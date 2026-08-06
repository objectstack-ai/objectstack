// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #5537 — a dataset response's `fields` must describe its DIMENSION columns on
 * every path, not only on the single-query one.
 *
 * A dataset selection whose base measures ALL carry their own measure-scoped
 * `filter` never issues the primary grouped query: `runMeasurePass` starts from
 * a synthesized `{ rows: [], fields: [] }` and every supplementary sub-query
 * contributes exactly one MEASURE descriptor. The dimension columns are in
 * `rows` (they are the merge key) but are described nowhere, so a consumer that
 * reads column metadata — the console table renderer — has no `label` for the
 * grouped column and falls back to humanizing the raw key. Live on hotcrm +
 * 17.0.0-rc.2:
 *
 * ```
 * {"selection":{"dimensions":["owner"],"measures":["opp_count"]}}   → fields ['owner','opp_count']    ✅
 * {"selection":{"dimensions":["owner"],"measures":["won_count"]}}   → fields ['won_count']            ❌
 * {"selection":{"dimensions":["lead_source"],
 *               "measures":["won_count","decided_count","win_rate"]}} → fields ['won_count',…]        ❌
 * ```
 *
 * The same `owner` dimension declares `label: 'Owner'`, so the "Open Pipeline by
 * Owner" widget rendered `Owner` and "Win / Loss by Rep" rendered `owner`. A
 * string dimension hid the defect rather than escaping it: `lead_source`
 * humanizes to `Lead Source`, which happens to equal its real label.
 *
 * **Derived measures are not a second cause.** A derived measure is computed
 * from base measures, so it loses the dimension descriptors exactly when its
 * DEPENDENCIES are all filter-scoped (case C — `win_rate` over two filtered
 * counts); a `ratio` over unfiltered deps keeps the primary query and was never
 * affected. That distinction is pinned below so the next reader does not go
 * looking for a derived-specific seam that does not exist.
 *
 * **What a dimension descriptor IS.** `{ name, type, label }`.
 * `DatasetDimensionSchema` declares no `format` (only `label` / `type` /
 * `field` / `dateGranularity`), so there is no authorable dimension format for
 * any path to lose — `AnalyticsResult.fields[].format` is produced for MEASURES
 * only, on every path, before and after this change. A date dimension's bucket
 * is rendered server-side into the row VALUE by `resolveDimensionLabels`, not
 * via a field format. What the filtered path did lose besides the label is the
 * `type` (`time` for a date axis, not the renderer's `string` default), which
 * is asserted here per-case.
 *
 * ## Reverse verification, direction predicted BEFORE running
 *
 * Reverting the fix (restoring `runMeasurePass`'s bare `{ rows: [], fields: [] }`
 * seam) must turn RED every case whose selection has ONLY filter-scoped base
 * measures — the two "all measures filter-scoped" describes and the
 * `lead_source`/date/multi-dimension/compareTo cases inside them — and leave
 * GREEN every case in the "already worked" block, which pins the behaviour this
 * change converges ON. Ordinary direction, no inversion and no count movement:
 * the change ADDS field entries that were absent, it narrows no rule and
 * removes no `??` limb, so nothing downstream can gain a finding from it.
 * Predicted 8 red / 4 green; measured exactly that.
 */

import { describe, it, expect } from 'vitest';
import { DatasetSchema } from '@objectstack/spec/ui';
import type { ExecutionContext } from '@objectstack/spec/kernel';
import { AnalyticsService } from '../analytics-service.js';

const CTX = { tenantId: 'org_A' } as ExecutionContext;

// ── the fixture: HotCRM's `opportunity_metrics`, trimmed ────────────────────

/**
 * `owner` is a LOOKUP whose label ('Owner') differs from its humanized key
 * ('owner') — the dimension that exposed the defect. `lead_source` is the
 * string dimension whose humanized key coincidentally equals its label, kept so
 * the response is asserted rather than the renderer's luck. `close_date` is the
 * date axis: its descriptor `type` is `time`, which is what a renderer needs to
 * treat the column as a time axis at all.
 */
const dataset = DatasetSchema.parse({
  name: 'opportunity_metrics',
  label: 'Opportunity Metrics',
  object: 'opportunity',
  include: [],
  dimensions: [
    { name: 'owner', field: 'owner_id', type: 'lookup', label: 'Owner' },
    { name: 'lead_source', field: 'lead_source', type: 'string', label: 'Lead Source' },
    { name: 'close_date', field: 'close_date', type: 'date', label: 'Close Date', dateGranularity: 'month' },
  ],
  measures: [
    // No filter → the single-query path that always worked.
    { name: 'opp_count', aggregate: 'count', label: 'Opportunities' },
    // Measure-scoped filters → the supplementary-sub-query merge path.
    { name: 'won_count', aggregate: 'count', filter: { stage: 'closed_won' }, label: 'Won' },
    { name: 'decided_count', aggregate: 'count', filter: { stage: { $in: ['closed_won', 'closed_lost'] } }, label: 'Decided' },
    { name: 'open_amount', aggregate: 'sum', field: 'amount', filter: { stage: 'open' }, label: 'Open Amount', format: '$0,0' },
    // Derived over FILTERED deps (case C) and derived over UNFILTERED deps —
    // the pair that shows `derived` is not an independent cause.
    { name: 'win_rate', derived: { op: 'ratio', of: ['won_count', 'decided_count'] }, label: 'Win Rate', format: '0.0%' },
    { name: 'total_amount', aggregate: 'sum', field: 'amount', label: 'Total Amount' },
    { name: 'avg_deal', derived: { op: 'ratio', of: ['total_amount', 'opp_count'] }, label: 'Avg Deal' },
  ],
});

interface Opp {
  owner_id: string;
  lead_source: string;
  stage: string;
  amount: number;
  close_date: string;
}

const OPPS: Opp[] = [
  { owner_id: 'usr_1', lead_source: 'web', stage: 'closed_won', amount: 100, close_date: '2026-01-05' },
  { owner_id: 'usr_1', lead_source: 'web', stage: 'closed_lost', amount: 50, close_date: '2026-01-09' },
  { owner_id: 'usr_1', lead_source: 'web', stage: 'open', amount: 70, close_date: '2026-02-11' },
  { owner_id: 'usr_2', lead_source: 'referral', stage: 'closed_won', amount: 200, close_date: '2026-02-20' },
  { owner_id: 'usr_2', lead_source: 'referral', stage: 'closed_won', amount: 300, close_date: '2025-12-14' },
];

/** Enough of the engine filter grammar for this fixture. */
function matches(row: Opp, filter: unknown): boolean {
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
    const value = (row as unknown as Record<string, unknown>)[key];
    if (cond != null && typeof cond === 'object' && !Array.isArray(cond)) {
      const ops = cond as Record<string, unknown>;
      if ('$in' in ops && !(ops.$in as unknown[]).includes(value)) return false;
      if ('$ne' in ops && value === ops.$ne) return false;
      if ('$gte' in ops && !(String(value) >= String(ops.$gte))) return false;
      if ('$lte' in ops && !(String(value) <= String(ops.$lte))) return false;
      continue;
    }
    if (value !== cond) return false;
  }
  return true;
}

type GroupByItem = string | { field: string; dateGranularity?: string };

/**
 * Group `OPPS` the way a real `GROUP BY` would: rows the filter excludes
 * contribute nothing, and a dimension value left with no matching rows produces
 * NO group at all — which is what makes a filter-scoped measure need its own
 * grouped sub-query in the first place.
 */
function evaluateAggregate(opts: {
  groupBy?: unknown;
  aggregations?: unknown;
  filter?: unknown;
}): Record<string, unknown>[] {
  const groupBy = (opts.groupBy ?? []) as GroupByItem[];
  const aggregations = (opts.aggregations ?? []) as Array<{ field: string; method: string; alias: string }>;
  const buckets = new Map<string, { key: Record<string, unknown>; rows: Opp[] }>();
  for (const opp of OPPS) {
    if (!matches(opp, opts.filter)) continue;
    const key: Record<string, unknown> = {};
    for (const g of groupBy) {
      const field = typeof g === 'string' ? g : g.field;
      const raw = (opp as unknown as Record<string, unknown>)[field];
      const granularity = typeof g === 'string' ? undefined : g.dateGranularity;
      // Only `month` is exercised here; the bucket key is the sort-stable form
      // the real bucketing utilities mint.
      key[field] = granularity === 'month' ? String(raw).slice(0, 7) : raw;
    }
    const id = JSON.stringify(groupBy.map((g) => key[typeof g === 'string' ? g : g.field] ?? null));
    let bucket = buckets.get(id);
    if (!bucket) {
      bucket = { key, rows: [] };
      buckets.set(id, bucket);
    }
    bucket.rows.push(opp);
  }
  return [...buckets.values()].map(({ key, rows }) => {
    const row: Record<string, unknown> = { ...key };
    for (const a of aggregations) {
      row[a.alias] =
        a.method === 'sum'
          ? rows.reduce((s, r) => s + Number((r as unknown as Record<string, unknown>)[a.field] ?? 0), 0)
          : rows.length;
    }
    return row;
  });
}

/** The ObjectQL-aggregate service — the path every date-bucketed query lands on. */
function svc() {
  return new AnalyticsService({
    queryCapabilities: () => ({ nativeSql: false, objectqlAggregate: true, inMemory: false }),
    executeAggregate: async (_object: string, options: Record<string, unknown>) =>
      evaluateAggregate(options),
  });
}

/** Every field descriptor, in response order, stripped of absent keys. */
function descriptors(fields: Awaited<ReturnType<AnalyticsService['queryDataset']>>['fields']) {
  return fields.map((f) => {
    const out: Record<string, unknown> = { name: f.name, type: f.type };
    if (f.label != null) out.label = f.label;
    if (f.format != null) out.format = f.format;
    if (f.currency != null) out.currency = f.currency;
    if (f.percentScale != null) out.percentScale = f.percentScale;
    return out;
  });
}

// ── A) the path that always worked — the convergence target ─────────────────

describe('#5537 — the single-query path already described its dimensions (guard)', () => {
  it('A) no measure carries a filter: dimension first, fully described', async () => {
    const result = await svc().queryDataset(
      dataset,
      { dimensions: ['owner'], measures: ['opp_count'] },
      CTX,
    );
    expect(descriptors(result.fields)).toEqual([
      { name: 'owner', type: 'string', label: 'Owner' },
      { name: 'opp_count', type: 'number', label: 'Opportunities' },
    ]);
    // The dimension column is in the rows the descriptors describe.
    expect(result.rows.map((r) => r.owner).sort()).toEqual(['usr_1', 'usr_2']);
  });

  it('a derived measure over UNFILTERED deps was never affected', async () => {
    const result = await svc().queryDataset(
      dataset,
      { dimensions: ['owner'], measures: ['avg_deal'] },
      CTX,
    );
    // Base deps resolved in dependency order, then the derived column.
    expect(descriptors(result.fields)).toEqual([
      { name: 'owner', type: 'string', label: 'Owner' },
      { name: 'total_amount', type: 'number', label: 'Total Amount' },
      { name: 'opp_count', type: 'number', label: 'Opportunities' },
      { name: 'avg_deal', type: 'number', label: 'Avg Deal', percentScale: 'fraction' },
    ]);
  });

  it('a MIXED selection (one filtered, one not) already kept the dimension', async () => {
    const result = await svc().queryDataset(
      dataset,
      { dimensions: ['owner'], measures: ['opp_count', 'won_count'] },
      CTX,
    );
    expect(descriptors(result.fields)).toEqual([
      { name: 'owner', type: 'string', label: 'Owner' },
      { name: 'opp_count', type: 'number', label: 'Opportunities' },
      { name: 'won_count', type: 'number', label: 'Won' },
    ]);
  });

  /**
   * The CONTROL for the `compareTo` case in the next block, and the reason the
   * expectation there carries an unlabelled `close_date`.
   *
   * A `timeDimensions` entry that resolves a granularity is GROUPED BY, so it is
   * a COLUMN of the result and every producer of this shape projects it (#4033),
   * even when the caller never listed it under `dimensions`. It reaches `fields`
   * with a `type` and no `label`, because the label enrichment in `queryDataset`
   * walks `selection.dimensions` — and that is true on THIS path, which never
   * had the #5537 defect. Pinned here so the pair reads as convergence rather
   * than as something the fix introduced.
   *
   * That the column exists AT ALL is itself a defect, filed as #5688 and
   * deliberately not fixed here: a `timeDimensions` entry carrying only a
   * `dateRange` gets the dataset's default granularity filled in, which turns a
   * WINDOW into a second GROUP BY — so this selection also comes back split by
   * month. It reproduces identically on this path, i.e. independently of #5537,
   * and settling it changes the response SHAPE (a row count, not a label), which
   * is not a call to make as a rider. Both asserted verbatim so the day #5688
   * lands, this pair goes red and gets updated on purpose.
   */
  it('a granular `timeDimensions` column is projected here too — unlabelled, on this path as well', async () => {
    const result = await svc().queryDataset(
      dataset,
      {
        dimensions: ['owner'],
        measures: ['opp_count'],
        timeDimensions: [{ dimension: 'close_date', dateRange: ['2026-01-01', '2026-02-28'] }],
        compareTo: { kind: 'previousYear', dimension: 'close_date' },
      },
      CTX,
    );
    expect(descriptors(result.fields)).toEqual([
      { name: 'owner', type: 'string', label: 'Owner' },
      { name: 'close_date', type: 'time' },
      { name: 'opp_count', type: 'number', label: 'Opportunities' },
      { name: 'opp_count__compare', type: 'number', label: 'Opportunities' },
    ]);
    // #5688, stated as data rather than as prose: `usr_1` is one owner and comes
    // back as two rows because the window entry acquired a `month` bucket. The
    // descriptors are honest about the grid — the grid is what is wrong.
    expect(result.rows.map((r) => [r.owner, r.close_date])).toEqual([
      ['usr_1', '2026-01'],
      ['usr_1', '2026-02'],
      ['usr_2', '2026-02'],
    ]);
  });
});

// ── B/C) all base measures filter-scoped — the defect ───────────────────────

describe('#5537 — all base measures filter-scoped: the dimension is described too', () => {
  it('B) one filtered measure: `owner` is described, not merely present in rows', async () => {
    const result = await svc().queryDataset(
      dataset,
      { dimensions: ['owner'], measures: ['won_count'] },
      CTX,
    );
    expect(descriptors(result.fields)).toEqual([
      { name: 'owner', type: 'string', label: 'Owner' },
      { name: 'won_count', type: 'number', label: 'Won' },
    ]);
    // The regression's signature: the grouped column was in `rows` all along.
    expect(new Set(result.fields.map((f) => f.name))).toEqual(
      new Set(Object.keys(result.rows[0])),
    );
  });

  it('C) filtered measures + a derived ratio over them (the Win/Loss widget)', async () => {
    const result = await svc().queryDataset(
      dataset,
      { dimensions: ['lead_source'], measures: ['won_count', 'decided_count', 'win_rate'] },
      CTX,
    );
    expect(descriptors(result.fields)).toEqual([
      { name: 'lead_source', type: 'string', label: 'Lead Source' },
      { name: 'won_count', type: 'number', label: 'Won' },
      { name: 'decided_count', type: 'number', label: 'Decided' },
      { name: 'win_rate', type: 'number', label: 'Win Rate', format: '0.0%', percentScale: 'fraction' },
    ]);
  });

  it('a DATE axis keeps its `time` type and label, not the renderer default', async () => {
    const result = await svc().queryDataset(
      dataset,
      { dimensions: ['close_date'], measures: ['won_count'] },
      CTX,
    );
    expect(descriptors(result.fields)).toEqual([
      { name: 'close_date', type: 'time', label: 'Close Date' },
      { name: 'won_count', type: 'number', label: 'Won' },
    ]);
  });

  it('a measure `format`/`currency` chain still resolves alongside the dimension', async () => {
    const result = await svc().queryDataset(
      dataset,
      { dimensions: ['owner'], measures: ['open_amount'] },
      CTX,
    );
    expect(descriptors(result.fields)).toEqual([
      { name: 'owner', type: 'string', label: 'Owner' },
      { name: 'open_amount', type: 'number', label: 'Open Amount', format: '$0,0' },
    ]);
  });

  it('MULTIPLE dimensions are described in selection order, ahead of the measures', async () => {
    const result = await svc().queryDataset(
      dataset,
      { dimensions: ['owner', 'lead_source'], measures: ['won_count', 'decided_count'] },
      CTX,
    );
    expect(descriptors(result.fields)).toEqual([
      { name: 'owner', type: 'string', label: 'Owner' },
      { name: 'lead_source', type: 'string', label: 'Lead Source' },
      { name: 'won_count', type: 'number', label: 'Won' },
      { name: 'decided_count', type: 'number', label: 'Decided' },
    ]);
  });

  it('the descriptors are emitted ONCE, however many supplementary queries ran', async () => {
    const result = await svc().queryDataset(
      dataset,
      { dimensions: ['owner'], measures: ['won_count', 'decided_count', 'open_amount'] },
      CTX,
    );
    expect(result.fields.filter((f) => f.name === 'owner')).toHaveLength(1);
    expect(descriptors(result.fields)).toEqual([
      { name: 'owner', type: 'string', label: 'Owner' },
      { name: 'won_count', type: 'number', label: 'Won' },
      { name: 'decided_count', type: 'number', label: 'Decided' },
      { name: 'open_amount', type: 'number', label: 'Open Amount', format: '$0,0' },
    ]);
  });

  it('`compareTo` attaches its columns AFTER the dimension descriptors', async () => {
    const result = await svc().queryDataset(
      dataset,
      {
        dimensions: ['owner'],
        measures: ['won_count'],
        timeDimensions: [{ dimension: 'close_date', dateRange: ['2026-01-01', '2026-02-28'] }],
        compareTo: { kind: 'previousYear', dimension: 'close_date' },
      },
      CTX,
    );
    // Identical to the control in the previous block, measure for measure —
    // including the unlabelled `close_date` a granular `timeDimensions` entry
    // projects on BOTH paths.
    expect(descriptors(result.fields)).toEqual([
      { name: 'owner', type: 'string', label: 'Owner' },
      { name: 'close_date', type: 'time' },
      { name: 'won_count', type: 'number', label: 'Won' },
      { name: 'won_count__compare', type: 'number', label: 'Won' },
    ]);
  });

  it('the `totals` grid re-enters the same pass and still describes the dimension', async () => {
    const result = await svc().queryDataset(
      dataset,
      {
        dimensions: ['owner'],
        measures: ['won_count'],
        totals: { groupings: [[]] },
      },
      CTX,
    );
    expect(descriptors(result.fields)).toEqual([
      { name: 'owner', type: 'string', label: 'Owner' },
      { name: 'won_count', type: 'number', label: 'Won' },
    ]);
    expect(result.totals).toHaveLength(1);
  });
});
