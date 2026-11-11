// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `POST /oauth-consent/request` on the real plugin: a real `AuthManager`
 * (real better-auth carrying the real `@better-auth/oauth-provider`), the real
 * `AuthPlugin` route registration on a Hono app, clients registered through
 * the provider's own doors, and the signed request taken from the provider's
 * own `/oauth2/authorize` redirect to the consent page. The engine is the
 * shared in-memory one (`createMemoryEngine`).
 *
 * Pinned:
 *
 *  - the answer's `redirectUri` is the redirect of the signed request, and a
 *    request whose bytes differ from what the provider signed is refused;
 *  - only a client a platform administrator registered reads
 *    `registeredByAdministrator: true`: one registered with no credential
 *    through `/oauth2/register`, and one an account without platform-admin
 *    standing registered through the Setup create door, both read `false`;
 *  - the door needs a session, takes `oauth_query` only, and answers a client
 *    the provider does not serve `404`.
 */

import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from 'vitest';
import { Hono } from 'hono';
import { ADMIN_FULL_ACCESS } from '@objectstack/spec/identity';
import type { PluginContext } from '@objectstack/core';
import { AuthManager } from './auth-manager';
import { AuthPlugin } from './auth-plugin';
import { createMemoryEngine } from './impersonation-bearer-rotation.test';
import { inviteForAudienceGate } from './audience-gate-test-support';
import { memoizeScrypt } from './__tests__/scrypt-memo.testkit';
import {
  OAUTH_CONSENT_REQUEST_CLIENT_NOT_FOUND_MESSAGE,
  OAUTH_CONSENT_REQUEST_PATH,
  OAUTH_CONSENT_REQUEST_UNSIGNED_MESSAGE,
} from './oauth-consent-request';
import * as entry from './index';
import {
  oauthConsentRequestDepsFor,
  runOAuthConsentRequestRead,
  type OAuthConsentRequestManager,
  type OAuthConsentRequestResult,
} from './index';

const SECRET = 'test-secret-at-least-32-chars-long-consent-request';
const PASSWORD = 'S3cure!Passw0rd-consent-request';
const ORIGIN = 'http://localhost:3000';
const BASE = '/api/v1/auth';
const EMAIL = 'mia@consent-request.example.com';
const PS_ADMIN = 'ps_admin_full_access';

const DCR_REDIRECT = 'http://127.0.0.1:56789/callback';
const SETUP_REDIRECT = 'http://localhost:47011/oauth/done';
// RFC 7636 Appendix B challenge.
const PKCE_CHALLENGE = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';

const ENV_KEYS = ['OS_MCP_SERVER_ENABLED', 'OS_OIDC_PROVIDER_ENABLED', 'OS_OIDC_DCR_ENABLED'] as const;
const savedEnv: Record<string, string | undefined> = {};

const mockCtx = (): PluginContext =>
  ({
    registerService: vi.fn(),
    getService: vi.fn((name: string) => (name === 'manifest' ? { register: vi.fn() } : undefined)),
    getServices: vi.fn(() => new Map()),
    hook: vi.fn(),
    trigger: vi.fn(),
    logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
    getKernel: vi.fn(),
  }) as any;

const cookieFrom = (response: Response): string =>
  (response.headers.getSetCookie?.() ?? [response.headers.get('set-cookie') ?? ''])
    .map((c) => c.split(';')[0])
    .filter(Boolean)
    .join('; ');

const readJson = async (res: Response) => {
  const text = await res.text();
  return { status: res.status, body: JSON.parse(text) as any, cacheControl: res.headers.get('cache-control') };
};

/** ADR-0068 D2 standing, granted the way the platform grants it: the Default Organization's admin_full_access grant. */
const grantPlatformAdmin = async (engine: any, userId: string) => {
  let org = (engine.tables.get('sys_organization') ?? []).find((r: any) => r.slug === 'default');
  if (!org) {
    await engine.insert('sys_organization', { id: 'org_default', name: 'Default Organization', slug: 'default' });
    org = { id: 'org_default' };
  }
  if (!(engine.tables.get('sys_permission_set') ?? []).some((r: any) => r.id === PS_ADMIN)) {
    await engine.insert('sys_permission_set', { id: PS_ADMIN, name: ADMIN_FULL_ACCESS });
  }
  await engine.insert('sys_user_permission_set', {
    user_id: userId,
    permission_set_id: PS_ADMIN,
    permission_set: 'admin_full_access',
    organization_id: String(org.id),
  });
};

const arrange = async () => {
  const engine = createMemoryEngine();
  const manager = new AuthManager({ secret: SECRET, baseUrl: ORIGIN, dataEngine: engine } as any);

  const direct = (path: string, init: { method?: string; body?: unknown; cookie?: string } = {}) =>
    manager.handleRequest(
      new Request(`${ORIGIN}${BASE}${path}`, {
        method: init.method ?? 'POST',
        headers: {
          origin: ORIGIN,
          ...(init.body === undefined ? {} : { 'Content-Type': 'application/json' }),
          ...(init.cookie ? { cookie: init.cookie } : {}),
        },
        ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
      }),
    );

  const invitationId = await inviteForAudienceGate(manager, EMAIL);
  const signUp = await direct('/sign-up/email', { body: { email: EMAIL, password: PASSWORD, name: 'Mia', invitationId } });
  expect(signUp.status, `sign-up: ${await signUp.clone().text()}`).toBe(200);
  const signIn = await direct('/sign-in/email', { body: { email: EMAIL, password: PASSWORD } });
  expect(signIn.status, `sign-in: ${await signIn.clone().text()}`).toBe(200);
  const cookie = cookieFrom(signIn);

  const app = new Hono();
  const ctx = mockCtx();
  const plugin = new AuthPlugin({ secret: SECRET });
  await plugin.init(ctx);
  (plugin as any).authManager = manager;
  (plugin as any).registerAuthRoutes({ getRawApp: () => app, getPort: () => 0 }, ctx);

  const post = (path: string, body: unknown, opts: { cookie?: string; search?: string } = {}) =>
    app.request(`${ORIGIN}${BASE}${path}${opts.search ?? ''}`, {
      method: 'POST',
      headers: { origin: ORIGIN, 'content-type': 'application/json', ...(opts.cookie ? { cookie: opts.cookie } : {}) },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    });

  /** A client registered through `/oauth2/register` with no credential at all. */
  const registerWithoutCredential = async (): Promise<string> => {
    const res = await direct('/oauth2/register', {
      body: {
        client_name: 'Workspace Helper',
        redirect_uris: [DCR_REDIRECT],
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'],
        token_endpoint_auth_method: 'none',
      },
    });
    const body: any = await res.json();
    expect(res.status, JSON.stringify(body)).toBe(201);
    return String(body.client_id);
  };

  /** A client registered through the Setup create action's door, by the signed-in person. */
  const registerThroughSetup = async (): Promise<string> => {
    const res = await post(
      '/sys-oauth-application/register',
      { name: 'Team Notes', redirectURLs: SETUP_REDIRECT, type: 'native' },
      { cookie },
    );
    const body: any = await res.json();
    expect(res.status, JSON.stringify(body)).toBe(200);
    return String(body.data.client.client_id);
  };

  /** The signed query the provider's `/oauth2/authorize` hands the consent page. */
  const signedConsentQuery = async (clientId: string, redirectUri: string): Promise<string> => {
    const url = new URL(`${ORIGIN}${BASE}/oauth2/authorize`);
    url.searchParams.set('client_id', clientId);
    url.searchParams.set('redirect_uri', redirectUri);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('scope', 'openid profile');
    url.searchParams.set('state', 'st');
    url.searchParams.set('code_challenge', PKCE_CHALLENGE);
    url.searchParams.set('code_challenge_method', 'S256');
    const res = await manager.handleRequest(new Request(url.toString(), { method: 'GET', headers: { cookie } }));
    const location = res.headers.get('location') ?? '';
    expect(location, `expected a consent redirect, got ${res.status} ${location}`).toContain('/oauth/consent?');
    return location.slice(location.indexOf('?') + 1);
  };

  const clientRows = () => (engine.tables.get('sys_oauth_application') ?? []) as any[];

  /** Give the signed-in person platform-admin standing. */
  const makeSignedInPersonPlatformAdmin = async () => {
    const user = ((engine.tables.get('sys_user') ?? []) as any[]).find((r) => r.email === EMAIL);
    expect(user, 'the signed-in person\'s sys_user row').toBeTruthy();
    await grantPlatformAdmin(engine, String(user.id));
  };

  return {
    manager,
    cookie,
    post,
    registerWithoutCredential,
    registerThroughSetup,
    signedConsentQuery,
    clientRows,
    makeSignedInPersonPlatformAdmin,
  };
};

beforeEach(() => {
  for (const k of ENV_KEYS) {
    savedEnv[k] = process.env[k];
    delete process.env[k];
  }
  process.env.OS_MCP_SERVER_ENABLED = 'true';
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
});

const scrypt = memoizeScrypt();
afterAll(scrypt.restore);

describe('POST /oauth-consent/request — what the consent page names about the request', () => {
  it('answers the signed redirect, and a client registered dynamically with no credential as not registered by an administrator', async () => {
    const rig = await arrange();
    const clientId = await rig.registerWithoutCredential();
    const query = await rig.signedConsentQuery(clientId, DCR_REDIRECT);

    const answer = await readJson(await rig.post(OAUTH_CONSENT_REQUEST_PATH, { oauth_query: query }, { cookie: rig.cookie }));

    expect(answer.status, JSON.stringify(answer.body)).toBe(200);
    expect(answer.cacheControl).toBe('no-store');
    expect(answer.body).toEqual({
      success: true,
      data: { clientId, redirectUri: DCR_REDIRECT, registeredByAdministrator: false },
    });
  });

  it('reads a client a platform administrator registered through the Setup create door as registered by an administrator', async () => {
    const rig = await arrange();
    await rig.makeSignedInPersonPlatformAdmin();
    const clientId = await rig.registerThroughSetup();
    const query = await rig.signedConsentQuery(clientId, SETUP_REDIRECT);

    const answer = await readJson(await rig.post(OAUTH_CONSENT_REQUEST_PATH, { oauth_query: query }, { cookie: rig.cookie }));

    expect(answer.status, JSON.stringify(answer.body)).toBe(200);
    expect(answer.body.data).toEqual({ clientId, redirectUri: SETUP_REDIRECT, registeredByAdministrator: true });
  });

  it('reads a client an account without platform-admin standing registered as not registered by an administrator', async () => {
    const rig = await arrange();
    const clientId = await rig.registerThroughSetup();
    const row = rig.clientRows().find((r) => r.client_id === clientId);
    expect(row?.user_id, 'the self-service door stamps the registering account').toBeTruthy();
    const query = await rig.signedConsentQuery(clientId, SETUP_REDIRECT);

    const answer = await readJson(await rig.post(OAUTH_CONSENT_REQUEST_PATH, { oauth_query: query }, { cookie: rig.cookie }));

    expect(answer.status, JSON.stringify(answer.body)).toBe(200);
    expect(answer.body.data).toEqual({ clientId, redirectUri: SETUP_REDIRECT, registeredByAdministrator: false });
  });

  it('accepts the query with its leading question mark, as the page reads it from the address bar', async () => {
    const rig = await arrange();
    const clientId = await rig.registerWithoutCredential();
    const query = await rig.signedConsentQuery(clientId, DCR_REDIRECT);

    const answer = await readJson(await rig.post(OAUTH_CONSENT_REQUEST_PATH, { oauth_query: `?${query}` }, { cookie: rig.cookie }));

    expect(answer.status, JSON.stringify(answer.body)).toBe(200);
    expect(answer.body.data.redirectUri).toBe(DCR_REDIRECT);
  });

  it.each<[string, (query: string) => string]>([
    [
      'a redirect other than the one signed',
      (query) => {
        const params = new URLSearchParams(query);
        params.set('redirect_uri', 'https://elsewhere.example/cb');
        return params.toString();
      },
    ],
    ['a parameter added to the signed set', (query) => `${query}&redirect_uri=${encodeURIComponent('https://elsewhere.example/cb')}`],
    [
      'no signature',
      (query) => {
        const params = new URLSearchParams(query);
        params.delete('sig');
        return params.toString();
      },
    ],
  ])('refuses a request whose bytes are not the ones the provider signed: %s', async (_label, alter) => {
    const rig = await arrange();
    const clientId = await rig.registerWithoutCredential();
    const query = alter(await rig.signedConsentQuery(clientId, DCR_REDIRECT));

    const answer = await readJson(await rig.post(OAUTH_CONSENT_REQUEST_PATH, { oauth_query: query }, { cookie: rig.cookie }));

    expect(answer.status).toBe(400);
    expect(answer.body).toEqual({
      success: false,
      error: { code: 'VALIDATION_ERROR', message: OAUTH_CONSENT_REQUEST_UNSIGNED_MESSAGE },
    });
  });

  it('answers a client the provider no longer serves 404', async () => {
    const rig = await arrange();
    const clientId = await rig.registerWithoutCredential();
    const query = await rig.signedConsentQuery(clientId, DCR_REDIRECT);
    const row = rig.clientRows().find((r) => r.client_id === clientId);
    expect(row, 'the registered client row').toBeTruthy();
    row.disabled = true;

    const answer = await readJson(await rig.post(OAUTH_CONSENT_REQUEST_PATH, { oauth_query: query }, { cookie: rig.cookie }));

    expect(answer.status).toBe(404);
    expect(answer.body.error).toEqual({ code: 'RESOURCE_NOT_FOUND', message: OAUTH_CONSENT_REQUEST_CLIENT_NOT_FOUND_MESSAGE });
  });

  it('needs a session: a request with none is 401 whatever it carries', async () => {
    const rig = await arrange();
    const clientId = await rig.registerWithoutCredential();
    const query = await rig.signedConsentQuery(clientId, DCR_REDIRECT);

    const answer = await readJson(await rig.post(OAUTH_CONSENT_REQUEST_PATH, { oauth_query: query }));

    expect(answer.status).toBe(401);
    expect(answer.body.error.code).toBe('UNAUTHENTICATED');
    expect(JSON.stringify(answer.body)).not.toContain(DCR_REDIRECT);
  });

  it('takes oauth_query in the body and nothing else', async () => {
    const rig = await arrange();
    const clientId = await rig.registerWithoutCredential();
    const query = await rig.signedConsentQuery(clientId, DCR_REDIRECT);

    const extraKey = await readJson(
      await rig.post(OAUTH_CONSENT_REQUEST_PATH, { oauth_query: query, redirect_uri: SETUP_REDIRECT }, { cookie: rig.cookie }),
    );
    expect(extraKey.status).toBe(400);
    expect(extraKey.body.error.code).toBe('VALIDATION_ERROR');
    expect(extraKey.body.error.message).toContain('"redirect_uri"');

    const missing = await readJson(await rig.post(OAUTH_CONSENT_REQUEST_PATH, {}, { cookie: rig.cookie }));
    expect(missing.status).toBe(400);
    expect(missing.body.error.code).toBe('VALIDATION_ERROR');

    const queryParam = await readJson(
      await rig.post(OAUTH_CONSENT_REQUEST_PATH, { oauth_query: query }, { cookie: rig.cookie, search: '?client_id=x' }),
    );
    expect(queryParam.status).toBe(400);
    expect(queryParam.body.error.code).toBe('VALIDATION_ERROR');

    const garbled = await readJson(await rig.post(OAUTH_CONSENT_REQUEST_PATH, '{"oauth_query": ', { cookie: rig.cookie }));
    expect(garbled.status).toBe(400);
    expect(garbled.body.error.code).toBe('INVALID_REQUEST');
  });
});

describe('the package entry publishes the read, for a host that forwards the auth routes to an AuthManager it did not mount', () => {
  // A per-environment kernel runs AuthPlugin with `registerRoutes: false`, so its
  // host answers this route itself, from the package root, with the env's
  // AuthManager and the request: no AuthPlugin route, no Hono app.
  const hostAnswer = (manager: OAuthConsentRequestManager, body: unknown, cookie?: string): Promise<OAuthConsentRequestResult> =>
    runOAuthConsentRequestRead(oauthConsentRequestDepsFor(manager), {
      raw: new Request(`${ORIGIN}${BASE}${OAUTH_CONSENT_REQUEST_PATH}`, {
        method: 'POST',
        headers: { origin: ORIGIN, 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
        body: JSON.stringify(body),
      }),
      queries: {},
    });

  it('names both functions on the package root', () => {
    expect(Object.keys(entry)).toEqual(expect.arrayContaining(['runOAuthConsentRequestRead', 'oauthConsentRequestDepsFor']));
  });

  it('answers the signed redirect from the AuthManager alone, and a request with no session 401', async () => {
    const rig = await arrange();
    const clientId = await rig.registerWithoutCredential();
    const query = await rig.signedConsentQuery(clientId, DCR_REDIRECT);

    const answer = await hostAnswer(rig.manager, { oauth_query: query }, rig.cookie);
    expect(answer.status, JSON.stringify(answer.body)).toBe(200);
    expect(answer.headers['Cache-Control']).toBe('no-store');
    expect(answer.body).toEqual({
      success: true,
      data: { clientId, redirectUri: DCR_REDIRECT, registeredByAdministrator: false },
    });

    const anonymous = await hostAnswer(rig.manager, { oauth_query: query });
    expect(anonymous.status).toBe(401);
    expect(anonymous.body).toMatchObject({ success: false, error: { code: 'UNAUTHENTICATED' } });
  });
});
