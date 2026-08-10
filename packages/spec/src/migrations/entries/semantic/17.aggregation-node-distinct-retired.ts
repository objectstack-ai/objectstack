// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

export const entry: SemanticMigration = {
  id: 'aggregation-node-distinct-retired',
  surface: 'data.query.aggregations[].distinct',
  replacement:
    'the `count_distinct` aggregation FUNCTION for a deduplicated count — the one '
    + 'deduplicating spelling every face computes, lowered to `COUNT(DISTINCT field)` on '
    + 'both SQL faces since #6409. `SUM(DISTINCT …)` / `AVG(DISTINCT …)` get no '
    + 'replacement: no backend ever computed them here, and a per-row measure that needs '
    + 'deduplicating before summing is a modelling problem to fix in the data',
  reason:
    'A DIVERGENCE, not an inert declaration — which is why it outlived the #4286 sweep '
    + 'that dispositioned every other `data.query.*` member. That sweep asked which keys '
    + 'no executor reads; this one HAD an executor, exactly one out of six. The engine\'s '
    + 'in-memory fallback (`objectql/src/in-memory-aggregation.ts`) deduplicated the '
    + 'values before applying the function, while `SqlDriver.aggregate`, the Turso '
    + '`RemoteTransport.aggregate`, `driver-mongodb`\'s `buildAggregationStage`, '
    + '`driver-memory`\'s `computeAggregate` and service-analytics\' `AGGREGATE_SQL` all '
    + 'ignored the key. So `{ function: \'sum\', field: \'amount\', distinct: true }` '
    + 'answered a deduplicated sum when the engine fell back in memory and an ordinary sum '
    + 'on every SQL datasource: one query, two numbers, chosen by which backend happened '
    + 'to serve it — and unlike the #6203 / #5907 divergences closed on the same axis, the '
    + 'wrong answer here is a plausible NUMBER rather than a refusal, so nothing surfaced '
    + 'it to the author. Measured blast radius inside the fallback: `sum` and `avg` only — '
    + '`count` returned from its own branch before reaching the dedupe, `count_distinct` '
    + 'fed the values into a Set (dedupe-then-Set is Set), and dedupe does not move '
    + '`min`/`max`. ENFORCE was weighed and rejected (maintainer ruling 2026-08-09): '
    + '`count_distinct` already covers the only spelling anyone has measured demand for, '
    + 'and lowering `SUM(DISTINCT …)` across five faces — two of them frozen under #5499 — '
    + 'buys a shape that is near-universally a modelling mistake. A REQUEST surface — '
    + '`QueryAST` is the client SDK builder\'s output and the `POST /data/:object/query` '
    + 'body, never stored in stack metadata — so there is no source for the chain to '
    + 'rewrite and callers move their own queries: the #4286 disposition for '
    + '`joins`/`cursor`/`distinct`/`windowFunctions`, applied verbatim one level down. '
    + 'ADR-0049, #6815.',
  acceptanceCriteria:
    'No caller sends `distinct` inside an `aggregations[]` entry, on the wire or through '
    + 'the SDK; a deduplicated count is written as `{ function: \'count_distinct\', field }` '
    + 'and reads the same number on every backend. A query still carrying the key fails to '
    + 'parse with the removal prescription — including through '
    + '`EngineAggregateOptionsSchema`, which reuses `AggregationNodeSchema` by reference — '
    + 'and `POST /api/v1/data/:object/query` answers `400 VALIDATION_FAILED` with a '
    + '`fields[]` entry at `aggregations.<i>.distinct` instead of serving a number. '
    + 'Authoring it is a `tsc` error at the call site. ⚠️ The observable NUMBERS change on '
    + 'exactly one path and that is the point of the change: a `sum`/`avg` that used to be '
    + 'deduplicated by the in-memory fallback now answers what every SQL face has always '
    + 'answered for the same query. Verify against the SQL answer, not against the '
    + 'pre-upgrade fallback answer — the two disagreed, which is why the key is gone.',
};
