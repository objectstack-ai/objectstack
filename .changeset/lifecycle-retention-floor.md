---
"@objectstack/objectql": minor
"@objectstack/service-queue": patch
---

fix(objectql,service-queue): a `lifecycle` settings override can no longer undercut a consumer's retention floor (#5195)

ADR-0057 P4 lets an operator override any object's retention window per
environment and per tenant through the `lifecycle` settings namespace. Until now
the only validation on that override was **does it parse** — and a retention
window is not only the operator's business: other code can depend on the rows
still being there.

`sys_job_queue` is the worked example. `DbQueueAdapter` deduplicates publishes by
comparing a terminal row's `created_at` against its idempotency window, so the
dedup check only means anything while that row still exists; #5179 made the
ordering an invariant by refusing, at construction, an idempotency window longer
than the object's **declared** retention. A settings override the constructor
cannot see walks straight around it:

```jsonc
// lifecycle → retention_overrides
{ "sys_job_queue": { "maxAge": "1h" } }
```

completed rows are reaped an hour after they are written, publish keeps
deduplicating against 24h, and duplicate deliveries resume **with nothing in any
log**.

**New: retention floors.** A consumer may now declare, at runtime, the shortest
window its own contract survives:

```ts
lifecycle.registerRetentionFloor('sys_job_queue', {
  policy: 'retention',          // or 'ttl'
  minWindowMs: 24 * 60 * 60 * 1000,
  declaredBy: 'com.objectstack.service.queue',
  consequence: '…what silently breaks below it',
  remedy: '…the settings change that makes an override legal',
});
```

- An override below the floor — **global or tenant-scoped** — is **rejected**,
  and the declared window keeps running. Not clamped to the floor: clamping
  would enforce a third number written in neither the declaration nor the
  settings, and that number would move whenever an unrelated package changed
  its floor. Rejection has exactly one fallback, the declaration, which is
  already how an unparseable override resolves.
- The rejection is `error`-level and carries both the consequence and the fix,
  because what it prevents leaves the system looking entirely healthy. It is
  also on the sweep report as `LifecycleSweepReport.floorViolations` — machine-
  readable, every sweep.
- A **declared** window below a registered floor is reported the same way and
  still enforced: refusing to reap would trade a broken consumer contract for
  the unbounded table #5179 just closed.
- Objects with no registered floor are completely unaffected — P4 overrides
  behave exactly as before.

Floors are runtime wiring, not spec surface (the same call ADR-0057's reap-guard
amendment makes), plus a reason of their own: the queue's floor **is**
`DbQueueAdapterOptions.idempotencyWindowMs`, a per-kernel construction option, so
a static key on the object's `lifecycle` block could only ever be a second copy
of it that drifts. No `packages/spec` change.

`QueueServicePlugin` registers `sys_job_queue`'s floor on `kernel:ready`,
carrying the window the adapter was actually constructed with — so a non-default
`db.idempotencyWindowMs` is covered too. The ordering is now enforced from both
sides: the constructor rejects a too-long `idempotencyWindowMs`, the floor
rejects a too-short `maxAge`.

New exports from `@objectstack/objectql`: `LifecycleRetentionFloor`,
`LifecycleFloorViolation`, plus `LifecycleService.registerRetentionFloor()`.
`LifecycleLoggerLike` gained an optional `error()` (absent ⇒ falls back to
`warn`), and `LifecycleSweepReport` gained `floorViolations`.
