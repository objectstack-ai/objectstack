---
'@objectstack/plugin-audit': minor
'@objectstack/plugin-security': minor
'@objectstack/service-settings': minor
'@objectstack/spec': minor
'@objectstack/objectql': patch
---

feat(plugin-audit,plugin-security)!: the compliance ledger `sys_audit_log` loses its injected organization column; the organization a row is about stays in `tenant_id`, and an organization reader is scoped on it by a platform row policy (ADR-0131 D7)

Clause-②: no (narrowing)

<!-- adr-0087: registered sys-audit-log-organization-column-retired -->

**BREAKING**, shipped as `minor` under the repo's convention for breaking changes on this line.

Some ledger rows are about deployment-level actions no organization owns: a change of platform-administrator standing at boot, a change to a global setting, plugin-auth's administrative user writes. An injected organization column made the tenant wall the ledger's anchor, so under a walled posture those rows were hidden from every reader, platform administrators included. ADR-0131 D7 takes the column off: the ledger is governed by object permission, and the organization a row is about is the plain attribution field `tenant_id`, which the tenant-field resolver does not claim.

- **`sys_audit_log`** (`@objectstack/plugin-audit`) declares `systemFields: { tenant: false }`, so the registry injects no `organization_id` and a new table is provisioned without it. `tenant_id` (a lookup to `sys_organization`) is unchanged and is the only organization column. The record mirror, the record-view writer and the sign-in writer stamp it as before and no longer stamp `organization_id`. A write that still names `organization_id` on the ledger is refused `INVALID_FIELD`, and a filter on it `INVALID_FILTER`.
- **The read scope** (`@objectstack/plugin-security`, the shipped permission sets): a platform row policy, `sys_audit_log_org` (`tenant_id == current_user.organization_id`), in `organization_admin` (and its no-bypass variant), `member_default` and `viewer_readonly`. `organization_admin` also names `sys_audit_log` explicitly, read only and without `viewAllRecords` / `modifyAllRecords`: its wildcard's superuser bypass would otherwise skip the policy on an object with no tenant column. Under an organization wall an organization administrator or viewer reads the rows about its active organization; a platform administrator (`admin_full_access`) reads every row, the rows about no organization included. Under `single` the policy is stripped by provenance (ADR-0105 D3), as every platform tenant policy is.
- **`config_change` rows** (`@objectstack/service-settings`): a GLOBAL-scope settings change is about no organization, so its ledger row carries no `tenant_id`, whatever organization the writing session had active. Tenant- and user-scope changes keep the writer's organization. The settings writer and plugin-security's platform-admin standing writer no longer probe for or stamp `organization_id`.
- **Retention** (`@objectstack/objectql`): a tenant-scope `lifecycle.retention_overrides` window on `sys_audit_log` partitions the reaper's and the archiver's passes on `tenant_id`, and the global pass keeps the rows with no `tenant_id`.
- **`view_all_audit_log`**: its description (`@objectstack/spec/security`) now names the row scope it does not lift; the capability still lifts only the parent-record read gate.

**What moves for consumers.**

- **Authored references.** A filter, list-view column, report grouping, formula or seed key that names `organization_id` on `sys_audit_log` names `tenant_id` instead; the two held the same value on every row a writer wrote.
- **Who reads what, under a wall.** A platform administrator now also reads the rows about no organization, global settings changes included. An organization administrator reads exactly its active organization's rows. Under the `group` posture an organization reader is scoped to the ACTIVE organization's rows, not the union of its memberships. A permission set an application ships that grants `viewAllRecords` on the ledger (directly or through a wildcard) skips the row policy, as it skips Layer 1 on every object the wall does not cover.
- **Who reads what, under `single`.** The row policy is stripped under `single` (ADR-0105 D3), as every platform tenant policy is. So a deployment that holds more than one organization under `single` serves every organization's ledger rows to every ledger reader. The remedy is a walled posture.
- **Existing databases — nothing moves automatically** (ADR-0131 D14). Schema sync is additive: the physical `organization_id` column stays and the boot drift report names it orphaned. The v18 upgrade ceremony confirms its values equal `tenant_id` and drops it (`os migrate apply --allow-destructive`), reporting any row where they differ.
