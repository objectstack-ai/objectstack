---
'@objectstack/core': patch
---

fix(core): a failed boot destroys every plugin whose `init()` ran, not only the ones that started

Clause-②: no
Metadata-protocol: none

`ObjectKernel.bootstrap()` used to roll back only the plugins whose `start()` had succeeded. A plugin that opened a resource in `init()` (a pool, a client, a timer) kept it after a refused boot if it never got to a successful `start()`: its own `start()` threw, an earlier plugin's `start()` failed first, or a later plugin's `init()` refused the boot. A failed boot leaves the kernel `stopped`, `shutdown()` on it does nothing, and so no `destroy()` ever ran. A normal shutdown does destroy such a plugin.

- **What changes.** With `rollbackOnFailure` on (the default), a failed boot now destroys every plugin whose `init()` finished, in reverse init order, at whatever point the boot fails: a later `init()`, a `start()`, the system-requirement check, or a `kernel:ready`, `kernel:bootstrapped` or `kernel:listening` handler. Before, a failure during `init()` destroyed nothing at all.
- **What stays the same.** A plugin whose `init()` threw or never ran is not destroyed. A plugin with no `destroy()` is skipped. A `destroy()` that throws is logged and the other plugins are still destroyed. The error the boot rejects with is the same as before. `rollbackOnFailure: false` still leaves every plugin as it is.
- **No plugin is destroyed twice.** The rollback after a failed `start()` now runs with the kernel `stopping`, as the later-phase rollback already did. A `shutdown()` called from inside a `destroy()` during that rollback is ignored now. Before, it destroyed every plugin a second time.
- **For plugin authors.** On a failed boot, `destroy()` can now run without `start()` having run first. Release only what `init()` or `start()` actually set up, for example with `this.pool?.end()`.
