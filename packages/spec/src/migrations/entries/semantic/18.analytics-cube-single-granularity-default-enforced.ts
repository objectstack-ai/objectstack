// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// An inert key made real, and the one request class that goes from answered to
// refused because of it — the shape of
// `analytics-cube-public-default-visible-enforced`. There is no D2 conversion:
// no spelling moves, and whether a one-interval list means "bucket by this by
// default" or "the one interval I happened to list" is the author's intent,
// which the chain cannot read. The protocol-18 conversion
// `cube-sub-day-granularities-removed` is why the entry is owed even to an
// author who never wrote a one-interval list. No backticks in `surface`: the
// upgrade guide renders it inside a code span and a table cell.
export const entry: SemanticMigration = {
  id: 'analytics-cube-single-granularity-default-enforced',
  surface:
    'data.Cube.dimensions.granularities — an analytics cube time dimension whose granularities '
    + 'list holds exactly one interval, whether an author wrote it that way or the protocol 18 '
    + 'conversion cube-sub-day-granularities-removed reduced a longer list to it',
  replacement:
    'nothing, when that one interval is the bucket the dimension should be grouped at by default. '
    + 'When it is not, list every interval the dimension serves (two or more state no default) or '
    + 'omit the key. A dashboard or report that charts a custom-SQL measure over such a dimension '
    + 'either stops grouping by it or groups by a dimension that declares no single interval',
  reason:
    'An inert key made real. A cube time dimension\'s `granularities` was read only for a cube the '
    + 'dataset compiler minted, where a one-interval list is the dataset\'s default bucket. A cube '
    + 'authored with `defineCube()` or `defineStack({ analyticsCubes })` never reached that reader, '
    + 'so grouping by its time dimension grouped raw timestamps, one group per distinct instant, '
    + 'whatever the list said. The analytics service now reads every cube by the compiled-dataset '
    + 'rule: on `/analytics/query` and on the `/analytics/sql` dry run, a time dimension the query '
    + 'groups by without stating a granularity is bucketed at the one interval its list declares. '
    + 'A granularity the query states still wins, one the list does not name is not refused, and a '
    + 'list of two or more states no default. Two holdings change on upgrade. A query grouping by '
    + 'such a dimension answers one row per bucket where it answered one row per timestamp. And a '
    + 'bucketed query is served by the engine aggregate path, which refuses a custom-SQL measure — a '
    + '`number`, `string` or `boolean` measure whose `sql` is an expression — with 400 '
    + '`INVALID_FIELD`, the same refusal, byte for byte, that the same query already got with that '
    + 'granularity stated by hand; so such a measure grouped by such a dimension goes from answered '
    + 'to refused. The protocol-18 conversion `cube-sub-day-granularities-removed` strips the retired '
    + 'sub-day intervals from every authored and stored cube, so a dimension that offered one '
    + 'sub-day interval and one coarser interval now holds a one-interval list: a default bucket its '
    + 'author never wrote.',
  acceptanceCriteria:
    'Every cube time dimension whose `granularities` lists exactly one interval is one you mean to '
    + 'bucket at that interval by default: a query that groups by it on `/analytics/query` answers '
    + 'one row per bucket, and `/analytics/sql` shows the bucketed statement. Every time dimension '
    + 'that should have no default lists two or more intervals or omits the key. No dashboard or '
    + 'report groups a custom-SQL measure by a one-interval dimension — or each one that did now '
    + 'groups by a dimension without a single interval.',
};
