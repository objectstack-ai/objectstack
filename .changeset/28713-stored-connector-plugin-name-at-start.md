---
"@objectstack/service-automation": patch
"@objectstack/core": patch
---

fix(service-automation): a stored connector under a host plugin connector's name is skipped at start, as it is while the platform runs

Clause-②: yes (widening) — `@objectstack/core` adds one read-only public member, `dispatchesBootPhaseHooks()`, on `ObjectKernel` and `ObjectKernelBase` (so `LiteKernel`); no accepted value changes.

Metadata-protocol: none

- **Now.** A provider-bound connector saved in the environment (through the metadata door or Studio) under the name of a connector that a plugin on the host provides is treated at start exactly as it is while the platform runs: the plugin's connector is served under that name, and the saved connector is not served, with the same log record naming it. Connectors saved in the environment are now materialized once every plugin has started, still before the server accepts requests.
- **Unchanged.** A connector the host's own stack declares, and an installed package's, keep their start behavior, including when their name collides with a plugin's connector.
- **`@objectstack/core`.** `ObjectKernel.dispatchesBootPhaseHooks()` answers whether `bootstrap()` dispatches `kernel:ready`, `kernel:bootstrapped` and `kernel:listening` once every plugin has started (`false` exactly when the `bootPhaseHooks` option is `false`); `LiteKernel` always answers `true`. A plugin that leaves part of its start to one of those hooks reads it during its own `start()`. On a kernel that does not dispatch them, or a host that does not say, saved connectors are materialized during the automation plugin's own start, as before.
