---
'@objectstack/service-automation': patch
---

fix(service-automation): the region refusal names the deeper suspended run it could not read instead of leaving it parked in silence

Clause-②: no
Metadata-protocol: none

When a `subflow` or `map` call inside a `loop` body, a `parallel` branch or a `try_catch` slot starts a child flow that suspends, the run fails at the region boundary and cancels the child run with every run it is parked on. That walk read each link through a best-effort read, so a link deeper in the chain that the suspended-run store could not read stopped the walk with only a `warn`: that run, and every run below it, stayed parked. The walk now reads through the strict loader that `cancelRun` uses. It cancels every link it read, still cancels the link it could not read through `cancelRun` (which records its own `error` if the store is still unreadable), and logs one `error` naming that run, because any run below it was never reached and may still be parked. The refusal itself, its text and its un-routability are unchanged.
