---
"@objectstack/platform-objects": minor
"@objectstack/service-queue": minor
---

fix(service-queue): `sys_job_queue` no longer grows forever — `completed` rows expire on a declared 7-day retention (#5179)

`DbQueueAdapter` marked a delivered message `status: 'completed'` and then
**nothing ever touched that row again**. `purge()` had zero production callers
(tests only), `purgeFailed()` is a manual dead-letter API, and the object
declared no lifecycle policy at all — so every queue delivery left a permanent
row, which since #5160 means one permanent row per queued email.

`sys_job_queue` now declares an ADR-0057 policy and the platform
`LifecycleService` enforces it on its existing hourly sweep:

```ts
lifecycle: {
  class: 'transient',
  retention: { maxAge: '7d', onlyWhen: { status: 'completed' } },
}
```

**Only `completed` rows are swept.** `pending` / `running` are live work, and
`failed` / `dlq` are the dead-letter queue — they exist to wait for a human, so
they are never deleted automatically at any age. `listFailed()` / `replay()` /
`purgeFailed()` remain the only way a dead letter leaves the table. This is
also why the policy is `retention` (age + row filter) rather than a `ttl` on
`completed_at`: TTL has no row filter, and `dlq` rows stamp `completed_at` too.

**No new configuration, and no new sweeper.** ADR-0057 §3.3 puts one reaper in
the platform rather than one per plugin — the same call the sibling
`sys_job_run` (30d) already makes. Any kernel with a data engine already runs
it, its per-sweep `[lifecycle] sweep: … ~N rows reaped` line now accounts for
this table too, and the window is overridable per environment through the
`lifecycle` settings namespace without touching code.

**The dedup window is now an enforced invariant, not a coincidence.** Publish
dedups against a terminal row by comparing its `created_at` to
`idempotencyWindowMs` (default 24h), and the reaper cuts off on that same
`created_at` axis — so retention (7d) ≥ dedup window is what keeps "duplicate
publishes inside the window are suppressed" true. `DbQueueAdapter` reads the
declared window (new export `completedRetentionWindowMs()`) and **throws at
construction** if `idempotencyWindowMs` is configured longer than it, instead of
silently degrading into duplicate deliveries days later. If you raise
`idempotencyWindowMs` past 7 days, raise the object's declared retention (or the
`lifecycle` settings override) to match — the error message names both numbers.

`class: 'transient'` is deliberate: `telemetry`/`event`/`audit` classes
relocate their table to the dedicated `telemetry` datasource wherever one is
registered (ADR-0057 §3.6), and moving a live work queue's storage would be a
migration, not a cleanup.
