// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { z } from 'zod';

/**
 * API Documentation & Testing Interface Protocol
 * 
 * Provides schemas for generating interactive API documentation and testing
 * interfaces similar to Swagger UI, Postman, etc.
 * 
 * Features:
 * - OpenAPI/Swagger specification generation
 * - Interactive API testing playground
 * - API versioning and changelog
 * - Code generation templates
 * - Mock server configuration
 * 
 * Architecture Alignment:
 * - Swagger UI: Interactive API documentation
 * - Postman: API testing collections
 * - Redoc: Documentation rendering
 * 
 * @example Documentation Config
 * ```typescript
 * const docConfig: ApiDocumentationConfig = {
 *   enabled: true,
 *   title: 'ObjectStack API',
 *   version: '1.0.0',
 *   servers: [{ url: 'https://api.example.com', description: 'Production' }],
 *   ui: {
 *     type: 'swagger-ui',
 *     theme: 'light',
 *     enableTryItOut: true
 *   }
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

export type OpenApiServer = z.infer<typeof OpenApiServerSchema>;

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

export type OpenApiSecurityScheme = z.infer<typeof OpenApiSecuritySchemeSchema>;

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

export type OpenApiSpec = z.infer<typeof OpenApiSpecSchema>;

// ==========================================
// API Testing Playground
// ==========================================

/**
 * API Testing UI Type
 */
export const ApiTestingUiType = z.enum([
  'swagger-ui',      // Swagger UI
  'redoc',           // Redoc
  'rapidoc',         // RapiDoc
  'stoplight',       // Stoplight Elements
  'scalar',          // Scalar API Reference
  'graphiql',        // GraphiQL
  'postman',         // Postman-like interface
  'custom',          // Custom implementation
]);

export type ApiTestingUiType = z.infer<typeof ApiTestingUiType>;

/**
 * API Testing UI Configuration Schema
 * 
 * Configuration for interactive API testing interface.
 * 
 * @example Swagger UI Config
 * ```json
 * {
 *   "type": "swagger-ui",
 *   "path": "/api-docs",
 *   "theme": "light",
 *   "enableTryItOut": true,
 *   "enableFilter": true,
 *   "enableCors": true,
 *   "defaultModelsExpandDepth": 1
 * }
 * ```
 */
export const ApiTestingUiConfigSchema = lazySchema(() => z.object({
  /** UI type */
  type: ApiTestingUiType.describe('Testing UI implementation'),
  
  /** UI path */
  path: z.string().default('/api-docs').describe('URL path for documentation UI'),
  
  /** UI theme */
  theme: z.enum(['light', 'dark', 'auto']).default('light').describe('UI color theme'),
  
  /** Enable try-it-out feature */
  enableTryItOut: z.boolean().default(true).describe('Enable interactive API testing'),
  
  /** Enable filtering */
  enableFilter: z.boolean().default(true).describe('Enable endpoint filtering'),
  
  /** Enable CORS for testing */
  enableCors: z.boolean().default(true).describe('Enable CORS for browser testing'),
  
  /** Default expand depth for models */
  defaultModelsExpandDepth: z.number().int().min(-1).default(1)
    .describe('Default expand depth for schemas (-1 = fully expand)'),
  
  /** Display request duration */
  displayRequestDuration: z.boolean().default(true).describe('Show request duration'),
  
  /** Syntax highlighting */
  syntaxHighlighting: z.boolean().default(true).describe('Enable syntax highlighting'),
  
  /** Custom CSS URL */
  customCssUrl: z.string().url().optional().describe('Custom CSS stylesheet URL'),
  
  /** Custom JavaScript URL */
  customJsUrl: z.string().url().optional().describe('Custom JavaScript URL'),
  
  /** Layout options */
  layout: z.object({
    showExtensions: z.boolean().default(false).describe('Show vendor extensions'),
    showCommonExtensions: z.boolean().default(false).describe('Show common extensions'),
    deepLinking: z.boolean().default(true).describe('Enable deep linking'),
    displayOperationId: z.boolean().default(false).describe('Display operation IDs'),
    defaultModelRendering: z.enum(['example', 'model']).default('example')
      .describe('Default model rendering mode'),
    defaultModelsExpandDepth: z.number().int().default(1).describe('Models expand depth'),
    defaultModelExpandDepth: z.number().int().default(1).describe('Single model expand depth'),
    docExpansion: z.enum(['list', 'full', 'none']).default('list')
      .describe('Documentation expansion mode'),
  }).optional().describe('Layout configuration'),
}));

export type ApiTestingUiConfig = z.infer<typeof ApiTestingUiConfigSchema>;

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

export type ApiTestRequest = z.infer<typeof ApiTestRequestSchema>;

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

export type ApiTestCollection = z.infer<typeof ApiTestCollectionSchema>;

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

export type ApiChangelogEntry = z.infer<typeof ApiChangelogEntrySchema>;

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

export type CodeGenerationTemplate = z.infer<typeof CodeGenerationTemplateSchema>;

/**
 * API Documentation Configuration Schema
 * 
 * Complete configuration for API documentation and testing interface.
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
 *   "ui": {
 *     "type": "swagger-ui",
 *     "theme": "light",
 *     "enableTryItOut": true
 *   },
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
  
  /** UI configuration */
  ui: ApiTestingUiConfigSchema.optional().describe('Testing UI configuration'),
  
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

export type ApiDocumentationConfig = z.infer<typeof ApiDocumentationConfigSchema>;

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

export type GeneratedApiDocumentation = z.infer<typeof GeneratedApiDocumentationSchema>;

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
