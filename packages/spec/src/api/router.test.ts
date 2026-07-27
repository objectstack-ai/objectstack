import { describe, it, expect } from 'vitest';
import {
  RouteCategory,
  RouteDefinitionSchema,
  RouterConfigSchema,
  HttpMethod,
  type RouteDefinition,
  type RouterConfig,
} from './router.zod';

describe('RouteCategory', () => {
  it('should accept valid route categories', () => {
    const categories = ['system', 'api', 'auth', 'static', 'webhook', 'plugin'];
    
    categories.forEach(category => {
      expect(() => RouteCategory.parse(category)).not.toThrow();
    });
  });

  it('should reject invalid category', () => {
    expect(() => RouteCategory.parse('invalid')).toThrow();
  });
});

describe('RouteDefinitionSchema', () => {
  describe('Basic Route Properties', () => {
    it('should accept minimal valid route', () => {
      const route = RouteDefinitionSchema.parse({
        method: 'GET',
        path: '/api/test',
        handler: 'test_handler',
      });

      expect(route.method).toBe('GET');
      expect(route.path).toBe('/api/test');
      expect(route.handler).toBe('test_handler');
    });

    it('should apply default category', () => {
      const route = RouteDefinitionSchema.parse({
        method: 'GET',
        path: '/api/test',
        handler: 'test_handler',
      });

      expect(route.category).toBe('api');
    });

    it('should apply default public flag', () => {
      const route = RouteDefinitionSchema.parse({
        method: 'GET',
        path: '/api/test',
        handler: 'test_handler',
      });

      expect(route.public).toBe(false);
    });

    it('should accept custom category', () => {
      const route = RouteDefinitionSchema.parse({
        method: 'GET',
        path: '/health',
        handler: 'health_check',
        category: 'system',
      });

      expect(route.category).toBe('system');
    });
  });

  describe('HTTP Methods', () => {
    it('should accept all HTTP methods', () => {
      const methods: Array<z.infer<typeof HttpMethod>> = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS'];
      
      methods.forEach(method => {
        const route = RouteDefinitionSchema.parse({
          method,
          path: '/api/test',
          handler: 'test_handler',
        });
        expect(route.method).toBe(method);
      });
    });
  });

  describe('Path Patterns', () => {
    it('should accept path with parameters', () => {
      const route = RouteDefinitionSchema.parse({
        method: 'GET',
        path: '/api/users/:id',
        handler: 'get_user',
      });

      expect(route.path).toBe('/api/users/:id');
    });

    it('should accept path with multiple parameters', () => {
      const route = RouteDefinitionSchema.parse({
        method: 'GET',
        path: '/api/environments/:environmentId/tasks/:taskId',
        handler: 'get_task',
      });

      expect(route.path).toBe('/api/environments/:environmentId/tasks/:taskId');
    });

    it('should accept root path', () => {
      const route = RouteDefinitionSchema.parse({
        method: 'GET',
        path: '/',
        handler: 'root_handler',
      });

      expect(route.path).toBe('/');
    });

    it('should accept wildcard path', () => {
      const route = RouteDefinitionSchema.parse({
        method: 'GET',
        path: '/api/*',
        handler: 'catch_all',
      });

      expect(route.path).toBe('/api/*');
    });
  });

  describe('Documentation', () => {
    it('should accept route with summary', () => {
      const route = RouteDefinitionSchema.parse({
        method: 'GET',
        path: '/api/users',
        handler: 'list_users',
        summary: 'List all users',
      });

      expect(route.summary).toBe('List all users');
    });

    it('should accept route with description', () => {
      const route = RouteDefinitionSchema.parse({
        method: 'POST',
        path: '/api/users',
        handler: 'create_user',
        summary: 'Create user',
        description: 'Creates a new user with the provided data',
      });

      expect(route.description).toBe('Creates a new user with the provided data');
    });
  });

  describe('Security', () => {
    it('should accept public route', () => {
      const route = RouteDefinitionSchema.parse({
        method: 'GET',
        path: '/api/public',
        handler: 'public_handler',
        public: true,
      });

      expect(route.public).toBe(true);
    });

    it('should accept route with permissions', () => {
      const route = RouteDefinitionSchema.parse({
        method: 'DELETE',
        path: '/api/users/:id',
        handler: 'delete_user',
        permissions: ['users.delete', 'admin'],
      });

      expect(route.permissions).toHaveLength(2);
      expect(route.permissions).toContain('users.delete');
    });

    it('should accept private route with permissions', () => {
      const route = RouteDefinitionSchema.parse({
        method: 'POST',
        path: '/api/admin/settings',
        handler: 'update_settings',
        public: false,
        permissions: ['admin'],
      });

      expect(route.public).toBe(false);
      expect(route.permissions).toContain('admin');
    });
  });

  describe('Performance', () => {
    it('should accept route with timeout', () => {
      const route = RouteDefinitionSchema.parse({
        method: 'POST',
        path: '/api/batch',
        handler: 'batch_process',
        timeout: 30000,
      });

      expect(route.timeout).toBe(30000);
    });

    it('should accept route with rate limit', () => {
      const route = RouteDefinitionSchema.parse({
        method: 'POST',
        path: '/api/upload',
        handler: 'upload_file',
        rateLimit: 'strict',
      });

      expect(route.rateLimit).toBe('strict');
    });

    it('should accept route with timeout and rate limit', () => {
      const route = RouteDefinitionSchema.parse({
        method: 'POST',
        path: '/api/heavy-operation',
        handler: 'heavy_handler',
        timeout: 60000,
        rateLimit: 'moderate',
      });

      expect(route.timeout).toBe(60000);
      expect(route.rateLimit).toBe('moderate');
    });
  });

  describe('Complete Route Examples', () => {
    it('should accept system health check route', () => {
      const route: RouteDefinition = {
        method: 'GET',
        path: '/health',
        category: 'system',
        handler: 'health_check',
        summary: 'Health Check',
        public: true,
      };

      expect(() => RouteDefinitionSchema.parse(route)).not.toThrow();
    });

    it('should accept authenticated API route', () => {
      const route: RouteDefinition = {
        method: 'POST',
        path: '/api/v1/orders',
        category: 'api',
        handler: 'create_order',
        summary: 'Create Order',
        description: 'Creates a new order in the system',
        public: false,
        permissions: ['orders.create'],
        timeout: 5000,
      };

      expect(() => RouteDefinitionSchema.parse(route)).not.toThrow();
    });

    it('should accept webhook route', () => {
      const route: RouteDefinition = {
        method: 'POST',
        path: '/webhooks/stripe',
        category: 'webhook',
        handler: 'stripe_webhook',
        summary: 'Stripe Webhook',
        public: true,
      };

      expect(() => RouteDefinitionSchema.parse(route)).not.toThrow();
    });

    it('should accept static file route', () => {
      const route: RouteDefinition = {
        method: 'GET',
        path: '/static/*',
        category: 'static',
        handler: 'serve_static',
        public: true,
      };

      expect(() => RouteDefinitionSchema.parse(route)).not.toThrow();
    });

    it('should accept plugin route', () => {
      const route: RouteDefinition = {
        method: 'GET',
        path: '/plugins/custom-report',
        category: 'plugin',
        handler: 'custom_report_handler',
        summary: 'Custom Report',
        permissions: ['reports.view'],
      };

      expect(() => RouteDefinitionSchema.parse(route)).not.toThrow();
    });
  });
});

describe('RouterConfigSchema', () => {
  describe('Basic Configuration', () => {
    it('should accept minimal config with defaults', () => {
      const config = RouterConfigSchema.parse({});

      expect(config.basePath).toBe('/api');
      expect(config.mounts).toBeDefined();
    });

    it('should apply default basePath', () => {
      const config = RouterConfigSchema.parse({});

      expect(config.basePath).toBe('/api');
    });

    it('should accept custom basePath', () => {
      const config = RouterConfigSchema.parse({
        basePath: '/v1',
      });

      expect(config.basePath).toBe('/v1');
    });
  });

  describe('Protocol Mounts', () => {
    it('should apply default mounts', () => {
      const config = RouterConfigSchema.parse({});

      expect(config.mounts.data).toBe('/data');
      expect(config.mounts.metadata).toBe('/meta');
      expect(config.mounts.auth).toBe('/auth');
      expect(config.mounts.automation).toBe('/automation');
      expect(config.mounts.storage).toBe('/storage');
    });

    it('should accept custom mounts', () => {
      const config = RouterConfigSchema.parse({
        mounts: {
          data: '/api/data',
          metadata: '/api/metadata',
          auth: '/api/auth',
          automation: '/api/automation',
          storage: '/api/storage',
        },
      });

      expect(config.mounts.data).toBe('/api/data');
      expect(config.mounts.metadata).toBe('/api/metadata');
    });

    it('should merge custom mounts with defaults', () => {
      const config = RouterConfigSchema.parse({
        mounts: {
          data: '/custom-data',
        },
      });

      expect(config.mounts.data).toBe('/custom-data');
      expect(config.mounts.metadata).toBe('/meta'); // default
    });
  });

  describe('CORS Configuration', () => {
    it('should accept config without CORS', () => {
      const config = RouterConfigSchema.parse({});

      expect(config.cors).toBeUndefined();
    });

    it('should accept CORS configuration', () => {
      const config = RouterConfigSchema.parse({
        cors: {
          enabled: true,
          origins: ['https://example.com'],
          methods: ['GET', 'POST'],
        },
      });

      expect(config.cors?.enabled).toBe(true);
    });
  });

  describe('Static Mounts', () => {
    it('should accept config without static mounts', () => {
      const config = RouterConfigSchema.parse({});

      expect(config.staticMounts).toBeUndefined();
    });

    it('should accept static mount configuration', () => {
      const config = RouterConfigSchema.parse({
        staticMounts: [
          {
            path: '/assets',
            directory: '/var/www/assets',
          },
        ],
      });

      expect(config.staticMounts).toHaveLength(1);
      expect(config.staticMounts![0].path).toBe('/assets');
    });

    it('should accept multiple static mounts', () => {
      const config = RouterConfigSchema.parse({
        staticMounts: [
          { path: '/assets', directory: '/var/www/assets' },
          { path: '/uploads', directory: '/var/www/uploads' },
          { path: '/public', directory: '/var/www/public' },
        ],
      });

      expect(config.staticMounts).toHaveLength(3);
    });
  });

  describe('Complete Configuration Examples', () => {
    it('should accept minimal production config', () => {
      const config: RouterConfig = {
        basePath: '/api',
      };

      const result = RouterConfigSchema.parse(config);
      expect(result.basePath).toBe('/api');
    });

    it('should accept full production config', () => {
      const config: RouterConfig = {
        basePath: '/api/v1',
        mounts: {
          data: '/data',
          metadata: '/metadata',
          auth: '/auth',
          automation: '/flows',
          storage: '/files',
        },
        cors: {
          enabled: true,
          origins: ['https://app.example.com', 'https://admin.example.com'],
          methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
          credentials: true,
          maxAge: 86400,
        },
        staticMounts: [
          {
            path: '/assets',
            directory: '/var/www/assets',
            maxAge: 31536000,
          },
        ],
      };

      const result = RouterConfigSchema.parse(config);
      expect(result.basePath).toBe('/api/v1');
      expect(result.cors?.enabled).toBe(true);
      expect(result.staticMounts).toHaveLength(1);
    });

    it('should accept development config', () => {
      const config: RouterConfig = {
        basePath: '/api',
        cors: {
          enabled: true,
          origins: '*',
          methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
        },
      };

      const result = RouterConfigSchema.parse(config);
      expect(result.cors?.origins).toBe('*');
    });
  });
});

describe('Integration Tests', () => {
  it('should support complete routing setup', () => {
    // Router config
    const routerConfig = RouterConfigSchema.parse({
      basePath: '/api/v1',
      mounts: {
        data: '/data',
        metadata: '/meta',
      },
    });

    // Route definitions
    const routes: RouteDefinition[] = [
      {
        method: 'GET',
        path: '/api/v1/health',
        category: 'system',
        handler: 'health_check',
        public: true,
      },
      {
        method: 'GET',
        path: `${routerConfig.basePath}${routerConfig.mounts.data}/:object`,
        category: 'api',
        handler: 'list_records',
      },
      {
        method: 'POST',
        path: `${routerConfig.basePath}${routerConfig.mounts.data}/:object`,
        category: 'api',
        handler: 'create_record',
        permissions: ['data.create'],
      },
    ];

    routes.forEach(route => {
      expect(() => RouteDefinitionSchema.parse(route)).not.toThrow();
    });

    expect(routes).toHaveLength(3);
  });

  it('should support route categorization', () => {
    const systemRoutes: RouteDefinition[] = [
      {
        method: 'GET',
        path: '/health',
        category: 'system',
        handler: 'health',
        public: true,
      },
      {
        method: 'GET',
        path: '/metrics',
        category: 'system',
        handler: 'metrics',
        public: false,
        permissions: ['admin'],
      },
    ];

    const apiRoutes: RouteDefinition[] = [
      {
        method: 'GET',
        path: '/api/users',
        category: 'api',
        handler: 'list_users',
      },
      {
        method: 'POST',
        path: '/api/users',
        category: 'api',
        handler: 'create_user',
        permissions: ['users.create'],
      },
    ];

    [...systemRoutes, ...apiRoutes].forEach(route => {
      expect(() => RouteDefinitionSchema.parse(route)).not.toThrow();
    });
  });
});
