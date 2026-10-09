---
'@objectstack/core': minor
---

fix(core)!: a `gracefulShutdown: false` kernel no longer exits the process when its teardown times out

Clause-②: no

<!-- adr-0087: not-required (no-migration-prescription) No metadata moves: no spec key, authorable spelling, export, option, type or stored shape is added, removed, renamed or re-shaped, and no stored row is read, rewritten or converted, so there is nothing for `objectstack migrate meta` to rewrite. What changes is a runtime behaviour of `ObjectKernel.shutdown()` under an existing option: on a teardown timeout a `gracefulShutdown: false` kernel returns to its host instead of calling `process.exit(1)`. The other categories are closed on facts: `@objectstack/core` publishes (not unpublished); no ADR-0087 id is named or touched (not registered or already-registered); and no TypeScript declaration moves, only a JSDoc comment (not runtime-interface-only or type-surface-only). -->

**BREAKING** for a host that builds `ObjectKernel` with `gracefulShutdown: false` and counted on the kernel to end the process when a teardown hung: a behaviour change, shipped as `minor` under the launch-window convention for breaking changes.

- **What changes.** When `shutdown()` overruns `shutdownTimeout`, a kernel built with `gracefulShutdown: false` no longer calls `process.exit(1)`. It logs the timeout at `error`, marks itself `stopped`, and `shutdown()` resolves, so the host decides whether the process exits. The hung teardown is not cancelled: it keeps running in the background and holds whatever it has not released until it finishes or the process ends.
- **Why.** `gracefulShutdown: false` already meant that the host, not the kernel, handles the process signals, and the kernel lifecycle docs say such a kernel stays out of the process-management business. The timeout branch did not read the option. So a host that runs several `false` kernels in one process, one per environment, lost all of them when one environment's teardown hung.
- **Unchanged.** With `gracefulShutdown: true` (the default; the kernel installs its own SIGINT, SIGTERM and SIGQUIT listeners) a genuine timeout still logs `Shutdown timed out — forcing exit` and calls `process.exit(1)`. A teardown that throws instead of hanging still never exits the process, under either setting. `shutdown()` still never rejects, and no option, key or export is added. Every kernel `@objectstack/cli` builds takes the default, so its commands behave as before.
- **Who must act.** A host that sets `gracefulShutdown: false` (a server framework with its own signal handlers, or a host running one kernel per environment in one process) and relied on that exit to end a process whose teardown hung. Such a host already handles the signals itself; it now also ends the process itself. Call `process.exit()` in that host once `await kernel.shutdown()` returns, instead of waiting for the event loop to drain: `shutdown()` returns within `shutdownTimeout` whether or not the teardown finished, but a hung teardown can keep the loop alive after it. The timeout is reported in the kernel's `error` log line.
