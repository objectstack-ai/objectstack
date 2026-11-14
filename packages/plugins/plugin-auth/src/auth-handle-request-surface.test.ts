// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// `auth.handleRequest` answers the plugin's WHOLE auth surface (#32637): the
// route registration that fills the self-hosted mount runs once more, in
// `AuthPlugin.init()`, on a private per-kernel table bound to the manager. A
// host that forwards its auth path to the service — a multi-tenant host, the
// `@objectstack/hono` embed, the dispatcher's `/auth` domain — is answered
// exactly as the self-hosted mount answers, with the same mount-layer checks.
//
// Every composition below is the real one: `AuthPlugin.init()` on a mock
// kernel context whose `data` service is the in-memory engine, so the manager
// under test is the one `init()` built and bound, never a stand-in swapped in
// afterwards. `registerRoutes: false` is the per-environment kernel's shape: no
// HTTP server, nothing mounted, the service alone.
//
// ADR-0112 is `code` AND `status`; every refusal assertion carries both.

import { describe, it, expect, vi, beforeEach, afterEach, beforeAll, afterAll } from 'vitest';
import { Hono } from 'hono';
import type { PluginContext } from '@objectstack/core';
import { INTERNAL_ERROR_MESSAGE } from '@objectstack/types';
import { AuthManager } from './auth-manager';
import { AuthPlugin } from './auth-plugin';
import { AUTH_ROUTE_LEDGER } from './auth-route-ledger';
import { ONE_TIME_TOKEN_HANDOFF_PATH, s256Challenge } from './one-time-token-handoff';
import { createMemoryEngine } from './impersonation-bearer-rotation.test';
import { inviteForAudienceGate } from './audience-gate-test-support';
import { memoizeScrypt } from './__tests__/scrypt-memo.testkit';

const SECRET = 'test-secret-at-least-32-chars-long!!';
const PASSWORD = 'S3cure!Passw0rd-32637';
const ORIGIN = 'http://localhost:3000';
const BASE = '/api/v1/auth';
const ADMIN_EMAIL = 'admin.32637@example.com';

/** Documentation ranges (RFC 5737): one allowed, one not, one private proxy hop. */
const RANGE = '203.0.113.0/24';
const INSIDE = '203.0.113.7';
const OUTSIDE = '198.51.100.9';
const PROXY_HOP = '10.0.0.2';

const APP_SCHEME = 'com.example.surface';

/**
 * The plugins the route ledger's conformance suite enumerates at (its maximal
 * surface), so every `requires` a ledger row names is switched on.
 */
const LEDGERED_PLUGINS = {
  organization: true,
  twoFactor: true,
  admin: true,
  oidcProvider: true,
  passkeys: true,
  magicLink: true,
  deviceAuthorization: true,
};

/** Env switches `buildPluginList` reads on top of the config; cleared so the surface is the config's. */
const ENV_KEYS = [
  'OS_SSO_ENABLED', 'OS_SSO_DOMAIN_VERIFICATION', 'OS_SCIM_ENABLED',
  'OS_AUTH_TWO_FACTOR', 'OS_AUTH_PASSWORD_REJECT_BREACHED',
  'OS_OIDC_PROVIDER_ENABLED', 'OS_MCP_SERVER_ENABLED',
];
const savedEnv: Record<string, string | undefined> = {};
beforeAll(() => {
  for (const key of ENV_KEYS) {
    savedEnv[key] = process.env[key];
    delete process.env[key];
  }
});
afterAll(() => {
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
});

const scrypt = memoizeScrypt();
afterAll(scrypt.restore);

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
});

type Logger = { info: ReturnType<typeof vi.fn>; warn: ReturnType<typeof vi.fn>; error: ReturnType<typeof vi.fn>; debug: ReturnType<typeof vi.fn> };

interface Composition {
  plugin: AuthPlugin;
  manager: AuthManager;
  ctx: PluginContext & { logger: Logger };
  engine: ReturnType<typeof createMemoryEngine>;
}

/** `AuthPlugin.init()` on the in-memory engine: the manager is the one `init()` built and bound. */
async function compose(options: Record<string, unknown> = {}): Promise<Composition> {
  const engine = createMemoryEngine();
  const ctx = {
    registerService: vi.fn(),
    getService: vi.fn((name: string) => {
      if (name === 'data') return engine;
      if (name === 'manifest') return { register: vi.fn() };
      return undefined;
    }),
    getServices: vi.fn(() => new Map()),
    hook: vi.fn(),
    trigger: vi.fn(),
    logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
    getKernel: vi.fn(),
  } as unknown as PluginContext & { logger: Logger };
  const plugin = new AuthPlugin({ secret: SECRET, baseUrl: ORIGIN, registerRoutes: false, ...options } as never);
  await plugin.init(ctx);
  const registered = (ctx.registerService as ReturnType<typeof vi.fn>).mock.calls.find(([name]) => name === 'auth');
  const manager = registered?.[1] as AuthManager;
  expect(manager, 'init() registered the auth service').toBeInstanceOf(AuthManager);
  return { plugin, manager, ctx, engine };
}

/** One request at `path` under the auth base. */
const at = (path: string, init: RequestInit = {}) => new Request(`${ORIGIN}${BASE}${path}`, init);

const postJson = (path: string, body: unknown, headers: Record<string, string> = {}) =>
  at(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: ORIGIN, ...headers },
    body: JSON.stringify(body),
  });

/** Status + the error code the body carries (ADR-0112 nests it under `error`). */
async function verdict(res: Response): Promise<{ status: number; code?: string }> {
  const text = await res.text();
  let code: string | undefined;
  try {
    const parsed = JSON.parse(text);
    code = parsed?.error?.code ?? parsed?.code;
  } catch {
    /* non-JSON body: no code */
  }
  return { status: res.status, code };
}

/** What better-auth answers for a path its router does not serve: the disclaiming 404. */
async function vendorDisclaimer(manager: AuthManager): Promise<{ status: number; body: string }> {
  const res = await manager.handleVendorRequest(at('/__no_such_route_32637__'));
  return { status: res.status, body: await res.text() };
}

/** A platform admin's bearer, signed up and in through `handleRequest` itself. */
async function adminBearer({ manager, engine }: Composition): Promise<string> {
  const invitationId = await inviteForAudienceGate(manager, ADMIN_EMAIL);
  const signUp = await manager.handleRequest(
    postJson('/sign-up/email', { email: ADMIN_EMAIL, password: PASSWORD, name: 'Platform Admin', invitationId }),
  );
  expect(signUp.status, `sign-up: ${await signUp.clone().text()}`).toBe(200);
  const users = (engine.tables.get('sys_user') ?? []) as any[];
  // The legacy scalar `isPlatformAdminUser` accepts — `gateAdmin` admits.
  users.find((r) => r.email === ADMIN_EMAIL)!.role = 'admin';
  const signIn = await manager.handleRequest(postJson('/sign-in/email', { email: ADMIN_EMAIL, password: PASSWORD }));
  const token = signIn.headers.get('set-auth-token');
  expect(token, `sign-in: ${await signIn.clone().text()}`).toBeTruthy();
  return token!;
}

/** Every `(method, path)` the table registered, in registration order. */
const routeList = (app: Hono) => app.routes.map((route) => `${route.method} ${route.path}`);

describe('auth.handleRequest — every objectstack-mounted ledger row is answered, not disclaimed', () => {
  // Derived from the ledger: a route added to it later is covered with no edit here.
  const OBJECTSTACK_ROWS = AUTH_ROUTE_LEDGER.filter((row) => row.source === 'objectstack');

  let composition: Composition;
  let disclaimer: { status: number; body: string };
  beforeAll(async () => {
    composition = await compose({ plugins: LEDGERED_PLUGINS, trustedAppSchemes: [APP_SCHEME] });
    disclaimer = await vendorDisclaimer(composition.manager);
  });

  it('reads a non-trivial population off the ledger', () => {
    expect(OBJECTSTACK_ROWS.length).toBeGreaterThanOrEqual(42);
    expect(disclaimer.status).toBe(404);
  });

  it.each(OBJECTSTACK_ROWS.map((row) => [row.route] as const))('%s', async (route) => {
    const [method, wire] = route.split(' ');
    expect(wire.startsWith(BASE), `${route} is under ${BASE}`).toBe(true);
    const path = wire.slice(BASE.length);
    const request = () =>
      method === 'GET' ? at(path, { method: 'GET', headers: { origin: ORIGIN } }) : postJson(path, {});

    // Control: better-auth alone disclaims the route (the conformance pin's
    // own claim), so an answer that equals its disclaimer means the route was
    // never reached.
    const vendor = await composition.manager.handleVendorRequest(request());
    expect({ status: vendor.status, body: await vendor.text() }, `${route}: better-auth disclaims it`).toEqual(disclaimer);

    const res = await composition.manager.handleRequest(request());
    const answered = { status: res.status, body: await res.text() };
    expect(answered, `${route} is answered through handleRequest, not disclaimed`).not.toEqual(disclaimer);
  });
});

describe('auth.handleRequest — the private table is the self-hosted registration', () => {
  it('registers the same routes, in the same order, as the host app except the root discovery documents', async () => {
    // The table `init()` built and bound, caught as the registration fills it.
    const mount = vi.spyOn(AuthPlugin.prototype as any, 'mountAuthRoutes');
    const { plugin, ctx } = await compose({ plugins: LEDGERED_PLUGINS, trustedAppSchemes: [APP_SCHEME] });
    const privateCalls = mount.mock.calls.filter((call) => call[2] === 'private');
    expect(privateCalls, 'init() fills one private table').toHaveLength(1);
    const privateTable = privateCalls[0][0] as Hono;
    const host = new Hono();
    (plugin as any).registerAuthRoutes({ getRawApp: () => host, getPort: () => 0 }, ctx);
    expect(mount.mock.calls.at(-1)?.[0], 'the host app is filled by the same registration').toBe(host);

    const hostRoutes = routeList(host);
    const discovery = hostRoutes.filter((r) => r.split(' ')[1].startsWith('/.well-known/'));
    // The exception is real: the host app carries discovery documents.
    expect(discovery.length).toBeGreaterThan(0);
    expect(routeList(privateTable)).toEqual(hostRoutes.filter((r) => !discovery.includes(r)));
    // Every route sits under the auth base: nothing is reachable through
    // handleRequest that the self-hosted mount does not serve.
    expect(routeList(privateTable).every((r) => r.split(' ')[1].startsWith(`${BASE}/`))).toBe(true);
  });

  it('says the start-up line once: the private table registers silently', async () => {
    const { plugin, ctx } = await compose();
    const said = () =>
      ctx.logger.info.mock.calls.filter(([line]) => String(line).startsWith('Auth routes registered: All requests under')).length;
    expect(said(), 'init() built the private table and said nothing').toBe(0);
    (plugin as any).registerAuthRoutes({ getRawApp: () => new Hono(), getPort: () => 0 }, ctx);
    expect(said()).toBe(1);
  });
});

describe('auth.handleRequest — an exception reaches the caller as a rejection', () => {
  it('a throwing vendor entry makes handleRequest reject, the private catch-all and error handler swallowing nothing', async () => {
    const { manager } = await compose();
    vi.spyOn(manager, 'handleVendorRequest').mockRejectedValue(new Error('vendor fault 32637'));
    await expect(manager.handleRequest(at('/get-session'))).rejects.toThrow('vendor fault 32637');
  });

  it('a vendor entry that throws synchronously is a rejection too', async () => {
    const { manager } = await compose();
    vi.spyOn(manager, 'handleVendorRequest').mockImplementation(() => {
      throw new Error('sync vendor fault 32637');
    });
    await expect(manager.handleRequest(at('/get-session'))).rejects.toThrow('sync vendor fault 32637');
  });

  it('the host table answers the same fault with a generic message and logs the error', async () => {
    const { plugin, manager, ctx } = await compose();
    const host = new Hono();
    (plugin as any).registerAuthRoutes({ getRawApp: () => host, getPort: () => 0 }, ctx);
    vi.spyOn(manager, 'handleVendorRequest').mockRejectedValue(new Error('vendor fault 32637'));
    const res = await host.request(at('/get-session'));
    expect(res.status).toBe(500);
    const text = await res.text();
    expect(JSON.parse(text)).toEqual({ success: false, error: INTERNAL_ERROR_MESSAGE });
    expect(text).not.toContain('vendor fault 32637');
    expect(ctx.logger.error).toHaveBeenCalledWith('Auth request error:', expect.objectContaining({ message: 'vendor fault 32637' }));
  });

  it('a route answering its own fault names no exception text, and logs the error', async () => {
    const { manager, ctx } = await compose();
    vi.spyOn(manager, 'getPublicConfig').mockImplementation(() => {
      throw new Error('config fault 32637');
    });
    const res = await manager.handleRequest(at('/config'));
    const text = await res.text();
    expect({ status: res.status, code: JSON.parse(text).error?.code }).toEqual({ status: 500, code: 'AUTH_CONFIG_ERROR' });
    expect(JSON.parse(text).error.message).toBe(INTERNAL_ERROR_MESSAGE);
    expect(text).not.toContain('config fault 32637');
    expect(ctx.logger.error).toHaveBeenCalledWith('[AuthPlugin] config failed', expect.objectContaining({ message: 'config fault 32637' }));
  });
});

describe('auth.handleRequest — the transport peer reaches the mount-layer checks', () => {
  const ADMITTED = { status: 401, code: 'UNAUTHENTICATED' };
  const REFUSED = { status: 403, code: 'IP_NOT_ALLOWED' };

  it('hands the transport its caller passed to the vendor entry', async () => {
    const { manager } = await compose();
    const vendor = vi.spyOn(manager, 'handleVendorRequest');
    await manager.handleRequest(at('/get-session'), { remoteAddress: INSIDE });
    expect(vendor).toHaveBeenCalledTimes(1);
    expect(vendor.mock.calls[0][1]).toEqual({ remoteAddress: INSIDE });
  });

  it('judges the allow-list by the peer it is handed when no proxy is trusted', async () => {
    const { manager } = await compose({ allowedIpRanges: [RANGE] });
    expect(await verdict(await manager.handleRequest(at('/get-session'), { remoteAddress: INSIDE }))).toEqual(ADMITTED);
    expect(await verdict(await manager.handleRequest(at('/get-session'), { remoteAddress: OUTSIDE }))).toEqual(REFUSED);
    // No peer and no trusted header: the address cannot be established, which
    // is refused while ranges are set.
    expect(await verdict(await manager.handleRequest(at('/get-session')))).toEqual(REFUSED);
  });

  it('with trustProxy, refuses a forwarded address outside the ranges and exempts /config', async () => {
    const { manager } = await compose({ allowedIpRanges: [RANGE], trustProxy: true });
    const forwardedFrom = (address: string, path = '/get-session') =>
      manager.handleRequest(at(path, { headers: { 'x-forwarded-for': address } }), { remoteAddress: PROXY_HOP });
    expect(await verdict(await forwardedFrom(OUTSIDE))).toEqual(REFUSED);
    expect(await verdict(await forwardedFrom(INSIDE))).toEqual(ADMITTED);
    const config = await forwardedFrom(OUTSIDE, '/config');
    expect(config.status).toBe(200);
    expect(((await config.json()) as any).success).toBe(true);
  });
});

describe('auth.handleRequest — fallbacks, and what ownsRoute counts', () => {
  it('a manager with no bound table answers through the vendor entry', async () => {
    const manager = new AuthManager({ secret: SECRET, baseUrl: ORIGIN, dataEngine: createMemoryEngine() } as never);
    const vendor = vi.spyOn(manager, 'handleVendorRequest');
    const request = at('/config');
    const transport = { remoteAddress: INSIDE };
    await manager.handleRequest(request, transport);
    expect(vendor).toHaveBeenCalledWith(request, transport);
  });

  it.each([
    ['a path outside the auth base', `${ORIGIN}/api/v1/elsewhere`],
    ['the bare auth base', `${ORIGIN}${BASE}`],
  ])('%s goes to the vendor entry', async (_label, url) => {
    const { manager } = await compose();
    const vendor = vi.spyOn(manager, 'handleVendorRequest');
    const request = new Request(url);
    await manager.handleRequest(request);
    expect(vendor).toHaveBeenCalledWith(request, undefined);
  });

  it('an unknown path under the base is the vendor\'s own 404, never the table\'s plain-text one', async () => {
    const { manager } = await compose();
    const res = await manager.handleRequest(at('/__no_such_route_32637__'));
    const body = await res.text();
    expect({ status: res.status, body }).toEqual(await vendorDisclaimer(manager));
    // Hono's own not-found answer, which the private table would give if the
    // catch-all did not hand better-auth's back.
    expect(body).not.toBe('404 Not Found');
    expect(res.headers.get('content-type') ?? '').not.toContain('text/plain');
  });

  it('ownsRoute counts the table\'s routes by method AND path, and better-auth\'s as before', async () => {
    const { manager } = await compose();
    const owns = (method: string, path: string) => manager.ownsRoute(at(path, { method }));
    expect(await owns('POST', '/admin/sso/register')).toBe(true);
    expect(await owns('GET', '/config')).toBe(true);
    expect(await owns('HEAD', '/config')).toBe(true);
    expect(await owns('GET', '/admin/sso/register')).toBe(false);
    expect(await owns('GET', '/get-session')).toBe(true);
    expect(await owns('GET', '/__no_such_route_32637__')).toBe(false);
  });
});

describe('auth.handleRequest — bridges re-dispatch through the vendor entry', () => {
  let composition: Composition;
  let bearer: string;
  beforeAll(async () => {
    composition = await compose({ plugins: { admin: true, sso: true } });
    bearer = await adminBearer(composition);
  });

  it.each([
    // Reshape-and-re-dispatch: the bridge hands `/sso/register` to the vendor.
    ['POST /admin/sso/register', '/admin/sso/register', { providerId: 'credential', issuer: 'https://idp.example.com', domain: 'idp.example.com', clientId: 'c', clientSecret: 's' }, '/sso/register'],
    // Gate-then-delegate on the vendor's OWN path: through handleRequest it would answer itself.
    ['POST /admin/remove-user', '/admin/remove-user', { userId: 'usr_no_such_user_32637' }, '/admin/remove-user'],
  ])('%s with an admin session answers once, its inner route reaching better-auth', async (_label, path, body, inner) => {
    const { manager } = composition;
    const outer = vi.spyOn(manager, 'handleRequest');
    const vendor = vi.spyOn(manager, 'handleVendorRequest');
    const res = await manager.handleRequest(postJson(path, body, { authorization: `Bearer ${bearer}` }));
    // An answer, and not a server fault: the vendor's own refusal of the inner
    // request (an unknown user, a reserved provider id), never a disclaimer.
    const answered = { status: res.status, body: await res.text() };
    expect(answered.status, answered.body).toBeLessThan(500);
    expect(answered).not.toEqual(await vendorDisclaimer(manager));
    expect(outer).toHaveBeenCalledTimes(1);
    expect(vendor.mock.calls.map(([request]) => new URL(request.url).pathname)).toContain(`${BASE}${inner}`);
  });

  it('the mount-layer checks run once for a bridged request on the self-hosted mount', async () => {
    const { plugin, manager, ctx } = composition;
    const host = new Hono();
    (plugin as any).registerAuthRoutes({ getRawApp: () => host, getPort: () => 0 }, ctx);
    const gate = vi.spyOn(manager, 'isClientIpAllowed');
    const res = await host.request(
      postJson('/admin/sso/register', { providerId: 'credential', issuer: 'https://idp.example.com', domain: 'idp.example.com', clientId: 'c', clientSecret: 's' }, { authorization: `Bearer ${bearer}` }),
    );
    expect(res.status, await res.clone().text()).toBeLessThan(500);
    expect(gate).toHaveBeenCalledTimes(1);
  });

  it('and once through handleRequest', async () => {
    const { manager } = composition;
    const gate = vi.spyOn(manager, 'isClientIpAllowed');
    await manager.handleRequest(
      postJson('/admin/sso/register', { providerId: 'credential', issuer: 'https://idp.example.com', domain: 'idp.example.com', clientId: 'c', clientSecret: 's' }, { authorization: `Bearer ${bearer}` }),
    );
    expect(gate).toHaveBeenCalledTimes(1);
  });
});

describe('auth.handleRequest — the private table serves no sign-in page, and says so', () => {
  const NAVIGATION = {
    'sec-fetch-dest': 'document',
    'sec-fetch-mode': 'navigate',
    'sec-fetch-site': 'none',
    accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  };
  const query = new URLSearchParams({
    redirect_uri: `${APP_SCHEME}://auth/callback`,
    code_challenge: s256Challenge('Shell-made_code.verifier~0123456789abcdefghijklmnop'),
    code_challenge_method: 'S256',
  });

  it('answers a signed-out navigation 401 there, while the host app that serves the Console sends it to sign in', async () => {
    const { plugin, manager, ctx } = await compose({ trustedAppSchemes: [APP_SCHEME] });
    const host = new Hono();
    const consoleAsked = vi.fn();
    host.get('/_console/*', (c) => {
      consoleAsked();
      return c.html('<!doctype html><title>Console</title>');
    });
    (plugin as any).registerAuthRoutes({ getRawApp: () => host, getPort: () => 0 }, ctx);
    const path = `${ONE_TIME_TOKEN_HANDOFF_PATH}?${query}`;

    // The host app is asked whether it serves the sign-in page, and it does.
    expect((await host.request(at(path, { headers: NAVIGATION }))).status).toBe(302);
    expect(consoleAsked).toHaveBeenCalled();
    consoleAsked.mockClear();

    // The private table declares it serves none: nothing is asked, nothing reported.
    const res = await manager.handleRequest(at(path, { headers: NAVIGATION }));
    expect(res.status).toBe(401);
    expect(consoleAsked).not.toHaveBeenCalled();
    expect(
      ctx.logger.warn.mock.calls.some(([line]) => String(line).includes('does not serve a sign-in page')),
    ).toBe(false);
  });
});
