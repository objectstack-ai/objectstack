// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0131 D6/D7] `readLegacyOrganizationRows` answers from the physical
 * column, and refuses — never reads as "none" — every seam that did not answer.
 * The real-engine pins (a v17-shape SQLite file) live in `@objectstack/cli`
 * (`meta-stored-legacy-organization.integration.test.ts`), which carries the
 * SQL stack; these pin the seam verdicts.
 */

import { describe, expect, it } from 'vitest';
import { dialectOfDriver, LegacyOrganizationRowsUnreadable, readLegacyOrganizationRows } from './legacy-organization-row.js';

/** A SQL driver double: the column list and the legacy select, by statement. */
function sqlDriver(opts: {
  dialectName?: unknown;
  client?: unknown;
  columns?: unknown;
  rows?: unknown;
}) {
  const seen: string[] = [];
  return {
    seen,
    ...(opts.dialectName !== undefined ? { dialectName: opts.dialectName } : {}),
    ...(opts.client !== undefined ? { config: { client: opts.client } } : {}),
    async execute(sql: string) {
      seen.push(sql);
      return /column_name/.test(sql) ? opts.columns : opts.rows;
    },
  };
}

const V17_COLUMNS = [{ column_name: 'id' }, { column_name: 'type' }, { column_name: 'organization_id' }];
const V18_COLUMNS = [{ column_name: 'id' }, { column_name: 'type' }];

describe('readLegacyOrganizationRows — the answers', () => {
  it('a v17-shape table: every row with an organization value, by id', async () => {
    const driver = sqlDriver({
      dialectName: 'sqlite',
      columns: V17_COLUMNS,
      rows: [{ id: 'r1', organization_id: 'org_a' }, { id: 'r2', organization_id: 'org_b' }],
    });
    const legacy = await readLegacyOrganizationRows(driver);
    expect([...legacy]).toEqual([['r1', 'org_a'], ['r2', 'org_b']]);
    expect(driver.seen[1]).toMatch(/organization_id IS NOT NULL AND organization_id <> ''/);
  });

  it('a migrated or fresh table (no column): none, and the rows are never read', async () => {
    const driver = sqlDriver({ dialectName: 'postgres', columns: { rows: V18_COLUMNS } });
    expect((await readLegacyOrganizationRows(driver)).size).toBe(0);
    expect(driver.seen).toHaveLength(1);
  });

  it('a table answered "no column" is not asked again on the same driver (the column only ever leaves)', async () => {
    const driver = sqlDriver({ dialectName: 'sqlite', columns: V18_COLUMNS });
    await readLegacyOrganizationRows(driver);
    await readLegacyOrganizationRows(driver);
    expect(driver.seen).toHaveLength(1);
  });

  it('a table that HAS the column is read afresh every time — the values move during the ceremony', async () => {
    const driver = sqlDriver({ dialectName: 'sqlite', columns: V17_COLUMNS, rows: [] });
    await readLegacyOrganizationRows(driver);
    await readLegacyOrganizationRows(driver);
    expect(driver.seen).toHaveLength(4);
  });

  it('mysql2\'s [rows, fields] and the upper-case COLUMN_NAME both read', async () => {
    const driver = sqlDriver({
      client: 'mysql2',
      columns: [[{ COLUMN_NAME: 'id' }, { COLUMN_NAME: 'organization_id' }], []],
      rows: [[{ id: 'r1', organization_id: 'org_a' }], []],
    });
    expect([...(await readLegacyOrganizationRows(driver))]).toEqual([['r1', 'org_a']]);
  });

  it('a driver that is not a SQL driver (no dialectName, no config.client — memory, MongoDB): none', async () => {
    expect((await readLegacyOrganizationRows({ async execute() { return null; } })).size).toBe(0);
    expect((await readLegacyOrganizationRows(undefined)).size).toBe(0);
  });
});

describe('readLegacyOrganizationRows — fails closed', () => {
  it.each([
    ['null', null],
    ['undefined', undefined],
    ['the statement echoed back as a string', 'SELECT …'],
    ['a bare object with no rows', { rowCount: 0 }],
  ])('a seam that returns no result set (%s) is refused, never read as "no column"', async (_label, answer) => {
    const driver = sqlDriver({ dialectName: 'sqlite', columns: answer });
    await expect(readLegacyOrganizationRows(driver)).rejects.toBeInstanceOf(LegacyOrganizationRowsUnreadable);
  });

  it('a legacy select that returns no result set is refused', async () => {
    const driver = sqlDriver({ dialectName: 'sqlite', columns: V17_COLUMNS, rows: null });
    await expect(readLegacyOrganizationRows(driver)).rejects.toBeInstanceOf(LegacyOrganizationRowsUnreadable);
  });

  it('an EMPTY column list for a table that exists is refused', async () => {
    const driver = sqlDriver({ dialectName: 'sqlite', columns: [] });
    await expect(readLegacyOrganizationRows(driver)).rejects.toThrow(/column list came back empty/);
  });

  it.each([
    ['dialectName unknown', { dialectName: 'unknown' }],
    ['an unrecognised client string', { client: 'oracledb' }],
    ['a client class with no dialectName', { client: class Client_Unknown {} }],
  ])('a SQL driver whose dialect resolves to none (%s) is refused, never given the SQLite statement', async (_label, shape) => {
    const driver = sqlDriver({ ...shape, columns: V17_COLUMNS, rows: [] });
    await expect(readLegacyOrganizationRows(driver)).rejects.toThrow(/no dialect/);
    expect(driver.seen).toHaveLength(0);
  });

  it('a SQL driver with no raw seam is refused', async () => {
    await expect(readLegacyOrganizationRows({ dialectName: 'sqlite' })).rejects.toThrow(/no raw-SQL seam/);
  });

  it('a table outside the family is refused before anything runs', async () => {
    const driver = sqlDriver({ dialectName: 'sqlite', columns: V17_COLUMNS, rows: [] });
    await expect(readLegacyOrganizationRows(driver, 'sys_user')).rejects.toThrow(/not a sys_metadata-family table/);
    expect(driver.seen).toHaveLength(0);
  });
});

describe('readLegacyOrganizationRows — the presence check is the driver\'s catalog read, not execute()', () => {
  /** A `SqlDriver`-shaped double: `listPhysicalColumns`, and an `execute` that answers the legacy select only. */
  function catalogDriver(columns: unknown, rows: unknown = []) {
    const calls: string[] = [];
    return {
      calls,
      dialectName: 'sqlite',
      async listPhysicalColumns(object: string) { calls.push(`columns:${object}`); return columns; },
      async execute(sql: string) { calls.push(/column_name/.test(sql) ? 'execute:catalog' : 'execute:legacy'); return rows; },
    };
  }

  it('a migrated or fresh table: one catalog read, and execute() is never called', async () => {
    const driver = catalogDriver(['id', 'type']);
    expect((await readLegacyOrganizationRows(driver)).size).toBe(0);
    expect(driver.calls).toEqual(['columns:sys_metadata']);
  });

  it('a v17-shape table: the catalog read, then the legacy select', async () => {
    const driver = catalogDriver(['id', 'organization_id'], [{ id: 'r1', organization_id: 'org_a' }]);
    expect([...(await readLegacyOrganizationRows(driver))]).toEqual([['r1', 'org_a']]);
    expect(driver.calls).toEqual(['columns:sys_metadata', 'execute:legacy']);
  });

  it('a column list that is not a list, or is empty, is refused', async () => {
    await expect(readLegacyOrganizationRows(catalogDriver(null))).rejects.toThrow(/not a list/);
    await expect(readLegacyOrganizationRows(catalogDriver([]))).rejects.toThrow(/column list came back empty/);
  });
});

describe('dialectOfDriver — the one driver-dialect resolver, shared with the organization-ownership ceremony', () => {
  it.each([
    ['dialectName first: SqliteWasmDriver\'s client is a dialect class', { dialectName: 'sqlite', config: { client: class Client_WasmSqlite {} } }, 'sqlite'],
    ['dialectName postgres', { dialectName: 'postgres', config: { client: 'pg' } }, 'postgres'],
    ['dialectName mysql', { dialectName: 'mysql', config: { client: 'mysql2' } }, 'mysql'],
    ['no dialectName: a recognised client string', { config: { client: 'postgresql' } }, 'postgres'],
    ['dialectName is the whole answer: unknown beside a recognised client', { dialectName: 'unknown', config: { client: 'pg' } }, 'unresolved'],
    ['a client class with no dialectName', { config: { client: class Client_PG {} } }, 'unresolved'],
    ['an unrecognised client string', { config: { client: 'oracledb' } }, 'unresolved'],
    ['no dialectName and no client (memory, MongoDB)', {}, 'none'],
    ['no driver', null, 'none'],
  ])('%s', (_label, driver, expected) => {
    expect(dialectOfDriver(driver)).toBe(expected);
  });
});
