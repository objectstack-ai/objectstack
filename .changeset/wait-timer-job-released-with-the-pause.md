---
"@objectstack/service-automation": minor
---

fix(automation): a `wait` timer's wake-up job is dropped when the run leaves the node, not only when the timer fires (#5512)

A timer `wait` arms a one-shot job on entry (`flow-wait:<runId>:<nodeId>`,
`{ type: 'once', at }`) and, until now, only that job's own callback ever tore it
down. Every other way out of the pause left it armed:

- resumed early through the REST resume endpoint (`POST
  /api/v1/automation/:name/runs/:runId/resume` — a door the #3801 resume gate
  deliberately leaves open for `screen`/`wait` pauses) or the SDK equivalent;
- cancelled while parked (`cancelRun`, ADR-0044);
- terminally failed under a subflow ancestor.

Reported from 17.0-rc2 acceptance: a `wait P1D` pause resumed early ran to
completion while its one-shot stayed `active: true` in `sys_job` with tomorrow's
deadline. For the next 24h anyone reading `sys_job` saw "a run is still waiting
to be woken" — the row contradicted the run — and when the deadline arrived the
job fired a resume at a run that had completed the day before (harmless: the
engine reports a machine-state error and the callback discards it, then the job
self-cancels). A long-running org accumulated one stale row per early wake-up.

**What changed.** The engine now tells the node its pause is over. `NodeExecutor`
gains an optional `onSuspensionReleased(release)` — the mirror of `suspend: true`
— called from the single choke point every consumption of a suspension already
passes through, with the `runId`, the node, the `correlation` the node minted at
suspend time, and why the pause ended (`resumed` / `cancelled` / `failed`). The
`wait` node implements it by cancelling the one-shot whose name it recognises as
its own, so the `sys_job` row goes inactive the moment the run leaves the node,
whichever route it left by. `SuspensionRelease` / `SuspensionReleaseReason` are
exported for plugin nodes that arm something on entry (a lease, a reminder, a
timeout) and need the same teardown.

Teardown is best-effort and runs after the suspension is consumed: a job service
that is down or throwing can neither delay nor fail the continuation — the engine
logs one warning naming the correlation an operator would cancel by hand. Node
types that arm nothing are unaffected (the hook is optional), and a pause that
armed no job — a signal wait, or a timer with no parseable duration — cancels
nothing, since its correlation is not a job name. Deprecated ADR-0018 node
aliases delegate the hook to their canonical executor, so authoring the old type
name cannot silently lose the teardown.

The timer callback keeps its own `finally` cancel: the two answer different
questions — "the run left the node" versus "this one-shot has had its single
shot", including shots that did not consume a pause. `cancel` is idempotent.
