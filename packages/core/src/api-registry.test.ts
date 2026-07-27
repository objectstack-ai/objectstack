import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ApiRegistry } from './api-registry';
import type {
  ApiRegistryEntryInput,
} from '@objectstack/spec/api';
import type { Logger } from '@objectstack/spec/contracts';

// Mock logger
const createMockLogger = (): Logger => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
});

describe('ApiRegistry', () => {
  let registry: ApiRegistry;
  let logger: Logger;

  beforeEach(() => {
    logger = createMockLogger();
    registry = new ApiRegistry(logger, 'error', '1.0.0');
  });

  describe('Constructor', () => {
    it('should create registry with default conflict resolution', () => {
      const reg = new ApiRegistry(logger);
      const snapshot = reg.getRegistry();
      expect(snapshot.conflictResolution).toBe('error');
      expect(snapshot.version).toBe('1.0.0');
    });

    it('should create registry with custom conflict resolution', () => {
      const reg = new ApiRegistry(logger, 'priority', '2.0.0');
      const snapshot = reg.getRegistry();
      expect(snapshot.conflictResolution).toBe('priority');
      expect(snapshot.version).toBe('2.0.0');
    });
  });

  describe('registerApi', () => {
    it('should register a simple REST API', () => {
      const api: ApiRegistryEntryInput = {
        id: 'customer_api',
        name: 'Customer API',
        type: 'rest',
        version: 'v1',
        basePath: '/api/v1/customers',
        endpoints: [
          {
            id: 'get_customer',
            method: 'GET',
            path: '/api/v1/customers/:id',
            summary: 'Get customer by ID',
            responses: [
              {
                statusCode: 200,
                description: 'Success',
              },
            ],
          },
        ],
      };

      registry.registerApi(api);

      const retrieved = registry.getApi('customer_api');
      expect(retrieved).toBeDefined();
      expect(retrieved?.name).toBe('Customer API');
      expect(retrieved?.endpoints.length).toBe(1);
    });

    it('should throw error when registering duplicate API', () => {
      const api: ApiRegistryEntryInput = {
        id: 'test_api',
        name: 'Test API',
        type: 'rest',
        version: 'v1',
        basePath: '/api/test',
        endpoints: [],
      };

      registry.registerApi(api);

      expect(() => registry.registerApi(api)).toThrow(
        "API 'test_api' already registered"
      );
    });

    it('should register API with multiple endpoints', () => {
      const api: ApiRegistryEntryInput = {
        id: 'crud_api',
        name: 'CRUD API',
        type: 'rest',
        version: 'v1',
        basePath: '/api/v1/data',
        endpoints: [
          {
            id: 'create',
            method: 'POST',
            path: '/api/v1/data',
            summary: 'Create record',
            responses: [],
          },
          {
            id: 'read',
            method: 'GET',
            path: '/api/v1/data/:id',
            summary: 'Read record',
            responses: [],
          },
          {
            id: 'update',
            method: 'PUT',
            path: '/api/v1/data/:id',
            summary: 'Update record',
            responses: [],
          },
          {
            id: 'delete',
            method: 'DELETE',
            path: '/api/v1/data/:id',
            summary: 'Delete record',
            responses: [],
          },
        ],
      };

      registry.registerApi(api);

      const stats = registry.getStats();
      expect(stats.totalApis).toBe(1);
      expect(stats.totalEndpoints).toBe(4);
      expect(stats.totalRoutes).toBe(4);
    });

    it('should register API with RBAC permissions', () => {
      const api: ApiRegistryEntryInput = {
        id: 'protected_api',
        name: 'Protected API',
        type: 'rest',
        version: 'v1',
        basePath: '/api/protected',
        endpoints: [
          {
            id: 'admin_only',
            method: 'POST',
            path: '/api/protected/admin',
            summary: 'Admin endpoint',
            requiredPermissions: ['admin.access', 'api_enabled'],
            responses: [],
          },
        ],
      };

      registry.registerApi(api);

      const endpoint = registry.getEndpoint('protected_api', 'admin_only');
      expect(endpoint?.requiredPermissions).toEqual(['admin.access', 'api_enabled']);
    });
  });

  describe('unregisterApi', () => {
    it('should unregister an API', () => {
      const api: ApiRegistryEntryInput = {
        id: 'temp_api',
        name: 'Temporary API',
        type: 'rest',
        version: 'v1',
        basePath: '/api/temp',
        endpoints: [
          {
            id: 'test',
            method: 'GET',
            path: '/api/temp/test',
            responses: [],
          },
        ],
      };

      registry.registerApi(api);
      expect(registry.getApi('temp_api')).toBeDefined();

      registry.unregisterApi('temp_api');
      expect(registry.getApi('temp_api')).toBeUndefined();
    });

    it('should throw error when unregistering non-existent API', () => {
      expect(() => registry.unregisterApi('nonexistent')).toThrow(
        "API 'nonexistent' not found"
      );
    });
  });

  describe('Route Conflict Detection', () => {
    describe('error strategy', () => {
      it('should throw error on route conflict', () => {
        const api1: ApiRegistryEntryInput = {
          id: 'api1',
          name: 'API 1',
          type: 'rest',
          version: 'v1',
          basePath: '/api/v1',
          endpoints: [
            {
              id: 'endpoint1',
              method: 'GET',
              path: '/api/v1/test',
              responses: [],
            },
          ],
        };

        const api2: ApiRegistryEntryInput = {
          id: 'api2',
          name: 'API 2',
          type: 'rest',
          version: 'v1',
          basePath: '/api/v1',
          endpoints: [
            {
              id: 'endpoint2',
              method: 'GET',
              path: '/api/v1/test', // Same route!
              responses: [],
            },
          ],
        };

        registry.registerApi(api1);
        expect(() => registry.registerApi(api2)).toThrow(/Route conflict detected/);
      });

      it('should allow same path with different methods', () => {
        const api: ApiRegistryEntryInput = {
          id: 'multi_method',
          name: 'Multi Method API',
          type: 'rest',
          version: 'v1',
          basePath: '/api/v1',
          endpoints: [
            {
              id: 'get',
              method: 'GET',
              path: '/api/v1/resource',
              responses: [],
            },
            {
              id: 'post',
              method: 'POST',
              path: '/api/v1/resource',
              responses: [],
            },
            {
              id: 'put',
              method: 'PUT',
              path: '/api/v1/resource',
              responses: [],
            },
          ],
        };

        expect(() => registry.registerApi(api)).not.toThrow();
        expect(registry.getStats().totalRoutes).toBe(3);
      });
    });

    describe('priority strategy', () => {
      beforeEach(() => {
        registry = new ApiRegistry(logger, 'priority');
      });

      it('should prefer higher priority endpoint', () => {
        const api1: ApiRegistryEntryInput = {
          id: 'low_priority',
          name: 'Low Priority API',
          type: 'rest',
          version: 'v1',
          basePath: '/api',
          endpoints: [
            {
              id: 'low',
              method: 'GET',
              path: '/api/test',
              priority: 100,
              responses: [],
            },
          ],
        };

        const api2: ApiRegistryEntryInput = {
          id: 'high_priority',
          name: 'High Priority API',
          type: 'rest',
          version: 'v1',
          basePath: '/api',
          endpoints: [
            {
              id: 'high',
              method: 'GET',
              path: '/api/test',
              priority: 500,
              responses: [],
            },
          ],
        };

        registry.registerApi(api1);
        registry.registerApi(api2); // Should replace low priority

        const result = registry.findEndpointByRoute('GET', '/api/test');
        expect(result?.api.id).toBe('high_priority');
        expect(result?.endpoint.id).toBe('high');
      });

      it('should keep higher priority when registering lower priority', () => {
        const api1: ApiRegistryEntryInput = {
          id: 'high_priority',
          name: 'High Priority API',
          type: 'rest',
          version: 'v1',
          basePath: '/api',
          endpoints: [
            {
              id: 'high',
              method: 'GET',
              path: '/api/test',
              priority: 900,
              responses: [],
            },
          ],
        };

        const api2: ApiRegistryEntryInput = {
          id: 'low_priority',
          name: 'Low Priority API',
          type: 'rest',
          version: 'v1',
          basePath: '/api',
          endpoints: [
            {
              id: 'low',
              method: 'GET',
              path: '/api/test',
              priority: 100,
              responses: [],
            },
          ],
        };

        registry.registerApi(api1);
        registry.registerApi(api2); // Should NOT replace

        const result = registry.findEndpointByRoute('GET', '/api/test');
        expect(result?.api.id).toBe('high_priority');
        expect(result?.endpoint.id).toBe('high');
      });
    });

    describe('first-wins strategy', () => {
      beforeEach(() => {
        registry = new ApiRegistry(logger, 'first-wins');
      });

      it('should keep first registered endpoint', () => {
        const api1: ApiRegistryEntryInput = {
          id: 'first',
          name: 'First API',
          type: 'rest',
          version: 'v1',
          basePath: '/api',
          endpoints: [
            {
              id: 'first_endpoint',
              method: 'GET',
              path: '/api/test',
              responses: [],
            },
          ],
        };

        const api2: ApiRegistryEntryInput = {
          id: 'second',
          name: 'Second API',
          type: 'rest',
          version: 'v1',
          basePath: '/api',
          endpoints: [
            {
              id: 'second_endpoint',
              method: 'GET',
              path: '/api/test',
              responses: [],
            },
          ],
        };

        registry.registerApi(api1);
        registry.registerApi(api2);

        const result = registry.findEndpointByRoute('GET', '/api/test');
        expect(result?.api.id).toBe('first');
        expect(result?.endpoint.id).toBe('first_endpoint');
      });
    });

    describe('last-wins strategy', () => {
      beforeEach(() => {
        registry = new ApiRegistry(logger, 'last-wins');
      });

      it('should use last registered endpoint', () => {
        const api1: ApiRegistryEntryInput = {
          id: 'first',
          name: 'First API',
          type: 'rest',
          version: 'v1',
          basePath: '/api',
          endpoints: [
            {
              id: 'first_endpoint',
              method: 'GET',
              path: '/api/test',
              responses: [],
            },
          ],
        };

        const api2: ApiRegistryEntryInput = {
          id: 'second',
          name: 'Second API',
          type: 'rest',
          version: 'v1',
          basePath: '/api',
          endpoints: [
            {
              id: 'second_endpoint',
              method: 'GET',
              path: '/api/test',
              responses: [],
            },
          ],
        };

        registry.registerApi(api1);
        registry.registerApi(api2);

        const result = registry.findEndpointByRoute('GET', '/api/test');
        expect(result?.api.id).toBe('second');
        expect(result?.endpoint.id).toBe('second_endpoint');
      });
    });
  });

  describe('findApis', () => {
    beforeEach(() => {
      // Register multiple APIs for testing
      registry.registerApi({
        id: 'rest_api',
        name: 'REST API',
        type: 'rest',
        version: 'v1',
        basePath: '/api/v1/rest',
        endpoints: [],
        metadata: {
          status: 'active',
          tags: ['data', 'crud'],
        },
      });

      registry.registerApi({
        id: 'odata_api',
        name: 'OData API',
        type: 'odata',
        version: 'v1',
        basePath: '/odata',
        endpoints: [],
        metadata: {
          status: 'active',
          tags: ['query', 'data'],
        },
      });

      registry.registerApi({
        id: 'deprecated_api',
        name: 'Deprecated API',
        type: 'rest',
        version: 'v0',
        basePath: '/api/v0/old',
        endpoints: [],
        metadata: {
          status: 'deprecated',
          tags: ['legacy'],
        },
      });
    });

    it('should find all APIs with empty query', () => {
      const result = registry.findApis({});
      expect(result.total).toBe(3);
      expect(result.apis.length).toBe(3);
    });

    it('should filter by type', () => {
      const result = registry.findApis({ type: 'rest' });
      expect(result.total).toBe(2);
      expect(result.apis.every((api) => api.type === 'rest')).toBe(true);
    });

    it('should filter by status', () => {
      const result = registry.findApis({ status: 'active' });
      expect(result.total).toBe(2);
      expect(result.apis.every((api) => api.metadata?.status === 'active')).toBe(true);
    });

    it('should filter by version', () => {
      const result = registry.findApis({ version: 'v1' });
      expect(result.total).toBe(2);
      expect(result.apis.every((api) => api.version === 'v1')).toBe(true);
    });

    it('should filter by tags (ANY match)', () => {
      const result = registry.findApis({ tags: ['data'] });
      expect(result.total).toBe(2);
    });

    it('should search in name and description', () => {
      const result = registry.findApis({ search: 'odata' });
      expect(result.total).toBe(1);
      expect(result.apis[0].id).toBe('odata_api');
    });

    it('should combine multiple filters', () => {
      const result = registry.findApis({
        type: 'rest',
        status: 'active',
        tags: ['crud'],
      });
      expect(result.total).toBe(1);
      expect(result.apis[0].id).toBe('rest_api');
    });
  });

  describe('getEndpoint', () => {
    it('should get endpoint by API and endpoint ID', () => {
      const api: ApiRegistryEntryInput = {
        id: 'test_api',
        name: 'Test API',
        type: 'rest',
        version: 'v1',
        basePath: '/api/test',
        endpoints: [
          {
            id: 'test_endpoint',
            method: 'GET',
            path: '/api/test/hello',
            summary: 'Test endpoint',
            responses: [],
          },
        ],
      };

      registry.registerApi(api);

      const endpoint = registry.getEndpoint('test_api', 'test_endpoint');
      expect(endpoint).toBeDefined();
      expect(endpoint?.summary).toBe('Test endpoint');
    });

    it('should return undefined for non-existent endpoint', () => {
      const endpoint = registry.getEndpoint('nonexistent', 'also_nonexistent');
      expect(endpoint).toBeUndefined();
    });
  });

  describe('findEndpointByRoute', () => {
    it('should find endpoint by method and path', () => {
      const api: ApiRegistryEntryInput = {
        id: 'route_api',
        name: 'Route API',
        type: 'rest',
        version: 'v1',
        basePath: '/api',
        endpoints: [
          {
            id: 'get_users',
            method: 'GET',
            path: '/api/users',
            responses: [],
          },
        ],
      };

      registry.registerApi(api);

      const result = registry.findEndpointByRoute('GET', '/api/users');
      expect(result).toBeDefined();
      expect(result?.api.id).toBe('route_api');
      expect(result?.endpoint.id).toBe('get_users');
    });

    it('should return undefined for non-existent route', () => {
      const result = registry.findEndpointByRoute('POST', '/nonexistent');
      expect(result).toBeUndefined();
    });
  });

  describe('getRegistry', () => {
    it('should return complete registry snapshot', () => {
      registry.registerApi({
        id: 'api1',
        name: 'API 1',
        type: 'rest',
        version: 'v1',
        basePath: '/api/v1',
        endpoints: [
          { id: 'e1', path: '/api/v1/test', responses: [] },
        ],
      });

      const snapshot = registry.getRegistry();
      expect(snapshot.version).toBe('1.0.0');
      expect(snapshot.conflictResolution).toBe('error');
      expect(snapshot.totalApis).toBe(1);
      expect(snapshot.totalEndpoints).toBe(1);
      expect(snapshot.byType).toBeDefined();
      expect(snapshot.byStatus).toBeDefined();
      expect(snapshot.updatedAt).toBeDefined();
    });

    it('should group APIs by type', () => {
      registry.registerApi({
        id: 'rest1',
        name: 'REST 1',
        type: 'rest',
        version: 'v1',
        basePath: '/api/rest1',
        endpoints: [],
      });

      registry.registerApi({
        id: 'rest2',
        name: 'REST 2',
        type: 'rest',
        version: 'v1',
        basePath: '/api/rest2',
        endpoints: [],
      });

      registry.registerApi({
        id: 'graphql1',
        name: 'GraphQL 1',
        type: 'odata',
        version: 'v1',
        basePath: '/odata',
        endpoints: [],
      });

      const snapshot = registry.getRegistry();
      expect(snapshot.byType?.rest?.length).toBe(2);
      expect(snapshot.byType?.odata?.length).toBe(1);
    });
  });

  describe('clear', () => {
    it('should clear all registered APIs', () => {
      registry.registerApi({
        id: 'test',
        name: 'Test',
        type: 'rest',
        version: 'v1',
        basePath: '/test',
        endpoints: [{ id: 'e1', path: '/test', responses: [] }],
      });

      expect(registry.getStats().totalApis).toBe(1);

      registry.clear();

      expect(registry.getStats().totalApis).toBe(0);
      expect(registry.getStats().totalEndpoints).toBe(0);
      expect(registry.getStats().totalRoutes).toBe(0);
    });
  });

  describe('getStats', () => {
    it('should return accurate statistics', () => {
      registry.registerApi({
        id: 'api1',
        name: 'API 1',
        type: 'rest',
        version: 'v1',
        basePath: '/api1',
        endpoints: [
          { id: 'e1', path: '/api1/e1', responses: [] },
          { id: 'e2', path: '/api1/e2', responses: [] },
        ],
      });

      registry.registerApi({
        id: 'api2',
        name: 'API 2',
        type: 'odata',
        version: 'v1',
        basePath: '/odata',
        endpoints: [
          { id: 'query', path: '/odata', responses: [] },
        ],
      });

      const stats = registry.getStats();
      expect(stats.totalApis).toBe(2);
      expect(stats.totalEndpoints).toBe(3);
      expect(stats.totalRoutes).toBe(3);
      expect(stats.apisByType.rest).toBe(1);
      expect(stats.apisByType.odata).toBe(1);
      expect(stats.endpointsByApi.api1).toBe(2);
      expect(stats.endpointsByApi.api2).toBe(1);
    });
  });

  describe('Multi-protocol Support', () => {
    it('should register OData API', () => {
      const api: ApiRegistryEntryInput = {
        id: 'odata',
        name: 'OData API',
        type: 'odata',
        version: 'v1',
        basePath: '/odata',
        endpoints: [
          {
            id: 'query',
            path: '/odata',
            summary: 'GraphQL Query',
            responses: [],
          },
        ],
      };

      registry.registerApi(api);
      expect(registry.getApi('odata')?.type).toBe('odata');
    });

    it('should register WebSocket API', () => {
      const api: ApiRegistryEntryInput = {
        id: 'websocket',
        name: 'WebSocket API',
        type: 'websocket',
        version: 'v1',
        basePath: '/ws',
        endpoints: [
          {
            id: 'subscribe',
            path: '/ws/events',
            summary: 'Subscribe to events',
            protocolConfig: {
              subProtocol: 'websocket',
              eventName: 'data.updated',
              direction: 'server-to-client',
            },
            responses: [],
          },
        ],
      };

      registry.registerApi(api);
      const endpoint = registry.getEndpoint('websocket', 'subscribe');
      expect(endpoint?.protocolConfig?.subProtocol).toBe('websocket');
    });

    it('should register Plugin API', () => {
      const api: ApiRegistryEntryInput = {
        id: 'custom_plugin',
        name: 'Custom Plugin API',
        type: 'plugin',
        version: '1.0.0',
        basePath: '/plugins/custom',
        endpoints: [
          {
            id: 'custom_action',
            method: 'POST',
            path: '/plugins/custom/action',
            summary: 'Custom plugin action',
            responses: [],
          },
        ],
        metadata: {
          pluginSource: 'custom_plugin_package',
          status: 'active',
        },
      };

      registry.registerApi(api);
      const result = registry.findApis({ pluginSource: 'custom_plugin_package' });
      expect(result.total).toBe(1);
    });
  });

  describe('Performance Optimizations', () => {
    it('should use indices for fast type-based lookups', () => {
      // Register multiple APIs with different types
      registry.registerApi({
        id: 'rest_api_1',
        name: 'REST API 1',
        type: 'rest',
        version: 'v1',
        basePath: '/api/rest1',
        endpoints: [{ id: 'e1', path: '/api/rest1', responses: [] }],
      });

      registry.registerApi({
        id: 'rest_api_2',
        name: 'REST API 2',
        type: 'rest',
        version: 'v1',
        basePath: '/api/rest2',
        endpoints: [{ id: 'e2', path: '/api/rest2', responses: [] }],
      });

      registry.registerApi({
        id: 'odata_api',
        name: 'OData API',
        type: 'odata',
        version: 'v1',
        basePath: '/odata',
        endpoints: [{ id: 'e3', path: '/odata', responses: [] }],
      });

      // Should efficiently find all REST APIs
      const restApis = registry.findApis({ type: 'rest' });
      expect(restApis.total).toBe(2);
      expect(restApis.apis.every(api => api.type === 'rest')).toBe(true);

      // Should efficiently find OData APIs
      const graphqlApis = registry.findApis({ type: 'odata' });
      expect(graphqlApis.total).toBe(1);
      expect(graphqlApis.apis[0].id).toBe('odata_api');
    });

    it('should use indices for fast tag-based lookups', () => {
      registry.registerApi({
        id: 'api_1',
        name: 'API 1',
        type: 'rest',
        version: 'v1',
        basePath: '/api1',
        endpoints: [{ id: 'e1', path: '/api1', responses: [] }],
        metadata: { tags: ['customer', 'crm'] },
      });

      registry.registerApi({
        id: 'api_2',
        name: 'API 2',
        type: 'rest',
        version: 'v1',
        basePath: '/api2',
        endpoints: [{ id: 'e2', path: '/api2', responses: [] }],
        metadata: { tags: ['order', 'sales'] },
      });

      registry.registerApi({
        id: 'api_3',
        name: 'API 3',
        type: 'rest',
        version: 'v1',
        basePath: '/api3',
        endpoints: [{ id: 'e3', path: '/api3', responses: [] }],
        metadata: { tags: ['customer', 'analytics'] },
      });

      // Should efficiently find APIs by tag
      const customerApis = registry.findApis({ tags: ['customer'] });
      expect(customerApis.total).toBe(2);
      expect(customerApis.apis.map(a => a.id).sort()).toEqual(['api_1', 'api_3']);

      // Should support multiple tags (ANY match)
      const multiTagApis = registry.findApis({ tags: ['crm', 'sales'] });
      expect(multiTagApis.total).toBe(2);
    });

    it('should use indices for fast status-based lookups', () => {
      registry.registerApi({
        id: 'active_api',
        name: 'Active API',
        type: 'rest',
        version: 'v1',
        basePath: '/active',
        endpoints: [{ id: 'e1', path: '/active', responses: [] }],
        metadata: { status: 'active' },
      });

      registry.registerApi({
        id: 'beta_api',
        name: 'Beta API',
        type: 'rest',
        version: 'v1',
        basePath: '/beta',
        endpoints: [{ id: 'e2', path: '/beta', responses: [] }],
        metadata: { status: 'beta' },
      });

      registry.registerApi({
        id: 'deprecated_api',
        name: 'Deprecated API',
        type: 'rest',
        version: 'v1',
        basePath: '/deprecated',
        endpoints: [{ id: 'e3', path: '/deprecated', responses: [] }],
        metadata: { status: 'deprecated' },
      });

      // Should efficiently find by status
      const activeApis = registry.findApis({ status: 'active' });
      expect(activeApis.total).toBe(1);
      expect(activeApis.apis[0].id).toBe('active_api');

      const betaApis = registry.findApis({ status: 'beta' });
      expect(betaApis.total).toBe(1);
    });

    it('should combine multiple indexed filters efficiently', () => {
      registry.registerApi({
        id: 'rest_crm_active',
        name: 'REST CRM Active',
        type: 'rest',
        version: 'v1',
        basePath: '/crm',
        endpoints: [{ id: 'e1', path: '/crm', responses: [] }],
        metadata: { status: 'active', tags: ['crm', 'customer'] },
      });

      registry.registerApi({
        id: 'rest_crm_beta',
        name: 'REST CRM Beta',
        type: 'rest',
        version: 'v1',
        basePath: '/crm-beta',
        endpoints: [{ id: 'e2', path: '/crm-beta', responses: [] }],
        metadata: { status: 'beta', tags: ['crm'] },
      });

      registry.registerApi({
        id: 'graphql_crm_active',
        name: 'GraphQL CRM Active',
        type: 'odata',
        version: 'v1',
        basePath: '/odata',
        endpoints: [{ id: 'e3', path: '/odata', responses: [] }],
        metadata: { status: 'active', tags: ['crm'] },
      });

      // Combine type + status + tags filters
      const result = registry.findApis({
        type: 'rest',
        status: 'active',
        tags: ['crm'],
      });

      expect(result.total).toBe(1);
      expect(result.apis[0].id).toBe('rest_crm_active');
    });

    it('should maintain indices when APIs are unregistered', () => {
      registry.registerApi({
        id: 'temp_api',
        name: 'Temporary API',
        type: 'rest',
        version: 'v1',
        basePath: '/temp',
        endpoints: [{ id: 'e1', path: '/temp', responses: [] }],
        metadata: { status: 'beta', tags: ['temp', 'test'] },
      });

      // Verify it's in indices
      expect(registry.findApis({ type: 'rest' }).total).toBe(1);
      expect(registry.findApis({ status: 'beta' }).total).toBe(1);
      expect(registry.findApis({ tags: ['temp'] }).total).toBe(1);

      // Unregister
      registry.unregisterApi('temp_api');

      // Verify removed from indices
      expect(registry.findApis({ type: 'rest' }).total).toBe(0);
      expect(registry.findApis({ status: 'beta' }).total).toBe(0);
      expect(registry.findApis({ tags: ['temp'] }).total).toBe(0);
    });
  });

  describe('Safety Guards', () => {
    it('should allow clear() in non-production environment', () => {
      const originalEnv = process.env.NODE_ENV;
      try {
        process.env.NODE_ENV = 'test';

        registry.registerApi({
          id: 'test_api',
          name: 'Test API',
          type: 'rest',
          version: 'v1',
          basePath: '/test',
          endpoints: [{ id: 'e1', path: '/test', responses: [] }],
        });

        expect(registry.getStats().totalApis).toBe(1);

        // Should work without force flag in non-production
        registry.clear();
        expect(registry.getStats().totalApis).toBe(0);
      } finally {
        process.env.NODE_ENV = originalEnv;
      }
    });

    it('should prevent clear() in production without force flag', () => {
      const originalEnv = process.env.NODE_ENV;
      try {
        process.env.NODE_ENV = 'production';

        registry.registerApi({
          id: 'prod_api',
          name: 'Production API',
          type: 'rest',
          version: 'v1',
          basePath: '/prod',
          endpoints: [{ id: 'e1', path: '/prod', responses: [] }],
        });

        // Should throw error in production without force flag
        expect(() => registry.clear()).toThrow(
          'Cannot clear registry in production environment without force flag'
        );

        // API should still exist
        expect(registry.getStats().totalApis).toBe(1);
      } finally {
        process.env.NODE_ENV = originalEnv;
      }
    });

    it('should allow clear() in production with force flag', () => {
      const originalEnv = process.env.NODE_ENV;
      try {
        process.env.NODE_ENV = 'production';

        registry.registerApi({
          id: 'prod_api',
          name: 'Production API',
          type: 'rest',
          version: 'v1',
          basePath: '/prod',
          endpoints: [{ id: 'e1', path: '/prod', responses: [] }],
        });

        expect(registry.getStats().totalApis).toBe(1);

        // Should work with force flag
        registry.clear({ force: true });
        expect(registry.getStats().totalApis).toBe(0);

        // Verify logger warned about forced clear
        expect(logger.warn).toHaveBeenCalledWith(
          'API registry forcefully cleared in production',
          { force: true }
        );
      } finally {
        process.env.NODE_ENV = originalEnv;
      }
    });

    it('should clear all indices when clear() is called', () => {
      registry.registerApi({
        id: 'api_1',
        name: 'API 1',
        type: 'rest',
        version: 'v1',
        basePath: '/api1',
        endpoints: [{ id: 'e1', path: '/api1', responses: [] }],
        metadata: { status: 'active', tags: ['test'] },
      });

      registry.clear();

      // All lookups should return empty
      expect(registry.findApis({ type: 'rest' }).total).toBe(0);
      expect(registry.findApis({ status: 'active' }).total).toBe(0);
      expect(registry.findApis({ tags: ['test'] }).total).toBe(0);
    });
  });
});
