// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The load-bearing assumption behind #3650.
 *
 * `ObjectQLStrategy` lowers `timeDimensions[].dateRange` to `{$gte, $lte}` ISO
 * strings and hands them to `engine.aggregate()` WITHOUT the storage coercion
 * `NativeSQLStrategy` performs. The justification is that this path goes through
 * the driver's own CRUD filter coercion, whereas the raw-SQL path binds straight
 * into a statement and therefore had to learn about SQLite's INTEGER epoch
 * itself (#2034).
 *
 * That is an assumption about the driver, not about the strategy — so it is
 * pinned here against a real SQLite database. A `Field.datetime` column is
 * stored as INTEGER epoch ms; an uncoerced ISO TEXT comparand matches NOTHING
 * (TEXT sorts after every INTEGER), which would have made the #3650 fix a no-op
 * on exactly the column type dashboards use most.
 *
 * `Field.date` (ISO TEXT storage) is covered alongside it, since a dataset may
 * bucket on either.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SqlDriver } from '../src/index.js';

const TABLE = 'opportunity';

describe('SqlDriver.aggregate — ISO window over epoch-stored datetime (#3650)', () => {
  let driver: SqlDriver;

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
          closed_at: { type: 'datetime' }, // INTEGER epoch ms under better-sqlite3
          closed_on: { type: 'date' }, // YYYY-MM-DD TEXT
          amount: { type: 'number' },
        },
      },
    ]);

    // Inserted as real Date objects, the path the seed loader takes.
    const rows = [
      ['o1', '2025-11-15T09:00:00Z', '2025-11-15', 900], // before window
      ['o2', '2026-01-10T09:00:00Z', '2026-01-10', 100], // inside
      ['o3', '2026-01-20T09:00:00Z', '2026-01-20', 200], // inside
      ['o4', '2026-02-14T09:00:00Z', '2026-02-14', 30], // inside (Feb)
      ['o5', '2026-06-05T09:00:00Z', '2026-06-05', 700], // after window
    ] as const;
    for (const [id, at, on, amount] of rows) {
      await driver.create(
        TABLE,
        { id, closed_at: new Date(at), closed_on: on, amount },
        { bypassTenantAudit: true },
      );
    }
  });

  afterEach(async () => {
    await driver.disconnect();
  });

  /** Exactly what the strategy emits: an inclusive ISO range, uncoerced. */
  const window = (col: string) => ({
    [col]: { $gte: '2026-01-01', $lte: '2026-02-28' },
  });

  it('confines a datetime aggregate to the window (the epoch-affinity trap)', async () => {
    const rows = await driver.aggregate(TABLE, {
      aggregations: [
        { function: 'sum', field: 'amount', alias: 'total' },
        { function: 'count', alias: 'n' },
      ],
      where: window('closed_at'),
    } as any);

    // 330 over 3 rows. An uncoerced TEXT-vs-INTEGER compare yields 0 rows;
    // a dropped window yields 1930 over 5.
    expect(Number(rows[0].total)).toBe(330);
    expect(Number(rows[0].n)).toBe(3);
  });

  it('buckets a TEXT-stored date inside the window — the shape #3650 is about', async () => {
    // A `granularity` is what makes NativeSQLStrategy decline, so window +
    // bucketing together is the combination that reaches the ObjectQL path.
    const rows = await driver.aggregate(TABLE, {
      groupBy: [{ field: 'closed_on', dateGranularity: 'month' }],
      aggregations: [{ function: 'sum', field: 'amount', alias: 'total' }],
      where: window('closed_on'),
    } as any);

    const byMonth = Object.fromEntries(rows.map((r: any) => [r.closed_on, Number(r.total)]));
    expect(byMonth).toEqual({ '2026-01': 300, '2026-02': 30 });
  });

  it('buckets an EPOCH-stored datetime inside the window (was one null bucket)', async () => {
    // This assertion was pinned as a KNOWN GAP by #3650 and is the acceptance
    // gate of the follow-up fix (#3773): SQLite advertises
    // `queryDateGranularity.month`, so `engine.aggregate` pushes the bucketing
    // down to the driver — `engine.ts` only falls back to in-memory bucketing
    // when a granularity is UNSUPPORTED or a non-UTC timezone is in play,
    // neither of which applies here. The dialect expression used to be a flat
    // `strftime('%Y-%m', col)`, and SQLite reads a bare INTEGER as a Julian day
    // number; an epoch-ms value is far outside the legal range, so every row
    // bucketed as NULL and the whole trend chart collapsed to one bar.
    const rows = await driver.aggregate(TABLE, {
      groupBy: [{ field: 'closed_at', dateGranularity: 'month' }],
      aggregations: [{ function: 'sum', field: 'amount', alias: 'total' }],
      where: window('closed_at'),
    } as any);

    // Two things have to hold at once: the WINDOW (#3650 — the total is the
    // in-window 330, not the full 1930) and the BUCKETS (#3773).
    const byMonth = Object.fromEntries(rows.map((r: any) => [String(r.closed_at), Number(r.total)]));
    expect(byMonth).toEqual({ '2026-01': 300, '2026-02': 30 });
  });

  it('confines a date (TEXT-stored) aggregate to the same window', async () => {
    const rows = await driver.aggregate(TABLE, {
      aggregations: [{ function: 'sum', field: 'amount', alias: 'total' }],
      where: window('closed_on'),
    } as any);

    expect(Number(rows[0].total)).toBe(330);
  });

  it('excludes the whole table when the window selects nothing', async () => {
    const rows = await driver.aggregate(TABLE, {
      aggregations: [{ function: 'count', alias: 'n' }],
      where: { closed_at: { $gte: '2027-01-01', $lte: '2027-12-31' } },
    } as any);

    // An empty window must read as zero, not as "filter ignored → 5".
    expect(Number(rows[0]?.n ?? 0)).toBe(0);
  });
});
