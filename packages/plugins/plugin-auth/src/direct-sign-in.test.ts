// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Direct sign-in (`direct-sign-in.ts`): the setting, the return path it keeps,
 * the provider it starts, and the start door as `AuthPlugin` mounts it.
 *
 * Three layers:
 *
 *  1. PURE — `resolveDirectSignIn`, `keptReturnPath`, `chooseDirectSignInProvider`.
 *  2. THE DOOR over a fake host — `runDirectSignIn`: its closed query set, what
 *     it hands the vendor's start, and where it lands when it cannot start.
 *  3. THE MOUNT — the REAL `registerAuthRoutes` on a REAL Hono app over a REAL
 *     `AuthManager` with a generic-OAuth provider (the platform identity
 *     provider's shape): the door answers 302 to the provider through the
 *     vendor's own start; with the setting off the path and `/auth/config` are
 *     what they are on `main`; and no API, `/mcp`, API-key or bearer request is
 *     ever redirected.
 *
 * The full round trip (start → identity provider → callback → the kept path)
 * is pinned in `implicit-account-linking.test.ts`, whose stubbed identity
 * provider and engine it shares.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import type { PluginContext } from '@objectstack/core';
import { AuthPlugin } from './auth-plugin';
import { AuthManager } from './auth-manager';
import {
  DIRECT_SIGN_IN_ENV,
  DIRECT_SIGN_IN_UNAVAILABLE,
  chooseDirectSignInProvider,
  keptReturnPath,
  resolveDirectSignIn,
  runDirectSignIn,
  type DirectSignInHost,
} from './direct-sign-in';
// better-auth's first module load is paid at module load, never inside a
// clocked case (AGENTS.md, Build & Test): `AuthManager` reaches these through
// a lazy `await import()`.
import 'better-auth';
import 'better-auth/api';
import 'better-auth/plugins';
import 'better-auth/plugins/generic-oauth';

const ORIGIN = 'http://localhost:3000';
const SECRET = 'test-secret-at-least-32-chars-long!!';
const IDP = 'https://idp.example.test';
const PLATFORM_IDP = 'objectstack-cloud';

/** Every open-redirect spelling the door must drop, never follow. */
const FOREIGN_RETURN_PATHS = [
  'https://evil.example/x',
  'http://evil.example',
  '//evil.example',
  '//evil.example/_console/login',
  '/\\evil.example',
  '\\\\evil.example',
  '/%5cevil.example',
  '/%5Cevil.example',
  '/%2f%2fevil.example',
  '/%2F%2Fevil.example',
  '/%252f%252fevil.example',
  'https%3A%2F%2Fevil.example',
  '%2F%2Fevil.example',
  'javascript:alert(1)',
  '/_console/\tlogin',
  '/_console/\nlogin',
  '/\t/evil.example',
  '/%09/evil.example',
  '/%0a/evil.example',
  '/%E0%A4%A',
  '',
  `/${'a'.repeat(2048)}`,
];

describe('resolveDirectSignIn: the setting in force', () => {
  it('is off when neither the option nor the environment sets it', () => {
    expect(resolveDirectSignIn(undefined, {})).toEqual({ enabled: false });
  });

  it('is on with the option, the local sign-in path hidden by default', () => {
    expect(resolveDirectSignIn({}, {})).toEqual({ enabled: true, localSignIn: 'hidden' });
    expect(resolveDirectSignIn({ provider: PLATFORM_IDP, localSignIn: 'off' }, {})).toEqual({
      enabled: true,
      provider: PLATFORM_IDP,
      localSignIn: 'off',
    });
  });

  it('lets the environment win field by field', () => {
    const env = {
      [DIRECT_SIGN_IN_ENV.enabled]: 'true',
      [DIRECT_SIGN_IN_ENV.provider]: 'corp-oidc',
      [DIRECT_SIGN_IN_ENV.localSignIn]: 'off',
    };
    expect(resolveDirectSignIn(undefined, env)).toEqual({ enabled: true, provider: 'corp-oidc', localSignIn: 'off' });
    expect(resolveDirectSignIn({ provider: PLATFORM_IDP }, { [DIRECT_SIGN_IN_ENV.enabled]: 'false' })).toEqual({
      enabled: false,
    });
    expect(resolveDirectSignIn({ provider: PLATFORM_IDP, localSignIn: 'hidden' }, env)).toEqual({
      enabled: true,
      provider: 'corp-oidc',
      localSignIn: 'off',
    });
  });

  it('refuses an off-vocabulary local sign-in path loudly, from the option or the environment', () => {
    expect(() => resolveDirectSignIn({ localSignIn: 'of' as never }, {})).toThrow(/OS_AUTH_LOCAL_SIGN_IN/);
    expect(() => resolveDirectSignIn(undefined, { [DIRECT_SIGN_IN_ENV.localSignIn]: 'none' })).toThrow(/hidden/);
  });
});

describe('keptReturnPath: only a same-origin path is kept', () => {
  it.each([
    '/_console/',
    '/_console/apps/crm/accounts?view=all',
    '/_console/login?redirect=%2Fapps%2Fcrm&direct=returned',
    '/_console/apps/crm#section-2',
  ])('keeps %s', (path) => {
    expect(keptReturnPath(path)).toBe(path);
  });

  it.each(FOREIGN_RETURN_PATHS)('drops %j', (path) => {
    expect(keptReturnPath(path)).toBeUndefined();
  });

  it('drops a value that is not a string', () => {
    expect(keptReturnPath(undefined)).toBeUndefined();
    expect(keptReturnPath(null)).toBeUndefined();
    expect(keptReturnPath(['/_console/'])).toBeUndefined();
  });
});

describe('chooseDirectSignInProvider: which identity provider a visit goes to', () => {
  it('starts a named oidcProviders entry through the OAuth start, and a named SSO row through the SSO start', () => {
    expect(chooseDirectSignInProvider({ provider: PLATFORM_IDP, oauthProviderIds: [PLATFORM_IDP], ssoProviderIds: [] })).toEqual({
      kind: 'oauth',
      providerId: PLATFORM_IDP,
    });
    expect(chooseDirectSignInProvider({ provider: 'acme', oauthProviderIds: [PLATFORM_IDP], ssoProviderIds: ['acme'] })).toEqual({
      kind: 'sso',
      providerId: 'acme',
    });
  });

  it('misses a named provider that is not configured', () => {
    expect(chooseDirectSignInProvider({ provider: 'nope', oauthProviderIds: [PLATFORM_IDP], ssoProviderIds: [] })).toEqual({
      miss: 'provider_not_found',
    });
  });

  it('unnamed: the one candidate, and no redirect for none or several', () => {
    expect(chooseDirectSignInProvider({ oauthProviderIds: [], ssoProviderIds: ['acme'] })).toEqual({ kind: 'sso', providerId: 'acme' });
    expect(chooseDirectSignInProvider({ oauthProviderIds: [], ssoProviderIds: [] })).toEqual({ miss: 'no_provider' });
    expect(chooseDirectSignInProvider({ oauthProviderIds: [PLATFORM_IDP], ssoProviderIds: ['acme'] })).toEqual({
      miss: 'several_providers',
    });
  });
});

// ── The door over a fake host ────────────────────────────────────────────────

const fakeHost = (overrides: Partial<DirectSignInHost> = {}) => {
  const dispatched: Array<{ url: string; body: any; headers: Headers }> = [];
  const host: DirectSignInHost = {
    setting: () => ({ enabled: true, provider: PLATFORM_IDP, localSignIn: 'hidden' }),
    chooseProvider: async () => ({ kind: 'oauth', providerId: PLATFORM_IDP }),
    origin: () => ORIGIN,
    consolePageUrl: (path) => `${ORIGIN}/_console${path}`,
    startUrl: (kind) => `${ORIGIN}/api/v1/auth${kind === 'oauth' ? '/sign-in/social' : '/sign-in/sso'}`,
    dispatch: async (request) => {
      dispatched.push({ url: request.url, body: await request.json(), headers: request.headers });
      return new Response(JSON.stringify({ url: `${IDP}/authorize?state=s1`, redirect: true }), {
        status: 200,
        headers: { 'content-type': 'application/json', 'set-cookie': 'state=abc; Path=/; HttpOnly' },
      });
    },
    logger: { warn: vi.fn(), debug: vi.fn() },
    ...overrides,
  };
  return { host, dispatched };
};

const door = (query: string, init?: RequestInit) =>
  new Request(`${ORIGIN}/api/v1/auth/sign-in/direct${query}`, init);

describe('runDirectSignIn: the start door', () => {
  it('answers 302 to the identity provider with the vendor state cookie, returning to the kept path', async () => {
    const { host, dispatched } = fakeHost();
    const res = await runDirectSignIn(door('?callbackURL=%2F_console%2Fapps%2Fcrm%3Fview%3Dall'), host);
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe(`${IDP}/authorize?state=s1`);
    expect(res.headers.getSetCookie()).toEqual(['state=abc; Path=/; HttpOnly']);
    expect(dispatched).toHaveLength(1);
    expect(dispatched[0].url).toBe(`${ORIGIN}/api/v1/auth/sign-in/social`);
    expect(dispatched[0].body).toEqual({
      provider: PLATFORM_IDP,
      callbackURL: `${ORIGIN}/_console/apps/crm?view=all`,
      errorCallbackURL: `${ORIGIN}/_console/login`,
      disableRedirect: true,
    });
    // The vendor's start reads and renews no session.
    expect(dispatched[0].headers.get('cookie')).toBeNull();
    expect(dispatched[0].headers.get('authorization')).toBeNull();
  });

  it('starts an SSO row through the SSO start with its providerId', async () => {
    const { host, dispatched } = fakeHost({ chooseProvider: async () => ({ kind: 'sso', providerId: 'acme' }) });
    const res = await runDirectSignIn(door('?callbackURL=%2F_console%2F'), host);
    expect(res.status).toBe(302);
    expect(dispatched[0].url).toBe(`${ORIGIN}/api/v1/auth/sign-in/sso`);
    expect(dispatched[0].body).toEqual({
      providerId: 'acme',
      callbackURL: `${ORIGIN}/_console/`,
      errorCallbackURL: `${ORIGIN}/_console/login`,
    });
  });

  it.each(FOREIGN_RETURN_PATHS)('drops the foreign return path %j and returns to the Console root', async (path) => {
    const { host, dispatched } = fakeHost();
    const res = await runDirectSignIn(door(`?callbackURL=${encodeURIComponent(path)}`), host);
    expect(res.status).toBe(302);
    expect(dispatched[0].body.callbackURL).toBe(`${ORIGIN}/_console/`);
    expect(dispatched[0].body.callbackURL).not.toContain('evil');
  });

  it('returns to the Console root when no return path is sent', async () => {
    const { host, dispatched } = fakeHost();
    await runDirectSignIn(door(''), host);
    expect(dispatched[0].body.callbackURL).toBe(`${ORIGIN}/_console/`);
  });

  it('refuses an unknown query parameter and a repeated callbackURL with 400, starting nothing', async () => {
    for (const query of ['?returnTo=%2F', '?callbackURL=%2F&callbackURL=%2Fx', '?callbackURL=%2F&next=%2F']) {
      const { host, dispatched } = fakeHost();
      const res = await runDirectSignIn(door(query), host);
      expect(res.status).toBe(400);
      expect((await res.json()).error.code).toBe('VALIDATION_ERROR');
      expect(dispatched).toHaveLength(0);
    }
  });

  it('lands on the sign-in page with an error, never a retry, when no provider resolves or the start is refused', async () => {
    const cases: Array<Partial<DirectSignInHost>> = [
      { chooseProvider: async () => ({ miss: 'several_providers' }) },
      { chooseProvider: async () => ({ miss: 'no_provider' }) },
      { dispatch: async () => new Response('{"message":"refused"}', { status: 400 }) },
      { dispatch: async () => new Response(JSON.stringify({ url: 'javascript:alert(1)' }), { status: 200 }) },
      { dispatch: async () => { throw new Error('vendor down'); } },
    ];
    for (const overrides of cases) {
      const { host } = fakeHost(overrides);
      const res = await runDirectSignIn(door('?callbackURL=%2F_console%2F'), host);
      expect(res.status).toBe(302);
      expect(res.headers.get('location')).toBe(`${ORIGIN}/_console/login?error=${DIRECT_SIGN_IN_UNAVAILABLE}`);
      expect(host.logger!.warn).toHaveBeenCalledTimes(1);
    }
  });

  it('answers 404 with the setting off', async () => {
    const { host, dispatched } = fakeHost({ setting: () => ({ enabled: false }) });
    const res = await runDirectSignIn(door('?callbackURL=%2F'), host);
    expect(res.status).toBe(404);
    expect(dispatched).toHaveLength(0);
  });
});

// ── The mount ────────────────────────────────────────────────────────────────

const savedEnv: Record<string, string | undefined> = {};
beforeEach(() => {
  for (const name of Object.values(DIRECT_SIGN_IN_ENV)) {
    savedEnv[name] = process.env[name];
    delete process.env[name];
  }
});
afterEach(() => {
  for (const [name, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

function mount(directSignIn?: { provider?: string; localSignIn?: 'hidden' | 'off' }) {
  const app = new Hono();
  const ctx = {
    registerService: vi.fn(),
    getService: vi.fn(),
    getServices: vi.fn(() => new Map()),
    hook: vi.fn(),
    trigger: vi.fn(),
    logger: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() },
    getKernel: vi.fn(),
  } as unknown as PluginContext;
  const options = {
    secret: SECRET,
    baseUrl: ORIGIN,
    oidcProviders: [
      {
        providerId: PLATFORM_IDP,
        clientId: `${PLATFORM_IDP}-client`,
        clientSecret: `${PLATFORM_IDP}-secret`,
        authorizationUrl: `${IDP}/${PLATFORM_IDP}/authorize`,
        tokenUrl: `${IDP}/${PLATFORM_IDP}/token`,
        userInfoUrl: `${IDP}/${PLATFORM_IDP}/userinfo`,
        pkce: false,
      },
    ],
    ...(directSignIn ? { directSignIn } : {}),
  };
  const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  const plugin = new AuthPlugin(options as any);
  (plugin as any).authManager = new AuthManager(options as any);
  warnSpy.mockRestore();
  (plugin as any).registerAuthRoutes({ getRawApp: () => app, getPort: () => 0 }, ctx);
  // What a composition mounts beside the auth routes: the API and `/mcp`
  // answer 401 to an anonymous caller.
  app.all('/api/v1/data/*', (c) => c.json({ success: false, error: { code: 'UNAUTHORIZED' } }, 401));
  app.all('/mcp', (c) => c.json({ success: false, error: { code: 'UNAUTHORIZED' } }, 401));
  return { app };
}

const config = async (app: Hono) => {
  const res = await app.request(`${ORIGIN}/api/v1/auth/config`);
  expect(res.status).toBe(200);
  return (await res.json()).data;
};

describe('the mounted start door (setting on)', () => {
  it('answers 302 to the platform identity provider with state, and /auth/config advertises it', async () => {
    const { app } = mount({ provider: PLATFORM_IDP });
    const res = await app.request(
      `${ORIGIN}/api/v1/auth/sign-in/direct?callbackURL=${encodeURIComponent('/_console/login?redirect=%2Fapps%2Fcrm&direct=returned')}`,
    );
    expect(res.status).toBe(302);
    const location = new URL(res.headers.get('location')!);
    expect(`${location.origin}${location.pathname}`).toBe(`${IDP}/${PLATFORM_IDP}/authorize`);
    expect(location.searchParams.get('state')).toBeTruthy();
    expect(location.searchParams.get('client_id')).toBe(`${PLATFORM_IDP}-client`);
    expect(res.headers.getSetCookie().length).toBeGreaterThan(0);

    const data = await config(app);
    expect(data.features.directSignIn).toBe(true);
    expect(data.features.localSignIn).toBe('hidden');
  });

  it('advertises false when the named provider is not configured, and the door lands on the sign-in page', async () => {
    const { app } = mount({ provider: 'not-configured' });
    expect((await config(app)).features.directSignIn).toBe(false);
    const res = await app.request(`${ORIGIN}/api/v1/auth/sign-in/direct`);
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe(`${ORIGIN}/_console/login?error=${DIRECT_SIGN_IN_UNAVAILABLE}`);
  });

  it('serves localSignIn off when the deployment closes the local path', async () => {
    const { app } = mount({ provider: PLATFORM_IDP, localSignIn: 'off' });
    expect((await config(app)).features.localSignIn).toBe('off');
  });

  it('CONTROL: the API, /mcp, API-key and bearer requests are never redirected', async () => {
    const { app } = mount({ provider: PLATFORM_IDP });
    const requests: Array<[string, Record<string, string>]> = [
      ['/api/v1/data/account', {}],
      ['/api/v1/data/account', { authorization: 'Bearer not-a-session' }],
      ['/api/v1/data/account', { 'x-api-key': 'osk_not_a_key' }],
      ['/mcp', {}],
      ['/mcp', { authorization: 'Bearer not-a-token' }],
      ['/api/v1/auth/get-session', { authorization: 'Bearer not-a-session' }],
    ];
    for (const [path, headers] of requests) {
      const res = await app.request(`${ORIGIN}${path}`, { headers });
      expect(res.status, path).not.toBe(302);
      expect(res.headers.get('location'), path).toBeNull();
    }
  });
});

describe('CONTROL: with the setting off, the door and /auth/config are what they are on main', () => {
  it('does not mount the door: the path answers what an unclaimed auth path answers', async () => {
    const off = mount();
    const res = await off.app.request(`${ORIGIN}/api/v1/auth/sign-in/direct?callbackURL=%2F`);
    const unclaimed = await off.app.request(`${ORIGIN}/api/v1/auth/sign-in/not-a-door?callbackURL=%2F`);
    expect(res.status).toBe(404);
    expect(res.status).toBe(unclaimed.status);
    expect(await res.text()).toBe(await unclaimed.text());
    expect(res.headers.get('location')).toBeNull();
  });

  it('serves directSignIn false and no localSignIn; every other key is unchanged by the option', async () => {
    const off = await config(mount().app);
    expect(off.features.directSignIn).toBe(false);
    expect('localSignIn' in off.features).toBe(false);
    const on = await config(mount({ provider: PLATFORM_IDP }).app);
    const strip = (data: any) => {
      const { directSignIn: _d, localSignIn: _l, ...features } = data.features;
      return { ...data, features };
    };
    expect(strip(on)).toEqual(strip(off));
  });

  it('the environment turns it off over the option', async () => {
    process.env[DIRECT_SIGN_IN_ENV.enabled] = 'false';
    const { app } = mount({ provider: PLATFORM_IDP });
    expect((await config(app)).features.directSignIn).toBe(false);
    expect((await app.request(`${ORIGIN}/api/v1/auth/sign-in/direct`)).status).toBe(404);
  });
});
