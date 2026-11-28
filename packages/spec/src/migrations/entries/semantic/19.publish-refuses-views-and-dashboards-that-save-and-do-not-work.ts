// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// The upgrade-guide entry of the Views, dashboards and app shell family of the
// second batch of author-time rules (#35143): a list view filter or a dashboard
// the schema still accepts but that shows nothing, refused at publish and in
// `os validate` / `build`, and four advisories on the app shell. Notice only:
// no key is removed and no D2 conversion exists, because each fix is a choice
// only the author can make (which stored field to filter on, which widget to
// add).
export const entry: SemanticMigration = {
  id: 'publish-refuses-views-and-dashboards-that-save-and-do-not-work',
  surface:
    'Two author-time errors, run by `os validate` / `lint` / `compile` / `build`: a list view filter, or a '
    + '`userFilters.tabs[]` preset, keyed on a `formula` field (`list-view-filter-field-virtual`, also refused by '
    + 'the runtime publish gate on a `view` or `object` write); and a dashboard with `widgets: []` '
    + '(`dashboard-without-widgets`, a warning at the runtime publish gate, where Studio creates a dashboard empty). '
    + 'Four warnings: a `kanban` board grouped by a field with no fixed set of lanes '
    + '(`list-view-kanban-group-field-uncategorical`), an app with no navigation entry (`app-navigation-empty`), an '
    + 'object no app\'s navigation opens (`object-unreachable-from-navigation`) and an object navigation opens with '
    + 'no list view (`object-without-view`)',
  replacement:
    'Filter on the stored fields the formula reads, or on a stored field written when its sources change; add a '
    + 'widget bound to a dataset, or remove the dashboard',
  reason:
    'Each parses and publishes, then shows nothing: the engine refuses a query filtered on a field computed on read '
    + '(400 INVALID_FIELD), so the view opens on that error every time; a dashboard with no widgets opens on its '
    + 'header over an empty canvas. Stored metadata is not rewritten or refused at boot. The next publish of a view '
    + 'or object carrying such a filter is refused with the fix named; the warnings never refuse.',
  acceptanceCriteria:
    'os validate reports neither error; a publish of every view and object the package carries succeeds.',
};
