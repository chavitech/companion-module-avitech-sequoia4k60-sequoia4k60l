import type { CompanionVariableDefinitions } from '@companion-module/base'
import type ModuleInstance from './main.js'
import { INPUT_IDS, formatSignal, type InputId, type InputSignal } from './signal.js'
import {
	FIRMWARE_FIELDS,
	HEALTH_FIELDS,
	type DeviceInfo,
	type FirmwareVariableId,
	type HealthVariableId,
} from './device-info.js'

/**
 * The module's variables, published from two reads with two different refresh stories.
 *
 * - "Signal Type - Get" (Table 1.3.1.2) is live per-input state, refreshed by the poll loop in
 *   `ModuleInstance`. See `signal.ts` for what the device actually reports and why only these
 *   fields are exposed.
 * - "Firmware Version - Get" (Table 1.3.1.1) is two things behind one request: version and identity
 *   strings that cannot change while a unit runs, and the health fields that can. It is read at
 *   connect and then on a fraction of the poll ticks - see `deviceInfoEveryTicks()` for why it does
 *   not ride every one. See `device-info.ts` for the shape.
 */
export type VariablesSchema = {
	[K in `input_${InputId}_signal`]: string
} & {
	[K in `input_${InputId}_width` | `input_${InputId}_height` | `input_${InputId}_refresh`]: number
} & {
	/** How many of the four inputs currently report a signal. */
	inputs_present: number
} & {
	[K in FirmwareVariableId]: string
} & {
	/**
	 * The live half of Table 1.3.1.1, refreshed by the poll loop at its own slower cadence. Numbers,
	 * except that a field the unit does not report reads as an empty string rather than as `0` - see
	 * `device-info.ts` on why absent and zero must not collapse together.
	 */
	[K in HealthVariableId]: number | string
} & {
	/** Identity fields from "Firmware Version - Get" (Table 1.3.1.1). See `device-info.ts`. */
	machine_name: string
	machine_type: string
	mac_address: string
	/** This unit's own network configuration, which §1.3.1.3 notably cannot identify. */
	device_ip: string
	device_gateway: string
	device_subnet: string
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

	for (const field of FIRMWARE_FIELDS) {
		definitions[field.id] = { name: `${field.label} firmware version` }
	}

	for (const field of HEALTH_FIELDS) {
		definitions[field.id] = {
			name: field.documented ? field.label : `${field.label} (meaning not documented by the vendor)`,
		}
	}

	definitions.machine_name = { name: 'Machine name reported by the device' }
	definitions.machine_type = { name: 'Machine type reported by the device' }
	definitions.mac_address = { name: 'MAC address reported by the device' }
	definitions.device_ip = { name: 'IP address reported by the device' }
	definitions.device_gateway = { name: 'Gateway reported by the device' }
	definitions.device_subnet = { name: 'Subnet mask reported by the device' }

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

/**
 * Maps the parsed device info onto variable values.
 *
 * Every field is always written, including the empty ones, for the same reason `SignalVariableValues`
 * writes absent inputs: a device that stops reporting a version string should clear it rather than
 * leave the previous unit's value on a button after the host is repointed.
 */
export function DeviceInfoVariableValues(info: DeviceInfo): Partial<VariablesSchema> {
	const values: Partial<VariablesSchema> = {}

	for (const field of FIRMWARE_FIELDS) {
		values[field.id] = info.firmware[field.key]
	}

	for (const field of HEALTH_FIELDS) {
		// An unreported field publishes as '' rather than 0: on a button, blank reads as "the unit
		// didn't say", where 0 reads as a measurement it never made.
		values[field.id] = info.health[field.key] ?? ''
	}

	values.machine_name = info.machineName
	values.machine_type = info.machineType
	values.mac_address = info.macAddress
	values.device_ip = info.ip
	values.device_gateway = info.gateway
	values.device_subnet = info.subnet

	return values
}
