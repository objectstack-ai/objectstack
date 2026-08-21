---
"@objectstack/core": patch
---

The kernel's two `Promise.race` timeout guards — the startup guard around each
plugin's `init`/`start`, and the shutdown guard around `performShutdown()` —
now reclaim **both** halves of the guard when the race settles: the timer is
cleared *and* the losing promise is settled (#10604).

Neither site settled its loser, so the timeout promise and the reaction
`Promise.race` held on it were retained for the life of the process — four
leaking promises per showcase test run under `vitest --detectAsyncLeaks`, now
zero. The two hand-rolled copies had also drifted into doing opposite halves of
the same cleanup: the startup site cleared its timer and never `unref`'d, the
shutdown site `unref`'d and never cleared. Both now go through one internal
`TimeoutGuard`, so they cannot drift apart again. No exported API changes.

**Behaviour change, at the shutdown guard:** the shutdown timer is no longer
`unref()`d. Two consequences for an embedding host (CLI, auth-proxy, test
runner):

- After a **successful** shutdown, no timer is left armed. Previously the guard
  survived its own race and stayed scheduled to fire against a kernel already
  `'stopped'`. That late rejection was *handled* — `Promise.race` had attached a
  rejection handler to it — so this was never an unhandled-rejection risk; it
  was retained work and a wakeup after teardown.
- When teardown **hangs**, the guard now actually fires. An unref'd timer does
  not keep the event loop alive, so a process with nothing else to run could
  exit silently — status 0, teardown incomplete — before `shutdownTimeout`
  elapsed, leaving `Shutdown timed out — forcing exit` and its `exit(1)`
  unreachable in exactly the case they exist for. Reclaiming on settle keeps the
  guard ref'd exactly as long as the race is undecided, which is the guarantee
  the startup guard already had (#4813).

If your host relied on a hung `shutdown()` letting the process fall out of the
event loop on its own, it will now wait up to `shutdownTimeout` (default 60s)
and then hard-exit with status 1. Lower `shutdownTimeout` in the kernel config
to shorten that window.
