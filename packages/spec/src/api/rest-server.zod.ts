// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { z } from 'zod';
import { HttpMethod } from '../shared/http.zod';
import { retiredKey } from '../shared/retired-key';

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
   * [REMOVED in #3963] The deployment-wide anonymous-access opt-out.
   *
   * Tombstoned rather than deleted: `RestApiConfigSchema` is not `.strict()`, so
   * a plain deletion would silently strip the key — an author who keeps writing
   * `requireAuth: false` would get a clean parse and a deployment that quietly
   * denies every anonymous request, with nothing to grep (ADR-0104, #3733).
   * Which is the exact failure mode this key's removal is about.
   */
  requireAuth: retiredKey(
    '`api.requireAuth` was removed in @objectstack/spec 17 (#3963). Anonymous access to object data '
    + 'is now always denied — auth is a kernel concern, not a deployment posture. Delete the key. '
    + 'To publish something publicly, declare it: a public form view (`sharing.allowAnonymous`), a '
    + "share link, or `book.audience: 'public'` — each derives its own narrow authorization instead of "
    + 'opening the whole data plane.',
  ),

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

export type RestApiConfig = z.input<typeof RestApiConfigSchema>;
/** Post-parse shape of {@link RestApiConfig} — defaults applied, transforms run (ADR-0122). */
export type RestApiConfigParsed = z.infer<typeof RestApiConfigSchema>;

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

export type CrudOperation = z.input<typeof CrudOperation>;

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

export type CrudEndpointPattern = z.input<typeof CrudEndpointPatternSchema>;

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

export type CrudEndpointsConfig = z.input<typeof CrudEndpointsConfigSchema>;
/** Post-parse shape of {@link CrudEndpointsConfig} — defaults applied, transforms run (ADR-0122). */
export type CrudEndpointsConfigParsed = z.infer<typeof CrudEndpointsConfigSchema>;

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
   * [ADR-0106 D8] Per-caller field-level masking of the OBJECT SCHEMAS this
   * server serves from `/meta` and `/metadata`.
   *
   * Default **on**: an object schema is projected onto the fields the CALLING
   * user may read, so a field they cannot read does not appear at all — not its
   * name, label, type, picklist options, formula, `visibleWhen` predicate,
   * `defaultValue`, nor the `requiredPermissions` capability guarding it.
   *
   * `false` opts this server out and serves the full schema to every
   * authenticated caller, as releases before ADR-0106 did. The change is
   * **disclosure only**: the data plane masks values and refuses forbidden
   * writes either way, and the console reads field affordances from
   * `/auth/me/permissions`, so toggling it never changes UI correctness.
   *
   * Deployment-wide counterpart: `OS_ALLOW_UNMASKED_OBJECT_METADATA=1`, which
   * also covers the runtime `/metadata` dispatcher (that path has no per-server
   * REST config to read). Either opt-out disables the mask; neither is needed
   * to keep it on.
   */
  maskObjectFields: z.boolean().default(true)
    .describe('[ADR-0106 D8] Mask served object schemas to the caller\'s readable fields'),

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

export type MetadataEndpointsConfig = z.input<typeof MetadataEndpointsConfigSchema>;
/** Post-parse shape of {@link MetadataEndpointsConfig} — defaults applied, transforms run (ADR-0122). */
export type MetadataEndpointsConfigParsed = z.infer<typeof MetadataEndpointsConfigSchema>;

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

export type BatchEndpointsConfig = z.input<typeof BatchEndpointsConfigSchema>;
/** Post-parse shape of {@link BatchEndpointsConfig} — defaults applied, transforms run (ADR-0122). */
export type BatchEndpointsConfigParsed = z.infer<typeof BatchEndpointsConfigSchema>;

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

export type RouteGenerationConfig = z.input<typeof RouteGenerationConfigSchema>;
/** Post-parse shape of {@link RouteGenerationConfig} — defaults applied, transforms run (ADR-0122). */
export type RouteGenerationConfigParsed = z.infer<typeof RouteGenerationConfigSchema>;

// ==========================================
// OpenAPI 3.1 Webhooks & Callbacks — REMOVED (#4579)
// ==========================================
//
// `OpenApiWebhookEventSchema`, `CallbackSchema` and `OpenApi31ExtensionsSchema`
// — the `RestServerConfig.openApi31` block — were removed in v17 (#4579,
// ADR-0049 enforce-or-remove). The block was declared-but-unenforced end to
// end: `normalizeConfig` (packages/rest/src/rest-server.ts) forwards only
// `api` / `crud` / `metadata` / `batch` / `routes`; the served
// `GET /openapi.json` is the pre-generated @objectstack/spec contract enriched
// at request time with the live server URL + the runtime-registered objects;
// and `gen:openapi` (scripts/build-openapi.ts) never read a webhook or
// callback. So a definition authored under `openApi31.webhooks` never appeared
// in any served document — false compliance, not a capability. Zero
// import-level consumers across objectstack / cloud / objectui (three-repo
// scan, #4579). Config-driven OpenAPI 3.1 webhooks/callbacks documentation is
// a NEW capability: if it is ever needed it returns via the enforce route of
// ADR-0049, through an ADR — not by re-declaring inert keys. The live OpenAPI
// switch is `RestApiConfigSchema.enableOpenApi` above; the outbound webhook an
// author actually configures is `WebhookSchema` in `@objectstack/spec/automation`.
// The tombstone on `RestServerConfigSchema.openApi31` below carries the
// author-facing prescription.

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
   * [REMOVED in #4579] The OpenAPI 3.1 extensions block (`webhooks` /
   * `callbacks` / `jsonSchemaDialect` / `pathItemReferences`). Tombstoned
   * rather than deleted: this schema is not `.strict()`, so a plain deletion
   * would silently strip the key — an author who keeps declaring webhooks here
   * would get a clean parse and a served /openapi.json that never mentions
   * them, which is the exact declared ≠ enforced failure the removal closes
   * (see the section comment above).
   */
  openApi31: retiredKey(
    '`RestServerConfig.openApi31` was removed in @objectstack/spec 17 (#4579, ADR-0049) — no '
    + 'runtime ever read it: the REST server forwards only `api`/`crud`/`metadata`/`batch`/`routes`, '
    + 'and the served /openapi.json is the pre-generated contract enriched with the live server URL '
    + 'and the registered objects, so webhook/callback definitions declared here never appeared in '
    + 'it. Delete the key. Config-driven OpenAPI 3.1 webhooks/callbacks documentation is a new '
    + 'capability and must arrive via the enforce route of ADR-0049 (a new ADR), not by re-declaring '
    + 'the key; for a real outbound webhook use `Webhook` from `@objectstack/spec/automation`.',
  ),
}));

export type RestServerConfig = z.input<typeof RestServerConfigSchema>;
/** Post-parse shape of {@link RestServerConfig} — defaults applied, transforms run (ADR-0122). */
export type RestServerConfigParsed = z.infer<typeof RestServerConfigSchema>;

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

export type GeneratedEndpoint = z.input<typeof GeneratedEndpointSchema>;

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

export type EndpointRegistry = z.input<typeof EndpointRegistrySchema>;

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
