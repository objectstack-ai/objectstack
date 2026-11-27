---
'@objectstack/plugin-approvals': patch
---

fix(approvals): a step decided in a `subflow` child no longer tells the submitter "approved" while the parent opens a further step

Clause-②: no
Metadata-protocol: none

The decision that ends an approval tells its submitter the outcome (`approval.approved` / `approval.rejected`); a decision that ends only a step tells no one. To tell the two apart, the platform looked for a pending request on the decided request's own run. A step decided inside a `subflow` child hands the next step to the parent run, which opens it under the parent's run id, so nothing pending was found and the submitter was told "approved" while the next step was still open.

The check now looks across the run that carries the request's record (`record_run_id`, recorded on each request since requests record their root run). A `subflow` child shares that run with its parent, so a further step on either side keeps the first decision quiet, and the decision that ends the approval tells the submitter as before.

- A `map` item whose item is a record carries a run of its own, so each item's submitter is still told that item's outcome when its last step is decided, while the batch goes on to the next item.
- A request opened before requests recorded the run that carries their record is judged on its own run, as before.

Nothing to migrate.
