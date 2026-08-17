---
'@objectstack/service-automation': patch
'@objectstack/plugin-approvals': patch
---

`sys_automation_run` resolves its organization from the DECLARED `AutomationContext.tenantId` and from no other spelling (cloud#1395).

The suspended-run store read `context.organizationId ?? context.tenantId`. `AutomationContext` declares `tenantId` and not `organizationId`, and no producer writes the latter — `RecordChangeTrigger.buildContext` maps the hook session's organization onto `tenantId`, and the runtime's automation domain sets `tenantId` directly. The dead limb was not inert: the one test covering `sys_automation_run.organization_id` fed the phantom key, so the column's only coverage exercised a path production cannot reach and said nothing about the live one. The limb is removed, the fixture speaks the declared contract, and a test now asserts the absence so restoring the alias goes red.

Both `sys_approval_request.organization_id` and `sys_automation_run.organization_id` now document the measured attribution defect this uncovered and the negative control that makes it a defect: on a walled single-database boot these two tables stored customer activity with no organization (27/27 and 31/31) while `sys_audit_log` (1669 rows) was correctly attributed on the same boot, because the audit writer resolves the organization from the record the row is ABOUT rather than from the acting context. The write-side repair is not in this change — which column a side-table row should follow is an open contract question, since the audit resolver is scope-pinned to audit stamping by the #8778 ruling. The current behaviour is pinned by test so the fix must promote the assertion rather than quietly satisfy it.
