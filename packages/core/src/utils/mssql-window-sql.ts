// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#31626] SQL Server's row window — the `limit` / `offset` of a read — held
 * ONCE for every SQL face of the platform.
 *
 * ## Why it lives here
 *
 * `@objectstack/driver-sql` decided SQL Server's window inline in its find path
 * (#31327): an `OFFSET` needs an `ORDER BY`, and `FETCH NEXT 0 ROWS` is an
 * error. `@objectstack/service-analytics` prints the statement for the same
 * window (the `/analytics/sql` echo, and the native face's statement), depends
 * on no driver, and spelled every dialect it could not name with `LIMIT n`,
 * which SQL Server does not parse: on a federated SQL Server object the echo
 * printed `… LIMIT 10 OFFSET 5`. The rules moved here, the shape #31394 gave
 * the text-match table (`text-match-sql.ts`), so the driver and the echo
 * decide the window with one function instead of two copies.
 *
 * ## The rules, and where each comes from
 *
 * - **An `OFFSET` needs an `ORDER BY`.** SQL Server refuses `OFFSET n ROWS`
 *   without one (a syntax error, not a reshuffle). When the read has no order
 *   key, `ORDER BY (SELECT NULL)` ({@link MSSQL_NEUTRAL_ORDER_SQL}) is the
 *   order that changes nothing but the statement's validity.
 * - **`limit: 0` is `TOP (0)`, and the offset goes.** `FETCH NEXT 0 ROWS` is
 *   an error there ("must be greater than zero"), where every other dialect
 *   answers `LIMIT 0` with no rows. An offset into no rows is no rows.
 * - **An offset of `0` is no offset.** knex's SQL Server compiler (3.3.0)
 *   emits nothing for it and spells a lone limit `TOP (n)`; every window here
 *   is the one that compiler builds from the same `limit` / `offset`, so the
 *   echoed statement is the shape the driver runs.
 *
 * `driver-sql` hands {@link mssqlWindow}'s answer to knex, which renders it;
 * a face that writes its own SQL text renders it with {@link mssqlWindowSql}.
 */

/** The `ORDER BY` key that orders nothing, so SQL Server accepts an `OFFSET`. */
export const MSSQL_NEUTRAL_ORDER_SQL = '(SELECT NULL)';

/** SQL Server's window for one read — see {@link mssqlWindow}. */
export interface MssqlWindow {
  /** `TOP (n)` in the select list, or `null`. Set only when no offset applies. */
  readonly top: number | null;
  /** `OFFSET n ROWS`, or `null` for none. */
  readonly offset: number | null;
  /** `FETCH NEXT n ROWS ONLY` after the offset, or `null` for no upper bound. */
  readonly fetch: number | null;
  /** The statement must be ordered by {@link MSSQL_NEUTRAL_ORDER_SQL} before the window. */
  readonly neutralOrder: boolean;
}

/**
 * SQL Server's window for a read of `limit` rows after `offset`, either of them
 * absent. `ordered` says whether the statement already carries an `ORDER BY`.
 */
export function mssqlWindow(
  limit: number | undefined | null,
  offset: number | undefined | null,
  ordered: boolean,
): MssqlWindow {
  const skips = !!offset;
  const neutralOrder = skips && !ordered;
  if (limit === 0) return { top: 0, offset: null, fetch: null, neutralOrder };
  if (!skips) return { top: limit ?? null, offset: null, fetch: null, neutralOrder };
  return { top: null, offset: offset!, fetch: limit ?? null, neutralOrder };
}

/**
 * {@link mssqlWindow} as SQL text, for a face that writes its own statement:
 * `top` goes right after `SELECT` (`'TOP (n) '`, or `''`), `tail` at the end of
 * the statement, after any `ORDER BY` it carries (the neutral order, the
 * `OFFSET` and the `FETCH`, or `''`).
 */
export function mssqlWindowSql(window: MssqlWindow): { top: string; tail: string } {
  let tail = '';
  if (window.neutralOrder) tail += ` ORDER BY ${MSSQL_NEUTRAL_ORDER_SQL}`;
  if (window.offset !== null) tail += ` OFFSET ${window.offset} ROWS`;
  if (window.fetch !== null) tail += ` FETCH NEXT ${window.fetch} ROWS ONLY`;
  return { top: window.top !== null ? `TOP (${window.top}) ` : '', tail };
}
