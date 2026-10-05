// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Two plugin-auth engine calls that used to reach the engine with NO principal
 * and NO opt-in now carry the explicit system opt-in (`isSystem: true`):
 *
 *  - the platform-admin OAuth client toggle route (`/admin/oauth2/toggle-disabled`):
 *    its `sys_oauth_application` read and write go through `withSystemContext`,
 *    the same wrapper better-auth's adapter writes those rows through;
 *  - the SCIM bearer verifier (`verifyScimBearerToken`): its credential probe
 *    carries the opt-in in the read's trailing options.
 *
 * A context with neither a principal nor `isSystem` is the security
 * middleware's principal-less hand-off (ADR-0096), which is not an
 * authorization: each of these calls is already authorized by its own door
 * (the platform-admin judge; the bearer digest). The opt-in names that.
 *
 * Measured on a REAL engine: a middleware registered on it records the context
 * every operation receives, so what is asserted is what the middleware chain —
 * the security middleware included, in a composed deployment — is handed. Each
 * case also pins the door's answer and the stored row, which this change does
 * not move.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { Hono } from 'hono';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import type { PluginContext } from '@objectstack/core';
import { AuthPlugin } from './auth-plugin.js';
import { authIdentityObjects } from './manifest.js';
import { SCIM_CREDENTIAL_OBJECT, digestScimBearerToken, verifyScimBearerToken } from './scim-connection-service.js';

const BASE = '/api/v1/auth';
const ORIGIN = 'http://localhost:3000';
const SYSTEM = { context: { isSystem: true } } as const;

interface Seen {
  object: string;
  operation: string;
  context: Record<string, unknown> | undefined;
}

const engines: ObjectQL[] = [];
afterEach(async () => {
  while (engines.length) {
    const e = engines.pop();
    try {
      await (e as unknown as { destroy?(): Promise<void> })?.destroy?.();
    } catch {
      /* noop */
    }
  }
});

/** A real engine over in-memory sqlite, with plugin-auth's own objects and a context recorder. */
async function bootEngine(): Promise<{ engine: ObjectQL; seen: Seen[] }> {
  const engine = new ObjectQL();
  engines.push(engine);
  engine.registerDriver(
    new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true }),
    true,
  );
  await engine.init();
  for (const object of authIdentityObjects) {
    engine.registry.registerObject(object as never, '@objectstack/plugin-auth');
  }
  await engine.syncSchemas();
  const seen: Seen[] = [];
  engine.registerMiddleware(async (opCtx, next) => {
    seen.push({
      object: opCtx.object,
      operation: opCtx.operation,
      context: opCtx.context as Record<string, unknown> | undefined,
    });
    await next();
  });
  return { engine, seen };
}

const mockCtx = (): PluginContext =>
  ({
    registerService: vi.fn(),
    getService: vi.fn((name: string) => (name === 'manifest' ? { register: vi.fn() } : undefined)),
    getServices: vi.fn(() => new Map()),
    hook: vi.fn(),
    trigger: vi.fn(),
    logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
    getKernel: vi.fn(),
  }) as unknown as PluginContext;

/**
 * The plugin's REAL route registration on a real Hono app (the
 * `admin-sso-bridge-gate.test.ts` harness), with the auth manager reduced to
 * the seams the toggle route reads: the session the platform-admin judge
 * reads, and the data engine.
 */
async function mountRoutes(engine: ObjectQL) {
  const app = new Hono();
  const ctx = mockCtx();
  const plugin = new AuthPlugin({
    secret: 'test-secret-at-least-32-chars-long!!',
    plugins: { oidcProvider: false },
  });
  await plugin.init(ctx);
  (plugin as unknown as { authManager: unknown }).authManager = {
    handleRequest: async () => new Response(null, { status: 404 }),
    getApi: async () => ({
      getSession: async () => ({ user: { id: 'usr_platform_admin', isPlatformAdmin: true } }),
    }),
    getDataEngine: () => engine,
  };
  (plugin as unknown as {
    registerAuthRoutes(server: unknown, ctx: PluginContext): void;
  }).registerAuthRoutes({ getRawApp: () => app, getPort: () => 0 }, ctx);
  return app;
}

const toggle = (app: Hono, body: Record<string, unknown>) =>
  app.request(`${ORIGIN}${BASE}/admin/oauth2/toggle-disabled`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: ORIGIN },
    body: JSON.stringify(body),
  });

const onObject = (seen: Seen[], object: string) => seen.filter((s) => s.object === object);

describe('platform-admin OAuth client toggle — the read and the write carry the system opt-in', () => {
  it('flips the stored flag, and every sys_oauth_application operation it makes is isSystem', async () => {
    const { engine, seen } = await bootEngine();
    await engine.insert(
      'sys_oauth_application',
      {
        client_id: 'pin-client',
        name: 'Pin Client',
        redirect_uris: JSON.stringify(['https://pin.example/cb']),
        disabled: false,
      },
      SYSTEM,
    );
    const app = await mountRoutes(engine);
    seen.length = 0;

    const res = await toggle(app, { client_id: 'pin-client', disabled: true });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, data: { client_id: 'pin-client', disabled: true } });

    const ops = onObject(seen, 'sys_oauth_application');
    // Not vacuous: the route made both of its calls.
    expect(ops.map((o) => o.operation)).toEqual(['findOne', 'update']);
    for (const op of ops) {
      expect(op.context?.isSystem, `${op.operation} reached the engine without the system opt-in`).toBe(true);
    }

    const stored = await engine.findOne('sys_oauth_application', { where: { client_id: 'pin-client' } }, SYSTEM);
    expect(Boolean(stored?.disabled)).toBe(true);
  });

  it('a missing client is still 404 RESOURCE_NOT_FOUND, and its read is isSystem', async () => {
    const { engine, seen } = await bootEngine();
    const app = await mountRoutes(engine);
    seen.length = 0;

    const res = await toggle(app, { client_id: 'no-such-client', disabled: true });
    expect(res.status).toBe(404);
    const body = (await res.json()) as { success: boolean; error: { code: string } };
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('RESOURCE_NOT_FOUND');

    const ops = onObject(seen, 'sys_oauth_application');
    expect(ops.map((o) => o.operation)).toEqual(['findOne']);
    expect(ops[0].context?.isSystem).toBe(true);
  });
});

describe('SCIM bearer verification — the credential probe carries the system opt-in', () => {
  const SECRET = 'scim-pin-secret-at-least-32-chars-long';
  const TOKEN = 'oss_scim_pin-token';

  it('resolves a known bearer to its connection, through an isSystem read', async () => {
    const { engine, seen } = await bootEngine();
    await engine.insert(
      SCIM_CREDENTIAL_OBJECT,
      { connection_id: 'conn-pin', token_digest: digestScimBearerToken(SECRET, TOKEN), active: true },
      SYSTEM,
    );
    seen.length = 0;

    const verified = await verifyScimBearerToken(engine as never, SECRET, TOKEN);
    expect(verified?.connection).toEqual({ id: 'conn-pin', provisioningDomainId: 'conn-pin' });

    const ops = onObject(seen, SCIM_CREDENTIAL_OBJECT);
    expect(ops.map((o) => o.operation)).toEqual(['findOne']);
    expect(ops[0].context?.isSystem, 'the credential probe reached the engine without the system opt-in').toBe(true);
  });

  it('an unknown bearer is still null, through an isSystem read', async () => {
    const { engine, seen } = await bootEngine();
    seen.length = 0;

    expect(await verifyScimBearerToken(engine as never, SECRET, 'oss_scim_unknown')).toBeNull();

    const ops = onObject(seen, SCIM_CREDENTIAL_OBJECT);
    expect(ops.map((o) => o.operation)).toEqual(['findOne']);
    expect(ops[0].context?.isSystem).toBe(true);
  });
});
