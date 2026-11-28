// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// The upgrade-guide entry of the Views, dashboards and app shell family of the
// second batch of author-time rules (#35143): a list view filter the schema
// still accepts but the engine refuses, refused at publish and in
// `os validate` / `build`, and five advisories on dashboards, boards and the
// app shell. Notice only: no key is removed and no D2 conversion exists,
// because the fix is a choice only the author can make (which stored field to
// filter on).
export const entry: SemanticMigration = {
  id: 'publish-refuses-views-and-dashboards-that-save-and-do-not-work',
  surface:
    'One author-time error, run by `os validate` / `lint` / `compile` / `build`: a list view filter, or a '
    + '`userFilters.tabs[]` preset, keyed on a `formula` field (`list-view-filter-field-virtual`, also refused by '
    + 'the runtime publish gate on a `view` or `object` write). '
    + 'Five warnings: a dashboard with `widgets: []` (`dashboard-without-widgets`), a `kanban` board grouped by a '
    + 'field with no fixed set of lanes '
    + '(`list-view-kanban-group-field-uncategorical`), an app with no navigation entry (`app-navigation-empty`), an '
    + 'object no app\'s navigation opens (`object-unreachable-from-navigation`) and an object navigation opens with '
    + 'no list view (`object-without-view`)',
  replacement:
    'Filter on the stored fields the formula reads, or on a stored field written when its sources change',
  reason:
    'The filter parses and publishes, then shows nothing: the engine refuses a query filtered on a field computed '
    + 'on read (400 INVALID_FIELD), so the view opens on that error every time. Stored metadata is not rewritten or refused at boot. The next publish of a view '
    + 'or object carrying such a filter is refused with the fix named; the warnings never refuse.',
  acceptanceCriteria:
    'os validate reports no list-view-filter-field-virtual error; a publish of every view and object the package carries succeeds.',
};
