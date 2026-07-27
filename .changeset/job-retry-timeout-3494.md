---
"@objectstack/spec": minor
"@objectstack/service-job": minor
"@objectstack/runtime": minor
---

feat(job): honor the authored `retryPolicy` / `timeout` in the job scheduler (#3494)

`JobSchema.retryPolicy` and `JobSchema.timeout` used to be parsed-but-ignored
(the 2026-06 liveness audit's aspirational-config cluster). They are now
enforced end to end — built rather than pruned, since retry/backoff and
per-run time limits are semantics job authors reasonably expect:

- **spec**: `IJobService.schedule` gains an optional 4th `options` argument
  (`JobScheduleOptions` with `retryPolicy` / `timeout`, mirroring the
  authorable schema); new `JobRetryPolicy` type. Backward compatible —
  existing 3-arg implementations and callers are unaffected.
- **service-job**: new `runWithPolicy` helper (exported, with
  `JobTimeoutError`) wraps every handler invocation in `CronJobAdapter` and
  `IntervalJobAdapter`; `DbJobAdapter` threads options through to its inner
  adapters. Failed attempts (including timeouts) retry with exponential
  backoff `backoffMs * backoffMultiplier^(retry-1)` up to `maxRetries`;
  an attempt exceeding `timeout` is recorded with execution status
  `'timeout'`. No `options` → exactly the legacy single-attempt behavior.
- **runtime**: declarative-jobs registration in AppPlugin forwards the
  authored `retryPolicy` / `timeout` to the scheduler.

Note: JavaScript cannot forcibly cancel an in-flight handler — a timed-out
attempt is abandoned, not killed. The retry delay caps only via the
multiplier arithmetic (no maxDelay knob yet).

Refs #3494, #1878, #1893.
