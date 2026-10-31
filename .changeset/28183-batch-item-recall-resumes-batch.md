---
'@objectstack/plugin-approvals': patch
---

fix(plugin-approvals): a revise-window recall on a batch sign-off item resumes the batch, which records the item as cancelled and goes on

Clause-②: no (a batch run that nothing could wake after the recall now continues, in the shape the cancelled-item ruling already set; no schema, accept set, error code or result field changes)
Metadata-protocol: none

A batch sign-off is a `map` node over the items, and each item's run parks on its own `approval`. When the submitter recalled an item from the revise window, the recall cancelled the item's run with `cancelRun`, which never touches the parent. The batch run stayed parked on that item with no request open for the next one, and nothing woke it short of an operator resuming the batch run by hand.

- **Now.** After the cancel, the recall resumes the batch run parked on that item. The map records the item's slot as `{ $status: 'cancelled', $itemRunId }`, leaves it out of `count`, and opens the next item, or runs on past the map when it was the last one.
- **Only the built-in `map`.** A run is woken only when it is parked at a `map` node on that item's run. Any other node parked on such a link is left alone, because nothing records the cancelled item for it.
- **Failures are told the way the recall tells its own.** A batch resume the engine refuses or strands does not fail the recall: the withdrawal stands, `resumeError` says which run did not move and why, and an engine-stranded batch is reported on `resumeFailure` with code `RESUME_FAILED`.
- **Unchanged.** A recall while the request is still `pending` (the item resumes down `reject` and the map records its output), a revise-window recall with no batch above it, and a batch whose items are all decided.
