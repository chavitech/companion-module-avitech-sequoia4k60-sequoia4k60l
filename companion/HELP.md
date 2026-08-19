## Avitech Sequoia 4K60 & 4K60L

Controls the Avitech Sequoia 4K60 and Sequoia 4K60L multiviewers over HTTP. One connection
controls one unit.

## Getting started

Add a connection and fill in four fields:

| Field                      | Notes                                                                             |
| -------------------------- | --------------------------------------------------------------------------------- |
| **Model / Operating Mode** | A single combined choice — see below.                                             |
| **Target IP**              | The unit's address. Factory default is `192.168.0.5`.                             |
| **Target Port**            | `80` unless your unit has been moved off the default.                             |
| **Signal Poll Interval**   | Seconds between input-signal refreshes. Default `2`; set `0` to turn polling off. |

Once connected, the available actions appear in the action list for any button.

## Choosing the model and mode

Model and mode are one dropdown rather than two, because not every mode exists on both machines:

- **Sequoia 4K60** — Quad Multiview + Workstation, or Seamless Switching
- **Sequoia 4K60L** — Quad Multiview + Bypass, Single-View Seamless Switching, or Daisy Chain

**This must match how your unit is physically configured.** A unit's operating mode is set on the
hardware itself; the module cannot read it or change it. Routing, audio, resolution and K/M
commands are sent in a different shape in each mode, so a mismatched setting means buttons quietly
send the wrong command.

Changing this field rebuilds the action list, and buttons using an action that no longer exists in
the new mode will need reassigning.

## Daisy Chain mode is deliberately limited

In **Sequoia 4K60L — Daisy Chain**, only four actions are offered: Label Text, Audio, K/M Control
and Output Resolution. These are the only commands Avitech documents as working on a chained unit.

The restriction is not precautionary. Testing against a real daisy-chained 4K60L found that most
window commands **return `Success` and then do nothing** — the unit reports success for a command
it never carried out, so neither this module nor any other can detect the failure. Rather than
offer buttons that appear to work and don't, the module doesn't offer them.

Input signal polling is also switched off in this mode, so the signal variables and feedback below
will not update. This is why the four available actions are all "set" commands.

## Input signal status

While polling is enabled, the module tracks what each of the four inputs is receiving.

**Variables** — for each input `1`–`4`:

| Variable             | Example                                       |
| -------------------- | --------------------------------------------- |
| `$(input_1_signal)`  | `3840x2160 60Hz`, or `No signal`              |
| `$(input_1_width)`   | `3840`                                        |
| `$(input_1_height)`  | `2160`                                        |
| `$(input_1_refresh)` | `59.94`                                       |
| `$(inputs_present)`  | `3` — how many inputs currently have a signal |

**Feedback** — _Input has signal_ turns a button green while the selected input is locked to a
source. Use it to build a source-status wall.

These are only as current as the poll interval. If you set the interval long, or set it to `0`,
the **Refresh Input Signal Status** action updates them on demand.

Note that no progressive/interlaced suffix is shown (`1080p` vs `1080i`) — the device does not
report which one it has, so the module does not guess.

## Before you use these actions

Two actions change the unit in ways that are not obvious from their names:

- **Reset Factory Defaults** wipes saved presets and settings. It does **not** take effect when you
  press it — the unit carries on working normally, and the reset lands at the next reboot. A unit
  that has been sent this looks completely fine until someone power-cycles it.
- **Window Label Text — Set** should never be sent to a daisy-chained unit. It does not set the
  label, and afterwards the unit's own GUI can no longer edit labels manually. The module does not
  offer this action in Daisy Chain mode for that reason.

## Troubleshooting

**Connection shows an error.** Confirm the IP, and that the unit answers in a browser at
`http://<ip>/`. The module checks the connection by asking for the firmware version.

**Buttons report success but nothing happens on the unit.** Check the Model / Operating Mode field
first — this is what a mode mismatch looks like. On a daisy-chained unit, see the section above.

**Signal variables show `No signal` for everything.** Polling is off (interval `0`), the unit is in
Daisy Chain mode, or the connection is down. The module's log records polling failures.
