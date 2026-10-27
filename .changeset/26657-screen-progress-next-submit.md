---
'@objectstack/spec': patch
'@objectstack/service-automation': patch
'@object-ui/app-shell': patch
---

feat(automation): a paused screen says whether another screen can follow, and the screen-flow runner reads Next or Submit and counts steps from it

Clause-②: yes (widening)
Metadata-protocol: none

A screen-flow wizard's primary button read Submit on every step, so a requester believed the whole wizard was submitted on step 1, and no step counter could be drawn: the paused screen carried nothing about the screens after it, and a flow can branch after any screen, so only the engine can tell.

- **`@objectstack/spec` — `ScreenSpec.progress`** (optional, `ScreenProgressSpec`) on the paused screen a run serves, and its wire spelling on `TriggerFlowResponseSchema`. `nextScreen` is `'none'` (no path out of this screen reaches another one: the last step), `'certain'` (every path pauses on another screen first) or `'possible'` (a branch, a fault path, a loop, a pause that serves no screen, or a `subflow` decides — the engine does not guess). `step` (1-based) and `stepCount` are present only when every path agrees on them. Nothing a metadata author writes changes.
- **`@objectstack/service-automation`** fills it from the flow graph of the run when a `screen` node pauses (`readScreenProgress`). A screen that never pauses is not counted; one the run's caller may already have answered counts as possible, never certain. A screen inside a child run (`subflow`) carries only `nextScreen` when its own graph shows another screen, and no `progress` when it does not, because the parent may continue with screens of its own.
- **`@object-ui/app-shell` — `FlowRunner`** labels the flat step's button `common.next` while another screen is certain or possible and `common.submit` on the last, and draws `form.stepOf` beside the flow's name only when both `step` and `stepCount` are served. A screen served without `progress` keeps Submit and no counter, as before.

What to do: nothing. A custom runner that reads the paused screen can read `progress` the same way.
