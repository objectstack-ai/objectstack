// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { z } from 'zod';
import { HttpMethod, RateLimitConfigSchema } from '../shared/http.zod';
import { SnakeCaseIdentifierSchema } from '../shared/identifiers.zod';

/**
 * Unified API Registry Protocol
 * 
 * Provides a centralized registry for managing all API endpoints across different
 * API types (REST, OData, WebSocket, Auth, File, Plugin-registered).
 * 
 * This enables:
 * - Unified API discovery and documentation (similar to Swagger/OpenAPI)
 * - API testing interfaces
 * - API governance and monitoring
 * - Plugin API registration
 * - Multi-protocol support
 * 
 * Architecture Alignment:
 * - Kubernetes: Service Discovery & API Server
 * - AWS API Gateway: Unified API Management
 * - Kong Gateway: Plugin-based API Management
 * 
 * @example API Registry Entry
 * ```typescript
 * const apiEntry: ApiRegistryEntry = {
 *   id: 'customer_crud',
 *   name: 'Customer CRUD API',
 *   type: 'rest',
 *   version: 'v1',
 *   basePath: '/api/v1/data/customer',
 *   endpoints: [...],
 *   metadata: {
 *     owner: 'sales_team',
 *     tags: ['customer', 'crm']
 *   }
 * }
 * ```
 */

// ==========================================
// API Type Enumeration
// ==========================================

/**
 * API Protocol Type
 * 
 * Defines the different types of APIs supported by ObjectStack.
 */
import { lazySchema } from '../shared/lazy-schema';
export const ApiProtocolType = z.enum([
  'rest',      // RESTful API (CRUD operations)
  'odata',     // OData v4 API (enterprise integration)
  'websocket', // WebSocket API (real-time)
  'file',      // File/Storage API (uploads/downloads)
  'auth',      // Authentication/Authorization API
  'metadata',  // Metadata/Schema API
  'plugin',    // Plugin-registered custom API
  'webhook',   // Webhook endpoints
  'rpc',       // JSON-RPC or similar
]);

export type ApiProtocolType = z.infer<typeof ApiProtocolType>;

// ==========================================
// API Endpoint Registration
// ==========================================

/**
 * HTTP Status Code
 */
export const HttpStatusCode = z.union([
  z.number().int().min(100).max(599),
  z.enum(['2xx', '3xx', '4xx', '5xx']), // Pattern matching
]);

export type HttpStatusCode = z.infer<typeof HttpStatusCode>;

// ==========================================
// Schema Reference Types
// ==========================================

/**
 * ObjectQL Reference Schema
 * 
 * Allows referencing ObjectStack data objects instead of static JSON schemas.
 * When an API parameter or response references an ObjectQL object, the schema
 * is dynamically derived from the object definition, enabling automatic updates
 * when the object schema changes.
 * 
 * **IMPORTANT - Schema Resolution Responsibility:**
 * The API Registry STORES these references as metadata but does NOT resolve them.
 * Schema resolution (expanding references into actual JSON Schema) is performed by:
 * - **API Gateway**: For runtime request/response validation
 * - **OpenAPI Generator**: For Swagger/OpenAPI documentation
 * - **Documentation Tools**: For developer documentation
 * 
 * This separation allows the Registry to remain lightweight and focused on
 * registration/discovery, while specialized tools handle schema transformation.
 * 
 * **Benefits:**
 * - Auto-updating API documentation when object schemas change
 * - Consistent type definitions across API and database
 * - Reduced duplication and maintenance
 * - Registry remains protocol-agnostic and lightweight
 * 
 * @example Reference Customer object
 * ```json
 * {
 *   "objectId": "customer",
 *   "includeFields": ["id", "name", "email"],
 *   "excludeFields": ["internal_notes"]
 * }
 * ```
 */
export const ObjectQLReferenceSchema = lazySchema(() => z.object({
  /** Referenced object name (snake_case) */
  objectId: SnakeCaseIdentifierSchema.describe('Object name to reference'),
  
  /** Include only specific fields (optional) */
  includeFields: z.array(z.string()).optional()
    .describe('Include only these fields in the schema'),
  
  /** Exclude specific fields (optional) */
  excludeFields: z.array(z.string()).optional()
    .describe('Exclude these fields from the schema'),
  
  /** Include related objects via lookup fields */
  includeRelated: z.array(z.string()).optional()
    .describe('Include related objects via lookup fields'),
}));

export type ObjectQLReference = z.infer<typeof ObjectQLReferenceSchema>;

/**
 * Schema Definition
 * 
 * Unified schema definition that supports both:
 * 1. Static JSON Schema (traditional approach)
 * 2. Dynamic ObjectQL reference (linked to object definitions)
 * 
 * When using ObjectQL references, the API documentation and validation
 * automatically update when object schemas change, eliminating the need
 * to manually sync API schemas with data models.
 */
export const SchemaDefinition = z.union([
  z.unknown().describe('Static JSON Schema definition'),
  z.object({
    $ref: ObjectQLReferenceSchema.describe('Dynamic reference to ObjectQL object'),
  }).describe('Dynamic ObjectQL reference'),
]);

export type SchemaDefinition = z.infer<typeof SchemaDefinition>;

// ==========================================
// API Parameter & Response Schemas
// ==========================================

/**
 * API Parameter Schema
 * 
 * Defines a single API parameter (path, query, header, or body).
 * 
 * **Enhancement: Dynamic Schema Linking**
 * - Supports both static JSON Schema and dynamic ObjectQL references
 * - When using ObjectQL references, parameter validation automatically updates
 *   when the referenced object schema changes
 * 
 * @example Static schema
 * ```json
 * {
 *   "name": "customer_id",
 *   "in": "path",
 *   "schema": {
 *     "type": "string",
 *     "format": "uuid"
 *   }
 * }
 * ```
 * 
 * @example Dynamic ObjectQL reference
 * ```json
 * {
 *   "name": "customer",
 *   "in": "body",
 *   "schema": {
 *     "$ref": {
 *       "objectId": "customer",
 *       "excludeFields": ["internal_notes"]
 *     }
 *   }
 * }
 * ```
 */
export const ApiParameterSchema = lazySchema(() => z.object({
  /** Parameter name */
  name: z.string().describe('Parameter name'),
  
  /** Parameter location */
  in: z.enum(['path', 'query', 'header', 'body', 'cookie']).describe('Parameter location'),
  
  /** Parameter description */
  description: z.string().optional().describe('Parameter description'),
  
  /** Required flag */
  required: z.boolean().default(false).describe('Whether parameter is required'),
  
  /** Parameter type/schema - supports static or dynamic (ObjectQL) schemas */
  schema: z.union([
    z.object({
      type: z.enum(['string', 'number', 'integer', 'boolean', 'array', 'object']).describe('Parameter type'),
      format: z.string().optional().describe('Format (e.g., date-time, email, uuid)'),
      enum: z.array(z.unknown()).optional().describe('Allowed values'),
      default: z.unknown().optional().describe('Default value'),
      items: z.unknown().optional().describe('Array item schema'),
      properties: z.record(z.string(), z.unknown()).optional().describe('Object properties'),
    }).describe('Static JSON Schema'),
    z.object({
      $ref: ObjectQLReferenceSchema,
    }).describe('Dynamic ObjectQL reference'),
  ]).describe('Parameter schema definition'),
  
  /** Example value */
  example: z.unknown().optional().describe('Example value'),
}));

export type ApiParameter = z.infer<typeof ApiParameterSchema>;

/**
 * API Response Schema
 * 
 * Defines an API response for a specific status code.
 * 
 * **Enhancement: Dynamic Schema Linking**
 * - Response schema can reference ObjectQL objects
 * - When object definitions change, response documentation auto-updates
 * 
 * @example Response with ObjectQL reference
 * ```json
 * {
 *   "statusCode": 200,
 *   "description": "Customer retrieved successfully",
 *   "schema": {
 *     "$ref": {
 *       "objectId": "customer",
 *       "excludeFields": ["password_hash"]
 *     }
 *   }
 * }
 * ```
 */
export const ApiResponseSchema = lazySchema(() => z.object({
  /** HTTP status code */
  statusCode: HttpStatusCode.describe('HTTP status code'),
  
  /** Response description */
  description: z.string().describe('Response description'),
  
  /** Response content type */
  contentType: z.string().default('application/json').describe('Response content type'),
  
  /** Response schema - supports static or dynamic (ObjectQL) schemas */
  schema: z.union([
    z.unknown().describe('Static JSON Schema'),
    z.object({
      $ref: ObjectQLReferenceSchema,
    }).describe('Dynamic ObjectQL reference'),
  ]).optional().describe('Response body schema'),
  
  /** Response headers */
  headers: z.record(z.string(), z.object({
    description: z.string().optional(),
    schema: z.unknown(),
  })).optional().describe('Response headers'),
  
  /** Example response */
  example: z.unknown().optional().describe('Example response'),
}));

export type ApiResponse = z.infer<typeof ApiResponseSchema>;
export type ApiResponseInput = z.input<typeof ApiResponseSchema>;

/**
 * API Endpoint Registration Schema
 * 
 * Represents a single API endpoint registration with complete metadata.
 * 
 * **Enhancements:**
 * 1. **RBAC Integration**: `requiredPermissions` field for automatic permission checking
 * 2. **Dynamic Schema Linking**: Parameters and responses can reference ObjectQL objects
 * 3. **Route Priority**: `priority` field for conflict resolution
 * 4. **Protocol Config**: `protocolConfig` for protocol-specific extensions
 * 
 * @example REST Endpoint with RBAC
 * ```json
 * {
 *   "id": "get_customer_by_id",
 *   "method": "GET",
 *   "path": "/api/v1/data/customer/:id",
 *   "summary": "Get customer by ID",
 *   "requiredPermissions": ["customer.read"],
 *   "parameters": [
 *     {
 *       "name": "id",
 *       "in": "path",
 *       "required": true,
 *       "schema": { "type": "string" }
 *     }
 *   ],
 *   "responses": [
 *     {
 *       "statusCode": 200,
 *       "description": "Customer found",
 *       "schema": {
 *         "$ref": {
 *           "objectId": "customer"
 *         }
 *       }
 *     }
 *   ],
 *   "priority": 100
 * }
 * ```
 * 
 * @example Plugin Endpoint with Protocol Config
 * ```json
 * {
 *   "id": "grpc_service_method",
 *   "path": "/grpc/ServiceName/MethodName",
 *   "summary": "gRPC service method",
 *   "protocolConfig": {
 *     "subProtocol": "grpc",
 *     "serviceName": "CustomerService",
 *     "methodName": "GetCustomer"
 *   },
 *   "priority": 50
 * }
 * ```
 */
export const ApiEndpointRegistrationSchema = lazySchema(() => z.object({
  /** Unique endpoint identifier */
  id: z.string().describe('Unique endpoint identifier'),
  
  /** HTTP method (for HTTP-based APIs) */
  method: HttpMethod.optional().describe('HTTP method'),
  
  /** URL path pattern */
  path: z.string().describe('URL path pattern'),
  
  /** Short summary */
  summary: z.string().optional().describe('Short endpoint summary'),
  
  /** Detailed description */
  description: z.string().optional().describe('Detailed endpoint description'),
  
  /** Operation ID (OpenAPI) */
  operationId: z.string().optional().describe('Unique operation identifier'),
  
  /** Tags for grouping */
  tags: z.array(z.string()).optional().default([]).describe('Tags for categorization'),
  
  /** Parameters */
  parameters: z.array(ApiParameterSchema).optional().default([]).describe('Endpoint parameters'),
  
  /** Request body schema */
  requestBody: z.object({
    description: z.string().optional(),
    required: z.boolean().default(false),
    contentType: z.string().default('application/json'),
    schema: z.unknown().optional(),
    example: z.unknown().optional(),
  }).optional().describe('Request body specification'),
  
  /** Response definitions */
  responses: z.array(ApiResponseSchema).optional().default([]).describe('Possible responses'),
  
  /** Rate Limiting */
  rateLimit: RateLimitConfigSchema.optional().describe('Endpoint specific rate limiting'),

  /** Security Requirements */
  security: z.array(z.record(z.string(), z.array(z.string()))).optional().describe('Security requirements (e.g. [{"bearerAuth": []}])'),
  
  /**
   * Required Permissions (RBAC Integration)
   * 
   * Array of permission names required to access this endpoint.
   * The gateway layer automatically validates these permissions before
   * allowing the request to proceed, eliminating the need for permission
   * checks in individual API handlers.
   * 
   * **Format:** `<object>.<operation>` or system permission name
   * 
   * **Object Permissions:**
   * - `customer.read` - Read customer records
   * - `customer.create` - Create customer records
   * - `customer.edit` - Update customer records
   * - `customer.delete` - Delete customer records
   * - `customer.viewAll` - View all customer records (bypass sharing)
   * - `customer.modifyAll` - Modify all customer records (bypass sharing)
   * 
   * **System Permissions:**
   * - `manage_users` - User management
   * - `view_setup` - Access to system setup
   * - `customize_application` - Modify metadata
   * - `api_enabled` - API access
   * 
   * @example Object-level permissions
   * ```json
   * {
   *   "requiredPermissions": ["customer.read"]
   * }
   * ```
   * 
   * @example Multiple permissions (ALL required)
   * ```json
   * {
   *   "requiredPermissions": ["customer.read", "account.read"]
   * }
   * ```
   * 
   * @example System permission
   * ```json
   * {
   *   "requiredPermissions": ["manage_users"]
   * }
   * ```
   * 
   * @see {@link file://../../permission/permission.zod.ts} for permission definitions
   */
  requiredPermissions: z.array(z.string()).optional().default([])
    .describe('Required RBAC permissions (e.g., "customer.read", "manage_users")'),
  
  /**
   * Route Priority
   * 
   * Priority level for route conflict resolution. Higher priority routes
   * are registered first and take precedence when multiple routes match
   * the same path pattern.
   * 
   * **Default:** 100 (medium priority)
   * **Range:** 0-1000 (higher = more important)
   * 
   * **Use Cases:**
   * - Core system APIs: 900-1000
   * - Plugin APIs: 100-500
   * - Custom/override APIs: 500-900
   * - Fallback routes: 0-100
   * 
   * @example High priority core endpoint
   * ```json
   * {
   *   "path": "/api/v1/data/:object/:id",
   *   "priority": 950
   * }
   * ```
   * 
   * @example Medium priority plugin endpoint
   * ```json
   * {
   *   "path": "/api/v1/custom/action",
   *   "priority": 300
   * }
   * ```
   */
  priority: z.number().int().min(0).max(1000).optional().default(100)
    .describe('Route priority for conflict resolution (0-1000, higher = more important)'),
  
  /**
   * Protocol-Specific Configuration
   * 
   * Allows plugins and custom APIs to define protocol-specific metadata
   * that can be used for specialized handling or documentation generation.
   * 
   * **Examples:**
   * - gRPC: Service and method names
   * - tRPC: Procedure type (query/mutation)
   * - WebSocket: Event names and handlers
   * - Custom protocols: Any metadata needed
   * 
   * @example gRPC configuration
   * ```json
   * {
   *   "protocolConfig": {
   *     "subProtocol": "grpc",
   *     "serviceName": "CustomerService",
   *     "methodName": "GetCustomer",
   *     "streaming": false
   *   }
   * }
   * ```
   * 
   * @example tRPC configuration
   * ```json
   * {
   *   "protocolConfig": {
   *     "subProtocol": "trpc",
   *     "procedureType": "query",
   *     "router": "customer"
   *   }
   * }
   * ```
   * 
   * @example WebSocket configuration
   * ```json
   * {
   *   "protocolConfig": {
   *     "subProtocol": "websocket",
   *     "eventName": "customer.updated",
   *     "direction": "server-to-client"
   *   }
   * }
   * ```
   */
  protocolConfig: z.record(z.string(), z.unknown()).optional()
    .describe('Protocol-specific configuration for custom protocols (gRPC, tRPC, etc.)'),
  
  /** Deprecation flag */
  deprecated: z.boolean().default(false).describe('Whether endpoint is deprecated'),
  
  /** External documentation */
  externalDocs: z.object({
    description: z.string().optional(),
    url: z.string().url(),
  }).optional().describe('External documentation link'),
}));

export type ApiEndpointRegistration = z.infer<typeof ApiEndpointRegistrationSchema>;
export type ApiEndpointRegistrationInput = z.input<typeof ApiEndpointRegistrationSchema>;

// ==========================================
// API Registry Entry
// ==========================================

/**
 * API Metadata Schema
 * 
 * Additional metadata for an API registration.
 */
export const ApiMetadataSchema = lazySchema(() => z.object({
  /** API owner/team */
  owner: z.string().optional().describe('Owner team or person'),
  
  /** API status */
  status: z.enum(['active', 'deprecated', 'experimental', 'beta']).default('active')
    .describe('API lifecycle status'),
  
  /** Categorization tags */
  tags: z.array(z.string()).optional().default([]).describe('Classification tags'),
  
  /** Plugin source (if plugin-registered) */
  pluginSource: z.string().optional().describe('Source plugin name'),
  
  /** Custom metadata */
  custom: z.record(z.string(), z.unknown()).optional().describe('Custom metadata fields'),
}));

export type ApiMetadata = z.infer<typeof ApiMetadataSchema>;
export type ApiMetadataInput = z.input<typeof ApiMetadataSchema>;

/**
 * API Registry Entry Schema
 * 
 * Complete registration entry for an API in the unified registry.
 * 
 * @example REST API Entry
 * ```json
 * {
 *   "id": "customer_api",
 *   "name": "Customer Management API",
 *   "type": "rest",
 *   "version": "v1",
 *   "basePath": "/api/v1/data/customer",
 *   "description": "CRUD operations for customer records",
 *   "endpoints": [...],
 *   "metadata": {
 *     "owner": "sales_team",
 *     "status": "active",
 *     "tags": ["customer", "crm"]
 *   }
 * }
 * ```
 * 
 * @example Plugin API Entry
 * ```json
 * {
 *   "id": "payment_webhook",
 *   "name": "Payment Webhook API",
 *   "type": "plugin",
 *   "version": "1.0.0",
 *   "basePath": "/plugins/payment/webhook",
 *   "endpoints": [...],
 *   "metadata": {
 *     "pluginSource": "payment_gateway_plugin",
 *     "status": "active"
 *   }
 * }
 * ```
 */
export const ApiRegistryEntrySchema = lazySchema(() => z.object({
  /** Unique API identifier */
  id: z.string().regex(/^[a-z_][a-z0-9_]*$/).describe('Unique API identifier (snake_case)'),
  
  /** Human-readable name */
  name: z.string().describe('API display name'),
  
  /** API protocol type */
  type: ApiProtocolType.describe('API protocol type'),
  
  /** API version */
  version: z.string().describe('API version (e.g., v1, 2024-01)'),
  
  /** Base URL path */
  basePath: z.string().describe('Base URL path for this API'),
  
  /** API description */
  description: z.string().optional().describe('API description'),
  
  /** Endpoints in this API */
  endpoints: z.array(ApiEndpointRegistrationSchema).describe('Registered endpoints'),
  
  /** OpenAPI/OData specific configuration */
  config: z.record(z.string(), z.unknown()).optional().describe('Protocol-specific configuration'),
  
  /** API metadata */
  metadata: ApiMetadataSchema.optional().describe('Additional metadata'),
  
  /** Terms of service URL */
  termsOfService: z.string().url().optional().describe('Terms of service URL'),
  
  /** Contact information */
  contact: z.object({
    name: z.string().optional(),
    url: z.string().url().optional(),
    email: z.string().email().optional(),
  }).optional().describe('Contact information'),
  
  /** License information */
  license: z.object({
    name: z.string(),
    url: z.string().url().optional(),
  }).optional().describe('License information'),
}));

export type ApiRegistryEntry = z.infer<typeof ApiRegistryEntrySchema>;
export type ApiRegistryEntryInput = z.input<typeof ApiRegistryEntrySchema>;

// ==========================================
// API Registry
// ==========================================

/**
 * Route Conflict Resolution Strategy
 * 
 * Defines how to handle conflicts when multiple endpoints register
 * the same or overlapping URL patterns.
 */
export const ConflictResolutionStrategy = z.enum([
  'error',       // Throw error on conflict (safest, default)
  'priority',    // Use priority field to resolve (highest priority wins)
  'first-wins',  // First registered endpoint wins
  'last-wins',   // Last registered endpoint wins (override mode)
]);

export type ConflictResolutionStrategy = z.infer<typeof ConflictResolutionStrategy>;

/**
 * API Registry Schema
 * 
 * Central registry containing all registered APIs.
 * 
 * **Enhancement: Route Conflict Detection**
 * - `conflictResolution`: Strategy for handling route conflicts
 * - Prevents silent overwrites and unexpected routing behavior
 * 
 * @example
 * ```json
 * {
 *   "version": "1.0.0",
 *   "conflictResolution": "priority",
 *   "apis": [
 *     { "id": "customer_api", "type": "rest", ... },
 *     { "id": "graphql_api", "type": "graphql", ... },
 *     { "id": "file_upload_api", "type": "file", ... }
 *   ],
 *   "totalApis": 3,
 *   "totalEndpoints": 47
 * }
 * ```
 * 
 * @example Priority-based conflict resolution
 * ```json
 * {
 *   "conflictResolution": "priority",
 *   "apis": [
 *     {
 *       "id": "core_api",
 *       "endpoints": [
 *         {
 *           "path": "/api/v1/data/:object",
 *           "priority": 950
 *         }
 *       ]
 *     },
 *     {
 *       "id": "plugin_api",
 *       "endpoints": [
 *         {
 *           "path": "/api/v1/data/custom",
 *           "priority": 300
 *         }
 *       ]
 *     }
 *   ]
 * }
 * ```
 */
export const ApiRegistrySchema = lazySchema(() => z.object({
  /** Registry version */
  version: z.string().describe('Registry version'),
  
  /**
   * Conflict Resolution Strategy
   * 
   * Defines how to handle route conflicts when multiple endpoints
   * register the same or overlapping URL patterns.
   * 
   * **Strategies:**
   * - `error`: Throw error on conflict (safest, prevents silent overwrites)
   * - `priority`: Use endpoint priority field (highest priority wins)
   * - `first-wins`: First registered endpoint wins (stable, predictable)
   * - `last-wins`: Last registered endpoint wins (allows overrides)
   * 
   * **Default:** `error`
   * 
   * **Best Practices:**
   * - Use `error` in production to catch configuration issues
   * - Use `priority` when mixing core and plugin APIs
   * - Use `last-wins` for development/testing overrides
   * 
   * @example Prevent accidental conflicts
   * ```json
   * {
   *   "conflictResolution": "error"
   * }
   * ```
   * 
   * @example Allow plugin overrides with priority
   * ```json
   * {
   *   "conflictResolution": "priority"
   * }
   * ```
   */
  conflictResolution: ConflictResolutionStrategy.optional().default('error')
    .describe('Strategy for handling route conflicts'),
  
  /** Registered APIs */
  apis: z.array(ApiRegistryEntrySchema).describe('All registered APIs'),
  
  /** Total API count */
  totalApis: z.number().int().describe('Total number of registered APIs'),
  
  /** Total endpoint count across all APIs */
  totalEndpoints: z.number().int().describe('Total number of endpoints'),
  
  /** APIs grouped by type */
  byType: z.record(ApiProtocolType, z.array(ApiRegistryEntrySchema)).optional()
    .describe('APIs grouped by protocol type'),
  
  /** APIs grouped by status */
  byStatus: z.record(z.string(), z.array(ApiRegistryEntrySchema)).optional()
    .describe('APIs grouped by status'),
  
  /** Last updated timestamp */
  updatedAt: z.string().datetime().optional().describe('Last registry update time'),
}));

export type ApiRegistry = z.infer<typeof ApiRegistrySchema>;

// ==========================================
// API Discovery & Query
// ==========================================

/**
 * API Discovery Query Schema
 * 
 * Query parameters for discovering/filtering APIs in the registry.
 * 
 * @example
 * ```json
 * {
 *   "type": "rest",
 *   "tags": ["customer"],
 *   "status": "active"
 * }
 * ```
 */
export const ApiDiscoveryQuerySchema = lazySchema(() => z.object({
  /** Filter by API type */
  type: ApiProtocolType.optional().describe('Filter by API protocol type'),
  
  /** Filter by tags */
  tags: z.array(z.string()).optional().describe('Filter by tags (ANY match)'),
  
  /** Filter by status */
  status: z.enum(['active', 'deprecated', 'experimental', 'beta']).optional()
    .describe('Filter by lifecycle status'),
  
  /** Filter by plugin source */
  pluginSource: z.string().optional().describe('Filter by plugin name'),
  
  /** Search in name/description */
  search: z.string().optional().describe('Full-text search in name/description'),
  
  /** Filter by version */
  version: z.string().optional().describe('Filter by specific version'),
}));

export type ApiDiscoveryQuery = z.infer<typeof ApiDiscoveryQuerySchema>;

/**
 * API Discovery Response Schema
 * 
 * Response for API discovery queries.
 */
export const ApiDiscoveryResponseSchema = lazySchema(() => z.object({
  /** Matching APIs */
  apis: z.array(ApiRegistryEntrySchema).describe('Matching API entries'),
  
  /** Total matches */
  total: z.number().int().describe('Total matching APIs'),
  
  /** Applied filters */
  filters: ApiDiscoveryQuerySchema.optional().describe('Applied query filters'),
}));

export type ApiDiscoveryResponse = z.infer<typeof ApiDiscoveryResponseSchema>;

// ==========================================
// Helper Functions
// ==========================================

/**
 * Helper to create API endpoint registration
 */
export const ApiEndpointRegistration = Object.assign(ApiEndpointRegistrationSchema, {
  create: <T extends z.input<typeof ApiEndpointRegistrationSchema>>(config: T) => config,
});

/**
 * Helper to create API registry entry
 */
export const ApiRegistryEntry = Object.assign(ApiRegistryEntrySchema, {
  create: <T extends z.input<typeof ApiRegistryEntrySchema>>(config: T) => config,
});

/**
 * Helper to create API registry
 */
export const ApiRegistry = Object.assign(ApiRegistrySchema, {
  create: <T extends z.input<typeof ApiRegistrySchema>>(config: T) => config,
});
