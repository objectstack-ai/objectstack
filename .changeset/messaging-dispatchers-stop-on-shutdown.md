---
"@objectstack/service-messaging": patch
---

**Fix:** `MessagingServicePlugin` now releases its delivery dispatchers on `kernel.shutdown()`. Previously they kept running after shutdown had resolved (#9371).

The plugin starts two `setInterval` dispatchers at `kernel:ready` — `NotificationDispatcher` over `sys_notification_delivery` and `HttpDispatcher` over `sys_http_delivery` — and released them from a method named `stop()`. The kernel's plugin teardown hook is `destroy()` (`Plugin.destroy?()` in `@objectstack/core`; the only teardown `ObjectKernel.performShutdown()` and `LiteKernel.destroy()` invoke), and `stop()` is not on that interface, so **nothing ever called it**. Both dispatchers went on claiming and updating delivery rows after `await kernel.shutdown()` returned. Measured on the new pin: 48 further delivery reads/writes in the 80 ms following a resolved shutdown.

The teardown body now lives on `destroy()`. `stop()` is **retained as an alias** — it is public API of an exported class, and an embedder may well have learned to call it directly precisely because the kernel never did. No call site has to change, and no accept/reject behaviour of any contract moves.

**Why it was invisible in production, and where the bill landed.** `start()` `unref()`s both timers, so a long-lived host process still exits and the leak is silent. Under vitest the worker process is alive throughout teardown, so a tick fires *after* a test file is over, reads a delivery table through a driver the suite already disconnected, and `SqlDriver`'s console fallback warns. `console.*` inside a vitest worker is an RPC to the main process (`onUserConsoleLog`); one issued after `rpcDone()` has snapshotted the pending set is rejected by `$rejectPendingCalls` as `EnvironmentTeardownError: [vitest-worker]: Closing rpc while "onUserConsoleLog" was pending`. Nothing awaits that promise, so it lands as an unhandled rejection and fails a run in which every test passed — twice measured on `examples/app-showcase` (334/334 and 337/337 green, exit 1, a merge-queue eviction each time). The width of the window is the duration of `rpcDone()`, which is why it only ever fired on a loaded queue runner and never on the PR-side run of the identical diff.

Suites that boot a kernel with this plugin get quieter and finish cleaner as a result: over 48 loaded runs of the affected showcase file, console output emitted after the file's own `afterAll` went 3 → 0, and console RPC round-trips per run roughly halved (6574 → 3456 in aggregate).
