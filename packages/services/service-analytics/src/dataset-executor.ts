// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type {
  IAnalyticsService,
  AnalyticsQuery,
  AnalyticsResult,
  DatasetSelection,
  DatasetCompareTo,
} from '@objectstack/spec/contracts';
import { emptyGroupValueFor, type FilterCondition } from '@objectstack/spec/data';
import type { ExecutionContext } from '@objectstack/spec/kernel';
import { filterTokenContextFrom, resolveFilterTokens } from '@objectstack/core';
import type { CompiledDataset, DerivedMeasureSpec } from './dataset-compiler.js';
import type { OrderLabelResolver } from './dimension-labels.js';

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
 *   - fills the empty-group value into columns no query reported, by aggregate
 *     kind (#4708) — a count/sum over an excluded group is 0, avg/min/max null,
 *   - evaluates derived measures (ratio/sum/difference/product) row-by-row (Q1),
 *   - shifts the query for `compareTo` (previousPeriod / previousYear) and
 *     attaches `<measure>__compare` columns,
 *   - computes server-side totals (`selection.totals.groupings`, #1753) by
 *     re-running the selection per dimension subset, so matrix subtotals and
 *     the grand total use each measure's true aggregate,
 *   - orders and windows the final grid (`order` / `limit` / `offset`, #3588).
 *
 * **Where ordering happens, and why here.** `order`/`limit`/`offset` are applied
 * to the ASSEMBLED grid — after measure-scoped sub-queries are merged in, after
 * `compareTo` columns are attached, and after derived measures are computed —
 * never by forwarding them blindly to every sub-query. Two reasons:
 *
 *  1. **Correctness.** A supplementary measure-scoped query selects ONE measure;
 *     forwarding `ORDER BY <other_measure>` to it emits SQL referencing a column
 *     that query never selects, and forwarding `LIMIT` truncates it before the
 *     merge, so rows silently vanish from the grid. A derived measure has no SQL
 *     column at all, yet is a perfectly reasonable sort key.
 *  2. **Coverage.** Only `NativeSQLStrategy` honours `order`/`limit`; the
 *     ObjectQL aggregate path has nowhere to put them (`EngineAggregateOptions`
 *     has no ordering grammar), and date-bucketed queries are *forced* down that
 *     path because native SQL declines granularity. Sorting here makes ordering
 *     work identically on every driver and strategy.
 *
 * The single-query case still pushes `order`/`limit`/`offset` DOWN into the SQL
 * (see `canPushDownWindow`) so the database does the work and the echoed `sql`
 * shows it; the post-pass is then a no-op re-sort of already-sorted rows.
 *
 * **What the sort key IS for a label-bearing dimension (#3680).** An order key
 * naming a `select` or `lookup`/`master_detail` dimension sorts by the DISPLAY
 * label the response will carry (option label / related record name), not the
 * stored value — a "sort by Account" ordered by opaque FK ids presents as
 * arbitrary once the labels render. The mapping comes through an injected
 * {@link OrderLabelResolver} (built by `queryDataset` over the same
 * label-resolution capabilities the display pass uses); rows keep their raw
 * values — only the COMPARISON substitutes the label — so drill metadata still
 * snapshots stored values downstream. Such keys are never pushed into SQL (the
 * label is not a column there), and the label fetch happens BEFORE `applyWindow`
 * so a "top 10 by account name" truncates the right ten.
 *
 * RLS/tenant scoping is NOT handled here — it is enforced inside the strategy
 * via the StrategyContext read-scope hook (D-C). This layer is pure query
 * shaping + arithmetic; the order-label hook is an injected interface, not an
 * engine dependency.
 */

/**
 * Expand `{filter-placeholder}` values across everything a dataset query
 * compares on (framework#3582): the dataset's intrinsic `filter`, the
 * presentation's `runtimeFilter` (a dashboard widget's own scope), every
 * measure-scoped filter, and the `dateRange` bounds of the selection's time
 * dimensions.
 *
 * The dashboard path needs its own call rather than inheriting the ObjectQL
 * engine's: `NativeSQLStrategy` compiles a raw `SELECT … WHERE` and binds
 * comparands directly, so a widget filtered on `{current_year_start}` never
 * passes through `engine.find()` at all — which is exactly why the token
 * reached SQLite as the literal text and every such widget rendered zero.
 *
 * Inputs are treated as immutable: a `CompiledDataset` lives in the service's
 * registry across requests, so resolving in place would bake one request's
 * user id (and one day's dates) into every later render. New objects are
 * allocated only when the tree actually held a placeholder.
 */
function resolveSelectionTokens(
  compiled: CompiledDataset,
  selection: DatasetSelection,
  context?: ExecutionContext,
): { compiled: CompiledDataset; selection: DatasetSelection } {
  // One instant for the whole call: the intrinsic filter, the runtime filter
  // and each measure filter are resolved in separate passes, and a query whose
  // pieces disagreed about "now" could straddle a period boundary — the primary
  // grid scoped to this month while a measure-scoped sub-query saw the next.
  const tokenCtx = filterTokenContextFrom(context, new Date());
  const resolve = <T>(v: T): T => resolveFilterTokens(v, tokenCtx);

  const filter = resolve(compiled.filter);
  const measureFilters = resolve(compiled.measureFilters);
  const runtimeFilter = resolve(selection.runtimeFilter);
  const timeDimensions = selection.timeDimensions?.map((td) =>
    td.dateRange == null ? td : { ...td, dateRange: resolve(td.dateRange) },
  );

  const compiledChanged =
    filter !== compiled.filter || measureFilters !== compiled.measureFilters;
  const selectionChanged =
    runtimeFilter !== selection.runtimeFilter ||
    (timeDimensions !== undefined &&
      timeDimensions.some((td, i) => td !== selection.timeDimensions![i]));

  return {
    compiled: compiledChanged ? { ...compiled, filter, measureFilters } : compiled,
    selection: selectionChanged ? { ...selection, runtimeFilter, timeDimensions } : selection,
  };
}

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

/**
 * Fill the EMPTY-GROUP value into every measure column the assembled grid
 * LISTS but no query REPORTED — by aggregate kind (#4708, objectui#3136).
 *
 * The grid is assembled from several results: the primary query, one
 * supplementary query per measure-scoped filter, and (for `compareTo`) a
 * shifted pass. {@link mergeByDimensions} writes a measure's column only onto
 * rows its source result returned, and a `GROUP BY` over a filtered row set
 * emits NO group at all for a dimension value the filter excludes entirely.
 * The column therefore comes back **absent**, not `0` — and absent renders as
 * "no data for this row", which for a count is the opposite of what the row
 * means. A derived ratio over it goes null as well ({@link computeDerived}
 * treats a missing operand as unknowable), so the blank spreads.
 *
 * The bias runs the worst possible way: the rows that blank are the ones whose
 * numerator the filter excluded — the WORST-performing rows. A `lead_source`
 * that won nothing renders as "no data" while one that won everything renders
 * fine.
 *
 * **Filled strictly by aggregate kind**, never wholesale. `count` /
 * `count_distinct` over an excluded group is unambiguously `0` ("how many rows
 * matched" has an exact answer when the answer is none), and `sum` over the
 * empty set is its identity `0`. `avg` / `min` / `max` are genuinely null —
 * there is nothing to average — and flattening those to `0` would trade this
 * lie for the opposite one, reporting a measurement nobody made. The
 * kind→identity mapping is `emptyGroupValueFor` in `@objectstack/spec/data`,
 * shared with the authoring-side coherence checks so the two cannot drift.
 *
 * **Only rows that already exist are touched** — no group is invented. A
 * dimension value no query reported at all has genuinely no data and stays out
 * of the grid; this fills the cell, never the row.
 *
 * Deliberately NOT a `?? 0` in the widget or a `coalesce` in the measure: a
 * consumer-side patch must be repeated by every author of every ratio widget
 * forever, and forgetting it is silent. Only the executor knows which aggregate
 * produced the gap, so only the executor can tell `0` from unknown.
 *
 * Mutates `rows` in place (they are already this pipeline's own copies) and
 * returns them for chaining.
 *
 * @param columnAggregates - Grid column → the aggregate that produced it.
 *   Includes `<measure>__compare` columns, which merge through the same seam.
 */
export function fillEmptyGroups(
  rows: Record<string, unknown>[],
  columnAggregates: Record<string, string | undefined>,
): Record<string, unknown>[] {
  for (const [column, aggregate] of Object.entries(columnAggregates)) {
    const empty = emptyGroupValueFor(aggregate);
    if (empty === undefined) continue;
    for (const row of rows) if (row[column] == null) row[column] = empty;
  }
  return rows;
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

// ── date bucketing (#3588) ───────────────────────────────────────────────────

/** The date-bucket vocabulary shared by the dataset, the selection, and the
 *  bucketing utilities in `@objectstack/core`. */
export type DateGranularityValue = NonNullable<DatasetSelection['dateGranularity']>;

/**
 * The EFFECTIVE bucket size for one date dimension of a selection — the single
 * source of truth for granularity precedence.
 *
 * Precedence, per dimension:
 *   1. a `granularity` already stated on that dimension's `timeDimensions`
 *      entry — never overridden;
 *   2. `selection.dateGranularity` — the presentation's choice, so a widget can
 *      bucket by month without the dataset committing every consumer to it;
 *   3. `datasetDefault` — the dataset dimension's own `dateGranularity`.
 *
 * The unit of precedence is the GRANULARITY, not the entry: a `timeDimensions`
 * entry carrying only a `dateRange` (what `compareTo` needs) states a WINDOW,
 * not a bucket size, and must not suppress bucketing.
 *
 * **Why this is exported.** The bucket size chosen here decides three things
 * that MUST agree: the `GROUP BY` the query compiles to, the humanized label
 * each bucket key is rendered as, and the half-open `[gte, lt)` range a bucket
 * drills into. When the query layer resolved granularity and the post-processing
 * in `analytics-service` read the dataset default instead, they silently
 * disagreed for every selection that overrode it — a `year` query came back
 * labelled `1970-01` (a year bucket re-formatted as a month), a `day` query
 * collapsed to duplicate month labels, and `quarter`/`year` lost their drill
 * ranges entirely. One function, called from all three sites, is what stops
 * that drift recurring.
 */
export function resolveDimensionGranularity(
  selection: Pick<DatasetSelection, 'timeDimensions' | 'dateGranularity'>,
  dimension: string,
  datasetDefault?: string,
): DateGranularityValue | undefined {
  // `timeDimensions[].granularity` and the compiled cube's `granularities` are
  // both typed as bare strings by their own layers (Cube.js heritage), but the
  // only values that reach here come from the dataset/selection granularity
  // vocabulary — the same five the bucketing utilities accept.
  const stated = (selection.timeDimensions ?? []).find((t) => t.dimension === dimension)?.granularity;
  if (stated) return stated as DateGranularityValue;
  return selection.dateGranularity ?? (datasetDefault as DateGranularityValue | undefined);
}

// ── ordering + windowing (#3588) ─────────────────────────────────────────────

/**
 * Compare two grouped-cell values for ORDER BY, ascending.
 *
 * Nulls sort LAST regardless of direction (the SQL `NULLS LAST` convention, and
 * the one users expect: an empty bucket shouldn't win a "top 10 by revenue").
 * The caller negates the result for `desc`, so the null branch deliberately
 * returns its verdict BEFORE that negation can flip it — see `compareRows`.
 *
 * Numbers (and numeric strings, which is how some drivers return SUM results)
 * compare numerically so 9 sorts below 10; everything else compares as a string.
 * Dates arrive here already bucketed to sort-stable keys ("2026-04", "2026-Q2"),
 * so lexicographic ordering is chronological for them too.
 */
function compareValues(a: unknown, b: unknown): number {
  const aNull = a == null || a === '';
  const bNull = b == null || b === '';
  if (aNull || bNull) return aNull && bNull ? 0 : aNull ? 1 : -1;
  if (a instanceof Date || b instanceof Date) {
    return Number(a instanceof Date ? a.getTime() : a) - Number(b instanceof Date ? b.getTime() : b);
  }
  if (typeof a === 'boolean' || typeof b === 'boolean') {
    return Number(a) - Number(b);
  }
  const an = typeof a === 'number' ? a : Number(a);
  const bn = typeof b === 'number' ? b : Number(b);
  if (Number.isFinite(an) && Number.isFinite(bn)) return an - bn;
  return String(a).localeCompare(String(b));
}

/**
 * Order rows by each key in `order`, in the object's own key order (first key is
 * the primary sort). Returns a NEW array; the input is not mutated. Null/empty
 * cells stay last in both directions (see {@link compareValues}).
 *
 * `sortKeys` substitutes the COMPARED value per key (#3680): when it holds a map
 * for an order key, each cell compares by its mapped value — the display label a
 * label-bearing dimension will render as — falling back to the raw cell where
 * unmapped (an orphaned id or RLS-hidden record renders raw too, so sort and
 * display stay consistent). The rows themselves are never rewritten here.
 */
export function applyOrdering(
  rows: Record<string, unknown>[],
  order: Record<string, 'asc' | 'desc'> | undefined,
  sortKeys?: Record<string, Map<unknown, unknown>>,
): Record<string, unknown>[] {
  const keys = Object.entries(order ?? {});
  if (keys.length === 0 || rows.length < 2) return rows;
  // Array.prototype.sort is stable (ES2019+), so equal rows keep the order the
  // grouping produced — an important property for reproducible LIMITs.
  return [...rows].sort((ra, rb) => {
    for (const [key, dir] of keys) {
      const map = sortKeys?.[key];
      const av = map?.get(ra[key]) ?? ra[key];
      const bv = map?.get(rb[key]) ?? rb[key];
      const aNull = av == null || av === '';
      const bNull = bv == null || bv === '';
      // Nulls last in BOTH directions — decided before `desc` negation.
      if (aNull || bNull) {
        if (aNull && bNull) continue;
        return aNull ? 1 : -1;
      }
      const c = compareValues(av, bv);
      if (c !== 0) return dir === 'desc' ? -c : c;
    }
    return 0;
  });
}

/** Apply `offset`/`limit` to an already-ordered grid. */
export function applyWindow(
  rows: Record<string, unknown>[],
  limit?: number,
  offset?: number,
): Record<string, unknown>[] {
  const start = offset != null && offset > 0 ? offset : 0;
  if (start === 0 && limit == null) return rows;
  return rows.slice(start, limit != null ? start + limit : undefined);
}

/**
 * Validate `order` keys and resolve the EFFECTIVE ordering for a selection.
 *
 * A key must name something the caller actually selected — a dimension, a
 * measure, or a `<measure>__compare` column. An unknown key throws rather than
 * being dropped: silently ignoring `sortBy` is precisely the failure mode this
 * change exists to remove (#3588), and a mistyped sort key that quietly returns
 * arbitrarily-ordered rows is worse than a loud 400.
 *
 * When `limit`/`offset` is requested WITHOUT an order, the selected dimensions
 * ascending become the implicit ordering, so the truncated window is
 * reproducible instead of "whatever the group-by happened to emit".
 *
 * Failing both, a selected TIME dimension defaults to ASCENDING (#3916). A time
 * axis has one order a reader expects — chronological — and until this default
 * existed nothing supplied it anywhere in the stack: the aggregate path has no
 * ordering grammar, so buckets came back in Map-insertion order, and the pivot
 * builds its column headers in row-arrival order. A month-bucketed matrix
 * therefore rendered `2026-07-01, 2026-07-05, …, 2026-07-02`. Bucket keys are
 * minted sort-stable for exactly this (`2026-07`, `2026-Q3`, `2026-W31`), so
 * ascending IS chronological. An explicit `order` still wins outright — this is
 * a default, not a policy — and non-time dimensions keep whatever order the
 * grouping produced unless the caller asks.
 *
 * @param timeDimensions - The selected dimensions the cube types as `time`, in
 *   selection order. The executor resolves these (it owns the cube); passing
 *   them in keeps this function pure and directly testable.
 */
export function resolveOrdering(
  selection: DatasetSelection,
  dimensions: string[],
  timeDimensions: string[] = [],
): Record<string, 'asc' | 'desc'> | undefined {
  const order = selection.order;
  if (order && Object.keys(order).length > 0) {
    const selectable = new Set<string>([
      ...dimensions,
      ...selection.measures,
      ...selection.measures.map((m) => `${m}__compare`),
    ]);
    const unknown = Object.keys(order).filter((k) => !selectable.has(k));
    if (unknown.length) {
      throw new Error(
        `[dataset-executor] order key(s) ${unknown.map((k) => `"${k}"`).join(', ')} — ` +
        `not a selected dimension or measure. Selectable here: ` +
        `${[...selectable].join(', ') || '(none)'}.`,
      );
    }
    return order;
  }
  // Implicit, deterministic ordering so a bare `limit` is reproducible.
  if ((selection.limit != null || selection.offset != null) && dimensions.length > 0) {
    return Object.fromEntries(dimensions.map((d) => [d, 'asc' as const]));
  }
  // #3916 — chronological by default on the time axis.
  const timeKeys = timeDimensions.filter((d) => dimensions.includes(d));
  if (timeKeys.length > 0) {
    return Object.fromEntries(timeKeys.map((d) => [d, 'asc' as const]));
  }
  return undefined;
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
  /**
   * @param service - The analytics service the executor issues its queries to.
   * @param orderLabels - Optional sort-key label hook (#3680). When provided,
   *   an order key naming a label-bearing (`select`/`lookup`) dimension sorts
   *   by its display label instead of the stored value. Omit to sort by stored
   *   values everywhere (e.g. the draft-preview path, whose seed rows already
   *   carry display names).
   */
  constructor(
    private readonly service: IAnalyticsService,
    private readonly orderLabels?: OrderLabelResolver,
  ) {}

  /**
   * Execute a dataset selection and return the shaped rows (+ field metadata).
   *
   * @param context - The request's ExecutionContext, threaded into every
   *   underlying `IAnalyticsService.query` so the tenant/RLS read scope is
   *   applied per request (ADR-0021 D-C).
   */
  async execute(
    compiledInput: CompiledDataset,
    selectionInput: DatasetSelection,
    context?: ExecutionContext,
  ): Promise<AnalyticsResult> {
    // framework#3582 — expand `{current_quarter_start}` / `{current_user_id}`
    // placeholders BEFORE any query is shaped, once for the whole call so every
    // sub-query (measure-scoped, totals, compareTo) shares one instant.
    const { compiled, selection } = resolveSelectionTokens(compiledInput, selectionInput, context);

    const result = await this.executeSelection(compiled, selection, context);

    // Server-side totals (#1753) — re-run the selection grouped by each
    // requested dimension subset, so a subtotal/grand total is the measure's
    // TRUE aggregate over the underlying rows (an avg total is the average of
    // all rows, not of bucket averages). Re-running the full pipeline keeps
    // measure-scoped filters, derived measures, and compareTo consistent with
    // the primary grid. order/limit/offset are dropped: totals cover the whole
    // selection, and an order key may reference a dimension the grouping drops.
    const groupings = selection.totals?.groupings;
    if (groupings?.length) {
      const selected = new Set(selection.dimensions ?? []);
      const totals: NonNullable<AnalyticsResult['totals']> = [];
      for (const grouping of groupings) {
        const unknown = grouping.filter((d) => !selected.has(d));
        if (unknown.length) {
          throw new Error(
            `[dataset-executor] totals grouping [${grouping.join(', ')}] is not a subset of the selected dimensions — unknown: ${unknown.join(', ')}.`,
          );
        }
        const sub = await this.executeSelection(compiled, {
          ...selection,
          dimensions: grouping,
          totals: undefined,
          order: undefined,
          limit: undefined,
          offset: undefined,
        }, context);
        totals.push({ dimensions: grouping, rows: sub.rows });
      }
      result.totals = totals;
    }

    return result;
  }

  private async executeSelection(
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

    // Effective ordering — validated against what this selection projects, with
    // a deterministic dimension order synthesized for a bare `limit` (#3588) and
    // an ascending default on the time axis (#3916).
    const order = resolveOrdering(selection, dimensions, this.timeDimensionsOf(compiled, dimensions));

    // #3680 — order keys naming a select/lookup dimension sort by the DISPLAY
    // label the response will carry, not the stored value / FK id. Resolved
    // over the assembled grid below; identified up front because such a key
    // also disqualifies SQL pushdown (the label is not a column the database
    // could ORDER BY, and a SQL LIMIT would truncate the wrong window).
    const labelOrderKeys = this.orderLabels
      ? Object.keys(order ?? {}).filter(
          (k) => dimensions.includes(k) && this.orderLabels!.isLabelBearing(k),
        )
      : [];

    // Push `order`/`limit`/`offset` down into the SQL only when this selection
    // is ONE query whose columns can satisfy them. With supplementary
    // measure-scoped queries, a compareTo pass, or derived measures in play, the
    // grid is assembled from several results — a sub-query LIMIT would drop rows
    // before the merge and an ORDER BY would name a column that sub-query never
    // selects. Those cases order in memory below instead.
    const singleQuery = filtered.length === 0 && !selection.compareTo && selectedDerived.length === 0;
    const pushDownKeys = new Set<string>([...dimensions, ...unfiltered]);
    const canPushDownWindow =
      singleQuery && labelOrderKeys.length === 0 &&
      Object.keys(order ?? {}).every((k) => pushDownKeys.has(k));
    const windowQuery = canPushDownWindow
      ? { order, limit: selection.limit, offset: selection.offset }
      : undefined;

    // Primary query: all unfiltered base measures in one pass. When every base
    // measure is filter-scoped, the supplementary queries below build the grid.
    let result: AnalyticsResult;
    if (unfiltered.length > 0 || filtered.length === 0) {
      result = await this.service.query(this.buildQuery(compiled, {
        measures: unfiltered,
        dimensions,
        where: baseFilter,
        selection,
        contextTimezone: context?.timezone,
        window: windowQuery,
      }), context);
    } else {
      result = { rows: [], fields: [] };
    }

    // Supplementary queries: one per measure-scoped filter, merged by dimension key.
    for (const m of filtered) {
      const mFilter = combineFilters(baseFilter, compiled.measureFilters[m]);
      const sub = await this.service.query(this.buildQuery(compiled, {
        measures: [m], dimensions, where: mFilter, selection,
        contextTimezone: context?.timezone,
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

    // Empty-group fill (#4708) — a group a query never reported reads `0` for a
    // count/sum and stays null for avg/min/max. See {@link fillEmptyGroups} for
    // why this belongs to the executor and not to every widget author.
    //
    // Placed after EVERY merge and before the derived pass, because each merge
    // is a place a column can go missing and `mergeByDimensions` APPENDS rows:
    //   - a supplementary measure-scoped query omits the groups its filter
    //     excluded (the "won nothing" rows — the original defect);
    //   - a later supplementary query can append rows for dimension keys no
    //     earlier query saw, and those need the same fill;
    //   - the compareTo pass appends a row for every bucket that existed in the
    //     PREVIOUS window and not in this one, on which *every* base measure is
    //     absent — including unfiltered ones, which is why the fill covers all
    //     base measures rather than only the filter-scoped ones.
    // Running it before the compare merge left that last class blank, so a lead
    // source that sold last month and nothing this month rendered as "no data"
    // instead of 0 — the same worst-row bias, one merge later.
    //
    // Derived measures are evaluated AFTER, so a ratio over a filled 0 computes
    // (0%) instead of being poisoned by an absent operand.
    const fillColumns: Record<string, string | undefined> = {};
    for (const m of baseMeasures) {
      const aggregate = compiled.cube.measures?.[m]?.type;
      fillColumns[m] = aggregate;
      if (selection.compareTo) fillColumns[`${m}__compare`] = aggregate;
    }
    fillEmptyGroups(result.rows, fillColumns);

    // Derived measures (computed from base + compare columns already present).
    result.rows = evaluateDerivedMeasures(result.rows, selectedDerived);
    for (const d of selectedDerived) result.fields.push({ name: d.name, type: 'number' });

    // Order + window the assembled grid (#3588). Every column the caller may
    // sort by exists by now — merged measure-scoped values, `__compare`
    // columns, and derived measures included. When the window was already
    // pushed into SQL this re-sorts an already-sorted grid (a no-op) and
    // re-slices an already-sliced one; when it could not be (the ObjectQL
    // aggregate path has no ordering grammar, and date-bucketed queries are
    // forced down it), this is what makes `sortBy` work at all.
    //
    // #3680 — for label-bearing order keys, substitute the display label as
    // the SORT KEY, resolved over the grid's distinct values BEFORE the window
    // (a "top 10 by account name" must pick the ten by name). Rows keep their
    // raw values — display rewriting stays in `queryDataset`, after the drill
    // metadata snapshots the stored values. A select dimension resolves from
    // field metadata (no query); a lookup costs one batched id→name read.
    let sortKeys: Record<string, Map<unknown, unknown>> | undefined;
    for (const key of labelOrderKeys) {
      const values = [...new Set(result.rows.map((r) => r[key]).filter((v) => v != null))];
      if (values.length === 0) continue;
      const labels = await this.orderLabels!.resolveLabels(key, values);
      if (labels && labels.size > 0) (sortKeys ??= {})[key] = labels;
    }
    result.rows = applyOrdering(result.rows, order, sortKeys);
    result.rows = applyWindow(result.rows, selection.limit, selection.offset);

    return result;
  }

  /**
   * The selected dimensions the compiled cube types as `time`, in selection
   * order (#3916) — the axis {@link resolveOrdering} defaults to ascending.
   *
   * Membership is decided by the DIMENSION's declared type, not by whether the
   * selection happens to bucket it: a `date` dimension left ungranulated groups
   * raw timestamps, and those want chronological order every bit as much as
   * month buckets do. (Both sort correctly — `compareValues` compares Dates and
   * ISO strings chronologically, and bucket keys are minted sort-stable.)
   */
  private timeDimensionsOf(compiled: CompiledDataset, dimensions: string[]): string[] {
    return dimensions.filter((d) => compiled.cube.dimensions[d]?.type === 'time');
  }

  private buildQuery(
    compiled: CompiledDataset,
    opts: {
      measures: string[];
      dimensions: string[];
      where?: FilterCondition;
      selection: DatasetSelection;
      contextTimezone?: string;
      /**
       * Ordering/window to push DOWN into this query. Set only for a selection
       * the caller proved is a single self-sufficient query (see
       * `canPushDownWindow`); omitted for supplementary/compare sub-queries,
       * which must return their full grid for the merge.
       */
      window?: { order?: Record<string, 'asc' | 'desc'>; limit?: number; offset?: number };
    },
  ): AnalyticsQuery {
    const q: AnalyticsQuery = {
      cube: compiled.cube.name,
      measures: opts.measures,
      dimensions: opts.dimensions,
      // Precedence: explicit selection tz → request's reference tz
      // (ExecutionContext.timezone, ADR-0053 Phase 2) → UTC.
      timezone: opts.selection.timezone ?? opts.contextTimezone ?? 'UTC',
    };
    if (opts.where) q.where = opts.where as Record<string, unknown>;
    // Bucket selected date dimensions. Without this a date dimension groups by
    // the raw timestamp — one bucket per ROW, which is why a "new accounts by
    // month" bar chart drew one bar per account instead of one per month
    // (#3588).
    //
    // Granularity precedence, per dimension:
    //   1. a `granularity` already stated on that dimension's
    //      `selection.timeDimensions` entry — never overridden;
    //   2. `selection.dateGranularity` — the PRESENTATION's choice, so a widget
    //      can bucket by month without the dataset committing every consumer to
    //      that granularity;
    //   3. the dataset dimension's own default (the compiler lowers an explicit
    //      `dateGranularity` to a single-entry `granularities`; the 5-entry
    //      "all granularities" list means the dataset stated no default).
    //
    // Note the unit of precedence is the GRANULARITY, not the entry. A
    // `timeDimensions` entry that only carries a `dateRange` (which is exactly
    // what `compareTo` needs) states a WINDOW, not a bucket size — letting its
    // mere presence suppress bucketing left the compared pass grouping raw
    // timestamps while the primary pass grouped months, so the two grids shared
    // no dimension key and every `__compare` column came back empty.
    const selTimeDims = opts.selection.timeDimensions ?? [];
    const selDims = new Set(selTimeDims.map((t) => t.dimension));
    const granularityFor = (name: string): string | undefined => {
      const cd = compiled.cube.dimensions[name];
      if (cd?.type !== 'time') return undefined;
      const datasetDefault = cd.granularities?.length === 1 ? String(cd.granularities[0]) : undefined;
      return resolveDimensionGranularity(opts.selection, name, datasetDefault);
    };
    // Fill in a bucket size for caller-supplied entries that named none.
    const resolvedTimeDims = selTimeDims.map((t) => {
      if (t.granularity) return t;
      const granularity = granularityFor(t.dimension);
      return granularity ? { ...t, granularity } : t;
    });
    const explicitTimeDims: Array<{ dimension: string; granularity: string }> = [];
    for (const name of opts.dimensions) {
      if (selDims.has(name)) continue;
      const granularity = granularityFor(name);
      if (granularity) explicitTimeDims.push({ dimension: name, granularity });
    }
    const mergedTimeDims = [...resolvedTimeDims, ...explicitTimeDims];
    if (mergedTimeDims.length > 0) q.timeDimensions = mergedTimeDims as AnalyticsQuery['timeDimensions'];
    // Ordering/window: pushed down ONLY when the caller vouched for it. The
    // executor always re-applies both over the assembled grid, so omitting them
    // here costs correctness nothing — it only moves the work to memory.
    if (opts.window?.order && Object.keys(opts.window.order).length > 0) q.order = opts.window.order;
    if (opts.window?.limit != null) q.limit = opts.window.limit;
    if (opts.window?.offset != null) q.offset = opts.window.offset;
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
    // Built through `buildQuery` so the comparison pass buckets its date
    // dimensions EXACTLY like the primary pass. Hand-rolling the query here
    // skipped granularity resolution, so a bucketed primary grid ("2026-04")
    // was merged against raw-timestamp comparison rows and no dimension key
    // ever matched — every `__compare` column came back empty. The shifted
    // `timeDimensions` still win for their own dimension (rule 1 of the
    // precedence chain); `window` is deliberately omitted — the comparison grid
    // must stay whole for the merge.
    const sub = await this.service.query(this.buildQuery(compiled, {
      measures,
      dimensions,
      where: baseFilter,
      selection: { ...selection, timeDimensions: shiftedTd },
      contextTimezone: context?.timezone,
    }), context);
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
