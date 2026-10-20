// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// #24640 — the `ObjectListViewSchema` copy of `ui/ListView:filterableFields`:
// the def is `ListViewShapeSchema.omit({ userFilters }).extend(…)`, so the
// tombstone lands in this walked shape too and `authorable-surface/` marks it
// `[RETIRED]` separately. Registered per key, as gate (b) reads them — nothing
// radiates from the base. An object's own `listViews` is reached by no
// conversion, so an object body carrying the key is refused at its door. D2:
// `view-list-filterable-fields-removed`, a drop that never rewrites the key to
// `userFilters.fields`.
export const entry = 'ui/ObjectListView:filterableFields';
