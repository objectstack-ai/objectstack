---
'@objectstack/service-job': patch
---

fix(service-job): a scheduled job no longer starts while its own previous run is still in flight

Clause-②: no
Metadata-protocol: none

A job whose run outlasted its interval used to start a second, third and fourth run of itself, on a single node as much as on several. The cluster lock a scheduled fire takes is held for a 60-second lease that is never renewed, so once a run outlived the lease the next tick took the lock again and started an overlapping run (a `job.pull` on a 30-second interval was measured with four runs of the same mapping in flight at once).

Both timer adapters (`CronJobAdapter`, which owns every scheduled fire under `DbJobAdapter`, and `IntervalJobAdapter`, which owns the timer when no cron adapter is assembled) now keep an in-process, per-job in-flight latch: a scheduled tick of a job whose previous scheduled run has not settled on this node is skipped, and logs one `warn` naming the job and when the run still in flight started. A run that finishes inside its interval fires on every tick as before. No `sys_job_run` row is written for a skipped tick, and nothing is persisted, so a restart cannot leave a job blocked.

Manual `trigger()` and `replay()` are not gated: they remain an operator asking this node to run the job now. Across nodes, a second node's fire is still excluded only for the lock's lease; a run longer than the lease can still overlap with a fire on another node.
