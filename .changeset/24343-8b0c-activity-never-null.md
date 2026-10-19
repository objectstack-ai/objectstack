---
"@objectstack/plugin-audit": patch
"@objectstack/cli": patch
---

fix: an activity row is written only when an organization is derivable, never with a NULL organization, and the v18 ownership ceremony deletes the existing NULL activity rows it cannot attribute (ADR-0131 D9)

Clause-②: no

- **`@objectstack/plugin-audit`.** The audit writer's activity mirror (`sys_activity`) takes its organization from the record, then from the acting session, then from the `tenancy` service's Default Organization under `single`. When none of them names one, the mirror now writes no activity row at all. Before, it wrote a row with `organization_id` NULL. Under a wall that row was readable by no organization member. The change is still recorded: the compliance ledger row (`sys_audit_log`) is written as before, with its `tenant_id` attribution. Under `single` the Default Organization is always derivable, so nothing changes there. A record that names its organization keeps its activity row, with that organization.
- **`@objectstack/cli`.** `os migrate organization-ownership` still attributes a NULL `sys_activity` row when its record carries an organization. On a walled database (any posture but `single`), the mirror-deletion step now deletes the NULL rows no anchor attributes, such as activity about a sign-up's `sys_user`. Before, those rows were reported as unattributable and held certification. They are 14-day telemetry that the mirror no longer writes, and `sys_audit_log` keeps each change. The plan counts them as the departure `underivable-activity`, and warns before the first write that `--apply` deletes them. The apply report lists the count as the table's `deleted`. Under `single` the Default Organization takes these rows, as before, and nothing is deleted.
