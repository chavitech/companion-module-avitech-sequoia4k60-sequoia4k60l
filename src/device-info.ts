import type { AvitechResponse } from './avitech-api.js'

/**
 * Parsing for "Firmware Version - Get" (Table 1.3.1.1), the read `checkConnection()` already sends
 * on every connect.
 *
 * **Bench-captured from a 4K60L on 2026-08-24**, and cross-checked against the guide's Figure
 * 1.3.1.1, which was recovered by extracting the page image (`pdfimages -png -f 9`). Every key the
 * figure shows is present on hardware with the same spelling, the same type and the same array
 * length - this is one of the few shapes in this module where the guide turned out to be exactly
 * right about what it documented.
 *
 * What it was *not* right about is completeness. The hardware reply carries **51 keys to the
 * figure's 32**, a strict superset, including a ninth version string (`oip_ver`) that appears
 * nowhere in the guide. The two units differ in both model and firmware age - the figure is a 4K60
 * on 2022-2024 firmware, the capture a 4K60L on 2026 firmware - so **nothing here attributes the
 * extra keys to either axis.** They may be new firmware, they may be the other model. Every field
 * is optional for that reason: a missing key degrades to an empty string rather than being an error.
 *
 * The 4K60 itself has still never been on a bench. The figure is the only evidence about it.
 *
 * The 2026-08-24 capture, in full (192.168.0.7, a 4K60L):
 *
 * ```json
 * {"machine_name":"Sequoia4K60L","machine_type":"Sequoia4K60L.v2","usage_time":0,
 *  "cb_firmware":"26:7:24:13","web_version":"2026.7.23.120 01","kernel":"Thu Sep 26 16:25:06 CST 2024",
 *  "mac_addr":"00:23:21:00:20:90","sob_firmware":"2026:7:24:2","sob_alive":1,"temp":"34",
 *  "resolution":[0,0,0,0,0],"remote_en":[1,1,1,0,1],"osd_en":[1,0,0,0,0],
 *  "km_mcu":"V0.00.01 01.30.2026","km_usb":"0.2.4 2022-10-06","scaler_ver":"26.7.23.14",
 *  "scaler_alive":1,"mediator_ver":"25.10.30.01","fan_status":0,"audio":[0,0,0,0,0],
 *  "sib_hdcp":[1,0,1,1],"fading_time":[0],"sob_alarm":1,"wall_lock_status":0,
 *  "avahi_ip":"169.254.5.170","ws_total_user":0,"udp_port":20037,"ttf":1,
 *  "force_source_color":[0,0,0,0],"custom_edid":["0x0p","0x0p","0x0p","0x0p"],
 *  "auto_remote":[0,0,0,0,0],"daisy_chain":0,"daisy_startup_flag":0,"daisy_audio":0,
 *  "daisy_active":0,"daisy_dip":0,"idle_time":0,"daisy_slave_mode":0,"remote_winid":[0,0,0,0,0],
 *  "remote_mouse_mode":[0,0,0,0,0],"gateway":"","subnet":"255.255.255.0","ip_dev_bundle":0,
 *  "oip_ver":"2025.6.2.15","ip_dev_bundle_ip":"0.0.0.0","DH_MASTER":1,"ip":"192.168.0.7",
 *  "remote_manager_en":0,"change_template":0,"inp_bit":[0,0,0,0],"scaler_menu":[0,0]}
 * ```
 *
 * The figure, for comparison (a 4K60 - the only evidence that model has produced):
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
 * Three details the capture settles, all of which had been guesses:
 *
 * - **`temp` is a string** (`"34"`, `"45"`) on both, where a number would be expected.
 * - **`fading_time` is an array of one** (`[0]`) on both, not a scalar.
 * - **The five-wide port arrays are not a 4K60 thing.** `resolution`, `remote_en`, `osd_en`,
 *   `audio` and `auto_remote` are all five entries long on the **4K60L** too, which has only four
 *   HDMI outputs - and `remote_en` came back `[1,1,1,0,1]`, so the fifth slot is not inert padding
 *   either. Anything that later maps these arrays onto ports must not size itself from
 *   `capabilities.maxPorts`. This is the same trap `INPUT_IDS` exists to avoid in `signal.ts`.
 *
 * Only the version strings and the machine's identity are modelled below. The rest of that payload
 * is live state with no other read path - `resolution`, `audio`, `osd_en`, `remote_en`, `temp`,
 * `daisy_active`, `wall_lock_status` and friends - and is the obvious next wave of variables, but it
 * is state that *changes*, so it needs a refresh story rather than the read-once one below. The
 * version strings do not change while a unit is running, which is what makes them the cheap half.
 */

/**
 * The nine version strings, named after the wire keys rather than after Table 1.3.1.1's prose.
 *
 * The prose promises "MCU / Scaler / Web / KM firmware version" - four things - and the figure
 * carries eight, with no mapping given between the two, while hardware added a ninth the guide
 * never mentions. `cb_firmware`, `sob_firmware` and `oip_ver` are unexplained by any part of the
 * guide. Renaming them to a guessed meaning would bake that guess into a variable id users put on
 * buttons, so the wire key is what survives.
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
	/**
	 * `oip_ver` ("2025.6.2.15"). A ninth version string that the guide's figure does not contain at
	 * all - it was found only in the 2026-08-24 hardware capture, so it is unknown whether it is new
	 * firmware or the other model. Absent on a unit that does not report it, which reads as blank.
	 */
	oip: string
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
		firmware: { cb: '', sob: '', scaler: '', mediator: '', oip: '', web: '', kmMcu: '', kmUsb: '', kernel: '' },
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
			oip: toText(entry.oip_ver),
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
 * this, so a new version string is one entry here rather than an edit in three places - which is
 * exactly how `oip_ver` was added when hardware turned out to report one the guide never showed.
 *
 * `as const` is what makes that work - `FirmwareVariableId` is derived from these literals, so the
 * variables schema cannot drift from the list that populates it.
 */
export const FIRMWARE_FIELDS = [
	{ key: 'cb', id: 'firmware_cb', label: 'CB' },
	{ key: 'sob', id: 'firmware_sob', label: 'SOB' },
	{ key: 'scaler', id: 'firmware_scaler', label: 'Scaler' },
	{ key: 'mediator', id: 'firmware_mediator', label: 'Mediator' },
	{ key: 'oip', id: 'firmware_oip', label: 'OIP' },
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
