import { Regex, type SomeCompanionConfigField } from '@companion-module/base'
import { DEVICE_MODE_CHOICES, type DeviceMode } from './models.js'

export type ModuleConfig = {
	mode: DeviceMode
	host: string
	port: number
	/** Seconds between "Signal Type - Get" polls. 0 disables polling. See `POLL_INTERVAL_DISABLED`. */
	pollInterval: number
}

/** The `pollInterval` value that turns the signal poll loop off entirely. */
export const POLL_INTERVAL_DISABLED = 0

export const POLL_INTERVAL_DEFAULT = 2

export function GetConfigFields(): SomeCompanionConfigField[] {
	return [
		{
			type: 'dropdown',
			id: 'mode',
			label: 'Model / Operating Mode',
			width: 6,
			choices: DEVICE_MODE_CHOICES,
			default: DEVICE_MODE_CHOICES[0].id,
		},
		{
			type: 'textinput',
			id: 'host',
			label: 'Target IP',
			width: 8,
			regex: Regex.IP,
		},
		{
			type: 'number',
			id: 'port',
			label: 'Target Port',
			width: 4,
			min: 1,
			max: 65535,
			default: 80,
		},
		{
			type: 'number',
			id: 'pollInterval',
			label: 'Signal Poll Interval (seconds)',
			width: 6,
			min: POLL_INTERVAL_DISABLED,
			max: 3600,
			default: POLL_INTERVAL_DEFAULT,
			tooltip:
				'How often to refresh input signal variables and feedbacks. Set to 0 to disable. Polling is always off in daisy-chain mode, where section 1.3.5 does not list this command.',
		},
	]
}
