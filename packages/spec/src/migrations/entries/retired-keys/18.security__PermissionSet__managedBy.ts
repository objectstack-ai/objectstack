// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// #23891 (ADR-0049 enforce-or-remove; the liveness ledger's `dead` verdict of
// 2026-10-11). `PermissionSet.managedBy` — the authored per-record provenance
// `package | platform | user` of ADR-0086 D3 — was never read: the retired
// `bootstrapDeclaredPermissions` seeder stamped the `sys_permission_set.managed_by`
// COLUMN without reading the key, and the packaged-set lock decides provenance
// from the package's artifact. Setup's form row and its labels promised upgrade
// behaviour nothing kept. The set shape is `strictObject`, so the route is the
// `retiredKey()` tombstone: the key stays in the walked shape as `[RETIRED]`,
// and authoring it is a tsc error and a parse error carrying the prescription.
// The column is a different surface and is untouched. D2:
// `permission-set-managed-by-removed`; D3: `permission-set-managed-by-retired`.
export const entry = 'security/PermissionSet:managedBy';
