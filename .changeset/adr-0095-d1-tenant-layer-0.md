---
"@objectstack/plugin-security": minor
---

ADR-0095 D1: tenant isolation is now **Layer 0** — an independent, always-first,
AND-composed filter (`tenant-layer.ts`), no longer a wildcard `tenant_isolation`
RLS policy OR-merged with business RLS. The effective row filter is
`Layer0(tenant) AND Layer1(business RLS)`; the two share no compiler, merge step,
or bypass bit. The superuser bypass now exempts the tenant wall only as a Layer 0
rule (platform-admin posture + object posture permits: private / platform-global
/ better-auth-managed), never via a business-RLS short-circuit.

**BREAKING (multi-org `tenancy.mode = 'multi'` deployments only; `single` mode is
inert and unchanged).** Retiring the OR-merged tenant policy resolves four
behavior deltas, all toward stronger/correcter isolation:

- **(a) Cross-tenant read leak closed.** A permissive business RLS policy (e.g.
  `status == 'public'`) no longer OR-widens tenant scope; a foreign-org row it
  matched is now invisible.
- **(b) Member by-id writes narrow to owner-only.** The OR-merge silently widened
  `owner_only_writes` (`created_by == me`) back to org-wide, so a member could
  by-id update/delete *any* record in their org. Writes are now owner-scoped as
  authored. **Migration:** if your deployment intentionally relied on members
  editing each other's records org-wide, grant an explicit per-object edit
  permission set (position-distributed) where that is wanted — the baseline
  `member_default` no longer permits it.
- **(c) Global-catalog objects visible to members.** On a `tenancy.enabled:false`
  object, members were scoped by a phantom `organization_id` filter (a column
  such objects lack); Layer 0 correctly treats them as non-tenant, so the global
  catalog is visible.
- **(e) No-active-org writes fail closed.** A write by a principal with no active
  organization on a tenant object is now denied (was owner-scoped only).

`tenant_isolation` is retired from the seeded `organization_admin` /
`member_default` / `viewer_readonly` sets; the `_self` / `_org` identity-table
carve-outs and `owner_only_writes/deletes` are unchanged. Customized seeded sets
keep their overlays (ADR-0094). The driver-level `applyTenantScope` seam is
untouched. See ADR-0095 and framework#2936 (the `extractTargetField` `==` blind
spot this exposes, tracked separately).
