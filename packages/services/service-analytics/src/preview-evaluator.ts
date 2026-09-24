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
//
// [#19810] "Doesn't claim it" is a FALL-BACK only where a fall-back exists. A
// `where` operator outside the subset above has none: the rows being charted
// live only in the pending seed draft, so there is no live path to hand the
// query to. It is REFUSED — `INVALID_FILTER` / 400, the envelope this package's
// `where` door already speaks — and never answered true. See
// PREVIEW_FIELD_OPERATORS. [#19835] So is a field constraint carrying ZERO
// operators (`{ name: {} }`), at any depth — see isEmptyFieldConstraint.
// [#19888] And a list in the equality slot (`{ stage: ['won', 'lost'] }`,
// `{ stage: { $eq: [...] } }`), through the published door's own gate.

import {
  calendarPartsInTzOrUtc,
  nextUtcCalendarDay,
  resolveAnalyticsDateRangeString,
  utcInstantMs,
} from '@objectstack/core';
import { explicitDateRangeWindow } from './date-range-array-arm.js';
// [#19810] The `where` door's refusal envelope — `INVALID_FILTER` / 400,
// EXPORTED by `filter-normalizer` precisely so a sibling in this package cannot
// invent a second spelling of it. A draft-preview filter is a `where`-door
// refusal in every respect that matters: the caller authored the predicate and
// the repair is theirs. [#19888] So is the equality-slot list gate, for the
// same reason: one rule, one spelling, on both faces.
import { assertNoListInEqualitySlot, invalidFilterError } from './strategies/filter-normalizer.js';
import type { AnalyticsQuery, AnalyticsResult } from '@objectstack/spec/contracts';
import { emptyGroupValueFor, type Cube } from '@objectstack/spec/data';

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

/** One field operator's predicate, over one row's value. */
type PreviewPredicate = (value: unknown, expected: unknown) => boolean;

/**
 * [#19810] The field operators this face EVALUATES — and, because the refusal
 * below derives its vocabulary from these keys, the complete statement of what
 * the draft preview accepts.
 *
 * ⛔ This was a `switch` whose `default` arm answered `return true` — "unknown
 * operator — permissive (preview, reads only)". Permissive is the one thing a
 * filter must never be: a predicate that answers true for every row does not
 * narrow the query, it WIDENS it (#3948, #4286/ADR-0078, #5345). So a drafted
 * chart carrying `name $icontains 'acme'` charted the WHOLE dataset and looked
 * exactly like a working chart, until publish — where the real filter doors do
 * apply the operator — changed the numbers under the author. Every declared
 * operator with no row below was in that state: `$icontains`, `$notContains`,
 * `$startsWith`, `$endsWith`, `$null`, `$exists`, plus `$like` / `$ilike` and
 * any typo. "Reads only" argued the wrong half: the preview writes nothing and
 * reports a NUMBER, and a wrong number is what a chart is.
 *
 * It is the identical shape this file already records twice — `$between` fell
 * to that same `default` and matched every row (#4081), and `dateRange`
 * degenerated to a point window (#16322) — because publish materialises the
 * SAME seed, so any disagreement here makes the numbers jump across the publish
 * boundary for no reason an author can see.
 *
 * Vocabulary and evaluator are ONE table, the shape `memory-analytics`'
 * `MONGO_TO_CUBE_OPERATOR` took for this exact defect (#5345): adding a row
 * here is the only way to widen what this face accepts, and forgetting to add
 * one is a loud refusal rather than a wrong number. A `Map`, not an object
 * literal, so a field constraint naming an `Object.prototype` member
 * (`{ name: { toString: 'x' } }`) cannot resolve to an inherited function and
 * be called as a predicate.
 *
 * ⛔ Widening it is deliberately NOT this card's work, and the ordering is
 * already ruled: the `FILTER_OPERATORS` docblock's #6520 constraint — the word
 * list must not land ahead of the evaluators — reads the same in this
 * direction, so an arm joins this table in the PR that measures it against the
 * shared text/temporal conformance kits, not before. Every row below is
 * byte-for-byte the `case` it replaces.
 */
const PREVIEW_FIELD_OPERATORS = new Map<string, PreviewPredicate>([
  ['$eq', (value, expected) => value === expected || String(value) === String(expected)],
  ['$ne', (value, expected) => !(value === expected || String(value) === String(expected))],
  ['$gt', (value, expected) => value != null && compare(value, expected) > 0],
  ['$gte', (value, expected) => value != null && compare(value, expected) >= 0],
  ['$lt', (value, expected) => value != null && compare(value, expected) < 0],
  ['$lte', (value, expected) => {
    if (value == null) return false;
    // A bare-day upper bound means "through that whole day" (#3777): the SQL
    // paths compile it half-open (`< day+1`), and the preview must agree or
    // a drafted chart shows different numbers than the published one. String
    // ordering makes `< nextDay` equivalent to `<= day` for plain date
    // values, so no type lookup is needed here either.
    return lteBound(value, expected);
  }],
  ['$between', (value, expected) => {
    // Was absent, so it fell to the permissive `default` and matched EVERY
    // row — a drafted chart with a range filter silently charted the whole
    // dataset, then changed at publish (found by the ADR-0053 D-A3 matrix,
    // #4081). The max takes the same whole-day rule as `$lte`.
    if (value == null || !Array.isArray(expected) || expected.length !== 2) return false;
    const [min, max] = expected;
    if (min == null || max == null) return false;
    return compare(value, min) >= 0 && lteBound(value, max);
  }],
  ['$in', (value, expected) => Array.isArray(expected) && expected.some((e) => value === e || String(value) === String(e))],
  ['$nin', (value, expected) => Array.isArray(expected) && !expected.some((e) => value === e || String(value) === String(e))],
  ['$contains', (value, expected) => String(value ?? '').toLowerCase().includes(String(expected ?? '').toLowerCase())],
]);

/**
 * [#19810] A filter operator this face cannot evaluate, in the ADR-0112
 * envelope every sibling filter refusal in this package speaks.
 *
 * ⛔ REFUSED, not answered-true and not silently excluded from the result. The
 * three candidates are not equivalent: answering true is the defect; excluding
 * the row makes the preview merely DIFFERENT from the published chart — zero
 * rows where publish draws numbers — which is the silent failure #16322
 * abolished on this very evaluator; only a refusal makes the disagreement
 * VISIBLE to the author who can fix it. That is the call
 * `uncompilableFieldOperatorError` states for the analytics cube face, and the
 * posture `service-analytics` already takes for `$like` / `$ilike` (the
 * `FILTER_OPERATORS` face table: "REFUSE, loudly, in the ADR-0112
 * `INVALID_FILTER` envelope").
 *
 * This face is the ONLY door on the path it serves: `queryDataset`'s preview
 * branch evaluates in memory and never reaches a strategy, so no `where` gate
 * runs ahead of it — the same reason `lowerPreviewDateRange` refuses here
 * rather than trusting the schema door behind it.
 */
function previewUnevaluableOperatorError(op: string, field: string): Error {
  const supported = [...PREVIEW_FIELD_OPERATORS.keys()].join(', ');
  return invalidFilterError(
    `[analytics] Filter operator "${op}" on field "${field}" is not evaluated by the draft-data ` +
      `preview. Operators this face evaluates: ${supported}. It is refused rather than answered ` +
      `true for every row: a predicate that matches everything does not narrow the query, it ` +
      `WIDENS it — the drafted chart is drawn over rows the filter excluded and looks like a ` +
      `working chart, until publish applies the operator and the numbers change. Rewrite the ` +
      `predicate with an operator listed above, or publish the seed and chart it live.`,
  );
}

/**
 * [#19835] Is this field spec `{}` — a field constrained by ZERO operators?
 *
 * A plain object with no own enumerable keys, and nothing else — the predicate
 * `driver-memory`, `driver-mongodb`, `driver-sql` and `@objectstack/formula`
 * each apply under the same name. A `Date`, a `RegExp` or a class instance also
 * enumerates to nothing, but it is a COMPARAND rather than a constraint, so the
 * prototype check keeps it out of this refusal exactly as it does there.
 *
 * Mirrored locally, not imported: the exported copy lives in `driver-memory`
 * (`filter-refusal.ts`), a package this service does not depend on, and a
 * dependency on a driver for a four-line predicate is the wrong direction.
 */
function isEmptyFieldConstraint(spec: unknown): boolean {
  if (spec === null || typeof spec !== 'object' || Array.isArray(spec)) return false;
  const proto = Object.getPrototypeOf(spec);
  if (proto !== Object.prototype && proto !== null) return false;
  return Object.keys(spec as Row).length === 0;
}

/**
 * [#19835] `{ field: {} }` — a field constrained by ZERO operators — REFUSED,
 * in the same `INVALID_FILTER` / 400 envelope as
 * {@link previewUnevaluableOperatorError}.
 *
 * ⛔ It used to MATCH EVERY ROW, and not by anyone's decision: the per-field
 * loop in {@link matchesWhere} iterates the constraint's entries, an empty
 * object has none, so the loop body never ran and the row fell through to the
 * function's closing `return true`. The operator-vocabulary refusal (#19810)
 * could not reach it either — with no key there is no operator to look up and
 * no lookup to fail.
 *
 * Every shipped backend already refuses this shape (#5240 ruled it: refused
 * everywhere, one wording): `driver-memory`'s and `driver-mongodb`'s
 * `emptyFieldConstraintError`, and `driver-sql`'s at the top level and inside
 * `$and`/`$or`/`$not` alike. This package's own `where` door refuses it too
 * (`filter-normalizer`'s wrapper arm). So the draft preview charted every row
 * for a filter publish never answers at all — the preview/publish divergence
 * this evaluator's other refusals exist to make visible.
 *
 * ⛔ Refused, NOT answered as "matches nothing". `{ status: {} }` does not mean
 * "no rows" — read literally it means "rows whose status is anything", and the
 * shape is almost always an authoring accident (a filter builder that recorded
 * a field and never its operator). Either silent reading hands the author a row
 * count they never asked for; only the refusal names the constraint to repair.
 *
 * The message follows the drivers' wording (constraint, position, the two legal
 * repairs) and carries no tracker number, per the runtime-string rule.
 */
function previewEmptyFieldConstraintError(field: string, path: string): Error {
  return invalidFilterError(
    `[analytics] Field constraint at ${path} carries zero operators ({ "${field}": {} }). A field ` +
      `constraint must name at least one operator (e.g. { "${field}": { "$eq": "value" } }) or be a ` +
      `direct comparand (e.g. { "${field}": "value" }). It is refused rather than evaluated: the ` +
      `draft-data preview used to answer it with EVERY row, while every data driver and the live ` +
      `analytics filter refuse it — so the drafted chart was drawn over rows the published one never ` +
      `returns. It does not mean "no rows" either; name the operator the constraint was meant to carry.`,
  );
}

/**
 * [#19810] Refuse a `where` this face cannot evaluate BEFORE any row is read.
 *
 * Row-independent on purpose. {@link matchOp}'s refusal can only fire if some
 * row reaches it, and a pending seed draft holding ZERO rows — the state a
 * draft is authored in, and the state a `$null` filter over an empty seed lands
 * in — would otherwise answer an unevaluable filter with an empty result and no
 * complaint. `driver-memory`'s `assertFilterConditionShape` runs ahead of that
 * driver's lowering for the same reason: the walk must not be a function of the
 * data.
 *
 * It mirrors {@link matchesWhere}'s own traversal exactly, malformed shapes
 * included — a non-array `$and` is left for `matchesWhere` to fault on as it
 * always has, so this gate widens no refusal beyond the operator vocabulary
 * and the zero-operator constraint.
 *
 * [#19835] The zero-operator constraint is judged HERE, for the whole tree,
 * rather than only where {@link matchesWhere} meets it: that walk
 * short-circuits (`every`/`some`, and a node returns on its first false entry),
 * so a `{ $or: [{ name: 'Globex' }, { amount: {} }] }` would refuse or answer
 * depending on which ROW was being tested. A malformed filter is refused for
 * every row or none — the posture `@objectstack/formula`'s `assertFilterShape`
 * takes for the same shape — and nesting under `$and`/`$or`/`$not` cannot
 * route around it, the position `driver-sql` once dropped it in.
 */
function assertPreviewCanEvaluate(where: Record<string, unknown> | undefined, path = 'where'): void {
  if (!where) return;
  for (const [key, cond] of Object.entries(where)) {
    const here = `${path}.${key}`;
    if (key === '$and' || key === '$or') {
      if (Array.isArray(cond)) cond.forEach((arm, i) => assertPreviewCanEvaluate(arm as Row, `${here}[${i}]`));
    } else if (key === '$not') {
      if (cond !== null && typeof cond === 'object' && !Array.isArray(cond)) {
        assertPreviewCanEvaluate(cond as Row, here);
      }
    } else if (isEmptyFieldConstraint(cond)) {
      throw previewEmptyFieldConstraintError(key, here);
    } else if (cond !== null && typeof cond === 'object' && !Array.isArray(cond)) {
      for (const op of Object.keys(cond as Row)) {
        if (!PREVIEW_FIELD_OPERATORS.has(op)) throw previewUnevaluableOperatorError(op, key);
      }
    }
  }
}

function matchOp(value: unknown, op: string, expected: unknown, field: string): boolean {
  const evaluate = PREVIEW_FIELD_OPERATORS.get(op);
  if (!evaluate) throw previewUnevaluableOperatorError(op, field);
  return evaluate(value, expected);
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
    } else if (isEmptyFieldConstraint(cond)) {
      // [#19835] Zero entries would leave the loop below unrun and fall through
      // to a MATCH. Refused here too, so a direct caller of this matcher gets
      // the same answer the row-independent gate gives a whole query.
      throw previewEmptyFieldConstraintError(key, key);
    } else if (cond !== null && typeof cond === 'object' && !Array.isArray(cond)) {
      for (const [op, expected] of Object.entries(cond as Row)) {
        if (!matchOp(row[key], op, expected, key)) return false;
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
 * | `count`          | over `*` the ROW count; over a declared COLUMN that       |
 * |                  | column's NON-NULL count — numeric either way              |
 * | `count_distinct` | the cardinality of the non-null values — numeric          |
 * | `sum`            | arithmetic over the operands that read as numbers         |
 * | `avg`            | the mean of the NON-NULL operands that read as numbers,   |
 * |                  | and `null` when NO ROW CARRIED A VALUE (#16219)           |
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
 * — the layer that refuses is that card's ruling, not this file's. ⭐ #16219's
 * empty-group `null` is deliberately NOT that case: it fires only when NO row
 * carried a value, never when the values were present and unreadable as numbers.
 *
 * ⛔ `count`/`count_distinct` stay numeric. Counting `date`s is still counting;
 * the sibling descriptor rule (`measure-result-type.ts`) answers the same way.
 */
function aggregate(rows: Row[], metricType: string, field: string): unknown {
  // `*` is the "no column declared" spelling — `dataset-compiler` writes
  // `sql: m.field ?? '*'` — so a metric over it aggregates over ROWS. Every
  // metric type keeps that reading, exactly as before.
  if (field === '*') return rows.length;
  // [#16218] `count` over a DECLARED column counts that column's non-null
  // values, which is what `COUNT(col)` means. The condition above used to be
  // `metricType === 'count' || field === '*'`, so the field a measure declared
  // was carried in and never read: the preview answered the row count and a
  // drafted chart showed a different number than the published one, silently —
  // the number `count(*)` gives, so the author's choice to count a specific
  // column had no effect on this path at all. The live faces settled the same
  // question the other way round in #10298: `AGGREGATE_SQL.count` in
  // `native-sql-strategy.ts` emits COUNT(*) for the star and COUNT(col) for a
  // real column, and every SQL dialect defines the latter over non-null values.
  //
  // A group with no non-null value counts `0`, never null: `emptyGroupValueFor`
  // (`@objectstack/spec/data`) rules `count` over nothing the identity `0`
  // because counting nothing is a measured fact — the opposite of the
  // `min`/`max` reading in {@link extremumOf}.
  if (metricType === 'count') return rows.filter((r) => r[field] != null).length;
  const nums = rows.map((r) => Number(r[field])).filter((n) => Number.isFinite(n));
  switch (metricType) {
    // The spec's spelling (`AggregationFunction`), which is what the compiler
    // copies through. It used to be spelled `countDistinct` here — a word no
    // producer mints — so the arm was UNREACHABLE and the measure fell to the
    // numeric `default` below, answering a sum of coerced values (or a row
    // count) under the author's `count_distinct` name.
    case 'count_distinct': return new Set(rows.map((r) => r[field]).filter((v) => v != null)).size;
    case 'sum': return nums.reduce((a, b) => a + b, 0);
    // [#16219] Averaging NOTHING has no answer, and this arm used to invent
    // one. The live faces answer SQL NULL over the same rows (`AVG(col)` is
    // defined over non-null values in every dialect), so a drafted chart read
    // `0` where the published chart read blank — and `0` is a PLAUSIBLE
    // average, indistinguishable from one somebody measured.
    //
    // ⭐ Two limbs, and only the second is visible in the line this replaced.
    // `Number(null)` is `0` and `Number.isFinite` accepts it, so `nums` above
    // counts every NULL as a zero OPERAND: a group whose field is NULL in every
    // row took the TRUE branch with `nums = [0, 0]` and averaged the nulls — the
    // `: 0` fallback never ran there at all. The same coercion pulled a group
    // that DOES have values off the live answer too: `(10 + 20 + 0) / 3 = 10`
    // against SQLite's 15. So the operand list is rebuilt here over the rows
    // that carry a value, exactly as {@link extremumOf} (`v == null` → skip) and
    // #16218's `count` arm (`r[field] != null`) already do.
    //
    // ⛔ Scoped to this arm rather than folded into `nums`: `sum` is immune to
    // the coercion (`0` is the additive identity, so both spellings answer the
    // same number) and the numeric `default` below is the historical answer for
    // the custom-SQL metric types, which has no live standard to be moved
    // towards. Widening either would be an unrequested value change.
    //
    // ⛔ And the empty answer is not a hard-coded `null`: what an aggregate
    // answers over an empty operand set is the platform's ruling and lives in
    // exactly one place — `emptyGroupValueFor` (`@objectstack/spec/data`), which
    // hands back the identity `0` where counting or summing nothing is a
    // measured fact and `undefined` where there is nothing to answer. It is
    // READ, never restated, by `fillEmptyGroups`, `sql-driver` and
    // `driver-turso`, and #16203 cited it for `min`/`max` in this same function.
    // `?? null` is only the wire spelling of that `undefined` — the same `null`
    // {@link extremumOf} returns and the same one the live faces' SQL NULL
    // arrives as — never a second opinion about the ruling.
    case 'avg': {
      const present = rows.filter((r) => r[field] != null);
      const operands = present.map((r) => Number(r[field])).filter((n) => Number.isFinite(n));
      if (operands.length) return operands.reduce((a, b) => a + b, 0) / operands.length;
      // ⭐ No numeric operand is TWO different situations, and only one of them
      // is "averaging nothing":
      //
      //   • no row carried a value at all — the empty group. That is the
      //     platform's ruled question and `emptyGroupValueFor` answers it.
      //   • rows carried values that do not read as numbers — a `date` column
      //     under `avg`. That is an INCOHERENT aggregate/field-type pair, which
      //     #16099 owns and no layer refuses yet; the answer stays the numeric
      //     identity it has always been. ⛔ Not this card's to move: `avg` over
      //     a temporal operand is pinned as-is by `preview-aggregate-operand-type`
      //     (#16203), and the live face answers a different number again
      //     (SQLite's numeric affinity), so `null` here would invent a third.
      return present.length ? 0 : (emptyGroupValueFor(metricType) ?? null);
    }
    case 'min': return extremumOf(rows, field, 'min');
    case 'max': return extremumOf(rows, field, 'max');
    default: return nums.length ? nums.reduce((a, b) => a + b, 0) : rows.length;
  }
}

/**
 * The window one `timeDimensions[].dateRange` lowers to on this face, reduced
 * to the three facts the closed vocabulary decides: the two bounds, and whether
 * the upper one is excluded.
 *
 * Structurally `@objectstack/core`'s `LoweredDateRangeWindow` — the shared
 * conformance kit's currency — so this face registers in the kit with no
 * translation of its own, and a translation layer cannot become the place the
 * fourth face quietly grows a fourth interpretation.
 */
export interface PreviewDateRangeWindow {
  readonly start: string;
  readonly end: string;
  readonly endExclusive: boolean;
}

/**
 * [#16322] Lower one `dateRange` for the draft-preview face — the FOURTH
 * analytics face, now held to the same closed vocabulary as `driver-memory`'s
 * cube face and both `service-analytics` strategies.
 *
 * ⛔ It used to degenerate to the point window `[range, range]`, exactly the
 * shape this card abolished on the other three: a VALID `last_30_days` filtered
 * `v >= 'last_30_days' && v <= 'last_30_days~'` — **zero rows, silently** —
 * while the published chart beside it answered a real window. That is precisely
 * the continuity a draft preview exists to provide: publish materialises the
 * SAME seed, so a preview that disagrees with the live face makes the numbers
 * jump across the publish boundary for no reason an author can see.
 *
 * The STRING arm is the closed preset vocabulary (#16041), lowered by the ONE
 * shared `resolveAnalyticsDateRangeString` the other three faces call — so this
 * is not a second interpretation but the only one — and REFUSED with the
 * ADR-0112 `400 ANALYTICS_DATE_RANGE_UNRECOGNIZED` envelope when it is not a
 * preset name. ⛔ The refusal PROPAGATES: this evaluator is reached through
 * `queryDataset`, which types its selection from `AnalyticsQuery` and never
 * Zod-parses it, so the schema door is behind it — which is the whole moment a
 * face-side refusal exists for.
 *
 * The ARRAY arm is the CALLER's explicit window and is untouched, bound for
 * bound, with the inclusive upper reading it has always had (#16179). Its
 * bare-day widening (#3777) stays in the predicate below rather than moving
 * here: that is a per-face calendar translation, not a window this vocabulary
 * resolved.
 *
 * @throws the ADR-0112 envelope for a string outside `DATE_RANGE_PRESETS`.
 */
export function lowerPreviewDateRange(
  dateRange: string | readonly string[],
  timezone?: string,
): PreviewDateRangeWindow {
  if (!Array.isArray(dateRange)) {
    const window = resolveAnalyticsDateRangeString(dateRange as string, { timezone });
    return { start: window.start, end: window.end, endExclusive: window.endExclusive };
  }
  // [#17124] An oddly-sized array is REFUSED, by the one
  // `explicitDateRangeWindow` every face in this package calls. ⛔ What this
  // replaced left the upper bound UNWRITTEN — `String(undefined)` is
  // `"undefined"`, and every ISO date sorts below it, so a one-entry array
  // admitted every row from `start` onward while the sibling faces read the
  // same document as one day and as all of history.
  const [start, end] = explicitDateRangeWindow(dateRange as readonly unknown[]);
  return { start, end, endExclusive: false };
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
  // [#19810] The operator vocabulary is decided BEFORE the rows are read, so an
  // unevaluable predicate refuses over an empty seed draft too — see
  // {@link assertPreviewCanEvaluate}.
  // [#19888] A list in the equality slot first, through the gate the published
  // `where` door runs: {@link matchesWhere} would otherwise compare each row
  // against the list's STRING form (`'won,lost'`) and chart that, for a filter
  // publish refuses `INVALID_FILTER` / 400 (ruling 乙, #19757).
  assertNoListInEqualitySlot(query.where);
  assertPreviewCanEvaluate(query.where);
  let filtered = rows.filter((r) => matchesWhere(r, query.where));
  const timeDims = query.timeDimensions ?? [];
  for (const td of timeDims) {
    const dim = cube.dimensions?.[td.dimension];
    const field = String(dim?.sql ?? td.dimension);
    if (!td.dateRange) continue;
    // [#16322] One lowering for both arms — the closed preset vocabulary, or
    // the caller's explicit window — and a refusal for anything else.
    const explicit = Array.isArray(td.dateRange);
    const { start, end, endExclusive } = lowerPreviewDateRange(td.dateRange, query.timezone);
    // Bare-day end → half-open `< day+1`, the same translation the SQL
    // paths apply (#3777); a full-timestamp end keeps the historical
    // `'~'`-suffix trick (inclusive of that instant's own sub-values).
    // ⛔ Neither reaches a RESOLVED preset window: it states its own upper
    // reading and is never a bare day — the ten calendar presets stop BEFORE
    // their end instant, the three rolling ones end at NOW and reach it.
    const nextDay = explicit ? nextUtcCalendarDay(end) : null;
    filtered = filtered.filter((r) => {
      const v = String(r[field] ?? '');
      const inUpper = endExclusive
        ? v < end
        : nextDay != null
          ? v < nextDay
          : explicit
            ? v <= `${end}~`
            : v <= end;
      return v >= start && inUpper;
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
