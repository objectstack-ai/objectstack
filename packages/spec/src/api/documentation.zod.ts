// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { z } from 'zod';

/**
 * API Documentation & Testing Interface Protocol
 * 
 * Provides schemas for describing API documentation and test collections.
 *
 * Features:
 * - OpenAPI/Swagger specification generation
 * - API test requests and collections
 * - API versioning and changelog
 * - Code generation templates
 * - Mock server configuration
 *
 * Architecture Alignment:
 * - OpenAPI: the machine-readable API description
 * - Postman: API testing collections
 *
 * The platform serves no HTML documentation viewer: the API origin publishes
 * the OpenAPI document (`GET {basePath}/openapi.json`) and nothing else, so
 * this module declares no viewer — the retired `ui` key is refused at parse
 * with that prescription.
 *
 * @example Documentation Config
 * ```typescript
 * const docConfig: ApiDocumentationConfig = {
 *   enabled: true,
 *   title: 'ObjectStack API',
 *   version: '1.0.0',
 *   servers: [{ url: 'https://api.example.com', description: 'Production' }],
 * }
 * ```
 */

// ==========================================
// OpenAPI Specification
// ==========================================

/**
 * OpenAPI Server Schema
 * 
 * Server configuration for OpenAPI specification.
 */
import { lazySchema } from '../shared/lazy-schema';
import { retiredKey } from '../shared/retired-key';
export const OpenApiServerSchema = lazySchema(() => z.object({
  /** Server URL */
  url: z.string().url().describe('Server base URL'),
  
  /** Server description */
  description: z.string().optional().describe('Server description'),
  
  /** Server variables */
  variables: z.record(z.string(), z.object({
    default: z.string(),
    description: z.string().optional(),
    enum: z.array(z.string()).optional(),
  })).optional().describe('URL template variables'),
}));

export type OpenApiServer = z.input<typeof OpenApiServerSchema>;

/**
 * OpenAPI Security Scheme Schema
 * 
 * Security scheme definition for OpenAPI.
 */
export const OpenApiSecuritySchemeSchema = lazySchema(() => z.object({
  /** Security scheme type */
  type: z.enum(['apiKey', 'http', 'oauth2', 'openIdConnect']).describe('Security type'),
  
  /** Scheme name */
  scheme: z.string().optional().describe('HTTP auth scheme (bearer, basic, etc.)'),
  
  /** Bearer format */
  bearerFormat: z.string().optional().describe('Bearer token format (e.g., JWT)'),
  
  /** API key name */
  name: z.string().optional().describe('API key parameter name'),
  
  /** API key location */
  in: z.enum(['header', 'query', 'cookie']).optional().describe('API key location'),
  
  /** OAuth flows */
  flows: z.object({
    implicit: z.unknown().optional(),
    password: z.unknown().optional(),
    clientCredentials: z.unknown().optional(),
    authorizationCode: z.unknown().optional(),
  }).optional().describe('OAuth2 flows'),
  
  /** OpenID Connect URL */
  openIdConnectUrl: z.string().url().optional().describe('OpenID Connect discovery URL'),
  
  /** Description */
  description: z.string().optional().describe('Security scheme description'),
}));

export type OpenApiSecurityScheme = z.input<typeof OpenApiSecuritySchemeSchema>;

/**
 * OpenAPI Specification Schema
 * 
 * Complete OpenAPI 3.0 specification structure.
 * 
 * @see https://swagger.io/specification/
 * 
 * @example
 * ```json
 * {
 *   "openapi": "3.0.0",
 *   "info": {
 *     "title": "ObjectStack API",
 *     "version": "1.0.0",
 *     "description": "ObjectStack unified API"
 *   },
 *   "servers": [
 *     { "url": "https://api.example.com" }
 *   ],
 *   "paths": { ... },
 *   "components": { ... }
 * }
 * ```
 */
export const OpenApiSpecSchema = lazySchema(() => z.object({
  /** OpenAPI version */
  openapi: z.string().default('3.0.0').describe('OpenAPI specification version'),
  
  /** API information */
  info: z.object({
    title: z.string().describe('API title'),
    version: z.string().describe('API version'),
    description: z.string().optional().describe('API description'),
    termsOfService: z.string().url().optional().describe('Terms of service URL'),
    contact: z.object({
      name: z.string().optional(),
      url: z.string().url().optional(),
      email: z.string().email().optional(),
    }).optional(),
    license: z.object({
      name: z.string(),
      url: z.string().url().optional(),
    }).optional(),
  }).describe('API metadata'),
  
  /** Servers */
  servers: z.array(OpenApiServerSchema).optional().default([]).describe('API servers'),
  
  /** API paths */
  paths: z.record(z.string(), z.unknown()).describe('API paths and operations'),
  
  /** Reusable components */
  components: z.object({
    schemas: z.record(z.string(), z.unknown()).optional(),
    responses: z.record(z.string(), z.unknown()).optional(),
    parameters: z.record(z.string(), z.unknown()).optional(),
    examples: z.record(z.string(), z.unknown()).optional(),
    requestBodies: z.record(z.string(), z.unknown()).optional(),
    headers: z.record(z.string(), z.unknown()).optional(),
    securitySchemes: z.record(z.string(), OpenApiSecuritySchemeSchema).optional(),
    links: z.record(z.string(), z.unknown()).optional(),
    callbacks: z.record(z.string(), z.unknown()).optional(),
  }).optional().describe('Reusable components'),
  
  /** Security requirements */
  security: z.array(z.record(z.string(), z.array(z.string()))).optional()
    .describe('Global security requirements'),
  
  /** Tags */
  tags: z.array(z.object({
    name: z.string(),
    description: z.string().optional(),
    externalDocs: z.object({
      description: z.string().optional(),
      url: z.string().url(),
    }).optional(),
  })).optional().describe('Tag definitions'),
  
  /** External documentation */
  externalDocs: z.object({
    description: z.string().optional(),
    url: z.string().url(),
  }).optional().describe('External documentation'),
}));

export type OpenApiSpec = z.input<typeof OpenApiSpecSchema>;
/** Post-parse shape of {@link OpenApiSpec} — defaults applied, transforms run (ADR-0122). */
export type OpenApiSpecParsed = z.infer<typeof OpenApiSpecSchema>;

// ==========================================
// API Testing Playground
// ==========================================

// ─── [#25159] `ApiDocumentationConfig.ui` and its viewer defs are RETIRED ───
//
// ADR-0049 enforce-or-remove; triage route A (no staged window), which follows
// the maintainer's ruling to take the docs viewer page offline. `ui` declared
// an interactive documentation viewer — `ApiTestingUiType` (`swagger-ui`,
// `redoc`, `rapidoc`, `stoplight`, `scalar`, `graphiql`, `postman`, `custom`)
// at `ApiTestingUiConfigSchema.path` (default `/api-docs`), with a theme,
// try-it-out, CORS and layout switches — and NOTHING read it: measured at this
// retirement's base (b93c750c7), zero hits for `ApiTestingUi` outside
// `packages/spec` in this repo and in objectui at its pinned sha, against a
// lit control on the same instrument; nothing in the tree parses
// `ApiDocumentationConfigSchema` outside its own unit tests. Since the viewer
// page `GET {basePath}/docs` was retired, the API origin serves no HTML viewer
// at all, only the OpenAPI document at `GET {basePath}/openapi.json` (mounted
// by `packages/rest`'s `registerOpenApiEndpoints` while `api.enableOpenApi` is
// on), so the key could not be honoured either.
//
// Two bookkeeping shapes, one retirement:
//   1. `ApiDocumentationConfig.ui` — `retiredKey()` tombstone below (the shape
//      is a non-strict `z.object`, so a bare deletion would be a silent strip,
//      ADR-0104); `api/ApiDocumentationConfig:ui` in `RETIRED_KEYS_BY_MAJOR[18]`.
//   2. `ApiTestingUiConfigSchema` / `ApiTestingUiType` (and the
//      `ApiTestingUiConfig` / `ApiTestingUiConfigParsed` / `ApiTestingUiType`
//      types) — orphan value schemas once `ui` is gone: they had no other
//      consumer, and an exported value schema with no consumer reads as a
//      capability. `api/ApiTestingUiConfig` + `api/ApiTestingUiType` in
//      `RETIRED_DEFS_BY_MAJOR[18]`.
//
// No D2 conversion, deliberately: an `ApiDocumentationConfig` is not a stack
// collection member and never a `sys_metadata` row, so a MetadataConversion
// would be a transform with no seam that ever runs (the `kernel/Manifest:loading`
// disposition). The D3 semantic entry `api-docs-viewer-keys-retired` carries
// the prescription outward, beside its REST-plugin siblings `openApi.uiPath`
// and `openApi.uiFramework` (`plugin-rest-api.zod.ts`).
const API_DOCUMENTATION_UI_RETIRED =
  '`ApiDocumentationConfig.ui` was removed in @objectstack/spec 18.1.0 (ADR-0049 '
  + 'enforce-or-remove) — nothing ever read it: no viewer was ever mounted from it, and the '
  + 'platform serves no HTML API documentation viewer at all, only the machine-readable OpenAPI '
  + 'document. Delete the key. The OpenAPI document is served at `GET /api/v1/openapi.json` '
  + 'under the REST server\'s default `api.basePath` and `api.version` (the path follows both) '
  + 'while `api.enableOpenApi` is on; point any viewer or client generator you run yourself at '
  + 'that document.';

/**
 * API Test Request Schema
 * 
 * Represents a saved/example API test request.
 * 
 * @example
 * ```json
 * {
 *   "name": "Get Customer by ID",
 *   "description": "Retrieves a customer record",
 *   "method": "GET",
 *   "url": "/api/v1/data/customer/123",
 *   "headers": {
 *     "Authorization": "Bearer {{token}}"
 *   },
 *   "variables": {
 *     "token": "sample_token"
 *   }
 * }
 * ```
 */
export const ApiTestRequestSchema = lazySchema(() => z.object({
  /** Request name */
  name: z.string().describe('Test request name'),
  
  /** Request description */
  description: z.string().optional().describe('Request description'),
  
  /** HTTP method */
  method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'])
    .describe('HTTP method'),
  
  /** Request URL */
  url: z.string().describe('Request URL (can include variables)'),
  
  /** Request headers */
  headers: z.record(z.string(), z.string()).optional().default({})
    .describe('Request headers'),
  
  /** Query parameters */
  queryParams: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()]))
    .optional().default({}).describe('Query parameters'),
  
  /** Request body */
  body: z.unknown().optional().describe('Request body'),
  
  /** Environment variables */
  variables: z.record(z.string(), z.unknown()).optional().default({})
    .describe('Template variables'),
  
  /** Expected response */
  expectedResponse: z.object({
    statusCode: z.number().int(),
    body: z.unknown().optional(),
  }).optional().describe('Expected response for validation'),
}));

export type ApiTestRequest = z.input<typeof ApiTestRequestSchema>;
/** Post-parse shape of {@link ApiTestRequest} — defaults applied, transforms run (ADR-0122). */
export type ApiTestRequestParsed = z.infer<typeof ApiTestRequestSchema>;

/**
 * API Test Collection Schema
 * 
 * Collection of test requests (similar to Postman collections).
 * 
 * @example
 * ```json
 * {
 *   "name": "Customer API Tests",
 *   "description": "Test collection for customer endpoints",
 *   "variables": {
 *     "baseUrl": "https://api.example.com",
 *     "apiKey": "test_key"
 *   },
 *   "requests": [...]
 * }
 * ```
 */
export const ApiTestCollectionSchema = lazySchema(() => z.object({
  /** Collection name */
  name: z.string().describe('Collection name'),
  
  /** Collection description */
  description: z.string().optional().describe('Collection description'),
  
  /** Collection variables */
  variables: z.record(z.string(), z.unknown()).optional().default({})
    .describe('Shared variables'),
  
  /** Test requests */
  requests: z.array(ApiTestRequestSchema).describe('Test requests in this collection'),
  
  /** Folders/grouping */
  folders: z.array(z.object({
    name: z.string(),
    description: z.string().optional(),
    requests: z.array(ApiTestRequestSchema),
  })).optional().describe('Request folders for organization'),
}));

export type ApiTestCollection = z.input<typeof ApiTestCollectionSchema>;
/** Post-parse shape of {@link ApiTestCollection} — defaults applied, transforms run (ADR-0122). */
export type ApiTestCollectionParsed = z.infer<typeof ApiTestCollectionSchema>;

// ==========================================
// API Documentation Configuration
// ==========================================

/**
 * API Changelog Entry Schema
 * 
 * Documents changes in API versions.
 */
export const ApiChangelogEntrySchema = lazySchema(() => z.object({
  /** Version */
  version: z.string().describe('API version'),
  
  /** Release date */
  date: z.string().date().describe('Release date'),
  
  /** Changes */
  changes: z.object({
    added: z.array(z.string()).optional().default([]).describe('New features'),
    changed: z.array(z.string()).optional().default([]).describe('Changes'),
    deprecated: z.array(z.string()).optional().default([]).describe('Deprecations'),
    removed: z.array(z.string()).optional().default([]).describe('Removed features'),
    fixed: z.array(z.string()).optional().default([]).describe('Bug fixes'),
    security: z.array(z.string()).optional().default([]).describe('Security fixes'),
  }).describe('Version changes'),
  
  /** Migration guide */
  migrationGuide: z.string().optional().describe('Migration guide URL or text'),
}));

export type ApiChangelogEntry = z.input<typeof ApiChangelogEntrySchema>;
/** Post-parse shape of {@link ApiChangelogEntry} — defaults applied, transforms run (ADR-0122). */
export type ApiChangelogEntryParsed = z.infer<typeof ApiChangelogEntrySchema>;

/**
 * Code Generation Template Schema
 * 
 * Templates for generating client code.
 */
export const CodeGenerationTemplateSchema = lazySchema(() => z.object({
  /** Language/framework */
  language: z.string().describe('Target language/framework (e.g., typescript, python, curl)'),
  
  /** Template name */
  name: z.string().describe('Template name'),
  
  /** Template content */
  template: z.string().describe('Code template with placeholders'),
  
  /** Template variables */
  variables: z.array(z.string()).optional().describe('Required template variables'),
}));

export type CodeGenerationTemplate = z.input<typeof CodeGenerationTemplateSchema>;

/**
 * API Documentation Configuration Schema
 * 
 * Complete configuration for API documentation and test collections. It
 * configures no viewer: the platform serves the OpenAPI document only, and the
 * retired `ui` key says so at parse (`API_DOCUMENTATION_UI_RETIRED`).
 * 
 * @example
 * ```json
 * {
 *   "enabled": true,
 *   "title": "ObjectStack API Documentation",
 *   "version": "1.0.0",
 *   "description": "Unified API for ObjectStack platform",
 *   "servers": [
 *     { "url": "https://api.example.com", "description": "Production" }
 *   ],
 *   "generateOpenApi": true,
 *   "generateTestCollections": true
 * }
 * ```
 */
export const ApiDocumentationConfigSchema = lazySchema(() => z.object({
  /** Enable documentation */
  enabled: z.boolean().default(true).describe('Enable API documentation'),
  
  /** Documentation title */
  title: z.string().default('API Documentation').describe('Documentation title'),
  
  /** API version */
  version: z.string().describe('API version'),
  
  /** API description */
  description: z.string().optional().describe('API description'),
  
  /** Server configurations */
  servers: z.array(OpenApiServerSchema).optional().default([])
    .describe('API server URLs'),
  
  /**
   * RETIRED (#25159, ADR-0049): `ui` declared a documentation viewer nothing
   * ever mounted, and the platform serves none — the retirement record sits
   * above `API_DOCUMENTATION_UI_RETIRED`. Tombstoned rather than deleted: this
   * shape is not `.strict()`, so authoring it must fail loudly (tsc `never` +
   * the parse-time prescription), never strip in silence. The key carried no
   * Zod `.default()`, and nothing parses this config into a stored or built
   * artifact, so there is no emitted residue to tolerate.
   */
  ui: retiredKey(API_DOCUMENTATION_UI_RETIRED),
  
  /** Generate OpenAPI spec */
  generateOpenApi: z.boolean().default(true).describe('Generate OpenAPI 3.0 specification'),
  
  /** Generate test collections */
  generateTestCollections: z.boolean().default(true)
    .describe('Generate API test collections'),
  
  /** Test collections */
  testCollections: z.array(ApiTestCollectionSchema).optional().default([])
    .describe('Predefined test collections'),
  
  /** API changelog */
  changelog: z.array(ApiChangelogEntrySchema).optional().default([])
    .describe('API version changelog'),
  
  /** Code generation templates */
  codeTemplates: z.array(CodeGenerationTemplateSchema).optional().default([])
    .describe('Code generation templates'),
  
  /** Terms of service */
  termsOfService: z.string().url().optional().describe('Terms of service URL'),
  
  /** Contact information */
  contact: z.object({
    name: z.string().optional(),
    url: z.string().url().optional(),
    email: z.string().email().optional(),
  }).optional().describe('Contact information'),
  
  /** License */
  license: z.object({
    name: z.string(),
    url: z.string().url().optional(),
  }).optional().describe('API license'),
  
  /** External documentation */
  externalDocs: z.object({
    description: z.string().optional(),
    url: z.string().url(),
  }).optional().describe('External documentation link'),
  
  /** Security schemes */
  securitySchemes: z.record(z.string(), OpenApiSecuritySchemeSchema).optional()
    .describe('Security scheme definitions'),
  
  /** Global tags */
  tags: z.array(z.object({
    name: z.string(),
    description: z.string().optional(),
    externalDocs: z.object({
      description: z.string().optional(),
      url: z.string().url(),
    }).optional(),
  })).optional().describe('Global tag definitions'),
}));

export type ApiDocumentationConfig = z.input<typeof ApiDocumentationConfigSchema>;
/** Post-parse shape of {@link ApiDocumentationConfig} — defaults applied, transforms run (ADR-0122). */
export type ApiDocumentationConfigParsed = z.infer<typeof ApiDocumentationConfigSchema>;

// ==========================================
// API Documentation Generation
// ==========================================

/**
 * Generated API Documentation Schema
 * 
 * Output of documentation generation process.
 */
export const GeneratedApiDocumentationSchema = lazySchema(() => z.object({
  /** OpenAPI specification */
  openApiSpec: OpenApiSpecSchema.optional().describe('Generated OpenAPI specification'),
  
  /** Test collections */
  testCollections: z.array(ApiTestCollectionSchema).optional()
    .describe('Generated test collections'),
  
  /** Markdown documentation */
  markdown: z.string().optional().describe('Generated markdown documentation'),
  
  /** HTML documentation */
  html: z.string().optional().describe('Generated HTML documentation'),
  
  /** Generation timestamp */
  generatedAt: z.string().datetime().describe('Generation timestamp'),
  
  /** Source APIs */
  sourceApis: z.array(z.string()).describe('Source API IDs used for generation'),
}));

export type GeneratedApiDocumentation = z.input<typeof GeneratedApiDocumentationSchema>;
/** Post-parse shape of {@link GeneratedApiDocumentation} — defaults applied, transforms run (ADR-0122). */
export type GeneratedApiDocumentationParsed = z.infer<typeof GeneratedApiDocumentationSchema>;

// ==========================================
// Helper Functions
// ==========================================

/**
 * Helper to create API documentation config
 */
export const ApiDocumentationConfig = Object.assign(ApiDocumentationConfigSchema, {
  create: <T extends z.input<typeof ApiDocumentationConfigSchema>>(config: T) => config,
});

/**
 * Helper to create API test collection
 */
export const ApiTestCollection = Object.assign(ApiTestCollectionSchema, {
  create: <T extends z.input<typeof ApiTestCollectionSchema>>(config: T) => config,
});

/**
 * Helper to create OpenAPI specification
 */
export const OpenApiSpec = Object.assign(OpenApiSpecSchema, {
  create: <T extends z.input<typeof OpenApiSpecSchema>>(config: T) => config,
});
