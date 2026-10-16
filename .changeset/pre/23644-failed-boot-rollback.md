---
'@objectstack/core': patch
---

fix(core): a bootstrap that fails after every plugin started rolls them back too, so a driver connected in `start()` is disconnected

Clause-②: no

`ObjectKernel.bootstrap()` rolled back started plugins only when a plugin's `start()` failed. A boot refused later (the system-requirement check, or a `kernel:ready`, `kernel:bootstrapped` or `kernel:listening` handler that throws) left the kernel `stopped` with every plugin still holding what its `start()` took: a datasource driver stayed connected, because `shutdown()` on a stopped kernel is a no-op and nothing else ran any `destroy()`.

- **What changes.** A boot that fails after the last `start()` now destroys the plugins that started, in reverse start order, through the same rollback a failing `start()` already ran. One teardown answers a failed boot at whatever phase it fails. A kernel built with `rollbackOnFailure: false` keeps opting out of both.
- **What does not change.**
  - A readiness or hook failure still rejects with its own error, unwrapped; a failing `start()` still rejects with the error naming the plugin.
  - A `destroy()` that throws during the rollback is logged at `error` and does not replace the boot error; the plugins started before it are still destroyed.
  - A plugin whose `start()` failed or never ran is not destroyed.
  - A failed `start()` still rolls back exactly once.
  - `shutdown()` after any failed boot is still a no-op, so nothing is destroyed twice.
- **Ownership of the teardown.** While the rollback runs the kernel reads `stopping`, so a `shutdown()` or a signal that arrives meanwhile is absorbed. A `shutdown()` that already began mid-boot owns the destroys, and the failed boot adds none.
- **Who is affected.** In-process hosts that await a boot which can be refused after connect: `Runtime.start()`, `bootStack`, tests. `os serve` exits on a refused boot and is not.
- **What to check in a plugin.** A `destroy()` may now run on a plugin whose `kernel:ready` handler never ran, the same tolerance `bootPhaseHooks: false` already asks for. A host that closed such a resource by hand after a refused boot now closes it a second time, so that close should tolerate an already-closed resource.
