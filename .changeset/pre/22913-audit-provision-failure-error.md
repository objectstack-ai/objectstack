---
'@objectstack/plugin-audit': patch
---

A failed boot provisioning of an audit table is logged at `error`, naming what is lost and the fix

Clause-②: no

At `kernel:ready`, `AuditPlugin` creates the storage for `sys_audit_log`, `sys_activity`, `sys_comment` and `sys_comment_reaction`. When the driver refuses one of those DDL statements, the boot still completes and the deployment looks healthy, but the table does not exist. For `sys_audit_log` and `sys_activity` the loss is silent: audited writes keep succeeding while their audit and activity rows have nowhere to land. That failure was logged at `warn`. It is now logged at `error`, once per object per boot and never per write. The boot is still not failed.

- **What the line says.** It names the object, what is lost without it, and that the deployment keeps looking healthy. It gives the fix: resolve the driver's refusal, then restart (this provisioning runs on every boot) or run `os migrate apply`, which creates the missing storage. `os migrate plan` lists it as a `create_table` entry for that object. Both remedies were measured to create a missing `sys_activity` once the fault was gone, with and without the telemetry sibling database.
- **Where the driver's error is.** In the record's meta as `{ object, error }`, not in the message, so a multi-line driver error stays one record.
- **What is unchanged.** The other objects are still provisioned when one fails, and the placement lines (`system tables provisioned`, the non-default datasource note) are unchanged. A log search on `could not provision sys_activity storage` (or any of the four object names) still matches the line.
