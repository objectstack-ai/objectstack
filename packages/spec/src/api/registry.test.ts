import { describe, it, expect } from 'vitest';
import {
  ApiProtocolType,
  ApiParameterSchema,
  ApiResponseSchema,
  ApiEndpointRegistrationSchema,
  ApiMetadataSchema,
  ApiRegistryEntrySchema,
  ApiRegistrySchema,
  ApiDiscoveryQuerySchema,
  ApiDiscoveryResponseSchema,
  ApiEndpointRegistration,
  ApiRegistryEntry,
  ApiRegistry,
  ObjectQLReferenceSchema,
  SchemaDefinition,
  ConflictResolutionStrategy,
} from './registry.zod';

describe('API Registry Protocol', () => {
  describe('ApiProtocolType', () => {
    it('should accept valid API protocol types', () => {
      expect(ApiProtocolType.parse('rest')).toBe('rest');
        expect(ApiProtocolType.parse('odata')).toBe('odata');
      expect(ApiProtocolType.parse('websocket')).toBe('websocket');
      expect(ApiProtocolType.parse('file')).toBe('file');
      expect(ApiProtocolType.parse('auth')).toBe('auth');
      expect(ApiProtocolType.parse('metadata')).toBe('metadata');
      expect(ApiProtocolType.parse('plugin')).toBe('plugin');
      expect(ApiProtocolType.parse('webhook')).toBe('webhook');
      expect(ApiProtocolType.parse('rpc')).toBe('rpc');
    });

    it('should reject invalid API protocol types', () => {
      expect(() => ApiProtocolType.parse('invalid')).toThrow();
    });
  });

  describe('ApiParameterSchema', () => {
    it('should validate valid parameter', () => {
      const param = {
        name: 'id',
        in: 'path' as const,
        description: 'Customer ID',
        required: true,
        schema: {
          type: 'string' as const,
          format: 'uuid',
        },
        example: '123e4567-e89b-12d3-a456-426614174000',
      };

      const result = ApiParameterSchema.parse(param);
      expect(result.name).toBe('id');
      expect(result.in).toBe('path');
      expect(result.required).toBe(true);
    });

    it('should apply defaults for optional fields', () => {
      const param = {
        name: 'filter',
        in: 'query' as const,
        schema: { type: 'string' as const },
      };

      const result = ApiParameterSchema.parse(param);
      expect(result.required).toBe(false);
    });

    it('should validate parameter in different locations', () => {
      expect(() => ApiParameterSchema.parse({
        name: 'auth',
        in: 'header',
        schema: { type: 'string' },
      })).not.toThrow();

      expect(() => ApiParameterSchema.parse({
        name: 'page',
        in: 'query',
        schema: { type: 'number' },
      })).not.toThrow();

      expect(() => ApiParameterSchema.parse({
        name: 'id',
        in: 'path',
        schema: { type: 'string' },
      })).not.toThrow();

      expect(() => ApiParameterSchema.parse({
        name: 'data',
        in: 'body',
        schema: { type: 'object' },
      })).not.toThrow();
    });
  });

  describe('ApiResponseSchema', () => {
    it('should validate valid response', () => {
      const response = {
        statusCode: 200,
        description: 'Successful response',
        contentType: 'application/json',
        schema: { type: 'object' },
        example: { id: '123', name: 'Test' },
      };

      const result = ApiResponseSchema.parse(response);
      expect(result.statusCode).toBe(200);
      expect(result.contentType).toBe('application/json');
    });

    it('should apply default content type', () => {
      const response = {
        statusCode: 200,
        description: 'Success',
      };

      const result = ApiResponseSchema.parse(response);
      expect(result.contentType).toBe('application/json');
    });

    it('should accept status code patterns', () => {
      expect(() => ApiResponseSchema.parse({
        statusCode: '2xx',
        description: 'Success range',
      })).not.toThrow();

      expect(() => ApiResponseSchema.parse({
        statusCode: 404,
        description: 'Not found',
      })).not.toThrow();
    });
  });

  describe('ApiEndpointRegistrationSchema', () => {
    it('should validate complete endpoint registration', () => {
      const endpoint = {
        id: 'get_customer',
        method: 'GET',
        path: '/api/v1/customers/:id',
        summary: 'Get customer by ID',
        description: 'Retrieves a single customer record',
        operationId: 'getCustomerById',
        tags: ['customer', 'data'],
        parameters: [
          {
            name: 'id',
            in: 'path' as const,
            required: true,
            schema: { type: 'string' as const },
          },
        ],
        responses: [
          {
            statusCode: 200,
            description: 'Customer found',
            schema: { type: 'object' as const },
          },
          {
            statusCode: 404,
            description: 'Customer not found',
          },
        ],
        deprecated: false,
      };

      const result = ApiEndpointRegistrationSchema.parse(endpoint);
      expect(result.id).toBe('get_customer');
      expect(result.method).toBe('GET');
      expect(result.tags).toHaveLength(2);
      expect(result.parameters).toHaveLength(1);
      expect(result.responses).toHaveLength(2);
    });

    it('should apply defaults for optional fields', () => {
      const endpoint = {
        id: 'simple_endpoint',
        path: '/api/test',
      };

      const result = ApiEndpointRegistrationSchema.parse(endpoint);
      expect(result.tags).toEqual([]);
      expect(result.parameters).toEqual([]);
      expect(result.responses).toEqual([]);
      expect(result.deprecated).toBe(false);
    });

    it('should support request body', () => {
      const endpoint = {
        id: 'create_customer',
        method: 'POST',
        path: '/api/v1/customers',
        requestBody: {
          description: 'Customer data',
          required: true,
          contentType: 'application/json',
          schema: { type: 'object' },
          example: { name: 'John Doe', email: 'john@example.com' },
        },
        responses: [
          {
            statusCode: 201,
            description: 'Customer created',
          },
        ],
      };

      const result = ApiEndpointRegistrationSchema.parse(endpoint);
      expect(result.requestBody).toBeDefined();
      expect(result.requestBody?.required).toBe(true);
    });

    it('should support security requirements', () => {
      const endpoint = {
        id: 'protected_endpoint',
        path: '/api/v1/protected',
        security: [
          {
            'bearerAuth': [],
          },
          {
            'apiKey': [],
          },
        ],
        responses: [],
      };

      const result = ApiEndpointRegistrationSchema.parse(endpoint);
      expect(result.security).toHaveLength(2);
      expect(result.security?.[0]).toHaveProperty('bearerAuth');
    });

    it('should use helper create function', () => {
      const endpoint = ApiEndpointRegistration.create({
        id: 'test_endpoint',
        path: '/test',
        summary: 'Test endpoint',
      });

      expect(endpoint.id).toBe('test_endpoint');
      expect(endpoint.path).toBe('/test');
    });
  });

  describe('ApiMetadataSchema', () => {
    it('should validate API metadata', () => {
      const metadata = {
        owner: 'api_team',
        status: 'active' as const,
        tags: ['customer', 'public'],
        custom: {
          rateLimit: 1000,
          cacheable: true,
        },
      };

      const result = ApiMetadataSchema.parse(metadata);
      expect(result.owner).toBe('api_team');
      expect(result.status).toBe('active');
      expect(result.tags).toHaveLength(2);
    });

    it('should apply defaults', () => {
      const metadata = {};

      const result = ApiMetadataSchema.parse(metadata);
      expect(result.status).toBe('active');
      expect(result.tags).toEqual([]);
    });

    it('should validate status values', () => {
      expect(() => ApiMetadataSchema.parse({ status: 'active' })).not.toThrow();
      expect(() => ApiMetadataSchema.parse({ status: 'deprecated' })).not.toThrow();
      expect(() => ApiMetadataSchema.parse({ status: 'experimental' })).not.toThrow();
      expect(() => ApiMetadataSchema.parse({ status: 'beta' })).not.toThrow();
      expect(() => ApiMetadataSchema.parse({ status: 'invalid' })).toThrow();
    });

    it('should support plugin source', () => {
      const metadata = {
        pluginSource: 'payment_gateway_plugin',
        status: 'active' as const,
      };

      const result = ApiMetadataSchema.parse(metadata);
      expect(result.pluginSource).toBe('payment_gateway_plugin');
    });
  });

  describe('ApiRegistryEntrySchema', () => {
    it('should validate complete registry entry', () => {
      const entry = {
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
            summary: 'List customers',
            responses: [],
          },
          {
            id: 'get_customer',
            method: 'GET',
            path: '/api/v1/customers/:id',
            summary: 'Get customer',
            responses: [],
          },
        ],
        metadata: {
          owner: 'sales_team',
          status: 'active' as const,
          tags: ['customer', 'crm'],
        },
        contact: {
          name: 'API Team',
          email: 'api@example.com',
        },
        license: {
          name: 'Apache 2.0',
          url: 'https://www.apache.org/licenses/LICENSE-2.0',
        },
      };

      const result = ApiRegistryEntrySchema.parse(entry);
      expect(result.id).toBe('customer_api');
      expect(result.type).toBe('rest');
      expect(result.endpoints).toHaveLength(2);
    });

    it('should enforce snake_case for id', () => {
      expect(() => ApiRegistryEntrySchema.parse({
        id: 'customer_api',
        name: 'Customer API',
        type: 'rest',
        version: 'v1',
        basePath: '/api/customers',
        endpoints: [],
      })).not.toThrow();

      expect(() => ApiRegistryEntrySchema.parse({
        id: 'CustomerAPI',
        name: 'Customer API',
        type: 'rest',
        version: 'v1',
        basePath: '/api/customers',
        endpoints: [],
      })).toThrow();
    });

    it('should support plugin-registered APIs', () => {
      const entry = {
        id: 'payment_webhook',
        name: 'Payment Webhook API',
        type: 'plugin',
        version: '1.0.0',
        basePath: '/plugins/payment/webhook',
        endpoints: [
          {
            id: 'receive_payment_notification',
            method: 'POST',
            path: '/plugins/payment/webhook',
            responses: [],
          },
        ],
        metadata: {
          pluginSource: 'payment_gateway_plugin',
          status: 'active' as const,
        },
      };

      const result = ApiRegistryEntrySchema.parse(entry);
      expect(result.type).toBe('plugin');
      expect(result.metadata?.pluginSource).toBe('payment_gateway_plugin');
    });

    it('should use helper create function', () => {
      const entry = ApiRegistryEntry.create({
        id: 'test_api',
        name: 'Test API',
        type: 'rest',
        version: 'v1',
        basePath: '/api/test',
        endpoints: [],
      });

      expect(entry.id).toBe('test_api');
      expect(entry.type).toBe('rest');
    });
  });

  describe('ApiRegistrySchema', () => {
    it('should validate complete registry', () => {
      const registry = {
        version: '1.0.0',
        apis: [
          {
            id: 'customer_api',
            name: 'Customer API',
            type: 'rest',
            version: 'v1',
            basePath: '/api/v1/customers',
            endpoints: [
              {
                id: 'list_customers',
                path: '/api/v1/customers',
                responses: [],
              },
            ],
          },
          {
            id: 'odata_api',
            name: 'OData API',
            type: 'odata',
            version: 'v1',
            basePath: '/odata',
            endpoints: [
              {
                id: 'odata_query',
                path: '/odata',
                responses: [],
              },
            ],
          },
        ],
        totalApis: 2,
        totalEndpoints: 2,
        updatedAt: new Date().toISOString(),
      };

      const result = ApiRegistrySchema.parse(registry);
      expect(result.totalApis).toBe(2);
      expect(result.apis).toHaveLength(2);
    });

    it('should support grouping by type', () => {
      const registry = {
        version: '1.0.0',
        apis: [
          {
            id: 'rest_api_1',
            name: 'REST API 1',
            type: 'rest' as const,
            version: 'v1',
            basePath: '/api/v1',
            endpoints: [],
          },
          {
            id: 'rest_api_2',
            name: 'REST API 2',
            type: 'rest' as const,
            version: 'v1',
            basePath: '/api/v2',
            endpoints: [],
          },
          {
            id: 'odata_api',
            name: 'OData API',
            type: 'odata' as const,
            version: 'v1',
            basePath: '/odata',
            endpoints: [],
          },
        ],
        totalApis: 3,
        totalEndpoints: 0,
      };

      const result = ApiRegistrySchema.parse(registry);
      expect(result.totalApis).toBe(3);
      expect(result.apis).toHaveLength(3);
    });

    it('should use helper create function', () => {
      const registry = ApiRegistry.create({
        version: '1.0.0',
        apis: [],
        totalApis: 0,
        totalEndpoints: 0,
      });

      expect(registry.version).toBe('1.0.0');
      expect(registry.totalApis).toBe(0);
    });
  });

  describe('ApiDiscoveryQuerySchema', () => {
    it('should validate discovery query', () => {
      const query = {
        type: 'rest',
        tags: ['customer', 'public'],
        status: 'active' as const,
        search: 'customer',
      };

      const result = ApiDiscoveryQuerySchema.parse(query);
      expect(result.type).toBe('rest');
      expect(result.tags).toHaveLength(2);
      expect(result.status).toBe('active');
    });

    it('should allow empty query', () => {
      const query = {};
      const result = ApiDiscoveryQuerySchema.parse(query);
      expect(result).toEqual({});
    });

    it('should filter by plugin source', () => {
      const query = {
        pluginSource: 'payment_gateway',
      };

      const result = ApiDiscoveryQuerySchema.parse(query);
      expect(result.pluginSource).toBe('payment_gateway');
    });
  });

  describe('ApiDiscoveryResponseSchema', () => {
    it('should validate discovery response', () => {
      const response = {
        apis: [
          {
            id: 'customer_api',
            name: 'Customer API',
            type: 'rest',
            version: 'v1',
            basePath: '/api/customers',
            endpoints: [],
          },
        ],
        total: 1,
        filters: {
          type: 'rest',
          status: 'active' as const,
        },
      };

      const result = ApiDiscoveryResponseSchema.parse(response);
      expect(result.total).toBe(1);
      expect(result.apis).toHaveLength(1);
    });
  });

  // ==========================================
  // NEW TESTS: Enhancement Features
  // ==========================================

  describe('ObjectQL Reference Schema', () => {
    it('should validate ObjectQL reference', () => {
      const ref = {
        objectId: 'customer',
      };

      const result = ObjectQLReferenceSchema.parse(ref);
      expect(result.objectId).toBe('customer');
    });

    it('should support field inclusion/exclusion', () => {
      const ref = {
        objectId: 'customer',
        includeFields: ['id', 'name', 'email'],
        excludeFields: ['password_hash'],
      };

      const result = ObjectQLReferenceSchema.parse(ref);
      expect(result.includeFields).toHaveLength(3);
      expect(result.excludeFields).toHaveLength(1);
    });

    it('should support related object inclusion', () => {
      const ref = {
        objectId: 'order',
        includeRelated: ['customer', 'items'],
      };

      const result = ObjectQLReferenceSchema.parse(ref);
      expect(result.includeRelated).toHaveLength(2);
    });

    it('should enforce snake_case for objectId', () => {
      expect(() => ObjectQLReferenceSchema.parse({
        objectId: 'customer_account',
      })).not.toThrow();

      expect(() => ObjectQLReferenceSchema.parse({
        objectId: 'CustomerAccount',
      })).toThrow();
    });
  });

  describe('Dynamic Schema Linking', () => {
    it('should support ObjectQL reference in parameter schema', () => {
      const param = {
        name: 'customer',
        in: 'body' as const,
        schema: {
          $ref: {
            objectId: 'customer',
            excludeFields: ['internal_notes'],
          },
        },
      };

      const result = ApiParameterSchema.parse(param);
      expect(result.schema).toHaveProperty('$ref');
      if ('$ref' in result.schema) {
        expect(result.schema.$ref.objectId).toBe('customer');
      }
    });

    it('should support static JSON schema in parameter', () => {
      const param = {
        name: 'id',
        in: 'path' as const,
        schema: {
          type: 'string' as const,
          format: 'uuid',
        },
      };

      const result = ApiParameterSchema.parse(param);
      if ('type' in result.schema) {
        expect(result.schema.type).toBe('string');
      }
    });

    it('should support ObjectQL reference in response schema', () => {
      const response = {
        statusCode: 200,
        description: 'Customer retrieved',
        schema: {
          $ref: {
            objectId: 'customer',
            excludeFields: ['password_hash'],
          },
        },
      };

      const result = ApiResponseSchema.parse(response);
      expect(result.schema).toHaveProperty('$ref');
      if (result.schema && typeof result.schema === 'object' && '$ref' in result.schema) {
        expect(result.schema.$ref.objectId).toBe('customer');
      }
    });

    it('should support static schema in response', () => {
      const response = {
        statusCode: 200,
        description: 'Success',
        schema: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            name: { type: 'string' },
          },
        },
      };

      const result = ApiResponseSchema.parse(response);
      expect(result.schema).toBeDefined();
    });
  });

  describe('RBAC Integration', () => {
    it('should support required permissions', () => {
      const endpoint = {
        id: 'get_customer',
        path: '/api/v1/customers/:id',
        requiredPermissions: ['customer.read'],
        responses: [],
      };

      const result = ApiEndpointRegistrationSchema.parse(endpoint);
      expect(result.requiredPermissions).toHaveLength(1);
      expect(result.requiredPermissions).toContain('customer.read');
    });

    it('should support multiple permissions', () => {
      const endpoint = {
        id: 'complex_operation',
        path: '/api/v1/complex',
        requiredPermissions: ['customer.read', 'account.read', 'order.viewAll'],
        responses: [],
      };

      const result = ApiEndpointRegistrationSchema.parse(endpoint);
      expect(result.requiredPermissions).toHaveLength(3);
    });

    it('should support system permissions', () => {
      const endpoint = {
        id: 'manage_users',
        path: '/api/v1/admin/users',
        requiredPermissions: ['manage_users', 'view_setup'],
        responses: [],
      };

      const result = ApiEndpointRegistrationSchema.parse(endpoint);
      expect(result.requiredPermissions).toContain('manage_users');
    });

    it('should default to empty array when no permissions specified', () => {
      const endpoint = {
        id: 'public_endpoint',
        path: '/api/v1/public',
        responses: [],
      };

      const result = ApiEndpointRegistrationSchema.parse(endpoint);
      expect(result.requiredPermissions).toEqual([]);
    });
  });

  describe('Route Priority', () => {
    it('should support priority field', () => {
      const endpoint = {
        id: 'high_priority',
        path: '/api/v1/data/:object',
        priority: 950,
        responses: [],
      };

      const result = ApiEndpointRegistrationSchema.parse(endpoint);
      expect(result.priority).toBe(950);
    });

    it('should default priority to 100', () => {
      const endpoint = {
        id: 'default_priority',
        path: '/api/v1/test',
        responses: [],
      };

      const result = ApiEndpointRegistrationSchema.parse(endpoint);
      expect(result.priority).toBe(100);
    });

    it('should validate priority range', () => {
      expect(() => ApiEndpointRegistrationSchema.parse({
        id: 'test',
        path: '/test',
        priority: -1,
        responses: [],
      })).toThrow();

      expect(() => ApiEndpointRegistrationSchema.parse({
        id: 'test',
        path: '/test',
        priority: 1001,
        responses: [],
      })).toThrow();

      expect(() => ApiEndpointRegistrationSchema.parse({
        id: 'test',
        path: '/test',
        priority: 0,
        responses: [],
      })).not.toThrow();

      expect(() => ApiEndpointRegistrationSchema.parse({
        id: 'test',
        path: '/test',
        priority: 1000,
        responses: [],
      })).not.toThrow();
    });
  });

  describe('Protocol Configuration', () => {
    it('should support gRPC protocol config', () => {
      const endpoint = {
        id: 'grpc_method',
        path: '/grpc/CustomerService/GetCustomer',
        protocolConfig: {
          subProtocol: 'grpc',
          serviceName: 'CustomerService',
          methodName: 'GetCustomer',
          streaming: false,
        },
        responses: [],
      };

      const result = ApiEndpointRegistrationSchema.parse(endpoint);
      expect(result.protocolConfig).toBeDefined();
      expect(result.protocolConfig?.subProtocol).toBe('grpc');
      expect(result.protocolConfig?.serviceName).toBe('CustomerService');
    });

    it('should support tRPC protocol config', () => {
      const endpoint = {
        id: 'trpc_query',
        path: '/trpc/customer.getById',
        protocolConfig: {
          subProtocol: 'trpc',
          procedureType: 'query',
          router: 'customer',
        },
        responses: [],
      };

      const result = ApiEndpointRegistrationSchema.parse(endpoint);
      expect(result.protocolConfig?.subProtocol).toBe('trpc');
      expect(result.protocolConfig?.procedureType).toBe('query');
    });

    it('should support WebSocket protocol config', () => {
      const endpoint = {
        id: 'ws_event',
        path: '/ws/customer.updated',
        protocolConfig: {
          subProtocol: 'websocket',
          eventName: 'customer.updated',
          direction: 'server-to-client',
        },
        responses: [],
      };

      const result = ApiEndpointRegistrationSchema.parse(endpoint);
      expect(result.protocolConfig?.eventName).toBe('customer.updated');
    });

    it('should allow custom protocol configurations', () => {
      const endpoint = {
        id: 'custom_protocol',
        path: '/custom/endpoint',
        protocolConfig: {
          customField1: 'value1',
          customField2: 123,
          customField3: true,
        },
        responses: [],
      };

      const result = ApiEndpointRegistrationSchema.parse(endpoint);
      expect(result.protocolConfig).toBeDefined();
      expect(Object.keys(result.protocolConfig || {})).toHaveLength(3);
    });
  });

  describe('Conflict Resolution Strategy', () => {
    it('should validate conflict resolution strategies', () => {
      expect(ConflictResolutionStrategy.parse('error')).toBe('error');
      expect(ConflictResolutionStrategy.parse('priority')).toBe('priority');
      expect(ConflictResolutionStrategy.parse('first-wins')).toBe('first-wins');
      expect(ConflictResolutionStrategy.parse('last-wins')).toBe('last-wins');
    });

    it('should reject invalid strategies', () => {
      expect(() => ConflictResolutionStrategy.parse('invalid')).toThrow();
    });

    it('should support conflict resolution in registry', () => {
      const registry = {
        version: '1.0.0',
        conflictResolution: 'priority' as const,
        apis: [],
        totalApis: 0,
        totalEndpoints: 0,
      };

      const result = ApiRegistrySchema.parse(registry);
      expect(result.conflictResolution).toBe('priority');
    });

    it('should default conflict resolution to error', () => {
      const registry = {
        version: '1.0.0',
        apis: [],
        totalApis: 0,
        totalEndpoints: 0,
      };

      const result = ApiRegistrySchema.parse(registry);
      expect(result.conflictResolution).toBe('error');
    });
  });

  describe('Complete Integration Test', () => {
    it('should validate endpoint with all enhancements', () => {
      const endpoint = {
        id: 'get_customer_full',
        method: 'GET',
        path: '/api/v1/customers/:id',
        summary: 'Get customer by ID',
        description: 'Retrieves a customer with all enhancements',
        tags: ['customer', 'crm'],
        
        // RBAC Integration
        requiredPermissions: ['customer.read'],
        
        // Route Priority
        priority: 500,
        
        // Protocol Config
        protocolConfig: {
          cacheEnabled: true,
          cacheTtl: 300,
        },
        
        // Parameters with ObjectQL reference
        parameters: [
          {
            name: 'id',
            in: 'path' as const,
            required: true,
            schema: {
              type: 'string' as const,
              format: 'uuid',
            },
          },
        ],
        
        // Responses with ObjectQL reference
        responses: [
          {
            statusCode: 200,
            description: 'Customer found',
            schema: {
              $ref: {
                objectId: 'customer',
                excludeFields: ['password_hash', 'internal_notes'],
              },
            },
          },
          {
            statusCode: 404,
            description: 'Customer not found',
          },
        ],
      };

      const result = ApiEndpointRegistrationSchema.parse(endpoint);
      expect(result.id).toBe('get_customer_full');
      expect(result.requiredPermissions).toContain('customer.read');
      expect(result.priority).toBe(500);
      expect(result.protocolConfig?.cacheEnabled).toBe(true);
      expect(result.responses).toHaveLength(2);
    });

    it('should validate complete registry with all enhancements', () => {
      const registry = {
        version: '1.0.0',
        conflictResolution: 'priority' as const,
        apis: [
          {
            id: 'customer_api',
            name: 'Customer API',
            type: 'rest' as const,
            version: 'v1',
            basePath: '/api/v1/customers',
            endpoints: [
              {
                id: 'list_customers',
                method: 'GET',
                path: '/api/v1/customers',
                requiredPermissions: ['customer.read'],
                priority: 500,
                responses: [
                  {
                    statusCode: 200,
                    description: 'Success',
                    schema: {
                      $ref: {
                        objectId: 'customer',
                      },
                    },
                  },
                ],
              },
            ],
          },
        ],
        totalApis: 1,
        totalEndpoints: 1,
      };

      const result = ApiRegistrySchema.parse(registry);
      expect(result.conflictResolution).toBe('priority');
      expect(result.apis).toHaveLength(1);
      expect(result.apis[0].endpoints[0].requiredPermissions).toContain('customer.read');
    });
  });
});
