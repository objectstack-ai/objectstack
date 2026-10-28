// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #26893 — a date-dimension series answers every bucket of its window, the
 * empty ones included.
 *
 * A grouped query answers one row per bucket that HOLDS rows. HotCRM's
 * "Revenue Trend: closed-won revenue over the last 12 months" came back with
 * the months that held a deal and nothing for May and August, so the category
 * axis drew April next to June and the area between them read as revenue. The
 * executor now invents the missing buckets from its own calendar helpers, and
 * the empty-group fill gives them their value (count/sum `0`, avg/min/max
 * `null`).
 *
 * Served through the real plugin, the real ObjectQL engine and a real SQLite
 * driver (sql.js), the way `objectql-echo-bucket-enumeration.test.ts` serves
 * its table: a bucketed query declines native SQL, so every trend reaches the
 * engine's `aggregate()` and the driver's own date bucket.
 *
 * Pinned:
 *   - the window is the time dimension's `dateRange` — an explicit pair and a
 *     preset — and the buckets come back in order;
 *   - with the window only in `runtimeFilter` (the dashboard widget's shape)
 *     or only a lower bound (HotCRM's `{ $gte: '{12_months_ago}' }`), only the
 *     gaps between the first and last bucket returned are filled;
 *   - another grid dimension is filled per combination that holds a row;
 *   - a non-UTC zone: the keys the fill writes are the keys the query writes;
 *   - the controls — a full window, a top-N, an order on a measure, no time
 *     dimension — come back as they always have;
 *   - the bound: a fill past `MAX_ZERO_FILLED_GRID_ROWS` does not run at all;
 *   - #27111, `compareTo`: the same fill, over the PRIMARY window, adds the
 *     buckets empty in both windows with `0` in both the measure and its
 *     `__compare`; a bucket either window holds is unchanged, and the guards
 *     (no axis `dateRange`, a `limit`, an order on a `__compare`) hold.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqliteWasmDriver } from '@objectstack/driver-sqlite-wasm';
import { DatasetSchema } from '@objectstack/spec/ui';
import type { DatasetSelection } from '@objectstack/spec/contracts';
import type { ExecutionContext } from '@objectstack/spec/kernel';
import type { AnalyticsService } from '../analytics-service.js';
import { AnalyticsServicePlugin } from '../plugin.js';
import {
  fillEmptyTimeBuckets,
  MAX_ZERO_FILLED_GRID_ROWS,
} from '../dataset-executor.js';
import { installDefaultOrganization } from './default-organization.testkit.js';

const DEAL = 'os26893_deal';
const DEAL_OBJECT = {
  name: DEAL,
  label: 'Zero-fill deal',
  fields: {
    close_date: { name: 'close_date', type: 'date' as const },
    closed_at: { name: 'closed_at', type: 'datetime' as const },
    stage: { name: 'stage', type: 'text' as const },
    owner: { name: 'owner', type: 'text' as const },
    amount: { name: 'amount', type: 'number' as const },
  },
};

/** The HotCRM `opportunity_metrics` shape: a month-bucketed close date and the three aggregates. */
const DATASET = DatasetSchema.parse({
  name: 'os26893_metrics',
  label: 'Zero-fill metrics',
  object: DEAL,
  include: [],
  dimensions: [
    { name: 'close_date', field: 'close_date', type: 'date', dateGranularity: 'month' },
    { name: 'closed_at', field: 'closed_at', type: 'date' },
    { name: 'stage', field: 'stage', type: 'string' },
    { name: 'owner', field: 'owner', type: 'string' },
  ],
  measures: [
    { name: 'opp_count', aggregate: 'count' },
    { name: 'total_amount', aggregate: 'sum', field: 'amount' },
    { name: 'avg_amount', aggregate: 'avg', field: 'amount' },
  ],
});

/**
 * Twelve months, 2025-11 through 2026-10, closed-won in ten of them: nothing
 * in 2026-05 or 2026-08 (the filing's two months). October holds the daily
 * series: 1, 2, 3, 6, 9 and 10 October, so 4–5 and 7–8 are interior gaps and
 * 11–30 are past the last row. One `lost` deal sits in May, so the stage
 * filter is what empties it.
 */
const DEALS = [
  { id: 'd01', close_date: '2025-11-14', stage: 'closed_won', owner: 'ann', amount: 10 },
  { id: 'd02', close_date: '2025-12-02', stage: 'closed_won', owner: 'bob', amount: 20 },
  { id: 'd03', close_date: '2026-01-20', stage: 'closed_won', owner: 'ann', amount: 30 },
  { id: 'd04', close_date: '2026-02-11', stage: 'closed_won', owner: 'bob', amount: 40 },
  { id: 'd05', close_date: '2026-03-05', stage: 'closed_won', owner: 'ann', amount: 50 },
  { id: 'd06', close_date: '2026-04-18', stage: 'closed_won', owner: 'ann', amount: 60 },
  { id: 'd07', close_date: '2026-05-09', stage: 'lost', owner: 'bob', amount: 999 },
  { id: 'd08', close_date: '2026-06-23', stage: 'closed_won', owner: 'bob', amount: 70 },
  { id: 'd09', close_date: '2026-07-07', stage: 'closed_won', owner: 'ann', amount: 80 },
  { id: 'd10', close_date: '2026-09-30', stage: 'closed_won', owner: 'bob', amount: 90 },
  { id: 'd11', close_date: '2026-10-01', stage: 'closed_won', owner: 'ann', amount: 1 },
  { id: 'd12', close_date: '2026-10-02', stage: 'closed_won', owner: 'ann', amount: 2 },
  { id: 'd13', close_date: '2026-10-03', stage: 'closed_won', owner: 'bob', amount: 3 },
  { id: 'd14', close_date: '2026-10-06', stage: 'closed_won', owner: 'ann', amount: 6 },
  { id: 'd15', close_date: '2026-10-09', stage: 'closed_won', owner: 'ann', amount: 9 },
  { id: 'd16', close_date: '2026-10-10', stage: 'closed_won', owner: 'ann', amount: 10 },
] as const;

const WON = { stage: 'closed_won' };
const TWELVE_MONTHS: [string, string] = ['2025-11-01', '2026-10-31'];
const MONTHS = [
  '2025-11', '2025-12', '2026-01', '2026-02', '2026-03', '2026-04',
  '2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10',
];

const quiet = { debug() {}, info() {}, warn() {}, error() {}, child() { return quiet; } };
const CTX = { tenantId: 'org_default' } as ExecutionContext;

let engine: ObjectQL;
let analytics: AnalyticsService;

beforeAll(async () => {
  const driver = new SqliteWasmDriver({ filename: ':memory:' });
  engine = new ObjectQL({ logger: quiet } as any);
  engine.registerDriver(driver as any, true);
  await engine.init();
  engine.registry.registerObject(DEAL_OBJECT as any);
  await engine.syncSchemas();
  await installDefaultOrganization(engine);
  for (const deal of DEALS) await engine.insert(DEAL, { ...deal } as any);

  const registered: Record<string, unknown> = {};
  await new AnalyticsServicePlugin({} as any).init({
    getService: (name: string) => (name === 'data' ? engine : registered[name]),
    registerService: (name: string, svc: unknown) => { registered[name] = svc; },
    replaceService: (name: string, svc: unknown) => { registered[name] = svc; },
    hook: () => {},
    logger: quiet,
  } as never);
  analytics = registered.analytics as AnalyticsService;
});

afterAll(async () => {
  await (engine as any)?.destroy?.();
});

const run = (selection: DatasetSelection) => analytics.queryDataset!(DATASET, selection, CTX);
const series = (rows: Record<string, unknown>[], axis = 'close_date', measure = 'total_amount') =>
  rows.map((row) => [row[axis], row[measure] == null ? row[measure] : Number(row[measure])]);

describe('[#26893] a month series over a 12-month dateRange answers all twelve months', () => {
  it('the two empty months come back in order, with count/sum 0 and no avg', async () => {
    const res = await run({
      dimensions: ['close_date'],
      measures: ['opp_count', 'total_amount', 'avg_amount'],
      runtimeFilter: WON,
      timeDimensions: [{ dimension: 'close_date', dateRange: TWELVE_MONTHS }],
    });
    expect(res.rows.map((r) => r.close_date)).toEqual(MONTHS);
    const may = res.rows.find((r) => r.close_date === '2026-05')!;
    const aug = res.rows.find((r) => r.close_date === '2026-08')!;
    for (const empty of [may, aug]) {
      expect(empty.opp_count).toBe(0);
      expect(empty.total_amount).toBe(0);
      // An empty group's avg is left unset, not 0 (`emptyGroupValueFor`): the
      // invented bucket reads the same.
      expect(empty.avg_amount ?? null).toBeNull();
    }
    // A real bucket keeps its own numbers.
    expect(series(res.rows).find(([k]) => k === '2026-10')).toEqual(['2026-10', 31]);
  });

  it('a window wider than the data fills the edges too, and the response describes no new column', async () => {
    const res = await run({
      dimensions: ['close_date'],
      measures: ['total_amount'],
      runtimeFilter: WON,
      timeDimensions: [{ dimension: 'close_date', dateRange: ['2025-09-01', '2026-12-31'] }],
    });
    expect(res.rows.map((r) => r.close_date)).toEqual(['2025-09', '2025-10', ...MONTHS, '2026-11', '2026-12']);
    expect(res.fields.map((f) => f.name)).toEqual(['close_date', 'total_amount']);
  });

  it('a preset window is the one the query filtered by (this_year, frozen at 2026-10-15)', async () => {
    vi.useFakeTimers({ now: new Date('2026-10-15T12:00:00.000Z'), toFake: ['Date'] });
    try {
      const res = await run({
        dimensions: ['close_date'],
        measures: ['total_amount'],
        runtimeFilter: WON,
        timeDimensions: [{ dimension: 'close_date', dateRange: 'this_year' }],
      });
      expect(res.rows.map((r) => r.close_date)).toEqual([
        '2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06',
        '2026-07', '2026-08', '2026-09', '2026-10', '2026-11', '2026-12',
      ]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('a week axis spells its invented keys the way the grouping spells real ones, across a week-year', async () => {
    const res = await run({
      dimensions: ['close_date'],
      measures: ['opp_count'],
      dateGranularity: 'week',
      runtimeFilter: WON,
      timeDimensions: [{ dimension: 'close_date', dateRange: ['2025-12-01', '2026-01-25'] }],
    });
    // 2025-12-02 is 2025-W49 and 2026-01-20 is 2026-W04; Monday 2025-12-29 opens 2026-W01.
    expect(series(res.rows, 'close_date', 'opp_count')).toEqual([
      ['2025-W49', 1], ['2025-W50', 0], ['2025-W51', 0], ['2025-W52', 0],
      ['2026-W01', 0], ['2026-W02', 0], ['2026-W03', 0], ['2026-W04', 1],
    ]);
  });
});

describe('[#26893] with no dateRange, only the interior gaps are filled', () => {
  it('a day series with its 30-day window in runtimeFilter only: the gaps between the first and last day', async () => {
    const res = await run({
      dimensions: ['close_date'],
      measures: ['opp_count'],
      dateGranularity: 'day',
      runtimeFilter: { ...WON, close_date: { $gte: '2026-10-01', $lte: '2026-10-30' } },
    });
    // 11–30 October are past the last row: no seam reads a window out of a
    // filter, so they are not invented.
    expect(series(res.rows, 'close_date', 'opp_count')).toEqual([
      ['2026-10-01', 1], ['2026-10-02', 1], ['2026-10-03', 1], ['2026-10-04', 0], ['2026-10-05', 0],
      ['2026-10-06', 1], ['2026-10-07', 0], ['2026-10-08', 0], ['2026-10-09', 1], ['2026-10-10', 1],
    ]);
  });

  it('HotCRM\'s one-bound filter ({ $gte }) fills May and August, and invents no month before the first', async () => {
    const res = await run({
      dimensions: ['close_date'],
      measures: ['total_amount'],
      runtimeFilter: { ...WON, close_date: { $gte: '2026-03-01' } },
    });
    expect(series(res.rows)).toEqual([
      ['2026-03', 50], ['2026-04', 60], ['2026-05', 0], ['2026-06', 70],
      ['2026-07', 80], ['2026-08', 0], ['2026-09', 90], ['2026-10', 31],
    ]);
  });

  it('no window and no rows: no buckets', async () => {
    const res = await run({
      dimensions: ['close_date'],
      measures: ['total_amount'],
      runtimeFilter: { stage: 'no_such_stage' },
    });
    expect(res.rows).toEqual([]);
  });

  it('a window and no rows: the window\'s buckets, all empty', async () => {
    const res = await run({
      dimensions: ['close_date'],
      measures: ['opp_count'],
      runtimeFilter: { stage: 'no_such_stage' },
      timeDimensions: [{ dimension: 'close_date', dateRange: ['2026-01-01', '2026-03-31'] }],
    });
    expect(series(res.rows, 'close_date', 'opp_count')).toEqual([['2026-01', 0], ['2026-02', 0], ['2026-03', 0]]);
  });
});

describe('[#26893] another grid dimension: each combination that holds a row is filled once', () => {
  it('month × owner: both owners get every month; an owner no row holds is not invented', async () => {
    const res = await run({
      dimensions: ['close_date', 'owner'],
      measures: ['opp_count'],
      runtimeFilter: { ...WON, owner: { $in: ['ann', 'bob', 'nobody'] } },
      timeDimensions: [{ dimension: 'close_date', dateRange: ['2026-01-01', '2026-04-30'] }],
    });
    const cells = res.rows.map((r) => `${r.close_date}|${r.owner}|${r.opp_count}`).sort();
    expect(cells).toEqual([
      '2026-01|ann|1', '2026-01|bob|0',
      '2026-02|ann|0', '2026-02|bob|1',
      '2026-03|ann|1', '2026-03|bob|0',
      '2026-04|ann|1', '2026-04|bob|0',
    ]);
  });
});

describe('[#26893] a non-UTC zone: the fill writes the keys the query writes', () => {
  it('Asia/Shanghai, last_7_days frozen at 2026-03-06T20:00Z (already 7 March in Shanghai)', async () => {
    // 2026-03-04T17:30Z is 01:30 on 5 March in Shanghai: the query keys it
    // `2026-03-05`, and the fill must neither re-invent that day nor key the
    // window on the UTC calendar (which would end on the 6th).
    await engine.insert(DEAL, { id: 'tz1', closed_at: '2026-03-04T17:30:00.000Z', stage: 'tz_probe', owner: 'ann', amount: 5 } as any);
    vi.useFakeTimers({ now: new Date('2026-03-06T20:00:00.000Z'), toFake: ['Date'] });
    try {
      const res = await run({
        dimensions: ['closed_at'],
        measures: ['opp_count'],
        dateGranularity: 'day',
        timezone: 'Asia/Shanghai',
        runtimeFilter: { stage: 'tz_probe' },
        timeDimensions: [{ dimension: 'closed_at', dateRange: 'last_7_days' }],
      });
      expect(series(res.rows, 'closed_at', 'opp_count')).toEqual([
        ['2026-02-28', 0], ['2026-03-01', 0], ['2026-03-02', 0], ['2026-03-03', 0],
        ['2026-03-04', 0], ['2026-03-05', 1], ['2026-03-06', 0], ['2026-03-07', 0],
      ]);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('[#26893] controls — answers the fill must not change', () => {
  it('a fully populated window comes back exactly as grouped', async () => {
    const res = await run({
      dimensions: ['close_date'],
      measures: ['total_amount'],
      runtimeFilter: WON,
      timeDimensions: [{ dimension: 'close_date', dateRange: ['2026-01-01', '2026-04-30'] }],
    });
    expect(series(res.rows)).toEqual([['2026-01', 30], ['2026-02', 40], ['2026-03', 50], ['2026-04', 60]]);
  });

  it('a top-N (limit + order on a measure) picks from the real buckets only', async () => {
    const res = await run({
      dimensions: ['close_date'],
      measures: ['total_amount'],
      runtimeFilter: WON,
      timeDimensions: [{ dimension: 'close_date', dateRange: TWELVE_MONTHS }],
      order: { total_amount: 'asc' },
      limit: 3,
    });
    expect(series(res.rows)).toEqual([['2025-11', 10], ['2025-12', 20], ['2026-01', 30]]);
  });

  it('an order on a measure without a limit is not filled either', async () => {
    const res = await run({
      dimensions: ['close_date'],
      measures: ['total_amount'],
      runtimeFilter: WON,
      timeDimensions: [{ dimension: 'close_date', dateRange: TWELVE_MONTHS }],
      order: { total_amount: 'desc' },
    });
    expect(res.rows).toHaveLength(10);
    expect(res.rows.map((r) => r.close_date)).not.toContain('2026-05');
  });

  it('a limit alone is not filled', async () => {
    const res = await run({
      dimensions: ['close_date'],
      measures: ['total_amount'],
      runtimeFilter: WON,
      timeDimensions: [{ dimension: 'close_date', dateRange: TWELVE_MONTHS }],
      limit: 6,
    });
    expect(res.rows.map((r) => r.close_date)).toEqual(['2025-11', '2025-12', '2026-01', '2026-02', '2026-03', '2026-04']);
  });

  it('a query with no time dimension is unchanged', async () => {
    const res = await run({ dimensions: ['owner'], measures: ['opp_count'], runtimeFilter: WON });
    expect(res.rows.map((r) => `${r.owner}|${r.opp_count}`).sort()).toEqual(['ann|10', 'bob|5']);
  });

  it(`a fill past ${MAX_ZERO_FILLED_GRID_ROWS} rows does not run at all — never a partial fill`, async () => {
    const res = await run({
      dimensions: ['close_date'],
      measures: ['opp_count'],
      dateGranularity: 'day',
      runtimeFilter: WON,
      timeDimensions: [{ dimension: 'close_date', dateRange: ['2017-01-01', '2026-12-31'] }],
    });
    expect(res.rows).toHaveLength(DEALS.filter((d) => d.stage === 'closed_won').length);
  });
});

describe('[#27111] compareTo: a bucket empty in both windows is filled, over the primary window', () => {
  it('May–August vs the previous year: May and August come back, with 0 in the measure and in its __compare', async () => {
    const res = await run({
      dimensions: ['close_date'],
      measures: ['opp_count', 'total_amount', 'avg_amount'],
      runtimeFilter: WON,
      timeDimensions: [{ dimension: 'close_date', dateRange: ['2026-05-01', '2026-08-31'] }],
      compareTo: { kind: 'previousYear' },
    });
    // 2025-05..08 holds no deal, and 2026 holds June and July only.
    expect(series(res.rows)).toEqual([['2026-05', 0], ['2026-06', 70], ['2026-07', 80], ['2026-08', 0]]);
    expect(res.rows.map((r) => r.total_amount__compare)).toEqual([0, 0, 0, 0]);
    for (const month of ['2026-05', '2026-08']) {
      const row = res.rows.find((r) => r.close_date === month)!;
      expect(row.opp_count).toBe(0);
      expect(row.opp_count__compare).toBe(0);
      // avg is an absent key on both sides, the way an empty group reads it.
      expect('avg_amount' in row).toBe(false);
      expect('avg_amount__compare' in row).toBe(false);
    }
  });
});

/**
 * A compare-only fixture, its own stage: March–August 2026 against
 * March–August 2025, one month in each of the four states.
 *
 * | month | 2026 (primary) | 2025 (compare) |
 * |:--|:--|:--|
 * | 03 | 1 deal | 1 deal |
 * | 04 | 1 deal | — |
 * | 05 | — | 1 deal |
 * | 06 | — | — |
 * | 07 | 1 deal | — |
 * | 08 | — | — |
 *
 * `closed_at` dates the same deals for the window-only anchor case: 2026's
 * deals close in 2026 and 2025's in 2025, so anchoring on `closed_at` while
 * the grid buckets `close_date` gives a series with no axis window.
 */
const CMP = { stage: 'cmp_probe' };
const CMP_DEALS = [
  { id: 'c1', close_date: '2026-03-10', closed_at: '2026-03-10T12:00:00.000Z', amount: 4 },
  { id: 'c2', close_date: '2026-04-10', closed_at: '2026-04-10T12:00:00.000Z', amount: 8 },
  { id: 'c3', close_date: '2026-07-10', closed_at: '2026-07-10T12:00:00.000Z', amount: 16 },
  { id: 'c4', close_date: '2025-03-10', closed_at: '2025-03-10T12:00:00.000Z', amount: 1 },
  { id: 'c5', close_date: '2025-05-10', closed_at: '2025-05-10T12:00:00.000Z', amount: 2 },
];
const CMP_WINDOW: [string, string] = ['2026-03-01', '2026-08-31'];
const cells = (rows: Record<string, unknown>[]) =>
  rows.map((r) => `${r.close_date}|${r.opp_count}|${r.opp_count__compare}`);

describe('[#27111] compareTo: only the both-empty buckets are added; every other answer is unchanged', () => {
  beforeAll(async () => {
    for (const deal of CMP_DEALS) await engine.insert(DEAL, { ...deal, ...CMP, owner: 'ann' } as any);
  });

  it('a bucket either window holds keeps the merge\'s values; June and August are added at 0 / 0', async () => {
    const res = await run({
      dimensions: ['close_date'],
      measures: ['opp_count', 'total_amount'],
      runtimeFilter: CMP,
      timeDimensions: [{ dimension: 'close_date', dateRange: CMP_WINDOW }],
      compareTo: { kind: 'previousYear' },
    });
    expect(cells(res.rows)).toEqual([
      '2026-03|1|1', '2026-04|1|0', '2026-05|0|1', '2026-06|0|0', '2026-07|1|0', '2026-08|0|0',
    ]);
    expect(res.rows.map((r) => [r.total_amount, r.total_amount__compare].map(Number))).toEqual([
      [4, 1], [8, 0], [0, 2], [0, 0], [16, 0], [0, 0],
    ]);
  });

  it('the primary columns are the plain series\' answer: one fill rule', async () => {
    const selection: DatasetSelection = {
      dimensions: ['close_date'],
      measures: ['opp_count', 'total_amount'],
      runtimeFilter: CMP,
      timeDimensions: [{ dimension: 'close_date', dateRange: CMP_WINDOW }],
    };
    const plain = await run(selection);
    const compared = await run({ ...selection, compareTo: { kind: 'previousYear' } });
    const primary = (rows: Record<string, unknown>[]) =>
      rows.map((r) => [r.close_date, r.opp_count, Number(r.total_amount)]);
    expect(primary(compared.rows)).toEqual(primary(plain.rows));
    expect(plain.rows.map((r) => r.close_date)).toEqual([
      '2026-03', '2026-04', '2026-05', '2026-06', '2026-07', '2026-08',
    ]);
  });

  it('previousPeriod aligns by ordinal and fills the same way', async () => {
    // June–August 2026 against March–May 2026: 03↔06, 04↔07, 05↔08.
    const res = await run({
      dimensions: ['close_date'],
      measures: ['opp_count'],
      runtimeFilter: CMP,
      timeDimensions: [{ dimension: 'close_date', dateRange: ['2026-06-01', '2026-08-31'] }],
      compareTo: { kind: 'previousPeriod' },
    });
    expect(cells(res.rows)).toEqual(['2026-06|0|1', '2026-07|1|1', '2026-08|0|0']);
  });

  it('an axis with no dateRange of its own (a window-only anchor) fills interior gaps only, no edges', async () => {
    const res = await run({
      dimensions: ['close_date'],
      measures: ['opp_count'],
      runtimeFilter: CMP,
      timeDimensions: [{ dimension: 'closed_at', dateRange: ['2026-01-01', '2026-12-31'] }],
      compareTo: { kind: 'previousYear', dimension: 'closed_at' },
    });
    // The anchor is not a grid column, so the comparison rows key by their
    // own close_date (2025-03, 2025-05). Between the first and last bucket
    // the grid holds, every month; nothing before 2025-03 or after 2026-07.
    expect(cells(res.rows)).toEqual([
      '2025-03|0|1', '2025-04|0|0', '2025-05|0|1', '2025-06|0|0', '2025-07|0|0', '2025-08|0|0',
      '2025-09|0|0', '2025-10|0|0', '2025-11|0|0', '2025-12|0|0', '2026-01|0|0', '2026-02|0|0',
      '2026-03|1|0', '2026-04|1|0', '2026-05|0|0', '2026-06|0|0', '2026-07|1|0',
    ]);
  });

  it('a limit with compareTo is not filled', async () => {
    const res = await run({
      dimensions: ['close_date'],
      measures: ['opp_count'],
      runtimeFilter: CMP,
      timeDimensions: [{ dimension: 'close_date', dateRange: CMP_WINDOW }],
      compareTo: { kind: 'previousYear' },
      limit: 10,
    });
    expect(cells(res.rows)).toEqual(['2026-03|1|1', '2026-04|1|0', '2026-05|0|1', '2026-07|1|0']);
  });

  it('an order on a __compare column is not filled', async () => {
    const res = await run({
      dimensions: ['close_date'],
      measures: ['opp_count'],
      runtimeFilter: CMP,
      timeDimensions: [{ dimension: 'close_date', dateRange: CMP_WINDOW }],
      compareTo: { kind: 'previousYear' },
      order: { opp_count__compare: 'desc' },
    });
    expect(res.rows.map((r) => r.close_date).sort()).toEqual(['2026-03', '2026-04', '2026-05', '2026-07']);
  });
});

describe('[#26893] fillEmptyTimeBuckets — the walk itself', () => {
  const plan = { axis: 'm', granularity: 'month' as const, dimensions: ['m'] };

  it('leaves the null bucket where it is and fills around it', () => {
    const rows = [{ m: '2026-01', n: 1 }, { m: null, n: 4 }, { m: '2026-03', n: 2 }];
    fillEmptyTimeBuckets(rows, plan);
    expect(rows.map((r) => r.m)).toEqual(['2026-01', null, '2026-03', '2026-02']);
  });

  it('declines a key that is not a bucket key of the plan\'s granularity', () => {
    const rows = [{ m: '2026-01-15T10:00:00.000Z' }, { m: '2026-03' }];
    expect(fillEmptyTimeBuckets(rows, plan)).toHaveLength(2);
  });

  it('invents no row it already holds (one-row series, no window)', () => {
    const rows = [{ m: '2026-01' }];
    expect(fillEmptyTimeBuckets(rows, plan)).toEqual([{ m: '2026-01' }]);
  });

  it('declines at the bound, and runs just under it', () => {
    const day = { axis: 'd', granularity: 'day' as const, dimensions: ['d'] };
    // 2,000 days from 2020-01-01 is 2025-06-22 inclusive; one more is past the bound.
    const under = fillEmptyTimeBuckets([], { ...day, window: ['2020-01-01', '2025-06-22'] });
    expect(under).toHaveLength(MAX_ZERO_FILLED_GRID_ROWS);
    expect(fillEmptyTimeBuckets([], { ...day, window: ['2020-01-01', '2025-06-23'] })).toEqual([]);
  });
});
