# Avitech Sequoia 4K60 / 4K60L — Companion module

Bitfocus Companion connection module for the Avitech Sequoia 4K60 and 4K60L multiviewers.
Manifest id `avitech-sequoia4k60-sequoia4k60l`, runtime `node22`, entrypoint `dist/main.js`.

**The manifest id is derived from the repository name and is not free-form.** Bitfocus CI
(`bitfocus/actions/.github/workflows/module-checks.yaml`, the "Package module" job) computes
`basename(repo)` with the `companion-module-` prefix stripped and requires `companion/manifest.json`'s
`id` to equal it exactly — so repo `companion-module-avitech-sequoia4k60-sequoia4k60l` demands id
`avitech-sequoia4k60-sequoia4k60l`. Note the id does **not** carry the `companion-module-` prefix;
compare `companion-module-bmd-atem` → `bmd-atem`. If that job fails with "Module manifest.json id
does not match github repository name", this is why, and the id is what moves — renaming the repo
changes the id every published connection is keyed on. `legacyIds` exists to migrate a _published_
id and is empty because this module has not shipped.

## Build and verify

```bash
yarn install
yarn build     # rimraf dist && tsc -p tsconfig.build.json
yarn lint
```

There is no test suite. `yarn lint` and `yarn build` are the only automated checks — run both
before calling a change done. Use `yarn dev` for a watching compiler while iterating.

### The command bench

Automated checks can't tell you whether a _device_ still accepts a command. Avitech ships firmware
updates that aren't regression tested, so the reference guide documenting a command is not evidence
that a given unit honors it. `tools/bench.mjs` closes that gap:

```bash
yarn bench --host 192.168.0.5 [--port 80] [--mode <device-mode>] [--listen 8099]
```

It serves a page on `localhost:8099` with one button per command; clicking it fires the request at
a real machine and shows the exact URL sent plus the **raw** response text. Prove a command on the
bench before trying to debug it through the Companion UI.

Two things make it trustworthy, and both are worth preserving:

- **It drives the real adapters.** The bench imports `dist/adapters/index.js` and calls the same
  methods `actions.ts` does, so the URL it sends is byte-identical to Companion's. It is not a
  hand-maintained copy of the request shapes, and must not become one. This works only because
  nothing in the adapter import chain has a runtime dependency on `@companion-module/base` — every
  import in it is type-only and erased by `tsc`. Adding a value import from that package to
  `base.ts`, `models.ts` or an adapter would break the bench.
- **It proxies server-side.** The device's cgi-bin sends no CORS headers, so a page opened over
  `file://` could fire commands but never read the reply. The local server exists to read it.

Its `COMMANDS` array is declarative — extending the bench to another guide section is a data
change, not a rewrite. It covers every adapter method: sections 1.3.1 through 1.3.5.

Sections 1.3.3–1.3.5 are the first commands that are not on every unit, so entries carry optional
`models` and `modes` lists. An inapplicable command is rendered **disabled with the reason** rather
than hidden, so the page stays a full catalogue of the guide and "why is this not here" is answered
on the card. `unavailableReason()` is enforced in `handleSend()` too, not only in the markup —
`setKmRebootMode` and `setLabel` exist only on `Sequoia4K60LAdapter`, and reaching one through a
4K60 adapter is a `TypeError` that reads like a bench fault rather than a wrong question.

This is applicability, **not** the mode gating `actions.ts` performs. The bench still fires anything
the running adapter can physically send — that is the point of it — so a command Companion withholds
from a mode is still offered here when the adapter has a branch for it.

Two consequences of driving the real adapters worth knowing before reading a result:

- **Routing — Set sends nothing at all in daisy-chain mode.** §1.3.5 has no routing command, so
  `Sequoia4K60LAdapter.setRouting()` has no branch for that mode and falls through silently. The
  result panel reports "no request was made", which is the honest answer, but it is not a device
  response and must not be read as one.
- **One card, several wire shapes.** `set_audio_4k60l` sends `2060`/`audio` with `location` for
  quad-bypass OUT 2/3, without it for single-view, and switches to the `Daisy` cmd family entirely
  in daisy-chain mode. `set_routing_4k60l` similarly splits between `route2win` and `hdmi_output`.
  Read the URL the bench prints rather than assuming which branch ran.

Tables 1.3.4.6 and 1.3.4.9/1.3.4.10 have no cards of their own: §1.3.1 documents K/M Control and
Output Resolution for the 4K60 in the same shape, so there is one adapter method each and firing
the 1.3.1.13 / 1.3.1.4 cards on a 4K60L _is_ firing them. Same for 1.3.5.3 and 1.3.5.4.

Two things the bench does that Companion does not:

- **It has no colour picker.** §1.3.1's OSD colours are typed as `R,G,B` or `R,G,B,A` text and
  parsed by `parseColor`. `src/system.ts` is deliberately _not_ imported here — it holds a runtime
  import of `@companion-module/base` for `splitRgb`, which is exactly the dependency the bench
  exists without. Its choice lists are duplicated in `bench.mjs` on purpose; the adapter calls are
  still the real ones, which is the part that has to stay honest.
- **It renders an unconditional `warn` on destructive commands.** Separate from `warnInDaisyChain`,
  which only fires in daisy-chain mode. Reset Factory Defaults (§1.3.1.11) and Custom Preset —
  Delete (§1.3.1.9) erase device state in every mode, and the bench fires on a single click with no
  confirmation. Unlike Companion — where a button has to be deliberately created and the action
  assigned to it — one click on the bench page is the whole gesture.

## Model / mode design

The single most important concept in this module. Read before touching `actions.ts` or the
adapters.

The 4K60 and 4K60L each expose several **mutually exclusive operating modes**, and the mode
changes the wire shape of routing, audio, resolution, and K/M commands. A unit's mode is a fact
about how the hardware is physically configured — **this module cannot change it**.

So the instance config asks for one combined **model + mode** choice (`DEVICE_MODES` in
`models.ts`), rather than a model field and a mode field. This makes an invalid model/mode
combination structurally impossible in config. Preserve that property:

- Adding a mode means adding one entry to `DEVICE_MODES` **and** `DEVICE_MODE_CHOICES`.
- `getModelForMode()` derives the model from the mode string prefix. Mode ids must therefore
  keep the `sequoia-4k60l-` / `sequoia-4k60-` prefix convention — note that `sequoia-4k60l`
  is checked first because `sequoia-4k60` is a prefix of it.

## Adapter architecture

`src/adapters/` isolates per-model behavior behind `SequoiaAdapter`.

- `base.ts` — abstract class. Only holds commands whose wire shape is **identical across every
  mode of both models**, plus a `capabilities` object for fixed hardware differences (`maxPorts`
  — port 5 is 4K60-only; `supportsDaisyChain`). Two kinds live here:
  - `setRouting`, `getRouting`, `setAudio` are **abstract** — every mode supports them, but the
    request shape differs, so each adapter implements its own.
  - The §1.3.2 window commands (`getWindowGeometry`, `setWindowGeometry`, `getWindowLabels`,
    `setWindowLabel`, `setWindowShow`, `setWindowAspect`, `setFullscreen`) are **concrete**. The
    guide documents §1.3.2 once for "Sequoia 4K60/4K60L" with a single request shape, so there is
    nothing for a subclass to branch on.
  - The §1.3.1 system commands are **concrete** for the same reason. Note `setOsd`: the guide's
    Tables 1.3.1.16–1.3.1.21 are six _tasks_ but one request (`2060` / `set` / `osd` / `data`), so
    there is one method taking a `Partial<OsdSettings>`, and `actions.ts` provides the task-shaped
    buttons. Each action writes only its own keys, so pressing one never disturbs another's
    settings.
- `sequoia-4k60.ts` / `sequoia-4k60l.ts` — concrete adapters.
- `index.ts` — `createAdapter(mode, self, api)` factory, plus the public re-exports. Import
  adapters from `./adapters/index.js`, not the individual files.

**Model-specific commands do not go on the base class.** K/M reboot mode (`setKmRebootMode`,
§1.3.4.5) and daisy-chain label text (`setLabel`, §1.3.5) exist only on the 4K60L, so they live only
on `Sequoia4K60LAdapter` and callers narrow with `instanceof` first. Resist the urge to hoist a
method up to `base.ts` to avoid a narrowing check — the base class is deliberately the intersection
of the two machines, not the union.

The test is what the _guide_ documents, not what is convenient. `setOutputResolution` and
`setKmControl` were 4K60L-only until §1.3.1 was implemented, and moved to `base.ts` because §1.3.1
documents both for the 4K60 as well — 1.3.1.4's `port = 1/2/3/4/5 (port 5 is only available for
Sequoia 4K60)` and 1.3.1.13's "Sequoia 4K60 ... in Quad Multiview + Workstation mode". Sections
1.3.4/1.3.5 describe the same requests a second time for the 4K60L; the shapes are byte-identical,
so there is one method each. Mode restrictions still live in `actions.ts` gating, not in the
adapters — `set_km_control` is registered for exactly the three modes the guide names and stays off
the 4K60's Seamless Switching and the 4K60L's Single-View Seamless.

**Daisy chain is treated as a closed list.** §1.3.5 names the only four commands assumed to work
on a unit in daisy-chain mode — Label Text, Audio, K/M Control and Output Resolution. A command
documented elsewhere is not registered for that mode even when it is otherwise model-agnostic —
hence `actions.ts` gates all seven §1.3.2 actions and all 22 daisy-chain-ineligible §1.3.1 actions
behind `!isDaisyChain`, and `Sequoia4K60LAdapter.setLabel()` (§1.3.5, sends `daisy: 1`) stays a
separate method from `SequoiaAdapter.setWindowLabel()` (§1.3.2, no `daisy` key) despite the overlap.
In daisy-chain mode the action list is exactly those four commands; that is the property to check
after touching gating.

Bench-tested against a daisy-chained 4K60L on 2026-07-29, so this gating is now empirically
justified rather than precautionary:

- **Almost every §1.3.2 command returns `Success` and then does nothing.** The device does not
  report the rejection, so the module _cannot_ detect this failure — nothing in `parseResponse`
  can tell it apart from a real success. Treat a §1.3.2 command aimed at a chained unit as a
  false positive, never as working. Whether that's worth chasing is a firmware question.
- **Never send Window Label Text — Set (§1.3.2.4) to a daisy-chained unit.** It doesn't set the
  label, and afterwards the unit's own GUI can no longer edit labels manually. This is the one
  §1.3.2 command with a known harmful effect in this mode. Companion won't offer it there, but
  `tools/bench.mjs` does not gate by mode and will happily fire it.

**§1.3.1 is almost entirely un-bench-tested.** Every request shape in it was verified against the
guide's worked examples and nothing more. That is a weaker claim than it sounds — the §1.3.2
findings above were also guide-faithful right up until hardware showed that `z` and `global_option`
behave nothing like the documentation says.

The one exception, tested on a 4K60L on 2026-07-29: **Reset Factory Defaults (§1.3.1.11) does not
apply when sent.** The unit carries on with its presets and full command set intact, and the reset
only lands on the next reboot. So the destructive window closes at the power cut, not at the button
press, and a unit that has been sent this looks completely normal until someone reboots it. Warnings
in `base.ts`, `actions.ts` and `bench.mjs` say "destructive" without saying "immediate" for exactly
this reason — do not re-tighten that wording without re-testing.

Specific things to establish on real hardware before trusting them:

- The `get` responses are screenshot-only in the guide, so the PDF's text layer does not contain
  them — but the figures are extractable as images (`pdfimages -png -f <page>`), and doing so
  decodes Firmware Version, Network and OSD Info without needing hardware. Custom Preset File List
  is still unrecorded. **Signal Type (§1.3.1.2) is captured and implemented — see below.**
- Whether `setOsd` really is additive. The module assumes an unaddressed key is left alone, because
  every worked example sends a partial `data` object. `setWindowGeometry` had to abandon exactly
  that assumption. `getOsdInfo` is the read side to build on if it turns out to be wrong.
- `idle_time` (§1.3.1.24) has a **blank** Cmd-Value row in the guide — no range, no units, no
  disable value. Seconds is inferred from its single example (120 described as "2 minutes"); the
  0–65535 bound in `actions.ts` is this module's invention, not the vendor's.

Four places where the guide's prose and its worked example disagree, and the example was followed:
`en` vs `enable` (§1.3.1.15), `mode` vs `sob_alarm` (§1.3.1.22), `preset_num` vs `preset_unm`
(§1.3.1.6), and `signal` (§1.3.1.2, below). Also note §1.3.1.23's `enable` is inverted — `0` turns
power saving **on** — which is the guide's wording, not a transcription error.

`ModuleInstance.adapter` is rebuilt in both `init()` and `configUpdated()`, because changing the
configured mode must swap the adapter and rebuild the action list.

## Signal Type (§1.3.1.2) and the poll loop

`src/signal.ts` parses the only §1.3.1 read that reports live state. Captured from a 4K60L on
2026-08-12 and cross-checked against the guide's Figure 1.3.1.2; the module's variables and the
`input_signal_present` feedback are built on it.

```json
[{"input":1,"signal":19,"clock":5939,"total":[4400,2250],"active":[3840,2160],"start":[384,82],"freq":6000},
 {"input":2,"signal":0}, ...]
```

- **An input with no signal carries only `input` and `signal`.** Every other key is absent. The
  guide's figure has all four inputs live and so never shows this, which is why `parseSignalResponse`
  never infers one key's presence from another's.
- **`signal` is not `0`/`1`.** The prose says `0(video absent) / 1(video feed)`; the figure shows 3
  and 5, hardware returned 19. Nor is it a resolution code — the figure's `3` and the captured `19`
  are both 3840×2160@60 differing only in blanking — and it shares no namespace with
  `RESOLUTION_MODES` (where 3840×2160 60Hz is 99). Treat it as opaque; only `!== 0` is relied on,
  and the readable format comes from `active` + `freq`.
- **`freq` is hundredths of a Hz** (6000 = 60.00, 5994 = 59.94, 2997 = 29.97). **`clock` is a
  measured pixel clock in units of 0.1 MHz** — every sample checks out against
  `total[0] × total[1] × freq`. It **jitters**: two inputs carrying an identical format read 5939
  and 5940. Neither `clock` nor `start` is surfaced as a variable, and neither should be — polling
  measurement noise onto a button redraws it for nothing.
- **`input` is 1–4 on both models.** `capabilities.maxPorts` counts HDMI _outputs_ (5 on the 4K60)
  and must not be used to size this array; `INPUT_IDS` is separate for that reason.

`ModuleInstance` polls this on a timer whose interval is the `pollInterval` config field (seconds,
`0` disables). Three properties to preserve:

- **It does not poll in daisy-chain mode.** §1.3.5 does not list this command, so polling it would
  be exactly the request the `actions.ts` gating exists to prevent — and §1.3.2's bench results are
  the warning about what a chained unit's answer is worth.
- **`stopPolling()` runs in `destroy()` and at the top of `configUpdated()`.** Host, interval and
  mode can all change, so the loop is torn down and rebuilt rather than adjusted.
- **Failures log once, not every tick.** `pollFailing` tracks the transition; an unreachable device
  would otherwise fill the log at the poll rate. The request has already set `InstanceStatus`.

The "Refresh Input Signal Status" action calls `refreshSignalState()` — the same path the poll uses
— so a manual press and a tick publish identically.

### The other `get` shapes, decoded from the guide's figures

Recovered by extracting the PDF figures as images rather than from hardware, so these are the
guide's own screenshots — trustworthy about _shape_, not about any particular unit's values.

- **Firmware Version** (`Info`/`device`, Figure 1.3.1.1) — a flat object. Beyond the version
  strings it carries live state with no other read path: `resolution[5]`, `audio[5]`, `osd_en[5]`,
  `remote_en[5]`, `sib_hdcp[4]`, `custom_edid[4]`, `daisy_chain`, `daisy_audio`, `daisy_active`,
  `idle_time`, `fading_time`, `temp`, `machine_name`, `wall_lock_status`. This is the obvious
  source for a second wave of variables, and `checkConnection()` already sends it.
- **Network** (`Info`/`machinelist`, Figure 1.3.1.3) — an array of
  `{IP, MAC, MACHINE, NAME, AVAHI_IP}`, keys uppercase. Note it lists **every** Sequoia on the
  subnet, not just the addressed one, so nothing may assume element 0 is this instance.
- **OSD Info** (`2060`/`get`/`osd`, Figure 1.3.1.14) — confirms all 15 `OsdSettings` keys the module
  writes, spelled identically, colours as `[r,g,b,a]`. It also returns `show_tally2`, `show_tally3`,
  `tally2_on_color`, `tally2_off_color` and `tally3_off_color`, which `OsdSettings` does not model —
  tally channels 2 and 3 are unimplemented, not deliberately excluded.

## Device HTTP API

`src/avitech-api.ts`. Every command is a GET:

```
http://<ip>/cgi-bin/command.cgi?cmd=<cmd>&param=<json>
```

`cmd` selects the command family (`Info`, `Ext`, `2060`, …). `param` is a JSON object always
carrying `func` (`get`/`set`/`load`/`list`/`del`) and `type`, plus per-command extras. Requests
time out at 5s and update `InstanceStatus` on success and failure.

Response handling has three cases, and the third is a real-world quirk worth preserving:

1. `"Success"` or empty — returned as-is for set/load/del commands.
2. `"Wrong format"` — thrown as `AvitechApiError`.
3. A `{"cb_status": "..."}` envelope — **undocumented in the v1.0.8 reference guide.** Newer
   firmware rejects some commands this way instead of returning `"Wrong format"` (observed:
   `"Not Permitted"`). It is parsed and thrown as an error, because otherwise a rejected command
   looks like a successful JSON response. Don't remove this check when tidying `parseResponse`.

Anything else that parses as JSON is returned parsed; anything that doesn't is returned as text.

## Conventions

- **ESM.** Relative imports need the `.js` extension (`./config.js` from `config.ts`).
- **Formatting** comes from `@companion-module/tools/.prettierrc.json` — tabs, single quotes,
  no semicolons, 120 columns. Run `yarn format`; a husky/lint-staged pre-commit hook enforces it.
- `eslint.config.mjs` is generated by `@companion-module/tools`; don't hand-add rules casually.
- `.yarnrc.yml` sets `enableScripts: false` and `npmMinimalAgeGate: 3d`. A dependency bump can
  be refused purely for being freshly published — check the publish date before debugging further.
- **Per-section option modules.** `src/windows.ts` (§1.3.2) and `src/system.ts` (§1.3.1) hold the
  dropdown choice lists, option-field builders and value conversions for their section, keeping
  `actions.ts` to action definitions. Data types the adapters need (`WindowGeometry`, `OsdSettings`,
  `DeviceColor`) are declared in `base.ts` and flow **outward** to these modules — never the
  reverse. That is what lets `system.ts` hold a value import of `@companion-module/base` for
  `splitRgb` without dragging it into the adapter chain and breaking the bench.
- `src/signal.ts` is the response-parsing counterpart: §1.3.1.2's reply shape, its choice list, and
  the display formatting. It knows nothing about variable names — `variables.ts` maps `InputSignal`
  onto those — so the parsing stays usable by anything else that needs live input state.
- Actions, feedbacks, presets, and variables are each registered from their own module via an
  `Update*(self)` function called from `ModuleInstance`. Keep that shape; `actions.ts` is by far
  the largest file and is where mode-dependent option lists are built.
- **`presets.ts` is gated by mode for the same reason `actions.ts` is.** A preset may only reference
  an action id that exists in the configured mode, or applying it binds a step to an action the
  module never registered — so its mode predicates mirror `UpdateActions()` exactly, and
  `updatePresets()` is called from `configUpdated()` as well as `init()`. Adding a mode therefore
  means checking three places, not one: `DEVICE_MODES`/`DEVICE_MODE_CHOICES`, the `actions.ts`
  gating, and here. In daisy-chain mode the preset list is Audio and K/M Control only.
  Variable references in preset text use the `sequoia:` prefix — the manifest `shortname`, which
  Companion rewrites to the user's connection label when the preset is applied.
