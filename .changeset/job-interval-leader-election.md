---
"@objectstack/service-job": patch
---

fix(service-job): leader-elect `interval` schedules on multi-replica deployments (#13686)

`DbJobAdapter` — the adapter a production assembly upgrades to — routed a
`type: 'cron'` schedule to `CronJobAdapter`, which takes a per-fire cluster lock
(`job:<name>`, `waitMs: 0`) before running the handler, and routed a
`type: 'interval'` schedule to `IntervalJobAdapter`, which has no lock at all.
So on a 3-replica cluster every replica armed its own `setInterval` and every
tick executed three times. #2219 declared the capability as leader-electing
scheduled **cron/interval** jobs across the cluster; only the cron half enforced
it.

Reported from a live 3-replica deployment (traefik → 3 app replicas, shared
postgres + redis, `OS_CLUSTER_DRIVER=redis`) with the fence counter
`os:fence:job:ts:*` measured flat for 100 s while eight 60 s interval jobs ran —
where the same jobs on cron expressions increment it once per replica per tick.
Duplicate *business effects* were mostly masked by per-handler de-duplication
and staggered container start times; the writes de-duplication did not cover
were not — one SLA escalation delivered its notifications twice to each of three
recipients, six inserts inside a 54 ms window.

**What changed.** `DbJobAdapter.schedule()` now delegates `interval` to the same
`cron` adapter it already delegates `cron` to — `CronJobAdapter` has always
handled `type: 'interval'` itself and fires it through the same leader-elected
`runScheduled()` — so an interval fire acquires the `job:` lock and the replicas
that lose it skip that tick. Both delegated types are still registered on the
inner adapter through the new `IntervalJobAdapter.register()`, which stores a
registration **without arming a timer**, so `trigger()`, `replay()`,
`getExecutions()` and `listJobs()` are unchanged and one process never holds an
elected timer beside an unelected one.

**Unchanged on purpose.** Cron routing and cron behaviour; manual `trigger()`,
which is deliberately not leader-elected (an operator is asking *this* node to
run the job now); `once` schedules; the `sys_job` / `sys_job_run` writes. With no
cluster driver configured the lock is always granted, so single-node scheduling
is byte-for-byte what it was. With no cron adapter assembled at all
(`enableCron: false`, or its construction threw) an interval job still fires on
the inner timer exactly as before — unelected, and now saying so in a warning
rather than surfacing only as duplicate rows.

No new configuration key: #2219 declared this as the behaviour, and putting it
behind a switch would re-open the same declared-≠-enforced gap on the switch.
