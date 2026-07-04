// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { z } from 'zod';
import { HttpMethod } from '../shared/http.zod';

/**
 * REST API Server Protocol
 * 
 * Defines the REST API server configuration for automatically generating
 * RESTful CRUD endpoints, metadata endpoints, and batch operations.
 * 
 * Features:
 * - Automatic CRUD endpoint generation from Object definitions
 * - Standard REST conventions (GET, POST, PUT, PATCH, DELETE)
 * - Metadata API endpoints
 * - Batch operation endpoints
 * - OpenAPI/Swagger documentation generation
 * 
 * Architecture alignment:
 * - Salesforce: REST API with Object CRUD
 * - Microsoft Dynamics: Web API with entity operations
 * - Strapi: Auto-generated REST endpoints
 */

// ==========================================
// REST API Configuration
// ==========================================

/**
 * REST API Configuration Schema
 * Core configuration for REST API server
 * 
 * @example
 * {
 *   "version": "v1",
 *   "basePath": "/api",
 *   "enableCrud": true,
 *   "enableMetadata": true,
 *   "enableBatch": true,
 *   "documentation": {
 *     "enabled": true,
 *     "title": "ObjectStack API"
 *   }
 * }
 */
import { lazySchema } from '../shared/lazy-schema';
export const RestApiConfigSchema = lazySchema(() => z.object({
  /**
   * API version identifier
   */
  version: z.string().regex(/^[a-zA-Z0-9_\-\.]+$/).default('v1').describe('API version (e.g., v1, v2, 2024-01)'),
  
  /**
   * Base path for all API routes
   */
  basePath: z.string().default('/api').describe('Base URL path for API'),
  
  /**
   * Full API path (combines basePath and version)
   */
  apiPath: z.string().optional().describe('Full API path (defaults to {basePath}/{version})'),
  
  /**
   * Enable automatic CRUD endpoints
   */
  enableCrud: z.boolean().default(true).describe('Enable automatic CRUD endpoint generation'),
  
  /**
   * Enable metadata endpoints
   */
  enableMetadata: z.boolean().default(true).describe('Enable metadata API endpoints'),
  
  /**
   * Enable UI API endpoints
   */
  enableUi: z.boolean().default(true).describe('Enable UI API endpoints (Views, Menus, Layouts)'),
  
  /**
   * Enable batch operation endpoints
   */
  enableBatch: z.boolean().default(true).describe('Enable batch operation endpoints'),
  
  /**
   * Enable API discovery endpoint
   */
  enableDiscovery: z.boolean().default(true).describe('Enable API discovery endpoint'),

  /**
   * Enable OpenAPI 3.1 spec endpoints — `GET <basePath>/openapi.json`
   * for the machine-readable contract and `GET <basePath>/docs` for a
   * zero-dep Scalar-rendered HTML viewer. The spec ships pre-generated
   * from @objectstack/spec and is enriched at request time with the
   * actual server URL + the runtime-registered objects (so `{object}`
   * placeholders expand into one path per concrete table).
   */
  enableOpenApi: z.boolean().default(true).describe('Enable OpenAPI 3.1 spec & docs viewer endpoints'),

  /**
   * Enable project-scoped routing (/api/v1/environments/:environmentId/data/...)
   * When true, all data/meta/AI APIs are scoped under /environments/:environmentId
   * Control plane routes (/auth, /cloud) remain unscoped
   */
  enableProjectScoping: z.boolean().default(false)
    .describe('Enable project-scoped routing for data/meta/AI APIs'),

  /**
   * Project ID resolution strategy when enableProjectScoping is true
   * - 'required': environmentId must be in URL (strict, recommended for production)
   * - 'optional': environmentId can be in URL or fallback to headers/session
   * - 'auto': backward compatible - accepts both scoped and unscoped routes
   */
  projectResolution: z.enum(['required', 'optional', 'auto']).default('auto')
    .describe('Project ID resolution strategy'),

  /**
   * When `true`, all `/data/*` CRUD + batch endpoints reject anonymous
   * requests with HTTP 401 before reaching ObjectQL. This is the REST-layer
   * counterpart to the security plugin's RBAC enforcement and the
   * **only** defense for deployments where the security plugin is not
   * mounted (legacy bare-runtime hosts) or where it would otherwise fall
   * through anonymous traffic.
   *
   * **Default `true` — secure by default (ADR-0056 D2).** Anonymous access
   * to the data API must be an explicit deployment decision
   * (`requireAuth: false`), not a silent fallthrough. Legitimate anonymous
   * surfaces survive the deny posture without any opt-out: the control
   * plane (`/auth`, `/health`, `/discovery`) is exempt, share-links read
   * under a system context after token validation, and public-form
   * submission is self-authorizing via the declaration-derived
   * `publicFormGrant` (create + read-back on the declared target object
   * only). Demo/playground deployments that intentionally serve data
   * publicly must now set `requireAuth: false` explicitly — the REST
   * plugin logs a boot warning when they do.
   */
  requireAuth: z.boolean().default(true)
    .describe('Reject anonymous requests on /data/* with HTTP 401 (secure-by-default; set false to serve data publicly)'),

  /**
   * API documentation configuration
   */
  documentation: z.object({
    enabled: z.boolean().default(true).describe('Enable API documentation'),
    title: z.string().default('ObjectStack API').describe('API documentation title'),
    description: z.string().optional().describe('API description'),
    version: z.string().optional().describe('Documentation version'),
    termsOfService: z.string().optional().describe('Terms of service URL'),
    contact: z.object({
      name: z.string().optional(),
      url: z.string().optional(),
      email: z.string().optional(),
    }).optional(),
    license: z.object({
      name: z.string(),
      url: z.string().optional(),
    }).optional(),
  }).optional().describe('OpenAPI/Swagger documentation config'),
  
  /**
   * Response format configuration
   */
  responseFormat: z.object({
    envelope: z.boolean().default(true).describe('Wrap responses in standard envelope'),
    includeMetadata: z.boolean().default(true).describe('Include response metadata (timestamp, requestId)'),
    includePagination: z.boolean().default(true).describe('Include pagination info in list responses'),
  }).optional().describe('Response format options'),
}));

export type RestApiConfig = z.infer<typeof RestApiConfigSchema>;
export type RestApiConfigInput = z.input<typeof RestApiConfigSchema>;

// ==========================================
// CRUD Endpoint Configuration
// ==========================================

/**
 * CRUD Operation Type Enum
 */
export const CrudOperation = z.enum([
  'create',   // POST /api/v1/data/{object}
  'read',     // GET /api/v1/data/{object}/:id
  'update',   // PATCH /api/v1/data/{object}/:id
  'delete',   // DELETE /api/v1/data/{object}/:id
  'list',     // GET /api/v1/data/{object}
]);

export type CrudOperation = z.infer<typeof CrudOperation>;

/**
 * CRUD Endpoint Pattern Schema
 * Defines the URL pattern for CRUD operations
 * 
 * @example
 * {
 *   "create": { "method": "POST", "path": "/data/{object}" },
 *   "read": { "method": "GET", "path": "/data/{object}/:id" },
 *   "update": { "method": "PATCH", "path": "/data/{object}/:id" },
 *   "delete": { "method": "DELETE", "path": "/data/{object}/:id" },
 *   "list": { "method": "GET", "path": "/data/{object}" }
 * }
 */
export const CrudEndpointPatternSchema = lazySchema(() => z.object({
  /**
   * HTTP method
   */
  method: HttpMethod.describe('HTTP method'),
  
  /**
   * URL path pattern (relative to API base)
   */
  path: z.string().describe('URL path pattern'),
  
  /**
   * Operation summary for documentation
   */
  summary: z.string().optional().describe('Operation summary'),
  
  /**
   * Operation description
   */
  description: z.string().optional().describe('Operation description'),
}));

export type CrudEndpointPattern = z.infer<typeof CrudEndpointPatternSchema>;

/**
 * CRUD Endpoints Configuration Schema
 * Configuration for automatic CRUD endpoint generation
 */
export const CrudEndpointsConfigSchema = lazySchema(() => z.object({
  /**
   * Enable/disable specific CRUD operations
   */
  operations: z.object({
    create: z.boolean().default(true).describe('Enable create operation'),
    read: z.boolean().default(true).describe('Enable read operation'),
    update: z.boolean().default(true).describe('Enable update operation'),
    delete: z.boolean().default(true).describe('Enable delete operation'),
    list: z.boolean().default(true).describe('Enable list operation'),
  }).optional().describe('Enable/disable operations'),
  
  /**
   * Custom endpoint patterns (override defaults)
   */
  patterns: z.record(CrudOperation, CrudEndpointPatternSchema.optional()).optional()
    .describe('Custom URL patterns for operations'),
  
  /**
   * Path prefix for data operations
   */
  dataPrefix: z.string().default('/data').describe('URL prefix for data endpoints'),
  
  /**
   * Object name parameter style
   */
  objectParamStyle: z.enum(['path', 'query']).default('path')
    .describe('How object name is passed (path param or query param)'),
}));

export type CrudEndpointsConfig = z.infer<typeof CrudEndpointsConfigSchema>;
export type CrudEndpointsConfigInput = z.input<typeof CrudEndpointsConfigSchema>;

// ==========================================
// Metadata Endpoint Configuration
// ==========================================

/**
 * Metadata Endpoint Configuration Schema
 * Configuration for metadata API endpoints
 * 
 * @example
 * {
 *   "prefix": "/meta",
 *   "enableCache": true,
 *   "endpoints": {
 *     "types": true,
 *     "objects": true,
 *     "fields": true
 *   }
 * }
 */
export const MetadataEndpointsConfigSchema = lazySchema(() => z.object({
  /**
   * Path prefix for metadata operations
   */
  prefix: z.string().default('/meta').describe('URL prefix for metadata endpoints'),
  
  /**
   * Enable HTTP caching for metadata
   */
  enableCache: z.boolean().default(true).describe('Enable HTTP cache headers (ETag, Last-Modified)'),
  
  /**
   * Cache TTL in seconds
   */
  cacheTtl: z.number().int().default(3600).describe('Cache TTL in seconds'),
  
  /**
   * Enable specific metadata endpoints
   */
  endpoints: z.object({
    types: z.boolean().default(true).describe('GET /meta - List all metadata types'),
    items: z.boolean().default(true).describe('GET /meta/:type - List items of type'),
    item: z.boolean().default(true).describe('GET /meta/:type/:name - Get specific item'),
    schema: z.boolean().default(true).describe('GET /meta/:type/:name/schema - Get JSON schema'),
  }).optional().describe('Enable/disable specific endpoints'),
}));

export type MetadataEndpointsConfig = z.infer<typeof MetadataEndpointsConfigSchema>;
export type MetadataEndpointsConfigInput = z.input<typeof MetadataEndpointsConfigSchema>;

// ==========================================
// Batch Operation Endpoint Configuration
// ==========================================

/**
 * Batch Operation Endpoint Configuration Schema
 * Configuration for batch/bulk operation endpoints
 * 
 * @example
 * {
 *   "maxBatchSize": 200,
 *   "enableBatchEndpoint": true,
 *   "enableCreateMany": true,
 *   "enableUpdateMany": true,
 *   "enableDeleteMany": true
 * }
 */
export const BatchEndpointsConfigSchema = lazySchema(() => z.object({
  /**
   * Maximum batch size
   */
  maxBatchSize: z.number().int().min(1).max(1000).default(200)
    .describe('Maximum records per batch operation'),
  
  /**
   * Enable generic batch endpoint
   */
  enableBatchEndpoint: z.boolean().default(true)
    .describe('Enable POST /data/:object/batch endpoint'),
  
  /**
   * Enable specific batch operations
   */
  operations: z.object({
    createMany: z.boolean().default(true).describe('Enable POST /data/:object/createMany'),
    updateMany: z.boolean().default(true).describe('Enable POST /data/:object/updateMany'),
    deleteMany: z.boolean().default(true).describe('Enable POST /data/:object/deleteMany'),
    upsertMany: z.boolean().default(true).describe('Enable POST /data/:object/upsertMany'),
  }).optional().describe('Enable/disable specific batch operations'),
  
  /**
   * Transaction mode default
   */
  defaultAtomic: z.boolean().default(true)
    .describe('Default atomic/transaction mode for batch operations'),
}));

export type BatchEndpointsConfig = z.infer<typeof BatchEndpointsConfigSchema>;
export type BatchEndpointsConfigInput = z.input<typeof BatchEndpointsConfigSchema>;

// ==========================================
// Route Generation Configuration
// ==========================================

/**
 * Route Generation Configuration Schema
 * Controls automatic route generation for objects
 */
export const RouteGenerationConfigSchema = lazySchema(() => z.object({
  /**
   * Objects to include (if empty, include all)
   */
  includeObjects: z.array(z.string()).optional()
    .describe('Specific objects to generate routes for (empty = all)'),
  
  /**
   * Objects to exclude
   */
  excludeObjects: z.array(z.string()).optional()
    .describe('Objects to exclude from route generation'),
  
  /**
   * Object name transformations
   */
  nameTransform: z.enum(['none', 'plural', 'kebab-case', 'camelCase']).default('none')
    .describe('Transform object names in URLs'),
  
  /**
   * Custom route overrides per object
   */
  overrides: z.record(z.string(), z.object({
    enabled: z.boolean().optional().describe('Enable/disable routes for this object'),
    basePath: z.string().optional().describe('Custom base path'),
    operations: z.record(CrudOperation, z.boolean()).optional()
      .describe('Enable/disable specific operations'),
  })).optional().describe('Per-object route customization'),
}));

export type RouteGenerationConfig = z.infer<typeof RouteGenerationConfigSchema>;
export type RouteGenerationConfigInput = z.input<typeof RouteGenerationConfigSchema>;

// ==========================================
// OpenAPI 3.1 Webhooks & Callbacks
// ==========================================

/**
 * Webhook Event Schema
 * Defines an event that can trigger a webhook delivery
 */
export const WebhookEventSchema = lazySchema(() => z.object({
  name: z.string().regex(/^[a-z_][a-z0-9_]*$/).describe('Webhook event identifier (snake_case)'),
  description: z.string().describe('Human-readable event description'),
  method: HttpMethod.default('POST').describe('HTTP method for webhook delivery'),
  payloadSchema: z.string().describe('JSON Schema $ref for the webhook payload'),
  headers: z.record(z.string(), z.string()).optional().describe('Custom headers to include in webhook delivery'),
  security: z.array(
    z.enum(['hmac_sha256', 'basic', 'bearer', 'api_key'])
  ).describe('Supported authentication methods for webhook verification'),
}));

export type WebhookEvent = z.infer<typeof WebhookEventSchema>;

/**
 * Webhook Configuration Schema
 * Top-level webhook configuration for the REST API
 */
export const WebhookConfigSchema = lazySchema(() => z.object({
  enabled: z.boolean().default(false).describe('Enable webhook support'),
  events: z.array(WebhookEventSchema).describe('Registered webhook events'),
  deliveryConfig: z.object({
    maxRetries: z.number().int().default(3).describe('Maximum delivery retry attempts'),
    retryIntervalMs: z.number().int().default(5000).describe('Milliseconds between retry attempts'),
    timeoutMs: z.number().int().default(30000).describe('Delivery request timeout in milliseconds'),
    signatureHeader: z.string().default('X-Signature-256').describe('Header name for webhook signature'),
  }).describe('Webhook delivery configuration'),
  registrationEndpoint: z.string().default('/webhooks').describe('URL path for webhook registration'),
}));

export type WebhookConfig = z.infer<typeof WebhookConfigSchema>;

/**
 * Callback Schema
 * OpenAPI 3.1 callback definition for asynchronous API responses
 */
export const CallbackSchema = lazySchema(() => z.object({
  name: z.string().regex(/^[a-z_][a-z0-9_]*$/).describe('Callback identifier (snake_case)'),
  expression: z.string().describe('Runtime expression (e.g., {$request.body#/callbackUrl})'),
  method: HttpMethod.describe('HTTP method for callback request'),
  url: z.string().describe('Callback URL template with runtime expressions'),
}));

export type Callback = z.infer<typeof CallbackSchema>;

/**
 * OpenAPI 3.1 Extensions Schema
 * Extensions specific to OpenAPI 3.1 specification
 */
export const OpenApi31ExtensionsSchema = lazySchema(() => z.object({
  webhooks: z.record(z.string(), WebhookEventSchema).optional()
    .describe('OpenAPI 3.1 webhooks (top-level webhook definitions)'),
  callbacks: z.record(z.string(), z.array(CallbackSchema)).optional()
    .describe('OpenAPI 3.1 callbacks (async response definitions)'),
  jsonSchemaDialect: z.string().default('https://json-schema.org/draft/2020-12/schema')
    .describe('JSON Schema dialect for schema definitions'),
  pathItemReferences: z.boolean().default(false)
    .describe('Allow $ref in path items (OpenAPI 3.1 feature)'),
}));

export type OpenApi31Extensions = z.infer<typeof OpenApi31ExtensionsSchema>;

// ==========================================
// Complete REST Server Configuration
// ==========================================

/**
 * REST Server Configuration Schema
 * Complete configuration for REST API server with auto-generated endpoints
 * 
 * @example
 * {
 *   "api": {
 *     "version": "v1",
 *     "basePath": "/api",
 *     "enableCrud": true,
 *     "enableMetadata": true,
 *     "enableBatch": true
 *   },
 *   "crud": {
 *     "dataPrefix": "/data"
 *   },
 *   "metadata": {
 *     "prefix": "/meta",
 *     "enableCache": true
 *   },
 *   "batch": {
 *     "maxBatchSize": 200
 *   },
 *   "routes": {
 *     "excludeObjects": ["system_log"]
 *   }
 * }
 */
export const RestServerConfigSchema = lazySchema(() => z.object({
  /**
   * API configuration
   */
  api: RestApiConfigSchema.optional().describe('REST API configuration'),
  
  /**
   * CRUD endpoints configuration
   */
  crud: CrudEndpointsConfigSchema.optional().describe('CRUD endpoints configuration'),
  
  /**
   * Metadata endpoints configuration
   */
  metadata: MetadataEndpointsConfigSchema.optional().describe('Metadata endpoints configuration'),
  
  /**
   * Batch endpoints configuration
   */
  batch: BatchEndpointsConfigSchema.optional().describe('Batch endpoints configuration'),
  
  /**
   * Route generation configuration
   */
  routes: RouteGenerationConfigSchema.optional().describe('Route generation configuration'),
  
  /**
   * OpenAPI 3.1 extensions (webhooks, callbacks)
   */
  openApi31: OpenApi31ExtensionsSchema.optional().describe('OpenAPI 3.1 extensions configuration'),
}));

export type RestServerConfig = z.infer<typeof RestServerConfigSchema>;
export type RestServerConfigInput = z.input<typeof RestServerConfigSchema>;

// ==========================================
// Endpoint Registry
// ==========================================

/**
 * Generated Endpoint Schema
 * Represents a generated REST endpoint
 */
export const GeneratedEndpointSchema = lazySchema(() => z.object({
  /**
   * Endpoint identifier
   */
  id: z.string().describe('Unique endpoint identifier'),
  
  /**
   * HTTP method
   */
  method: HttpMethod.describe('HTTP method'),
  
  /**
   * Full URL path
   */
  path: z.string().describe('Full URL path'),
  
  /**
   * Object this endpoint operates on
   */
  object: z.string().describe('Object name (snake_case)'),
  
  /**
   * Operation type
   */
  operation: z.union([CrudOperation, z.string()]).describe('Operation type'),
  
  /**
   * Handler reference
   */
  handler: z.string().describe('Handler function identifier'),
  
  /**
   * Endpoint metadata
   */
  metadata: z.object({
    summary: z.string().optional(),
    description: z.string().optional(),
    tags: z.array(z.string()).optional(),
    deprecated: z.boolean().optional(),
  }).optional(),
}));

export type GeneratedEndpoint = z.infer<typeof GeneratedEndpointSchema>;

/**
 * Endpoint Registry Schema
 * Registry of all generated endpoints
 */
export const EndpointRegistrySchema = lazySchema(() => z.object({
  /**
   * Generated endpoints
   */
  endpoints: z.array(GeneratedEndpointSchema).describe('All generated endpoints'),
  
  /**
   * Total endpoint count
   */
  total: z.number().int().describe('Total number of endpoints'),
  
  /**
   * Endpoints by object
   */
  byObject: z.record(z.string(), z.array(GeneratedEndpointSchema)).optional()
    .describe('Endpoints grouped by object'),
  
  /**
   * Endpoints by operation
   */
  byOperation: z.record(z.string(), z.array(GeneratedEndpointSchema)).optional()
    .describe('Endpoints grouped by operation'),
}));

export type EndpointRegistry = z.infer<typeof EndpointRegistrySchema>;

// ==========================================
// Helper Functions
// ==========================================

/**
 * Helper to create REST API configuration
 */
export const RestApiConfig = Object.assign(RestApiConfigSchema, {
  create: <T extends z.input<typeof RestApiConfigSchema>>(config: T) => config,
});

/**
 * Helper to create REST server configuration
 */
export const RestServerConfig = Object.assign(RestServerConfigSchema, {
  create: <T extends z.input<typeof RestServerConfigSchema>>(config: T) => config,
});
