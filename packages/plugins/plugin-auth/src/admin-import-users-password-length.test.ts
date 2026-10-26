// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#25932] The identity import sizes a generated temporary password to the
 * deployment's password length range, the way create-user's
 * `generatePassword` does: `min(max(16, minPasswordLength), maxPasswordLength)`,
 * read from better-auth's own `$context` (`password.config`), the one reader
 * of that range.
 *
 * Driven on a real stack: real `ObjectQL` over `@objectstack/driver-sql` +
 * better-sqlite3, the objects from this plugin's own manifest, a real
 * `AuthManager` whose `emailAndPassword` range is what the ADR-0069
 * `auth.password_min_length` / `password_max_length` settings map onto, and
 * the plugin's REAL `POST /admin/import-users` mount, so the pins also hold
 * the route's wiring of the import deps. Only the platform-admin gate's
 * session read is a stand-in (the `admin-import-users-account-invitation`
 * shape).
 *
 * Pinned:
 *  ① `temporary` policy under a minimum of 24: the row's password is 24
 *    characters, and the imported user signs in with it.
 *  ② `auto` policy, a row with no deliverable channel (no email service
 *    wired): the fallback temporary password is sized the same way.
 *  ③ The default range: still 16 characters.
 *  ④ A maximum below 16 caps the length at that maximum.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { Hono } from 'hono';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import type { PluginContext } from '@objectstack/core';
import { AuthManager } from './auth-manager.js';
import { AuthPlugin } from './auth-plugin.js';
import { authIdentityObjects } from './manifest.js';

const ORIGIN = 'https://acme.example.com';
const BASE = '/api/v1/auth';
const SECRET = 'test-secret-at-least-32-chars-long-25932';
const ADMIN = { id: 'admin-25932', email: 'ada.admin@acme.example.com' };

const engines: ObjectQL[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  while (engines.length) {
    try {
      await (engines.pop() as unknown as { destroy?(): Promise<void> })?.destroy?.();
    } catch {
      /* noop */
    }
  }
});

async function bootEngine(): Promise<ObjectQL> {
  const engine = new ObjectQL();
  engines.push(engine);
  engine.registerDriver(
    new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true }),
    true,
  );
  await engine.init();
  for (const object of authIdentityObjects) engine.registry.registerObject(object as never, '@objectstack/plugin-auth');
  await engine.syncSchemas();
  return engine;
}

/** A real manager with the given length range; `withEmail` wires a capturing email service. */
async function bootManager(
  emailAndPassword: { minPasswordLength?: number; maxPasswordLength?: number },
  withEmail = true,
): Promise<AuthManager> {
  const engine = await bootEngine();
  const manager = new AuthManager({
    secret: SECRET,
    baseUrl: ORIGIN,
    dataEngine: engine as never,
    plugins: { admin: true },
    emailAndPassword,
  } as never);
  if (withEmail) manager.setEmailService({ sendTemplate: async () => ({ status: 'sent' }) } as never);
  return manager;
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

/** The plugin's REAL route registration; only the gate's session read is a stand-in. */
async function mountImport(manager: AuthManager): Promise<Hono> {
  const app = new Hono();
  const ctx = mockCtx();
  const plugin = new AuthPlugin({ secret: SECRET, plugins: { oidcProvider: false } });
  await plugin.init(ctx);
  const realApi = await manager.getApi();
  const gated = new Proxy(manager, {
    get(target, key) {
      if (key === 'getApi') {
        return async () => ({ ...realApi, getSession: async () => ({ user: { ...ADMIN, isPlatformAdmin: true } }) });
      }
      const value = Reflect.get(target, key, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
  (plugin as unknown as { authManager: unknown }).authManager = gated;
  (plugin as unknown as {
    registerAuthRoutes(server: unknown, ctx: PluginContext): void;
  }).registerAuthRoutes({ getRawApp: () => app, getPort: () => 0 }, ctx);
  return app;
}

/** One email row through the mounted import; answers that row. */
async function importOne(app: Hono, email: string, passwordPolicy: 'temporary' | 'auto'): Promise<Record<string, unknown>> {
  const res = await app.request(`${ORIGIN}${BASE}/admin/import-users`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: ORIGIN },
    body: JSON.stringify({ format: 'json', mode: 'insert', passwordPolicy, rows: [{ email, name: 'Imported' }] }),
  });
  const answer = (await res.json()) as { data?: { summary?: { created?: number; errors?: number }; rows?: Array<Record<string, unknown>> } };
  expect(res.status, JSON.stringify(answer)).toBe(200);
  expect(answer.data?.summary).toMatchObject({ created: 1, errors: 0 });
  return answer.data!.rows![0]!;
}

async function signIn(manager: AuthManager, email: string, password: string): Promise<Response> {
  return manager.handleRequest(
    new Request(`${ORIGIN}${BASE}/sign-in/email`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: ORIGIN },
      body: JSON.stringify({ email, password }),
    }),
  );
}

describe('[#25932] the identity import sizes a temporary password to the deployment length range', () => {
  it('① temporary policy, minimum 24: a 24-character password the user signs in with', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const manager = await bootManager({ minPasswordLength: 24 });
    const app = await mountImport(manager);
    const email = 'temp-25932@acme.example.com';

    const row = await importOne(app, email, 'temporary');

    expect(row.delivery).toBe('temporary');
    const password = String(row.temporaryPassword);
    expect(password).toHaveLength(24);
    const res = await signIn(manager, email, password);
    expect(res.status, await res.clone().text()).toBe(200);
  });

  it('② auto policy, a row with no deliverable channel: the fallback password is sized the same way', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const manager = await bootManager({ minPasswordLength: 24 }, false);
    expect(manager.isEmailServiceAvailable(), 'no email service: the row has no deliverable channel').toBe(false);
    const app = await mountImport(manager);
    const email = 'auto-25932@acme.example.com';

    const row = await importOne(app, email, 'auto');

    expect(row.delivery).toBe('temporary');
    const password = String(row.temporaryPassword);
    expect(password).toHaveLength(24);
    const res = await signIn(manager, email, password);
    expect(res.status, await res.clone().text()).toBe(200);
  });

  it('③ the default range: still 16 characters', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const manager = await bootManager({});
    const app = await mountImport(manager);

    const row = await importOne(app, 'default-25932@acme.example.com', 'temporary');

    expect(String(row.temporaryPassword)).toHaveLength(16);
  });

  it('④ a maximum below 16 caps the length at that maximum', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const manager = await bootManager({ maxPasswordLength: 14 });
    const app = await mountImport(manager);
    const email = 'capped-25932@acme.example.com';

    const row = await importOne(app, email, 'temporary');

    const password = String(row.temporaryPassword);
    expect(password).toHaveLength(14);
    const res = await signIn(manager, email, password);
    expect(res.status, await res.clone().text()).toBe(200);
  });
});
