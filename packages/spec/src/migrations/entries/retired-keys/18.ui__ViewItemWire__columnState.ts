// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// #36403 (ADR-0049 enforce-or-remove; the spec half of #35955). The view item
// record's `columnState` — the console grid's per-user column order and widths,
// declared by `viewItemWireFields()` on member 1 of the `view` union
// `saveMetaItem` validates, and stored on the shared row. No writer is left: the
// overlay writer retired with objectui#12504, and since #35955 a column drag
// goes to the list's draft while widths live in the reader's browser (census at
// `main` 97b9d1e6: this framework, its examples and console, HotCRM and the
// gallery; cloud not reachable). Tombstoned with `retiredKey()`; the authoring
// door never declared it. Same blind spot as `ui/ViewItemWire:owner`: a
// discriminated-union def emits no top-level `properties`, so no gate judges
// this row. D2: `view-column-state-removed`.
export const entry = 'ui/ViewItemWire:columnState';
