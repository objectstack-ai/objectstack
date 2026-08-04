---
---

ci: the stall guard now proves it still fires (`pnpm check:stall-guard`), and a stalled run's SIGKILL escalation actually runs (#4250). CI-only — releases nothing.

`scripts/run-with-stall-guard.mjs` gains a `--self-test` that drives it against synthetic stalls — an idle hang, a sync-spinning hang, a hang that never prints a first line, and a descendant that traps SIGTERM — asserting the exit-75 verdict, the idle/ON-CPU classification, the SIGUSR2 stack harvest including the "no report = blocked event loop" inference, full process-group teardown, and the negative direction (a healthy run keeps its own exit status; steady output is never called a stall). Six jobs across five workflows depend on this guard, and until now nothing exercised its firing path between real stalls.

Writing that harness surfaced a real defect, since fixed: the SIGKILL escalation was armed as an unref'd timer and the guard exited from the direct child's `exit` handler, so the timer never fired. The direct child (`pnpm` → `turbo`, or `sh`) dies on SIGTERM immediately, so any **descendant** that traps SIGTERM outlived the guard — the shape `ObjectKernelConfig.gracefulShutdown` installs in every kernel a test boots. The guard now waits for the process group to actually empty and SIGKILLs the holdouts, naming them in the log.
