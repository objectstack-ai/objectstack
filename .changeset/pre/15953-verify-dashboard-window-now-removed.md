---
'@objectstack/verify': minor
---

fix(verify)!: `runDashboardWindowProofs` takes no options, so the dashboard date-window run can no longer be pinned to an instant the server does not resolve on, and a run that crosses UTC midnight after it starts reports `not-run` instead of a false red

`runDashboardWindowProofs(stack, token, config)` loses its fourth parameter, and `DashboardWindowProofOptions` (its only member was `now`) is retired. The server resolves a dashboard's date preset per request on its own clock, so any `now` other than the current instant made every window read `contradicted`: the option could only produce false reds, and nothing passed it.

Clause-②: no (narrowing)

<!-- adr-0087: not-required (runtime-export-retired @objectstack/verify#DashboardWindowProofOptions) No metadata moves: no spec key, authorable spelling, object definition or stored shape is added, removed, renamed or re-shaped, so there is nothing for `objectstack migrate meta` to rewrite. What retires is one type export of `@objectstack/verify`'s published entry, `DashboardWindowProofOptions`, together with the optional fourth parameter of `runDashboardWindowProofs` that it typed. The affected party is a TypeScript caller, and the compiler at that call site delivers the break. -->

**BREAKING** (an accept-set narrowing), shipped as `minor` under the launch-window convention for breaking changes.

- FROM `DashboardWindowProofOptions` TO nothing (no replacement): drop the fourth argument, so `runDashboardWindowProofs(stack, token, config, { now })` becomes `runDashboardWindowProofs(stack, token, config)`.

Fix: the presets resolve when the run starts, and each count measure places its fixture rows on the day it is probed. A run that crossed UTC midnight between the two judged that measure against the previous day's edges and could read it `contradicted`. That measure is now `not-run`, and its detail names both days; the widget reads `inconclusive`. The guard that catches a day turning while a measure is being probed is unchanged.
