// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { z } from 'zod';

/**
 * HTTP Metadata Cache Protocol
 * 
 * Implements efficient HTTP-level metadata caching with ETag support.
 * Implements P0 requirement for ObjectStack kernel.
 * 
 * ## Caching in ObjectStack
 * 
 * **HTTP Cache (`api/http-cache.zod.ts`) - This File**
 * - **Purpose**: Cache API responses at HTTP protocol level
 * - **Technologies**: HTTP headers (ETag, Last-Modified, Cache-Control), CDN
 * - **Configuration**: Cache-Control headers, validation tokens
 * - **Use case**: Reduce API response time for repeated metadata requests
 * - **Scope**: HTTP layer, client-server communication
 * 
 * **Application Cache (`system/cache.zod.ts`)**
 * - **Purpose**: Cache computed data, query results, aggregations
 * - **Technologies**: Redis, Memcached, in-memory LRU
 * - **Configuration**: TTL, eviction policies, cache warming
 * - **Use case**: Cache expensive database queries, computed values
 * - **Scope**: Application layer, server-side data storage
 * 
 * ## Features
 * - ETag-based conditional requests (HTTP 304 Not Modified)
 * - Cache-Control directives
 * - Metadata versioning
 * - Selective cache invalidation
 * 
 * Industry alignment: HTTP Caching (RFC 7234), Salesforce Metadata API
 * 
 * @see ../../system/cache.zod.ts for application-level caching
 */

// ==========================================
// Cache Control Headers
// ==========================================

/**
 * Cache Control Directive Enum
 * Standard HTTP cache control directives
 */
import { lazySchema } from '../shared/lazy-schema';
export const CacheDirective = z.enum([
  'public',           // Cacheable by any cache
  'private',          // Cacheable only by user-agent
  'no-cache',         // Must revalidate with server
  'no-store',         // Never cache
  'must-revalidate',  // Must revalidate stale responses
  'max-age',          // Maximum cache age in seconds
]);

export type CacheDirective = z.input<typeof CacheDirective>;

/**
 * Cache Control Schema
 * HTTP cache control configuration
 * 
 * @example
 * {
 *   "directives": ["public", "max-age"],
 *   "maxAge": 3600,
 *   "staleWhileRevalidate": 86400
 * }
 */
export const CacheControlSchema = lazySchema(() => z.object({
  directives: z.array(CacheDirective).describe('Cache control directives'),
  maxAge: z.number().optional().describe('Maximum cache age in seconds'),
  staleWhileRevalidate: z.number().optional().describe('Allow serving stale content while revalidating (seconds)'),
  staleIfError: z.number().optional().describe('Allow serving stale content on error (seconds)'),
}));

export type CacheControl = z.input<typeof CacheControlSchema>;

// ==========================================
// ETag Support
// ==========================================

/**
 * ETag Schema
 * Entity tag for cache validation
 * 
 * ETags can be:
 * - Strong: Exact match required (e.g., "686897696a7c876b7e")
 * - Weak: Semantic equivalence (e.g., W/"686897696a7c876b7e")
 */
export const ETagSchema = lazySchema(() => z.object({
  value: z.string().describe('ETag value (hash or version identifier)'),
  weak: z.boolean().optional().default(false).describe('Whether this is a weak ETag'),
}));

export type ETag = z.input<typeof ETagSchema>;
/** Post-parse shape of {@link ETag} — defaults applied, transforms run (ADR-0122). */
export type ETagParsed = z.infer<typeof ETagSchema>;

// ==========================================
// Metadata Cache Request
// ==========================================

/**
 * Metadata Cache Request Schema
 * Request with cache validation headers
 * 
 * @example
 * // GET /api/v1/metadata/object/account
 * // Headers:
 * // If-None-Match: "686897696a7c876b7e"
 * // If-Modified-Since: Wed, 21 Oct 2015 07:28:00 GMT
 */
export const MetadataCacheRequestSchema = lazySchema(() => z.object({
  ifNoneMatch: z.string().optional().describe('ETag value for conditional request (If-None-Match header)'),
  ifModifiedSince: z.string().datetime().optional().describe('Timestamp for conditional request (If-Modified-Since header)'),
  cacheControl: CacheControlSchema.optional().describe('Client cache control preferences'),
}));

export type MetadataCacheRequest = z.input<typeof MetadataCacheRequestSchema>;

// ==========================================
// Metadata Cache Response
// ==========================================

/**
 * Metadata Cache Response Schema
 * Response with cache control headers
 * 
 * @example Success Response (200 OK)
 * {
 *   "data": { "object": "account" },
 *   "etag": {
 *     "value": "686897696a7c876b7e",
 *     "weak": false
 *   },
 *   "lastModified": "2026-01-29T12:00:00Z",
 *   "cacheControl": {
 *     "directives": ["public", "max-age"],
 *     "maxAge": 3600
 *   }
 * }
 * 
 * @example Not Modified Response (304 Not Modified)
 * {
 *   "notModified": true,
 *   "etag": {
 *     "value": "686897696a7c876b7e"
 *   }
 * }
 */
export const MetadataCacheResponseSchema = lazySchema(() => z.object({
  data: z.unknown().optional().describe('Metadata payload (omitted for 304 Not Modified)'),
  etag: ETagSchema.optional().describe('ETag for this resource version'),
  lastModified: z.string().datetime().optional().describe('Last modification timestamp'),
  cacheControl: CacheControlSchema.optional().describe('Cache control directives'),
  notModified: z.boolean().optional().default(false).describe('True if resource has not been modified (304 response)'),
  version: z.string().optional().describe('Metadata version identifier'),
}));

export type MetadataCacheResponse = z.input<typeof MetadataCacheResponseSchema>;
/** Post-parse shape of {@link MetadataCacheResponse} — defaults applied, transforms run (ADR-0122). */
export type MetadataCacheResponseParsed = z.infer<typeof MetadataCacheResponseSchema>;

// ==========================================
// Metadata Cache Invalidation
// ==========================================

/**
 * Cache Invalidation Target Enum
 * Specifies what to invalidate
 */
export const CacheInvalidationTarget = z.enum([
  'all',              // Invalidate all cached metadata
  'object',           // Invalidate specific object metadata
  'field',            // Invalidate specific field metadata
  'permission',       // Invalidate permission metadata
  'layout',           // Invalidate layout metadata
  'custom',           // Custom invalidation pattern
]);

export type CacheInvalidationTarget = z.input<typeof CacheInvalidationTarget>;

/**
 * Cache Invalidation Request Schema
 * Request to invalidate cached metadata
 * 
 * @example
 * // POST /api/v1/metadata/cache/invalidate
 * {
 *   "target": "object",
 *   "identifiers": ["account", "contact"],
 *   "cascade": true
 * }
 */
export const CacheInvalidationRequestSchema = lazySchema(() => z.object({
  target: CacheInvalidationTarget.describe('What to invalidate'),
  identifiers: z.array(z.string()).optional().describe('Specific resources to invalidate (e.g., object names)'),
  cascade: z.boolean().optional().default(false).describe('If true, invalidate dependent resources'),
  pattern: z.string().optional().describe('Pattern for custom invalidation (supports wildcards)'),
}));

export type CacheInvalidationRequest = z.input<typeof CacheInvalidationRequestSchema>;
/** Post-parse shape of {@link CacheInvalidationRequest} — defaults applied, transforms run (ADR-0122). */
export type CacheInvalidationRequestParsed = z.infer<typeof CacheInvalidationRequestSchema>;

/**
 * Cache Invalidation Response Schema
 * Response for cache invalidation
 * 
 * @example
 * {
 *   "success": true,
 *   "invalidated": 5,
 *   "targets": ["account", "contact", "opportunity"]
 * }
 */
export const CacheInvalidationResponseSchema = lazySchema(() => z.object({
  success: z.boolean().describe('Whether invalidation succeeded'),
  invalidated: z.number().describe('Number of cache entries invalidated'),
  targets: z.array(z.string()).optional().describe('List of invalidated resources'),
}));

export type CacheInvalidationResponse = z.input<typeof CacheInvalidationResponseSchema>;

// ==========================================
// Metadata Cache API Methods
// ==========================================

/**
 * Metadata Cache API Client Interface
 * 
 * @example Usage
 * // Get metadata with cache support
 * const response = await client.meta.getCached('account', {
 *   ifNoneMatch: '"686897696a7c876b7e"'
 * });
 * 
 * if (response.notModified) {
 *   // Use cached version
 * } else {
 *   // Update cache with response.data
 *   cache.set('account', response.data, {
 *     etag: response.etag?.value,
 *     maxAge: response.cacheControl?.maxAge
 *   });
 * }
 */
export const MetadataCacheApi = {
  getCached: {
    input: MetadataCacheRequestSchema,
    output: MetadataCacheResponseSchema,
  },
  invalidate: {
    input: CacheInvalidationRequestSchema,
    output: CacheInvalidationResponseSchema,
  },
};
