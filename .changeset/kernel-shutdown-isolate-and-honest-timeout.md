---
"@objectstack/core": patch
---

fix(core): one throwing `kernel:shutdown` handler no longer skips every plugin `destroy()` and kills the process under a false "Shutdown timed out" (#5274)

**On `ObjectKernel`, a single bad shutdown subscriber used to end the entire teardown
and `process.exit(1)` the host — reporting a timeout that never happened.**

`performShutdown()` dispatched `kernel:shutdown` through `context.trigger` (a bare
awaited loop that never catches), so the first handler that threw propagated out to
`shutdown()`'s `Promise.race` catch. That catch was written for the timeout race alone
and treated every exception as one, producing three consequences at once:

1. the remaining `kernel:shutdown` handlers never ran;
2. **every** plugin's `destroy()` was skipped — the reverse-order destroy pass sits
   after the trigger in `performShutdown()`, so it was never reached;
3. the process was killed by `process.exit(1)` under the log line
   `Shutdown timed out — forcing exit`, while nothing had timed out — sending whoever
   read it to the `shutdownTimeout` config for a handler bug.

Two changes, matching the reasoning #5257 recorded at `LiteKernel`'s shutdown dispatch
site:

- **`kernel:shutdown` now dispatches ISOLATING on `ObjectKernel` too.** A handler that
  throws is logged as `Hook handler failed: kernel:shutdown` and the remaining handlers
  still run, followed by the reverse-order `destroy()` pass and the `onShutdown()`
  handlers — both of which already isolated per plugin and per handler. What is queued
  behind a failing shutdown handler is the cleanup that flushes buffers, closes
  connections and releases locks, so one bad handler must not amplify into leaks and
  unflushed writes. The BOOT-path hooks are untouched: `kernel:ready`,
  `kernel:bootstrapped` and `kernel:listening` still propagate and still fail the boot
  (#5170, #5257).
- **The timeout catch now handles only a genuine timeout**, discriminated by identity on
  the timer's own rejection — not by message, not by type, so nothing a plugin throws
  can impersonate it. A genuine `shutdownTimeout` overrun is **unchanged**: it still
  logs `Shutdown timed out — forcing exit` and still calls `process.exit(1)`, because
  teardown really is hung and the process would otherwise hold what it failed to
  release. Any other exception is logged at `error` and follows the normal path —
  `state = 'stopped'`, return — with no `process.exit`, leaving an embedding host
  (cloud auth-proxy, CLI, a test runner) its own chance to finish cleanly.

`shutdown()` still never rejects, so no existing caller changes. Telling the two paths
apart is the point of the fix, and both are pinned by named tests.
