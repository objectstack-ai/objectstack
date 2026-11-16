---
'@objectstack/service-job': patch
---

fix(service-job): kernel shutdown waits for a scheduled job run already in flight, or settles its run row as interrupted

Clause-②: no
Metadata-protocol: none

The kernel destroys plugins in reverse order, so the job service is destroyed before the driver it writes through. `IntervalJobAdapter.destroy()` and `CronJobAdapter.destroy()` stopped their timers and returned at once, while a scheduled run could still be executing. That run then met the released driver: its body failed, its `sys_job_run` row could not be updated and stayed `running` for good, and the `sys_job` counters were not bumped (`DbJobAdapter: failed to update sys_job_run`, `DbJobAdapter: bumpJob failed`). In the cloud runtime a kernel is evicted routinely, so every eviction with a scheduled run in flight could leave such a row.

- Both timer adapters now wait in `destroy()` for the scheduled run they hold in flight, for at most `shutdownDrainMs` (a new constructor option, default 10000 ms, inside the kernel's 60 s `shutdownTimeout`). A run that ends inside that bound writes its own terminal row as before. A tick that comes due while `destroy()` runs does not start a new run.
- A run still going when the bound passes is named in one `warn`. If it runs under `DbJobAdapter`, its row is settled before the driver goes: `status: 'failed'`, with an `error` that says it was interrupted by shutdown, and `sys_job` records it like any other failed run. No new status value is added. When the abandoned handler finishes later, nothing more is written. No scheduled run starts a retry attempt after shutdown has begun.
- `DbJobAdapterOptions.shutdownDrainMs` sets the bound for the adapter's own timer (the fallback used when there is no cron adapter). A cron adapter you pass in uses its own option.
- Manual `trigger()` and `replay()` runs are not changed. Their callers await them.
