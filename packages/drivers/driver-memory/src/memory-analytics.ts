// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import type { IAnalyticsService, AnalyticsResult, CubeMeta } from '@objectstack/spec/contracts';
import type { Cube, AnalyticsQuery } from '@objectstack/spec/data';
// [#6520] `$icontains`' ASCII-only fold, from the spec's one definition.
// [#7117] `likePatternToGlobPattern` — the spec's one LIKE→GLOB translation, so
// the SQL exit's wildcard rendering is not a third hand-copy of that escape.
import { asciiCaseInsensitiveRegexSource, likePatternToGlobPattern } from '@objectstack/spec/data';
import type { InMemoryDriver } from './memory-driver.js';
import { Logger, createLogger, nextUtcCalendarDay } from '@objectstack/core';
import {
  assertFilterConditionShape,
  uncompilableCombinatorError,
  uncompilableFieldOperatorError,
  type FilterFaceCapabilities,
} from './filter-refusal.js';

/**
 * [#5345] The Filter Protocol operators this face can LOWER into a cube-style
 * `{member, operator, values}` entry — and, because
 * {@link ANALYTICS_FILTER_CAPABILITIES} is derived from its keys, the complete
 * statement of what the face accepts.
 *
 * That derivation is the point. This table used to be a `switch` with
 * `default: return null`, and the caller answered `null` with `continue` — so
 * the vocabulary was declared nowhere and enforced nowhere, and the five
 * declared operators missing from it (`$between`, `$startsWith`, `$endsWith`,
 * `$null`, `$regex`) vanished out of any `where` that carried them. Keeping the
 * gate's vocabulary and the compiler's table as one object makes adding a row
 * here the only way to widen what this face accepts, and makes forgetting to
 * add one a loud refusal rather than a wrong number.
 *
 * A row here used to mean only that the face ATTEMPTS the operator, not that the
 * predicate it builds is correct. Both halves of that caveat are now closed:
 * #5373 removed the `string[]` comparand round-trip that lost booleans and
 * `null` (see {@link NormalizedCubeFilter}), and #5374 replaced the
 * operator-name→operator-name mapping — under which `notContains` compiled to a
 * bare mingo `{$not: 'x'}` that constrains nothing — with
 * {@link CUBE_OPERATOR_TO_MONGO_PREDICATE}, which builds the whole predicate.
 *
 * The literal `as const` is load-bearing, not style: it makes
 * {@link CubeOperator} the exact union of this table's values, and that union is
 * the key type of the predicate table. Adding a row here without teaching the
 * compiler how to build its predicate is therefore a TYPE ERROR rather than a
 * wrong number — which is the whole point of #5345 keeping the gate's vocabulary
 * and the compiler's table as one statement.
 */
const MONGO_TO_CUBE_OPERATOR = Object.freeze({
  $eq: 'equals',
  $ne: 'notEquals',
  $gt: 'gt',
  $gte: 'gte',
  $lt: 'lt',
  $lte: 'lte',
  $in: 'in',
  $nin: 'notIn',
  $contains: 'contains',
  $notContains: 'notContains',
  // [#6520] This face lowers `$icontains` too, so the analytics/cube surface
  // answers it like the driver's other two. Leaving it out would have been a
  // LOUD refusal (`uncompilableFieldOperatorError` — "declared, but this face
  // cannot compile it"), not a silent drop; it is added because the cube
  // pipeline can express it, and one driver answering one operator two ways by
  // entry point is the divergence class #5374 closed for `$contains`.
  $icontains: 'icontains',
  $exists: 'set',
} as const);

/**
 * [#5374] The cube-style operator names this face lowers into — exactly the
 * values of {@link MONGO_TO_CUBE_OPERATOR}, derived rather than restated so the
 * two cannot drift.
 */
type CubeOperator = (typeof MONGO_TO_CUBE_OPERATOR)[keyof typeof MONGO_TO_CUBE_OPERATOR];

/**
 * [#5345] What the analytics (cube) face compiles, for the shared filter walk.
 *
 * `$and` is the one combinator: {@link MemoryAnalyticsService.flattenFilterCondition}
 * folds its branches into the same implicit-AND list the top level already is.
 * `$or` and `$not` have no expression in a flat `{member, operator, values}`
 * pipeline at all — which is why they were being skipped, and why refusing is
 * the answer here rather than a lowering nobody can write.
 */
export const ANALYTICS_FILTER_CAPABILITIES: FilterFaceCapabilities = Object.freeze({
  face: "driver-memory's analytics (cube) face",
  fieldOperators: new Set<string>(Object.keys(MONGO_TO_CUBE_OPERATOR)),
  combinators: new Set<string>(['$and']),
});

/**
 * [#5373] One lowered constraint: the private intermediate between
 * {@link MemoryAnalyticsService.normalizeFilters} and the two exits that consume
 * it (`query()` → a mingo `$match`, `generateSql()` → a SQL literal).
 *
 * # Why `values` is `unknown[]` and not `string[]`
 *
 * It was `string[]`, because the cube WIRE format serialises filter values as
 * strings. So every comparand made a JS value → string → JS value round trip,
 * and that round trip is lossy for everything that is not already a string:
 *
 * | authored | stringified | recovered | compared against | result |
 * |---|---|---|---|---|
 * | `true` | `'1'` | `1` (the `/^-?\d+$/` arm wins) | stored `true` | **0 rows** |
 * | `null` | `''` | `''` | stored `null` | `$ne` matched everything |
 * | `'100'` (text column) | `'100'` | `100` | stored `'100'` | **0 rows** |
 *
 * mingo compares across JS types the way MongoDB compares across BSON types —
 * never equal — so each of those is a wrong row set rather than an error. The
 * encoding's own justification (booleans as `'1'`/`'0'`, "so downstream
 * consumers expecting SQLite-style numeric booleans match correctly") was true
 * for the SQL-generating exit and false for the in-memory one, and both exits
 * shared the one encoding. There is no string form that is correct for both.
 *
 * So the round trip is gone rather than made lossless: the value stays whatever
 * the author wrote, and each exit converts at ITS boundary, where it knows what
 * it needs — `toSqlLiteral` in `generateSql()`, nothing at all in `query()`.
 *
 * This is an INTERNAL representation, which is what makes that affordable.
 * `AnalyticsQuery.where` is a `FilterCondition` and nothing else (#5375 removed
 * the leg that also accepted a cube-style array as input), and the API layer
 * actively REJECTS a `{member, operator, values}` array on the wire — so no
 * caller, no spec schema and no serialized form observes this triple's shape.
 */
interface NormalizedCubeFilter {
  member: string;
  operator: CubeOperator;
  /**
   * The comparands, as authored. Temporal values are put into the field's
   * storage form at the exits ({@link MemoryAnalyticsService.comparandsFor}),
   * never here — that rule needs the resolved field path, which only an exit has.
   */
  values: unknown[];
}

/**
 * [#5374] What one lowered entry gives its predicate builder.
 *
 * Two comparand lists, not one, because the driver's own translation makes the
 * same split and for the same reason (#4047, `normalizeFieldOperators`): a
 * VALUE COMPARISON must be put into the field's storage form or mingo's
 * cross-type comparison drops every row, while an operand that is not a
 * comparand — a `$exists` flag, a `$regex` pattern — must NOT be, because
 * "storage form" is meaningless for it and applying it corrupts the operand.
 *
 * That was not hypothetical here. This face ran every operand through the
 * comparand conversion, so on a declared `datetime` column
 * `{made_at: {$contains: '2026-01-01T00:00:00Z'}}` had its PATTERN rewritten to
 * canonical `'2026-01-01T00:00:00.000Z'` and then matched the row, where
 * `find()` — which never rewrites a pattern — matched nothing.
 */
interface MongoPredicateInput {
  /** Comparands in the field's storage form (#4047). For value comparisons. */
  readonly comparands: readonly unknown[];
  /** The operands as authored. For operands that are not comparands. */
  readonly raw: readonly unknown[];
  /**
   * A comparand as a literal-substring pattern, built by the DRIVER's own rule
   * (`filterSubstringPattern`) rather than re-derived here.
   *
   * [#7723] Case-EXACT, because that rule is: `filterSubstringPattern` carried
   * an `i` flag until #7723 took it off, putting the `$contains` family on the
   * #4706 Q2 = A answer across every face of this package. Borrowing the rule
   * rather than restating it is what made that one edit reach this face too.
   */
  readonly substring: (value: unknown) => RegExp;
  /**
   * [#6520] A comparand as an ASCII-case-insensitive literal-substring pattern —
   * `$icontains`' fold, which is NOT {@link substring}'s.
   *
   * The two are deliberately separate functions rather than one with a flag.
   * `substring` is case-EXACT (#4706 Q2 = A, landed for this package in #7723);
   * this one folds `A-Z` and nothing else, which is what the protocol says
   * `$icontains` means (#4706 Q1 = A). Collapsing them would silently give one
   * of the two operators the other's answer — and note the fold lives in the
   * pattern SOURCE, never in a RegExp flag, because an `i` flag folds the whole
   * Unicode range and would answer `CAFÉ` for `café`.
   */
  readonly asciiSubstring: (value: unknown) => RegExp;
}

type MongoPredicateBuilder = (input: MongoPredicateInput) => Record<string, unknown>;

/**
 * [#5374] How each cube operator becomes a mingo field predicate — the whole
 * `{$op: …}` object, not the name of an operator.
 *
 * # Why the shape changed
 *
 * This was `convertOperatorToMongo(operator): string`, a name→name map, and the
 * call site filled the name in as `matchStage[field] = {[name]: comparand}`.
 * That shape can express "compare this field to this value" and NOTHING else,
 * so the two entries that need to WRAP their comparand were forced through it
 * anyway:
 *
 *   - `notContains` → `'$not'` became `{name: {$not: 'et'}}`. mingo's `$not`
 *     takes a regex or an operator expression; given a bare scalar it
 *     constrains nothing, so the predicate was emitted, looked present in the
 *     pipeline, and passed the whole table (#5374: 3 rows where `find()`
 *     returns 2). A predicate that is emitted and inert is indistinguishable
 *     from a correct one at the author's end, and widens in the #3948
 *     direction.
 *   - `contains` → `'$regex'` became `{name: {$regex: 'a.p'}}` — the right
 *     operator, but the comparand went in raw, so it was neither escaped nor
 *     case-folded and meant something other than what `find()` means by it.
 *
 * A builder can say `{$not: {$regex: …}}`, so the class of "this operator needs
 * a structure and the table can only hold a name" is gone rather than this one
 * instance of it. `$in`/`$nin`/`$lte`/`$exists`, which the call site had grown
 * an `if` chain for, are ordinary rows here for the same reason.
 *
 * # Why it is a `Record<CubeOperator, …>`
 *
 * Because the missing-entry case had a `|| '$eq'` fallback, and a misspelled or
 * unmapped operator silently became an EQUALITY comparison — the exact
 * silent-wrong-answer shape #5345, #5373 and this issue have each been closing.
 * After #5345 that fallback was unreachable (`mongoOperatorToCubeOperator`
 * refuses anything not in {@link MONGO_TO_CUBE_OPERATOR}, and both exits consume
 * only `normalizeFilters` output), but only until someone widened the vocabulary
 * — which #5345 deliberately made a ONE-LINE edit to that table. Keying this
 * table by {@link CubeOperator} makes that edit fail to compile until the
 * predicate exists, so the fallback is not merely unreachable, it is
 * unnecessary: the totality is proven, not defended.
 *
 * Two entries were deleted rather than kept. `'notSet': '$exists'` and
 * `'inDateRange': '$gte'` were both unreachable (nothing lowers to either name)
 * and both wrong if they ever had been: the first inverts — the call site would
 * have compiled `notSet` to `{$exists: true}` — and the second answers a
 * two-ended range with a one-ended `>=`, which its own comment conceded ("Will
 * need special handling") and which nothing implemented. Dead code that is
 * ALSO wrong is a trap primed for whoever widens the vocabulary next; the type
 * error they now get instead says so at the only moment it helps.
 */
const CUBE_OPERATOR_TO_MONGO_PREDICATE: Readonly<Record<CubeOperator, MongoPredicateBuilder>> = Object.freeze({
  equals: ({ comparands }) => ({ $eq: comparands[0] }),
  notEquals: ({ comparands }) => ({ $ne: comparands[0] }),
  gt: ({ comparands }) => ({ $gt: comparands[0] }),
  gte: ({ comparands }) => ({ $gte: comparands[0] }),
  lt: ({ comparands }) => ({ $lt: comparands[0] }),
  // A bare-day `lte` bound means "through that whole day" (#4042; the SQL twin
  // is #3777): compile half-open so timestamp values on the final day stay in.
  // Order-equivalent to `$lte` for plain `YYYY-MM-DD` values.
  lte: ({ comparands }) => {
    const nextDay = nextUtcCalendarDay(comparands[0]);
    return nextDay != null ? { $lt: nextDay } : { $lte: comparands[0] };
  },
  // The list operators take the WHOLE list. An empty one is a real predicate —
  // `$in: []` selects nothing, `$nin: []` selects everything — and saying so
  // here is what retires the call site's `values.length > 0` guard, under which
  // `{code: {$in: []}}` emitted no predicate at all and answered with the whole
  // table while `find()` answered with none of it.
  in: ({ comparands }) => ({ $in: [...comparands] }),
  notIn: ({ comparands }) => ({ $nin: [...comparands] }),
  // A pattern, not a comparand: `raw`, and the driver's own substring rule.
  contains: ({ raw, substring }) => ({ $regex: substring(raw[0]) }),
  // [#6520] The case-INSENSITIVE twin, folding ASCII and nothing else. It takes
  // `asciiSubstring`, not `substring`: the neighbour above folds Unicode, so
  // reusing it here would answer `CAFÉ` for `café` on this face while the SQL
  // family answered no rows — the divergence #6520 closed.
  icontains: ({ raw, asciiSubstring }) => ({ $regex: asciiSubstring(raw[0]) }),
  // The fix this issue is about. `{$not: <scalar>}` constrains nothing; the
  // negation has to wrap a pattern, which is exactly what the live query path
  // builds for `$notContains` (`memory-driver.ts` `normalizeFieldOperators`).
  notContains: ({ raw, substring }) => ({ $not: { $regex: substring(raw[0]) } }),
  // A presence flag, not a comparand. The `raw.length === 0` arm keeps the old
  // call site's reading of a valueless `set` ("does it exist" → true).
  set: ({ raw }) => ({ $exists: raw.length > 0 ? Boolean(raw[0]) : true }),
});

/**
 * [#7117] What one lowered entry gives its SQL predicate builder — the SQL twin
 * of {@link MongoPredicateInput}, and split along the same seam for the same
 * reason: a VALUE COMPARISON is rendered from the comparand in the field's
 * storage form, while a PATTERN operand is built from what the author wrote.
 */
interface SqlPredicateInput {
  /** The resolved column expression this predicate constrains. */
  readonly column: string;
  /** Comparands in the field's storage form (#4047). For value comparisons. */
  readonly comparands: readonly unknown[];
  /** The operands as authored. For operands that are not comparands. */
  readonly raw: readonly unknown[];
  /** One comparand as a SQL literal ({@link MemoryAnalyticsService.toSqlLiteral}). */
  readonly literal: (value: unknown) => string;
  /**
   * A comparand as a case-EXACT substring GLOB pattern, already a SQL literal.
   * See {@link globSubstringPattern} for why GLOB and not LIKE.
   */
  readonly globSubstring: (value: unknown) => string;
}

type SqlPredicateBuilder = (input: SqlPredicateInput) => string;

/**
 * [#7117] A comparand as a SQLite `GLOB` pattern that matches it as a literal
 * SUBSTRING — the wildcard rendering this issue is about.
 *
 * ## Why a pattern at all
 *
 * `generateSql()` used to emit the bare comparand: `{name: {$contains: 'acme'}}`
 * echoed `WHERE name LIKE 'acme'`, which is an EQUALITY, next to a `query()`
 * that returns every row CONTAINING `acme`. The echo's whole job is reproducing
 * execution, so an author who runs it to debug a chart gets a NARROWER row set
 * and reads the filter as broken — the #5333 / #3650 class ("a rendering that
 * contradicts execution is worse than no rendering") reached through this
 * package's analytics face.
 *
 * ## Why GLOB and not LIKE
 *
 * This exit emits SQLite-shaped SQL — the dialect its sibling decisions already
 * assume ({@link MemoryAnalyticsService.toSqlLiteral} spells booleans `1`/`0`,
 * and #6520's `icontains` row reasoned from SQLite's ASCII-only `LIKE`). On
 * SQLite `LIKE` folds ASCII case and the fold cannot be turned off per
 * statement, while #4706 Q2 = A rules the `$contains` family case-SENSITIVE and
 * #7723 put this package's execution faces on that answer. So a `LIKE` echo
 * would have contradicted execution on a SECOND axis the moment the first was
 * fixed: right rows for the wrong case. `GLOB` is case-exact by definition,
 * which is exactly why `driver-sql`'s `textMatchPredicate` picks it for its own
 * SQLite arm — this is the same cell of that table, rendered as a literal
 * instead of a binding.
 *
 * ## Why the translation is borrowed and not written here
 *
 * GLOB's pattern language is not LIKE's: `*` / `?` / `[` are metacharacters to
 * GLOB and ORDINARY characters to LIKE, and forgetting that direction is the
 * `%`-matches-every-row bypass (#5567) wearing GLOB's clothes. The spec owns one
 * definition of the translation (`likePatternToGlobPattern`), so the comparand
 * is LIKE-escaped into a substring pattern and handed to it — a third hand-copy
 * of the escape is the thing `service-analytics`' `like-pattern.ts` header says
 * to refuse, and this is how it is refused.
 *
 * The LIKE escape in front of it is what keeps an author's own metacharacter
 * literal: `{name: {$contains: '%'}}` matched NO row on `query()` and every
 * non-null row on the echoed `LIKE '%'`, which is the widening direction, not
 * the narrowing one this issue opened on.
 */
function globSubstringPattern(value: unknown): string {
  return likePatternToGlobPattern(`%${String(value).replace(/[\\%_]/g, '\\$&')}%`);
}

/**
 * [#7117] How each cube operator becomes a SQL predicate — the whole clause, not
 * the name of an operator.
 *
 * # Why the shape changed
 *
 * This was `operatorToSql(operator): string`, a name→name map, and the WHERE
 * builder filled the name in as `${column} ${op} ${literal}`. That shape can say
 * "compare this column to this value" and NOTHING else, which is the same
 * expressiveness ceiling {@link CUBE_OPERATOR_TO_MONGO_PREDICATE} was built to
 * break on the mingo side in #5374 — and it failed here in the same three ways:
 *
 *   - **The LIKE family had nowhere to put its wildcards.** `contains` →
 *     `'LIKE'` rendered `name LIKE 'acme'`, an equality. See
 *     {@link globSubstringPattern}.
 *   - **`in` / `notIn` / `set` are not in the table at all**, so they fell to
 *     its `|| '='` fallback — the silent-wrong-answer shape #5374 and #5345
 *     removed from this file's sibling tables. Measured against `query()` on
 *     the fixture in `memory-analytics-echo-operator-coverage.test.ts`:
 *     `{name: {$nin: [a]}}` echoed `name = a`, the exact COMPLEMENT of the rows
 *     `query()` returns; `{name: {$in: [a, b]}}` echoed only `a`;
 *     `{name: {$exists: true}}` echoed `name = 1`, which selects nothing at all.
 *     (`startsWith` / `endsWith`, which this issue's text also expected to land
 *     on that fallback, cannot reach it: they are not in
 *     {@link MONGO_TO_CUBE_OPERATOR}, so `normalizeFilters` REFUSES them for
 *     both exits with `INVALID_FILTER` / 400 — loudly, per #5345.)
 *   - **A negation could not be made null-safe**, because `(a OR b)` is not a
 *     name. SQL is three-valued and a `WHERE` keeps only TRUE, so a bare
 *     `col != v` / `col NOT GLOB v` drops every row whose column is NULL, while
 *     mingo returns them. #5146 ruled that divergence closed repo-wide and
 *     #5297 spells the remedy — `(col IS NULL OR <test>)`, which is what
 *     `read-scope-sql.ts`'s `nullSafeNegative` emits for `$ne` / `$nin` /
 *     `$notContains`. The three negative rows below are that same rewrite.
 *
 * # Why it is a `Record<CubeOperator, …>`
 *
 * Same reason as its mingo twin, and it is the load-bearing half of this fix.
 * The `|| '='` fallback is not merely unreachable now — it is UNNECESSARY:
 * keying by {@link CubeOperator} makes widening {@link MONGO_TO_CUBE_OPERATOR}
 * (a deliberate one-line edit, per #5345) fail to COMPILE until this table has
 * the new operator's SQL spelling. The totality is proven rather than defended,
 * so no future operator can silently render as an equality nobody wrote.
 *
 * # The one cell where SQL cannot say what mingo says
 *
 * `set` renders `IS NOT NULL` / `IS NULL` — the spelling this repo's other two
 * SQL lowerings already use (`read-scope-sql.ts`'s `$exists` arm, `driver-sql`'s
 * "a present field is a non-null column in SQL"). It is not an exact
 * translation, and cannot be: mingo's `$exists` tests KEY PRESENCE, which a
 * relational column always has. A row storing an explicit `null` therefore
 * satisfies `$exists: true` on `query()` and fails `IS NOT NULL` in the echo.
 * That residue is inherent to describing a document store in SQL, it is pinned
 * as an explicit inequality in `memory-analytics-echo-operator-coverage.test.ts`
 * so it cannot be "fixed" in silence, and it is a far smaller gap than the
 * `name = 1` it replaces — which matched nothing at all.
 */
const CUBE_OPERATOR_TO_SQL_PREDICATE: Readonly<Record<CubeOperator, SqlPredicateBuilder>> = Object.freeze({
  // [#5373] A null comparand is a NULLNESS test, not a comparison. SQL's
  // `= NULL` is never true, so emitting one would move the very loss #5373
  // closed from the mingo exit to this one: `{closed_at: null}` would select
  // nothing while `query()` selects the null rows. The two exits have to mean
  // the same thing.
  equals: ({ column, comparands, literal }) =>
    comparands[0] == null ? `${column} IS NULL` : `${column} = ${literal(comparands[0])}`,
  notEquals: ({ column, comparands, literal }) =>
    comparands[0] == null
      ? `${column} IS NOT NULL`
      : `(${column} IS NULL OR ${column} != ${literal(comparands[0])})`,
  gt: ({ column, comparands, literal }) => `${column} > ${literal(comparands[0])}`,
  gte: ({ column, comparands, literal }) => `${column} >= ${literal(comparands[0])}`,
  lt: ({ column, comparands, literal }) => `${column} < ${literal(comparands[0])}`,
  // Half-open on a bare-day bound, exactly as the mingo row above is (#4042; the
  // SQL twin is #3777). `<= '2026-01-02'` drops that day's timestamped rows,
  // which is measurable as an echo one row NARROWER than the chart it describes.
  lte: ({ column, comparands, literal }) => {
    const nextDay = nextUtcCalendarDay(comparands[0]);
    return nextDay != null
      ? `${column} < ${literal(nextDay)}`
      : `${column} <= ${literal(comparands[0])}`;
  },
  // The list operators take the WHOLE list, and an EMPTY one is a real
  // predicate on this side too — `$in: []` selects nothing, `$nin: []`
  // everything. Saying so here is what retires the WHERE builder's
  // `values.length > 0` guard, under which `{code: {$in: []}}` emitted no clause
  // at all and the echo described the whole table while `query()` returns none
  // of it. The mingo row above retired the identical guard in #5374.
  in: ({ column, comparands, literal }) =>
    comparands.length === 0 ? '1 = 0' : `${column} IN (${comparands.map(literal).join(', ')})`,
  notIn: ({ column, comparands, literal }) =>
    comparands.length === 0
      ? '1 = 1'
      : `(${column} IS NULL OR ${column} NOT IN (${comparands.map(literal).join(', ')}))`,
  // A pattern, not a comparand: `raw`, and the shared GLOB substring rule.
  contains: ({ column, raw, globSubstring }) => `${column} GLOB ${globSubstring(raw[0])}`,
  notContains: ({ column, raw, globSubstring }) =>
    `(${column} IS NULL OR ${column} NOT GLOB ${globSubstring(raw[0])})`,
  // [#6520] The case-INSENSITIVE twin. SQLite's `lower()` folds ASCII and
  // nothing else — measured in #6518: `lower('CAFÉ')` is `'cafÉ'` — so it is
  // `$icontains`' fold (#4706 Q1 = A) rather than the Unicode one, and it goes
  // on BOTH sides: folding only the pattern compares a folded needle against a
  // raw column and matches just the rows that were already lower-case.
  icontains: ({ column, raw, globSubstring }) =>
    `lower(${column}) GLOB lower(${globSubstring(raw[0])})`,
  // A presence flag, not a comparand — see this table's docblock for the one
  // cell SQL cannot translate exactly. The `raw.length === 0` arm mirrors the
  // mingo row's reading of a valueless `set`.
  set: ({ column, raw }) =>
    `${column} IS ${raw.length === 0 || Boolean(raw[0]) ? 'NOT NULL' : 'NULL'}`,
});

/**
 * [#6814] The size of a collected `$addToSet`, as `count_distinct` defines it:
 * distinct NON-NULL values of the column.
 *
 * That is what `COUNT(DISTINCT col)` computes on SQLite, PostgreSQL and MySQL
 * alike, what objectql's fallback computes (`in-memory-aggregation.ts`), what
 * this package's own data face computes (`MemoryDriver.computeAggregate`), and
 * what `AGGREGATION_CASES` says — 2 over `AGGREGATION_ROWS`.
 *
 * ## Why the exclusion is HERE and not in the `$group` expression
 *
 * The two server-side spellings were considered and not taken, for the same
 * reasons `driver-mongodb`'s twin records (#6814):
 *
 * - **`$ne: null` before the `$addToSet`** — as a `$match` it drops the row from
 *   the WHOLE pipeline, so a `count` or `sum` measure sharing the query would
 *   silently lose the null rows too. Correct only for a pipeline carrying one
 *   measure, which this builder cannot assume.
 * - **`$size` of a `$setDifference` against `[null]`** — sound, but it puts the
 *   rule in the `$project` stage while the collection stays in `$group`, so the
 *   two halves of one definition sit in different stages built by different
 *   methods. Here they are one expression next to its own explanation.
 *
 * `undefined` is excluded beside `null`: mingo's `$addToSet` skips a MISSING
 * field the way MongoDB's does, so this arm sees `undefined` only via an
 * explicitly-undefined stored value — one state with `null` in SQL, and there is
 * no third.
 */
function sizeDistinctSet(values: readonly unknown[]): number {
  return new Set(values.filter((v) => v !== null && v !== undefined)).size;
}

/**
 * [#7853] A `JSON.stringify` replacer that renders a `RegExp` operand instead of
 * dropping it — the one value type the pipeline dump carries that
 * `JSON.stringify` erases.
 *
 * ## What was lost
 *
 * A `RegExp` has no own enumerable properties, so `JSON.stringify` renders it as
 * `{}`. Three operators put one into the `$match` stage — `contains` and
 * `icontains` as `{$regex: …}`, `notContains` as `{$not: {$regex: …}}` (measured:
 * those three and no others, out of the twelve this face declares) — so
 * `{name: {$contains: 'Industries'}}` dumped as
 *
 * ```
 * /* Stage 1: $match *\/ {"name":{"$regex":{}}}
 * ```
 *
 * The one field an author debugging a chart is looking for is the one the dump
 * dropped. This is lost information on a transparency surface, not the #5333
 * class: the dump is explicitly NOT SQL (its header says so) and `{}` reads as
 * "something is missing here" rather than as a working predicate, which is why
 * it is graded below #7117 rather than beside it.
 *
 * ## Why the pattern's own literal syntax and not `{"$regex":"…","$options":"…"}`
 *
 * The mongo-shaped form is what the rest of the dump speaks, and it was the
 * first candidate. It cannot be reached from a value replacer, and the reason is
 * structural rather than cosmetic: the `RegExp` sits AT the `$regex` key, so
 * replacing it with `{$regex, $options}` renders the doubled
 * `{"name":{"$regex":{"$regex":"Industries","$options":""}}}` — a shape no mongo
 * query has. Flattening it into the real mongo spelling means rewriting the
 * PARENT object, which would make the dump disagree with the pipeline it claims
 * to be dumping: what mingo executes is a JS `RegExp` object at that key, not a
 * source/options pair. Trading a degenerate rendering for a plausible-but-wrong
 * one is the #5333 direction, and this card is explicitly not that.
 *
 * So the value is rendered as the JS literal it is, `/source/flags`, which is
 * also the only one-token form that keeps the FLAGS. Flags are not decoration
 * here: `$icontains`' fold lives in the pattern SOURCE (#6520) while `$contains`
 * is case-EXACT (#7723, #4706 Q2 = A), so a rendering that dropped `i` would
 * recreate a smaller copy of this same information loss on the one axis those
 * two operators differ.
 *
 * ## What it deliberately does not touch
 *
 * Every other value on this path already renders faithfully, measured rather
 * than assumed: a `Date` comparand is canonicalized to an ISO string by
 * {@link MemoryAnalyticsService.comparandsFor} before it reaches here, and
 * `toJSON` runs BEFORE a replacer in any case, so dates are unchanged. A
 * `BigInt` comparand does throw — but out of mingo's own `Query.compile` during
 * EXECUTION, before this dump is ever built, so no replacer here reaches it.
 */
function pipelineDumpReplacer(_key: string, value: unknown): unknown {
  return value instanceof RegExp ? `/${value.source}/${value.flags}` : value;
}

/**
 * Configuration for MemoryAnalyticsService
 */
export interface MemoryAnalyticsConfig {
  /** The data driver instance to use for queries */
  driver: InMemoryDriver;
  /** Cube definitions for the semantic layer */
  cubes: Cube[];
  /** Optional logger */
  logger?: Logger;
}

/**
 * Memory-Based Analytics Service
 * 
 * Implements IAnalyticsService using InMemoryDriver's aggregation capabilities.
 * Provides a semantic layer (Cubes, Metrics, Dimensions) on top of in-memory data.
 * 
 * Features:
 * - Cube-based semantic modeling
 * - Measure calculations (count, sum, avg, min, max, count_distinct)
 * - Dimension grouping
 * - Filter support
 * - Time dimension handling
 * - SQL generation (for debugging/transparency)
 * 
 * This implementation is suitable for:
 * - Development and testing
 * - Local-first analytics
 * - Small to medium datasets
 * - Prototyping BI applications
 */
export class MemoryAnalyticsService implements IAnalyticsService {
  private driver: InMemoryDriver;
  private cubes: Map<string, Cube>;
  private logger: Logger;

  constructor(config: MemoryAnalyticsConfig) {
    this.driver = config.driver;
    this.cubes = new Map(config.cubes.map(c => [c.name, c]));
    this.logger = config.logger || createLogger({ level: 'info', format: 'pretty' });
    this.logger.debug('MemoryAnalyticsService initialized', { cubeCount: this.cubes.size });
  }

  /**
   * Execute an analytical query using the memory driver's aggregation pipeline
   */
  async query(query: AnalyticsQuery): Promise<AnalyticsResult> {
    this.logger.debug('Executing analytics query', { cube: query.cube, measures: query.measures });

    // Get cube definition
    if (!query.cube) {
      throw new Error('Cube name is required');
    }
    const cube = this.cubes.get(query.cube);
    if (!cube) {
      throw new Error(`Cube not found: ${query.cube}`);
    }

    // Build MongoDB aggregation pipeline
    const pipeline: Record<string, any>[] = [];

    // Stage 1: $match for filters
    // `AnalyticsQuery.where` is a FilterCondition (MongoDB-style — the canonical
    // spec shape, used by dashboard widget metadata directly). It is lowered
    // into the cube-style `{member, operator, values}` list this pipeline
    // consumes, and anything this face cannot lower is refused there rather than
    // dropped (#5345).
    const normalizedFilters = this.normalizeFilters(query);
    if (normalizedFilters.length > 0) {
      const matchStage: Record<string, any> = {};
      for (const filter of normalizedFilters) {
        const fieldPath = this.resolveFieldPath(cube, filter.member);
        // [#5374] The operator decides the WHOLE predicate, not just its name —
        // so `notContains` can say `{$not: {$regex: …}}` instead of being forced
        // into `{$not: <comparand>}`, which mingo reads as no constraint at all.
        //
        // [#5373] `comparands` are the values as authored, in the storage form
        // of the field they are compared against. There is no type recovery step
        // any more, because there is no longer a stringification to recover
        // FROM: a boolean reaches mingo as a boolean and `null` as `null`, so a
        // predicate over `is_active` or `closed_at` selects the same rows
        // `find()` selects instead of none / all of them.
        matchStage[fieldPath] = this.mongoPredicateBuilder(filter.operator)({
          comparands: this.comparandsFor(cube, filter.member, filter.values),
          raw: filter.values,
          substring: (value) => this.driver.filterSubstringPattern(value),
          // [#6520] `$icontains`' fold, from the spec's shared definition rather
          // than from the driver's Unicode-folding `filterSubstringPattern`.
          asciiSubstring: (value) => new RegExp(asciiCaseInsensitiveRegexSource(String(value))),
        });
      }
      if (Object.keys(matchStage).length > 0) {
        pipeline.push({ $match: matchStage });
      }
    }

    // Stage 2: Time dimension filters
    if (query.timeDimensions && query.timeDimensions.length > 0) {
      for (const timeDim of query.timeDimensions) {
        const fieldPath = this.resolveFieldPath(cube, timeDim.dimension);
        if (timeDim.dateRange) {
          const range = Array.isArray(timeDim.dateRange)
            ? timeDim.dateRange
            : this.parseDateRangeString(timeDim.dateRange);

          if (range.length === 2) {
            // The window matches BOTH stored forms of a datetime value — the
            // in-memory table holds whatever the writer produced: `Date`
            // objects from direct JS callers AND ISO strings (the driver's own
            // `created_at` default, every REST/JSON write). Mingo compares
            // cross-type as never-equal, so a single-form bound silently
            // empties the other half — the same disease driver-sql's
            // mixed-storage CASE repair cures, expressed as the `$or` a
            // schemaless store allows.
            //
            // Both spellings are half-open on a bare-day end (#4042; the SQL
            // twin is #3777): a `$lte`-at-midnight upper bound dropped the
            // final day's rows for `Date` values and the string spelling
            // inherits `<= day`'s whole-day intent via `< nextDay`.
            const start = String(range[0]);
            const end = String(range[1]);
            const nextDay = nextUtcCalendarDay(end);
            const stringBounds = nextDay != null
              ? { $gte: start, $lt: nextDay }
              : { $gte: start, $lte: end };
            const dateBounds = nextDay != null
              ? { $gte: new Date(start), $lt: new Date(`${nextDay}T00:00:00.000Z`) }
              : { $gte: new Date(start), $lte: new Date(end) };
            pipeline.push({
              $match: {
                $or: [
                  { [fieldPath]: stringBounds },
                  { [fieldPath]: dateBounds },
                ],
              }
            });
          }
        }
      }
    }

    // Stage 3: $group for measures and dimensions
    const groupStage: Record<string, any> = { _id: {} };
    
    // Add dimensions to _id
    if (query.dimensions && query.dimensions.length > 0) {
      for (const dim of query.dimensions) {
        const fieldPath = this.resolveFieldPath(cube, dim);
        const dimName = this.getShortName(dim);
        groupStage._id[dimName] = `$${fieldPath}`;
      }
    } else {
      groupStage._id = null; // No grouping, aggregate all
    }

    // Add measures as computed fields
    if (query.measures && query.measures.length > 0) {
      for (const measure of query.measures) {
        const measureDef = this.resolveMeasure(cube, measure);
        const measureName = this.getShortName(measure);
        
        if (measureDef) {
          const aggregator = this.buildAggregator(measureDef);
          groupStage[measureName] = aggregator;
        }
      }
    }

    pipeline.push({ $group: groupStage });

    // Stage 4: $project to reshape results (use short names, we'll fix them later)
    const projectStage: Record<string, any> = { _id: 0 };
    if (query.dimensions && query.dimensions.length > 0) {
      for (const dim of query.dimensions) {
        const dimName = this.getShortName(dim);
        projectStage[dimName] = `$_id.${dimName}`;
      }
    }
    if (query.measures && query.measures.length > 0) {
      for (const measure of query.measures) {
        const measureName = this.getShortName(measure);
        projectStage[measureName] = `$${measureName}`;
      }
    }
    pipeline.push({ $project: projectStage });

    // Stage 5: $sort (use short names)
    if (query.order && Object.keys(query.order).length > 0) {
      const sortStage: Record<string, any> = {};
      for (const [field, direction] of Object.entries(query.order)) {
        const shortName = this.getShortName(field);
        sortStage[shortName] = direction === 'asc' ? 1 : -1;
      }
      pipeline.push({ $sort: sortStage });
    }

    // Stage 6: $limit and $skip
    //
    // PRESENCE on the limit, not truthiness (#6577) — the same defect and the
    // same reason as `memory-driver.ts`'s slice: `limit: 0` means "return no
    // records" (#6485), `0` is falsy, so the stage was omitted entirely and an
    // analytics read that asked for none came back with every row. Mingo
    // honours `{ $limit: 0 }` as zero records (measured: 3 in, 0 out), so
    // pushing the stage is sufficient here — no short-circuit needed, unlike
    // the MongoDB driver, whose upstream client defines `0` as "no limit".
    if (query.offset) {
      pipeline.push({ $skip: query.offset });
    }
    if (query.limit !== undefined) {
      pipeline.push({ $limit: query.limit });
    }

    // Execute the aggregation pipeline
    const tableName = this.extractTableName(cube.sql);
    const rawRows = await this.driver.aggregate(tableName, pipeline);

    // [#6814] `$addToSet` COLLECTS; a `count_distinct` measure has to ANSWER a
    // number. Without this step the value reached the caller as the raw array
    // of values — under a field `measureTypeToFieldType` describes as `number`,
    // so the response's own metadata disagreed with the cell beside it — and it
    // included `null`, so even sizing it where it landed would have answered
    // one HIGHER than the standard on any nullable column.
    if (query.measures) {
      for (const measure of query.measures) {
        if (this.resolveMeasure(cube, measure)?.type !== 'count_distinct') continue;
        const shortName = this.getShortName(measure);
        for (const row of rawRows) {
          if (Array.isArray(row[shortName])) row[shortName] = sizeDistinctSet(row[shortName]);
        }
      }
    }

    // Rename fields from short names to full cube.field names
    const rows = rawRows.map(row => {
      const renamedRow: Record<string, unknown> = {};
      
      // Rename dimensions
      if (query.dimensions) {
        for (const dim of query.dimensions) {
          const shortName = this.getShortName(dim);
          if (shortName in row) {
            renamedRow[dim] = row[shortName];
          }
        }
      }
      
      // Rename measures
      if (query.measures) {
        for (const measure of query.measures) {
          const shortName = this.getShortName(measure);
          if (shortName in row) {
            renamedRow[measure] = row[shortName];
          }
        }
      }
      
      return renamedRow;
    });

    // Build field metadata
    const fields: Array<{ name: string; type: string }> = [];
    
    if (query.dimensions) {
      for (const dim of query.dimensions) {
        const dimension = this.resolveDimension(cube, dim);
        fields.push({
          name: dim,
          type: dimension?.type || 'string'
        });
      }
    }
    
    if (query.measures) {
      for (const measure of query.measures) {
        const measureDef = this.resolveMeasure(cube, measure);
        fields.push({
          name: measure,
          type: this.measureTypeToFieldType(measureDef?.type || 'count')
        });
      }
    }

    this.logger.debug('Analytics query completed', { rowCount: rows.length });

    return {
      rows,
      fields,
      sql: this.generateSqlFromPipeline(tableName, pipeline) // For debugging
    };
  }

  /**
   * Get available cube metadata for discovery
   */
  async getMeta(cubeName?: string): Promise<CubeMeta[]> {
    const cubes = cubeName 
      ? [this.cubes.get(cubeName)].filter(Boolean) as Cube[]
      : Array.from(this.cubes.values());

    return cubes.map(cube => ({
      name: cube.name,
      title: cube.title,
      measures: Object.entries(cube.measures).map(([key, measure]) => ({
        name: `${cube.name}.${key}`,
        type: measure.type,
        title: measure.label
      })),
      dimensions: Object.entries(cube.dimensions).map(([key, dimension]) => ({
        name: `${cube.name}.${key}`,
        type: dimension.type,
        title: dimension.label
      }))
    }));
  }

  /**
   * Generate SQL representation for debugging/transparency
   */
  async generateSql(query: AnalyticsQuery): Promise<{ sql: string; params: unknown[] }> {
    if (!query.cube) {
      throw new Error('Cube name is required');
    }
    const cube = this.cubes.get(query.cube);
    if (!cube) {
      throw new Error(`Cube not found: ${query.cube}`);
    }

    const tableName = this.extractTableName(cube.sql);
    const selectClauses: string[] = [];
    const groupByClauses: string[] = [];

    // Build SELECT for dimensions
    if (query.dimensions && query.dimensions.length > 0) {
      for (const dim of query.dimensions) {
        const fieldPath = this.resolveFieldPath(cube, dim);
        selectClauses.push(`${fieldPath} AS "${dim}"`);
        groupByClauses.push(fieldPath);
      }
    }

    // Build SELECT for measures
    if (query.measures && query.measures.length > 0) {
      for (const measure of query.measures) {
        const measureDef = this.resolveMeasure(cube, measure);
        if (measureDef) {
          const aggSql = this.measureToSql(measureDef);
          selectClauses.push(`${aggSql} AS "${measure}"`);
        }
      }
    }

    // Build WHERE clause
    //
    // [#7117] One builder per operator, from a table keyed by `CubeOperator` —
    // the SQL twin of the `$match` construction in `query()`, and total by
    // construction for the same reason. There is deliberately no
    // `values.length > 0` guard any more: an empty list IS a predicate, and
    // skipping the clause described the whole table (see the `in` row).
    const whereClauses: string[] = [];
    const normalizedFilters = this.normalizeFilters(query);
    for (const filter of normalizedFilters) {
      const fieldPath = this.resolveFieldPath(cube, filter.member);
      whereClauses.push(this.sqlPredicateBuilder(filter.operator)({
        column: fieldPath,
        comparands: this.comparandsFor(cube, filter.member, filter.values),
        raw: filter.values,
        literal: (value) => this.toSqlLiteral(value),
        globSubstring: (value) => this.toSqlLiteral(globSubstringPattern(value)),
      }));
    }

    let sql = `SELECT ${selectClauses.join(', ')} FROM ${tableName}`;
    if (whereClauses.length > 0) {
      sql += ` WHERE ${whereClauses.join(' AND ')}`;
    }
    if (groupByClauses.length > 0) {
      sql += ` GROUP BY ${groupByClauses.join(', ')}`;
    }
    if (query.order) {
      const orderClauses = Object.entries(query.order).map(([field, dir]) => 
        `"${field}" ${dir.toUpperCase()}`
      );
      sql += ` ORDER BY ${orderClauses.join(', ')}`;
    }
    // PRESENCE, not truthiness (#6577) — the third site of the same shape in
    // this package. `limit: 0` means "return no records" (#6485), and a dropped
    // `LIMIT 0` widens the statement to the whole table.
    if (query.limit !== undefined) {
      sql += ` LIMIT ${query.limit}`;
    }
    if (query.offset) {
      sql += ` OFFSET ${query.offset}`;
    }

    return { sql, params: [] };
  }

  // ===================================
  // Helper Methods
  // ===================================

  /**
   * Normalize a query's `where` into the cube-style array the pipeline consumes.
   *
   * Accepts a MongoDB-style `FilterCondition` (per spec/data/filter.zod.ts) —
   * the canonical `AnalyticsQuery.where` shape, and the only one the schema
   * declares:
   *   - implicit equality:  `{is_active: true}`
   *   - operator wrapper:   `{stage: {$nin: [...]}}`
   *   - mixed:              `{stage: 'won', amount: {$gte: 100}}`
   *   - `$and`:             folded into the same implicit-AND list
   * → flattened into one cube-style entry per (field, operator) pair.
   *
   * [#5345] Everything outside {@link ANALYTICS_FILTER_CAPABILITIES} is REFUSED
   * with `INVALID_FILTER` / 400, by the same walk the query path and the
   * reference matcher use. It used to be dropped, and the direction of that drop
   * is what made it a defect rather than a limitation: fewer predicates means
   * MORE rows, so a widget filtered on `{$or: [...]}` aggregated the whole table
   * and looked like a working widget. `$not` made it a permission bug on top —
   * `cel-to-filter.ts` compiles a CEL `!expr` RLS read scope into exactly that
   * shape, so dropping it put unreadable rows into the numbers.
   *
   * The gate runs HERE, before a single key is lowered, for the reason
   * `assertFilterConditionShape` documents at length: a refusal raised partway
   * through a lowering fires or does not fire depending on key order and on
   * which sibling branch was walked first. Both public entry points (`query()`
   * and `generateSql()`) go through this method, so both refuse identically.
   */
  private normalizeFilters(query: unknown): NormalizedCubeFilter[] {
    if (!query || typeof query !== 'object') return [];

    const out: NormalizedCubeFilter[] = [];
    const where = (query as { where?: unknown }).where;

    if (where && typeof where === 'object' && !Array.isArray(where)) {
      assertFilterConditionShape(where, 'where', ANALYTICS_FILTER_CAPABILITIES);
      this.flattenFilterCondition(where as Record<string, unknown>, out, 'where');
    }

    return out;
  }

  private flattenFilterCondition(
    cond: Record<string, unknown>,
    out: NormalizedCubeFilter[],
    path: string,
  ): void {
    for (const [key, raw] of Object.entries(cond)) {
      const here = `${path}.${key}`;

      // [#5373] There is deliberately no `if (raw == null) continue` here.
      //
      // There was, and it was the more dangerous half of this issue: `null` is a
      // COMPARAND, not an absent constraint, so `{closed_at: null}` produced no
      // cube entry at all and the predicate simply vanished. One fewer
      // constraint means MORE rows — a "closed_at is empty" widget silently
      // aggregated the whole table, including the closed records it was written
      // to exclude, and a widened chart looks exactly like a working chart. That
      // is the #3948 direction, and on an RLS read scope it is an unauthorized
      // read rather than a wrong number.
      //
      // `undefined` falls through with it, matching the live query path, which
      // has never distinguished the two (`normalizeFilterCondition` sends both
      // to `toStorageForm` and lets mingo's null-equality rule decide). Agreeing
      // with that path is the invariant (#5240); inventing a third reading of
      // `{field: undefined}` here would break it in the other direction.

      // Logical combinators. `$and` folds into the same implicit-AND list; the
      // gate above has already proven it is an array of filter nodes.
      if (key === '$and') {
        for (const sub of raw as unknown[]) {
          this.flattenFilterCondition(sub as Record<string, unknown>, out, here);
        }
        continue;
      }
      // [#5345] Unreachable via normalizeFilters — the gate refuses these for
      // this face before the lowering starts. Kept as a throw rather than left
      // implicit so that the `continue` which caused #5345 cannot come back, and
      // so a future caller that lowers a condition without gating it first fails
      // loudly instead of silently widening the result set.
      if (key === '$or' || key === '$not') {
        throw uncompilableCombinatorError(key, here, ANALYTICS_FILTER_CAPABILITIES);
      }

      // Operator wrapper: { field: { $op: value, ... } }
      //
      // `raw !== null` carries real weight now that the blanket `raw == null`
      // skip above is gone: `typeof null === 'object'`, so a null comparand
      // would otherwise be read as an operator map and reach `Object.keys(null)`.
      // It is a comparand — it belongs to the implicit-equality arm below.
      if (raw !== null && typeof raw === 'object' && !Array.isArray(raw) && !(raw instanceof Date)) {
        const wrapper = raw as Record<string, unknown>;
        const opEntries = Object.keys(wrapper).filter(k => k.startsWith('$'));
        if (opEntries.length > 0) {
          for (const opKey of opEntries) {
            const cubeOp = this.mongoOperatorToCubeOperator(opKey, key, `${here}.${opKey}`);
            const v = wrapper[opKey];
            out.push({ member: key, operator: cubeOp, values: Array.isArray(v) ? [...v] : [v] });
          }
          continue;
        }
        // Otherwise treat as nested relation (e.g. {profile: {verified: true}}).
        // Flatten with dot-prefixed keys.
        for (const [nestedKey, nestedVal] of Object.entries(wrapper)) {
          this.flattenFilterCondition({ [`${key}.${nestedKey}`]: nestedVal }, out, here);
        }
        continue;
      }

      // Implicit equality: { field: scalar | array }
      out.push({
        member: key,
        operator: Array.isArray(raw) ? 'in' : 'equals',
        values: Array.isArray(raw) ? [...raw] : [raw],
      });
    }
  }

  /**
   * Lower a Filter Protocol `$op` key to the cube-style operator name both exits
   * consume — {@link CUBE_OPERATOR_TO_MONGO_PREDICATE} and
   * {@link CUBE_OPERATOR_TO_SQL_PREDICATE} are keyed by its result.
   *
   * [#5345] An operator with no row in {@link MONGO_TO_CUBE_OPERATOR} is
   * REFUSED, not skipped. The gate in `normalizeFilters` refuses the same set
   * one step earlier, so for a top-level or `$and`-nested constraint this throw
   * is unreachable — but the nested-relation branch above re-enters this
   * function with a synthesised `{'a.b': spec}` node the gate never saw, and
   * that is a real path to an unmapped operator. It used to `continue`.
   */
  private mongoOperatorToCubeOperator(op: string, field: string, path: string): CubeOperator {
    const cubeOp = (MONGO_TO_CUBE_OPERATOR as Record<string, CubeOperator | undefined>)[op];
    if (!cubeOp) throw uncompilableFieldOperatorError(op, field, path, ANALYTICS_FILTER_CAPABILITIES);
    return cubeOp;
  }

  /**
   * [#5373] The comparands of one lowered entry, in the storage form of the
   * field they are compared against — the ONE place either exit converts a
   * value, so the two exits cannot drift apart.
   *
   * The only conversion left is the temporal one (#4047): a `datetime` column
   * holds canonical UTC ISO text, so a `Date` comparand has to become that text
   * or mingo's cross-type comparison drops every row. That rule is keyed on the
   * DECLARED field kind and belongs to the driver, so it is borrowed from the
   * driver rather than re-derived here — a second derivation of it is the
   * in-package divergence #5240 ruled against.
   *
   * Everything else passes through untouched. That is the point of #5373: a
   * boolean stays a boolean, `null` stays `null`, and a text column's `'100'`
   * stays the string `'100'` instead of becoming the number `100`.
   */
  private comparandsFor(cube: Cube, member: string, values: unknown[]): unknown[] {
    const table = this.extractTableName(cube.sql);
    const fieldPath = this.resolveFieldPath(cube, member);
    return values.map(v => this.driver.filterComparandStorageForm(table, fieldPath, v));
  }

  /**
   * [#5373] A JS comparand as a SQL literal — the one point where a value is
   * stringified, and the reason it may be.
   *
   * This used to take the cube-stringified `string`, which meant it could only
   * guess the original type back out of the text: `'100'` from a TEXT column
   * looked exactly like `100` from a numeric one, and it emitted both unquoted
   * (`WHERE code = 100`). Given the real value there is nothing to guess.
   *
   * Booleans keep the SQLite-style `1`/`0` spelling the old encoding chose —
   * that justification was always sound for THIS half, and only wrong because
   * the in-memory half was forced to share it.
   *
   * A `null` comparand never reaches here from `equals`/`notEquals`; those rows
   * of {@link CUBE_OPERATOR_TO_SQL_PREDICATE} emit `IS NULL` / `IS NOT NULL`.
   * `NULL` is the honest literal for the remaining operators, which cannot be
   * satisfied by it.
   *
   * [#7117] It also renders the GLOB PATTERNS the text rows build, which is why
   * the quote-doubling matters beyond comparands: a pattern is a string literal
   * in the same statement, and `{name: {$contains: "o'brien"}}` has to survive
   * as one.
   */
  private toSqlLiteral(v: unknown): string {
    if (v == null) return 'NULL';
    if (typeof v === 'boolean') return v ? '1' : '0';
    if (typeof v === 'number') return Number.isFinite(v) ? String(v) : 'NULL';
    if (typeof v === 'bigint') return String(v);
    const text = v instanceof Date
      ? v.toISOString()
      : typeof v === 'object' ? JSON.stringify(v) : String(v);
    return `'${text.replace(/'/g, "''")}'`;
  }

  private resolveFieldPath(cube: Cube, member: string): string {
    // Handle both "cube.field" and "field" formats
    const parts = member.split('.');
    const fieldName = parts.length > 1 ? parts[1] : parts[0];

    // Check if it's a dimension
    const dimension = cube.dimensions[fieldName];
    if (dimension) {
      // Extract field path from SQL expression
      return dimension.sql.replace(/^\$/, ''); // Remove $ prefix if present
    }

    // Check if it's a measure (for filters)
    const measure = cube.measures[fieldName];
    if (measure) {
      return measure.sql.replace(/^\$/, '');
    }

    return fieldName;
  }

  private resolveMeasure(cube: Cube, measureName: string) {
    const parts = measureName.split('.');
    const fieldName = parts.length > 1 ? parts[1] : parts[0];
    const direct = cube.measures[fieldName];
    if (direct) return direct;

    // Accept `${field}_${type}` aliases (e.g. 'amount_sum') for measures whose
    // canonical name is just `${field}` (e.g. measure 'amount' of type 'sum').
    // This matches the convention used by the data-objectstack adapter and
    // other clients that build measure names from (field, function) pairs.
    const aggTypes = ['count', 'sum', 'avg', 'min', 'max', 'count_distinct'];
    for (const type of aggTypes) {
      const suffix = `_${type}`;
      if (fieldName.endsWith(suffix)) {
        const baseField = fieldName.slice(0, -suffix.length);
        const candidate = cube.measures[baseField];
        if (candidate && candidate.type === type) {
          return candidate;
        }
      }
    }
    return undefined;
  }

  private resolveDimension(cube: Cube, dimensionName: string) {
    const parts = dimensionName.split('.');
    const fieldName = parts.length > 1 ? parts[1] : parts[0];
    return cube.dimensions[fieldName];
  }

  private getShortName(fullName: string): string {
    const parts = fullName.split('.');
    return parts.length > 1 ? parts[1] : parts[0];
  }

  private buildAggregator(measure: { type: string; sql: string; filters?: any[] }): any {
    const fieldPath = measure.sql.replace(/^\$/, '');

    switch (measure.type) {
      case 'count':
        return { $sum: 1 };
      case 'sum':
        return { $sum: `$${fieldPath}` };
      case 'avg':
        return { $avg: `$${fieldPath}` };
      case 'min':
        return { $min: `$${fieldPath}` };
      case 'max':
        return { $max: `$${fieldPath}` };
      case 'count_distinct':
        // Collects the distinct values; {@link sizeDistinctSet} turns the array
        // into the NUMBER, excluding null — see the note there for why the
        // exclusion is on that side rather than in this expression.
        return { $addToSet: `$${fieldPath}` };
      default:
        return { $sum: 1 }; // Default to count
    }
  }

  private measureTypeToFieldType(measureType: string): string {
    switch (measureType) {
      case 'count':
      case 'sum':
      case 'count_distinct':
        return 'number';
      case 'avg':
      case 'min':
      case 'max':
        return 'number';
      case 'string':
        return 'string';
      case 'boolean':
        return 'boolean';
      default:
        return 'number';
    }
  }

  /**
   * [#5374] The mingo predicate builder for one lowered operator.
   *
   * Total by construction: {@link CUBE_OPERATOR_TO_MONGO_PREDICATE} is keyed by
   * {@link CubeOperator}, and `filter.operator` IS a `CubeOperator`, so the
   * lookup cannot miss without a type error somewhere first. The throw is the
   * totality floor that keeps the old `|| '$eq'` from coming back — the two
   * tables drifting must fail loudly, never compile a filter into an equality
   * comparison nobody wrote. It is not a user-input path: everything the author
   * can get wrong was already refused by {@link ANALYTICS_FILTER_CAPABILITIES}.
   */
  private mongoPredicateBuilder(operator: CubeOperator): MongoPredicateBuilder {
    const build = (CUBE_OPERATOR_TO_MONGO_PREDICATE as Record<string, MongoPredicateBuilder | undefined>)[operator];
    if (!build) {
      throw new Error(
        `[driver-memory] analytics face: no mingo predicate for cube operator '${operator}'. ` +
        `MONGO_TO_CUBE_OPERATOR and CUBE_OPERATOR_TO_MONGO_PREDICATE have drifted — ` +
        `add the missing builder rather than letting the operator compile to something else.`,
      );
    }
    return build;
  }

  /**
   * [#7117] The SQL predicate builder for one lowered operator — the twin of
   * {@link MemoryAnalyticsService.mongoPredicateBuilder}, with the same totality
   * floor and for the same reason.
   *
   * It replaced `operatorToSql`, whose `|| '='` fallback was not a default but a
   * wrong ANSWER: three of this face's twelve operators (`in`, `notIn`, `set`)
   * had no row and rendered as an EQUALITY in a statement offered to the author
   * as a description of their query. The throw below cannot be reached from any
   * input — {@link ANALYTICS_FILTER_CAPABILITIES} refuses everything outside the
   * vocabulary, and the `Record<CubeOperator, …>` key type makes a missing row a
   * type error first — so an arrival means our own two tables drifted.
   */
  private sqlPredicateBuilder(operator: CubeOperator): SqlPredicateBuilder {
    const build = (CUBE_OPERATOR_TO_SQL_PREDICATE as Record<string, SqlPredicateBuilder | undefined>)[operator];
    if (!build) {
      throw new Error(
        `[driver-memory] analytics face: no SQL predicate for cube operator '${operator}'. ` +
        `MONGO_TO_CUBE_OPERATOR and CUBE_OPERATOR_TO_SQL_PREDICATE have drifted — ` +
        `add the missing builder rather than letting the operator render as an equality.`,
      );
    }
    return build;
  }

  private measureToSql(measure: { type: string; sql: string }): string {
    const fieldPath = measure.sql.replace(/^\$/, '');
    
    switch (measure.type) {
      case 'count':
        return 'COUNT(*)';
      case 'sum':
        return `SUM(${fieldPath})`;
      case 'avg':
        return `AVG(${fieldPath})`;
      case 'min':
        return `MIN(${fieldPath})`;
      case 'max':
        return `MAX(${fieldPath})`;
      case 'count_distinct':
        return `COUNT(DISTINCT ${fieldPath})`;
      default:
        return 'COUNT(*)';
    }
  }

  private extractTableName(sql: string): string {
    // For simple table names, return as-is
    // For complex SQL, this would need more sophisticated parsing
    return sql.trim();
  }

  private parseDateRangeString(range: string): string[] {
    // Simple parser for common date range strings
    // In production, this would use a proper date range parser
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    
    if (range === 'today') {
      return [today.toISOString(), new Date(today.getTime() + 86400000).toISOString()];
    } else if (range.startsWith('last ')) {
      const parts = range.split(' ');
      const num = parseInt(parts[1]);
      const unit = parts[2];
      const start = new Date(today);
      
      if (unit.startsWith('day')) {
        start.setDate(start.getDate() - num);
      } else if (unit.startsWith('week')) {
        start.setDate(start.getDate() - num * 7);
      } else if (unit.startsWith('month')) {
        start.setMonth(start.getMonth() - num);
      } else if (unit.startsWith('year')) {
        start.setFullYear(start.getFullYear() - num);
      }
      
      return [start.toISOString(), now.toISOString()];
    }
    
    return [range, range]; // Fallback
  }

  private generateSqlFromPipeline(table: string, pipeline: Record<string, any>[]): string {
    // Simplified SQL generation for debugging
    // This is a basic representation of the aggregation pipeline
    //
    // [#7853] The replacer is what keeps a `RegExp` operand from rendering as
    // `{}` — see {@link pipelineDumpReplacer} for why the pattern's own literal
    // syntax and not the mongo-shaped `{$regex, $options}`.
    const stages = pipeline.map((stage, idx) => {
      const op = Object.keys(stage)[0];
      return `/* Stage ${idx + 1}: ${op} */ ${JSON.stringify(stage[op], pipelineDumpReplacer)}`;
    }).join('\n');
    
    return `-- MongoDB Aggregation Pipeline on table: ${table}\n${stages}`;
  }
}
