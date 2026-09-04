---
"@objectstack/service-automation": minor
---

feat(automation): a resume that consumed the pause and then failed downstream answers `status: 'stranded'` (#13937)

The services half of the #13937 shape-4 ruling (maintainer 2026-09-01):
`resumeInternal`'s consumption order is kept — the suspension is consumed
before downstream nodes run, which is what buys exactly-once across a crash —
and the state that order leaves behind when a downstream node throws now
carries the platform-level name #14384 put on the contract.

`AutomationEngine.resume()` (and every engine continuation that reaches the
same catch arm) returns `{ success: false, status: 'stranded', … }` where it
returned no `status` at all. Stamped on that one exit only: the pause a
durable decision was waiting on is gone, the run is recorded `failed`, and it
can be re-armed only by the explicit operator verb
`restoreConsumedSuspension` (#13909 slice 2, already published) — never by
`resume` (which answers `RUN_NOT_FOUND`) and never automatically. Distinct
from `'failed'` on purpose: that one says the run ran and was rejected; this
one says a recorded continuation stopped mid-flight and an operator has
something to repair. The result's verdict and the restore verb are held to
agree by test: a stranded result is exactly a restorable run.

Not changed: the run's RECORDED status (the run log, `getRun`, `listRuns`, the
durable `sys_automation_run` history row) stays `failed` — that vocabulary is
`ExecutionStatus` in `@objectstack/spec`, which the ruling did not widen; the
durable discriminator for the condition remains the snapshot the terminal row
carries. No resume semantics move for any pausing node type; shapes 2 and 3
of the decision stay excluded.

Also in this change, under the same ruling's exactly-once guarantee, two
repairs to how `restoreConsumedSuspension` finds a stranded run's snapshot:

- The durable run-history row of a stranded run now records the PAUSE node in
  `node_id`. It recorded the node that threw — the run's last step — and the
  object store read that column back as the snapshot's node, so a restore
  from the row (after a restart, or on another replica) re-armed the run at
  the failed node and the next resume skipped it while reporting the run
  completed. The throwing node stays where the Runs surface reads it: the
  row's step log and `error`.
- The verb reads the durable row and its own per-process journal as two
  witnesses of one strand instead of trusting either alone. The hot copy is
  preferred when both describe the same pause (it is the verbatim object the
  failure was journalled from). A row that carries no snapshot is read as
  "the run moved on" only when this process's own history write landed —
  the replica that stranded a run used to keep a hot copy that could re-arm
  the run after another replica had restored, resumed and finished it, and
  the next resume re-ran every node after the pause. A snapshot the object
  store could not persist (over its 256 KiB row budget) is now recorded in
  the row as dropped, with the pause it belonged to, so the replica holding
  the hot copy still restores and any other replica is refused with a reason
  that names the budget and the remedy.

In-memory and store-less deployments observe no behaviour difference. On the
object store, same-replica restores re-arm the pause node on every path, and
restores from the row alone do too; restores across replicas of a run that
finished elsewhere are refused.
