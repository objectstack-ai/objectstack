// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// #29213. An accept-set narrowing of the dashboard schema with no conversion:
// on a dashboard that declares the built-in `dateRange`, a globalFilters entry
// keyed `dateRange` (name, else field) is refused by the dashboard parse.
// Whether the entry was meant as the date range or as a filter of its own, and
// which widgets bind it, only the author knows. Same class as
// ui-dashboard-global-filter-duplicate-name-refused.
export const entry: SemanticMigration = {
  id: 'ui-dashboard-global-filter-reserved-date-range-refused',
  surface: 'dashboard.globalFilters — an entry keyed `dateRange` (its `name`, or its `field` when it has '
    + 'no `name`) on a dashboard that also declares `dateRange`, e.g. dateRange: { field: \'close_date\' }, '
    + 'globalFilters: [{ name: \'dateRange\', field: \'region\' }]',
  replacement: 'Give the entry another `name` (and rename every widget `filterBindings.dateRange` key that '
    + 'means it), or delete it and keep the built-in `dateRange`. On a dashboard that does not declare '
    + '`dateRange`, an entry keyed `dateRange` stays legal.',
  reason:
    'The built-in date range is a filter the dashboard declares under the reserved key `dateRange`: the '
    + 'key the filter bar draws its control under and the key a widget\'s `filterBindings` names. A '
    + '`globalFilters` entry keyed `dateRange` beside it parsed and the dashboard save door answered 200. '
    + 'The console and lint both build the date range first and let the later definition win, so the '
    + 'board drew the entry\'s control in place of the declared date range, every widget binding '
    + '`dateRange` was filtered by the entry\'s field, and the only trace was a browser console warning. '
    + '`DashboardSchema` now refuses the entry at every door that parses a dashboard: `defineStack`, '
    + '`os validate`, `os build` and the dashboard save door (`422 INVALID_METADATA`), with one issue at '
    + 'the entry\'s `name` (or `field`) naming the reserved word and the built-in date range. Not '
    + 'convertible: whether the entry was meant to be the date range or a filter of its own is a fact '
    + 'only the author holds.',
  acceptanceCriteria:
    'Each dashboard parses without a `custom` issue at `globalFilters[i].name` (or `.field`) of the form '
    + '"globalFilters[i] is keyed \'dateRange\', the reserved name of the built-in date range this '
    + 'dashboard declares in `dateRange`", and saves. After renaming, check that every widget '
    + '`filterBindings` key names the filter it meant, and that `os validate` reports no '
    + '`dashboard-filter-binding-unknown` finding. A stored `sys_metadata` dashboard that still carries '
    + 'the pair still loads, with `_diagnostics` reading `valid: false` and carrying this refusal, and its '
    + 'next save (draft or publish) is refused; nothing rewrites it. Measured before the change: no '
    + 'authored dashboard in this repository\'s examples, apps, packages or ui tree keys a global filter '
    + '`dateRange`.',
};
