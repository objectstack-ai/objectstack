# REST API Plugin Implementation

## Overview

This document describes the implementation of Phase 2 of the API Protocol plan: **核心 REST API 插件** (Core REST API Plugin).

The REST API plugin provides a standardized way to register and configure REST API endpoints for ObjectStack services, with built-in support for:
- Request validation using Zod schemas
- Response envelope wrapping
- Standardized error handling
- OpenAPI documentation auto-generation

## Key Components

### 1. Route Registration (`RestApiRouteRegistrationSchema`)

Defines how to register groups of related endpoints under a common prefix.

**Example:**
```typescript
const dataRoutes: RestApiRouteRegistration = {
  prefix: '/api/v1/data',
  service: 'data',
  category: 'data',
  methods: ['findData', 'getData', 'createData', 'updateData', 'deleteData'],
  endpoints: [
    {
      method: 'GET',
      path: '/:object',
      handler: 'findData',
      category: 'data',
      public: false,
      permissions: ['data.read'],
      summary: 'Query records',
      requestSchema: 'FindDataRequestSchema',
      responseSchema: 'ListRecordResponseSchema',
    },
    // ... more endpoints
  ],
  middleware: [
    { name: 'auth', type: 'authentication', enabled: true, order: 10 },
    { name: 'validation', type: 'validation', enabled: true, order: 20 },
    { name: 'response_envelope', type: 'transformation', enabled: true, order: 100 },
  ],
  authRequired: true,
};
```

### 2. Request Validation (`RequestValidationConfigSchema`)

Configures automatic request validation using Zod schemas.

**Features:**
- Three validation modes: `strict`, `permissive`, `strip`
- Validates body, query parameters, URL parameters, and headers
- Field-level error details
- Custom error messages

**Example:**
```typescript
const validation: RequestValidationConfig = {
  enabled: true,
  mode: 'strict',
  validateBody: true,
  validateQuery: true,
  validateParams: true,
  includeFieldErrors: true,
};
```

### 3. Response Envelope (`ResponseEnvelopeConfigSchema`)

Standardizes all API responses using `BaseResponseSchema`.

**Features:**
- Automatic wrapping of response data
- Metadata injection (timestamp, requestId, duration, traceId)
- Custom metadata support
- Skip wrapping for already-wrapped responses

**Example:**
```typescript
const responseEnvelope: ResponseEnvelopeConfig = {
  enabled: true,
  includeMetadata: true,
  includeTimestamp: true,
  includeRequestId: true,
  includeDuration: true,
  includeTraceId: true,
};
```

**Response Format:**
```json
{
  "success": true,
  "data": { ... },
  "meta": {
    "timestamp": "2026-02-08T10:00:00Z",
    "requestId": "req_123",
    "duration": 45,
    "traceId": "trace_456"
  }
}
```

### 4. Error Handling (`ErrorHandlingConfigSchema`)

Standardizes error responses using `ApiErrorSchema`.

**Features:**
- Stack trace inclusion (dev mode)
- Error logging
- Documentation URL generation
- Custom error messages by code
- Field redaction for sensitive data

**Example:**
```typescript
const errorHandling: ErrorHandlingConfig = {
  enabled: true,
  includeStackTrace: false,
  logErrors: true,
  exposeInternalErrors: false,
  includeDocumentation: true,
  documentationBaseUrl: 'https://docs.objectstack.dev/errors',
  customErrorMessages: {
    validation_error: 'Your request data is invalid. Please check your input.',
  },
  redactFields: ['password', 'ssn', 'creditCard'],
};
```

**Error Response Format:**
```json
{
  "success": false,
  "error": {
    "code": "validation_error",
    "message": "Validation failed for 2 fields",
    "category": "validation",
    "httpStatus": 400,
    "retryable": false,
    "fieldErrors": [
      {
        "field": "email",
        "code": "invalid_format",
        "message": "Email format is invalid",
        "value": "not-an-email"
      }
    ],
    "timestamp": "2026-02-08T10:00:00Z",
    "requestId": "req_123",
    "documentation": "https://docs.objectstack.dev/errors/validation_error"
  }
}
```

### 5. OpenAPI Generation (`OpenApiGenerationConfigSchema`)

Automatically generates OpenAPI documentation from route definitions and Zod schemas.

**Features:**
- OpenAPI 3.0.x and 3.1.0 support
- Multiple UI frameworks (Swagger UI, Redoc, RapiDoc, Elements)
- Auto-generated schemas from Zod definitions
- Request/response examples
- Server URLs, contact info, license info

**Example:**
```typescript
const openApi: OpenApiGenerationConfig = {
  enabled: true,
  version: '3.0.3',
  title: 'ObjectStack API',
  description: 'Comprehensive API for ObjectStack',
  apiVersion: '1.0.0',
  outputPath: '/api/docs/openapi.json',
  uiPath: '/api/docs',
  uiFramework: 'swagger-ui',
  generateSchemas: true,
  includeExamples: true,
  servers: [
    { url: 'https://api.example.com', description: 'Production' },
    { url: 'https://api-staging.example.com', description: 'Staging' },
  ],
  contact: {
    name: 'API Support',
    email: 'api@example.com',
  },
  license: {
    name: 'MIT',
    url: 'https://opensource.org/licenses/MIT',
  },
};
```

## Default Route Registrations

The plugin provides five default route registrations:

### 1. Discovery Routes (`DEFAULT_DISCOVERY_ROUTES`)
- **Prefix:** `/api/v1/discovery`
- **Public:** Yes (no auth required)
- **Endpoints:** `GET /discovery`

### 2. Metadata Routes (`DEFAULT_METADATA_ROUTES`)
- **Prefix:** `/api/v1/meta`
- **Auth Required:** Yes
- **Endpoints:**
  - `GET /meta` - List metadata types
  - `GET /meta/:type` - List items of a type
  - `GET /meta/:type/:name` - Get specific item
  - `PUT /meta/:type/:name` - Create/update item
- **Caching:** Enabled (1 hour TTL)

### 3. Data CRUD Routes (`DEFAULT_DATA_CRUD_ROUTES`)
- **Prefix:** `/api/v1/data`
- **Auth Required:** Yes
- **Endpoints:**
  - `GET /data/:object` - Query records
  - `GET /data/:object/:id` - Get record by ID
  - `POST /data/:object` - Create record
  - `PATCH /data/:object/:id` - Update record
  - `DELETE /data/:object/:id` - Delete record
- **Permissions:** `data.read`, `data.create`, `data.update`, `data.delete`

### 4. Batch Routes (`DEFAULT_BATCH_ROUTES`)
- **Prefix:** `/api/v1/data/:object`
- **Auth Required:** Yes
- **Endpoints:**
  - `POST /batch` - Generic batch operation
  - `POST /createMany` - Batch create
  - `POST /updateMany` - Batch update
  - `POST /deleteMany` - Batch delete
- **Timeout:** 60 seconds
- **Permissions:** `data.batch` + operation-specific permissions

### 5. Permission Routes (`DEFAULT_PERMISSION_ROUTES`)
- **Prefix:** `/api/v1/auth`
- **Auth Required:** Yes
- **Endpoints:**
  - `POST /auth/check` - Check permission
  - `GET /auth/permissions/:object` - Get object permissions
  - `GET /auth/permissions/effective` - Get effective permissions
- **Caching:** Enabled for GET endpoints (5 minutes TTL)

## Plugin Configuration

Complete plugin configuration example:

```typescript
const config: RestApiPluginConfig = {
  enabled: true,
  basePath: '/api',
  version: 'v1',
  
  // Route registrations
  routes: [
    DEFAULT_DISCOVERY_ROUTES,
    DEFAULT_METADATA_ROUTES,
    DEFAULT_DATA_CRUD_ROUTES,
    DEFAULT_BATCH_ROUTES,
    DEFAULT_PERMISSION_ROUTES,
  ],
  
  // Request validation
  validation: {
    enabled: true,
    mode: 'strict',
    validateBody: true,
    validateQuery: true,
    includeFieldErrors: true,
  },
  
  // Response envelope
  responseEnvelope: {
    enabled: true,
    includeMetadata: true,
    includeTimestamp: true,
    includeRequestId: true,
  },
  
  // Error handling
  errorHandling: {
    enabled: true,
    includeStackTrace: false,
    logErrors: true,
    includeDocumentation: true,
  },
  
  // OpenAPI documentation
  openApi: {
    enabled: true,
    title: 'ObjectStack API',
    generateSchemas: true,
    includeExamples: true,
  },
  
  // Global middleware
  globalMiddleware: [
    { name: 'cors', type: 'custom', enabled: true, order: 1 },
    { name: 'logger', type: 'logging', enabled: true, order: 5 },
  ],
  
  // CORS configuration
  cors: {
    enabled: true,
    origins: ['http://localhost:3000'],
    credentials: true,
  },
  
  // Performance settings
  performance: {
    enableCompression: true,
    enableETag: true,
    enableCaching: true,
    defaultCacheTtlSeconds: 300,
  },
};
```

## Middleware Execution Order

Middleware is executed in the following order (lower numbers first):

1. **CORS** (order: 1) - Cross-origin resource sharing
2. **Logger** (order: 5) - Request/response logging
3. **Authentication** (order: 10) - JWT/session validation
4. **Validation** (order: 20) - Request schema validation
5. **Response Envelope** (order: 100) - Response wrapping
6. **Error Handler** (order: 200) - Error formatting

## Usage in Plugin Manifest

```typescript
{
  "name": "rest_api",
  "version": "1.0.0",
  "type": "server",
  "contributes": {
    "routes": [
      {
        "prefix": "/api/v1/discovery",
        "service": "metadata",
        "methods": ["getDiscovery"],
      },
      {
        "prefix": "/api/v1/meta",
        "service": "metadata",
        "methods": ["getMetaTypes", "getMetaItems", "getMetaItem", "saveMetaItem"],
      },
      {
        "prefix": "/api/v1/data",
        "service": "data",
        "methods": ["findData", "getData", "createData", "updateData", "deleteData"],
      },
    ],
  },
}
```

## Integration with HttpDispatcher

The REST API plugin integrates with the HttpDispatcher to route requests to the appropriate service:

```
┌─────────────────────────────────────────────────────┐
│                  HTTP Request                        │
└─────────────────────┬───────────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────────┐
│              Global Middleware                       │
│  (CORS, Logging, Authentication)                    │
└─────────────────────┬───────────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────────┐
│              HttpDispatcher                          │
│  • Match URL prefix                                  │
│  • Route to service                                  │
└─────────────────────┬───────────────────────────────┘
                      │
          ┌───────────┼───────────┐
          ▼           ▼           ▼
     ┌────────┐  ┌────────┐  ┌────────┐
     │metadata│  │  data  │  │  auth  │
     │service │  │service │  │service │
     └────┬───┘  └────┬───┘  └────┬───┘
          │           │           │
          ▼           ▼           ▼
┌─────────────────────────────────────────────────────┐
│          Route-Specific Middleware                   │
│  (Validation, Transformation)                       │
└─────────────────────┬───────────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────────┐
│               Handler Execution                      │
└─────────────────────┬───────────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────────┐
│         Response Envelope & Error Handling           │
└─────────────────────┬───────────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────────┐
│                 HTTP Response                        │
└─────────────────────────────────────────────────────┘
```

## Testing

The implementation includes comprehensive tests:

- **33 test cases** covering all schemas and configurations
- Schema validation tests
- Default route registration tests
- Middleware ordering tests
- Schema consistency checks

Run tests:
```bash
pnpm test plugin-rest-api.test.ts
```

## JSON Schema Generation

The plugin generates 9 JSON schemas:

1. `ErrorHandlingConfig.json`
2. `OpenApiGenerationConfig.json`
3. `RequestValidationConfig.json`
4. `ResponseEnvelopeConfig.json`
5. `RestApiEndpoint.json`
6. `RestApiPluginConfig.json`
7. `RestApiRouteCategory.json`
8. `RestApiRouteRegistration.json`
9. `ValidationMode.json`

These schemas can be used for IDE autocomplete, documentation, and validation.

## Architecture Alignment

This implementation aligns with industry best practices:

- **Salesforce REST API**: Metadata and data CRUD patterns
- **Microsoft Dynamics Web API**: Entity operations and OData support
- **Strapi**: Auto-generated REST endpoints from schemas
- **AWS API Gateway**: Route configuration and middleware chains
- **Kubernetes API**: Resource-based routing and discovery

## Future Enhancements

Phase 3 and Phase 4 will add additional plugins:

- **Phase 3**: UI API, Workflow, Analytics, Automation, i18n plugins
- **Phase 4**: Notification, Realtime, AI, Hub, GraphQL plugins

Each plugin will follow the same pattern established here.
