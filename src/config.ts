import { Regex, type SomeCompanionConfigField } from '@companion-module/base'
import { DEVICE_MODE_CHOICES, type DeviceMode } from './models.js'

export type ModuleConfig = {
	mode: DeviceMode
	host: string
	port: number
	/**
	 * Seconds between polls of "Signal Type - Get". 0 disables polling. See `POLL_INTERVAL_DISABLED`.
	 *
	 * This is the only interval the user sets, and it is the signal read's. "Firmware Version - Get"
	 * rides the same loop at a fraction of the rate - see `deviceInfoEveryTicks()`. A second field
	 * would ask the user to tune something they have no way to reason about, and the measurement
	 * that fraction comes from is the module's to make, not theirs.
	 */
	pollInterval: number
}

/** The `pollInterval` value that turns the signal poll loop off entirely. */
export const POLL_INTERVAL_DISABLED = 0

export const POLL_INTERVAL_DEFAULT = 2

/**
 * How often the device-info half of the poll loop is refreshed, in seconds.
 *
 * The two reads on the poll loop move at wildly different speeds. "Signal Type - Get" changes the
 * moment a source is unplugged, which is what the configured interval is for. The live fields of
 * "Firmware Version - Get" do not: sampled every 20 seconds for 7 minutes on a 4K60L (2026-08-26),
 * `temp`, `fan_status`, `sob_alive`, `wall_lock_status` and `usage_time` never moved at all, and
 * `temp` shifted by one degree over two *days*.
 *
 * So reading it every tick spends half the module's request budget watching fields that change on
 * the scale of hours. 30 seconds is far below the rate at which any of them has been observed to
 * move, and at the default 2-second interval it takes a sustained ~1 request/second down to ~0.53.
 *
 * A target, not a bound - the read can only ride ticks that exist. See `deviceInfoEveryTicks()`.
 */
export const DEVICE_INFO_REFRESH_SECONDS = 30

/**
 * How many poll ticks apart the device-info reads should be, given the configured signal interval.
 *
 * Derived rather than a fixed count so the device-info read keeps its own cadence instead of
 * inheriting the signal read's: at a 2-second interval that is every 15th tick, and at a 30-second
 * one it is every tick.
 *
 * It rounds up, so the period reached is at least `DEVICE_INFO_REFRESH_SECONDS` and can overshoot
 * it by up to one interval - a 20-second interval gives a 40-second period, because a read can only
 * ride a tick that exists. Never less than every tick, which is what an interval at or above the
 * target already means.
 */
export function deviceInfoEveryTicks(intervalSeconds: number): number {
	if (intervalSeconds <= POLL_INTERVAL_DISABLED) {
		return 1
	}

	return Math.max(1, Math.ceil(DEVICE_INFO_REFRESH_SECONDS / intervalSeconds))
}

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
			label: 'Poll Interval (seconds)',
			width: 6,
			min: POLL_INTERVAL_DISABLED,
			max: 3600,
			default: POLL_INTERVAL_DEFAULT,
			tooltip: `How often to refresh the input signal variables and feedbacks. Set to 0 to disable. The device status fields change far too slowly to be worth reading this often, so they are refreshed roughly every ${DEVICE_INFO_REFRESH_SECONDS} seconds instead - or on every poll, if the interval is longer than that. Polling is always off in daisy-chain mode, where section 1.3.5 does not list these commands.`,
		},
	]
}
