// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// #29023. An accept-set narrowing of the dashboard schema with no conversion:
// two globalFilters entries under one key (name, else field) are refused by the
// dashboard parse. Which definition keeps the name, and which widgets bind the
// renamed one, only the author knows. Same class as
// ui-dashboard-filter-binding-unknown-refused.
export const entry: SemanticMigration = {
  id: 'ui-dashboard-global-filter-duplicate-name-refused',
  surface: 'dashboard.globalFilters — two or more entries under the same filter key (the entry\'s '
    + '`name`, or its `field` when it has no `name`), e.g. globalFilters: [{ name: \'r\', field: '
    + '\'region\' }, { name: \'r\', field: \'status\' }]',
  replacement: 'One entry per filter key on each dashboard. Rename all but one of the colliding entries '
    + '(and every widget `filterBindings` key that means a renamed one), or delete the copy. Two filters '
    + 'over the same `field` stay legal when their names differ.',
  reason:
    'A global filter\'s key is the one the filter bar draws its control under, the key a widget\'s '
    + '`filterBindings` names and the `page.<name>` variable its value is published as. The schema typed '
    + '`globalFilters` as a plain array, so two entries under one key parsed and the dashboard save door '
    + 'answered 200. The board then drew ONE control, and the value typed into it filtered the field of '
    + 'the other definition: the widget query carried the second entry\'s field and the tile read a number '
    + 'the author never asked for, with nothing on the page to say so. `DashboardSchema` now refuses the '
    + 'pair at every door that parses a dashboard: `defineStack`, `os validate`, `os build` and the '
    + 'dashboard save door (`422 INVALID_METADATA`), with one issue at the second declaration\'s `name` '
    + '(or `field`) naming the key and every index. Not convertible: which definition keeps the name, and '
    + 'whether the copy should go, is a fact only the author holds, and renaming on their behalf would '
    + 'silently unbind every widget that meant the renamed one.',
  acceptanceCriteria:
    'Each dashboard parses without a `custom` issue at `globalFilters[i].name` (or `.field`) of the form '
    + '"This dashboard declares the global filter X twice in globalFilters: globalFilters[i] and '
    + 'globalFilters[j]", and saves. After renaming, check that every widget `filterBindings` key names the '
    + 'filter it meant, and that `os validate` reports no `dashboard-filter-binding-unknown` finding. A '
    + 'stored `sys_metadata` dashboard that still repeats a key still loads, with `_diagnostics` reading '
    + '`valid: false` and carrying this refusal, and its next save (draft or publish) is refused; nothing '
    + 'rewrites it. `os migrate meta --stored` lists each such stored dashboard under this entry\'s id, at '
    + 'the second declaration\'s `name` (or `field`). Measured before the change: no authored dashboard in '
    + 'this repository\'s examples, platform objects, docs or skills repeats a filter key.',
};
