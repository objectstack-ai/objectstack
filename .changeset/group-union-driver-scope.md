---
"@objectstack/spec": patch
"@objectstack/objectql": patch
"@objectstack/driver-sql": patch
"@objectstack/plugin-security": patch
---

fix(authz): widen the driver's native tenant scope to the membership union
under the `group` posture — ADR-0105 D2 finally reaches the wire (#3623)

The Layer 0 wall correctly compiled `organization_id IN accessible_org_ids`
under `group`, but the ObjectQL engine also propagated the active-org
`tenantId` into `DriverOptions` unconditionally, and the SQL driver's native
scoping ANDed `organization_id = tenantId` under the union — collapsing every
group read back to active-org (isolated) reach. Found by the cloud-side
`ee-group-showcase` dogfood (cloud#880), the first end-to-end boot of `group`
against a real driver.

- `DriverOptions.tenantIds` (spec): the union tenant access set. Drivers with
  native scoping widen reads/updates/deletes/aggregates to `IN (...)`,
  keeping the NULL-tenant global-row carve-out; inserts still stamp from
  `tenantId` (the active organization is the write target, D5). Absent or
  empty ⇒ equality fallback — fail toward isolation, never toward exposure.
- ObjectQL engine threads `ExecutionContext.accessible_org_ids` as
  `tenantIds` when the tenancy posture is `group`, reported by a new
  `setTenancyPostureProvider` seam.
- SecurityPlugin wires that provider at start — deliberately from the
  enforcement layer, so the driver wall only widens while the Layer 0 union
  wall enforces above it. Embeddings without plugin-security keep active-org
  equality.
