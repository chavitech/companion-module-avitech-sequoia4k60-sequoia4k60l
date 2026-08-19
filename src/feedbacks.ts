import { combineRgb } from '@companion-module/base'
import type ModuleInstance from './main.js'
import { INPUT_CHOICES, INPUT_IDS } from './signal.js'

/**
 * Feedbacks driven by "Signal Type - Get" (Table 1.3.1.2). The state they read is refreshed by the
 * poll loop in `ModuleInstance`, so it is only as live as `pollInterval` - and it does not update
 * at all in daisy-chain mode, where the module does not poll. See `ModuleInstance.startPolling()`.
 */
export type FeedbacksSchema = {
	input_signal_present: {
		type: 'boolean'
		options: {
			input: number
		}
	}
}

export const SIGNAL_FEEDBACK_ID = 'input_signal_present'

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
	})
}
