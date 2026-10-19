// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// #23488 — ADR-0049 enforce-or-remove (ruling of record 6181988435, letter A).
// `AdminScope.manageBindings` gated the `sys_position_permission_set` binding
// rows, which ADR-0131 D3 retired: a position's sets are part of its
// definition, written through the metadata door under `manage_metadata`, which
// reads no `adminScope`. Measured before removal: no production author set it
// to `true` (the showcase wrote the default `false`), and no door that writes
// a position consulted it; its one remaining reader was the delegated-admin
// gate's strict-containment comparison, which drops the axis in the same PR.
//
// `retiredKey()` on a `strictObject`, for the prescription and the `tsc`
// channel. The key was DEFAULTED (`false`), so a 17.x parse wrote it into every
// scope it emitted; the `acceptRetiredDefaultResidue` stage is NOT adopted
// (the `system/EmailTemplateDefinition:isSystem` precedent): built artifacts
// and stored rows are healed by the replayed D2 conversion
// `permission-admin-scope-binding-authoring-removed`. The D3 record is
// `permission-admin-scope-binding-authoring-retired`.
export const entry = 'security/AdminScope:manageBindings';
