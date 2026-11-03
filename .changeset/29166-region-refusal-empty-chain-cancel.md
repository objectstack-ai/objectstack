---
'@objectstack/service-automation': patch
---

fix(service-automation): the region refusal cancels the child run it leaves behind even when the suspension store cannot be read

Clause-②: no
Metadata-protocol: none

When a `subflow` or `map` call inside a `loop` body, a `parallel` branch or a `try_catch` slot starts a child flow that suspends, the run fails at the region boundary and the child run it parked is cancelled. That cancel walked the child's suspension chain through a best-effort read, so a suspended-run store it could not read handed back an empty chain: nothing was cancelled, only a `warn` was logged, and the child run could stay parked, to be resumed later for a caller that had already failed. Now an empty chain still cancels the child run once through `cancelRun`. If the store answers by then, the child is cancelled; if it is still unreadable, `cancelRun` logs the skipped cancellation at `error`, naming the run to cancel by hand. The refusal itself, its text and its un-routability are unchanged.
