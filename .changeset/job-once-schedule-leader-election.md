---
"@objectstack/service-job": patch
---

fix(service-job): leader-elect `type: 'once'` schedules on `DbJobAdapter` (#13918)

`DbJobAdapter.schedule()` decides which adapter owns a scheduled fire, and only
`CronJobAdapter` takes the cluster lock (`runScheduled()` -> `lock.acquire('job:'
+ name, { waitMs: 0 })`). `cron` schedules were routed there from the start and
`interval` schedules since #13686 — but `once` schedules still went to the inner
`IntervalJobAdapter`, a bare `setTimeout` with no lock. On a multi-replica
deployment a one-shot job therefore ran **once per replica**, not once per
cluster, and a one-shot is the worst-shaped of the three: there is no later tick
during which a business-level de-duplication marker could win, so every replica's
copy lands inside the same short window.

`once` now takes the same leader-elected path as `cron` and `interval` whenever a
cron adapter is assembled, and stays registered on the inner adapter via
`register()` (stored, not armed), so `trigger()`, `replay()`, `getExecutions()`
and `listJobs()` answer for it exactly as before. Affected paths in this repo:
the automation wait-node's timer resume and its cold-boot re-arm
(`@objectstack/service-automation`), schedule-triggered flows with an `at`
(`@objectstack/trigger-schedule`), and app-declared jobs with a `once` schedule
(`@objectstack/runtime`).

**Behaviour change, on multi-replica assemblies only.** A `once` job now fires on
one replica per cluster instead of on every replica. Single-node behaviour is
unchanged in both assemblies: with a cron adapter and no cluster driver the lock
is always granted, and with no cron adapter at all the job still fires on the
inner timer exactly as before. The semantics are **at-most-once per cluster**
(maintainer ruling 2026-09-01): election decides who fires, not that the fire
survives — a leader that dies mid-fire loses it, and nothing re-arms it. That
takes nothing away, because the previous unelected `setTimeout` was not persisted
either and the same crash lost it on every replica at once. No re-arm, retry or
persistence mechanism is added.
