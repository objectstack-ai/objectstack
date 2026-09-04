// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
/**
 * Pins for the server-side list-view grouping contract (#14556, ruling A on
 * objectui#7189).
 *
 * The acceptance fixture is the card's: 186 rows in five business units sized
 * 86 / 61 / 31 / 7 / 1, a page of `$top: 100`. The card measured what a
 * page-scoped grouping renders on it — TWO headers (86, 14) when the rows are
 * contiguous, FIVE (31/31/30/7/1) when they are interleaved — and ruled that
 * neither is the data. The pins below reproduce both artefacts on the page
 * window (so the fixture is shown to be the one that failed) and then reduce
 * the COMPILED header query over the whole set in both orders: 86/61/31/7/1,
 * order-independent, every unit present.
 */
import { describe, it, expect } from 'vitest';
import { StandardErrorCode } from '../api/errors.zod';
import { ListViewSchema } from './view.zod';
import type { ColumnSummary } from './view.zod';
import type { FilterCondition } from '../data/filter.zod';
import type { EngineAggregateOptions } from '../data/data-engine.zod';
import {
  COLUMN_SUMMARY_AGGREGATION,
  LIST_VIEW_GROUP_COUNT_ALIAS,
  ListViewGroupQueryError,
  UNMAPPED_COLUMN_SUMMARIES,
  columnSummaryAlias,
  compileListViewGroupQuery,
  compileListViewGroupRowsQuery,
  deriveColumnSummary,
  listViewGroupKeyPredicate,
} from './view-grouping-query';
import type { ListViewGroupHeaderRow } from './view-grouping-query';

// ─── The acceptance fixture ──────────────────────────────────────────────────

interface Row {
  id: string;
  business_unit: string | null;
  status: 'open' | 'done';
  amount: number;
  owner: string;
  /** Nullable on purpose — the field the derived `*_filled` / `*_empty` pins read. */
  notes: string | null;
}

/** Five units, 186 rows, sized exactly as the card measured them. */
const UNITS: ReadonlyArray<readonly [string, number]> = [
  ['northgate_operations', 86],
  ['northgate_quality', 61],
  ['riverside_plant', 31],
  ['northgate_plant', 7],
  ['harbour_office', 1],
];

function makeRow(unit: string, ordinal: number): Row {
  return {
    id: `${unit}-${ordinal}`,
    business_unit: unit,
    // Every third row is done, so a view filter and a second grouping level
    // both have something to bite on.
    status: ordinal % 3 === 0 ? 'done' : 'open',
    amount: ordinal,
    owner: `owner_${ordinal % 4}`,
    // Every fifth row has no note — the server's "empty" (null), never ''.
    notes: ordinal % 5 === 0 ? null : `note ${ordinal}`,
  };
}

/** Rows of one unit, then the next — the contiguous order the card measured. */
const CONTIGUOUS: Row[] = UNITS.flatMap(([unit, size]) =>
  Array.from({ length: size }, (_, i) => makeRow(unit, i + 1)),
);

/** Round-robin over the units — the interleaved order the card measured. */
const INTERLEAVED: Row[] = (() => {
  const queues = UNITS.map(([unit, size]) => Array.from({ length: size }, (_, i) => makeRow(unit, i + 1)));
  const out: Row[] = [];
  while (queues.some((q) => q.length > 0)) {
    for (const q of queues) {
      const next = q.shift();
      if (next) out.push(next);
    }
  }
  return out;
})();

const PAGE_SIZE = 100;
const EXPECTED_COUNTS = { northgate_operations: 86, northgate_quality: 61, riverside_plant: 31, northgate_plant: 7, harbour_office: 1 };
/** Rows whose `notes` is null per unit: floor(size / 5). */
const EXPECTED_EMPTY_NOTES = { northgate_operations: 17, northgate_quality: 12, riverside_plant: 6, northgate_plant: 1, harbour_office: 0 };

// ─── A minimal reduction of the compiled queries over rows ───────────────────
//
// Test-only: enough of the filter AST (`$and`, `$eq`, `$null`, implicit
// equality) and of the aggregate vocabulary to evaluate what the helpers
// compile. The platform's own faces are pinned elsewhere
// (`aggregation-conformance`, `in-memory-aggregation`); this is the pin that
// the COMPILED shape, evaluated, answers the card's numbers.

function matches(row: Record<string, unknown>, where: FilterCondition | Record<string, unknown> | undefined): boolean {
  if (!where) return true;
  for (const [key, cond] of Object.entries(where)) {
    if (key === '$and') { if (!(cond as FilterCondition[]).every((c) => matches(row, c))) return false; continue; }
    if (key === '$or') { if (!(cond as FilterCondition[]).some((c) => matches(row, c))) return false; continue; }
    const value = row[key];
    if (cond !== null && typeof cond === 'object' && !Array.isArray(cond)) {
      const ops = cond as Record<string, unknown>;
      if ('$eq' in ops && value !== ops.$eq) return false;
      if ('$null' in ops && (value == null) !== ops.$null) return false;
      if ('$in' in ops && !(ops.$in as unknown[]).includes(value)) return false;
      continue;
    }
    if (value !== cond) return false;
  }
  return true;
}

function reduceHeaderQuery(rows: Row[], query: EngineAggregateOptions): ListViewGroupHeaderRow[] {
  const groupBy = (query.groupBy ?? []).map((g) => (typeof g === 'string' ? g : g.field));
  const buckets = new Map<string, { key: Record<string, unknown>; rows: Row[] }>();
  for (const row of rows.filter((r) => matches(r as unknown as Record<string, unknown>, query.where))) {
    const key: Record<string, unknown> = {};
    for (const g of groupBy) key[g] = (row as unknown as Record<string, unknown>)[g] ?? null;
    const id = JSON.stringify(groupBy.map((g) => key[g]));
    const bucket = buckets.get(id) ?? { key, rows: [] };
    bucket.rows.push(row);
    buckets.set(id, bucket);
  }
  return [...buckets.values()].map(({ key, rows: bucketRows }) => {
    const out: Record<string, unknown> = { ...key };
    for (const agg of query.aggregations ?? []) {
      const values = agg.field ? bucketRows.map((r) => (r as unknown as Record<string, unknown>)[agg.field as string]) : [];
      const nums = values.filter((v) => v != null).map(Number);
      switch (agg.function) {
        // `count(field)` is the NON-NULL count on every face — the ruled semantics.
        case 'count': out[agg.alias] = agg.field ? values.filter((v) => v != null).length : bucketRows.length; break;
        case 'count_distinct': out[agg.alias] = new Set(values.filter((v) => v != null)).size; break;
        case 'sum': out[agg.alias] = nums.reduce((a, b) => a + b, 0); break;
        case 'avg': out[agg.alias] = nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : null; break;
        case 'min': out[agg.alias] = nums.length ? Math.min(...nums) : null; break;
        case 'max': out[agg.alias] = nums.length ? Math.max(...nums) : null; break;
      }
    }
    return out as ListViewGroupHeaderRow;
  });
}

/** Header rows → `{ unit: count }`, the shape a reader compares. */
function countsByUnit(headers: ListViewGroupHeaderRow[]): Record<string, number> {
  return Object.fromEntries(headers.map((h) => [String(h.business_unit), h[LIST_VIEW_GROUP_COUNT_ALIAS]]));
}

/** What a page-scoped grouping (the interim, objectui `useGroupedData`) shows on the first window. */
function pageScopedCounts(rows: Row[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const row of rows.slice(0, PAGE_SIZE)) counts[String(row.business_unit)] = (counts[String(row.business_unit)] ?? 0) + 1;
  return counts;
}

const refusal = (fn: () => unknown): ListViewGroupQueryError => {
  try { fn(); } catch (e) { return e as ListViewGroupQueryError; }
  throw new Error('expected a ListViewGroupQueryError');
};

const GROUPED_VIEW = {
  grouping: { fields: [{ field: 'business_unit' }] },
  columns: [
    { field: 'id' },
    { field: 'amount', summary: 'sum' as const },
    { field: 'owner', summary: 'count_unique' as const },
  ],
};

// ─── The fixture reproduces the card's measurements ──────────────────────────

describe('the acceptance fixture is the one the card measured', () => {
  it('holds 186 rows in five units sized 86/61/31/7/1, in both orders', () => {
    expect(CONTIGUOUS).toHaveLength(186);
    expect(INTERLEAVED).toHaveLength(186);
    const whole = (rows: Row[]) => countsByUnit(reduceHeaderQuery(rows, { groupBy: ['business_unit'], aggregations: [{ function: 'count', alias: 'count' }] }));
    expect(whole(CONTIGUOUS)).toEqual(EXPECTED_COUNTS);
    expect(whole(INTERLEAVED)).toEqual(EXPECTED_COUNTS);
  });

  it('page-scoped grouping over the first 100 rows renders TWO headers (86, 14) when contiguous — three units absent', () => {
    expect(pageScopedCounts(CONTIGUOUS)).toEqual({ northgate_operations: 86, northgate_quality: 14 });
  });

  it('page-scoped grouping over the first 100 rows renders FIVE headers reading 31/31/30/7/1 when interleaved', () => {
    expect(pageScopedCounts(INTERLEAVED)).toEqual({
      northgate_operations: 31, northgate_quality: 31, riverside_plant: 30, northgate_plant: 7, harbour_office: 1,
    });
  });
});

// ─── The header query ────────────────────────────────────────────────────────

describe('compileListViewGroupQuery — the group set and every header number are ONE aggregate query', () => {
  it('compiles the grouping, the count node and the mapped column summaries onto EngineAggregateOptions', () => {
    const where = { status: { $eq: 'open' } };
    expect(compileListViewGroupQuery(GROUPED_VIEW, { where })).toEqual({
      where,
      groupBy: ['business_unit'],
      aggregations: [
        { function: 'count', alias: 'count' },
        { function: 'sum', field: 'amount', alias: 'sum_amount' },
        { function: 'count_distinct', field: 'owner', alias: 'count_distinct_owner' },
      ],
    });
  });

  it('omits `where` when the view has no filter — the whole object', () => {
    expect(compileListViewGroupQuery({ grouping: { fields: [{ field: 'business_unit' }] } })).toEqual({
      groupBy: ['business_unit'],
      aggregations: [{ function: 'count', alias: 'count' }],
    });
  });

  it('reduced over the whole set yields 86/61/31/7/1 regardless of row order — the acceptance criterion', () => {
    const query = compileListViewGroupQuery(GROUPED_VIEW);
    const contiguous = reduceHeaderQuery(CONTIGUOUS, query);
    const interleaved = reduceHeaderQuery(INTERLEAVED, query);
    expect(countsByUnit(contiguous)).toEqual(EXPECTED_COUNTS);
    expect(countsByUnit(interleaved)).toEqual(EXPECTED_COUNTS);
    expect(contiguous).toHaveLength(5);
    expect(interleaved).toHaveLength(5);
  });

  it('carries the per-group summaries on the same row as the count, under `<function>_<field>`', () => {
    const headers = reduceHeaderQuery(CONTIGUOUS, compileListViewGroupQuery(GROUPED_VIEW));
    const ops = headers.find((h) => h.business_unit === 'northgate_operations')!;
    // sum 1..86, and owners cycle through four names.
    expect(ops).toEqual({ business_unit: 'northgate_operations', count: 86, sum_amount: (86 * 87) / 2, count_distinct_owner: 4 });
    const single = headers.find((h) => h.business_unit === 'harbour_office')!;
    expect(single).toEqual({ business_unit: 'harbour_office', count: 1, sum_amount: 1, count_distinct_owner: 1 });
  });

  it('applies the view filter to the header numbers — the same `where` the row query carries', () => {
    const query = compileListViewGroupQuery(GROUPED_VIEW, { where: { status: { $eq: 'done' } } });
    const counts = countsByUnit(reduceHeaderQuery(INTERLEAVED, query));
    // Every third ordinal is done: floor(size / 3).
    expect(counts).toEqual({ northgate_operations: 28, northgate_quality: 20, riverside_plant: 10, northgate_plant: 2 });
  });

  it('a two-level grouping compiles to a two-column groupBy, in nesting order', () => {
    const query = compileListViewGroupQuery({
      grouping: { fields: [{ field: 'business_unit' }, { field: 'status' }] },
      columns: ['id', 'amount'],
    });
    expect(query.groupBy).toEqual(['business_unit', 'status']);
    const leaves = reduceHeaderQuery(CONTIGUOUS, query);
    // Five units, two of which have no `done` rows (sizes 7 → 2 done, 1 → 0 done).
    expect(leaves).toHaveLength(9);
    const opsOpen = leaves.find((h) => h.business_unit === 'northgate_operations' && h.status === 'open')!;
    const opsDone = leaves.find((h) => h.business_unit === 'northgate_operations' && h.status === 'done')!;
    expect(opsOpen.count).toBe(58);
    expect(opsDone.count).toBe(28);
    // The outer level folds exactly for count.
    expect(opsOpen.count + opsDone.count).toBe(EXPECTED_COUNTS.northgate_operations);
  });

  it('`depth` compiles an outer level\'s own query — the first N grouping fields', () => {
    const view = { grouping: { fields: [{ field: 'business_unit' }, { field: 'status' }] } };
    expect(compileListViewGroupQuery(view, { depth: 1 }).groupBy).toEqual(['business_unit']);
    expect(compileListViewGroupQuery(view, { depth: 2 }).groupBy).toEqual(['business_unit', 'status']);
    expect(countsByUnit(reduceHeaderQuery(INTERLEAVED, compileListViewGroupQuery(view, { depth: 1 })))).toEqual(EXPECTED_COUNTS);
  });

  it('count_distinct does NOT fold across leaves — an outer-level count_unique needs the depth query', () => {
    const view = {
      grouping: { fields: [{ field: 'business_unit' }, { field: 'status' }] },
      columns: [{ field: 'owner', summary: 'count_unique' as const }],
    };
    const leaves = reduceHeaderQuery(CONTIGUOUS, compileListViewGroupQuery(view));
    const opsLeaves = leaves.filter((h) => h.business_unit === 'northgate_operations');
    // Both leaves of the unit see all four owners, so summing over-counts the union.
    const folded = opsLeaves.reduce((a, h) => a + (h.count_distinct_owner as number), 0);
    expect(folded).toBe(8);
    const outer = reduceHeaderQuery(CONTIGUOUS, compileListViewGroupQuery(view, { depth: 1 }));
    expect(outer.find((h) => h.business_unit === 'northgate_operations')!.count_distinct_owner).toBe(4);
    expect(folded).not.toBe(4);
  });

  it('groups the empty key as its own group, keyed null', () => {
    const rows: Row[] = [...CONTIGUOUS.slice(0, 3), { ...makeRow('x', 9), business_unit: null }];
    const headers = reduceHeaderQuery(rows, compileListViewGroupQuery({ grouping: { fields: [{ field: 'business_unit' }] } }));
    expect(headers).toContainEqual({ business_unit: null, count: 1 });
  });

  it('a column summary `count` IS the group count — it rides the count column, not a second node', () => {
    const query = compileListViewGroupQuery({
      grouping: { fields: [{ field: 'business_unit' }] },
      columns: [{ field: 'id', summary: 'count' }, { field: 'amount', summary: { type: 'count' } }],
    });
    expect(query.aggregations).toEqual([{ function: 'count', alias: 'count' }]);
  });

  it('the object form aggregates the named field, and identical summaries are one node', () => {
    const query = compileListViewGroupQuery({
      grouping: { fields: [{ field: 'business_unit' }] },
      columns: [
        { field: 'amount', summary: { type: 'sum', field: 'amount_in_base_currency' } },
        { field: 'amount_in_base_currency', summary: 'sum' },
        { field: 'notes', summary: 'none' },
      ],
    });
    expect(query.aggregations).toEqual([
      { function: 'count', alias: 'count' },
      { function: 'sum', field: 'amount_in_base_currency', alias: 'sum_amount_in_base_currency' },
    ]);
  });

  it('bare field-name columns declare no summary', () => {
    expect(compileListViewGroupQuery({ grouping: { fields: [{ field: 'status' }] }, columns: ['id', 'amount'] }).aggregations)
      .toEqual([{ function: 'count', alias: 'count' }]);
  });

  it('compiles from a view the schema accepts — the source is the declared ListView, not a private shape', () => {
    const view = ListViewSchema.parse({
      type: 'grid',
      columns: [{ field: 'name' }, { field: 'amount', summary: 'avg' }],
      grouping: { fields: [{ field: 'business_unit', order: 'desc' }] },
    });
    expect(compileListViewGroupQuery({ grouping: view.grouping!, columns: view.columns })).toEqual({
      groupBy: ['business_unit'],
      aggregations: [
        { function: 'count', alias: 'count' },
        { function: 'avg', field: 'amount', alias: 'avg_amount' },
      ],
    });
  });
});

// ─── The derived members (fork i, ruled) ─────────────────────────────────────

describe('count_filled / count_empty / percent_filled / percent_empty — ONE COUNT(field) node, derived on the header row', () => {
  const DERIVED_VIEW = {
    grouping: { fields: [{ field: 'business_unit' }] },
    columns: [
      { field: 'notes', summary: 'count_filled' as const },
      { field: 'id', summary: { type: 'count_empty' as const, field: 'notes' } },
      { field: 'notes', summary: 'percent_filled' as const },
      { field: 'amount', summary: 'percent_empty' as const },
    ],
  };

  it('compile to one `count_<field>` node per summarised field, beside the fieldless count', () => {
    expect(compileListViewGroupQuery(DERIVED_VIEW).aggregations).toEqual([
      { function: 'count', alias: 'count' },
      { function: 'count', field: 'notes', alias: 'count_notes' },
      { function: 'count', field: 'amount', alias: 'count_amount' },
    ]);
  });

  it.each([['contiguous', CONTIGUOUS], ['interleaved', INTERLEAVED]] as const)(
    'derive per unit from the header row, in %s order: filled / empty / the two ratios',
    (_order, rows) => {
      const headers = reduceHeaderQuery(rows, compileListViewGroupQuery(DERIVED_VIEW));
      for (const [unit, size] of UNITS) {
        const row = headers.find((h) => h.business_unit === unit)!;
        const empty = EXPECTED_EMPTY_NOTES[unit as keyof typeof EXPECTED_EMPTY_NOTES];
        expect(row.count).toBe(size);
        expect(deriveColumnSummary(row, 'count_filled', 'notes')).toBe(size - empty);
        expect(deriveColumnSummary(row, { type: 'count_empty', field: 'notes' }, 'id')).toBe(empty);
        expect(deriveColumnSummary(row, 'percent_filled', 'notes')).toBeCloseTo((size - empty) / size, 12);
        expect(deriveColumnSummary(row, 'percent_empty', 'notes')).toBeCloseTo(empty / size, 12);
      }
      // `amount` is never null: percent_empty is 0 everywhere.
      expect(headers.every((h) => deriveColumnSummary(h, 'percent_empty', 'amount') === 0)).toBe(true);
    },
  );

  it('an all-empty group reads filled 0 / percent_filled 0 / percent_empty 1; a count of 0 reads 0 and 1 — no division', () => {
    const allNull: Row[] = [5, 10, 15].map((n) => ({ ...makeRow('void_unit', n) }));
    const [row] = reduceHeaderQuery(allNull, compileListViewGroupQuery(DERIVED_VIEW));
    expect(row).toEqual({ business_unit: 'void_unit', count: 3, count_notes: 0, count_amount: 3 });
    expect(deriveColumnSummary(row, 'count_filled', 'notes')).toBe(0);
    expect(deriveColumnSummary(row, 'count_empty', 'notes')).toBe(3);
    expect(deriveColumnSummary(row, 'percent_filled', 'notes')).toBe(0);
    expect(deriveColumnSummary(row, 'percent_empty', 'notes')).toBe(1);
    const emptyGroup: ListViewGroupHeaderRow = { business_unit: 'x', count: 0, count_notes: 0 };
    expect(deriveColumnSummary(emptyGroup, 'percent_filled', 'notes')).toBe(0);
    expect(deriveColumnSummary(emptyGroup, 'percent_empty', 'notes')).toBe(1);
    expect(deriveColumnSummary(emptyGroup, 'count_empty', 'notes')).toBe(0);
  });

  it('reads the aggregate members off their own column, `none` and a missing column as undefined', () => {
    const row: ListViewGroupHeaderRow = { business_unit: 'x', count: 86, sum_amount: 3741, avg_amount: null };
    expect(deriveColumnSummary(row, 'count', 'anything')).toBe(86);
    expect(deriveColumnSummary(row, 'sum', 'amount')).toBe(3741);
    expect(deriveColumnSummary(row, 'avg', 'amount')).toBeNull();
    expect(deriveColumnSummary(row, 'min', 'amount')).toBeUndefined();
    expect(deriveColumnSummary(row, 'none', 'amount')).toBeUndefined();
    expect(deriveColumnSummary(row, 'count_filled', 'notes')).toBeUndefined();
  });

  it('a summary on a field named like the derived column collides loudly', () => {
    const err = refusal(() => compileListViewGroupQuery({
      grouping: { fields: [{ field: 'count_notes' }] },
      columns: [{ field: 'notes', summary: 'count_filled' }],
    }));
    expect(err.reason).toBe('alias_collision');
    expect(err.path).toEqual(['columns', 0, 'summary']);
  });
});

// ─── The mapping table ───────────────────────────────────────────────────────

describe('COLUMN_SUMMARY_AGGREGATION — one vocabulary, not two', () => {
  it('maps every member: six onto AggregationFunction, four by derivation from count, none as nothing', () => {
    expect(COLUMN_SUMMARY_AGGREGATION).toEqual({
      none: { kind: 'none' },
      count: { kind: 'aggregate', function: 'count', fieldless: true },
      count_unique: { kind: 'aggregate', function: 'count_distinct', fieldless: false },
      sum: { kind: 'aggregate', function: 'sum', fieldless: false },
      avg: { kind: 'aggregate', function: 'avg', fieldless: false },
      min: { kind: 'aggregate', function: 'min', fieldless: false },
      max: { kind: 'aggregate', function: 'max', fieldless: false },
      count_filled: { kind: 'derived', from: 'count', fieldless: false },
      count_empty: { kind: 'derived', from: 'count', fieldless: false },
      percent_filled: { kind: 'derived', from: 'count', fieldless: false },
      percent_empty: { kind: 'derived', from: 'count', fieldless: false },
    });
    expect(UNMAPPED_COLUMN_SUMMARIES).toEqual([]);
    expect(Object.values(COLUMN_SUMMARY_AGGREGATION).every((m) => m.kind !== 'unmapped')).toBe(true);
  });

  it('aliases a summary `<function>_<field>` and the fieldless count `count`', () => {
    expect(columnSummaryAlias('sum', 'amount')).toBe('sum_amount');
    expect(columnSummaryAlias('count_distinct', 'owner')).toBe('count_distinct_owner');
    expect(columnSummaryAlias('count', undefined)).toBe(LIST_VIEW_GROUP_COUNT_ALIAS);
    expect(columnSummaryAlias('count', 'notes')).toBe('count_notes');
  });

  it('an UNKNOWN summary value (no member at all) is INVALID_QUERY / 400 — a typo, not a capability gap', () => {
    const view = {
      grouping: { fields: [{ field: 'business_unit' }] },
      columns: [{ field: 'id' }, { field: 'amount', summary: 'median' as unknown as ColumnSummary }],
    };
    const err = refusal(() => compileListViewGroupQuery(view));
    expect(err).toBeInstanceOf(ListViewGroupQueryError);
    expect(err.reason).toBe('summary_unknown');
    expect(err.code).toBe('INVALID_QUERY');
    expect(err.status).toBe(400);
    expect(err.path).toEqual(['columns', 1, 'summary']);
    expect(err.message).toMatch(/^Column summary "median" on columns\[1\] \(field "amount"\) is not a column summary function\./);
    expect(err.message).not.toMatch(/#\d+/);
    const read = refusal(() => deriveColumnSummary({ count: 1 }, 'median' as unknown as ColumnSummary, 'amount'));
    expect(read.reason).toBe('summary_unknown');
    expect(read.status).toBe(400);
  });

  it('a DECLARED member with no counterpart stays NOT_IMPLEMENTED / 501 (summary_unmapped) — the machinery, kept for a future member', () => {
    const unmapped = new ListViewGroupQueryError('summary_unmapped', ['columns', 0, 'summary'], 'x');
    expect(unmapped.code).toBe(StandardErrorCode.enum.NOT_IMPLEMENTED);
    expect(unmapped.status).toBe(501);
    expect(unmapped.path).toEqual(['columns', 0, 'summary']);
    const unknown = new ListViewGroupQueryError('summary_unknown', [], 'x');
    expect(unknown.code).toBe(StandardErrorCode.enum.INVALID_QUERY);
    expect(unknown.status).toBe(400);
    const invalid = new ListViewGroupQueryError('alias_collision', [], 'x');
    expect(invalid.code).toBe(StandardErrorCode.enum.INVALID_QUERY);
    expect(invalid.status).toBe(400);
    expect(unmapped.name).toBe('ListViewGroupQueryError');
  });
});

// ─── Structural refusals ─────────────────────────────────────────────────────

describe('compileListViewGroupQuery — refuses what the contract cannot mean', () => {
  it('an alias landing on a grouped field\'s own column', () => {
    const err = refusal(() => compileListViewGroupQuery({
      grouping: { fields: [{ field: 'sum_amount' }] },
      columns: [{ field: 'amount', summary: 'sum' }],
    }));
    expect(err).toBeInstanceOf(ListViewGroupQueryError);
    expect(err.reason).toBe('alias_collision');
    expect(err.code).toBe('INVALID_QUERY');
    expect(err.status).toBe(400);
    expect(err.path).toEqual(['columns', 0, 'summary']);
  });

  it('a grouping field named `count` — it would share its column with the group count, summaries or not', () => {
    const bare = refusal(() => compileListViewGroupQuery({ grouping: { fields: [{ field: 'status' }, { field: 'count' }] } }));
    expect(bare.reason).toBe('alias_collision');
    expect(bare.code).toBe('INVALID_QUERY');
    expect(bare.path).toEqual(['grouping', 'fields', 1, 'field']);
    const withSummary = refusal(() => compileListViewGroupQuery({
      grouping: { fields: [{ field: 'count' }] },
      columns: [{ field: 'id', summary: 'count' }],
    }));
    expect(withSummary.reason).toBe('alias_collision');
    expect(withSummary.path).toEqual(['grouping', 'fields', 0, 'field']);
    // Past the compiled depth, the name is not a groupBy column and does not collide.
    expect(compileListViewGroupQuery({ grouping: { fields: [{ field: 'status' }, { field: 'count' }] } }, { depth: 1 }).groupBy)
      .toEqual(['status']);
  });

  it('an empty grouping', () => {
    const err = refusal(() => compileListViewGroupQuery({ grouping: { fields: [] } }));
    expect(err.reason).toBe('grouping_empty');
    expect(err.path).toEqual(['grouping', 'fields']);
    expect(err.status).toBe(400);
  });

  it('a blank grouping field', () => {
    const err = refusal(() => compileListViewGroupQuery({ grouping: { fields: [{ field: 'status' }, { field: ' ' }] } }));
    expect(err.reason).toBe('grouping_field_blank');
    expect(err.path).toEqual(['grouping', 'fields', 1, 'field']);
  });

  it.each([0, 3, 1.5, -1])('depth %s outside 1..2', (depth) => {
    const err = refusal(() => compileListViewGroupQuery(
      { grouping: { fields: [{ field: 'a' }, { field: 'b' }] } },
      { depth },
    ));
    expect(err.reason).toBe('depth_out_of_range');
    expect(err.code).toBe('INVALID_QUERY');
  });
});

// ─── The per-group row page ──────────────────────────────────────────────────

describe('compileListViewGroupRowsQuery — rows inside a group are the EXISTING paged find', () => {
  const VIEW = { grouping: { fields: [{ field: 'business_unit' }] } };
  const viewWhere = { status: { $eq: 'open' } };

  it('ANDs the group predicate into the view filter and carries the page', () => {
    expect(compileListViewGroupRowsQuery(VIEW, { business_unit: 'northgate_operations' }, { where: viewWhere, limit: 25, offset: 25 })).toEqual({
      where: { $and: [viewWhere, { business_unit: { $eq: 'northgate_operations' } }] },
      limit: 25,
      offset: 25,
    });
  });

  it('spells the empty group with the `$null` predicate — the spelling `is_empty` lowers to', () => {
    expect(compileListViewGroupRowsQuery(VIEW, { business_unit: null }, { limit: 10 })).toEqual({
      where: { $and: [{ business_unit: { $null: true } }] },
      limit: 10,
    });
    expect(listViewGroupKeyPredicate(VIEW.grouping, { business_unit: undefined })).toEqual([{ business_unit: { $null: true } }]);
  });

  it('a missing or empty view filter contributes no member', () => {
    expect(compileListViewGroupRowsQuery(VIEW, { business_unit: 'x' }).where).toEqual({ $and: [{ business_unit: { $eq: 'x' } }] });
    expect(compileListViewGroupRowsQuery(VIEW, { business_unit: 'x' }, { where: {} }).where).toEqual({ $and: [{ business_unit: { $eq: 'x' } }] });
  });

  it('passes `orderBy` and `fields` through to the find', () => {
    const query = compileListViewGroupRowsQuery(VIEW, { business_unit: 'x' }, {
      orderBy: [{ field: 'amount', order: 'desc' }],
      fields: ['id', 'amount'],
      limit: 5,
    });
    expect(query.orderBy).toEqual([{ field: 'amount', order: 'desc' }]);
    expect(query.fields).toEqual(['id', 'amount']);
    expect(query).not.toHaveProperty('offset');
  });

  it('opening the 86-row group pages its rows — every row reachable, none twice', () => {
    const pages: Row[][] = [];
    for (let offset = 0; offset < 200; offset += 50) {
      const query = compileListViewGroupRowsQuery(VIEW, { business_unit: 'northgate_operations' }, { limit: 50, offset });
      const page = INTERLEAVED
        .filter((r) => matches(r as unknown as Record<string, unknown>, query.where))
        .slice(query.offset, (query.offset ?? 0) + (query.limit ?? 0));
      if (page.length === 0) break;
      pages.push(page);
    }
    expect(pages.map((p) => p.length)).toEqual([50, 36]);
    const ids = pages.flat().map((r) => r.id);
    expect(new Set(ids).size).toBe(86);
    expect(pages.flat().every((r) => r.business_unit === 'northgate_operations')).toBe(true);
  });

  it('a two-level group key selects the leaf group; an outer-level key selects the outer group', () => {
    const grouping = { fields: [{ field: 'business_unit' }, { field: 'status' }] };
    expect(listViewGroupKeyPredicate(grouping, { business_unit: 'northgate_plant', status: 'done' })).toEqual([
      { business_unit: { $eq: 'northgate_plant' } },
      { status: { $eq: 'done' } },
    ]);
    expect(listViewGroupKeyPredicate(grouping, { business_unit: 'northgate_plant' })).toEqual([
      { business_unit: { $eq: 'northgate_plant' } },
    ]);
    const leaf = compileListViewGroupRowsQuery({ grouping }, { business_unit: 'northgate_plant', status: 'done' });
    expect(CONTIGUOUS.filter((r) => matches(r as unknown as Record<string, unknown>, leaf.where))).toHaveLength(2);
  });

  it('refuses a group key that is not a prefix of the nesting order', () => {
    const grouping = { fields: [{ field: 'business_unit' }, { field: 'status' }] };
    for (const key of [{ status: 'done' }, { business_unit: 'x', owner: 'y' }, {}]) {
      const err = refusal(() => listViewGroupKeyPredicate(grouping, key));
      expect(err).toBeInstanceOf(ListViewGroupQueryError);
      expect(err.reason).toBe('group_key_not_a_prefix');
      expect(err.code).toBe('INVALID_QUERY');
    }
  });

  it('group keys are scalar-valued — an array or object where a key should be is refused', () => {
    const grouping = { fields: [{ field: 'business_unit' }, { field: 'status' }] };
    const array = refusal(() => listViewGroupKeyPredicate(grouping, { business_unit: ['a', 'b'] }));
    expect(array.reason).toBe('group_key_not_scalar');
    expect(array.code).toBe('INVALID_QUERY');
    expect(array.status).toBe(400);
    expect(array.path).toEqual(['grouping', 'fields', 0, 'field']);
    const object = refusal(() => listViewGroupKeyPredicate(grouping, { business_unit: 'a', status: { id: 'done' } }));
    expect(object.reason).toBe('group_key_not_scalar');
    expect(object.path).toEqual(['grouping', 'fields', 1, 'field']);
    // Scalars of every stored kind, and a date instant, pass.
    const when = new Date('2026-09-04T00:00:00Z');
    expect(listViewGroupKeyPredicate({ fields: [{ field: 'n' }, { field: 'b' }, { field: 'd' }] }, { n: 7, b: false, d: when }))
      .toEqual([{ n: { $eq: 7 } }, { b: { $eq: false } }, { d: { $eq: when } }]);
  });
});
