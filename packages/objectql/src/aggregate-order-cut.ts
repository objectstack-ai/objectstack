// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * "The top five customers by revenue": an aggregate whose groups are ORDERED
 * by an aggregated column, CUT to a number of groups, and answered with how
 * many groups existed before the cut — all three in the database, in the one
 * statement that groups: `engine.aggregate('crm_order', query,
 * { [AGGREGATE_ORDER_CUT]: { orderBy: [{ field: 'revenue', order: 'desc' }],
 * limit: 5 } })` reaches a SQL driver as
 * `SELECT g.*, COUNT(*) OVER () AS __os_total_groups FROM (<the grouped
 * statement>) g ORDER BY … LIMIT 5`.
 *
 * ## An engine-internal option, never a wire key
 *
 * The request rides on {@link AGGREGATE_ORDER_CUT}, a symbol-keyed READ option
 * (the `EngineReadOptions` third argument of `aggregate`), exactly as the
 * relation group join rides on its own (`relation-group-join.ts`): no wire
 * request, JSON body or spread author input can carry a symbol, so the public
 * query vocabulary (`EngineAggregateOptions`, `QueryAST`) is unchanged. It is a
 * `Symbol.for` key because the doors that carry it to the engine (the MCP
 * tools' bridges, the runtime's `callData`) do not all depend on this package
 * at runtime. Holding the key grants nothing: the read is still the caller's
 * own `aggregate`, through every door, gate and middleware it always runs.
 *
 * ## Ordered by the aggregated row's own columns
 *
 * An order key names a column of the AGGREGATED row — an aggregation alias or a
 * group key's projected name (`alias ?? field`), the namespace `having` filters
 * ({@link aggregatedRowColumns}). Any other name is refused `INVALID_SORT` /
 * 400, naming the columns this query projects. The group keys the order does
 * not name, and every group key a `rank` names, follow it, ascending, so two
 * runs of one request answer the same groups in the same order. A NULL ranks
 * last in either direction, except where the column answers an identity over
 * nothing (`sum`, the counts: `emptyGroupValueFor`), which ranks as that
 * identity — the value the row is served with. Under a `rank` key the values
 * it does not list (a NULL among them) share one rank past the listed ones,
 * so they come after them ascending and before them descending; among
 * themselves they follow the trailing ascending keys, NULL last.
 *
 * ## The count is the statement's
 *
 * The driver answers the number of groups the statement formed before its cut
 * on every row, under {@link AGGREGATE_TOTAL_GROUPS_COLUMN}; the engine takes it
 * off the rows and writes it to the request's {@link AggregateOrderCutOutcome}.
 * A driver that answered rows without it did not serve the cut, and its rows
 * are refused as a server fault, never served as an answer.
 *
 * ## Refused, never approximated
 *
 * Prime Directive 5 (ruling record 6888468549): only a driver that compiles the
 * cut in its own statement serves it ({@link driverCompilesAggregateOrderCut}).
 * Every other driver — the in-memory driver, MongoDB, OData, the remote face of
 * the Turso driver — is refused `INVALID_QUERY` / 400 before anything is read;
 * so is an aggregate the engine would compute in memory (a date bucket the
 * driver does not compile, a reference zone it does not bucket, a measure
 * filter it does not evaluate), an aggregate with a `having` (applied by the
 * engine AFTER the driver, so a cut in the statement would cut before it), and
 * a relation group join. No in-process sort and no slower path exist.
 */

import { StandardErrorCode } from '@objectstack/spec/api';
import { driverNameOf } from './relation-semi-join.js';

/**
 * The read-option key of an order-and-cut request: `aggregate(object, query,
 * { [AGGREGATE_ORDER_CUT]: request })`. A `Symbol.for` key — its carriers live
 * in packages that do not import this one — and a symbol, so no wire request
 * can carry it.
 */
export const AGGREGATE_ORDER_CUT: unique symbol = Symbol.for('objectstack.objectql.aggregateOrderCut');

/**
 * The AST key the driver reads the cut from ({@link DriverAggregateOrderCut});
 * `driver-sql`'s aggregate compiler reads the same `Symbol.for` key. Set by the
 * engine on the composed AST it hands `driver.aggregate`, after every
 * middleware has run — no middleware and no caller sees it.
 */
export const AGGREGATE_ORDER_CUT_DIRECTIVE: unique symbol = Symbol.for('objectstack.driver.aggregate.orderCut');

/**
 * The column the driver answers the group count under, on every row. Taken off
 * the rows by the engine before anyone reads them; an aggregated column of the
 * same name is refused, so it never shadows one.
 */
export const AGGREGATE_TOTAL_GROUPS_COLUMN = '__os_total_groups';

/**
 * The most values a {@link AggregateOrderKey.rank} may list: a declared option
 * list, not a data set.
 */
export const AGGREGATE_ORDER_RANK_MAX = 500;

/** One key of a request's order: an aggregated-row column and its direction. */
export interface AggregateOrderKey {
  readonly field: string;
  readonly order: 'asc' | 'desc';
  /**
   * Order the column by these values' positions instead of by the values
   * themselves: a value at position `i` ranks `i`, every value the list does
   * not hold (a NULL among them) ranks `rank.length`, and `order` runs over the
   * ranks, so the unlisted values come after the listed ones ascending and
   * before them descending. For a group key whose values are declared options,
   * so a cut keeps the groups first in the declared order — the order the
   * caller reads off the schema it is served, handed down so the statement
   * applies it before the cut. Groups the rank does not tell apart fall to the
   * next key, and the ranked column itself stays among the trailing ascending
   * keys (NULL last), so the unlisted values keep an order of their own.
   */
  readonly rank?: ReadonlyArray<string | number>;
}

/** What the engine did with an {@link AggregateOrderCutRequest}: set only once the driver answered it. */
export interface AggregateOrderCutOutcome {
  readonly kind: 'served';
  /** How many groups the statement formed before the cut. */
  readonly totalGroups: number;
}

/**
 * The request: the order of the groups, how many to answer, and the slot the
 * engine writes its {@link AggregateOrderCutOutcome} to. A carrier that hands
 * the request on reads the slot back after the read: a read that came back
 * without it was not served as ordered and cut, and is never an answer.
 */
export interface AggregateOrderCutRequest {
  readonly orderBy: readonly AggregateOrderKey[];
  /** The most groups to answer; absent = every group, still ordered and counted. */
  readonly limit?: number;
  outcome?: AggregateOrderCutOutcome;
}

/** What the driver is handed, on the AST under {@link AGGREGATE_ORDER_CUT_DIRECTIVE}. */
export interface DriverAggregateOrderCut {
  /** The full order: the request's keys, then every group key it does not name or names only by a `rank`, ascending. */
  readonly orderBy: ReadonlyArray<{
    readonly column: string;
    readonly order: 'asc' | 'desc';
    /** {@link AggregateOrderKey.rank}, as the request named it. */
    readonly rank?: ReadonlyArray<string | number>;
  }>;
  readonly limit?: number;
  /** The column to answer the pre-cut group count under, on every row. */
  readonly totalGroupsColumn: string;
}

/**
 * The drivers whose `aggregate` compiles {@link AGGREGATE_ORDER_CUT_DIRECTIVE},
 * named — no capability bit says which drivers compile it, and an unnamed
 * driver is never handed one. `driver-sql` covers every dialect it speaks; the
 * WASM SQLite driver inherits its `aggregate`. The Turso driver is admitted only
 * on its local and replica faces ({@link driverCompilesAggregateOrderCut}),
 * which inherit the same `aggregate`; its remote face compiles its own.
 */
export const AGGREGATE_ORDER_CUT_COMPILING_DRIVERS: ReadonlySet<string> = new Set([
  'com.objectstack.driver.sql',
  'com.objectstack.driver.sqlite-wasm',
]);

const TURSO_DRIVER = 'com.objectstack.driver.turso';
const TURSO_SQL_FACES: ReadonlySet<string> = new Set(['local', 'replica']);

/** The request on a read's options, when one rides there. */
export function aggregateOrderCutRequestOf(options: unknown): AggregateOrderCutRequest | undefined {
  if (options === null || typeof options !== 'object') return undefined;
  const request = (options as Record<symbol, unknown>)[AGGREGATE_ORDER_CUT];
  return request === undefined ? undefined : (request as AggregateOrderCutRequest);
}

/** Does this driver's `aggregate` compile the cut? Named drivers only (see {@link AGGREGATE_ORDER_CUT_COMPILING_DRIVERS}). */
export function driverCompilesAggregateOrderCut(
  driver: { readonly name?: unknown; readonly aggregate?: unknown } | undefined,
): boolean {
  if (typeof driver?.aggregate !== 'function') return false;
  const name = driver.name;
  if (typeof name !== 'string') return false;
  if (AGGREGATE_ORDER_CUT_COMPILING_DRIVERS.has(name)) return true;
  if (name !== TURSO_DRIVER) return false;
  const mode = (driver as { readonly transportMode?: unknown }).transportMode;
  return typeof mode === 'string' && TURSO_SQL_FACES.has(mode);
}

type CodedError = Error & {
  code?: string; status?: number; httpStatus?: number;
  object?: string; param?: string;
};

/** A refusal of the request, `INVALID_QUERY` or `INVALID_SORT` / 400, nothing read. */
function refusal(code: 'INVALID_QUERY' | 'INVALID_SORT', object: string, detail: string): CodedError {
  const err = new Error(
    `aggregate('${object}') ordered or cut by group: ${detail} The query was NOT run and nothing was read.`,
  ) as CodedError;
  err.code = code;
  err.status = 400;
  // …and `httpStatus`, the same number under ADR-0112 D5's spelling — what a
  // consumer holding the THROWN error reads; `status` stays for the HTTP doors.
  err.httpStatus = 400;
  err.object = object;
  err.param = 'orderBy';
  return err;
}

/**
 * The request's own shape, judged against the aggregated row's columns
 * (`columns`: {@link aggregatedRowColumns} of the query) before anything is
 * read. An order key naming no column of the row is `INVALID_SORT`, naming
 * the columns the query projects.
 */
export function assertAggregateOrderCutShape(
  object: string,
  request: AggregateOrderCutRequest,
  columns: readonly string[],
): void {
  if (request === null || typeof request !== 'object') {
    throw refusal('INVALID_QUERY', object, 'the request is not an object.');
  }
  const orderBy: unknown = request.orderBy;
  if (!Array.isArray(orderBy)) {
    throw refusal('INVALID_QUERY', object, '`orderBy` must be a list of { field, order } (an empty list orders by the group keys).');
  }
  const limit: unknown = request.limit;
  if (limit !== undefined && !(typeof limit === 'number' && Number.isInteger(limit) && limit >= 1)) {
    throw refusal('INVALID_QUERY', object, `\`limit\` must be a whole number of groups, 1 or more; received ${JSON.stringify(limit)}.`);
  }
  if (columns.includes(AGGREGATE_TOTAL_GROUPS_COLUMN)) {
    throw refusal(
      'INVALID_QUERY',
      object,
      `the aggregated row already projects a column named '${AGGREGATE_TOTAL_GROUPS_COLUMN}', the name the group count `
      + 'is answered under. Rename that alias.',
    );
  }
  const known = columns.length > 0 ? columns.join(', ') : '(none — the query projects no column)';
  const seen = new Set<string>();
  for (const [i, key] of orderBy.entries()) {
    const field = (key as { field?: unknown } | null)?.field;
    const order = (key as { order?: unknown } | null)?.order;
    if (typeof field !== 'string' || field === '' || (order !== 'asc' && order !== 'desc')) {
      throw refusal('INVALID_QUERY', object, `\`orderBy[${i}]\` must be { field, order: 'asc' | 'desc' }.`);
    }
    if (!columns.includes(field)) {
      throw refusal(
        'INVALID_SORT',
        object,
        `\`orderBy[${i}]\` names '${field}', which is not a column of the aggregated row. Groups are ordered by `
        + `the row's own columns — the aggregation aliases and the groupBy projections — which here are: ${known}.`,
      );
    }
    if (seen.has(field)) throw refusal('INVALID_QUERY', object, `\`orderBy\` names '${field}' twice.`);
    seen.add(field);
    const rank = (key as { rank?: unknown }).rank;
    if (rank !== undefined) {
      const values = Array.isArray(rank) ? rank : [];
      const valid = values.length >= 1 && values.length <= AGGREGATE_ORDER_RANK_MAX
        && values.every((v) => typeof v === 'string' || (typeof v === 'number' && Number.isFinite(v)))
        && new Set(values).size === values.length;
      if (!valid) {
        throw refusal(
          'INVALID_QUERY',
          object,
          `\`orderBy[${i}].rank\` must list 1 to ${AGGREGATE_ORDER_RANK_MAX} distinct strings or numbers, in the order to rank them.`,
        );
      }
    }
  }
}

/**
 * Why the engine cannot serve the cut for this read, or `undefined` when it
 * can — judged once the driver and the path the aggregate takes are known,
 * before the driver is asked. ⛔ No answer here means "compute it some other
 * way": every reason is a refusal.
 */
export function aggregateOrderCutRefusal(
  object: string,
  facts: {
    readonly driver: { readonly name?: unknown; readonly aggregate?: unknown } | undefined;
    /** The aggregate is answered by the driver's own statement (no in-memory tier). */
    readonly nativeAggregate: boolean;
    readonly hasHaving: boolean;
    readonly hasRelationGroup: boolean;
  },
): Error | undefined {
  if (!driverCompilesAggregateOrderCut(facts.driver)) {
    return refusal(
      'INVALID_QUERY',
      object,
      `this read's driver '${driverNameOf(facts.driver)}' does not order and cut groups in its own statement, and `
      + 'the groups are never ordered or cut in the application instead. Ask without an order and a limit, or query '
      + 'an object stored in a SQL database.',
    );
  }
  if (facts.hasHaving) {
    return refusal(
      'INVALID_QUERY',
      object,
      '`having` is applied after the driver answers, so a cut in the statement would cut before it. Ask without '
      + '`having`, or without an order and a limit.',
    );
  }
  if (facts.hasRelationGroup) {
    return refusal('INVALID_QUERY', object, 'grouping through a relation is not ordered or cut. Ask without an order and a limit.');
  }
  if (!facts.nativeAggregate) {
    return refusal(
      'INVALID_QUERY',
      object,
      'this aggregate is computed in the application, not by the driver (a date bucket the driver does not '
      + 'compile, a reference timezone it does not bucket, or a measure filter it does not evaluate), and its groups '
      + 'are never ordered or cut there. Ask without the order and the limit, or without that part of the aggregate.',
    );
  }
  return undefined;
}

/**
 * The full order the driver applies: the request's keys, then every group key
 * column the request does not name, ascending — so the answer is the same
 * groups in the same order on every run. A column the request names only by a
 * `rank` stays among those trailing keys: the rank leaves every value it does
 * not list on one rank, and its own ascending order (NULL last) then tells
 * those groups apart.
 */
export function aggregateOrderCutDirective(
  request: AggregateOrderCutRequest,
  groupColumns: readonly string[],
): DriverAggregateOrderCut {
  const named = new Set(request.orderBy.filter((k) => k.rank === undefined).map((k) => k.field));
  return {
    orderBy: [
      ...request.orderBy.map((k) => ({ column: k.field, order: k.order, ...(k.rank !== undefined ? { rank: [...k.rank] } : {}) })),
      ...groupColumns.filter((c) => !named.has(c)).map((column) => ({ column, order: 'asc' as const })),
    ],
    ...(request.limit !== undefined ? { limit: request.limit } : {}),
    totalGroupsColumn: AGGREGATE_TOTAL_GROUPS_COLUMN,
  };
}

/** `ast` with the directive on it, under its symbol key (a copy; `ast` is not changed). */
export function withAggregateOrderCutDirective<T extends object>(ast: T, directive: DriverAggregateOrderCut): T {
  return { ...ast, [AGGREGATE_ORDER_CUT_DIRECTIVE]: directive } as T;
}

/**
 * Take the group count off the driver's rows and write the outcome. Every row
 * must carry the same count; zero rows is zero groups. A row without it means
 * the driver did not serve the cut: a server fault, never an answer.
 */
export function takeAggregateGroupCount(
  object: string,
  driver: { readonly name?: unknown } | undefined,
  rows: unknown,
  request: AggregateOrderCutRequest,
): Record<string, unknown>[] {
  const list = Array.isArray(rows) ? (rows as Array<Record<string, unknown>>) : [];
  let totalGroups = 0;
  const out = list.map((row, i) => {
    const raw = row?.[AGGREGATE_TOTAL_GROUPS_COLUMN];
    const n = typeof raw === 'number' ? raw : typeof raw === 'string' && raw.trim() !== '' ? Number(raw) : Number.NaN;
    if (!Number.isInteger(n) || n < list.length || (i > 0 && n !== totalGroups)) {
      const err = new Error(
        `aggregate('${object}'): the driver '${driverNameOf(driver)}' answered an ordered and cut aggregate without `
        + 'the group count of its own statement, so its rows are not the answer and none is returned.',
      ) as CodedError;
      err.code = StandardErrorCode.enum.INTERNAL_ERROR;
      err.status = 500;
      err.httpStatus = 500;
      throw err;
    }
    totalGroups = n;
    const { [AGGREGATE_TOTAL_GROUPS_COLUMN]: _count, ...rest } = row;
    return rest;
  });
  request.outcome = { kind: 'served', totalGroups };
  return out;
}
