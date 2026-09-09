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
import { AnalyticsQuerySchema } from '@objectstack/spec/data';
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
  it.each(['second', 'minute', 'hour'])(
    'refuses %s with the NOT_IMPLEMENTED/501 envelope',
    async (granularity) => {
      // Asserted on `code` and `status` — the ADR-0112 envelope — never on the
      // message text. A bare `toThrow()` would pass against a driver that threw
      // for any unrelated reason.
      await expect(
        query({
          ...BASE,
          timeDimensions: [{ dimension: 'events.createdAt', granularity: granularity as 'hour' }],
        }),
      ).rejects.toMatchObject({ code: 'NOT_IMPLEMENTED', status: 501 });
    },
  );

  it('refuses on an EMPTY table too, so the refusal is the compile and not the data', async () => {
    // An unbucketed query over no rows answers `{rows: []}`; this one still
    // refuses, which places the refusal at compile time where the ruling put it.
    await expect(
      query(
        {
          ...BASE,
          timeDimensions: [{ dimension: 'events.createdAt', granularity: 'hour' }],
        },
        [],
      ),
    ).rejects.toMatchObject({ code: 'NOT_IMPLEMENTED', status: 501 });
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
