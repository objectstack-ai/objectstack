// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { z } from 'zod';
import { HttpMethod } from '../shared/http.zod';
import { MiddlewareConfigSchema } from '../system/http-server.zod';
import { retiredKey } from '../shared/retired-key';

/**
 * REST API Plugin Protocol
 * 
 * Defines the schema for REST API plugins that register Discovery, Metadata,
 * Data CRUD, Batch, and Permission routes with the HTTP Dispatcher.
 * 
 * This plugin type implements Phase 2 of the API Protocol implementation plan,
 * providing standardized REST endpoints with:
 * - Request validation middleware using Zod schemas
 * - Response envelope wrapping with BaseResponseSchema
 * - Error handling using ApiErrorSchema
 * - OpenAPI documentation auto-generation
 * 
 * Features:
 * - Route registration for core API endpoints
 * - Automatic schema-based validation
 * - Standardized request/response envelopes
 * - OpenAPI/Swagger documentation generation
 * 
 * Architecture Alignment:
 * - Salesforce: REST API with metadata and data CRUD
 * - Microsoft Dynamics: Web API with entity operations
 * - Strapi: Auto-generated REST endpoints from schemas
 * 
 * @example Serving routes from a plugin (imperative `http.server` mount)
 * ```typescript
 * // Routes are mounted in CODE — resolve the `http.server` service from the
 * // plugin context and register handlers on `kernel:ready` (the service is
 * // registered by plugin-hono-server; `examples/app-showcase`'s
 * // recalc-endpoint is a real consumer of this exact shape). The worked
 * // manifest example that used to sit here declared `contributes.routes`,
 * // which was removed in @objectstack/spec 17 (#10726): nothing ever read
 * // it, so every route it showed parsed cleanly and served nothing.
 * class RestApiPlugin {
 *   name = 'rest_api';
 *   async init(ctx: PluginContext) {
 *     ctx.hook('kernel:ready', async () => {
 *       const server = await ctx.getService<IHttpServer>('http.server');
 *       server.get('/api/v1/discovery', (req, res) => { ... });
 *       server.post('/api/v1/data/:object', (req, res) => { ... });
 *     });
 *   }
 * }
 * ```
 *
 * A declarative endpoint over a pipeline the platform already runs
 * (query/return records, trigger a flow) is `defineStack({ apis })` instead —
 * no plugin code at all.
 */

// ==========================================
// REST API Route Categories
// ==========================================

/**
 * REST API Route Category Enum
 * Categorizes REST API routes by their primary function
 */
import { lazySchema } from '../shared/lazy-schema';
export const RestApiRouteCategory = z.enum([
  'discovery',    // API discovery and capabilities
  'metadata',     // Metadata operations (objects, fields, views)
  'data',         // Data CRUD operations
  'batch',        // Batch/bulk operations
  'permission',   // Permission/authorization checks
  'analytics',    // Analytics and reporting
  'automation',   // Automation triggers and flows
  // 'workflow' removed (#4451, v17): no workflow surface ever existed for a
  // route to belong to (ADR-0115 Evidence 5); state machines are a validation
  // rule, approvals are flow nodes. Routes in that space are 'automation'.
  'ui',           // UI metadata (views, layouts)
  'realtime',     // Realtime/WebSocket
  'notification', // Notification management
  'ai',           // AI operations (NLQ, chat)
  'i18n',         // Internationalization
]);

export type RestApiRouteCategory = z.input<typeof RestApiRouteCategory>;

// ==========================================
// Route Registration Schema
// ==========================================

// ─── [#13823] `handlerStatus` and the Route Coverage Report are RETIRED ──────
//
// ADR-0049 enforce-or-remove; maintainer ruling 2026-09-01 (director decision
// batch #27, verbatim 「同意」): remove. `handlerStatus` (`implemented` / `stub`
// / `planned`) was authorable on `RestApiEndpointSchema` and re-declared on
// `RouteCoverageEntrySchema`, and NOTHING read it: a repo-wide identifier
// search at this retirement's base (a9b2be0b0; `skills/**` and tests
// excluded) returned only the three sites that used to sit in this file. Its
// documented effect had a different cause — `DispatcherErrorCode.enum
// .NOT_IMPLEMENTED` is raised by the declarative-endpoint executor
// (`runtime/src/endpoint-executor.ts` ×3, `runtime/src/api-mapping.ts`,
// `runtime/src/api-endpoint-step.ts`) for a target or mapping it cannot
// serve, and none of those sites consults the key — so `handlerStatus:
// 'stub'` got an ordinarily served route, and `RouteCoverageReportSchema`,
// the only shape that would have carried the status outward, had zero
// constructors in objectstack, objectui (pinned sha) and cloud.
//
// Three bookkeeping shapes, one retirement:
//   1. `RestApiEndpoint.handlerStatus` — `retiredKey()` tombstone below (this
//      shape is a non-strict `z.object`, so a bare deletion would be a silent
//      strip, #3733 / ADR-0104); `api/RestApiEndpoint:handlerStatus` in
//      `RETIRED_KEYS_BY_MAJOR[18]`.
//   2. `RouteCoverageEntrySchema` / `RouteCoverageReportSchema` — whole-def
//      removal (route 3: nobody ever parsed or constructed one);
//      `api/RouteCoverageEntry` + `api/RouteCoverageReport` in
//      `RETIRED_DEFS_BY_MAJOR[18]`. The section that declared them is
//      recorded at the end of this file.
//   3. `HandlerStatusSchema` / `HandlerStatus` (the enum this comment
//      replaces) — orphan value schema once both carriers are gone (#3950:
//      an exported value schema with no consumer reads as a capability);
//      `api/HandlerStatus` in `RETIRED_DEFS_BY_MAJOR[18]`.
//
// No D2 conversion, deliberately: nothing in the tree parses
// `RestApiEndpointSchema` outside its own unit tests — it is not a stack
// collection member (`PLURAL_TO_SINGULAR` has no entry for it) and never a
// `sys_metadata` row — so a MetadataConversion would be a transform with no
// seam that ever runs (the `kernel/Manifest:loading` disposition). The D3
// semantic entry `rest-api-endpoint-handler-status-retired` carries the
// prescription outward. ENFORCE — mounting a 501 stub for `stub` / `planned`
// — was ruled out as a zero-pull new capability, not a repair.
const HANDLER_STATUS_RETIRED =
  '`RestApiEndpoint.handlerStatus` was removed in @objectstack/spec 17 (#13823, ADR-0049 '
  + 'enforce-or-remove) — nothing ever read it: no registrar, dispatcher or adapter consulted '
  + "the key, so an endpoint declared `stub` or `planned` was served exactly like an "
  + '`implemented` one, and the `501 NOT_IMPLEMENTED` its docstring promised is raised by the '
  + 'declarative-endpoint executor for a target it cannot serve, never from this field. Delete '
  + 'the key. An endpoint that has no handler yet is simply not registered; a '
  + 'declared-but-unbuilt route answering 501 is not a platform capability (ruling record, '
  + '2026-09-01).';

/**
 * REST API Endpoint Schema
 * Defines a single REST API endpoint with its metadata
 * 
 * @example Discovery Endpoint
 * {
 *   "method": "GET",
 *   "path": "/api/v1/discovery",
 *   "handler": "getDiscovery",
 *   "category": "discovery",
 *   "public": true,
 *   "description": "Get API discovery information"
 * }
 */
export const RestApiEndpointSchema = lazySchema(() => z.object({
  /**
   * HTTP method
   */
  method: HttpMethod.describe('HTTP method for this endpoint'),
  
  /**
   * URL path pattern (supports parameters like :id)
   */
  path: z.string().describe('URL path pattern (e.g., /api/v1/data/:object/:id)'),
  
  /**
   * Handler reference (protocol method name)
   */
  handler: z.string().describe('Protocol method name or handler identifier'),
  
  /**
   * Route category
   */
  category: RestApiRouteCategory.describe('Route category'),
  
  /**
   * Whether endpoint is publicly accessible (no auth required)
   */
  public: z.boolean().default(false).describe('Is publicly accessible without authentication'),
  
  /**
   * Required permissions
   */
  permissions: z.array(z.string()).optional().describe('Required permissions (e.g., ["data.read", "object.account.read"])'),
  
  /**
   * OpenAPI documentation metadata
   */
  summary: z.string().optional().describe('Short description for OpenAPI'),
  description: z.string().optional().describe('Detailed description for OpenAPI'),
  tags: z.array(z.string()).optional().describe('OpenAPI tags for grouping'),
  
  /**
   * Request/Response schema references
   */
  requestSchema: z.string().optional().describe('Request schema name (for validation)'),
  responseSchema: z.string().optional().describe('Response schema name (for documentation)'),
  
  /**
   * Performance and reliability settings
   */
  timeout: z.number().int().optional().describe('Request timeout in milliseconds'),
  rateLimit: z.string().optional().describe('Rate limit policy name'),
  cacheable: z.boolean().default(false).describe('Whether response can be cached'),
  cacheTtl: z.number().int().optional().describe('Cache TTL in seconds'),

  /**
   * RETIRED (#13823, ADR-0049): `handlerStatus` (`implemented` / `stub` /
   * `planned`) had no reader — the retirement record sits above
   * `HANDLER_STATUS_RETIRED`. Tombstoned rather than deleted: this shape is
   * not `.strict()`, so authoring it must fail loudly (tsc `never` + the
   * parse-time prescription), never strip in silence. The old docblock's
   * `@default 'implemented'` was prose only — the key never carried a Zod
   * `.default()`, so no built artifact materialised it and there is no
   * residue window to tolerate (#12840 does not apply).
   */
  handlerStatus: retiredKey(HANDLER_STATUS_RETIRED),
}));

export type RestApiEndpoint = z.input<typeof RestApiEndpointSchema>;
/** Post-parse shape of {@link RestApiEndpoint} — defaults applied, transforms run (ADR-0122). */
export type RestApiEndpointParsed = z.infer<typeof RestApiEndpointSchema>;

/**
 * REST API Route Registration Schema
 * Registers a group of related endpoints under a common prefix
 * 
 * @example Data CRUD Routes
 * {
 *   "prefix": "/api/v1/data",
 *   "service": "data",
 *   "category": "data",
 *   "endpoints": [
 *     { "method": "GET", "path": "/:object", "handler": "findData" },
 *     { "method": "GET", "path": "/:object/:id", "handler": "getData" },
 *     { "method": "POST", "path": "/:object", "handler": "createData" },
 *     { "method": "PATCH", "path": "/:object/:id", "handler": "updateData" },
 *     { "method": "DELETE", "path": "/:object/:id", "handler": "deleteData" }
 *   ],
 *   "middleware": [
 *     { "name": "auth", "type": "authentication", "enabled": true },
 *     { "name": "validation", "type": "validation", "enabled": true },
 *     { "name": "response_envelope", "type": "transformation", "enabled": true }
 *   ]
 * }
 */
export const RestApiRouteRegistrationSchema = z.object({
  /**
   * URL prefix for this route group (e.g., /api/v1/data)
   */
  prefix: z.string().regex(/^\//).describe('URL path prefix for this route group'),
  
  /**
   * Service name that handles these routes
   */
  service: z.string().describe('Core service name (metadata, data, auth, etc.)'),
  
  /**
   * Route category
   */
  category: RestApiRouteCategory.describe('Primary category for this route group'),
  
  /**
   * Protocol methods implemented
   */
  methods: z.array(z.string()).optional().describe('Protocol method names implemented'),
  
  /**
   * Detailed endpoint definitions
   */
  endpoints: z.array(RestApiEndpointSchema).optional().describe('Endpoint definitions'),
  
  /**
   * Middleware applied to all routes in this group
   */
  middleware: z.array(MiddlewareConfigSchema).optional().describe('Middleware stack for this route group'),
  
  /**
   * Whether authentication is required for all routes
   */
  authRequired: z.boolean().default(true).describe('Whether authentication is required by default'),
  
  /**
   * OpenAPI documentation
   */
  documentation: z.object({
    title: z.string().optional().describe('Route group title'),
    description: z.string().optional().describe('Route group description'),
    tags: z.array(z.string()).optional().describe('OpenAPI tags'),
  }).optional().describe('Documentation metadata for this route group'),
});

export type RestApiRouteRegistration = z.input<typeof RestApiRouteRegistrationSchema>;
/** Post-parse shape of {@link RestApiRouteRegistration} — defaults applied, transforms run (ADR-0122). */
export type RestApiRouteRegistrationParsed = z.infer<typeof RestApiRouteRegistrationSchema>;

// ==========================================
// Request Validation Configuration
// ==========================================

/**
 * Request Validation Mode Enum
 * Defines how validation errors are handled
 */
export const ValidationMode = z.enum([
  'strict',     // Reject requests with validation errors (400 Bad Request)
  'permissive', // Log validation errors but allow request to proceed
  'strip',      // Remove invalid fields and continue with valid data
]);

export type ValidationMode = z.input<typeof ValidationMode>;

/**
 * Request Validation Configuration Schema
 * Configures Zod-based request validation middleware
 * 
 * @example
 * {
 *   "enabled": true,
 *   "mode": "strict",
 *   "validateBody": true,
 *   "validateQuery": true,
 *   "validateParams": true,
 *   "includeFieldErrors": true
 * }
 */
export const RequestValidationConfigSchema = z.object({
  /**
   * Enable request validation
   */
  enabled: z.boolean().default(true).describe('Enable automatic request validation'),
  
  /**
   * Validation mode
   */
  mode: ValidationMode.default('strict').describe('How to handle validation errors'),
  
  /**
   * Validate request body
   */
  validateBody: z.boolean().default(true).describe('Validate request body against schema'),
  
  /**
   * Validate query parameters
   */
  validateQuery: z.boolean().default(true).describe('Validate query string parameters'),
  
  /**
   * Validate URL parameters
   */
  validateParams: z.boolean().default(true).describe('Validate URL path parameters'),
  
  /**
   * Validate request headers
   */
  validateHeaders: z.boolean().default(false).describe('Validate request headers'),
  
  /**
   * Include detailed field errors in response
   */
  includeFieldErrors: z.boolean().default(true).describe('Include field-level error details in response'),
  
  /**
   * Custom error message prefix
   */
  errorPrefix: z.string().optional().describe('Custom prefix for validation error messages'),
  
  /**
   * Schema registry reference
   */
  schemaRegistry: z.string().optional().describe('Schema registry name to use for validation'),
});

export type RequestValidationConfig = z.input<typeof RequestValidationConfigSchema>;
/** Post-parse shape of {@link RequestValidationConfig} — defaults applied, transforms run (ADR-0122). */
export type RequestValidationConfigParsed = z.infer<typeof RequestValidationConfigSchema>;

// ==========================================
// Response Envelope Configuration
// ==========================================

/**
 * Response Envelope Configuration Schema
 * Configures automatic response wrapping with BaseResponseSchema
 * 
 * @example
 * {
 *   "enabled": true,
 *   "includeMetadata": true,
 *   "includeTimestamp": true,
 *   "includeRequestId": true,
 *   "includeDuration": true
 * }
 */
export const ResponseEnvelopeConfigSchema = z.object({
  /**
   * Enable response envelope wrapping
   */
  enabled: z.boolean().default(true).describe('Enable automatic response envelope wrapping'),
  
  /**
   * Include metadata object
   */
  includeMetadata: z.boolean().default(true).describe('Include meta object in responses'),
  
  /**
   * Include timestamp in metadata
   */
  includeTimestamp: z.boolean().default(true).describe('Include timestamp in response metadata'),
  
  /**
   * Include request ID in metadata
   */
  includeRequestId: z.boolean().default(true).describe('Include requestId in response metadata'),
  
  /**
   * Include request duration in metadata
   */
  includeDuration: z.boolean().default(false).describe('Include request duration in ms'),
  
  /**
   * Include trace ID for distributed tracing
   */
  includeTraceId: z.boolean().default(false).describe('Include distributed traceId'),
  
  /**
   * Custom metadata fields
   */
  customMetadata: z.record(z.string(), z.unknown()).optional().describe('Additional metadata fields to include'),
  
  /**
   * Whether to wrap already-wrapped responses
   */
  skipIfWrapped: z.boolean().default(true).describe('Skip wrapping if response already has success field'),
});

export type ResponseEnvelopeConfig = z.input<typeof ResponseEnvelopeConfigSchema>;
/** Post-parse shape of {@link ResponseEnvelopeConfig} — defaults applied, transforms run (ADR-0122). */
export type ResponseEnvelopeConfigParsed = z.infer<typeof ResponseEnvelopeConfigSchema>;

// ==========================================
// Error Handling Configuration
// ==========================================

/**
 * Error Handling Configuration Schema
 * Configures error handling and ApiErrorSchema formatting
 * 
 * @example
 * {
 *   "enabled": true,
 *   "includeStackTrace": false,
 *   "logErrors": true,
 *   "exposeInternalErrors": false,
 *   "customErrorMessages": {
 *     "validation_error": "The request data is invalid. Please check your input."
 *   }
 * }
 */
export const ErrorHandlingConfigSchema = z.object({
  /**
   * Enable standardized error handling
   */
  enabled: z.boolean().default(true).describe('Enable standardized error handling'),
  
  /**
   * Include stack traces in error responses (dev only)
   */
  includeStackTrace: z.boolean().default(false).describe('Include stack traces in error responses'),
  
  /**
   * Log errors to logger
   */
  logErrors: z.boolean().default(true).describe('Log errors to system logger'),
  
  /**
   * Expose internal error details
   */
  exposeInternalErrors: z.boolean().default(false).describe('Expose internal error details in responses'),
  
  /**
   * Include request ID in errors
   */
  includeRequestId: z.boolean().default(true).describe('Include requestId in error responses'),
  
  /**
   * Include timestamp in errors
   */
  includeTimestamp: z.boolean().default(true).describe('Include timestamp in error responses'),
  
  /**
   * Include error documentation URLs
   */
  includeDocumentation: z.boolean().default(true).describe('Include documentation URLs for errors'),
  
  /**
   * Documentation base URL
   */
  documentationBaseUrl: z.string().url().optional().describe('Base URL for error documentation'),
  
  /**
   * Custom error messages by code
   */
  customErrorMessages: z.record(z.string(), z.string()).optional()
    .describe('Custom error messages by error code'),
  
  /**
   * Sensitive fields to redact from error details
   */
  redactFields: z.array(z.string()).optional().describe('Field names to redact from error details'),
});

export type ErrorHandlingConfig = z.input<typeof ErrorHandlingConfigSchema>;
/** Post-parse shape of {@link ErrorHandlingConfig} — defaults applied, transforms run (ADR-0122). */
export type ErrorHandlingConfigParsed = z.infer<typeof ErrorHandlingConfigSchema>;

// ==========================================
// OpenAPI Documentation Configuration
// ==========================================

/**
 * OpenAPI Generation Configuration Schema
 * Configures automatic OpenAPI documentation generation
 * 
 * @example
 * {
 *   "enabled": true,
 *   "version": "3.0.0",
 *   "title": "ObjectStack API",
 *   "description": "ObjectStack REST API",
 *   "outputPath": "/api/docs/openapi.json",
 *   "uiPath": "/api/docs",
 *   "includeInternal": false,
 *   "generateSchemas": true
 * }
 */
export const OpenApiGenerationConfigSchema = z.object({
  /**
   * Enable OpenAPI generation
   */
  enabled: z.boolean().default(true).describe('Enable automatic OpenAPI documentation generation'),
  
  /**
   * OpenAPI specification version
   */
  version: z.enum(['3.0.0', '3.0.1', '3.0.2', '3.0.3', '3.1.0']).default('3.0.3')
    .describe('OpenAPI specification version'),
  
  /**
   * API title
   */
  title: z.string().default('ObjectStack API').describe('API title'),
  
  /**
   * API description
   */
  description: z.string().optional().describe('API description'),
  
  /**
   * API version
   */
  apiVersion: z.string().default('1.0.0').describe('API version'),
  
  /**
   * Output path for OpenAPI spec
   */
  outputPath: z.string().default('/api/docs/openapi.json').describe('URL path to serve OpenAPI JSON'),
  
  /**
   * UI path for Swagger/Redoc
   */
  uiPath: z.string().default('/api/docs').describe('URL path to serve documentation UI'),
  
  /**
   * UI framework to use
   */
  uiFramework: z.enum(['swagger-ui', 'redoc', 'rapidoc', 'elements']).default('swagger-ui')
    .describe('Documentation UI framework'),
  
  /**
   * Include internal/admin endpoints
   */
  includeInternal: z.boolean().default(false).describe('Include internal endpoints in documentation'),
  
  /**
   * Generate JSON schemas from Zod
   */
  generateSchemas: z.boolean().default(true).describe('Auto-generate schemas from Zod definitions'),
  
  /**
   * Include examples in documentation
   */
  includeExamples: z.boolean().default(true).describe('Include request/response examples'),
  
  /**
   * Server URLs
   */
  servers: z.array(z.object({
    url: z.string().describe('Server URL'),
    description: z.string().optional().describe('Server description'),
  })).optional().describe('Server URLs for API'),
  
  /**
   * Contact information
   */
  contact: z.object({
    name: z.string().optional(),
    url: z.string().url().optional(),
    email: z.string().email().optional(),
  }).optional().describe('API contact information'),
  
  /**
   * License information
   */
  license: z.object({
    name: z.string().describe('License name'),
    url: z.string().url().optional().describe('License URL'),
  }).optional().describe('API license information'),
  
  /**
   * Security schemes
   */
  securitySchemes: z.record(z.string(), z.object({
    type: z.enum(['apiKey', 'http', 'oauth2', 'openIdConnect']),
    scheme: z.string().optional(),
    bearerFormat: z.string().optional(),
  })).optional().describe('Security scheme definitions'),
});

export type OpenApiGenerationConfig = z.input<typeof OpenApiGenerationConfigSchema>;
/** Post-parse shape of {@link OpenApiGenerationConfig} — defaults applied, transforms run (ADR-0122). */
export type OpenApiGenerationConfigParsed = z.infer<typeof OpenApiGenerationConfigSchema>;

// ==========================================
// REST API Plugin Configuration
// ==========================================

/**
 * REST API Plugin Configuration Schema
 * Complete configuration for REST API plugin
 * 
 * @example
 * {
 *   "enabled": true,
 *   "basePath": "/api",
 *   "version": "v1",
 *   "routes": [...],
 *   "validation": { "enabled": true, "mode": "strict" },
 *   "responseEnvelope": { "enabled": true, "includeMetadata": true },
 *   "errorHandling": { "enabled": true, "includeStackTrace": false },
 *   "openApi": { "enabled": true, "title": "ObjectStack API" }
 * }
 */
export const RestApiPluginConfigSchema = z.object({
  /**
   * Enable REST API plugin
   */
  enabled: z.boolean().default(true).describe('Enable REST API plugin'),
  
  /**
   * API base path
   */
  basePath: z.string().default('/api').describe('Base path for all API routes'),
  
  /**
   * API version
   */
  version: z.string().default('v1').describe('API version identifier'),
  
  /**
   * Route registrations
   */
  routes: z.array(RestApiRouteRegistrationSchema).describe('Route registrations'),
  
  /**
   * Request validation configuration
   */
  validation: RequestValidationConfigSchema.optional().describe('Request validation configuration'),
  
  /**
   * Response envelope configuration
   */
  responseEnvelope: ResponseEnvelopeConfigSchema.optional().describe('Response envelope configuration'),
  
  /**
   * Error handling configuration
   */
  errorHandling: ErrorHandlingConfigSchema.optional().describe('Error handling configuration'),
  
  /**
   * OpenAPI documentation configuration
   */
  openApi: OpenApiGenerationConfigSchema.optional().describe('OpenAPI documentation configuration'),
  
  /**
   * Global middleware applied to all routes
   */
  globalMiddleware: z.array(MiddlewareConfigSchema).optional().describe('Global middleware stack'),
  
  /**
   * CORS configuration
   */
  cors: z.object({
    enabled: z.boolean().default(true),
    origins: z.array(z.string()).optional(),
    methods: z.array(HttpMethod).optional(),
    credentials: z.boolean().default(true),
  }).optional().describe('CORS configuration'),
  
  /**
   * Performance settings
   */
  performance: z.object({
    enableCompression: z.boolean().default(true).describe('Enable response compression'),
    enableETag: z.boolean().default(true).describe('Enable ETag generation'),
    enableCaching: z.boolean().default(true).describe('Enable HTTP caching'),
    defaultCacheTtl: z.number().int().default(300).describe('Default cache TTL in seconds'),
  }).optional().describe('Performance optimization settings'),
});

export type RestApiPluginConfig = z.input<typeof RestApiPluginConfigSchema>;
/** Post-parse shape of {@link RestApiPluginConfig} — defaults applied, transforms run (ADR-0122). */
export type RestApiPluginConfigParsed = z.infer<typeof RestApiPluginConfigSchema>;

// ==========================================
// Default Route Registrations
// ==========================================

/**
 * Default Discovery Routes
 * Standard routes for API discovery endpoint
 */
export const DEFAULT_DISCOVERY_ROUTES: RestApiRouteRegistration = {
  prefix: '/api/v1/discovery',
  service: 'metadata',
  category: 'discovery',
  methods: ['getDiscovery'],
  authRequired: false,
  endpoints: [{
    method: 'GET',
    path: '',
    handler: 'getDiscovery',
    category: 'discovery',
    public: true,
    summary: 'Get API discovery information',
    description: 'Returns API version, capabilities, and available routes',
    tags: ['Discovery'],
    responseSchema: 'GetDiscoveryResponseSchema',
    cacheable: true,
    cacheTtl: 3600, // Cache for 1 hour as discovery info rarely changes
  }],
  middleware: [
    { name: 'response_envelope', type: 'transformation', enabled: true, order: 100 },
  ],
};

/**
 * Default Metadata Routes
 * Standard routes for metadata operations
 * 
 * Note: getMetaItemCached is not a separate endpoint - it's handled by the getMetaItem
 * endpoint with HTTP cache headers (ETag, If-None-Match, etc.) for conditional requests.
 */
export const DEFAULT_METADATA_ROUTES: RestApiRouteRegistration = {
  prefix: '/api/v1/meta',
  service: 'metadata',
  category: 'metadata',
  methods: [
    'getMetaTypes', 'getMetaItems', 'getMetaItem', 'getMetaItemLayered', 'saveMetaItem',
    'publishMetaItem',
  ],
  authRequired: true,
  endpoints: [
    {
      method: 'GET',
      path: '',
      handler: 'getMetaTypes',
      category: 'metadata',
      public: false,
      summary: 'List all metadata types',
      description: 'Returns available metadata types (object, field, view, etc.)',
      tags: ['Metadata'],
      responseSchema: 'GetMetaTypesResponseSchema',
      cacheable: true,
      cacheTtl: 3600,
    },
    {
      method: 'GET',
      path: '/:type',
      handler: 'getMetaItems',
      category: 'metadata',
      public: false,
      summary: 'List metadata items of a type',
      description: 'Returns all items of the specified metadata type',
      tags: ['Metadata'],
      responseSchema: 'GetMetaItemsResponseSchema',
      cacheable: true,
      cacheTtl: 3600,
    },
    {
      method: 'GET',
      path: '/:type/:name',
      handler: 'getMetaItem',
      category: 'metadata',
      public: false,
      summary: 'Get specific metadata item',
      description: 'Returns a specific metadata item by type and name',
      tags: ['Metadata'],
      // No `requestSchema` (#3899): every input (`:type`, `:name`, `?packageId`)
      // is path/query-bound, so `GetMetaItemRequestSchema` — still the protocol
      // METHOD contract — can never be violated by a request body. Declaring it
      // here read as "this endpoint 400s a bad body", a validation no route
      // performs or could perform.
      responseSchema: 'GetMetaItemResponseSchema',
      cacheable: true,
      cacheTtl: 3600,
    },
    {
      method: 'GET',
      path: '/:type/:name/layers',
      handler: 'getMetaItemLayered',
      category: 'metadata',
      public: false,
      summary: 'Get a metadata item as its three layers (code / overlay / effective)',
      description:
        'Diagnostic projection powering Studio\'s "code default vs override vs effective" '
        + 'comparison: the packaged baseline, the tenant customization row, and the merged '
        + 'result side by side. A DIFFERENT representation from `GET /:type/:name`, which '
        + 'answers only the merged value under `item` — hence its own path and its own '
        + 'response schema (#5882). Reached until now only as `GET /:type/:name?layers=true`, '
        + 'which still works during its deprecation window but is answered with '
        + '`Deprecation` / `Link` headers pointing here.',
      tags: ['Metadata'],
      // No `requestSchema`, for the same reason as `GET /:type/:name` above
      // (#3899): every input is path/query-bound, so no request body exists to
      // validate and declaring one would advertise a gate that cannot run.
      responseSchema: 'GetMetaItemLayeredResponseSchema',
      // Not cacheable: this is a diagnostic read that deliberately bypasses the
      // metadata cache so it always reflects the live overlay row.
      cacheable: false,
    },
    {
      method: 'PUT',
      path: '/:type/:name',
      handler: 'saveMetaItem',
      category: 'metadata',
      public: false,
      summary: 'Create or update metadata item',
      description: 'Creates or updates a metadata item',
      tags: ['Metadata'],
      // No `requestSchema` (#3899): `SaveMetaItemRequestSchema.item` is
      // `z.unknown()`, so an entry parse can never fail — the declaration
      // promised a gate with no teeth. The REAL request gate is the metadata
      // layer's per-type validation behind `saveMetaItem`, which rejects an
      // off-spec item with 422 + `issues`.
      responseSchema: 'SaveMetaItemResponseSchema',
      permissions: ['metadata.write'],
      cacheable: false,
    },
    {
      method: 'POST',
      path: '/:type/:name/publish',
      handler: 'publishMetaItem',
      category: 'metadata',
      public: false,
      summary: 'Publish the pending draft overlay (promotes draft → active)',
      description:
        'Promotes the item\'s pending DRAFT overlay to the live `active` row and records an '
        + '`op=\'publish\'` history event. The sibling write door of `PUT /:type/:name` — the '
        + 'ADR-0033 two-step spelling, where `?mode=draft` stages a body and this makes it live. '
        + '404 `[no_draft]` when there is nothing to publish; 409 `metadata_conflict` when the '
        + 'published row advanced while the draft was held. Served since before #7294 with no '
        + 'declaration behind it — this entry is what makes its response contract nameable.',
      tags: ['Metadata'],
      // No `requestSchema` (#3899): the body is optional and its only read key
      // is `message`, taken only when it is already a string and ignored
      // otherwise — the route cannot 400 a malformed body, so declaring a
      // schema here would advertise a gate that does not run. Every other
      // input (`:type`, `:name`) is path-bound.
      responseSchema: 'PublishMetaItemResponseSchema',
      permissions: ['metadata.write'],
      cacheable: false,
    },
  ],
  middleware: [
    { name: 'auth', type: 'authentication', enabled: true, order: 10 },
    { name: 'validation', type: 'validation', enabled: true, order: 20 },
    { name: 'response_envelope', type: 'transformation', enabled: true, order: 100 },
  ],
};

/**
 * Default Data CRUD Routes
 * Standard routes for data operations
 */
export const DEFAULT_DATA_CRUD_ROUTES: RestApiRouteRegistration = {
  prefix: '/api/v1/data',
  service: 'data',
  category: 'data',
  methods: ['findData', 'getData', 'createData', 'updateData', 'deleteData'],
  authRequired: true,
  endpoints: [
    {
      method: 'GET',
      path: '/:object',
      handler: 'findData',
      category: 'data',
      public: false,
      summary: 'Query records',
      description: 'Query records with filtering, sorting, and pagination',
      tags: ['Data'],
      // No `requestSchema` (#3899): a GET carries its query in the query
      // string, where every value is a string — `FindDataRequestSchema`'s typed
      // `query` (QuerySchema: numeric limit/offset, structured where) cannot
      // describe it, and nothing ever validated it. The schema-guarded spelling
      // of this operation is `POST /:object/query` below.
      responseSchema: 'ListRecordResponseSchema',
      permissions: ['data.read'],
      cacheable: false,
    },
    {
      // The QueryAST-in-body spelling of `findData` — what `client.data.query()`
      // posts. Mounted by `@objectstack/rest` since forever, but absent from
      // this table until #3899 wired its request contract: the body is the
      // QueryAST (`spec/data/query.zod.ts`), validated at the route via
      // `FindDataRequestSchema` with the PATH object written last (#3946), so a
      // malformed body 400s instead of degrading into an unfiltered full read.
      method: 'POST',
      path: '/:object/query',
      handler: 'findData',
      category: 'data',
      public: false,
      summary: 'Advanced query (QueryAST in body)',
      description: 'Query records with a structured QueryAST request body (filter, sort, aggregation, expansion)',
      tags: ['Data'],
      requestSchema: 'FindDataRequestSchema',
      responseSchema: 'FindDataResponseSchema',
      permissions: ['data.read'],
      cacheable: false,
    },
    {
      method: 'GET',
      path: '/:object/:id',
      handler: 'getData',
      category: 'data',
      public: false,
      summary: 'Get record by ID',
      description: 'Retrieve a single record by its ID',
      tags: ['Data'],
      // No `requestSchema` (#3899): `:id` is path-bound and always a string —
      // `IdRequestSchema` can never be violated by a request body.
      responseSchema: 'SingleRecordResponseSchema',
      permissions: ['data.read'],
      cacheable: false,
    },
    {
      method: 'POST',
      path: '/:object',
      handler: 'createData',
      category: 'data',
      public: false,
      summary: 'Create record',
      description: 'Create a new record',
      tags: ['Data'],
      // Was 'CreateRequestSchema' — the generic service-contract envelope
      // (`{ data }`), which is NOT what this route receives: the wire body IS
      // the bare record. `CreateDataRequestSchema` is the protocol request the
      // route assembles ({ object } from the path + `data` = body) and, since
      // #3899, validates before dispatch.
      requestSchema: 'CreateDataRequestSchema',
      responseSchema: 'SingleRecordResponseSchema',
      permissions: ['data.create'],
      cacheable: false,
    },
    {
      method: 'PATCH',
      path: '/:object/:id',
      handler: 'updateData',
      category: 'data',
      public: false,
      summary: 'Update record',
      description: 'Update an existing record',
      tags: ['Data'],
      // Was 'UpdateRequestSchema' — same mismatch as create: the wire body is
      // the bare field patch (plus optional `expectedVersion`, stripped into
      // its own protocol field). `UpdateDataRequestSchema` is what the route
      // assembles from path + body and, since #3899, validates.
      requestSchema: 'UpdateDataRequestSchema',
      responseSchema: 'SingleRecordResponseSchema',
      permissions: ['data.update'],
      cacheable: false,
    },
    {
      method: 'DELETE',
      path: '/:object/:id',
      handler: 'deleteData',
      category: 'data',
      public: false,
      summary: 'Delete record',
      description: 'Delete a record by ID',
      tags: ['Data'],
      // No `requestSchema` (#3899): DELETE carries no body; `:id` is
      // path-bound (`?expectedVersion` rides the query string / If-Match).
      responseSchema: 'DeleteResponseSchema',
      permissions: ['data.delete'],
      cacheable: false,
    },
  ],
  middleware: [
    { name: 'auth', type: 'authentication', enabled: true, order: 10 },
    { name: 'validation', type: 'validation', enabled: true, order: 20 },
    { name: 'response_envelope', type: 'transformation', enabled: true, order: 100 },
    { name: 'error_handler', type: 'error', enabled: true, order: 200 },
  ],
};

/**
 * Default Batch Routes
 * Standard routes for batch operations
 */
export const DEFAULT_BATCH_ROUTES: RestApiRouteRegistration = {
  prefix: '/api/v1/data/:object',
  service: 'data',
  category: 'batch',
  methods: ['batchData', 'createManyData', 'updateManyData', 'deleteManyData'],
  authRequired: true,
  endpoints: [
    {
      method: 'POST',
      path: '/batch',
      handler: 'batchData',
      category: 'batch',
      public: false,
      summary: 'Batch operation',
      description: 'Execute a batch operation (create, update, upsert, delete)',
      tags: ['Batch'],
      requestSchema: 'BatchUpdateRequestSchema',
      responseSchema: 'BatchUpdateResponseSchema',
      permissions: ['data.batch'],
      timeout: 60000, // 60 seconds for batch operations
      cacheable: false,
    },
    {
      method: 'POST',
      path: '/createMany',
      handler: 'createManyData',
      category: 'batch',
      public: false,
      summary: 'Batch create',
      description: 'Create multiple records in a single operation',
      tags: ['Batch'],
      // Was 'CreateManyRequestSchema' — a name no schema ever exported (the real
      // request contract is CreateManyDataRequestSchema in protocol.zod.ts). A
      // dangling documentation reference; point it at the schema that exists.
      // NOTE the wire body is the BARE records array (what `client.data
      // .createMany` posts); the route assembles `{ object }` from the path +
      // `records` = body and, since #3899, validates that assembly before
      // dispatch.
      requestSchema: 'CreateManyDataRequestSchema',
      responseSchema: 'BatchUpdateResponseSchema',
      permissions: ['data.create', 'data.batch'],
      timeout: 60000,
      cacheable: false,
    },
    {
      method: 'POST',
      path: '/updateMany',
      handler: 'updateManyData',
      category: 'batch',
      public: false,
      summary: 'Batch update',
      description: 'Update multiple records in a single operation',
      tags: ['Batch'],
      requestSchema: 'UpdateManyRequestSchema',
      responseSchema: 'BatchUpdateResponseSchema',
      permissions: ['data.update', 'data.batch'],
      timeout: 60000,
      cacheable: false,
    },
    {
      method: 'POST',
      path: '/deleteMany',
      handler: 'deleteManyData',
      category: 'batch',
      public: false,
      summary: 'Batch delete',
      description: 'Delete multiple records in a single operation',
      tags: ['Batch'],
      requestSchema: 'DeleteManyRequestSchema',
      responseSchema: 'BatchUpdateResponseSchema',
      permissions: ['data.delete', 'data.batch'],
      timeout: 60000,
      cacheable: false,
    },
  ],
  middleware: [
    { name: 'auth', type: 'authentication', enabled: true, order: 10 },
    { name: 'validation', type: 'validation', enabled: true, order: 20 },
    { name: 'response_envelope', type: 'transformation', enabled: true, order: 100 },
    { name: 'error_handler', type: 'error', enabled: true, order: 200 },
  ],
};

// The Permission / View / Workflow / Realtime route tables were deleted
// (#3612): no server ever mounted those routes and nothing consumed the
// tables — they only underwrote dead client SDK namespaces (removed in the
// same change). Same disease, same cure as DEFAULT_DISPATCHER_ROUTES (#3586).

// ==========================================
// Notification Routes
// ==========================================

/**
 * Default Notification Routes
 * Standard routes for notification management (device registration, preferences, listing)
 */
export const DEFAULT_NOTIFICATION_ROUTES: RestApiRouteRegistration = {
  prefix: '/api/v1/notifications',
  service: 'notification',
  category: 'notification',
  methods: [
    'listNotifications', 'markNotificationsRead', 'markAllNotificationsRead',
  ],
  authRequired: true,
  // The device-registration and preferences endpoints are GONE from this table
  // (#3899). `POST/DELETE /devices*` and `GET/PATCH /preferences` were removed
  // as SERVER routes in #3612 — in fact they were never built ("the
  // /notifications/devices and /notifications/preferences server routes that
  // ADR-0012 describes were never built", packages/client/src/index.ts) — yet
  // this table kept declaring them, requestSchema and all, so the catalog
  // promised validation on routes that 404. Same disease, same cure as
  // DEFAULT_AI_ROUTES (#3718). The `RegisterDevice*` / `*Preferences*` schemas
  // in protocol.zod.ts remain exported as protocol-method contracts.
  endpoints: [
    {
      method: 'GET',
      path: '',
      handler: 'listNotifications',
      category: 'notification',
      public: false,
      summary: 'List notifications',
      // NOT "paginated" (#6361). The route answers the newest `limit` rows and
      // stops; there is no continuation token on either half of the contract
      // since `cursor` was removed in protocol 17. The catalog is a
      // machine-readable surface (Route & surface ownership rule 4), so a
      // pagination claim here is read by SDKs and codegen as a capability.
      description: 'Returns the newest window of notifications for the current user (not paginated)',
      tags: ['Notifications'],
      responseSchema: 'ListNotificationsResponseSchema',
      cacheable: false,
    },
    {
      method: 'POST',
      path: '/read',
      handler: 'markNotificationsRead',
      category: 'notification',
      public: false,
      summary: 'Mark notifications as read',
      description: 'Marks specific notifications as read by their IDs',
      tags: ['Notifications'],
      requestSchema: 'MarkNotificationsReadRequestSchema',
      responseSchema: 'MarkNotificationsReadResponseSchema',
      cacheable: false,
    },
    {
      method: 'POST',
      path: '/read/all',
      handler: 'markAllNotificationsRead',
      category: 'notification',
      public: false,
      summary: 'Mark all notifications as read',
      description: 'Marks all notifications as read for the current user',
      tags: ['Notifications'],
      responseSchema: 'MarkAllNotificationsReadResponseSchema',
      cacheable: false,
    },
  ],
  middleware: [
    { name: 'auth', type: 'authentication', enabled: true, order: 10 },
    { name: 'validation', type: 'validation', enabled: true, order: 20 },
    { name: 'response_envelope', type: 'transformation', enabled: true, order: 100 },
  ],
};

// ==========================================
// AI Routes
// ==========================================

// `DEFAULT_AI_ROUTES` is GONE (#3718).
//
// It declared `POST /api/v1/ai/{nlq,suggest,insights}` with handlers
// `aiNlq` / `aiSuggest` / `aiInsights`. Nothing ever mounted those paths and
// nothing ever implemented those handlers, so all three 404ed for the whole
// life of the declaration — while `client.ai.nlq/suggest/insights` called them
// and this table made them look registered.
//
// It could not have been otherwise: this registration table has **no runtime
// consumer**. Only `getDefaultRouteRegistrations()` returned it, and only this
// package's own tests read that. Re-declaring the routes that DO exist here
// would recreate the same illusion, because the AI service is a Cloud/EE
// package (`service-ai`, in the `cloud` repo) and this repo's dispatcher only
// proxies `/api/v1/ai/**` to whatever `buildAIRoutes()` mounted.
//
// The real table is enumerated where it is mounted — `cloud`'s
// `packages/service-ai/src/ai-route-ledger.ts`, whose conformance test reads
// `buildAIRoutes()` directly and drives `client.ai.*` against it. The wire
// shapes are `Ai*Schema` in `protocol.zod.ts`; the docs table is
// `content/docs/api/plugin-endpoints.mdx`.

// ==========================================
// i18n Routes
// ==========================================

/**
 * Default i18n Routes
 * Standard routes for internationalization operations
 */
export const DEFAULT_I18N_ROUTES: RestApiRouteRegistration = {
  prefix: '/api/v1/i18n',
  service: 'i18n',
  category: 'i18n',
  methods: ['getLocales', 'getTranslations', 'getFieldLabels'],
  authRequired: true,
  endpoints: [
    {
      method: 'GET',
      path: '/locales',
      handler: 'getLocales',
      category: 'i18n',
      public: false,
      summary: 'Get available locales',
      description: 'Returns all available locales with their metadata',
      tags: ['i18n'],
      responseSchema: 'GetLocalesResponseSchema',
      cacheable: true,
      cacheTtl: 86400, // 24 hours — locales change very rarely
    },
    {
      method: 'GET',
      path: '/translations/:locale',
      handler: 'getTranslations',
      category: 'i18n',
      public: false,
      summary: 'Get translations for a locale',
      description: "Returns the specified locale's full translation bundle",
      tags: ['i18n'],
      responseSchema: 'GetTranslationsResponseSchema',
      cacheable: true,
      cacheTtl: 3600,
    },
    {
      method: 'GET',
      path: '/labels/:object/:locale',
      handler: 'getFieldLabels',
      category: 'i18n',
      public: false,
      summary: 'Get translated field labels',
      description: 'Returns translated field labels, help text, and option labels for an object',
      tags: ['i18n'],
      responseSchema: 'GetFieldLabelsResponseSchema',
      cacheable: true,
      cacheTtl: 3600,
    },
  ],
  middleware: [
    { name: 'auth', type: 'authentication', enabled: true, order: 10 },
    { name: 'response_envelope', type: 'transformation', enabled: true, order: 100 },
  ],
};

// ==========================================
// Analytics Routes
// ==========================================

/**
 * Default Analytics Routes
 * Standard routes for analytics and BI operations
 */
export const DEFAULT_ANALYTICS_ROUTES: RestApiRouteRegistration = {
  prefix: '/api/v1/analytics',
  service: 'analytics',
  category: 'analytics',
  methods: ['analyticsQuery', 'getAnalyticsMeta'],
  authRequired: true,
  endpoints: [
    {
      method: 'POST',
      path: '/query',
      handler: 'analyticsQuery',
      category: 'analytics',
      public: false,
      summary: 'Execute analytics query',
      description: 'Executes a structured analytics query against the semantic layer',
      tags: ['Analytics'],
      requestSchema: 'AnalyticsQueryRequestSchema',
      responseSchema: 'AnalyticsResultResponseSchema',
      permissions: ['analytics.query'],
      timeout: 120000, // 2 minutes for analytics queries
      cacheable: false,
    },
    {
      method: 'GET',
      path: '/meta',
      handler: 'getAnalyticsMeta',
      category: 'analytics',
      public: false,
      summary: 'Get analytics metadata',
      description: 'Returns available cubes, dimensions, measures, and segments',
      tags: ['Analytics'],
      responseSchema: 'AnalyticsMetadataResponseSchema',
      cacheable: true,
      cacheTtl: 3600,
    },
  ],
  middleware: [
    { name: 'auth', type: 'authentication', enabled: true, order: 10 },
    { name: 'validation', type: 'validation', enabled: true, order: 20 },
    { name: 'response_envelope', type: 'transformation', enabled: true, order: 100 },
    { name: 'error_handler', type: 'error', enabled: true, order: 200 },
  ],
};

// ==========================================
// Automation Routes
// ==========================================

/**
 * Default Automation Routes
 * Standard routes for automation triggers
 */
export const DEFAULT_AUTOMATION_ROUTES: RestApiRouteRegistration = {
  prefix: '/api/v1/automation',
  service: 'automation',
  category: 'automation',
  methods: ['triggerAutomation'],
  authRequired: true,
  endpoints: [
    {
      method: 'POST',
      // Was '/trigger' — a path no server has ever mounted. The real mounts
      // are `POST /trigger/:name` (what `client.automation.trigger()` calls)
      // and the alias `POST /:name/trigger`; the flow name rides the PATH, not
      // the body (#3899).
      path: '/trigger/:name',
      handler: 'triggerAutomation',
      category: 'automation',
      public: false,
      summary: 'Trigger automation',
      description:
        'Triggers an automation flow by name (path param). Alias mount: POST /:name/trigger. '
        + 'The body is the flow trigger context ({ recordId?, objectName?, params? }; unknown '
        + 'top-level keys are forwarded as flow params).',
      tags: ['Automation'],
      // No `requestSchema` (#3899): 'AutomationTriggerRequestSchema'
      // ({ trigger, payload }) described a wire shape this route never had —
      // the name is path-bound and the body is a lenient params bag translated
      // by the dispatcher's `buildAutomationContext`. Declaring that schema
      // here promised a 400 nothing performs; it remains exported as the
      // protocol-method contract only.
      responseSchema: 'AutomationTriggerResponseSchema',
      permissions: ['automation.trigger'],
      timeout: 120000, // 2 minutes for long-running automations
      cacheable: false,
    },
    {
      method: 'GET',
      path: '/actions',
      handler: 'getActionDescriptors',
      category: 'automation',
      public: false,
      summary: 'List automation actions',
      description:
        'Returns the live action/node registry (built-in + plugin-contributed) backing the ' +
        'designer palette and flow validation. Supports ?paradigm, ?source, and ?category filters (ADR-0018).',
      tags: ['Automation'],
      responseSchema: 'AutomationActionsResponseSchema',
      permissions: ['automation.read'],
      cacheable: true,
    },
  ],
  middleware: [
    { name: 'auth', type: 'authentication', enabled: true, order: 10 },
    { name: 'validation', type: 'validation', enabled: true, order: 20 },
    { name: 'response_envelope', type: 'transformation', enabled: true, order: 100 },
    { name: 'error_handler', type: 'error', enabled: true, order: 200 },
  ],
};

// ==========================================
// Helper Functions
// ==========================================

/**
 * Helper to create REST API plugin configuration
 */
export const RestApiPluginConfig = Object.assign(RestApiPluginConfigSchema, {
  create: <T extends z.input<typeof RestApiPluginConfigSchema>>(config: T) => config,
});

/**
 * Helper to create route registration
 */
export const RestApiRouteRegistration = Object.assign(RestApiRouteRegistrationSchema, {
  create: <T extends z.input<typeof RestApiRouteRegistrationSchema>>(registration: T) => registration,
});

/**
 * Get all default route registrations.
 * Returns the complete set of standard REST API routes covering all protocol namespaces.
 * 
 * Route groups (8 total):
 * 1. Discovery - API capabilities and routing info
 * 2. Metadata - Object/field schema CRUD
 * 3. Data CRUD - Record operations
 * 4. Batch - Bulk operations
 * 5. Notification - Push notifications and preferences
 * 6. i18n - Locales and translations
 * 7. Analytics - BI queries and metadata
 * 8. Automation - Trigger flows and scripts
 *
 * AI is deliberately absent: its routes are mounted by a Cloud/EE package in
 * the `cloud` repo, never from here, and the group that used to sit at #6
 * declared three endpoints nothing has ever served (#3718).
 */
export function getDefaultRouteRegistrations(): RestApiRouteRegistration[] {
  return [
    DEFAULT_DISCOVERY_ROUTES,
    DEFAULT_METADATA_ROUTES,
    DEFAULT_DATA_CRUD_ROUTES,
    DEFAULT_BATCH_ROUTES,
    DEFAULT_NOTIFICATION_ROUTES,
    DEFAULT_I18N_ROUTES,
    DEFAULT_ANALYTICS_ROUTES,
    DEFAULT_AUTOMATION_ROUTES,
  ];
}

// ==========================================
// Route Coverage Report — RETIRED (#13823)
// ==========================================
//
// `RouteCoverageEntrySchema` / `RouteCoverageReportSchema` (and their
// `RouteCoverageEntry` / `RouteCoverageReport` types) left the published set
// whole in this retirement — the record is above `HANDLER_STATUS_RETIRED`.
// The docblock that stood here said adapters SHOULD warn on every endpoint
// with `handlerStatus !== 'implemented'` and emit the report as startup
// health diagnostics; no adapter, dispatcher or registrar ever constructed
// one, so the report was a shape with no producer and the status it
// aggregated had no reader. Registered as `api/RouteCoverageEntry` and
// `api/RouteCoverageReport` in `RETIRED_DEFS_BY_MAJOR[18]`. Route readiness
// that IS measured is unchanged and lives elsewhere: the discovery payload's
// per-service `status` / `handlerReady` (`api/discovery.zod.ts`) and the
// CI-asserted route ledger (`packages/runtime/src/route-ledger.ts`).
