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

export type RouteHandlerMetadata = z.input<typeof RouteHandlerMetadataSchema>;
/** Post-parse shape of {@link RouteHandlerMetadata} — defaults applied, transforms run (ADR-0122). */
export type RouteHandlerMetadataParsed = z.infer<typeof RouteHandlerMetadataSchema>;

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

export type MiddlewareType = z.input<typeof MiddlewareType>;

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

export type MiddlewareConfig = z.input<typeof MiddlewareConfigSchema>;
/** Post-parse shape of {@link MiddlewareConfig} — defaults applied, transforms run (ADR-0122). */
export type MiddlewareConfigParsed = z.infer<typeof MiddlewareConfigSchema>;

// ==========================================
// Server Lifecycle Events / Capabilities / Status — RETIRED
// ==========================================

// `ServerEventType`, `ServerEventSchema` / `ServerEvent`,
// `ServerCapabilitiesSchema` / `ServerCapabilities` /
// `ServerCapabilitiesParsed`, and `ServerStatusSchema` / `ServerStatus` were
// REMOVED per ADR-0049 enforce-or-remove (#5295, protocol 17) — the same route,
// in the same file, for the same reason as `HttpServerConfigSchema` above
// (#4938). Route 3 of the retirement playbook: nothing parsed them, so there is
// no author to hand a `retiredKey()` tombstone to and no stored or authored
// document for a D2 conversion to rewrite. `RETIRED_DEFS_BY_MAJOR[17]` plus the
// D3 `SemanticMigration` `http-server-runtime-vocabulary-retired` ARE the
// declaration.
//
// What each declared, and what actually decides it:
//
// | retired shape | declared | the live mechanism |
// |---|---|---|
// | `ServerEventType` / `ServerEvent` | a 7-value lifecycle/traffic event feed (`starting`, `started`, `stopping`, `stopped`, `request`, `response`, `error`) with a timestamp and a loose payload | nothing emitted it. Lifecycle is the transport plugin's own `start`/`stop` seam; per-request observability is `system/metrics.zod.ts` and `system/logging.zod.ts`, and `OS_SERVER_TIMING` for timings |
// | `ServerCapabilities` | eight booleans a server implementation would *report* about itself (`websocket`, `sse`, `serverPush`, `streaming`, `middleware`, `routeParams`, `compression`, plus `httpVersions`) | nothing reported or read them. A transport plugin declares what it provides by implementing the kernel plugin contract — the seams it registers ARE the capability statement, and a second self-described record can only disagree with them |
// | `ServerStatus` | a five-state machine plus uptime, bound host/port and connection/request counters | `/health` for liveness and the metrics surface for counters; no seam ever produced this shape |
//
// ## The measurement that made this a removal rather than a conformance surface
//
// #5295 was held, not queued, on one doubt: a response/capability vocabulary
// can legitimately be a REFERENCE surface for host implementers (the CSS-variable
// rebuttal), and "zero consumers in this repo" is weaker evidence for one of
// those than for an authorable key. The card's precondition was therefore to
// measure the reference reader itself. Re-run on `origin/main` immediately
// before this removal:
//
//   1. `plugin-hono-server` — the one in-tree host implementation — neither
//      implements nor reports any of the three. Its source names no capability
//      record, no status shape and no lifecycle event union; what it registers
//      is routes and middleware through the kernel plugin contract.
//   2. Declaration-site grep (`^(export )?(const|type) <Name>`) puts every
//      declaration in this file, and a quoted-name sweep across objectstack and
//      objectui finds no reader outside this file: the only surviving mentions
//      are three ADR-0122 isomorphism pins (deleted with the schemas) and the
//      GENERATED reference pages, which document the export because it exists,
//      not because anyone imports it.
//   3. The control ran green in the same sweep: `MiddlewareConfig`, declared
//      twelve lines above these, resolves to a live consumer
//      (`packages/runtime/src/middleware.ts:4,59`) — so the sweep can see a
//      reader in this file when there is one.
//
// A reference surface with no referent is the #3950 shape: an exported schema
// with no consumer reads as a capability to whoever finds it. If host-implementer
// conformance becomes a real requirement, it returns through the ENFORCE route
// — an adapter contract with a checker behind it, vocabulary second.

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
