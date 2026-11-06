// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [objectstack-ai/cloud#3606, ruling A] An MCP access token is revoked through
 * the OAuth consent it was minted under (`mcp-token-revocation.ts`).
 *
 * Every reading is taken off a REAL `AuthManager` — the installed
 * `@better-auth/oauth-provider` 1.7.12 with this package's own options — on a
 * real `ObjectQL` over `@objectstack/driver-sql` + better-sqlite3, driven
 * through `handleRequest`, the seam the revoke answer lives on: DCR → sign-up
 * → authorize (PKCE S256, `resource` = the MCP URL) → consent → token →
 * revoke. The client is a DCR public client (`token_endpoint_auth_method:
 * none`), the shape the cloud tenant rig measured. The stored rows are read
 * at DRIVER level, below every read mask.
 *
 * What the ruling binds, and the leg that pins each:
 *
 *  - revoking the access token with `client_id` only answers 200, deletes the
 *    consent and the refresh family, and the same bearer is refused by
 *    `verifyMcpAccessToken` — which the MCP route answers with a 401
 *    (`@objectstack/runtime` `http-dispatcher.mcp-oauth.test.ts`, "invalid /
 *    expired JWT bearer → 401", pins that a refused bearer is a 401 there);
 *  - the Console's `delete-consent` refuses the same bearer, with no extra write;
 *  - a revoke sent by ANOTHER client answers 200 and the owner's token works;
 *  - a `token_type_hint` naming another token type does not end the search
 *    (RFC 7009 §2.1): the MCP access token is revoked all the same;
 *  - an unknown or invalid token answers 200 (RFC 7009 §2.2), while a request
 *    the provider refuses before it looks at the token keeps its refusal;
 *  - a store error in the consent read refuses (fail closed);
 *  - a store error while revoking is handed to the caller as a 503
 *    (RFC 7009 §2.2.1);
 *  - a token minted before its consent was granted again stays refused;
 *  - a server-only `skip_consent` client keeps the provider's honest
 *    `unsupported_token_type` and is admitted without a consent row.
 */

import { createRequire } from 'node:module';
import path from 'node:path';
import fs from 'node:fs';
import { describe, it, expect, afterEach, vi } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { AuthManager } from './auth-manager.js';
import { authIdentityObjects } from './manifest.js';
import { UNKNOWN_TOKEN_DESCRIPTIONS } from './mcp-token-revocation.js';

const BASE = 'http://localhost:3000';
const AUTH = `${BASE}/api/v1/auth`;
const MCP_RESOURCE = `${BASE}/api/v1/mcp`;
const SECRET = 'test-secret-at-least-32-chars-long-30345';
const PASSWORD = 'S3cure!Passw0rd-30345';
const REDIRECT_URI = 'http://localhost:56789/callback';
const SCOPE = 'openid profile email offline_access data:read';
// RFC 7636 Appendix B verifier/challenge pair.
const PKCE_VERIFIER = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
const PKCE_CHALLENGE = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';
const SYS = { context: { isSystem: true } } as const;

const engines: ObjectQL[] = [];
afterEach(async () => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  while (engines.length) {
    try {
      await (engines.pop() as unknown as { destroy?(): Promise<void> })?.destroy?.();
    } catch {
      /* noop */
    }
  }
});

const cookiesOf = (res: Response): string =>
  (res.headers.getSetCookie?.() ?? [res.headers.get('set-cookie') ?? ''])
    .map((c) => c.split(';')[0]!)
    .filter(Boolean)
    .join('; ');

/** A real AuthManager with its embedded authorization server and DCR on, over a real engine. */
async function rig() {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  const engine = new ObjectQL();
  engines.push(engine);
  const driver = new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true });
  engine.registerDriver(driver, true);
  await engine.init();
  for (const object of authIdentityObjects) {
    engine.registry.registerObject(object as never, '@objectstack/plugin-auth');
  }
  await engine.syncSchemas();
  vi.spyOn((engine as any).logger, 'info').mockImplementation(() => undefined);

  const manager = new AuthManager({
    secret: SECRET,
    baseUrl: BASE,
    dataEngine: engine as never,
    plugins: { oidcProvider: true, dynamicClientRegistration: true },
  } as never);

  const send = (request: Request) => manager.handleRequest(request);
  const postJson = (path: string, body: unknown, cookie?: string) =>
    send(new Request(`${AUTH}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: BASE, ...(cookie ? { cookie } : {}) },
      body: JSON.stringify(body),
    }));
  const postForm = (path: string, params: Record<string, string>, headers: Record<string, string> = {}) =>
    send(new Request(`${AUTH}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', ...headers },
      body: new URLSearchParams(params).toString(),
    }));

  /** Every stored row of `object`, read at DRIVER level. */
  const rowsAtRest = async (object: string): Promise<Record<string, any>[]> => {
    const found = await (driver as any).find(object, { where: {} });
    return (Array.isArray(found) ? found : [found]).filter(Boolean);
  };

  async function registerClient(): Promise<string> {
    const res = await postJson('/oauth2/register', {
      client_name: 'Claude Code (test)',
      redirect_uris: [REDIRECT_URI],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
      application_type: 'native',
      scope: SCOPE,
    });
    const body: any = await res.json().catch(() => null);
    expect(res.status, JSON.stringify(body)).toBe(201);
    return body.client_id as string;
  }

  async function signUp(email: string): Promise<string> {
    const res = await postJson('/sign-up/email', { email, password: PASSWORD, name: 'Mia' });
    expect(res.status, await res.clone().text()).toBe(200);
    return cookiesOf(res);
  }

  /** Authorize as the signed-in user; through the consent page when one is shown. Answers the code. */
  async function authorize(clientId: string, cookie: string): Promise<{ code: string; prompted: boolean }> {
    const url = new URL(`${AUTH}/oauth2/authorize`);
    url.searchParams.set('client_id', clientId);
    url.searchParams.set('redirect_uri', REDIRECT_URI);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('scope', SCOPE);
    url.searchParams.set('state', 'st');
    url.searchParams.set('code_challenge', PKCE_CHALLENGE);
    url.searchParams.set('code_challenge_method', 'S256');
    url.searchParams.set('resource', MCP_RESOURCE);
    const res = await send(new Request(url.toString(), { headers: { cookie } }));
    let location = res.headers.get('location') ?? '';
    expect(location, `authorize answered ${res.status} with no redirect: ${await res.clone().text()}`).toBeTruthy();
    const prompted = location.includes('/oauth/consent');
    if (prompted) {
      const consent = await postJson('/oauth2/consent', { accept: true, oauth_query: location.slice(location.indexOf('?')) }, cookie);
      const body: any = await consent.json().catch(() => null);
      location = body?.redirect_uri ?? body?.url ?? '';
      expect(location, `consent did not produce a redirect: ${JSON.stringify(body)}`).toBeTruthy();
    }
    const code = new URL(location).searchParams.get('code');
    expect(code, `no authorization code: ${location}`).toBeTruthy();
    return { code: code!, prompted };
  }

  async function exchange(clientId: string, code: string) {
    const res = await postForm('/oauth2/token', {
      grant_type: 'authorization_code',
      code,
      redirect_uri: REDIRECT_URI,
      client_id: clientId,
      code_verifier: PKCE_VERIFIER,
      resource: MCP_RESOURCE,
    });
    const body: any = await res.json().catch(() => null);
    expect(res.status, JSON.stringify(body)).toBe(200);
    expect(body?.access_token && body?.refresh_token, JSON.stringify(body)).toBeTruthy();
    return body as { access_token: string; refresh_token: string };
  }

  /** A DCR public client, a signed-up user, a first consent and the tokens it earns. */
  async function connect(email = 'mia@acme.example.com') {
    const clientId = await registerClient();
    const cookie = await signUp(email);
    const { code, prompted } = await authorize(clientId, cookie);
    expect(prompted, 'a first connect shows the consent page').toBe(true);
    return { clientId, cookie, ...(await exchange(clientId, code)) };
  }

  const revoke = (params: Record<string, string>, headers?: Record<string, string>) =>
    postForm('/oauth2/revoke', params, headers);

  return { engine, driver, manager, send, postJson, postForm, rowsAtRest, registerClient, signUp, authorize, exchange, connect, revoke };
}

const bodyOf = async (res: Response) => ({ status: res.status, body: await res.clone().json().catch(() => res.clone().text()) });

describe('[ruling A] /oauth2/revoke revokes an MCP access token through its consent', () => {
  it('⭐ a DCR public client revokes its access token with `client_id` only → 200, and the same bearer is refused', async () => {
    const r = await rig();
    const { clientId, cookie, access_token, refresh_token } = await r.connect();
    expect(await r.manager.verifyMcpAccessToken(access_token), 'the control: the bearer verifies before the revoke')
      .toMatchObject({ clientId });
    expect(await r.rowsAtRest('sys_oauth_consent')).toHaveLength(1);
    expect(await r.rowsAtRest('sys_oauth_refresh_token')).toHaveLength(1);

    const res = await r.revoke({ token: access_token, token_type_hint: 'access_token', client_id: clientId });
    expect(await bodyOf(res)).toEqual({ status: 200, body: null });

    expect(await r.manager.verifyMcpAccessToken(access_token), 'the revoked bearer is refused').toBeNull();
    expect(await r.rowsAtRest('sys_oauth_consent'), 'the consent is deleted').toEqual([]);
    expect(await r.rowsAtRest('sys_oauth_refresh_token'), 'the refresh family is deleted').toEqual([]);
    // The refresh token minted under the grant mints nothing any more.
    const refreshed = await r.postForm('/oauth2/token', {
      grant_type: 'refresh_token', refresh_token, client_id: clientId, resource: MCP_RESOURCE,
    });
    expect(refreshed.status).toBe(400);
    // The accepted cost: the next connect asks for consent again.
    expect((await r.authorize(clientId, cookie)).prompted).toBe(true);
  }, 60_000);

  it('the hint is not needed, and a second revoke of the same token is a 200 that changes nothing', async () => {
    const r = await rig();
    const { clientId, access_token } = await r.connect();
    expect((await r.revoke({ token: access_token, client_id: clientId })).status).toBe(200);
    expect(await r.manager.verifyMcpAccessToken(access_token)).toBeNull();
    expect((await r.revoke({ token: access_token, client_id: clientId })).status).toBe(200);
  }, 60_000);

  it('a hint naming another token type does not end the search: the MCP access token is still revoked (RFC 7009 §2.1)', async () => {
    const r = await rig();
    const { clientId, access_token } = await r.connect();
    expect(await r.manager.verifyMcpAccessToken(access_token), 'the control').toMatchObject({ clientId });

    const res = await r.revoke({ token: access_token, token_type_hint: 'refresh_token', client_id: clientId });
    expect(await bodyOf(res)).toEqual({ status: 200, body: null });
    expect(await r.manager.verifyMcpAccessToken(access_token), 'the revoked bearer is refused').toBeNull();
    expect(await r.rowsAtRest('sys_oauth_consent'), 'the consent is deleted').toEqual([]);
    expect(await r.rowsAtRest('sys_oauth_refresh_token'), 'the refresh family is deleted').toEqual([]);
  }, 60_000);

  it('under that hint, ANOTHER client\'s revoke still answers 200 and changes nothing', async () => {
    const r = await rig();
    const { clientId, access_token } = await r.connect();
    const intruder = await r.registerClient();
    const res = await r.revoke({ token: access_token, token_type_hint: 'refresh_token', client_id: intruder });
    expect(await bodyOf(res)).toEqual({ status: 200, body: null });
    expect(await r.manager.verifyMcpAccessToken(access_token)).toMatchObject({ clientId });
    expect(await r.rowsAtRest('sys_oauth_consent')).toHaveLength(1);
  }, 60_000);

  it('the Console\'s `delete-consent` refuses the same bearer on the next request, with no extra write', async () => {
    const r = await rig();
    const { clientId, cookie, access_token } = await r.connect();
    const listed = await r.send(new Request(`${AUTH}/oauth2/get-consents`, { headers: { cookie } }));
    const consents: any[] = await listed.json();
    expect(consents.map((c) => c.clientId)).toEqual([clientId]);

    const res = await r.postJson('/oauth2/delete-consent', { id: consents[0].id }, cookie);
    expect(res.status, await res.clone().text()).toBe(200);
    expect(await r.manager.verifyMcpAccessToken(access_token)).toBeNull();
  }, 60_000);

  it('a revoke sent by ANOTHER client answers 200 and the owner\'s token still works', async () => {
    const r = await rig();
    const { clientId, access_token } = await r.connect();
    const intruder = await r.registerClient();

    const res = await r.revoke({ token: access_token, token_type_hint: 'access_token', client_id: intruder });
    expect(await bodyOf(res)).toEqual({ status: 200, body: null });
    expect(await r.manager.verifyMcpAccessToken(access_token)).toMatchObject({ clientId });
    expect(await r.rowsAtRest('sys_oauth_consent')).toHaveLength(1);
    expect(await r.rowsAtRest('sys_oauth_refresh_token')).toHaveLength(1);
  }, 60_000);

  it('a token minted before its consent was granted again stays refused; the new grant\'s token works', async () => {
    const r = await rig();
    const { clientId, cookie, access_token } = await r.connect();
    expect((await r.revoke({ token: access_token, client_id: clientId })).status).toBe(200);

    // The person connects again a few seconds later: a NEW consent row.
    vi.useFakeTimers({ toFake: ['Date'], shouldAdvanceTime: true });
    vi.setSystemTime(Date.now() + 5_000);
    const { code, prompted } = await r.authorize(clientId, cookie);
    expect(prompted).toBe(true);
    const fresh = await r.exchange(clientId, code);
    expect(await r.rowsAtRest('sys_oauth_consent')).toHaveLength(1);

    expect(await r.manager.verifyMcpAccessToken(fresh.access_token)).toMatchObject({ clientId });
    expect(await r.manager.verifyMcpAccessToken(access_token), 'the old grant\'s token').toBeNull();
  }, 60_000);
});

describe('[ruling A] what /oauth2/revoke answers for a token it cannot act on', () => {
  it('an unknown or invalid token answers 200 (RFC 7009 §2.2), with any hint or none', async () => {
    const r = await rig();
    const clientId = await r.registerClient();
    for (const hint of ['access_token', 'refresh_token', undefined]) {
      for (const token of ['garbage', 'a.b.c', 'eyJhbGciOiJub25lIn0.e30.']) {
        const res = await r.revoke({ token, client_id: clientId, ...(hint ? { token_type_hint: hint } : {}) });
        expect(await bodyOf(res), `token ${token}, hint ${hint}`).toEqual({ status: 200, body: null });
      }
    }
  }, 60_000);

  it('every description it answers 200 for is one the installed provider still writes', async () => {
    // The closed list keys on the provider's own words. A bump that rewords
    // one must red here, not turn its refusal into a silent 400.
    const distDir = path.dirname(createRequire(import.meta.url).resolve('@better-auth/oauth-provider'));
    const files = fs.readdirSync(distDir).filter((f) => f.endsWith('.mjs'));
    expect(files.length, `no dist sources found under ${distDir}`).toBeGreaterThan(0);
    const dist = files.map((f) => fs.readFileSync(path.join(distDir, f), 'utf8')).join('\n');
    expect(dist.includes('JWT access tokens are self-contained and cannot be revoked server-side'), 'positive control').toBe(true);
    for (const description of UNKNOWN_TOKEN_DESCRIPTIONS) {
      expect(dist.includes(`error_description: "${description}"`), description).toBe(true);
    }
  });

  it('a request the provider refuses before it reads the token keeps its refusal', async () => {
    const r = await rig();
    const { access_token } = await r.connect();
    // No client at all: the provider's 401 stands.
    expect((await r.revoke({ token: access_token, token_type_hint: 'access_token' })).status).toBe(401);
    // An unknown client: refused as an invalid client, never answered 200.
    const unknown = await r.revoke({ token: access_token, token_type_hint: 'access_token', client_id: 'no-such-client' });
    expect(unknown.status).toBeGreaterThanOrEqual(400);
    expect((await bodyOf(unknown)).body).toMatchObject({ error: 'invalid_client' });
    // An empty token: a malformed request, still 400.
    const clientId = await r.registerClient();
    expect((await r.revoke({ token: '', client_id: clientId })).status).toBe(400);
    // And nothing was revoked by any of them.
    expect(await r.rowsAtRest('sys_oauth_consent')).toHaveLength(1);
  }, 60_000);
});

describe('[ruling A] store errors', () => {
  it('a store error in the consent read refuses the bearer (fail closed)', async () => {
    const r = await rig();
    const { clientId, access_token } = await r.connect();
    const original = (r.driver as any).find.bind(r.driver);
    const failing = vi.spyOn(r.driver as any, 'find').mockImplementation(async (object: unknown, ...rest: unknown[]) => {
      if (object === 'sys_oauth_consent') throw new Error('consent store unreachable');
      return original(object, ...rest);
    });
    expect(await r.manager.verifyMcpAccessToken(access_token)).toBeNull();
    failing.mockRestore();
    expect(await r.manager.verifyMcpAccessToken(access_token), 'the control: the store answers again').toMatchObject({ clientId });
  }, 60_000);

  it('a store error while revoking is handed to the caller as a 503 (RFC 7009 §2.2.1), and a retry completes the revoke', async () => {
    const r = await rig();
    const { clientId, access_token } = await r.connect();
    const failing = vi.spyOn(r.driver as any, 'delete').mockRejectedValue(new Error('store unreachable'));
    const res = await r.revoke({ token: access_token, token_type_hint: 'access_token', client_id: clientId });
    expect(await bodyOf(res)).toMatchObject({ status: 503, body: { error: 'server_error' } });
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(await r.manager.verifyMcpAccessToken(access_token), 'nothing was revoked, and the client was told').toMatchObject({ clientId });
    failing.mockRestore();
    expect((await r.revoke({ token: access_token, token_type_hint: 'access_token', client_id: clientId })).status).toBe(200);
    expect(await r.manager.verifyMcpAccessToken(access_token)).toBeNull();
  }, 60_000);
});

describe('[ruling A, step 5] a server-only `skip_consent` client', () => {
  it('has no consent row, is admitted without one, and keeps the honest `unsupported_token_type`', async () => {
    const r = await rig();
    const clientId = await r.registerClient();
    const [app] = (await r.rowsAtRest('sys_oauth_application')).filter((row) => row.client_id === clientId);
    await (r.engine as any).update('sys_oauth_application', { id: app!.id, skip_consent: true }, SYS);
    const cookie = await r.signUp('ops@acme.example.com');
    const { code, prompted } = await r.authorize(clientId, cookie);
    expect(prompted, 'a skip_consent client is never shown the consent page').toBe(false);
    const { access_token } = await r.exchange(clientId, code);
    expect(await r.rowsAtRest('sys_oauth_consent')).toEqual([]);

    expect(await r.manager.verifyMcpAccessToken(access_token)).toMatchObject({ clientId });
    const res = await r.revoke({ token: access_token, token_type_hint: 'access_token', client_id: clientId });
    const provider = await bodyOf(res);
    expect(provider).toMatchObject({ status: 400, body: { error: 'unsupported_token_type' } });
    // Under a hint naming another token type, the same honest answer, word for word.
    const hinted = await r.revoke({ token: access_token, token_type_hint: 'refresh_token', client_id: clientId });
    expect(await bodyOf(hinted)).toEqual(provider);
    expect(await r.manager.verifyMcpAccessToken(access_token)).toMatchObject({ clientId });
  }, 60_000);
});
