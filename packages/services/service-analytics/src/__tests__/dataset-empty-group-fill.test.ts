// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Empty-group fill (#4708, objectui#3136).
 *
 * A measure carrying its own `filter` runs as a separate grouped sub-query and
 * is merged back by dimension key. A `GROUP BY` over a filtered row set emits
 * NO group for a dimension value the filter excludes entirely, so the measure
 * comes back ABSENT rather than `0` — and a derived ratio over an absent
 * operand goes null, so the cell renders blank: visually identical to "no data
 * for this row", which is the opposite of what the row means.
 *
 * The bias is what makes it worth a dedicated suite: the rows that blank are
 * exactly the WORST-performing ones (nothing matched the numerator's filter),
 * while a row that matched everything renders fine. A dashboard that hides its
 * worst rows and shows its best is the least acceptable direction for the
 * error to run, so `renders the worst row …` below asserts the asymmetry
 * directly rather than only the individual cells.
 *
 * The fill is strictly by aggregate kind — over-filling would trade this lie
 * for its mirror image (an `avg` of nothing reported as 0 is a measurement
 * nobody made), so `does NOT fill avg/min/max` pins the other side.
 */

import { describe, it, expect, vi } from 'vitest';
import type { IAnalyticsService, AnalyticsQuery, AnalyticsResult } from '@objectstack/spec/contracts';
import { DatasetSchema } from '@objectstack/spec/ui';
import { compileDataset } from '../dataset-compiler.js';
import { DatasetExecutor, fillEmptyGroups } from '../dataset-executor.js';

function fakeService(handler: (q: AnalyticsQuery) => AnalyticsResult): IAnalyticsService {
  return { query: vi.fn(async (q: AnalyticsQuery) => handler(q)), getMeta: async () => [] };
}

// ── the issue's reproduction, verbatim (hotcrm#593 / hotcrm#656) ─────────────

const winRate = DatasetSchema.parse({
  name: 'pipeline', label: 'Pipeline', object: 'opportunity',
  dimensions: [{ name: 'lead_source', field: 'lead_source', type: 'string' }],
  measures: [
    { name: 'won_count', aggregate: 'count', filter: { stage: 'closed_won' } },
    { name: 'lost_count', aggregate: 'count', filter: { stage: 'closed_lost' } },
    { name: 'decided_count', aggregate: 'count', filter: { stage: { $in: ['closed_won', 'closed_lost'] } } },
    { name: 'win_rate', derived: { op: 'ratio', of: ['won_count', 'decided_count'] } },
  ],
});

/**
 * The four lead sources of the issue's table. Each sub-query returns only the
 * groups its filter left non-empty — which is what a real `GROUP BY` does:
 *   - `partner` won everything      → absent from the `lost_count` result
 *   - `cold_call` won nothing       → absent from the `won_count` result
 */
const winRateService = fakeService((q) => {
  switch (q.measures[0]) {
    case 'won_count':
      return { rows: [
        { lead_source: 'content', won_count: 2 },
        { lead_source: 'referral', won_count: 1 },
        { lead_source: 'partner', won_count: 1 },
      ], fields: [] };
    case 'lost_count':
      return { rows: [
        { lead_source: 'content', lost_count: 1 },
        { lead_source: 'referral', lost_count: 1 },
        { lead_source: 'cold_call', lost_count: 1 },
      ], fields: [] };
    case 'decided_count':
      return { rows: [
        { lead_source: 'content', decided_count: 3 },
        { lead_source: 'referral', decided_count: 2 },
        { lead_source: 'partner', decided_count: 1 },
        { lead_source: 'cold_call', decided_count: 1 },
      ], fields: [] };
    default:
      return { rows: [], fields: [] };
  }
});

const runWinRate = () =>
  new DatasetExecutor(winRateService).execute(compileDataset(winRate), {
    dimensions: ['lead_source'],
    measures: ['won_count', 'lost_count', 'decided_count', 'win_rate'],
  });

describe('empty-group fill — a filtered count that matched nothing (#4708)', () => {
  it('reports 0 (not blank) for the group its filter excluded, so the ratio computes', async () => {
    const rows = (await runWinRate()).rows;
    const cold = rows.find((r) => r.lead_source === 'cold_call')!;
    // cold_call won nothing and lost one. The correct answer is 0%, not blank.
    expect(cold.won_count).toBe(0);
    expect(cold.decided_count).toBe(1);
    expect(cold.win_rate).toBe(0);
  });

  it('fills the mirror gap too — a source that never lost reads 0 losses', async () => {
    const rows = (await runWinRate()).rows;
    expect(rows.find((r) => r.lead_source === 'partner')).toMatchObject({
      won_count: 1, lost_count: 0, decided_count: 1, win_rate: 1,
    });
  });

  it('renders the worst row exactly as legibly as the best one (the asymmetry)', async () => {
    const rows = (await runWinRate()).rows;
    // The defect's signature: `partner` (won everything) rendered fine while
    // `cold_call` (won nothing) rendered blank — the dashboard hid its worst
    // row. No row may come back with an unmeasured cell.
    for (const row of rows) {
      expect(row.win_rate, `win_rate blank for ${row.lead_source}`).not.toBeNull();
      expect(row.win_rate).toEqual(expect.any(Number));
      for (const m of ['won_count', 'lost_count', 'decided_count']) {
        expect(row[m], `${m} blank for ${row.lead_source}`).toEqual(expect.any(Number));
      }
    }
    // …and the worst row is the one the reader must be able to act on.
    const byRate = [...rows].sort((a, b) => Number(a.win_rate) - Number(b.win_rate));
    expect(byRate[0]).toMatchObject({ lead_source: 'cold_call', win_rate: 0 });
    expect(byRate[byRate.length - 1]).toMatchObject({ lead_source: 'partner', win_rate: 1 });
  });

  it('invents no group — a dimension value no query reported stays out of the grid', async () => {
    const rows = (await runWinRate()).rows;
    // Only the four sources some sub-query actually returned. `webinar` has no
    // opportunities at all, so it is absent from every result and must not be
    // materialised as a row of zeroes.
    expect(rows.map((r) => r.lead_source).sort()).toEqual(['cold_call', 'content', 'partner', 'referral']);
  });
});

// ── the other side: aggregates with no answer over an empty set ──────────────

const amounts = DatasetSchema.parse({
  name: 'deals', label: 'Deals', object: 'opportunity',
  dimensions: [{ name: 'lead_source', field: 'lead_source', type: 'string' }],
  measures: [
    { name: 'won_count', aggregate: 'count', filter: { stage: 'closed_won' } },
    { name: 'won_total', aggregate: 'sum', field: 'amount', filter: { stage: 'closed_won' } },
    { name: 'won_avg', aggregate: 'avg', field: 'amount', filter: { stage: 'closed_won' } },
    { name: 'won_min', aggregate: 'min', field: 'amount', filter: { stage: 'closed_won' } },
    { name: 'won_max', aggregate: 'max', field: 'amount', filter: { stage: 'closed_won' } },
    { name: 'all_count', aggregate: 'count' },
  ],
});

describe('empty-group fill — strictly by aggregate kind (#4708)', () => {
  it('does NOT fill avg/min/max: nothing to average over an empty group', async () => {
    const svc = fakeService((q) => {
      if (q.measures.includes('all_count')) {
        return { rows: [
          { lead_source: 'content', all_count: 4 },
          { lead_source: 'cold_call', all_count: 1 },
        ], fields: [] };
      }
      // every won_* sub-query: cold_call won nothing, so no group for it
      const m = q.measures[0];
      return { rows: [{ lead_source: 'content', [m]: 7 }], fields: [] };
    });
    const res = await new DatasetExecutor(svc).execute(compileDataset(amounts), {
      dimensions: ['lead_source'],
      measures: ['all_count', 'won_count', 'won_total', 'won_avg', 'won_min', 'won_max'],
    });
    const cold = res.rows.find((r) => r.lead_source === 'cold_call')!;
    // Measured facts: no rows matched, so the count is 0 and the sum is 0.
    expect(cold.won_count).toBe(0);
    expect(cold.won_total).toBe(0);
    // Genuinely unknown — filling these would report a measurement nobody made
    // ("average deal size 0" is a different claim from "no deals").
    for (const m of ['won_avg', 'won_min', 'won_max']) {
      expect(cold[m] ?? null, `${m} must stay null`).toBeNull();
      expect(cold[m], `${m} must not be flattened to 0`).not.toBe(0);
    }
    // The group that did have data is untouched.
    expect(res.rows.find((r) => r.lead_source === 'content')).toMatchObject({
      won_count: 7, won_total: 7, won_avg: 7, won_min: 7, won_max: 7,
    });
  });
});

// ── the compareTo seam: rows APPENDED by the comparison merge ────────────────

const compareDs = DatasetSchema.parse({
  name: 'trend', label: 'Trend', object: 'opportunity',
  dimensions: [
    { name: 'lead_source', field: 'lead_source', type: 'string' },
    { name: 'close_date', field: 'close_date', type: 'date' },
  ],
  measures: [
    { name: 'revenue', aggregate: 'sum', field: 'amount' },
    { name: 'avg_deal', aggregate: 'avg', field: 'amount' },
    { name: 'won_count', aggregate: 'count', filter: { stage: 'closed_won' } },
  ],
});

describe('empty-group fill — buckets the comparison window added (#4708)', () => {
  it('fills every base measure on a row only the previous period produced', async () => {
    const svc = fakeService((q) => {
      const shifted = JSON.stringify(q.timeDimensions ?? []).includes('2025-12');
      if (shifted) {
        return { rows: [
          { lead_source: 'content', revenue: 80, avg_deal: 40, won_count: 2 },
          { lead_source: 'cold_call', revenue: 10, avg_deal: 10, won_count: 1 },
        ], fields: [] };
      }
      if (q.measures.includes('won_count')) {
        return { rows: [{ lead_source: 'content', won_count: 3 }], fields: [] };
      }
      // this period, `cold_call` has no opportunities at all
      return { rows: [{ lead_source: 'content', revenue: 100, avg_deal: 50 }], fields: [] };
    });
    const res = await new DatasetExecutor(svc).execute(compileDataset(compareDs), {
      dimensions: ['lead_source'],
      measures: ['revenue', 'avg_deal', 'won_count'],
      timeDimensions: [{ dimension: 'close_date', dateRange: ['2026-01-01', '2026-01-31'] }],
      compareTo: { kind: 'previousPeriod', dimension: 'close_date' },
    });
    const cold = res.rows.find((r) => r.lead_source === 'cold_call')!;
    // The row exists because the comparison window had data for it; "how much
    // did cold_call sell this period" therefore has an exact answer — none.
    // Before #4708 the fill ran BEFORE this merge, so all three read blank.
    expect(cold.revenue).toBe(0);
    expect(cold.won_count).toBe(0);
    expect(cold.avg_deal ?? null).toBeNull();
    // the comparison columns are untouched — they were reported
    expect(cold).toMatchObject({ revenue__compare: 10, won_count__compare: 1 });
  });

  it('fills a comparison column the previous window never reported', async () => {
    const svc = fakeService((q) => {
      const shifted = JSON.stringify(q.timeDimensions ?? []).includes('2025-12');
      // the previous period knew nothing of `content`
      if (shifted) return { rows: [], fields: [] };
      if (q.measures.includes('won_count')) {
        return { rows: [{ lead_source: 'content', won_count: 3 }], fields: [] };
      }
      return { rows: [{ lead_source: 'content', revenue: 100, avg_deal: 50 }], fields: [] };
    });
    const res = await new DatasetExecutor(svc).execute(compileDataset(compareDs), {
      dimensions: ['lead_source'],
      measures: ['revenue', 'avg_deal', 'won_count'],
      timeDimensions: [{ dimension: 'close_date', dateRange: ['2026-01-01', '2026-01-31'] }],
      compareTo: { kind: 'previousPeriod', dimension: 'close_date' },
    });
    expect(res.rows[0]).toMatchObject({
      revenue: 100, won_count: 3,
      // "sold nothing last month" — a fact, not a gap
      revenue__compare: 0, won_count__compare: 0,
    });
    expect(res.rows[0].avg_deal__compare ?? null).toBeNull();
  });
});

// ── the helper in isolation ─────────────────────────────────────────────────

describe('fillEmptyGroups', () => {
  it('fills count/count_distinct/sum, leaves avg/min/max and reported values alone', () => {
    const rows = [
      { g: 'a', c: 2, d: 1, s: 5, avg: 2.5, min: 1, max: 4 },
      { g: 'b' },
    ];
    fillEmptyGroups(rows, {
      c: 'count', d: 'count_distinct', s: 'sum', avg: 'avg', min: 'min', max: 'max',
      unknown: undefined,
    });
    expect(rows[0]).toEqual({ g: 'a', c: 2, d: 1, s: 5, avg: 2.5, min: 1, max: 4 });
    expect(rows[1]).toEqual({ g: 'b', c: 0, d: 0, s: 0 });
  });

  it('touches only the columns it is given, and never adds rows', () => {
    const rows = [{ g: 'a' }];
    expect(fillEmptyGroups(rows, { c: 'count' })).toHaveLength(1);
    expect(rows[0]).toEqual({ g: 'a', c: 0 });
  });
});
