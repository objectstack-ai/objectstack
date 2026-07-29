// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Date bucketing across the two SQLite storage forms (#3773).
 *
 * `sql-driver-date-bucket.test.ts` builds its fixture with
 * `knex.schema.createTable` + `t.string('ts')`, so every value it buckets is ISO
 * TEXT. That was only half of what SQLite actually held: a `Field.datetime`
 * declared through `initObjects` used to become INTEGER epoch **milliseconds**
 * (knex binds a JS `Date` as `.getTime()`), and `strftime` reads a bare integer
 * as a Julian day number — epoch ms is orders of magnitude outside the legal
 * range, so every row bucketed as NULL and any datetime trend chart rendered as
 * one `(null)` bar carrying the whole total.
 *
 * Since #3912 writes are canonicalised, so a freshly written column is uniform
 * TEXT — but the epoch form still sits in every database written by an earlier
 * build, so both must keep bucketing identically. This suite goes through
 * `driver.initObjects([...])` — the path a real object takes — and sweeps every
 * supported granularity against BOTH storage forms, asserting against the same
 * `bucketDateValue` labels the in-memory fallback produces. Anything that
 * buckets differently depending on how the column happens to be stored is the
 * bug this file exists to catch.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SqlDriver } from '../src/index.js';
import { LegacyStorageDriver } from '../src/legacy-datetime-storage.testkit.js';

type Granularity = 'day' | 'month' | 'quarter' | 'year';

/** Every granularity SQLite advertises natively (week is bucketed in-memory). */
const GRANULARITIES: Granularity[] = ['day', 'month', 'quarter', 'year'];

/**
 * ⚠️ Keep in sync with `packages/objectql/src/in-memory-aggregation.ts#bucketDateValue`.
 *
 * This copy exists because driver-sql cannot depend on objectql. Nothing here
 * can detect it drifting from its original — a stale copy and the SQL agree
 * with each other while both are wrong. The executable check is
 * `checkDateBucketParity` (@objectstack/verify), run against the real drivers
 * in `packages/qa/dogfood/test/date-bucket-parity-conformance.test.ts`, where
 * the reference side is the REAL `applyInMemoryAggregation`.
 */
function bucketDateValue(value: unknown, g: Granularity): string | null {
  if (value == null) return null;
  // A finite number is epoch milliseconds — SQLite's `Field.datetime` storage.
  const d =
    value instanceof Date ? value : typeof value === 'number' ? new Date(value) : new Date(String(value));
  if (Number.isNaN(d.getTime())) return null;
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth() + 1;
  switch (g) {
    case 'year': return String(y);
    case 'quarter': return `${y}-Q${Math.floor((m - 1) / 3) + 1}`;
    case 'month': return `${y}-${String(m).padStart(2, '0')}`;
    case 'day': return `${y}-${String(m).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
  }
}

const TABLE = 'deal';

/**
 * One UTC instant per row, with its `Field.date` twin on the same calendar day
 * so the two columns MUST produce identical labels at every granularity — the
 * whole point being that storage form may not change the answer.
 *
 * Amounts are distinct powers of two: a bucket's sum names exactly which rows
 * landed in it, so a mis-bucketing can't hide behind a coincidental total.
 */
const FIXTURE: Array<{ id: string; iso: string; amount: number }> = [
  { id: 'r1', iso: '1969-12-31T23:59:59.999Z', amount: 1 },  // pre-epoch, 1ms before 1970
  { id: 'r2', iso: '2025-11-15T09:00:00.000Z', amount: 2 },
  { id: 'r3', iso: '2026-01-10T09:00:00.000Z', amount: 4 },
  { id: 'r4', iso: '2026-01-20T23:59:59.000Z', amount: 8 },  // same month as r3
  { id: 'r5', iso: '2026-02-14T00:00:00.000Z', amount: 16 }, // exact midnight
  { id: 'r6', iso: '2026-06-30T23:59:59.000Z', amount: 32 }, // last instant of Q2
  { id: 'r7', iso: '2026-07-01T00:00:00.000Z', amount: 64 }, // first instant of Q3
];

/**
 * Test-local key for the empty bucket. `String(null)` is `'null'` — a label a
 * TEXT column could genuinely hold, and the coercion that used to hide the
 * #3839 divergence: it made the SQL side's NULL and a sentinel string compare
 * as different strings only by luck. Keying it out of band keeps "empty"
 * unmistakable on both sides.
 */
const EMPTY = '‹empty bucket›';
const labelOf = (v: unknown): string => (v == null ? EMPTY : String(v));

/** The labels the in-memory path would produce, folded into bucket → sum. */
function expectedBuckets(g: Granularity): Record<string, number> {
  const out: Record<string, number> = {};
  for (const row of FIXTURE) {
    const key = labelOf(bucketDateValue(row.iso, g));
    out[key] = (out[key] ?? 0) + row.amount;
  }
  return out;
}

async function bucketSums(driver: SqlDriver, field: string, g: Granularity) {
  const rows = await driver.aggregate(TABLE, {
    groupBy: [{ field, dateGranularity: g }],
    aggregations: [{ function: 'sum', field: 'amount', alias: 'total' }],
  } as any);
  return Object.fromEntries(rows.map((r: any) => [labelOf(r[field]), Number(r.total)]));
}

describe('SqlDriver date bucketing is storage-form independent (#3773)', () => {
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
          closed_at: { type: 'datetime' }, // canonical ISO-Z TEXT since #3912
          closed_on: { type: 'date' },     // YYYY-MM-DD TEXT
          amount: { type: 'number' },
        },
      },
    ]);

    for (const { id, iso, amount } of FIXTURE) {
      await driver.create(
        TABLE,
        // A real `Date` for the datetime column — the path the seed loader and
        // every normal write take, and the one that produces epoch storage.
        { id, closed_at: new Date(iso), closed_on: iso.slice(0, 10), amount },
        { bypassTenantAudit: true },
      );
    }
  });

  afterEach(async () => {
    await driver.disconnect();
  });

  it('stores both temporal columns as canonical text (#3912)', async () => {
    // The premise of this whole file. Since #3912 `formatInput` canonicalises a
    // `Field.datetime` write to `YYYY-MM-DDTHH:MM:SS.sssZ`, so a bound `Date` no
    // longer lands as an INTEGER epoch — the storage form is now the one
    // `Field.date` already used, with a time part. The legacy epoch form still
    // exists in un-migrated databases and is covered by the MIXED-form suite
    // below, which writes it the only way it can still be produced: raw SQL.
    const res: any = await driver.execute(
      `SELECT typeof("closed_at") AS at_t, "closed_at" AS at_v, typeof("closed_on") AS on_t FROM "${TABLE}" WHERE id = 'r3'`,
    );
    const row = Array.isArray(res) ? res[0] : (res?.rows?.[0] ?? res);
    expect(row.at_t).toBe('text');
    expect(row.at_v).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    expect(row.on_t).toBe('text');
  });

  for (const g of GRANULARITIES) {
    describe(`granularity '${g}'`, () => {
      it('buckets the datetime column', async () => {
        expect(await bucketSums(driver, 'closed_at', g)).toEqual(expectedBuckets(g));
      });

      it('buckets the TEXT-stored date column', async () => {
        expect(await bucketSums(driver, 'closed_on', g)).toEqual(expectedBuckets(g));
      });

      it('gives both columns the same labels', async () => {
        const [byAt, byOn] = await Promise.all([
          bucketSums(driver, 'closed_at', g),
          bucketSums(driver, 'closed_on', g),
        ]);
        expect(Object.keys(byAt).sort()).toEqual(Object.keys(byOn).sort());
      });
    });
  }

  it('keeps a pre-1970 instant on its own calendar day', async () => {
    // Guards the `/1000.0` in the bucket expression. Integer division truncates
    // toward zero, so `-1 / 1000` is 0 and this row would surface as 1970-01-01
    // — a full day, year and quarter wrong, and only for negative epochs.
    const byDay = await bucketSums(driver, 'closed_at', 'day');
    expect(byDay['1969-12-31']).toBe(1);
    expect(byDay['1970-01-01']).toBeUndefined();
  });
});

describe('SqlDriver date bucketing over a MIXED-form datetime column (#3773)', () => {
  // A legacy, UN-MIGRATED database: before #3912 `formatInput` left datetime
  // values alone, so a `Date` landed as INTEGER epoch ms while an ISO string
  // (an unresolved `defaultValue: 'NOW()'` slot, any string-valued write) landed
  // as TEXT — in the same column. A bucket expression that assumed epoch for the
  // whole column would divide the TEXT by 1000 — `'2026-01-10T…' / 1000.0` is
  // 2.026 seconds past the epoch — and file live rows under 1970, which is worse
  // than the NULL it replaced.
  //
  // Writes are canonical now, so the only way to reach this state is a database
  // whose backfill has not run: rows inserted raw, with the column's canonical
  // marker cleared. That is exactly the state `backfillCanonicalDatetimes` logs
  // and swallows into when it cannot run — where queries must stay CORRECT via
  // the read-side repair, just unindexed.
  let driver: LegacyStorageDriver;

  beforeEach(async () => {
    driver = new LegacyStorageDriver({
      client: 'better-sqlite3',
      connection: { filename: ':memory:' },
      useNullAsDefault: true,
    });
    await driver.initObjects([
      { name: TABLE, fields: { closed_at: { type: 'datetime' }, amount: { type: 'number' } } },
    ]);
    await driver.seedLegacyRows(TABLE, 'closed_at', [
      { id: 'int', closed_at: Date.parse('2026-01-10T09:00:00Z'), amount: 1 }, // INTEGER epoch ms
      { id: 'txt', closed_at: '2026-02-14T09:00:00Z', amount: 2 },             // zone-explicit TEXT
      { id: 'naive', closed_at: '2026-02-20 09:00:00', amount: 4 },            // CURRENT_TIMESTAMP TEXT
      { id: 'nil', closed_at: null, amount: 8 },
    ]);
  });

  afterEach(async () => {
    await driver.disconnect();
  });

  it('stores the fixture in both forms', async () => {
    const res: any = await driver.execute(
      `SELECT id, typeof("closed_at") AS t FROM "${TABLE}" ORDER BY id`,
    );
    const rows = Array.isArray(res) ? res : (res?.rows ?? []);
    const byId = Object.fromEntries(rows.map((r: any) => [r.id, r.t]));
    expect(['integer', 'real']).toContain(byId.int);
    expect(byId.txt).toBe('text');
    expect(byId.naive).toBe('text');
    expect(byId.nil).toBe('null');
  });

  it('buckets each row by its own stored form', async () => {
    const byMonth = await bucketSums(driver, 'closed_at', 'month');
    expect(byMonth['2026-01']).toBe(1);  // INTEGER epoch ms
    expect(byMonth['2026-02']).toBe(6);  // ISO TEXT (2) + zone-naive TEXT (4)
    expect(byMonth['1970-01']).toBeUndefined(); // TEXT never divided by 1000
  });

  it('leaves a NULL instant in its own bucket', async () => {
    const byMonth = await bucketSums(driver, 'closed_at', 'month');
    // SQL NULL propagates through the bucket expression, so the row lands in the
    // empty bucket instead of under some real month. Since #3839 the in-memory
    // path keys that bucket as `null` as well, so the two paths agree on it —
    // the executable proof is `checkDateBucketParity`, whose fixture now carries
    // a null instant for exactly this.
    expect(byMonth[EMPTY]).toBe(8);
  });
});
