// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { z } from 'zod';
import { HttpMethod } from '../shared/http.zod';
import { MiddlewareConfigSchema } from '../system/http-server.zod';

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
 * @example Plugin Manifest
 * ```typescript
 * {
 *   "name": "rest_api",
 *   "version": "1.0.0",
 *   "type": "server",
 *   "contributes": {
 *     "routes": [
 *       {
 *         "prefix": "/api/v1/discovery",
 *         "service": "metadata",
 *         "methods": ["getDiscovery"],
 *         "middleware": [
 *           { "name": "response_envelope", "type": "transformation", "enabled": true }
 *         ]
 *       },
 *       {
 *         "prefix": "/api/v1/meta",
 *         "service": "metadata",
 *         "methods": ["getMetaTypes", "getMetaItems", "getMetaItem", "saveMetaItem"],
 *         "middleware": [
 *           { "name": "auth", "type": "authentication", "enabled": true },
 *           { "name": "request_validation", "type": "validation", "enabled": true }
 *         ]
 *       },
 *       {
 *         "prefix": "/api/v1/data",
 *         "service": "data",
 *         "methods": ["findData", "getData", "createData", "updateData", "deleteData"]
 *       }
 *     ]
 *   }
 * }
 * ```
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
  'workflow',     // Workflow state management
  'ui',           // UI metadata (views, layouts)
  'realtime',     // Realtime/WebSocket
  'notification', // Notification management
  'ai',           // AI operations (NLQ, chat)
  'i18n',         // Internationalization
]);

export type RestApiRouteCategory = z.infer<typeof RestApiRouteCategory>;

// ==========================================
// Route Registration Schema
// ==========================================

/**
 * Handler Implementation Status
 * Shared enum for tracking whether an endpoint has a real handler.
 * Used by both `RestApiEndpointSchema` and `RouteCoverageEntrySchema`.
 *
 * - `implemented` – A real handler is coded and registered.
 * - `stub`        – A placeholder handler exists that returns 501 Not Implemented.
 * - `planned`     – Declared in the protocol spec but not yet implemented.
 */
export const HandlerStatusSchema = lazySchema(() => z.enum(['implemented', 'stub', 'planned']));
export type HandlerStatus = z.infer<typeof HandlerStatusSchema>;

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
   * Handler implementation status.
   * Tracks whether this endpoint has a real handler or is only declared.
   *
   * - `implemented` – A real handler is coded and registered.
   * - `stub`        – A placeholder handler exists that returns 501 Not Implemented.
   * - `planned`     – Declared in the protocol spec but not yet implemented.
   * @default 'implemented'
   */
  handlerStatus: HandlerStatusSchema.optional()
    .describe('Handler implementation status: implemented (default if omitted), stub, or planned'),
}));

export type RestApiEndpoint = z.infer<typeof RestApiEndpointSchema>;

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

export type RestApiRouteRegistration = z.infer<typeof RestApiRouteRegistrationSchema>;

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

export type ValidationMode = z.infer<typeof ValidationMode>;

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

export type RequestValidationConfig = z.infer<typeof RequestValidationConfigSchema>;
export type RequestValidationConfigInput = z.input<typeof RequestValidationConfigSchema>;

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

export type ResponseEnvelopeConfig = z.infer<typeof ResponseEnvelopeConfigSchema>;
export type ResponseEnvelopeConfigInput = z.input<typeof ResponseEnvelopeConfigSchema>;

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

export type ErrorHandlingConfig = z.infer<typeof ErrorHandlingConfigSchema>;
export type ErrorHandlingConfigInput = z.input<typeof ErrorHandlingConfigSchema>;

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

export type OpenApiGenerationConfig = z.infer<typeof OpenApiGenerationConfigSchema>;
export type OpenApiGenerationConfigInput = z.input<typeof OpenApiGenerationConfigSchema>;

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

export type RestApiPluginConfig = z.infer<typeof RestApiPluginConfigSchema>;
export type RestApiPluginConfigInput = z.input<typeof RestApiPluginConfigSchema>;

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
  methods: ['getMetaTypes', 'getMetaItems', 'getMetaItem', 'saveMetaItem'],
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
      requestSchema: 'GetMetaItemRequestSchema',
      responseSchema: 'GetMetaItemResponseSchema',
      cacheable: true,
      cacheTtl: 3600,
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
      requestSchema: 'SaveMetaItemRequestSchema',
      responseSchema: 'SaveMetaItemResponseSchema',
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
      requestSchema: 'FindDataRequestSchema',
      responseSchema: 'ListRecordResponseSchema',
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
      requestSchema: 'IdRequestSchema',
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
      requestSchema: 'CreateRequestSchema',
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
      requestSchema: 'UpdateRequestSchema',
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
      requestSchema: 'IdRequestSchema',
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
      requestSchema: 'CreateManyRequestSchema',
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

/**
 * Default Permission Routes
 * Standard routes for permission checking
 */
export const DEFAULT_PERMISSION_ROUTES: RestApiRouteRegistration = {
  prefix: '/api/v1/auth',
  service: 'auth',
  category: 'permission',
  methods: ['checkPermission', 'getObjectPermissions', 'getEffectivePermissions'],
  authRequired: true,
  endpoints: [
    {
      method: 'POST',
      path: '/check',
      handler: 'checkPermission',
      category: 'permission',
      public: false,
      summary: 'Check permission',
      description: 'Check if current user has a specific permission',
      tags: ['Permission'],
      requestSchema: 'CheckPermissionRequestSchema',
      responseSchema: 'CheckPermissionResponseSchema',
      cacheable: false,
    },
    {
      method: 'GET',
      path: '/permissions/:object',
      handler: 'getObjectPermissions',
      category: 'permission',
      public: false,
      summary: 'Get object permissions',
      description: 'Get all permissions for a specific object',
      tags: ['Permission'],
      responseSchema: 'ObjectPermissionsResponseSchema',
      cacheable: true,
      cacheTtl: 300,
    },
    {
      method: 'GET',
      path: '/permissions/effective',
      handler: 'getEffectivePermissions',
      category: 'permission',
      public: false,
      summary: 'Get effective permissions',
      description: 'Get all effective permissions for current user',
      tags: ['Permission'],
      responseSchema: 'EffectivePermissionsResponseSchema',
      cacheable: true,
      cacheTtl: 300,
    },
  ],
  middleware: [
    { name: 'auth', type: 'authentication', enabled: true, order: 10 },
    { name: 'response_envelope', type: 'transformation', enabled: true, order: 100 },
  ],
};

// ==========================================
// View Management Routes
// ==========================================

/**
 * Default View Management Routes
 * Standard routes for UI view CRUD operations
 */
export const DEFAULT_VIEW_ROUTES: RestApiRouteRegistration = {
  prefix: '/api/v1/ui',
  service: 'ui',
  category: 'ui',
  methods: ['listViews', 'getView', 'createView', 'updateView', 'deleteView'],
  authRequired: true,
  endpoints: [
    {
      method: 'GET',
      path: '/views/:object',
      handler: 'listViews',
      category: 'ui',
      public: false,
      summary: 'List views for an object',
      description: 'Returns all views (list, form) for the specified object',
      tags: ['Views', 'UI'],
      responseSchema: 'ListViewsResponseSchema',
      cacheable: true,
      cacheTtl: 1800,
    },
    {
      method: 'GET',
      path: '/views/:object/:viewId',
      handler: 'getView',
      category: 'ui',
      public: false,
      summary: 'Get a specific view',
      description: 'Returns a specific view definition by object and view ID',
      tags: ['Views', 'UI'],
      responseSchema: 'GetViewResponseSchema',
      cacheable: true,
      cacheTtl: 1800,
    },
    {
      method: 'POST',
      path: '/views/:object',
      handler: 'createView',
      category: 'ui',
      public: false,
      summary: 'Create a new view',
      description: 'Creates a new view definition for the specified object',
      tags: ['Views', 'UI'],
      requestSchema: 'CreateViewRequestSchema',
      responseSchema: 'CreateViewResponseSchema',
      permissions: ['ui.view.create'],
      cacheable: false,
    },
    {
      method: 'PATCH',
      path: '/views/:object/:viewId',
      handler: 'updateView',
      category: 'ui',
      public: false,
      summary: 'Update a view',
      description: 'Updates an existing view definition',
      tags: ['Views', 'UI'],
      requestSchema: 'UpdateViewRequestSchema',
      responseSchema: 'UpdateViewResponseSchema',
      permissions: ['ui.view.update'],
      cacheable: false,
    },
    {
      method: 'DELETE',
      path: '/views/:object/:viewId',
      handler: 'deleteView',
      category: 'ui',
      public: false,
      summary: 'Delete a view',
      description: 'Deletes a view definition',
      tags: ['Views', 'UI'],
      responseSchema: 'DeleteViewResponseSchema',
      permissions: ['ui.view.delete'],
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
// Workflow Routes
// ==========================================

/**
 * Default Workflow Routes
 * Standard routes for workflow state management and transitions
 */
export const DEFAULT_WORKFLOW_ROUTES: RestApiRouteRegistration = {
  prefix: '/api/v1/workflow',
  service: 'workflow',
  category: 'workflow',
  methods: ['getWorkflowConfig', 'getWorkflowState', 'workflowTransition', 'workflowApprove', 'workflowReject'],
  authRequired: true,
  endpoints: [
    {
      method: 'GET',
      path: '/:object/config',
      handler: 'getWorkflowConfig',
      category: 'workflow',
      public: false,
      summary: 'Get workflow configuration',
      description: 'Returns workflow rules and state machine configuration for an object',
      tags: ['Workflow'],
      responseSchema: 'GetWorkflowConfigResponseSchema',
      cacheable: true,
      cacheTtl: 3600,
    },
    {
      method: 'GET',
      path: '/:object/:recordId/state',
      handler: 'getWorkflowState',
      category: 'workflow',
      public: false,
      summary: 'Get workflow state',
      description: 'Returns current workflow state and available transitions for a record',
      tags: ['Workflow'],
      responseSchema: 'GetWorkflowStateResponseSchema',
      cacheable: false,
    },
    {
      method: 'POST',
      path: '/:object/:recordId/transition',
      handler: 'workflowTransition',
      category: 'workflow',
      public: false,
      summary: 'Execute workflow transition',
      description: 'Transitions a record to a new workflow state',
      tags: ['Workflow'],
      requestSchema: 'WorkflowTransitionRequestSchema',
      responseSchema: 'WorkflowTransitionResponseSchema',
      permissions: ['workflow.transition'],
      cacheable: false,
    },
    {
      method: 'POST',
      path: '/:object/:recordId/approve',
      handler: 'workflowApprove',
      category: 'workflow',
      public: false,
      summary: 'Approve workflow step',
      description: 'Approves a pending workflow approval step',
      tags: ['Workflow'],
      requestSchema: 'WorkflowApproveRequestSchema',
      responseSchema: 'WorkflowApproveResponseSchema',
      permissions: ['workflow.approve'],
      cacheable: false,
    },
    {
      method: 'POST',
      path: '/:object/:recordId/reject',
      handler: 'workflowReject',
      category: 'workflow',
      public: false,
      summary: 'Reject workflow step',
      description: 'Rejects a pending workflow approval step',
      tags: ['Workflow'],
      requestSchema: 'WorkflowRejectRequestSchema',
      responseSchema: 'WorkflowRejectResponseSchema',
      permissions: ['workflow.reject'],
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

// ==========================================
// Realtime Routes
// ==========================================

/**
 * Default Realtime Routes
 * Standard routes for realtime connection management and subscriptions
 */
export const DEFAULT_REALTIME_ROUTES: RestApiRouteRegistration = {
  prefix: '/api/v1/realtime',
  service: 'realtime',
  category: 'realtime',
  methods: ['realtimeConnect', 'realtimeDisconnect', 'realtimeSubscribe', 'realtimeUnsubscribe', 'setPresence', 'getPresence'],
  authRequired: true,
  endpoints: [
    {
      method: 'POST',
      path: '/connect',
      handler: 'realtimeConnect',
      category: 'realtime',
      public: false,
      summary: 'Establish realtime connection',
      description: 'Negotiates a realtime connection (WebSocket/SSE) and returns connection details',
      tags: ['Realtime'],
      requestSchema: 'RealtimeConnectRequestSchema',
      responseSchema: 'RealtimeConnectResponseSchema',
      cacheable: false,
    },
    {
      method: 'POST',
      path: '/disconnect',
      handler: 'realtimeDisconnect',
      category: 'realtime',
      public: false,
      summary: 'Close realtime connection',
      description: 'Closes an active realtime connection',
      tags: ['Realtime'],
      requestSchema: 'RealtimeDisconnectRequestSchema',
      responseSchema: 'RealtimeDisconnectResponseSchema',
      cacheable: false,
    },
    {
      method: 'POST',
      path: '/subscribe',
      handler: 'realtimeSubscribe',
      category: 'realtime',
      public: false,
      summary: 'Subscribe to channel',
      description: 'Subscribes to a realtime channel for receiving events',
      tags: ['Realtime'],
      requestSchema: 'RealtimeSubscribeRequestSchema',
      responseSchema: 'RealtimeSubscribeResponseSchema',
      cacheable: false,
    },
    {
      method: 'POST',
      path: '/unsubscribe',
      handler: 'realtimeUnsubscribe',
      category: 'realtime',
      public: false,
      summary: 'Unsubscribe from channel',
      description: 'Unsubscribes from a realtime channel',
      tags: ['Realtime'],
      requestSchema: 'RealtimeUnsubscribeRequestSchema',
      responseSchema: 'RealtimeUnsubscribeResponseSchema',
      cacheable: false,
    },
    {
      method: 'PUT',
      path: '/presence/:channel',
      handler: 'setPresence',
      category: 'realtime',
      public: false,
      summary: 'Set presence state',
      description: 'Sets the current user\'s presence state in a channel',
      tags: ['Realtime'],
      requestSchema: 'SetPresenceRequestSchema',
      responseSchema: 'SetPresenceResponseSchema',
      cacheable: false,
    },
    {
      method: 'GET',
      path: '/presence/:channel',
      handler: 'getPresence',
      category: 'realtime',
      public: false,
      summary: 'Get channel presence',
      description: 'Returns all active members and their presence state in a channel',
      tags: ['Realtime'],
      responseSchema: 'GetPresenceResponseSchema',
      cacheable: false,
    },
  ],
  middleware: [
    { name: 'auth', type: 'authentication', enabled: true, order: 10 },
    { name: 'response_envelope', type: 'transformation', enabled: true, order: 100 },
  ],
};

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
    'registerDevice', 'unregisterDevice',
    'getNotificationPreferences', 'updateNotificationPreferences',
    'listNotifications', 'markNotificationsRead', 'markAllNotificationsRead',
  ],
  authRequired: true,
  endpoints: [
    {
      method: 'POST',
      path: '/devices',
      handler: 'registerDevice',
      category: 'notification',
      public: false,
      summary: 'Register device for push notifications',
      description: 'Registers a device token for receiving push notifications',
      tags: ['Notifications'],
      requestSchema: 'RegisterDeviceRequestSchema',
      responseSchema: 'RegisterDeviceResponseSchema',
      cacheable: false,
    },
    {
      method: 'DELETE',
      path: '/devices/:deviceId',
      handler: 'unregisterDevice',
      category: 'notification',
      public: false,
      summary: 'Unregister device',
      description: 'Removes a device from push notification registration',
      tags: ['Notifications'],
      responseSchema: 'UnregisterDeviceResponseSchema',
      cacheable: false,
    },
    {
      method: 'GET',
      path: '/preferences',
      handler: 'getNotificationPreferences',
      category: 'notification',
      public: false,
      summary: 'Get notification preferences',
      description: 'Returns current user notification preferences',
      tags: ['Notifications'],
      responseSchema: 'GetNotificationPreferencesResponseSchema',
      cacheable: false,
    },
    {
      method: 'PATCH',
      path: '/preferences',
      handler: 'updateNotificationPreferences',
      category: 'notification',
      public: false,
      summary: 'Update notification preferences',
      description: 'Updates user notification preferences',
      tags: ['Notifications'],
      requestSchema: 'UpdateNotificationPreferencesRequestSchema',
      responseSchema: 'UpdateNotificationPreferencesResponseSchema',
      cacheable: false,
    },
    {
      method: 'GET',
      path: '',
      handler: 'listNotifications',
      category: 'notification',
      public: false,
      summary: 'List notifications',
      description: 'Returns paginated list of notifications for the current user',
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

/**
 * Default AI Routes
 * Standard routes for AI operations (NLQ, Chat, Suggest, Insights)
 */
export const DEFAULT_AI_ROUTES: RestApiRouteRegistration = {
  prefix: '/api/v1/ai',
  service: 'ai',
  category: 'ai',
  methods: ['aiNlq', 'aiSuggest', 'aiInsights'],
  authRequired: true,
  endpoints: [
    {
      method: 'POST',
      path: '/nlq',
      handler: 'aiNlq',
      category: 'ai',
      public: false,
      summary: 'Natural language query',
      description: 'Converts a natural language query to a structured query AST',
      tags: ['AI'],
      requestSchema: 'AiNlqRequestSchema',
      responseSchema: 'AiNlqResponseSchema',
      timeout: 30000,
      cacheable: false,
    },
    // AI chat route removed — wire protocol aligned with Vercel AI SDK.
    // The chat endpoint should use Vercel's `toDataStreamResponse()` directly.
    {
      method: 'POST',
      path: '/suggest',
      handler: 'aiSuggest',
      category: 'ai',
      public: false,
      summary: 'Get AI-powered suggestions',
      description: 'Returns AI-generated field value suggestions based on context',
      tags: ['AI'],
      requestSchema: 'AiSuggestRequestSchema',
      responseSchema: 'AiSuggestResponseSchema',
      timeout: 15000,
      cacheable: false,
    },
    {
      method: 'POST',
      path: '/insights',
      handler: 'aiInsights',
      category: 'ai',
      public: false,
      summary: 'Get AI-generated insights',
      description: 'Returns AI-generated insights (summaries, trends, anomalies, recommendations)',
      tags: ['AI'],
      requestSchema: 'AiInsightsRequestSchema',
      responseSchema: 'AiInsightsResponseSchema',
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
      description: 'Returns translation strings for the specified locale and optional namespace',
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
      path: '/trigger',
      handler: 'triggerAutomation',
      category: 'automation',
      public: false,
      summary: 'Trigger automation',
      description: 'Triggers an automation flow or script by name',
      tags: ['Automation'],
      requestSchema: 'AutomationTriggerRequestSchema',
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
 * Route groups (13 total):
 * 1. Discovery - API capabilities and routing info
 * 2. Metadata - Object/field schema CRUD
 * 3. Data CRUD - Record operations
 * 4. Batch - Bulk operations
 * 5. Permission - Authorization checks
 * 6. Views - UI view CRUD
 * 7. Workflow - State machine transitions
 * 8. Realtime - WebSocket/SSE connections
 * 9. Notification - Push notifications and preferences
 * 10. AI - NLQ, chat, suggestions, insights
 * 11. i18n - Locales and translations
 * 12. Analytics - BI queries and metadata
 * 13. Automation - Trigger flows and scripts
 */
export function getDefaultRouteRegistrations(): RestApiRouteRegistration[] {
  return [
    DEFAULT_DISCOVERY_ROUTES,
    DEFAULT_METADATA_ROUTES,
    DEFAULT_DATA_CRUD_ROUTES,
    DEFAULT_BATCH_ROUTES,
    DEFAULT_PERMISSION_ROUTES,
    DEFAULT_VIEW_ROUTES,
    DEFAULT_WORKFLOW_ROUTES,
    DEFAULT_REALTIME_ROUTES,
    DEFAULT_NOTIFICATION_ROUTES,
    DEFAULT_AI_ROUTES,
    DEFAULT_I18N_ROUTES,
    DEFAULT_ANALYTICS_ROUTES,
    DEFAULT_AUTOMATION_ROUTES,
  ];
}

// ==========================================
// Route Coverage Report
// ==========================================

/**
 * Route Coverage Entry Schema
 * Reports the coverage status of a single declared endpoint.
 */
export const RouteCoverageEntrySchema = z.object({
  /** Full URL path of the endpoint */
  path: z.string().describe('Full URL path (e.g. /api/v1/analytics/query)'),
  /** HTTP method */
  method: HttpMethod.describe('HTTP method (GET, POST, etc.)'),
  /** Route category */
  category: RestApiRouteCategory.describe('Route category'),
  /** Handler implementation status */
  handlerStatus: HandlerStatusSchema.describe('Handler status'),
  /** Target service */
  service: z.string().describe('Target service name'),
  /** Whether the handler was successfully called during health check */
  healthCheckPassed: z.boolean().optional().describe('Whether the health check probe succeeded'),
});

export type RouteCoverageEntry = z.infer<typeof RouteCoverageEntrySchema>;

/**
 * Route Coverage Report Schema
 *
 * Aggregated report generated by the adapter/dispatcher at startup.
 * Lists every declared endpoint and whether a handler is confirmed.
 *
 * Adapters SHOULD log a warning for every endpoint where
 * `handlerStatus !== 'implemented'` and emit this report as part
 * of the startup health diagnostics.
 */
export const RouteCoverageReportSchema = z.object({
  /** ISO 8601 timestamp of report generation */
  timestamp: z.string().describe('ISO 8601 timestamp'),
  /** Adapter that generated the report */
  adapter: z.string().describe('Adapter name (e.g. "hono", "express", "nextjs")'),
  /** Summary counters */
  summary: z.object({
    total: z.number().int().describe('Total declared endpoints'),
    implemented: z.number().int().describe('Endpoints with real handlers'),
    stub: z.number().int().describe('Endpoints with stub handlers (501)'),
    planned: z.number().int().describe('Endpoints not yet implemented'),
  }),
  /** Per-endpoint entries */
  entries: z.array(RouteCoverageEntrySchema).describe('Per-endpoint coverage entries'),
});

export type RouteCoverageReport = z.infer<typeof RouteCoverageReportSchema>;
