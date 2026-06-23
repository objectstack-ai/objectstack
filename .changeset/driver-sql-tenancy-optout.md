---
"@objectstack/driver-sql": patch
---

fix(driver-sql): honor `tenancy.enabled:false` in driver org-scoping

The driver auto-detects `organization_id` as a tenant-isolation column and, when
the caller passes `DriverOptions.tenantId`, scopes reads/updates/deletes to that
tenant (and injects the column on inserts). The implicit column-detection
fallback ignored an explicit `tenancy.enabled === false`, so a platform-global
object that opts out of tenancy but carries an optional `organization_id` FK
(e.g. `sys_license`) was still org-scoped — an authenticated caller's active-org
`tenantId` then hid every NULL-org / cross-org row. The opt-out is now honored in
a single shared `computeTenantField()` used by both `initObjects` and
`registerExternalObject` (which had drifted). Covers `TursoDriver` (extends
`SqlDriver`). Genuine org-scoped objects are unaffected.
