/**
 * Command bench - a hardware sanity check for the Sequoia HTTP commands.
 *
 * Avitech ships firmware updates that are not regression tested, so "the reference guide says X"
 * is not evidence that a given unit still accepts X. This serves a local page with one button per
 * command; clicking it fires the request at a real machine and shows the exact URL sent plus the
 * raw, unparsed response text. The point is to prove a command works against hardware *before*
 * anyone tries to debug it through the Companion UI.
 *
 * Fidelity: the requests are built by the module's own adapter classes, imported from `dist/`, not
 * by a hand-written copy that can drift. That works because nothing in the adapter import chain
 * has a runtime dependency on `@companion-module/base` - every import in it is type-only and
 * erased by tsc - so the adapters can be driven here without a Companion runtime. A stub `api`
 * object stands in for AvitechHttpApi and performs the fetch, capturing the URL and raw body.
 *
 * The server-side proxy is not incidental: the device's cgi-bin sends no CORS headers, so a page
 * opened over file:// could fire commands but never read the reply.
 *
 * Usage:
 *   yarn bench --host 192.168.0.5 [--port 80] [--mode <device-mode>] [--listen 8099]
 */

import { createServer } from 'node:http'

/*
 * dist/ is the build output and does not exist until `yarn build` runs, so eslint-plugin-n reads
 * these as unpublished imports. The `bench` script builds first. Importing the compiled adapters
 * rather than re-deriving the request shapes here is the entire point of this tool, so the rule is
 * suppressed rather than worked around.
 */
/* eslint-disable n/no-unpublished-import */
import { createAdapter } from '../dist/adapters/index.js'
import { DEVICE_MODES } from '../dist/models.js'
/* eslint-enable n/no-unpublished-import */

const REQUEST_TIMEOUT_MS = 5000

// --- CLI ------------------------------------------------------------------------------------

/** A bad invocation, reported as a usage message rather than a stack trace. */
class UsageError extends Error {}

function parseArgs(argv) {
	const args = { port: 80, mode: DEVICE_MODES[0], listen: 8099 }

	for (let i = 0; i < argv.length; i += 1) {
		const [flag, inlineValue] = argv[i].split('=')
		const value = inlineValue ?? argv[++i]

		switch (flag) {
			case '--host':
				args.host = value
				break
			case '--port':
				args.port = Number(value)
				break
			case '--mode':
				args.mode = value
				break
			case '--listen':
				args.listen = Number(value)
				break
			default:
				throw new UsageError(`Unknown argument: ${flag}`)
		}
	}

	if (!args.host) throw new UsageError('Missing required --host <device-ip>')
	if (!DEVICE_MODES.includes(args.mode)) {
		throw new UsageError(`Unknown --mode "${args.mode}". Expected one of:\n  ${DEVICE_MODES.join('\n  ')}`)
	}

	return args
}

// --- Adapter wiring -------------------------------------------------------------------------

/** Assigned by `main()` once the arguments have been validated. */
let config
let adapter

/**
 * Every request made while handling one button press. An adapter method can make more than one -
 * `setWindowGeometry` reads the current geometry before it writes - and the whole point of this
 * tool is to show what actually went over the wire, so all of them are reported.
 */
let requestLog = []

/**
 * Stands in for AvitechHttpApi, and must stay behaviourally identical to it: adapter methods that
 * consume another command's return value (again, `setWindowGeometry`) only work if this parses
 * responses the way the real client does. Mirrors `AvitechHttpApi.buildUrl()` and `parseResponse()`.
 *
 * The raw text is recorded separately regardless, so nothing is hidden by the parsing.
 */
const api = {
	async sendCommand(cmd, param) {
		const portSuffix = config.port && config.port !== 80 ? `:${config.port}` : ''
		const url = `http://${config.host}${portSuffix}/cgi-bin/command.cgi?cmd=${encodeURIComponent(
			cmd,
		)}&param=${encodeURIComponent(JSON.stringify(param))}`

		const entry = { url, cmd, param }
		requestLog.push(entry)

		const response = await fetch(url, { method: 'GET', signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) })
		const raw = await response.text()

		entry.httpStatus = response.status
		entry.raw = raw

		return parseResponse(raw)
	},
}

/** Kept in step with `AvitechHttpApi.parseResponse()` in src/avitech-api.ts. */
function parseResponse(text) {
	const trimmed = text.trim()

	if (trimmed === 'Wrong format') throw new Error('Device reported: Wrong format')
	if (trimmed === 'Success' || trimmed === '') return trimmed

	let parsed
	try {
		parsed = JSON.parse(trimmed)
	} catch {
		return trimmed
	}

	// The undocumented rejection envelope newer firmware uses in place of "Wrong format".
	if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
		const cbStatus = parsed.cb_status
		if (typeof cbStatus === 'string' && !/^(ok|success)$/i.test(cbStatus)) {
			throw new Error(`Device reported: ${cbStatus}`)
		}
	}

	return parsed
}

/** Minimal stand-in for ModuleInstance - the adapters only ever reach the device via the api. */
const moduleInstance = {
	get config() {
		return config
	},
	log: (level, message) => console.log(`  [${level}] ${message}`),
	updateStatus: () => {},
}

// --- Command catalogue ----------------------------------------------------------------------

const WINDOW_CHOICES = [1, 2, 3, 4].map((id) => ({ value: id, label: `Window ${id}` }))
const ASPECT_CHOICES = [
	{ value: 0, label: 'Fill up window' },
	{ value: 1, label: 'Auto-detect' },
	{ value: 2, label: '16:9' },
	{ value: 3, label: '4:3' },
	{ value: 4, label: '16:10' },
	{ value: 5, label: '5:4' },
]
const SHOW_CHOICES = [
	{ value: 0, label: 'Hide' },
	{ value: 1, label: 'Show' },
]
const FIT_CHOICES = [
	{ value: 0, label: 'Disabled' },
	{ value: 1, label: 'Enabled' },
]
const RESOLUTION_CHOICES = ['4096x2160', '3840x2400', '3840x2160', '1920x1200', '1920x1080', '1280x1024'].map((id) => ({
	value: id,
	label: id.replace('x', ' x '),
}))

const GEOMETRY_DEFAULTS = [
	{ x: 0, y: 0, w: 1920, h: 1080 },
	{ x: 1920, y: 0, w: 1920, h: 1080 },
	{ x: 0, y: 1080, w: 1920, h: 1080 },
	{ x: 1920, y: 1080, w: 1920, h: 1080 },
]

// --- Section 1.3.1 choice lists ---------------------------------------------------------------
// Deliberately spelled out here rather than imported from `src/system.ts`. That module holds a
// runtime import of `@companion-module/base` for its colour helpers, and pulling it in would put
// the very dependency the bench exists to avoid back into this process. These lists are small and
// the duplication is visible; the adapter calls below are still the real ones.

const MODE_CHOICES_1_3_1 = {
	defaultLayout: [
		{ value: 1, label: 'Quad (2x2)' },
		{ value: 2, label: '3 small + 1 large' },
		{ value: 3, label: '1 large + 3 small' },
	],
	userIconPreset: [1, 2, 3, 4, 5].map((value) => ({ value, label: `User icon preset ${value}` })),
	osdEnabled: [
		{ value: 0, label: 'Hide all OSD' },
		{ value: 1, label: 'Show all OSD' },
	],
	borderWidth: [
		{ value: 0, label: 'Off' },
		{ value: 2, label: '2 px' },
		{ value: 4, label: '4 px' },
		{ value: 6, label: '6 px' },
	],
	labelOverlay: [
		{ value: 0, label: 'Outside the image' },
		{ value: 1, label: 'Overlaid on the image' },
	],
	onOff: [
		{ value: 0, label: 'Off' },
		{ value: 1, label: 'On' },
	],
	// Table 1.3.1.23 defines this backwards on purpose: 0 turns power saving ON.
	powerSaving: [
		{ value: 0, label: 'Enable power saving' },
		{ value: 1, label: 'Disable power saving' },
	],
	mouseMode: [
		{ value: 'right', label: 'Right-handed' },
		{ value: 'left', label: 'Left-handed' },
	],
}

const PORT_CHOICES_ALL = [
	{ value: 0, label: 'All monitors' },
	...[1, 2, 3, 4, 5].map((value) => ({ value, label: `HDMI OUT ${value}` })),
]

/**
 * Parses an "R,G,B" or "R,G,B,A" bench text field into the device's `[R, G, B, A]` form.
 *
 * The bench has no colour picker widget, so colours are typed. `fallbackAlpha` is 255 for the
 * colours the guide fixes at 255, and is what a three-component value gets.
 */
function parseColor(value, fallbackAlpha = 255) {
	const parts = String(value)
		.split(',')
		.map((part) => Number(part.trim()))

	if (parts.length < 3 || parts.length > 4 || parts.some((part) => !Number.isFinite(part))) {
		throw new Error(`Expected a colour as "R,G,B" or "R,G,B,A", received: ${value}`)
	}

	return [parts[0], parts[1], parts[2], parts.length === 4 ? parts[3] : fallbackAlpha]
}

// --- Applicability --------------------------------------------------------------------------

const MODEL_LABELS = {
	'sequoia-4k60': 'Sequoia 4K60',
	'sequoia-4k60l': 'Sequoia 4K60L',
}

const SECTION_TITLES = {
	'1.3.1': 'Commands for Controlling System',
	'1.3.2': 'Commands for Controlling Window',
	'1.3.3': 'Commands for Sequoia 4K60',
	'1.3.4': 'Commands for Sequoia 4K60L',
	'1.3.5': 'Command for Sequoia 4K60L in Daisy Chain',
}

/** '1.3.4.7-8' -> '1.3.4'. Used to group the page and to look up a section title. */
function sectionGroup(section) {
	return section.split('.').slice(0, 3).join('.')
}

/**
 * Why a command cannot be fired in the current run, or undefined if it can.
 *
 * Sections 1.3.3 - 1.3.5 are the first commands here that do not exist on every unit, and two of
 * them (`setKmRebootMode`, `setLabel`) are methods only `Sequoia4K60LAdapter` declares - calling
 * one through a 4K60 adapter is a TypeError, not a device error, which would look like a bench
 * fault rather than a wrong question. So an inapplicable command is rendered disabled with the
 * reason, rather than hidden: the page stays a full catalogue of the guide, and "why is this not
 * here" is answered on the card.
 *
 * This is applicability, not the mode *gating* `actions.ts` performs. The bench still fires
 * anything the running adapter can physically send - that is the whole point of it - so a command
 * the module withholds from a mode is still offered here if the adapter has a branch for it.
 */
function unavailableReason(command) {
	if (command.models && !command.models.includes(adapter.model)) {
		const wanted = command.models.map((model) => MODEL_LABELS[model]).join(' or ')
		return `Only on the ${wanted}. This bench is running as ${MODEL_LABELS[adapter.model]}; restart with a --mode for that model to reach it.`
	}

	if (command.modes && !command.modes.includes(config.mode)) {
		return `Only in ${command.modes.join(' / ')}. Restart the bench with --mode ${command.modes[0]}.`
	}

	return undefined
}

// --- Command catalogue ------------------------------------------------------------------------

/**
 * Declarative so that extending the bench to another guide section is a data change rather than a
 * rewrite. `run` receives the form values keyed by field id and calls straight through to the
 * adapter. `models` / `modes` restrict a command to the units that have it - see
 * `unavailableReason()`.
 */
const COMMANDS = [
	{
		id: 'get_firmware_version',
		section: '1.3.1.1',
		name: 'Firmware Version — Get',
		note: 'Screenshot-only response in the guide (Figure 1.3.1.1). Whatever comes back here is the source of truth.',
		fields: [],
		run: () => adapter.getFirmwareVersion(),
	},
	{
		id: 'get_signal_type',
		section: '1.3.1.2',
		name: 'Signal Type — Get',
		note: 'Per-window 0 (no video) / 1 (video). The one 1.3.1 read worth driving feedbacks off, so its exact shape matters.',
		fields: [],
		run: () => adapter.getSignalType(),
	},
	{
		id: 'get_network_info',
		section: '1.3.1.3',
		name: 'Network — Get',
		note: 'Reports every Sequoia on the same network, not only this one. Worth checking how a daisy chain appears here.',
		fields: [],
		run: () => adapter.getNetworkInfo(),
	},
	{
		id: 'set_output_resolution',
		section: '1.3.1.4',
		name: 'Output Resolution — Set',
		note: 'Also documented as 1.3.4.9/1.3.4.10 and in 1.3.5. Port 5 exists only on the 4K60. Mode 0 is auto-detect from EDID.',
		fields: [
			{ id: 'port', label: 'Output Port', type: 'number', default: 1 },
			{ id: 'mode', label: 'Resolution Mode', type: 'number', default: 0 },
		],
		run: (values) => adapter.setOutputResolution(values.port, values.mode),
	},
	{
		id: 'load_default_layout',
		section: '1.3.1.5',
		name: 'Default Preset — Load',
		note: 'Rearranges the windows to a factory layout. Does not erase anything, despite the name.',
		fields: [{ id: 'layout', label: 'Layout', type: 'select', choices: MODE_CHOICES_1_3_1.defaultLayout, default: 1 }],
		run: (values) => adapter.loadDefaultLayout(values.layout),
	},
	{
		id: 'load_user_icon_preset',
		section: '1.3.1.6',
		name: 'User Icon Preset — Load',
		note: 'Presets 1-5 from the web GUI. The module omits the guide’s optional "response" key; this does too.',
		fields: [{ id: 'preset', label: 'Preset', type: 'select', choices: MODE_CHOICES_1_3_1.userIconPreset, default: 1 }],
		run: (values) => adapter.loadPreset(values.preset),
	},
	{
		id: 'load_latest_preset',
		section: '1.3.1.10',
		name: 'Latest Display Preset — Load',
		note: 'Same request as 1.3.1.6 with preset_num 15. Loads the layout last stored with Save Latest.',
		fields: [],
		run: () => adapter.loadLatestPreset(),
	},
	{
		id: 'load_custom_preset',
		section: '1.3.1.7',
		name: 'Custom Preset — Load',
		note: 'Run the file list below first to get a name that actually exists.',
		fields: [{ id: 'name', label: 'Preset Filename', type: 'text', default: '' }],
		run: (values) => adapter.loadCustomPreset(values.name),
	},
	{
		id: 'list_custom_presets',
		section: '1.3.1.8',
		name: 'Custom Preset File List — Get',
		note: 'Screenshot-only response in the guide (Figure 1.3.1.7).',
		fields: [],
		run: () => adapter.listCustomPresets(),
	},
	{
		id: 'delete_custom_preset',
		section: '1.3.1.9',
		name: 'Custom Preset — Delete',
		warn: 'Destructive. Permanently deletes the named preset from the device. Check the spelling before sending.',
		fields: [{ id: 'name', label: 'Preset Filename', type: 'text', default: '' }],
		run: (values) => adapter.deleteCustomPreset(values.name),
	},
	{
		id: 'reset_factory_defaults',
		section: '1.3.1.11',
		name: 'Reset Factory Defaults',
		warn: 'Destructive. Resets the unit and erases EVERY custom preset in its flash memory. It applies on the next reboot, not on send, so a unit that has been sent this keeps working normally until it is power-cycled — do not leave one in that state for someone else to find.',
		fields: [],
		run: () => adapter.resetFactoryDefaults(),
	},
	{
		id: 'set_fading_level',
		section: '1.3.1.12',
		name: 'Fading Level (Speed) — Set',
		note: 'Only affects source switching in fullscreen mode. 0 = off, 1 = fastest, 255 = slowest.',
		fields: [{ id: 'fading_time', label: 'Fade Speed', type: 'number', default: 0 }],
		run: (values) => adapter.setFadingLevel(values.fading_time),
	},
	{
		id: 'set_km_control',
		section: '1.3.1.13',
		name: 'K/M Control — Set',
		note: 'Also documented as 1.3.4.6 and 1.3.5.3. 0 = Host mode; 1-4 standalone, 1-16 across a chain.',
		fields: [{ id: 'winid', label: 'Window ID', type: 'number', default: 0 }],
		run: (values) => adapter.setKmControl(values.winid),
	},
	{
		id: 'get_osd_info',
		section: '1.3.1.14',
		name: 'OSD Information — Get',
		note: 'The read side of every OSD setter below. Capture this before and after a set to see which keys actually moved.',
		fields: [],
		run: () => adapter.getOsdInfo(),
	},
	{
		id: 'set_osd_enabled',
		section: '1.3.1.15',
		name: 'OSD Show/Hide — Set',
		note: 'The odd one out: cmd=Info, not 2060, and the payload key is "en", not "enable". Worth confirming on hardware.',
		fields: [{ id: 'enabled', label: 'OSD', type: 'select', choices: MODE_CHOICES_1_3_1.osdEnabled, default: 1 }],
		run: (values) => adapter.setOsdEnabled(values.enabled),
	},
	{
		id: 'set_window_border',
		section: '1.3.1.17',
		name: 'Window Border — Set',
		note: 'One of six tables (1.3.1.16-1.3.1.21) that are the same 2060/set/osd request with different data keys.',
		fields: [
			{
				id: 'border_width',
				label: 'Border Width',
				type: 'select',
				choices: MODE_CHOICES_1_3_1.borderWidth,
				default: 2,
			},
			{ id: 'border_color', label: 'Border Colour (R,G,B)', type: 'text', default: '255,255,255' },
		],
		run: (values) =>
			adapter.setOsd({ border_width: values.border_width, border_color: parseColor(values.border_color) }),
	},
	{
		id: 'set_window_label_color',
		section: '1.3.1.18',
		name: 'Window Label Color — Set',
		note: 'The label colours are the only ones whose 4th component is a transparency level rather than a fixed 255.',
		fields: [
			{ id: 'label_font_color', label: 'Font Colour (R,G,B,A)', type: 'text', default: '255,255,255,255' },
			{ id: 'label_back_color', label: 'Background Colour (R,G,B,A)', type: 'text', default: '0,0,0,255' },
			{
				id: 'label_overlay',
				label: 'Label Position',
				type: 'select',
				choices: MODE_CHOICES_1_3_1.labelOverlay,
				default: 0,
			},
		],
		run: (values) =>
			adapter.setOsd({
				label_font_color: parseColor(values.label_font_color),
				label_back_color: parseColor(values.label_back_color),
				label_overlay: values.label_overlay,
			}),
	},
	{
		id: 'set_osd_label_display',
		section: '1.3.1.16',
		name: 'OSD — Set (label visibility keys)',
		note: 'The label keys of 1.3.1.16 that no task-shaped table covers. Auto-hide only bites while Show Label is on.',
		fields: [
			{ id: 'show_label', label: 'Labels', type: 'select', choices: MODE_CHOICES_1_3_1.onOff, default: 1 },
			{ id: 'auto_hide_label', label: 'Auto-hide', type: 'select', choices: MODE_CHOICES_1_3_1.onOff, default: 0 },
			{
				id: 'label_text_transparency',
				label: 'Text Transparency',
				type: 'select',
				choices: MODE_CHOICES_1_3_1.onOff,
				default: 0,
			},
		],
		run: (values) =>
			adapter.setOsd({
				show_label: values.show_label,
				auto_hide_label: values.auto_hide_label,
				label_text_transparency: values.label_text_transparency,
			}),
	},
	{
		id: 'set_audio_tally_color',
		section: '1.3.1.19',
		name: 'Audio Tally Color — Set',
		note: 'Tally 1 is the HDMI embedded audio switch indicator.',
		fields: [
			{ id: 'tally1_on_color', label: 'On Colour (R,G,B)', type: 'text', default: '0,255,0' },
			{ id: 'tally1_off_color', label: 'Off Colour (R,G,B)', type: 'text', default: '64,64,64' },
		],
		run: (values) =>
			adapter.setOsd({
				tally1_on_color: parseColor(values.tally1_on_color),
				tally1_off_color: parseColor(values.tally1_off_color),
			}),
	},
	{
		id: 'set_audio_tally_show',
		section: '1.3.1.20',
		name: 'Audio Tally Show/Hide — Set',
		note: 'Only visible while the OSD as a whole is on.',
		fields: [
			{ id: 'show_tally1', label: 'Audio Tally', type: 'select', choices: MODE_CHOICES_1_3_1.onOff, default: 1 },
		],
		run: (values) => adapter.setOsd({ show_tally1: values.show_tally1 }),
	},
	{
		id: 'set_popup_menu_colors',
		section: '1.3.1.16',
		name: 'OSD — Set (popup menu colours)',
		note: 'The last three keys of 1.3.1.16. No table of their own, and no description of where the popup menu appears.',
		fields: [
			{ id: 'popupmenu_active_color', label: 'Active (R,G,B)', type: 'text', default: '255,255,255' },
			{ id: 'popupmenu_available_color', label: 'Available (R,G,B)', type: 'text', default: '192,192,192' },
			{ id: 'popupmenu_disable_color', label: 'Disabled (R,G,B)', type: 'text', default: '96,96,96' },
		],
		run: (values) =>
			adapter.setOsd({
				popupmenu_active_color: parseColor(values.popupmenu_active_color),
				popupmenu_available_color: parseColor(values.popupmenu_available_color),
				popupmenu_disable_color: parseColor(values.popupmenu_disable_color),
			}),
	},
	{
		id: 'set_active_border',
		section: '1.3.1.21',
		name: 'Active Window Border Show/Hide — Set',
		note: 'Sent through the same osd data object, but active_border is absent from 1.3.1.16’s own key list.',
		fields: [
			{ id: 'active_border', label: 'Active Border', type: 'select', choices: MODE_CHOICES_1_3_1.onOff, default: 1 },
		],
		run: (values) => adapter.setOsd({ active_border: values.active_border }),
	},
	{
		id: 'set_alert_display',
		section: '1.3.1.22',
		name: 'Alert Display — Set',
		note: 'Fan failure and temperature alerts. The on/off value rides in "mode"; "sob_alarm" is the type, not the key.',
		fields: [{ id: 'mode', label: 'Alerts', type: 'select', choices: MODE_CHOICES_1_3_1.onOff, default: 1 }],
		run: (values) => adapter.setAlertDisplay(values.mode),
	},
	{
		id: 'set_power_saving',
		section: '1.3.1.23',
		name: 'Power Saving Mode on Monitor — Set',
		note: 'Reads backwards by design: enable=0 turns power saving ON. Port 0 targets every monitor; port 5 is 4K60-only.',
		fields: [
			{ id: 'port', label: 'Monitor', type: 'select', choices: PORT_CHOICES_ALL, default: 0 },
			{ id: 'enable', label: 'Power Saving', type: 'select', choices: MODE_CHOICES_1_3_1.powerSaving, default: 1 },
		],
		run: (values) => adapter.setPowerSavingMode(values.port, values.enable),
	},
	{
		id: 'set_km_idle_detection',
		section: '1.3.1.24',
		name: 'Keyboard/Mouse Idle Detection — Set',
		note: 'The guide documents no range at all for idle_time. Seconds was inferred from its one example (120 = "2 minutes") and is confirmed on a 4K60L in quad-bypass. Whether 0 disables the lock is still unknown — a good thing to establish here.',
		fields: [{ id: 'idle_time', label: 'Idle Time (seconds)', type: 'number', default: 120 }],
		run: (values) => adapter.setKmIdleDetection(values.idle_time),
	},
	{
		id: 'set_mouse',
		section: '1.3.1.25',
		name: 'Mouse — Set',
		note: 'One of the few string-valued parameters in the API. The guide’s example description contradicts its own value.',
		fields: [
			{ id: 'mode', label: 'Handedness', type: 'select', choices: MODE_CHOICES_1_3_1.mouseMode, default: 'right' },
			{ id: 'speed', label: 'Pointer Speed', type: 'number', default: 7 },
		],
		run: (values) => adapter.setMouse(values.mode, values.speed),
	},
	{
		id: 'get_window_geometry',
		section: '1.3.2.1',
		name: 'Window Position and Size — Get',
		note: 'The guide only shows this response as a screenshot. Whatever comes back here is the source of truth.',
		fields: [],
		run: () => adapter.getWindowGeometry(),
	},
	{
		id: 'set_window_geometry',
		section: '1.3.2.2',
		name: 'Window Position and Size — Set',
		note: 'Writes all four windows at once. Run the Get above first and mirror its values if you want a no-op round trip.',
		fields: [
			{
				id: 'resolution',
				label: 'Output Resolution',
				type: 'select',
				choices: RESOLUTION_CHOICES,
				default: '3840x2160',
			},
			...GEOMETRY_DEFAULTS.flatMap((defaults, index) => {
				const id = index + 1
				return [
					{ id: `w${id}_x`, label: `W${id} X`, type: 'number', default: defaults.x },
					{ id: `w${id}_y`, label: `W${id} Y`, type: 'number', default: defaults.y },
					{ id: `w${id}_w`, label: `W${id} Width`, type: 'number', default: defaults.w },
					{ id: `w${id}_h`, label: `W${id} Height`, type: 'number', default: defaults.h },
					{ id: `w${id}_aspect`, label: `W${id} Aspect`, type: 'select', choices: ASPECT_CHOICES, default: 1 },
					{ id: `w${id}_fit`, label: `W${id} Fit`, type: 'select', choices: FIT_CHOICES, default: 0 },
					{ id: `w${id}_show`, label: `W${id} Show`, type: 'select', choices: SHOW_CHOICES, default: 1 },
				]
			}),
		],
		run: (values) => {
			const windows = [1, 2, 3, 4].map((id) => ({
				x: values[`w${id}_x`],
				y: values[`w${id}_y`],
				w: values[`w${id}_w`],
				h: values[`w${id}_h`],
				aspect: values[`w${id}_aspect`],
				fit: values[`w${id}_fit`],
				show: values[`w${id}_show`],
			}))
			const [width, height] = String(values.resolution).split('x').map(Number)

			return adapter.setWindowGeometry(windows, [width, height])
		},
	},
	{
		id: 'get_window_labels',
		section: '1.3.2.3',
		name: 'Window Label Text — Get',
		note: 'Also a screenshot-only response in the guide.',
		fields: [],
		run: () => adapter.getWindowLabels(),
	},
	{
		id: 'set_window_label',
		section: '1.3.2.4',
		name: 'Window Label Text — Set',
		note: 'Excluded characters: < > ! @ # $ % ^ & * " \' ` / \\ , . : ; ? =',
		warnInDaisyChain:
			'Do not run this against a daisy-chained unit. It returns Success, does not set the label, and leaves the unit unable to edit labels from its own GUI afterwards.',
		fields: [
			{ id: 'port', label: 'Input Port', type: 'select', choices: WINDOW_CHOICES, default: 1 },
			{ id: 'label', label: 'Label', type: 'text', default: 'Bench Test' },
		],
		run: (values) => adapter.setWindowLabel(values.port, values.label),
	},
	{
		id: 'set_window_show',
		section: '1.3.2.5',
		name: 'Window Show/Hide — Set',
		fields: [
			{ id: 'winid', label: 'Window', type: 'select', choices: WINDOW_CHOICES, default: 1 },
			{ id: 'show', label: 'Visibility', type: 'select', choices: SHOW_CHOICES, default: 1 },
		],
		run: (values) => adapter.setWindowShow(values.winid, values.show),
	},
	{
		id: 'set_window_aspect',
		section: '1.3.2.6',
		name: 'Window Aspect Ratio — Set',
		fields: [
			{ id: 'winid', label: 'Window', type: 'select', choices: WINDOW_CHOICES, default: 1 },
			{ id: 'aspect', label: 'Aspect Ratio', type: 'select', choices: ASPECT_CHOICES, default: 1 },
		],
		run: (values) => adapter.setWindowAspect(values.winid, values.aspect),
	},
	{
		id: 'set_fullscreen',
		section: '1.3.2.7',
		name: 'Fullscreen Mode — Set',
		fields: [
			{
				id: 'full',
				label: 'Target',
				type: 'select',
				choices: [{ value: 0, label: 'Multiview (exit fullscreen)' }, ...WINDOW_CHOICES],
				default: 0,
			},
		],
		run: (values) => adapter.setFullscreen(values.full),
	},

	// --- Section 1.3.3, Commands for Sequoia 4K60 ---------------------------------------------
	// One adapter method serves each of the paired tables below: the guide documents Set Routing
	// and Set Audio twice apiece (once per operating mode), but the 4K60's two modes produce
	// byte-identical requests, so `Sequoia4K60Adapter` has nothing to branch on. The section label
	// carries both table numbers rather than pretending there is only one.
	{
		id: 'set_routing_4k60',
		section: '1.3.3.1-2',
		name: 'Routing - Set',
		models: ['sequoia-4k60'],
		note: 'Input 0 duplicates HDMI OUT 1’s multiview layout and is valid only for OUT 2/3/4. OUT 5 exists on this model only. Window ID means the quad-view window on OUT 1, and the mode decides what it means elsewhere - the request shape does not change.',
		fields: [
			{ id: 'input', label: 'Input Port', type: 'number', default: 1 },
			{ id: 'port', label: 'Output Port', type: 'number', default: 1 },
			{ id: 'winid', label: 'Window ID', type: 'number', default: 1 },
		],
		run: (values) => adapter.setRouting(values.input, values.port, values.winid),
	},
	{
		id: 'get_routing_4k60',
		section: '1.3.3.3',
		name: 'Routing Info - Get',
		models: ['sequoia-4k60'],
		note: 'Screenshot-only response in the guide, and unrecorded anywhere else. Asks for type route2win - the 4K60L asks for hdmi_output instead, so the two models genuinely differ here rather than sharing a request.',
		fields: [],
		run: () => adapter.getRouting(),
	},
	{
		id: 'set_audio_4k60',
		section: '1.3.3.4-5',
		name: 'Audio - Set',
		models: ['sequoia-4k60'],
		note: 'Window 0 turns the output’s audio off; 1-4 selects a window.',
		fields: [
			{ id: 'port', label: 'Output Port', type: 'number', default: 1 },
			{ id: 'winid', label: 'Window ID', type: 'number', default: 0 },
		],
		run: (values) => adapter.setAudio(values.port, values.winid),
	},

	// --- Section 1.3.4, Commands for Sequoia 4K60L --------------------------------------------
	// Unlike the 4K60, this model's modes really do change the request shape, so the cards below
	// are worth firing once per mode. Tables 1.3.4.6 (K/M Control) and 1.3.4.9/1.3.4.10 (Output
	// Resolution) are absent here on purpose: section 1.3.1 documents both for the 4K60 in the
	// same shape, so there is one adapter method each and they already appear under 1.3.1.13 and
	// 1.3.1.4 above. Firing those cards on a 4K60L is firing these commands.
	{
		id: 'set_routing_4k60l',
		section: '1.3.4.1-3',
		name: 'Routing - Set',
		models: ['sequoia-4k60l'],
		note: 'The clearest case of a mode changing the wire shape: quad-bypass sends route2win for OUT 1 but hdmi_output (with enable/mode hardcoded) for OUT 2/3, while single-view seamless always sends route2win with Window ID forced to 1 whatever you type. Watch the URL to see which branch you got. In daisy-chain mode this sends nothing at all - section 1.3.5 has no Routing - Set, so the adapter has no branch for it and the result panel will say no request was made.',
		fields: [
			{ id: 'input', label: 'Input Port', type: 'number', default: 1 },
			{ id: 'port', label: 'Output Port', type: 'number', default: 1 },
			{ id: 'winid', label: 'Window ID', type: 'number', default: 1 },
		],
		run: (values) => adapter.setRouting(values.input, values.port, values.winid),
	},
	{
		id: 'get_routing_4k60l',
		section: '1.3.4.4',
		name: 'Routing Info - Get',
		models: ['sequoia-4k60l'],
		note: 'Screenshot-only response in the guide. Asks for type hdmi_output. The adapter does not branch on mode, so this fires in daisy-chain mode too - section 1.3.5 does not list it, which makes whatever comes back there worth recording rather than trusting.',
		fields: [],
		run: () => adapter.getRouting(),
	},
	{
		id: 'set_km_reboot_mode',
		section: '1.3.4.5',
		name: 'Power-on K/M Mode - Set',
		models: ['sequoia-4k60l'],
		modes: ['sequoia-4k60l-quad-bypass'],
		note: 'Sets which K/M target the unit comes up in after a power cycle. 0 = Host, 1-4 = that window’s remote. Distinct from K/M Control (1.3.1.13), which switches the live target and does not survive a reboot. Port is fixed to 1 by the adapter, the only value the guide’s example shows.',
		fields: [{ id: 'mode', label: 'Power-on Mode', type: 'number', default: 0 }],
		run: (values) => adapter.setKmRebootMode(values.mode),
	},
	{
		id: 'set_audio_4k60l',
		section: '1.3.4.7-8',
		name: 'Audio - Set',
		models: ['sequoia-4k60l'],
		note: 'Quad-bypass sends port 1 plainly but adds location:1 for OUT 2/3; single-view seamless sends port and window straight through, and accepts only window 0 or 1. In daisy-chain mode this switches to a different cmd family entirely - Daisy rather than 2060, with location and port both pinned to 1 - which is Table 1.3.5.2. Same button, three wire shapes; read the URL.',
		fields: [
			{ id: 'port', label: 'Output Port', type: 'number', default: 1 },
			{ id: 'winid', label: 'Window ID', type: 'number', default: 0 },
		],
		run: (values) => adapter.setAudio(values.port, values.winid),
	},

	// --- Section 1.3.5, Command for Sequoia 4K60L in Daisy Chain ------------------------------
	// Of the four commands 1.3.5 names, only Label Text (1.3.5.1) has an adapter method of its own.
	// Audio (1.3.5.2) is the 1.3.4 card above taking its daisy branch; K/M Control (1.3.5.3) and
	// Output Resolution (1.3.5.4) are the 1.3.1.13 and 1.3.1.4 cards - the requests are
	// byte-identical to the ones 1.3.1 documents, so there is one adapter method each.
	{
		id: 'set_label_daisy',
		section: '1.3.5.1',
		name: 'Label Text - Set',
		models: ['sequoia-4k60l'],
		modes: ['sequoia-4k60l-daisy-chain'],
		note: 'Not the same command as Window Label Text - Set (1.3.2.4) above, despite doing the same job: this one sends daisy:1 and addresses ports 1-16 across the chain. It is the label command that is documented to work on a chained unit - 1.3.2.4 is the one that breaks manual label editing there, so use this card and not that one.',
		fields: [
			{ id: 'port', label: 'Port (1-16)', type: 'number', default: 1 },
			{ id: 'label', label: 'Label', type: 'text', default: 'Bench Test' },
		],
		run: (values) => adapter.setLabel(values.port, values.label),
	},
]

// --- HTTP server ----------------------------------------------------------------------------

function readBody(request) {
	return new Promise((resolve, reject) => {
		let body = ''
		request.on('data', (chunk) => (body += chunk))
		request.on('end', () => resolve(body))
		request.on('error', reject)
	})
}

async function handleSend(request, response) {
	const { id, values } = JSON.parse(await readBody(request))
	const command = COMMANDS.find((candidate) => candidate.id === id)

	if (!command) {
		response.writeHead(404, { 'content-type': 'application/json' })
		response.end(JSON.stringify({ error: `Unknown command: ${id}` }))
		return
	}

	// The card renders its Send button disabled, but /send is reachable regardless - and calling
	// a 4K60L-only method through a 4K60 adapter throws a TypeError that reads like a bench bug.
	const unavailable = unavailableReason(command)
	if (unavailable) {
		response.writeHead(409, { 'content-type': 'application/json' })
		response.end(JSON.stringify({ error: unavailable }))
		return
	}

	requestLog = []

	const result = {}
	try {
		await command.run(values)
	} catch (error) {
		result.error = error.message
	}

	result.requests = requestLog

	console.log(`\n  ${command.section}  ${command.name}`)
	for (const entry of requestLog) {
		console.log(`  -> ${entry.url}`)
		if (entry.raw !== undefined) console.log(`  <- ${entry.httpStatus} ${JSON.stringify(entry.raw)}`)
	}
	if (result.error) console.log(`  !! ${result.error}`)

	response.writeHead(200, { 'content-type': 'application/json' })
	response.end(JSON.stringify(result))
}

const server = createServer((request, response) => {
	if (request.method === 'POST' && request.url === '/send') {
		handleSend(request, response).catch((error) => {
			response.writeHead(500, { 'content-type': 'application/json' })
			response.end(JSON.stringify({ error: error.message }))
		})
		return
	}

	if (request.url === '/' || request.url === '/index.html') {
		// no-store because the page and the /send payload shape change together. A cached page
		// against a newer server silently renders nothing, which looks like a device fault rather
		// than a stale tab.
		response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
		response.end(renderPage())
		return
	}

	response.writeHead(404)
	response.end('Not found')
})

function main() {
	config = parseArgs(process.argv.slice(2))
	adapter = createAdapter(config.mode, moduleInstance, api)

	server.listen(config.listen, () => {
		console.log(`\n  Sequoia command bench`)
		console.log(`  device : http://${config.host}${config.port !== 80 ? `:${config.port}` : ''}`)
		console.log(`  mode   : ${config.mode}`)
		console.log(`  bench  : http://localhost:${config.listen}\n`)
	})
}

try {
	main()
} catch (error) {
	if (!(error instanceof UsageError)) throw error

	console.error(`\n  ${error.message}\n`)
	console.error('  Usage: yarn bench --host 192.168.0.5 [--port 80] [--mode <device-mode>] [--listen 8099]\n')
	process.exitCode = 1
}

// --- Page -----------------------------------------------------------------------------------

const escapeHtml = (value) =>
	String(value).replace(
		/[&<>"']/g,
		(char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char],
	)

function renderField(field) {
	const label = `<label for="${field.id}">${escapeHtml(field.label)}</label>`

	if (field.type === 'select') {
		const options = field.choices
			.map(
				(choice) =>
					`<option value="${escapeHtml(choice.value)}"${choice.value === field.default ? ' selected' : ''}>${escapeHtml(
						choice.label,
					)}</option>`,
			)
			.join('')
		return `<div class="field">${label}<select id="${field.id}" data-field="${field.id}" data-kind="${
			typeof field.default === 'number' ? 'number' : 'text'
		}">${options}</select></div>`
	}

	const inputType = field.type === 'number' ? 'number' : 'text'
	return `<div class="field">${label}<input id="${field.id}" data-field="${field.id}" data-kind="${
		field.type === 'number' ? 'number' : 'text'
	}" type="${inputType}" value="${escapeHtml(field.default)}"></div>`
}

function renderCard(command) {
	const note = command.note ? `<p class="note">${escapeHtml(command.note)}</p>` : ''
	const fields = command.fields.length
		? `<div class="fields">${command.fields.map(renderField).join('')}</div>`
		: '<p class="note">No parameters.</p>'

	// Companion gates section 1.3.2 out of daisy-chain mode; the bench deliberately does not, so
	// that undocumented behaviour can still be probed. A command with a known harmful effect there
	// needs saying out loud instead.
	const isDaisyChain = config.mode === 'sequoia-4k60l-daisy-chain'
	const daisyWarning =
		isDaisyChain && command.warnInDaisyChain ? `<p class="warn">${escapeHtml(command.warnInDaisyChain)}</p>` : ''

	// `warn` is unconditional, for commands that are dangerous in every mode rather than only in a
	// daisy chain - the section 1.3.1 commands that erase device state.
	const warning = command.warn ? `<p class="warn">${escapeHtml(command.warn)}</p>` : ''

	// Sections 1.3.3-1.3.5 are not on every unit. An inapplicable command stays on the page so it
	// remains a full catalogue, with its Send disabled and the reason where the warnings go.
	const unavailable = unavailableReason(command)

	return `
<section class="card${unavailable ? ' unavailable' : ''}" data-command="${command.id}">
	<header>
		<span class="tag">${escapeHtml(command.section)}</span>
		<h2>${escapeHtml(command.name)}</h2>
	</header>
	${unavailable ? `<p class="unavailable-note">${escapeHtml(unavailable)}</p>` : ''}
	${warning}
	${daisyWarning}
	${note}
	${fields}
	<button type="button"${unavailable ? ' disabled' : ''}>Send</button>
	<pre class="result" hidden></pre>
</section>`
}

/** Cards grouped under their guide section, in section order, so a long page stays navigable. */
function renderSections() {
	const groups = new Map()

	for (const command of COMMANDS) {
		const key = sectionGroup(command.section)
		if (!groups.has(key)) groups.set(key, [])
		groups.get(key).push(command)
	}

	return [...groups.entries()]
		.map(([key, commands]) => {
			const available = commands.filter((command) => !unavailableReason(command)).length
			const count =
				available === commands.length
					? `${commands.length} command${commands.length === 1 ? '' : 's'}`
					: `${available} of ${commands.length} applicable here`

			return `
<h2 class="section-heading">
	<span class="tag">${escapeHtml(key)}</span>
	${escapeHtml(SECTION_TITLES[key] ?? '')}
	<span class="section-count">${escapeHtml(count)}</span>
</h2>
${commands.map(renderCard).join('')}`
		})
		.join('')
}

function renderPage() {
	return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Sequoia command bench</title>
<style>
	:root { color-scheme: light dark; --bg:#f6f7f9; --card:#fff; --line:#d8dce2; --ink:#1c2024; --muted:#6b7280; --accent:#2563eb; --ok:#15803d; --bad:#b91c1c; }
	@media (prefers-color-scheme: dark) {
		:root { --bg:#14161a; --card:#1c1f24; --line:#2e333b; --ink:#e6e8ea; --muted:#9aa1ab; --accent:#60a5fa; --ok:#4ade80; --bad:#f87171; }
	}
	* { box-sizing: border-box; }
	body { margin:0; padding:2rem 1.5rem 4rem; background:var(--bg); color:var(--ink);
		font:15px/1.5 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif; }
	main { max-width: 60rem; margin: 0 auto; }
	h1 { font-size:1.35rem; margin:0 0 .35rem; }
	.target { color:var(--muted); font-size:.9rem; margin:0 0 2rem; }
	.target code { background:var(--card); border:1px solid var(--line); border-radius:4px; padding:.1rem .35rem; }
	.card { background:var(--card); border:1px solid var(--line); border-radius:10px; padding:1.1rem 1.25rem; margin-bottom:1rem; }
	.card header { display:flex; align-items:baseline; gap:.6rem; }
	.card h2 { font-size:1rem; margin:0; font-weight:600; }
	.tag { font:600 11px/1 ui-monospace, SFMono-Regular, Menlo, monospace; color:var(--muted);
		border:1px solid var(--line); border-radius:4px; padding:.25rem .4rem; }
	.note { color:var(--muted); font-size:.85rem; margin:.6rem 0 0; }
	.warn { margin:.7rem 0 0; padding:.55rem .7rem; border:1px solid var(--bad); border-left-width:3px;
		border-radius:6px; color:var(--bad); font-size:.85rem; }
	.section-heading { display:flex; align-items:baseline; gap:.6rem; font-size:.95rem; font-weight:600;
		margin:2.2rem 0 .8rem; padding-bottom:.5rem; border-bottom:1px solid var(--line); }
	.section-heading:first-of-type { margin-top:0; }
	.section-count { margin-left:auto; font-weight:400; font-size:.78rem; color:var(--muted); }
	.card.unavailable { opacity:.6; }
	.unavailable-note { margin:.7rem 0 0; padding:.55rem .7rem; border:1px dashed var(--line);
		border-radius:6px; color:var(--muted); font-size:.85rem; }
	.banner { margin:0 0 1.5rem; padding:.8rem 1rem; border:1px solid var(--bad); border-left-width:3px;
		border-radius:8px; background:var(--card); font-size:.88rem; }
	.banner strong { color:var(--bad); }
	.fields { display:grid; grid-template-columns:repeat(auto-fill, minmax(9.5rem, 1fr)); gap:.6rem; margin:.9rem 0 0; }
	.field { display:flex; flex-direction:column; gap:.25rem; }
	label { font-size:.75rem; color:var(--muted); }
	input, select { padding:.4rem .5rem; border:1px solid var(--line); border-radius:6px;
		background:var(--bg); color:var(--ink); font:inherit; font-size:.85rem; min-width:0; }
	button { margin-top:.9rem; padding:.45rem 1.1rem; border:0; border-radius:6px; background:var(--accent);
		color:#fff; font:inherit; font-weight:600; font-size:.85rem; cursor:pointer; }
	button:disabled { opacity:.55; cursor:progress; }
	.result { margin:.9rem 0 0; padding:.75rem .85rem; background:var(--bg); border:1px solid var(--line);
		border-radius:6px; font:12px/1.55 ui-monospace, SFMono-Regular, Menlo, monospace;
		white-space:pre-wrap; word-break:break-all; overflow-x:auto; }
	.result.ok { border-color:var(--ok); }
	.result.bad { border-color:var(--bad); }
</style>
</head>
<body>
<main>
	<h1>Sequoia command bench</h1>
	<p class="target">
		Sections 1.3.1 &ndash; 1.3.5 &middot;
		device <code>${escapeHtml(config.host)}${config.port !== 80 ? `:${config.port}` : ''}</code> &middot;
		mode <code>${escapeHtml(config.mode)}</code> &middot;
		model <code>${escapeHtml(adapter.model)}</code>
	</p>
	${
		config.mode === 'sequoia-4k60l-daisy-chain'
			? `<div class="banner"><strong>Daisy-chain mode.</strong> Companion does not expose section 1.3.2
			   on a chained unit; this bench does not gate by mode, so every command below will still fire.
			   Most of them return <code>Success</code> and have no effect &mdash; a false positive the module
			   cannot detect. Treat any result here as unverified unless you confirm it on the hardware.</div>`
			: ''
	}
	${renderSections()}
</main>
<script>
document.querySelectorAll('.card').forEach((card) => {
	const button = card.querySelector('button')
	const result = card.querySelector('.result')

	button.addEventListener('click', async () => {
		const values = {}
		card.querySelectorAll('[data-field]').forEach((el) => {
			values[el.dataset.field] = el.dataset.kind === 'number' ? Number(el.value) : el.value
		})

		button.disabled = true
		result.hidden = false
		result.className = 'result'
		result.textContent = 'Sending...'

		try {
			const response = await fetch('/send', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ id: card.dataset.command, values }),
			})
			const data = await response.json()

			const lines = []
			for (const entry of data.requests ?? []) {
				if (lines.length) lines.push('')
				lines.push('GET  ' + decodeURIComponent(entry.url), '')
				if (entry.raw !== undefined) lines.push('<-   HTTP ' + entry.httpStatus, JSON.stringify(entry.raw))
			}
			if (data.error) lines.push('', '!!   ' + data.error)
			if (!lines.length) lines.push('(no request was made)')

			result.textContent = lines.join('\\n')
			result.classList.add(data.error ? 'bad' : 'ok')
		} catch (error) {
			result.textContent = '!!   ' + error.message
			result.classList.add('bad')
		} finally {
			button.disabled = false
		}
	})
})
</script>
</body>
</html>`
}
