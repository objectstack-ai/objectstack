// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// #36270 — ADR-0049 enforce-or-remove (the maintainer's ruling A: one editing
// model). A grid that renders editable now selects a cell first and opens its
// editor on double-click, Enter, F2 or typing, so `object-grid`'s
// `singleClickEdit` has no single-click entry left to switch.
//
// Registered under 18 for the reason `ui/ObjectGridProps:resizableColumns` is:
// the removal ships on the 18.x line (launch-window convention: accept-set
// narrowings ride minor releases) and the prescription lives at the major
// boundary where `migrate meta` users look. Tombstoned with `retiredKey()` in
// `ObjectGridPropsSchema` (the surface baseline line carries `[RETIRED]`);
// sources are rewritten by the D2 conversion
// `object-grid-single-click-edit-removed` (a delete, whatever the value).
export const entry = 'ui/ObjectGridProps:singleClickEdit';
