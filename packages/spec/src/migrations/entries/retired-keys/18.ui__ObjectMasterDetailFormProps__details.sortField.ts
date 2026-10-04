// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// #21589 — ADR-0049 enforce-or-remove through the ADR-0087 D2 route, the spec
// half of objectui#11070 round 9 (the direction recorded on #21220's landing
// and mirrored on objectui#11396 ③: tombstone plus ADR-0087). The console
// retired the authored override at objectui `0a3e5409f`, and the
// `.objectui-sha` pin `89cad75d5570` is past it: `MasterDetailDetailConfig`
// has no `sortField` member (`plugin-form/src/MasterDetailForm.tsx:83`), and
// the field the line grid stamps with each line's position is the one
// `deriveDetail` derives from the child object (`deriveMasterDetail.ts:540`),
// handed to the grid as `sort_field` (`:874`). Tombstoned with `retiredKey()`
// in the strict detail entry; a NESTED row (an array member, spelled without
// its `[]`), so it has no `authorable-surface/` line and checks (b2)/(b3)
// resolve it against the emitted schema. Stored and built pages are stripped
// by the D2 conversion `object-master-detail-form-detail-sort-field-removed`,
// a pure lossless delete scoped by component `type` and position; its D3
// record is `object-master-detail-form-detail-sort-field-retired`.
//
// Registered under 18, not 17: the removal ships on the 17.x line
// (launch-window convention: accept-set narrowings ride minor releases) and
// the prescription lives at the major boundary where `migrate meta` users
// look — the `ui/PageHeaderProps:breadcrumb` precedent.
export const entry = 'ui/ObjectMasterDetailFormProps:details.sortField';
