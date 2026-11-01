// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#28765] The draft preview's copy of the engine's duplicate-group-column
 * refusal.
 *
 * Both live faces hand `engine.aggregate` the `groupBy` the ObjectQL strategy
 * builds (the native strategy delegates a bucketed time dimension to it), and
 * the engine refuses one naming a column twice: `@objectstack/objectql`'s
 * `assertAggregatedColumnsAreDistinct` (`aggregate-query-shape-door.ts`),
 * `INVALID_QUERY` / 400. The strategy already names a key once when several
 * dimensions read it (#28744), so what still reaches that refusal is a
 * selection asking one column for two values under one name: the column raw
 * beside its own bucket, or two buckets of it.
 *
 * The preview evaluates drafted rows in memory and hands no engine anything,
 * so it served both columns. It now judges the strategy's own keys
 * (`aggregateGroupKeys`, the function the strategy's direct path builds them
 * with, so the positions are the engine's) on the object the strategy names
 * (`aggregateObjectOf`), and refuses the same way.
 *
 * Why a copy and not the engine's function: `@objectstack/objectql` is a dev
 * dependency of this package, never a runtime one, and its root does not
 * export the door. The message, code, status and keys here are the engine's,
 * byte for byte, and `preview-time-filter-fk-parity.test.ts` compares the
 * preview's refusal with both live faces' field by field, so a change to the
 * engine's wording reds that test. Only the `groupBy` half is copied: the
 * strategy's keys carry no `alias`, and a measure alias colliding with a group
 * column is a different question.
 */

import { StandardErrorCode } from '@objectstack/spec/api';
import type { AnalyticsQuery } from '@objectstack/spec/contracts';
import type { Cube } from '@objectstack/spec/data';
import { aggregateGroupKeys, aggregateObjectOf, type AggregateGroupKey } from './strategies/objectql-strategy.js';

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
 * Refuse `query` when two of the keys the ObjectQL strategy would hand the
 * engine for it over `cube` project one column, with the engine's refusal for
 * it.
 */
export function assertPreviewGroupColumnsDistinct(query: AnalyticsQuery, cube: Cube): void {
  const object = aggregateObjectOf(cube);
  const groupBy = aggregateGroupKeys(query, cube);
  const seen = new Map<string, string>();
  for (const [i, key] of groupBy.entries()) {
    const { column, path } = columnOf(key, i);
    const first = seen.get(column);
    if (first === undefined) {
      seen.set(column, path);
      continue;
    }
    const err = new Error(
      `aggregate('${object}'): ${path} names the column '${column}', which ${first} already names — `
      + `one row cannot carry two values under one column. The query was NOT run. Give one of the group `
      + "entries its own 'alias'. A repeated column name kept only the last value written under it: a "
      + 'count overwritten by a sum, or the group keys replaced by the numbers, while the answer looked served.',
    ) as GroupColumnRefusal;
    err.code = StandardErrorCode.enum.INVALID_QUERY;
    err.status = 400;
    err.httpStatus = 400;
    Object.assign(err, { object, param: 'groupBy', path, fields: [column] });
    throw err;
  }
}
