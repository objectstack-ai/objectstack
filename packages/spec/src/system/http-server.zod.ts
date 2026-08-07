// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { z } from 'zod';
import { HttpMethod } from '../shared/http.zod';
import { lazySchema } from '../shared/lazy-schema';

/**
 * HTTP Server Protocol
 *
 * Route-registration metadata, middleware declaration and the server-side lifecycle/status vocabulary for HTTP server implementations (Express, Fastify, Hono, etc.)
 *
 * Architecture alignment:
 * - Kubernetes: Service and Ingress resources
 * - AWS: API Gateway configuration
 * - Spring Boot: Application properties
 */

// ==========================================
// Server Configuration — RETIRED
// ==========================================

// `HttpServerConfigSchema` / `HttpServerConfig` / `HttpServerConfigInput` and
// the `HttpServerConfig.create()` helper were REMOVED per ADR-0049
// enforce-or-remove (#4938). The shape declared nine keys — `port`, `host`,
// `cors`, `requestTimeout`, `bodyLimit`, `compression`, `security`, `static`,
// `trustProxy` — and it was doubly inert:
//
//   1. ZERO runtime readers. No package in any repo (objectstack / cloud /
//      objectui) ever parsed a document with this schema or read a key off it;
//      the only non-spec mentions were "Used by:" comments in
//      `shared/http.zod.ts` pointing back at it.
//   2. ZERO authoring entry — the condition that made this worse than the
//      ordinary declared-but-unread defect. `stack.zod.ts` had no `server:`
//      key, `config-schema.json` had no `HttpServerConfig`, and no settings
//      manifest carried it, so the configuration `authorable-surface.json`
//      listed and `content/docs/references/` rendered could not even be
//      WRITTEN DOWN, let alone take effect.
//
// What actually decides these things, and where to configure each:
//
// | retired key | the live mechanism |
// |---|---|
// | `port` / `host` | the deployment, not the stack — `objectstack serve -p <port>` / `PORT` |
// | `static` | the transport plugin's `staticMounts` |
// | `cors` | the transport adapter — `OS_CORS_ORIGIN` / `OS_CORS_CREDENTIALS` / `OS_CORS_MAX_AGE` |
// | `security.helmet` | the dispatcher plugin's `securityHeaders` (on by default) |
// | `security.rateLimit` | `defineStack({ server: { security: { rateLimit } } })` — LIVE since #5006 |
// | `trustProxy` | `defineStack({ server: { trustProxy } })` — LIVE since #5006 |
// | `requestTimeout` / `bodyLimit` / `compression` | nothing. No seam consumes them; they return with an executor or not at all |
//
// Two of the nine were ACTIVATED rather than lost: #5006 mounted
// `security.rateLimit` and `trustProxy` on the deliberately narrow
// `StackServerConfigSchema` (`system/stack-server.zod.ts`), which is the one
// authoring surface for server-level configuration and grows one key at a time,
// each arriving with its consumer. That schema is `strictObject`, so the other
// seven keys are rejected BY NAME there with a per-key prescription — which is
// why this removal needs no `retiredKey()` tombstone: a tombstone is a message
// to whoever writes the key, and the only place anyone can write it already
// answers. Route 3 of the retirement playbook ("nothing parses it → neither"),
// the same shape #4834 / PR #4878 used for the kernel plugin-runtime family.
//
// `cors` is the one key with real business pull (`example-embed-objectql`
// proves embedding is a live scenario), and the 2026-08-04 ruling registered it
// as the FIRST per-key admission candidate into `server:` — to be admitted the
// #4910 way, WITH its executor, when the embedding work is scheduled. It is
// deliberately not parked on the export surface as a dead key in the meantime.
//
// `CorsConfigSchema`, `RateLimitConfigSchema` and `StaticMountSchema` stay in
// `shared/http.zod.ts`: each has other live consumers (`api/router.zod.ts`,
// `api/endpoint.zod.ts`, `system/stack-server.zod.ts`).

// ==========================================
// Route Registration
// ==========================================

/**
 * Route Handler Metadata Schema
 * Metadata for route handlers used in registration
 */
export const RouteHandlerMetadataSchema = lazySchema(() => z.object({
  /**
   * HTTP method
   */
  method: HttpMethod.describe('HTTP method'),
  
  /**
   * URL path pattern (supports parameters like /api/users/:id)
   */
  path: z.string().describe('URL path pattern'),
  
  /**
   * Handler function name or identifier
   */
  handler: z.string().describe('Handler identifier or name'),
  
  /**
   * Route metadata
   */
  metadata: z.object({
    summary: z.string().optional().describe('Route summary for documentation'),
    description: z.string().optional().describe('Route description'),
    tags: z.array(z.string()).optional().describe('Tags for grouping'),
    operationId: z.string().optional().describe('Unique operation identifier'),
  }).optional(),
  
  /**
   * Security requirements
   */
  security: z.object({
    authRequired: z.boolean().default(true).describe('Require authentication'),
    permissions: z.array(z.string()).optional().describe('Required permissions'),
    rateLimit: z.string().optional().describe('Rate limit policy override'),
  }).optional(),
}));

export type RouteHandlerMetadata = z.infer<typeof RouteHandlerMetadataSchema>;
/** Post-parse shape of {@link RouteHandlerMetadata} — defaults applied, transforms run (ADR-0122). */
export type RouteHandlerMetadataParsed = z.infer<typeof RouteHandlerMetadataSchema>;
export type RouteHandlerMetadataInput = z.input<typeof RouteHandlerMetadataSchema>;

// ==========================================
// Middleware Configuration
// ==========================================

/**
 * Middleware Type Enum
 */
export const MiddlewareType = z.enum([
  'authentication',  // Authentication middleware
  'authorization',   // Authorization/permission checks
  'logging',         // Request/response logging
  'validation',      // Input validation
  'transformation',  // Request/response transformation
  'error',          // Error handling
  'custom',         // Custom middleware
]);

export type MiddlewareType = z.infer<typeof MiddlewareType>;

/**
 * Middleware Configuration Schema
 * Defines middleware execution order and configuration
 * 
 * @example
 * {
 *   "name": "auth_middleware",
 *   "type": "authentication",
 *   "enabled": true,
 *   "order": 10,
 *   "config": {
 *     "jwtSecret": "secret",
 *     "excludePaths": ["/health", "/metrics"]
 *   }
 * }
 */
export const MiddlewareConfigSchema = lazySchema(() => z.object({
  /**
   * Middleware identifier
   */
  name: z.string().regex(/^[a-z_][a-z0-9_]*$/).describe('Middleware name (snake_case)'),
  
  /**
   * Middleware type
   */
  type: MiddlewareType.describe('Middleware type'),
  
  /**
   * Enable/disable middleware
   */
  enabled: z.boolean().default(true).describe('Whether middleware is enabled'),
  
  /**
   * Execution order (lower numbers execute first)
   */
  order: z.number().int().default(100).describe('Execution order priority'),
  
  /**
   * Middleware-specific configuration
   */
  config: z.record(z.string(), z.unknown()).optional().describe('Middleware configuration object'),
  
  /**
   * Path patterns to apply middleware to
   */
  paths: z.object({
    include: z.array(z.string()).optional().describe('Include path patterns (glob)'),
    exclude: z.array(z.string()).optional().describe('Exclude path patterns (glob)'),
  }).optional().describe('Path filtering'),
}));

export type MiddlewareConfig = z.infer<typeof MiddlewareConfigSchema>;
/** Post-parse shape of {@link MiddlewareConfig} — defaults applied, transforms run (ADR-0122). */
export type MiddlewareConfigParsed = z.infer<typeof MiddlewareConfigSchema>;
export type MiddlewareConfigInput = z.input<typeof MiddlewareConfigSchema>;

// ==========================================
// Server Lifecycle Events
// ==========================================

/**
 * Server Event Type Enum
 */
export const ServerEventType = z.enum([
  'starting',      // Server is starting
  'started',       // Server has started and is listening
  'stopping',      // Server is stopping
  'stopped',       // Server has stopped
  'request',       // Request received
  'response',      // Response sent
  'error',         // Error occurred
]);

export type ServerEventType = z.infer<typeof ServerEventType>;

/**
 * Server Event Schema
 * Events emitted by the HTTP server during lifecycle
 */
export const ServerEventSchema = lazySchema(() => z.object({
  /**
   * Event type
   */
  type: ServerEventType.describe('Event type'),
  
  /**
   * Timestamp
   */
  timestamp: z.string().datetime().describe('Event timestamp (ISO 8601)'),
  
  /**
   * Event payload
   */
  data: z.record(z.string(), z.unknown()).optional().describe('Event-specific data'),
}));

export type ServerEvent = z.infer<typeof ServerEventSchema>;

// ==========================================
// Server Capability Declaration
// ==========================================

/**
 * Server Capabilities Schema
 * Declares what features a server implementation supports
 */
export const ServerCapabilitiesSchema = lazySchema(() => z.object({
  /**
   * Supported HTTP versions
   */
  httpVersions: z.array(z.enum(['1.0', '1.1', '2.0', '3.0'])).default(['1.1']).describe('Supported HTTP versions'),
  
  /**
   * WebSocket support
   */
  websocket: z.boolean().default(false).describe('WebSocket support'),
  
  /**
   * Server-Sent Events support
   */
  sse: z.boolean().default(false).describe('Server-Sent Events support'),
  
  /**
   * HTTP/2 Server Push
   */
  serverPush: z.boolean().default(false).describe('HTTP/2 Server Push support'),
  
  /**
   * Streaming support
   */
  streaming: z.boolean().default(true).describe('Response streaming support'),
  
  /**
   * Middleware support
   */
  middleware: z.boolean().default(true).describe('Middleware chain support'),
  
  /**
   * Route parameterization
   */
  routeParams: z.boolean().default(true).describe('URL parameter support (/users/:id)'),
  
  /**
   * Built-in compression
   */
  compression: z.boolean().default(true).describe('Built-in compression support'),
}));

export type ServerCapabilities = z.infer<typeof ServerCapabilitiesSchema>;
/** Post-parse shape of {@link ServerCapabilities} — defaults applied, transforms run (ADR-0122). */
export type ServerCapabilitiesParsed = z.infer<typeof ServerCapabilitiesSchema>;
export type ServerCapabilitiesInput = z.input<typeof ServerCapabilitiesSchema>;

// ==========================================
// Server Status & Metrics
// ==========================================

/**
 * Server Status Schema
 * Current operational status of the server
 */
export const ServerStatusSchema = lazySchema(() => z.object({
  /**
   * Server state
   */
  state: z.enum(['stopped', 'starting', 'running', 'stopping', 'error']).describe('Current server state'),
  
  /**
   * Uptime in milliseconds
   */
  uptime: z.number().int().optional().describe('Server uptime in milliseconds'),
  
  /**
   * Server information
   */
  server: z.object({
    port: z.number().int().describe('Listening port'),
    host: z.string().describe('Bound host'),
    url: z.string().optional().describe('Full server URL'),
  }).optional(),
  
  /**
   * Connection metrics
   */
  connections: z.object({
    active: z.number().int().describe('Active connections'),
    total: z.number().int().describe('Total connections handled'),
  }).optional(),
  
  /**
   * Request metrics
   */
  requests: z.object({
    total: z.number().int().describe('Total requests processed'),
    success: z.number().int().describe('Successful requests'),
    errors: z.number().int().describe('Failed requests'),
  }).optional(),
}));

export type ServerStatus = z.infer<typeof ServerStatusSchema>;

// ==========================================
// Helper Functions
// ==========================================

// The `HttpServerConfig` helper (`Object.assign(HttpServerConfigSchema, {
// create })`) went with the schema it wrapped — see the retirement note at the
// top of this file (#4938).

/**
 * Helper to create middleware configuration
 */
export const MiddlewareConfig = Object.assign(MiddlewareConfigSchema, {
  create: <T extends z.input<typeof MiddlewareConfigSchema>>(config: T) => config,
});
