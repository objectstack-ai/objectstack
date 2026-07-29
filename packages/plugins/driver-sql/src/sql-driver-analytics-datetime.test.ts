// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * End-to-end repro of the dashboard time-series "No rows" bug at the storage
 * level, and proof of the fix.
 *
 * The analytics `NativeSQLStrategy` compiles dashboard relative-date tokens
 * (e.g. `{12_months_ago}`) to ISO date strings and binds them into a raw
 * `SELECT … WHERE col >= ?` that it runs through the driver's `execute()` —
 * bypassing the normal `find()` filter coercion. Under better-sqlite3 a
 * `Field.datetime` column is stored as an INTEGER epoch (ms), so the ISO TEXT
 * comparand never matches (TEXT sorts after every INTEGER) → 0 rows, even though
 * the rows exist. A `Field.date` column stores ISO TEXT and matches fine.
 *
 * This test reproduces both the broken (raw ISO bind → 0) and fixed (epoch bind
 * via the driver's public `temporalFilterValue` → N) behaviour against a real
 * SQLite database, mirroring exactly what the analytics strategy now does.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SqlDriver } from '../src/index.js';

describe('Analytics datetime filter — SQLite epoch storage (E2E repro)', () => {
  let driver: SqlDriver;
  const TABLE = 'compliance_assessment';
  const CUTOFF = '2025-06-18'; // ISO date token the dashboard expands to

  beforeEach(async () => {
    driver = new SqlDriver({
      client: 'better-sqlite3',
      connection: { filename: ':memory:' },
      useNullAsDefault: true,
    });

    await driver.initObjects([
      {
        name: TABLE,
        fields: {
          title: { type: 'string' },
          assessed_at: { type: 'datetime' }, // stored as INTEGER epoch ms
          assessed_on: { type: 'date' },      // stored as YYYY-MM-DD text
        },
      },
    ]);

    // Four assessments AFTER the cutoff, one well before — inserted with real
    // Date objects so better-sqlite3 stores `assessed_at` as INTEGER epoch ms,
    // exactly the path the seed loader takes.
    const rows = [
      ['a1', new Date('2024-01-01T00:00:00Z'), '2024-01-01'], // before cutoff
      ['a2', new Date('2025-06-18T09:00:00Z'), '2025-06-18'], // on/after
      ['a3', new Date('2025-09-01T09:00:00Z'), '2025-09-01'],
      ['a4', new Date('2026-01-15T09:00:00Z'), '2026-01-15'],
      ['a5', new Date('2026-05-20T09:00:00Z'), '2026-05-20'],
    ] as const;
    for (const [id, at, on] of rows) {
      await driver.create(
        TABLE,
        { id, title: id, assessed_at: at, assessed_on: on },
        { bypassTenantAudit: true },
      );
    }
  });

  afterEach(async () => {
    await driver.disconnect();
  });

  const countWhere = async (col: string, bind: unknown): Promise<number> => {
    const res: any = await driver.execute(
      `SELECT count(*) AS n FROM "${TABLE}" WHERE "${col}" >= ?`,
      [bind],
    );
    const row = Array.isArray(res) ? res[0] : res?.rows?.[0] ?? res;
    return Number(row.n);
  };

  it('BUG: a raw ISO comparand against the epoch datetime column returns 0 rows', async () => {
    // This is what the type-blind strategy used to bind — the silent failure.
    expect(await countWhere('assessed_at', CUTOFF)).toBe(0);
  });

  it('FIX: the driver-coerced epoch comparand returns the 4 matching rows', async () => {
    // `temporalFilterValue` is exactly the hook NativeSQLStrategy now calls.
    const coerced = driver.temporalFilterValue(TABLE, 'assessed_at', CUTOFF);
    expect(typeof coerced).toBe('number'); // epoch ms, not the ISO string
    expect(await countWhere('assessed_at', coerced)).toBe(4);
  });

  it('CONTROL: the `Field.date` text column already matched the raw ISO comparand', async () => {
    // Proves the date/text path was never broken and is left untouched.
    const coerced = driver.temporalFilterValue(TABLE, 'assessed_on', CUTOFF);
    expect(typeof coerced).toBe('string'); // YYYY-MM-DD, NOT coerced to epoch
    expect(await countWhere('assessed_on', coerced)).toBe(4);
    // and the raw ISO bind matches identically (no coercion needed for text)
    expect(await countWhere('assessed_on', CUTOFF)).toBe(4);
  });

  it('does not touch a non-temporal column', () => {
    expect(driver.temporalFilterValue(TABLE, 'title', 'hello')).toBe('hello');
  });
});

/**
 * #3912 — coercing the comparand is necessary but NOT sufficient.
 *
 * The fixture above writes every row with a JS `Date`, so the column is uniformly
 * INTEGER epoch. A production table is not: REST/JSON writes carry ISO strings
 * (JSON has no `Date`) and `NOW()` defaults stamp ISO TEXT, so the SAME column
 * holds both forms. An epoch comparand then matches the INTEGER half and misses
 * every TEXT row — a dashboard `last_30_days` reading 0 with rows in range.
 *
 * `temporalFilterColumnSql` is the companion hook that normalises the COLUMN, so
 * the comparison is form-agnostic. These tests bind exactly what the analytics
 * strategy binds, against a real mixed-storage SQLite table.
 */
describe('Analytics datetime filter — MIXED storage (#3912)', () => {
  let driver: SqlDriver;
  const TABLE = 'compliance_assessment';
  const CUTOFF = '2025-06-18';

  beforeEach(async () => {
    driver = new SqlDriver({
      client: 'better-sqlite3',
      connection: { filename: ':memory:' },
      useNullAsDefault: true,
    });
    await driver.initObjects([
      {
        name: TABLE,
        fields: { title: { type: 'string' }, assessed_at: { type: 'datetime' } },
      },
    ]);

    const rows = [
      ['i1', new Date('2024-01-01T00:00:00Z')],     // INTEGER, before cutoff
      ['t1', '2024-02-01T00:00:00.000Z'],           // TEXT,    before cutoff
      ['i2', new Date('2025-09-01T09:00:00Z')],     // INTEGER, after
      ['t2', '2025-10-01T09:00:00.000Z'],           // TEXT,    after
      ['t3', '2026-01-15T09:00:00.000Z'],           // TEXT,    after
    ] as const;
    for (const [id, at] of rows) {
      await driver.create(TABLE, { id, title: id, assessed_at: at }, { bypassTenantAudit: true });
    }
  });

  afterEach(async () => {
    await driver.disconnect();
  });

  /**
   * The `dateRange` shape the dashboard actually emits — a two-sided window, with
   * both bounds coerced, optionally reading the column through the fix.
   */
  const countInWindow = async (col: string, from: string, to: string, useColumnHook: boolean) => {
    const ref = useColumnHook
      ? driver.temporalFilterColumnSql(TABLE, col, `"${col}"`)
      : `"${col}"`;
    const res: any = await driver.execute(
      `SELECT count(*) AS n FROM "${TABLE}" WHERE ${ref} >= ? AND ${ref} <= ?`,
      [
        driver.temporalFilterValue(TABLE, col, from),
        driver.temporalFilterValue(TABLE, col, to),
      ],
    );
    const row = Array.isArray(res) ? res[0] : res?.rows?.[0] ?? res;
    return Number(row.n);
  };

  it('the fixture really is mixed-form', async () => {
    const res: any = await driver.execute(
      `SELECT typeof(assessed_at) AS t, count(*) AS n FROM "${TABLE}" GROUP BY 1 ORDER BY 1`,
    );
    const rows = Array.isArray(res) ? res : res?.rows ?? [];
    expect(rows.map((r: any) => [r.t, Number(r.n)])).toEqual([['integer', 2], ['text', 3]]);
  });

  it('BUG: coercing only the comparand empties the window on a TEXT-stored row', async () => {
    // SQLite orders INTEGER before TEXT, so a TEXT row passes `>= <epoch>` and
    // then fails `<= <epoch>` — the two-sided window collapses to nothing. That
    // is the reported symptom: 0 rows where 3 exist.
    expect(await countInWindow('assessed_at', CUTOFF, '2026-12-31', false)).toBe(1); // i2 only
    expect(await countInWindow('assessed_at', '2025-10-01', '2026-12-31', false)).toBe(0);
  });

  it('FIX: normalising the column finds rows of BOTH forms in the window', async () => {
    expect(await countInWindow('assessed_at', CUTOFF, '2026-12-31', true)).toBe(3); // i2, t2, t3
    expect(await countInWindow('assessed_at', '2025-10-01', '2026-12-31', true)).toBe(2); // t2, t3
    expect(await countInWindow('assessed_at', '2024-01-01', '2024-12-31', true)).toBe(2); // i1, t1
  });

  it('leaves a non-temporal column reference untouched', () => {
    expect(driver.temporalFilterColumnSql(TABLE, 'title', '"title"')).toBe('"title"');
  });
});
