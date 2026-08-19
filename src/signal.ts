import type { DropdownChoice } from '@companion-module/base'
import type { AvitechResponse } from './avitech-api.js'

/**
 * Parsing for "Signal Type - Get" (Table 1.3.1.2), the one section 1.3.1 read that reports live
 * per-input state and is therefore worth driving variables and feedbacks from.
 *
 * The guide documents this command's response only as a screenshot (Figure 1.3.1.2). Both that
 * screenshot and a capture from a real 4K60L (2026-08-12, see below) were used to write this;
 * everything asserted here comes from one of the two, not from the prose.
 *
 * `clock` and `start` are read but deliberately not surfaced. `clock` is a *measured* pixel clock
 * in units of 0.1MHz (4400 x 2250 x 60 = 594.0MHz reads as 5940), and it jitters: the capture below
 * shows two inputs carrying an identical format reading 5939 and 5940. Polling that into a variable
 * would redraw buttons on measurement noise. `start` is the active-area offset and is of no use on
 * a button.
 */

/**
 * The device reports four inputs regardless of model.
 *
 * Deliberately not derived from `SequoiaCapabilities.maxPorts`: that counts HDMI *outputs* (5 on
 * the 4K60, 4 on the 4K60L), which is a different axis. Both machines take four sources.
 */
export const INPUT_IDS = [1, 2, 3, 4] as const

export type InputId = (typeof INPUT_IDS)[number]

export const INPUT_CHOICES: DropdownChoice[] = INPUT_IDS.map((id) => ({ id, label: `Input ${id}` }))

/** `freq` is expressed in hundredths of a Hz - 6000 is 60.00Hz, 5994 is 59.94Hz, 2997 is 29.97Hz. */
const FREQ_PER_HZ = 100

/** Shown for an input the device reports no signal on. */
export const NO_SIGNAL_LABEL = 'No signal'

/**
 * Shown when the device says a signal is present but does not report usable dimensions for it.
 * Not observed on hardware - `active` has always accompanied a non-zero `signal` - but the two
 * facts arrive as separate keys, so they are handled as separate facts.
 */
export const UNKNOWN_FORMAT_LABEL = 'Signal present'

/** One input's entry in the response, normalised. */
export interface InputSignal {
	input: InputId
	/**
	 * Whether the device is locked to a source on this input.
	 *
	 * Derived as `signal !== 0`. Table 1.3.1.2's prose claims `signal` is `0(video absent) /
	 * 1(video feed)`, and that is wrong: the guide's own Figure 1.3.1.2 shows 3 and 5, and a 4K60L
	 * returned 19. It is not a resolution code either - the figure's 3 and the captured 19 are both
	 * 3840x2160 at 60Hz and differ only in blanking (`total` 4000x2222 vs 4400x2250) - nor does it
	 * share a namespace with `RESOLUTION_MODES`, where 3840x2160 60Hz is 99. So it is treated as
	 * opaque, and the human-readable format is built from `active` and `freq`, which describe
	 * themselves. Only "is it zero" is relied on.
	 */
	present: boolean
	/** `active[0]`, the horizontal active pixel count. 0 when no signal. */
	width: number
	/** `active[1]`, the vertical active pixel count. 0 when no signal. */
	height: number
	/** `freq` converted to Hz (59.94, 60, ...). 0 when no signal. */
	refresh: number
}

/** An input the device reported nothing for, and the state every input starts in before a poll. */
export function absentSignal(input: InputId): InputSignal {
	return { input, present: false, width: 0, height: 0, refresh: 0 }
}

export function emptySignals(): InputSignal[] {
	return INPUT_IDS.map(absentSignal)
}

/**
 * Normalises a "Signal Type - Get" response into exactly one entry per input, in `INPUT_IDS` order.
 *
 * Anything unexpected degrades to "absent" rather than throwing: this is polled on a timer, so a
 * malformed reply should leave the buttons reading "No signal", not tear down the poll loop.
 *
 * The important shape detail is that **an input with no signal carries only `input` and `signal`** -
 * `clock`, `total`, `active`, `start` and `freq` are all absent, as in this 4K60L capture:
 *
 * ```json
 * [{"input":1,"signal":19,"clock":5939,"total":[4400,2250],"active":[3840,2160],"start":[384,82],"freq":6000},
 *  {"input":2,"signal":0}, ... ]
 * ```
 *
 * Figure 1.3.1.2 has all four inputs live and so never shows that case, which is why nothing here
 * assumes a key is present because a sibling key is.
 */
export function parseSignalResponse(response: AvitechResponse): InputSignal[] {
	const entries = Array.isArray(response) ? response : []

	return INPUT_IDS.map((id) => {
		const entry = entries.find(
			(candidate): candidate is Record<string, unknown> =>
				candidate !== null && typeof candidate === 'object' && (candidate as Record<string, unknown>).input === id,
		)

		if (!entry || toNumber(entry.signal) === 0) {
			return absentSignal(id)
		}

		const active = Array.isArray(entry.active) ? entry.active : []

		return {
			input: id,
			present: true,
			width: toNumber(active[0]),
			height: toNumber(active[1]),
			refresh: toRefreshHz(entry.freq),
		}
	})
}

/**
 * A display string for one input: "3840x2160 59.94Hz", or `NO_SIGNAL_LABEL`.
 *
 * No progressive/interlaced suffix, because nothing in the response distinguishes the two -
 * `total` and `active` alone cannot, so "1920x1080p60" would be an assertion the device never made.
 */
export function formatSignal(signal: InputSignal): string {
	if (!signal.present) {
		return NO_SIGNAL_LABEL
	}

	if (!signal.width || !signal.height) {
		return UNKNOWN_FORMAT_LABEL
	}

	return `${signal.width}x${signal.height} ${signal.refresh}Hz`
}

function toRefreshHz(value: unknown): number {
	// Two decimals is exactly the precision the wire format carries, and rounding here keeps 59.94
	// from arriving as 59.940000000000005.
	return Number((toNumber(value) / FREQ_PER_HZ).toFixed(2))
}

function toNumber(value: unknown): number {
	return typeof value === 'number' && Number.isFinite(value) ? value : 0
}
