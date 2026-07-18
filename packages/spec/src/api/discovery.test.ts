import { describe, it, expect } from 'vitest';
import {
  DiscoverySchema,
  ApiRoutesSchema,
  ServiceInfoSchema,
  ServiceStatus,
  WellKnownCapabilitiesSchema,
  RouteHealthEntrySchema,
  RouteHealthReportSchema,
  ServiceSelfInfoSchema,
  readServiceSelfInfo,
  SERVICE_SELF_INFO_KEY,
  type DiscoveryResponse,
  type ApiRoutes,
  type ServiceInfo,
  type WellKnownCapabilities,
  type RouteHealthEntry,
  type RouteHealthReport,
} from './discovery.zod';

describe('ApiRoutesSchema', () => {
  it('should accept valid minimal routes', () => {
    const routes: ApiRoutes = {
      data: '/api/v1/data',
      metadata: '/api/v1/meta',
      auth: '/api/v1/auth',
    };

    expect(() => ApiRoutesSchema.parse(routes)).not.toThrow();
  });

  it('should accept routes with all fields', () => {
    const routes = ApiRoutesSchema.parse({
      data: '/api/v1/data',
      metadata: '/api/v1/meta',
      auth: '/api/v1/auth',
      actions: '/api/v1/p',
      storage: '/api/v1/storage',
      graphql: '/api/v1/graphql',
      discovery: '/api/v1/discovery',
    });

    expect(routes.data).toBe('/api/v1/data');
    expect(routes.graphql).toBe('/api/v1/graphql');
    expect(routes.discovery).toBe('/api/v1/discovery');
  });

  it('should accept custom route paths', () => {
    const routes = ApiRoutesSchema.parse({
      data: '/data',
      metadata: '/metadata',
      auth: '/auth',
    });

    expect(routes.data).toBe('/data');
  });

  it('should accept versioned routes', () => {
    const routes = ApiRoutesSchema.parse({
      data: '/api/v2/data',
      metadata: '/api/v2/meta',
      auth: '/api/v2/auth',
    });

    expect(routes.data).toBe('/api/v2/data');
  });

  it('should reject routes without required fields', () => {
    // data is required
    expect(() => ApiRoutesSchema.parse({
      metadata: '/api/v1/meta',
      auth: '/api/v1/auth',
    })).toThrow();

    // metadata is required
    expect(() => ApiRoutesSchema.parse({
      data: '/api/v1/data',
      auth: '/api/v1/auth',
    })).toThrow();
  });

  it('should accept routes without auth (auth is plugin-provided)', () => {
    const routes = ApiRoutesSchema.parse({
      data: '/api/v1/data',
      metadata: '/api/v1/meta',
    });

    expect(routes.data).toBe('/api/v1/data');
    expect(routes.auth).toBeUndefined();
  });
});

/** Minimal services map used as base fixture for DiscoverySchema tests */
const minimalServices = {
  data: { enabled: true, status: 'available' as const, route: '/api/v1/data', provider: 'objectql' },
  metadata: { enabled: true, status: 'available' as const, route: '/api/v1/meta', provider: 'objectql' },
};

describe('DiscoverySchema', () => {
  it('should accept valid minimal discovery response', () => {
    const discovery: DiscoveryResponse = {
      name: 'ObjectStack',
      version: '1.0.0',
      environment: 'production',
      routes: {
        data: '/api/v1/data',
        metadata: '/api/v1/meta',
        auth: '/api/v1/auth',
      },
      services: minimalServices,
      locale: {
        default: 'en-US',
        supported: ['en-US', 'zh-CN'],
        timezone: 'UTC',
      },
    };

    expect(() => DiscoverySchema.parse(discovery)).not.toThrow();
  });

  it('should accept discovery with all fields', () => {
    const discovery = DiscoverySchema.parse({
      name: 'ObjectStack Platform',
      version: '2.0.0',
      environment: 'production',
      routes: {
        data: '/api/v1/data',
        metadata: '/api/v1/meta',
        auth: '/api/v1/auth',
        actions: '/api/v1/p',
        storage: '/api/v1/storage',
        graphql: '/api/v1/graphql',
      },
      services: {
        ...minimalServices,
        graphql: { enabled: true, status: 'available' as const, route: '/api/v1/graphql', provider: 'plugin-graphql' },
        search: { enabled: true, status: 'available' as const, route: '/api/v1/search', provider: 'plugin-search' },
      },
      locale: {
        default: 'en-US',
        supported: ['en-US', 'zh-CN', 'es-ES', 'fr-FR'],
        timezone: 'America/Los_Angeles',
      },
    });

    expect(discovery.name).toBe('ObjectStack Platform');
    expect(discovery.version).toBe('2.0.0');
  });

  it('should accept different environment values', () => {
    const environments: Array<DiscoveryResponse['environment']> = ['production', 'sandbox', 'development'];

    environments.forEach(environment => {
      const discovery = DiscoverySchema.parse({
        name: 'ObjectStack',
        version: '1.0.0',
        environment,
        routes: {
          data: '/api/v1/data',
          metadata: '/api/v1/meta',
          auth: '/api/v1/auth',
        },
        services: minimalServices,
        locale: {
          default: 'en-US',
          supported: ['en-US'],
          timezone: 'UTC',
        },
      });
      expect(discovery.environment).toBe(environment);
    });
  });

  it('should reject invalid environment', () => {
    expect(() => DiscoverySchema.parse({
      name: 'ObjectStack',
      version: '1.0.0',
      environment: 'staging',
      routes: {
        data: '/api/v1/data',
        metadata: '/api/v1/meta',
        auth: '/api/v1/auth',
      },
      services: minimalServices,
      locale: {
        default: 'en-US',
        supported: ['en-US'],
        timezone: 'UTC',
      },
    })).toThrow();
  });

  it('should handle production environment', () => {
    const discovery = DiscoverySchema.parse({
      name: 'ObjectStack Production',
      version: '1.0.0',
      environment: 'production',
      routes: {
        data: '/api/v1/data',
        metadata: '/api/v1/meta',
        auth: '/api/v1/auth',
      },
      services: {
        ...minimalServices,
        graphql: { enabled: true, status: 'available' as const, route: '/graphql', provider: 'plugin-graphql' },
        search: { enabled: true, status: 'available' as const, route: '/api/v1/search', provider: 'plugin-search' },
      },
      locale: {
        default: 'en-US',
        supported: ['en-US', 'zh-CN', 'es-ES'],
        timezone: 'UTC',
      },
    });

    expect(discovery.environment).toBe('production');
  });

  it('should handle sandbox environment', () => {
    const discovery = DiscoverySchema.parse({
      name: 'ObjectStack Sandbox',
      version: '1.0.0-sandbox',
      environment: 'sandbox',
      routes: {
        data: '/api/v1/data',
        metadata: '/api/v1/meta',
        auth: '/api/v1/auth',
      },
      services: minimalServices,
      locale: {
        default: 'en-US',
        supported: ['en-US'],
        timezone: 'UTC',
      },
    });

    expect(discovery.environment).toBe('sandbox');
  });

  it('should handle development environment', () => {
    const discovery = DiscoverySchema.parse({
      name: 'ObjectStack Dev',
      version: '0.1.0-dev',
      environment: 'development',
      routes: {
        data: '/api/v1/data',
        metadata: '/api/v1/meta',
        auth: '/api/v1/auth',
      },
      services: minimalServices,
      locale: {
        default: 'en-US',
        supported: ['en-US'],
        timezone: 'America/Los_Angeles',
      },
    });

    expect(discovery.environment).toBe('development');
  });

  it('should handle locale configuration', () => {
    const discovery = DiscoverySchema.parse({
      name: 'ObjectStack',
      version: '1.0.0',
      environment: 'production',
      routes: {
        data: '/api/v1/data',
        metadata: '/api/v1/meta',
        auth: '/api/v1/auth',
      },
      services: minimalServices,
      locale: {
        default: 'zh-CN',
        supported: ['en-US', 'zh-CN', 'ja-JP'],
        timezone: 'Asia/Shanghai',
      },
    });

    expect(discovery.locale.default).toBe('zh-CN');
    expect(discovery.locale.supported).toHaveLength(3);
    expect(discovery.locale.timezone).toBe('Asia/Shanghai');
  });

  it('should handle timezone configuration', () => {
    const timezones = [
      'UTC',
      'America/New_York',
      'America/Los_Angeles',
      'Europe/London',
      'Asia/Tokyo',
      'Australia/Sydney',
    ];

    timezones.forEach(timezone => {
      const discovery = DiscoverySchema.parse({
        name: 'ObjectStack',
        version: '1.0.0',
        environment: 'production',
        routes: {
          data: '/api/v1/data',
          metadata: '/api/v1/meta',
          auth: '/api/v1/auth',
        },
        services: minimalServices,
        locale: {
          default: 'en-US',
          supported: ['en-US'],
          timezone,
        },
      });
      expect(discovery.locale.timezone).toBe(timezone);
    });
  });

  it('should handle multiple supported locales', () => {
    const discovery = DiscoverySchema.parse({
      name: 'ObjectStack',
      version: '1.0.0',
      environment: 'production',
      routes: {
        data: '/api/v1/data',
        metadata: '/api/v1/meta',
        auth: '/api/v1/auth',
      },
      services: minimalServices,
      locale: {
        default: 'en-US',
        supported: [
          'en-US',
          'en-GB',
          'zh-CN',
          'zh-TW',
          'es-ES',
          'es-MX',
          'fr-FR',
          'de-DE',
          'ja-JP',
          'ko-KR',
        ],
        timezone: 'UTC',
      },
    });

    expect(discovery.locale.supported).toHaveLength(10);
  });

  it('should handle GraphQL-enabled instance via services', () => {
    const discovery = DiscoverySchema.parse({
      name: 'ObjectStack',
      version: '1.0.0',
      environment: 'production',
      routes: {
        data: '/api/v1/data',
        metadata: '/api/v1/meta',
        auth: '/api/v1/auth',
        graphql: '/api/v1/graphql',
      },
      services: {
        ...minimalServices,
        graphql: { enabled: true, status: 'available' as const, route: '/api/v1/graphql', provider: 'plugin-graphql' },
      },
      locale: {
        default: 'en-US',
        supported: ['en-US'],
        timezone: 'UTC',
      },
    });

    expect(discovery.services['graphql'].enabled).toBe(true);
    expect(discovery.routes.graphql).toBe('/api/v1/graphql');
  });

  it('should reject discovery without required fields', () => {
    expect(() => DiscoverySchema.parse({
      version: '1.0.0',
      environment: 'production',
      routes: {
        data: '/api/v1/data',
        metadata: '/api/v1/meta',
        auth: '/api/v1/auth',
      },
      services: minimalServices,
      locale: {
        default: 'en-US',
        supported: ['en-US'],
        timezone: 'UTC',
      },
    })).toThrow();

    expect(() => DiscoverySchema.parse({
      name: 'ObjectStack',
      environment: 'production',
      routes: {
        data: '/api/v1/data',
        metadata: '/api/v1/meta',
        auth: '/api/v1/auth',
      },
      services: minimalServices,
      locale: {
        default: 'en-US',
        supported: ['en-US'],
        timezone: 'UTC',
      },
    })).toThrow();
  });

  it('should reject discovery without services (now required)', () => {
    expect(() => DiscoverySchema.parse({
      name: 'ObjectStack',
      version: '1.0.0',
      environment: 'production',
      routes: {
        data: '/api/v1/data',
        metadata: '/api/v1/meta',
      },
      locale: {
        default: 'en-US',
        supported: ['en-US'],
        timezone: 'UTC',
      },
    })).toThrow();
  });
});

describe('ServiceInfoSchema', () => {
  it('should accept an available service', () => {
    const info: ServiceInfo = {
      enabled: true,
      status: 'available',
      route: '/api/v1/data',
      provider: 'objectql',
    };
    expect(() => ServiceInfoSchema.parse(info)).not.toThrow();
  });

  it('should accept an unavailable service with message', () => {
    const info = ServiceInfoSchema.parse({
      enabled: false,
      status: 'unavailable',
      message: 'Install plugin-workflow to enable',
    });
    expect(info.enabled).toBe(false);
    expect(info.route).toBeUndefined();
    expect(info.message).toBe('Install plugin-workflow to enable');
  });

  it('should accept a stub service', () => {
    const info = ServiceInfoSchema.parse({
      enabled: false,
      status: 'stub',
      route: '/api/v1/automation',
      message: 'Install plugin-automation to enable',
    });
    expect(info.status).toBe('stub');
  });

  it('should accept a degraded service', () => {
    const info = ServiceInfoSchema.parse({
      enabled: true,
      status: 'degraded',
      provider: 'objectql',
      message: 'HTTP ETag caching only',
    });
    expect(info.status).toBe('degraded');
    expect(info.enabled).toBe(true);
  });

  it('should reject invalid status', () => {
    expect(() => ServiceInfoSchema.parse({
      enabled: true,
      status: 'unknown',
    })).toThrow();
  });
});

describe('DiscoverySchema with services', () => {
  const baseDiscovery = {
    name: 'ObjectStack',
    version: '1.0.0',
    environment: 'production' as const,
    routes: {
      data: '/api/v1/data',
      metadata: '/api/v1/meta',
      auth: '/api/v1/auth',
    },
    services: minimalServices,
    locale: {
      default: 'en-US',
      supported: ['en-US'],
      timezone: 'UTC',
    },
  };

  it('should accept discovery with services map', () => {
    const discovery = DiscoverySchema.parse({
      ...baseDiscovery,
      services: {
        metadata: { enabled: true, status: 'available', route: '/api/v1/meta', provider: 'objectql' },
        data: { enabled: true, status: 'available', route: '/api/v1/data', provider: 'objectql' },
        auth: { enabled: true, status: 'available', route: '/api/v1/auth' },
        workflow: { enabled: false, status: 'unavailable', message: 'Not installed' },
        analytics: { enabled: false, status: 'stub', message: 'Install plugin' },
      },
    });

    expect(discovery.services).toBeDefined();
    expect(discovery.services['metadata'].enabled).toBe(true);
    expect(discovery.services['metadata'].status).toBe('available');
    expect(discovery.services['workflow'].enabled).toBe(false);
    expect(discovery.services['analytics'].status).toBe('stub');
  });

  it('should allow clients to enumerate available vs unavailable services', () => {
    const discovery = DiscoverySchema.parse({
      ...baseDiscovery,
      services: {
        metadata: { enabled: true, status: 'available' },
        data: { enabled: true, status: 'available' },
        auth: { enabled: true, status: 'available' },
        cache: { enabled: true, status: 'degraded', message: 'ETag only' },
        workflow: { enabled: false, status: 'unavailable' },
        ai: { enabled: false, status: 'unavailable' },
      },
    });

    const available = Object.entries(discovery.services)
      .filter(([, s]) => s.enabled)
      .map(([name]) => name);
    const unavailable = Object.entries(discovery.services)
      .filter(([, s]) => !s.enabled)
      .map(([name]) => name);

    expect(available).toEqual(['metadata', 'data', 'auth', 'cache']);
    expect(unavailable).toEqual(['workflow', 'ai']);
  });

  it('should derive capabilities from services (no dedicated capabilities field needed)', () => {
    const discovery = DiscoverySchema.parse({
      ...baseDiscovery,
      services: {
        ...minimalServices,
        graphql: { enabled: true, status: 'available', route: '/graphql', provider: 'plugin-graphql' },
        ai: { enabled: false, status: 'unavailable', message: 'Not installed' },
      },
    });

    // Capability can be derived from service.enabled
    expect(discovery.services['graphql'].enabled).toBe(true);
    expect(discovery.services['ai'].enabled).toBe(false);
  });
});

// ==========================================
// ServiceInfoSchema — version & rateLimit
// ==========================================

describe('ServiceInfoSchema (version field)', () => {
  it('should accept a service with version', () => {
    const info = ServiceInfoSchema.parse({
      enabled: true,
      status: 'available',
      route: '/api/v1/data',
      provider: 'objectql',
      version: '3.0.6',
    });
    expect(info.version).toBe('3.0.6');
  });

  it('should allow version to be omitted', () => {
    const info = ServiceInfoSchema.parse({
      enabled: true,
      status: 'available',
    });
    expect(info.version).toBeUndefined();
  });
});

describe('ServiceInfoSchema (rateLimit field)', () => {
  it('should accept a service with rateLimit', () => {
    const info = ServiceInfoSchema.parse({
      enabled: true,
      status: 'available',
      rateLimit: {
        requestsPerMinute: 60,
        requestsPerHour: 1000,
        burstLimit: 10,
        retryAfterMs: 5000,
      },
    });
    expect(info.rateLimit?.requestsPerMinute).toBe(60);
    expect(info.rateLimit?.burstLimit).toBe(10);
  });

  it('should allow rateLimit to be omitted', () => {
    const info = ServiceInfoSchema.parse({
      enabled: true,
      status: 'available',
    });
    expect(info.rateLimit).toBeUndefined();
  });

  it('should allow partial rateLimit fields', () => {
    const info = ServiceInfoSchema.parse({
      enabled: true,
      status: 'available',
      rateLimit: {
        requestsPerMinute: 100,
      },
    });
    expect(info.rateLimit?.requestsPerMinute).toBe(100);
    expect(info.rateLimit?.requestsPerHour).toBeUndefined();
  });
});

// ==========================================
// DiscoverySchema — capabilities
// ==========================================

describe('DiscoverySchema (capabilities field)', () => {
  const fixture = {
    name: 'ObjectStack',
    version: '1.0.0',
    environment: 'production' as const,
    routes: { data: '/api/v1/data', metadata: '/api/v1/meta' },
    services: minimalServices,
    locale: { default: 'en-US', supported: ['en-US'], timezone: 'UTC' },
  };

  it('should accept discovery with capabilities', () => {
    const discovery = DiscoverySchema.parse({
      ...fixture,
      capabilities: {
        comments: {
          enabled: true,
          features: { threaded: true, reactions: true, mentions: true },
          description: 'Feed and comments support',
        },
        automation: {
          enabled: false,
          description: 'Flow automation engine',
        },
      },
    });
    expect(discovery.capabilities?.comments.enabled).toBe(true);
    expect(discovery.capabilities?.comments.features?.threaded).toBe(true);
    expect(discovery.capabilities?.automation.enabled).toBe(false);
  });

  it('should allow capabilities to be omitted', () => {
    const discovery = DiscoverySchema.parse(fixture);
    expect(discovery.capabilities).toBeUndefined();
  });
});

// ==========================================
// DiscoverySchema — schemaDiscovery
// ==========================================

describe('DiscoverySchema (schemaDiscovery field)', () => {
  const fixture = {
    name: 'ObjectStack',
    version: '1.0.0',
    environment: 'production' as const,
    routes: { data: '/api/v1/data', metadata: '/api/v1/meta' },
    services: minimalServices,
    locale: { default: 'en-US', supported: ['en-US'], timezone: 'UTC' },
  };

  it('should accept discovery with schemaDiscovery', () => {
    const discovery = DiscoverySchema.parse({
      ...fixture,
      schemaDiscovery: {
        openapi: '/api/v1/openapi.json',
        graphql: '/graphql',
        jsonSchema: '/api/v1/schemas',
      },
    });
    expect(discovery.schemaDiscovery?.openapi).toBe('/api/v1/openapi.json');
    expect(discovery.schemaDiscovery?.graphql).toBe('/graphql');
    expect(discovery.schemaDiscovery?.jsonSchema).toBe('/api/v1/schemas');
  });

  it('should allow schemaDiscovery to be omitted', () => {
    const discovery = DiscoverySchema.parse(fixture);
    expect(discovery.schemaDiscovery).toBeUndefined();
  });

  it('should allow partial schemaDiscovery fields', () => {
    const discovery = DiscoverySchema.parse({
      ...fixture,
      schemaDiscovery: {
        openapi: '/api/v1/openapi.json',
      },
    });
    expect(discovery.schemaDiscovery?.openapi).toBe('/api/v1/openapi.json');
    expect(discovery.schemaDiscovery?.graphql).toBeUndefined();
  });
});

// ==========================================
// WellKnownCapabilitiesSchema
// ==========================================

describe('WellKnownCapabilitiesSchema', () => {
  it('should accept all capabilities enabled', () => {
    const caps: WellKnownCapabilities = {
      comments: true,
      automation: true,
      cron: true,
      search: true,
      export: true,
      chunkedUpload: true,
    };
    expect(() => WellKnownCapabilitiesSchema.parse(caps)).not.toThrow();
  });

  it('should accept all capabilities disabled', () => {
    const caps = WellKnownCapabilitiesSchema.parse({
      comments: false,
      automation: false,
      cron: false,
      search: false,
      export: false,
      chunkedUpload: false,
    });
    expect(caps.comments).toBe(false);
    expect(caps.chunkedUpload).toBe(false);
  });

  it('should reject missing required fields', () => {
    expect(() => WellKnownCapabilitiesSchema.parse({ comments: true })).toThrow();
    expect(() => WellKnownCapabilitiesSchema.parse({})).toThrow();
  });

  it('should reject non-boolean values', () => {
    expect(() => WellKnownCapabilitiesSchema.parse({
      comments: 'yes',
      automation: true,
      cron: true,
      search: true,
      export: true,
      chunkedUpload: true,
    })).toThrow();
  });

  it('should have .describe() annotations on all fields', () => {
    const shape = WellKnownCapabilitiesSchema.shape;
    expect(shape.comments.description).toBeDefined();
    expect(shape.automation.description).toBeDefined();
    expect(shape.cron.description).toBeDefined();
    expect(shape.search.description).toBeDefined();
    expect(shape.export.description).toBeDefined();
    expect(shape.chunkedUpload.description).toBeDefined();
  });
});

// ==========================================
// ServiceStatus enum
// ==========================================

describe('ServiceStatus', () => {
  it('should accept all valid status values', () => {
    const values = ['available', 'registered', 'unavailable', 'degraded', 'stub'] as const;
    values.forEach(status => {
      expect(() => ServiceStatus.parse(status)).not.toThrow();
    });
  });

  it('should include "registered" for declared-but-unverified routes', () => {
    expect(ServiceStatus.parse('registered')).toBe('registered');
  });

  it('should reject invalid status values', () => {
    expect(() => ServiceStatus.parse('unknown')).toThrow();
    expect(() => ServiceStatus.parse('active')).toThrow();
  });
});

// ==========================================
// ServiceInfoSchema — handlerReady field
// ==========================================

describe('ServiceInfoSchema (handlerReady field)', () => {
  it('should default handlerReady to undefined when omitted', () => {
    const info = ServiceInfoSchema.parse({
      enabled: true,
      status: 'available',
    });
    expect(info.handlerReady).toBeUndefined();
  });

  it('should accept explicit handlerReady: true', () => {
    const info = ServiceInfoSchema.parse({
      enabled: true,
      status: 'available',
      handlerReady: true,
      route: '/api/v1/data',
    });
    expect(info.handlerReady).toBe(true);
  });

  it('should accept registered status with handlerReady false', () => {
    const info = ServiceInfoSchema.parse({
      enabled: true,
      status: 'registered',
      handlerReady: false,
      route: '/api/v1/ai',
      message: 'Route declared but handler not verified',
    });
    expect(info.status).toBe('registered');
    expect(info.handlerReady).toBe(false);
  });

  it('should allow clients to filter handler-ready services', () => {
    const services: Record<string, ServiceInfo> = {
      data: ServiceInfoSchema.parse({ enabled: true, status: 'available', handlerReady: true }),
      ai: ServiceInfoSchema.parse({ enabled: true, status: 'registered', handlerReady: false }),
      workflow: ServiceInfoSchema.parse({ enabled: false, status: 'unavailable', handlerReady: false }),
    };

    const ready = Object.entries(services)
      .filter(([, s]) => s.enabled && s.handlerReady)
      .map(([name]) => name);

    expect(ready).toEqual(['data']);
  });
});

// ==========================================
// RouteHealthReportSchema
// ==========================================

describe('RouteHealthEntrySchema', () => {
  it('should accept a valid entry', () => {
    const entry: RouteHealthEntry = {
      route: '/api/v1/analytics/query',
      method: 'POST',
      service: 'analytics',
      declared: true,
      handlerRegistered: true,
      healthStatus: 'pass',
    };
    expect(() => RouteHealthEntrySchema.parse(entry)).not.toThrow();
  });

  it('should accept all health status values', () => {
    const statuses = ['pass', 'fail', 'missing', 'skip'] as const;
    statuses.forEach(healthStatus => {
      expect(() => RouteHealthEntrySchema.parse({
        route: '/test',
        method: 'GET',
        service: 'test',
        declared: true,
        handlerRegistered: false,
        healthStatus,
      })).not.toThrow();
    });
  });

  it('should accept entry with diagnostic message', () => {
    const entry = RouteHealthEntrySchema.parse({
      route: '/api/v1/workflow',
      method: 'GET',
      service: 'workflow',
      declared: true,
      handlerRegistered: false,
      healthStatus: 'missing',
      message: 'No handler registered — install plugin-workflow',
    });
    expect(entry.message).toBe('No handler registered — install plugin-workflow');
  });
});

describe('RouteHealthReportSchema', () => {
  it('should accept a valid report', () => {
    const report: RouteHealthReport = {
      timestamp: '2026-04-01T00:00:00.000Z',
      adapter: 'hono',
      totalDeclared: 3,
      totalRegistered: 2,
      totalMissing: 1,
      routes: [
        { route: '/api/v1/data', method: 'GET', service: 'data', declared: true, handlerRegistered: true, healthStatus: 'pass' },
        { route: '/api/v1/meta', method: 'GET', service: 'metadata', declared: true, handlerRegistered: true, healthStatus: 'pass' },
        { route: '/api/v1/ai/chat', method: 'POST', service: 'ai', declared: true, handlerRegistered: false, healthStatus: 'missing' },
      ],
    };
    expect(() => RouteHealthReportSchema.parse(report)).not.toThrow();
  });

  it('should validate summary counters are integers', () => {
    expect(() => RouteHealthReportSchema.parse({
      timestamp: '2026-04-01T00:00:00.000Z',
      adapter: 'express',
      totalDeclared: 1.5,
      totalRegistered: 1,
      totalMissing: 0,
      routes: [],
    })).toThrow();
  });
});

describe('Service self-description marker (ADR-0076 D12, #2462)', () => {
  it('ServiceSelfInfoSchema accepts stub and degraded declarations', () => {
    expect(() => ServiceSelfInfoSchema.parse({ status: 'stub' })).not.toThrow();
    expect(() => ServiceSelfInfoSchema.parse({
      status: 'degraded', handlerReady: true, message: 'fallback',
    })).not.toThrow();
  });

  it('ServiceSelfInfoSchema rejects available — real services carry no marker', () => {
    expect(() => ServiceSelfInfoSchema.parse({ status: 'available' })).toThrow();
  });

  it('readServiceSelfInfo returns undefined for unmarked services and non-objects', () => {
    expect(readServiceSelfInfo({ query: () => [] })).toBeUndefined();
    expect(readServiceSelfInfo(undefined)).toBeUndefined();
    expect(readServiceSelfInfo(null)).toBeUndefined();
    expect(readServiceSelfInfo('svc')).toBeUndefined();
  });

  it('readServiceSelfInfo reads the standard __serviceInfo descriptor', () => {
    const svc = {
      [SERVICE_SELF_INFO_KEY]: { status: 'degraded', message: 'partial' },
    };
    expect(readServiceSelfInfo(svc)).toEqual({
      status: 'degraded',
      handlerReady: true, // degraded defaults to a genuinely-serving handler
      message: 'partial',
    });
  });

  it('readServiceSelfInfo defaults handlerReady to false for stubs', () => {
    const svc = { [SERVICE_SELF_INFO_KEY]: { status: 'stub' } };
    expect(readServiceSelfInfo(svc)).toEqual({ status: 'stub', handlerReady: false });
  });

  it('readServiceSelfInfo honors an explicit handlerReady override', () => {
    const svc = { [SERVICE_SELF_INFO_KEY]: { status: 'degraded', handlerReady: false } };
    expect(readServiceSelfInfo(svc)?.handlerReady).toBe(false);
  });

  it('readServiceSelfInfo normalizes the legacy _dev marker to a stub', () => {
    const info = readServiceSelfInfo({ _dev: true, chat: () => 'fake' });
    expect(info?.status).toBe('stub');
    expect(info?.handlerReady).toBe(false);
    expect(info?.message).toContain('plugin-dev');
  });

  it('readServiceSelfInfo ignores malformed markers', () => {
    expect(readServiceSelfInfo({ [SERVICE_SELF_INFO_KEY]: { status: 'available' } })).toBeUndefined();
    expect(readServiceSelfInfo({ [SERVICE_SELF_INFO_KEY]: 'stub' })).toBeUndefined();
    expect(readServiceSelfInfo({ _dev: 'yes' })).toBeUndefined();
  });
});
