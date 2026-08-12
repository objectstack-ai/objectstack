---
"@objectstack/service-job": patch
---

fix(service-job): a timed-out job run is recorded as `timeout`, not `success` (#7734)

A job declared with `timeout: 2000` whose handler ran for 10 s persisted
`sys_job_run.status: 'success'` with `duration_ms` ≈ 10000 — five times the
declared limit — and left `sys_job.last_status: success`, `failure_count: 0`.
The scheduler did the right thing at runtime (it abandoned the attempt and
retried it); only the record an operator reads was wrong, which is the worse
half: the `timeout` verdict existed solely in the in-memory `JobExecution`
history that `sys_job_run` never reads.

**The race.** `DbJobAdapter.schedule()` wrapped the handler in its recorder and
handed the *wrapper* to the timer adapter, which applied the `runWithPolicy`
timeout guard around it. So the guard raced the recorder rather than the
handler: when the guard won, the recorder's own `await handler(ctx)` was still
pending on a handler JavaScript cannot cancel, and whenever that finally
resolved it wrote `success` over the run. The same seam is why every
`sys_job_run.attempt` read `1` — the recorder ran once per attempt but had no
way to know which attempt it was.

**The fix.** The party that observes the timeout is now the party that records
it. `runWithPolicy` takes an optional per-attempt `JobAttemptRecorder`
(`onAttemptStart` / `onAttemptSettled`, reporting `timedOut` at the instant the
guard fires), and `DbJobAdapter` runs the policy itself and records from those
callbacks. An abandoned attempt's late value loses the race and reaches no
observer, so it has no path to the row at all; a per-run latch keeps that
one-terminal-write-per-row invariant explicit. The timer adapters receive a
registration with `retryPolicy`/`timeout` removed, since the wrapper above them
now applies both.

- `sys_job_run.status` is `timeout` for a run that blew its limit, with the
  guard's message in `error` and `duration_ms` measuring the abandoned attempt.
- `sys_job.last_status` is `timeout` and `failure_count` increments: a run that
  never finished is a failure, and alerting keys on that count.
- `sys_job_run.attempt` carries the real attempt number, so a retry lands `2`.
- `replay()`'s synthetic row now mirrors any terminal status of the run it
  replayed (it already did this for `degraded`), instead of pairing an honest
  `timeout` row with a `success` one.

Additive: a handler that finishes inside its timeout, or that carries no
`timeout`/`retryPolicy` at all, records exactly what it recorded before.
