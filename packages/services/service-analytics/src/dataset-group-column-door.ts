// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#28765, #28798] The one refusal every `queryDataset` face answers for a
 * selection that asks one column for two values under one name: the column
 * raw beside its own bucket, or two buckets of it.
 *
 * The ObjectQL strategy names a group key once when several dimensions read it
 * (#28744), so what still names a column twice is such a selection. Native
 * declines every bucketed time dimension to the ObjectQL strategy, and only a
 * bucket can name a column twice, so both live faces reach the strategy, which
 * calls this door on the keys it built (`execute` and `executeCrossObject`)
 * right before `engine.aggregate`. The draft preview, which hands no engine
 * anything, calls it on the keys the strategy's direct path would build
 * (`aggregateGroupKeys`), on the object it names (`aggregateObjectOf`).
 *
 * Why not leave it to the engine: `@objectstack/objectql`'s
 * `assertAggregatedColumnsAreDistinct` (`aggregate-query-shape-door.ts`)
 * refuses the same keys with the same `code`, status, `param`, `path`,
 * `object` and `fields`, but prescribes "give one of the group entries its own
 * 'alias'", and a dataset selection (`dimensions` / `timeDimensions`) has no
 * alias. That door stays the backstop for a direct `engine.aggregate` caller,
 * who can alias. Here only the prescription differs: it names the selection's
 * members over the column and a repair the selection can make.
 * `preview-time-filter-fk-parity.test.ts` pins the sentence on all three faces
 * and the engine's own on a direct caller.
 */

import { StandardErrorCode } from '@objectstack/spec/api';
import type { AnalyticsQuery } from '@objectstack/spec/contracts';
import type { AggregateGroupKey } from './strategies/objectql-strategy.js';

type GroupColumnRefusal = Error & {
  code?: string; status?: number; httpStatus?: number;
  fields?: string[]; object?: string; param?: string; path?: string;
};

/** The column a key projects, and how the engine names its position. */
function columnOf(key: AggregateGroupKey, i: number): { column: string; path: string } {
  return typeof key === 'string'
    ? { column: key, path: `groupBy.${i}` }
    : { column: key.field, path: `groupBy.${i}.field` };
}

/**
 * The repair `query` can make when it asks `column` twice: raw beside a bucket
 * when either key is the bare column, else two buckets. Names the selection's
 * members over the column, read with `memberColumn`.
 */
function prescription(
  column: string,
  rawBesideBucket: boolean,
  query: AnalyticsQuery,
  memberColumn: (member: string) => string,
): string {
  const bucketed = new Set<string>();
  const buckets = new Set<string>();
  for (const td of query.timeDimensions ?? []) {
    if (!td.granularity) continue;
    bucketed.add(td.dimension);
    if (memberColumn(td.dimension) === column) buckets.add(`'${td.dimension}' by ${td.granularity}`);
  }
  const raw = new Set((query.dimensions ?? []).filter((d) => !bucketed.has(d) && memberColumn(d) === column).map((d) => `'${d}'`));
  const listed = (key: string, members: Set<string>) => (members.size > 0 ? `\`${key}\` ${[...members].join(', ')}` : '');
  const named = (parts: string[]) => (parts.some(Boolean) ? ` (${parts.filter(Boolean).join('; ')})` : '');
  return rawBesideBucket
    ? `The selection asks for '${column}' both raw and bucketed${named([listed('dimensions', raw), listed('timeDimensions', buckets)])}. `
      + 'Drop the raw dimension from `dimensions`, or drop the granularity from the `timeDimensions` entry.'
    : `The selection asks for '${column}' at two granularities${named([listed('timeDimensions', buckets)])}. `
      + 'Ask one granularity of it in `timeDimensions`.';
}

/**
 * Refuse the dataset `query` when two of the `groupBy` keys built for it on
 * `object` project one column, with `INVALID_QUERY` / 400 and the engine's
 * keys. `memberColumn` reads the column a selection member names.
 */
export function assertDatasetGroupColumnsDistinct(
  object: string,
  groupBy: readonly AggregateGroupKey[],
  query: AnalyticsQuery,
  memberColumn: (member: string) => string,
): void {
  const seen = new Map<string, { path: string; raw: boolean }>();
  for (const [i, key] of groupBy.entries()) {
    const { column, path } = columnOf(key, i);
    const first = seen.get(column);
    if (first === undefined) {
      seen.set(column, { path, raw: typeof key === 'string' });
      continue;
    }
    const err = new Error(
      `aggregate('${object}'): ${path} names the column '${column}', which ${first.path} already names — `
      + 'one row cannot carry two values under one column. The query was NOT run. '
      + `${prescription(column, first.raw || typeof key === 'string', query, memberColumn)} A repeated column name `
      + 'kept only the last value written under it: a count overwritten by a sum, or the group keys replaced '
      + 'by the numbers, while the answer looked served.',
    ) as GroupColumnRefusal;
    err.code = StandardErrorCode.enum.INVALID_QUERY;
    err.status = 400;
    err.httpStatus = 400;
    Object.assign(err, { object, param: 'groupBy', path, fields: [column] });
    throw err;
  }
}
