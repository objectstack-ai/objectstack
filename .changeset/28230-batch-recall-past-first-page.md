---
'@objectstack/plugin-approvals': patch
'@objectstack/service-automation': patch
---

fix(plugin-approvals): a revise-window recall on a batch item finds its batch run past the first 1000 parked runs

Clause-②: no (a recall on a store with more than 1000 parked runs now wakes its batch, as it already does below that; no schema, accept set, error code or result field changes)
Metadata-protocol: none

The recall found the batch above the item it cancels in `listSuspendedRunsDurable()`. On a database-backed store that listing reads one page of 1000 `paused` rows, and a process adds only the runs it parked itself. So when another replica (or this process before a restart) parked the batch and more than 1000 runs were parked ahead of it, the recall did not find the batch. The batch stayed parked on the cancelled item, and the recall said nothing.

- **Now.** Before it cancels the item, the recall asks the engine for the batch through the item's own link to it. The new `AutomationEngine.suspendedMapParentOf(itemRunId)` reads the item's suspension, then its parent's, by id. It answers the parent only while the parent is parked on `map:<itemRunId>` at the `map` node that launched the item. The read comes before `cancelRun` because the cancel removes the item's suspension, and the link with it.
- **Unchanged.** Below 1000 parked runs the recall wakes the batch as before. A recall with no batch above it, and a run parked on the item at a node other than the built-in `map`, are left alone as before. A failed lookup is reported in `resumeError` after the cancel, as before.
