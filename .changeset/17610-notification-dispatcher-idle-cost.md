---
'@objectstack/service-messaging': minor
---

`NotificationDispatcher` reaps once per tick instead of once per claim, backs off while the outbox is idle, and `emit()` wakes it (#17610)

**What an idle dispatcher cost.** Against an EMPTY `sys_notification_delivery` outbox every tick walked `partitionCount` partitions (default 8) and ran `claim()` and `claimDigest()` in each — and each of those opened with the environment-wide visibility-timeout reap before its candidate SELECT. Measured on a real `ObjectQL` + `SqlDriver`: **32 statements a tick, 16 of them the identical reap UPDATE**, on a fixed 500 ms interval that never let up, one loop per warm kernel. On remote Turso every statement is an HTTP round trip.

**Now:**

- **The reap runs once per tick**, before any claim — an idle tick is `1 + 2 × partitionCount` = 17 statements. Its predicate names no partition, so one run returns every claim that had expired when the tick began; a claim that expires during the tick is returned by the next one. A crashed node's `in_flight` rows are still recovered within one tick of `claimTtlMs` passing, and a claim is still never re-taken before its TTL.
- **The loop backs off while idle.** Every tick that claims nothing doubles the delay to the next, from `intervalMs` up to `maxIdleIntervalMs` (default 30 s; `MessagingServicePlugin` option `dispatchMaxIdleIntervalMs`). A tick that claims work snaps back to `intervalMs`. With the defaults, ten idle minutes are 24 ticks instead of 1,201.
- **`emit()` wakes the dispatcher.** `MessagingService.setOutbox(outbox, { onEnqueued })` fires once per `emit()` that enqueued at least one delivery; the plugin points it at the new `NotificationDispatcher.wake()`, which ticks immediately — or once more, right after a tick already in flight.

**Latency bound.** A notification emitted in the process that runs the dispatcher goes out on the tick `wake()` starts, no later than before. While idle, work nobody announces is noticed within one backed-off interval, at most `maxIdleIntervalMs` (30 s by default): a deferred delivery coming due (retry schedule, quiet hours, digest window), a row enqueued by a process that does not run this dispatcher, and a crashed node's expired claim (recovered within `claimTtlMs` + `maxIdleIntervalMs`). Set `dispatchMaxIdleIntervalMs` to `dispatchIntervalMs` to keep the fixed interval.

**BREAKING (interface member added):** `INotificationOutbox` gains `reap(opts: ReapOptions)`, and `ClaimOptions` gains an optional `skipReap`. A custom outbox implementation must add `reap()` — the visibility-timeout recovery it already runs at the top of `claim()`, as a method of its own (both built-in stores, `SqlNotificationOutbox` and `MemoryNotificationOutbox`, factor it out exactly that way). Callers of `claim()` / `claimDigest()` are unaffected: without `skipReap` they reap as before.

FROM → TO, for an implementer:

```ts
// FROM
class MyOutbox implements INotificationOutbox {
  async claim(opts: ClaimOptions) { await this.reapExpired(opts.now ?? Date.now(), opts.claimTtlMs); /* … */ }
}
// TO
class MyOutbox implements INotificationOutbox {
  async reap(opts: ReapOptions) { await this.reapExpired(opts.now ?? Date.now(), opts.claimTtlMs); }
  async claim(opts: ClaimOptions) { if (!opts.skipReap) await this.reapExpired(opts.now ?? Date.now(), opts.claimTtlMs); /* … */ }
}
```

Breaking ships as `minor` per the launch-window convention (`scripts/check-changeset-no-major.mjs`).

<!-- adr-0087: not-required (no-migration-prescription) The added member is a runtime TypeScript interface method (`INotificationOutbox.reap` in `packages/services/service-messaging/src/outbox.ts`) plus one optional options key (`ClaimOptions.skipReap`): no Zod schema, no `packages/spec` declaration, no authorable key and no stored representation changes shape — `sys_notification_delivery` rows are byte-identical before and after, so `objectstack migrate meta` has nothing to visit and there is no tombstone to mint. The only affected party, a third-party implementer of the interface, is told by the compiler at the class declaration, which is more precise than a ledger entry. The checkable `runtime-interface-only` spelling is deliberately not claimed, for the reason the `INotificationOutbox.ack` change recorded: `packages/spec/src/api/error-code-ledger.zod.ts` mentions `INotificationOutbox` in a prose comment about the shared `DELIVERY_NOT_ELIGIBLE` code, which that disposition's step-4 scan refuses as an unresolvable mention. -->
