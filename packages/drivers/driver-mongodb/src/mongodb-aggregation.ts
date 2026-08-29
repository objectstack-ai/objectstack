// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * MongoDB Aggregation Pipeline Builder
 *
 * Translates ObjectStack QueryAST aggregations + groupBy into
 * MongoDB aggregation pipeline stages ($match, $group, $sort, $project).
 */

import type { Document } from 'mongodb';
import { StandardErrorCode } from '@objectstack/spec/api';
import { AggregationFunction } from '@objectstack/spec/data';
import type { DateGranularityValue, GroupByNode } from '@objectstack/spec/data';
import { translateFilter } from './mongodb-filter.js';
import type { TemporalFieldKindResolver } from './mongodb-temporal.js';

/**
 * Aggregation function descriptor from QueryAST.
 *
 * [#12818] `function` stays a bare `string`, deliberately: the enforcement is
 * {@link refuseAggregateFunction} at the lowering site, not this annotation.
 * Narrowing it to `AggregationFunction` was the card's other candidate remedy
 * and it does not close the hole it names — `MongoDBDriver.aggregate` reads its
 * aggregations through `(query as any).aggregations`, so a narrowed type meets
 * no value at this driver's own call site, and this module is EXPORTED, so a
 * caller hands the builder whatever string it likes. A door that cannot be
 * reached by the values it governs looks shut and is not. The narrowing would
 * additionally have deleted the `array_agg` / `string_agg` arms below as a side
 * effect (both left the enum at #6188), which was a second accept-face change
 * and a separate card: #13075, now LANDED. It did not land as a deletion —
 * those two arms are NAMED and refused ({@link refuseRetiredAggregateFunction}),
 * because this switch's `default` answers a `$sum` and falling through would
 * have turned a visibly-wrong array into a plausible number. The reasoning
 * above is unchanged by it: `function` is still a bare `string`, and the
 * enforcement is still at the lowering site. See {@link LOWERED_HERE}.
 */
export interface AggregationInput {
  function: string;
  field?: string;
  alias: string;
  distinct?: boolean;
  filter?: unknown;
}

/**
 * [#7580] The granularities this driver buckets NATIVELY, published verbatim as
 * `MongoDBDriver.supports.queryDateGranularity`.
 *
 * ## One constant, two readers — which is what makes "declared = enforced" true
 *
 * The capability record the engine reads and the set {@link normalizeGroupBy}
 * agrees to lower are THE SAME OBJECT. A driver that advertises a granularity
 * its builder then refuses is strictly worse than one that advertises nothing:
 * the engine stops bucketing in memory on the strength of the advertisement, so
 * a query that used to answer starts throwing 501. Splitting the two into
 * separate literals is how that happens, so they are not split.
 * `mongodb-date-bucket-parity.test.ts` pins the identity so a future edit to one
 * cannot silently miss the other.
 *
 * ## Why all five, when `driver-sql` on SQLite advertises four
 *
 * SQLite has no ISO-week format specifier, so `driver-sql` sets `week: false`
 * and lets the engine bucket weeks in memory. MongoDB's `$dateToString` has both
 * halves of the ISO-8601 week date — `%G` (ISO week-YEAR) and `%V` (ISO week
 * number, zero-padded to 2) — which is exactly the label
 * `bucketDateValue` computes by hand. The dialect difference is real, so the
 * records differ.
 *
 * ⚠️ **Documentation-derived, not observed** (#5517). Every `$dateToString`
 * format specifier and every `$convert`/`$concat`/`$switch` null rule this
 * record stands on is read from the MongoDB manual; this fleet cannot fetch a
 * mongod binary (proxy 403), so no assertion here has met a real server. See
 * the bound stated at the top of `mongodb-date-bucket-parity.test.ts`.
 */
export const MONGODB_DATE_GRANULARITIES: Record<DateGranularityValue, boolean> = {
  day: true,
  week: true,
  month: true,
  quarter: true,
  year: true,
};

/** The advertised granularities, in a stable order, for refusal messages. */
const BUCKETED_HERE: string[] = Object.entries(MONGODB_DATE_GRANULARITIES)
  .filter(([, on]) => on === true)
  .map(([g]) => g)
  .sort();

/**
 * One `groupBy` entry after the declared union has been read: the field the
 * `$group._id` keys on, the name the group value is PROJECTED under, and the
 * expression whose value defines the group.
 *
 * [#6850] `field` and `outKey` are separate because `GroupByNodeSchema.alias`
 * renames the projection without moving the grouping — the rule #6401 converged
 * the three SQL faces onto (`alias ?? field`), and the one
 * `in-memory-aggregation.ts` has always applied.
 *
 * [#7580] `expr` is separate from `field` for the same class of reason: a
 * date-bucketed node groups by a LABEL computed from the field, not by the
 * field. Keeping it on the target rather than re-deriving it at `$group` time is
 * what stops the `_id` and the `$project` that flattens it from disagreeing
 * about which of the two a node meant.
 */
interface GroupByTarget {
  field: string;
  outKey: string;
  expr: Document | string;
}

/**
 * [#6850] Read the declared `GroupByNode` union — a bare field name, or a
 * structured `{ field, dateGranularity?, alias? }` node.
 *
 * Before this, `groupBy` was annotated `string[]` and every entry went straight
 * into `groupId[field] = '$' + field`. A structured node is an OBJECT there, so
 * the `$group._id` key became the literal `"[object Object]"` and its value the
 * field path `"$[object Object]"`, which matches nothing: the aggregation did
 * not refuse and did not throw, it ANSWERED — rows grouped by a nonexistent
 * path, under a column named `[object Object]`. (`mongodb-driver.ts` passed the
 * value through an `any` cast, which is why the declared union never met that
 * `string[]` annotation at `tsc`.) `driver-turso`'s remote transport carried the
 * same shape and at least died loudly on it (#6212); this face answered.
 */
function normalizeGroupBy(nodes: readonly GroupByNode[]): GroupByTarget[] {
  return nodes.map((node) => {
    if (typeof node === 'string') return { field: node, outKey: node, expr: `$${node}` };
    if (node && typeof node === 'object' && typeof node.field === 'string' && node.field !== '') {
      const outKey = node.alias ?? node.field;
      // [#7580] A DATE-BUCKETED node groups by the engine's bucket LABEL. A
      // granularity outside {@link MONGODB_DATE_GRANULARITIES} is still refused
      // rather than grouped by the raw instant, which would answer one bucket
      // per distinct timestamp and look like a working query.
      if (node.dateGranularity) {
        if (MONGODB_DATE_GRANULARITIES[node.dateGranularity] !== true) {
          refuseDateBucketedGroupBy(node.dateGranularity);
        }
        return { field: node.field, outKey, expr: buildDateBucketExpr(node.field, node.dateGranularity) };
      }
      return { field: node.field, outKey, expr: `$${node.field}` };
    }
    throw malformedGroupByError(node);
  });
}

/**
 * [#7580] The instant a bucket expression reads, from whatever form the column
 * holds it in.
 *
 * ## Why a conversion step exists at all (ADR-0053 storage forms)
 *
 * This driver does NOT store every temporal field as a BSON `Date`. Per
 * `mongodb-temporal.ts`'s canon table: `datetime` is a BSON `Date`, but `date`
 * is `YYYY-MM-DD` TEXT and `time` is `HH:MM:SS[.fff]` TEXT — both timezone-naive
 * by ADR-0053 Phase 1, both deliberately NOT instants. A date operator applied
 * straight to `$field` therefore meets a string on two of the three declared
 * kinds, and MongoDB's date operators do not silently tolerate that.
 *
 * `$convert … onError: null, onNull: null` makes the read TOTAL, which is the
 * property that matters, because the in-memory reference is total too:
 * `bucketDateValue` returns `null` for a null, absent or unparseable instant and
 * puts them all in one bucket (#3839). Matching that shape is not a nicety —
 * a non-total expression would fail the WHOLE aggregation on one junk row, where
 * the engine's fallback answers.
 *
 * Measured, per declared kind, against `bucketDateValue`'s `new Date(...)`:
 *
 * | Stored form | in-memory reference | this expression |
 * |---|---|---|
 * | BSON `Date` (`datetime`) | the instant | identity — `$convert` of a date is the date |
 * | `'2024-01-15'` (`date`) | `new Date('2024-01-15')` = midnight **UTC** | `$dateFromString` semantics: midnight UTC |
 * | `'14:30:00'` (`time`) | `Invalid Date` → `null` bucket | not a date → `onError` → `null` bucket |
 * | epoch ms number | `new Date(ms)` | `$convert` reads a numeric as epoch ms |
 * | `null` / missing | `null` bucket | `onNull` → `null` bucket |
 *
 * ⚠️ **The residual divergence, stated rather than papered over.** JS's date
 * parser accepts legacy spellings that ISO-8601 does not (`'2024-01-15 10:00:00'`
 * with a space, `'2024/01/15'`), so a column holding one of those buckets in
 * memory and empties here. Those are not forms this driver WRITES — every write
 * goes through `coerceTemporalValue`, which canonicalises to the table above —
 * so the exposure is pre-#4047 legacy rows only, and it is the same exposure
 * every SQL face already carries (`strftime` parses no more of them than
 * `$dateFromString` does). It is recorded here because "advertised" has to mean
 * something exact.
 */
function instantOf(field: string): Document {
  return { $convert: { input: `$${field}`, to: 'date', onError: null, onNull: null } };
}

/**
 * [#7580] The expression whose value IS the engine's bucket label for `field` at
 * `granularity` — the `$group._id` half of native date bucketing.
 *
 * ## Labels, not instants — and therefore no `$dateTrunc`
 *
 * The contract is not "truncate the instant", it is "produce the string
 * `bucketDateValue` produces", because the engine's in-memory fallback emits
 * LABELS and `engine.aggregate` picks between the two paths per query on a
 * capability bit. A drill-down that crosses that seam has to see the same
 * spelling on both sides. `$dateTrunc` (the route the card sketched) answers a
 * truncated DATE, which would still need formatting afterwards — so it buys a
 * stage, raises the server floor to MongoDB 5.0, and adds `binSize` /
 * `startOfWeek` semantics this fleet cannot observe. `$dateToString` alone
 * answers the label directly, on a 3.6 floor, out of one operator. Fewer
 * unobserved semantics is the whole argument: every operator here is one more
 * documentation-derived claim (#5517), so the lowering that needs the fewest
 * wins.
 *
 * ## The five labels, against `bucketDateValue`
 *
 * | Granularity | Reference | Emitted |
 * |---|---|---|
 * | `year` | `String(y)` → `'2024'` | `%Y` |
 * | `month` | `` `${y}-${MM}` `` → `'2024-01'` | `%Y-%m` |
 * | `day` | `` `${y}-${MM}-${DD}` `` → `'2024-01-15'` | `%Y-%m-%d` |
 * | `week` | ISO-8601 week date → `'2025-W01'` | `%G-W%V` |
 * | `quarter` | `` `${y}-Q${n}` `` → `'2024-Q1'` | `%Y` + `-Q` + a month switch |
 *
 * `%G`/`%V` are the ISO week-YEAR and the zero-padded ISO week number — the two
 * quantities `bucketDateValue` computes by hand off the Thursday of the week, so
 * `2024-12-30` labels `'2025-W01'` on both sides rather than `'2024-W01'`.
 *
 * ## Why `quarter` is spelled with a `$switch` over strings
 *
 * MongoDB has no quarter specifier, so the digit has to be derived. Deriving it
 * arithmetically (`$ceil` of `$divide` of `$month`) would make the label depend
 * on how `$toString` formats a *double* — `1` vs `1.0` is the difference between
 * `'2024-Q1'` and a label nothing else in the repo produces, and it is precisely
 * the kind of claim this environment cannot check. Comparing the zero-padded
 * `%m` STRING instead (`'01' <= '03'` is lexicographic and exact for fixed-width
 * two-digit numerals) keeps every value in the expression a literal string.
 *
 * Null propagation falls out of `$concat`, which the manual defines as returning
 * `null` if ANY argument is null: on a null instant `%Y` is null, so the whole
 * label is null and lands in the same empty bucket the reference uses. The
 * `$switch` still evaluates on that path (`$lte: [null, '03']` is true under BSON
 * sort order, so it answers `'1'`) — harmlessly, because `$concat` has already
 * decided. No `$cond` guard is needed, and one fewer operator is one fewer
 * unobserved claim.
 *
 * ⚠️ Known, shared bound: `%Y` is 4-digit zero-padded where `String(y)` is not,
 * so a year before 1000 labels `'0999'` here and `'999'` in memory. Every SQL
 * face has the identical property (`strftime('%Y')` pads too) and advertises
 * `year` regardless; it is recorded, not silently inherited.
 */
function buildDateBucketExpr(field: string, granularity: DateGranularityValue): Document {
  const fmt = (format: string): Document => ({ $dateToString: { format, date: instantOf(field) } });

  switch (granularity) {
    case 'year':
      return fmt('%Y');
    case 'month':
      return fmt('%Y-%m');
    case 'day':
      return fmt('%Y-%m-%d');
    case 'week':
      return fmt('%G-W%V');
    case 'quarter':
      return {
        $concat: [
          fmt('%Y'),
          '-Q',
          {
            $switch: {
              branches: [
                { case: { $lte: [fmt('%m'), '03'] }, then: '1' },
                { case: { $lte: [fmt('%m'), '06'] }, then: '2' },
                { case: { $lte: [fmt('%m'), '09'] }, then: '3' },
              ],
              default: '4',
            },
          },
        ],
      };
    default:
      // Unreachable through `DateGranularityValue`, and refused rather than
      // defaulted: a granularity this switch does not know is a granularity with
      // no label, and guessing one is the silent-answer failure this whole card
      // exists to close.
      return refuseDateBucketedGroupBy(granularity);
  }
}

/**
 * [#6850] A `groupBy` entry asks for a date BUCKET — the twin of `driver-sql`'s
 * and `driver-turso`'s `refuseDateBucketedGroupBy`, first sentence for first
 * sentence, and the same NOT_IMPLEMENTED/501 class for the same reason (#5907,
 * #6212, ADR-0112): `DateGranularity` declares the name, this backend emits no
 * bucket expression for it, so it is a capability gap in the backend rather than
 * a mistake in the query.
 *
 * [#7580] The population it refuses has SHRUNK, and the shape has not. This
 * driver now lowers every granularity in {@link MONGODB_DATE_GRANULARITIES} —
 * all five `DateGranularity` declares — and publishes exactly that record as
 * `MongoDBDriver.supports.queryDateGranularity`, so the refusal no longer fires
 * for any spec-valid granularity. It is kept, and kept total, for the two
 * callers that can still reach it: one that hands the builder a granularity
 * string outside the declared enum (this module is exported, and `groupBy`
 * arrives through an `any` cast on the driver's own `aggregate`), and any future
 * edit that narrows the advertised record without narrowing the lowering. The
 * refusal is the local half of "declared = enforced" — the capability record
 * says what the engine may push down, this says what the builder will actually
 * lower, and they read the same constant so they cannot disagree.
 *
 * The message names what IS bucketed here, so a reader is told where the
 * boundary is rather than only that they crossed it — the `driver-sql` wording,
 * first sentence for first sentence (#5907, #6212, ADR-0112).
 */
function refuseDateBucketedGroupBy(granularity: string): never {
  const err = new Error(
    `Date bucketing by '${granularity}' is not supported by this backend. `
    + `Bucketed here: ${BUCKETED_HERE.length > 0 ? BUCKETED_HERE.join(', ') : 'none'} (driver-mongodb). `
    + `The query is spelled correctly and @objectstack/spec DateGranularity declares it — this is `
    + `a capability gap in the backend, not a mistake in the query, which is why it answers `
    + `NOT_IMPLEMENTED/501 rather than a 400. A driver publishes the granularities it buckets `
    + `natively as \`supports.queryDateGranularity\`; the engine reads that record and buckets `
    + `in memory for every granularity absent from it, which is always correct (#6212).`,
  ) as Error & { code?: string; status?: number };
  err.code = StandardErrorCode.enum.NOT_IMPLEMENTED;
  err.status = 501;
  throw err;
}

/**
 * [#10576] An aggregation entry carries a per-aggregation `filter`
 * (`AggregationNodeSchema.filter`, the contract half of #10413) — the twin of
 * `driver-sql`'s `unsupportedAggregationFilterError`, first sentence for first
 * sentence, and the same NOT_IMPLEMENTED/501 class for the same reason (#5907,
 * ADR-0112): the spec declares the key, this builder emits no conditional
 * accumulator for it, so it is a capability gap in the backend rather than a
 * mistake in the query. Refused rather than silently accumulating the
 * UNFILTERED rows — the #10413 defect. Unreachable through `engine.aggregate`
 * (the engine lowers filtered aggregations in memory for every driver); this
 * fires only for a caller that drives the builder or driver directly.
 */
function refusePerAggregationFilter(alias: string): never {
  const err = new Error(
    `Per-aggregation \`filter\` on "${alias}" is not supported by this backend (driver-mongodb). ` +
    `The query is spelled correctly and @objectstack/spec AggregationNodeSchema declares the key — ` +
    `this backend compiles no conditional-aggregate (SQL FILTER (WHERE …) / CASE WHEN) expression ` +
    `for it, so it is refused rather than silently aggregating the UNFILTERED rows (#10413), which ` +
    `is why it answers NOT_IMPLEMENTED/501 rather than a 400. \`engine.aggregate\` lowers filtered ` +
    `aggregations in memory for every driver without native support — route the query through the ` +
    `engine, or drop the \`filter\` key.`,
  ) as Error & { code?: string; status?: number };
  err.code = StandardErrorCode.enum.NOT_IMPLEMENTED;
  err.status = 501;
  throw err;
}

/**
 * [#6850] A `groupBy` entry that is neither half of the declared union.
 *
 * INVALID_QUERY/400 rather than 501: unlike a date bucket this is not a
 * capability gap — `GroupByNodeSchema` declares a field NAME or an object
 * carrying a `field`, and nothing else has a meaning to lower. Refused rather
 * than skipped because dropping a grouping target silently changes which rows
 * share a group.
 */
function malformedGroupByError(node: unknown): Error {
  const err = new Error(
    `groupBy entry ${JSON.stringify(node) ?? String(node)} is not a grouping target. `
    + `@objectstack/spec GroupByNodeSchema declares each entry as either a field NAME `
    + `('region') or an object with a non-empty 'field' ({ field: 'closed_at', dateGranularity?, `
    + `alias? }). It is refused rather than skipped because dropping a grouping target silently `
    + `changes which rows share a group.`,
  ) as Error & { code?: string; status?: number };
  err.code = StandardErrorCode.enum.INVALID_QUERY;
  err.status = 400;
  return err;
}

/**
 * [#12818] The aggregate functions {@link buildAccumulator} LOWERS into a
 * `$group` accumulator — and therefore the exact population that is NOT
 * refused.
 *
 * A ROSTER rather than `driver-sql`'s table of lowerings, because this face's
 * lowerings are not one shape with a name in it: `count` branches on whether a
 * `field` was given, `count_distinct` splits its work with
 * {@link postProcessAggregation}, and the four arithmetic/order arms wrap
 * {@link numericAggregandExpr}. So the `switch` stays the compiler and this is
 * what the refusal messages read; `mongodb-unrecognised-aggregate-function.test.ts`
 * holds the two equal in BOTH directions (every name here lowers, every name
 * absent from here refuses), which is the drift a hand-written list otherwise
 * develops the day after it is typed — the note over `driver-memory`'s
 * `SUPPORTED_FIELD_OPERATORS` (#5345), applied to the aggregate vocabulary.
 *
 * ⚠️ This roster CARRIED two entries `AggregationFunction` does not declare —
 * `array_agg` and `string_agg`, which left the enum at #6188 (ADR-0049
 * enforce-or-remove) while this face went on lowering them, so one query
 * answered 400 on `driver-sql` and `driver-turso` and a `$push` array here.
 * #13075 CLOSED that divergence: {@link buildAccumulator} names both arms and
 * refuses them ({@link refuseRetiredAggregateFunction}), so they are off this
 * roster too — a roster that named what the switch no longer lowers would be a
 * lie, and it is what the refusal messages read.
 *
 * The reason they were kept OUT of those messages stands, and is why
 * {@link LOWERED_AND_DECLARED} still filters rather than being collapsed into
 * this constant: a remedy naming a retired spelling is a remedy
 * `AggregationNodeSchema` rejects at the protocol door. The two sets are equal
 * TODAY; the filter is what keeps that true of the next name this face lowers
 * ahead of the enum, instead of only of those two.
 */
const LOWERED_HERE: readonly string[] = [
  'count', 'sum', 'avg', 'min', 'max', 'count_distinct',
];

/**
 * [#5907] The aggregate vocabulary the Query Protocol DECLARES, read from the
 * spec rather than restated — `AggregationNodeSchema.function` is this enum, so
 * "declared" has exactly one definition and this driver cannot drift from it.
 */
const DECLARED_AGGREGATE_FUNCTIONS: readonly string[] = AggregationFunction.options;

/**
 * [#12818] What a refusal offers back as the remedy: lowered HERE *and*
 * writable by a caller. The intersection, not {@link LOWERED_HERE} itself —
 * see that constant's warning.
 */
const LOWERED_AND_DECLARED: readonly string[] =
  LOWERED_HERE.filter((f) => DECLARED_AGGREGATE_FUNCTIONS.includes(f));

/**
 * [#12818] Class 1 — a function name the Query Protocol does not declare.
 *
 * The caller wrote something no backend can run (`median`), so this is a
 * request-shaped mistake: `INVALID_QUERY` / 400, the catalogued
 * `StandardErrorCode` for "malformed query syntax" and a member of
 * `@objectstack/rest`'s `isExpectedQueryRejection` list, so a client mistake
 * stops being logged as an unhandled server fault. It is also the code the
 * PROTOCOL DOOR already gives this condition — `metadata-protocol`'s
 * `invalidQueryError` refuses "a function outside the spec enum" with exactly
 * `400 INVALID_QUERY` (#4254) — so a caller who reaches this driver in-process
 * gets the same wire identity as one who came through REST.
 *
 * The FIRST SENTENCE is shared verbatim with the twins in `driver-sql`'s
 * `undeclaredAggregateFunctionError` and `driver-turso`'s `remote-transport.ts`
 * (#5240 — one condition, one wording): a caller must not be able to tell which
 * backend answered from the words it used. Spelled out rather than imported,
 * which is what the two SQL faces do to each other; the bytes are pinned
 * against those faces' literals in
 * `mongodb-unrecognised-aggregate-function.test.ts`.
 *
 * Judged against the declared enum CASE-SENSITIVELY, which is what the enum is:
 * `COUNT_DISTINCT` is not `count_distinct` (`AggregationFunction.parse('COUNT')`
 * throws), so answering "declared but not implemented" for it would be false.
 */
function undeclaredAggregateFunctionError(func: string): Error {
  const err = new Error(
    `Aggregate function "${func}" is not a declared aggregate function. `
    + `Declared functions: ${DECLARED_AGGREGATE_FUNCTIONS.join(', ')} `
    + `(@objectstack/spec AggregationFunction). Fix the "function" key of the aggregations[] `
    + `entry — the Query Protocol has no such function, so this is a query no backend can run, `
    + `not a gap in this one (#5907). It is refused rather than accumulated: until #12818 this `
    + `builder answered any unrecognised name with a $sum of that column under the alias the `
    + `caller asked for, which is a plausible number nothing downstream can tell from an answer.`,
  ) as Error & { code?: string; status?: number };
  err.code = StandardErrorCode.enum.INVALID_QUERY;
  err.status = 400;
  return err;
}

/**
 * [#12818] Class 2 — a DECLARED function this backend does not lower.
 *
 * Kept distinct from {@link undeclaredAggregateFunctionError} for the reason
 * #5907 gives on the SQL faces: `count_distinct` is declared and implemented by
 * several backends, so telling a dashboard author their correct query is a typo
 * would be false. The line #5345 drew in `driver-memory`'s `filter-refusal.ts`
 * between "the protocol has no such operator" and "the protocol has it, this
 * face cannot lower it".
 *
 * ⚠️ **This class is EMPTY today, and the producer is kept deliberately** —
 * {@link LOWERED_HERE} covers every member of `AggregationFunction`, pinned as
 * a positive assertion ("the declared-but-unlowered set is empty") rather than
 * left to be rediscovered. Deleting it as dead code was considered and
 * rejected, exactly as on `driver-sql`: the branch is not an unenforced
 * declaration, it is the CLASSIFIER that decides which of two truths a future
 * name is told. Without it, the first function a later spec bump adds would be
 * told the protocol has no such name — the misreport #5907 exists to prevent,
 * landing precisely in the window between a spec change and a driver change.
 *
 * `NOT_IMPLEMENTED` / 501 from the ADR-0112 STANDARD catalog, whose own
 * `HttpStatusErrorCodeMap` pairs the two — the same envelope
 * {@link refuseDateBucketedGroupBy} and {@link refusePerAggregationFilter}
 * already answer with, one seam over in this file.
 */
function uncompilableAggregateFunctionError(func: string): Error {
  const err = new Error(
    `Aggregate function "${func}" is declared but not implemented by this backend. `
    + `Lowered here: ${LOWERED_AND_DECLARED.join(', ')} (driver-mongodb). The name is spelled `
    + `correctly and @objectstack/spec AggregationFunction declares it — this is a capability gap `
    + `in the backend, not a mistake in the query, which is why it answers NOT_IMPLEMENTED/501 `
    + `rather than a 400. Aggregate with a function this backend lowers; whether the declaration `
    + `itself should stand is ADR-0049's enforce-or-remove question (#5907).`,
  ) as Error & { code?: string; status?: number };
  err.code = StandardErrorCode.enum.NOT_IMPLEMENTED;
  err.status = 501;
  return err;
}

/**
 * [#12818] Which refusal a name this builder cannot lower deserves.
 *
 * Written ONCE and reached from the single `default:` arm, so "is this the
 * caller's mistake or ours?" cannot be answered two ways for one query. `func`
 * is the name the CALLER wrote — not a normalised form — because that is what
 * the enum is judged against and what the message has to quote back.
 */
function refuseAggregateFunction(func: string): never {
  throw DECLARED_AGGREGATE_FUNCTIONS.includes(func)
    ? uncompilableAggregateFunctionError(func)
    : undeclaredAggregateFunctionError(func);
}

/**
 * Build a MongoDB aggregation pipeline from QueryAST components.
 *
 * @param where - Filter condition (translated to $match)
 * @param aggregations - Array of aggregation descriptors
 * @param groupBy - Fields to group by
 * @param orderBy - Sort specification
 * @param limit - Max results
 * @param offset - Skip results
 */
export function buildAggregationPipeline(opts: {
  where?: unknown;
  aggregations?: AggregationInput[];
  /**
   * [#6850] `GroupByNode[]` — the spec's own union, not the `string[]`
   * restatement that had drifted from it. See {@link normalizeGroupBy}.
   */
  groupBy?: readonly GroupByNode[];
  orderBy?: Array<{ field: string; order?: string }>;
  limit?: number;
  offset?: number;
  /**
   * Declared temporal kinds of the aggregated object, so a `$match` comparand
   * lands in the field's storage form (#4047) — the aggregate path has to agree
   * with `find()` about that, or the same window answers differently depending
   * on which one the caller took.
   */
  temporalKind?: TemporalFieldKindResolver;
}): Document[] {
  const pipeline: Document[] = [];

  // $match stage
  if (opts.where) {
    const matchFilter = translateFilter(opts.where, opts.temporalKind);
    if (Object.keys(matchFilter).length > 0) {
      pipeline.push({ $match: matchFilter });
    }
  }

  // [#6850] Read the declared union ONCE, before any stage is built, so the
  // `$group` keys and the `$project` that flattens them cannot disagree about
  // what a node means — and so a refusal happens before a pipeline exists.
  const groupTargets = normalizeGroupBy(opts.groupBy ?? []);

  // $group stage
  if (opts.aggregations && opts.aggregations.length > 0) {
    const groupId: Document = {};
    const groupAccumulators: Document = {};

    // Build _id from groupBy fields. The _id key is the PROJECTED name and its
    // value the grouping EXPRESSION — a bare field path for a plain node, the
    // bucket label expression for a `dateGranularity` one (#7580) — so an alias
    // renames the output column without moving the grouping (`alias ?? field`,
    // the #6401 rule) and a bucketed node groups by its label rather than by the
    // raw instant.
    for (const { outKey, expr } of groupTargets) {
      groupId[outKey] = expr;
    }

    // Build accumulators from aggregation descriptors
    for (const agg of opts.aggregations) {
      // [#10576] A per-aggregation `filter` (`AggregationNodeSchema.filter`,
      // the contract half of #10413) has no lowering in this builder — a
      // `$cond`-wrapped accumulator would be one, but building it is a
      // capability investment this refusal deliberately is not. Refused before
      // a pipeline exists rather than silently accumulating the UNFILTERED
      // rows (the #10413 defect). Unreachable through `engine.aggregate`,
      // which lowers filtered aggregations in memory for every driver; `{}` is
      // the vacuous filter, same convention as `where` / `having`.
      if (agg.filter && typeof agg.filter === 'object' && Object.keys(agg.filter).length > 0) {
        refusePerAggregationFilter(agg.alias ?? agg.field ?? '(unaliased)');
      }
      groupAccumulators[agg.alias] = buildAccumulator(agg);
    }

    pipeline.push({
      $group: {
        _id: Object.keys(groupId).length > 0 ? groupId : null,
        ...groupAccumulators,
      },
    });

    // $project stage to flatten _id fields back to top level
    if (groupTargets.length > 0) {
      const project: Document = { _id: 0 };
      for (const { outKey } of groupTargets) {
        project[outKey] = `$_id.${outKey}`;
      }
      for (const agg of opts.aggregations) {
        project[agg.alias] = 1;
      }
      pipeline.push({ $project: project });
    }
  }

  // $sort stage
  if (opts.orderBy && opts.orderBy.length > 0) {
    const sort: Document = {};
    for (const item of opts.orderBy) {
      sort[item.field] = item.order === 'desc' ? -1 : 1;
    }
    pipeline.push({ $sort: sort });
  }

  // $skip + $limit
  if (opts.offset !== undefined && opts.offset > 0) {
    pipeline.push({ $skip: opts.offset });
  }
  if (opts.limit !== undefined) {
    pipeline.push({ $limit: opts.limit });
  }

  return pipeline;
}

/**
 * [#11151] `path`, with a BOOLEAN rendered as the number it is worth — the
 * aggregand expression `$sum` and `$avg` consume on this face.
 *
 * ## What it is for
 *
 * MongoDB's `$sum` and `$avg` are ARITHMETIC accumulators and ignore every
 * non-numeric value, a boolean included. So a whole boolean column summed to
 * `$sum`'s identity `0` and averaged to `null` here, while `SUM(col)` /
 * `AVG(col)` answer `3` / `0.5` over the same 3-true/3-false rows on every SQL
 * dialect (#11635), `driver-memory` answers those numbers on both of its faces
 * (#11065), and objectql's in-memory fallback answers them too because its
 * `toNumber` is `Number(v)` and `Number(true) === 1`. A rate measure over a
 * flag column — an SLA-violation rate, a win rate — is the ordinary shape of
 * that query, and the two answers are not two spellings of one: a dashboard
 * tile bound to the measure renders a percentage under SQL and a blank here,
 * indistinguishable from "no matching rows". `sum`'s `0` is the worse half,
 * being a plausible number rather than a visible hole.
 *
 * The expression is the one #11065 landed on `driver-memory`'s analytics face
 * (`memory-analytics.ts`, `numericAggregandExpr`), reproduced rather than
 * imported: this driver shares no line of code with that one, and the shared
 * contract between them is the VALUES in `@objectstack/spec/data`, not a
 * helper.
 *
 * ## Why an EXPRESSION and not post-processing
 *
 * {@link postProcessAggregation} runs after the pipeline's own `$sort` and
 * `$limit` stages, so a measure left unresolved until then would be sorted as
 * whatever it was — and `order` over a `sum` or `avg` measure is an ordinary
 * analytics query. Keeping the rule inside the `$group` expression leaves every
 * later stage looking at the number it expects.
 *
 * ## Why it IS applied to `min` / `max` as well — the #11152 ruling
 *
 * `$min` / `$max` are ORDER STATISTICS over BSON canonical comparison order:
 * bare, they rank booleans and return a MEMBER of the input domain
 * (`false` / `true`), which is what #11249 ruled (maintainer 2026-08-23) and
 * what this face answered between #11151's fix and #11152. **#11152 superseded
 * that** (maintainer 2026-08-28, ruling verbatim on that card's record:
 * 「12745 A回，其他同意。」): booleans aggregate as NUMBERS on every face,
 * with NO per-aggregate exception — `min` / `max` over a boolean answer
 * `0` / `1`, the same numeric domain `sum` / `avg` answer in, on this face
 * and on every other. So the `min` / `max` arms wrap the same coercion:
 * booleans rank as the numbers they are worth, and every other type reaches
 * `$min` / `$max` exactly as before ($cond's else branch is the bare path).
 * Null and missing still vanish under the accumulators' own rule, so the
 * empty window still answers `null`, never a manufactured `0`.
 *
 * ## The narrowness is deliberate
 *
 * Only `bool` is rewritten. Null, missing and a non-numeric string reach the
 * accumulator exactly as before and are ignored by it exactly as before.
 * Coercing wider would mean adopting `toNumber`'s other half, which maps a
 * non-numeric string to `0` and so averages garbage as zero rather than
 * excluding it — a separate question from this one.
 */
function numericAggregandExpr(path: string): Document {
  return { $cond: [{ $eq: [{ $type: path }, 'bool'] }, { $cond: [path, 1, 0] }, path] };
}

/**
 * [#13075] `array_agg` / `string_agg` — names the Query Protocol RETIRED.
 *
 * Both left `AggregationFunction` at #6188 under ADR-0049 enforce-or-remove: no
 * SQL backend ever compiled either, and `string_agg` never had one shape to
 * lower to (the delimiter is a second argument in PostgreSQL, a `SEPARATOR`
 * clause in MySQL and a differently-named function in SQL Server). This face
 * kept lowering both anyway, so ONE query answered `400` on `driver-sql` and
 * `driver-turso` and a `$push` array here — the local/remote fork #5907 exists
 * to prevent, one vocabulary later.
 *
 * ## Why 400 and not 501 — the #5907 classification
 *
 * `driver-sql` sorts every refused aggregate into two classes and these two are
 * class 1: `refuseAggregateFunction` asks whether the spec still DECLARES the
 * name, and answers `INVALID_QUERY`/400 when it does not. "The protocol has no
 * such function" is a different fact from "this backend cannot lower it"
 * (`NOT_IMPLEMENTED`/501, the class {@link refusePerAggregationFilter} and
 * {@link refuseDateBucketedGroupBy} answer in) and deserves the different
 * answer. `driver-turso`'s `RemoteTransport` carries the same note verbatim.
 * So this refusal is answer-for-answer parity with both SQL faces.
 *
 * ## Why these two are NAMED here rather than left to the `default` arm
 *
 * `objectql`'s in-memory fallback deleted its arms for these two outright at
 * #6188 and let them fall through, which it could do safely because its switch
 * is over the ENUM TYPE — `case 'array_agg'` there does not type-check, which
 * is exactly why that face could not keep them by accident and this one could.
 * `AggregationInput.function` is a bare `string` (the driver's own `aggregate`
 * reads aggregations through an `any` cast), so the arms here compiled fine and
 * survived the retirement unnoticed.
 *
 * Falling through is ALSO not currently safe here: this builder's `default` arm
 * answers `{ $sum: … }`, so deleting these two arms without naming them would
 * turn a visibly-wrong ARRAY into an arithmetically PLAUSIBLE NUMBER — strictly
 * the worse failure, and the very defect #12818 is fixing in that arm. Naming
 * them is correct whichever order the two land in: before #12818's fix it is
 * the only thing standing between these names and a silent sum, and after it
 * the two agree on the answer while this arm keeps telling a caller that the
 * name was REMOVED rather than merely unrecognised — the same distinction
 * `AggregationFunction`'s own error map draws, and for the same reason (telling
 * the author of `arry_agg` that their value "was removed" would misinform).
 *
 * The prescription itself is deliberately NOT restated here. It lives once, on
 * the enum's error map in `@objectstack/spec`, where the parse door hands it to
 * every caller who arrives through a spec-valid request; a copy in this file
 * would be a second wording of one vocabulary with nothing keeping the two in
 * step. This message names where it is and what to do instead in one line.
 */
function refuseRetiredAggregateFunction(func: string): never {
  const err = new Error(
    `Aggregate function "${func}" was REMOVED from @objectstack/spec `
    + `AggregationFunction at #6188 (ADR-0049 enforce-or-remove) and is not lowered by this `
    + `backend (driver-mongodb). Declared now: ${AggregationFunction.options.join(', ')}. `
    + `This answers INVALID_QUERY/400 rather than NOT_IMPLEMENTED/501 because the protocol no `
    + `longer has this name at all, which is a different fact from a capability gap in the `
    + `backend (#5907) — the same answer \`driver-sql\` and \`driver-turso\` give it. There is no `
    + `replacement in the query vocabulary: read the rows with an ordinary \`fields\` query and `
    + `shape them in the caller, or model the roll-up as a stored field. Parsing the query `
    + `through AggregationNodeSchema reports this with the full retirement prescription.`,
  ) as Error & { code?: string; status?: number };
  err.code = StandardErrorCode.enum.INVALID_QUERY;
  err.status = 400;
  throw err;
}

/**
 * Build a single MongoDB accumulator expression from an aggregation descriptor.
 */
function buildAccumulator(agg: AggregationInput): Document {
  const fieldRef = agg.field ? `$${agg.field}` : null;

  switch (agg.function) {
    case 'count':
      // [#6814] `count(*)` counts ROWS; `count(col)` counts NON-NULL VALUES of
      // that column — what `COUNT(col)` does on every SQL dialect, what the
      // in-memory fallback does, and what `AGGREGATION_CASES` says (4 over
      // `AGGREGATION_ROWS`, beside `count(*)`'s 6 and `count_distinct`'s 2:
      // three different numbers over one column, on purpose). This arm ignored
      // `field` entirely and answered the row count for both spellings, so
      // `count(stage)` came back 6 here and 4 on the SQL family.
      //
      // `$ifNull` maps a MISSING field to null as well, so an absent key and an
      // explicit null are counted alike — the SQL reading, where an absent
      // value is NULL and there is no third state.
      return fieldRef === null
        ? { $sum: 1 }
        : { $sum: { $cond: [{ $eq: [{ $ifNull: [fieldRef, null] }, null] }, 0, 1] } };

    // [#11151/#11152] All four arithmetic/order aggregates coerce a BOOLEAN
    // aggregand; see {@link numericAggregandExpr} — `sum`/`avg` since #11151,
    // `min`/`max` since the #11152 ruling (2026-08-28) pinned booleans as
    // numbers on every face with no per-aggregate exception.
    case 'sum':
      return { $sum: fieldRef === null ? 0 : numericAggregandExpr(fieldRef) };

    case 'avg':
      return { $avg: fieldRef === null ? 0 : numericAggregandExpr(fieldRef) };

    case 'min':
      return { $min: fieldRef === null ? 0 : numericAggregandExpr(fieldRef) };

    case 'max':
      return { $max: fieldRef === null ? 0 : numericAggregandExpr(fieldRef) };

    case 'count_distinct':
      // Collect the distinct values here; {@link postProcessAggregation} sizes
      // the set, EXCLUDING null — see the note there for why the exclusion is
      // on that side rather than in this expression.
      return { $addToSet: fieldRef ?? null };

    // [#13075] REFUSED, where this face used to LOWER both: `array_agg` to a
    // `$push` and `string_agg` to a `$push` plus a join in
    // {@link postProcessAggregation}. Both names left `AggregationFunction` at
    // #6188; see {@link refuseRetiredAggregateFunction} for why they are named
    // here rather than left to fall through.
    case 'array_agg':
    case 'string_agg':
      refuseRetiredAggregateFunction(agg.function);

    default:
      // [#12818] REFUSED, where this arm used to `return { $sum: fieldRef ?? 0 }`.
      //
      // Any name this switch does not lower — a typo, a function added to the
      // contract but not to this file, an unnarrowed `method` arriving from
      // `StrategyContext.executeAggregate` (#12776) — was answered as a SUM of
      // that column, under the alias the caller asked for. No error, no
      // envelope, no log. It is the worst available answer precisely because a
      // sum of a numeric column is arithmetically plausible: a dashboard tile
      // renders it without complaint, so nothing downstream can notice that the
      // function it asked for was never run. The `"[object Object]"` group id
      // (#6850) and the null-carrying `count_distinct` (#6814) are this file's
      // earlier members of the same family, and both emitted well-formed
      // pipelines too.
      //
      // The refusal is also what makes the rest of this file consistent with
      // itself: one seam over, a `groupBy` entry carrying a granularity this
      // driver cannot bucket is refused rather than grouped by the raw instant
      // ({@link refuseDateBucketedGroupBy}), and a per-aggregation `filter` it
      // cannot lower is refused rather than accumulated unfiltered
      // ({@link refusePerAggregationFilter}). Aggregation function and groupBy
      // entry are the two halves of one lowering; they no longer disagree about
      // what to do with a shape this driver does not model.
      //
      // Reached before anything is sent to the server — `buildAggregationPipeline`
      // throws while assembling stages into a local array, so no partial
      // pipeline executes.
      return refuseAggregateFunction(agg.function);
  }
}

/**
 * Post-process aggregation results.
 *
 * Handles count_distinct conversion ($addToSet -> count).
 *
 * ## [#13075] The `string_agg` join is GONE
 *
 * This function also joined a `string_agg` alias's `$push` array into a
 * delimited string. `string_agg` left `AggregationFunction` at #6188, and
 * {@link buildAccumulator} now refuses the name outright, so no pipeline this
 * builder emits can produce the array that limb existed to reshape — it was
 * reachable only for a caller hand-feeding `postProcessAggregation` a result
 * set the builder could not have built. Deleted rather than left unreachable,
 * the reason `objectql`'s in-memory fallback gives for the same deletion: dead
 * arms are how a retired vocabulary comes back by accident.
 *
 * ## [#6814] Why the null exclusion is HERE
 *
 * `count_distinct` is distinct NON-NULL values of the column — what
 * `COUNT(DISTINCT col)` computes on SQLite, PostgreSQL and MySQL alike, what
 * `in-memory-aggregation.ts` computes (`new Set(values.filter(v => v != null)).size`),
 * and what `AGGREGATION_CASES` says (2 over `AGGREGATION_ROWS`). `$addToSet`
 * adds an explicit `null` to the set, so sizing the array as it arrived answered
 * one HIGHER on any nullable column — 3 where the standard says 2. (`$addToSet`
 * on a MISSING field adds nothing, so the divergence showed only for an
 * explicitly-null value, which is exactly what a nullable column produces.)
 *
 * The two server-side spellings the finding sketched were measured against this
 * one and not taken:
 *
 * - **`$ne: null` before the `$addToSet`** — as a `$match` it drops the row from
 *   the WHOLE pipeline, so a `count(*)` or `sum()` sharing it would silently
 *   lose the null rows too. Correct only for a pipeline carrying nothing else,
 *   which is not a shape this builder can assume.
 * - **`$size` of a `$setDifference` against `[null]`** — sound, and it would
 *   size server-side rather than shipping the array; it needs a `$project` stage
 *   this builder does not emit when there is no `groupBy`, so it is a shape
 *   change to the pipeline that no suite here can execute (the real-mongod
 *   suites are opt-in since #5517). Worth doing when this cell gains a live
 *   half; it would make this function's `Array.isArray` guard fall through
 *   harmlessly on the already-sized value.
 *
 * Excluding it here is exact, needs no server semantics to be true, and is
 * pinned directly by `mongodb-aggregation-translation.test.ts`.
 */
export function postProcessAggregation(
  results: Document[],
  aggregations: AggregationInput[],
): Document[] {
  const countDistinctFields = aggregations
    .filter((a) => a.function === 'count_distinct')
    .map((a) => a.alias);

  if (countDistinctFields.length === 0) {
    return results;
  }

  return results.map((row) => {
    const processed = { ...row };
    for (const field of countDistinctFields) {
      if (Array.isArray(processed[field])) {
        // `!= null` on purpose: it takes `undefined` with it, which is what a
        // set built from a field some documents do not carry can hold.
        processed[field] = processed[field].filter((v: unknown) => v != null).length;
      }
    }
    return processed;
  });
}
