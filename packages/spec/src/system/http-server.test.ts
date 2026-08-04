import { describe, it, expect } from 'vitest';
import * as httpServer from './http-server.zod';
import {
  RouteHandlerMetadataSchema,
  MiddlewareType,
  MiddlewareConfigSchema,
  ServerEventType,
  ServerEventSchema,
  ServerCapabilitiesSchema,
  ServerStatusSchema,
} from './http-server.zod';
import * as sharedHttp from '../shared/http.zod';
import { RouterConfigSchema } from '../api/router.zod';
import { ApiEndpointSchema } from '../api/endpoint.zod';

/**
 * `HttpServerConfigSchema` was retired in v17 (#4938, ADR-0049
 * enforce-or-remove): nine keys, zero runtime readers, and — the condition that
 * made it worse than the ordinary declared-but-unread defect — zero authoring
 * entry, so the configuration the docs promised could not even be written down.
 *
 * These are the removal's pin tests. There is deliberately NO `retiredKey()`
 * tombstone to assert against: a tombstone is a message to whoever writes the
 * key, and the only surface on which anyone can write a server key is
 * `StackServerConfigSchema`, which is `strictObject` and already answers for
 * all seven by name. Those prescriptions are pinned in `stack-server.test.ts`;
 * what is pinned HERE is that the export is gone and that nothing else went
 * with it.
 */
describe('HttpServerConfig retirement (#4938)', () => {
  // `HttpServerConfigSchema` and `HttpServerConfig` were both runtime VALUES
  // (the latter via `Object.assign(HttpServerConfigSchema, { create })`), so a
  // runtime `in` check is a real witness for them — reverse-verified by pasting
  // the removed limb back, which turns these red plus the barrel assertion
  // below. `HttpServerConfigInput` is type-only and cannot be seen from here at
  // all: a `@ts-expect-error` pin would be a PHANTOM check, because this
  // package's tsconfig excludes `**/*.test.ts` from `tsc --noEmit`. Its witness
  // is `api-surface.json`, which lost all three entries in this change and is
  // ratcheted by `check:api-surface` against the built `dist/*.d.ts`.
  it.each([
    'HttpServerConfigSchema',
    'HttpServerConfig',
  ])('no longer exports the value `%s`', (name) => {
    expect(name in httpServer).toBe(false);
  });

  it('does not re-export the removed shape from the system barrel either', async () => {
    const system = await import('./index');
    expect('HttpServerConfigSchema' in system).toBe(false);
    expect('HttpServerConfig' in system).toBe(false);
  });

  it('keeps the sibling exports that DO have consumers outside spec', () => {
    // The removal is the container, not the file: `RouteHandlerMetadata` is
    // consumed by `packages/rest/src/route-manager.ts` and `MiddlewareType` /
    // `MiddlewareConfig` by `packages/runtime/src/middleware.ts`. A whole-file
    // retirement would have broken both.
    for (const name of [
      'RouteHandlerMetadataSchema',
      'MiddlewareType',
      'MiddlewareConfigSchema',
      'MiddlewareConfig',
    ]) {
      expect(name in httpServer).toBe(true);
    }
  });

  it('leaves the shared value schemas it embedded in place — they are not orphaned', () => {
    // Each has at least one live consumer elsewhere, so none of them became
    // dead weight when their only `system/` embed point went away.
    expect('CorsConfigSchema' in sharedHttp).toBe(true);
    expect('StaticMountSchema' in sharedHttp).toBe(true);
    expect('RateLimitConfigSchema' in sharedHttp).toBe(true);

    const routerShape = (RouterConfigSchema as never as { shape: Record<string, unknown> }).shape;
    expect(Object.keys(routerShape)).toEqual(expect.arrayContaining(['cors', 'staticMounts']));
    const endpointShape = (ApiEndpointSchema as never as { shape: Record<string, unknown> }).shape;
    expect(Object.keys(endpointShape)).toContain('rateLimit');
  });
});

describe('RouteHandlerMetadataSchema', () => {
  it('should accept valid route handler', () => {
    const route = RouteHandlerMetadataSchema.parse({
      method: 'GET',
      path: '/api/users/:id',
      handler: 'getUser',
    });

    expect(route.method).toBe('GET');
    expect(route.path).toBe('/api/users/:id');
    expect(route.handler).toBe('getUser');
  });

  it('should accept route with metadata and security', () => {
    const route = RouteHandlerMetadataSchema.parse({
      method: 'POST',
      path: '/api/users',
      handler: 'createUser',
      metadata: {
        summary: 'Create a user',
        description: 'Creates a new user account',
        tags: ['users'],
        operationId: 'createUser',
      },
      security: {
        authRequired: true,
        permissions: ['users.create'],
        rateLimit: 'strict',
      },
    });

    expect(route.metadata?.summary).toBe('Create a user');
    expect(route.security?.permissions).toEqual(['users.create']);
  });

  it('should default authRequired to true', () => {
    const route = RouteHandlerMetadataSchema.parse({
      method: 'GET',
      path: '/api/data',
      handler: 'getData',
      security: {},
    });

    expect(route.security?.authRequired).toBe(true);
  });

  it('should reject missing required fields', () => {
    expect(() => RouteHandlerMetadataSchema.parse({})).toThrow();
    expect(() => RouteHandlerMetadataSchema.parse({ method: 'GET' })).toThrow();
    expect(() => RouteHandlerMetadataSchema.parse({ method: 'GET', path: '/test' })).toThrow();
  });
});

describe('MiddlewareType', () => {
  it('should accept valid middleware types', () => {
    const types = ['authentication', 'authorization', 'logging', 'validation', 'transformation', 'error', 'custom'];

    types.forEach((type) => {
      expect(() => MiddlewareType.parse(type)).not.toThrow();
    });
  });

  it('should reject invalid middleware types', () => {
    expect(() => MiddlewareType.parse('invalid')).toThrow();
    expect(() => MiddlewareType.parse('cache')).toThrow();
  });
});

describe('MiddlewareConfigSchema', () => {
  it('should accept valid middleware with defaults', () => {
    const mw = MiddlewareConfigSchema.parse({
      name: 'auth_middleware',
      type: 'authentication',
    });

    expect(mw.name).toBe('auth_middleware');
    expect(mw.type).toBe('authentication');
    expect(mw.enabled).toBe(true);
    expect(mw.order).toBe(100);
  });

  it('should accept full configuration', () => {
    const mw = MiddlewareConfigSchema.parse({
      name: 'rate_limiter',
      type: 'custom',
      enabled: false,
      order: 10,
      config: { maxRequests: 100 },
      paths: {
        include: ['/api/*'],
        exclude: ['/health'],
      },
    });

    expect(mw.enabled).toBe(false);
    expect(mw.order).toBe(10);
    expect(mw.config).toEqual({ maxRequests: 100 });
    expect(mw.paths?.include).toEqual(['/api/*']);
    expect(mw.paths?.exclude).toEqual(['/health']);
  });

  it('should reject invalid snake_case names', () => {
    expect(() => MiddlewareConfigSchema.parse({ name: 'InvalidName', type: 'custom' })).toThrow();
    expect(() => MiddlewareConfigSchema.parse({ name: 'my-middleware', type: 'custom' })).toThrow();
  });

  it('should reject missing required fields', () => {
    expect(() => MiddlewareConfigSchema.parse({})).toThrow();
    expect(() => MiddlewareConfigSchema.parse({ name: 'test' })).toThrow();
  });
});

describe('ServerEventType', () => {
  it('should accept valid event types', () => {
    const types = ['starting', 'started', 'stopping', 'stopped', 'request', 'response', 'error'];

    types.forEach((type) => {
      expect(() => ServerEventType.parse(type)).not.toThrow();
    });
  });

  it('should reject invalid event types', () => {
    expect(() => ServerEventType.parse('invalid')).toThrow();
  });
});

describe('ServerEventSchema', () => {
  it('should accept valid server event', () => {
    const event = ServerEventSchema.parse({
      type: 'started',
      timestamp: '2025-01-01T00:00:00Z',
    });

    expect(event.type).toBe('started');
    expect(event.timestamp).toBe('2025-01-01T00:00:00Z');
  });

  it('should accept event with data', () => {
    const event = ServerEventSchema.parse({
      type: 'error',
      timestamp: '2025-01-01T00:00:00Z',
      data: { message: 'Connection refused', code: 500 },
    });

    expect(event.data).toEqual({ message: 'Connection refused', code: 500 });
  });

  it('should reject invalid timestamp', () => {
    expect(() => ServerEventSchema.parse({ type: 'started', timestamp: 'not-a-date' })).toThrow();
  });

  it('should reject missing required fields', () => {
    expect(() => ServerEventSchema.parse({})).toThrow();
    expect(() => ServerEventSchema.parse({ type: 'started' })).toThrow();
  });
});

describe('ServerCapabilitiesSchema', () => {
  it('should accept empty config with defaults', () => {
    const caps = ServerCapabilitiesSchema.parse({});

    expect(caps.httpVersions).toEqual(['1.1']);
    expect(caps.websocket).toBe(false);
    expect(caps.sse).toBe(false);
    expect(caps.serverPush).toBe(false);
    expect(caps.streaming).toBe(true);
    expect(caps.middleware).toBe(true);
    expect(caps.routeParams).toBe(true);
    expect(caps.compression).toBe(true);
  });

  it('should accept full configuration', () => {
    const caps = ServerCapabilitiesSchema.parse({
      httpVersions: ['1.1', '2.0'],
      websocket: true,
      sse: true,
      serverPush: true,
      streaming: false,
      middleware: false,
      routeParams: false,
      compression: false,
    });

    expect(caps.httpVersions).toEqual(['1.1', '2.0']);
    expect(caps.websocket).toBe(true);
    expect(caps.sse).toBe(true);
  });

  it('should reject invalid HTTP versions', () => {
    expect(() => ServerCapabilitiesSchema.parse({ httpVersions: ['4.0'] })).toThrow();
  });
});

describe('ServerStatusSchema', () => {
  it('should accept minimal status', () => {
    const status = ServerStatusSchema.parse({
      state: 'running',
    });

    expect(status.state).toBe('running');
  });

  it('should accept all state values', () => {
    const states = ['stopped', 'starting', 'running', 'stopping', 'error'];

    states.forEach((state) => {
      expect(() => ServerStatusSchema.parse({ state })).not.toThrow();
    });
  });

  it('should accept full status', () => {
    const status = ServerStatusSchema.parse({
      state: 'running',
      uptime: 3600000,
      server: { port: 3000, host: '0.0.0.0', url: 'http://localhost:3000' },
      connections: { active: 10, total: 500 },
      requests: { total: 1000, success: 990, errors: 10 },
    });

    expect(status.uptime).toBe(3600000);
    expect(status.server?.port).toBe(3000);
    expect(status.connections?.active).toBe(10);
    expect(status.requests?.total).toBe(1000);
  });

  it('should reject invalid state', () => {
    expect(() => ServerStatusSchema.parse({ state: 'invalid' })).toThrow();
  });

  it('should reject missing required state', () => {
    expect(() => ServerStatusSchema.parse({})).toThrow();
  });
});
