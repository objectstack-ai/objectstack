---
'@objectstack/service-job': patch
'@objectstack/service-automation': patch
---

Job runs that finish without doing their work are now audited as `degraded`, not `success` (#5548)

`DbJobAdapter` decided a run's outcome solely by whether the handler threw, so a
handler that failed internally and deliberately did not throw was recorded as
`sys_job_run.status: 'success'` — the audit surface Studio's jobs view reads
reported the one thing that had definitely not happened.

The adapters now consume the `JobRunOutcome` channel `JobHandler` gained in
#6617, using the `degraded` status vocabulary added in #7072:

- a handler resolving `{ outcome: 'degraded', reason? }` lands
  `sys_job_run.status: 'degraded'` with the reason in `error`, and mirrors onto
  `sys_job.last_status` / `last_error`;
- `degraded` is not a failure: `failure_count` stays flat and nothing retries
  (retry keys on a rejected promise only, unchanged);
- `IntervalJobAdapter` / `CronJobAdapter` report the same verdict through
  `getExecutions()`, so the in-memory history and the persisted row agree.

Strictly additive: a handler that resolves `undefined` — every handler written
before #6617 — is still recorded as `success`, byte for byte as before.

The first adopter is the `wait` node's timer wake-up: a shot that fires into an
unreachable suspended-run store now reports `degraded` / `STORE_UNAVAILABLE`
while still keeping its one-shot armed and its `sys_job` row active (#5529).
