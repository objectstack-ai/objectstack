// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

export const entry: SemanticMigration = {
  id: 'query-array-string-agg-retired',
  surface: "data.query.aggregations[].function ('array_agg' / 'string_agg')",
  replacement:
    'an ordinary `fields` query, shaped in the caller — or a stored field that materialises '
    + 'the roll-up. For a deduplicated COUNT the live spelling is unchanged: '
    + '`count_distinct` stays declared',
  reason:
    'The stored half of this retirement is a conversion '
    + '(`dataset-measure-array-string-agg-removed`); this entry is the REQUEST half. '
    + '`QueryAST` is never stored in stack metadata — it is the client SDK builder\'s output '
    + 'and the `POST /data/:object/query` body — so there is no source for the chain to '
    + 'rewrite and callers move their own queries. Both values were declared-but-unlowered '
    + 'on the SQL family: `SqlDriver.mapAggregateFunc` and the Turso '
    + '`RemoteTransport.aggregate` compile five functions and refuse the rest, so a caller '
    + 'following the schema against a SQL datasource got a refusal, not an array. They did '
    + 'run on `driver-mongodb` and on the engine\'s in-memory fallback, which is what makes '
    + 'this the one narrowing in the batch that removes reachable behaviour: an aggregation '
    + 'that worked on one backend and failed on another is exactly the unpredictability the '
    + 'ruling ended, and #5499 has both of those backends frozen. `count_distinct` was '
    + 'deliberately NOT retired with them (maintainer, 2026-08-07) — it takes ADR-0049\'s '
    + 'enforce leg, and its SQL lowering is a separate drivers-side card. ADR-0049, #6188.',
  acceptanceCriteria:
    'No caller sends `array_agg` or `string_agg` in `aggregations[].function`; list-style '
    + 'roll-ups are assembled by the caller from an ordinary `fields` query, or materialised '
    + 'as a stored field. A query still carrying either value fails to parse with the '
    + 'removal prescription naming it, and authoring it is a `tsc` error at the call site; '
    + '`count_distinct` continues to parse and is unaffected.',
};
