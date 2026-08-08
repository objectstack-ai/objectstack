// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Canonical conformance cases for the **aggregate vocabulary** — the shared
 * standard every backend that lowers `QueryAST.aggregations` is checked
 * against, so two faces of one platform cannot answer one aggregation with two
 * numbers.
 *
 * ## Why this exists
 *
 * `AggregationFunction` is lowered by several independent implementations, and
 * the two that matter most are two FACES OF ONE DRIVER:
 *
 * | Face | Where |
 * |---|---|
 * | SQL compiler (LOCAL) | `driver-sql` `SqlDriver.aggregate` / `mapAggregateFunc` |
 * | Turso REMOTE compiler | `driver-turso` `RemoteTransport.aggregate` |
 *
 * `TursoDriver` picks between them from `url`, so a divergence here is not a
 * cross-product inconsistency a user could reason about — it is ONE driver
 * answering one query two ways depending on a connection string. That seam has
 * split before on the aggregate axis alone: #5907 (one condition, two wire
 * identities), #6203 (`COUNT` compiled remote, refused local), #6321 (an
 * undeclared `agg.func` limb tolerated on both). Each of those was found by
 * someone reading two files side by side. This table is what makes the next one
 * fail a test instead.
 *
 * `count_distinct` is the case the table was created for (#6409). Its lowering
 * is the first one where the two faces do something the OTHER four do not —
 * emit a keyword INSIDE the argument list (`count(distinct x)`) rather than
 * wrap the column in a function name — so it is the first entry where "both
 * faces read the same lowering table" stops being enough and the emitted SQL
 * has to be compared on RESULTS.
 *
 * ## Deliberate scope
 *
 * **Values computed over rows, for the functions the SQL family lowers.** Every
 * case names a function, a field, an optional single `groupBy` column, and the
 * number each group must produce. What is deliberately OUT:
 *
 * - **Refusals.** {@link AggregationCase} has no way to spell "this must be
 *   rejected" — `expected` is a value list. The refusal envelope (#5907:
 *   `INVALID_QUERY`/400 for an undeclared name, `NOT_IMPLEMENTED`/501 for a
 *   declared-but-uncompiled one) is pinned per face by
 *   `sql-driver-out-of-contract-aggregate-function.test.ts` and
 *   `remote-transport-aggregate-function-refusal.test.ts`, which compare the
 *   two faces' RUNTIME errors against each other. Same discipline as
 *   `filter-logic-conformance.ts`, which left its one rejection family out for
 *   exactly this reason.
 * - **Date bucketing.** `groupBy` here is a bare column name. Bucketed grouping
 *   is a per-dialect capability published as `supports.queryDateGranularity`
 *   and checked by `date-bucket-parity.test.ts`; folding it in would make the
 *   table unpassable for a face that legitimately buckets nothing.
 * - **Presentation.** `min`/`max` hand back a value OF the column and the SQL
 *   driver re-presents it; the fixture's aggregated column is a plain number so
 *   that path is not exercised here. `sql-driver-aggregate-temporal-output.test.ts`
 *   owns it.
 *
 * ## NULL is IN, and it is the point of the table
 *
 * {@link AggregationRow.stage} is nullable, and every `count_distinct` case
 * turns on it. `COUNT(DISTINCT col)` excludes NULLs — measured, not assumed,
 * on the two dialects a harness for these faces can actually run (SQLite via
 * better-sqlite3 for the local face, SQLite-behind-the-libsql-interface for the
 * remote one) and consistent with the standard's `COUNT` being defined over
 * non-null values in PostgreSQL and MySQL alike. A backend that counted NULL as
 * a distinct value would answer `3` where {@link AGGREGATION_CASES} says `2`,
 * and that is not a theoretical failure mode: it is what `driver-mongodb`'s
 * `$addToSet` → `$size` lowering does today (see the DEBT list below).
 *
 * The `count` cases sit beside them on purpose. `count(stage)` is `4` while
 * `count_distinct(stage)` is `2` and `count(*)` is `6`: three different numbers
 * over one column, so a face that collapsed `count_distinct` into either
 * neighbour — the exact failure a `default:` arm or a copied lowering produces
 * — shows up as a wrong value rather than as a passing test.
 *
 * ## Enrolled backends
 *
 * - **`driver-sql`** — `sql-driver-aggregation-conformance.test.ts`, on a real
 *   better-sqlite3 database.
 * - **`driver-turso` REMOTE** — `turso-remote-aggregation-conformance.test.ts`,
 *   through `makeLibsqlSqliteStub` (libsql IS SQLite, so the transport gets real
 *   value semantics with no network).
 *
 * `driver-sqlite-wasm` and `driver-turso` LOCAL are deliberately NOT on that
 * list: both *inherit* `SqlDriver`, so they re-run one compiler rather than
 * check a second one — the same judgement `filter-logic-conformance.ts` records
 * about its own enrolment.
 *
 * ## DEBT — backends that would fail this table, and why they are not enrolled
 *
 * Recorded rather than quietly omitted: an unenrolled backend that would go RED
 * is a divergence, and a table that lists only its passing members reads as
 * coverage it does not have.
 *
 * | Backend | Verdict | Evidence |
 * |---|---|---|
 * | `driver-memory` (data face) | **RED** — answers `null` | `MemoryDriver.computeAggregate` has no `count_distinct` arm; the `switch` falls to `default: return null`, so the aggregation resolves with no value and no error. |
 * | `driver-memory` (analytics face) | **agrees** | `memory-analytics.ts` collects `$addToSet` and sizes it — the same NULL question as MongoDB below; not executed against this table. |
 * | `driver-mongodb` | **RED** — counts NULL | `count_distinct` lowers to `$addToSet` and `postProcessAggregation` takes the array's `.length`, so an explicit `null` is one of the distinct values. Read from the source; not executed. |
 *
 * Both packages are inside the **#5499 investment freeze**, which is why these
 * are DEBT rows and not fixes: #6409's ruling put them explicitly out of scope
 * and left their partial implementations untouched. Enrolling either means
 * lifting the freeze for it first — the row is here so that decision is made
 * against a measured verdict instead of an assumption that they already agree.
 *
 * `objectql`'s in-memory fallback (`in-memory-aggregation.ts`) is a fourth
 * lowering and is NOT frozen: it computes `count_distinct` as
 * `new Set(values.filter(v => v != null)).size`, which is this table's answer.
 * It is unenrolled only because it is not a SQL face and reaching it needs the
 * engine rather than a driver; enrolling it is a candidate, not a debt.
 *
 * @see FILTER_LOGIC_CASES — the combinator standard this table is modelled on.
 */

import type { AggregationFunction } from './query.zod';

/**
 * A row in the conformance fixture.
 *
 * Six rows over two groups, shaped so that no two of `count(*)`,
 * `count(stage)` and `count_distinct(stage)` agree — see the note above.
 */
export interface AggregationRow {
  id: string;
  /**
   * The GROUP BY column. Two groups of unequal size, and their
   * `count_distinct(stage)` answers differ (`west` → 2, `east` → 1), so a face
   * that computed the grouped aggregate over the whole table instead of per
   * group cannot pass by coincidence.
   */
  region: string;
  /**
   * The NULLABLE, duplicate-bearing column every `count_distinct` case targets.
   *
   * Harnesses MUST declare it nullable and seed the nulls AS nulls: a `NOT NULL`
   * column, or a seed substituting `''`, turns the null cases green for the
   * wrong reason — "does this lowering drop NULLs" is the question they exist
   * to ask.
   */
  stage: string | null;
  /**
   * A non-null numeric column for the arithmetic aggregates. Deliberately
   * all-distinct so `count_distinct(score)` equals the row count: the pair of
   * `count_distinct` cases then straddles the interesting axis — one column
   * where dedup and nulls both bite, one where neither does.
   */
  score: number;
}

/**
 * The fixture, as stored. `west` carries the duplicate (`won` twice) and a
 * null; `east` carries one value and a null, so BOTH groups exercise null
 * exclusion while only one exercises dedup.
 */
export const AGGREGATION_ROWS: readonly AggregationRow[] = [
  { id: '1', region: 'west', stage: 'won',  score: 10 },
  { id: '2', region: 'west', stage: 'won',  score: 20 },
  { id: '3', region: 'west', stage: 'lost', score: 30 },
  { id: '4', region: 'west', stage: null,   score: 40 },
  { id: '5', region: 'east', stage: 'won',  score: 50 },
  { id: '6', region: 'east', stage: null,   score: 60 },
] as const;

/**
 * One expected aggregate value.
 *
 * `group` is the value of the {@link AggregationCase.groupBy} column, or `null`
 * for a whole-table aggregate — not `undefined`, so a harness that forgot to
 * project the grouping column fails on a comparison rather than on a missing
 * key.
 */
export interface AggregationExpectation {
  readonly group: string | null;
  readonly value: number;
}

/** One conformance case: an aggregation, and the value(s) it must produce. */
export interface AggregationCase {
  /** Stable identifier, usable as a test name. */
  readonly name: string;
  /**
   * Typed against the declared enum on purpose (#4918): a name that LEAVES
   * `AggregationFunction` fails `tsc` here rather than leaving a case that
   * silently tests nothing.
   */
  readonly function: AggregationFunction;
  /** Omitted for the `COUNT(*)` spelling the spec allows. */
  readonly field?: string;
  /** The single GROUP BY column, or omitted for a whole-table aggregate. */
  readonly groupBy?: 'region';
  /** Ascending by `group`, with `null` first for the ungrouped case. */
  readonly expected: readonly AggregationExpectation[];
  /** Why the case is here — surfaced in failure output. */
  readonly note?: string;
}

/**
 * The cases. The whole compiled vocabulary, not only the new cell: the
 * arithmetic aggregates are the controls that keep a `count_distinct`
 * implementation from being "passed" by a change that broke everything else,
 * and they are what a third-party driver author most wants the table for.
 */
export const AGGREGATION_CASES: readonly AggregationCase[] = [
  // ── count: the three numbers one column can produce ────────────────────────
  {
    name: 'count(*) counts rows, nulls included',
    function: 'count',
    expected: [{ group: null, value: 6 }],
  },
  {
    name: 'count(stage) counts non-null values, duplicates included',
    function: 'count',
    field: 'stage',
    expected: [{ group: null, value: 4 }],
    note: 'The neighbour count_distinct must NOT equal: dedup is the difference.',
  },
  {
    name: 'count_distinct(stage) counts distinct NON-NULL values',
    function: 'count_distinct',
    field: 'stage',
    expected: [{ group: null, value: 2 }],
    note:
      '#6409: `won` twice collapses to one and the two nulls contribute nothing — '
      + '4 means the dedup was dropped, 3 means NULL was counted as a value, '
      + '6 means the lowering fell through to count(*).',
  },
  {
    name: 'count_distinct over an all-distinct non-null column equals the row count',
    function: 'count_distinct',
    field: 'score',
    expected: [{ group: null, value: 6 }],
    note:
      'The control for the case above: with nothing to dedup and no nulls, '
      + 'count_distinct and count agree — so the previous case cannot be passed '
      + 'by a lowering that always subtracts something.',
  },

  // ── the arithmetic vocabulary ─────────────────────────────────────────────
  {
    name: 'sum(score)',
    function: 'sum',
    field: 'score',
    expected: [{ group: null, value: 210 }],
  },
  {
    name: 'avg(score)',
    function: 'avg',
    field: 'score',
    expected: [{ group: null, value: 35 }],
  },
  {
    name: 'min(score)',
    function: 'min',
    field: 'score',
    expected: [{ group: null, value: 10 }],
  },
  {
    name: 'max(score)',
    function: 'max',
    field: 'score',
    expected: [{ group: null, value: 60 }],
  },

  // ── grouped: the aggregate is computed PER GROUP ──────────────────────────
  {
    name: 'count_distinct(stage) grouped by region',
    function: 'count_distinct',
    field: 'stage',
    groupBy: 'region',
    expected: [
      { group: 'east', value: 1 },
      { group: 'west', value: 2 },
    ],
    note:
      'The two groups disagree on purpose — an aggregate computed over the whole '
      + 'table and repeated per group would answer 2/2, and the ungrouped case '
      + 'above cannot see that.',
  },
  {
    name: 'count(stage) grouped by region',
    function: 'count',
    field: 'stage',
    groupBy: 'region',
    expected: [
      { group: 'east', value: 1 },
      { group: 'west', value: 3 },
    ],
    note: 'The grouped neighbour: `west` is 3 here and 2 above.',
  },
  {
    name: 'count(*) grouped by region',
    function: 'count',
    groupBy: 'region',
    expected: [
      { group: 'east', value: 2 },
      { group: 'west', value: 4 },
    ],
  },
  {
    name: 'sum(score) grouped by region',
    function: 'sum',
    field: 'score',
    groupBy: 'region',
    expected: [
      { group: 'east', value: 110 },
      { group: 'west', value: 100 },
    ],
  },
] as const;
