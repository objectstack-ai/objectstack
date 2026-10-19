// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// #23488 — ADR-0049 enforce-or-remove (ruling of record 6181988435, letter A).
// `AdminScope.authorEnvironmentSets` gated writes to `sys_permission_set`
// rows, which ADR-0131 D3 retired: a permission set is an environment metadata
// definition, written through the metadata door under `manage_metadata`, which
// reads no `adminScope`. Measured before removal: no production author set it
// to `true`, and no door that writes a permission set consulted it; its one
// remaining reader was the delegated-admin gate's strict-containment
// comparison, which drops the axis in the same PR.
//
// Tombstoned and healed exactly as `security/AdminScope:manageBindings` (the
// same D2 conversion, `permission-admin-scope-binding-authoring-removed`, and
// the same D3 record, `permission-admin-scope-binding-authoring-retired`).
export const entry = 'security/AdminScope:authorEnvironmentSets';
