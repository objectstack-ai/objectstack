// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// #21464 — the `object-metric` page block's `drillDown.report` was `z.unknown()`:
// the tile hands it to the shared drill drawer, which draws a dataset-bound
// report and lists the records for any other value, and no spec drill shape
// declared it. The maintainer ruled on #21704 (fork 1, letter B) that it is
// `ReportSchema` by reference, once a joined report refuses a block that binds
// no dataset (#21702), so a report the member admits is one the drawer draws.
// D3 only: page-component `properties` is not parsed on the metadata save or
// load path, so a stored page is never refused; and the authored census found
// no drawn report to respell — the refused values are objectui's probes of the
// values the drawer does NOT draw.
export const entry: SemanticMigration = {
  id: 'ui-object-metric-drill-down-report-typed',
  surface: 'page `object-metric` components — `properties.drillDown.report` (which used to accept any value)',
  replacement: 'a report definition, the same shape as `reports[]` (`ReportSchema`): `{ name, label, dataset, '
    + 'values, … }`, or a `joined` report whose every block binds a `dataset`. Write a bare report name, a '
    + '`{ name }` reference or the retired `objectName` / `columns` form as the dataset-bound report itself.',
  reason: 'The metric tile hands `drillDown.report` to the shared drill drawer, which draws it as a report — with '
    + 'the metric\'s filter joined into the report\'s own `runtimeFilter` — when it is dataset-bound (a non-empty '
    + '`dataset`, or a `joined` report with a block that binds one), and lists the records for any other value. '
    + 'The page-component row declared it `z.unknown()`, so a report with no `dataset`, a misspelled report key, a '
    + 'bare report name or a `{ name }` reference passed the component-props gate, and the drawer quietly listed '
    + 'the records instead. The row now takes `ReportSchema` by reference — the declaration objectui already '
    + 'names for the member — and, since a joined report refuses a block that binds no `dataset`, every report it '
    + 'admits is one the drawer draws. It is read where every page component\'s props are: the component-props gate '
    + 'reports a refused value as an advisory `component-props-invalid` / `component-props-unknown-key` finding on '
    + '`objectstack validate`, `objectstack build` and `objectstack lint`, and a stored page still saves and loads, '
    + 'because a page component\'s `properties` is not parsed on the metadata save or load path. No conversion is '
    + 'registered: nothing on the load path refuses the shape, and the authored census found no drawn report to '
    + 'respell. Deployed metadata NOT MEASURED.',
  acceptanceCriteria: 'Every `object-metric` node validates: `objectstack validate` reports no '
    + '`component-props-invalid` / `component-props-unknown-key` finding under `properties.drillDown.report`. Each '
    + 'tile whose drill names a report opens that report, scoped by the metric\'s filter, instead of the record list.',
};
