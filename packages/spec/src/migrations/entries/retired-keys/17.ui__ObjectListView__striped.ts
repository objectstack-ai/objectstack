// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// #7176 — the `ObjectListViewSchema` copy of `ui/ListView:striped`: the def is
// `ListViewSchema.omit({userFilters}).extend(…)`, so the tombstone lands in
// this walked shape too and `authorable-surface/` marks it `[RETIRED]`
// separately. Registered per key, as gate (b) reads them — nothing radiates
// from the base (the `shared/FieldMapping:transform` precedent).
export const entry = 'ui/ObjectListView:striped';
