---
'@objectstack/service-automation': minor
'@objectstack/plugin-approvals': patch
---

`restoreConsumedSuspension` reaches a NESTED run: the ancestors a stranded descendant cascade-failed are journalled too, and the chain is re-armed as one unit

`resumeInternal`'s catch arm journalled the consumed suspension of the run that
threw, and nothing else. For a nested run the ancestors were handled on both
paths with no journal at all: up-bubble (`failAncestors` walks `$parentRunId`
and calls `failSuspendedRun` on each suspended ancestor) and delegation (the
parent frame sees a failed child with no retryable code and calls
`failSuspendedRun` on itself). `failSuspendedRun` was `forgetSuspendedRun(run,
'failed')` plus a `failed` log record — it journalled nothing.

So the leaf was restorable while every ancestor was recorded `failed` with its
pause consumed and no snapshot (`restoreConsumedSuspension(PARENT)` answered
`NO_CONSUMED_SUSPENSION`), and restoring the leaf completed it into a parent
that never continues: `bubbleToParent` found no parent suspension and logged.
The operator ended up worse off than before using the exit.

`failSuspendedRun` now journals the pause it consumes whenever the descendant
whose failure consumed it is itself repairable — from the same single producer
and onto the same durable terminal row as the strand's own snapshot, so the
chain is repairable from any replica and after a restart, not only from the
process that stranded it. `restoreConsumedSuspension` then repairs the chain as
one unit: it walks down to the stranded descendant and up through the ancestors
it cascaded into, and re-arms every member DEEPEST FIRST, so an ancestor becomes
resumable only after the run it is parked awaiting is parked again. The entry
point does not matter — naming any member of the chain repairs all of it — and
the continuation is then re-issued once, on the run that was named.

Additive on the wire and in the type: the result's existing fields still
describe the run the caller named, and the new `chain` key is present only when
the repair was a chain repair. `ChainRestoreEntry` is exported for it. The
narrower `IAutomationService.restoreConsumedSuspension` contract in
`@objectstack/spec` is unchanged and the HTTP door's payload is unchanged — the
door answers `{ runId, restored, reason }` as it always did.

Every member goes through the same per-run call as a flat restore — its own
in-process claim, its own strict live-suspension read, its own two-witness read,
its own durable park — so idempotence and the #14333 advance claim hold per run
in the chain: a second restore finds every member parked and answers
`RUN_SUSPENDED` without minting a second pause anywhere.

⛔ No ancestor is stamped `'stranded'`. That word is the resume result of a run
that consumed its OWN pause and then threw downstream, and nothing re-arms an
ancestor by resuming it; stamping it would send an operator to retry a recovery
that cannot succeed. The parent frame's delegation result still carries no
status at all, and an ancestor's repairability is carried by the journal and by
this verb's answer.

Journalling is EARNED, not applied to every cascade: an ancestor whose
descendant is beyond repair is still consumed without a snapshot, because
re-arming it would promise a chain repair that could not be completed.

**`@objectstack/plugin-approvals`** reports the consequence rather than causing
it: `inspectStrandedRequests` asks the engine per run, so a cascade-failed
ancestor whose descendant is repairable now comes back `runState:
'repairable'` instead of `'unrepairable'`, and restoring either row repairs the
pair. `'unrepairable'` keeps its other causes — a run that never paused, a
snapshot no longer held, and a cascade whose descendant was itself beyond
repair. No plugin logic changed; the docblocks that documented the old
limitation did.
