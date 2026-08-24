import type { AvitechResponse } from './avitech-api.js'

/**
 * Parsing for "Firmware Version - Get" (Table 1.3.1.1), the read `checkConnection()` already sends
 * on every connect.
 *
 * **This shape has not been captured from hardware.** It was recovered from the guide's Figure
 * 1.3.1.1 by extracting the page image (`pdfimages -png -f 9`), so it is the vendor's own
 * screenshot: trustworthy about which keys exist and how they are spelled, and not evidence about
 * any particular unit's values. Two things follow, and both are deliberate:
 *
 * - Every field is optional here even though the figure shows all of them. The figure is one
 *   machine on one firmware; §1.3.2 is this project's standing reminder that documentation-faithful
 *   and correct are different claims.
 * - The figure is a **4K60** (`machine_name` reads `Sequoia4K60`). Whether a 4K60L answers with the
 *   same key set is untested. Nothing here is keyed off the model, so a missing key degrades to an
 *   empty string rather than being an error.
 *
 * The captured figure, transcribed in full:
 *
 * ```json
 * {"machine_name":"Sequoia4K60","machine_type":"Sequoia4K60.v1","usage_time":0,
 *  "cb_firmware":"23:12:21:3","web_version":"24.01.02.104 01","kernel":"Fri Apr 29 16:42:28 CST 2022",
 *  "mac_addr":"00:23:21:00:1E:A0","sob_firmware":"2023:12:25:1","sob_alive":1,"temp":"45",
 *  "resolution":[0,0,0,0,0],"remote_en":[1,0,0,0,0],"osd_en":[0,0,0,0,0],
 *  "km_mcu":"V0.00.01 12.08.2023","km_usb":"0.2.3 2020-12-02","scaler_ver":"24.1.2.10",
 *  "scaler_alive":1,"mediator_ver":"23.12.15.01","audio":[0,0,0,0,0],"sib_hdcp":[1,1,1,1],
 *  "fading_time":[0],"sob_alarm":0,"wall_lock_status":0,"avahi_ip":"169.254.6.0","udp_port":20037,
 *  "force_source_color":[0,0,0,0],"custom_edid":["0x0p","0x0p","0x0p","0x0p"],
 *  "auto_remote":[0,0,0,0,0],"daisy_chain":0,"daisy_audio":0,"daisy_active":0,"idle_time":0}
 * ```
 *
 * Only the version strings and the machine's identity are modelled below. The rest of that payload
 * is live state with no other read path - `resolution`, `audio`, `osd_en`, `remote_en`, `temp`,
 * `daisy_active`, `wall_lock_status` and friends - and is the obvious next wave of variables, but it
 * is state that *changes*, so it needs a refresh story rather than the read-once one below. The
 * version strings do not change while a unit is running, which is what makes them the cheap half.
 */

/**
 * The eight version strings, named after the wire keys rather than after Table 1.3.1.1's prose.
 *
 * The prose promises "MCU / Scaler / Web / KM firmware version" - four things - and the response
 * carries eight, with no mapping given between the two. `cb_firmware` and `sob_firmware` in
 * particular are unexplained by any part of the guide. Renaming them to a guessed meaning would
 * bake that guess into a variable id users put on buttons, so the wire key is what survives.
 */
export interface DeviceFirmware {
	/** `cb_firmware`. Colon-separated date-like string in the figure ("23:12:21:3"). */
	cb: string
	/** `sob_firmware`. Same shape ("2023:12:25:1"). Paired with `sob_alive` in the response. */
	sob: string
	/** `scaler_ver` ("24.1.2.10"). The "Scaler" of the prose's four. */
	scaler: string
	/** `mediator_ver` ("23.12.15.01"). */
	mediator: string
	/** `web_version` ("24.01.02.104 01"). The "Web" of the prose's four. */
	web: string
	/** `km_mcu` ("V0.00.01 12.08.2023"). K/M control board; the prose's "MCU" and "KM" both plausibly point here. */
	kmMcu: string
	/** `km_usb` ("0.2.3 2020-12-02"). */
	kmUsb: string
	/** `kernel`. A build date, not a version number ("Fri Apr 29 16:42:28 CST 2022"). */
	kernel: string
}

/** Identity fields from the same read, published alongside the versions because they arrive free. */
export interface DeviceInfo {
	firmware: DeviceFirmware
	/** `machine_name` ("Sequoia4K60"). The unit's own name for itself, not the configured mode. */
	machineName: string
	/** `machine_type` ("Sequoia4K60.v1"). */
	machineType: string
	/** `mac_addr` ("00:23:21:00:1E:A0"). */
	macAddress: string
}

/** The state before any read has succeeded, and what an unparseable reply degrades to. */
export function emptyDeviceInfo(): DeviceInfo {
	return {
		firmware: { cb: '', sob: '', scaler: '', mediator: '', web: '', kmMcu: '', kmUsb: '', kernel: '' },
		machineName: '',
		machineType: '',
		macAddress: '',
	}
}

/**
 * Normalises a "Firmware Version - Get" response.
 *
 * Never throws and never reports failure: a reply that is not an object degrades to
 * `emptyDeviceInfo()`, which reads as blank variables rather than as stale ones. The guide's own
 * Figure 1.2.6 documents `null` and `{ }` as answers when there is no data, so an empty object is a
 * shape the device really produces and not a malformed reply.
 */
export function parseDeviceInfo(response: AvitechResponse): DeviceInfo {
	if (response === null || typeof response !== 'object' || Array.isArray(response)) {
		return emptyDeviceInfo()
	}

	const entry = response

	return {
		firmware: {
			cb: toText(entry.cb_firmware),
			sob: toText(entry.sob_firmware),
			scaler: toText(entry.scaler_ver),
			mediator: toText(entry.mediator_ver),
			web: toText(entry.web_version),
			kmMcu: toText(entry.km_mcu),
			kmUsb: toText(entry.km_usb),
			kernel: toText(entry.kernel),
		},
		machineName: toText(entry.machine_name),
		machineType: toText(entry.machine_type),
		macAddress: toText(entry.mac_addr),
	}
}

/**
 * The variable-facing view of `DeviceFirmware`: one entry per version string, in the order they
 * should read in the variables list. `variables.ts` builds both the definitions and the values from
 * this, so a ninth version string is one entry here rather than an edit in three places.
 *
 * `as const` is what makes that work - `FirmwareVariableId` is derived from these literals, so the
 * variables schema cannot drift from the list that populates it.
 */
export const FIRMWARE_FIELDS = [
	{ key: 'cb', id: 'firmware_cb', label: 'CB' },
	{ key: 'sob', id: 'firmware_sob', label: 'SOB' },
	{ key: 'scaler', id: 'firmware_scaler', label: 'Scaler' },
	{ key: 'mediator', id: 'firmware_mediator', label: 'Mediator' },
	{ key: 'web', id: 'firmware_web', label: 'Web' },
	{ key: 'kmMcu', id: 'firmware_km_mcu', label: 'K/M MCU' },
	{ key: 'kmUsb', id: 'firmware_km_usb', label: 'K/M USB' },
	{ key: 'kernel', id: 'firmware_kernel', label: 'Kernel' },
] as const satisfies ReadonlyArray<{ key: keyof DeviceFirmware; id: string; label: string }>

export type FirmwareVariableId = (typeof FIRMWARE_FIELDS)[number]['id']

/**
 * A one-line summary for the log, listing only the versions the unit actually reported.
 *
 * Skipping the blanks matters: it is how "this firmware does not report `mediator_ver`" stays
 * visible in the log instead of being flattened into an empty value that reads like a parse bug.
 */
export function formatFirmware(info: DeviceInfo): string {
	const parts = FIRMWARE_FIELDS.filter(({ key }) => info.firmware[key]).map(
		({ key, label }) => `${label} ${info.firmware[key]}`,
	)

	return parts.length ? parts.join(', ') : 'no version strings reported'
}

function toText(value: unknown): string {
	// `temp` arrives as a string ("45") where a number would be expected, so this response is known
	// to be loose about the two. Numbers are accepted and stringified rather than dropped.
	if (typeof value === 'string') {
		return value
	}

	return typeof value === 'number' && Number.isFinite(value) ? String(value) : ''
}
