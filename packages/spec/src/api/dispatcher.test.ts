import { describe, it, expect } from 'vitest';
import {
  DispatcherRouteSchema,
  DispatcherConfigSchema,
  DispatcherErrorCode,
  DispatcherErrorResponseSchema,
  DEFAULT_DISPATCHER_ROUTES,
  type DispatcherRoute,
  type DispatcherConfig,
} from './dispatcher.zod';

describe('DispatcherRouteSchema', () => {
  it('should accept valid route with all fields', () => {
    const route: DispatcherRoute = {
      prefix: '/api/v1/data',
      service: 'data',
      authRequired: true,
      criticality: 'required',
    };

    expect(() => DispatcherRouteSchema.parse(route)).not.toThrow();
  });

  it('should apply default values', () => {
    const route = DispatcherRouteSchema.parse({
      prefix: '/api/v1/ai',
      service: 'ai',
    });

    expect(route.authRequired).toBe(true);
    expect(route.criticality).toBe('optional');
  });

  it('should accept public route (no auth)', () => {
    const route = DispatcherRouteSchema.parse({
      prefix: '/api/v1/discovery',
      service: 'metadata',
      authRequired: false,
    });

    expect(route.authRequired).toBe(false);
  });

  it('should accept route with permissions', () => {
    const route = DispatcherRouteSchema.parse({
      prefix: '/api/v1/meta',
      service: 'metadata',
      permissions: ['system.metadata.read'],
    });

    expect(route.permissions).toEqual(['system.metadata.read']);
  });

  it('should reject route without leading slash', () => {
    expect(() => DispatcherRouteSchema.parse({
      prefix: 'api/v1/data',
      service: 'data',
    })).toThrow();
  });

  it('should reject invalid service name', () => {
    expect(() => DispatcherRouteSchema.parse({
      prefix: '/api/v1/invalid',
      service: 'not-a-service',
    })).toThrow();
  });

  it('should accept all valid criticality levels', () => {
    const levels = ['required', 'core', 'optional'] as const;
    levels.forEach(criticality => {
      const route = DispatcherRouteSchema.parse({
        prefix: '/api/v1/test',
        service: 'data',
        criticality,
      });
      expect(route.criticality).toBe(criticality);
    });
  });
});

describe('DispatcherConfigSchema', () => {
  it('should accept valid config with routes', () => {
    const config: DispatcherConfig = {
      routes: [
        { prefix: '/api/v1/data', service: 'data', authRequired: true, criticality: 'required' },
        { prefix: '/api/v1/meta', service: 'metadata', authRequired: true, criticality: 'required' },
      ],
      fallback: '404',
    };

    expect(() => DispatcherConfigSchema.parse(config)).not.toThrow();
  });

  it('should apply default fallback', () => {
    const config = DispatcherConfigSchema.parse({
      routes: [],
    });

    expect(config.fallback).toBe('404');
  });

  it('should accept proxy fallback with target', () => {
    const config = DispatcherConfigSchema.parse({
      routes: [],
      fallback: 'proxy',
      proxyTarget: 'https://api.example.com',
    });

    expect(config.fallback).toBe('proxy');
    expect(config.proxyTarget).toBe('https://api.example.com');
  });

  it('should accept custom fallback', () => {
    const config = DispatcherConfigSchema.parse({
      routes: [],
      fallback: 'custom',
    });

    expect(config.fallback).toBe('custom');
  });
});

describe('DEFAULT_DISPATCHER_ROUTES', () => {
  it('should have routes for all protocol namespaces', () => {
    expect(DEFAULT_DISPATCHER_ROUTES.length).toBeGreaterThanOrEqual(15);
  });

  it('should include required services', () => {
    const services = DEFAULT_DISPATCHER_ROUTES.map(r => r.service);
    expect(services).toContain('metadata');
    expect(services).toContain('data');
    expect(services).toContain('auth');
  });

  it('should include the storage service', () => {
    const services = DEFAULT_DISPATCHER_ROUTES.map(r => r.service);
    expect(services).toContain('file-storage');
    // The feed route was retired (ADR-0052 §5 / #3180) — comments/activity are
    // served by the generic data API on sys_comment / sys_activity.
    expect(DEFAULT_DISPATCHER_ROUTES.find(r => r.prefix.includes('feed'))).toBeUndefined();
  });

  it('should include optional services', () => {
    const services = DEFAULT_DISPATCHER_ROUTES.map(r => r.service);
    expect(services).toContain('ai');
    expect(services).toContain('i18n');
    expect(services).toContain('ui');
    expect(services).toContain('workflow');
    expect(services).toContain('realtime');
    expect(services).toContain('notification');
    expect(services).toContain('analytics');
    expect(services).toContain('automation');
  });

  it('should have discovery as public route', () => {
    const discovery = DEFAULT_DISPATCHER_ROUTES.find(r => r.prefix.includes('discovery'));
    expect(discovery).toBeDefined();
    expect(discovery!.authRequired).toBe(false);
  });

  it('should mark required services with required criticality', () => {
    const required = DEFAULT_DISPATCHER_ROUTES.filter(r => r.criticality === 'required');
    const requiredServices = required.map(r => r.service);
    expect(requiredServices).toContain('metadata');
    expect(requiredServices).toContain('data');
    expect(requiredServices).toContain('auth');
  });

  it('should have all prefixes starting with /', () => {
    DEFAULT_DISPATCHER_ROUTES.forEach(route => {
      expect(route.prefix).toMatch(/^\//);
    });
  });

  it('should be parseable by DispatcherConfigSchema', () => {
    expect(() => DispatcherConfigSchema.parse({
      routes: DEFAULT_DISPATCHER_ROUTES,
    })).not.toThrow();
  });

  it('should include health route', () => {
    const health = DEFAULT_DISPATCHER_ROUTES.find(r => r.prefix.includes('health'));
    expect(health).toBeDefined();
    expect(health!.authRequired).toBe(false);
    expect(health!.criticality).toBe('required');
  });
});

// ============================================================================
// Dispatcher Error Schemas
// ============================================================================

describe('DispatcherErrorCode', () => {
  it('should accept all valid error codes', () => {
    ['404', '405', '501', '503'].forEach(code => {
      expect(() => DispatcherErrorCode.parse(code)).not.toThrow();
    });
  });

  it('should reject invalid codes', () => {
    expect(() => DispatcherErrorCode.parse('200')).toThrow();
  });
});

describe('DispatcherErrorResponseSchema', () => {
  it('should accept a 404 error response', () => {
    expect(() => DispatcherErrorResponseSchema.parse({
      success: false,
      error: {
        code: 404,
        message: 'Route Not Found: /api/v1/unknown',
        type: 'ROUTE_NOT_FOUND',
        route: '/api/v1/unknown',
      },
    })).not.toThrow();
  });

  it('should accept a 501 error response', () => {
    expect(() => DispatcherErrorResponseSchema.parse({
      success: false,
      error: {
        code: 501,
        message: 'Not Implemented',
        type: 'NOT_IMPLEMENTED',
        service: 'workflow',
        hint: 'Install plugin-workflow',
      },
    })).not.toThrow();
  });

  it('should accept a 503 error response', () => {
    expect(() => DispatcherErrorResponseSchema.parse({
      success: false,
      error: {
        code: 503,
        message: 'Service Unavailable: ai',
        type: 'SERVICE_UNAVAILABLE',
        service: 'ai',
      },
    })).not.toThrow();
  });
});
