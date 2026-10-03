// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// #21464 — two members of the `object-metric` page block were `z.unknown()`
// although the tile reads each with a fixed shape, so an off-shape value passed
// the component-props gate and the tile asked the server for a measure it could
// not answer or drew an empty badge, in silence. `aggregate` now takes the query
// AST's aggregation functions and the chart aggregate's `groupBy` union by
// reference (`groupBy` optional: a metric is one number), and `trend` the
// badge's measured shape. `drillDown` and `compareTo` are held at `z.unknown()`: each
// by-reference candidate disagrees with the tile's read (the chart's drill-down
// declares `filter`, which the tile never reads, and refuses `report`, which it
// draws; the dashboard widget's comparison declares `dimension`, never read on
// this path), so each waits on a ruling. D3 only: page-component `properties`
// is not parsed on the metadata save or load path, so a stored page is never
// refused; an off-shape value has no rewrite that says what the author meant;
// and the authored census found no authored value to respell — every refused
// value is a fixture probing that the tile does not draw it.
export const entry: SemanticMigration = {
  id: 'ui-object-metric-aggregate-trend-typed',
  surface: 'page `object-metric` components — `properties.aggregate` and `.trend` (which used to accept any '
    + 'value)',
  replacement: 'the shape the tile reads: `aggregate` `{ field?, function, groupBy? }`, with `function` one of '
    + 'the engine\'s `count`, `sum`, `avg`, `min`, `max` or `count_distinct`, a `field` for every function but '
    + '`count`, and `groupBy` the chart aggregate\'s own union — a field name or a `{ field, dateGranularity?, '
    + 'alias? }` date-bucket node — here optional; `trend` `{ value, label?, direction? }`, with `value` a number, `label` a string '
    + 'or an inline locale map and `direction` `up`, `down` or `neutral`. Write a string `aggregate` as an '
    + 'object (`\'count\'` → `{ function: \'count\' }`); move `dateGranularity` inside `groupBy`; write a bare '
    + 'trend direction as `{ value, direction }`.',
  reason: 'The tile reads these members with one shape, and the page-component row declared them '
    + '`z.unknown()`, so any value passed the component-props gate and the tile answered an off-shape one in '
    + 'silence: a string `aggregate` or a function the engine does not have asked the server for a measure it does not '
    + 'have, so the tile showed an error or, on the client-side fallback, a sum it was not asked for; '
    + '`groupby` for `groupBy` drew one ungrouped '
    + 'number; and a `trend` with no `value` painted a lone `%`, with a misspelled member or direction simply '
    + 'not drawn. The row now takes the query AST\'s own aggregation functions — the six the tile forwards to '
    + 'the engine — and the chart aggregate\'s `groupBy` union by reference, and the badge\'s measured shape for '
    + '`trend`. The aggregate is not the chart\'s whole: the chart requires `groupBy` and five functions, while '
    + 'a metric paints one number over every row and draws a `count_distinct` wherever the analytics service '
    + 'answers it. `drillDown` and `compareTo` stay open: the chart\'s drill-down '
    + 'declares a `filter` the tile never reads and refuses a `report` it draws, and the dashboard widget\'s '
    + 'comparison declares a `dimension` this path never reads, so each waits on a ruling between the '
    + 'reference and the read. It is read where every page component\'s props are: the component-props gate '
    + 'reports a refused value as an advisory `component-props-invalid` / `component-props-unknown-key` finding '
    + 'on `objectstack validate`, `objectstack build` and `objectstack lint`, and a stored page still saves and '
    + 'loads, because a page component\'s `properties` is not parsed on the metadata save or load path. No '
    + 'conversion is registered: nothing on the load path refuses the shape, and an off-shape value has no '
    + 'rewrite that both keeps what the tile shows today and honours what the author wrote — which is the '
    + 'judgment this entry leaves to the upgrader. Deployed metadata NOT MEASURED.',
  acceptanceCriteria: 'Every `object-metric` node validates: `objectstack validate` reports no '
    + '`component-props-invalid` / `component-props-unknown-key` finding under the two members\' paths. Each '
    + 'tile that set one of them now shows it: the number its aggregate names, grouped or bucketed as written, '
    + 'and the trend badge with its value, arrow and caption.',
};
