// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// #21445 — ADR-0049 enforce-or-remove (objectui#6152 ruling A: `resizable` is
// canonical; the startup rule of immediate retirement — zero writers in either
// repository, so no window). `resizableColumns` was the legacy second spelling
// of `object-grid`'s `resizable`, read only as
// `schema.resizable ?? schema.resizableColumns` (measured at the
// `.objectui-sha` pin `89cad75d55`, `plugin-grid/src/ObjectGrid.tsx:5361`).
// One switch, two spellings; a grid authoring both silently ignored this one.
//
// Registered under 18 for the reason `ui/ObjectGridProps:defaultSort` is: the
// removal ships on the 17.x line (launch-window convention: accept-set
// narrowings ride minor releases) and the prescription lives at the major
// boundary where `migrate meta` users look. Tombstoned with `retiredKey()` in
// `ObjectGridPropsSchema` (the surface baseline line carries `[RETIRED]`);
// sources are rewritten by the D2 conversion
// `object-grid-resizable-columns-removed` (renamed to `resizable` when that is
// absent; a pure lossless delete when it is present, since the legacy key was
// never read then).
export const entry = 'ui/ObjectGridProps:resizableColumns';
