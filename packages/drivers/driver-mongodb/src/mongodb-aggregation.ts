// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * MongoDB Aggregation Pipeline Builder
 *
 * Translates ObjectStack QueryAST aggregations + groupBy into
 * MongoDB aggregation pipeline stages ($match, $group, $sort, $project).
 */

import type { Document } from 'mongodb';
import { StandardErrorCode } from '@objectstack/spec/api';
import type { GroupByNode } from '@objectstack/spec/data';
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
 * One `groupBy` entry after the declared union has been read: the field the
 * `$group._id` keys on, and the name the group value is PROJECTED under.
 *
 * [#6850] The two are separate because `GroupByNodeSchema.alias` renames the
 * projection without moving the grouping — the rule #6401 converged the three
 * SQL faces onto (`alias ?? field`), and the one `in-memory-aggregation.ts` has
 * always applied.
 */
interface GroupByTarget {
  field: string;
  outKey: string;
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
    if (typeof node === 'string') return { field: node, outKey: node };
    if (node && typeof node === 'object' && typeof node.field === 'string' && node.field !== '') {
      // A DATE-BUCKETED node has no lowering here — refuse it rather than group
      // by the raw instant, which would answer one bucket per distinct
      // timestamp and look like a working query.
      if (node.dateGranularity) refuseDateBucketedGroupBy(node.dateGranularity);
      return { field: node.field, outKey: node.alias ?? node.field };
    }
    throw malformedGroupByError(node);
  });
}

/**
 * [#6850] A `groupBy` entry asks for a date BUCKET — the twin of `driver-sql`'s
 * and `driver-turso`'s `refuseDateBucketedGroupBy`, first sentence for first
 * sentence, and the same NOT_IMPLEMENTED/501 class for the same reason (#5907,
 * #6212, ADR-0112): `DateGranularity` declares the name, this backend emits no
 * bucket expression for it, so it is a capability gap in the backend rather than
 * a mistake in the query.
 *
 * This driver buckets NOTHING natively, which is exactly what it publishes:
 * `MongoDBDriver.supports` carries no `queryDateGranularity` key at all (see the
 * comment on that field), so the engine buckets every granularity in memory and
 * never pushes a bucketed item down here. The refusal therefore fires only for a
 * caller that went around the capability bit and reached the builder directly,
 * which is the caller this message is written for.
 *
 * A native lowering is buildable — MongoDB has `$dateTrunc` — and this refusal
 * is not a verdict that it cannot be. It is not a one-liner either: the engine's
 * fallback produces LABELS (`'2026-01'`, `'2026-Q1'`, ISO `'2026-W03'` — see
 * `bucketDateValue` and `SqlDriver.buildDateBucketExpr`), so a pushdown here has
 * to emit those strings, publish `supports.queryDateGranularity`, and be held to
 * `date-bucket-parity.test.ts`. Until then, refusing is what keeps a declared
 * key from being silently ignored.
 */
function refuseDateBucketedGroupBy(granularity: string): never {
  const err = new Error(
    `Date bucketing by '${granularity}' is not supported by this backend. `
    + `Bucketed here: none (driver-mongodb). `
    + `The query is spelled correctly and @objectstack/spec DateGranularity declares it — this is `
    + `a capability gap in the backend, not a mistake in the query, which is why it answers `
    + `NOT_IMPLEMENTED/501 rather than a 400. A driver publishes the granularities it buckets `
    + `natively as \`supports.queryDateGranularity\`; the engine reads that record and buckets `
    + `in memory for every granularity absent from it, which is always correct (#6212). This `
    + `driver publishes none, so a bucketed groupBy reaches here only when a caller goes around `
    + `the engine (#6850).`,
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
    // value the FIELD path, so an alias renames the output column without
    // moving the grouping — `alias ?? field`, the #6401 rule.
    for (const { field, outKey } of groupTargets) {
      groupId[outKey] = `$${field}`;
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
