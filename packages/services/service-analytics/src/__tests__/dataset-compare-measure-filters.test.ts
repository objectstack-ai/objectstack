// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `compareTo` honours measure-scoped filters (#4820).
 *
 * A measure declared with its own `filter` runs as a supplementary grouped
 * sub-query in the current period. The comparison pass used to issue ONE
 * shifted query over every base measure with only the base filter, never
 * reading `compiled.measureFilters` — so `won_count` counted won deals and
 * `won_count__compare` counted every deal, side by side under one label.
 *
 * Two properties are pinned here, and the second is the one that matters:
 *
 *  1. **Shape** — the shifted pass fans out exactly like the primary one, and
 *     the shifted sub-query for a filtered measure carries that measure's
 *     filter.
 *  2. **The number the reader sees** — a shape assertion cannot tell a correct
 *     comparison from a plausible-looking wrong one, so the fake service below
 *     is a tiny in-memory database: it evaluates `where` and the `dateRange`
 *     against seed rows and groups them for real. Drop the measure filter on
 *     the shifted query and the number CHANGES (1 → 5), because the rows the
 *     filter excludes are really there.
 *
 * The seed is chosen so the defect's signature is unmistakable: `revenue` is
 * flat at 300 in both windows while won deals went 1 → 3. The bug rendered
 * that as 3 vs 5 — a collapse, in the period a rep tripled their wins.
 */

import { describe, it, expect, vi } from 'vitest';
import type { IAnalyticsService, AnalyticsQuery, AnalyticsResult } from '@objectstack/spec/contracts';
import { DatasetSchema } from '@objectstack/spec/ui';
import { compileDataset } from '../dataset-compiler.js';
import { DatasetExecutor, splitMeasuresByFilter } from '../dataset-executor.js';

// ── a fake service that actually filters and groups ─────────────────────────

interface Opp {
  lead_source: string;
  region: string;
  stage: string;
  amount: number;
  close_date: string;
}

/**
 * January 2026 (the selected window) vs December 2025 (`previousPeriod`).
 *
 * `content`: 3 won deals now; 1 won + 4 lost then. Revenue is deliberately
 * IDENTICAL across the two windows (300 = 3×100 = 100 + 4×50), so the only
 * thing that can move `won_count__compare` is whether the measure's filter
 * reached the shifted query.
 *
 * `cold_call`: sold last month, won nothing then, and has no opportunities at
 * all this month — the group a filtered sub-query legitimately never emits.
 */
const OPPS: Opp[] = [
  { lead_source: 'content', region: 'NA', stage: 'closed_won', amount: 100, close_date: '2026-01-05' },
  { lead_source: 'content', region: 'NA', stage: 'closed_won', amount: 100, close_date: '2026-01-12' },
  { lead_source: 'content', region: 'NA', stage: 'closed_won', amount: 100, close_date: '2026-01-20' },

  { lead_source: 'content', region: 'NA', stage: 'closed_won', amount: 100, close_date: '2025-12-03' },
  { lead_source: 'content', region: 'NA', stage: 'closed_lost', amount: 50, close_date: '2025-12-07' },
  { lead_source: 'content', region: 'NA', stage: 'closed_lost', amount: 50, close_date: '2025-12-11' },
  { lead_source: 'content', region: 'NA', stage: 'closed_lost', amount: 50, close_date: '2025-12-19' },
  { lead_source: 'content', region: 'NA', stage: 'closed_lost', amount: 50, close_date: '2025-12-28' },

  { lead_source: 'cold_call', region: 'NA', stage: 'closed_lost', amount: 20, close_date: '2025-12-09' },
  { lead_source: 'cold_call', region: 'NA', stage: 'closed_lost', amount: 20, close_date: '2025-12-15' },
];

/** How each measure name aggregates — the fake's stand-in for the SQL switch. */
const AGGREGATE: Record<string, { kind: 'sum' | 'count'; field?: keyof Opp }> = {
  revenue: { kind: 'sum', field: 'amount' },
  won_count: { kind: 'count' },
  deal_count: { kind: 'count' },
};

/** Enough of the MongoDB-style filter grammar for these datasets. */
function matches(row: Opp, filter: unknown): boolean {
  if (filter == null || typeof filter !== 'object') return true;
  for (const [key, cond] of Object.entries(filter as Record<string, unknown>)) {
    if (key === '$and') {
      if (!(cond as unknown[]).every((c) => matches(row, c))) return false;
      continue;
    }
    const value = (row as unknown as Record<string, unknown>)[key];
    if (cond != null && typeof cond === 'object' && !Array.isArray(cond)) {
      const ops = cond as Record<string, unknown>;
      if ('$ne' in ops && value === ops.$ne) return false;
      if ('$in' in ops && !(ops.$in as unknown[]).includes(value)) return false;
      continue;
    }
    if (value !== cond) return false;
  }
  return true;
}

/**
 * Group `OPPS` the way a real `GROUP BY` would: rows excluded by `where` (or
 * by the `dateRange` window) contribute nothing, and a dimension value left
 * with no matching rows produces NO group at all.
 */
function runQuery(q: AnalyticsQuery): AnalyticsResult {
  const range = (q.timeDimensions ?? [])[0]?.dateRange as [string, string] | undefined;
  const dims = q.dimensions ?? [];
  const groups = new Map<string, { row: Record<string, unknown>; matched: Opp[] }>();
  for (const opp of OPPS) {
    if (range && (opp.close_date < range[0] || opp.close_date > range[1])) continue;
    if (!matches(opp, q.where)) continue;
    // Keyed unambiguously on purpose: `mergeByDimensions` concatenates its own
    // key with no delimiter (#4821, filed separately and deliberately NOT
    // touched here), and this fake must not import that ambiguity — a test that
    // measured two defects at once could not tell which one it caught.
    const key = dims
      .map((d) => JSON.stringify((opp as unknown as Record<string, unknown>)[d] ?? null))
      .join('|');
    let group = groups.get(key);
    if (!group) {
      group = {
        row: Object.fromEntries(dims.map((d) => [d, (opp as unknown as Record<string, unknown>)[d]])),
        matched: [],
      };
      groups.set(key, group);
    }
    group.matched.push(opp);
  }
  const rows = [...groups.values()].map(({ row, matched }) => {
    for (const m of q.measures) {
      const spec = AGGREGATE[m];
      if (!spec) throw new Error(`fake service: no aggregate declared for measure "${m}"`);
      row[m] = spec.kind === 'count'
        ? matched.length
        : matched.reduce((acc, o) => acc + Number(o[spec.field!]), 0);
    }
    return row;
  });
  return { rows, fields: [] };
}

function recordingService(): { service: IAnalyticsService; seen: AnalyticsQuery[] } {
  const seen: AnalyticsQuery[] = [];
  const service: IAnalyticsService = {
    query: vi.fn(async (q: AnalyticsQuery) => {
      seen.push(q);
      return runQuery(q);
    }),
    getMeta: async () => [],
  };
  return { service, seen };
}

const isShifted = (q: AnalyticsQuery) => JSON.stringify(q.timeDimensions ?? []).includes('2025-12');

// ── the issue's dataset, verbatim ───────────────────────────────────────────

const pipeline = DatasetSchema.parse({
  name: 'pipeline', label: 'Pipeline', object: 'opportunity',
  dimensions: [
    { name: 'lead_source', field: 'lead_source', type: 'string' },
    { name: 'close_date', field: 'close_date', type: 'date' },
  ],
  measures: [
    { name: 'revenue', aggregate: 'sum', field: 'amount' },
    { name: 'won_count', aggregate: 'count', filter: { stage: 'closed_won' } },
  ],
});

const selection = {
  dimensions: ['lead_source'],
  measures: ['revenue', 'won_count'],
  timeDimensions: [{ dimension: 'close_date', dateRange: ['2026-01-01', '2026-01-31'] as [string, string] }],
  compareTo: { kind: 'previousPeriod' as const, dimension: 'close_date' },
};

async function runPipeline() {
  const { service, seen } = recordingService();
  const res = await new DatasetExecutor(service).execute(compileDataset(pipeline), selection);
  return { rows: res.rows, seen };
}

describe('compareTo — the shifted pass applies measure-scoped filters (#4820)', () => {
  it('sends the measure filter with the shifted sub-query for that measure', async () => {
    const { seen } = await runPipeline();
    const shifted = seen.filter(isShifted);

    // Two shifted queries, mirroring the primary pass: unfiltered measures in
    // one, `won_count` in its own. The defect's signature was a SINGLE shifted
    // query naming both measures.
    expect(shifted).toHaveLength(2);
    expect(shifted.some((q) => q.measures.length > 1)).toBe(false);

    const shiftedWon = shifted.find((q) => q.measures.includes('won_count'))!;
    expect(shiftedWon.measures).toEqual(['won_count']);
    // The whole issue in one assertion: query #3 used to have no `where` at all.
    expect(shiftedWon.where).toEqual({ stage: 'closed_won' });
    expect(shiftedWon.timeDimensions![0].dateRange).toEqual(['2025-12-01', '2025-12-31']);
  });

  it('does NOT leak that filter onto the unfiltered measure', async () => {
    const { seen } = await runPipeline();
    const shiftedRevenue = seen.filter(isShifted).find((q) => q.measures.includes('revenue'))!;
    expect(shiftedRevenue.measures).toEqual(['revenue']);
    expect(JSON.stringify(shiftedRevenue.where ?? null)).not.toContain('closed_won');
  });

  it('reports the NUMBER the column beside it means — 1 won deal, not 5 deals', async () => {
    const { rows } = await runPipeline();
    const content = rows.find((r) => r.lead_source === 'content')!;

    // December really held 5 opportunities for `content`, of which 1 was won.
    // Unfiltered, the comparison reads 5 — a number that exists, looks
    // plausible, and answers a question nobody asked.
    expect(content.won_count__compare).toBe(1);
    expect(content.won_count__compare, 'the unfiltered count of the previous window').not.toBe(5);

    // Revenue is flat across both windows by construction, so nothing but the
    // measure filter can explain a difference here.
    expect(content).toMatchObject({ revenue: 300, revenue__compare: 300, won_count: 3 });
  });

  it('shows growth as growth — the defect inverted the direction of the tile', async () => {
    const { rows } = await runPipeline();
    const content = rows.find((r) => r.lead_source === 'content')!;
    // 3 won this month vs 1 last month. Against the unfiltered 5 this rendered
    // as a 40% collapse, in the period the wins tripled.
    expect(Number(content.won_count)).toBeGreaterThan(Number(content.won_count__compare));
    const delta = Number(content.won_count) - Number(content.won_count__compare);
    expect(delta).toBe(2);
  });

  it('fills a comparison group the measure filter emptied, rather than blanking it (#4708 seam)', async () => {
    const { rows } = await runPipeline();
    // `cold_call` sold last month and won nothing, so the shifted `won_count`
    // sub-query emits no group for it — the same absence #4708 fills, now
    // reachable on the comparison pass too because it fans out at all.
    const cold = rows.find((r) => r.lead_source === 'cold_call')!;
    expect(cold).toMatchObject({
      revenue__compare: 40,
      won_count__compare: 0,
      // nothing at all this month — a fact, and 0 for both aggregates
      revenue: 0,
      won_count: 0,
    });
    expect(cold.won_count__compare ?? null).not.toBeNull();
  });
});

// ── the primary path must not change ────────────────────────────────────────

const unfilteredOnly = DatasetSchema.parse({
  name: 'trend', label: 'Trend', object: 'opportunity',
  filter: { is_deleted: { $ne: true } },
  dimensions: [
    { name: 'lead_source', field: 'lead_source', type: 'string' },
    { name: 'close_date', field: 'close_date', type: 'date' },
  ],
  measures: [
    { name: 'revenue', aggregate: 'sum', field: 'amount' },
    { name: 'deal_count', aggregate: 'count' },
  ],
});

describe('compareTo — measures WITHOUT a filter still compare in one query', () => {
  it('issues exactly two queries and shifts the base filter unchanged', async () => {
    const { service, seen } = recordingService();
    const res = await new DatasetExecutor(service).execute(compileDataset(unfilteredOnly), {
      dimensions: ['lead_source'],
      measures: ['revenue', 'deal_count'],
      timeDimensions: [{ dimension: 'close_date', dateRange: ['2026-01-01', '2026-01-31'] }],
      compareTo: { kind: 'previousPeriod', dimension: 'close_date' },
    });

    // No fan-out when nothing is filter-scoped: one current, one shifted.
    expect(seen).toHaveLength(2);
    const shifted = seen.filter(isShifted);
    expect(shifted).toHaveLength(1);
    expect(shifted[0].measures).toEqual(['revenue', 'deal_count']);
    // The dataset's own filter is all the shifted pass carries — no measure
    // filter existed to add.
    expect(shifted[0].where).toEqual({ is_deleted: { $ne: true } });

    const content = res.rows.find((r) => r.lead_source === 'content')!;
    expect(content).toMatchObject({
      revenue: 300, deal_count: 3, revenue__compare: 300, deal_count__compare: 5,
    });
  });
});

// ── the base filter and the measure filter compose, on both passes ──────────

const scoped = DatasetSchema.parse({
  name: 'scoped', label: 'Scoped', object: 'opportunity',
  filter: { is_deleted: { $ne: true } },
  dimensions: [
    { name: 'lead_source', field: 'lead_source', type: 'string' },
    { name: 'close_date', field: 'close_date', type: 'date' },
  ],
  measures: [
    { name: 'revenue', aggregate: 'sum', field: 'amount' },
    { name: 'won_count', aggregate: 'count', filter: { stage: 'closed_won' } },
  ],
});

describe('compareTo — dataset filter + runtime filter + measure filter all reach the shifted query', () => {
  it('ANDs all three, exactly as the current-period sub-query does', async () => {
    const { service, seen } = recordingService();
    await new DatasetExecutor(service).execute(compileDataset(scoped), {
      dimensions: ['lead_source'],
      measures: ['revenue', 'won_count'],
      runtimeFilter: { region: 'NA' },
      timeDimensions: [{ dimension: 'close_date', dateRange: ['2026-01-01', '2026-01-31'] }],
      compareTo: { kind: 'previousPeriod', dimension: 'close_date' },
    });

    const wonQueries = seen.filter((q) => q.measures.includes('won_count'));
    expect(wonQueries).toHaveLength(2); // one current, one shifted
    for (const q of wonQueries) {
      const where = JSON.stringify(q.where);
      expect(where).toContain('"is_deleted"');
      expect(where).toContain('"region":"NA"');
      expect(where).toContain('"stage":"closed_won"');
    }
    // …and the two differ ONLY in their window.
    const [current, shiftedWon] = [wonQueries.find((q) => !isShifted(q))!, wonQueries.find(isShifted)!];
    expect(shiftedWon.where).toEqual(current.where);
    expect(shiftedWon.timeDimensions![0].dateRange).toEqual(['2025-12-01', '2025-12-31']);
  });
});

// ── the split in isolation ──────────────────────────────────────────────────

describe('splitMeasuresByFilter', () => {
  it('separates measures carrying their own filter, preserving input order', () => {
    expect(
      splitMeasuresByFilter(['revenue', 'won_count', 'avg_deal', 'lost_count'], {
        won_count: { stage: 'closed_won' },
        lost_count: { stage: 'closed_lost' },
      }),
    ).toEqual({ unfiltered: ['revenue', 'avg_deal'], filtered: ['won_count', 'lost_count'] });
  });

  it('accepts a Set (the executor passes its base-measure set)', () => {
    expect(splitMeasuresByFilter(new Set(['a', 'b']), { b: { x: 1 } })).toEqual({
      unfiltered: ['a'], filtered: ['b'],
    });
  });
});
