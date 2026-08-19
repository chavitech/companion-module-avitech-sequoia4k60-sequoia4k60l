import { splitRgb } from '@companion-module/base'
import type { DropdownChoice } from '@companion-module/base'
import type { AvitechResponse } from './avitech-api.js'
import type { DeviceColor } from './adapters/index.js'

/**
 * Option value lists and colour conversion for the "Commands for Controlling System" family
 * (reference guide section 1.3.1). These apply to both the 4K60 and the 4K60L - the guide documents
 * the section once for "Sequoia 4K60/4K60L" rather than per model.
 *
 * This is the section 1.3.1 counterpart to `windows.ts`. Unlike that file it holds a value import
 * from `@companion-module/base` (`splitRgb`), which is safe here only because nothing in the
 * adapter import chain imports this module - `tools/bench.mjs` loads `dist/adapters/index.js` and
 * depends on that chain staying free of runtime dependencies on the Companion package. The types
 * the adapters need (`DeviceColor`, `OsdSettings`) are declared in `base.ts` and flow outward, not
 * inward. Keep it that way.
 */

/** Table 1.3.1.5. The three factory window arrangements. */
export const DEFAULT_LAYOUT_CHOICES: DropdownChoice[] = [
	{ id: 1, label: 'Quad (2x2)' },
	{ id: 2, label: '3 small + 1 large' },
	{ id: 3, label: '1 large + 3 small' },
]

/** Table 1.3.1.6. The five user icon presets from the web GUI's Layout & Routing page. */
export const USER_ICON_PRESET_CHOICES: DropdownChoice[] = [1, 2, 3, 4, 5].map((id) => ({
	id,
	label: `User icon preset ${id}`,
}))

/** Table 1.3.1.15. Master OSD visibility - label, border and audio tally together. */
export const OSD_ENABLED_CHOICES: DropdownChoice[] = [
	{ id: 0, label: 'Hide all OSD' },
	{ id: 1, label: 'Show all OSD' },
]

/** Tables 1.3.1.16/1.3.1.17. Border width in pixels; 0 hides the border. */
export const BORDER_WIDTH_CHOICES: DropdownChoice[] = [
	{ id: 0, label: 'Off (no border)' },
	{ id: 2, label: '2 pixels' },
	{ id: 4, label: '4 pixels' },
	{ id: 6, label: '6 pixels' },
]

/** Tables 1.3.1.16/1.3.1.18. Whether the label sits over the image or outside it. */
export const LABEL_OVERLAY_CHOICES: DropdownChoice[] = [
	{ id: 0, label: 'Outside the image' },
	{ id: 1, label: 'Overlaid on the image' },
]

/** Table 1.3.1.16. Label visibility. `auto_hide_label` only bites while this is 1. */
export const SHOW_LABEL_CHOICES: DropdownChoice[] = [
	{ id: 0, label: 'Hide labels' },
	{ id: 1, label: 'Show labels' },
]

/** Table 1.3.1.16. */
export const AUTO_HIDE_LABEL_CHOICES: DropdownChoice[] = [
	{ id: 0, label: 'Always visible' },
	{ id: 1, label: 'Auto-hide' },
]

/**
 * Table 1.3.1.16. Whether label text inherits the background's transparency or stays solid.
 *
 * The guide's wording is `0 (transparent along with label background), 1 (non)` - "non" being all
 * it says about value 1.
 */
export const LABEL_TEXT_TRANSPARENCY_CHOICES: DropdownChoice[] = [
	{ id: 0, label: 'Follow label background transparency' },
	{ id: 1, label: 'Always opaque' },
]

/** Tables 1.3.1.16/1.3.1.19/1.3.1.20. HDMI embedded audio switch tally. */
export const SHOW_TALLY_CHOICES: DropdownChoice[] = [
	{ id: 0, label: 'Hide audio tally' },
	{ id: 1, label: 'Show audio tally' },
]

/** Table 1.3.1.21. */
export const ACTIVE_BORDER_CHOICES: DropdownChoice[] = [
	{ id: 0, label: 'Off' },
	{ id: 1, label: 'On' },
]

/** Table 1.3.1.22. Fan failure and over-temperature alerts. */
export const ALERT_DISPLAY_CHOICES: DropdownChoice[] = [
	{ id: 0, label: 'Off' },
	{ id: 1, label: 'On' },
]

/**
 * Table 1.3.1.23, and the one place in this module where the wire value reads backwards.
 *
 * The guide defines `enable = 0 (enable power saving mode)` / `1 (disable power saving mode)`, so
 * these labels are deliberately written in terms of the resulting behaviour rather than echoing the
 * key name. Do not "fix" the apparent inversion.
 */
export const POWER_SAVING_CHOICES: DropdownChoice[] = [
	{ id: 0, label: 'Enable power saving' },
	{ id: 1, label: 'Disable power saving' },
]

/** Table 1.3.1.25. One of the module's only string-valued parameters. */
export const MOUSE_MODE_CHOICES: DropdownChoice[] = [
	{ id: 'right', label: 'Right-handed' },
	{ id: 'left', label: 'Left-handed' },
]

/**
 * Power saving (Table 1.3.1.23) is the only section 1.3.1 command addressing an output port, and
 * the only one accepting port 0 to mean "every monitor at once".
 */
export function PowerSavingPortChoices(maxPorts: number): DropdownChoice[] {
	return [
		{ id: 0, label: 'All monitors' },
		...Array.from({ length: maxPorts }, (_, i) => ({ id: i + 1, label: `HDMI OUT ${i + 1}` })),
	]
}

/**
 * A Companion colour picker value, as stored in the action's options.
 *
 * Typed as `string | number` rather than just `string` even though every picker below sets
 * `returnType: 'string'`: a config saved before that was set, or a Companion build that ignores it,
 * yields the packed number instead. `splitRgb` accepts both, so accepting both costs nothing.
 */
export type ColorOptionValue = string | number

/**
 * Converts a picker value to the device's `[R, G, B, 255]` form, for the OSD colours whose fourth
 * component the guide documents as "255 (fixed)" - tally, border and popup menu colours.
 *
 * Any alpha on the incoming value is discarded, which is why the pickers feeding this do not set
 * `enableAlpha`: offering a slider whose value is thrown away would be worse than not offering one.
 */
export function toFixedColor(value: ColorOptionValue): DeviceColor {
	const { r, g, b } = splitRgb(value)

	return [r, g, b, 255]
}

/**
 * Converts a picker value to the device's `[R, G, B, transparency]` form, for the label font and
 * background colours - the two whose fourth component the guide documents as a
 * "transparency level (0-255)".
 *
 * `splitRgb` reports alpha as 0.0-1.0 and defaults it to 1 when the value carries none, so a colour
 * picked without touching the alpha slider becomes 255 (fully opaque).
 */
export function toTransparencyColor(value: ColorOptionValue): DeviceColor {
	const { r, g, b, a } = splitRgb(value)

	return [r, g, b, Math.round((a ?? 1) * 255)]
}

/**
 * Normalises a "Custom Preset File List - Get" response (Table 1.3.1.8) into preset filenames.
 *
 * Captured from a 4K60L on 2026-08-19 across four reads, saving a preset between each:
 *
 * ```
 * []                                    nothing saved
 * ["TestPreset"]
 * ["TestPreset2","TestPreset"]
 * ["Alpha","TestPreset2","TestPreset"]  Alpha saved last, returned first
 * ```
 *
 * Three facts that this relies on, all from that capture rather than from the guide - which shows
 * the response only as Figure 1.3.1.7:
 *
 * - **Elements are bare filename strings**, with no extension and no wrapping object. So a name
 *   from here is exactly what `loadCustomPreset()` and `deleteCustomPreset()` take, with no
 *   transformation in between. That is what makes a picker possible at all.
 * - **An empty list is an ordinary `[]`**, not `""` or `"Success"`, so "no presets saved" is a
 *   successful read and not an error.
 * - **The order is newest-first.** `Alpha` was saved last and came back first, which is what rules
 *   out descending-alphabetical - the earlier reads could not, because `TestPreset2` happened to be
 *   both the newer file and the later string. The order is preserved rather than sorted here, so
 *   the most recently saved preset stays at the top of the picker where it is most likely wanted.
 *
 * Anything that is not a non-empty string is dropped rather than throwing: this feeds a dropdown
 * rebuild, and one odd entry should not cost the user the rest of the list.
 */
export function parseCustomPresetList(response: AvitechResponse): string[] {
	if (!Array.isArray(response)) {
		return []
	}

	return response.filter((entry): entry is string => typeof entry === 'string' && entry.length > 0)
}

/**
 * The preset picker's choices, in the device's own newest-first order.
 *
 * Returns an empty list when nothing is saved. Callers pair this with `allowCustom` so the field
 * still accepts a typed name - a dropdown with no entries and no way to type into it would be a
 * dead control on a unit whose presets have not been listed yet.
 */
export function CustomPresetChoices(names: string[]): DropdownChoice[] {
	return names.map((name) => ({ id: name, label: name }))
}
