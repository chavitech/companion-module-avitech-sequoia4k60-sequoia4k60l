import type { CompanionVariableDefinitions } from '@companion-module/base'
import type ModuleInstance from './main.js'
import { INPUT_IDS, formatSignal, type InputId, type InputSignal } from './signal.js'

/**
 * Variables published from "Signal Type - Get" (Table 1.3.1.2), refreshed by the poll loop in
 * `ModuleInstance`. See `signal.ts` for what the device actually reports and why only these fields
 * are exposed.
 */
export type VariablesSchema = {
	[K in `input_${InputId}_signal`]: string
} & {
	[K in `input_${InputId}_width` | `input_${InputId}_height` | `input_${InputId}_refresh`]: number
} & {
	/** How many of the four inputs currently report a signal. */
	inputs_present: number
}

export function UpdateVariableDefinitions(self: ModuleInstance): void {
	const definitions = {} as CompanionVariableDefinitions<VariablesSchema>

	for (const id of INPUT_IDS) {
		definitions[`input_${id}_signal`] = { name: `Input ${id} format (e.g. "3840x2160 60Hz")` }
		definitions[`input_${id}_width`] = { name: `Input ${id} active width in pixels` }
		definitions[`input_${id}_height`] = { name: `Input ${id} active height in pixels` }
		definitions[`input_${id}_refresh`] = { name: `Input ${id} refresh rate in Hz` }
	}

	definitions.inputs_present = { name: 'Number of inputs with a signal' }

	self.setVariableDefinitions(definitions)
}

/**
 * Maps the parsed signal state onto variable values. Every input is always written, including the
 * ones with no signal, so a source disappearing clears its variables rather than leaving the last
 * format on the button.
 */
export function SignalVariableValues(signals: InputSignal[]): Partial<VariablesSchema> {
	const values: Partial<VariablesSchema> = {}

	for (const signal of signals) {
		values[`input_${signal.input}_signal`] = formatSignal(signal)
		values[`input_${signal.input}_width`] = signal.width
		values[`input_${signal.input}_height`] = signal.height
		values[`input_${signal.input}_refresh`] = signal.refresh
	}

	values.inputs_present = signals.filter((signal) => signal.present).length

	return values
}
