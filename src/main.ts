import { InstanceBase, InstanceStatus, type SomeCompanionConfigField } from '@companion-module/base'
import { GetConfigFields, POLL_INTERVAL_DEFAULT, POLL_INTERVAL_DISABLED, type ModuleConfig } from './config.js'
import { SignalVariableValues, UpdateVariableDefinitions, type VariablesSchema } from './variables.js'
import { UpgradeScripts } from './upgrades.js'
import { UpdateActions, type ActionsSchema } from './actions.js'
import { SIGNAL_FEEDBACK_ID, UpdateFeedbacks, type FeedbacksSchema } from './feedbacks.js'
import { UpdatePresets } from './presets.js'
import { AvitechHttpApi } from './avitech-api.js'
import { createAdapter, type SequoiaAdapter } from './adapters/index.js'
import { emptySignals, parseSignalResponse, type InputSignal } from './signal.js'
import { parseCustomPresetList } from './system.js'

export type ModuleSchema = {
	config: ModuleConfig
	secrets: undefined
	actions: ActionsSchema
	feedbacks: FeedbacksSchema
	variables: VariablesSchema
}

export { UpgradeScripts }

export default class ModuleInstance extends InstanceBase<ModuleSchema> {
	config!: ModuleConfig // Setup in init()
	api!: AvitechHttpApi // Setup in init()
	adapter!: SequoiaAdapter // Setup in init()

	/** Latest parsed "Signal Type - Get" state, one entry per input. Refreshed by `pollSignal()`. */
	private signals: InputSignal[] = emptySignals()
	private pollTimer: NodeJS.Timeout | undefined
	/** Guards against a slow request overlapping the next tick when the interval is short. */
	private pollInFlight = false
	/** Set once a poll has failed, so a device going away logs once instead of every interval. */
	private pollFailing = false

	/**
	 * Custom preset filenames from the device (Table 1.3.1.8), newest first, feeding the Load and
	 * Delete pickers in `actions.ts`.
	 *
	 * Unlike the signal state this is *not* polled. Presets only change when someone saves or
	 * deletes one, so it is read at init and on demand via the "Refresh Custom Preset List" action.
	 * Empty is a legitimate value - a unit with nothing saved returns `[]` - so it is not a
	 * "not loaded yet" marker, which is why both pickers stay usable when it is empty.
	 */
	customPresets: string[] = []

	constructor(internal: unknown) {
		super(internal)
	}

	async init(config: ModuleConfig): Promise<void> {
		this.config = config
		this.api = new AvitechHttpApi(this)
		this.adapter = createAdapter(this.config.mode, this, this.api)

		this.updateActions() // export actions
		this.updateFeedbacks() // export feedbacks
		this.updatePresets() // export Presets
		this.updateVariableDefinitions() // export variable definitions
		this.publishSignalState() // seed the variables so they read "No signal" rather than being undefined

		await this.checkConnection()
		await this.refreshCustomPresets()
		this.startPolling()
	}
	// When module gets deleted
	async destroy(): Promise<void> {
		this.stopPolling()
		this.log('debug', 'destroy')
	}

	async configUpdated(config: ModuleConfig): Promise<void> {
		this.stopPolling() // host, interval and mode can all have changed; the loop is rebuilt below
		this.config = config
		this.adapter = createAdapter(this.config.mode, this, this.api)
		this.updateActions() // action list/options depend on the configured mode
		this.updatePresets() // presets reference actions, so they are gated by mode for the same reason

		await this.checkConnection()
		await this.refreshCustomPresets() // a new host is a different unit with different presets
		this.startPolling()
	}

	/**
	 * Reads the custom preset list and rebuilds the actions so the Load and Delete pickers show it.
	 *
	 * Never throws. This runs during `init()`, where an unreachable device must still leave a
	 * working instance - the pickers simply fall back to typed names, which is what they were
	 * before they had a list at all. `checkConnection()` has already reported the connection state,
	 * so a failure here is logged at `debug` rather than raised again as an error.
	 *
	 * Not run in daisy-chain mode: section 1.3.5 does not list this command, and `actions.ts` does
	 * not register the preset actions there, so there is nothing to populate.
	 */
	async refreshCustomPresets(): Promise<void> {
		if (!this.config.host || this.config.mode === 'sequoia-4k60l-daisy-chain') {
			return
		}

		try {
			this.customPresets = parseCustomPresetList(await this.adapter.listCustomPresets())
			this.updateActions() // the pickers' choices are baked in at definition time
		} catch (error) {
			this.log('debug', `Could not read the custom preset list: ${(error as Error).message}`)
		}
	}

	/** Latest known state for one input, or undefined if `input` is not one of the four. */
	getInputSignal(input: number): InputSignal | undefined {
		return this.signals.find((signal) => signal.input === input)
	}

	/**
	 * Reads "Signal Type - Get" once and republishes the variables and feedbacks from it. Throws if
	 * the request fails - the poll loop and the "Refresh Input Signal Status" action each handle
	 * that in their own way.
	 */
	async refreshSignalState(): Promise<InputSignal[]> {
		this.signals = parseSignalResponse(await this.adapter.getSignalType())
		this.publishSignalState()

		return this.signals
	}

	/**
	 * Starts the "Signal Type - Get" poll loop, unless it is switched off or not applicable.
	 *
	 * Not applicable in daisy-chain mode: section 1.3.5 names the only four commands assumed to work
	 * on a chained unit and this is not one of them, so polling it would be exactly the kind of
	 * request `actions.ts` gates out - and section 1.3.2's bench results are a warning that a
	 * chained unit can answer such a request without the answer meaning anything.
	 */
	private startPolling(): void {
		// Falls back to the field's default rather than to "disabled": an instance saved before
		// `pollInterval` existed has no value for it, and should behave like a freshly created one.
		// A user who genuinely wants polling off stores a real 0, which `??` leaves alone.
		const intervalSeconds = this.config.pollInterval ?? POLL_INTERVAL_DEFAULT

		if (intervalSeconds <= POLL_INTERVAL_DISABLED || !this.config.host) {
			return
		}

		if (this.config.mode === 'sequoia-4k60l-daisy-chain') {
			this.log('debug', 'Signal polling is not run in daisy-chain mode')
			return
		}

		this.pollTimer = setInterval(() => void this.pollSignal(), intervalSeconds * 1000)
		void this.pollSignal() // don't make the first values wait a whole interval
	}

	private stopPolling(): void {
		if (this.pollTimer) {
			clearInterval(this.pollTimer)
			this.pollTimer = undefined
		}

		this.pollInFlight = false
		this.pollFailing = false
	}

	private async pollSignal(): Promise<void> {
		if (this.pollInFlight) {
			return
		}

		this.pollInFlight = true

		try {
			await this.refreshSignalState()

			if (this.pollFailing) {
				this.log('info', 'Input signal polling recovered')
				this.pollFailing = false
			}
		} catch (error) {
			// An unreachable device fails on every tick, so this logs the transition only. The request
			// itself has already moved InstanceStatus to ConnectionFailure.
			if (!this.pollFailing) {
				this.log('warn', `Input signal polling failed: ${(error as Error).message}`)
				this.pollFailing = true
			}
		} finally {
			this.pollInFlight = false
		}
	}

	private publishSignalState(): void {
		this.setVariableValues(SignalVariableValues(this.signals))
		this.checkFeedbacks(SIGNAL_FEEDBACK_ID)
	}

	/** Confirms the device is reachable using the Firmware Version - Get command, and updates connection status. */
	private async checkConnection(): Promise<void> {
		if (!this.config.host) {
			this.updateStatus(InstanceStatus.BadConfig, 'Target IP is not configured')
			return
		}

		this.updateStatus(InstanceStatus.Connecting)

		try {
			await this.api.sendCommand('Info', { func: 'get', type: 'device' })
		} catch (error) {
			this.log('error', `Failed to connect to ${this.config.host}: ${(error as Error).message}`)
		}
	}

	// Return config fields for web config
	getConfigFields(): SomeCompanionConfigField[] {
		return GetConfigFields()
	}

	updateActions(): void {
		UpdateActions(this)
	}

	updateFeedbacks(): void {
		UpdateFeedbacks(this)
	}

	updatePresets(): void {
		UpdatePresets(this)
	}

	updateVariableDefinitions(): void {
		UpdateVariableDefinitions(this)
	}
}
