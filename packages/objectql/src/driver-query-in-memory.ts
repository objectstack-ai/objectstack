// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `applyDriverQueryInMemory` — the engine's own reading of a driver query over
 * rows already in memory: `where`, `orderBy`, `offset` / `limit` and `fields`,
 * in that order (ADR-0015 Tier A, epic #27261 P1).
 *
 * ## Why the engine owns this
 *
 * A plugin driver (a `driver.<name>` service a server plugin publishes) is
 * written against a remote system that may filter, sort and page some of a
 * query or none of it. `DriverCapabilities` carries no claim for any of the
 * three (the bits were retired in 17.0.0 with the prescription that `find()`
 * executes the whole AST), so the engine cannot know which parts such a
 * driver honoured. The floor in `external-driver-floor.ts` therefore applies
 * the whole query here, over whatever rows the driver returned: a driver that
 * already filtered loses nothing (filtering a filtered set is the identity),
 * and one that returned everything still answers the right subset. A driver
 * cannot opt out of correctness, only of performance (ruling 6471382887).
 *
 * ## One filter semantics, not a second one
 *
 * `where` is evaluated by objectql's own walker (`matchesDriverWhere`,
 * `having-filter.ts`), the one that already serves `having` and the
 * per-aggregation `filter`: one vocabulary, one ADR-0112 envelope, the #5298
 * null-safe negations, and a temporal comparand read by the column's storage
 * rule when `fieldClasses` names the column's class. The spec's conformance
 * tables (`FILTER_LOGIC_CASES`, `FILTER_TEXT_CASES`, `PAGINATION_*_CASES`,
 * `TEMPORAL_CASES`) are its oracle, not any one driver
 * (`driver-query-in-memory.conformance.test.ts`).
 *
 * The `where` is expected as the engine hands it to a driver: tokens resolved
 * and the shared lowering applied (`lowerFilterCondition`, ADR-0053 D-D1). The
 * helper applies no whole-day rule of its own, as no driver does.
 *
 * ## Sort and paging
 *
 * - Keys compare as `driver-memory`'s reference reading does: a value with no
 *   value (`null` / absent) sorts LAST in either direction, `Date`s as
 *   instants, everything else by `<` / `>`.
 * - A PAGED read (`limit` or `offset` present) is a partition of the result
 *   set (`IDataDriver.find`'s contract, `PAGINATION_CASES`): `id` is appended
 *   as the tie-breaker in the last key's direction (`asc` when there is none),
 *   as `driver-sql` orders a paged read. An unpaged read keeps the rows'
 *   arrival order when it carries no `orderBy`.
 * - `limit` and `offset` are read by PRESENCE: `limit: 0` returns no rows
 *   (#6485).
 *
 * `fields` projects each row to the named columns plus `id`, which every row
 * keeps (the projection `driver-memory` applies). Every row returned is a
 * fresh object.
 */

import type { FilterCondition } from '@objectstack/spec/data';
import { findMisplacedReadableIds, readableIdsDriverRefusal } from '@objectstack/core';
import { matchesDriverWhere, type AggregatedColumnClass } from './having-filter.js';

/** The query keys this helper applies. */
export interface DriverQueryInMemory {
  where?: FilterCondition;
  orderBy?: ReadonlyArray<{ field: string; order?: 'asc' | 'desc' }>;
  limit?: number;
  offset?: number;
  fields?: readonly string[];
}

/** What the helper is told about the object the rows belong to. */
export interface DriverQueryInMemoryOptions {
  /**
   * Each declared field's comparison class (`declaredFieldClasses(fields)`): a
   * temporal comparand is compared by its column's storage rule. Absent ⇒
   * every comparand as written.
   */
  fieldClasses?: ReadonlyMap<string, AggregatedColumnClass | undefined>;
  /**
   * The declared JSON-stored fields (`declaredJsonStoredFields(fields)`), on
   * which `$contains` / `$notContains` ask membership and the scalar
   * comparisons are refused, as `where` refuses them on every SQL dialect.
   */
  jsonStored?: ReadonlySet<string>;
}

/**
 * Keys a driver query may carry that this helper does not apply. Each is
 * refused by name rather than ignored: ignoring `groupBy` would answer raw
 * rows for a grouped read, ignoring `search` every row for a search.
 * `object` and `expand` are not here — the first is the call's routing, the
 * second the engine's own post-read step.
 */
const UNAPPLIED_KEYS = ['groupBy', 'aggregations', 'having', 'search', 'searchFields', 'top'] as const;

/** The refusal name a composed `ReadableIds` leaf is refused under (ADR-0139 D3). */
const READABLE_IDS_REFUSER = 'objectql in-memory query';

/**
 * Refuse a `where` this helper cannot evaluate before any row is read — or a
 * remote is asked: a `ReadableIds` leaf, composed or not (ADR-0139 D3). The
 * walker would read a composed leaf in a `$in` slot as an empty list and
 * answer no rows, a short list nobody was told about.
 */
export function assertDriverWhereEvaluableInMemory(where: unknown): void {
  const site = findMisplacedReadableIds(where, false);
  if (site) {
    throw readableIdsDriverRefusal(
      READABLE_IDS_REFUSER,
      site,
      'the engine evaluates a plugin driver\'s rows in memory and has no semi-join to read the leaf with',
    );
  }
}

/**
 * Apply `query` to `rows` in memory: `where`, then `orderBy`, then `offset` /
 * `limit`, then `fields`. See the module comment for each step's reading.
 *
 * @throws `INVALID_FILTER` / 400 for a `where` the walker refuses, and a plain
 *   error for a key this helper does not apply or a malformed `orderBy`,
 *   `limit` or `offset`.
 */
export function applyDriverQueryInMemory(
  rows: readonly Record<string, unknown>[],
  query: DriverQueryInMemory,
  options: DriverQueryInMemoryOptions = {},
): Record<string, unknown>[] {
  for (const key of UNAPPLIED_KEYS) {
    if ((query as Record<string, unknown>)[key] !== undefined) {
      throw new Error(
        `applyDriverQueryInMemory does not apply \`${key}\`. It reads where, orderBy, limit, offset and fields; `
        + `a query carrying \`${key}\` is refused rather than answered without it.`,
      );
    }
  }
  assertDriverWhereEvaluableInMemory(query.where);
  const orderBy = readOrderBy(query.orderBy);
  const limit = readCount('limit', query.limit);
  const offset = readCount('offset', query.offset);

  let result = query.where === undefined
    ? [...rows]
    : rows.filter((row) => matchesDriverWhere(row, query.where, options.fieldClasses, options.jsonStored));

  const paged = limit !== undefined || offset !== undefined;
  const keys = paged && !orderBy.some((key) => key.field === 'id')
    ? [...orderBy, { field: 'id', order: orderBy.length > 0 ? orderBy[orderBy.length - 1]!.order : 'asc' as const }]
    : orderBy;
  if (keys.length > 0) result = [...result].sort((a, b) => compareRows(a, b, keys));

  if (offset !== undefined) result = result.slice(offset);
  if (limit !== undefined) result = result.slice(0, limit);

  const fields = query.fields;
  if (Array.isArray(fields) && fields.length > 0) return result.map((row) => project(row, fields));
  return result.map((row) => ({ ...row }));
}

type SortKey = { field: string; order: 'asc' | 'desc' };

function readOrderBy(orderBy: unknown): SortKey[] {
  if (orderBy === undefined) return [];
  if (!Array.isArray(orderBy)) {
    throw new Error(`applyDriverQueryInMemory: \`orderBy\` must be an array of { field, order } nodes, received ${JSON.stringify(orderBy)}.`);
  }
  return orderBy.map((node: unknown) => {
    const { field, order } = (node ?? {}) as { field?: unknown; order?: unknown };
    if (typeof field !== 'string' || field === '' || (order !== undefined && order !== 'asc' && order !== 'desc')) {
      throw new Error(`applyDriverQueryInMemory: an \`orderBy\` node must be { field: string, order?: 'asc' | 'desc' }, received ${JSON.stringify(node)}.`);
    }
    return { field, order: order ?? 'asc' };
  });
}

function readCount(key: 'limit' | 'offset', value: unknown): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throw new Error(`applyDriverQueryInMemory: \`${key}\` must be a non-negative integer, received ${JSON.stringify(value)}.`);
  }
  return value;
}

function compareRows(a: Record<string, unknown>, b: Record<string, unknown>, keys: readonly SortKey[]): number {
  for (const { field, order } of keys) {
    const x = a[field];
    const y = b[field];
    const xMissing = x === undefined || x === null;
    const yMissing = y === undefined || y === null;
    if (xMissing || yMissing) {
      if (xMissing && yMissing) continue;
      // No value sorts last in either direction.
      return xMissing ? 1 : -1;
    }
    // A remote may answer one column in both forms (a `Date` on some rows, an
    // ISO string on others): when either side is a `Date`, both compare as
    // instants, or `number < string` would read every pair as equal.
    const temporal = x instanceof Date || y instanceof Date;
    const left = temporal ? instantOf(x) : x;
    const right = temporal ? instantOf(y) : y;
    if ((left as any) < (right as any)) return order === 'desc' ? 1 : -1;
    if ((left as any) > (right as any)) return order === 'desc' ? -1 : 1;
  }
  return 0;
}

/** A value as epoch ms for a temporal comparison; a string that is not a date stays as written. */
function instantOf(value: unknown): unknown {
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'string') {
    const ms = Date.parse(value);
    return Number.isNaN(ms) ? value : ms;
  }
  return value;
}

function project(row: Record<string, unknown>, fields: readonly string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const field of fields) {
    if (row[field] !== undefined) out[field] = row[field];
  }
  if (out.id === undefined && row.id !== undefined) out.id = row.id;
  return out;
}
