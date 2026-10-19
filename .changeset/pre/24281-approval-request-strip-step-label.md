---
'@objectstack/plugin-approvals': patch
---

fix(plugin-approvals): the approval request page's highlights strip names the current step by its label, not the node id

Clause-②: no

- **The approvals get serves `current_step_label`.** `ApprovalRequestRow` declares it as the step's label under the `sys_approval_request` column's own name. Every door that serves a request now serves it with exactly `step_label`'s value: the get, the list, and the request that a decision, recall, send-back, resubmit, reassign, remind, info request or comment echoes back. `step_label` stays, with the same value, for the inbox and the emailed action-link pages. `current_step` stays the Approval node's machine id.
- **The strip's step chip is the step's label.** `sys_approval_request_detail` lists `current_step_label` (the "Approval Step" field) where it listed `current_step`, so a request waiting on the `approve_step` node reads `Manager Review` there instead of `approve_step`. The request lists already showed this label.
- **The object's `highlightFields` makes the same swap.** The page's Details tab is a bare `record:details` node, which draws the object's `highlightFields` minus the strip. A change to the strip alone would have moved `current_step` into that tab.
- **When no label is stored.** The get serves the stored label, else the node label in the request's node-config snapshot, else the humanized node id (`approve_step` → `Approve Step`). A request the boot backfill has not labelled still shows a step chip. A request with no step serves neither field, and the strip draws no step chip.

A patch: one served key that the contract already declares, and one entry in one platform object's field list and in its page. No export, type, accepted value or stored column changes.
