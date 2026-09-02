---
'@objectstack/plugin-sharing': patch
---

Sharing rules with a business-unit recipient no longer grant nothing when the unit was created by seed data.

`BusinessUnitGraphService.orgScope` screened `sys_business_unit` with a strict `organization_id` equality, while the platform's own tenant screen (`SqlDriver.applyTenantScope`) is null-inclusive: `(organization_id = ? OR organization_id IS NULL)`. A sharing rule always carries the caller's organization, but a business unit written by seed data carries none — a seed cannot know the id the runtime mints at boot — so the two never matched. The seed check read the unit as "does not exist", both recipient widths (`business_unit` and `unit_and_subordinates`) expanded to zero users, and the rule stayed active having materialised no `sys_record_share` row and logged nothing. `orgScope` now applies the platform's null-inclusive screen, matching what `plugin-approvals` already did for the same rows.

The member reads are now tenant-screened, which they were not before. Both `expandUnitMembers` and `expandUsers` queried `sys_business_unit_member` with no organization predicate at all, under a system context that carries no tenant; the strict unit screen was the only thing keeping an org-stamped rule away from that unscoped query. Widening the unit screen alone would have turned a silent under-grant into a silent cross-tenant over-grant, since a seeded unit id exists identically in every tenant. The member screen is strict rather than null-inclusive on purpose: seed replay and elevated system writes both leave `sys_business_unit_member.organization_id` NULL, so a NULL there means unknown tenancy rather than platform-global, and an org-scoped rule does not grant to it.

An active business-unit rule that expands to no recipients now warns once per rule per process, naming the rule, the object, the recipient kind, the unit and the organization. That case — a rule whose unit and memberships were both seeded — is the one combination that still grants nobody, and it is no longer silent.
