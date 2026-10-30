---
'@objectstack/service-automation': patch
'@objectstack/spec': patch
'@objectstack/runtime': patch
---

fix(service-automation)!: a resume of a run parked on a `map` node, addressed by the parent's run id while the in-flight item's child run is still suspended, is refused with a code naming the child run id, instead of completing the parent past an item that never ran (#27877)

Clause-②: yes (narrowing) — `resume(runId)` on a run whose resume chain reaches a `map` link with a still-suspended item child, which answered success before, is refused, with a new wire code `RESUME_CHILD_PENDING` (a new member of the `AutomationResult.code` union, the `TriggerFlowResponseSchema` `code` enum and the ADR-0112 ledger).
Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) No authorable key is added, removed, renamed or re-shaped: the one protocol change is a new member of a response code enum, which no metadata author writes. A resume the engine accepted is refused before any state is touched, so there is no stored or authored shape for a migration to rewrite and no tombstone. -->

**BREAKING** accept-set narrowing at `AutomationEngine.resume` (`@objectstack/service-automation`), served by the generic resume route (`POST /automation/:name/runs/:runId/resume`) and the MCP `resume_run` tool (`@objectstack/runtime`), with its code added to the contract (`@objectstack/spec`).

- **Before.** A run parked on a `map` node, resumed by its own id while the item's child run was parked on a pause open to the generic route (a `screen`, a `wait`, any node declaring `resumeAuthority: 'any'`), re-ran the map node. The map had already counted the in-flight item as started, so it moved past it: the resume answered success, the parent's run row was `completed`, and the item child stayed in `listSuspendedRuns()` with nothing left to continue into.
- **Now.** That resume is refused with the new code `RESUME_CHILD_PENDING` (409 on both doors), and the message names the item run id to resume instead. Nothing moves: the parent stays parked on the item, the map's progress is unchanged, and the item child stays resumable. The same holds when a `subflow` link leads down to such a map: the refusal names the item run of the deepest map link.
- **Unchanged.** Resuming the item run continues the map exactly as before, through the engine's own up-bubble. A parent parked on a `subflow` node still delegates the signal to its child. An item parked on a node only its owning service may resume still answers `PERMISSION_DENIED` (403) at the parent's id. A `map` whose item run is gone (cancelled, or never persisted) is not refused.
- **New code.** `RESUME_CHILD_PENDING` joins `AutomationResult.code`, `TriggerFlowResponseSchema.data.code` and the error-code ledger under `@objectstack/service-automation`; the runtime resume door maps it to 409. It is not `RESUME_IN_PROGRESS`: that one is benign and needs nothing from the caller, this one is answered only by resuming a different run id. A client that switches exhaustively over the code union gains one member.
- **Who sees it.** A caller that resumes a batch flow by the parent run id it launched with, while an item is parked on a screen or a wait.

**The remedy.** Resume the item run the refusal names (also listed by `listSuspendedRuns()`, the run whose context carries the parent's id); the parent continues when the map's last item completes.
