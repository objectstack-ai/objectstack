---
'@objectstack/objectql': minor
---

feat(objectql)!: under a walled posture (`group` / `isolated`), a system insert into a platform object that names no organization is refused; it no longer lands with `organization_id` NULL

Clause-②: yes (narrowing)

<!-- adr-0087: not-required (no-migration-prescription) A validity narrowing at the engine's system-insert door: no key of any metadata schema is removed, renamed or re-shaped, so there is nothing for `objectstack migrate meta` to rewrite and no tombstone. No export, type or error code is removed or renamed: `PLATFORM_OBJECT_TENANCY`, `isPlatformObjectOutOfTenantAuditScope` and `ERR_SYSTEM_WRITE_ORGANIZATION_REQUIRED` keep their shapes; two exports are added, `WALLED_ORGANIZATION_LESS_BRIDGE` and `isWalledOrganizationLessBridgeObject`, the temporary bridge named below. The remedy is a run-time one, stated below. -->

**BREAKING** accept-set narrowing, shipped as `minor` under the repo's launch-window convention for breaking changes (ADR-0131 D9, D11). This is the walled half of the change whose `single` half shipped in 18.0.

- **Before.** Under `group` or `isolated`, a system-context insert (`isSystem`, no `tenantId`) into a `sys_` / `cloud_` / `ai_` object that carries an organization column, but that the tenancy inventory had not admitted, skipped the organization rule. The row landed with `organization_id` NULL, a row no organization owns and the wall hides from every organization.
- **Now.** That insert goes through the same decision every application object already gets under a wall: no organization is derivable, so it is refused with `ERR_SYSTEM_WRITE_ORGANIZATION_REQUIRED` (status 500, reason `walled-posture`), and nothing is written. Apart from the two tables named below, the posture no longer changes which objects the rule covers.
- **Unchanged.** A write that carries an organization, on the execution context or on the record, is never re-stamped or refused. Objects with no organization column (`systemFields: { tenant: false }`), objects declaring `tenancy: { enabled: false }`, and federated objects are outside the rule. `sys_secret` and `sys_flow_credential` keep their organization-less system inserts under a wall, as before: a global-scope encrypted setting, a datasource credential and a flow credential are deployment-level, and both tables drop their organization column in a later 18.x release, which retires this bridge (`WALLED_ORGANIZATION_LESS_BRIDGE`). Updates are untouched. The engine's diagnostics-only tenant-audit mute still reads the inventory.

**The remedy.** If a refusal names your insert, carry the organization on the write: `ql.insert(object, { ...row, organization_id: orgId }, { context: { isSystem: true } })`, or `{ context: { isSystem: true, tenantId: orgId } }`. If the row is deployment-level by design, the object should declare no organization column: `systemFields: { tenant: false }`.
