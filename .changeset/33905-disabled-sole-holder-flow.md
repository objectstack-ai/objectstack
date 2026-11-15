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

Three HTTP write doors ask `getFlow` whether the name is held, and move with it for such a flow. These answers were read from the runtime source; the engine's half of the clone answer was measured. Each holds only where the door's earlier checks, such as the packaged-base and authoring rules, let the request through.

- `POST /automation/SOURCE/clone`, with the flow's name as the new name: the taken-name probe refused the copy with `409`. It now finds no flow and lets the copy through. The engine files the copy's body in the disabled package's slot of the name, and once the package is enabled again its trigger runs the copy's body until the next re-sync. That is the answer the door already gives once the disable's re-sync has withdrawn the flow, so the door accepts nothing the normal path refuses.
- A definition write (`POST /automation`, `PUT /automation/NAME`) or a clone that the engine accepts and that is then refused (an unknown `notify` channel, a refused landing, a refused save) put back the definition the engine held. It now has nothing to put back, so it removes the name's registration. A `PUT` body that leaves out a stored credential no longer keeps the one the engine held.
- `DELETE /automation/NAME` answered a deletion. It still removes the engine's registration, but now answers `404` unless a stored row was removed.

Remedy: enable the package. Its flow runs on its trigger again with no re-arm, and the bare entries serve it again.

An event that fires while the package is disabled is dropped, not replayed when the package is enabled again.

Nothing durable moves: the slot key, run keys, the trigger binding, the dispatch holder, credentials and the version history stay judged over every holder. Resuming a run parked before the disable is not decided here. A flow no package ships (the environment's own, or one registered straight into the engine) answers as before.
