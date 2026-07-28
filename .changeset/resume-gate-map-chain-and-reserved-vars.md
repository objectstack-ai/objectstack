---
"@objectstack/service-automation": patch
"@objectstack/runtime": patch
---

fix(automation): the resume gate follows `map:` too, and the route stops accepting engine-internal variables (#3853)

Two holes in the #3801 resume gate, both demonstrated with a repro.

**1. The chain walk missed `map:`.** `resumeInternal` handles the two linked-run
correlations oppositely — a `subflow:` pause *delegates* the signal to the child,
a `map:` pause *re-runs* the map node — and the gate followed only the first. So
a run parked on a `map` node was judged on `map` itself (`resumeAuthority: 'any'`)
and let through even while the item it was waiting on sat on an `approval`.

`map` is the batch-approval shape, and the map parent's run id is the one a
launcher holds. Since `$mapState.started` is advanced past the in-flight item
before the suspend, an empty-body resume of the parent **skipped that item's
approval outright**, orphaning its still-pending request; a later real decision
then bubbled into a parent already waiting on the next item, cascading the
misalignment.

The walk now follows both prefixes: a linked-run pause is waiting on a CHILD, so
the child's node carries the authority — the gate reads *the item, not the loop*.

**2. Resume `inputs` could write the engine's `$` namespace.** They are applied
as bare flow variables, so a caller could set the exact handoff keys the engine's
map bubble uses (`<nodeId>.$mapItemDone` / `$mapItemOutput`) and have the map
record a per-item result for a decision nobody made — the node id is readable
from `GET /automation/:name`. The same reached `$runId`, which `approval` /
`wait` nodes use to correlate external state back to a run.

`POST /automation/:name/runs/:runId/resume` now answers **400** when `inputs`
names anything in the engine namespace (`$…`, or a `.$` segment). Enforced at the
transport, not in the engine, so the in-process bubble keeps working — the same
trust split the gate itself uses.

Nothing changes for author-declared variables: `{ new_assignee: 'ada' }` and
dotted names like `collect.note` are unaffected. If you were driving a batch-
approval `map` by resuming the map's own run id, resume the **item's** run
through its owning service instead (e.g. `client.approvals.approve`) — the map
advances itself when the item completes.
