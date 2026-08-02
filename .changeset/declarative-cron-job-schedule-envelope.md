---
"@objectstack/runtime": patch
"@objectstack/observability": patch
---

fix(runtime): declarative `defineJob` cron jobs are actually scheduled (#4567)

Every background job authored as `defineJob({ schedule: { type: 'cron', … } })`
was **silently never scheduled**. `JobSchema.parse` rewrites the cron
`expression` into the canonical expression envelope
(`{ dialect: 'cron', source: '0 1 * * *' }` — the authoring/persistence tier),
but `AppPlugin` handed `job.schedule` verbatim to `IJobService.schedule`, whose
boundary contract documents `expression` as a **bare cron string** because
`CronJobAdapter` passes it straight to croner. croner rejected the object
(`CronPattern: Pattern has to be of type string.`), the throw was swallowed by a
per-job `try/catch` that only `warn`ed, and the author saw a green build and a
green boot with the job never running. `interval` / `once` schedules and
flow `schedule` triggers were unaffected.

**Fix (contract-first).** The authoring→boundary downgrade now happens at the one
place the two tiers meet — `AppPlugin`'s declarative-job registration, alongside
the existing `retryPolicy` / `timeout` threading — via
`toBoundaryJobSchedule()`. The adapters stay strict: no `typeof === 'object'`
tolerance was added downstream, so the boundary keeps exactly one shape.
A schedule that cannot be reduced to it (unknown type, AST-only or non-`cron`
expression envelope, missing `intervalMs` / `at`) is rejected by name.

**The failure path is no longer silent.** A job that cannot be scheduled now logs
at **error** level with its own message (`Background job FAILED TO SCHEDULE — it
will never run`), plus a boot summary line when any job failed, and increments
the new `job_schedule_failures_total` counter
(`SEMCONV.jobScheduleFailuresTotal`, labels `app` / `job`) on the observability
metrics registry. "Failed to schedule" no longer shares the quiet `warn` used by
"handler not found in bundle.functions" — the first is an outage of declared
work, the second is a job that was never going to run.

No authoring change is required: existing `defineJob` cron declarations start
working on upgrade.
