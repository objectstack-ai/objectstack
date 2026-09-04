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
  listViewGroupKeyPredicate,
} from './view-grouping-query';

// ─── The acceptance fixture ──────────────────────────────────────────────────

interface Row {
  id: string;
  business_unit: string | null;
  status: 'open' | 'done';
  amount: number;
  owner: string;
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

function reduceHeaderQuery(rows: Row[], query: EngineAggregateOptions): Record<string, unknown>[] {
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
        case 'count': out[agg.alias] = agg.field ? values.filter((v) => v != null).length : bucketRows.length; break;
        case 'count_distinct': out[agg.alias] = new Set(values.filter((v) => v != null)).size; break;
        case 'sum': out[agg.alias] = nums.reduce((a, b) => a + b, 0); break;
        case 'avg': out[agg.alias] = nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : null; break;
        case 'min': out[agg.alias] = nums.length ? Math.min(...nums) : null; break;
        case 'max': out[agg.alias] = nums.length ? Math.max(...nums) : null; break;
      }
    }
    return out;
  });
}

/** Header rows → `{ unit: count }`, the shape a reader compares. */
function countsByUnit(headers: Record<string, unknown>[]): Record<string, number> {
  return Object.fromEntries(headers.map((h) => [String(h.business_unit), h[LIST_VIEW_GROUP_COUNT_ALIAS] as number]));
}

/** What a page-scoped grouping (the interim, objectui `useGroupedData`) shows on the first window. */
function pageScopedCounts(rows: Row[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const row of rows.slice(0, PAGE_SIZE)) counts[String(row.business_unit)] = (counts[String(row.business_unit)] ?? 0) + 1;
  return counts;
}

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
    expect((opsOpen.count as number) + (opsDone.count as number)).toBe(EXPECTED_COUNTS.northgate_operations);
  });

  it('`depth` compiles an outer level\'s own query — the first N grouping fields', () => {
    const view = { grouping: { fields: [{ field: 'business_unit' }, { field: 'status' }] } };
    expect(compileListViewGroupQuery(view, { depth: 1 }).groupBy).toEqual(['business_unit']);
    expect(compileListViewGroupQuery(view, { depth: 2 }).groupBy).toEqual(['business_unit', 'status']);
    expect(countsByUnit(reduceHeaderQuery(INTERLEAVED, compileListViewGroupQuery(view, { depth: 1 })))).toEqual(EXPECTED_COUNTS);
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

// ─── The mapping table (fork i) ──────────────────────────────────────────────

describe('COLUMN_SUMMARY_AGGREGATION — one vocabulary, not two', () => {
  it('maps count / count_unique / sum / avg / min / max onto AggregationFunction and names the unmapped members', () => {
    expect(COLUMN_SUMMARY_AGGREGATION).toEqual({
      none: { kind: 'none' },
      count: { kind: 'aggregate', function: 'count', fieldless: true },
      count_unique: { kind: 'aggregate', function: 'count_distinct', fieldless: false },
      sum: { kind: 'aggregate', function: 'sum', fieldless: false },
      avg: { kind: 'aggregate', function: 'avg', fieldless: false },
      min: { kind: 'aggregate', function: 'min', fieldless: false },
      max: { kind: 'aggregate', function: 'max', fieldless: false },
      count_empty: { kind: 'unmapped' },
      count_filled: { kind: 'unmapped' },
      percent_empty: { kind: 'unmapped' },
      percent_filled: { kind: 'unmapped' },
    });
    expect(UNMAPPED_COLUMN_SUMMARIES).toEqual(['count_empty', 'count_filled', 'percent_empty', 'percent_filled']);
  });

  it('aliases a summary `<function>_<field>` and the fieldless count `count`', () => {
    expect(columnSummaryAlias('sum', 'amount')).toBe('sum_amount');
    expect(columnSummaryAlias('count_distinct', 'owner')).toBe('count_distinct_owner');
    expect(columnSummaryAlias('count', undefined)).toBe(LIST_VIEW_GROUP_COUNT_ALIAS);
    expect(columnSummaryAlias('count', 'owner')).toBe('count_owner');
  });

  it.each(['count_empty', 'count_filled', 'percent_empty', 'percent_filled'] as const)(
    'refuses a `%s` summary LOUDLY at compile time — code, status and the path of the summary',
    (member) => {
      const view = {
        grouping: { fields: [{ field: 'business_unit' }] },
        columns: [{ field: 'id' }, { field: 'notes', summary: member }],
      };
      let caught: unknown;
      try { compileListViewGroupQuery(view); } catch (e) { caught = e; }
      expect(caught).toBeInstanceOf(ListViewGroupQueryError);
      const err = caught as ListViewGroupQueryError;
      expect(err.code).toBe('NOT_IMPLEMENTED');
      expect(err.status).toBe(501);
      expect(err.reason).toBe('summary_unmapped');
      expect(err.path).toEqual(['columns', 1, 'summary']);
      expect(err.message).toMatch(new RegExp(`^Column summary "${member}" on columns\\[1\\] \\(field "notes"\\) has no counterpart in the aggregation vocabulary`));
      expect(err.message).toContain('is an open contract question; until it is ruled, remove the summary from this column');
      expect(err.message).toContain('Nothing is dropped silently.');
      // The refusal is printed at the author: no issue-id token (maintainer ruling 2026-08-12).
      expect(err.message).not.toMatch(/#\d+/);
    },
  );

  it('the refusal codes are standard-catalog members (ADR-0112) — pinned so the literals cannot drift', () => {
    const unmapped = new ListViewGroupQueryError('summary_unmapped', [], 'x');
    expect(unmapped.code).toBe(StandardErrorCode.enum.NOT_IMPLEMENTED);
    expect(unmapped.status).toBe(501);
    const invalid = new ListViewGroupQueryError('alias_collision', [], 'x');
    expect(invalid.code).toBe(StandardErrorCode.enum.INVALID_QUERY);
    expect(invalid.status).toBe(400);
    expect(unmapped.name).toBe('ListViewGroupQueryError');
  });
});

// ─── Structural refusals ─────────────────────────────────────────────────────

describe('compileListViewGroupQuery — refuses what the contract cannot mean', () => {
  const refusal = (fn: () => unknown): ListViewGroupQueryError => {
    try { fn(); } catch (e) { return e as ListViewGroupQueryError; }
    throw new Error('expected a ListViewGroupQueryError');
  };

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
      let caught: unknown;
      try { listViewGroupKeyPredicate(grouping, key); } catch (e) { caught = e; }
      expect(caught).toBeInstanceOf(ListViewGroupQueryError);
      expect((caught as ListViewGroupQueryError).reason).toBe('group_key_not_a_prefix');
      expect((caught as ListViewGroupQueryError).code).toBe('INVALID_QUERY');
    }
  });
});
