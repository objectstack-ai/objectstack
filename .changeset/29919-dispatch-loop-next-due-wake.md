---
'@objectstack/core': patch
'@objectstack/service-messaging': patch
'@objectstack/service-queue': patch
---

fix(core,service-messaging,service-queue): an idle dispatch loop wakes at the next due time, and a sole writer's loop no longer re-runs the idle ramp after every boot

Clause-②: yes (widening)
Metadata-protocol: none

- **`@objectstack/core`: `DispatchLoop` wakes at the next due time.** A new optional `DispatchLoopOptions.nextDueAt()` answers the earliest instant work becomes claimable (a deferred row, a claim's expiry). The loop asks it once per idle streak, after the first empty tick, and never sleeps past the answer, so a deferred row goes out within one tick of coming due whatever `maxIdleIntervalMs` is. The answer is remembered rather than re-read on every ceiling tick, so an idle loop's steady-state cost is unchanged; the new `DispatchLoop.wakeAt(dueAtMs)` lets a producer in the same process announce a deferred row at no read. An answer at or before the tick that found nothing is not chased, and a rejected tick or read still counts as idle, so neither can make the loop spin.
- **`@objectstack/core`: `DispatchLoopOptions.soleWriter`** (default `false`). On a host where no other process writes the store, an empty tick sleeps straight to the next due time or the ceiling instead of re-running the ramp from `intervalMs`, which only ever bought latency on rows another process wrote. A fresh sole-writer loop over an empty store now ticks once in its first minute; before, every boot re-ran the ramp (six ticks in the first minute at the dispatchers' 500 ms base, five at the queue's 1 s).
- **`@objectstack/service-messaging`:** `INotificationOutbox.nextDueAt` / `IHttpOutbox.nextDueAt` (optional; both built-in stores implement it: two reads, the earliest future `next_attempt_at` / `next_retry_at` and the oldest `in_flight` claim plus the claim TTL), wired into `NotificationDispatcher` and `HttpDispatcher`; `soleWriter` on both dispatchers' options, and `dispatchSoleWriter` on `MessagingServicePlugin`. Retries, quiet hours, digest windows and a crashed node's claims are taken at their due time instead of up to `dispatchMaxIdleIntervalMs` late.
- **`@objectstack/service-queue`:** `DbQueueAdapter` reads the earliest future `scheduled_for` of its subscribed queues (one read per idle streak), a deferred `publish()` announces its due time to the loop through `wakeAt` instead of waiting out the backoff, and `DbQueueAdapterOptions.soleWriter` (reachable as `QueueServicePlugin` `db.soleWriter`) skips the ramp.

Nothing changes for a host that sets neither `soleWriter` flag except the due-time wake: the ramp keeps its shape, cut short only when a due row is earlier, and an idle stretch costs one extra read at its start.
