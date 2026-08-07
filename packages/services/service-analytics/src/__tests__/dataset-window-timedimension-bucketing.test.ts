// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #5688 — a `timeDimensions` entry used only as a WINDOW must stay a filter.
 *
 * A dashboard date-range picker emits `timeDimensions: [{ dimension, dateRange }]`
 * — no `granularity` — and does not list that dimension under
 * `selection.dimensions`. The executor filled in the dataset dimension's own
 * `dateGranularity` anyway, which made the entry a GROUP BY item: the response
 * grew a time column nobody selected and every row split per bucket. "Count by
 * Owner" plus a date filter came back as "by Owner × month":
 *
 * ```
 * fields [{"name":"owner",…},{"name":"close_date","type":"time"},{"name":"opp_count",…}]
 * rows   [{"owner":"u1","close_date":"2026-01","opp_count":1},
 *         {"owner":"u1","close_date":"2026-02","opp_count":1},
 *         {"owner":"u2","close_date":"2026-01","opp_count":1}]
 * ```
 *
 * A KPI single-value card then read the first of those rows. The invariant it
 * broke is the one every filter obeys: a `dateRange` removes rows — it does not
 * mint a column, split a row, or change the column set.
 *
 * ## The narrowed criterion (all three arms pinned below)
 *
 * An entry that states NO granularity is bucketed only when the request says
 * that date is being bucketed: the dimension is one of the grid dimensions this
 * query groups by, or `selection.dateGranularity` is set. An entry carrying its
 * own `granularity` was never in question and stays grouped (#4033). The dataset
 * dimension's `dateGranularity` alone is NOT such a signal — it says how this
 * date renders WHEN grouped, not that it should be grouped.
 *
 * ## compareTo — the same question, answered on both passes (#3588/#4870)
 *
 * The backfill existed because the comparison pass must bucket exactly like the
 * primary one; a month-bucketed primary grid merged against raw-timestamp
 * comparison rows shares no dimension key, and every `__compare` column comes
 * back empty. That still holds, and holds BY CONSTRUCTION: `runCompare` re-enters
 * `buildQuery` with the same grid dimensions and the same
 * `selection.dateGranularity`, differing only in the shifted `dateRange`, so both
 * passes reach the same verdict for the same entry. Pinned as a PAIR here — the
 * bucketed anchor and the window-only anchor, each asserted on both passes — so
 * neither demand can be re-broken in the other's name.
 *
 * For a window-only anchor the narrowing does not merely preserve the merge, it
 * REPAIRS it. `mergeByDimensions` has always keyed on `selection.dimensions`
 * alone, never on the projected bucket column, so the backfilled month column
 * was outside the merge key: with several month-split rows per owner the
 * comparison value landed on whichever row the index happened to hold last and
 * the others read a confident `0`. Both numbers are asserted below.
 *
 * ## …and bucketing alike was only HALF of it (#6007)
 *
 * Identical bucketing makes the two grids the same SHAPE; it does not make them
 * the same KEYS. For a bucketed anchor the comparison pass groups the shifted
 * window, so its rows key to `2025-01` where the primary grid keys to `2026-01`
 * — nothing merges, every comparison row is appended, and the grid doubles into
 * half-real/half-zero rows plus buckets from outside the caller's own window.
 * The bucketed-anchor case below asserted exactly that grid as "long-standing
 * behaviour, unchanged by #5688", pointing at #6007; #6007 ruled it a defect and
 * flipped it to the paired 2×2. The whole-file pairing is unchanged: the
 * window-only anchor is still asserted NOT to align (it is not a column on
 * either pass, so there is nothing to realign), and the alignment itself —
 * every granularity, both `compareTo` kinds, and every case it declines — lives
 * in `dataset-compare-bucket-alignment.test.ts`.
 */

import { describe, it, expect } from 'vitest';
import { DatasetSchema } from '@objectstack/spec/ui';
import type { ExecutionContext } from '@objectstack/spec/kernel';
import { AnalyticsService } from '../analytics-service.js';

const CTX = { tenantId: 'org_A' } as ExecutionContext;

// ── fixture ─────────────────────────────────────────────────────────────────

/**
 * The issue's dataset: a lookup dimension whose label differs from its
 * humanized key, and a date dimension declaring an explicit `dateGranularity` —
 * the necessary condition for the defect, and the shape HotCRM-class datasets
 * ship.
 */
const dataset = DatasetSchema.parse({
  name: 'opportunity_metrics',
  label: 'Opportunity Metrics',
  object: 'opportunity',
  include: [],
  dimensions: [
    { name: 'owner', field: 'owner_id', type: 'lookup', label: 'Owner' },
    { name: 'close_date', field: 'close_date', type: 'date', label: 'Close Date', dateGranularity: 'month' },
    // The control: same shape, no declared `dateGranularity`, so nothing was
    // ever backfilled for it — which is what makes the declaration the trigger.
    { name: 'created_at', field: 'created_at', type: 'date', label: 'Created' },
  ],
  measures: [{ name: 'opp_count', aggregate: 'count', label: 'Opps' }],
});

/**
 * Current window (2026-01-01..2026-02-28): `u1` → 2 (one per month), `u2` → 1.
 * Previous year (2025-01-01..2025-02-28): `u1` → 3 (one in Jan, TWO in Feb),
 * `u2` → 1.
 *
 * `u1`'s comparison total deliberately spans two months and is not equal to
 * either month alone (3 = 1 + 2), so a per-month merge cannot accidentally
 * produce the right answer.
 */
const OPPS: Array<{ owner_id: string; close_date: string; created_at: string }> = [
  { owner_id: 'u1', close_date: '2026-01-05', created_at: '2025-11-01' },
  { owner_id: 'u1', close_date: '2026-02-11', created_at: '2025-11-02' },
  { owner_id: 'u2', close_date: '2026-01-20', created_at: '2025-11-03' },
  { owner_id: 'u1', close_date: '2025-01-07', created_at: '2024-11-01' },
  { owner_id: 'u1', close_date: '2025-02-03', created_at: '2024-11-02' },
  { owner_id: 'u1', close_date: '2025-02-04', created_at: '2024-11-03' },
  { owner_id: 'u2', close_date: '2025-01-15', created_at: '2024-11-04' },
];

type GroupByItem = string | { field: string; dateGranularity?: string };
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

/** Bucket keys for the granularities this fixture exercises. */
function bucket(raw: unknown, granularity?: string): unknown {
  const s = String(raw);
  if (granularity === 'month') return s.slice(0, 7);
  if (granularity === 'year') return s.slice(0, 4);
  return raw;
}

/** Group `OPPS` the way a real `GROUP BY` would, over the filtered row set. */
function evaluateAggregate(opts: AggOptions): Record<string, unknown>[] {
  const groupBy = (opts.groupBy ?? []) as GroupByItem[];
  const aggregations = (opts.aggregations ?? []) as Array<{ field: string; method: string; alias: string }>;
  const buckets = new Map<string, { key: Record<string, unknown>; rows: unknown[] }>();
  for (const opp of OPPS) {
    if (!matches(opp as unknown as Record<string, unknown>, opts.filter)) continue;
    const key: Record<string, unknown> = {};
    for (const g of groupBy) {
      const field = typeof g === 'string' ? g : g.field;
      const raw = (opp as unknown as Record<string, unknown>)[field];
      key[field] = bucket(raw, typeof g === 'string' ? undefined : g.dateGranularity);
    }
    const id = JSON.stringify(groupBy.map((g) => key[typeof g === 'string' ? g : g.field] ?? null));
    let b = buckets.get(id);
    if (!b) {
      b = { key, rows: [] };
      buckets.set(id, b);
    }
    b.rows.push(opp);
  }
  return [...buckets.values()].map(({ key, rows }) => {
    const row: Record<string, unknown> = { ...key };
    for (const a of aggregations) row[a.alias] = rows.length;
    return row;
  });
}

/**
 * The ObjectQL-aggregate service — the path every date-bucketed query lands on
 * — recording each lowered aggregate call, so the GROUP BY itself is asserted
 * rather than inferred from the rows.
 */
function svc() {
  const calls: AggOptions[] = [];
  const service = new AnalyticsService({
    queryCapabilities: () => ({ nativeSql: false, objectqlAggregate: true, inMemory: false }),
    executeAggregate: async (_object: string, options: Record<string, unknown>) => {
      calls.push(options as AggOptions);
      return evaluateAggregate(options as AggOptions);
    },
  });
  return { service, calls };
}

const groupByOf = (call: AggOptions) => (call.groupBy ?? []) as GroupByItem[];
const names = (fields: Array<{ name: string }>) => fields.map((f) => f.name);
const descriptor = (fields: Array<{ name: string; type?: string; label?: string }>, name: string) => {
  const f = fields.find((x) => x.name === name);
  return f ? { name: f.name, type: f.type, label: f.label } : undefined;
};

const WINDOW: [string, string] = ['2026-01-01', '2026-02-28'];

// ── 1) the window-only entry stays a filter ─────────────────────────────────

describe('#5688 — a dateRange-only entry filters rows and nothing else', () => {
  it('the issue verbatim: "by Owner" + a date filter is by Owner, not Owner × month', async () => {
    const { service, calls } = svc();
    const result = await service.queryDataset(
      dataset,
      {
        dimensions: ['owner'],
        measures: ['opp_count'],
        timeDimensions: [{ dimension: 'close_date', dateRange: WINDOW }],
      },
      CTX,
    );
    // The column set is the selection's own: no time column nobody asked for.
    expect(names(result.fields)).toEqual(['owner', 'opp_count']);
    // Two rows, not three — `u1`'s January and February records are one owner.
    expect(result.rows).toEqual([
      { owner: 'u1', opp_count: 2 },
      { owner: 'u2', opp_count: 1 },
    ]);
    // Where it is settled: the entry never reaches the GROUP BY, and its
    // `dateRange` is still applied as a predicate — fewer rows, same columns.
    expect(groupByOf(calls[0])).toEqual(['owner_id']);
    expect(calls[0].filter).toMatchObject({ close_date: { $gte: WINDOW[0], $lte: WINDOW[1] } });
  });

  it('adding the window changes the ROW COUNT and nothing about the column set', async () => {
    const selection = { dimensions: ['owner'], measures: ['opp_count'] };
    const unfiltered = await svc().service.queryDataset(dataset, selection, CTX);
    const filtered = await svc().service.queryDataset(
      dataset,
      { ...selection, timeDimensions: [{ dimension: 'close_date', dateRange: WINDOW }] },
      CTX,
    );
    // Identical columns; the window only removed the 2025 records from the counts.
    expect(names(filtered.fields)).toEqual(names(unfiltered.fields));
    expect(unfiltered.rows).toEqual([
      { owner: 'u1', opp_count: 5 },
      { owner: 'u2', opp_count: 2 },
    ]);
    expect(filtered.rows).toEqual([
      { owner: 'u1', opp_count: 2 },
      { owner: 'u2', opp_count: 1 },
    ]);
  });

  it('a KPI single-value card gets ONE row, not the first of several buckets', async () => {
    const { service } = svc();
    const result = await service.queryDataset(
      dataset,
      {
        dimensions: [],
        measures: ['opp_count'],
        timeDimensions: [{ dimension: 'close_date', dateRange: WINDOW }],
      },
      CTX,
    );
    expect(result.rows).toEqual([{ opp_count: 3 }]);
    expect(names(result.fields)).toEqual(['opp_count']);
  });

  it('mints no descriptor for the window dimension — the lookup widened, the projection did not', async () => {
    const { service } = svc();
    const result = await service.queryDataset(
      dataset,
      {
        dimensions: ['owner'],
        measures: ['opp_count'],
        timeDimensions: [{ dimension: 'close_date', dateRange: WINDOW }],
      },
      CTX,
    );
    // #5688 widened the label enrichment's lookup set to dimensions reached via
    // `timeDimensions`. It must still describe only columns that EXIST: an entry
    // that stayed a window is not a column, so no `close_date` field appears.
    expect(descriptor(result.fields, 'close_date')).toBeUndefined();
    expect(result.rows.every((r) => !('close_date' in r))).toBe(true);
  });
});

// ── 2) the entries that ARE asking for a bucket keep it ─────────────────────

describe('#5688 — an entry asking to be bucketed still is (#3588/#4033/#4870 guard)', () => {
  it('the dimension is also a GRID dimension → bucketed, exactly as before', async () => {
    const { service, calls } = svc();
    const result = await service.queryDataset(
      dataset,
      {
        dimensions: ['owner', 'close_date'],
        measures: ['opp_count'],
        timeDimensions: [{ dimension: 'close_date', dateRange: WINDOW }],
      },
      CTX,
    );
    // Left unbucketed this would group RAW TIMESTAMPS — one bucket per row,
    // which is the #3588 defect the backfill was introduced to fix.
    expect(groupByOf(calls[0])).toEqual(['owner_id', { field: 'close_date', dateGranularity: 'month' }]);
    // Chronological by default on the time axis (#3916), ties in grouping order.
    expect(result.rows).toEqual([
      { owner: 'u1', close_date: '2026-01', opp_count: 1 },
      { owner: 'u2', close_date: '2026-01', opp_count: 1 },
      { owner: 'u1', close_date: '2026-02', opp_count: 1 },
    ]);
    expect(descriptor(result.fields, 'close_date')).toEqual({
      name: 'close_date', type: 'time', label: 'Close Date',
    });
  });

  it('the entry states its OWN granularity → bucketed and projected, though never selected (#4033)', async () => {
    const { service, calls } = svc();
    const result = await service.queryDataset(
      dataset,
      {
        dimensions: ['owner'],
        measures: ['opp_count'],
        timeDimensions: [{ dimension: 'close_date', dateRange: WINDOW, granularity: 'month' }],
      },
      CTX,
    );
    expect(groupByOf(calls[0])).toEqual(['owner_id', { field: 'close_date', dateGranularity: 'month' }]);
    expect(names(result.fields)).toEqual(['owner', 'close_date', 'opp_count']);
    // #5691's blind spot, closed here: the projected time column reaches
    // `fields` with a `label` now, not a bare `type`. The enrichment loop used
    // to walk `selection.dimensions` only, which this column is not in.
    expect(descriptor(result.fields, 'close_date')).toEqual({
      name: 'close_date', type: 'time', label: 'Close Date',
    });
  });

  it('`selection.dateGranularity` is set → the presentation asked for buckets, so it gets them', async () => {
    const { service, calls } = svc();
    const result = await service.queryDataset(
      dataset,
      {
        dimensions: ['owner'],
        measures: ['opp_count'],
        dateGranularity: 'year',
        timeDimensions: [{ dimension: 'close_date', dateRange: WINDOW }],
      },
      CTX,
    );
    // The selection's granularity beats the dataset's `month` default — the
    // precedence chain in `resolveDimensionGranularity` is untouched by #5688.
    expect(groupByOf(calls[0])).toEqual(['owner_id', { field: 'close_date', dateGranularity: 'year' }]);
    expect(result.rows).toEqual([
      { owner: 'u1', close_date: '2026', opp_count: 2 },
      { owner: 'u2', close_date: '2026', opp_count: 1 },
    ]);
  });

  it('control — a dimension declaring NO dateGranularity was never backfilled either way', async () => {
    const { service, calls } = svc();
    await service.queryDataset(
      dataset,
      {
        dimensions: ['owner'],
        measures: ['opp_count'],
        timeDimensions: [{ dimension: 'created_at', dateRange: ['2025-01-01', '2025-12-31'] }],
      },
      CTX,
    );
    // Same outcome as `close_date` now has, reached for a different reason:
    // there was no default to fill in. Pinned so the declaration is visibly the
    // trigger condition rather than an assumed one.
    expect(groupByOf(calls[0])).toEqual(['owner_id']);
  });
});

// ── 3) compareTo — the pair ─────────────────────────────────────────────────

describe('#5688 — compareTo buckets both passes alike, whichever verdict it reaches', () => {
  it('window-only anchor: NEITHER pass buckets, and the comparison merges on `owner`', async () => {
    const { service, calls } = svc();
    const result = await service.queryDataset(
      dataset,
      {
        dimensions: ['owner'],
        measures: ['opp_count'],
        timeDimensions: [{ dimension: 'close_date', dateRange: WINDOW }],
        compareTo: { kind: 'previousYear', dimension: 'close_date' },
      },
      CTX,
    );
    // Both passes ran, both grouped by `owner` alone — same verdict, so the two
    // grids are shaped alike (the #4870 invariant, at the other verdict).
    expect(calls).toHaveLength(2);
    expect(groupByOf(calls[0])).toEqual(['owner_id']);
    expect(groupByOf(calls[1])).toEqual(['owner_id']);
    expect(calls[1].filter).toMatchObject({ close_date: { $gte: '2025-01-01', $lte: '2025-02-28' } });
    // `u1`: 2 this window against 3 last year — 3 spans two months, so the
    // number is only reachable by merging the WHOLE shifted window onto the
    // owner. Before #5688 this row set was three month-split rows carrying
    // `__compare` 0 / 2 / 1: the January row read a confident 0 and the other
    // two months' comparison values were overwritten by whichever landed last.
    expect(result.rows).toEqual([
      { owner: 'u1', opp_count: 2, opp_count__compare: 3 },
      { owner: 'u2', opp_count: 1, opp_count__compare: 1 },
    ]);
    expect(names(result.fields)).toEqual(['owner', 'opp_count', 'opp_count__compare']);
  });

  it('bucketed anchor: BOTH passes bucket by month, and the comparison lands on the SAME row (#6007)', async () => {
    const { service, calls } = svc();
    const result = await service.queryDataset(
      dataset,
      {
        dimensions: ['close_date'],
        measures: ['opp_count'],
        timeDimensions: [{ dimension: 'close_date', dateRange: WINDOW }],
        compareTo: { kind: 'previousYear', dimension: 'close_date' },
      },
      CTX,
    );
    expect(calls).toHaveLength(2);
    // The comparison pass must bucket EXACTLY like the primary one. Hand-rolled
    // without granularity resolution it grouped raw timestamps, and no dimension
    // key ever matched.
    expect(groupByOf(calls[0])).toEqual([{ field: 'close_date', dateGranularity: 'month' }]);
    expect(groupByOf(calls[1])).toEqual([{ field: 'close_date', dateGranularity: 'month' }]);
    expect(calls[1].filter).toMatchObject({ close_date: { $gte: '2025-01-01', $lte: '2025-02-28' } });
    expect(descriptor(result.fields, 'close_date')).toEqual({
      name: 'close_date', type: 'time', label: 'Close Date',
    });
    // **This assertion was deliberately flipped by #6007**, and it is the whole
    // point of the pair. Bucketing the two passes ALIKE (#4870, above) was only
    // half the requirement: the comparison pass still grouped the SHIFTED
    // window, so its rows keyed to `2025-01` / `2025-02` while the merge keys on
    // `selection.dimensions` — nothing matched, every comparison row was
    // APPENDED, and this is what the grid used to be:
    //
    // ```
    // [{ close_date: '2025-01', opp_count: 0, opp_count__compare: 2 },
    //  { close_date: '2025-02', opp_count: 0, opp_count__compare: 2 },
    //  { close_date: '2026-01', opp_count: 2, opp_count__compare: 0 },
    //  { close_date: '2026-02', opp_count: 1, opp_count__compare: 0 }]
    // ```
    //
    // Four rows for a two-bucket window, a confident `0` on every one of them
    // (each pass reported only its own half, and `fillEmptyGroups` filled the
    // other), and two rows keyed OUTSIDE the window the caller filtered to. The
    // ruling on #6007 restates each comparison bucket key in current-period
    // terms — `2025-01` → `2026-01` — so a "this year vs last year" trend is
    // what it reads as: 2 rows × 2 columns, one row per bucket of the requested
    // window, both numbers real.
    expect(result.rows).toEqual([
      { close_date: '2026-01', opp_count: 2, opp_count__compare: 2 },
      { close_date: '2026-02', opp_count: 1, opp_count__compare: 2 },
    ]);
    // Said as an invariant rather than only as a row list, because it is the
    // invariant a future change is most likely to break silently: no row keys to
    // a bucket outside the filtered window.
    expect(result.rows.every((r) => String(r.close_date).startsWith('2026-'))).toBe(true);
  });

  it('window-only anchor with NO grid dimensions: one row, both totals comparable', async () => {
    const { service } = svc();
    const result = await service.queryDataset(
      dataset,
      {
        dimensions: [],
        measures: ['opp_count'],
        timeDimensions: [{ dimension: 'close_date', dateRange: WINDOW }],
        compareTo: { kind: 'previousYear', dimension: 'close_date' },
      },
      CTX,
    );
    // The period-over-period tile: 3 this window, 4 last year. Before #5688 this
    // came back as two month rows and the tile read the first one.
    expect(result.rows).toEqual([{ opp_count: 3, opp_count__compare: 4 }]);
  });
});
