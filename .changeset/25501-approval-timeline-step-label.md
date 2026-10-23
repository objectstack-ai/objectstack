---
'@objectstack/plugin-approvals': patch
---

fix: the approval request page's Timeline shows each action's step by its label, not the node's machine id

Clause-②: no
Metadata-protocol: none

The Timeline tab of the `sys_approval_request` record page lists the request's `sys_approval_action` rows. Its step column asked for `step_name`, which holds the Approval node's id (for example `dual_signoff`), so every row showed that id. The column is now `step_label`, the step's label that the service writes on every row and the boot backfill fills on older rows. The strip's step chip (`current_step_label`) and the object's own lists already show this label.
