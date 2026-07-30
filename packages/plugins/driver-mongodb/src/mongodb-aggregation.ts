// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * MongoDB Aggregation Pipeline Builder
 *
 * Translates ObjectStack QueryAST aggregations + groupBy into
 * MongoDB aggregation pipeline stages ($match, $group, $sort, $project).
 */

import type { Document } from 'mongodb';
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
  groupBy?: string[];
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

  // $group stage
  if (opts.aggregations && opts.aggregations.length > 0) {
    const groupId: Document = {};
    const groupAccumulators: Document = {};

    // Build _id from groupBy fields
    if (opts.groupBy && opts.groupBy.length > 0) {
      for (const field of opts.groupBy) {
        groupId[field] = `$${field}`;
      }
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
    if (opts.groupBy && opts.groupBy.length > 0) {
      const project: Document = { _id: 0 };
      for (const field of opts.groupBy) {
        project[field] = `$_id.${field}`;
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
      return { $sum: 1 };

    case 'sum':
      return { $sum: fieldRef ?? 0 };

    case 'avg':
      return { $avg: fieldRef ?? 0 };

    case 'min':
      return { $min: fieldRef ?? 0 };

    case 'max':
      return { $max: fieldRef ?? 0 };

    case 'count_distinct':
      // Use $addToSet to collect unique values; a subsequent $project
      // can use $size to get the count. We store the set here.
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
        processed[field] = processed[field].length;
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
