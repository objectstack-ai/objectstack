// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

export const entry: SemanticMigration = {
  id: 'analytics-authorable-unknown-keys-refused',
  // Same-major bookkeeping (#10414): batch D also closed the nested
  // `Metric.filters[]` item, but `Metric.filters` was REMOVED outright later
  // in this same unpublished major (retired-key entry `data/Metric:filters`,
  // conversion `metric-filters-removed`), so this entry no longer names a
  // surface an 18.x author can reach.
  surface: 'analytics cube definitions (`defineCube` / `defineStack({ analyticsCubes })`: the '
    + 'cube, its `refreshKey`, each metric, each dimension, each '
    + 'join) and the `/analytics/query` body\'s nested `timeDimensions[]` items — undeclared keys',
  replacement: 'the declared key the rejection names. Every rejection carries the surface, the '
    + 'offending key and a rename suggestion (`title` → `label` on a metric/dimension, `label` → '
    + '`title` on the cube, `granuarity` → `granularity`, `orderBy` → `order`; `filters` on a '
    + 'query gets the `where` prescription). A key that names no supported capability is simply '
    + 'removed',
  reason:
    'The #4001 strictness campaign\'s data/ batch D. These shapes parsed `.strip` — an '
    + 'undeclared key on an authored cube was silently dropped, so a join authored with a '
    + 'typo\'d `relationship` registered with the `many_to_one` default (a different join than '
    + 'the author declared) and a metric\'s misspelled key vanished under a successful parse. '
    + 'The subtle half: `/analytics/query`\'s top level has been strict since #3878, but '
    + 'top-level strictness does not recurse — `timeDimensions: [{ dimension, granuarity: '
    + '\'day\' }]` rode through the strict wrapper with the typo stripped, bucketing the whole '
    + 'range as one group under an ordinary 200. Undeclared keys on all eight sites are now '
    + 'refused at parse time with a prescriptive message. (One of the eight — the nested metric '
    + '`filters[]` item — was itself removed later in this major: #10414, `metric-filters-removed`.)',
  acceptanceCriteria:
    'Every cube in `defineStack({ analyticsCubes })` / `defineCube` parses with only declared '
    + 'keys at every level (cube, refreshKey, measures, dimensions, joins); '
    + 'every `/analytics/query` body\'s `timeDimensions[]` items carry only '
    + '`dimension`/`granularity`/`dateRange`. Declared keys parse byte-identically to before.',
};
