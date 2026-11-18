// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `query_dataset`'s `totalGroups`: how many groups a selection formed before
 * its `offset` and `limit` cut them. The same meaning as `aggregate_records`'
 * `totalGroups`, which is the length of the rows `engine.aggregate` answered
 * (`rows.length`), taken before that tool's own cap cuts them — the same
 * reading as Source 2 below. It is never paid for with a read: it comes from
 * one of two places, and from nowhere else.
 *
 * ## Source 1: the database, where the window is pushed down
 *
 * When the one statement that grouped the answer also cut it, the count is a
 * window in that statement — `SELECT …, COUNT(*) OVER () AS
 * "__os_group_count" FROM … GROUP BY … ORDER BY … LIMIT n`. A window runs after
 * the `GROUP BY` and ahead of the `ORDER BY` and the window, so every row
 * carries the number of groups the statement formed: one statement, one round
 * trip, and no group is read to be counted. `NativeSQLStrategy` adds it only on
 * a dialect it knows ({@link GROUP_COUNT_DIALECTS}), never under a selected
 * member's own name, and an empty page after an `offset` says nothing.
 *
 * ## Source 2: a whole grid, where the window is applied in memory
 *
 * Where the window is applied in memory, the grid in hand before it IS every
 * group: the executor's grid when it cannot push the window down (a
 * label-bearing order key, which the tool's default order brings in for any
 * select or reference dimension; a measure with its own filter; a derived
 * measure; `compareTo`), and the ObjectQL face's rows, which `engine.aggregate`
 * answers whole because it is handed no window. The count is then the grid's
 * length before the window. "Whole" is vouched for, never assumed: each read
 * that built the grid carries a request, and the strategy that served it
 * answers it only when it applied no window and no cap — the native strategy
 * for a statement with no `LIMIT`, the ObjectQL face for the engine's answer.
 * The executor counts only when every read was answered and each answer's
 * count equals the rows it handed back, so a read cut by any cap under it (a
 * host strategy's row guard, say) leaves the count out.
 *
 * ## Asked for, never assumed
 *
 * The request rides on a {@link GroupCountRequest} the caller hands down:
 * `AnalyticsService.queryDataset(…, { groupCount })` → `DatasetExecutor` →
 * each query it issues, on the symbol key {@link ANALYTICS_GROUP_COUNT}.
 * No wire request, JSON body or spread author input can carry a symbol, so the
 * public query vocabulary (`AnalyticsQuery`, `DatasetSelection`) is unchanged,
 * and a statement no caller asked to count is the statement it always was.
 *
 * ## Absent everywhere else
 *
 * Prime Directive 5 (ruling record 6888468549): no slower path is built for
 * the count. An answer neither source covers leaves the request unanswered,
 * and the tool then leaves `totalGroups` out: a pushed-down window on a SQL
 * dialect the strategy does not know or under a member named
 * {@link ANALYTICS_GROUP_COUNT_COLUMN}, an empty page after an `offset` on a
 * pushed-down window, a read the strategy that served it did not vouch whole
 * (a host-injected strategy or fallback service that does not answer the
 * request) or that a cap cut under it, a grid grown by the empty
 * time-bucket fill, the draft-preview read, and the answer served for a
 * missing object.
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

/**
 * Answer `request` for rows a strategy read with no window and no cap: every
 * group the read formed came back, so the count is the rows'. Called only
 * where that holds — never on rows a `LIMIT`, an `OFFSET` or a guard cut.
 */
export function answerWholeGrid(rows: unknown, request: GroupCountRequest): void {
  if (Array.isArray(rows)) request.outcome = { groupCount: rows.length };
}

/** Whether `window` cuts anything: a `limit` or an `offset` is set. */
export function hasWindow(window: { readonly limit?: number | null; readonly offset?: number | null }): boolean {
  return window.limit != null || window.offset != null;
}

/**
 * The executor's ledger for a grid it builds from several reads and windows in
 * memory: whole while every read that built it was. Starts `true`; one read
 * that comes back unvouched turns it `false` for good.
 */
export interface WholeGridProof {
  whole: boolean;
}

/**
 * Note one read against `proof`. The read was whole only when the strategy
 * that served it answered `request` (it applied no window and no cap) AND the
 * count it answered equals the rows that came back — a guard that cut the
 * rows after the strategy counted them is caught here, by the mismatch.
 */
export function noteWholeRead(proof: WholeGridProof, request: GroupCountRequest, rows: unknown): void {
  if (!Array.isArray(rows) || request.outcome?.groupCount !== rows.length) proof.whole = false;
}

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
