import { describe, it, expect, beforeEach } from 'vitest';
import { ObjectKernel } from './kernel';
import { createApiRegistryPlugin } from './api-registry-plugin';
import { ApiRegistry } from './api-registry';
import type { Plugin } from './types';
import type { ApiRegistryEntryInput } from '@objectstack/spec/api';

describe('API Registry Plugin', () => {
  let kernel: ObjectKernel;

  beforeEach(() => {
    kernel = new ObjectKernel({
        skipSystemValidation: true
    });
  });

  describe('Plugin Registration', () => {
    it('should register API Registry as a service', async () => {
      await kernel.use(createApiRegistryPlugin());
      await kernel.bootstrap();

      const registry = kernel.getService<ApiRegistry>('api-registry');
      expect(registry).toBeDefined();
      expect(registry).toBeInstanceOf(ApiRegistry);

      await kernel.shutdown();
    });

    it('should register with custom conflict resolution', async () => {
      await kernel.use(createApiRegistryPlugin({
        conflictResolution: 'priority',
        version: '2.0.0',
      }));
      await kernel.bootstrap();

      const registry = kernel.getService<ApiRegistry>('api-registry');
      const snapshot = registry.getRegistry();
      expect(snapshot.conflictResolution).toBe('priority');
      expect(snapshot.version).toBe('2.0.0');

      await kernel.shutdown();
    });
  });

  describe('Integration with Plugins', () => {
    it('should allow plugins to register APIs', async () => {
      await kernel.use(createApiRegistryPlugin());

      const testPlugin: Plugin = {
        name: 'test-plugin',
        init: async (ctx) => {
          const registry = ctx.getService<ApiRegistry>('api-registry');

          const api: ApiRegistryEntryInput = {
            id: 'test_api',
            name: 'Test API',
            type: 'rest',
            version: 'v1',
            basePath: '/api/test',
            endpoints: [
              {
                id: 'get_test',
                method: 'GET',
                path: '/api/test/hello',
                summary: 'Test endpoint',
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
        },
      };

      await kernel.use(testPlugin);
      await kernel.bootstrap();

      const registry = kernel.getService<ApiRegistry>('api-registry');
      const api = registry.getApi('test_api');
      expect(api).toBeDefined();
      expect(api?.name).toBe('Test API');
      expect(api?.endpoints.length).toBe(1);

      await kernel.shutdown();
    });

    it('should allow multiple plugins to register APIs', async () => {
      await kernel.use(createApiRegistryPlugin());

      const plugin1: Plugin = {
        name: 'plugin-1',
        init: async (ctx) => {
          const registry = ctx.getService<ApiRegistry>('api-registry');
          registry.registerApi({
            id: 'api1',
            name: 'API 1',
            type: 'rest',
            version: 'v1',
            basePath: '/api/plugin1',
            endpoints: [
              {
                id: 'endpoint1',
                method: 'GET',
                path: '/api/plugin1/data',
                responses: [],
              },
            ],
          });
        },
      };

      const plugin2: Plugin = {
        name: 'plugin-2',
        init: async (ctx) => {
          const registry = ctx.getService<ApiRegistry>('api-registry');
          registry.registerApi({
            id: 'api2',
            name: 'API 2',
            type: 'odata',
            version: 'v1',
            basePath: '/odata',
            endpoints: [
              {
                id: 'query',
                path: '/odata',
                responses: [],
              },
            ],
          });
        },
      };

      await kernel.use(plugin1);
      await kernel.use(plugin2);
      await kernel.bootstrap();

      const registry = kernel.getService<ApiRegistry>('api-registry');
      const stats = registry.getStats();
      expect(stats.totalApis).toBe(2);
      expect(stats.apisByType.rest).toBe(1);
      expect(stats.apisByType.odata).toBe(1);

      await kernel.shutdown();
    });

    it('should support API discovery across plugins', async () => {
      await kernel.use(createApiRegistryPlugin());

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
            endpoints: [],
            metadata: {
              status: 'active',
              tags: ['crm', 'data'],
            },
          });

          registry.registerApi({
            id: 'product_api',
            name: 'Product API',
            type: 'rest',
            version: 'v1',
            basePath: '/api/v1/products',
            endpoints: [],
            metadata: {
              status: 'active',
              tags: ['inventory', 'data'],
            },
          });
        },
      };

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
            endpoints: [],
            metadata: {
              status: 'beta',
              tags: ['analytics', 'reporting'],
            },
          });
        },
      };

      await kernel.use(dataPlugin);
      await kernel.use(analyticsPlugin);
      await kernel.bootstrap();

      const registry = kernel.getService<ApiRegistry>('api-registry');

      // Find all data APIs
      const dataApis = registry.findApis({ tags: ['data'] });
      expect(dataApis.total).toBe(2);

      // Find active APIs
      const activeApis = registry.findApis({ status: 'active' });
      expect(activeApis.total).toBe(2);

      // Find CRM APIs
      const crmApis = registry.findApis({ tags: ['crm'] });
      expect(crmApis.total).toBe(1);
      expect(crmApis.apis[0].id).toBe('customer_api');

      await kernel.shutdown();
    });

    it('should handle route conflicts based on strategy', async () => {
      await kernel.use(createApiRegistryPlugin({
        conflictResolution: 'priority',
      }));

      const corePlugin: Plugin = {
        name: 'core-plugin',
        init: async (ctx) => {
          const registry = ctx.getService<ApiRegistry>('api-registry');
          registry.registerApi({
            id: 'core_api',
            name: 'Core API',
            type: 'rest',
            version: 'v1',
            basePath: '/api',
            endpoints: [
              {
                id: 'core_endpoint',
                method: 'GET',
                path: '/api/data/:object',
                priority: 900, // High priority
                summary: 'Core data endpoint',
                responses: [],
              },
            ],
          });
        },
      };

      const pluginOverride: Plugin = {
        name: 'plugin-override',
        init: async (ctx) => {
          const registry = ctx.getService<ApiRegistry>('api-registry');
          registry.registerApi({
            id: 'plugin_api',
            name: 'Plugin API',
            type: 'rest',
            version: 'v1',
            basePath: '/api',
            endpoints: [
              {
                id: 'plugin_endpoint',
                method: 'GET',
                path: '/api/data/:object',
                priority: 300, // Lower priority
                summary: 'Plugin data endpoint',
                responses: [],
              },
            ],
          });
        },
      };

      await kernel.use(corePlugin);
      await kernel.use(pluginOverride);
      await kernel.bootstrap();

      const registry = kernel.getService<ApiRegistry>('api-registry');
      const result = registry.findEndpointByRoute('GET', '/api/data/:object');

      // Core API should win due to higher priority
      expect(result?.api.id).toBe('core_api');
      expect(result?.endpoint.id).toBe('core_endpoint');

      await kernel.shutdown();
    });

    it('should support cleanup on plugin unload', async () => {
      await kernel.use(createApiRegistryPlugin());

      const dynamicPlugin: Plugin = {
        name: 'dynamic-plugin',
        init: async (ctx) => {
          const registry = ctx.getService<ApiRegistry>('api-registry');
          registry.registerApi({
            id: 'dynamic_api',
            name: 'Dynamic API',
            type: 'rest',
            version: 'v1',
            basePath: '/api/dynamic',
            endpoints: [
              {
                id: 'test',
                method: 'GET',
                path: '/api/dynamic/test',
                responses: [],
              },
            ],
          });
        },
        destroy: async () => {
          // In a real scenario, this would use ctx to access registry
          // For now, we'll test the registry's unregister capability
        },
      };

      await kernel.use(dynamicPlugin);
      await kernel.bootstrap();

      const registry = kernel.getService<ApiRegistry>('api-registry');
      expect(registry.getApi('dynamic_api')).toBeDefined();

      // Unregister the API
      registry.unregisterApi('dynamic_api');
      expect(registry.getApi('dynamic_api')).toBeUndefined();

      await kernel.shutdown();
    });
  });

  describe('API Registry Lifecycle', () => {
    it('should be available during plugin start phase', async () => {
      await kernel.use(createApiRegistryPlugin());

      let registryAvailable = false;

      const testPlugin: Plugin = {
        name: 'test-plugin',
        init: async () => {
          // Init phase
        },
        start: async (ctx) => {
          // Start phase - registry should be available
          const registry = ctx.getService<ApiRegistry>('api-registry');
          registryAvailable = registry !== undefined;
        },
      };

      await kernel.use(testPlugin);
      await kernel.bootstrap();

      expect(registryAvailable).toBe(true);

      await kernel.shutdown();
    });

    it('should provide consistent registry across all plugins', async () => {
      await kernel.use(createApiRegistryPlugin());

      let registry1: ApiRegistry | undefined;
      let registry2: ApiRegistry | undefined;

      const plugin1: Plugin = {
        name: 'plugin-1',
        init: async (ctx) => {
          registry1 = ctx.getService<ApiRegistry>('api-registry');
        },
      };

      const plugin2: Plugin = {
        name: 'plugin-2',
        init: async (ctx) => {
          registry2 = ctx.getService<ApiRegistry>('api-registry');
        },
      };

      await kernel.use(plugin1);
      await kernel.use(plugin2);
      await kernel.bootstrap();

      // Same registry instance should be shared
      expect(registry1).toBe(registry2);

      await kernel.shutdown();
    });
  });
});
