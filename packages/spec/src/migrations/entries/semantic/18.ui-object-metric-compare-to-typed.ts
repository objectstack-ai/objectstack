// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// #21464 — the `object-metric` page block's `compareTo` was `z.unknown()`
// although the tile reads it with one shape, so a bare kind string, a kind
// outside the two or a `dimension` passed the component-props gate, and the
// tile compared against the previous period, or shifted its own filter's window
// rather than the dimension named, in silence. It now takes the tile's read:
// `{ kind }`, with `kind` the dashboard widget comparison's own vocabulary by
// reference, and `dimension` refused by name with a prescription (the inline
// tile shifts the date macros in its own `filter` and never reads a dataset
// time dimension). D3 only: page-component `properties` is not parsed on the
// metadata save or load path, so a stored page is never refused; a `dimension`
// has no rewrite that keeps the window the author meant; and the authored census
// found no authored value to respell — the one refused value is a fixture
// probing that the tile does not read `dimension`.
export const entry: SemanticMigration = {
  id: 'ui-object-metric-compare-to-typed',
  surface: 'page `object-metric` components — `properties.compareTo` (which used to accept any value)',
  replacement: 'the shape the tile reads: `{ kind }`, with `kind` the dashboard widget comparison\'s own '
    + 'vocabulary, `previousPeriod` or `previousYear`. Write a bare kind string as an object '
    + '(`\'previousYear\'` → `{ kind: \'previousYear\' }`), and delete a `dimension`: the tile shifts the date '
    + 'macros in its own `filter`, so state the window there.',
  reason: 'The tile reads `compareTo` with one shape — `kind` alone, dispatching on `previousYear` and treating '
    + 'every other value as `previousPeriod` — and the page-component row declared it `z.unknown()`, so any value '
    + 'passed the component-props gate and the tile answered an off-shape one in silence: a bare `\'previousYear\'` '
    + 'or a kind outside the two compared against the previous period, and a `dimension` was carried and never '
    + 'read, because this inline tile shifts the date macros in its own `filter` while only a dashboard widget\'s '
    + 'dataset path hands `dimension` to the analytics executor. The row now takes `{ kind }`, with `kind` the '
    + 'dashboard widget comparison\'s own member by reference, and refuses `dimension` by name with that '
    + 'prescription rather than accepting a key the tile ignores. It is read where every page component\'s props '
    + 'are: the component-props gate reports a refused value as an advisory `component-props-invalid` / '
    + '`component-props-unknown-key` finding on `objectstack validate`, `objectstack build` and `objectstack '
    + 'lint`, and a stored page still saves and loads, because a page component\'s `properties` is not parsed on '
    + 'the metadata save or load path. No conversion is registered: nothing on the load path refuses the shape, '
    + 'and a `dimension` has no rewrite that keeps the window the author meant — which is the judgment this entry '
    + 'leaves to the upgrader. Deployed metadata NOT MEASURED.',
  acceptanceCriteria: 'Every `object-metric` node validates: `objectstack validate` reports no '
    + '`component-props-invalid` / `component-props-unknown-key` finding under `properties.compareTo`. Each tile '
    + 'that sets a comparison shows its trend labelled for the kind it names, over the window its own `filter` '
    + 'resolves to.',
};
