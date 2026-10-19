---
'@objectstack/objectql': minor
---

feat(objectql)!: under the `single` posture, a system insert into a platform object that names no organization takes the Default Organization, or is refused; it no longer lands with `organization_id` NULL

Clause-②: no (narrowing)

<!-- adr-0087: not-required (no-migration-prescription) A validity narrowing at the engine's system-insert door: no key of any metadata schema is removed, renamed or re-shaped, so there is nothing for `objectstack migrate meta` to rewrite and no tombstone. No export, type or error code is added, removed or renamed: `PLATFORM_OBJECT_TENANCY`, `isPlatformObjectOutOfTenantAuditScope` and `ERR_SYSTEM_WRITE_ORGANIZATION_REQUIRED` keep their shapes. The remedy is a run-time one, stated below. -->

**BREAKING** accept-set narrowing, shipped as `minor` under the repo's launch-window convention for breaking changes (ADR-0131 D9, D11).

- **Before.** A system-context insert (`isSystem`, no `tenantId`) into a `sys_` / `cloud_` / `ai_` object that carries an organization column, but that the tenancy inventory had not admitted, skipped the organization rule entirely, under every posture. The row landed with `organization_id` NULL. Thirty-five platform objects in this repository were in that population, among them `sys_business_unit`, `sys_business_unit_member`, `sys_member`, `sys_team`, `sys_user_permission_set`, `sys_user_position`, `sys_sharing_rule`, `sys_share_link`, `sys_comment`, `sys_attachment`, `sys_activity`, `sys_email`, `sys_inbox_message`, `sys_secret`, `sys_setting`, `sys_setting_audit`, `sys_webhook` and `sys_flow_credential`.
- **Now, under `single`.** That insert goes through the same decision every application object already gets. With exactly one organization (the Default Organization), the row is stamped with it. With none, or with several, the insert is refused with `ERR_SYSTEM_WRITE_ORGANIZATION_REQUIRED` (status 500), and the message names the missing organization. Nothing is written.
- **Unchanged.** Under a walled posture (`group` / `isolated`) the per-object exclusion stands as before; the walled half of this change ships in a later 18.x release. A write that carries an organization, on the execution context or on the record, is never re-stamped or refused. Objects with no organization column, objects declaring `tenancy: { enabled: false }`, and federated objects are outside the rule. Updates are untouched. The engine's diagnostics-only tenant-audit mute is unchanged.

**The remedy.** If a refusal names your insert, carry the organization on the write: `ql.insert(object, { ...row, organization_id: orgId }, { context: { isSystem: true } })`, or `{ context: { isSystem: true, tenantId: orgId } }`. On a fresh `single` deployment the auth plugin creates the Default Organization at boot, so a refusal reading `no-organization` means the write ran before it, or in a composition that registers `sys_organization` but mounts no auth plugin to create the Default Organization.
