// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * End-to-end cover of the dashboard time-series "No rows" bug at the storage
 * level, and proof of the fix — now that the fix is canonical STORAGE (#3912)
 * rather than a comparand cast.
 *
 * The analytics `NativeSQLStrategy` compiles dashboard relative-date tokens
 * (e.g. `{12_months_ago}`) to ISO date strings and binds them into a raw
 * `SELECT … WHERE col >= ?` that it runs through the driver's `execute()` —
 * bypassing the normal `find()` filter coercion. Under better-sqlite3 a
 * `Field.datetime` column USED to be stored as an INTEGER epoch (ms) whenever a
 * `Date` was bound, so an ISO TEXT comparand never matched it (TEXT sorts after
 * every INTEGER) → 0 rows even though the rows existed.
 *
 * Both sides are one shape now: `formatInput` writes canonical UTC text and
 * `temporalFilterValue` canonicalises the comparand to the same. These tests run
 * that against a real SQLite database, and the MIXED-storage suite below covers
 * what an un-migrated database still needs from the read-side repair.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SqlDriver } from '../src/index.js';
import { LegacyStorageDriver } from '../src/legacy-datetime-storage.testkit.js';

describe('Analytics datetime filter — SQLite canonical storage (E2E)', () => {
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
          assessed_at: { type: 'datetime' }, // canonical ISO-Z text since #3912
          assessed_on: { type: 'date' },      // YYYY-MM-DD text
        },
      },
    ]);

    // Four assessments AFTER the cutoff, one well before — inserted with real
    // Date objects, the path the seed loader takes. That used to land as INTEGER
    // epoch ms; `formatInput` now canonicalises it on the way in.
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

  it('the datetime column is stored as canonical text, like the date column', async () => {
    const res: any = await driver.execute(
      `SELECT DISTINCT typeof("assessed_at") AS t FROM "${TABLE}"`,
    );
    const rows = Array.isArray(res) ? res : res?.rows ?? [];
    expect(rows.map((r: any) => r.t)).toEqual(['text']);
  });

  it('FIX: the canonicalised comparand returns the 4 matching rows', async () => {
    // `temporalFilterValue` is exactly the hook NativeSQLStrategy calls.
    const coerced = driver.temporalFilterValue(TABLE, 'assessed_at', CUTOFF);
    expect(coerced).toBe('2025-06-18T00:00:00.000Z'); // canonical text, not epoch ms
    expect(await countWhere('assessed_at', coerced)).toBe(4);
  });

  it('the bare ISO date matches too — both sides are text now (index-friendly)', async () => {
    // Canonical storage is fixed-width UTC, so `'2025-06-18' <= '2025-06-18T…'`
    // lexicographically. The comparand cast stops being load-bearing for a
    // day-granular bound, which is what keeps the emitted SQL a plain
    // `col >= ?` against an indexable column.
    expect(await countWhere('assessed_at', CUTOFF)).toBe(4);
  });

  it('CONTROL: the `Field.date` text column already matched the raw ISO comparand', async () => {
    // Proves the date/text path was never broken and is left untouched.
    const coerced = driver.temporalFilterValue(TABLE, 'assessed_on', CUTOFF);
    expect(coerced).toBe('2025-06-18'); // YYYY-MM-DD, not an instant
    expect(await countWhere('assessed_on', coerced)).toBe(4);
    // and the raw ISO bind matches identically (no coercion needed for text)
    expect(await countWhere('assessed_on', CUTOFF)).toBe(4);
  });

  it('does not touch a non-temporal column', () => {
    expect(driver.temporalFilterValue(TABLE, 'title', 'hello')).toBe('hello');
  });
});

/**
 * #3912 — what an UN-MIGRATED database still needs.
 *
 * Before canonical storage, one column legitimately held both forms: REST/JSON
 * writes carry ISO strings (JSON has no `Date`) and `NOW()` defaults stamp ISO
 * TEXT, while a bound `Date` landed as INTEGER epoch. An epoch comparand then
 * matched the INTEGER half and missed every TEXT row — a dashboard
 * `last_30_days` reading 0 with rows in range.
 *
 * New writes cannot produce that pair any more, and `backfillCanonicalDatetimes`
 * converges existing rows at schema sync. But the backfill is allowed to fail
 * (it logs and swallows, so a migration can never take boot down), and an
 * external/unmanaged table never gets one — so `temporalFilterColumnSql` still
 * has to make the comparison form-agnostic. These tests bind exactly what the
 * analytics strategy binds, against a real mixed-storage SQLite table.
 */
describe('Analytics datetime filter — legacy MIXED storage (#3912)', () => {
  let driver: LegacyStorageDriver;
  const TABLE = 'compliance_assessment';
  const CUTOFF = '2025-06-18';

  beforeEach(async () => {
    driver = new LegacyStorageDriver({
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

    await driver.seedLegacyRows(TABLE, 'assessed_at', [
      { id: 'i1', title: 'i1', assessed_at: Date.parse('2024-01-01T00:00:00Z') }, // INTEGER, before
      { id: 't1', title: 't1', assessed_at: '2024-02-01T00:00:00.000Z' },         // TEXT,    before
      { id: 'i2', title: 'i2', assessed_at: Date.parse('2025-09-01T09:00:00Z') }, // INTEGER, after
      { id: 't2', title: 't2', assessed_at: '2025-10-01T09:00:00.000Z' },         // TEXT,    after
      { id: 't3', title: 't3', assessed_at: '2026-01-15T09:00:00.000Z' },         // TEXT,    after
    ]);
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

  it('BUG: reading the raw column silently drops the rows in the OTHER form', async () => {
    // SQLite orders INTEGER before TEXT, so against a canonical TEXT comparand
    // every legacy epoch row fails `>=` outright. The window quietly returns a
    // SUBSET — the shape of #3912, and the reason the read-side repair cannot
    // just be deleted once writes are canonical: a database that has not been
    // backfilled still holds the other form.
    expect(await countInWindow('assessed_at', CUTOFF, '2026-12-31', false)).toBe(2); // t2,t3 — i2 lost
    expect(await countInWindow('assessed_at', '2024-01-01', '2024-06-30', false)).toBe(1); // t1 — i1 lost
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
