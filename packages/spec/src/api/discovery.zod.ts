// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { z } from 'zod';
import { HttpMethod } from '../shared/http.zod';

/**
 * Service Status Enum
 * Describes the operational state of a service in the discovery response.
 *
 * - `available`   – Fully operational: service is registered AND HTTP handler is verified.
 * - `registered`  – Route is declared in the dispatcher table but the HTTP handler has
 *                   not been verified (may 501 at runtime).
 * - `unavailable` – Service is not installed / not registered in the kernel.
 * - `degraded`    – Partially working (e.g., in-memory fallback, missing persistence).
 * - `stub`        – Placeholder handler that always returns 501 Not Implemented.
 */
import { lazySchema } from '../shared/lazy-schema';
export const ServiceStatus = z.enum([
  'available',
  'registered',
  'unavailable',
  'degraded',
  'stub',
]).describe(
  'available = fully operational, registered = route declared but handler unverified, '
  + 'unavailable = not installed, degraded = partial, stub = placeholder that returns 501'
);

export type ServiceStatus = z.infer<typeof ServiceStatus>;

/**
 * Service Status in Discovery Response
 * Reports per-service availability so clients can adapt their UI accordingly.
 */
export const ServiceInfoSchema = lazySchema(() => z.object({
  /** Whether the service is enabled and available */
  enabled: z.boolean(),
  /** Current operational status */
  status: ServiceStatus,
  /**
   * Whether the HTTP handler for this service is confirmed to be mounted.
   *
   * Semantics:
   * - `undefined` (omitted) = handler readiness is unknown / not yet verified.
   * - `true`                = handler is registered in the adapter / dispatcher (safe to call).
   * - `false`               = route is declared but no handler exists or only a stub is present
   *                            — requests are expected to receive 501 Not Implemented.
   *
   * Clients SHOULD check this flag before displaying or invoking a service endpoint and may
   * distinguish between "unknown" (omitted) and "known missing" (`false`).
   */
  handlerReady: z.boolean().optional().describe(
    'Whether the HTTP handler is confirmed to be mounted. '
    + 'Omitted = readiness unknown/unverified; true = handler mounted; false = handler missing or stub (likely 501).'
  ),
  /** Route path (only present if enabled) */
  route: z.string().optional().describe('e.g. /api/v1/analytics'),
  /** Implementation provider name */
  provider: z.string().optional().describe('e.g. "objectql", "plugin-redis", "driver-memory"'),
  /** Service version */
  version: z.string().optional().describe('Semantic version of the service implementation (e.g. "3.0.6")'),
  /** Human-readable reason if unavailable */
  message: z.string().optional().describe('e.g. "Install plugin-workflow to enable"'),
  /** Rate limit configuration for this service */
  rateLimit: z.object({
    requestsPerMinute: z.number().int().optional().describe('Maximum requests per minute'),
    requestsPerHour: z.number().int().optional().describe('Maximum requests per hour'),
    burstLimit: z.number().int().optional().describe('Maximum burst request count'),
    retryAfterMs: z.number().int().optional().describe('Suggested retry-after delay in milliseconds when rate-limited'),
  }).optional().describe('Rate limit and quota info for this service'),
}));

// ============================================================================
// Honest capabilities — service self-description marker (ADR-0076 D12, #2462)
// ============================================================================

/**
 * Well-known property name a registered kernel service can carry to
 * self-identify as a stub / dev-fake / degraded fallback.
 *
 * Discovery builders MUST read this marker (via {@link readServiceSelfInfo})
 * and report the declared status instead of hardcoding `available` — a stub
 * or fallback that reports `status: 'available'` misleads consumers (AI
 * agents, the console) into treating a fake capability as real.
 */
export const SERVICE_SELF_INFO_KEY = '__serviceInfo' as const;

/**
 * Shape of the {@link SERVICE_SELF_INFO_KEY} marker a service carries to
 * describe its own honesty level. Only non-`available` self-reports exist:
 * a service that is fully real simply carries no marker.
 */
export const ServiceSelfInfoSchema = lazySchema(() => z.object({
  /** Declared honesty level: `stub` = placeholder/fake, `degraded` = working but partial fallback */
  status: z.enum(['stub', 'degraded']).describe(
    'stub = placeholder or dev fake (do not use for real work); '
    + 'degraded = functional fallback with reduced capability'
  ),
  /**
   * Whether the service's HTTP handler genuinely serves requests.
   * Defaults (when omitted): `false` for `stub`, `true` for `degraded`.
   */
  handlerReady: z.boolean().optional().describe(
    'Whether the HTTP handler genuinely serves requests. Defaults: false for stub, true for degraded.'
  ),
  /** Human-readable explanation shown in discovery (e.g. what to install for the real thing) */
  message: z.string().optional().describe('Human-readable explanation, e.g. what to install for the full implementation'),
}));

export type ServiceSelfInfo = z.infer<typeof ServiceSelfInfoSchema>;

/**
 * Reads the standardized self-description marker off a registered service
 * instance (ADR-0076 D12). Returns `undefined` for services that carry no
 * marker — i.e. services claiming to be fully real.
 *
 * Reads exactly one marker: `svc[SERVICE_SELF_INFO_KEY]`, the
 * `{ status, handlerReady?, message? }` descriptor.
 *
 * There were once three. `_fallback: true` (the kernel's in-memory fallbacks)
 * was recognized by nothing, so discovery reported those as fully `available`
 * — the honesty gap D12 exists to close; `_dev: true` (plugin-dev's stub
 * table) was normalized here to `{ status: 'stub', handlerReady: false }`.
 * Both were retired by moving their producers onto this descriptor rather than
 * by teaching this function more dialects (#4082, ADR-0115): one marker that
 * says WHICH kind of unreal a service is beats N markers that only say "unreal"
 * — `degraded` (really serves, reduced capability) and `stub` (fabricates) are
 * the distinction every consumer actually gates on, and a boolean cannot carry
 * it. A service still carrying a retired marker reads as unmarked here, i.e.
 * as fully real — migrate it (see the CHANGELOG entry for the mapping).
 */
export function readServiceSelfInfo(svc: unknown): ServiceSelfInfo | undefined {
  if (!svc || typeof svc !== 'object') return undefined;
  const self = (svc as Record<string, unknown>)[SERVICE_SELF_INFO_KEY] as Record<string, unknown> | undefined;
  if (self && typeof self === 'object' && (self.status === 'stub' || self.status === 'degraded')) {
    return {
      status: self.status,
      handlerReady: typeof self.handlerReady === 'boolean'
        ? self.handlerReady
        : self.status === 'degraded',
      ...(typeof self.message === 'string' ? { message: self.message } : {}),
    };
  }
  return undefined;
}

/**
 * API Routes Schema
 * The "Map" for the frontend to know where to send requests.
 * This decouples the frontend from hardcoded URL paths.
 */
export const ApiRoutesSchema = lazySchema(() => z.object({
  /** Base URL for Object CRUD (Data Protocol) */
  data: z.string().describe('e.g. /api/v1/data'),
  
  /** Base URL for Schema Definitions (Metadata Protocol) */
  metadata: z.string().describe('e.g. /api/v1/meta'),

  /** Base URL for API Discovery endpoint */
  discovery: z.string().optional().describe('e.g. /api/v1/discovery'),

  /** Base URL for UI Configurations (Views, Menus) */
  ui: z.string().optional().describe('e.g. /api/v1/ui'),
  
  /** Base URL for Authentication (plugin-provided) */
  auth: z.string().optional().describe('e.g. /api/v1/auth'),
  
  /** Base URL for Automation (Flows/Scripts) */
  automation: z.string().optional().describe('e.g. /api/v1/automation'),
  
  /** Base URL for File/Storage operations */
  storage: z.string().optional().describe('e.g. /api/v1/storage'),
  
  /** Base URL for Analytics/BI operations */
  analytics: z.string().optional().describe('e.g. /api/v1/analytics'),
  

  /** Base URL for Package Management */
  packages: z.string().optional().describe('e.g. /api/v1/packages'),

  /** Base URL for Workflow Engine */
  workflow: z.string().optional().describe('e.g. /api/v1/workflow'),

  /** Base URL for Approvals (ADR-0019: approval as a flow node) */
  approvals: z.string().optional().describe('e.g. /api/v1/approvals'),

  /** Base URL for Realtime (WebSocket/SSE) */
  realtime: z.string().optional().describe('e.g. /api/v1/realtime'),

  /** Base URL for Notification Service */
  notifications: z.string().optional().describe('e.g. /api/v1/notifications'),

  /** Base URL for AI Engine (NLQ, Chat, Suggest) */
  ai: z.string().optional().describe('e.g. /api/v1/ai'),

  /** Base URL for Internationalization */
  i18n: z.string().optional().describe('e.g. /api/v1/i18n'),
}));

/**
 * Discovery Response Schema
 * The root object returned by the Metadata Discovery Endpoint.
 * 
 * Design rationale:
 * - `services` is the single source of truth for service availability.
 *   Each service entry includes `enabled`, `status`, `route`, and `provider`.
 * - `routes` is a convenience shortcut: a flat map of service-name → route-path
 *   so that clients can resolve endpoints without iterating the services map.
 * - `capabilities`/`features` was removed because it was fully derivable
 *   from `services[x].enabled`. Use `services` to determine feature availability.
 */
export const DiscoverySchema = lazySchema(() => z.object({
  /** System Identity */
  name: z.string(),
  version: z.string(),
  environment: z.enum(['production', 'sandbox', 'development']),
  
  /** Dynamic Routing — convenience shortcut for client routing */
  routes: ApiRoutesSchema,
  
  /** Localization Info (helping frontend init i18n) */
  locale: z.object({
    default: z.string(),
    supported: z.array(z.string()),
    timezone: z.string(),
  }),
  
  /**
   * Per-service status map.
   * This is the **single source of truth** for service availability.
   * Clients use this to determine which features are available,
   * show/hide UI elements, and display appropriate messages.
   */
  services: z.record(z.string(), ServiceInfoSchema).describe(
    'Per-service availability map keyed by CoreServiceName'
  ),

  /**
   * Hierarchical capability descriptors.
   * Declares platform features so clients can adapt UI without probing individual services.
   * Each key is a capability domain (e.g., "comments", "automation", "search"),
   * and its value describes what sub-features are available.
   */
  capabilities: z.record(z.string(), z.object({
    enabled: z.boolean().describe('Whether this capability is available'),
    features: z.record(z.string(), z.boolean()).optional()
      .describe('Sub-feature flags within this capability'),
    description: z.string().optional()
      .describe('Human-readable capability description'),
  })).optional().describe('Hierarchical capability descriptors for frontend intelligent adaptation'),

  /**
   * Schema discovery URLs for cross-ecosystem interoperability.
   */
  schemaDiscovery: z.object({
    openapi: z.string().optional().describe('URL to OpenAPI (Swagger) specification (e.g., "/api/v1/openapi.json")'),
    jsonSchema: z.string().optional().describe('URL to JSON Schema definitions'),
  }).optional().describe('Schema discovery endpoints for API toolchain integration'),

  /**
   * Custom metadata key-value pairs for extensibility
   */
  metadata: z.record(z.string(), z.unknown()).optional().describe('Custom metadata key-value pairs for extensibility'),
}));

/**
 * Well-Known Capabilities Schema
 * Flat boolean flags for quick feature detection by clients (ObjectUI).
 * Each flag indicates whether the backend supports a specific capability.
 * Clients can use these to show/hide UI elements without probing individual endpoints.
 */
export const WellKnownCapabilitiesSchema = lazySchema(() => z.object({
  /** Whether the backend supports record comments / chatter (served by `sys_comment` via the data API) */
  comments: z.boolean().describe('Whether the backend supports record comments / chatter (the `sys_comment` object served via the data API)'),
  /** Whether the backend supports Automation CRUD (flows, triggers) */
  automation: z.boolean().describe('Whether the backend supports Automation CRUD (flows, triggers)'),
  /** Whether the backend supports cron scheduling */
  cron: z.boolean().describe('Whether the backend supports cron scheduling'),
  /** Whether the backend supports full-text search */
  search: z.boolean().describe('Whether the backend supports full-text search'),
  /** Whether the backend supports async export */
  export: z.boolean().describe('Whether the backend supports async export'),
  /** Whether the backend supports chunked (multipart) uploads */
  chunkedUpload: z.boolean().describe('Whether the backend supports chunked (multipart) uploads'),
  /**
   * Whether the backend exposes the atomic cross-object batch endpoint
   * (`POST {basePath}/batch`, issue #1604 / ADR-0034 item 4): heterogeneous
   * create/update/delete across objects that all commit or all roll back in a
   * single transaction, with intra-batch `{ $ref: <opIndex> }` parent references.
   *
   * This lets a client decide **at connection time** whether to send an atomic
   * batch or fall back to non-atomic client-side simulation — replacing the
   * runtime probe (fire a `/batch` and read 404/405/501). `true` means the route
   * is mounted AND the runtime engine can honour a transaction; a backend that
   * would 404 (no route) or 501 (no `transaction()`) MUST report `false`
   * (declared === enforced).
   */
  transactionalBatch: z.boolean().describe(
    'Whether the backend exposes the atomic cross-object batch endpoint (POST {basePath}/batch, #1604/ADR-0034): '
    + 'all ops commit or roll back together in one transaction. Lets clients skip non-atomic client-side simulation '
    + 'instead of runtime-probing 404/405/501. True ⟺ the /batch route is mounted AND the runtime can honour a transaction.'
  ),
}).describe('Well-known capability flags for frontend intelligent adaptation'));

export type WellKnownCapabilities = z.infer<typeof WellKnownCapabilitiesSchema>;
export type DiscoveryResponse = z.infer<typeof DiscoverySchema>;
export type ApiRoutes = z.infer<typeof ApiRoutesSchema>;
export type ServiceInfo = z.infer<typeof ServiceInfoSchema>;

// ============================================================================
// Route Health Report
// ============================================================================

/**
 * Single route health entry for the coverage report.
 */
export const RouteHealthEntrySchema = lazySchema(() => z.object({
  /** Route path (e.g. /api/v1/analytics) */
  route: z.string().describe('Route path pattern'),
  /** HTTP method */
  method: HttpMethod.describe('HTTP method (GET, POST, etc.)'),
  /** Target service name */
  service: z.string().describe('Target service name'),
  /** Whether the route is declared in discovery */
  declared: z.boolean().describe('Whether the route is declared in discovery/metadata'),
  /** Whether the handler is actually registered in the adapter/dispatcher */
  handlerRegistered: z.boolean().describe('Whether the HTTP handler is registered'),
  /**
   * Health check result:
   * - `pass`    – Handler exists and responds (2xx/4xx — i.e., not 404/501/503)
   * - `fail`    – Handler returned 501 or 503
   * - `missing` – No handler registered (404)
   * - `skip`    – Health check was not performed
   */
  healthStatus: z.enum(['pass', 'fail', 'missing', 'skip']).describe(
    'pass = handler responds, fail = 501/503, missing = no handler (404), skip = not checked'
  ),
  /** Optional diagnostic message */
  message: z.string().optional().describe('Diagnostic message'),
}));

export type RouteHealthEntry = z.infer<typeof RouteHealthEntrySchema>;

/**
 * Route Health Report Schema
 * Aggregated route coverage report produced at startup or on demand.
 *
 * This report enables automated detection of routes that are declared
 * in discovery metadata but have no corresponding HTTP handler.
 */
export const RouteHealthReportSchema = lazySchema(() => z.object({
  /** ISO 8601 timestamp of when the report was generated */
  timestamp: z.string().describe('ISO 8601 timestamp of report generation'),
  /** Adapter name that generated the report (e.g. "hono", "express", "nextjs") */
  adapter: z.string().describe('Adapter or runtime that produced this report'),
  /** Total routes declared in discovery / dispatcher table */
  totalDeclared: z.number().int().describe('Total routes declared in discovery'),
  /** Routes with a confirmed handler registration */
  totalRegistered: z.number().int().describe('Routes with confirmed handler'),
  /** Routes missing a handler */
  totalMissing: z.number().int().describe('Routes missing a handler'),
  /** Per-route health entries */
  routes: z.array(RouteHealthEntrySchema).describe('Per-route health entries'),
}));

export type RouteHealthReport = z.infer<typeof RouteHealthReportSchema>;
