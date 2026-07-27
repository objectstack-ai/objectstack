import { describe, it, expect } from 'vitest';
import {
  DispatcherRouteSchema,
  DispatcherConfigSchema,
  DispatcherErrorCode,
  DispatcherErrorResponseSchema,
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

// DEFAULT_DISPATCHER_ROUTES tests removed with the const (#3586) — the
// dispatcher's real route surface is asserted by the route-ledger conformance
// suite in packages/runtime.

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
