// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import fs from 'fs';
import path from 'path';
import { z } from 'zod';

// Dynamic imports from spec source
import * as API from '../src/api';
import * as Data from '../src/data';
import { assertRefsResolve, assertNoDegradedSchemas } from './lib/openapi-self-consistency';

const OUT_DIR = path.resolve(__dirname, '../json-schema');
const pkg = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../package.json'), 'utf-8'));
const SPEC_VERSION = pkg.version;

/**
 * Generates an OpenAPI 3.1 specification from the ObjectStack REST API protocol schemas.
 * This auto-generates documentation for all CRUD operations and platform endpoints.
 */

interface OpenApiPath {
  [method: string]: {
    summary: string;
    description?: string;
    tags: string[];
    operationId: string;
    parameters?: Array<{
      name: string;
      in: string;
      required: boolean;
      schema: Record<string, unknown>;
      description?: string;
    }>;
    requestBody?: {
      required: boolean;
      content: Record<string, { schema: Record<string, unknown> }>;
    };
    responses: Record<string, {
      description: string;
      content?: Record<string, { schema: Record<string, unknown> }>;
    }>;
  };
}

function generateCrudPaths(basePath: string): Record<string, OpenApiPath> {
  const paths: Record<string, OpenApiPath> = {};

  // List records
  paths[`${basePath}/{object}`] = {
    get: {
      summary: 'List records',
      description: 'Query records with filtering, sorting, and pagination',
      tags: ['CRUD'],
      operationId: 'listRecords',
      parameters: [
        { name: 'object', in: 'path', required: true, schema: { type: 'string' }, description: 'Object name (snake_case)' },
        { name: 'top', in: 'query', required: false, schema: { type: 'integer', default: 25 }, description: 'Page size' },
        { name: 'skip', in: 'query', required: false, schema: { type: 'integer', default: 0 }, description: 'Offset' },
        { name: 'sort', in: 'query', required: false, schema: { type: 'string' }, description: 'Sort field (prefix with - for desc)' },
        { name: 'fields', in: 'query', required: false, schema: { type: 'string' }, description: 'Comma-separated field list' },
      ],
      responses: {
        '200': {
          description: 'List of records',
          content: { 'application/json': { schema: { $ref: '#/components/schemas/ListRecordResponse' } } },
        },
        '400': { description: 'Invalid query', content: { 'application/json': { schema: { $ref: '#/components/schemas/ApiError' } } } },
        '401': { description: 'Unauthorized' },
      },
    },
    post: {
      summary: 'Create a record',
      description: 'Create a new record in the specified object',
      tags: ['CRUD'],
      operationId: 'createRecord',
      parameters: [
        { name: 'object', in: 'path', required: true, schema: { type: 'string' }, description: 'Object name (snake_case)' },
      ],
      requestBody: {
        required: true,
        content: { 'application/json': { schema: { $ref: '#/components/schemas/CreateRequest' } } },
      },
      responses: {
        '201': {
          description: 'Record created',
          content: { 'application/json': { schema: { $ref: '#/components/schemas/SingleRecordResponse' } } },
        },
        '400': { description: 'Validation error', content: { 'application/json': { schema: { $ref: '#/components/schemas/ApiError' } } } },
        '401': { description: 'Unauthorized' },
      },
    },
  };

  // Single record operations
  paths[`${basePath}/{object}/{id}`] = {
    get: {
      summary: 'Get a record',
      description: 'Retrieve a single record by ID',
      tags: ['CRUD'],
      operationId: 'getRecord',
      parameters: [
        { name: 'object', in: 'path', required: true, schema: { type: 'string' }, description: 'Object name' },
        { name: 'id', in: 'path', required: true, schema: { type: 'string' }, description: 'Record ID' },
      ],
      responses: {
        '200': {
          description: 'Record found',
          content: { 'application/json': { schema: { $ref: '#/components/schemas/SingleRecordResponse' } } },
        },
        '404': { description: 'Record not found' },
        '401': { description: 'Unauthorized' },
      },
    },
    put: {
      summary: 'Update a record',
      description: 'Update an existing record by ID',
      tags: ['CRUD'],
      operationId: 'updateRecord',
      parameters: [
        { name: 'object', in: 'path', required: true, schema: { type: 'string' }, description: 'Object name' },
        { name: 'id', in: 'path', required: true, schema: { type: 'string' }, description: 'Record ID' },
      ],
      requestBody: {
        required: true,
        content: { 'application/json': { schema: { $ref: '#/components/schemas/UpdateRequest' } } },
      },
      responses: {
        '200': {
          description: 'Record updated',
          content: { 'application/json': { schema: { $ref: '#/components/schemas/SingleRecordResponse' } } },
        },
        '400': { description: 'Validation error' },
        '404': { description: 'Record not found' },
        '401': { description: 'Unauthorized' },
      },
    },
    delete: {
      summary: 'Delete a record',
      description: 'Delete a record by ID',
      tags: ['CRUD'],
      operationId: 'deleteRecord',
      parameters: [
        { name: 'object', in: 'path', required: true, schema: { type: 'string' }, description: 'Object name' },
        { name: 'id', in: 'path', required: true, schema: { type: 'string' }, description: 'Record ID' },
      ],
      responses: {
        '200': {
          description: 'Record deleted',
          content: { 'application/json': { schema: { $ref: '#/components/schemas/DeleteResponse' } } },
        },
        '404': { description: 'Record not found' },
        '401': { description: 'Unauthorized' },
      },
    },
  };

  return paths;
}

function generateMetadataPaths(basePath: string): Record<string, OpenApiPath> {
  const paths: Record<string, OpenApiPath> = {};

  paths[`${basePath}/meta`] = {
    get: {
      summary: 'Get platform metadata',
      description: 'Returns platform-level metadata including registered types and capabilities',
      tags: ['Metadata'],
      operationId: 'getMetadata',
      responses: {
        '200': { description: 'Platform metadata' },
      },
    },
  };

  paths[`${basePath}/meta/types`] = {
    get: {
      summary: 'List metadata types',
      description: 'Returns all registered metadata type names',
      tags: ['Metadata'],
      operationId: 'listMetadataTypes',
      responses: {
        '200': { description: 'List of metadata type names' },
      },
    },
  };

  paths[`${basePath}/meta/{type}`] = {
    get: {
      summary: 'List metadata by type',
      description: 'Returns all metadata entries for the specified type',
      tags: ['Metadata'],
      operationId: 'listMetadataByType',
      parameters: [
        { name: 'type', in: 'path', required: true, schema: { type: 'string' }, description: 'Metadata type (e.g., object, view, flow)' },
      ],
      responses: {
        '200': { description: 'List of metadata entries' },
        '404': { description: 'Unknown metadata type' },
      },
    },
  };

  paths[`${basePath}/meta/{type}/{name}`] = {
    get: {
      summary: 'Get metadata by type and name',
      description: 'Returns a single metadata entry by type and name',
      tags: ['Metadata'],
      operationId: 'getMetadataByName',
      parameters: [
        { name: 'type', in: 'path', required: true, schema: { type: 'string' }, description: 'Metadata type' },
        { name: 'name', in: 'path', required: true, schema: { type: 'string' }, description: 'Metadata name' },
      ],
      responses: {
        '200': { description: 'Metadata entry' },
        '404': { description: 'Metadata not found' },
      },
    },
  };

  return paths;
}

function generateDiscoveryPaths(basePath: string): Record<string, OpenApiPath> {
  return {
    [`${basePath}/.well-known/objectstack`]: {
      get: {
        summary: 'Platform discovery',
        description: 'Returns ObjectStack platform discovery information including available services and capabilities',
        tags: ['Discovery'],
        operationId: 'discover',
        responses: {
          '200': { description: 'Discovery response with platform info, services, and capabilities' },
        },
      },
    },
  };
}

function generateComponentSchemas(): Record<string, Record<string, unknown>> {
  const schemas: Record<string, Record<string, unknown>> = {};
  const degraded: string[] = [];

  // Map of contract schema names to their Zod schemas
  const contractSchemas: Record<string, z.ZodType> = {
    CreateRequest: (API as any).CreateRequestSchema,
    UpdateRequest: (API as any).UpdateRequestSchema,
    SingleRecordResponse: (API as any).SingleRecordResponseSchema,
    ListRecordResponse: (API as any).ListRecordResponseSchema,
    DeleteResponse: (API as any).DeleteResponseSchema,
    ApiError: (API as any).ApiErrorSchema,
    BulkRequest: (API as any).BulkRequestSchema,
    BulkResponse: (API as any).BulkResponseSchema,
    BaseResponse: (API as any).BaseResponseSchema,
  };

  for (const [name, schema] of Object.entries(contractSchemas)) {
    // `typeof` must admit BOTH 'object' and 'function': every contract schema
    // here is wrapped in `lazySchema()`, whose Proxy target is
    // `function lazyZod() {}`, so `typeof schema === 'function'`. Demanding
    // 'object' short-circuited all nine and published an empty
    // `components.schemas` behind six dangling `$ref`s (#5168). The `_zod`
    // half of the guard is Proxy-safe as written — `lazySchema` maintains a
    // `_zod` facade precisely so `toJSONSchema` can traverse it.
    const isZodLike =
      !!schema && (typeof schema === 'object' || typeof schema === 'function') && '_zod' in schema;
    if (!isZodLike) continue; // reported by assertNoDegradedSchemas below

    try {
      schemas[name] = z.toJSONSchema(schema as z.ZodType, { target: 'draft-2020-12' });
    } catch {
      degraded.push(name);
    }
  }

  // Declared = enforced: the table above is a literal list of the contract's
  // nine schemas, so a name that produced nothing is a defect, never an
  // optional input. Failing here is what makes the #5168 shape unrepeatable.
  assertNoDegradedSchemas(Object.keys(contractSchemas), schemas, degraded);

  return schemas;
}

// ─── Build OpenAPI Spec ──────────────────────────────────────────────

const basePath = '/api';

const openapi: Record<string, unknown> = {
  openapi: '3.1.0',
  info: {
    title: 'ObjectStack REST API',
    version: SPEC_VERSION,
    description: 'Auto-generated OpenAPI specification from @objectstack/spec protocol schemas.',
    contact: {
      name: 'ObjectStack',
      url: 'https://objectstack.io',
    },
    license: {
      name: 'Apache-2.0',
      url: 'https://www.apache.org/licenses/LICENSE-2.0',
    },
  },
  servers: [
    { url: 'http://localhost:3000', description: 'Local development' },
  ],
  tags: [
    { name: 'CRUD', description: 'Data record operations' },
    { name: 'Metadata', description: 'Platform metadata and introspection' },
    { name: 'Discovery', description: 'Service discovery and capabilities' },
  ],
  paths: {
    ...generateCrudPaths(basePath),
    ...generateMetadataPaths(basePath),
    ...generateDiscoveryPaths(basePath),
  },
  components: {
    schemas: generateComponentSchemas(),
    securitySchemes: {
      bearerAuth: {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
      },
      apiKey: {
        type: 'apiKey',
        in: 'header',
        name: 'X-API-Key',
      },
    },
  },
  security: [
    { bearerAuth: [] },
  ],
};

// ─── Self-consistency gate (#5168) ───────────────────────────────────
//
// Runs BEFORE the write, so a document whose `$ref`s do not resolve is never
// emitted at all. `gen:openapi` has no staleness gate (`check:generated`
// reports it as one of the two ungated generators), so this is the only thing
// standing between a silently-broken collector and the published
// `GET /api/v1/openapi.json`. Throwing exits non-zero and fails the build.
assertRefsResolve(openapi);

// Write output
if (!fs.existsSync(OUT_DIR)) {
  fs.mkdirSync(OUT_DIR, { recursive: true });
}

const outPath = path.join(OUT_DIR, 'openapi.json');
fs.writeFileSync(outPath, JSON.stringify(openapi, null, 2));
console.log(`✅ Generated OpenAPI spec: ${outPath}`);
console.log(`   Version: ${SPEC_VERSION}`);
console.log(`   Paths: ${Object.keys(openapi.paths as object).length}`);
console.log(`   Components: ${Object.keys((openapi.components as any).schemas).length}`);
