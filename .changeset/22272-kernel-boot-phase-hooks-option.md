---
"@objectstack/core": minor
---

feat(core): `ObjectKernelConfig.bootPhaseHooks`, a declared option to bootstrap without dispatching `kernel:ready`, `kernel:bootstrapped` and `kernel:listening`

Clause-②: yes (widening)

- **What is new.** `new ObjectKernel({ bootPhaseHooks: false })` runs dependency ordering, every plugin's `init()`, the core-service fallbacks, every plugin's `start()` and the system-requirement check exactly as before. It then stops without dispatching the three boot-phase hooks, and the kernel is `running`. Only an explicit `false` withholds them. An absent option or `undefined` keeps today's boot, unchanged. `Runtime` forwards the option through its existing `kernel` config.
- **Who it is for.** A host that needs a kernel's registered definitions and started services, and nothing the boot phase does. The example is a repair kernel for an environment whose normal boot cannot finish because a boot-phase handler throws, never settles, or outlasts the host's timeout. Such a host no longer has to wrap the kernel's private `context.hook` to drop those names.
- **What it guarantees.** Every service and every definition a plugin registers in `init()` or `start()` is present, a driver it connects there included. `shutdown()` is unchanged: `kernel:shutdown`, every `destroy()` and every `onShutdown()` handler run.
- **What it does not guarantee.** That the definitions equal a full boot's. A definition a plugin registers in a boot-phase handler is absent, and nothing a plugin does in those handlers runs: seeds, reconciles, schedulers, audits, and the HTTP listener a server plugin opens on `kernel:listening`. Whether a given set of plugins registers anything there is a reading of that set, not a property of the option. The option withholds the kernel's own dispatch, not the hook names.
- **Loud, once.** A withholding boot logs one `warn` naming each withheld hook and how many registered handlers it left uncalled, with the counts also in the line's `withheldHandlers` field. Its completion line says the hooks were withheld.
