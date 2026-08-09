// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import { applyInMemoryAggregation, bucketDateValue } from './in-memory-aggregation.js';

const rows = [
  { region: 'East', closed_at: '2024-01-15', amount: 100, owner: 'alice' },
  { region: 'East', closed_at: '2024-02-10', amount: 200, owner: 'alice' },
  { region: 'East', closed_at: '2024-04-05', amount: 150, owner: 'bob' },
  { region: 'West', closed_at: '2024-01-20', amount: 300, owner: 'alice' },
  { region: 'West', closed_at: '2024-04-30', amount: null,  owner: 'carol' },
];

describe('applyInMemoryAggregation', () => {
  it('returns rows unchanged when no groupBy nor aggregations', () => {
    expect(applyInMemoryAggregation(rows, {})).toBe(rows);
  });

  it('aggregates without groupBy → single row', () => {
    const out = applyInMemoryAggregation(rows, {
      aggregations: [
        { function: 'count', alias: 'cnt' },
        { function: 'sum', field: 'amount', alias: 'total' },
        { function: 'avg', field: 'amount', alias: 'avg_amount' },
      ],
    });
    expect(out).toEqual([
      { cnt: 5, total: 750, avg_amount: 750 / 4 }, // null excluded from avg
    ]);
  });

  it('groups by a flat string field', () => {
    const out = applyInMemoryAggregation(rows, {
      groupBy: ['region'],
      aggregations: [{ function: 'sum', field: 'amount', alias: 'total' }],
    });
    const east = out.find((r) => r.region === 'East');
    const west = out.find((r) => r.region === 'West');
    expect(east!.total).toBe(450);
    expect(west!.total).toBe(300);
  });

  it('groups by a structured groupBy with dateGranularity (quarter)', () => {
    const out = applyInMemoryAggregation(rows, {
      groupBy: [{ field: 'closed_at', dateGranularity: 'quarter', alias: 'qtr' }],
      aggregations: [{ function: 'sum', field: 'amount', alias: 'total' }],
    });
    const q1 = out.find((r) => r.qtr === '2024-Q1');
    const q2 = out.find((r) => r.qtr === '2024-Q2');
    expect(q1!.total).toBe(600); // 100+200+300
    expect(q2!.total).toBe(150); // 150 (null excluded by toNumber)
  });

  it('combines region + quarter (multi-dimensional groupBy)', () => {
    const out = applyInMemoryAggregation(rows, {
      groupBy: ['region', { field: 'closed_at', dateGranularity: 'quarter' }],
      aggregations: [{ function: 'count', alias: 'n' }],
    });
    expect(out.length).toBe(4); // East/Q1, East/Q2, West/Q1, West/Q2
    const eastQ1 = out.find((r) => r.region === 'East' && r.closed_at === '2024-Q1');
    expect(eastQ1!.n).toBe(2);
  });

  it('honours count_distinct', () => {
    const out = applyInMemoryAggregation(rows, {
      groupBy: ['region'],
      aggregations: [
        { function: 'count_distinct', field: 'owner', alias: 'owners' },
      ],
    });
    const east = out.find((r) => r.region === 'East');
    expect(east!.owners).toBe(2);
  });

  // #6188 retired `array_agg` / `string_agg` from `AggregationFunction`, and
  // this fallback's arms for them went with the vocabulary. The case is kept —
  // re-spelled onto what the retirement actually guarantees — because the pair
  // reached this path from a spec-valid request until v17, so "the fallback no
  // longer computes them" is the observable half of the change. It arrives as
  // `null` from the `default` arm, not as an array; callers cannot reach this
  // through a parsed query at all, since the enum refuses both by name.
  it('no longer computes the retired list aggregations', () => {
    const out = applyInMemoryAggregation(rows, {
      groupBy: ['region'],
      // Cast: these are exactly the values `AggregationFunction` no longer has,
      // which is what this test exists to pin.
      aggregations: [
        { function: 'array_agg', field: 'owner', alias: 'owner_list' },
        { function: 'string_agg', field: 'owner', alias: 'owner_str' },
      ] as never,
    });
    const east = out.find((r) => r.region === 'East');
    expect(east!.owner_list).toBeNull();
    expect(east!.owner_str).toBeNull();
  });

  // #6815 — the per-aggregation `distinct` flag, retired under ADR-0049. This
  // module was the ONLY reader of it in the repo: it deduplicated the values
  // before applying the function while `driver-sql`, `driver-turso`,
  // `driver-mongodb`, `driver-memory` and the service-analytics SQL builder
  // all ignored the key. So the engine's choice of path — a driver without
  // native aggregation, a non-UTC date bucket (#1982), a partial SQL driver —
  // silently decided WHICH NUMBER a report showed, and both numbers looked
  // right. `AggregationNodeSchema` tombstones the key, so a parsed query can
  // no longer carry it; this pins the behaviour for the unparsed shapes that
  // reach the fallback directly (an engine-options bag, a driver forwarding a
  // raw body), which is where a resurrected dedupe limb would hide.
  //
  // The dedupe limb had NO test of its own before this one — the flag was
  // honoured here for its whole life without a case pinning the divergence.
  // The blast radius, measured rather than assumed — it is NARROWER than
  // "every aggregation": `count` returned from its own branch before ever
  // calling `collectValues`, so the flag never reached it; `count_distinct`
  // fed the values into a `Set` (dedupe-then-Set is Set); and dedupe does not
  // move `min`/`max`. Exactly TWO functions changed answer — `sum` and `avg` —
  // and this dataset makes both of them move. The pin covers all six anyway:
  // the guarantee is "no function reads the key", not "two functions stopped".
  const DUPES = [
    { region: 'East', amount: 100, owner: 'alice' },
    { region: 'East', amount: 100, owner: 'alice' },
    { region: 'East', amount: 400, owner: 'bob' },
  ];

  it('ignores a `distinct` flag on an aggregation — uniform with every SQL face', () => {
    // Cast: `distinct` is exactly the key `AggregationNode` no longer has,
    // which is what this test exists to pin.
    const out = applyInMemoryAggregation(DUPES, {
      groupBy: ['region'],
      aggregations: [
        { function: 'sum', field: 'amount', alias: 'total', distinct: true },
        { function: 'avg', field: 'amount', alias: 'avg_amount', distinct: true },
        { function: 'min', field: 'amount', alias: 'lo', distinct: true },
        { function: 'max', field: 'amount', alias: 'hi', distinct: true },
        { function: 'count', field: 'amount', alias: 'n', distinct: true },
        { function: 'count_distinct', field: 'amount', alias: 'uniques', distinct: true },
      ] as never,
    });
    const east = out.find((r) => r.region === 'East')!;
    // The two that moved. `SUM(amount)` over 100/100/400 is 600 on every SQL
    // face; the removed limb collapsed the pair and answered 500.
    expect(east.total).toBe(600);
    // `AVG(amount)` is 600/3 = 200; the removed limb answered 500/2 = 250.
    expect(east.avg_amount).toBe(200);
    // The four that never moved, pinned so a reader can see the real radius.
    expect(east.lo).toBe(100);
    expect(east.hi).toBe(400);
    expect(east.n).toBe(3);
    // …and the live deduplicating spelling still deduplicates, in its own arm,
    // with or without the retired key present.
    expect(east.uniques).toBe(2);
  });

  it('`count_distinct` is unaffected by the removal — dedupe lives in its own arm', () => {
    const out = applyInMemoryAggregation(DUPES, {
      groupBy: ['region'],
      aggregations: [
        { function: 'count_distinct', field: 'owner', alias: 'owners' },
        { function: 'count_distinct', field: 'amount', alias: 'amounts' },
      ],
    });
    const east = out.find((r) => r.region === 'East')!;
    expect(east.owners).toBe(2);
    expect(east.amounts).toBe(2);
  });

  // #3839 — this used to be the literal string `'(null)'`, which the pushed-down
  // SQL path never produced (a NULL group column stays SQL NULL). The engine
  // picks between the two paths per query, so the bucket key's TYPE changed
  // under a dashboard when the driver, the granularity or the timezone changed.
  it('keys the empty bucket as real null, like the pushed-down SQL', () => {
    const dataset = [
      { stage: null, amount: 10 },
      { stage: undefined, amount: 1 },
      { stage: 'won', amount: 5 },
      { amount: 2 }, // field absent entirely
    ];
    const out = applyInMemoryAggregation(dataset, {
      groupBy: ['stage'],
      aggregations: [{ function: 'sum', field: 'amount', alias: 'total' }],
    });
    // null / undefined / absent all describe the same emptiness → one bucket.
    const empty = out.filter((r) => r.stage === null);
    expect(empty).toHaveLength(1);
    expect(empty[0].total).toBe(13);
    // …and it is a real null, not a string that happens to read like one.
    expect(out.some((r) => typeof r.stage === 'string' && /null/i.test(r.stage))).toBe(false);
  });

  // The empty bucket's key is now `null`, and `${null}` is the string 'null' —
  // so a row whose value IS the string "null" would merge into the empty bucket
  // if the internal bucket id were built by plain interpolation.
  it('keeps the empty bucket distinct from the literal string "null"', () => {
    const dataset = [
      { stage: null, amount: 10 },
      { stage: 'null', amount: 5 },
    ];
    const out = applyInMemoryAggregation(dataset, {
      groupBy: ['stage'],
      aggregations: [{ function: 'sum', field: 'amount', alias: 'total' }],
    });
    expect(out).toHaveLength(2);
    expect(out.find((r) => r.stage === null)!.total).toBe(10);
    expect(out.find((r) => r.stage === 'null')!.total).toBe(5);
  });

  // #3849 — these rows ARE `driver.find()` output, so a key that is not the
  // value verbatim is a key that disagrees with every other read of the column.
  // This used to `String()` everything, which the pushed-down path never did.
  it('keys a non-empty bucket with the value verbatim, not a string of it', () => {
    const dataset = [
      { qty: 3, won: true, amount: 1 },
      { qty: 3, won: false, amount: 2 },
      { qty: 7, won: false, amount: 4 },
    ];
    const agg = [{ function: 'sum' as const, field: 'amount', alias: 'total' }];

    const byQty = applyInMemoryAggregation(dataset, { groupBy: ['qty'], aggregations: agg });
    expect(byQty.map((r) => r.qty).sort()).toEqual([3, 7]);
    expect(byQty.find((r) => r.qty === 3)!.total).toBe(3);

    const byWon = applyInMemoryAggregation(dataset, { groupBy: ['won'], aggregations: agg });
    expect(byWon.map((r) => r.won).sort()).toEqual([false, true]);
    expect(byWon.find((r) => r.won === false)!.total).toBe(6);
  });

  // The bucket id is built from the key, so preserving the key's type is only
  // half of it — the id has to preserve it too, or `1` and `'1'` merge on the
  // way in and the surviving key is whichever row happened to arrive first.
  it('keeps values of different types in different buckets', () => {
    const dataset = [
      { v: 1, amount: 1 },
      { v: '1', amount: 2 },
      { v: true, amount: 4 },
      { v: 'true', amount: 8 },
      { v: null, amount: 16 },
      { v: 'null', amount: 32 },
    ];
    const out = applyInMemoryAggregation(dataset, {
      groupBy: ['v'],
      aggregations: [{ function: 'sum', field: 'amount', alias: 'total' }],
    });
    expect(out).toHaveLength(6);
    const total = (v: unknown) => out.find((r) => Object.is(r.v, v))!.total;
    expect(total(1)).toBe(1);
    expect(total('1')).toBe(2);
    expect(total(true)).toBe(4);
    expect(total('true')).toBe(8);
    expect(total(null)).toBe(16);
    expect(total('null')).toBe(32);
  });

  // `JSON.stringify` throws on a BigInt, and the id builder runs on every row of
  // every grouped query — a shape that used to bucket fine under `String()` must
  // not start crashing the aggregate.
  it('buckets a BigInt key without throwing', () => {
    const dataset = [
      { v: 9007199254740993n, amount: 1 },
      { v: 9007199254740993n, amount: 2 },
      { v: 9007199254740994n, amount: 4 },
    ];
    const out = applyInMemoryAggregation(dataset, {
      groupBy: ['v'],
      aggregations: [{ function: 'sum', field: 'amount', alias: 'total' }],
    });
    expect(out).toHaveLength(2);
    expect(out.find((r) => r.v === 9007199254740993n)!.total).toBe(3);
  });
});

describe('bucketDateValue', () => {
  it('truncates to year/quarter/month/day', () => {
    expect(bucketDateValue('2024-05-15', 'year')).toBe('2024');
    expect(bucketDateValue('2024-05-15', 'quarter')).toBe('2024-Q2');
    expect(bucketDateValue('2024-05-15', 'month')).toBe('2024-05');
    expect(bucketDateValue('2024-05-15', 'day')).toBe('2024-05-15');
  });

  it('produces ISO week labels (week starts Monday)', () => {
    // 2024-01-01 is a Monday → ISO week 1
    expect(bucketDateValue('2024-01-01', 'week')).toBe('2024-W01');
    // 2024-12-30 (Mon) → ISO week 1 of 2025
    expect(bucketDateValue('2024-12-30', 'week')).toBe('2025-W01');
  });

  // #3839 — `null`, not a sentinel string. SQL propagates NULL through the
  // bucket expression for both of these (`strftime('%Y-%m', 'not-a-date')` is
  // NULL), so the two paths agree on the empty bucket as well as the full ones.
  it('returns null for null / invalid dates', () => {
    expect(bucketDateValue(null, 'month')).toBeNull();
    expect(bucketDateValue(undefined, 'month')).toBeNull();
    expect(bucketDateValue('not-a-date', 'month')).toBeNull();
  });

  // #3773 — parity with the pushed-down SQL. SQLite stores a `Field.datetime`
  // as epoch milliseconds, so a driver that hands back raw storage values feeds
  // this a NUMBER. `new Date(String(1767225600000))` is an Invalid Date, so
  // these all bucketed as '(null)' while the native SQL bucketed them correctly
  // — the two paths have to label the same instant identically.
  it('reads a finite number as epoch milliseconds', () => {
    const ms = Date.parse('2026-01-10T09:00:00Z');
    expect(bucketDateValue(ms, 'year')).toBe('2026');
    expect(bucketDateValue(ms, 'quarter')).toBe('2026-Q1');
    expect(bucketDateValue(ms, 'month')).toBe('2026-01');
    expect(bucketDateValue(ms, 'day')).toBe('2026-01-10');
    // Same instant, all three shapes a driver might return.
    for (const g of ['year', 'quarter', 'month', 'day'] as const) {
      expect(bucketDateValue(ms, g)).toBe(bucketDateValue(new Date(ms), g));
      expect(bucketDateValue(ms, g)).toBe(bucketDateValue(new Date(ms).toISOString(), g));
    }
  });

  it('reads a negative epoch as a pre-1970 instant', () => {
    expect(bucketDateValue(-1, 'day')).toBe('1969-12-31');
    expect(bucketDateValue(0, 'day')).toBe('1970-01-01');
  });

  // ADR-0053 Phase 2 (D2): a non-UTC reference timezone shifts the calendar day.
  describe('timezone-aware bucketing', () => {
    // 2024-03-01T03:00Z is still 2024-02-29 (22:00) in America/New_York.
    const nearMidnight = '2024-03-01T03:00:00.000Z';

    it('buckets on the reference zone calendar day (day/month/quarter)', () => {
      expect(bucketDateValue(nearMidnight, 'day', 'America/New_York')).toBe('2024-02-29');
      expect(bucketDateValue(nearMidnight, 'month', 'America/New_York')).toBe('2024-02');
      expect(bucketDateValue(nearMidnight, 'quarter', 'America/New_York')).toBe('2024-Q1');
      // ...while UTC sees the next day/month.
      expect(bucketDateValue(nearMidnight, 'day', 'UTC')).toBe('2024-03-01');
      expect(bucketDateValue(nearMidnight, 'month', 'UTC')).toBe('2024-03');
    });

    it('shifts the ISO week when the zone moves the day across a Monday', () => {
      // 2024-03-04T02:00Z is a Monday in UTC (ISO week 10) but still
      // 2024-03-03 Sunday (ISO week 9) in America/New_York.
      const mondayUtc = '2024-03-04T02:00:00.000Z';
      expect(bucketDateValue(mondayUtc, 'week', 'UTC')).toBe('2024-W10');
      expect(bucketDateValue(mondayUtc, 'week', 'America/New_York')).toBe('2024-W09');
    });

    it('falls back to UTC for unset / UTC / invalid zones', () => {
      expect(bucketDateValue(nearMidnight, 'day')).toBe('2024-03-01');
      expect(bucketDateValue(nearMidnight, 'day', 'UTC')).toBe('2024-03-01');
      expect(bucketDateValue(nearMidnight, 'day', 'Not/AZone')).toBe('2024-03-01');
    });

    it('groups rows into the right tz bucket via applyInMemoryAggregation', () => {
      // Two events 4h apart that straddle the NY midnight: in UTC they share
      // the 2024-03-01 day; in NY they split across 02-29 and 03-01.
      const rows = [
        { closed_at: '2024-03-01T03:00:00.000Z', amount: 10 }, // NY: 02-29
        { closed_at: '2024-03-01T07:00:00.000Z', amount: 5 },  // NY: 03-01
      ];
      const ast = {
        groupBy: [{ field: 'closed_at', dateGranularity: 'day' as const }],
        aggregations: [{ function: 'sum', field: 'amount', alias: 'total' }],
      };
      const utc = applyInMemoryAggregation(rows, ast, 'UTC');
      expect(utc).toEqual([{ closed_at: '2024-03-01', total: 15 }]);

      const ny = applyInMemoryAggregation(rows, ast, 'America/New_York').sort(
        (a, b) => String(a.closed_at).localeCompare(String(b.closed_at)),
      );
      expect(ny).toEqual([
        { closed_at: '2024-02-29', total: 10 },
        { closed_at: '2024-03-01', total: 5 },
      ]);
    });
  });
});

describe('count-all `*` sentinel (regression #1982)', () => {
  // The Cube `count` measure and a dataset `count` with no field compile to
  // `sql: '*'`. The in-memory count branch treated `'*'` as a column name and
  // counted non-null of a non-existent property → 0 for every bucket. The
  // driver's `COUNT(*)` masked it; the tz≠UTC date-bucket path (which always
  // runs in-memory) surfaced it as a 0-count bucket with a correct label.
  const evts = [
    { closed_at: '2024-03-01T03:00:00.000Z' }, // NY: 02-29
    { closed_at: '2024-03-01T07:00:00.000Z' }, // NY: 03-01
    { closed_at: '2024-03-01T09:00:00.000Z' }, // NY: 03-01
  ];

  it("counts all rows for a fieldless / `'*'` count, ungrouped", () => {
    const out = applyInMemoryAggregation(evts, {
      aggregations: [{ function: 'count', field: '*', alias: 'n' }],
    });
    expect(out).toEqual([{ n: 3 }]);
  });

  it("counts rows per tz bucket for a `'*'` count (was 0 before the fix)", () => {
    const ast = {
      groupBy: [{ field: 'closed_at', dateGranularity: 'day' as const }],
      aggregations: [{ function: 'count', field: '*', alias: 'n' }],
    };
    const ny = applyInMemoryAggregation(evts, ast, 'America/New_York').sort(
      (a, b) => String(a.closed_at).localeCompare(String(b.closed_at)),
    );
    expect(ny).toEqual([
      { closed_at: '2024-02-29', n: 1 },
      { closed_at: '2024-03-01', n: 2 },
    ]);
  });
});
