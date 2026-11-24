// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#33697] ADR-0053 Phase 2 D2 as amended: PostgreSQL buckets a non-UTC
 * reference zone in the database, and its buckets equal the in-memory ones.
 *
 * `aggregate()` reads the zone from `DriverAggregateQuery.timezone`, which the
 * engine sets only on a driver declaring `supports.zonedDateBucketing`, and
 * only to the runtime's resolved area/location name.
 *
 * ## The cells
 *
 *  - **sqlite**, every run (and **live mysql** where provisioned, which
 *    declares nothing here either): SQLite has no tz database, so it does not
 *    declare the bit and refuses a zoned bucket (NOT_IMPLEMENTED / 501) rather than read
 *    the zone as UTC. `UTC` and a query with no date bucket are served.
 *  - **live postgres**, where `OS_TEST_POSTGRES_URL` is provisioned (a named
 *    skip otherwise, red under `OS_EXPECT_LIVE_DIALECT_MATRIX=1`): it declares
 *    the bit, and every bucket `aggregate()` answers for a zone equals the
 *    label the in-memory path computes for the same row — `bucketDateKey`
 *    (`@objectstack/core`) with the zone for a `Field.datetime`, and with no
 *    zone for a `Field.date` (`in-memory-aggregation.ts` `bucketCalendarDay`).
 *    The rows cross both 2026 Europe/Berlin DST changes at a local midnight,
 *    a month, a quarter, a year and an ISO-week boundary; the zones are the
 *    ADR's parity set (Europe/Berlin, Asia/Taipei, America/New_York, which is
 *    WEST of UTC for the calendar-day axis) plus the card's review item (e)
 *    names (`America/Chicago`, what `CST` resolves to; `Etc/GMT+5`). A zone
 *    the runtime does not resolve to itself is refused (INVALID_QUERY / 400).
 *
 * Review item (a): the zone is a bound value, and the bucket binds it once —
 * the GROUP BY names the select-list position — so PostgreSQL does not see two
 * parameters and refuse with 42803. The multi-key case below puts the bucket
 * second, after a plain key, under a `where` that binds values of its own.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bucketDateKey } from '@objectstack/core';
import { SqlDriver } from '../src/index.js';
import { DIALECT_CELLS, declareDialectCell, type DialectCell } from './live-dialect-matrix.testkit.js';

const TABLE = 'os33697_zoned_bucket';

type Granularity = 'day' | 'week' | 'month' | 'quarter' | 'year';
const GRANULARITIES: readonly Granularity[] = ['day', 'week', 'month', 'quarter', 'year'];

/** Each row: a calendar day (`on`, `Field.date`), an instant (`at`, `Field.datetime`), a plain key. */
const ROWS: ReadonlyArray<{ id: string; kind: string; on: string | null; at: string | null }> = [
  // Europe/Berlin, before the spring change (CET, +1): local 2026-03-29 00:30.
  { id: 'r01', kind: 'a', on: '2026-03-29', at: '2026-03-28T23:30:00.000Z' },
  // After it (CEST, +2): local 2026-03-30 00:30; a +1 reading says 03-29.
  { id: 'r02', kind: 'b', on: '2026-03-30', at: '2026-03-29T22:30:00.000Z' },
  // Month and quarter edge in CEST: local 2026-04-01 00:30 (Q2); +1 says 03-31 (Q1).
  { id: 'r03', kind: 'a', on: '2026-04-01', at: '2026-03-31T22:30:00.000Z' },
  // Before the autumn change (CEST, +2): local 2026-10-25 00:30.
  { id: 'r04', kind: 'b', on: '2026-10-25', at: '2026-10-24T22:30:00.000Z' },
  // After it (CET, +1): local 2026-10-26 00:30 (a Monday, ISO week 44).
  { id: 'r05', kind: 'a', on: '2026-10-26', at: '2026-10-25T23:30:00.000Z' },
  // Month edge in CET: local 2026-11-01 00:30.
  { id: 'r06', kind: 'b', on: '2026-11-01', at: '2026-10-31T23:30:00.000Z' },
  // Year edge east of UTC: Asia/Taipei 2026-01-01 00:30; Berlin 2025-12-31 17:30.
  { id: 'r07', kind: 'a', on: '2026-01-01', at: '2025-12-31T16:30:00.000Z' },
  // West of UTC: America/New_York 2026-02-28 23:30 (EST, -5); UTC says 03-01.
  { id: 'r08', kind: 'b', on: '2026-03-01', at: '2026-03-01T04:30:00.000Z' },
  // ISO week edge: Berlin Monday 2026-01-05 00:30 (W02); UTC Sunday (W01).
  { id: 'r09', kind: 'a', on: '2024-12-30', at: '2026-01-04T23:30:00.000Z' },
  // The empty bucket.
  { id: 'r10', kind: 'b', on: null, at: null },
];

const ZONES = ['Europe/Berlin', 'Asia/Taipei', 'America/New_York', 'America/Chicago', 'Etc/GMT+5'] as const;

/** The empty bucket, keyed out of band so it cannot collide with a real label. */
const EMPTY = '(empty bucket)';
const labelOf = (v: unknown): string => (v == null ? EMPTY : String(v));

/** What the in-memory path answers: label -> row count, for `column` bucketed by `g` in `zone`. */
function inMemoryBuckets(column: 'on' | 'at', g: Granularity, zone: string): [string, number][] {
  const counts = new Map<string, number>();
  for (const row of ROWS) {
    const v = row[column];
    // A `Field.date` is a calendar day and reads no zone (bucketCalendarDay).
    const key = labelOf(v == null ? null : column === 'on' ? bucketDateKey(v, g) : bucketDateKey(v, g, zone));
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts].sort();
}

function bucketsOf(rows: readonly Record<string, unknown>[], labelColumn: string): [string, number][] {
  return rows.map((r): [string, number] => [labelOf(r[labelColumn]), Number(r.n)]).sort();
}

async function refusalOf(p: Promise<unknown>): Promise<{ code?: string; status?: number }> {
  try {
    await p;
  } catch (e) {
    return e as { code?: string; status?: number };
  }
  throw new Error('expected a refusal, got an answer');
}

function measure(cell: DialectCell): void {
  describe(`[#33697] zoned date buckets on ${cell.label}`, () => {
    let driver: SqlDriver;

    beforeAll(async () => {
      driver = new SqlDriver(cell.config());
      await driver.execute(`drop table if exists ${TABLE}`).catch(() => {});
      await driver.initObjects([
        { name: TABLE, fields: { kind: { type: 'text' }, on: { type: 'date' }, at: { type: 'datetime' } } },
      ]);
      for (const row of ROWS) await driver.create(TABLE, { ...row }, { bypassTenantAudit: true });
    });

    afterAll(async () => {
      await driver?.execute(`drop table if exists ${TABLE}`).catch(() => {});
      await driver?.disconnect();
    });

    if (cell.id !== 'pg') {
      it('declares no zone-aware bucketing', () => {
        expect(driver.supports.zonedDateBucketing).toBe(false);
      });

      it('refuses a zoned bucket NOT_IMPLEMENTED/501, never reading the zone as UTC', async () => {
        const err = await refusalOf(driver.aggregate(TABLE, {
          groupBy: [{ field: 'at', dateGranularity: 'month' }],
          aggregations: [{ function: 'count', alias: 'n' }],
          timezone: 'Asia/Taipei',
        }));
        expect(err.code).toBe('NOT_IMPLEMENTED');
        expect(err.status).toBe(501);
      });

      it('serves UTC, and a zone on a query with no date bucket', async () => {
        const utc = await driver.aggregate(TABLE, {
          groupBy: [{ field: 'at', dateGranularity: 'year' }],
          aggregations: [{ function: 'count', alias: 'n' }],
          timezone: 'UTC',
        });
        expect(bucketsOf(utc as Record<string, unknown>[], 'at')).toEqual(inMemoryBuckets('at', 'year', 'UTC'));
        const plain = await driver.aggregate(TABLE, {
          groupBy: ['kind'],
          aggregations: [{ function: 'count', alias: 'n' }],
          timezone: 'Asia/Taipei',
        });
        expect(bucketsOf(plain as Record<string, unknown>[], 'kind')).toEqual([['a', 5], ['b', 5]]);
      });
      return;
    }

    it('declares zone-aware bucketing', () => {
      expect(driver.supports.zonedDateBucketing).toBe(true);
    });

    it('the fixtures are zone-sensitive: every zone disagrees with UTC at some granularity, and every granularity in some zone', () => {
      const differs = (zone: string, g: Granularity) => JSON.stringify(inMemoryBuckets('at', g, zone)) !== JSON.stringify(inMemoryBuckets('at', g, 'UTC'));
      for (const zone of ZONES) expect(GRANULARITIES.some((g) => differs(zone, g)), zone).toBe(true);
      for (const g of GRANULARITIES) expect(ZONES.some((zone) => differs(zone, g)), g).toBe(true);
    });

    for (const zone of ZONES) {
      it.each(GRANULARITIES)(`${zone}: a Field.datetime buckets as the in-memory path does, by %s`, async (g) => {
        const grouped = await driver.aggregate(TABLE, {
          groupBy: [{ field: 'at', dateGranularity: g }],
          aggregations: [{ function: 'count', alias: 'n' }],
          timezone: zone,
        });
        expect(bucketsOf(grouped as Record<string, unknown>[], 'at')).toEqual(inMemoryBuckets('at', g, zone));
      });

      it.each(GRANULARITIES)(`${zone}: a Field.date keeps its calendar day, by %s`, async (g) => {
        const grouped = await driver.aggregate(TABLE, {
          groupBy: [{ field: 'on', dateGranularity: g }],
          aggregations: [{ function: 'count', alias: 'n' }],
          timezone: zone,
        });
        expect(bucketsOf(grouped as Record<string, unknown>[], 'on')).toEqual(inMemoryBuckets('on', g, zone));
      });
    }

    it('binds the zone once: a bucket after a plain key, aliased, under a where with bindings', async () => {
      const grouped = (await driver.aggregate(TABLE, {
        where: { kind: { $in: ['a', 'b'] }, id: { $ne: 'zz' } },
        groupBy: ['kind', { field: 'at', dateGranularity: 'month', alias: 'm' }],
        aggregations: [{ function: 'count', alias: 'n' }],
        timezone: 'Europe/Berlin',
      })) as Record<string, unknown>[];
      const want = new Map<string, number>();
      for (const row of ROWS) {
        const key = `${row.kind}|${labelOf(row.at == null ? null : bucketDateKey(row.at, 'month', 'Europe/Berlin'))}`;
        want.set(key, (want.get(key) ?? 0) + 1);
      }
      const got = grouped.map((r): [string, number] => [`${r.kind}|${labelOf(r.m)}`, Number(r.n)]).sort();
      expect(got).toEqual([...want].sort());
    });

    it.each(['CST', 'US/Eastern', '+08:00', 'EST5EDT', 'Bogus/Zone'])(
      'refuses %s INVALID_QUERY/400: only the resolved area/location name is bucketed',
      async (zone) => {
        const err = await refusalOf(driver.aggregate(TABLE, {
          groupBy: [{ field: 'at', dateGranularity: 'day' }],
          aggregations: [{ function: 'count', alias: 'n' }],
          timezone: zone,
        }));
        expect(err.code).toBe('INVALID_QUERY');
        expect(err.status).toBe(400);
      },
    );
  });
}

for (const cell of DIALECT_CELLS) {
  declareDialectCell(cell, 'zoned date bucket', measure);
}
