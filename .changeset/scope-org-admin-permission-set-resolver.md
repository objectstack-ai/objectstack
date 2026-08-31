---
"@objectstack/plugin-security": patch
---

fix(plugin-security): resolve the org-admin permission set per organization, and keep the revoke reach wide (#11670)

`auto-org-admin-grant.ts` resolved the `sys_permission_set` row that every
auto-provisioned org-admin grant points at by NAME alone: no `organization_id`
predicate, `limit: 1`, and cached per ObjectQL instance on the name alone. Each
property reads as deliberate; together they answer with a row nobody chose.

Post-#10103 the RBAC catalog is materialized per organization and
`sys_permission_set.name` is unique per organization (ADR-0120 D3), so one name
carries a row per organization PLUS the organization-less platform-bucket row
`bootstrapPlatformAdmin` mints on every boot — and that bucket row is the
OLDEST bearing the name (measured on a fresh walled rig at 1.3 s ahead of the
first `sys_organization`, #11532). An unscoped `limit: 1` read has no reason to
prefer any other, and a per-instance cache keyed on the name made the first
organization reconciled in a process pick the row every later organization got.
The grant target is a foreign key, so on a walled deployment
`sys_user_permission_set` rows granting `organization_admin` could point at a
row belonging to no organization.

**Walled postures only.** The read is now threaded with the granting
organization — through `SqlDriver.applyTenantScope`, resolved by
`resolveOwnOrganizationRow`, the catalog's own spelling of "which row is this
organization's" — and the cache is keyed on `(organization, name)`. `single`
keeps the unscoped answer and the unscoped `limit: 1` grant-target read
unchanged; no read on a `single` path carries a `tenantId`.

**When the organization has no own row**, the resolver returns `null` (the
module's existing `skipped` / `permission_set_missing` no-op) and warns loudly,
rather than falling back to the organization-less row: a fallback would keep
minting grants at the platform bucket, and the second one would never be
repaired — once the organization's own row appeared the reconciler would insert
a duplicate beside it.

**The revoke reach widened in the same change, deliberately.** Narrowing the
grant target without it would be a permission loosening: a demoted admin whose
grant predates this fix names the organization-less row, and the ADR-0105 D4 F2
close-out (a deployment that drops its wall must not leave the unbounded
`organization_admin` grant standing) converges across copies written under the
other posture. Revocation therefore matches EVERY copy of the set name, in every
posture — the per-pair superseded and demotion legs and the backfill's orphan
sweep alike. The grant target is posture-scoped; the revoke reach never is.

⛔ No repair of existing rows is claimed or performed. This makes new
resolutions correct; grants already pointing at the organization-less row are
left exactly as they are, including the duplicate that appears beside one when
its holder still qualifies. Accept/reject is unchanged today — `resolve-authz-context`
resolves permission sets by id without tenant scoping, which is why the defect
was invisible — and no published surface changes.
