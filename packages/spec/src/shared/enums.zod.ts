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
// percentile/median/stddev/variance, that one carried array_agg/string_agg
// (themselves retired at #6188, ADR-0049 — no SQL backend compiled them).
// Removed rather than reconciled, because a second name for one concept is how
// the vocabularies drifted apart in the first place. objectui#2945.

/** Sort direction used across query, data-engine, analytics */
export const SortDirectionEnum = z.enum(['asc', 'desc'])
  .describe('Sort order direction');
export type SortDirection = z.input<typeof SortDirectionEnum>;

/** Reusable sort item — field + direction pair used across views, data sources, filters */
export const SortItemSchema = lazySchema(() => z.object({
  field: z.string().describe('Field name to sort by'),
  order: SortDirectionEnum.describe('Sort direction'),
}).describe('Sort field and direction pair'));
export type SortItem = z.input<typeof SortItemSchema>;

/** CRUD mutation events used across hook, validation, object CDC */
export const MutationEventEnum = z.enum([
  'insert', 'update', 'delete', 'upsert',
]).describe('Data mutation event types');
export type MutationEvent = z.input<typeof MutationEventEnum>;

/** Database isolation levels — unified format */
export const IsolationLevelEnum = z.enum([
  'read_uncommitted', 'read_committed', 'repeatable_read', 'serializable', 'snapshot',
]).describe('Transaction isolation levels (snake_case standard)');
export type IsolationLevel = z.input<typeof IsolationLevelEnum>;

// `CacheStrategyEnum` lived here as a second declaration of the cache eviction
// vocabulary next to `CacheStrategySchema` (`system/cache.zod.ts`) — same
// `CacheStrategy` type name on two entry points, diverged on the values (this
// one lacked `adaptive`). It had zero importers in this repo, objectui, or
// cloud, while the system schema is the one `CacheTier.strategy` gates on.
// Removed rather than reconciled, for the same reason as
// `AggregationFunctionEnum` above: a second name for one concept is how the
// vocabularies drifted apart in the first place. #4537.
