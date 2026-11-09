---
'@objectstack/service-job': patch
---

fix(service-job): a scheduled fire renews its cluster lease while it runs, so a long job no longer starts on a second node

Clause-②: no
Metadata-protocol: none

A scheduled fire takes the cluster lock `job:NAME` with a 60-second lease (`leaseMs`) and used to never renew it. On a deployment with several nodes, a run that outlasted the lease freed the key while still running, and another node's next tick took it and started the same job, so a large sync or report ran on two nodes at once.

`CronJobAdapter` now renews the handle it acquired every `leaseMs / 3` (20 s by default) while the handler runs, through the lock handle's own `renew()`, and stops renewing in the same `finally` that releases the lock. Nothing new is persisted: a node that dies stops renewing and the key frees itself on its lease as before. A run shorter than a third of the lease is never renewed, and `once` jobs behave as before.

If a renewal fails, the run is not cancelled. The adapter logs one `warn` per failure naming the job and the error. While the handle still reports it holds the lock, the next heartbeat tries again; once the lease is lost, renewal stops for that run, and another node's next tick may take the key and start the job there too. The in-process latch from the previous fix still keeps this node from overlapping itself.
