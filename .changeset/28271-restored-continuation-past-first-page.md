---
'@objectstack/plugin-approvals': patch
'@objectstack/service-automation': patch
---

fix(plugin-approvals): re-issuing a restored approval continuation proves the pause past the first 1000 parked runs

Clause-②: no (a re-issue on a store with more than 1000 parked runs now proves the pause as it already does below that; no schema, accept set, error code or result field changes)
Metadata-protocol: none

`continueRestoredRun` proves the pause it continues is the one the request's outcome was issued at, by reading where the run is parked. It read that from `listSuspendedRunsDurable()`. On a database-backed store that listing reads one page of 1000 `paused` rows, and a process adds only the runs it parked itself. So when another replica (or this process before a restart) parked the run and more than 1000 runs were parked ahead of it, the run was on no page. Every re-issue was refused with `INVALID_STATE` "parked at no node this engine can see", every retry read the same page, and the recorded outcome never took effect.

- **Now.** The proof asks the engine for that one run. The new `AutomationEngine.suspensionOf(runId)` reads the run's suspension by id, through the same strict, store-authoritative read `hasSuspendedRun` uses, and answers its flow, node and correlation, or `undefined` when it is not suspended. It rejects when the store cannot be read.
- **Unchanged.** Below 1000 parked runs the re-issue proceeds as before. A run that is not parked, or is parked at another node, is still refused, and the refusal still names the node. An engine without the read is still refused; the refusal now names `suspensionOf` as the missing read.
