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
   * Deployment-wide switch for the structured-search surface. `false` skips
   * mounting the search endpoints entirely (`registerSearchEndpoints` is never
   * called, so the routes 404), and the discovery capability block reports
   * `search.enabled: false` regardless of what the underlying protocol could
   * serve — declared and enforced at the mount, not advertised past it.
   *
   * Before this key had a declared seat the REST layer honoured it anyway,
   * reading its config raw through a cast — and this schema (a non-strict
   * `z.object()`) STRIPPED it, so any config that was parsed and then consumed
   * silently turned search back on. Declared here so the opt-out survives its
   * own contract's parse.
   */
  enableSearch: z.boolean().default(true).describe('Enable structured search endpoints (deployment-wide search opt-out)'),

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
    '`api.requireAuth` was removed in @objectstack/spec 17. Anonymous access to object data '
    + 'is now always denied — auth is a kernel concern, not a deployment posture. Delete the key. '
    + 'To publish something publicly, declare it: a public form view (`sharing.allowAnonymous`), a '
    + "share link, or `book.audience: 'public'` — each derives its own narrow authorization instead of "
    + 'opening the whole data plane. '
    + 'Run `os migrate meta --from 16` to list the mechanical edits for existing sources; apply them by hand.',
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

// `CrudEndpointPatternSchema` — REMOVED (#14691)
//
// The per-operation `{ method, path, summary, description }` pattern shape was
// the value type of `crud.patterns`, retired below under ADR-0049
// enforce-or-remove (the #14369 liveness census: every CRUD route is mounted
// from fixed method/path pairs in `packages/rest`'s `registerCrudEndpoints`,
// so a custom pattern was validated and never read). With its carrier key
// tombstoned the def had no consumer left, and an exported schema nothing
// reads is read as a capability by whoever finds it (#3950), so it leaves with
// the key — declared in RETIRED_DEFS_BY_MAJOR[18] (`api/CrudEndpointPattern`).
// `CrudOperation` above stays: `GeneratedEndpointSchema.operation` still reads
// it. An endpoint on a custom path or method is a declarative `api` endpoint
// (`endpoint.zod.ts`, `type: 'object_operation'`).

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
   * [REMOVED in #14691] Per-operation custom URL patterns. Tombstoned rather
   * than deleted: this schema is not `.strict()`, so a plain deletion would
   * silently strip the key and an author would keep a config that "customizes"
   * routes the server mounts from fixed pairs (ADR-0104, #3733). The mounted
   * CRUD paths are the contract the client SDK, the discovery document and the
   * served /openapi.json all describe; a configurable per-operation method or
   * path would make every one of them lie (Route & surface ownership §4).
   */
  patterns: retiredKey(
    '`crud.patterns` was removed in @objectstack/spec 17 (ADR-0049 enforce-or-remove) — '
    + 'nothing ever read it: every CRUD route is mounted from the fixed method/path pairs in the REST '
    + "server's `registerCrudEndpoints`, so a custom pattern was validated and ignored. Delete the key. "
    + 'The mounted CRUD paths are the contract the client SDK, the discovery document and the served '
    + '/openapi.json all describe, and `crud.dataPrefix` is the one live knob that moves them; an '
    + "endpoint on a custom path or method is a declarative `api` endpoint (`type: 'object_operation'`, "
    + '`ApiEndpoint` in `@objectstack/spec/api`), which is matched, executed and documented.',
  ),
  
  /**
   * Path prefix for data operations
   */
  dataPrefix: z.string().default('/data').describe('URL prefix for data endpoints'),
  
  /**
   * [REMOVED in #14691] The object-name parameter style. Every CRUD route takes
   * the object name as a PATH segment; `'query'` was validated against the enum
   * and mounted exactly what `'path'` mounts. Tombstoned, not deleted — the
   * schema is not `.strict()` (see `patterns` above).
   */
  objectParamStyle: retiredKey(
    '`crud.objectParamStyle` was removed in @objectstack/spec 17 (ADR-0049 enforce-or-remove) — '
    + 'nothing ever read it: every CRUD route takes the object name as a path segment, so '
    + "`'query'` was validated and mounted exactly what `'path'` mounts. Delete the key; the object "
    + 'name is always a path segment.',
  ),
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
 *     "items": true,
 *     "item": true,
 *     "maintenance": true
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
   * [REMOVED in #14691] The metadata cache TTL. `enableCache` selects the
   * protocol's `getMetaItemCached` read path, which takes no TTL, and no
   * `Cache-Control` / `ETag` / `Last-Modified` header was ever built from this
   * value — `cacheTtl: 60` changed no header and no cache lifetime (and, having
   * no lower bound, accepted `-1`). Tombstoned, not deleted — the schema is not
   * `.strict()`.
   */
  cacheTtl: retiredKey(
    '`metadata.cacheTtl` was removed in @objectstack/spec 17 (ADR-0049 enforce-or-remove) — '
    + "nothing ever read it: `metadata.enableCache` selects the protocol's `getMetaItemCached` read "
    + 'path, which takes no TTL, and no Cache-Control / ETag header was ever built from this value. '
    + 'Delete the key; `metadata.enableCache` is the live switch, and a declarative `api` '
    + "endpoint's `cacheTtl` is the key that does reach the wire.",
  ),

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
   *
   * **Every switch here gates exactly the face its name states, reads and
   * writes alike, and its `describe()` enumerates every mount it takes.** The
   * radius IS the contract, not a summary of it: a reader who turns a switch
   * off is entitled to know what leaves with it.
   *
   * That was not true before #15542 / #15854, and both directions of the
   * mismatch were live at once. `items` said "list items of type" and also
   * gated the whole-store family — the cross-type diagnostics sweep, the draft
   * list, and the `POST /meta/_migrate-stored` **write door** — so closing a
   * listing read silently disarmed a migration door. `item` said "get specific
   * item" and gated four reads while leaving its own `PUT` and `DELETE` and
   * the whole history family answering to `api.enableMetadata` alone, so
   * closing the per-item surface left its writes mounted. The whole-store
   * family now has its own key, `maintenance`, and `item` covers the per-item
   * writes its name has always promised.
   *
   * ⚠️ The `/meta` paths named below are the DEFAULT prefix; every one of them
   * moves with `prefix` above, and the environment-scoped base mounts a second
   * copy of the same table.
   *
   * `api.enableMetadata` stays the master switch above all four: `false`
   * removes the entire metadata surface whatever these say.
   *
   * ⛔ Each key's mount radius is pinned route by route in
   * `packages/rest/src/rest-config-mount-table.pin.test.ts` (the #15544
   * shape — it asserts the route is ABSENT from the mounted table, not what
   * the switch normalizes to). A gate that grows or loses a route reddens
   * there. Move a radius and move that table in the same PR; ⛔ never relax it
   * to match a drifted gate.
   */
  endpoints: z.object({
    types: z.boolean().default(true)
      .describe('Mount the metadata type list — `GET /meta` and `GET /meta/types` (one handler, two paths)'),
    items: z.boolean().default(true)
      .describe('Mount the per-type item list — `GET /meta/:type`, and nothing else'),
    item: z.boolean().default(true)
      .describe(
        'Mount the whole per-item face — `GET`, `PUT` and `DELETE /meta/:type/:name`, its '
        + '`/references` and `/layers` reads, the history family (`/history`, `/audit`, `/diff`, '
        + '`/published`, `/publish`, `/rollback`) and `GET /meta/book/:name/tree`',
      ),
    maintenance: z.boolean().default(true)
      .describe(
        'Mount the whole-store maintenance operations — `GET /meta/diagnostics`, '
        + '`GET /meta/_drafts` and the `POST /meta/_migrate-stored` write door',
      ),
    /**
     * [REMOVED in #14691] Gated a route that does not exist: the REST server
     * mounts no `GET /meta/:type/:name/schema`, so `false` removed nothing and
     * `true` added nothing. Its three siblings each gate a real mount.
     */
    schema: retiredKey(
      '`metadata.endpoints.schema` was removed in @objectstack/spec 17 (ADR-0049 '
      + 'enforce-or-remove) — it gated a route that does not exist: the REST server mounts no '
      + '`GET /meta/:type/:name/schema`, so `false` removed nothing and `true` added nothing. Delete '
      + 'the key; `endpoints.types` / `items` / `item` / `maintenance` are the switches that gate real '
      + 'mounts.',
    ),
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
    /**
     * [REMOVED in #14691] Gated a route that was never built: there is no
     * `POST /data/:object/upsertMany` and no protocol member behind it (the
     * protocol carries `createManyData` / `updateManyData` / `deleteManyData`
     * and no upsert counterpart). Upsert is an operation TYPE of the generic
     * batch endpoint (`BatchOperationType` `'upsert'`, `batch.zod.ts`).
     */
    upsertMany: retiredKey(
      '`batch.operations.upsertMany` was removed in @objectstack/spec 17 (ADR-0049 '
      + 'enforce-or-remove) — it gated a route that was never built: there is no '
      + '`POST /data/:object/upsertMany` and no protocol member behind it, so `false` disabled '
      + 'nothing. Delete the key. Upsert is an operation type of the generic `POST /data/:object/batch` '
      + "endpoint (`BatchOperationType` `'upsert'`, keyed by `externalId`), gated by "
      + '`batch.enableBatchEndpoint`.',
    ),
  }).optional().describe('Enable/disable specific batch operations'),

  /**
   * [REMOVED in #14691] A server-side default for batch atomicity. No batch
   * handler ever consulted it: atomicity is decided per request by
   * `options.atomic` in the batch body (`BatchOptionsSchema`, ADR-0119 D4 —
   * opt-in, default `false`, aligned to what every caller already gets). A
   * deployment default that flipped it silently would change the failure
   * semantics of callers who send nothing, the move ADR-0119 D4 refused.
   * Tombstoned, not deleted — the schema is not `.strict()`.
   */
  defaultAtomic: retiredKey(
    '`batch.defaultAtomic` was removed in @objectstack/spec 17 (ADR-0049 enforce-or-remove) — '
    + 'no batch handler ever consulted it: atomicity is decided per request by `options.atomic` in the '
    + 'batch body (`BatchOptions`, ADR-0119 D4, opt-in), and a server-side default that flipped it '
    + 'silently would change the failure semantics of callers who send nothing. Delete the key; a '
    + 'caller that needs all-or-nothing sends `options: { atomic: true }`.',
  ),
}));

export type BatchEndpointsConfig = z.input<typeof BatchEndpointsConfigSchema>;
/** Post-parse shape of {@link BatchEndpointsConfig} — defaults applied, transforms run (ADR-0122). */
export type BatchEndpointsConfigParsed = z.infer<typeof BatchEndpointsConfigSchema>;

// ==========================================
// Route Generation Configuration
// ==========================================

/**
 * Route Generation Configuration Schema
 *
 * [#14691] Every key of this sub-object is a `retiredKey()` tombstone: the
 * #14369 liveness census found the whole block parsed, defaulted and
 * normalized into the REST server's config and never read back —
 * `excludeObjects: ['sys_log']` excluded nothing, `nameTransform: 'plural'`
 * mounted every route under the raw object name, and the per-object
 * `overrides` record turned nothing on or off. Retired under ADR-0049
 * enforce-or-remove rather than wired, because each key duplicated a contract
 * that already lives where it belongs: per-object API exposure is declared ON
 * the object (`enable.apiEnabled` / `enable.apiMethods`, enforced by the REST
 * data surface — 404 / 405), the object `name` is the canonical id on every
 * surface including the REST path segment (Prime Directive #6, so there is no
 * URL transform to configure), and the data base path is deployment-wide
 * (`crud.dataPrefix`). The sub-object stays declared so that an authored key
 * is refused with its prescription instead of being silently stripped (the
 * schemas are not `.strict()`); it ages out with its tombstones.
 */
export const RouteGenerationConfigSchema = lazySchema(() => z.object({
  includeObjects: retiredKey(
    '`routes.includeObjects` was removed in @objectstack/spec 17 (ADR-0049 enforce-or-remove) — '
    + 'nothing ever read it: route registration iterates every registered object, so an include list '
    + 'still mounted all of them. Delete the key. Per-object API exposure is declared on the object '
    + 'and enforced by the REST data surface: `enable.apiEnabled: false` hides the object (404) and '
    + '`enable.apiMethods` whitelists its operations (405 for the rest).',
  ),
  excludeObjects: retiredKey(
    '`routes.excludeObjects` was removed in @objectstack/spec 17 (ADR-0049 enforce-or-remove) — '
    + 'nothing ever read it: route registration iterates every registered object, so an excluded '
    + 'object was still mounted. Delete the key. Per-object API exposure is declared on the object '
    + 'and enforced by the REST data surface: `enable.apiEnabled: false` hides the object (404) and '
    + '`enable.apiMethods` whitelists its operations (405 for the rest).',
  ),
  nameTransform: retiredKey(
    '`routes.nameTransform` was removed in @objectstack/spec 17 (ADR-0049 enforce-or-remove) — '
    + 'nothing ever read it: the enum was validated and every value mounted exactly what '
    + "`'none'` mounts. Delete the key; the object `name` is the canonical id on every surface, the "
    + 'REST path segment included, so there is no URL transform to configure.',
  ),
  overrides: retiredKey(
    '`routes.overrides` was removed in @objectstack/spec 17 (ADR-0049 enforce-or-remove) — '
    + 'nothing ever read the per-object record: `enabled`, `basePath` and `operations` were validated '
    + 'and turned nothing on or off. Delete the key. Per-object exposure lives on the object '
    + '(`enable.apiEnabled` hides it, `enable.apiMethods` whitelists its operations — both enforced by '
    + 'the REST data surface); the data base path is deployment-wide (`crud.dataPrefix`); and an '
    + 'endpoint on a custom path is a declarative `api` endpoint.',
  ),
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
 *   }
 * }
 *
 * To keep an object off the REST data surface, declare it on the object
 * (`enable.apiEnabled: false`, or an `enable.apiMethods` whitelist) — the
 * `routes` sub-object's selectors were retired in #14691 because nothing read them.
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
    '`RestServerConfig.openApi31` was removed in @objectstack/spec 17 (ADR-0049) — no '
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
