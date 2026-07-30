// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { z } from 'zod';

// ============================================================================
// Shared Enumerations
// ============================================================================

import { lazySchema } from './lazy-schema';

// `AggregationFunctionEnum` lived here, claiming in its own doc comment to be
// "used across query, data-engine, analytics, field". It was used by nothing —
// no importer in this repo, objectui, or cloud — while `AggregationFunction`
// (`data/query.zod.ts`) is the vocabulary the query engine, dataset compiler and
// native-SQL strategy all gate on. The two even disagreed: this one had
// percentile/median/stddev/variance, that one has array_agg/string_agg. Removed
// rather than reconciled, because a second name for one concept is how the
// vocabularies drifted apart in the first place. objectui#2945.

/** Sort direction used across query, data-engine, analytics */
export const SortDirectionEnum = z.enum(['asc', 'desc'])
  .describe('Sort order direction');
export type SortDirection = z.infer<typeof SortDirectionEnum>;

/** Reusable sort item — field + direction pair used across views, data sources, filters */
export const SortItemSchema = lazySchema(() => z.object({
  field: z.string().describe('Field name to sort by'),
  order: SortDirectionEnum.describe('Sort direction'),
}).describe('Sort field and direction pair'));
export type SortItem = z.infer<typeof SortItemSchema>;

/** CRUD mutation events used across hook, validation, object CDC */
export const MutationEventEnum = z.enum([
  'insert', 'update', 'delete', 'upsert',
]).describe('Data mutation event types');
export type MutationEvent = z.infer<typeof MutationEventEnum>;

/** Database isolation levels — unified format */
export const IsolationLevelEnum = z.enum([
  'read_uncommitted', 'read_committed', 'repeatable_read', 'serializable', 'snapshot',
]).describe('Transaction isolation levels (snake_case standard)');
export type IsolationLevel = z.infer<typeof IsolationLevelEnum>;

/** Cache eviction strategies */
export const CacheStrategyEnum = z.enum(['lru', 'lfu', 'ttl', 'fifo'])
  .describe('Cache eviction strategy');
export type CacheStrategy = z.infer<typeof CacheStrategyEnum>;
