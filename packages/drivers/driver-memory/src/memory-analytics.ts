// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import type { IAnalyticsService, AnalyticsResult, CubeMeta } from '@objectstack/spec/contracts';
import type { Cube, AnalyticsQuery } from '@objectstack/spec/data';
// [#6520] `$icontains`' ASCII-only fold, from the spec's one definition.
// [#7117] `likePatternToGlobPattern` — the spec's one LIKE→GLOB translation, so
// the SQL exit's wildcard rendering is not a third hand-copy of that escape.
import { asciiCaseInsensitiveRegexSource, likePatternToGlobPattern } from '@objectstack/spec/data';
// [ADR-0053 D-D1, amended 2026-09-30 — #5930 step 3] This face's NEW door, run at
// the entry of {@link MemoryAnalyticsService.normalizeFilters}: the two shared
// comparand faces every other analytics face runs (ruling #7872; #6050 B), then
// the shared `FilterCondition → FilterCondition` lowering.
import {
  assertListComparandShapes,
  lowerFilterCondition,
  normalizeFilterComparandTypes,
} from '@objectstack/spec/data';
// The `FilterArray` spelling of `where`, lowered in front of that door by the
// spec's ONE lowering of it — the pair the analytics `where` door and the engine
// call: `isFilterAST` gates the shape, `parseFilterAST` lowers it. See
// {@link lowerWhereFilterArray}. ⛔ No second FilterArray parser in this face.
import { isFilterAST, parseFilterAST, VALID_AST_OPERATORS } from '@objectstack/spec/data';
import type { InMemoryDriver, MemoryContainsTest } from './memory-driver.js';
import {
  Logger,
  createLogger,
  nextUtcCalendarDay,
  isUnboundedAbove,
  // [#16322] The ONE lowering of the closed `dateRange` preset vocabulary and
  // the ONE refusal for a string outside it, shared with the SQL analytics
  // path so the two backends cannot answer one input differently again.
  resolveAnalyticsDateRangeString,
  // [#17596] The ONE constructor for that envelope, reused for the ARRAY arm's
  // own refusal: the shared conformance kit reads `code` + `status`, so the
  // pair must have a single origin across every face. ⛔ Only the SENTENCE is
  // this condition's own — see {@link explicitDateRangeWindow}.
  analyticsDateRangeUnrecognizedError,
  // [#16178] The ONE forward bucket labeller, and the guard that says which
  // granularities it can label. Hoisted into core precisely so this driver can
  // bucket with the SAME rule the objectql aggregation path uses, without a
  // driver depending on objectql and without a third hand copy of the labels.
  bucketDateKey,
  isBucketGranularity,
  type BucketGranularity,
  // [#20544] The ONE compensated fold for `sum` / `avg`, the one objectql's
  // rows path, this package's data face and SQLite add with — see
  // {@link compensatedAddendAccumulator}.
  compensatedSum,
} from '@objectstack/core';
// [#16178] The pipeline below is split at its `$group` when a time dimension
// buckets, so the bucket key can be folded in JS between the two halves — mingo
// has no expression that produces the canonical labels, and writing one would
// be the second dialect this repair exists to avoid.
import { Aggregator } from 'mingo';
import {
  assertFilterConditionShape,
  uncompilableCombinatorError,
  uncompilableFieldOperatorError,
  unsupportedFilterError,
  unsupportedTimeGranularityError,
  type FilterFaceCapabilities,
  // [#21066] The JSON-stored refusal's log line, written by this face's logger.
  withheldFilterLogLine,
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
  // [ADR-0053 D-D1, amended — #5930 step 3] `$null`, one of the two operators
  // the shared lowering emits that this face did not compile (the other is the
  // `$or` combinator, {@link ANALYTICS_FILTER_CAPABILITIES}): the NULL escape
  // it puts around a negative-polarity leaf, and the "has a value" it leaves of
  // a bound on the last supported day. Design §3.4's output vocabulary, and
  // nothing wider — `$not`, `$between` (lowered away before this table is
  // asked), `$startsWith`, `$endsWith` and `$empty` stay outside it.
  $null: 'isNull',
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
 * `$and` folds its branches into the same implicit-AND list the top level
 * already is ({@link MemoryAnalyticsService.flattenFilterCondition}). `$not` has
 * no expression in this face's `{member, operator, values}` pipeline, which is
 * why refusing it is the answer here rather than a lowering nobody can write.
 *
 * [ADR-0053 D-D1, amended — #5930 step 3] `$or` joins: the shared lowering emits
 * it (the NULL escape around a negative-polarity leaf), so this face has to
 * compile it, and it does — as a {@link NormalizedCubeDisjunction} each exit
 * renders natively (mingo's `$or`, SQL's `OR`), with the boolean identities
 * every other face gives it (`$or: []` is FALSE, a `{}` branch is TRUE).
 */
export const ANALYTICS_FILTER_CAPABILITIES: FilterFaceCapabilities = Object.freeze({
  face: "driver-memory's analytics (cube) face",
  fieldOperators: new Set<string>(Object.keys(MONGO_TO_CUBE_OPERATOR)),
  combinators: new Set<string>(['$and', '$or']),
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
  readonly anyOf?: never;
  member: string;
  operator: CubeOperator;
  /**
   * The comparands, as authored. Temporal values are put into the field's
   * storage form at the exits ({@link MemoryAnalyticsService.storageFormFor}),
   * never here — that rule needs the resolved field path, which only an exit has.
   */
  values: unknown[];
}

/**
 * [ADR-0053 D-D1, amended — #5930 step 3] A disjunction of conjunctions: the
 * `$or` this face now compiles. Each branch is an entry list read exactly as
 * the top level is — implicitly ANDed, contested members kept apart — so a
 * branch is whatever a `$or` element flattens to, nested `$or`s included.
 *
 * The boolean identities are the ones every other face gives (#5322): a branch
 * with NO entries (a `{}` element) is TRUE and makes the whole disjunction TRUE;
 * a disjunction with NO branches (`$or: []`) is FALSE. Both exits render those
 * two cases as constants rather than leaving them to a backend's reading of an
 * empty operand.
 */
interface NormalizedCubeDisjunction {
  readonly anyOf: ReadonlyArray<ReadonlyArray<NormalizedCubeEntry>>;
}

/** One entry of the implicitly-ANDed list `normalizeFilters` returns. */
type NormalizedCubeEntry = NormalizedCubeFilter | NormalizedCubeDisjunction;

function isDisjunction(entry: NormalizedCubeEntry): entry is NormalizedCubeDisjunction {
  return entry.anyOf !== undefined;
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
   * The test `$contains` asks of this member's column, built by the DRIVER's
   * own rule (`filterContainsTest`) rather than re-derived here — `$notContains`
   * wraps it in `$not`, as the live query path does.
   *
   * [#7723] Case-EXACT, because that rule is: `filterSubstringPattern` carried
   * an `i` flag until #7723 took it off, putting the `$contains` family on the
   * #4706 Q2 = A answer across every face of this package. Borrowing the rule
   * rather than restating it is what made that one edit reach this face too.
   *
   * [#20874] Borrowed WHOLE now, not as a pattern. On a declared JSON-stored
   * field the rule asks MEMBERSHIP (an `$elemMatch`), not substring, and this
   * face used to wrap `filterSubstringPattern` in a `$regex` of its own — so
   * `u1` matched a stored `['u10']` here exactly as it did on `find()`. Taking
   * the predicate rather than a piece of it is what makes the membership reading
   * reach this face with the same edit, the lesson #7723 records above.
   */
  readonly containment: (value: unknown) => MemoryContainsTest;
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
  // [ADR-0053 D-D1, amended — #5930 step 4] The comparison as handed, like its
  // three neighbours. The whole-day upper bound (#4042), its last supported day
  // (#20600) and D-E3's order — widen the AUTHORED day, then convert the bound
  // (#20661) — are the shared lowering's, run once at this face's door
  // ({@link MemoryAnalyticsService.normalizeFilters}): a bare-day `$lte` reaches
  // this table as `lt` a calendar string (converted like any comparand) or as
  // `isNull: false`, never as `lte`.
  lte: ({ comparands }) => ({ $lte: comparands[0] }),
  // The list operators take the WHOLE list. An empty one is a real predicate —
  // `$in: []` selects nothing, `$nin: []` selects everything — and saying so
  // here is what retires the call site's `values.length > 0` guard, under which
  // `{code: {$in: []}}` emitted no predicate at all and answered with the whole
  // table while `find()` answered with none of it.
  in: ({ comparands }) => ({ $in: [...comparands] }),
  notIn: ({ comparands }) => ({ $nin: [...comparands] }),
  // A pattern, not a comparand: `raw`, and the driver's own rule — membership on
  // a declared JSON-stored field, the substring everywhere else (#20874).
  contains: ({ raw, containment }) => containment(raw[0]),
  // [#6520] The case-INSENSITIVE twin, folding ASCII and nothing else. It takes
  // `asciiSubstring`, not `substring`: the neighbour above folds Unicode, so
  // reusing it here would answer `CAFÉ` for `café` on this face while the SQL
  // family answered no rows — the divergence #6520 closed.
  icontains: ({ raw, asciiSubstring }) => ({ $regex: asciiSubstring(raw[0]) }),
  // The fix this issue is about. `{$not: <scalar>}` constrains nothing; the
  // negation has to wrap a pattern, which is exactly what the live query path
  // builds for `$notContains` (`memory-driver.ts` `normalizeFieldOperators`) —
  // and, since #20874, the SAME test it builds, membership or substring.
  notContains: ({ raw, containment }) => ({ $not: containment(raw[0]) }),
  // [#13195] A presence flag, not a comparand — and "present" means HAS A
  // VALUE (`!= null`), never key presence: #5298 leg 3 / #5369, landed in PR
  // #5962, ruled onto this face 2026-08-30. It used to emit `{$exists: <bool>}`
  // and hand it to mingo, which reads key presence, so this exit EXECUTED the
  // key-presence answer while {@link CUBE_OPERATOR_TO_SQL_PREDICATE} ECHOED
  // `IS NOT NULL` beside it — the rows a chart was drawn from and the statement
  // shown next to it answered the same query differently. The two now agree,
  // and the residue that disagreement left in
  // `memory-analytics-echo-operator-coverage.test.ts` is gone rather than
  // documented. The `raw.length === 0` arm keeps the old call site's reading of
  // a valueless `set` ("does it exist" → true).
  set: ({ raw }) => ((raw.length === 0 || Boolean(raw[0])) ? { $ne: null } : { $eq: null }),
  // [ADR-0053 D-D1, amended — #5930 step 3] `$null`, the mirror of `set`: a
  // presence flag, not a comparand, and "no value" is null or an absent key —
  // mingo's `$eq: null` reads both, as MongoDB does. The flag is a boolean by
  // the time it gets here (`assertFilterConditionShape` refuses anything else,
  // #5347), so the `=== true` below is the whole choice.
  isNull: ({ raw }) => (raw[0] === true ? { $eq: null } : { $ne: null }),
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
  /**
   * [#20874] The stored members a `$contains` comparand names on this column,
   * or `null` when the column asks the SUBSTRING question — read off the
   * DRIVER's test (`filterContainsTest`), the one its `$match` twin executes.
   * See {@link sqliteMembershipPredicate}.
   */
  readonly members: (value: unknown) => readonly unknown[] | null;
}

/**
 * [#20874] The SQLite rendering of a `$contains` MEMBERSHIP test — `driver-sql`'s
 * own SQLite construct (`jsonMembershipPredicate`), with literals where that
 * one binds.
 *
 * The echo's job is reproducing execution ({@link globSubstringPattern}). Once
 * the `$match` twin asks membership on a declared JSON-stored column, a
 * `GLOB '*u1*'` echo over the stored text `["u10"]` would return the row the
 * chart excludes — so this renders the question that ran:
 *
 * - `json_each` over the column, guarded by `json_valid` so a cell holding
 *   bare text has no members instead of raising — the guard `driver-sql` keeps
 *   for the same reason;
 * - `typeof(os_member.key) = 'integer'` keeps it array-only: an array element
 *   has an INTEGER key, an object member a TEXT key and a scalar root a NULL
 *   one — the same "a scalar or object has no member" the `$elemMatch` twin
 *   answers;
 * - each element's JSON TEXT compared with each member's, the `CASE` spelling
 *   the three JSON literals by type name because SQLite surfaces `true` as the
 *   INTEGER 1 and `json_quote` would render it `1`.
 *
 * The members' JSON texts are exactly the texts `driver-sql` binds, because
 * both sides read the comparand the same way (`containsMemberCandidates` in
 * `memory-driver.ts`, `jsonMembershipCandidates` in `driver-sql`).
 */
function sqliteMembershipPredicate(
  column: string,
  members: readonly unknown[],
  literal: (value: unknown) => string,
): string {
  const texts = members.map((member) => literal(JSON.stringify(member))).join(', ');
  return (
    `EXISTS (SELECT 1 FROM json_each(CASE WHEN json_valid(${column}) THEN ${column} ELSE '[]' END) AS os_member ` +
    `WHERE typeof(os_member.key) = 'integer' AND CASE os_member.type ` +
    `WHEN 'true' THEN 'true' WHEN 'false' THEN 'false' WHEN 'null' THEN 'null' ` +
    `ELSE json_quote(os_member.value) END IN (${texts}))`
  );
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
 * # The `set` cell — once the one place SQL could not say what mingo said
 *
 * `set` renders `IS NOT NULL` / `IS NULL` — the spelling this repo's other two
 * SQL lowerings already use (`read-scope-sql.ts`'s `$exists` arm, `driver-sql`'s
 * "a present field is a non-null column in SQL"). This row is UNCHANGED, and it
 * is worth saying why it is now an exact translation rather than a documented
 * residue.
 *
 * It used to be inexact in one direction only: the mingo twin emitted
 * `{$exists: <bool>}`, mingo reads that as KEY PRESENCE, and a relational
 * column always has a key — so a row storing an explicit `null` satisfied
 * `$exists: true` on `query()` and failed `IS NOT NULL` in the echo. The chart
 * and the statement drawn beside it answered the same query differently, and
 * the gap was pinned as an explicit INEQUALITY in
 * `memory-analytics-echo-operator-coverage.test.ts` so it could not be closed
 * in silence.
 *
 * [#13195] It was not closed in silence: the maintainer ruled on 2026-08-30
 * that `$exists` means HAS A VALUE (`!= null`) on every exit — #5298 leg 3 /
 * #5369, shipped in PR #5962 and until then still unmet here — so the mingo
 * twin now emits `{$ne: null}` / `{$eq: null}`. SQL's `IS NOT NULL` was already
 * the ruled answer; it is the OTHER exit that moved to meet it. The inequality
 * pin is now an equality, and this face no longer contradicts itself.
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
  // [ADR-0053 D-D1, amended — #5930 step 4] The comparison as handed, exactly
  // as the mingo row above: the echo renders the lowered filter the rows were
  // drawn from, so a bare-day `$lte` echoes as the `lt` / `isNull` row it was
  // lowered to — `< '2026-07-29T00:00:00.000Z'` on a declared `datetime` field
  // (#20661), `IS NOT NULL` on the last supported day (#20600).
  lte: ({ column, comparands, literal }) => `${column} <= ${literal(comparands[0])}`,
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
  // A pattern, not a comparand: `raw`, and the shared GLOB substring rule — or,
  // on a declared JSON-stored column, the membership the `$match` twin runs
  // (#20874, {@link sqliteMembershipPredicate}). The negation stays null-safe
  // either way: `NOT EXISTS` is never UNKNOWN, but the NULL row still has to be
  // admitted by name, since `json_each(NULL)` is not a row set to negate.
  contains: ({ column, raw, globSubstring, members, literal }) => {
    const set = members(raw[0]);
    return set ? sqliteMembershipPredicate(column, set, literal) : `${column} GLOB ${globSubstring(raw[0])}`;
  },
  notContains: ({ column, raw, globSubstring, members, literal }) => {
    const set = members(raw[0]);
    const test = set ? `NOT ${sqliteMembershipPredicate(column, set, literal)}` : `${column} NOT GLOB ${globSubstring(raw[0])}`;
    return `(${column} IS NULL OR ${test})`;
  },
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
  // [ADR-0053 D-D1, amended — #5930 step 3] `$null`, the mirror of `set` — the
  // mingo row's `$eq: null` / `$ne: null`, spelled the way `read-scope-sql.ts`
  // and `driver-sql` spell a null predicate.
  isNull: ({ column, raw }) => `${column} IS ${raw[0] === true ? 'NULL' : 'NOT NULL'}`,
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
 * [#11065] `path`, with a BOOLEAN rendered as the number it is worth — the
 * aggregand expression `$sum` and `$avg` consume on this face, and, since the
 * #11152 ruling (maintainer 2026-08-28: booleans aggregate as numbers on every
 * face, no per-aggregate exception), `$min` and `$max` as well.
 *
 * ## What it is for
 *
 * mingo's `$avg` mirrors MongoDB's and IGNORES a non-numeric value, so a
 * whole boolean column averaged to `null` and summed to `0` (measured: five
 * bools in, `{avg: null, sum: 0}` out). Under SQL the same rows answer
 * `AVG(col)` = 0.4 and `SUM(col)` = 2, and objectql's in-memory fallback
 * (`in-memory-aggregation.ts`) answers those numbers too, because its
 * `toNumber` is `Number(v)` and `Number(true) === 1`. A rate measure over a
 * flag column — an SLA-violation rate, a win rate — is the ordinary shape of
 * that query, and the two answers are not two spellings of one: a tile bound
 * to the measure renders a percentage on one driver and a blank on the other,
 * with no error on either path.
 *
 * ## Why an EXPRESSION and not post-processing
 *
 * The `count_distinct` neighbour above collects with `$addToSet` and sizes the
 * array after `driver.aggregate` returns ({@link sizeDistinctSet}). Sum and
 * average must NOT be built that way: the post-processing step runs after the
 * pipeline's own `$sort` and `$limit` stages, so a measure left as an array
 * until then would be SORTED as an array — `order` over a `sum` or `avg`
 * measure is an ordinary analytics query, unlike ordering by `count_distinct`.
 * Keeping the rule inside the `$group` expression leaves every later stage
 * looking at the number it expects.
 *
 * ## The narrowness is deliberate
 *
 * Only `bool` is rewritten. Everything else — null, missing, a non-numeric
 * string — reaches mingo exactly as before and is ignored by the accumulator
 * exactly as before (measured: a numeric column carrying a null, a string and
 * a missing key answers identically with and without this wrapper). Coercing
 * wider would mean adopting `toNumber`'s other half, which maps a non-numeric
 * string to `0` and so averages garbage as zero rather than excluding it —
 * a separate question from this one.
 *
 * The data face carries the same rule in JavaScript (`memory-driver.ts`,
 * `computeAggregate`); `memory-boolean-aggregand.test.ts` drives both, because
 * one face aligned alone is how this package's faces come to disagree.
 */
function numericAggregandExpr(path: string): Record<string, unknown> {
  return { $cond: [{ $eq: [{ $type: path }, 'bool'] }, { $cond: [path, 1, 0] }, path] };
}

/**
 * [#20544] A `sum` or `avg` measure as ONE `$group` accumulator that adds with
 * `@objectstack/core`'s {@link compensatedSum} — the fold objectql's rows path,
 * this package's data face (`memory-driver.ts`, `computeAggregate`) and SQLite
 * add with.
 *
 * ## What it replaced
 *
 * mingo's `$sum` and `$avg` add in a plain loop, so this face answered
 * `0.6000000000000001` / `0.20000000000000004` over `0.1`, `0.2` and `0.3`
 * where the rows path and SQLite answer `0.6` / `0.19999999999999998`, and
 * `1e16, 1, -1e16` summed to `0` rather than `1`.
 *
 * ## Why an `$accumulator`, measured against the other two routes (mingo 7.2.4)
 *
 * - **A post-group recompute** is ruled out by the reason in
 *   {@link numericAggregandExpr}'s header: it runs after the pipeline's own
 *   `$sort` and `$limit`, so `order` over a `sum` measure would rank the value
 *   the measure does not answer.
 * - **A custom accumulator operator** cannot replace `$sum` / `$avg` through
 *   the `mingo` entry point this package imports: its `Aggregator` merges the
 *   default operators first (`Context.from`), and `addOps` keeps an operator
 *   already present, so a caller's context can only ADD a name. A new name
 *   would have to be registered where each `Aggregator` is built — the
 *   driver's public `aggregate()` and {@link MemoryAnalyticsService}'s own
 *   time-bucket half — widening the pipeline dialect the driver accepts.
 * - **`$accumulator`** is in mingo's default operator set and needs
 *   `scriptEnabled`, which `ComputeOptions.init` defaults to `true`; both
 *   `Aggregator`s this face runs take the default options. It stays inside the
 *   `$group` stage, so every later stage sees the finished number.
 *
 * ## What does not move
 *
 * Only the addition. The aggregand is {@link numericAggregandExpr}, as before,
 * and the addends are the values mingo's own `$sum` / `$avg` add: numbers,
 * NaN excluded (mingo's `isNumber`), so null, a missing key and a non-numeric
 * string stay ignored. `avg` over no addend is `null`, `sum` over none is `0`,
 * exactly as mingo answered. The values are added in the group's row order,
 * the order mingo's `$push` collects them in, so the naive running sum inside
 * {@link compensatedSum} is the one `$sum` computed.
 *
 * The functions are named, and {@link pipelineDumpReplacer} renders a function
 * by its name, so the pipeline dump still says which fold a measure runs.
 */
function compensatedAddendAccumulator(path: string, fn: 'sum' | 'avg'): Record<string, unknown> {
  return {
    $accumulator: {
      init: startAddends,
      accumulateArgs: [numericAggregandExpr(path)],
      accumulate: collectAddend,
      finalize: fn === 'sum' ? compensatedSumOfAddends : compensatedMeanOfAddends,
      lang: 'js',
    },
  };
}

function startAddends(): number[] {
  return [];
}

/** mingo's `isNumber`: the values its `$sum` and `$avg` add. */
function collectAddend(addends: number[], value: unknown): number[] {
  if (typeof value === 'number' && !Number.isNaN(value)) addends.push(value);
  return addends;
}

function compensatedSumOfAddends(addends: readonly number[]): number {
  return compensatedSum(addends);
}

function compensatedMeanOfAddends(addends: readonly number[]): number | null {
  return addends.length === 0 ? null : compensatedSum(addends) / addends.length;
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
 * {@link MemoryAnalyticsService.storageFormFor} before it reaches here, and
 * `toJSON` runs BEFORE a replacer in any case, so dates are unchanged. A
 * `BigInt` comparand does throw — but out of mingo's own `Query.compile` during
 * EXECUTION, before this dump is ever built, so no replacer here reaches it.
 */
function pipelineDumpReplacer(_key: string, value: unknown): unknown {
  if (value instanceof RegExp) return `/${value.source}/${value.flags}`;
  // [#20544] A function is the other value `JSON.stringify` erases, and the
  // `sum` / `avg` `$accumulator` carries three ({@link
  // compensatedAddendAccumulator}). Dropped, the two measures dump identically;
  // by name, the dump still says which fold each one runs.
  if (typeof value === 'function') return `[function ${value.name}]`;
  return value;
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
 * [#16178] A `timeDimensions[]` entry that asks its dimension to be BUCKETED,
 * resolved to everything the fold needs.
 *
 * `granularity` is already narrowed to the five the canonical vocabulary can
 * label — the three sub-day names `TimeUpdateInterval` also declares are refused
 * at compile, before this is built.
 */
interface TimeBucket {
  /** The member as the CALLER spelled it, which is how a projected bucket is named back. */
  readonly dimension: string;
  /** The row field the instant is read from. */
  readonly fieldPath: string;
  /** The bucket size, narrowed to what `bucketDateKey` can label. */
  readonly granularity: BucketGranularity;
  /** The synthetic field the bucket key is written to. */
  readonly bucketKey: string;
}

/**
 * The synthetic field a dimension's bucket key travels under.
 *
 * Synthetic rather than an overwrite of the source field, because one member can
 * be both a group key and a measure's aggregand: folding `created_at` in place
 * would leave `max(created_at)` ranking `'2026-W23'` strings. The `$` prefix a
 * mingo expression adds is applied by the caller, so the name itself carries
 * none; the double underscore keeps it clear of any real column.
 */
function bucketFieldFor(dimName: string): string {
  return `__bucket__${dimName}`;
}

/**
 * Read a row value at a resolved field path, dotted paths included — the same
 * traversal mingo performs for the `$<path>` the `$group` stage would have used,
 * so a nested dimension buckets from the value it would have grouped on.
 */
function readFieldPath(row: Record<string, any>, fieldPath: string): unknown {
  if (!fieldPath.includes('.')) return row[fieldPath];
  let cursor: any = row;
  for (const segment of fieldPath.split('.')) {
    if (cursor == null || typeof cursor !== 'object') return undefined;
    cursor = cursor[segment];
  }
  return cursor;
}

/**
 * [#16179] A `timeDimensions[].dateRange` resolved to its two bounds, together
 * with what the UPPER one means.
 *
 * `AnalyticsDateRange` is a union of two arms (`AnalyticsDateRangeSchema`) and
 * they do NOT agree on that question, which is the whole reason this carries a
 * flag instead of a bare pair:
 *
 * - an explicit `[a, b]` is the CALLER's window, and `b` is a bound they wrote
 *   meaning "include b" — the reading `$lte` has published since this face
 *   existed. ⛔ Never narrow it here; doing so is a silent behaviour change on
 *   a published package, and it is the route this card deliberately did not
 *   take;
 * - a preset name is resolved BY this driver, and `'today'`'s upper bound is
 *   the first instant of TOMORROW — the day's exclusive end, not a moment the
 *   day contains. Compared with `$lte` it made `'today'` one day plus one
 *   instant long, so two adjacent day windows overlapped at midnight and a row
 *   stamped there was counted in BOTH.
 *
 * The distinction is available where it is made — one line above the bound
 * construction, at the `Array.isArray` that discriminates the union's arms —
 * so the two paths never had to share an answer.
 */
interface ResolvedDateRange {
  /**
   * `[start, end]`, in the spelling the bounds are compared as.
   *
   * [#17596] A TUPLE, not a `readonly string[]`: both arms now produce exactly
   * two bounds or throw, so the bound construction below needs no
   * `if (range.length === 2)` — and that guard is precisely what used to drop
   * an odd-sized array's window silently, selecting all of history.
   */
  readonly bounds: readonly [string, string];
  /**
   * Is `end` the first instant AFTER the window rather than its last instant?
   * `true` only for a window this driver RESOLVED; ⛔ never for one a caller
   * wrote out.
   */
  readonly endExclusive: boolean;
}

/**
 * [#17596] The CALLER's explicit window as its two bounds — or the ADR-0112
 * refusal.
 *
 * ## What this replaces
 *
 * The array arm used to hand `timeDim.dateRange` to the bound construction
 * unexamined, behind an `if (range.length === 2)`. MEASURED on `49cd71548`,
 * four rows spanning 2020…2099 and one authored document:
 *
 * | `dateRange` | rows selected | pipeline |
 * |---|---|---|
 * | `['2026-01-01', '2026-01-01']` (the window) | the one day | `$match` + `$group` |
 * | `['2026-01-01']` | ALL FOUR | ⛔ byte-identical to no `dateRange` at all |
 * | `[]` | ALL FOUR | ⛔ same |
 * | `['2026-01-01', '2026-01-31', '2026-02-01']` | ALL FOUR | ⛔ same |
 * | `[null, null]` | none | `$gte: 'null'`, which no instant sorts inside |
 *
 * ⇒ the "plot all of history" shape #3650 was filed about and #16322 repaired
 * for the STRING arm, resurrected on the array arm of the same face — and
 * invisible, because a dashboard that silently widens its window still renders
 * a number.
 *
 * ## Why a refusal, and why THIS refusal
 *
 * ⛔ Not an alignment: all three readings the platform's five faces gave an
 * odd-sized array are ungoverned, so teaching this face one of them is
 * inventing a fourth. What IS governed is the contract the spec's own refusal
 * wording states — *an explicit window is the two-element array [start, end]*
 * — and PR #17593 already landed exactly this refusal on the
 * `service-analytics` faces. ⭐ The shared kit's ARITY case
 * (`ANALYTICS_DATE_RANGE_NOT_A_WINDOW`) is what now holds both to it, which is
 * why this is the same envelope and not a driver dialect.
 *
 * ⛔ Bound VALUES are not judged here: a bare `YYYY-MM-DD` versus a full
 * timestamp is this face's own calendar translation (#4042) and happens below.
 *
 * @param dateRange - the array arm as it reached the face, unparsed.
 * @returns the two bounds, in the order the author wrote them.
 * @throws the ADR-0112 `ANALYTICS_DATE_RANGE_UNRECOGNIZED` / 400 envelope when
 *   the array is not exactly two non-empty string bounds.
 */
function explicitDateRangeWindow(dateRange: readonly unknown[]): [string, string] {
  const refuse = (received: string): Error => {
    const err = analyticsDateRangeUnrecognizedError(dateRange);
    err.message =
      `[driver-memory] dateRange ${JSON.stringify(dateRange)} ${received}. An explicit window `
      + 'is the TWO-element array [start, end] of ISO dates or {date-macro} tokens — e.g. '
      + '["2026-01-01", "2026-01-31"]; for a single day write both bounds, '
      + '["2026-01-01", "2026-01-01"]. Refused (ANALYTICS_DATE_RANGE_UNRECOGNIZED / 400) '
      + 'rather than guessed: this face used to build no window at all for such an array, '
      + 'so the query read ALL of history — the same document another backend read as a '
      + 'single day.';
    return err;
  };
  if (dateRange.length !== 2) {
    throw refuse(`is a ${dateRange.length}-element array, not a window`);
  }
  const [start, end] = dateRange;
  for (const bound of [start, end]) {
    if (typeof bound !== 'string' || bound.length === 0) {
      throw refuse(
        `has a bound that is not a date string (${bound === null ? 'null' : typeof bound})`,
      );
    }
  }
  return [start as string, end as string];
}

/**
 * Lower the `FilterArray` spelling of a cube `where` to the `FilterCondition`
 * it spells, at the entry of {@link MemoryAnalyticsService.normalizeFilters} —
 * so both spellings of one filter meet the same comparand doors, the same
 * shared lowering and the same vocabulary gate after it.
 *
 * `AnalyticsQuery.where` is declared a `FilterCondition`; `FilterArray` is
 * input-only authoring sugar (`spec/data/filter.zod.ts`). This face used to
 * read only a non-array object `where`, so an array skipped every door and the
 * flatten, and its predicate vanished: `[['d', '=', 'v1']]` aggregated EVERY
 * row and the `generateSql()` echo carried no `WHERE`, while `{d: 'v1'}`
 * answered its row. Fewer predicates means more rows — the widening class the
 * vocabulary gate below already refuses for the object spelling.
 *
 * The analytics `where` door lowers the array spelling, and this face is an
 * analytics face, so it LOWERS rather than refuses — through the same spec pair
 * that door and the engine call, never a parser of its own. The three arrival
 * answers are theirs:
 *
 * 1. `[]` is "no filter", not a failed filter — `parseFilterAST([])` is
 *    `undefined`, and every door reads it that way.
 * 2. An array `isFilterAST` accepts is lowered by `parseFilterAST`, which runs
 *    the shared comparand-shape and comparand-type faces on what it returns;
 *    `normalizeFilters` then runs its door on that condition as on any object.
 * 3. Any other array is REFUSED `INVALID_FILTER` / 400 — `isFilterAST` gates
 *    first so `parseFilterAST`'s lenient `$${op}` fallback cannot turn a
 *    misspelled operator into a condition nothing compiles, and so a shape it
 *    has no lowering for (the infix join, a list of scalars, a cube-style
 *    `{member, operator, values}` list) is never read as no filter at all.
 *
 * Anything that is not an array is returned as it came.
 */
function lowerWhereFilterArray(where: unknown): unknown {
  if (!Array.isArray(where)) return where;
  // (1) `[]` is "no filter".
  if (where.length === 0) return undefined;
  // (3) Not a shape `parseFilterAST` can express.
  if (!isFilterAST(where)) throw filterArrayNotLowerableError(where);
  // (2) The declared path.
  const condition = parseFilterAST(where);
  if (!condition || typeof condition !== 'object' || Array.isArray(condition)) {
    // Unreachable by construction — `isFilterAST` accepted the shape, so
    // `parseFilterAST` has a lowering for it. Loud rather than silent: the
    // failure mode of the two spec functions disagreeing is a dropped
    // predicate, i.e. every row.
    throw unsupportedFilterError(
      `The analytics (cube) face received the filter array ${previewFilterArray(where)}, which ` +
        `isFilterAST() accepted and parseFilterAST() lowered to ${previewFilterArray(condition)}. ` +
        `It is refused rather than aggregating the UNFILTERED rows.`,
    );
  }
  return condition;
}

/** A `where` array this face cannot lower — the analytics `where` door's refusal, in this face's words. */
function filterArrayNotLowerableError(where: readonly unknown[]): Error {
  return unsupportedFilterError(
    `The analytics (cube) face received a 'where' array that is not a filter: ` +
      `${previewFilterArray(where)}. A filter array is a comparison [field, operator, value], a ` +
      `logical node ["and"|"or", ...conditions], or a list of those — it is INPUT-ONLY sugar (spec ` +
      `'FilterArray'), lowered to a FilterCondition by @objectstack/spec parseFilterAST() at every ` +
      `door, this one included. This value cannot be lowered, and an unapplied filter would have ` +
      `aggregated the UNFILTERED rows. Recognised operators: ` +
      `${[...VALID_AST_OPERATORS].sort().join(', ')}. Infix joins ([condA, "or", condB]) are NOT ` +
      `one of the shapes — write the prefix form ["or", condA, condB].`,
  );
}

/** The refused value for a message — never a second throw (a `bigint` has no JSON). */
function previewFilterArray(value: unknown): string {
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return Array.isArray(value) ? 'an array' : typeof value;
  }
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
    const normalizedFilters = this.normalizeFilters(query, cube);
    if (normalizedFilters.length > 0) {
      const matchStage = this.mongoConjunction(cube, normalizedFilters);
      if (Object.keys(matchStage).length > 0) {
        pipeline.push({ $match: matchStage });
      }
    }

    // Stage 2: Time dimension filters
    //
    // [#16178] and their GRANULARITY, which this face used to accept and never
    // read. The two keys are orthogonal and both live on the same entry:
    // `dateRange` decides WHICH rows are selected (#16042/#16179), `granularity`
    // decides how the selected rows are FOLDED. Collected here, applied between
    // the `$match` half of the pipeline and its `$group` (see
    // {@link aggregateWithTimeBuckets}).
    const timeBuckets: TimeBucket[] = [];
    if (query.timeDimensions && query.timeDimensions.length > 0) {
      for (const timeDim of query.timeDimensions) {
        const fieldPath = this.resolveFieldPath(cube, timeDim.dimension);
        if (timeDim.granularity !== undefined) {
          // Refused, not dropped: `TimeUpdateInterval` declares three sub-day
          // names the canonical bucket-key vocabulary has no label for, and
          // passing one through is this card's own defect under a new name.
          if (!isBucketGranularity(timeDim.granularity)) {
            throw unsupportedTimeGranularityError(timeDim.dimension, timeDim.granularity);
          }
          // The bucket travels under its own synthetic key rather than
          // overwriting the row's field: the SAME member can be both a group key
          // and a measure's aggregand (`max(created_at)`), and folding the field
          // in place would silently rank bucket LABELS instead of instants.
          timeBuckets.push({
            dimension: timeDim.dimension,
            fieldPath,
            granularity: timeDim.granularity,
            bucketKey: bucketFieldFor(this.getShortName(timeDim.dimension)),
          });
        }
        if (timeDim.dateRange) {
          // [#16179] The union's two arms are discriminated HERE, and the
          // answer travels the two lines down to the bound construction rather
          // than being re-derived from the bounds themselves — which is not
          // possible, because a resolved window and a caller's window are
          // rendered identically (`toISOString()` on both sides).
          // [#17596] The array arm is judged HERE, at the discriminator, and
          // either yields two bounds or throws: a caller's window is the
          // TWO-element [start, end], and any other shape used to fall past
          // the `if (range.length === 2)` that stood under this line and reach
          // the aggregation with NO time predicate emitted at all.
          const resolved: ResolvedDateRange = Array.isArray(timeDim.dateRange)
            ? { bounds: explicitDateRangeWindow(timeDim.dateRange), endExclusive: false }
            : this.parseDateRangeString(timeDim.dateRange, query.timezone);
          const range = resolved.bounds;

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
          // [#16179] The upper bound is EXCLUSIVE by exactly two routes, and
          // they are mutually exclusive by construction:
          //
          //   - the RESOLVER produced the window, so `end` is already the
          //     instant the window stops before -- `'today'`'s end is the
          //     first instant of tomorrow. ⛔ It must NOT be widened again:
          //     it is an instant, so `nextUtcCalendarDay` refuses it anyway
          //     (`calendar-day.ts`, pinned by `calendar-day.test.ts`), and
          //     asking is what would make a future bare-day resolver widen a
          //     bound that was already exclusive.
          //   - the CALLER wrote a bare `YYYY-MM-DD`, which denotes the WHOLE
          //     day and widens to `< nextDay` (#4042; the SQL twin is #3777).
          //
          // Anything else -- a full timestamp the CALLER wrote -- keeps
          // instant semantics and stays INCLUSIVE, byte for byte as before.
          //
          // [#20600] A caller's bare end on the last supported day has no next
          // day to stop before: every value is inside it, so the window keeps
          // its start alone, in both spellings.
          const widened = resolved.endExclusive ? null : nextUtcCalendarDay(end);
          const unbounded = isUnboundedAbove(widened);
          const widenedDay = isUnboundedAbove(widened) ? null : widened;
          const upperString = resolved.endExclusive ? end : widenedDay;
          const upperDate = widenedDay != null
            ? new Date(`${widenedDay}T00:00:00.000Z`)
            : (resolved.endExclusive ? new Date(end) : null);
          const stringBounds = unbounded
            ? { $gte: start }
            : upperString != null
              ? { $gte: start, $lt: upperString }
              : { $gte: start, $lte: end };
          const dateBounds = unbounded
            ? { $gte: new Date(start) }
            : upperDate != null
              ? { $gte: new Date(start), $lt: upperDate }
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

    // Stage 3: $group for measures and dimensions
    const groupStage: Record<string, any> = { _id: {} };
    
    // Add dimensions to _id
    const keyedBucketPaths = new Set<string>();
    if (query.dimensions && query.dimensions.length > 0) {
      for (const dim of query.dimensions) {
        const fieldPath = this.resolveFieldPath(cube, dim);
        const dimName = this.getShortName(dim);
        // [#16178] A dimension that a time dimension buckets keys on the FOLDED
        // value. Matched on the resolved field path, so `createdAt` in
        // `dimensions` and `events.createdAt` in `timeDimensions` are one member.
        const bucketed = timeBuckets.find(b => b.fieldPath === fieldPath);
        if (bucketed) keyedBucketPaths.add(bucketed.fieldPath);
        groupStage._id[dimName] = bucketed ? `$${bucketed.bucketKey}` : `$${fieldPath}`;
      }
    }

    // [#16178] A GRANULAR time dimension is a group column in its own right,
    // whether or not `dimensions` also lists it. Keying `$group` on
    // `query.dimensions` alone answered ONE TOTAL (`_id: null`) for the
    // canonical trend shape — `{measures, timeDimensions:[{dimension,
    // granularity}]}` with no `dimensions` — so the granularity was accepted,
    // silent and inert: this card's own defect class under a different name.
    //
    // The rule and its exception are the SQL/ObjectQL face's, recorded there:
    // every granular entry not already listed groups and projects
    // (`objectql-strategy.ts` :163-167), and one set — `projectedDimensions`
    // (:1889-1893) — feeds grouping, row mapping and field metadata alike,
    // because rows carrying a bucket under a `fields` list that never mentions
    // it is a trend chart with no x-axis (#4033). An entry carrying only a
    // `dateRange` is a PREDICATE and is NOT projected (#5688) — which needs no
    // test here, since `timeBuckets` only ever admits an entry that declared a
    // granularity.
    //
    // Deduped on the resolved field path, the same way the loop above folds a
    // bucketed member, so two spellings of one member cannot become two columns.
    const projectedBuckets: TimeBucket[] = [];
    for (const bucket of timeBuckets) {
      if (keyedBucketPaths.has(bucket.fieldPath)) continue;
      keyedBucketPaths.add(bucket.fieldPath);
      projectedBuckets.push(bucket);
      groupStage._id[this.getShortName(bucket.dimension)] = `$${bucket.bucketKey}`;
    }

    if (Object.keys(groupStage._id).length === 0) {
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
    for (const bucket of projectedBuckets) {
      const dimName = this.getShortName(bucket.dimension);
      projectStage[dimName] = `$_id.${dimName}`;
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
    // [#16178] Unbucketed queries keep the single-call path they always had,
    // byte for byte; only a query that actually asks for a granularity pays the
    // split.
    const rawRows = timeBuckets.length === 0
      ? await this.driver.aggregate(tableName, pipeline)
      : await this.aggregateWithTimeBuckets(tableName, pipeline, timeBuckets, query.timezone);

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
      // [#16178] and a granular time dimension `dimensions` never listed.
      for (const bucket of projectedBuckets) {
        const shortName = this.getShortName(bucket.dimension);
        if (shortName in row) {
          renamedRow[bucket.dimension] = row[shortName];
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

    // [#16178] On the declared type, not on `string`: the value is a bucket
    // LABEL either way, and the shape that DOES list the member has always
    // answered the member's own type for exactly that folded value. Two
    // spellings of one query answer one `fields` list — the same choice the
    // ObjectQL face records at `buildFieldMeta`.
    for (const bucket of projectedBuckets) {
      const dimension = this.resolveDimension(cube, bucket.dimension);
      fields.push({
        name: bucket.dimension,
        type: dimension?.type || 'string'
      });
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
   * [#16178] Run a pipeline whose time dimensions BUCKET, folding the bucket key
   * in between the pipeline's two halves.
   *
   * The fold has to happen in JavaScript. mingo has no expression that produces
   * the canonical bucket keys (`2026-Q2`, `2026-W23`) and building one out of
   * `$isoWeek`/`$concat` would be a SECOND implementation of the label rule —
   * exactly the divergence `checkDateBucketParity` exists to catch, and exactly
   * what hoisting `bucketDateKey` into `@objectstack/core` was ruled to avoid.
   * So the pipeline is cut at its `$group`: the `$match` half still runs in the
   * driver (which is where the rows live, and which is where the tenancy guard
   * sits), the bucket keys are written onto the selected rows, and the grouping
   * half runs over those rows with the same mingo the driver would have used.
   *
   * `timezone` is `AnalyticsQuery.timezone` — the SAME reference zone
   * `parseDateRangeString` resolves a `dateRange` preset against, so the window
   * that selects the rows and the bucket that folds them agree on where a
   * calendar day starts. Unset means UTC, on both.
   */
  private async aggregateWithTimeBuckets(
    tableName: string,
    pipeline: Record<string, any>[],
    timeBuckets: readonly TimeBucket[],
    timezone?: string,
  ): Promise<Record<string, any>[]> {
    const groupIndex = pipeline.findIndex(stage => '$group' in stage);
    // Stage 3 pushes `$group` unconditionally, so this cannot miss. Stated as a
    // throw rather than left to a `-1` slicing the pipeline inside out.
    if (groupIndex < 0) {
      throw new Error(
        'Analytics pipeline carries no $group stage to fold a time bucket into (driver-memory).',
      );
    }
    const selected = await this.driver.aggregate(tableName, pipeline.slice(0, groupIndex));
    for (const row of selected) {
      for (const bucket of timeBuckets) {
        row[bucket.bucketKey] = bucketDateKey(
          readFieldPath(row, bucket.fieldPath),
          bucket.granularity,
          timezone,
        );
      }
    }
    return new Aggregator(pipeline.slice(groupIndex)).run(selected) as Record<string, any>[];
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
    const whereClauses = this.sqlConjunction(cube, this.normalizeFilters(query, cube));

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
   * The mingo `$match` document one implicitly-ANDed entry list compiles to —
   * the top-level list `normalizeFilters` returns, and (since #5930 step 3)
   * each branch of a {@link NormalizedCubeDisjunction}, which is rendered by
   * the same rule so a branch means exactly what a top-level list means.
   */
  private mongoConjunction(cube: Cube, entries: ReadonlyArray<NormalizedCubeEntry>): Record<string, any> {
    const matchStage: Record<string, any> = {};
    /**
     * [#13524] Predicates for a member that already has one — see the
     * promotion below the loop for why they cannot be assigned.
     */
    const contested: Record<string, any>[] = [];
    for (const entry of entries) {
      // [ADR-0053 D-D1, amended — #5930 step 3] A disjunction. A branch with no
      // entries is TRUE and absorbs it: no constraint at all. A disjunction
      // with no branches is FALSE: the explicit constant, not an empty `$or`
      // left to the matcher's reading. Otherwise each branch compiles by this
      // same rule and mingo's `$or` joins them — joined through `$and` beside
      // the member predicates, since one `$match` holds a single `$or` key.
      if (isDisjunction(entry)) {
        if (entry.anyOf.some((branch) => branch.length === 0)) continue;
        contested.push(
          entry.anyOf.length === 0
            ? { $expr: false }
            : { $or: entry.anyOf.map((branch) => this.mongoConjunction(cube, branch)) },
        );
        continue;
      }
      const filter = entry;
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
      const storageForm = this.storageFormFor(cube, filter.member);
      const table = this.extractTableName(cube.sql);
      const predicate = this.mongoPredicateBuilder(filter.operator)({
        comparands: filter.values.map(storageForm),
        raw: filter.values,
        containment: (value) => this.driver.filterContainsTest(table, fieldPath, value),
        // [#6520] `$icontains`' fold, from the spec's shared definition rather
        // than from the driver's Unicode-folding `filterSubstringPattern`.
        asciiSubstring: (value) => new RegExp(asciiCaseInsensitiveRegexSource(String(value))),
      });
      // [#13524] This was `matchStage[fieldPath] = …`, and the assignment was
      // a WHOLESALE clobber — the widest member of this card's class. The two
      // document-shaped translators lose a constraint only when two operators
      // happen to lower onto the SAME key; here the stage is keyed by field
      // path alone, so the second predicate on a member replaced the first
      // ENTIRELY, for every operator pair. And `flattenFilterCondition` folds
      // `$and` into this same flat list, so `{$and: [{name: {$contains:'a'}},
      // {name: {$ne:'b'}}]}` — two separate nodes, not one operator map —
      // lost a constraint too. Measured on a three-row fixture:
      // `{name: {$contains:'a', $ne:'b'}}` aggregated ['1','3'] and its
      // key-swapped twin ['1'], while the reference matcher said ['1'].
      //
      // Same rule as the translators: free member merges inline, a taken one
      // becomes its own `$and` branch of the SAME `$match`, where both
      // predicates survive. No ranking is needed here — unlike a contested
      // operator key, nothing is overwritten, so which predicate sits inline
      // changes the document's shape but never its answer.
      if (Object.prototype.hasOwnProperty.call(matchStage, fieldPath)) {
        contested.push({ [fieldPath]: predicate });
      } else {
        matchStage[fieldPath] = predicate;
      }
    }
    // A field path can never BE `$and` — `resolveFieldPath` resolves cube
    // members, and `flattenFilterCondition` folds `$and` away and turns `$or`
    // into a disjunction entry before this runs — so this cannot collide with a
    // member.
    if (contested.length > 0) matchStage.$and = contested;
    return matchStage;
  }

  /**
   * The SQL clauses one implicitly-ANDed entry list compiles to, joined with
   * `AND` by the caller — the twin of {@link mongoConjunction}, by the same
   * rule on the same entries, so the echo describes the `$match` that ran.
   *
   * [ADR-0053 D-D1, amended — #5930 step 3] A disjunction renders as
   * `(b1 OR b2 …)`, each branch parenthesised when it holds more than one
   * clause, so no reading of it leans on `AND` binding tighter than `OR`. A
   * branch that compiles to no clause is TRUE and drops the whole disjunction;
   * a disjunction with no branches is `1 = 0`, the FALSE constant this exit
   * already spells an empty `$in` with.
   */
  private sqlConjunction(cube: Cube, entries: ReadonlyArray<NormalizedCubeEntry>): string[] {
    const clauses: string[] = [];
    for (const entry of entries) {
      if (isDisjunction(entry)) {
        if (entry.anyOf.length === 0) {
          clauses.push('1 = 0');
          continue;
        }
        const branches = entry.anyOf.map((branch) => this.sqlConjunction(cube, branch));
        if (branches.some((branch) => branch.length === 0)) continue;
        clauses.push(
          `(${branches.map((branch) => (branch.length === 1 ? branch[0] : `(${branch.join(' AND ')})`)).join(' OR ')})`,
        );
        continue;
      }
      const fieldPath = this.resolveFieldPath(cube, entry.member);
      const storageForm = this.storageFormFor(cube, entry.member);
      const table = this.extractTableName(cube.sql);
      clauses.push(this.sqlPredicateBuilder(entry.operator)({
        column: fieldPath,
        comparands: entry.values.map(storageForm),
        raw: entry.values,
        literal: (value) => this.toSqlLiteral(value),
        globSubstring: (value) => this.toSqlLiteral(globSubstringPattern(value)),
        members: (value) => {
          // [#20874] Read off the very test the `$match` exit runs, so the echo
          // and the chart can never name two different member sets.
          const test = this.driver.filterContainsTest(table, fieldPath, value);
          return '$elemMatch' in test ? test.$elemMatch.$in : null;
        },
      }));
    }
    return clauses;
  }

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
   * with `INVALID_FILTER` / 400, by the same walk the query path uses (as the
   * reference matcher did, until retired). It used to be dropped, and the direction of that drop
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
   *
   * ## The door in front of the gate (ADR-0053 D-D1, amended — #5930 step 3)
   *
   * This method is also the one seam of the amendment's item 2 that did not
   * exist before it — the face's NEW door — and it runs, in order:
   *
   * 1. **The two shared comparand faces** this face ran without:
   *    `assertListComparandShapes`, then `normalizeFilterComparandTypes`, whose
   *    RETURN is the condition read from here on (a bigint within 2^53
   *    narrowed to its number, copy-on-write). So an `undefined` comparand —
   *    implicit, under an operator, or as a list member — is refused
   *    `INVALID_FILTER` / 400 as it is on every other face (ruling #7872,
   *    #6050 B), where this face used to read it as `null`.
   * 2. **The shared lowering**, `lowerFilterCondition`. Nothing resolves filter
   *    tokens on this face, so it reads the comparands as authored (item 3).
   *    It applies type-blind (item 7): the declared temporal kinds live inside
   *    the driver and reach this face only as a storage-form conversion, and
   *    type-blind is the reading this face's own bound copy gave until #5930
   *    step 4 deleted it, so it moved no answer. This door is now the ONLY
   *    place this face applies the whole-day bound to a `where` — on every
   *    column, since no `isDatetimeColumn` reader is passed — and neither
   *    exit's `lte` row widens anything. (A `dateRange` window is not a
   *    `where`: its explicit end keeps its own arm, the amendment's item 8.) The lowering emits calendar strings; each exit converts
   *    them to the field's storage form as it converts any comparand (item 6).
   * 3. **This face's own vocabulary gate**, on the LOWERED condition — what the
   *    face actually compiles, as a driver behind the engine seam judges the
   *    lowered filter it receives. So a `$between` reaches the gate as the two
   *    bounds it lowers to, and answers `find()`'s rows here too.
   *
   * ## In front of the door: the `FilterArray` spelling
   *
   * An array `where` is lowered FIRST, by {@link lowerWhereFilterArray} — the
   * spec's `isFilterAST` / `parseFilterAST` pair the analytics `where` door
   * calls — so it reaches steps 1–3 as the `FilterCondition` it spells and
   * answers what that object answers; `[]` is no filter, and an array with no
   * lowering is refused `INVALID_FILTER` / 400. It used to skip all three steps
   * and the flatten, and so answered every row.
   */
  private normalizeFilters(query: unknown, cube: Cube): NormalizedCubeEntry[] {
    if (!query || typeof query !== 'object') return [];

    const out: NormalizedCubeEntry[] = [];
    const where = lowerWhereFilterArray((query as { where?: unknown }).where);

    if (where && typeof where === 'object' && !Array.isArray(where)) {
      assertListComparandShapes(where);
      const admitted = normalizeFilterComparandTypes(where);
      const lowered = lowerFilterCondition(admitted);
      // [#21066] A `where` key here is a cube MEMBER; the declaration it is
      // judged by is the field it resolves to on the cube's table — the same
      // (table, field path) pair `$contains` asks the driver about
      // (`filterContainsTest`), so this face refuses the equality and ordering
      // family on exactly the fields where `$contains` asks membership, as
      // `find()` does. The withheld half goes to this face's own log.
      const table = this.extractTableName(cube.sql);
      const declared = this.driver.filterFieldDeclarations(table);
      assertFilterConditionShape(lowered, 'where', ANALYTICS_FILTER_CAPABILITIES, {
        isJsonStoredField: (member) => declared.isJsonStoredField(this.resolveFieldPath(cube, member)),
        reportWithheld: (diagnostic) => this.logger.warn(withheldFilterLogLine(diagnostic)),
      });
      this.flattenFilterCondition(lowered as Record<string, unknown>, out, 'where');
    }

    return out;
  }

  private flattenFilterCondition(
    cond: Record<string, unknown>,
    out: NormalizedCubeEntry[],
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
      // [ADR-0053 D-D1, amended — #5930 step 3] `undefined` no longer reaches
      // this walk: the shared comparand faces at the door refuse it in every
      // comparand position, as every other face does (ruling #7872). It used to
      // fall through here and read as `null`.

      // Logical combinators. `$and` folds into the same implicit-AND list; the
      // gate above has already proven it is an array of filter nodes.
      if (key === '$and') {
        for (const sub of raw as unknown[]) {
          this.flattenFilterCondition(sub as Record<string, unknown>, out, here);
        }
        continue;
      }
      // [ADR-0053 D-D1, amended — #5930 step 3] `$or` becomes ONE entry holding
      // each branch flattened on its own — a branch is an implicitly-ANDed list
      // exactly like the top level — so the disjunction survives to both exits
      // instead of being folded into the conjunction around it. The gate above
      // has proven the operand an array of filter nodes. See
      // {@link NormalizedCubeDisjunction} for the identities.
      if (key === '$or') {
        const anyOf = (raw as unknown[]).map((sub, index) => {
          const branch: NormalizedCubeEntry[] = [];
          this.flattenFilterCondition(sub as Record<string, unknown>, branch, `${here}[${index}]`);
          return branch;
        });
        out.push({ anyOf });
        continue;
      }
      // [#5345] Unreachable via normalizeFilters — the gate refuses it for this
      // face before the lowering starts. Kept as a throw rather than left
      // implicit so that the `continue` which caused #5345 cannot come back, and
      // so a future caller that lowers a condition without gating it first fails
      // loudly instead of silently widening the result set.
      if (key === '$not') {
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
   * [#5373] The conversion that puts a value into the storage form of the field
   * one lowered entry is compared against — the ONE place either exit converts
   * a value, so the two exits cannot drift apart. Each exit maps the entry's
   * comparands through it. No builder derives a value any more: the whole-day
   * bound of an `lte` (#20661) is widened from the AUTHORED day by the shared
   * lowering at {@link MemoryAnalyticsService.normalizeFilters}, before either
   * exit converts it (ADR-0053 D-E3, structural since #5930 step 4).
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
  private storageFormFor(cube: Cube, member: string): (value: unknown) => unknown {
    const table = this.extractTableName(cube.sql);
    const fieldPath = this.resolveFieldPath(cube, member);
    return (value) => this.driver.filterComparandStorageForm(table, fieldPath, value);
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
      // [#20544] Compensated, as every other face the platform owns adds —
      // see {@link compensatedAddendAccumulator}.
      case 'sum':
        return compensatedAddendAccumulator(`$${fieldPath}`, 'sum');
      case 'avg':
        return compensatedAddendAccumulator(`$${fieldPath}`, 'avg');
      // [#11152] `min`/`max` take the SAME boolean coercion as `sum`/`avg` —
      // maintainer ruling 2026-08-28 (superseding #11249's `false`/`true`):
      // booleans aggregate as NUMBERS on every face, no per-aggregate
      // exception, so a boolean measure's order statistics answer 0/1. mingo's
      // `$min`/`$max` rank whatever the expression yields, so the coerced
      // number is what gets ranked; every non-boolean value passes through the
      // `$cond` untouched and is ranked exactly as before. The data face
      // carries the identical rule in JavaScript (`memory-driver.ts`,
      // `computeAggregate`) — one face aligned alone is how this package's
      // faces come to disagree.
      case 'min':
        return { $min: numericAggregandExpr(`$${fieldPath}`) };
      case 'max':
        return { $max: numericAggregandExpr(`$${fieldPath}`) };
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

  /**
   * The STRING arm of `timeDimensions[].dateRange`, resolved against the ONE
   * closed vocabulary — or refused (#16322, the driver half of #16041).
   *
   * ## What this method stopped doing, and why each half had to go
   *
   * It used to be a hand-rolled parser with two branches and a fallback, and
   * ALL THREE were defects by the time #16041 closed the contract:
   *
   *   - `range === 'today'` was the only preset it understood. Every other
   *     member of the declared vocabulary fell past it — MEASURED on the built
   *     dist over five probe rows (2020, 2026-08-31, 2026-09-05, now, 2099):
   *     `today` selected 1/5, and the other twelve selected **5/5, 2099
   *     included**. So a VALID preset like `last_30_days` was accepted by the
   *     schema and then silently widened to all of history: the exact defect
   *     class #16041 abolished at the contract, relocated onto the
   *     newly-blessed vocabulary.
   *   - `range.startsWith('last ')` matched a SPACE, a relative dialect
   *     (`'last 7 days'`) the closed vocabulary does not contain and the
   *     schema door now refuses. It could never fire for a preset name, which
   *     spells them `last_7_days`.
   *   - the `[range, range]` fallback is the silent widening itself, and it is
   *     what the refusal below replaces. ⛔ It must not come back in any
   *     spelling: an unresolvable window is a REFUSAL, not a window.
   *
   * ## ⛔ The calendar arithmetic did not move here — it left
   *
   * #15825's two defects (a LOCAL-midnight boundary rendered as UTC, and
   * `last N …` arithmetic done on the local calendar) and #16042's dropped
   * `timezone` were repaired in this method, and are now repaired ONCE for
   * every analytics face in `@objectstack/core`'s
   * {@link resolveAnalyticsDateRangeString} — the same package, one file over
   * from the `{date-macro}` resolver whose tokens it lowers. ⛔ Re-deriving any
   * of it here is the three-drifting-copies shape the vocabulary module's own
   * header records; the SQL analytics path calls the same function, which is
   * what makes "the drivers agree" checkable rather than asserted.
   *
   * ## ⭐ What survives unchanged
   *
   * `'today'` still resolves to `[that zone's midnight, tomorrow's midnight)`
   * with `endExclusive: true` — #16179's repair, byte for byte, because the
   * shared resolver states the same window in the same tokens. The three
   * rolling `last_N_days` presets end at NOW and stay INCLUSIVE. And the
   * explicit `[a, b]` array arm never arrives here at all: it is discriminated
   * at the call site and keeps its published `$lte` reading.
   *
   * @throws the ADR-0112 `400 ANALYTICS_DATE_RANGE_UNRECOGNIZED` envelope for
   *   a string outside `DATE_RANGE_PRESETS` — the same code, status and
   *   wording the schema door and the SQL analytics path answer with, since
   *   all three call one constructor.
   */
  private parseDateRangeString(range: string, timezone?: string): ResolvedDateRange {
    const window = resolveAnalyticsDateRangeString(range, { timezone });
    return { bounds: [window.start, window.end], endExclusive: window.endExclusive };
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
