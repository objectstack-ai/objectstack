// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.
//
// ADR-0037 Phase 3 — draft data preview: evaluate an AnalyticsQuery over an
// in-memory row set (the pending `seed` draft's records) instead of the real
// data engine. This is what lets a Live Canvas dashboard chart REAL numbers
// from the DRAFTED sample data before anything is published — and because
// publish materializes the *same* seed, the numbers are continuous across
// the publish boundary.
//
// Scope (deliberately the dataset-query subset, not a general engine):
//   • Mongo-style `where` filters ($eq implicit, $ne/$gt/$gte/$lt/$lte/
//     $between/$in/$nin/$contains, $and/$or/$not)
//   • timeDimensions date-range filtering + granularity bucketing
//     (day/week/month/quarter/year)
//   • group-by dimensions; count / count_distinct / sum / avg / min / max
//   • order + limit/offset
// Anything beyond (joins via `include`, raw SQL) falls back to the caller's
// normal execution path — the preview simply doesn't claim it.

import { calendarPartsInTzOrUtc, nextUtcCalendarDay, utcInstantMs } from '@objectstack/core';
import type { AnalyticsQuery, AnalyticsResult } from '@objectstack/spec/contracts';
import type { Cube } from '@objectstack/spec/data';

type Row = Record<string, unknown>;

// ── Filters (the unified Query DSL subset) ──────────────────────────────────

/**
 * Order two operands the way every other filter backend orders them.
 *
 * The `Date` arm is load-bearing rather than defensive: `String(new Date())`
 * is `'Mon Jul 27 2026 …'`, which under the plain string ordering below sorts
 * AFTER every `'2026-…'` comparand — so a preview row carrying an instant both
 * disappeared from windows it belongs in and appeared in ones it does not.
 * Measured against the shared matrix, 10 of 16 cases diverged, and unlike the
 * cross-type silence on the drivers this direction ADDS rows: a drafted chart
 * showed numbers no published chart would.
 *
 * The population is real. `Field.datetime`'s storage form is a BSON `Date` on
 * `driver-mongodb` (ADR-0053 D-E2), so rows fetched from a mongo-backed dataset
 * arrive here as `Date` objects, while the comparands are wire text.
 * {@link utcInstantMs} is the same primitive `formula`'s write-side evaluator
 * uses for the same pairing, so the two type-blind surfaces cannot drift.
 *
 * Deliberately narrow: the lift runs only when one side is a `Date` and both
 * read as instants, so string-vs-string keeps ISO lexicographic ordering and a
 * `Field.time` wall clock — which denotes no instant — is left untouched.
 */
function compare(a: unknown, b: unknown): number {
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  if (a instanceof Date || b instanceof Date) {
    const ai = utcInstantMs(a);
    const bi = utcInstantMs(b);
    if (ai !== null && bi !== null) return ai - bi;
  }
  return String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0;
}

/**
 * The inclusive-upper-bound comparison, with the calendar-day rule (#3777): a
 * bare-day bound means "through that whole day", so it is evaluated half-open
 * against the next day. String ordering makes `< nextDay` equivalent to
 * `<= day` for plain date values, so this needs no field-type lookup — which
 * matters here, because the preview sees drafted rows with no schema.
 *
 * Shared by `$lte` and the max of `$between` so the two cannot drift apart.
 */
function lteBound(value: unknown, bound: unknown): boolean {
  const nextDay = nextUtcCalendarDay(bound);
  if (nextDay != null) return compare(value, nextDay) < 0;
  return compare(value, bound) <= 0;
}

function matchOp(value: unknown, op: string, expected: unknown): boolean {
  switch (op) {
    case '$eq': return value === expected || String(value) === String(expected);
    case '$ne': return !(value === expected || String(value) === String(expected));
    case '$gt': return value != null && compare(value, expected) > 0;
    case '$gte': return value != null && compare(value, expected) >= 0;
    case '$lt': return value != null && compare(value, expected) < 0;
    case '$lte': {
      if (value == null) return false;
      // A bare-day upper bound means "through that whole day" (#3777): the SQL
      // paths compile it half-open (`< day+1`), and the preview must agree or
      // a drafted chart shows different numbers than the published one. String
      // ordering makes `< nextDay` equivalent to `<= day` for plain date
      // values, so no type lookup is needed here either.
      return lteBound(value, expected);
    }
    case '$between': {
      // Was absent, so it fell to the permissive `default` and matched EVERY
      // row — a drafted chart with a range filter silently charted the whole
      // dataset, then changed at publish (found by the ADR-0053 D-A3 matrix,
      // #4081). The max takes the same whole-day rule as `$lte`.
      if (value == null || !Array.isArray(expected) || expected.length !== 2) return false;
      const [min, max] = expected;
      if (min == null || max == null) return false;
      return compare(value, min) >= 0 && lteBound(value, max);
    }
    case '$in': return Array.isArray(expected) && expected.some((e) => value === e || String(value) === String(e));
    case '$nin': return Array.isArray(expected) && !expected.some((e) => value === e || String(value) === String(e));
    case '$contains': return String(value ?? '').toLowerCase().includes(String(expected ?? '').toLowerCase());
    default: return true; // unknown operator — permissive (preview, reads only)
  }
}

export function matchesWhere(row: Row, where: Record<string, unknown> | undefined): boolean {
  if (!where) return true;
  for (const [key, cond] of Object.entries(where)) {
    if (key === '$and') {
      if (!(cond as Row[]).every((c) => matchesWhere(row, c as Row))) return false;
    } else if (key === '$or') {
      if (!(cond as Row[]).some((c) => matchesWhere(row, c as Row))) return false;
    } else if (key === '$not') {
      if (matchesWhere(row, cond as Row)) return false;
    } else if (cond !== null && typeof cond === 'object' && !Array.isArray(cond)) {
      for (const [op, expected] of Object.entries(cond as Row)) {
        if (!matchOp(row[key], op, expected)) return false;
      }
    } else if (!(row[key] === cond || String(row[key]) === String(cond))) {
      return false; // implicit equality
    }
  }
  return true;
}

// ── Time bucketing ──────────────────────────────────────────────────────────

export function bucketDate(value: unknown, granularity: string, timezone?: string): string | null {
  const d = new Date(String(value));
  if (Number.isNaN(d.getTime())) return null;
  // ADR-0053 Phase 2: resolve the calendar day in the reference zone so an
  // instant near a tz day-boundary buckets where a user in that zone expects.
  // Unset / 'UTC' / invalid keeps the historical UTC bucketing.
  const { year: y, month, day: dayNum } = calendarPartsInTzOrUtc(d, timezone);
  const m = `${month}`.padStart(2, '0');
  const day = `${dayNum}`.padStart(2, '0');
  switch (granularity) {
    case 'year': return `${y}`;
    case 'quarter': return `${y}-Q${Math.floor((month - 1) / 3) + 1}`;
    case 'month': return `${y}-${m}`;
    case 'week': {
      // Build a UTC date from the zone-shifted parts, then step back to Monday.
      const monday = new Date(Date.UTC(y, month - 1, dayNum));
      const dow = (monday.getUTCDay() + 6) % 7; // Monday=0
      monday.setUTCDate(monday.getUTCDate() - dow);
      return monday.toISOString().slice(0, 10);
    }
    case 'day':
    default:
      return `${y}-${m}-${day}`;
  }
}

// ── Aggregation ─────────────────────────────────────────────────────────────

/**
 * Read an operand as a number, or `null` for "this is not a number" — the
 * question `Number()` cannot be asked, because it answers `NaN` for a date and
 * `0` for `''` and `null` alike.
 *
 * Numeric TEXT counts (`'800'`): a seed row carries whatever the draft was
 * authored with, and a numeric column written as text is still a numeric
 * column — ordering it lexicographically would put `'1200'` before `'800'`,
 * which no backend does for that column. A `Date` is deliberately NOT numeric
 * here: `Number(new Date())` is an epoch integer, and comparing one against a
 * money amount is a category error rather than an ordering.
 */
function numericOperand(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/**
 * Order two operands of ONE measure for `min`/`max`.
 *
 * Numbers (in either spelling) order numerically; everything else falls to
 * {@link compare}, this file's shared ordering — so ISO dates order as dates,
 * a BSON `Date` orders as its instant against wire text, and text orders the
 * way `MIN(text_col)` orders on a SQL face.
 *
 * Deliberately NOT folded into {@link compare} itself: that primitive also
 * decides `where` filtering and `order`, whose comparand comes from the QUERY
 * rather than from a sibling row, so widening it would move populations this
 * card never measured.
 */
function compareOperands(a: unknown, b: unknown): number {
  const an = numericOperand(a);
  const bn = numericOperand(b);
  if (an !== null && bn !== null) return an - bn;
  return compare(a, b);
}

/**
 * `min`/`max` over one group: the winning operand **in its own type**.
 *
 * NULLs are skipped (every SQL face aggregates over non-null values), and a
 * group with nothing left answers `null` — `emptyGroupValueFor`
 * (`@objectstack/spec/data`) rules `min`/`max` over nothing unanswerable, never
 * the `0` that reads as a measurement somebody made.
 */
function extremumOf(rows: Row[], field: string, kind: 'min' | 'max'): unknown {
  let winner: unknown;
  let seen = false;
  for (const r of rows) {
    const v = r[field];
    if (v == null) continue;
    if (!seen) {
      winner = v;
      seen = true;
      continue;
    }
    const c = compareOperands(v, winner);
    if (kind === 'min' ? c < 0 : c > 0) winner = v;
  }
  return seen ? winner : null;
}

/**
 * One measure over one group.
 *
 * `metricType` is the cube metric's `type` — `AggregationMetricType`
 * (`spec/data/analytics.zod.ts`), which `dataset-compiler` fills with the
 * dataset measure's own `aggregate` verbatim. That vocabulary is CLOSED, so
 * every member is answered here rather than left to fall through (#16203):
 *
 * | metric type      | answer                                                   |
 * |:-----------------|:---------------------------------------------------------|
 * | `count`          | the row count — numeric whatever it counted               |
 * | `count_distinct` | the cardinality of the non-null values — numeric          |
 * | `sum` / `avg`    | arithmetic over the operands that read as numbers         |
 * | `min` / `max`    | the winning operand, IN ITS OWN TYPE ({@link extremumOf}) |
 * | `number` / `string` / `boolean` | a custom-SQL metric the dataset path never mints — left on the historical numeric `default` |
 *
 * ⭐ `min`/`max` are why this function stopped returning `number`. Coercing
 * every operand with `Number()` and dropping the non-finite ones made a
 * `max` over a `date` field answer `0` — not a mislabelled column but a
 * DIFFERENT, WRONG ANSWER to the same query, silently, on the draft-preview
 * path only. The same value comes back as `'2026-05-12'` from the live path
 * over the same rows. `cross-object-rebucket.ts` settled the identical
 * question for the recombination path (#3797): the value `min`/`max` picks is
 * a value OF the column, so it has to come back in the shape the row carried.
 *
 * ⛔ `sum`/`avg` over a TEMPORAL operand is left exactly as it was — the
 * non-finite operands drop and the answer is the numeric identity. There is no
 * defined answer to invent (the SQL faces disagree with each other on it), and
 * #16099 is the open card for REFUSING an incoherent aggregate/field-type pair
 * — the layer that refuses is that card's ruling, not this file's.
 *
 * ⛔ `count`/`count_distinct` stay numeric. Counting `date`s is still counting;
 * the sibling descriptor rule (`measure-result-type.ts`) answers the same way.
 */
function aggregate(rows: Row[], metricType: string, field: string): unknown {
  // `count`, and any metric aggregating over rows rather than a column.
  if (metricType === 'count' || field === '*') return rows.length;
  const nums = rows.map((r) => Number(r[field])).filter((n) => Number.isFinite(n));
  switch (metricType) {
    // The spec's spelling (`AggregationFunction`), which is what the compiler
    // copies through. It used to be spelled `countDistinct` here — a word no
    // producer mints — so the arm was UNREACHABLE and the measure fell to the
    // numeric `default` below, answering a sum of coerced values (or a row
    // count) under the author's `count_distinct` name.
    case 'count_distinct': return new Set(rows.map((r) => r[field]).filter((v) => v != null)).size;
    case 'sum': return nums.reduce((a, b) => a + b, 0);
    case 'avg': return nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : 0;
    case 'min': return extremumOf(rows, field, 'min');
    case 'max': return extremumOf(rows, field, 'max');
    default: return nums.length ? nums.reduce((a, b) => a + b, 0) : rows.length;
  }
}

/**
 * Evaluate `query` over `rows` using the cube's measure/dimension specs.
 * Mirrors the engine strategies' output contract: rows keyed by bare
 * measure/dimension names, `fields` describing each output column.
 */
export function evaluateAnalyticsQueryOverRows(
  query: AnalyticsQuery,
  cube: Cube,
  rows: Row[],
): AnalyticsResult {
  // 1. Row-level filters: `where`, then timeDimension dateRanges.
  let filtered = rows.filter((r) => matchesWhere(r, query.where));
  const timeDims = query.timeDimensions ?? [];
  for (const td of timeDims) {
    const dim = cube.dimensions?.[td.dimension];
    const field = String(dim?.sql ?? td.dimension);
    if (!td.dateRange) continue;
    const [start, end] = Array.isArray(td.dateRange) ? td.dateRange : [td.dateRange, td.dateRange];
    filtered = filtered.filter((r) => {
      const v = String(r[field] ?? '');
      // Bare-day end → half-open `< day+1`, the same translation the SQL
      // paths apply (#3777); a full-timestamp end keeps the historical
      // `'~'`-suffix trick (inclusive of that instant's own sub-values).
      const nextDay = nextUtcCalendarDay(end);
      const inUpper = nextDay != null ? v < nextDay : v <= `${end}~`;
      return v >= String(start) && inUpper;
    });
  }

  // 2. Grouping keys: each selected dimension (time dims bucketed).
  const dimensions = query.dimensions ?? [];
  const timezone = query.timezone; // ADR-0053 Phase 2: reference tz for bucketing
  const granByDim = new Map(timeDims.filter((t) => t.granularity).map((t) => [t.dimension, t.granularity!]));
  const keyOf = (r: Row): { key: string; values: Row } => {
    const values: Row = {};
    for (const name of dimensions) {
      const dim = cube.dimensions?.[name];
      const field = String(dim?.sql ?? name);
      const raw = r[field];
      const gran = granByDim.get(name) ?? (dim?.type === 'time' && dim.granularities?.length === 1 ? String(dim.granularities[0]) : undefined);
      values[name] = gran ? bucketDate(raw, gran, timezone) : (raw ?? null);
    }
    return { key: JSON.stringify(values), values };
  };

  const groups = new Map<string, { values: Row; rows: Row[] }>();
  for (const r of filtered) {
    const { key, values } = keyOf(r);
    const g = groups.get(key) ?? { values, rows: [] };
    g.rows.push(r);
    groups.set(key, g);
  }
  // No dimensions → a single overall group (even over zero rows: count = 0).
  if (dimensions.length === 0 && groups.size === 0) {
    groups.set('{}', { values: {}, rows: [] });
  }

  // 3. Aggregate each measure per group.
  const out: Row[] = [];
  for (const g of groups.values()) {
    const row: Row = { ...g.values };
    for (const m of query.measures) {
      const metric = cube.measures?.[m];
      row[m] = aggregate(g.rows, String(metric?.type ?? 'count'), String(metric?.sql ?? '*'));
    }
    out.push(row);
  }

  // 4. Order + paging.
  for (const [col, dir] of Object.entries(query.order ?? {}).reverse()) {
    out.sort((a, b) => (dir === 'desc' ? -1 : 1) * compare(a[col], b[col]));
  }
  const offset = query.offset ?? 0;
  const limited = out.slice(offset, query.limit != null ? offset + query.limit : undefined);

  return {
    rows: limited,
    fields: [
      // A dimension column is described by the CUBE dimension's own type — the
      // same expression `NativeSQLStrategy.buildFieldMeta` and its ObjectQL
      // sibling use (`d?.type || 'string'`), so a `date` dataset dimension is
      // `'time'` here exactly as it is on the live path. Minting `'string'` for
      // every dimension made the same column two different things depending
      // only on whether a pending seed draft existed (#16203 (b)).
      ...dimensions.map((d) => ({ name: d, type: String(cube.dimensions?.[d]?.type || 'string') })),
      // ⛔ A MEASURE column keeps the `'number'` every producer in the platform
      // mints for it, live faces included. Correcting it is one rule owned by
      // `measureResultType` (#15768/#16101) and applied at the ADR-0021
      // descriptor pass; a second copy of it here would be two implementations
      // free to drift, over a question this producer cannot answer anyway (it
      // has the cube, not the source object's declared field types).
      ...query.measures.map((m) => ({ name: m, type: 'number' })),
    ],
  };
}
