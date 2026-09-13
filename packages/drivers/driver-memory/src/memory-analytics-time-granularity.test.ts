// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#16178] `AnalyticsQuery.timeDimensions[].granularity` — declared by the spec,
// enumerated per dimension by the cube (`granularities: ['day']`), and until this
// card read by NEITHER on this face. The `$group` stage keyed on the raw field
// path, so a time dimension answered ONE GROUP PER DISTINCT TIMESTAMP under an
// ordinary 200: one bar per row in a "new accounts by month" chart, which is the
// symptom #3588 catalogued and repaired for `service-analytics`.
//
// The measurement that opens this file is the card's own, and the `no
// granularity` cell beside it is the control: without it, "one group" proves
// nothing, because a fixture that collapses for an unrelated reason reads the
// same.
//
// Orthogonal to #16042/#16179, which repaired the `dateRange` WINDOW (which rows
// are SELECTED) on these same entries. This is the GROUPING (how selected rows
// are FOLDED) — and the two are held to one reference timezone here, since a
// window resolved in one zone and a bucket folded in another is a chart whose
// bars do not add up to its own total.

import { describe, it, expect } from 'vitest';
import { InMemoryDriver } from './memory-driver.js';
import { MemoryAnalyticsService } from './memory-analytics.js';
import { AnalyticsQuerySchema, TimeUpdateInterval } from '@objectstack/spec/data';
import { BUCKET_GRANULARITIES } from '@objectstack/core';
import type { AnalyticsQuery, Cube } from '@objectstack/spec/data';

/** Every query goes through the schema, the route a real request body takes. */
const asQuery = (input: AnalyticsQuery): AnalyticsQuery => AnalyticsQuerySchema.parse(input);

const cubes: Cube[] = [
  {
    name: 'events',
    title: 'Events',
    sql: 'events',
    measures: {
      count: { name: 'count', label: 'Event Count', type: 'count', sql: 'id' },
      latest: { name: 'latest', label: 'Latest Event', type: 'max', sql: 'created_at' },
    },
    dimensions: {
      createdAt: {
        name: 'createdAt',
        label: 'Created At',
        type: 'time',
        sql: 'created_at',
        granularities: ['day', 'week', 'month', 'quarter', 'year'],
      },
    },
  },
];

/** Two rows on ONE UTC calendar day, fourteen hours apart — the card's fixture. */
const TWO_ROWS_ONE_UTC_DAY = [
  { id: 1, created_at: '2026-09-06T01:00:00.000Z' },
  { id: 2, created_at: '2026-09-06T23:00:00.000Z' },
];

async function query(
  input: AnalyticsQuery,
  rows: Record<string, unknown>[] = TWO_ROWS_ONE_UTC_DAY,
) {
  const driver = new InMemoryDriver({ initialData: { events: rows } });
  await driver.connect();
  const service = new MemoryAnalyticsService({ driver, cubes });
  return service.query(asQuery(input));
}

const BASE = {
  cube: 'events',
  measures: ['events.count'],
  dimensions: ['events.createdAt'],
} satisfies Partial<AnalyticsQuery>;

const labels = (result: { rows: Record<string, unknown>[] }) =>
  result.rows.map((r) => r['events.createdAt']);

/**
 * The in-process door PAST the schema — `AnalyticsQuerySchema` would refuse an
 * undeclared spelling itself, so a query that tests what the DRIVER does with
 * one must not be parsed first. This is the reachability
 * `analyticsDateRangeUnrecognizedError` records for its own out-of-vocabulary
 * refusal: `POST /analytics/dataset/query` types `selection.timeDimensions`
 * from `AnalyticsQuery` and never Zod-parses them.
 */
async function unparsed(granularity: string) {
  const driver = new InMemoryDriver({ initialData: { events: TWO_ROWS_ONE_UTC_DAY } });
  await driver.connect();
  const service = new MemoryAnalyticsService({ driver, cubes });
  return service.query({
    ...BASE,
    timeDimensions: [{ dimension: 'events.createdAt', granularity }],
  } as unknown as AnalyticsQuery);
}

describe('[#16178] a time dimension buckets by its declared granularity', () => {
  it("folds two rows on one UTC day into ONE group under granularity 'day'", async () => {
    const result = await query({
      ...BASE,
      timeDimensions: [{ dimension: 'events.createdAt', granularity: 'day' }],
    });

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({ 'events.createdAt': '2026-09-06', 'events.count': 2 });
  });

  it('CONTROL — the same two rows stay two groups when no granularity is asked for', async () => {
    // The control that makes the cell above a measurement rather than a
    // coincidence: this face still groups on the raw instant when nothing asks
    // it to bucket, so "one group" above is the granularity doing the work.
    const result = await query({
      ...BASE,
      timeDimensions: [{ dimension: 'events.createdAt' }],
    });

    expect(result.rows).toHaveLength(2);
    expect(labels(result)).toEqual([
      '2026-09-06T01:00:00.000Z',
      '2026-09-06T23:00:00.000Z',
    ]);
  });

  it('labels every granularity in the canonical output vocabulary', async () => {
    // `DriverCapabilitiesSchema.queryDateGranularity` calls this vocabulary an
    // "Output contract (CRITICAL)": a driver that pushes the bucket down into
    // SQL emits these exact strings, so a drill-down survives the seam. The week
    // label is `YYYY-Www` — never the Monday's `YYYY-MM-DD`.
    const expected: Record<string, string> = {
      day: '2026-09-06',
      week: '2026-W36',
      month: '2026-09',
      quarter: '2026-Q3',
      year: '2026',
    };

    for (const [granularity, label] of Object.entries(expected)) {
      const result = await query({
        ...BASE,
        timeDimensions: [{ dimension: 'events.createdAt', granularity: granularity as 'day' }],
      });
      expect(labels(result), granularity).toEqual([label]);
    }
  });

  it('buckets a member named without its cube prefix in `dimensions`', async () => {
    // The two keys are matched on the RESOLVED field path, so `createdAt` and
    // `events.createdAt` are one member rather than two.
    const result = await query({
      ...BASE,
      dimensions: ['createdAt'],
      timeDimensions: [{ dimension: 'events.createdAt', granularity: 'day' }],
    });

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({ createdAt: '2026-09-06', 'events.count': 2 });
  });
});

describe('[#16178] a granular time dimension is a projected group column on its own', () => {
  /** Measures + one granular time dimension, `dimensions` absent entirely. */
  const TREND = {
    cube: 'events',
    measures: ['events.count'],
    timeDimensions: [{ dimension: 'events.createdAt', granularity: 'day' }],
  } satisfies Partial<AnalyticsQuery>;

  it('groups and projects a `timeDimensions` member that `dimensions` never lists', async () => {
    // The canonical trend-query shape. Keying `$group` on `query.dimensions`
    // alone answered ONE TOTAL for it (`_id: null`) — a chart with a y-value
    // and no x-axis, which is the #4033 symptom the SQL/ObjectQL face already
    // repaired: `objectql-strategy.ts` groups every granular entry not listed
    // in `dimensions` (:163-167) and `projectedDimensions` (:1889-1893) hands
    // that one set to grouping, row mapping and field metadata alike. Accepted,
    // silent and inert is this card's own defect class, so the two faces agree
    // here rather than one of them declaring a key it never reads.
    const result = await query(TREND);

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({ 'events.createdAt': '2026-09-06', 'events.count': 2 });
  });

  it('names the projected bucket in `fields`, on the terms the listed shape gets', async () => {
    // Rows without their `fields` entry is half of #4033: the x-axis exists in
    // the data and not in the metadata beside it. Pinned as AGREEMENT with the
    // shape that lists the member, so the two spellings of one query cannot
    // drift into two answers.
    const projected = await query(TREND);
    const listed = await query({
      ...BASE,
      timeDimensions: [{ dimension: 'events.createdAt', granularity: 'day' }],
    });

    expect(projected.fields).toEqual(listed.fields);
    expect(projected.fields.map((f) => f.name)).toEqual(['events.createdAt', 'events.count']);
  });

  it('CONTROL — a `dateRange`-only entry is NOT projected (#5688)', async () => {
    // The rule's other half, and what keeps the cells above from reading as
    // "every time dimension becomes a column". An entry carrying only a window
    // is a PREDICATE: it selects rows and contributes no group key, so this
    // answers one total under a `fields` list that never mentions the member.
    const result = await query({
      cube: 'events',
      measures: ['events.count'],
      timeDimensions: [{ dimension: 'events.createdAt', dateRange: ['2026-09-06', '2026-09-06'] }],
    });

    expect(result.rows).toEqual([{ 'events.count': 2 }]);
    expect(result.fields.map((f) => f.name)).toEqual(['events.count']);
  });

  it('keys a member listed BOTH ways exactly once', async () => {
    // Matched on the resolved field path, the same way the `dimensions` loop
    // already folds a bucketed member — so the unprefixed spelling collides
    // with the prefixed one instead of adding a second column.
    const result = await query({
      ...BASE,
      dimensions: ['createdAt'],
      timeDimensions: [{ dimension: 'events.createdAt', granularity: 'day' }],
    });

    expect(result.rows).toHaveLength(1);
    expect(result.fields.map((f) => f.name)).toEqual(['createdAt', 'events.count']);
  });
});

describe('[#16178] bucketing and the reference timezone', () => {
  it('folds in `AnalyticsQuery.timezone` — the zone the dateRange repair resolves against', async () => {
    // ⛔ UTC is not the only case. 01:00Z and 23:00Z are one UTC day, but in New
    // York the first is still the previous evening, and in Tokyo the second is
    // already the next morning — so the SAME two rows answer one group or two
    // depending on the reference zone, exactly as a user in that zone reads it.
    const utc = await query({
      ...BASE,
      timezone: 'UTC',
      timeDimensions: [{ dimension: 'events.createdAt', granularity: 'day' }],
    });
    expect(labels(utc)).toEqual(['2026-09-06']);

    const newYork = await query({
      ...BASE,
      timezone: 'America/New_York',
      timeDimensions: [{ dimension: 'events.createdAt', granularity: 'day' }],
    });
    expect(labels(newYork).sort()).toEqual(['2026-09-05', '2026-09-06']);

    const tokyo = await query({
      ...BASE,
      timezone: 'Asia/Tokyo',
      timeDimensions: [{ dimension: 'events.createdAt', granularity: 'day' }],
    });
    expect(labels(tokyo).sort()).toEqual(['2026-09-06', '2026-09-07']);
  });

  it('an absent timezone buckets in UTC, the same default the window resolver takes', async () => {
    const absent = await query({
      ...BASE,
      timeDimensions: [{ dimension: 'events.createdAt', granularity: 'day' }],
    });
    expect(labels(absent)).toEqual(['2026-09-06']);
  });

  it('does not disturb the `dateRange` window on the same entry (#16042/#16179)', async () => {
    // Both keys on one entry: the window still SELECTS by its own published
    // semantics and the granularity FOLDS what survives.
    const inWindow = await query({
      ...BASE,
      timeDimensions: [
        { dimension: 'events.createdAt', granularity: 'day', dateRange: ['2026-09-06', '2026-09-06'] },
      ],
    });
    expect(inWindow.rows).toHaveLength(1);
    expect(inWindow.rows[0]).toMatchObject({ 'events.createdAt': '2026-09-06', 'events.count': 2 });

    const outOfWindow = await query({
      ...BASE,
      timeDimensions: [
        { dimension: 'events.createdAt', granularity: 'day', dateRange: ['2026-09-04', '2026-09-04'] },
      ],
    });
    expect(outOfWindow.rows).toHaveLength(0);
  });
});

describe('[#16178] a sub-day granularity is refused, not dropped', () => {
  // [#17296] These three were refused as NOT_IMPLEMENTED/501 when this file was
  // written, because `TimeUpdateInterval` still DECLARED them and this backend
  // could not bucket them — a capability gap, stated honestly. #17296 measured
  // that no backend could bucket them and none could even advertise them
  // (`supports.queryDateGranularity` is a record over the five-member
  // `DateGranularity`), and retired the three from the spec. The refusal did
  // not get quieter: its CLASS moved, from "this backend cannot" to "the
  // contract does not declare it", which is the honest sentence once the
  // declaration is gone. Both halves are pinned below.
  it.each(['second', 'minute', 'hour'])(
    'refuses %s AT THE SCHEMA now, one door earlier, with the retirement prescription',
    (granularity) => {
      // The refusal MOVED rather than softened, and it moved toward the caller:
      // a parsed body no longer reaches the driver at all. `query()` runs
      // `AnalyticsQuerySchema.parse`, the route a real request body takes, so
      // this cell measures the door a caller actually meets first.
      //
      // Asserted on the PRESCRIPTION, not on "it threw": a bare rejection is
      // what zod's stock invalid-enum error already gives, and it would tell an
      // author upgrading from 17 nothing about why the name they wrote last
      // week is gone or what to write instead.
      const parsed = AnalyticsQuerySchema.safeParse({
        ...BASE,
        timeDimensions: [{ dimension: 'events.createdAt', granularity }],
      });
      expect(parsed.success, granularity).toBe(false);
      if (parsed.success) return;
      const message = parsed.error.issues.map((i) => i.message).join(' ');
      expect(message, granularity).toContain('retired in protocol 18');
      expect(message, granularity).toContain('os migrate meta --from 17');
    },
  );

  it.each(['second', 'minute', 'hour'])(
    'refuses %s at the DRIVER too, for the door that does not parse, as a 400',
    async (granularity) => {
      // The other door — `POST /analytics/dataset/query` types
      // `selection.timeDimensions` from `AnalyticsQuery` and never Zod-parses
      // them, which is the reachability `analyticsDateRangeUnrecognizedError`
      // records for its own out-of-vocabulary refusal. 501 said "your query is
      // right, this backend cannot"; that sentence became false the moment the
      // contract stopped declaring the value, so the class is now 400 and the
      // driver carries the retirement sentence itself rather than telling an
      // upgrading author their spelling never existed.
      const thrown = await unparsed(granularity).catch(
        (e: Error & { code?: string; status?: number }) => e,
      );
      expect(thrown).toMatchObject({ code: 'INVALID_QUERY', status: 400 });
      expect((thrown as Error).message, granularity).toContain('retired there');
      expect((thrown as Error).message, granularity).toContain('protocol 18');
    },
  );

  it('the 501 arm still EXISTS and its population is empty — measured, not asserted', async () => {
    // The claim `filter-refusal.ts` makes in prose, as a reading. 501 answers
    // "declared here, unbucketable here", so its population is exactly
    // TimeUpdateInterval minus BUCKET_GRANULARITIES. The two sets are equal as
    // of protocol 18, which is WHY every cell above is a 400 — and the day a
    // widening of one alone breaks that equality, this goes red before any
    // caller meets a 400 calling a declared value undeclared.
    expect([...TimeUpdateInterval.options]).toEqual([...BUCKET_GRANULARITIES]);
  });

  it('refuses on an EMPTY table too, so the refusal is the compile and not the data', async () => {
    // An unbucketed query over no rows answers `{rows: []}`; this one still
    // refuses, which places the refusal at compile time where the ruling put it.
    // Driven through the unparsed door, because the parsed one now stops the
    // value before any table — empty or not — is consulted at all.
    const driver = new InMemoryDriver({ initialData: { events: [] } });
    await driver.connect();
    const service = new MemoryAnalyticsService({ driver, cubes });
    await expect(
      service.query({
        ...BASE,
        timeDimensions: [{ dimension: 'events.createdAt', granularity: 'hour' }],
      } as unknown as AnalyticsQuery),
    ).rejects.toMatchObject({ code: 'INVALID_QUERY', status: 400 });
  });

  it('answers 400 for a granularity the CONTRACT never declared, WITHOUT the retirement sentence', () => {
    // 501 is a claim about this BACKEND, and it is only honest about a value the
    // contract actually declares. `'fortnight'` is a mistake in the query, and
    // the 501 sentence asserting "the spec declares the value" would have been
    // false of it. Reached the way its `dateRange` sibling documents — past the
    // schema door, which is where `POST /analytics/dataset/query` types
    // `selection.timeDimensions` without Zod-parsing them — so this query
    // deliberately does NOT go through `asQuery`.
    return expect(unparsed('fortnight')).rejects.toMatchObject({
      code: 'INVALID_QUERY',
      status: 400,
    });
  });

  it('CONTROL — the same door separates a RETIRED spelling from one that never existed', async () => {
    // [#17296] Without this the cells above read as "every rejection says
    // retired". Both are 400 now, so `code`/`status` no longer tell the two
    // populations apart — the PRESCRIPTION does, and that is the whole reason
    // the 400 arm branches at all. `fortnight` was never declared and has no
    // migration; `hour` was, and does not have one either, which is itself the
    // thing the author has to be told.
    const neverDeclared = await unparsed('fortnight').catch((e: Error) => e);
    const retired = await unparsed('hour').catch((e: Error) => e);
    expect((neverDeclared as Error).message).not.toContain('retired');
    expect((retired as Error).message).toContain('retired there');
    expect((retired as Error).message).toContain('protocol 18');
  });
});

describe('[#16178] the fold does not corrupt what it is not asked to bucket', () => {
  it('leaves a measure over the SAME member ranking instants, not labels', async () => {
    // The bucket key travels under a synthetic field rather than overwriting the
    // row's own: `created_at` is both the group key and `max()`'s aggregand here,
    // and folding it in place would have made `latest` the largest bucket LABEL.
    const result = await query({
      cube: 'events',
      measures: ['events.count', 'events.latest'],
      dimensions: ['events.createdAt'],
      timeDimensions: [{ dimension: 'events.createdAt', granularity: 'day' }],
    });

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({
      'events.createdAt': '2026-09-06',
      'events.count': 2,
      'events.latest': '2026-09-06T23:00:00.000Z',
    });
  });

  it('gives null and unparseable instants the one bucket SQL gives them (#3839)', async () => {
    const result = await query(
      {
        ...BASE,
        timeDimensions: [{ dimension: 'events.createdAt', granularity: 'day' }],
      },
      [
        { id: 1, created_at: null },
        { id: 2, created_at: 'not-a-date' },
        { id: 3, created_at: '2026-09-06T01:00:00.000Z' },
      ],
    );

    expect(result.rows).toHaveLength(2);
    expect(result.rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ 'events.createdAt': null, 'events.count': 2 }),
        expect.objectContaining({ 'events.createdAt': '2026-09-06', 'events.count': 1 }),
      ]),
    );
  });

  it('buckets an epoch-millis row with an ISO row (#3773)', async () => {
    // The in-memory table holds whatever the writer produced; a driver handing
    // back raw storage values yields numbers. Both must land in one bucket.
    const result = await query(
      {
        ...BASE,
        timeDimensions: [{ dimension: 'events.createdAt', granularity: 'day' }],
      },
      [
        { id: 1, created_at: Date.parse('2026-09-06T01:00:00.000Z') },
        { id: 2, created_at: '2026-09-06T23:00:00.000Z' },
      ],
    );

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({ 'events.createdAt': '2026-09-06', 'events.count': 2 });
  });
});
