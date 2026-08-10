import { describe, it, expect } from 'vitest';
import * as httpServer from './http-server.zod';
import {
  RouteHandlerMetadataSchema,
  MiddlewareType,
  MiddlewareConfigSchema,
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
  // all: when this was written a `@ts-expect-error` pin would have been a
  // PHANTOM check, because the package tsconfig excluded `**/*.test.ts` from
  // `tsc --noEmit` — the hole #5286 closed with a sibling `tsconfig.test.json`,
  // so a type-level pin here would evaluate today. Its longer-lived witness
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

/**
 * The rest of `http-server.zod.ts`'s runtime vocabulary was retired in v17
 * (#5295, ADR-0049 enforce-or-remove) — `ServerEventType` / `ServerEvent`,
 * `ServerCapabilities` and `ServerStatus`. Same file, same route and the same
 * absence of an authoring door as #4938 above, so again there is no
 * `retiredKey()` tombstone to assert against: none of the three was a KEY on
 * anything, so nobody could author one and nobody can receive a prescription.
 * What is pinned here is that the exports are gone, that the removal stopped at
 * the three shapes, and that the ONE doubt which held this card for four days —
 * "a capability vocabulary may be a reference surface for host implementers" —
 * was answered by measurement rather than by the absence of a grep hit.
 *
 * The unit tests that stood here (event-type enum, event parse, capability
 * defaults, status states) are deliberately NOT re-pointed at a surviving
 * schema: they asserted the shapes' own behaviour, and the shapes are the thing
 * being removed. Replacing them wholesale with the pins below is the third
 * fixture disposition in the retirement playbook.
 */
describe('server runtime vocabulary retirement (#5295)', () => {
  // All four were runtime VALUES (`z.enum` and `lazySchema` both produce one),
  // so an `in` check is a real witness. Reverse verification, direction
  // predicted before running it: pasting any limb back turns exactly these
  // assertions red — they are `false`-expecting existence checks, so the
  // restored export is the failure. It is the plain red direction, not one of
  // the two inverted ones, because nothing downstream COUNTS these names.
  it.each([
    'ServerEventType',
    'ServerEventSchema',
    'ServerCapabilitiesSchema',
    'ServerStatusSchema',
  ])('no longer exports the value `%s`', (name) => {
    expect(name in httpServer).toBe(false);
  });

  it('does not re-export them from the system barrel either', async () => {
    const system = await import('./index');
    for (const name of [
      'ServerEventType',
      'ServerEventSchema',
      'ServerCapabilitiesSchema',
      'ServerStatusSchema',
    ]) {
      expect(name in system).toBe(false);
    }
  });

  it('stops at the three shapes — the route/middleware half of the file survives', () => {
    // The file is not retired; its ROUTE-REGISTRATION half has live consumers
    // (`packages/rest/src/route-manager.ts`, `packages/runtime/src/middleware.ts`).
    // This is the same "removal is the container, not the file" line #4938 drew,
    // reasserted one layer in so a later sweep does not read the second
    // retirement as licence to take the rest.
    for (const name of [
      'RouteHandlerMetadataSchema',
      'MiddlewareType',
      'MiddlewareConfigSchema',
      'MiddlewareConfig',
    ]) {
      expect(name in httpServer).toBe(true);
    }
  });

  it('does not touch the server config that IS live and authorable', async () => {
    // `system/stack-server.zod.ts` is the one authoring door for server-level
    // configuration (#5006) and grows a key at a time, each with its executor.
    // A reader who sees two server retirements in this file must not conclude
    // that server configuration itself was retired.
    const stackServer = await import('./stack-server.zod');
    expect('StackServerConfigSchema' in stackServer).toBe(true);
  });
});
