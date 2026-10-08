---
'@objectstack/core': patch
---

fix(core): a stopped `ObjectKernel` removes its SIGINT/SIGTERM/SIGQUIT listeners and never exits the process

Clause-②: no

- **What was wrong.** With `gracefulShutdown: true` (the default) the constructor added one listener per signal and kept no handle, so `shutdown()` never removed them. Every kernel a process built left three listeners behind, and each one called `process.exit(0)` on the next signal. A process that had built and stopped five kernels and still ran a sixth exited six times on one SIGTERM, and the first exit landed before the live kernel had drained. Eleven built-and-stopped kernels also tripped Node's `MaxListenersExceededWarning`.
- **What a kernel does now.** It holds its listeners from construction until it reaches `stopped`, and removes them at that point, whichever way it got there: `shutdown()` completing, the shutdown timeout, or a failed `bootstrap()`. A stopped kernel has no listener, so it cannot handle a signal. While a kernel is `stopping` its listener stays installed, so a repeated signal is absorbed and does not trigger Node's default action mid-drain.
- **Who exits the process.** Only the handler whose signal started the drain, and only once. A signal that arrives while the host is already stopping the kernel through `shutdown()` is logged and left to the host. The kernel no longer exits the process in that case.
- **Unchanged.** A running kernel still drains and exits with code 0 on SIGINT, SIGTERM or SIGQUIT (code 1 if `shutdown()` throws). `gracefulShutdown: false` still installs nothing. A genuine shutdown timeout still calls `process.exit(1)`.
