import { combineRgb } from '@companion-module/base'
import type ModuleInstance from './main.js'
import { INPUT_CHOICES, INPUT_IDS } from './signal.js'
import { HEALTH_COMPARISON_FIELDS, type HealthFieldKey } from './device-info.js'
import { DEVICE_INFO_REFRESH_SECONDS } from './config.js'

/**
 * Feedbacks driven by the two polled reads: "Signal Type - Get" (Table 1.3.1.2) and the live half of
 * "Firmware Version - Get" (Table 1.3.1.1).
 *
 * The signal feedback is as live as `pollInterval`; the three device ones are only as live as
 * `DEVICE_INFO_REFRESH_SECONDS`, since that read rides only a fraction of the ticks. None of them
 * update in daisy-chain mode, where the module does not poll at all. See
 * `ModuleInstance.startPolling()`. Every description below says so, because a feedback that silently
 * stops updating is worse than one that is absent - and one that refreshes more slowly than the
 * configured interval would otherwise read as a stuck value.
 */
export type FeedbacksSchema = {
	input_signal_present: {
		type: 'boolean'
		options: {
			input: number
		}
	}
	device_temp_above: {
		type: 'boolean'
		options: {
			threshold: number
		}
	}
	device_alert_display: {
		type: 'boolean'
		options: {
			enabled: number
		}
	}
	device_status_field: {
		type: 'boolean'
		options: {
			field: HealthFieldKey
			comparison: Comparison
			value: number
		}
	}
}

export const SIGNAL_FEEDBACK_ID = 'input_signal_present'

/** Feedback ids refreshed whenever a device-info poll lands. */
export const DEVICE_FEEDBACK_IDS = ['device_temp_above', 'device_alert_display', 'device_status_field'] as const

type Comparison = 'eq' | 'ne' | 'gt' | 'lt'

const COMPARISON_CHOICES = [
	{ id: 'eq', label: 'is equal to' },
	{ id: 'ne', label: 'is not equal to' },
	{ id: 'gt', label: 'is greater than' },
	{ id: 'lt', label: 'is less than' },
] as const

function compare(actual: number, comparison: Comparison, expected: number): boolean {
	switch (comparison) {
		case 'eq':
			return actual === expected
		case 'ne':
			return actual !== expected
		case 'gt':
			return actual > expected
		case 'lt':
			return actual < expected
	}
}

export function UpdateFeedbacks(self: ModuleInstance): void {
	self.setFeedbackDefinitions({
		input_signal_present: {
			name: 'Input has signal',
			description:
				'True while the device reports a locked source on the selected input. Requires signal polling to be enabled in the instance config.',
			type: 'boolean',
			defaultStyle: {
				bgcolor: combineRgb(0, 128, 0),
				color: combineRgb(255, 255, 255),
			},
			options: [
				{
					id: 'input',
					type: 'dropdown',
					label: 'Input',
					default: INPUT_IDS[0],
					choices: INPUT_CHOICES,
				},
			],
			callback: (feedback) => self.getInputSignal(feedback.options.input)?.present ?? false,
		},

		/**
		 * The one health reading with an obvious operator use. The threshold comes from the user
		 * rather than from a constant here, which also sidesteps the fact that the guide never states
		 * the unit: whatever `temp` is counted in, the user picks a number in the same scale after
		 * watching `$(device_temp)`.
		 *
		 * False while the unit reports no temperature at all - an unknown reading must not look like
		 * a cool one, but neither should it alarm.
		 */
		device_temp_above: {
			name: 'Device temperature above threshold',
			description: `True while the temperature the device reports is above the threshold. The vendor does not document the unit of measurement, so set the threshold by watching $(device_temp) on a healthy unit. Requires polling to be enabled; device status is refreshed roughly every ${DEVICE_INFO_REFRESH_SECONDS} seconds rather than on every poll.`,
			type: 'boolean',
			defaultStyle: {
				bgcolor: combineRgb(160, 0, 0),
				color: combineRgb(255, 255, 255),
			},
			options: [
				{
					id: 'threshold',
					type: 'number',
					label: 'Above',
					default: 60,
					min: 0,
					max: 200,
				},
			],
			callback: (feedback) => {
				const temp = self.deviceInfo.health.temp

				return temp !== undefined && temp > feedback.options.threshold
			},
		},

		/**
		 * `sob_alarm`, the only field in the live half with a documented meaning: Table 1.3.1.22
		 * defines it as the on/off setting for the unit's fan-failure and temperature alert display.
		 *
		 * It is a *setting*, not an alarm state, and this feedback is named and styled accordingly -
		 * neutral, and matching either value the user selects. Reading it as "the device is alarming"
		 * would light a button on every correctly configured unit, since 1 means alerts are switched
		 * on. It pairs with the Alert Display action as a state indicator on the same button.
		 */
		device_alert_display: {
			name: 'Alert display setting',
			description: `True while the device's fan-failure and temperature alert display is set to the selected state (section 1.3.1.22). This is the setting, not an active alarm - a healthy unit normally reports it enabled. Requires polling to be enabled; device status is refreshed roughly every ${DEVICE_INFO_REFRESH_SECONDS} seconds rather than on every poll.`,
			type: 'boolean',
			defaultStyle: {
				bgcolor: combineRgb(0, 0, 128),
				color: combineRgb(255, 255, 255),
			},
			options: [
				{
					id: 'enabled',
					type: 'dropdown',
					label: 'Alert display is',
					default: 1,
					choices: [
						{ id: 1, label: 'Enabled' },
						{ id: 0, label: 'Disabled' },
					],
				},
			],
			callback: (feedback) => self.deviceInfo.health.alertDisplay === feedback.options.enabled,
		},

		/**
		 * The escape hatch for the undocumented half of Table 1.3.1.1.
		 *
		 * `fan_status`, `sob_alive`, `scaler_alive`, `daisy_active`, `wall_lock_status` and
		 * `usage_time` appear nowhere in the guide's text - they were found by capturing the response.
		 * Their values are visible, but what any particular value *means* is not known, and on a
		 * healthy 4K60L they read 0, 1, 1, 0, 0, 0.
		 *
		 * So rather than ship a "Fan fault" feedback whose polarity is a guess - the failure mode
		 * being a button that stays green through an actual fan failure - this exposes the raw
		 * comparison and lets an operator who has watched their own unit decide. One definition
		 * covers all six fields, and none of them needs the module to assert a meaning it does not
		 * have. Promote a field to its own named feedback when a bench result establishes what its
		 * values mean, not before.
		 */
		device_status_field: {
			name: 'Device status field comparison (advanced)',
			description: `Compares a raw status field from the device against a value. The vendor does not document what these fields mean, so watch the matching variable on a healthy unit before relying on one. Requires polling to be enabled; device status is refreshed roughly every ${DEVICE_INFO_REFRESH_SECONDS} seconds rather than on every poll.`,
			type: 'boolean',
			defaultStyle: {
				bgcolor: combineRgb(160, 100, 0),
				color: combineRgb(255, 255, 255),
			},
			options: [
				{
					id: 'field',
					type: 'dropdown',
					label: 'Field',
					default: HEALTH_COMPARISON_FIELDS[0].key,
					choices: HEALTH_COMPARISON_FIELDS.map((field) => ({ id: field.key, label: field.label })),
				},
				{
					id: 'comparison',
					type: 'dropdown',
					label: 'Comparison',
					default: 'eq',
					choices: [...COMPARISON_CHOICES],
				},
				{
					id: 'value',
					type: 'number',
					label: 'Value',
					default: 0,
					min: -65535,
					max: 65535,
				},
			],
			callback: (feedback) => {
				const actual = self.deviceInfo.health[feedback.options.field]

				// An unreported field is never a match, on any comparison. "Not equal to 0" must not
				// come out true just because the unit said nothing.
				return actual !== undefined && compare(actual, feedback.options.comparison, feedback.options.value)
			},
		},
	})
}
