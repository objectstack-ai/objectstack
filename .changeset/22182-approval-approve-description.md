---
'@objectstack/plugin-approvals': patch
---

fix(plugin-approvals): Approve asks its decision question in the dialog, as Reject does

Clause-②: no

`approval_approve` on `sys_approval_request` declares a `description`: "Approve this request? Your approval is recorded, and the request moves on once this step has the approvals it requires." The console shows it as the parameter dialog's subtitle, where a generic "Please provide the required information to continue." showed before; `approval_reject` beside it already declared its question this way. The zh-CN, ja-JP and es-ES bundles carry a translation of it.
