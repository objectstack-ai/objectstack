// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #6007 — `compareTo` when the date dimension IS the grid dimension.
 *
 * A trend chart with a year-over-year comparison selects the date as a grid
 * dimension AND anchors `compareTo` on it. The comparison pass then groups the
 * SHIFTED window, so its rows key to shifted buckets, while `mergeByDimensions`
 * keys on `selection.dimensions` — `2025-01` is not `2026-01`, so not one
 * comparison row merged. Every one was appended, `fillEmptyGroups` filled the
 * half each pass never reported, and a 2-bucket window came back as:
 *
 * ```
 * [{"close_date":"2025-01","opp_count__compare":5,"opp_count":0},
 *  {"close_date":"2025-02","opp_count__compare":7,"opp_count":0},
 *  {"close_date":"2026-01","opp_count":1,"opp_count__compare":0},
 *  {"close_date":"2026-02","opp_count":2,"opp_count__compare":0}]
 * ```
 *
 * Four rows, a confident `0` on each, and two of them keyed OUTSIDE the window
 * the caller filtered to. The maintainer's ruling (2026-08-07, direction 1):
 * shift the comparison bucket key back onto the current period, leaving the
 * response SHAPE untouched (still `<measure>__compare` columns, so objectui#3337
 * is unaffected). `previousYear` shifts back by a calendar year; `previousPeriod`
 * — an arbitrary-length day window with no calendar counterpart — aligns by
 * **bucket ordinal**, the n-th bucket of the previous window onto the n-th
 * bucket of this one.
 *
 * ## Why the old pin could not have caught this
 *
 * `dataset-selection-window.test.ts`'s "buckets the compareTo pass identically"
 * case has a fake that returns `created_at: '2026-06'` for BOTH passes,
 * regardless of the filter. Its merge therefore succeeded by construction. What
 * it genuinely pins — that the two passes resolve the same GROUP BY granularity
 * (#4870) — it pins well, and it stays green here; but no fake that ignores the
 * window can reach the layer below it, where real data buckets into the keys of
 * the window it was actually filtered to.
 *
 * So every fake in this file **buckets for real**: it applies the lowered
 * `filter` to a row set and groups what survives, exactly as a `GROUP BY` would,
 * which is what makes the shifted pass return shifted keys at all.
 */

import { describe, it, expect } from 'vitest';
import { DatasetSchema } from '@objectstack/spec/ui';
import type { ExecutionContext } from '@objectstack/spec/kernel';
import { bucketKeyToCalendarRange } from '@objectstack/core';
import { AnalyticsService } from '../analytics-service.js';
import {
  alignedCompareBucketKey,
  bucketKeyAtOrdinal,
  bucketOrdinalOfDay,
  type DateGranularityValue,
} from '../dataset-executor.js';

const CTX = { tenantId: 'org_A' } as ExecutionContext;

// ── fixture ─────────────────────────────────────────────────────────────────

const dataset = DatasetSchema.parse({
  name: 'opportunity_metrics',
  label: 'Opportunity Metrics',
  object: 'opportunity',
  include: [],
  dimensions: [
    { name: 'owner', field: 'owner_id', type: 'lookup', label: 'Owner' },
    { name: 'close_date', field: 'close_date', type: 'date', label: 'Close Date', dateGranularity: 'month' },
    // The control: a date dimension declaring NO granularity, so nothing buckets
    // it and the grid groups raw values.
    { name: 'created_at', field: 'created_at', type: 'date', label: 'Created' },
  ],
  measures: [
    { name: 'opp_count', aggregate: 'count', label: 'Opps' },
    { name: 'won_count', aggregate: 'count', label: 'Won', filter: { stage: 'won' } },
  ],
});

interface Opp {
  owner_id: string;
  close_date: string;
  created_at: string;
  stage: string;
}

/** `n` opportunities on `day`, alternating owners, all won unless stated. */
function opps(day: string, n: number, stage = 'won'): Opp[] {
  return Array.from({ length: n }, (_, i) => ({
    owner_id: i % 2 === 0 ? 'u1' : 'u2',
    close_date: day,
    created_at: day,
    stage,
  }));
}

type GroupByItem = string | { field: string; dateGranularity?: string };
type Aggregation = { field: string; method: string; alias: string };
type AggOptions = { groupBy?: unknown; aggregations?: unknown; filter?: unknown };

function matches(row: Record<string, unknown>, filter: unknown): boolean {
  if (filter == null || typeof filter !== 'object') return true;
  for (const [key, cond] of Object.entries(filter as Record<string, unknown>)) {
    if (key === '$and') {
      if (!(cond as unknown[]).every((c) => matches(row, c))) return false;
      continue;
    }
    if (key === '$or') {
      if (!(cond as unknown[]).some((c) => matches(row, c))) return false;
      continue;
    }
    const value = row[key];
    if (cond != null && typeof cond === 'object' && !Array.isArray(cond)) {
      const ops = cond as Record<string, unknown>;
      if ('$gte' in ops && !(String(value) >= String(ops.$gte))) return false;
      if ('$lte' in ops && !(String(value) <= String(ops.$lte))) return false;
      continue;
    }
    if (value !== cond) return false;
  }
  return true;
}

/**
 * Canonical bucket keys for the granularities this fixture drives end to end.
 *
 * ISO weeks are deliberately absent: reproducing that arithmetic in a fixture
 * would only prove the fixture agrees with the implementation. The week cases
 * use a scripted fake whose hand-written keys are validated against
 * `bucketKeyToCalendarRange` — `@objectstack/core`'s canonical inverse — inside
 * the test itself.
 */
function bucketOf(raw: unknown, granularity?: string): unknown {
  const s = String(raw);
  switch (granularity) {
    case 'year':
      return s.slice(0, 4);
    case 'quarter':
      return `${s.slice(0, 4)}-Q${Math.floor((Number(s.slice(5, 7)) - 1) / 3) + 1}`;
    case 'month':
      return s.slice(0, 7);
    case 'day':
      return s.slice(0, 10);
    default:
      return raw;
  }
}

/**
 * The ObjectQL-aggregate service over a REAL row set: the lowered `filter` is
 * applied, the survivors are grouped by the lowered `groupBy` (date items at
 * their stated granularity), and each aggregation is computed over the group.
 * This is what makes the comparison pass come back keyed to the shifted window.
 */
function svcOver(rows: Opp[]) {
  const calls: AggOptions[] = [];
  const service = new AnalyticsService({
    queryCapabilities: () => ({ nativeSql: false, objectqlAggregate: true, inMemory: false }),
    executeAggregate: async (_object: string, options: Record<string, unknown>) => {
      const opts = options as AggOptions;
      calls.push(opts);
      const groupBy = (opts.groupBy ?? []) as GroupByItem[];
      const aggregations = (opts.aggregations ?? []) as Aggregation[];
      const groups = new Map<string, { key: Record<string, unknown>; rows: Opp[] }>();
      for (const row of rows) {
        if (!matches(row as unknown as Record<string, unknown>, opts.filter)) continue;
        const key: Record<string, unknown> = {};
        for (const g of groupBy) {
          const field = typeof g === 'string' ? g : g.field;
          key[field] = bucketOf(
            (row as unknown as Record<string, unknown>)[field],
            typeof g === 'string' ? undefined : g.dateGranularity,
          );
        }
        const id = JSON.stringify(groupBy.map((g) => key[typeof g === 'string' ? g : g.field] ?? null));
        let group = groups.get(id);
        if (!group) {
          group = { key, rows: [] };
          groups.set(id, group);
        }
        group.rows.push(row);
      }
      return [...groups.values()].map(({ key, rows: members }) => {
        const out: Record<string, unknown> = { ...key };
        for (const a of aggregations) out[a.alias] = members.length;
        return out;
      });
    },
  });
  return { service, calls };
}

const groupByOf = (call: AggOptions) => (call.groupBy ?? []) as GroupByItem[];

// ── 1) the issue, verbatim ──────────────────────────────────────────────────

/** The issue's own numbers: 2026-01 → 1, 2026-02 → 2, 2025-01 → 5, 2025-02 → 7. */
const ISSUE_ROWS: Opp[] = [
  ...opps('2026-01-05', 1),
  ...opps('2026-02-11', 2),
  ...opps('2025-01-07', 5),
  ...opps('2025-02-03', 7),
];

describe('#6007 — the comparison bucket key is restated in current-period terms', () => {
  it('the issue verbatim: 2 rows × 2 columns, not 4 rows each holding one 0', async () => {
    const { service, calls } = svcOver(ISSUE_ROWS);
    const result = await service.queryDataset(
      dataset,
      {
        dimensions: ['close_date'],
        measures: ['opp_count'],
        timeDimensions: [{ dimension: 'close_date', dateRange: ['2026-01-01', '2026-02-28'] }],
        compareTo: { kind: 'previousYear', dimension: 'close_date' },
      },
      CTX,
    );
    // Both passes still bucket by month (#4870), and the comparison pass really
    // did query the shifted window — the precondition that made the keys differ.
    expect(groupByOf(calls[0])).toEqual([{ field: 'close_date', dateGranularity: 'month' }]);
    expect(groupByOf(calls[1])).toEqual([{ field: 'close_date', dateGranularity: 'month' }]);
    expect(calls[1].filter).toMatchObject({ close_date: { $gte: '2025-01-01', $lte: '2025-02-28' } });

    expect(result.rows).toEqual([
      { close_date: '2026-01', opp_count: 1, opp_count__compare: 5 },
      { close_date: '2026-02', opp_count: 2, opp_count__compare: 7 },
    ]);
  });

  it('no row is keyed outside the window the caller filtered to', async () => {
    const { service } = svcOver(ISSUE_ROWS);
    const result = await service.queryDataset(
      dataset,
      {
        dimensions: ['close_date'],
        measures: ['opp_count'],
        timeDimensions: [{ dimension: 'close_date', dateRange: ['2026-01-01', '2026-02-28'] }],
        compareTo: { kind: 'previousYear', dimension: 'close_date' },
      },
      CTX,
    );
    // The second half of the defect, asserted on its own: `2025-01` / `2025-02`
    // used to sit in a grid whose date filter was 2026-01..2026-02.
    expect(result.rows.map((r) => r.close_date)).toEqual(['2026-01', '2026-02']);
  });

  it('the fake really buckets — the comparison pass DOES return shifted keys', async () => {
    // The guard on this whole file: if the fake returned the same keys for both
    // passes (as the #4870 pin's does), every assertion above would pass with
    // the alignment deleted. Query the shifted window directly and read them.
    const { service } = svcOver(ISSUE_ROWS);
    const shifted = await service.queryDataset(
      dataset,
      {
        dimensions: ['close_date'],
        measures: ['opp_count'],
        timeDimensions: [{ dimension: 'close_date', dateRange: ['2025-01-01', '2025-02-28'] }],
      },
      CTX,
    );
    expect(shifted.rows).toEqual([
      { close_date: '2025-01', opp_count: 5 },
      { close_date: '2025-02', opp_count: 7 },
    ]);
  });
});

// ── 2) alignment is CALENDAR, not array position ────────────────────────────

/**
 * A gap in the middle of the current window: 2026-03 has no opportunities at
 * all, while the previous year has data in all four months.
 */
const GAP_ROWS: Opp[] = [
  ...opps('2026-01-05', 1),
  ...opps('2026-02-11', 2),
  // 2026-03: nothing
  ...opps('2026-04-09', 4),
  ...opps('2025-01-07', 5),
  ...opps('2025-02-03', 7),
  ...opps('2025-03-21', 3),
  ...opps('2025-04-02', 9),
];

describe('#6007 — a gap in the current grid does not shift the alignment', () => {
  it('pairs by calendar bucket, so 2025-03 lands on 2026-03 and not on 2026-04', async () => {
    const { service } = svcOver(GAP_ROWS);
    const result = await service.queryDataset(
      dataset,
      {
        dimensions: ['close_date'],
        measures: ['opp_count'],
        timeDimensions: [{ dimension: 'close_date', dateRange: ['2026-01-01', '2026-04-30'] }],
        compareTo: { kind: 'previousYear', dimension: 'close_date' },
      },
      CTX,
    );
    // The tempting implementation — sort each pass's keys and pair by index —
    // would map 2025-03 onto 2026-04 (the third key the primary grid HAS) and
    // leave 2025-04 homeless: every bucket after a gap reads its neighbour's
    // history. Ordinals are computed from the calendar, so the gap costs
    // nothing and 2026-03 arrives as its own row, in-window, with an honest 0.
    expect(result.rows).toEqual([
      { close_date: '2026-01', opp_count: 1, opp_count__compare: 5 },
      { close_date: '2026-02', opp_count: 2, opp_count__compare: 7 },
      { close_date: '2026-03', opp_count: 0, opp_count__compare: 3 },
      { close_date: '2026-04', opp_count: 4, opp_count__compare: 9 },
    ]);
  });
});

// ── 3) every granularity, and the second grid dimension ─────────────────────

describe('#6007 — the shift-back at each bucket size the selection can ask for', () => {
  const CROSS_YEAR: Opp[] = [
    ...opps('2026-02-10', 1),
    ...opps('2026-05-10', 2),
    ...opps('2025-02-10', 3),
    ...opps('2025-05-10', 4),
  ];

  it('quarter', async () => {
    const { service } = svcOver(CROSS_YEAR);
    const result = await service.queryDataset(
      dataset,
      {
        dimensions: ['close_date'],
        measures: ['opp_count'],
        dateGranularity: 'quarter',
        timeDimensions: [{ dimension: 'close_date', dateRange: ['2026-01-01', '2026-06-30'] }],
        compareTo: { kind: 'previousYear', dimension: 'close_date' },
      },
      CTX,
    );
    expect(result.rows).toEqual([
      { close_date: '2026-Q1', opp_count: 1, opp_count__compare: 3 },
      { close_date: '2026-Q2', opp_count: 2, opp_count__compare: 4 },
    ]);
  });

  it('year', async () => {
    const { service } = svcOver(CROSS_YEAR);
    const result = await service.queryDataset(
      dataset,
      {
        dimensions: ['close_date'],
        measures: ['opp_count'],
        dateGranularity: 'year',
        timeDimensions: [{ dimension: 'close_date', dateRange: ['2026-01-01', '2026-12-31'] }],
        compareTo: { kind: 'previousYear', dimension: 'close_date' },
      },
      CTX,
    );
    expect(result.rows).toEqual([{ close_date: '2026', opp_count: 3, opp_count__compare: 7 }]);
  });

  it('day', async () => {
    const { service } = svcOver([
      ...opps('2026-03-02', 1),
      ...opps('2026-03-03', 2),
      ...opps('2025-03-02', 5),
      ...opps('2025-03-03', 6),
    ]);
    const result = await service.queryDataset(
      dataset,
      {
        dimensions: ['close_date'],
        measures: ['opp_count'],
        dateGranularity: 'day',
        timeDimensions: [{ dimension: 'close_date', dateRange: ['2026-03-01', '2026-03-04'] }],
        compareTo: { kind: 'previousYear', dimension: 'close_date' },
      },
      CTX,
    );
    expect(result.rows).toEqual([
      { close_date: '2026-03-02', opp_count: 1, opp_count__compare: 5 },
      { close_date: '2026-03-03', opp_count: 2, opp_count__compare: 6 },
    ]);
  });

  /**
   * ISO weeks, end to end, on a SCRIPTED fake: it answers each pass with the
   * canonical week keys of the window that pass filtered to. The keys are
   * hand-written, so they are validated here against `bucketKeyToCalendarRange`
   * rather than trusted — a fixture that re-implemented ISO weeks could only
   * prove it agreed with the implementation.
   */
  it('week', async () => {
    // 2026-W02 = Mon 2026-01-05 … Sun 2026-01-11; 2025-W02 = Mon 2025-01-06 …
    for (const [key, start] of [
      ['2026-W02', '2026-01-05'],
      ['2026-W03', '2026-01-12'],
      ['2025-W02', '2025-01-06'],
      ['2025-W03', '2025-01-13'],
    ] as const) {
      expect(bucketKeyToCalendarRange(key, 'week')?.start, key).toBe(start);
    }
    const service = new AnalyticsService({
      queryCapabilities: () => ({ nativeSql: false, objectqlAggregate: true, inMemory: false }),
      executeAggregate: async (_object: string, options: Record<string, unknown>) => {
        const from = String(
          ((options as AggOptions).filter as Record<string, Record<string, unknown>>).close_date.$gte,
        );
        return from.startsWith('2025')
          ? [{ close_date: '2025-W02', opp_count: 30 }, { close_date: '2025-W03', opp_count: 40 }]
          : [{ close_date: '2026-W02', opp_count: 3 }, { close_date: '2026-W03', opp_count: 4 }];
      },
    });
    const result = await service.queryDataset(
      dataset,
      {
        dimensions: ['close_date'],
        measures: ['opp_count'],
        dateGranularity: 'week',
        timeDimensions: [{ dimension: 'close_date', dateRange: ['2026-01-05', '2026-01-18'] }],
        compareTo: { kind: 'previousYear', dimension: 'close_date' },
      },
      CTX,
    );
    expect(result.rows).toEqual([
      { close_date: '2026-W02', opp_count: 3, opp_count__compare: 30 },
      { close_date: '2026-W03', opp_count: 4, opp_count__compare: 40 },
    ]);
  });

  it('aligns the ANCHOR column only — the other grid dimension is matched as-is', async () => {
    const { service } = svcOver(ISSUE_ROWS);
    const result = await service.queryDataset(
      dataset,
      {
        dimensions: ['owner', 'close_date'],
        measures: ['opp_count'],
        timeDimensions: [{ dimension: 'close_date', dateRange: ['2026-01-01', '2026-02-28'] }],
        compareTo: { kind: 'previousYear', dimension: 'close_date' },
      },
      CTX,
    );
    // `opps` alternates owners, so 2025-01's five split 3/2 and 2025-02's seven
    // split 4/3 — numbers no single-dimension merge could produce by accident.
    expect(result.rows).toEqual([
      { owner: 'u1', close_date: '2026-01', opp_count: 1, opp_count__compare: 3 },
      { owner: 'u2', close_date: '2026-01', opp_count: 0, opp_count__compare: 2 },
      { owner: 'u1', close_date: '2026-02', opp_count: 1, opp_count__compare: 4 },
      { owner: 'u2', close_date: '2026-02', opp_count: 1, opp_count__compare: 3 },
    ]);
  });

  it('a measure-scoped filter still means the same thing in both columns (#4820 × #6007)', async () => {
    const { service } = svcOver([
      ...opps('2026-01-05', 1, 'won'),
      ...opps('2026-01-06', 2, 'lost'),
      ...opps('2025-01-07', 5, 'won'),
      ...opps('2025-01-08', 4, 'lost'),
    ]);
    const result = await service.queryDataset(
      dataset,
      {
        dimensions: ['close_date'],
        measures: ['opp_count', 'won_count'],
        timeDimensions: [{ dimension: 'close_date', dateRange: ['2026-01-01', '2026-01-31'] }],
        compareTo: { kind: 'previousYear', dimension: 'close_date' },
      },
      CTX,
    );
    // The measure-scoped pass fans out into its own shifted sub-query, so its
    // rows key to the shifted bucket too and need the same realignment.
    expect(result.rows).toEqual([
      {
        close_date: '2026-01',
        opp_count: 3,
        won_count: 1,
        opp_count__compare: 9,
        won_count__compare: 5,
      },
    ]);
  });
});

// ── 4) previousPeriod — the ordinal rule ────────────────────────────────────

describe('#6007 — previousPeriod aligns by bucket ordinal (the ruling’s added semantic)', () => {
  it('day buckets: the n-th day of the previous window onto the n-th day of this one', async () => {
    const { service, calls } = svcOver([
      ...opps('2026-05-01', 1),
      ...opps('2026-05-02', 2),
      ...opps('2026-05-03', 3),
      ...opps('2026-05-04', 10),
      ...opps('2026-05-05', 20),
      ...opps('2026-05-06', 30),
    ]);
    const result = await service.queryDataset(
      dataset,
      {
        dimensions: ['close_date'],
        measures: ['opp_count'],
        dateGranularity: 'day',
        timeDimensions: [{ dimension: 'close_date', dateRange: ['2026-05-04', '2026-05-06'] }],
        compareTo: { kind: 'previousPeriod', dimension: 'close_date' },
      },
      CTX,
    );
    // The equal-length window immediately before: 2026-05-01..03.
    expect(calls[1].filter).toMatchObject({ close_date: { $gte: '2026-05-01', $lte: '2026-05-03' } });
    expect(result.rows).toEqual([
      { close_date: '2026-05-04', opp_count: 10, opp_count__compare: 1 },
      { close_date: '2026-05-05', opp_count: 20, opp_count__compare: 2 },
      { close_date: '2026-05-06', opp_count: 30, opp_count__compare: 3 },
    ]);
  });

  it('month buckets: a 59-day window pairs its two months with the previous two', async () => {
    // [2026-02-01, 2026-03-31] is 59 days, so the previous period is
    // [2025-12-04, 2026-01-31] — two month buckets against two, aligned by
    // position: 2025-12 → 2026-02, 2026-01 → 2026-03. No calendar arithmetic
    // relates those pairs; the ordinal rule is what defines them.
    const { service, calls } = svcOver([
      ...opps('2025-12-10', 5),
      ...opps('2026-01-10', 6),
      ...opps('2026-02-10', 1),
      ...opps('2026-03-10', 2),
    ]);
    const result = await service.queryDataset(
      dataset,
      {
        dimensions: ['close_date'],
        measures: ['opp_count'],
        timeDimensions: [{ dimension: 'close_date', dateRange: ['2026-02-01', '2026-03-31'] }],
        compareTo: { kind: 'previousPeriod', dimension: 'close_date' },
      },
      CTX,
    );
    expect(calls[1].filter).toMatchObject({ close_date: { $gte: '2025-12-04', $lte: '2026-01-31' } });
    expect(result.rows).toEqual([
      { close_date: '2026-02', opp_count: 1, opp_count__compare: 5 },
      { close_date: '2026-03', opp_count: 2, opp_count__compare: 6 },
    ]);
  });
});

// ── 5) the shapes it must NOT touch ─────────────────────────────────────────

describe('#6007 — scoped to the broken shape, and no wider', () => {
  it('a window-only anchor is untouched: it is not a column, so there is nothing to realign', async () => {
    const { service } = svcOver(ISSUE_ROWS);
    const result = await service.queryDataset(
      dataset,
      {
        dimensions: ['owner'],
        measures: ['opp_count'],
        timeDimensions: [{ dimension: 'close_date', dateRange: ['2026-01-01', '2026-02-28'] }],
        compareTo: { kind: 'previousYear', dimension: 'close_date' },
      },
      CTX,
    );
    // #5688's half of the pair: neither pass buckets the anchor, both grids key
    // on `owner`, and the merge already worked. The comparison totals span the
    // WHOLE shifted window (u1: 3 + 4, u2: 2 + 3), so they are only reachable by
    // merging it onto the owner rather than per month.
    expect(result.rows).toEqual([
      { owner: 'u1', opp_count: 2, opp_count__compare: 7 },
      { owner: 'u2', opp_count: 1, opp_count__compare: 5 },
    ]);
  });

  it('an UNBUCKETED date grid dimension is left exactly as it was', async () => {
    const { service } = svcOver([...opps('2026-01-05', 1), ...opps('2025-01-05', 5)]);
    const result = await service.queryDataset(
      dataset,
      {
        dimensions: ['created_at'],
        measures: ['opp_count'],
        timeDimensions: [{ dimension: 'created_at', dateRange: ['2026-01-01', '2026-02-28'] }],
        compareTo: { kind: 'previousYear', dimension: 'created_at' },
      },
      CTX,
    );
    // `created_at` declares no `dateGranularity` and the selection states none,
    // so the runtime groups the raw column: these are instants, not bucket keys,
    // and there is no "the same bucket, one year on" for them. The pre-#6007
    // append is kept deliberately — inventing an alignment for a raw timestamp
    // is how a comparison column ends up on a row it does not describe.
    expect(result.rows).toEqual([
      { created_at: '2025-01-05', opp_count: 0, opp_count__compare: 5 },
      { created_at: '2026-01-05', opp_count: 1, opp_count__compare: 0 },
    ]);
  });

  it('the #4870 pin still holds: a fake that ignores the window merges as it always did', async () => {
    // `dataset-selection-window.test.ts`'s fake returns `2026-06` on BOTH passes.
    // That key is not one the shift-back maps FROM, so the alignment declines and
    // the row keeps it — which is exactly what that test asserts. Restated here
    // so the interaction is visible from this side too.
    let call = 0;
    const service = new AnalyticsService({
      queryCapabilities: () => ({ nativeSql: false, objectqlAggregate: true, inMemory: false }),
      executeAggregate: async () => [{ close_date: '2026-06', opp_count: ++call }],
    });
    const result = await service.queryDataset(
      dataset,
      {
        dimensions: ['close_date'],
        measures: ['opp_count'],
        timeDimensions: [{ dimension: 'close_date', dateRange: ['2026-06-01', '2026-06-30'] }],
        compareTo: { kind: 'previousPeriod', dimension: 'close_date' },
      },
      CTX,
    );
    expect(result.rows).toEqual([{ close_date: '2026-06', opp_count: 1, opp_count__compare: 2 }]);
  });
});

// ── 6) the key arithmetic, pinned against core's canonical inverse ──────────

const GRANULARITIES: DateGranularityValue[] = ['day', 'week', 'month', 'quarter', 'year'];

/** Cross-year, cross-quarter, cross-month, leap and ISO-week-boundary days. */
const DAYS = [
  '2024-01-15',
  '2024-02-29', // leap day
  '2024-04-01',
  '2024-06-30',
  '2024-12-30', // ISO 2025-W01
  '2025-01-01',
  '2025-05-19',
  '2026-01-04', // last day of ISO 2026-W01
  '2026-01-05', // first day of ISO 2026-W02
  '2026-02-15',
  '2026-12-31',
];

describe('#6007 — bucketOrdinalOfDay ↔ bucketKeyAtOrdinal, against bucketKeyToCalendarRange', () => {
  /**
   * `bucketKeyAtOrdinal` is the only place this package MINTS a bucket key, and
   * the keys it mints are compared byte-for-byte against keys the runtime's
   * `GROUP BY` produced. Anything less than a round trip against
   * `@objectstack/core`'s canonical inverse would be a copy of the bucket
   * vocabulary that cannot detect its own drift — the failure mode
   * `bucketDateValue`'s own doc warns about for the copies that already exist.
   */
  for (const g of GRANULARITIES) {
    for (const day of DAYS) {
      it(`${day} @ ${g} round-trips`, () => {
        const key = bucketKeyAtOrdinal(bucketOrdinalOfDay(day, g), g);
        const span = bucketKeyToCalendarRange(key, g);
        expect(span, `core rejects the minted key ${key}`).not.toBeNull();
        // the day lies inside the half-open span of the key minted for it
        expect(span!.start <= day).toBe(true);
        expect(day < span!.end).toBe(true);
        // and the span's own first day mints the same key back
        expect(bucketKeyAtOrdinal(bucketOrdinalOfDay(span!.start, g), g)).toBe(key);
        // ordinals advance by exactly one per bucket
        expect(bucketOrdinalOfDay(span!.end, g)).toBe(bucketOrdinalOfDay(day, g) + 1);
      });
    }
  }
});

describe('#6007 — alignedCompareBucketKey declines rather than guessing', () => {
  const CUR: [string, string] = ['2026-01-01', '2026-02-28'];
  const PREV: [string, string] = ['2025-01-01', '2025-02-28'];

  it('shifts a previousYear bucket forward one calendar year', () => {
    expect(alignedCompareBucketKey('2025-01', 'month', 'previousYear', CUR, PREV)).toBe('2026-01');
    expect(alignedCompareBucketKey('2025-02', 'month', 'previousYear', CUR, PREV)).toBe('2026-02');
  });

  it('returns null for the EMPTY bucket, whose key is null on both aggregation paths (#3839)', () => {
    // Both passes already key their empty bucket the same way, so they merge
    // with each other; "one year after nothing" is not a date.
    expect(alignedCompareBucketKey(null, 'month', 'previousYear', CUR, PREV)).toBeNull();
    expect(alignedCompareBucketKey(undefined, 'month', 'previousYear', CUR, PREV)).toBeNull();
    expect(alignedCompareBucketKey('', 'month', 'previousYear', CUR, PREV)).toBeNull();
  });

  it('returns null for a value that is not a bucket key of this granularity', () => {
    // A raw timestamp from an unbucketed date dimension, and a key of the wrong
    // bucket size — neither has a span to shift.
    expect(alignedCompareBucketKey('2025-01-07T09:30:00Z', 'month', 'previousYear', CUR, PREV)).toBeNull();
    expect(alignedCompareBucketKey('2025-Q1', 'month', 'previousYear', CUR, PREV)).toBeNull();
    expect(alignedCompareBucketKey('2025-13', 'month', 'previousYear', CUR, PREV)).toBeNull();
  });

  it('returns null when the shifted-back bucket falls outside the current window', () => {
    // Two equal-length day windows can tile into different bucket counts, so the
    // ordinal rule can have a last bucket with no counterpart. Moving it to a
    // bucket the caller never asked for would swap a visibly foreign row for a
    // plausible-looking wrong one; it keeps its own key and appends instead.
    expect(alignedCompareBucketKey('2025-03', 'month', 'previousYear', CUR, PREV)).toBeNull();
    expect(alignedCompareBucketKey('2024-12', 'month', 'previousYear', CUR, PREV)).toBeNull();
  });

  it('previousPeriod shifts by the ordinal distance between the two window starts', () => {
    const cur: [string, string] = ['2026-05-04', '2026-05-06'];
    const prev: [string, string] = ['2026-05-01', '2026-05-03'];
    expect(alignedCompareBucketKey('2026-05-01', 'day', 'previousPeriod', cur, prev)).toBe('2026-05-04');
    expect(alignedCompareBucketKey('2026-05-03', 'day', 'previousPeriod', cur, prev)).toBe('2026-05-06');
    // one bucket past the window — declined
    expect(alignedCompareBucketKey('2026-05-04', 'day', 'previousPeriod', cur, prev)).toBeNull();
  });
});
