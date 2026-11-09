// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#31626] SQL Server's window, as decided once for driver-sql's find path and
 * the analytics echo. Each row is the window knex's SQL Server compiler builds
 * from the same `limit` / `offset` after driver-sql's two rules (an `OFFSET`
 * needs an `ORDER BY`; `limit: 0` is `TOP (0)`); driver-sql pins its own
 * statements byte for byte in `sql-driver-mssql-dialect.test.ts`.
 */

import { describe, expect, it } from 'vitest';
import { MSSQL_NEUTRAL_ORDER_SQL, mssqlWindow, mssqlWindowSql } from './mssql-window-sql.js';

const ROWS: ReadonlyArray<[string, number | undefined, number | undefined, boolean, string, string]> = [
  ['no window', undefined, undefined, false, '', ''],
  ['a lone limit is TOP', 10, undefined, false, 'TOP (10) ', ''],
  ['limit 0 is TOP (0)', 0, undefined, false, 'TOP (0) ', ''],
  ['an offset alone, unordered', undefined, 5, false, '', ' ORDER BY (SELECT NULL) OFFSET 5 ROWS'],
  ['an offset of 0 is no offset', undefined, 0, false, '', ''],
  ['limit and offset, unordered', 10, 5, false, '', ' ORDER BY (SELECT NULL) OFFSET 5 ROWS FETCH NEXT 10 ROWS ONLY'],
  ['limit with an offset of 0 is TOP', 10, 0, false, 'TOP (10) ', ''],
  ['limit 0 drops the offset; the order stays', 0, 5, false, 'TOP (0) ', ' ORDER BY (SELECT NULL)'],
  ['limit and offset, ordered', 10, 5, true, '', ' OFFSET 5 ROWS FETCH NEXT 10 ROWS ONLY'],
  ['an offset alone, ordered', undefined, 5, true, '', ' OFFSET 5 ROWS'],
  ['a lone limit, ordered', 10, undefined, true, 'TOP (10) ', ''],
];

describe('[#31626] mssqlWindow / mssqlWindowSql — SQL Server\'s window', () => {
  for (const [label, limit, offset, ordered, top, tail] of ROWS) {
    it(`${label}: ${JSON.stringify({ top, tail })}`, () => {
      expect(mssqlWindowSql(mssqlWindow(limit, offset, ordered))).toEqual({ top, tail });
    });
  }

  it('the neutral order is the key SQL Server accepts and that orders nothing', () => {
    expect(MSSQL_NEUTRAL_ORDER_SQL).toBe('(SELECT NULL)');
  });

  it('`null` reads as absent, as `undefined` does', () => {
    expect(mssqlWindow(null, null, false)).toEqual(mssqlWindow(undefined, undefined, false));
  });
});
