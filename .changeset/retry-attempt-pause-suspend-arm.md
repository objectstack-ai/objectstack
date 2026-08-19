---
"@objectstack/service-automation": patch
"@objectstack/runtime": patch
---

fix(service-automation): a retry attempt that PAUSES is a durable pause, not a failed attempt — `executeWithoutRetry` gets the ADR-0019 suspend arm (#9510)

`execute()`'s catch tests the suspend signal FIRST, and that arm is what makes
ADR-0019's durable pause work: it snapshots the live variables, calls
`persistSuspendedRun`, records a `paused` log entry and returns
`{ success: true, status: 'paused', runId }`.

`executeWithoutRetry()` — the method `retryExecution` re-runs the flow through on
**every** retry attempt — had no such arm. A `FlowSuspendSignal` thrown on a
retry attempt fell into the generic failure path, and four things were lost at
once:

1. `persistSuspendedRun` never ran, so **the continuation was never stored** and
   the run could not be resumed by anyone, ever;
2. the run log recorded `failed` for a run that asked to pause;
3. the caller got `status: 'failed'`, with the suspend signal stringified into
   `error` (`FlowSuspendSignal` is not an `Error`);
4. `retryExecution` reads only `result.success`, so the pause counted as one more
   failed attempt: the loop burned the rest of the budget, and every further
   attempt re-entered the pausing node and orphaned another suspension.

Only a LATER attempt is exposed — `execute()` handles the first one correctly,
and a flow reaches `retryExecution` only after a failure. The reachable shape is
the ordinary one: `errorHandling.strategy: 'retry'` on a flow whose flaky
HTTP/connector call is followed by an `approval` or `screen` node.

**⚠️ Runs already lost to this defect are NOT recoverable.** Nothing was written
for them — no `sys_automation_run` row, no in-memory suspension — so there is no
continuation to rehydrate and no repair, here or later, can bring one back. The
run log holds a `failed` entry naming the flow and the trigger; those runs have
to be triggered again. What this change fixes is every run from here on.

**The repair is a restoration of a stated contract on a path that never got it,
not a new capability.** `AutomationResult.status: 'paused'` and ADR-0019 already
describe exactly this behaviour, and `execute()`'s own arm already implements it;
the retry path simply never received it. The alternative — refusing
`strategy: 'retry'` combined with a pausing node at authoring time — was
considered and rejected: it over-refuses (a pausing node can sit on a branch the
retrying path never reaches), under-refuses (a pausing node behind a runtime
condition is not statically decidable), and would ban the one combination authors
most reasonably reach for.

**The cost, and what was done about it.** Lifting the arm makes `retryExecution`
able to return a NON-TERMINAL result, and both of its readers were taught the
third state explicitly rather than left to a branch that happens to fall through:
the retry loop returns a paused attempt because it PAUSED (tested on `status`,
before the `success` check that means "this attempt succeeded"), and the trigger
route answers it from its own arm. The retry accounting is untouched — a
genuinely failing attempt still consumes one, `maxRetries` still bounds the loop,
and the loop stops only because the attempt did not fail.

**Both routes give one answer**, pinned as an equality rather than verified in
isolation: a pause on attempt 1 and a pause on attempt 3 produce the same engine
result and the same wire response, so no caller can tell which attempt paused.

Two adjacent gaps were measured out of this work and filed rather than absorbed:
a retry attempt runs with a smaller variable environment than the first (#9704),
and a flow's declared retry policy stops applying once a run pauses (#9705) —
the latter being the measured answer to "what happens to the retry budget when a
paused run is resumed and then fails": neither inherited nor fresh, because the
resume path has no retry loop at all. Both are pinned as today's behaviour so
neither can change by accident.
