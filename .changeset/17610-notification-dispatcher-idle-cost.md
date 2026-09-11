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

**Contract additions — all optional, nothing to change on upgrade.** `INotificationOutbox` gains an optional `reap(opts: ReapOptions)` — the visibility-timeout recovery `claim()` / `claimDigest()` already open with, as a method of its own — and `ClaimOptions` gains an optional `skipReap`. Both built-in stores (`SqlNotificationOutbox`, `MemoryNotificationOutbox`) implement them. A custom outbox without `reap()` keeps working as it is: the dispatcher probes for the method and, when it is absent, lets each claim reap as before — correct, at the old per-claim cost; implementing `reap()` and honouring `skipReap` is what earns the once-per-tick cost. Direct callers of `claim()` / `claimDigest()` are unaffected: without `skipReap` they reap exactly as before. Also new: `NotificationDispatcher.wake()`, the dispatcher's `maxIdleIntervalMs` option, and `MessagingService.setOutbox`'s optional second argument.
