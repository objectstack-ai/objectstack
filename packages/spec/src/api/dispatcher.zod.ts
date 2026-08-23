// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { z } from 'zod';
import { CoreServiceName, ServiceCriticalitySchema } from '../system/core-services.zod';

/**
 * # HttpDispatcher Protocol
 * 
 * Defines how the ObjectStack HttpDispatcher routes incoming API requests
 * to the correct kernel service based on URL prefix matching.
 * 
 * The dispatcher is the central routing component that:
 * 1. Matches incoming request URLs against registered route prefixes
 * 2. Delegates to the corresponding CoreService implementation
 * 3. Returns 503 Service Unavailable when a service is not registered
 * 4. Serves prefixes registered by the kernel services above. Plugins that need
 *    a code handler mount it imperatively on the `http.server` service (resolve
 *    it from the plugin context on `kernel:ready`), NOT through the manifest's
 *    `contributes.routes` key — nothing reads that key, so an entry there parses
 *    cleanly and serves nothing.
 * 
 * Architecture alignment:
 * - Kubernetes: API server aggregation layer
 * - Eclipse: Extension registry routing
 * - VS Code: Command palette routing
 */

// ============================================================================
// Route Definition
// ============================================================================

/**
 * Dispatcher Route Schema
 * Maps a URL prefix to a kernel service.
 * 
 * @example
 * {
 *   "prefix": "/api/v1/data",
 *   "service": "data",
 *   "authRequired": true,
 *   "criticality": "required"
 * }
 */
export const DispatcherRouteSchema = z.object({
  /**
   * URL path prefix for routing.
   * Incoming requests matching this prefix are routed to the target service.
   * Must start with '/'.
   */
  prefix: z.string().regex(/^\//).describe('URL path prefix for routing (e.g. /api/v1/data)'),
  
  /**
   * Target core service name.
   * The service that handles requests matching this prefix.
   */
  service: CoreServiceName.describe('Target core service name'),
  
  /**
   * Whether requests to this route require authentication.
   * Discovery endpoint is typically public; most others require auth.
   * @default true
   */
  authRequired: z.boolean().default(true).describe('Whether authentication is required'),
  
  /**
   * Service criticality level.
   * Determines behavior when the service is unavailable:
   * - required: return 500 Internal Server Error
   * - core: return 503 with degraded notice
   * - optional: return 503 Service Unavailable
   * @default 'optional'
   */
  criticality: ServiceCriticalitySchema.default('optional')
    .describe('Service criticality level for unavailability handling'),
  
  /**
   * Required permissions for accessing this route namespace.
   * Applied as a baseline before individual endpoint permission checks.
   */
  permissions: z.array(z.string()).optional()
    .describe('Required permissions for this route namespace'),
});

export type DispatcherRoute = z.input<typeof DispatcherRouteSchema>;
/** Post-parse shape of {@link DispatcherRoute} — defaults applied, transforms run (ADR-0122). */
export type DispatcherRouteParsed = z.infer<typeof DispatcherRouteSchema>;

// ============================================================================
// Dispatcher Configuration
// ============================================================================

/**
 * Dispatcher Configuration Schema
 * Complete configuration for the HttpDispatcher routing table.
 * 
 * @example
 * {
 *   "routes": [
 *     { "prefix": "/api/v1/discovery", "service": "metadata", "authRequired": false },
 *     { "prefix": "/api/v1/meta", "service": "metadata" },
 *     { "prefix": "/api/v1/data", "service": "data", "criticality": "required" },
 *     { "prefix": "/api/v1/auth", "service": "auth", "criticality": "required" },
 *     { "prefix": "/api/v1/ai", "service": "ai" }
 *   ],
 *   "fallback": "404"
 * }
 */
export const DispatcherConfigSchema = z.object({
  /**
   * Registered route mappings.
   * Routes are matched by longest-prefix-first strategy.
   */
  routes: z.array(DispatcherRouteSchema).describe('Route-to-service mappings'),
  
  /**
   * Behavior when no route matches the request.
   * - 404: Return 404 Not Found (default)
   * - proxy: Forward to a configured proxy target
   * - custom: Delegate to a custom handler
   * @default '404'
   */
  fallback: z.enum(['404', 'proxy', 'custom']).default('404')
    .describe('Behavior when no route matches'),
  
  /**
   * Proxy target URL for fallback: 'proxy' mode.
   */
  proxyTarget: z.string().url().optional()
    .describe('Proxy target URL when fallback is "proxy"'),
});

export type DispatcherConfig = z.input<typeof DispatcherConfigSchema>;
/** Post-parse shape of {@link DispatcherConfig} — defaults applied, transforms run (ADR-0122). */
export type DispatcherConfigParsed = z.infer<typeof DispatcherConfigSchema>;

// ============================================================================
// Default Route Table — REMOVED (#3586)
// ============================================================================
// DEFAULT_DISPATCHER_ROUTES was deleted: nothing in the runtime ever consumed
// it, it listed routes that never existed (/workflow, /realtime) while
// omitting eight real ones, and it underwrote a false compliance verdict.
// The audited, guard-enforced source of truth for the dispatcher's route
// surface is packages/runtime/src/route-ledger.ts.

// ============================================================================
// Dispatcher Error Codes
// ============================================================================

/**
 * The four route-resolution failure modes the dispatcher MUST distinguish, so
 * clients (and developers) can understand *why* an API call failed:
 *
 * - `ROUTE_NOT_FOUND` (404) – no route is registered for this path.
 * - `METHOD_NOT_ALLOWED` (405) – route exists but the HTTP method is not supported.
 * - `NOT_IMPLEMENTED` (501) – route is declared but the handler is a stub / not yet coded.
 * - `SERVICE_UNAVAILABLE` (503) – service exists but is temporarily down or not loaded.
 *
 * [#3842] These members used to be the *strings* `'404' | '405' | '501' | '503'`,
 * because `DispatcherErrorResponseSchema.error.code` carried the numeric HTTP
 * status and this enum existed to match against it. `error.code` now carries the
 * semantic string the base `ApiErrorSchema` has always declared (the number moved
 * to `httpStatus`), so this enum holds the semantic spellings — the same four
 * that used to sit in the now-removed `error.type`, moved verbatim. Match on the
 * status via `httpStatus` or the response status, not via a code.
 */
export const DispatcherErrorCode = z.enum([
  'ROUTE_NOT_FOUND',
  'METHOD_NOT_ALLOWED',
  'NOT_IMPLEMENTED',
  'SERVICE_UNAVAILABLE',
]).describe('Route-resolution failure mode emitted in `error.code`');

export type DispatcherErrorCode = z.input<typeof DispatcherErrorCode>;

/**
 * Dispatcher Error Response Schema
 *
 * Standardised error envelope returned by the dispatcher when a request cannot
 * be fulfilled.  Adapters MUST use this shape (or a superset) for all non-2xx
 * responses so that clients can programmatically distinguish failure modes.
 *
 * [#3842] This is a superset of `ApiErrorSchema`, not a rival dialect. It used
 * to declare `code` as the numeric HTTP status and put the machine-readable
 * spelling in a sibling `type` — which is where the dispatcher's deviation from
 * `ApiErrorSchema` was legitimised. `code` is now the semantic string both
 * schemas agree on, `httpStatus` carries the number, and `type` is gone.
 */
export const DispatcherErrorResponseSchema = z.object({
  /** Always `false` for error responses */
  success: z.literal(false),
  error: z.object({
    /**
     * Machine-readable error code for programmatic branching. Route-resolution
     * failures use a {@link DispatcherErrorCode}; every other failure carries
     * the producer's own code (or a `StandardErrorCode` derived from the status
     * — see `standardErrorCodeForHttpStatus`), so this stays an open string.
     */
    code: z.string().describe('Machine-readable error code (e.g. ROUTE_NOT_FOUND, permission_denied)'),
    /** Human-readable error message */
    message: z.string().describe('Human-readable error message'),
    /** HTTP status mirrored into the body (the response status is authoritative) */
    httpStatus: z.number().int().optional().describe('HTTP status code (404, 405, 501, 503, …)'),
    /** Route that was requested */
    route: z.string().optional().describe('Requested route path'),
    /** Service that the route maps to (if known) */
    service: z.string().optional().describe('Target service name, if resolvable'),
    /** Guidance for the developer */
    hint: z.string().optional().describe('Actionable hint for the developer (e.g., "Install plugin-workflow")'),
    /** Structured context — genuine context only, never a parked error code */
    details: z.unknown().optional().describe('Additional error context'),
  }),
});

export type DispatcherErrorResponse = z.input<typeof DispatcherErrorResponseSchema>;
