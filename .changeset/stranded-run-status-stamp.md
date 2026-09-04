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

Also in this change, under the same ruling's exactly-once guarantee:
`restoreConsumedSuspension` now reads the run's durable terminal row BEFORE its
own per-process journal. Read the other way round, the replica that stranded a
run kept a hot copy after another replica restored, resumed and finished it,
and a repeated restore on the first replica re-armed the COMPLETED run — whose
next resume re-ran every node after the pause. Such a restore is now refused
(`RUN_COMPLETED`, or `NO_CONSUMED_SUSPENSION` when the durable row holds no
snapshot for any other reason). Single-process and store-less deployments
observe no difference.
