// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type {
  IAnalyticsService,
  AnalyticsQuery,
  AnalyticsResult,
  DatasetSelection,
  DatasetCompareTo,
} from '@objectstack/spec/contracts';
import type { FilterCondition } from '@objectstack/spec/data';
import type { ExecutionContext } from '@objectstack/spec/kernel';
import type { CompiledDataset, DerivedMeasureSpec } from './dataset-compiler.js';

// Re-export the shared protocol shapes so existing importers keep working.
export type { DatasetSelection } from '@objectstack/spec/contracts';
/** @deprecated use DatasetCompareTo from @objectstack/spec/contracts */
export type CompareTo = DatasetCompareTo;

/**
 * Dataset executor (ADR-0021 WS2).
 *
 * Turns a compiled dataset + a presentation's selection (dimensions, measures,
 * runtime filter, compareTo) into one or more `AnalyticsQuery`s against the Cube
 * runtime, then post-processes the results:
 *   - resolves the base measures a selection needs (including derived deps),
 *   - applies measure-scoped filters via supplementary grouped queries,
 *   - evaluates derived measures (ratio/sum/difference/product) row-by-row (Q1),
 *   - shifts the query for `compareTo` (previousPeriod / previousYear) and
 *     attaches `<measure>__compare` columns.
 *
 * RLS/tenant scoping is NOT handled here — it is enforced inside the strategy
 * via the StrategyContext read-scope hook (D-C). This layer is pure query
 * shaping + arithmetic.
 */

/** AND two optional FilterConditions into one (MongoDB-style). */
export function combineFilters(
  a?: FilterCondition,
  b?: FilterCondition,
): FilterCondition | undefined {
  if (a && b) return { $and: [a, b] } as FilterCondition;
  return a ?? b;
}

/**
 * Evaluate derived measures on each aggregated row, mutating a shallow copy.
 * Division by zero (and missing operands) yields `null` rather than Infinity/NaN.
 */
export function evaluateDerivedMeasures(
  rows: Record<string, unknown>[],
  derived: DerivedMeasureSpec[],
): Record<string, unknown>[] {
  if (derived.length === 0) return rows;
  return rows.map((row) => {
    const out = { ...row };
    for (const d of derived) {
      out[d.name] = computeDerived(d, out);
    }
    return out;
  });
}

function num(v: unknown): number | null {
  if (v == null) return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

function computeDerived(d: DerivedMeasureSpec, row: Record<string, unknown>): number | null {
  const vals = d.of.map((name) => num(row[name]));
  if (vals.some((v) => v === null)) return null;
  const nums = vals as number[];
  switch (d.op) {
    case 'ratio': {
      if (nums.length < 2 || nums[1] === 0) return null;
      return nums[0] / nums[1];
    }
    case 'difference':
      return nums.slice(1).reduce((acc, v) => acc - v, nums[0]);
    case 'sum':
      return nums.reduce((acc, v) => acc + v, 0);
    case 'product':
      return nums.reduce((acc, v) => acc * v, 1);
    default:
      return null;
  }
}

// ── compareTo date math (deterministic — no Date.now) ────────────────────────

function parseUTC(date: string): number {
  // Accepts 'YYYY-MM-DD' (and ISO datetimes); interpreted as UTC.
  const ms = Date.parse(date.length === 10 ? `${date}T00:00:00Z` : date);
  if (Number.isNaN(ms)) throw new Error(`[dataset-executor] invalid date in dateRange: "${date}"`);
  return ms;
}

const DAY_MS = 86_400_000;

function toISODate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

function shiftYear(date: string, years: number): string {
  const d = new Date(parseUTC(date));
  d.setUTCFullYear(d.getUTCFullYear() + years);
  return toISODate(d.getTime());
}

/** Compute the comparison window for a [start,end] range. */
export function shiftRange(range: [string, string], kind: CompareTo['kind']): [string, string] {
  const [start, end] = range;
  if (kind === 'previousYear') {
    return [shiftYear(start, -1), shiftYear(end, -1)];
  }
  // previousPeriod — the equal-length window ending the day before `start`.
  const startMs = parseUTC(start);
  const endMs = parseUTC(end);
  const lengthDays = Math.round((endMs - startMs) / DAY_MS) + 1;
  const prevEndMs = startMs - DAY_MS;
  const prevStartMs = prevEndMs - (lengthDays - 1) * DAY_MS;
  return [toISODate(prevStartMs), toISODate(prevEndMs)];
}

export class DatasetExecutor {
  constructor(private readonly service: IAnalyticsService) {}

  /**
   * Execute a dataset selection and return the shaped rows (+ field metadata).
   *
   * @param context - The request's ExecutionContext, threaded into every
   *   underlying `IAnalyticsService.query` so the tenant/RLS read scope is
   *   applied per request (ADR-0021 D-C).
   */
  async execute(
    compiled: CompiledDataset,
    selection: DatasetSelection,
    context?: ExecutionContext,
  ): Promise<AnalyticsResult> {
    const derivedByName = new Map(compiled.derived.map((d) => [d.name, d]));
    const selectedDerived = selection.measures
      .map((m) => derivedByName.get(m))
      .filter((d): d is DerivedMeasureSpec => !!d);

    // Base measures = selected non-derived + dependencies of selected derived.
    const baseMeasures = new Set<string>();
    for (const m of selection.measures) {
      if (!derivedByName.has(m)) baseMeasures.add(m);
    }
    for (const d of selectedDerived) {
      for (const dep of d.of) baseMeasures.add(dep);
    }

    // Split measures into those with a scoped filter and those without.
    const unfiltered: string[] = [];
    const filtered: string[] = [];
    for (const m of baseMeasures) {
      (compiled.measureFilters[m] ? filtered : unfiltered).push(m);
    }

    const baseFilter = combineFilters(compiled.filter, selection.runtimeFilter);
    const dimensions = selection.dimensions ?? [];

    // Primary query: all unfiltered base measures in one pass. When every base
    // measure is filter-scoped, the supplementary queries below build the grid.
    let result: AnalyticsResult;
    if (unfiltered.length > 0 || filtered.length === 0) {
      result = await this.service.query(this.buildQuery(compiled, {
        measures: unfiltered,
        dimensions,
        where: baseFilter,
        selection,
      }), context);
    } else {
      result = { rows: [], fields: [] };
    }

    // Supplementary queries: one per measure-scoped filter, merged by dimension key.
    for (const m of filtered) {
      const mFilter = combineFilters(baseFilter, compiled.measureFilters[m]);
      const sub = await this.service.query(this.buildQuery(compiled, {
        measures: [m], dimensions, where: mFilter, selection,
      }), context);
      result.rows = mergeByDimensions(result.rows, sub.rows, dimensions, [m]);
      result.fields.push({ name: m, type: 'number' });
    }

    // compareTo — run a shifted query over the same base measures and attach.
    if (selection.compareTo) {
      const compareRows = await this.runCompare(compiled, selection, [...baseMeasures], dimensions, baseFilter, context);
      result.rows = mergeByDimensions(
        result.rows,
        compareRows,
        dimensions,
        [...baseMeasures].map((m) => `${m}__compare`),
      );
      for (const m of baseMeasures) result.fields.push({ name: `${m}__compare`, type: 'number' });
    }

    // Derived measures (computed from base + compare columns already present).
    result.rows = evaluateDerivedMeasures(result.rows, selectedDerived);
    for (const d of selectedDerived) result.fields.push({ name: d.name, type: 'number' });

    return result;
  }

  private buildQuery(
    compiled: CompiledDataset,
    opts: {
      measures: string[];
      dimensions: string[];
      where?: FilterCondition;
      selection: DatasetSelection;
    },
  ): AnalyticsQuery {
    const q: AnalyticsQuery = {
      cube: compiled.cube.name,
      measures: opts.measures,
      dimensions: opts.dimensions,
      timezone: opts.selection.timezone ?? 'UTC',
    };
    if (opts.where) q.where = opts.where as Record<string, unknown>;
    // Bucket selected date dimensions that declare an explicit `dateGranularity`
    // (the dataset compiled a single-entry `granularities`). Without this a date
    // dimension groups by the raw timestamp — one bucket per row, rendering epoch
    // millis on trend charts. A dimension already carried by `selection.timeDimensions`
    // (e.g. compareTo) keeps its entry; we never override it.
    const selTimeDims = opts.selection.timeDimensions ?? [];
    const selDims = new Set(selTimeDims.map((t) => t.dimension));
    const explicitTimeDims: Array<{ dimension: string; granularity: string }> = [];
    for (const name of opts.dimensions) {
      const cd = compiled.cube.dimensions[name];
      if (cd?.type === 'time' && cd.granularities?.length === 1 && !selDims.has(name)) {
        explicitTimeDims.push({ dimension: name, granularity: String(cd.granularities[0]) });
      }
    }
    const mergedTimeDims = [...selTimeDims, ...explicitTimeDims];
    if (mergedTimeDims.length > 0) q.timeDimensions = mergedTimeDims as AnalyticsQuery['timeDimensions'];
    if (opts.selection.order) q.order = opts.selection.order;
    if (opts.selection.limit != null) q.limit = opts.selection.limit;
    if (opts.selection.offset != null) q.offset = opts.selection.offset;
    return q;
  }

  private async runCompare(
    compiled: CompiledDataset,
    selection: DatasetSelection,
    measures: string[],
    dimensions: string[],
    baseFilter: FilterCondition | undefined,
    context?: ExecutionContext,
  ): Promise<Record<string, unknown>[]> {
    const cmp = selection.compareTo!;
    const td = (selection.timeDimensions ?? []).find((t) => t.dimension === cmp.dimension);
    if (!td || !td.dateRange) {
      throw new Error(
        `[dataset-executor] compareTo requires a timeDimension "${cmp.dimension}" with a dateRange.`,
      );
    }
    const range: [string, string] = Array.isArray(td.dateRange)
      ? [td.dateRange[0], td.dateRange[1] ?? td.dateRange[0]]
      : [td.dateRange, td.dateRange];
    const shifted = shiftRange(range, cmp.kind);
    const shiftedTd = (selection.timeDimensions ?? []).map((t) =>
      t.dimension === cmp.dimension ? { ...t, dateRange: shifted } : t,
    );
    const sub = await this.service.query({
      cube: compiled.cube.name,
      measures,
      dimensions,
      where: baseFilter as Record<string, unknown> | undefined,
      timeDimensions: shiftedTd,
      timezone: selection.timezone ?? 'UTC',
    }, context);
    // Rename measure columns to `<measure>__compare` so they merge alongside primary.
    return sub.rows.map((row) => {
      const out: Record<string, unknown> = {};
      for (const dim of dimensions) out[dim] = row[dim];
      for (const m of measures) out[`${m}__compare`] = row[m];
      return out;
    });
  }
}

/**
 * Left-merge `extra` rows onto `base` rows by their dimension-key tuple,
 * copying the listed value columns. Rows in `extra` with no base match are
 * appended (outer-ish merge so comparison-only buckets still surface).
 */
export function mergeByDimensions(
  base: Record<string, unknown>[],
  extra: Record<string, unknown>[],
  dimensions: string[],
  valueColumns: string[],
): Record<string, unknown>[] {
  const keyOf = (row: Record<string, unknown>) => dimensions.map((d) => String(row[d] ?? '')).join('');
  const index = new Map<string, Record<string, unknown>>();
  for (const row of base) index.set(keyOf(row), row);

  for (const row of extra) {
    const key = keyOf(row);
    const target = index.get(key);
    if (target) {
      for (const c of valueColumns) target[c] = row[c];
    } else {
      const fresh: Record<string, unknown> = {};
      for (const d of dimensions) fresh[d] = row[d];
      for (const c of valueColumns) fresh[c] = row[c];
      index.set(key, fresh);
      base.push(fresh);
    }
  }
  return base;
}
