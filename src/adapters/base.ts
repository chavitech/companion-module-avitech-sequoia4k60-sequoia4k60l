import type { AvitechHttpApi, AvitechResponse } from '../avitech-api.js'
import type { DeviceModel } from '../models.js'
import type ModuleInstance from '../main.js'

/**
 * Fixed differences between the two machines that the rest of the module needs to know about
 * (e.g. to build option choices, or to gate a command that's only valid on one model).
 */
export interface SequoiaCapabilities {
	/** Number of HDMI outputs/windows the device exposes. Port 5 exists only on the 4K60. */
	maxPorts: number
	/** Whether this model supports HDMI daisy-chaining additional units. */
	supportsDaisyChain: boolean
}

/**
 * One window's entry in a "Window Position and Size - Set" request (Table 1.3.2.2).
 *
 * The guide's `data` array is [x, y, w, h, z, aspect, fit, show], but `z` is deliberately absent
 * here. It is not a value the caller gets to choose: the device's z-order turned out to be real
 * state that the guide describes incorrectly, so `setWindowGeometry` reads it off the device and
 * carries it through rather than deriving or accepting one. See that method for the measurements.
 */
export interface WindowGeometry {
	/** position_x, 0 to 3840 */
	x: number
	/** position_y, 0 to 2160 */
	y: number
	/** size_w, 960 to 3840 */
	w: number
	/** size_h, 540 to 2160 */
	h: number
	/** Keep aspect ratio, 0-5. See ASPECT_CHOICES in windows.ts. */
	aspect: number
	/** Fit to window, 0 (disabled) / 1 (enabled) */
	fit: number
	/** 0 (hide) / 1 (show) */
	show: number
}

/**
 * Every command in section 1.3.2 that takes a `port` accepts 1, plus 3 for the 4K60 in "Dual
 * Independent Quad Multiview + Bypass" mode. That mode isn't one of `DEVICE_MODES`, so port is
 * fixed to 1 throughout - the same way the 4K60L adapter fixes `port` on its K/M commands.
 */
const WINDOW_COMMAND_PORT = 1

/**
 * Section 1.3.1's preset, layout and OSD commands carry `"port":1` in every worked example the
 * guide gives. Table 1.3.1.15 (OSD Show/Hide) is the only one to document a second value - port 3,
 * for the 4K60 in "Dual Independent Quad Multiview + Bypass" mode, which is not one of
 * `DEVICE_MODES` - so 1 is the only reachable value here too.
 *
 * Kept separate from `WINDOW_COMMAND_PORT` despite holding the same value: the two constants are 1
 * for different documented reasons, and collapsing them would tie section 1.3.1's port handling to
 * a section 1.3.2 rationale that does not actually cover it.
 *
 * The commands that take a caller-supplied port (`setOutputResolution`, `setPowerSavingMode`) do
 * not use this.
 */
const SYSTEM_COMMAND_PORT = 1

/**
 * Preset slot holding the "Save Latest" layout, per Table 1.3.1.10 - the layout the unit restores
 * at power-on. The guide gives no name for this slot and no indication of what occupies slots 6-14;
 * 15 is simply the number its example sends.
 */
const LATEST_DISPLAY_PRESET_NUM = 15

/**
 * An RGBA colour as the device expects it on the wire: `[R, G, B, A]`, each 0-255.
 *
 * The meaning of the fourth component depends on which OSD key it is written to, and the guide is
 * explicit about the split: label colours document it as a "transparency level (0-255)", while
 * every other colour (tally, border, popup menu) documents it as "255 (fixed)". `system.ts` builds
 * these from Companion colour pickers accordingly.
 */
export type DeviceColor = [number, number, number, number]

/**
 * The `data` payload of "OSD - Set" (Table 1.3.1.16).
 *
 * Tables 1.3.1.17 through 1.3.1.21 (Window Border, Window Label Color, Audio Tally Color, Audio
 * Tally Show/Hide, Active Window Border) are not separate commands - each one is this same request
 * carrying a subset of these keys. They are documented separately because they are separate
 * *tasks*, and `actions.ts` follows the guide's split so that each button exposes only the fields
 * that task needs. `setOsd` therefore takes a partial payload and writes exactly what it is given.
 *
 * Keys are snake_case because they are placed on the wire verbatim.
 *
 * `active_border` comes from Table 1.3.1.21 and is absent from 1.3.1.16's own key list, even though
 * 1.3.1.21 sends it through this same `type: "osd"` request.
 */
export interface OsdSettings {
	/** HDMI embedded audio switch tally. 0 (hide) / 1 (show). */
	show_tally1: number
	tally1_on_color: DeviceColor
	tally1_off_color: DeviceColor
	show_label: number
	/** 0 (label always shown) / 1 (label auto-hides). Only takes effect while `show_label` is 1. */
	auto_hide_label: number
	label_font_color: DeviceColor
	label_back_color: DeviceColor
	/** 0 (label sits outside the image) / 1 (label overlays the image). */
	label_overlay: number
	/** 0 (text follows the label background transparency) / 1 (text stays opaque). */
	label_text_transparency: number
	/** 0 (no border), or a width in pixels: 2, 4 or 6. */
	border_width: number
	border_color: DeviceColor
	popupmenu_active_color: DeviceColor
	popupmenu_available_color: DeviceColor
	popupmenu_disable_color: DeviceColor
	/** 0 (off) / 1 (on). Table 1.3.1.21. */
	active_border: number
}

/** Offset of the z value inside a Table 1.3.2.2 `data` array: [x, y, w, h, z, aspect, fit, show]. */
const GEOMETRY_Z_INDEX = 4

/**
 * State that "Window Position and Size - Set" has to write but that the action deliberately does
 * not expose, so it is carried over from the current device state rather than invented. See
 * `setWindowGeometry` for why.
 */
interface PreservedGeometryState {
	/** Current z value per window, indexed by `id - 1`. */
	z: number[]
	globalOption: unknown[]
	defaultLayout: number
	preset: number
}

/**
 * Pulls the carry-through fields out of a Table 1.3.2.1 response.
 *
 * Deliberately strict: a field we cannot read is thrown on rather than defaulted, because the
 * documented default is exactly the value that was found to be wrong on real hardware. Aborting the
 * write is a smaller failure than silently resetting device state.
 *
 * Throws a plain `Error` rather than `AvitechApiError` on purpose - importing that would pull
 * `avitech-api.js` (and through it `@companion-module/base`) into the adapter import chain, which
 * `tools/bench.mjs` relies on staying free of runtime dependencies.
 */
function readPreservedGeometryState(response: AvitechResponse): PreservedGeometryState {
	if (response === null || typeof response !== 'object' || Array.isArray(response)) {
		throw new Error(`Expected an object from the window geometry Get, received: ${JSON.stringify(response)}`)
	}

	const { win, global_option: globalOption, default_layout: defaultLayout, preset } = response

	if (!Array.isArray(win)) throw new Error('Window geometry response has no "win" array')
	if (!Array.isArray(globalOption)) throw new Error('Window geometry response has no "global_option" array')
	if (typeof defaultLayout !== 'number') throw new Error('Window geometry response has no "default_layout" number')
	if (typeof preset !== 'number') throw new Error('Window geometry response has no "preset" number')

	const z: number[] = []
	for (const entry of win) {
		if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
			throw new Error('Window geometry response contains a malformed "win" entry')
		}

		const { id, data } = entry as Record<string, unknown>
		if (typeof id !== 'number' || !Array.isArray(data) || typeof data[GEOMETRY_Z_INDEX] !== 'number') {
			throw new Error('Window geometry response contains a "win" entry with no id or z value')
		}

		z[id - 1] = data[GEOMETRY_Z_INDEX]
	}

	return { z, globalOption, defaultLayout, preset }
}

/**
 * Base class for a model-specific adapter. The abstract methods below (routing/audio) plus the
 * concrete section 1.3.2 window commands are supported in the same wire shape across every mode of
 * both models, so they're pulled up here for callers that don't need to know which concrete adapter
 * they're holding. Commands that only exist for one model (K/M mode, output resolution,
 * daisy-chain label text - see reference guide sections 1.3.4/1.3.5) live only on
 * `Sequoia4K60LAdapter`, and callers narrow with `instanceof` first.
 */
export abstract class SequoiaAdapter {
	abstract readonly model: DeviceModel
	abstract readonly capabilities: SequoiaCapabilities

	constructor(
		protected readonly self: ModuleInstance,
		protected readonly api: AvitechHttpApi,
	) {}

	abstract setRouting(input: number, port: number, winid: number): Promise<void>
	abstract getRouting(): Promise<AvitechResponse>
	abstract setAudio(port: number, winid: number): Promise<void>

	// --- Section 1.3.1, Commands for Controlling System -------------------------------------
	// Documented once for "Sequoia 4K60/4K60L", one request shape per command, so - as in section
	// 1.3.2 - there is nothing for a subclass to branch on.
	//
	// None of the responses below have been captured from hardware. Section 1.3.2's `get` comments
	// quote real captured payloads because that section was bench-tested; this one has not been, so
	// the shapes the guide shows only as screenshots are described but not asserted, and the `get`
	// actions log the reply verbatim rather than picking fields out of it.
	//
	// Two of these commands (`setOutputResolution`, `setKmControl`) are also documented in sections
	// 1.3.4 and 1.3.5 for the 4K60L specifically. They live here rather than on the 4K60L adapter
	// because 1.3.1 documents them for both machines - see their own comments.

	/**
	 * Table 1.3.1.1. Reports the MCU / Scaler / Web / KM firmware versions. Response shown in the
	 * guide only as a screenshot (Figure 1.3.1.1).
	 */
	async getFirmwareVersion(): Promise<AvitechResponse> {
		return this.api.sendCommand('Info', { func: 'get', type: 'device' })
	}

	/**
	 * Table 1.3.1.2. Reports whether each of the four windows currently has a signal:
	 * 0 (video absent) / 1 (video feed). Response shown only as a screenshot (Figure 1.3.1.2).
	 *
	 * This is the one 1.3.1 `get` genuinely worth driving feedbacks off once its shape is confirmed
	 * on hardware - it is per-window state that changes on its own, unlike firmware or network info.
	 */
	async getSignalType(): Promise<AvitechResponse> {
		return this.api.sendCommand('Info', { func: 'get', type: 'signal' })
	}

	/**
	 * Table 1.3.1.3. Reports IP address, MAC address and machine name for the Sequoia units on the
	 * same network - note this is a list of machines ("machinelist"), not only the one addressed.
	 * Response shown only as a screenshot (Figure 1.3.1.3).
	 */
	async getNetworkInfo(): Promise<AvitechResponse> {
		return this.api.sendCommand('Info', { func: 'get', type: 'machinelist' })
	}

	/**
	 * Table 1.3.1.4, and the same request as Tables 1.3.4.9/1.3.4.10 and section 1.3.5's Output
	 * Resolution - Set.
	 *
	 * On the base class because 1.3.1 documents it for both machines, not just the 4K60L: its
	 * Cmd-Value row reads `port = 1/2/3/4/5 (port 5 is only available for Sequoia 4K60)`, which only
	 * makes sense if the 4K60 accepts the command. Section 1.3.4 documents it a second time for the
	 * 4K60L's modes; both descriptions produce a byte-identical request, so there is one method.
	 *
	 * The caller supplies the port because the valid range is a property of the configured mode, not
	 * of the model: 1 for quad-bypass and daisy-chain, 1-4 for single-view seamless, 1-5 for the
	 * 4K60. `actions.ts` builds the choice list.
	 */
	async setOutputResolution(port: number, mode: number): Promise<void> {
		await this.api.sendCommand('2060', { func: 'set', type: 'resolution', port, mode })
	}

	/**
	 * Table 1.3.1.5. `layout` is 1 (quad), 2 (3 small + 1 large) or 3 (1 large + 3 small).
	 *
	 * The guide's Example 2/3 add a `"response"` key (0 = device sends no reply, 1 = it does). It is
	 * deliberately not sent: omitting it matches Example 1, and `response: 0` would suppress the very
	 * "Wrong format" reply `parseResponse` relies on to report a rejected command. There is nothing
	 * Companion gains from a silent write.
	 */
	async loadDefaultLayout(layout: number): Promise<void> {
		await this.api.sendCommand('2060', {
			func: 'load',
			type: 'default',
			port: SYSTEM_COMMAND_PORT,
			data: { default_layout: layout },
		})
	}

	/**
	 * Table 1.3.1.6, loading one of the five user icon presets shown in the web GUI under
	 * Layout & Routing > Multiview Layout. `presetNum` is 1-5.
	 *
	 * Table 1.3.1.10 ("Latest Display Preset - Load") is this same request with `preset_num: 15`,
	 * exposed as its own action because it is a different operation to an operator. The guide's
	 * Cmd-Value row spells the key `preset_unm`; every worked example spells it `preset_num`, which
	 * is what is sent here.
	 *
	 * `response` is omitted for the reason given on `loadDefaultLayout`.
	 */
	async loadPreset(presetNum: number): Promise<void> {
		await this.api.sendCommand('2060', {
			func: 'load',
			type: 'preset',
			port: SYSTEM_COMMAND_PORT,
			data: { preset_num: presetNum },
		})
	}

	/**
	 * Table 1.3.1.10. The layout last stored with "Save Latest", which is also what the unit loads
	 * at power-on. Preset slot 15 is the guide's own magic number for it.
	 */
	async loadLatestPreset(): Promise<void> {
		await this.loadPreset(LATEST_DISPLAY_PRESET_NUM)
	}

	/**
	 * Table 1.3.1.7. `name` is a saved custom preset filename, without any path or extension.
	 *
	 * The guide restricts the filename charset to A-Z, a-z, 0-9, `.`, `-` and `_`. That is not
	 * enforced here - the device answers "Wrong format" for a name it will not accept, and a
	 * client-side charset check would only duplicate that while risking being wrong about it.
	 */
	async loadCustomPreset(name: string): Promise<void> {
		await this.api.sendCommand('2060', {
			func: 'load',
			type: 'custom_preset',
			port: SYSTEM_COMMAND_PORT,
			name,
		})
	}

	/**
	 * Table 1.3.1.8. Lists saved custom preset filenames. Response shown only as Figure 1.3.1.7.
	 *
	 * Captured from a 4K60L on 2026-08-19: `[]` with nothing saved, then `["TestPreset"]`, then
	 * `["TestPreset2","TestPreset"]`. So this is a JSON array of **bare filename strings** with no
	 * extension and no wrapping object, and an empty list is an ordinary successful read rather than
	 * an error. A name from here feeds `loadCustomPreset()` and `deleteCustomPreset()` unchanged.
	 *
	 * The ordering is **not** settled. It is not ascending alphabetical, but the capture cannot tell
	 * newest-first from descending alphabetical - the newer file was also the later string. Nothing
	 * may assume element 0 is the most recent preset.
	 */
	async listCustomPresets(): Promise<AvitechResponse> {
		return this.api.sendCommand('2060', { func: 'list', type: 'custom_preset', port: SYSTEM_COMMAND_PORT })
	}

	/**
	 * Table 1.3.1.9. Deletes a saved custom preset by filename. Destructive and not undoable: the
	 * guide's own Function row says "Please be careful to type the filename correctly".
	 */
	async deleteCustomPreset(name: string): Promise<void> {
		await this.api.sendCommand('2060', {
			func: 'del',
			type: 'custom_preset',
			port: SYSTEM_COMMAND_PORT,
			name,
		})
	}

	/**
	 * Table 1.3.1.11. Resets the unit to its factory-default state.
	 *
	 * This erases every custom preset stored in the unit's flash memory - the guide says so
	 * explicitly and tells the reader to back presets up externally first.
	 *
	 * It does not take effect when sent. Tested on a 4K60L on 2026-07-29: the unit keeps running with
	 * its presets and normal command set fully intact, and the reset only lands on the next reboot.
	 * So there is a real window to recover in - back the presets up, or simply avoid power-cycling -
	 * and the loss becomes permanent at the power cut rather than at the button press. Warnings
	 * downstream say "destructive" without saying "immediate", because the second part is not true.
	 *
	 * There is still no confirmation step on the wire and no command to cancel a pending reset.
	 *
	 * Note the request is nothing like `loadDefaultLayout` despite both reading as "default": this
	 * is `Info` / `set` / `default` and wipes the device, that is `2060` / `load` / `default` and
	 * just rearranges the windows.
	 */
	async resetFactoryDefaults(): Promise<void> {
		await this.api.sendCommand('Info', { func: 'set', type: 'default' })
	}

	/**
	 * Table 1.3.1.12. Cross-fade duration when switching source in fullscreen mode: 0 turns fading
	 * off entirely, then 1 (fastest) through 255 (slowest).
	 *
	 * Applies only to fullscreen window source switching, per the guide's note - it has no effect on
	 * a multiview layout.
	 */
	async setFadingLevel(fadingTime: number): Promise<void> {
		await this.api.sendCommand('Info', { func: 'set', type: 'fading', fading_time: fadingTime })
	}

	/**
	 * Table 1.3.1.13, and the same request as Table 1.3.4.6 and Table 1.3.5.3.
	 *
	 * On the base class because 1.3.1 documents it for both machines: its Function row names both
	 * "Sequoia 4K60L ... in Quad Multiview + Bypass (Daisy Chain Capable) mode" and "Sequoia 4K60 ...
	 * in Quad Multiview + Workstation mode". It is still not valid in every mode - the 4K60's
	 * Seamless Switching mode and the 4K60L's Single-View Seamless mode are not listed anywhere - so
	 * `actions.ts` registers it for exactly the three modes the guide names.
	 *
	 * `port` is fixed to 1. `winid` is 0 (Host mode) or 1-N for that window's Remote mode, where N is
	 * 4 on a standalone unit and 16 across a daisy chain; the bound is enforced by the action's field
	 * range, not here.
	 */
	async setKmControl(winid: number): Promise<void> {
		await this.api.sendCommand('Ext', { func: 'set', type: 'enter_remote', port: 1, winid })
	}

	/**
	 * Table 1.3.1.14. Reports OSD state: audio tally on/off and colour, label on/off, label font and
	 * background colour, auto-hide status, and border colour and width. Response shown only as a
	 * screenshot (Figure 1.3.1.9).
	 *
	 * This is the read side of `setOsd`, so it is the command to capture first if the OSD actions
	 * ever need to preserve device-owned state the way `setWindowGeometry` does.
	 */
	async getOsdInfo(): Promise<AvitechResponse> {
		return this.api.sendCommand('2060', { func: 'get', type: 'osd', port: SYSTEM_COMMAND_PORT })
	}

	/**
	 * Table 1.3.1.15. Master OSD on/off - label, border and audio tally together. `enabled` is
	 * 0 (hide) or 1 (show).
	 *
	 * Two traps in one small command. It is `cmd=Info`, unlike every other OSD command in this
	 * section, which are `cmd=2060`. And the payload key is `en`, not `enable`: the guide's
	 * Cmd-Value row calls it "enable" but the worked example sends `"en":0`. The example is followed
	 * here, as it is the only form actually shown on the wire.
	 */
	async setOsdEnabled(enabled: number): Promise<void> {
		await this.api.sendCommand('Info', {
			func: 'set',
			type: 'osd',
			port: SYSTEM_COMMAND_PORT,
			en: enabled,
		})
	}

	/**
	 * Tables 1.3.1.16 through 1.3.1.21 - one request, written with whichever subset of `OsdSettings`
	 * the caller supplies. See `OsdSettings` for why the guide's six tables collapse to one method.
	 *
	 * Unlike `setWindowGeometry`, this does not read current state first. It does not have to: every
	 * worked example in these six tables sends a partial `data` object and the unaddressed keys are
	 * left alone, so there is no all-or-nothing payload to reconstruct and nothing to accidentally
	 * reset.
	 *
	 * **Confirmed additive** on a 4K60L in quad-bypass mode, 2026-08-19: writing one task's keys
	 * leaves the others as they were. This was the module's largest untested assumption, because
	 * `setWindowGeometry` had to abandon exactly the same one. `getOsdInfo` remains the read side if
	 * a future firmware changes it.
	 */
	async setOsd(data: Partial<OsdSettings>): Promise<void> {
		await this.api.sendCommand('2060', { func: 'set', type: 'osd', data })
	}

	/**
	 * Table 1.3.1.22. Fan failure and over-temperature alert display: 0 (off) or 1 (on).
	 *
	 * The payload key is `mode`, not `sob_alarm`. The guide's Cmd-Value row reads
	 * `sob_alarm = 0 (off) or 1 (on)`, but `sob_alarm` is the value of `type` in the worked example
	 * and the on/off value is carried in `mode`. Same shape of documentation slip as `en` above.
	 */
	async setAlertDisplay(mode: number): Promise<void> {
		await this.api.sendCommand('Info', { func: 'set', type: 'sob_alarm', mode })
	}

	/**
	 * Table 1.3.1.23. Power saving on the monitor attached to `port`, or every monitor when `port`
	 * is 0. Ports 1-5, with 5 only present on the 4K60.
	 *
	 * `enable` is inverted with respect to its name, and this is the guide's wording, not a
	 * transcription error: `0 (enable power saving mode)` and `1 (disable power saving mode)`. The
	 * parameter here is named `enable` to match the wire key, and the action's dropdown labels the
	 * two values by what they do rather than by their number, so nobody has to remember this.
	 *
	 * Also note `func` is `user` - a value that appears nowhere else in the module.
	 */
	async setPowerSavingMode(port: number, enable: number): Promise<void> {
		await this.api.sendCommand('2060', { func: 'user', type: 'hdmi_output', port, enable })
	}

	/**
	 * Table 1.3.1.24. Idle time in seconds after which the keyboard/mouse locks automatically.
	 *
	 * The guide's Cmd-Value row for `idle_time` is **blank** - it documents no range, no units and no
	 * disable value. Seconds was inferred from the single example, which sends 120 and describes it
	 * as "2 minutes", and that inference is **confirmed** on a 4K60L in quad-bypass mode, 2026-08-19.
	 *
	 * Still unknown: whether 0 disables the lock, and where the real upper bound is. The 0-65535
	 * range in `actions.ts` is this module's invention, not a vendor-stated limit, so the action
	 * still does not claim 0 means "never".
	 */
	async setKmIdleDetection(idleTime: number): Promise<void> {
		await this.api.sendCommand('Info', { func: 'lock', type: 'km', idle_time: idleTime })
	}

	/**
	 * Table 1.3.1.25. `mode` is the string `'right'` or `'left'` (button handedness), `speed` is
	 * 0 (slowest) to 14 (fastest).
	 *
	 * `mode` is one of the few string values in the whole API - everything else in this section is
	 * numeric. The guide's example description also contradicts its own parameter: it sends
	 * `"mode":"right"` while describing the result as configuring "the left mouse button ... for
	 * primary functions". The parameter value is taken at face value and the prose ignored.
	 */
	async setMouse(mode: string, speed: number): Promise<void> {
		await this.api.sendCommand('Info', { func: 'set', type: 'mouse', mode, speed })
	}

	// --- Section 1.3.2, Commands for Controlling Window -------------------------------------
	// Documented once for "Sequoia 4K60/4K60L" with a single request shape, so there is nothing
	// for a subclass to branch on. Section 1.3.5 does not list any of these, so `actions.ts` does
	// not register them for daisy-chain mode.

	/**
	 * Table 1.3.2.1. The guide shows this response only as a screenshot (Figure 1.3.2.1), so the
	 * shape below - captured from a 4K60L on 2026-07-29 - is the real source of truth:
	 *
	 * ```json
	 * {"port":1,
	 *  "win":[{"id":1,"data":[0,0,1920,1080,0,1,1,1],
	 *          "win_crop":[0,0,10000,10000],"virt_win":[0,0,1920,1080]}, ... x4],
	 *  "resolution":[3840,2160],"global_option":[0,0,0,1,0],"default_layout":0,"preset":0}
	 * ```
	 *
	 * Two details contradict the guide, and both are why `setWindowGeometry` calls this before it
	 * writes:
	 *
	 * - **z-order is not win_id order.** The guide states the z values 0~3 "correspond to the order
	 *   from win_id 1 ~ win_id 4", but this unit reported 0, 2, 1, 3 for windows 1-4. z is real
	 *   independent state, not a restatement of the id.
	 * - **`global_option` is not all zeros.** The guide says to leave it at 0 and not change it; the
	 *   device reported [0,0,0,1,0]. Index 3 holds a non-default value in the field.
	 *
	 * `win_crop` and `virt_win` come back but appear nowhere in the guide, and the Set command has
	 * no inputs corresponding to them. They were unaffected by a Set that omitted them, and
	 * `virt_win` tracked position exactly, so it looks derived. Left alone.
	 */
	async getWindowGeometry(): Promise<AvitechResponse> {
		return this.api.sendCommand('2060', { func: 'get', type: 'position', port: WINDOW_COMMAND_PORT })
	}

	/**
	 * Table 1.3.2.2. Sets all four windows in one request - the guide gives no example of a partial
	 * update, so the caller supplies the complete layout.
	 *
	 * Reads the current geometry first, which the guide gives no reason to do. Two of the fields
	 * this command must write are ones the caller does not supply, and following the guide's
	 * instructions for them was measured corrupting device state on a 4K60L (2026-07-29):
	 *
	 * - **z.** The guide says z 0~3 tracks win_id order and "currently cannot be modify", implying
	 *   it is safe to derive as `index`. It is neither. A unit sitting at z = 0,2,1,3 was sent
	 *   0,1,2,3 and ended up at 1,2,0,3 - so the device acts on an incoming z, but not by taking
	 *   the value given. Since the resulting z cannot be predicted, it can only be preserved.
	 * - **`global_option`.** The guide says to leave it at 0 and not change it. The same unit
	 *   reported [0,0,0,1,0], and writing the documented five zeros reset index 3 to 0.
	 *
	 * `default_layout` and `preset` are carried through for the same reason, though both have only
	 * ever been observed as 0. `resolution` comes from the caller: it is a real option on the
	 * action, not opaque state.
	 *
	 * The extra round-trip is the cost of not corrupting state the module does not model. If the
	 * read fails the write is abandoned rather than falling back to the documented defaults, since
	 * those defaults are the known-bad values.
	 */
	async setWindowGeometry(windows: WindowGeometry[], resolution: [number, number]): Promise<void> {
		const preserved = readPreservedGeometryState(await this.getWindowGeometry())

		await this.api.sendCommand('2060', {
			func: 'set',
			type: 'position',
			port: WINDOW_COMMAND_PORT,
			win: windows.map((window, index) => {
				const z = preserved.z[index]
				if (typeof z !== 'number') {
					throw new Error(`Window geometry response had no z value for window ${index + 1}`)
				}

				return {
					id: index + 1,
					data: [window.x, window.y, window.w, window.h, z, window.aspect, window.fit, window.show],
				}
			}),
			global_option: preserved.globalOption,
			resolution,
			default_layout: preserved.defaultLayout,
			preset: preserved.preset,
		})
	}

	/**
	 * Table 1.3.2.3. Response captured from a 4K60L on 2026-07-29; the guide shows only a
	 * screenshot (Figure 1.3.2.2):
	 *
	 * ```json
	 * {"sib_label":["Source 1","Source 2","Source 3","Source 4",
	 *               "Source 64","Source 65", ... ,"Source 79"]}
	 * ```
	 *
	 * Twenty entries, not four. The key name ("sib", presumably sibling) and the 4 -> 64 jump in the
	 * default numbering both suggest the array spans a full daisy chain rather than one unit's four
	 * inputs. On a non-chained unit the first four entries are the ones `setWindowLabel` ports 1-4
	 * address; what the remaining sixteen refer to is not established. Confirm against a real chain
	 * before driving variables off any index past 3.
	 */
	async getWindowLabels(): Promise<AvitechResponse> {
		return this.api.sendCommand('Info', { func: 'get', type: 'label' })
	}

	/**
	 * Table 1.3.2.4. The guide shows both a four-port and a single-port example, so addressing one
	 * port at a time is documented behaviour rather than a guess.
	 *
	 * Not to be confused with `Sequoia4K60LAdapter.setLabel()`, which is the section 1.3.5
	 * daisy-chain variant of this command (same cmd/type, plus `daisy: 1`).
	 */
	async setWindowLabel(port: number, label: string): Promise<void> {
		await this.api.sendCommand('Info', { func: 'set', type: 'genlabel', label: [{ port, label }] })
	}

	/** Table 1.3.2.5. */
	async setWindowShow(winid: number, show: number): Promise<void> {
		await this.api.sendCommand('Ext', {
			func: 'set',
			type: 'win',
			port: WINDOW_COMMAND_PORT,
			winid,
			data: { show },
		})
	}

	/** Table 1.3.2.6. Same cmd/type as `setWindowShow`; only the `data` key differs. */
	async setWindowAspect(winid: number, aspect: number): Promise<void> {
		await this.api.sendCommand('Ext', {
			func: 'set',
			type: 'win',
			port: WINDOW_COMMAND_PORT,
			winid,
			data: { aspect },
		})
	}

	/** Table 1.3.2.7. `full` is 0 to return to multiview, or 1-4 to fullscreen that window. */
	async setFullscreen(full: number): Promise<void> {
		await this.api.sendCommand('Ext', {
			func: 'set',
			type: 'global_option',
			port: WINDOW_COMMAND_PORT,
			data: { full },
		})
	}
}
