---
'@objectstack/service-automation': patch
---

fix(service-automation)!: a resume of a run parked on a `map` node, addressed by the parent's run id while the in-flight item's child run is still suspended, is refused with a code naming the child run id, instead of completing the parent past an item that never ran (#27877)

Clause-②: no (narrowing) — `resume(runId)` on a run whose resume chain reaches a `map` link with a still-suspended item child, which answered success before, is refused. Nothing is widened.
Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) No key of any schema is added, removed, renamed or re-shaped, and no export of the published entry changes: a resume the engine accepted is refused with an existing resume refusal code, before any state is touched. There is no authored shape for a migration to rewrite and no tombstone. -->

**BREAKING** accept-set narrowing at `AutomationEngine.resume` (`@objectstack/service-automation`), served by the generic resume route (`POST /automation/:name/runs/:runId/resume`) and the MCP `resume_run` tool.

- **Before.** A run parked on a `map` node, resumed by its own id while the item's child run was parked on a pause open to the generic route (a `screen`, a `wait`, any node declaring `resumeAuthority: 'any'`), re-ran the map node. The map had already counted the in-flight item as started, so it moved past it: the resume answered success, the parent's run row was `completed`, and the item child stayed in `listSuspendedRuns()` with nothing left to continue into.
- **Now.** That resume is refused with `RESUME_IN_PROGRESS` (409 on both doors), and the message names the item run id to resume instead. Nothing moves: the parent stays parked on the item, the map's progress is unchanged, and the item child stays resumable. The same holds when a `subflow` link leads down to such a map: the refusal names the item run of the deepest map link.
- **Unchanged.** Resuming the item run continues the map exactly as before, through the engine's own up-bubble. A parent parked on a `subflow` node still delegates the signal to its child. An item parked on a node only its owning service may resume still answers `PERMISSION_DENIED` (403) at the parent's id. A `map` whose item run is gone (cancelled, or never persisted) is not refused.
- **Who sees it.** A caller that resumes a batch flow by the parent run id it launched with, while an item is parked on a screen or a wait.

**The remedy.** Resume the item run the refusal names (also listed by `listSuspendedRuns()`, the run whose context carries the parent's id); the parent continues when the map's last item completes.
