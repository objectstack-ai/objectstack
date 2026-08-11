// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * MongoDB Aggregation Pipeline Builder
 *
 * Translates ObjectStack QueryAST aggregations + groupBy into
 * MongoDB aggregation pipeline stages ($match, $group, $sort, $project).
 */

import type { Document } from 'mongodb';
import { StandardErrorCode } from '@objectstack/spec/api';
import type { DateGranularityValue, GroupByNode } from '@objectstack/spec/data';
import { translateFilter } from './mongodb-filter.js';
import type { TemporalFieldKindResolver } from './mongodb-temporal.js';

/**
 * Aggregation function descriptor from QueryAST.
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

    case 'sum':
      return { $sum: fieldRef ?? 0 };

    case 'avg':
      return { $avg: fieldRef ?? 0 };

    case 'min':
      return { $min: fieldRef ?? 0 };

    case 'max':
      return { $max: fieldRef ?? 0 };

    case 'count_distinct':
      // Collect the distinct values here; {@link postProcessAggregation} sizes
      // the set, EXCLUDING null — see the note there for why the exclusion is
      // on that side rather than in this expression.
      return { $addToSet: fieldRef ?? null };

    case 'array_agg':
      return { $push: fieldRef ?? '$$ROOT' };

    case 'string_agg':
      // Collect into array; caller can post-process with $reduce
      return { $push: fieldRef ?? '' };

    default:
      return { $sum: fieldRef ?? 0 };
  }
}

/**
 * Post-process aggregation results.
 *
 * Handles count_distinct conversion ($addToSet → count) and
 * string_agg conversion ($push → joined string).
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

  const stringAggFields = aggregations
    .filter((a) => a.function === 'string_agg')
    .map((a) => a.alias);

  if (countDistinctFields.length === 0 && stringAggFields.length === 0) {
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
    for (const field of stringAggFields) {
      if (Array.isArray(processed[field])) {
        processed[field] = processed[field].join(', ');
      }
    }
    return processed;
  });
}
