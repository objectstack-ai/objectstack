// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// #21464 — the `object-metric` page block's `drillDown` was `z.unknown()`
// although the tile reads it with one shape, so a drill `filter`, a `mode`, a
// misspelled member or a non-numeric page size passed the component-props gate
// and the tile ignored each, in silence. It now takes the tile's read: the five
// list members (`enabled`, `title`, `target`, `columns`, `maxRows`) are the chart
// drill-down's own by reference, and `filter` and `mode` are refused by name with
// the prescriptions the renderer's own type for this block carries (a metric has
// no click event for a drill filter to resolve against, and no row for `mode` to
// open). The drill `report` is held open, not typed: the tile draws a
// dataset-bound report, but the spec declares no drill report yet. D3 only:
// page-component `properties` is not parsed on the metadata save or load path, so
// a stored page is never refused; a drill `filter` has no rewrite that keeps the
// scope the author meant; and the authored census found no authored value to
// respell — the two refused values are fixtures probing the refusal.
export const entry: SemanticMigration = {
  id: 'ui-object-metric-drill-down-typed',
  surface: 'page `object-metric` components — `properties.drillDown` (which used to accept any value)',
  replacement: 'the shape the tile reads: `{ enabled?, title?, target?, columns?, maxRows?, report? }`, the first '
    + 'five the chart drill-down\'s own members — `enabled` a boolean, `title` a string, `target` `drawer`, '
    + '`dialog` or `navigate`, `columns` field names, `maxRows` a positive whole number — and `report` still open. '
    + 'Delete a drill `filter` and scope the metric with its own `filter`, one level up; delete a `mode`, since a '
    + 'metric always lists the records behind its number.',
  reason: 'The tile reads `drillDown` with one shape — `enabled`, `title`, `target`, `columns`, `maxRows` and '
    + '`report`, scoping the drilled list by the metric\'s own `filter` — and the page-component row declared it '
    + '`z.unknown()`, so any value passed the component-props gate and the tile answered an off-shape one in '
    + 'silence: a drill `filter` or a `mode` was carried and never read, a misspelled member was simply not '
    + 'applied, and a non-numeric page size reached the drilled list. The row now takes the five list members '
    + 'the chart drill-down declares, by reference, and refuses `filter` and `mode` by name: a metric tile has no '
    + 'click event for a drill filter to resolve against, and no row for `mode` to open as a record. The chart\'s '
    + 'shape is not taken whole, because it declares `filter`. The drill `report` stays open: the tile draws a '
    + 'dataset-bound report through the shared drawer, but no spec drill shape declares a `report` member yet. '
    + 'It is read where every page component\'s props are: the component-props gate reports a refused value as '
    + 'an advisory `component-props-invalid` / `component-props-unknown-key` finding on `objectstack validate`, '
    + '`objectstack build` and `objectstack lint`, and a stored page still saves and loads, because a page '
    + 'component\'s `properties` is not parsed on the metadata save or load path. No conversion is registered: '
    + 'nothing on the load path refuses the shape, and a drill `filter` has no rewrite that keeps the scope the '
    + 'author meant — which is the judgment this entry leaves to the upgrader. Deployed metadata NOT MEASURED.',
  acceptanceCriteria: 'Every `object-metric` node validates: `objectstack validate` reports no '
    + '`component-props-invalid` / `component-props-unknown-key` finding under `properties.drillDown`. Each tile '
    + 'that sets a drill-down opens it as written: the panel shape `target` names, the heading `title` names, '
    + 'and the records behind the number, scoped by the metric\'s own `filter`, in the columns and page size '
    + 'written.',
};
