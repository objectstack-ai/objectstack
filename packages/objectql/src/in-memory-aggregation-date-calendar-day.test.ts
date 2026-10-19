// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#24618] A `Field.date` dimension buckets on its OWN calendar day under every
 * reference timezone — on the in-memory rows path exactly as on the pushdown
 * path.
 *
 * ADR-0053: a `date` is a timezone-naive calendar day, "never converted to an
 * instant and never timezone-shifted"; a `datetime` keeps the requested zone.
 * The rows path used to hand a `date` value to `bucketDateKey` WITH the zone,
 * which read `'2026-10-01'` as the instant `2026-10-01T00:00Z` and placed it on
 * that zone's calendar: `2026-09-30` in America/New_York. Measured at the
 * public door (`POST /api/v1/analytics/query`, stock showcase): every day key
 * one day early, month `{2026-09: 1, 2026-10: 5, 2026-11: 4}` for a stored
 * `{2026-10: 6, 2026-11: 4}`, quarter `{2026-Q3: 1, 2026-Q4: 9}` for
 * `{2026-Q4: 10}` — while the SQL path, taken at UTC, answered the stored days.
 *
 * The expected labels below are LITERALS, the calendar facts of each stored
 * day — never computed by the labeller under test.
 *
 * Three parts:
 *   (a) the rows path, declared `date`, under a negative-offset, a zero and a
 *       positive-offset zone, at every granularity — and the `Date` value shape;
 *   (b) the control: a declared `datetime` still follows the zone;
 *   (c) `engine.aggregate`: the pushdown route (taken only at UTC) and the rows
 *       route (forced by any other zone) answer ONE set of labels for a `date`.
 *       The pushdown side here is a driver double answering the literal labels;
 *       the REAL SQL faces are held to the same labels at UTC by
 *       `checkDateBucketParity` (`@objectstack/verify`), so (c) + that check
 *       are the parity under a non-UTC zone.
 */

import { describe, it, expect } from 'vitest';
import { ObjectQL } from './engine.js';
import { applyInMemoryAggregation } from './in-memory-aggregation.js';

type Granularity = 'day' | 'week' | 'month' | 'quarter' | 'year';
const GRANULARITIES: readonly Granularity[] = ['day', 'week', 'month', 'quarter', 'year'];

/**
 * Each stored day's label at each granularity — its own calendar, no zone.
 * Chosen for the edges a one-day-early shift crosses: a quarter and month start
 * (10-01), two ISO-week Mondays (10-05, 11-02), a month start on a Sunday
 * (11-01) and a year start whose ISO week is the previous year's 53rd (2027-01-01).
 */
const STORED_DAY_LABELS: Readonly<Record<string, Readonly<Record<Granularity, string>>>> = {
  '2026-10-01': { day: '2026-10-01', week: '2026-W40', month: '2026-10', quarter: '2026-Q4', year: '2026' },
  '2026-10-05': { day: '2026-10-05', week: '2026-W41', month: '2026-10', quarter: '2026-Q4', year: '2026' },
  '2026-10-13': { day: '2026-10-13', week: '2026-W42', month: '2026-10', quarter: '2026-Q4', year: '2026' },
  '2026-10-21': { day: '2026-10-21', week: '2026-W43', month: '2026-10', quarter: '2026-Q4', year: '2026' },
  '2026-10-31': { day: '2026-10-31', week: '2026-W44', month: '2026-10', quarter: '2026-Q4', year: '2026' },
  '2026-11-01': { day: '2026-11-01', week: '2026-W44', month: '2026-11', quarter: '2026-Q4', year: '2026' },
  '2026-11-02': { day: '2026-11-02', week: '2026-W45', month: '2026-11', quarter: '2026-Q4', year: '2026' },
  '2026-11-16': { day: '2026-11-16', week: '2026-W47', month: '2026-11', quarter: '2026-Q4', year: '2026' },
  '2026-11-30': { day: '2026-11-30', week: '2026-W49', month: '2026-11', quarter: '2026-Q4', year: '2026' },
  '2027-01-01': { day: '2027-01-01', week: '2026-W53', month: '2027-01', quarter: '2027-Q1', year: '2027' },
};

/** The empty bucket's label, chosen so no `String(value)` can produce it (#3839). */
const EMPTY = '‹empty bucket›';

/**
 * The card's ten deliveries (six in October, four in November — the month and
 * quarter counts the door measured), plus a year-edge row and an unset day.
 */
const DUE_DATES: ReadonlyArray<string | null> = [
  '2026-10-01', '2026-10-05', '2026-10-13', '2026-10-21', '2026-10-21', '2026-10-31',
  '2026-11-01', '2026-11-02', '2026-11-16', '2026-11-30',
  '2027-01-01',
  null,
];

/** `{label: count}` per granularity, for the rows above, as literals. */
const EXPECTED: Readonly<Record<Granularity, Readonly<Record<string, number>>>> = {
  day: {
    '2026-10-01': 1, '2026-10-05': 1, '2026-10-13': 1, '2026-10-21': 2, '2026-10-31': 1,
    '2026-11-01': 1, '2026-11-02': 1, '2026-11-16': 1, '2026-11-30': 1, '2027-01-01': 1, [EMPTY]: 1,
  },
  week: {
    '2026-W40': 1, '2026-W41': 1, '2026-W42': 1, '2026-W43': 2, '2026-W44': 2,
    '2026-W45': 1, '2026-W47': 1, '2026-W49': 1, '2026-W53': 1, [EMPTY]: 1,
  },
  month: { '2026-10': 6, '2026-11': 4, '2027-01': 1, [EMPTY]: 1 },
  quarter: { '2026-Q4': 10, '2027-Q1': 1, [EMPTY]: 1 },
  year: { '2026': 10, '2027': 1, [EMPTY]: 1 },
};

const FIELDS = {
  due_date: { type: 'date' },
  shipped_at: { type: 'datetime' },
  n: { type: 'number' },
} as const;

const ROWS = DUE_DATES.map((due_date, i) => ({ id: `d${i}`, due_date, n: 1 }));

/** A negative-offset pair, the zero zone, and a positive-offset zone. */
const ZONES = ['America/New_York', 'America/Los_Angeles', 'UTC', 'Asia/Tokyo'] as const;

function bucketAst(field: string, granularity: Granularity) {
  return {
    groupBy: [{ field, dateGranularity: granularity }],
    aggregations: [{ function: 'count' as const, alias: 'n' }],
  };
}

function labelCounts(rows: any[], field: string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const row of rows) {
    const v = row?.[field];
    out[v == null ? EMPTY : String(v)] = Number(row?.n ?? 0);
  }
  return out;
}

describe('(a) the rows path buckets a declared `date` by its stored day under every zone (#24618)', () => {
  for (const tz of ZONES) {
    for (const granularity of GRANULARITIES) {
      it(`${granularity} under ${tz}`, () => {
        const out = applyInMemoryAggregation(ROWS, bucketAst('due_date', granularity), tz, FIELDS);
        expect(labelCounts(out, 'due_date')).toEqual(EXPECTED[granularity]);
      });
    }
  }

  it('the door\'s month and quarter counts, under America/New_York', () => {
    const month = labelCounts(
      applyInMemoryAggregation(ROWS.slice(0, 10), bucketAst('due_date', 'month'), 'America/New_York', FIELDS),
      'due_date',
    );
    const quarter = labelCounts(
      applyInMemoryAggregation(ROWS.slice(0, 10), bucketAst('due_date', 'quarter'), 'America/New_York', FIELDS),
      'due_date',
    );
    expect(month).toEqual({ '2026-10': 6, '2026-11': 4 });
    expect(quarter).toEqual({ '2026-Q4': 10 });
  });

  it('a `Date` value of a `date` field buckets by its UTC calendar day — the `date` storage rule', () => {
    // Some drivers hand a `date` back as a `Date` at that day's UTC midnight;
    // `temporalStorageForm(value, 'date')` reads it as its UTC calendar day.
    const asDates = ROWS.map((r) => ({ ...r, due_date: r.due_date === null ? null : new Date(`${r.due_date}T00:00:00.000Z`) }));
    for (const granularity of GRANULARITIES) {
      const out = applyInMemoryAggregation(asDates, bucketAst('due_date', granularity), 'America/New_York', FIELDS);
      expect(labelCounts(out, 'due_date')).toEqual(EXPECTED[granularity]);
    }
  });

  it('an alias names the output column only — the declaration is read off `field`', () => {
    const out = applyInMemoryAggregation(
      ROWS,
      {
        groupBy: [{ field: 'due_date', dateGranularity: 'month', alias: 'due_month' }],
        aggregations: [{ function: 'count', alias: 'n' }],
      },
      'America/Los_Angeles',
      FIELDS,
    );
    expect(labelCounts(out, 'due_month')).toEqual(EXPECTED.month);
  });
});

describe('(b) control: a declared `datetime` keeps the reference zone (#24618)', () => {
  // Two instants either side of the New York midnight that opens 2026-10-01
  // (04:00Z, EDT −04), and one an hour into 2026-11-01 UTC.
  const SHIPPED = [
    { id: 's1', shipped_at: '2026-10-01T02:00:00.000Z', n: 1 }, // NY 2026-09-30 22:00
    { id: 's2', shipped_at: '2026-10-01T15:00:00.000Z', n: 1 }, // NY 2026-10-01 11:00
    { id: 's3', shipped_at: '2026-11-01T01:00:00.000Z', n: 1 }, // NY 2026-10-31 21:00
  ];

  it('under America/New_York an instant lands on the New York calendar day', () => {
    const day = applyInMemoryAggregation(SHIPPED, bucketAst('shipped_at', 'day'), 'America/New_York', FIELDS);
    expect(labelCounts(day, 'shipped_at')).toEqual({ '2026-09-30': 1, '2026-10-01': 1, '2026-10-31': 1 });
    const quarter = applyInMemoryAggregation(SHIPPED, bucketAst('shipped_at', 'quarter'), 'America/New_York', FIELDS);
    expect(labelCounts(quarter, 'shipped_at')).toEqual({ '2026-Q3': 1, '2026-Q4': 2 });
  });

  it('under UTC the same instants land on the UTC calendar day', () => {
    const day = applyInMemoryAggregation(SHIPPED, bucketAst('shipped_at', 'day'), 'UTC', FIELDS);
    expect(labelCounts(day, 'shipped_at')).toEqual({ '2026-10-01': 2, '2026-11-01': 1 });
  });
});

describe('(c) engine.aggregate answers one set of labels for a `date` on both routes (#24618)', () => {
  /**
   * A driver advertising native bucketing at every granularity. Its native
   * `aggregate` is the pushdown route: it labels each row by the literal table
   * above — what a SQL face answers for a `date` column, where no zone is ever
   * applied — and counts how often it ran, so each case can assert the route.
   */
  function makeEngine() {
    let nativeCalls = 0;
    const driver: any = {
      name: 'date-bucket-pushdown-double',
      version: '0.0.0',
      supports: { queryDateGranularity: { day: true, week: true, month: true, quarter: true, year: true } },
      async connect() {}, async disconnect() {}, async checkHealth() { return true; }, async execute() { return null; },
      async find() { return ROWS.map((r) => ({ ...r })); },
      async findOne() { return null; },
      async create(_o: string, d: any) { return d; },
      async update(_o: string, _id: string, d: any) { return d; },
      async delete() { return true; },
      async count() { return ROWS.length; },
      async bulkCreate(_o: string, r: any[]) { return r; },
      async bulkUpdate() { return []; }, async bulkDelete() {},
      async beginTransaction() { return { __trx: true, commit: async () => {}, rollback: async () => {} }; },
      async commit() {}, async rollback() {},
      async aggregate(_object: string, ast: any) {
        nativeCalls += 1;
        const { field, dateGranularity } = ast.groupBy[0];
        const counts = new Map<string | null, number>();
        for (const r of ROWS) {
          const v = (r as Record<string, unknown>)[field] as string | null;
          const label = v == null ? null : STORED_DAY_LABELS[v][dateGranularity as Granularity];
          counts.set(label, (counts.get(label) ?? 0) + 1);
        }
        return Array.from(counts, ([label, n]) => ({ [field]: label, n }));
      },
    };
    const engine = new ObjectQL();
    engine.registerDriver(driver, true);
    return { engine, driver, nativeCalls: () => nativeCalls };
  }

  for (const granularity of GRANULARITIES) {
    it(`${granularity}: the rows route under every non-UTC zone equals the pushdown route at UTC`, async () => {
      const { engine, nativeCalls } = makeEngine();
      await engine.init();
      engine.registry.registerObject({ name: 'delivery', fields: FIELDS } as any);

      const pushedDown = await engine.aggregate('delivery', { ...bucketAst('due_date', granularity), timezone: 'UTC' } as any);
      expect(nativeCalls()).toBe(1); // the pushdown route
      expect(labelCounts(pushedDown, 'due_date')).toEqual(EXPECTED[granularity]);

      for (const tz of ZONES.filter((z) => z !== 'UTC')) {
        const inMemory = await engine.aggregate('delivery', { ...bucketAst('due_date', granularity), timezone: tz } as any);
        expect(nativeCalls()).toBe(1); // a non-UTC zone forced the rows route
        expect(labelCounts(inMemory, 'due_date')).toEqual(labelCounts(pushedDown, 'due_date'));
      }
    });
  }
});
