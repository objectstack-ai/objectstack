---
'@objectstack/service-messaging': minor
---

`HttpDispatcher` reaps once per tick instead of once per partition, backs off while `sys_http_delivery` is idle, and `enqueueHttp()` / `redeliverHttp()` wake it (#17623)

**What an idle dispatcher cost.** Against an EMPTY `sys_http_delivery` outbox every tick walked `partitionCount` partitions (default 8) and ran `claim()` in each — and each claim opened with the environment-wide visibility-timeout reap before its candidate SELECT. Measured on a real `ObjectQL` + `SqlDriver`: **16 SQL statements a tick, 8 of them the identical reap UPDATE**, on a fixed 500 ms `setInterval` that never let up, one loop per warm kernel. It is the shape #17610 removed from `NotificationDispatcher`, still running beside it. On remote Turso every statement is an HTTP round trip.

**Now:**

- **The reap runs once per tick**, before any claim — an idle tick is `1 + partitionCount` = 9 statements. Its predicate names no partition, so one run returns every claim that had expired when the tick began; a claim that expires during the tick is returned by the next one. A crashed node's `in_flight` rows are still recovered within one tick of `claimTtlMs` passing, and a claim is still never re-taken before its TTL.
- **The loop backs off while idle.** Every tick that claims nothing doubles the delay to the next, from `intervalMs` up to `maxIdleIntervalMs` (default 30 s, the notification dispatcher's default). A tick that claims work snaps back to `intervalMs`. With the defaults, ten idle minutes are 24 ticks and 216 statements instead of 1,201 ticks and 19,216.
- **`MessagingServicePlugin`'s `dispatchMaxIdleIntervalMs` sets the ceiling for both dispatchers**, the way `dispatchIntervalMs` and `partitionCount` already govern both.
- **Writes in this process wake the dispatcher.** `MessagingService.setHttpOutbox(outbox, { onEnqueued })` fires after an `enqueueHttp()` that enqueues a delivery — not one that parks an undeliverable record, which is `dead` on arrival — and after a `redeliverHttp()`. The plugin points it at the new `HttpDispatcher.wake()`, which ticks immediately, or once more right after a tick already in flight.

**Latency bound.** A delivery enqueued or redelivered in the process that runs the dispatcher goes out on the tick `wake()` starts. While idle, work nobody announces is noticed within one backed-off interval, at most `maxIdleIntervalMs` (30 s by default):

- a retry coming due is attempted less than `min(its delay + intervalMs, maxIdleIntervalMs)` late, because the backoff restarts from `intervalMs` at the attempt that scheduled it;
- a row enqueued by a process that does not run this dispatcher;
- a crashed node's expired claim, recovered within `claimTtlMs` + `maxIdleIntervalMs` (about 35 s at defaults, where it was about 5.5 s).

Set `dispatchMaxIdleIntervalMs` to `dispatchIntervalMs` to keep the fixed interval.

**Contract additions — all optional, nothing to change on upgrade.** `IHttpOutbox` gains an optional `reap(opts: HttpReapOptions)` — the visibility-timeout recovery `claim()` already opens with, as a method of its own — and `HttpClaimOptions` gains an optional `skipReap`. Both built-in stores (`SqlHttpOutbox`, `MemoryHttpOutbox`) implement them. A custom outbox without `reap()` keeps working as it is: the dispatcher probes for the method and, when it is absent, lets each claim reap as before — correct, at the old per-claim cost. Direct callers of `claim()` are unaffected: without `skipReap` they reap exactly as before. Also new: `HttpDispatcher.wake()`, the dispatcher's `maxIdleIntervalMs` option, the `HttpReapOptions` type, and `MessagingService.setHttpOutbox`'s optional second argument.

**One loop, not two copies.** The timer loop — idle backoff, collapsing wakes into one follow-up tick, `stop()` — moved out of `NotificationDispatcher` into a module both dispatchers share. `NotificationDispatcher`'s behaviour and public surface are unchanged; its #17610 tests pass as they were.
