// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// An accept-set narrowing with no conversion: only the author knows which
// declared filter a misspelled key meant, or whether the entry should go.
export const entry: SemanticMigration = {
  id: 'ui-dashboard-filter-binding-unknown-refused',
  surface: 'dashboard.widgets[].filterBindings — a KEY that names no filter the dashboard '
    + 'declares (no `globalFilters` entry under that name, its `field` when unnamed, and not '
    + '`dateRange` on a dashboard that declares `dateRange`)',
  replacement: 'the key renamed to a declared filter name (the refusal names the nearest one), the '
    + 'filter declared on the dashboard, or the entry deleted. A `dateRange` key binds only on a '
    + 'dashboard that declares `dateRange`.',
  reason:
    'The schema types `filterBindings` as an open record, so any key parsed, and no author-time rule '
    + 'checked the keys against the dashboard: `dashboard-filter-field-unknown` judges only the '
    + 'EFFECTIVE field of each declared filter. The runtime reads a binding by looking up each '
    + 'declared filter\'s name (`widget.filterBindings?.[def.name]` in the dashboard renderer), so a '
    + 'key no filter carries is never read. A misspelled opt-out (`{ regoin: false }`) therefore '
    + 'leaves the widget scoped by the filter it was meant to ignore, and a misspelled re-target '
    + 'leaves the filter on its default field: the widget counts different rows than the author '
    + 'wrote and the page says nothing. The lint rule `dashboard-filter-binding-unknown` now refuses '
    + 'such a key at `os validate`, `os build` and the metadata publish door (`422 '
    + 'INVALID_METADATA`); a draft still saves and its `_diagnostics` report the same verdict. '
    + 'There is no mechanical rewrite: a conversion cannot know which filter a misspelled key '
    + 'meant, and deleting the entry on the author\'s behalf would hide the opt-out they believe is '
    + 'in force. A stored `sys_metadata` dashboard carrying such a key still loads and renders as '
    + 'before (the rule runs on the authoring path, not the load path); its next save or publish is '
    + 'refused until the key is fixed.',
  acceptanceCriteria:
    'Every dashboard widget\'s `filterBindings` keys each name a filter that dashboard declares: '
    + 'a `globalFilters[].name` (or the entry\'s `field` when it has no `name`), or `dateRange` on a '
    + 'dashboard that declares `dateRange`. `os validate` reports no '
    + '`dashboard-filter-binding-unknown` finding, and each affected dashboard publishes. Measured '
    + 'before the change: no dashboard in this repository\'s examples, platform objects, docs or '
    + 'skills, nor in the public HotCRM app, binds an undeclared key.',
};
