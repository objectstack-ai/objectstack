// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { z } from 'zod';

/**
 * Shared HTTP Schemas
 * 
 * Common HTTP-related schemas used across API and System protocols.
 * These schemas ensure consistency across different parts of the stack.
 */

// ==========================================
// Basic HTTP Types
// ==========================================

/**
 * HTTP Method Enum — the full method vocabulary of the routing contract.
 *
 * This is the one `api/*` routes are declared with (`ApiEndpointSchema.method`,
 * `RestServerConfig` routes, `plugin-rest-api.zod.ts`, `RouterConfig`), so it is
 * the online contract and it keeps the bare published name `shared/HttpMethod`.
 *
 * [#5832] It shares this file with a NARROWER five-method enum, and until #5832
 * the two published under the same def key: `schemaNameFromExportKey` strips the
 * `Schema` suffix, so `HttpMethod` and `HttpMethodSchema` both resolved to
 * `shared/HttpMethod` and `build-schemas.ts` wrote the second over the first.
 * `json-schema/shared/HttpMethod.json`, the bundled `$defs['shared/HttpMethod']`
 * and `references/shared/http#httpmethod` therefore described the FIVE-value
 * subset, so every downstream that validates against the published schema —
 * IDE completion, codegen, an AI metadata author — was told `HEAD` and
 * `OPTIONS` are illegal on routes that accept them. The subset now publishes
 * under its own name (`HttpMethodSubset`), and `findDefKeyCollisions()` in
 * `scripts/lib/def-key-collisions.ts` fails the build on the next collision of
 * this shape.
 */
import { lazySchema } from './lazy-schema';
export const HttpMethod = z.enum([
  'GET',
  'POST',
  'PUT',
  'DELETE',
  'PATCH',
  'HEAD',
  'OPTIONS'
]).describe('HTTP method — the full routing vocabulary (`api/*` endpoints, router and REST-server routes). The narrower `HttpMethodSubset` is what view data sources may request.');

export type HttpMethod = z.infer<typeof HttpMethod>;

/**
 * HTTP Method Subset — the five methods a VIEW DATA SOURCE may request.
 *
 * A strict subset of `HttpMethod`: no `HEAD`, no `OPTIONS`. Consumed by
 * `HttpRequestSchema.method` (and through it by `ui/view.zod.ts`'s API data
 * sources), which is the only place the narrowing is enforced.
 *
 * [#5832] Named `HttpMethodSchema` until #5832, which published it under
 * `shared/HttpMethod` — the SAME def key as the seven-value enum above, last
 * writer winning. The rename follows #4684's `RateLimitConfig` precedent and
 * ADR-0112 D9's rule that one name means one thing; the type alias moved with
 * it (`HttpMethodType` -> `HttpMethodSubset`) so the published def, the schema
 * const and the type alias are the one name this package's `<Name>Schema` /
 * `<Name>` convention (and `lib/docs-import-surface.ts`) require them to be.
 */
export const HttpMethodSubsetSchema = lazySchema(() => z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE'])
  .describe('HTTP methods a view data source may request — the subset of `HttpMethod` without `HEAD`/`OPTIONS`.'));

export type HttpMethodSubset = z.infer<typeof HttpMethodSubsetSchema>;

/**
 * HTTP Request Configuration Schema
 * Defines a complete HTTP request configuration used by API data providers.
 * Migrated from ui/view.zod.ts to shared for reuse across modules.
 */
export const HttpRequestSchema = lazySchema(() => z.object({
  url: z.string().describe('API endpoint URL'),
  method: HttpMethodSubsetSchema.optional().default('GET').describe('HTTP method'),
  headers: z.record(z.string(), z.string()).optional().describe('Custom HTTP headers'),
  params: z.record(z.string(), z.unknown()).optional().describe('Query parameters'),
  body: z.unknown().optional().describe('Request body for POST/PUT/PATCH'),
}));

export type HttpRequest = z.infer<typeof HttpRequestSchema>;
/** Post-parse shape of {@link HttpRequest} — defaults applied, transforms run (ADR-0122). */
export type HttpRequestParsed = z.infer<typeof HttpRequestSchema>;

// ==========================================
// CORS Configuration
// ==========================================

/**
 * CORS Configuration Schema
 * Cross-Origin Resource Sharing configuration
 * 
 * Used by:
 * - api/router.zod.ts (RouterConfigSchema)
 *
 * (`system/http-server.zod.ts` embedded this as `HttpServerConfig.cors` until
 * #4938 retired that shape. CORS is owned by the transport adapter and
 * configured by OS_CORS_ORIGIN / OS_CORS_CREDENTIALS / OS_CORS_MAX_AGE; this
 * schema is the registered first candidate for a future `server.cors` key,
 * which arrives WITH its executor or not at all.)
 *
 * @example
 * {
 *   "enabled": true,
 *   "origins": ["http://localhost:3000", "https://app.example.com"],
 *   "methods": ["GET", "POST", "PUT", "DELETE"],
 *   "credentials": true,
 *   "maxAge": 86400
 * }
 */
export const CorsConfigSchema = lazySchema(() => z.object({
  /**
   * Enable CORS
   */
  enabled: z.boolean().default(true).describe('Enable CORS'),
  
  /**
   * Allowed origins (* for all)
   */
  origins: z.union([
    z.string(),
    z.array(z.string())
  ]).default('*').describe('Allowed origins (* for all)'),
  
  /**
   * Allowed HTTP methods
   */
  methods: z.array(HttpMethod).optional().describe('Allowed HTTP methods'),
  
  /**
   * Allow credentials (cookies, authorization headers)
   */
  credentials: z.boolean().default(false).describe('Allow credentials (cookies, authorization headers)'),
  
  /**
   * Preflight cache duration in seconds
   */
  maxAge: z.number().int().optional().describe('Preflight cache duration in seconds'),
}));

export type CorsConfig = z.infer<typeof CorsConfigSchema>;
/** Post-parse shape of {@link CorsConfig} — defaults applied, transforms run (ADR-0122). */
export type CorsConfigParsed = z.infer<typeof CorsConfigSchema>;

// ==========================================
// Rate Limiting
// ==========================================

/**
 * Rate Limit Configuration Schema
 * 
 * Used by:
 * - api/endpoint.zod.ts (ApiEndpointSchema)
 * - system/stack-server.zod.ts (ServerRateLimitConfigSchema — this shape reused
 *   verbatim and closed against unknown keys; the LIVE inbound token bucket)
 *
 * (`system/http-server.zod.ts` embedded this as `HttpServerConfig.security
 * .rateLimit` until #4938 retired that shape; the budget itself was not lost —
 * #5006 activated it on the narrow `server:` block.)
 *
 * @example
 * {
 *   "enabled": true,
 *   "windowMs": 60000,
 *   "maxRequests": 100
 * }
 */
export const RateLimitConfigSchema = lazySchema(() => z.object({
  /**
   * Enable rate limiting
   */
  enabled: z.boolean().default(false).describe('Enable rate limiting'),
  
  /**
   * Time window in milliseconds
   */
  windowMs: z.number().int().default(60000).describe('Time window in milliseconds'),
  
  /**
   * Max requests per window
   */
  maxRequests: z.number().int().default(100).describe('Max requests per window'),
}));

export type RateLimitConfig = z.infer<typeof RateLimitConfigSchema>;
/** Post-parse shape of {@link RateLimitConfig} — defaults applied, transforms run (ADR-0122). */
export type RateLimitConfigParsed = z.infer<typeof RateLimitConfigSchema>;

// ==========================================
// Static File Serving
// ==========================================

/**
 * Static Mount Configuration Schema
 * Configuration for serving static files
 * 
 * Used by:
 * - api/router.zod.ts (RouterConfigSchema — `staticMounts`)
 *
 * (`system/http-server.zod.ts` embedded this as `HttpServerConfig.static` until
 * #4938 retired that shape. Static mounts are configured on the transport
 * plugin's `staticMounts`.)
 *
 * @example
 * {
 *   "path": "/static",
 *   "directory": "./public",
 *   "cacheControl": "public, max-age=31536000"
 * }
 */
export const StaticMountSchema = lazySchema(() => z.object({
  /**
   * URL path to serve from
   */
  path: z.string().describe('URL path to serve from'),
  
  /**
   * Physical directory to serve
   */
  directory: z.string().describe('Physical directory to serve'),
  
  /**
   * Cache-Control header value
   */
  cacheControl: z.string().optional().describe('Cache-Control header value'),
}));

export type StaticMount = z.infer<typeof StaticMountSchema>;
