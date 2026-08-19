import { combineRgb } from '@companion-module/base'
import type { CompanionPresetDefinitions, CompanionPresetGroup, CompanionPresetSection } from '@companion-module/base'
import type ModuleInstance from './main.js'
import type { ModuleSchema } from './main.js'
import { INPUT_IDS } from './signal.js'
import { DEFAULT_LAYOUT_CHOICES } from './system.js'
import { FULLSCREEN_CHOICES } from './windows.js'

/**
 * Starting-point buttons for the actions a user reaches for first.
 *
 * These are **mode-aware for the same reason `actions.ts` is**: a preset may only reference an
 * action that exists in the configured mode, or dropping it on a button produces a step bound to
 * an action id the module never registered. So the mode predicates below mirror `UpdateActions()`
 * exactly, and `ModuleInstance` rebuilds presets in `configUpdated()` alongside the action list.
 *
 * In daisy-chain mode that leaves Audio and K/M Control - two of the four commands section 1.3.5
 * names. The other two are left alone deliberately: Label Text needs per-unit text that no preset
 * can guess, and Output Resolution has fifteen choices, which is a dropdown rather than a wall of
 * buttons.
 */

/**
 * The connection label used in variable references.
 *
 * Companion rewrites this prefix to the user's actual connection label when the preset is applied,
 * so what matters is only that it is the module's own shortname (`companion/manifest.json`).
 */
const CONNECTION_LABEL = 'sequoia'

const WHITE = combineRgb(255, 255, 255)
const BLACK = combineRgb(0, 0, 0)
const GREY = combineRgb(40, 40, 40)
const GREEN = combineRgb(0, 128, 0)
const BLUE = combineRgb(0, 51, 102)

export function UpdatePresets(self: ModuleInstance): void {
	const mode = self.config.mode
	const isQuadWorkstation = mode === 'sequoia-4k60-quad-workstation'
	const isQuadBypass = mode === 'sequoia-4k60l-quad-bypass'
	const isSingleView = mode === 'sequoia-4k60l-single-view-seamless'
	const isDaisyChain = mode === 'sequoia-4k60l-daisy-chain'

	/** Both modes that put four sources on one output at once, and so route per window. */
	const isQuadView = isQuadWorkstation || isQuadBypass

	const presets: CompanionPresetDefinitions<ModuleSchema> = {}
	const sections: CompanionPresetSection<ModuleSchema>[] = []

	// --- Input signal ---------------------------------------------------------------------------
	// Skipped in daisy-chain mode, where the module does not poll section 1.3.1.2 and the feedback
	// these buttons are built on would never update.
	if (!isDaisyChain) {
		for (const input of INPUT_IDS) {
			presets[`input_${input}_status`] = {
				type: 'simple',
				name: `Input ${input} signal status`,
				keywords: ['signal', 'input', 'source', 'status'],
				style: {
					text: `In ${input}\n$(${CONNECTION_LABEL}:input_${input}_signal)`,
					size: 'auto',
					color: WHITE,
					bgcolor: GREY,
					show_topbar: false,
				},
				// Pressing refreshes rather than doing nothing: the button is worth having even with
				// polling turned off, and a press is the only other way to update it.
				steps: [{ down: [{ actionId: 'get_signal_type', options: {} }], up: [] }],
				feedbacks: [
					{
						feedbackId: 'input_signal_present',
						options: { input },
						style: { bgcolor: GREEN, color: WHITE },
					},
				],
			}
		}

		presets['signal_count'] = {
			type: 'simple',
			name: 'Inputs with a signal',
			keywords: ['signal', 'count', 'overview'],
			style: {
				text: `Signals\n$(${CONNECTION_LABEL}:inputs_present) / ${INPUT_IDS.length}`,
				size: 'auto',
				color: WHITE,
				bgcolor: GREY,
				show_topbar: false,
			},
			steps: [{ down: [{ actionId: 'get_signal_type', options: {} }], up: [] }],
			feedbacks: [],
		}

		sections.push({
			id: 'input_signal',
			name: 'Input Signal',
			description:
				'Live source status from section 1.3.1.2. These follow the poll interval in the connection config; pressing one refreshes it immediately.',
			definitions: [
				{
					id: 'input_status',
					type: 'simple',
					name: 'Per-input status',
					description: 'Green while the device reports a locked source, with the detected format below.',
					presets: INPUT_IDS.map((input) => `input_${input}_status`),
				},
				{
					id: 'signal_overview',
					type: 'simple',
					name: 'Overview',
					presets: ['signal_count'],
				},
			],
		})
	}

	// --- Routing --------------------------------------------------------------------------------
	// The useful button set genuinely differs by mode, rather than just the option values: a
	// quad-view mode routes a source into one of four windows (a 4x4 grid), while a seamless mode
	// puts one source on the whole output (four buttons). Building both from one loop would produce
	// sixteen buttons that are really four, repeated.
	if (!isDaisyChain) {
		const routingGroups: CompanionPresetGroup<ModuleSchema>[] = []

		if (isQuadView) {
			for (const window of INPUT_IDS) {
				for (const input of INPUT_IDS) {
					presets[`route_in${input}_win${window}`] = {
						type: 'simple',
						name: `Route Input ${input} to Window ${window}`,
						keywords: ['route', 'source', 'window'],
						style: {
							text: `Win ${window}\nIn ${input}`,
							size: 'auto',
							color: WHITE,
							bgcolor: BLUE,
							show_topbar: false,
						},
						steps: [{ down: [{ actionId: 'set_routing', options: { input, port: 1, winid: window } }], up: [] }],
						feedbacks: [],
					}
				}

				routingGroups.push({
					id: `route_win${window}`,
					type: 'simple',
					name: `Window ${window} source`,
					presets: INPUT_IDS.map((input) => `route_in${input}_win${window}`),
				})
			}
		} else {
			for (const input of INPUT_IDS) {
				presets[`route_in${input}_out1`] = {
					type: 'simple',
					name: `Take Input ${input} to HDMI OUT 1`,
					keywords: ['route', 'take', 'source', 'seamless'],
					style: {
						text: `Take\nIn ${input}`,
						size: 'auto',
						color: WHITE,
						bgcolor: BLUE,
						show_topbar: false,
					},
					steps: [
						{
							down: [
								{
									actionId: 'set_routing',
									// Single-View Seamless registers no Window ID field at all, so the option is
									// left off rather than sent as a value the action does not accept.
									options: isSingleView ? { input, port: 1 } : { input, port: 1, winid: 1 },
								},
							],
							up: [],
						},
					],
					feedbacks: [],
				}
			}

			routingGroups.push({
				id: 'route_out1',
				type: 'simple',
				name: 'HDMI OUT 1 source',
				presets: INPUT_IDS.map((input) => `route_in${input}_out1`),
			})
		}

		sections.push({
			id: 'routing',
			name: 'Routing',
			description: isQuadView
				? 'Assign an input to one of the four multiview windows on HDMI OUT 1.'
				: 'Switch HDMI OUT 1 to a single source.',
			definitions: routingGroups,
		})
	}

	// --- Audio ----------------------------------------------------------------------------------
	// Available in every mode - it is one of the four commands section 1.3.5 names for a chained
	// unit. Window 0 is "off" on all of them; Single-View Seamless is the one mode where the only
	// other value is 1, so it gets an on/off pair rather than a window picker.
	const audioPort = isDaisyChain ? undefined : 1
	const audioWindows = isSingleView ? [1] : [...INPUT_IDS]

	presets['audio_off'] = {
		type: 'simple',
		name: 'Audio off',
		keywords: ['audio', 'mute', 'off'],
		style: { text: 'Audio\nOff', size: 'auto', color: WHITE, bgcolor: BLACK, show_topbar: false },
		steps: [{ down: [{ actionId: 'set_audio', options: { port: audioPort, winid: 0 } }], up: [] }],
		feedbacks: [],
	}

	for (const window of audioWindows) {
		presets[`audio_win_${window}`] = {
			type: 'simple',
			name: isSingleView ? 'Audio on' : `Audio from Window ${window}`,
			keywords: ['audio', 'window'],
			style: {
				text: isSingleView ? 'Audio\nOn' : `Audio\nWin ${window}`,
				size: 'auto',
				color: WHITE,
				bgcolor: GREY,
				show_topbar: false,
			},
			steps: [{ down: [{ actionId: 'set_audio', options: { port: audioPort, winid: window } }], up: [] }],
			feedbacks: [],
		}
	}

	sections.push({
		id: 'audio',
		name: 'Audio',
		description: 'Select which window the output carries audio from.',
		definitions: [
			{
				id: 'audio_source',
				type: 'simple',
				name: 'Audio source',
				presets: ['audio_off', ...audioWindows.map((window) => `audio_win_${window}`)],
			},
		],
	})

	// --- K/M control ----------------------------------------------------------------------------
	// Registered for exactly the three modes `actions.ts` registers `set_km_control` for.
	if (isQuadWorkstation || isQuadBypass || isDaisyChain) {
		presets['km_host'] = {
			type: 'simple',
			name: 'K/M control - Host',
			keywords: ['km', 'keyboard', 'mouse', 'host'],
			style: { text: 'K/M\nHost', size: 'auto', color: WHITE, bgcolor: BLACK, show_topbar: false },
			steps: [{ down: [{ actionId: 'set_km_control', options: { winid: 0 } }], up: [] }],
			feedbacks: [],
		}

		for (const window of INPUT_IDS) {
			presets[`km_win_${window}`] = {
				type: 'simple',
				name: `K/M control - Window ${window}`,
				keywords: ['km', 'keyboard', 'mouse', 'remote'],
				style: {
					text: `K/M\nWin ${window}`,
					size: 'auto',
					color: WHITE,
					bgcolor: GREY,
					show_topbar: false,
				},
				steps: [{ down: [{ actionId: 'set_km_control', options: { winid: window } }], up: [] }],
				feedbacks: [],
			}
		}

		sections.push({
			id: 'km_control',
			name: 'K/M Control',
			description:
				'Switch the keyboard and mouse between the host and a remote window. Takes effect live; it does not survive a reboot.',
			definitions: [
				{
					id: 'km_target',
					type: 'simple',
					name: 'K/M target',
					// Daisy chain addresses up to 16 windows, but a preset per window across a chain of
					// unknown length is not a button set - the action's Window ID field covers the rest.
					presets: ['km_host', ...INPUT_IDS.map((window) => `km_win_${window}`)],
				},
			],
		})
	}

	// --- Layouts and fullscreen -----------------------------------------------------------------
	if (!isDaisyChain) {
		for (const choice of DEFAULT_LAYOUT_CHOICES) {
			presets[`layout_${choice.id}`] = {
				type: 'simple',
				name: `Load layout - ${choice.label}`,
				keywords: ['layout', 'preset', 'multiview'],
				style: {
					text: `Layout\n${choice.label}`,
					size: 'auto',
					color: WHITE,
					bgcolor: GREY,
					show_topbar: false,
				},
				steps: [{ down: [{ actionId: 'load_default_layout', options: { layout: Number(choice.id) } }], up: [] }],
				feedbacks: [],
			}
		}

		presets['load_latest_preset'] = {
			type: 'simple',
			name: 'Load most recent preset',
			keywords: ['preset', 'recall', 'latest'],
			style: { text: 'Load\nLatest', size: 'auto', color: WHITE, bgcolor: GREY, show_topbar: false },
			steps: [{ down: [{ actionId: 'load_latest_preset', options: {} }], up: [] }],
			feedbacks: [],
		}

		for (const choice of FULLSCREEN_CHOICES) {
			presets[`fullscreen_${choice.id}`] = {
				type: 'simple',
				name: `Fullscreen - ${choice.label}`,
				keywords: ['fullscreen', 'window', 'multiview'],
				style: {
					text: Number(choice.id) === 0 ? 'Exit\nFull' : `Full\nWin ${choice.id}`,
					size: 'auto',
					color: WHITE,
					bgcolor: Number(choice.id) === 0 ? BLACK : GREY,
					show_topbar: false,
				},
				steps: [{ down: [{ actionId: 'set_fullscreen', options: { full: Number(choice.id) } }], up: [] }],
				feedbacks: [],
			}
		}

		sections.push({
			id: 'layout',
			name: 'Layout',
			description: 'Recall a built-in multiview layout, or blow one window up to fill the output.',
			definitions: [
				{
					id: 'default_layouts',
					type: 'simple',
					name: 'Built-in layouts',
					presets: [...DEFAULT_LAYOUT_CHOICES.map((choice) => `layout_${choice.id}`), 'load_latest_preset'],
				},
				{
					id: 'fullscreen',
					type: 'simple',
					name: 'Fullscreen',
					presets: FULLSCREEN_CHOICES.map((choice) => `fullscreen_${choice.id}`),
				},
			],
		})
	}

	self.setPresetDefinitions(sections, presets)
}
