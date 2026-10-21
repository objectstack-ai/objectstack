// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#24773] The Console's Application Type reaches the OAuth provider as the
 * OIDC `application_type` the provider judges and stores.
 *
 * The defect, measured against the installed `@better-auth/oauth-provider`:
 * `POST /api/v1/auth/sys-oauth-application/register` forwarded the form's
 * choice as `type`. The provider's `/oauth2/create-client` body declares
 * `application_type` (`web` | `native`) and no `type`, so the member was
 * stripped and every registration was judged and stored as `web`. A `native`
 * client could not register the RFC 8252 loopback redirect URI the provider
 * grants native clients, and its row read `web`.
 *
 * What the door does now:
 *  - `web` and `native` are forwarded as `application_type`, and the
 *    provider's own rule applies unchanged: `web` needs https on a non-loopback
 *    host; `native` may use http only on exactly `localhost`, `127.0.0.1` or
 *    `[::1]`. Nothing in the door re-judges a URI.
 *  - Any other value (the form's `user-agent-based` and `public`, which have no
 *    `application_type`, or anything else) keeps the outcome it always had:
 *    registered, judged and stored as `web`. It is NOT refused — that would
 *    narrow what the door accepts — and the server logs exactly ONE warning
 *    per registration, naming the value.
 *  - No type at all is the provider's default, `web`, with no warning.
 *
 * Driven against REAL better-auth (OIDC provider on) behind the plugin's REAL
 * route registration on a real Hono app, over a REAL ObjectQL engine on SQLite
 * with the auth manifest's own objects. "Stored as" is read from the
 * `sys_oauth_application.type` column at driver level (the column the
 * provider's `applicationType` maps onto), never from the provider's answer.
 */

import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { Hono } from 'hono';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { envelopeViolations } from '@objectstack/spec/api';
import type { PluginContext } from '@objectstack/core';
import { AuthManager } from './auth-manager';
import { AuthPlugin } from './auth-plugin';
import { authIdentityObjects } from './manifest';

const SECRET = 'test-secret-at-least-32-chars-long-24773';
const PASSWORD = 'S3cure!Passw0rd-24773-type';
const EMAIL = 'owner.type.24773@example.com';
const ORIGIN = 'http://localhost:3000';
const BASE = '/api/v1/auth';
const DOOR = '/sys-oauth-application/register';
const CLIENTS = 'sys_oauth_application';

const LOOPBACK = 'http://localhost:4001/callback';
const LOOPBACK_IP = 'http://127.0.0.1:4001/callback';
const PLAIN_HTTP = 'http://app.example.com/callback';
const HTTPS = 'https://app.example.com/callback';

/**
 * The three authorization objects a real sign-in makes core's
 * `resolveUserAuthzGrants` read, which the auth manifest does not declare —
 * spelled locally with only the columns the resolver reads, as
 * `account-issuer-upgrade-path.test.ts` does, so the sign-in below exercises
 * its resolver leg instead of reading missing tables.
 */
const AUTHZ_OBJECTS = [
  {
    name: 'sys_user_position',
    label: 'User Position',
    fields: {
      id: { name: 'id', type: 'text' as const, primaryKey: true },
      user_id: { name: 'user_id', type: 'text' as const },
      position: { name: 'position', type: 'text' as const },
      organization_id: { name: 'organization_id', type: 'text' as const },
    },
  },
  {
    name: 'sys_user_permission_set',
    label: 'User Permission Set',
    fields: {
      id: { name: 'id', type: 'text' as const, primaryKey: true },
      user_id: { name: 'user_id', type: 'text' as const },
      permission_set_id: { name: 'permission_set_id', type: 'text' as const },
      organization_id: { name: 'organization_id', type: 'text' as const },
    },
  },
  {
    name: 'sys_position',
    label: 'Position',
    fields: {
      id: { name: 'id', type: 'text' as const, primaryKey: true },
      name: { name: 'name', type: 'text' as const },
      label: { name: 'label', type: 'text' as const },
      active: { name: 'active', type: 'boolean' as const },
      organization_id: { name: 'organization_id', type: 'text' as const },
    },
  },
];

const warn = vi.fn();
const mockCtx = (): PluginContext =>
  ({
    registerService: vi.fn(),
    getService: vi.fn((name: string) => (name === 'manifest' ? { register: vi.fn() } : undefined)),
    getServices: vi.fn(() => new Map()),
    hook: vi.fn(),
    trigger: vi.fn(),
    logger: { info: vi.fn(), error: vi.fn(), warn, debug: vi.fn() },
    getKernel: vi.fn(),
  }) as unknown as PluginContext;

let engine: ObjectQL;
let manager: AuthManager;
let app: Hono;
let cookie: string;

type Row = Record<string, unknown>;

/** Every stored client, read at DRIVER level — below every engine read mask. */
async function storedClients(): Promise<Row[]> {
  const driver = (
    engine as unknown as { getDriver(o: string): { find(o: string, q: unknown): Promise<unknown> } }
  ).getDriver(CLIENTS);
  const found = await driver.find(CLIENTS, { where: {} });
  return (Array.isArray(found) ? found : [found]).filter(Boolean) as Row[];
}

async function storedClient(clientId: unknown): Promise<Row> {
  const rows = (await storedClients()).filter((row) => row.client_id === clientId);
  expect(rows, `exactly one stored row for client ${String(clientId)}`).toHaveLength(1);
  return rows[0];
}

type Answer = {
  success: boolean;
  data?: { client?: { client_id?: unknown; application_type?: unknown } };
  error?: { code: string; message: string; details?: { upstreamError?: string } };
};

/**
 * One registration through the door. Returns the answer and the warnings the
 * plugin logged while serving THIS request (the mock is cleared first).
 */
async function register(body: Record<string, unknown>) {
  warn.mockClear();
  const res = await app.request(`${ORIGIN}${BASE}${DOOR}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: ORIGIN, cookie },
    body: JSON.stringify(body),
  });
  const json = (await res.json()) as Answer;
  return { status: res.status, body: json, warnings: [...warn.mock.calls] };
}

/** Accepted: 200, a minted client, its row stored with `type`. */
async function expectStoredAs(answer: Awaited<ReturnType<typeof register>>, storedType: 'web' | 'native') {
  expect(answer.status, JSON.stringify(answer.body)).toBe(200);
  expect(envelopeViolations(answer.body)).toEqual([]);
  expect(answer.body.success).toBe(true);
  const clientId = answer.body.data?.client?.client_id;
  expect(typeof clientId).toBe('string');
  const row = await storedClient(clientId);
  expect(row.type, `stored row: ${JSON.stringify(row)}`).toBe(storedType);
  return row;
}

/**
 * Refused by the provider: ADR-0112 `code` + `status`, nothing stored. A
 * refusal from the provider's redirect-URI rule names `invalid_redirect_uri`
 * in `details`; one from its body schema (a numeric-status `ValidationError`)
 * carries no upstream discriminator.
 */
async function expectRefused(
  answer: Awaited<ReturnType<typeof register>>,
  rowsBefore: number,
  refusedBy: 'redirect-uri-rule' | 'body-schema' = 'redirect-uri-rule',
) {
  expect(answer.status, JSON.stringify(answer.body)).toBe(400);
  expect(envelopeViolations(answer.body)).toEqual([]);
  expect(answer.body.success).toBe(false);
  expect(answer.body.error?.code).toBe('OAUTH_REGISTER_FAILED');
  expect(answer.body.error?.details?.upstreamError).toBe(
    refusedBy === 'redirect-uri-rule' ? 'invalid_redirect_uri' : undefined,
  );
  expect((await storedClients()).length, 'a refused registration wrote a client row').toBe(rowsBefore);
}

beforeAll(async () => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});

  engine = new ObjectQL();
  engine.registerDriver(
    new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true }),
    true,
  );
  await engine.init();
  for (const object of authIdentityObjects) {
    engine.registry.registerObject(object as never, '@objectstack/plugin-auth');
  }
  for (const object of AUTHZ_OBJECTS) {
    engine.registry.registerObject(object as never, '@objectstack/plugin-security');
  }
  await engine.syncSchemas();

  manager = new AuthManager({
    secret: SECRET,
    baseUrl: ORIGIN,
    dataEngine: engine as never,
    plugins: { oidcProvider: true },
  } as unknown as ConstructorParameters<typeof AuthManager>[0]);

  const direct = (path: string, body: unknown) =>
    manager.handleRequest(
      new Request(`${ORIGIN}${BASE}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', origin: ORIGIN },
        body: JSON.stringify(body),
      }),
    );
  const signUp = await direct('/sign-up/email', { email: EMAIL, password: PASSWORD, name: 'Client Owner' });
  expect(signUp.status, `sign-up: ${await signUp.clone().text()}`).toBe(200);
  const signIn = await direct('/sign-in/email', { email: EMAIL, password: PASSWORD });
  expect(signIn.status, `sign-in: ${await signIn.clone().text()}`).toBe(200);
  const staged = signIn.headers.getSetCookie().find((c) => /(?:^|\.)session_token=/.test(c.split(';')[0]));
  if (!staged) throw new Error('sign-in staged no session cookie');
  cookie = staged.split(';')[0];

  app = new Hono();
  const ctx = mockCtx();
  const plugin = new AuthPlugin({ secret: SECRET });
  await plugin.init(ctx);
  (plugin as unknown as { authManager: AuthManager }).authManager = manager;
  (plugin as unknown as {
    registerAuthRoutes(server: unknown, ctx: PluginContext): void;
  }).registerAuthRoutes({ getRawApp: () => app, getPort: () => 0 }, ctx);
}, 60_000);

afterAll(async () => {
  vi.restoreAllMocks();
  await (engine as unknown as { destroy?(): Promise<void> })?.destroy?.();
});

describe('[#24773] precondition — the provider judges `application_type`, and strips `type`', () => {
  // Without these, a provider that started reading `type` (or stopped granting
  // native clients the loopback rule) would let the door pins below pass or
  // fail for a reason that is not the door.
  const createClient = async (body: Record<string, unknown>) => {
    const api = (await manager.getApi()) as unknown as { createOAuthClient(input: unknown): Promise<unknown> };
    return api
      .createOAuthClient({ body: { client_name: 'precondition', ...body }, headers: new Headers({ cookie }) })
      .then(
        (client) => ({ client: client as { client_id?: unknown }, refusal: undefined }),
        (e: unknown) => ({ client: undefined, refusal: e as { body?: { error?: unknown } } }),
      );
  };

  it('`type: "native"` is stripped: a loopback redirect URI is refused under the web rule', async () => {
    const { client, refusal } = await createClient({ type: 'native', redirect_uris: [LOOPBACK] });
    expect(client, 'the provider honoured `type` — the defect this file pins no longer exists as measured').toBeUndefined();
    expect(refusal?.body?.error).toBe('invalid_redirect_uri');
  });

  it('`application_type: "native"` is honoured: the same loopback URI is accepted and stored as native', async () => {
    const { client, refusal } = await createClient({ application_type: 'native', redirect_uris: [LOOPBACK] });
    expect(refusal, JSON.stringify(refusal?.body)).toBeUndefined();
    expect((await storedClient(client?.client_id)).type).toBe('native');
  });
});

describe('[#24773] web and native reach the provider as `application_type`', () => {
  it('web + http://localhost: refused by the provider\'s web rule — 400 OAUTH_REGISTER_FAILED, nothing stored, no warning', async () => {
    const before = (await storedClients()).length;
    const answer = await register({ name: 'Local Web', redirectURLs: LOOPBACK, type: 'web' });
    await expectRefused(answer, before);
    expect(answer.warnings).toEqual([]);
  });

  it.each([LOOPBACK, LOOPBACK_IP])('native + %s: accepted and stored as native, no warning', async (uri) => {
    const answer = await register({ name: 'Local Native', redirectURLs: uri, type: 'native' });
    await expectStoredAs(answer, 'native');
    expect(answer.warnings).toEqual([]);
  });

  it('native + plain http on a non-loopback host: refused (the provider\'s body schema) — 400, nothing stored', async () => {
    // The provider's `SafeUrlSchema` requires https except on loopback hosts,
    // for every application type, before its per-type rule runs.
    const before = (await storedClients()).length;
    const answer = await register({ name: 'Remote Native', redirectURLs: PLAIN_HTTP, type: 'native' });
    await expectRefused(answer, before, 'body-schema');
    expect(answer.warnings).toEqual([]);
  });

  it('native + http on a loopback-range host that is not exactly localhost / 127.0.0.1 / [::1]: refused by the provider\'s native rule', async () => {
    const before = (await storedClients()).length;
    const answer = await register({ name: 'Near Native', redirectURLs: 'http://127.0.0.2:4001/callback', type: 'native' });
    await expectRefused(answer, before);
    expect(answer.warnings).toEqual([]);
  });

  it('web + https on a non-loopback host: accepted and stored as web, no warning', async () => {
    const answer = await register({ name: 'Production', redirectURLs: HTTPS, type: 'web' });
    await expectStoredAs(answer, 'web');
    expect(answer.warnings).toEqual([]);
  });

  it('no type: the provider\'s default, web — stored as web, no warning', async () => {
    const answer = await register({ name: 'Untyped', redirectURLs: HTTPS });
    await expectStoredAs(answer, 'web');
    expect(answer.warnings).toEqual([]);
  });
});

describe('[#24773] a type the provider has no `application_type` for keeps today\'s outcome, with one warning', () => {
  const UNHONOURED = ['user-agent-based', 'public', 'spa'] as const;

  it.each(UNHONOURED)('%s + https: accepted and stored as web; exactly one warning naming the value', async (type) => {
    const answer = await register({ name: `Typed ${type}`, redirectURLs: HTTPS, type });
    const row = await expectStoredAs(answer, 'web');
    // The form's value is stored nowhere on the row, and no public client
    // (no secret) was issued for `public`.
    expect(Object.entries(row).filter(([, value]) => value === type)).toEqual([]);
    expect(row.public === true || row.public === 1, 'the door registered a public client').toBe(false);
    expect(row.token_endpoint_auth_method).not.toBe('none');
    expect(answer.warnings).toHaveLength(1);
    const [, meta] = answer.warnings[0] as [string, Record<string, unknown>];
    expect(meta).toEqual({ requestedType: type, registeredAs: 'web' });
  });

  it.each(UNHONOURED)('%s + http://localhost: judged as web — refused, nothing stored; exactly one warning', async (type) => {
    const before = (await storedClients()).length;
    const answer = await register({ name: `Local ${type}`, redirectURLs: LOOPBACK, type });
    await expectRefused(answer, before);
    expect(answer.warnings).toHaveLength(1);
  });
});
