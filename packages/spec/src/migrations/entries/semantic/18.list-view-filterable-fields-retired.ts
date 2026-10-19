// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// #24640 (ADR-0049 enforce-or-remove; maintainer ruling C, record 6278975049,
// pulled into 18.0 by record 6279033298) — the D3 entry of the
// `view-list-filterable-fields-removed` family (ruling B on #17152: one D3
// entry per retirement family). Registered keys: `ui/ListView:filterableFields`
// and `ui/ObjectListView:filterableFields`. Unlike the `tabs` retirement this
// strip DOES change a screen — a stored whitelist stops narrowing the Filter
// panel — and the conversion cannot know whether the author meant that panel
// or the quick-filter bar the key was declared as; that is the judgement owed.
export const entry: SemanticMigration = {
  id: 'list-view-filterable-fields-retired',
  surface: 'view.list.filterableFields / view.listViews.*.filterableFields — the list view\'s Filter-panel field whitelist',
  replacement: 'Nothing replaces the whitelist: the platform carries no per-view Filter-panel '
    + 'whitelist. For a curated end-user filter bar above the list, declare `userFilters` — '
    + '`userFilters: { element: \'dropdown\', fields: [{ field: \'<field_name>\' }] }` — on the '
    + 'list view. The Filter panel offers every field the user may read: field read security '
    + 'decides, and a field the object definition marks `hidden: true` is not offered.',
  reason: 'The D2 conversion `view-list-filterable-fields-removed` deletes `filterableFields` from '
    + 'every list payload in `stack.views[]`, in all three persisted spellings. It never rewrites '
    + 'the key to `userFilters.fields`, because that would keep nothing an author saw: the key was '
    + 'declared as the quick-filter shorthand, while the one renderer that read it used it as a '
    + 'whitelist of the fields the Filter panel offers, so a rewrite would make the whitelist '
    + 'vanish AND quick-filter chips appear. The delete is not lossless in pixels: a view that '
    + 'named a whitelist now has its Filter panel offer every readable field, minus the fields the '
    + 'object marks hidden, and a hidden field the whitelist named is no longer offered. What the '
    + 'conversion cannot decide is what the author wanted: a curated set of quick filters is a '
    + '`userFilters` declaration the author writes; a field that must not be filterable at all is '
    + 'a field-security question, not a view key. One boundary is the author\'s by construction: '
    + 'a key declared under `objects[].listViews` is reached by no conversion, so such an object is '
    + 'refused at its own door until edited by hand.',
  acceptanceCriteria: 'No list view in `stack.views[]` or in any object `listViews` map declares '
    + '`filterableFields`; the parse refuses the key by name at every list-view door. For each view '
    + 'that did: if the author wanted end users to filter on a curated set of fields from the list '
    + 'itself, the view declares `userFilters` with those fields and the quick-filter bar shows '
    + 'them; otherwise nothing replaces it, and the Filter panel offers every field the signed-in '
    + 'user may read except the ones the object marks hidden. `searchableFields` and an existing '
    + '`userFilters` are unchanged.',
};
