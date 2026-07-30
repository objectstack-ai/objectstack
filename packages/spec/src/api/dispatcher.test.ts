import { describe, it, expect } from 'vitest';
import {
  DispatcherRouteSchema,
  DispatcherConfigSchema,
  DispatcherErrorCode,
  DispatcherErrorResponseSchema,
  type DispatcherRoute,
  type DispatcherConfig,
} from './dispatcher.zod';
import { ApiErrorSchema } from './contract.zod';

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
  it('should accept all four route-resolution failure modes', () => {
    ['ROUTE_NOT_FOUND', 'METHOD_NOT_ALLOWED', 'NOT_IMPLEMENTED', 'SERVICE_UNAVAILABLE'].forEach(code => {
      expect(() => DispatcherErrorCode.parse(code)).not.toThrow();
    });
  });

  it('should reject invalid codes', () => {
    expect(() => DispatcherErrorCode.parse('SOMETHING_ELSE')).toThrow();
  });

  it('should reject the HTTP-status spellings it used to hold (#3842)', () => {
    // The members were `'404' | '405' | '501' | '503'` while `error.code`
    // carried the numeric status. `code` is semantic now, so a status is not a
    // code — it belongs in `httpStatus`.
    ['404', '405', '501', '503'].forEach(status => {
      expect(() => DispatcherErrorCode.parse(status)).toThrow();
    });
  });
});

describe('DispatcherErrorResponseSchema', () => {
  it('should accept a 404 error response', () => {
    expect(() => DispatcherErrorResponseSchema.parse({
      success: false,
      error: {
        code: 'ROUTE_NOT_FOUND',
        message: 'Route Not Found: /api/v1/unknown',
        httpStatus: 404,
        route: '/api/v1/unknown',
      },
    })).not.toThrow();
  });

  it('should accept a 501 error response', () => {
    expect(() => DispatcherErrorResponseSchema.parse({
      success: false,
      error: {
        code: 'NOT_IMPLEMENTED',
        message: 'Not Implemented',
        httpStatus: 501,
        service: 'workflow',
        hint: 'Install plugin-workflow',
      },
    })).not.toThrow();
  });

  it('should accept a 503 error response', () => {
    expect(() => DispatcherErrorResponseSchema.parse({
      success: false,
      error: {
        code: 'SERVICE_UNAVAILABLE',
        message: 'Service Unavailable: ai',
        httpStatus: 503,
        service: 'ai',
      },
    })).not.toThrow();
  });

  it('should reject the numeric `code` it used to declare (#3842)', () => {
    // The regression this whole change exists to prevent: a producer putting the
    // HTTP status back into the field callers branch on.
    expect(() => DispatcherErrorResponseSchema.parse({
      success: false,
      error: { code: 404, message: 'Route Not Found: /api/v1/unknown' },
    })).toThrow();
  });

  it('agrees with the base ApiErrorSchema on what a dispatcher error is', () => {
    // The two schemas used to disagree about `code` — number here, string there
    // — which is what legitimised the dispatcher's deviation. A body valid under
    // one must now be valid under the other.
    const error = {
      code: 'ROUTE_NOT_FOUND',
      message: 'Route Not Found: /api/v1/unknown',
      httpStatus: 404,
      route: '/api/v1/unknown',
    };
    expect(() => DispatcherErrorResponseSchema.parse({ success: false, error })).not.toThrow();
    expect(ApiErrorSchema.safeParse(error).success).toBe(true);
  });
});
