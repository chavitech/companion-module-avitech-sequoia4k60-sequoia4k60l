import type { CompanionActionDefinition, DropdownChoice, SomeCompanionActionInputField } from '@companion-module/base'
import type ModuleInstance from './main.js'
import { Sequoia4K60LAdapter } from './adapters/index.js'
import { RESOLUTION_MODES } from './resolutions.js'
import { formatSignal } from './signal.js'
import {
	ASPECT_CHOICES,
	FULLSCREEN_CHOICES,
	GetWindowGeometryOptions,
	SHOW_CHOICES,
	collectWindowGeometry,
	parseGeometryResolution,
	type WindowGeometryOptions,
} from './windows.js'
import {
	ACTIVE_BORDER_CHOICES,
	ALERT_DISPLAY_CHOICES,
	AUTO_HIDE_LABEL_CHOICES,
	BORDER_WIDTH_CHOICES,
	DEFAULT_LAYOUT_CHOICES,
	LABEL_OVERLAY_CHOICES,
	LABEL_TEXT_TRANSPARENCY_CHOICES,
	MOUSE_MODE_CHOICES,
	OSD_ENABLED_CHOICES,
	POWER_SAVING_CHOICES,
	PowerSavingPortChoices,
	SHOW_LABEL_CHOICES,
	SHOW_TALLY_CHOICES,
	USER_ICON_PRESET_CHOICES,
	toFixedColor,
	toTransparencyColor,
	type ColorOptionValue,
} from './system.js'

export type ActionsSchema = {
	set_routing: {
		options: {
			input: number
			port: number
			winid?: number
		}
	}
	get_routing: {
		options: Record<string, never>
	}
	set_audio: {
		options: {
			port?: number
			winid: number
		}
	}
	set_km_reboot_mode: {
		options: {
			mode: number
		}
	}
	set_km_control: {
		options: {
			winid: number
		}
	}
	set_output_resolution: {
		options: {
			port?: number
			mode: number
		}
	}
	set_label: {
		options: {
			port: number
			label: string
		}
	}
	get_window_geometry: {
		options: Record<string, never>
	}
	set_window_geometry: {
		options: WindowGeometryOptions
	}
	get_window_labels: {
		options: Record<string, never>
	}
	set_window_label: {
		options: {
			port: number
			label: string
		}
	}
	set_window_show: {
		options: {
			winid: number
			show: number
		}
	}
	set_window_aspect: {
		options: {
			winid: number
			aspect: number
		}
	}
	set_fullscreen: {
		options: {
			full: number
		}
	}
	// --- Section 1.3.1, Commands for Controlling System ---
	get_firmware_version: {
		options: Record<string, never>
	}
	get_signal_type: {
		options: Record<string, never>
	}
	get_network_info: {
		options: Record<string, never>
	}
	load_default_layout: {
		options: {
			layout: number
		}
	}
	load_user_icon_preset: {
		options: {
			preset: number
		}
	}
	load_latest_preset: {
		options: Record<string, never>
	}
	load_custom_preset: {
		options: {
			name: string
		}
	}
	list_custom_presets: {
		options: Record<string, never>
	}
	delete_custom_preset: {
		options: {
			name: string
		}
	}
	reset_factory_defaults: {
		options: Record<string, never>
	}
	set_fading_level: {
		options: {
			fading_time: number
		}
	}
	get_osd_info: {
		options: Record<string, never>
	}
	set_osd_enabled: {
		options: {
			enabled: number
		}
	}
	set_window_border: {
		options: {
			border_width: number
			border_color: ColorOptionValue
		}
	}
	set_window_label_color: {
		options: {
			label_font_color: ColorOptionValue
			label_back_color: ColorOptionValue
			label_overlay: number
		}
	}
	set_osd_label_display: {
		options: {
			show_label: number
			auto_hide_label: number
			label_text_transparency: number
		}
	}
	set_audio_tally_color: {
		options: {
			tally1_on_color: ColorOptionValue
			tally1_off_color: ColorOptionValue
		}
	}
	set_audio_tally_show: {
		options: {
			show_tally1: number
		}
	}
	set_popup_menu_colors: {
		options: {
			popupmenu_active_color: ColorOptionValue
			popupmenu_available_color: ColorOptionValue
			popupmenu_disable_color: ColorOptionValue
		}
	}
	set_active_border: {
		options: {
			active_border: number
		}
	}
	set_alert_display: {
		options: {
			mode: number
		}
	}
	set_power_saving: {
		options: {
			port: number
			enable: number
		}
	}
	set_km_idle_detection: {
		options: {
			idle_time: number
		}
	}
	set_mouse: {
		options: {
			mode: string
			speed: number
		}
	}
}

const HDMI_OUT_CHOICES = (count: number): DropdownChoice[] =>
	Array.from({ length: count }, (_, i) => ({ id: i + 1, label: `HDMI OUT ${i + 1}` }))

const RESOLUTION_CHOICES: DropdownChoice[] = RESOLUTION_MODES.map((resolution) => ({
	id: resolution.mode,
	label: resolution.label,
}))

/** Section 1.3.2 addresses windows 1-4 on every command; unlike routing, the range never varies. */
const WINDOW_ID_CHOICES: DropdownChoice[] = [1, 2, 3, 4].map((id) => ({ id, label: `Window ${id}` }))

const LABEL_CHARSET_TOOLTIP = 'Allowed characters exclude: < > ! @ # $ % ^ & * " \' ` / \\ , . : ; ? ='

/** Table 1.3.1.7/1.3.1.9. The device rejects a name outside this set with "Wrong format". */
const PRESET_NAME_TOOLTIP = 'Allowed characters: A-Z, a-z, 0-9, period, dash and underscore.'

export function UpdateActions(self: ModuleInstance): void {
	const mode = self.config.mode
	const isQuadWorkstation = mode === 'sequoia-4k60-quad-workstation'
	const is4k60 = isQuadWorkstation || mode === 'sequoia-4k60-seamless'
	const isQuadBypass = mode === 'sequoia-4k60l-quad-bypass'
	const isSingleView = mode === 'sequoia-4k60l-single-view-seamless'
	const isDaisyChain = mode === 'sequoia-4k60l-daisy-chain'

	const set_routing: CompanionActionDefinition<ActionsSchema['set_routing']['options']> | undefined = isDaisyChain
		? undefined
		: {
				name: 'Set Routing',
				options: is4k60
					? [
							{
								id: 'input',
								type: 'number',
								label: 'Input Port',
								default: 1,
								min: 0,
								max: 4,
								tooltip: "0 = duplicate HDMI OUT 1's multiview layout (valid only for OUT 2/3/4). 1-4 = input port.",
							},
							{
								id: 'port',
								type: 'dropdown',
								label: 'Output Port',
								default: 1,
								choices: HDMI_OUT_CHOICES(5),
							},
							{
								id: 'winid',
								type: 'number',
								label: 'Window ID',
								default: 1,
								min: 1,
								max: 254,
								tooltip:
									'OUT1: 1-4 selects the quad-view window. OUT2/3/4: window select (Workstation mode) or fixed to 1 (Seamless mode). OUT5: always 1.',
							},
						]
					: isQuadBypass
						? [
								{ id: 'input', type: 'number', label: 'Input Port', default: 1, min: 1, max: 4 },
								{
									id: 'port',
									type: 'dropdown',
									label: 'Output Port',
									default: 1,
									choices: HDMI_OUT_CHOICES(3),
								},
								{
									id: 'winid',
									type: 'number',
									label: 'Window ID',
									default: 1,
									min: 1,
									max: 4,
									tooltip: 'Ignored when targeting HDMI OUT 2 or 3; selects OUT 1s quad-view window otherwise.',
								},
							]
						: [
								{ id: 'input', type: 'number', label: 'Input Port', default: 1, min: 1, max: 4 },
								{
									id: 'port',
									type: 'dropdown',
									label: 'Output Port',
									default: 1,
									choices: HDMI_OUT_CHOICES(4),
								},
							],
				callback: async (event) => {
					const winid = event.options.winid ?? 1
					try {
						await self.adapter.setRouting(event.options.input, event.options.port, winid)
					} catch (error) {
						self.log('error', `Set Routing failed: ${(error as Error).message}`)
					}
				},
			}

	const get_routing: CompanionActionDefinition<ActionsSchema['get_routing']['options']> | undefined = isDaisyChain
		? undefined
		: {
				name: 'Refresh Routing Info',
				options: [],
				callback: async () => {
					try {
						const result = await self.adapter.getRouting()
						self.log('info', `Routing info: ${JSON.stringify(result)}`)
					} catch (error) {
						self.log('error', `Get Routing Info failed: ${(error as Error).message}`)
					}
				},
			}

	const audioOptions: SomeCompanionActionInputField<'port' | 'winid'>[] = []
	if (!isDaisyChain) {
		audioOptions.push({
			id: 'port',
			type: 'dropdown',
			label: 'Output Port',
			default: 1,
			choices: HDMI_OUT_CHOICES(is4k60 ? 5 : isQuadBypass ? 3 : 4),
		})
	}
	audioOptions.push({
		id: 'winid',
		type: 'number',
		label: 'Window ID',
		default: 0,
		min: 0,
		max: is4k60 ? 4 : isQuadBypass ? 4 : isSingleView ? 1 : 16,
		tooltip: is4k60
			? '0 = off; 1-4 selects window (meaning depends on operating mode).'
			: isQuadBypass
				? 'OUT1: 0 = off, 1-4 = window. OUT2/3: 0 = off, 1 = on.'
				: isSingleView
					? '0 = off, 1 = on.'
					: '0 = off; 1-16 selects window across the daisy chain.',
	})

	const set_audio: CompanionActionDefinition<ActionsSchema['set_audio']['options']> = {
		name: 'Set Audio',
		options: audioOptions,
		callback: async (event) => {
			const port = event.options.port ?? 1
			try {
				await self.adapter.setAudio(port, event.options.winid)
			} catch (error) {
				self.log('error', `Set Audio failed: ${(error as Error).message}`)
			}
		},
	}

	const set_km_reboot_mode: CompanionActionDefinition<ActionsSchema['set_km_reboot_mode']['options']> | undefined =
		isQuadBypass
			? {
					name: 'Set K/M Mode (persists after reboot)',
					options: [
						{
							id: 'mode',
							type: 'dropdown',
							label: 'Mode',
							default: 0,
							choices: [
								{ id: 0, label: 'Host' },
								{ id: 1, label: 'Window 1 Remote' },
								{ id: 2, label: 'Window 2 Remote' },
								{ id: 3, label: 'Window 3 Remote' },
								{ id: 4, label: 'Window 4 Remote' },
							],
						},
					],
					callback: async (event) => {
						if (!(self.adapter instanceof Sequoia4K60LAdapter)) return
						try {
							await self.adapter.setKmRebootMode(event.options.mode)
						} catch (error) {
							self.log('error', `Set K/M Mode failed: ${(error as Error).message}`)
						}
					},
				}
			: undefined

	// Table 1.3.4.6 / 1.3.5.3 for the 4K60L, and Table 1.3.1.13 for the 4K60 - one request shape, so
	// one base-class method. Registered for exactly the three modes the guide names: the 4K60's
	// Seamless Switching and the 4K60L's Single-View Seamless are listed nowhere and stay excluded.
	const set_km_control: CompanionActionDefinition<ActionsSchema['set_km_control']['options']> | undefined =
		isQuadBypass || isDaisyChain || isQuadWorkstation
			? {
					name: 'Set K/M Control (live)',
					options: [
						{
							id: 'winid',
							type: 'number',
							label: 'Window ID',
							default: 0,
							min: 0,
							max: isDaisyChain ? 16 : 4,
							tooltip: '0 = Host mode; 1-N = that windows Remote mode.',
						},
					],
					callback: async (event) => {
						try {
							await self.adapter.setKmControl(event.options.winid)
						} catch (error) {
							self.log('error', `Set K/M Control failed: ${(error as Error).message}`)
						}
					},
				}
			: undefined

	// Tables 1.3.4.9/1.3.4.10 and section 1.3.5 for the 4K60L, and Table 1.3.1.4 for both machines -
	// one request shape, so one base-class method, and every mode gets the action.
	//
	// Only the port range varies, and it follows the mode rather than the model: quad-bypass and
	// daisy-chain drive port 1 alone (no dropdown - the field would have one entry), single-view
	// seamless drives 1-4, and the 4K60 drives 1-5 per 1.3.1.4's "port 5 is only available for
	// Sequoia 4K60".
	const resolutionOptions: SomeCompanionActionInputField<'port' | 'mode'>[] = []
	if (isSingleView || is4k60) {
		resolutionOptions.push({
			id: 'port',
			type: 'dropdown',
			label: 'Output Port',
			default: 1,
			choices: HDMI_OUT_CHOICES(self.adapter.capabilities.maxPorts),
		})
	}
	resolutionOptions.push({
		id: 'mode',
		type: 'dropdown',
		label: 'Resolution',
		default: RESOLUTION_MODES[0].mode,
		choices: RESOLUTION_CHOICES,
	})

	const set_output_resolution: CompanionActionDefinition<ActionsSchema['set_output_resolution']['options']> = {
		name: 'Set Output Resolution',
		options: resolutionOptions,
		callback: async (event) => {
			const port = event.options.port ?? 1
			try {
				await self.adapter.setOutputResolution(port, event.options.mode)
			} catch (error) {
				self.log('error', `Set Output Resolution failed: ${(error as Error).message}`)
			}
		},
	}

	const set_label: CompanionActionDefinition<ActionsSchema['set_label']['options']> | undefined = isDaisyChain
		? {
				name: 'Set Port Label',
				options: [
					{ id: 'port', type: 'number', label: 'Port', default: 1, min: 1, max: 16 },
					{ id: 'label', type: 'textinput', label: 'Label', default: '', tooltip: LABEL_CHARSET_TOOLTIP },
				],
				callback: async (event) => {
					if (!(self.adapter instanceof Sequoia4K60LAdapter)) return
					try {
						await self.adapter.setLabel(event.options.port, event.options.label)
					} catch (error) {
						self.log('error', `Set Port Label failed: ${(error as Error).message}`)
					}
				},
			}
		: undefined

	// --- Section 1.3.2, Commands for Controlling Window ---------------------------------------
	// Documented for both models with one request shape, so these are plain `self.adapter` calls
	// with no `instanceof` narrowing. Section 1.3.5 lists none of them, and hardware agrees: on a
	// daisy-chained 4K60L almost every one returns `Success` and does nothing (2026-07-29), while
	// the same seven work correctly on the same model in quad-bypass (2026-08-19). So the
	// restriction is specific to daisy chain rather than a general doubt about 1.3.2, and they are
	// left unregistered there.
	const supportsWindowCommands = !isDaisyChain

	const get_window_geometry: CompanionActionDefinition<ActionsSchema['get_window_geometry']['options']> | undefined =
		supportsWindowCommands
			? {
					name: 'Refresh Window Position/Size',
					options: [],
					callback: async () => {
						try {
							const result = await self.adapter.getWindowGeometry()
							self.log('info', `Window position/size: ${JSON.stringify(result)}`)
						} catch (error) {
							self.log('error', `Refresh Window Position/Size failed: ${(error as Error).message}`)
						}
					},
				}
			: undefined

	const set_window_geometry: CompanionActionDefinition<ActionsSchema['set_window_geometry']['options']> | undefined =
		supportsWindowCommands
			? {
					name: 'Set Window Position/Size (all four windows)',
					options: GetWindowGeometryOptions(),
					callback: async (event) => {
						try {
							await self.adapter.setWindowGeometry(
								collectWindowGeometry(event.options),
								parseGeometryResolution(event.options.resolution),
							)
						} catch (error) {
							self.log('error', `Set Window Position/Size failed: ${(error as Error).message}`)
						}
					},
				}
			: undefined

	const get_window_labels: CompanionActionDefinition<ActionsSchema['get_window_labels']['options']> | undefined =
		supportsWindowCommands
			? {
					name: 'Refresh Window Labels',
					options: [],
					callback: async () => {
						try {
							const result = await self.adapter.getWindowLabels()
							self.log('info', `Window labels: ${JSON.stringify(result)}`)
						} catch (error) {
							self.log('error', `Refresh Window Labels failed: ${(error as Error).message}`)
						}
					},
				}
			: undefined

	const set_window_label: CompanionActionDefinition<ActionsSchema['set_window_label']['options']> | undefined =
		supportsWindowCommands
			? {
					name: 'Set Window Label',
					options: [
						{ id: 'port', type: 'dropdown', label: 'Input Port', default: 1, choices: WINDOW_ID_CHOICES },
						{ id: 'label', type: 'textinput', label: 'Label', default: '', tooltip: LABEL_CHARSET_TOOLTIP },
					],
					callback: async (event) => {
						try {
							await self.adapter.setWindowLabel(event.options.port, event.options.label)
						} catch (error) {
							self.log('error', `Set Window Label failed: ${(error as Error).message}`)
						}
					},
				}
			: undefined

	const set_window_show: CompanionActionDefinition<ActionsSchema['set_window_show']['options']> | undefined =
		supportsWindowCommands
			? {
					name: 'Set Window Show/Hide',
					options: [
						{ id: 'winid', type: 'dropdown', label: 'Window', default: 1, choices: WINDOW_ID_CHOICES },
						{ id: 'show', type: 'dropdown', label: 'Visibility', default: 1, choices: SHOW_CHOICES },
					],
					callback: async (event) => {
						try {
							await self.adapter.setWindowShow(event.options.winid, event.options.show)
						} catch (error) {
							self.log('error', `Set Window Show/Hide failed: ${(error as Error).message}`)
						}
					},
				}
			: undefined

	const set_window_aspect: CompanionActionDefinition<ActionsSchema['set_window_aspect']['options']> | undefined =
		supportsWindowCommands
			? {
					name: 'Set Window Aspect Ratio',
					options: [
						{ id: 'winid', type: 'dropdown', label: 'Window', default: 1, choices: WINDOW_ID_CHOICES },
						{ id: 'aspect', type: 'dropdown', label: 'Aspect Ratio', default: 1, choices: ASPECT_CHOICES },
					],
					callback: async (event) => {
						try {
							await self.adapter.setWindowAspect(event.options.winid, event.options.aspect)
						} catch (error) {
							self.log('error', `Set Window Aspect Ratio failed: ${(error as Error).message}`)
						}
					},
				}
			: undefined

	const set_fullscreen: CompanionActionDefinition<ActionsSchema['set_fullscreen']['options']> | undefined =
		supportsWindowCommands
			? {
					name: 'Set Fullscreen Mode',
					options: [
						{ id: 'full', type: 'dropdown', label: 'Fullscreen Target', default: 0, choices: FULLSCREEN_CHOICES },
					],
					callback: async (event) => {
						try {
							await self.adapter.setFullscreen(event.options.full)
						} catch (error) {
							self.log('error', `Set Fullscreen Mode failed: ${(error as Error).message}`)
						}
					},
				}
			: undefined

	// --- Section 1.3.1, Commands for Controlling System ---------------------------------------
	// Documented for both models with one request shape, so these are plain `self.adapter` calls
	// with no `instanceof` narrowing. Section 1.3.5 names only four commands for a daisy-chained
	// unit - Label Text, Audio, K/M Control and Output Resolution - so, on the same closed-list
	// reasoning that keeps section 1.3.2 out of daisy-chain mode, the rest are left unregistered
	// there. The two exceptions are `set_km_control` and `set_output_resolution` above, which
	// section 1.3.5 does list and which therefore keep their own gating.
	//
	// None of these have been bench-tested against hardware. Section 1.3.2's daisy-chain findings
	// are a warning about what that means: a command can answer "Success" and do nothing at all.
	const supportsSystemCommands = !isDaisyChain

	const get_firmware_version: CompanionActionDefinition<ActionsSchema['get_firmware_version']['options']> | undefined =
		supportsSystemCommands
			? {
					name: 'Refresh Firmware Version',
					options: [],
					callback: async () => {
						try {
							const result = await self.adapter.getFirmwareVersion()
							self.log('info', `Firmware version: ${JSON.stringify(result)}`)
						} catch (error) {
							self.log('error', `Refresh Firmware Version failed: ${(error as Error).message}`)
						}
					},
				}
			: undefined

	const get_signal_type: CompanionActionDefinition<ActionsSchema['get_signal_type']['options']> | undefined =
		supportsSystemCommands
			? {
					name: 'Refresh Input Signal Status',
					description:
						'Updates the input signal variables and feedbacks immediately. Only needed if the poll interval is long or polling is disabled.',
					options: [],
					callback: async () => {
						try {
							const signals = await self.refreshSignalState()
							self.log('info', `Input signal status: ${signals.map(formatSignal).join(' | ')}`)
						} catch (error) {
							self.log('error', `Refresh Input Signal Status failed: ${(error as Error).message}`)
						}
					},
				}
			: undefined

	const get_network_info: CompanionActionDefinition<ActionsSchema['get_network_info']['options']> | undefined =
		supportsSystemCommands
			? {
					name: 'Refresh Network Info',
					options: [],
					callback: async () => {
						try {
							const result = await self.adapter.getNetworkInfo()
							self.log('info', `Network info: ${JSON.stringify(result)}`)
						} catch (error) {
							self.log('error', `Refresh Network Info failed: ${(error as Error).message}`)
						}
					},
				}
			: undefined

	const load_default_layout: CompanionActionDefinition<ActionsSchema['load_default_layout']['options']> | undefined =
		supportsSystemCommands
			? {
					name: 'Load Default Layout',
					options: [{ id: 'layout', type: 'dropdown', label: 'Layout', default: 1, choices: DEFAULT_LAYOUT_CHOICES }],
					callback: async (event) => {
						try {
							await self.adapter.loadDefaultLayout(event.options.layout)
						} catch (error) {
							self.log('error', `Load Default Layout failed: ${(error as Error).message}`)
						}
					},
				}
			: undefined

	const load_user_icon_preset:
		CompanionActionDefinition<ActionsSchema['load_user_icon_preset']['options']> | undefined = supportsSystemCommands
		? {
				name: 'Load User Icon Preset',
				options: [
					{
						id: 'preset',
						type: 'dropdown',
						label: 'Preset',
						default: 1,
						choices: USER_ICON_PRESET_CHOICES,
						tooltip: 'The five presets shown in the web GUI under Layout & Routing > Multiview Layout.',
					},
				],
				callback: async (event) => {
					try {
						await self.adapter.loadPreset(event.options.preset)
					} catch (error) {
						self.log('error', `Load User Icon Preset failed: ${(error as Error).message}`)
					}
				},
			}
		: undefined

	const load_latest_preset: CompanionActionDefinition<ActionsSchema['load_latest_preset']['options']> | undefined =
		supportsSystemCommands
			? {
					name: 'Load Latest Saved Layout',
					options: [],
					callback: async () => {
						try {
							await self.adapter.loadLatestPreset()
						} catch (error) {
							self.log('error', `Load Latest Saved Layout failed: ${(error as Error).message}`)
						}
					},
				}
			: undefined

	const load_custom_preset: CompanionActionDefinition<ActionsSchema['load_custom_preset']['options']> | undefined =
		supportsSystemCommands
			? {
					name: 'Load Custom Preset',
					options: [
						{
							id: 'name',
							type: 'textinput',
							label: 'Preset Filename',
							default: '',
							tooltip: PRESET_NAME_TOOLTIP,
						},
					],
					callback: async (event) => {
						try {
							await self.adapter.loadCustomPreset(event.options.name)
						} catch (error) {
							self.log('error', `Load Custom Preset failed: ${(error as Error).message}`)
						}
					},
				}
			: undefined

	const list_custom_presets: CompanionActionDefinition<ActionsSchema['list_custom_presets']['options']> | undefined =
		supportsSystemCommands
			? {
					name: 'Refresh Custom Preset List',
					options: [],
					callback: async () => {
						try {
							const result = await self.adapter.listCustomPresets()
							self.log('info', `Custom presets: ${JSON.stringify(result)}`)
						} catch (error) {
							self.log('error', `Refresh Custom Preset List failed: ${(error as Error).message}`)
						}
					},
				}
			: undefined

	const delete_custom_preset: CompanionActionDefinition<ActionsSchema['delete_custom_preset']['options']> | undefined =
		supportsSystemCommands
			? {
					name: 'Delete Custom Preset (cannot be undone)',
					options: [
						{
							id: 'name',
							type: 'textinput',
							label: 'Preset Filename',
							default: '',
							tooltip: `Permanently deletes this preset from the device. ${PRESET_NAME_TOOLTIP}`,
						},
					],
					callback: async (event) => {
						try {
							await self.adapter.deleteCustomPreset(event.options.name)
						} catch (error) {
							self.log('error', `Delete Custom Preset failed: ${(error as Error).message}`)
						}
					},
				}
			: undefined

	// Destructive, but not instant - the reset lands on the next reboot (measured, see
	// `resetFactoryDefaults`). The name and static-text field carry the warning the wire protocol
	// does not, and describe the actual timing rather than overstating it.
	const reset_factory_defaults:
		CompanionActionDefinition<ActionsSchema['reset_factory_defaults']['options']> | undefined = supportsSystemCommands
		? {
				name: 'Reset to Factory Defaults (erases all saved presets)',
				options: [
					{
						id: 'warning',
						type: 'static-text',
						label: 'Warning',
						value:
							'Resets the device to its factory state and erases every custom preset stored in its flash memory. There is no confirmation prompt. The reset applies on the next reboot, not on the button press, so the unit keeps running normally in the meantime - but once it is power-cycled the presets are gone. Back them up externally.',
					},
				],
				callback: async () => {
					try {
						await self.adapter.resetFactoryDefaults()
					} catch (error) {
						self.log('error', `Reset to Factory Defaults failed: ${(error as Error).message}`)
					}
				},
			}
		: undefined

	const set_fading_level: CompanionActionDefinition<ActionsSchema['set_fading_level']['options']> | undefined =
		supportsSystemCommands
			? {
					name: 'Set Fullscreen Fade Speed',
					options: [
						{
							id: 'fading_time',
							type: 'number',
							label: 'Fade Speed',
							default: 0,
							min: 0,
							max: 255,
							tooltip:
								'0 turns fading off (hard cut), then 1 (fastest) to 255 (slowest). Applies only when switching source in fullscreen mode.',
						},
					],
					callback: async (event) => {
						try {
							await self.adapter.setFadingLevel(event.options.fading_time)
						} catch (error) {
							self.log('error', `Set Fullscreen Fade Speed failed: ${(error as Error).message}`)
						}
					},
				}
			: undefined

	const get_osd_info: CompanionActionDefinition<ActionsSchema['get_osd_info']['options']> | undefined =
		supportsSystemCommands
			? {
					name: 'Refresh OSD Info',
					options: [],
					callback: async () => {
						try {
							const result = await self.adapter.getOsdInfo()
							self.log('info', `OSD info: ${JSON.stringify(result)}`)
						} catch (error) {
							self.log('error', `Refresh OSD Info failed: ${(error as Error).message}`)
						}
					},
				}
			: undefined

	const set_osd_enabled: CompanionActionDefinition<ActionsSchema['set_osd_enabled']['options']> | undefined =
		supportsSystemCommands
			? {
					name: 'Set OSD Show/Hide (all OSD elements)',
					options: [
						{
							id: 'enabled',
							type: 'dropdown',
							label: 'OSD',
							default: 1,
							choices: OSD_ENABLED_CHOICES,
							tooltip: 'Master switch for labels, borders and audio tally together.',
						},
					],
					callback: async (event) => {
						try {
							await self.adapter.setOsdEnabled(event.options.enabled)
						} catch (error) {
							self.log('error', `Set OSD Show/Hide failed: ${(error as Error).message}`)
						}
					},
				}
			: undefined

	// Tables 1.3.1.16-1.3.1.21 are all `setOsd` with a different subset of keys. Each action below
	// writes only its own keys, so pressing one never disturbs settings owned by another.
	const set_window_border: CompanionActionDefinition<ActionsSchema['set_window_border']['options']> | undefined =
		supportsSystemCommands
			? {
					name: 'Set Window Border',
					options: [
						{
							id: 'border_width',
							type: 'dropdown',
							label: 'Border Width',
							default: 2,
							choices: BORDER_WIDTH_CHOICES,
						},
						{
							id: 'border_color',
							type: 'colorpicker',
							label: 'Border Colour',
							default: '#ffffff',
							returnType: 'string',
						},
					],
					callback: async (event) => {
						try {
							await self.adapter.setOsd({
								border_width: event.options.border_width,
								border_color: toFixedColor(event.options.border_color),
							})
						} catch (error) {
							self.log('error', `Set Window Border failed: ${(error as Error).message}`)
						}
					},
				}
			: undefined

	const set_window_label_color:
		CompanionActionDefinition<ActionsSchema['set_window_label_color']['options']> | undefined = supportsSystemCommands
		? {
				name: 'Set Window Label Colour',
				options: [
					{
						id: 'label_font_color',
						type: 'colorpicker',
						label: 'Label Font Colour',
						default: 'rgba(255, 255, 255, 1)',
						enableAlpha: true,
						returnType: 'string',
						tooltip: 'The alpha slider sets the label transparency level the device stores alongside the colour.',
					},
					{
						id: 'label_back_color',
						type: 'colorpicker',
						label: 'Label Background Colour',
						default: 'rgba(0, 0, 0, 1)',
						enableAlpha: true,
						returnType: 'string',
						tooltip: 'The alpha slider sets the label transparency level the device stores alongside the colour.',
					},
					{
						id: 'label_overlay',
						type: 'dropdown',
						label: 'Label Position',
						default: 0,
						choices: LABEL_OVERLAY_CHOICES,
					},
				],
				callback: async (event) => {
					try {
						await self.adapter.setOsd({
							label_font_color: toTransparencyColor(event.options.label_font_color),
							label_back_color: toTransparencyColor(event.options.label_back_color),
							label_overlay: event.options.label_overlay,
						})
					} catch (error) {
						self.log('error', `Set Window Label Colour failed: ${(error as Error).message}`)
					}
				},
			}
		: undefined

	// Not a table of its own: these are the remaining label keys of Table 1.3.1.16, grouped here
	// because they are the visibility half of the label settings and the colour action owns the rest.
	const set_osd_label_display:
		CompanionActionDefinition<ActionsSchema['set_osd_label_display']['options']> | undefined = supportsSystemCommands
		? {
				name: 'Set Window Label Display',
				options: [
					{ id: 'show_label', type: 'dropdown', label: 'Labels', default: 1, choices: SHOW_LABEL_CHOICES },
					{
						id: 'auto_hide_label',
						type: 'dropdown',
						label: 'Auto-hide',
						default: 0,
						choices: AUTO_HIDE_LABEL_CHOICES,
						tooltip: 'Only has an effect while Labels is set to Show.',
					},
					{
						id: 'label_text_transparency',
						type: 'dropdown',
						label: 'Label Text Transparency',
						default: 0,
						choices: LABEL_TEXT_TRANSPARENCY_CHOICES,
					},
				],
				callback: async (event) => {
					try {
						await self.adapter.setOsd({
							show_label: event.options.show_label,
							auto_hide_label: event.options.auto_hide_label,
							label_text_transparency: event.options.label_text_transparency,
						})
					} catch (error) {
						self.log('error', `Set Window Label Display failed: ${(error as Error).message}`)
					}
				},
			}
		: undefined

	const set_audio_tally_color:
		CompanionActionDefinition<ActionsSchema['set_audio_tally_color']['options']> | undefined = supportsSystemCommands
		? {
				name: 'Set Audio Tally Colour',
				options: [
					{
						id: 'tally1_on_color',
						type: 'colorpicker',
						label: 'Tally On Colour',
						default: '#00ff00',
						returnType: 'string',
					},
					{
						id: 'tally1_off_color',
						type: 'colorpicker',
						label: 'Tally Off Colour',
						default: '#404040',
						returnType: 'string',
					},
				],
				callback: async (event) => {
					try {
						await self.adapter.setOsd({
							tally1_on_color: toFixedColor(event.options.tally1_on_color),
							tally1_off_color: toFixedColor(event.options.tally1_off_color),
						})
					} catch (error) {
						self.log('error', `Set Audio Tally Colour failed: ${(error as Error).message}`)
					}
				},
			}
		: undefined

	const set_audio_tally_show: CompanionActionDefinition<ActionsSchema['set_audio_tally_show']['options']> | undefined =
		supportsSystemCommands
			? {
					name: 'Set Audio Tally Show/Hide',
					options: [
						{
							id: 'show_tally1',
							type: 'dropdown',
							label: 'Audio Tally',
							default: 1,
							choices: SHOW_TALLY_CHOICES,
							tooltip: 'Only visible while the OSD as a whole is shown.',
						},
					],
					callback: async (event) => {
						try {
							await self.adapter.setOsd({ show_tally1: event.options.show_tally1 })
						} catch (error) {
							self.log('error', `Set Audio Tally Show/Hide failed: ${(error as Error).message}`)
						}
					},
				}
			: undefined

	// Also not a table of its own - the last three keys of Table 1.3.1.16, which no task-shaped
	// table in the guide covers.
	const set_popup_menu_colors:
		CompanionActionDefinition<ActionsSchema['set_popup_menu_colors']['options']> | undefined = supportsSystemCommands
		? {
				name: 'Set Popup Menu Colours',
				options: [
					{
						id: 'popupmenu_active_color',
						type: 'colorpicker',
						label: 'Active Item',
						default: '#ffffff',
						returnType: 'string',
					},
					{
						id: 'popupmenu_available_color',
						type: 'colorpicker',
						label: 'Available Item',
						default: '#c0c0c0',
						returnType: 'string',
					},
					{
						id: 'popupmenu_disable_color',
						type: 'colorpicker',
						label: 'Disabled Item',
						default: '#606060',
						returnType: 'string',
					},
				],
				callback: async (event) => {
					try {
						await self.adapter.setOsd({
							popupmenu_active_color: toFixedColor(event.options.popupmenu_active_color),
							popupmenu_available_color: toFixedColor(event.options.popupmenu_available_color),
							popupmenu_disable_color: toFixedColor(event.options.popupmenu_disable_color),
						})
					} catch (error) {
						self.log('error', `Set Popup Menu Colours failed: ${(error as Error).message}`)
					}
				},
			}
		: undefined

	const set_active_border: CompanionActionDefinition<ActionsSchema['set_active_border']['options']> | undefined =
		supportsSystemCommands
			? {
					name: 'Set Active Window Border Show/Hide',
					options: [
						{
							id: 'active_border',
							type: 'dropdown',
							label: 'Active Window Border',
							default: 1,
							choices: ACTIVE_BORDER_CHOICES,
						},
					],
					callback: async (event) => {
						try {
							await self.adapter.setOsd({ active_border: event.options.active_border })
						} catch (error) {
							self.log('error', `Set Active Window Border failed: ${(error as Error).message}`)
						}
					},
				}
			: undefined

	const set_alert_display: CompanionActionDefinition<ActionsSchema['set_alert_display']['options']> | undefined =
		supportsSystemCommands
			? {
					name: 'Set Alert Display',
					options: [
						{
							id: 'mode',
							type: 'dropdown',
							label: 'Fan / Temperature Alerts',
							default: 1,
							choices: ALERT_DISPLAY_CHOICES,
						},
					],
					callback: async (event) => {
						try {
							await self.adapter.setAlertDisplay(event.options.mode)
						} catch (error) {
							self.log('error', `Set Alert Display failed: ${(error as Error).message}`)
						}
					},
				}
			: undefined

	const set_power_saving: CompanionActionDefinition<ActionsSchema['set_power_saving']['options']> | undefined =
		supportsSystemCommands
			? {
					name: 'Set Monitor Power Saving',
					options: [
						{
							id: 'port',
							type: 'dropdown',
							label: 'Monitor',
							default: 0,
							choices: PowerSavingPortChoices(self.adapter.capabilities.maxPorts),
						},
						{
							id: 'enable',
							type: 'dropdown',
							label: 'Power Saving',
							default: 1,
							choices: POWER_SAVING_CHOICES,
						},
					],
					callback: async (event) => {
						try {
							await self.adapter.setPowerSavingMode(event.options.port, event.options.enable)
						} catch (error) {
							self.log('error', `Set Monitor Power Saving failed: ${(error as Error).message}`)
						}
					},
				}
			: undefined

	const set_km_idle_detection:
		CompanionActionDefinition<ActionsSchema['set_km_idle_detection']['options']> | undefined = supportsSystemCommands
		? {
				name: 'Set Keyboard/Mouse Idle Lock',
				options: [
					{
						id: 'idle_time',
						type: 'number',
						label: 'Idle Time (seconds)',
						default: 120,
						min: 0,
						max: 65535,
						tooltip:
							'Seconds of keyboard/mouse inactivity before the device locks them. The reference guide documents no range for this value; seconds is taken from its only example (120 = "2 minutes"), and the bounds here are this module\'s, not the vendor\'s.',
					},
				],
				callback: async (event) => {
					try {
						await self.adapter.setKmIdleDetection(event.options.idle_time)
					} catch (error) {
						self.log('error', `Set Keyboard/Mouse Idle Lock failed: ${(error as Error).message}`)
					}
				},
			}
		: undefined

	const set_mouse: CompanionActionDefinition<ActionsSchema['set_mouse']['options']> | undefined = supportsSystemCommands
		? {
				name: 'Set Mouse',
				options: [
					{ id: 'mode', type: 'dropdown', label: 'Button Handedness', default: 'right', choices: MOUSE_MODE_CHOICES },
					{
						id: 'speed',
						type: 'number',
						label: 'Pointer Speed',
						default: 7,
						min: 0,
						max: 14,
						tooltip: '0 = slowest, 14 = fastest.',
					},
				],
				callback: async (event) => {
					try {
						await self.adapter.setMouse(event.options.mode, event.options.speed)
					} catch (error) {
						self.log('error', `Set Mouse failed: ${(error as Error).message}`)
					}
				},
			}
		: undefined

	self.setActionDefinitions({
		set_routing,
		get_routing,
		set_audio,
		set_km_reboot_mode,
		set_km_control,
		set_output_resolution,
		set_label,
		get_window_geometry,
		set_window_geometry,
		get_window_labels,
		set_window_label,
		set_window_show,
		set_window_aspect,
		set_fullscreen,
		get_firmware_version,
		get_signal_type,
		get_network_info,
		load_default_layout,
		load_user_icon_preset,
		load_latest_preset,
		load_custom_preset,
		list_custom_presets,
		delete_custom_preset,
		reset_factory_defaults,
		set_fading_level,
		get_osd_info,
		set_osd_enabled,
		set_window_border,
		set_window_label_color,
		set_osd_label_display,
		set_audio_tally_color,
		set_audio_tally_show,
		set_popup_menu_colors,
		set_active_border,
		set_alert_display,
		set_power_saving,
		set_km_idle_detection,
		set_mouse,
	})
}
