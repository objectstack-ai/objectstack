---
"@objectstack/core": minor
"@objectstack/service-queue": minor
"@objectstack/service-messaging": patch
---

`DbQueueAdapter` backs off while `sys_job_queue` is idle instead of polling flat at 1 s, and the loop that does it is now published from `@objectstack/core` as `DispatchLoop` (#17612).

A registered-but-idle queue issued **3600 candidate reads an hour, per queue**, whatever was in the table — on a remote driver, 3600 HTTP round trips an hour of pure idle cost. Measured over one simulated idle hour on the engine boundary the adapter really talks to: **3601 reads before, 124 after**, with the flat-poll number re-measured on the same harness as a control so the new one is a reading about the backoff rather than about a loop that stopped ticking.

- **One mechanism, not a third copy.** The idle-backoff loop was written for `NotificationDispatcher` (#17610), shared with `HttpDispatcher` (#17623), and lived unexported inside `@objectstack/service-messaging`. `DbQueueAdapter` was the third polling worker needing it. It moves to `@objectstack/core` — the package all three already depend on — because it is a timing primitive owned by neither the messaging domain nor the queue domain, and having `service-queue` depend on `service-messaging` to reach it would invert the dependency direction. **New export from `@objectstack/core`: `DispatchLoop`, `DispatchLoopOptions`, `DEFAULT_MAX_IDLE_INTERVAL_MS`.**
- **Nothing published moved.** `@objectstack/service-messaging` exports only its `index`, which never carried the loop; its two dispatchers now import it from `@objectstack/core` and its own surface is byte-unchanged.
- **New option `DbQueueAdapterOptions.maxIdleIntervalMs`** (default 30 s). Each tick that claims nothing doubles the delay to the next from `pollIntervalMs` up to this ceiling; anything claimed, and every wake, snaps it straight back. **Setting it at or below `pollIntervalMs` restores the flat poll exactly.**
- ⚠️ **What the backoff costs, and what it does not.** Work published through this adapter now wakes the loop, so a due `publish()` and `replay()` are picked up at the base interval as before — the ceiling is never on their latency path. What it does cost is up to `maxIdleIntervalMs` of extra latency on work this process was never told about: a row another node wrote, a deferred row coming due, a crashed worker's lease expiring. A deferred `publish()` deliberately does **not** wake the loop, since that tick would claim nothing and would throw the backoff away.
