// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * API Registry Example
 * 
 * Demonstrates how to use the API Registry in the ObjectStack kernel
 * to register and discover API endpoints across plugins.
 */

import { ObjectKernel, createApiRegistryPlugin, ApiRegistry } from '@objectstack/core';
import type { Plugin } from '@objectstack/core';
import type { ApiRegistryEntry } from '@objectstack/spec/api';

// Example 1: Basic API Registration
async function example1_BasicApiRegistration() {
  console.log('\n=== Example 1: Basic API Registration ===\n');

  const kernel = new ObjectKernel();

  // Register API Registry plugin with default settings
  kernel.use(createApiRegistryPlugin());

  // Create a plugin that registers a simple REST API
  const customerPlugin: Plugin = {
    name: 'customer-plugin',
    version: '1.0.0',
    init: async (ctx) => {
      const registry = ctx.getService<ApiRegistry>('api-registry');

      const customerApi: ApiRegistryEntry = {
        id: 'customer_api',
        name: 'Customer Management API',
        type: 'rest',
        version: 'v1',
        basePath: '/api/v1/customers',
        description: 'CRUD operations for customer records',
        endpoints: [
          {
            id: 'list_customers',
            method: 'GET',
            path: '/api/v1/customers',
            summary: 'List all customers',
            parameters: [
              {
                name: 'limit',
                in: 'query',
                schema: { type: 'number' },
                description: 'Maximum number of results',
              },
              {
                name: 'offset',
                in: 'query',
                schema: { type: 'number' },
                description: 'Offset for pagination',
              },
            ],
            responses: [
              {
                statusCode: 200,
                description: 'Customers retrieved successfully',
                schema: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      id: { type: 'string' },
                      name: { type: 'string' },
                      email: { type: 'string' },
                    },
                  },
                },
              },
            ],
          },
          {
            id: 'get_customer',
            method: 'GET',
            path: '/api/v1/customers/:id',
            summary: 'Get customer by ID',
            requiredPermissions: ['customer.read'], // RBAC integration
            parameters: [
              {
                name: 'id',
                in: 'path',
                required: true,
                schema: { type: 'string', format: 'uuid' },
              },
            ],
            responses: [
              {
                statusCode: 200,
                description: 'Customer found',
              },
              {
                statusCode: 404,
                description: 'Customer not found',
              },
            ],
          },
          {
            id: 'create_customer',
            method: 'POST',
            path: '/api/v1/customers',
            summary: 'Create new customer',
            requiredPermissions: ['customer.create'],
            requestBody: {
              required: true,
              contentType: 'application/json',
              schema: {
                type: 'object',
                properties: {
                  name: { type: 'string' },
                  email: { type: 'string', format: 'email' },
                },
              },
            },
            responses: [
              {
                statusCode: 201,
                description: 'Customer created',
              },
            ],
          },
        ],
        metadata: {
          status: 'active',
          tags: ['customer', 'crm', 'data'],
          owner: 'sales_team',
        },
      };

      registry.registerApi(customerApi);
      ctx.logger.info('Customer API registered', {
        endpointCount: customerApi.endpoints.length,
      });
    },
  };

  kernel.use(customerPlugin);
  await kernel.bootstrap();

  // Access the registry
  const registry = kernel.getService<ApiRegistry>('api-registry');
  const snapshot = registry.getRegistry();

  console.log(`Total APIs: ${snapshot.totalApis}`);
  console.log(`Total Endpoints: ${snapshot.totalEndpoints}`);
  console.log('\nRegistered APIs:');
  snapshot.apis.forEach((api) => {
    console.log(`  - ${api.name} (${api.type}) - ${api.endpoints.length} endpoints`);
  });

  await kernel.shutdown();
}

// Example 2: Multi-Plugin API Discovery
async function example2_MultiPluginDiscovery() {
  console.log('\n=== Example 2: Multi-Plugin API Discovery ===\n');

  const kernel = new ObjectKernel();
  kernel.use(createApiRegistryPlugin());

  // Data Plugin - REST APIs
  const dataPlugin: Plugin = {
    name: 'data-plugin',
    init: async (ctx) => {
      const registry = ctx.getService<ApiRegistry>('api-registry');

      registry.registerApi({
        id: 'customer_api',
        name: 'Customer API',
        type: 'rest',
        version: 'v1',
        basePath: '/api/v1/customers',
        endpoints: [
          {
            id: 'get_customers',
            method: 'GET',
            path: '/api/v1/customers',
            responses: [],
          },
        ],
        metadata: {
          status: 'active',
          tags: ['data', 'crm'],
        },
      });

      registry.registerApi({
        id: 'product_api',
        name: 'Product API',
        type: 'rest',
        version: 'v1',
        basePath: '/api/v1/products',
        endpoints: [
          {
            id: 'get_products',
            method: 'GET',
            path: '/api/v1/products',
            responses: [],
          },
        ],
        metadata: {
          status: 'active',
          tags: ['data', 'inventory'],
        },
      });
    },
  };


  // Analytics Plugin - Beta API
  const analyticsPlugin: Plugin = {
    name: 'analytics-plugin',
    init: async (ctx) => {
      const registry = ctx.getService<ApiRegistry>('api-registry');

      registry.registerApi({
        id: 'analytics_api',
        name: 'Analytics API',
        type: 'rest',
        version: 'v1',
        basePath: '/api/v1/analytics',
        endpoints: [
          {
            id: 'get_reports',
            method: 'GET',
            path: '/api/v1/analytics/reports',
            responses: [],
          },
        ],
        metadata: {
          status: 'beta',
          tags: ['analytics', 'reporting'],
        },
      });
    },
  };

  kernel.use(dataPlugin);
  kernel.use(analyticsPlugin);
  await kernel.bootstrap();

  const registry = kernel.getService<ApiRegistry>('api-registry');

  // Discovery 1: Find all REST APIs
  console.log('All REST APIs:');
  const restApis = registry.findApis({ type: 'rest' });
  restApis.apis.forEach((api) => console.log(`  - ${api.name}`));

  // Discovery 2: Find active APIs
  console.log('\nActive APIs:');
  const activeApis = registry.findApis({ status: 'active' });
  console.log(`  Total: ${activeApis.total}`);

  // Discovery 3: Find data-related APIs
  console.log('\nData-related APIs:');
  const dataApis = registry.findApis({ tags: ['data'] });
  dataApis.apis.forEach((api) => console.log(`  - ${api.name}`));

  // Discovery 4: Search by name
  console.log('\nSearch for "analytics":');
  const analyticsApis = registry.findApis({ search: 'analytics' });
  analyticsApis.apis.forEach((api) => console.log(`  - ${api.name} (${api.metadata?.status})`));

  await kernel.shutdown();
}

// Example 3: Route Conflict Resolution
async function example3_ConflictResolution() {
  console.log('\n=== Example 3: Route Conflict Resolution ===\n');

  const kernel = new ObjectKernel();

  // Use priority-based conflict resolution
  kernel.use(
    createApiRegistryPlugin({
      conflictResolution: 'priority',
    })
  );

  // Core Plugin - High priority
  const corePlugin: Plugin = {
    name: 'core-plugin',
    init: async (ctx) => {
      const registry = ctx.getService<ApiRegistry>('api-registry');

      registry.registerApi({
        id: 'core_data_api',
        name: 'Core Data API',
        type: 'rest',
        version: 'v1',
        basePath: '/api',
        endpoints: [
          {
            id: 'core_data',
            method: 'GET',
            path: '/api/data/:object',
            priority: 900, // High priority
            summary: 'Core data endpoint (generic)',
            responses: [],
          },
        ],
      });

      ctx.logger.info('Core API registered with priority 900');
    },
  };

  // Custom Plugin - Medium priority
  const customPlugin: Plugin = {
    name: 'custom-plugin',
    init: async (ctx) => {
      const registry = ctx.getService<ApiRegistry>('api-registry');

      registry.registerApi({
        id: 'custom_data_api',
        name: 'Custom Data API',
        type: 'rest',
        version: 'v1',
        basePath: '/api',
        endpoints: [
          {
            id: 'custom_data',
            method: 'GET',
            path: '/api/data/:object',
            priority: 300, // Lower priority
            summary: 'Custom data endpoint (specialized)',
            responses: [],
          },
        ],
      });

      ctx.logger.info('Custom API registered with priority 300');
    },
  };

  kernel.use(corePlugin);
  kernel.use(customPlugin);
  await kernel.bootstrap();

  const registry = kernel.getService<ApiRegistry>('api-registry');

  // Check which endpoint won
  const winner = registry.findEndpointByRoute('GET', '/api/data/:object');
  console.log('\nConflict Resolution Result:');
  console.log(`  Route: GET /api/data/:object`);
  console.log(`  Winner: ${winner?.api.name}`);
  console.log(`  Endpoint: ${winner?.endpoint.summary}`);
  console.log(`  Priority: ${winner?.endpoint.priority}`);

  await kernel.shutdown();
}

// Example 4: Plugin-specific APIs with Custom Protocol
async function example4_CustomProtocol() {
  console.log('\n=== Example 4: Custom Protocol Support ===\n');

  const kernel = new ObjectKernel();
  kernel.use(createApiRegistryPlugin());

  const websocketPlugin: Plugin = {
    name: 'websocket-plugin',
    init: async (ctx) => {
      const registry = ctx.getService<ApiRegistry>('api-registry');

      registry.registerApi({
        id: 'realtime_api',
        name: 'Real-time WebSocket API',
        type: 'websocket',
        version: 'v1',
        basePath: '/ws',
        endpoints: [
          {
            id: 'customer_updates',
            path: '/ws/customers',
            summary: 'Customer update notifications',
            protocolConfig: {
              subProtocol: 'websocket',
              eventName: 'customer.updated',
              direction: 'server-to-client',
            },
            responses: [],
          },
          {
            id: 'order_updates',
            path: '/ws/orders',
            summary: 'Order update notifications',
            protocolConfig: {
              subProtocol: 'websocket',
              eventName: 'order.updated',
              direction: 'bidirectional',
            },
            responses: [],
          },
        ],
        metadata: {
          status: 'active',
          tags: ['realtime', 'websocket'],
          pluginSource: 'websocket-plugin',
        },
      });
    },
  };

  kernel.use(websocketPlugin);
  await kernel.bootstrap();

  const registry = kernel.getService<ApiRegistry>('api-registry');
  const wsApis = registry.findApis({ type: 'websocket' });

  console.log('WebSocket APIs:');
  wsApis.apis.forEach((api) => {
    console.log(`\n${api.name}:`);
    api.endpoints.forEach((endpoint) => {
      console.log(`  - ${endpoint.summary}`);
      console.log(`    Event: ${endpoint.protocolConfig?.eventName}`);
      console.log(`    Direction: ${endpoint.protocolConfig?.direction}`);
    });
  });

  await kernel.shutdown();
}

// Example 5: Dynamic Schema Linking with ObjectQL
async function example5_DynamicSchemas() {
  console.log('\n=== Example 5: Dynamic Schema Linking ===\n');

  const kernel = new ObjectKernel();
  kernel.use(createApiRegistryPlugin());

  const dynamicPlugin: Plugin = {
    name: 'dynamic-plugin',
    init: async (ctx) => {
      const registry = ctx.getService<ApiRegistry>('api-registry');

      registry.registerApi({
        id: 'dynamic_customer_api',
        name: 'Dynamic Customer API',
        type: 'rest',
        version: 'v1',
        basePath: '/api/v1/customers',
        endpoints: [
          {
            id: 'get_customer_dynamic',
            method: 'GET',
            path: '/api/v1/customers/:id',
            summary: 'Get customer (with dynamic schema)',
            responses: [
              {
                statusCode: 200,
                description: 'Customer retrieved',
                // Dynamic schema linked to ObjectQL
                // 
                // IMPORTANT: The API Registry stores this ObjectQL reference as-is.
                // The actual schema resolution (expanding the reference into a full JSON Schema)
                // is performed by downstream tools:
                // - API Gateway: For runtime request/response validation
                // - OpenAPI/Swagger Generator: For API documentation generation
                // - GraphQL Schema Builder: For GraphQL type generation
                // 
                // The Registry's responsibility is to STORE the reference metadata,
                // not to resolve or transform it.
                schema: {
                  $ref: {
                    objectId: 'customer', // References ObjectQL object
                    excludeFields: ['password_hash', 'internal_notes'], // Exclude sensitive fields
                    includeRelated: ['account', 'primary_contact'], // Include related objects
                  },
                },
              },
            ],
          },
        ],
      });

      ctx.logger.info('Dynamic Customer API registered with ObjectQL schema references');
    },
  };

  kernel.use(dynamicPlugin);
  await kernel.bootstrap();

  const registry = kernel.getService<ApiRegistry>('api-registry');
  const endpoint = registry.getEndpoint('dynamic_customer_api', 'get_customer_dynamic');

  console.log('Dynamic Endpoint:');
  console.log(`  Path: ${endpoint?.path}`);
  console.log(`  Summary: ${endpoint?.summary}`);
  
  if (endpoint?.responses?.[0]?.schema && '$ref' in endpoint.responses[0].schema) {
    const ref = endpoint.responses[0].schema.$ref;
    console.log('\n  Schema Reference (stored as metadata):');
    console.log(`    Object: ${ref.objectId}`);
    console.log(`    Excluded Fields: ${ref.excludeFields?.join(', ')}`);
    console.log(`    Included Related: ${ref.includeRelated?.join(', ')}`);
    console.log('\n  ℹ️  Note: Schema resolution is handled by gateway/documentation tools,');
    console.log('     not by the API Registry itself.');
  }

  await kernel.shutdown();
}

// Run all examples
async function main() {
  try {
    await example1_BasicApiRegistration();
    await example2_MultiPluginDiscovery();
    await example3_ConflictResolution();
    await example4_CustomProtocol();
    await example5_DynamicSchemas();
    
    console.log('\n=== All examples completed successfully! ===\n');
  } catch (error) {
    console.error('Example failed:', error);
    process.exit(1);
  }
}

// Only run if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}

export {
  example1_BasicApiRegistration,
  example2_MultiPluginDiscovery,
  example3_ConflictResolution,
  example4_CustomProtocol,
  example5_DynamicSchemas,
};
