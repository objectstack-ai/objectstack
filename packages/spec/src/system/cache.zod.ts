// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { z } from 'zod';
import { CronExpressionInputSchema } from '../shared/expression.zod';

/**
 * @module system/cache
 *
 * Application-Level Cache Protocol
 *
 * Multi-tier caching strategy for application data.
 * Supports Memory, Redis, Memcached, and CDN.
 * 
 * ## Caching in ObjectStack
 * 
 * **Application Cache (`system/cache.zod.ts`) - This File**
 * - **Purpose**: Cache computed data, query results, aggregations
 * - **Technologies**: Redis, Memcached, in-memory LRU
 * - **Configuration**: TTL, eviction policies, cache warming
 * - **Use case**: Cache expensive database queries, computed values
 * - **Scope**: Application layer, server-side data storage
 * 
 * **HTTP Cache (`api/http-cache.zod.ts`)**
 * - **Purpose**: Cache API responses at HTTP protocol level
 * - **Technologies**: HTTP headers (ETag, Last-Modified, Cache-Control), CDN
 * - **Configuration**: Cache-Control headers, validation tokens
 * - **Use case**: Reduce API response time for repeated metadata requests
 * - **Scope**: HTTP layer, client-server communication
 * 
 * @see ../../api/http-cache.zod.ts for HTTP-level caching
 */
import { lazySchema } from '../shared/lazy-schema';

/**
 * Cache eviction strategy — the single declaration of the `CacheStrategy`
 * vocabulary (#4537). `shared/enums.zod.ts` carried a second, diverged copy
 * (`CacheStrategyEnum`, no importers anywhere) that was removed rather than
 * reconciled. `adaptive` ("dynamic strategy selection") was declared only on
 * this side and had zero producers in this repo, objectui and cloud — dropped
 * so the enum carries only the values both declarations ever agreed on.
 */
export const CacheStrategySchema = lazySchema(() => z.enum([
  'lru',          // Least Recently Used
  'lfu',          // Least Frequently Used
  'fifo',         // First In First Out
  'ttl',          // Time To Live only
]).describe('Cache eviction strategy'));

export type CacheStrategy = z.input<typeof CacheStrategySchema>;

export const CacheTierSchema = lazySchema(() => z.object({
  name: z.string().describe('Unique cache tier name'),
  type: z.enum(['memory', 'redis', 'memcached', 'cdn']).describe('Cache backend type'),
  maxSize: z.number().optional().describe('Max size in MB'),
  ttl: z.number().default(300).describe('Default TTL in seconds'),
  strategy: CacheStrategySchema.default('lru').describe('Eviction strategy'),
  warmup: z.boolean().default(false).describe('Pre-populate cache on startup'),
}).describe('Configuration for a single cache tier in the hierarchy'));

export type CacheTier = z.input<typeof CacheTierSchema>;
/** Post-parse shape of {@link CacheTier} — defaults applied, transforms run (ADR-0122). */
export type CacheTierParsed = z.infer<typeof CacheTierSchema>;

export const CacheInvalidationSchema = lazySchema(() => z.object({
  trigger: z.enum(['create', 'update', 'delete', 'manual']).describe('Event that triggers invalidation'),
  scope: z.enum(['key', 'pattern', 'tag', 'all']).describe('Invalidation scope'),
  pattern: z.string().optional().describe('Key pattern for pattern-based invalidation'),
  tags: z.array(z.string()).optional().describe('Cache tags to invalidate'),
}).describe('Rule defining when and how cached entries are invalidated'));

export type CacheInvalidation = z.input<typeof CacheInvalidationSchema>;

export const CacheConfigSchema = lazySchema(() => z.object({
  enabled: z.boolean().default(false).describe('Enable application-level caching'),
  tiers: z.array(CacheTierSchema).describe('Ordered cache tier hierarchy'),
  invalidation: z.array(CacheInvalidationSchema).describe('Cache invalidation rules'),
  prefetch: z.boolean().default(false).describe('Enable cache prefetching'),
  compression: z.boolean().default(false).describe('Enable data compression in cache'),
  encryption: z.boolean().default(false).describe('Enable encryption for cached data'),
}).describe('Top-level application cache configuration'));

export type CacheConfig = z.input<typeof CacheConfigSchema>;
/** Post-parse shape of {@link CacheConfig} — defaults applied, transforms run (ADR-0122). */
export type CacheConfigParsed = z.infer<typeof CacheConfigSchema>;

/**
 * Distributed Cache Consistency Schema
 *
 * Defines write strategies for distributed cache consistency.
 *
 * - **write_through**: Write to cache and backend simultaneously
 * - **write_behind**: Write to cache first, async persist to backend
 * - **write_around**: Write to backend only, cache on next read
 * - **refresh_ahead**: Proactively refresh expiring entries before TTL
 */
export const CacheConsistencySchema = lazySchema(() => z.enum([
  'write_through',
  'write_behind',
  'write_around',
  'refresh_ahead',
]).describe('Distributed cache write consistency strategy'));

export type CacheConsistency = z.input<typeof CacheConsistencySchema>;

/**
 * Cache Avalanche Prevention Schema
 *
 * Strategies to prevent cache stampede/avalanche when many keys expire simultaneously.
 *
 * @example
 * ```typescript
 * const prevention: CacheAvalanchePrevention = {
 *   jitterTtl: { enabled: true, maxJitterSeconds: 60 },
 *   circuitBreaker: { enabled: true, failureThreshold: 5, resetTimeout: 30 },
 *   lockout: { enabled: true, lockTimeoutMs: 5000 },
 * };
 * ```
 */
export const CacheAvalanchePreventionSchema = lazySchema(() => z.object({
  /** TTL jitter to stagger cache expiration */
  jitterTtl: z.object({
    enabled: z.boolean().default(false).describe('Add random jitter to TTL values'),
    maxJitterSeconds: z.number().default(60).describe('Maximum jitter added to TTL in seconds'),
  }).optional().describe('TTL jitter to prevent simultaneous expiration'),

  /** Circuit breaker to protect backend under cache pressure */
  circuitBreaker: z.object({
    enabled: z.boolean().default(false).describe('Enable circuit breaker for backend protection'),
    failureThreshold: z.number().default(5).describe('Failures before circuit opens'),
    resetTimeout: z.number().default(30).describe('Seconds before half-open state'),
  }).optional().describe('Circuit breaker for backend protection'),

  /** Cache lock to prevent thundering herd on key miss */
  lockout: z.object({
    enabled: z.boolean().default(false).describe('Enable cache locking for key regeneration'),
    lockTimeoutMs: z.number().default(5000).describe('Maximum lock wait time in milliseconds'),
  }).optional().describe('Lock-based stampede prevention'),
}).describe('Cache avalanche/stampede prevention configuration'));

export type CacheAvalanchePrevention = z.input<typeof CacheAvalanchePreventionSchema>;
/** Post-parse shape of {@link CacheAvalanchePrevention} — defaults applied, transforms run (ADR-0122). */
export type CacheAvalanchePreventionParsed = z.infer<typeof CacheAvalanchePreventionSchema>;

/**
 * Cache Warmup Strategy Schema
 *
 * Defines how cache is pre-populated on startup or after cache flush.
 */
export const CacheWarmupSchema = lazySchema(() => z.object({
  /** Enable cache warming */
  enabled: z.boolean().default(false).describe('Enable cache warmup'),
  /** Warmup strategy */
  strategy: z.enum(['eager', 'lazy', 'scheduled']).default('lazy')
    .describe('Warmup strategy: eager (at startup), lazy (on first access), scheduled (cron)'),
  /** Cron schedule for scheduled warmup */
  schedule: CronExpressionInputSchema.optional().describe('Cron expression for scheduled warmup'),
  /** Keys/patterns to warm up */
  patterns: z.array(z.string()).optional().describe('Key patterns to warm up (e.g., "user:*", "config:*")'),
  /** Maximum concurrent warmup operations */
  concurrency: z.number().default(10).describe('Maximum concurrent warmup operations'),
}).describe('Cache warmup strategy'));

export type CacheWarmup = z.input<typeof CacheWarmupSchema>;
/** Post-parse shape of {@link CacheWarmup} — defaults applied, transforms run (ADR-0122). */
export type CacheWarmupParsed = z.infer<typeof CacheWarmupSchema>;

/**
 * Distributed Cache Configuration Schema
 *
 * Extended cache configuration for distributed multi-node deployments.
 * Adds consistency strategies, avalanche prevention, and warmup policies.
 *
 * @example
 * ```typescript
 * const distributedCache: DistributedCacheConfig = {
 *   enabled: true,
 *   tiers: [
 *     { name: 'l1', type: 'memory', maxSize: 100, ttl: 60, strategy: 'lru' },
 *     { name: 'l2', type: 'redis', maxSize: 1000, ttl: 300, strategy: 'lru' },
 *   ],
 *   invalidation: [
 *     { trigger: 'update', scope: 'key' },
 *   ],
 *   consistency: 'write_through',
 *   avalanchePrevention: {
 *     jitterTtl: { enabled: true, maxJitterSeconds: 30 },
 *     circuitBreaker: { enabled: true, failureThreshold: 5 },
 *   },
 *   warmup: { enabled: true, strategy: 'eager', patterns: ['config:*'] },
 * };
 * ```
 */
export const DistributedCacheConfigSchema = lazySchema(() => CacheConfigSchema.extend({
  /** Distributed write consistency strategy */
  consistency: CacheConsistencySchema.optional().describe('Distributed cache consistency strategy'),
  /** Avalanche/stampede prevention settings */
  avalanchePrevention: CacheAvalanchePreventionSchema.optional()
    .describe('Cache avalanche and stampede prevention'),
  /** Cache warmup configuration */
  warmup: CacheWarmupSchema.optional().describe('Cache warmup strategy'),
}).describe('Distributed cache configuration with consistency and avalanche prevention'));

export type DistributedCacheConfig = z.input<typeof DistributedCacheConfigSchema>;
/** Post-parse shape of {@link DistributedCacheConfig} — defaults applied, transforms run (ADR-0122). */
export type DistributedCacheConfigParsed = z.infer<typeof DistributedCacheConfigSchema>;
