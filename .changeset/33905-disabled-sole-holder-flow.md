---
'@objectstack/service-automation': patch
---

fix(service-automation)!: a flow whose only holder's package is disabled is not run by its trigger, and the engine's bare entries answer as for no flow (ADR-0150 D3)

Clause-②: no (narrowing)
Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) No key of any schema is added, removed, renamed or re-shaped, and no export changes shape. The moved answers are a trigger-fired run and the bare execute, getFlow and toggleFlow entries under a reversible package state: no stored row, slot key, run key, trigger binding or dispatch key changes, so there is nothing for a migration to rewrite and no tombstone. -->

**BREAKING** for a deployment where a package that alone ships a flow name is disabled while the automation engine still holds that flow (the re-sync that follows a disable failed or did not run): the flow no longer runs, and the bare entries no longer serve it. Before this release it kept running and was served.

What moves, for such a flow, while its package is disabled:

- Its trigger binding (record-change, schedule, time-relative, or an api inbound hook's queued post) ran the flow. Now nothing runs and no run-history row is written; the skip is logged once at `info` per slot.
- `execute(name, …)`, by any caller, a `subflow` or `map` node's call included, ran the flow. It now answers `{ success: false, error: "Flow 'NAME' not found" }`, the answer for a flow the engine does not hold.
- `getFlow(name)` answered the flow. It now answers `null`, so the bare HTTP doors that ask it first (`GET /automation/NAME`, `POST /automation/NAME/trigger`, `POST /automation/trigger/NAME`, `POST /automation/NAME/toggle`, `POST /automation/NAME/clone`, `GET /automation/NAME/runs`) answer `404`, which is what the namespaced address `/automation/NAMESPACE/NAME…` already answered.
- `toggleFlow(name, …)` switched the flow. It now rejects with `Flow 'NAME' not found`.

Remedy: enable the package. Its flow runs on its trigger again with no re-arm, and the bare entries serve it again.

An event that fires while the package is disabled is dropped, not replayed when the package is enabled again.

Nothing durable moves: the slot key, run keys, the trigger binding, the dispatch holder, credentials and the version history stay judged over every holder. Resuming a run parked before the disable is not decided here. A flow no package ships (the environment's own, or one registered straight into the engine) answers as before.
