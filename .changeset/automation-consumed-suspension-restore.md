---
"@objectstack/service-automation": minor
"@objectstack/plugin-approvals": patch
---

feat(service-automation): an operator can put back a suspension a failed resume consumed (#13909)

A run that was resumed and whose downstream node merely **threw** was
terminally unresumable, and nothing anywhere could move it. The engine consumes
the suspension *before* running downstream nodes, so such a node throws with
the pause already gone and the catch arm records the run `failed`: `resume`
then answers `RUN_NOT_FOUND`, `cancelRun` is a no-op, and none of the engine's
other public methods takes the run anywhere. A deployment could enter that
state and never leave it.

`AutomationEngine.restoreConsumedSuspension(runId, { requestedBy, reason })`
is the exit. It puts the consumed suspension back — verbatim, as it stood at
the pause — so the run is resumable again through an ordinary `resume`, with
the same authority gate, the same screen validation and the same idempotency
guard as any other.

- **Deliberate, never automatic.** Nothing calls it on its own: no retry, no
  sweeper. An operator asks for one run, by id.
- **Safe to refuse, with the reason named.** A run that is still suspended, one
  whose resume is *in flight*, one that completed, one that was cancelled, one
  that never suspended, and an unknown id each get their own refusal — as does
  an unreadable store, which is refused rather than guessed at.
- **Idempotent.** A suspension is keyed by run id, so however many operators
  ask there is one resumable pause and no extra traversal — the verb re-arms
  and stops. Two racing callers in one process get one restore and one refusal.
- **It leaves a trace.** The restore is logged with the run, flow, node, when
  the suspension was consumed, who asked and why, and the run is recorded
  `paused` again so the repair is not invisible. Across a restart the exit
  still works: the consumed suspension rides the run's own terminal history row
  (in `sys_automation_run` columns that already existed), and a run that is
  restored and then finishes clears it.

⚠️ A repair, not a prevention. The failed attempt's side effects are **not**
undone and the original resume signal is **not** replayed — the continuation
must be re-issued. Whether the pause should survive a downstream throw at all
is a separate, unruled decision (#13937); this change leaves the resume
ordering, `forgetSuspendedRun` and `traverseNext` exactly as they are, mints no
new run status, and works whichever way that is ruled — the runs already stuck
today are not released by changing what future resumes do.

`plugin-approvals` carries a comment correction only: its organization backfill
documented `context_json` as never written on terminal rows, which this change
makes false for that one class of row. No behaviour change there.
