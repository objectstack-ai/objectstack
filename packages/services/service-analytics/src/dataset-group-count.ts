// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `query_dataset`'s `totalGroups`: how many groups a selection formed before
 * its `offset` and `limit` cut them, counted by the database in the one SQL
 * statement that grouped and cut the answer — `SELECT …, COUNT(*) OVER () AS
 * "__os_group_count" FROM … GROUP BY … ORDER BY … LIMIT n`. A window runs after
 * the `GROUP BY` and ahead of the `ORDER BY` and the window, so every row
 * carries the number of groups the statement formed: one statement, one round
 * trip, and no group is read to be counted. The same meaning as
 * `aggregate_records`' `totalGroups`, which the engine's order-and-cut counts
 * with the same window over its grouped statement.
 *
 * ## Asked for, never assumed
 *
 * The count rides on a {@link GroupCountRequest} the caller hands down:
 * `AnalyticsService.queryDataset(…, { groupCount })` → `DatasetExecutor` →
 * the one query it issues, on the symbol key {@link ANALYTICS_GROUP_COUNT}.
 * No wire request, JSON body or spread author input can carry a symbol, so the
 * public query vocabulary (`AnalyticsQuery`, `DatasetSelection`) is unchanged,
 * and a statement no caller asked to count is the statement it always was.
 *
 * ## Counted where one statement grouped and cut, absent everywhere else
 *
 * Prime Directive 5 (ruling record 6888468549): the count is the statement's,
 * and no slower path is built for it. The executor hands the request on only
 * when the selection is ONE query whose order and window the strategy applies
 * (`canPushDownWindow`), and `NativeSQLStrategy` answers it only on a dialect
 * it knows ({@link GROUP_COUNT_DIALECTS}). Every other answer leaves the
 * request unanswered, and the tool then leaves `totalGroups` out: a grid the
 * executor assembles from several queries (a measure with its own filter, a
 * derived measure, `compareTo`) or orders by a display label, a query the
 * ObjectQL face serves through `engine.aggregate` (a date bucket, a
 * field-to-field filter, an external object, a driver with no raw SQL), and a
 * SQL dialect the strategy does not know.
 */

import type { AnalyticsQuery } from '@objectstack/spec/contracts';
import type { AnalyticsSqlDialect } from './text-match-sql.js';

/** What the counting layer found: set only once a statement counted the groups. */
export interface GroupCountOutcome {
  /** How many groups the statement formed before its `offset` and `limit`. */
  readonly groupCount: number;
}

/**
 * A request to count a selection's groups, and the slot the answer is written
 * to. A caller hands it down and reads the slot back after the read: a read
 * that came back with no outcome was not counted, and its count is unknown —
 * never zero.
 */
export interface GroupCountRequest {
  outcome?: GroupCountOutcome;
}

/**
 * The `AnalyticsQuery` key a {@link GroupCountRequest} rides to the strategy
 * on. A `Symbol.for` key, so every copy of the package agrees on it, and a
 * symbol, so no wire request can carry it. Object spreads keep it, so the
 * service's copy-on-write passes over the query hand it on unchanged.
 */
export const ANALYTICS_GROUP_COUNT: unique symbol = Symbol.for('objectstack.analytics.groupCount');

/**
 * The column the statement answers the group count under, on every row. Taken
 * off the rows by the strategy before anyone reads them; a selected member of
 * the same name leaves the request unanswered, so it never shadows one.
 */
export const ANALYTICS_GROUP_COUNT_COLUMN = '__os_group_count';

/**
 * The dialects whose grouped statement the strategy adds the window count to:
 * every one `COUNT(*) OVER ()` parses on (SQLite ≥ 3.25, PostgreSQL, MySQL 8,
 * SQL Server). A dialect the strategy does not know is not guessed at.
 */
export const GROUP_COUNT_DIALECTS: ReadonlySet<AnalyticsSqlDialect> = new Set(['sqlite', 'postgres', 'mysql', 'mssql']);

/** `query` carrying `request` under {@link ANALYTICS_GROUP_COUNT}: a copy, the input untouched. */
export function withGroupCountRequest(query: AnalyticsQuery, request: GroupCountRequest): AnalyticsQuery {
  return { ...query, [ANALYTICS_GROUP_COUNT]: request } as AnalyticsQuery;
}

/** The {@link GroupCountRequest} `query` carries, or `undefined`. */
export function groupCountRequestOf(query: AnalyticsQuery): GroupCountRequest | undefined {
  const request = (query as unknown as Record<symbol, unknown>)[ANALYTICS_GROUP_COUNT];
  return request !== null && typeof request === 'object' ? (request as GroupCountRequest) : undefined;
}

/**
 * Take the count off the rows a counted statement answered, and write it to
 * `request`. Every row loses the column. The count is read off the first row —
 * the window answers the same number on every row — as the SQL client handed
 * it (node-postgres answers a `bigint` as text). No row means no group only
 * when the statement skipped none and could answer one: with an `offset`, or a
 * `limit` of zero, an empty page says nothing about the groups before it, and
 * the request is left unanswered. A value that is not a whole count leaves it
 * unanswered too.
 */
export function takeGroupCount(
  rows: unknown,
  request: GroupCountRequest,
  window: { readonly limit?: number; readonly offset?: number },
): void {
  if (!Array.isArray(rows)) return;
  let first: unknown;
  for (const row of rows) {
    if (row === null || typeof row !== 'object') continue;
    const record = row as Record<string, unknown>;
    if (first === undefined) first = record[ANALYTICS_GROUP_COUNT_COLUMN];
    delete record[ANALYTICS_GROUP_COUNT_COLUMN];
  }
  if (rows.length === 0) {
    if ((window.offset ?? 0) === 0 && window.limit !== 0) request.outcome = { groupCount: 0 };
    return;
  }
  const count = typeof first === 'bigint' ? Number(first) : typeof first === 'string' && first.trim() !== '' ? Number(first) : first;
  if (typeof count === 'number' && Number.isSafeInteger(count) && count >= 0) request.outcome = { groupCount: count };
}
