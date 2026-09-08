// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * MCP OAuth — RFC 8707 resource registration, verified against the REAL
 * `@better-auth/oauth-provider` rather than against the options object we
 * hand it.
 *
 * ## Why this file exists
 *
 * The predecessor check asserted `opts.validAudiences` on the object
 * captured from a mocked `oauthProvider`. The provider never consumed that
 * object, so the assertion was green whether or not the installed version
 * read the option — and 1.7.2 does not read it at all. An assertion that
 * cannot fail is indistinguishable from one that passed.
 *
 * Every check here is refutable by the one fact the predecessor could not
 * see — "the provider does not consume this option":
 *
 * 1. `option surface liveness` reads the INSTALLED provider's dist and
 *    refuses any option name AuthManager passes that does not occur in it.
 *    It carries its own two-way control: a name the provider demonstrably
 *    reads must be found, and a name nothing could read must not be.
 * 2. The end-to-end block boots a real authorization server from the exact
 *    options AuthManager produces and drives discovery → DCR →
 *    `authorize?resource=<mcp url>` → consent → token. `invalid_target`
 *    at the authorize step is the production symptom, so the flow reaching
 *    a minted token audienced to the MCP resource is the reading.
 * 3. `enforcePerClientResources` stays ON and is asserted ON by behaviour:
 *    a client that is NOT linked to the resource must still be refused.
 *    Switching the check off to make (2) pass would turn that check red.
 */

import { createRequire } from 'node:module';
import path from 'node:path';
import fs from 'node:fs';

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { AuthManager } from './auth-manager';

// Same pattern as auth-manager.mcp-oauth.test.ts: better-auth is mocked so
// AuthManager's own instance build stays cheap. The authorization server the
// assertions run against is a SEPARATE, REAL one booted below from the
// options captured here.
vi.mock('better-auth', () => ({
  betterAuth: vi.fn(() => ({ handler: vi.fn(), api: {} })),
}));
vi.mock('@better-auth/oauth-provider', () => ({
  oauthProvider: vi.fn((opts: any) => ({ id: 'oauth-provider', _opts: opts })),
}));

import { oauthProvider } from '@better-auth/oauth-provider';

const BASE_URL = 'https://acme.example.com';
const AUTH_BASE_PATH = '/api/v1/auth';
const ISSUER = `${BASE_URL}${AUTH_BASE_PATH}`;
const MCP_RESOURCE = `${BASE_URL}/api/v1/mcp`;
const REDIRECT_URI = 'http://localhost:56789/callback';
// RFC 7636 Appendix B verifier/challenge pair.
const PKCE_VERIFIER = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
const PKCE_CHALLENGE = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';

const ENV_KEYS = ['OS_MCP_SERVER_ENABLED', 'OS_OIDC_PROVIDER_ENABLED', 'OS_OIDC_DCR_ENABLED'] as const;
const savedEnv: Record<string, string | undefined> = {};

beforeEach(() => {
  vi.clearAllMocks();
  for (const k of ENV_KEYS) {
    savedEnv[k] = process.env[k];
    delete process.env[k];
  }
});
afterEach(() => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
});

/** The options AuthManager actually hands `oauthProvider()`. */
async function captureProviderOptions(): Promise<any> {
  process.env.OS_MCP_SERVER_ENABLED = 'true';
  const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  try {
    const manager = new AuthManager({
      secret: 'test-secret-at-least-32-chars-long',
      baseUrl: BASE_URL,
    });
    await manager.getAuthInstance();
  } finally {
    warnSpy.mockRestore();
  }
  const opts = (oauthProvider as any).mock.calls.at(-1)?.[0];
  expect(opts, 'AuthManager must register the oauthProvider plugin').toBeDefined();
  return opts;
}

/**
 * Every source byte of the INSTALLED `@better-auth/oauth-provider`, resolved
 * through Node's own resolver so the reading is about the version this
 * checkout actually runs. Throws (fails the test) if it cannot be read —
 * "the scanner found nothing" must never be spellable as a pass.
 */
function installedProviderDistText(): string {
  const require = createRequire(import.meta.url);
  const distDir = path.dirname(require.resolve('@better-auth/oauth-provider'));
  const files = fs.readdirSync(distDir).filter((f) => f.endsWith('.mjs') || f.endsWith('.d.mts'));
  expect(files.length, `no dist sources found under ${distDir}`).toBeGreaterThan(0);
  return files.map((f) => fs.readFileSync(path.join(distDir, f), 'utf8')).join('\n');
}

/**
 * Boots a REAL better-auth authorization server carrying the REAL
 * `@better-auth/oauth-provider` configured with `opts`, backed by the
 * in-memory adapter. Returns the instance plus the raw row store, so a
 * check can read `oauthResource` / `oauthClientResource` row counts the
 * same way the bug report read `sys_oauth_resource` / `sys_oauth_client_resource`.
 */
async function bootRealAuthorizationServer(opts: any) {
  const [{ betterAuth }, { memoryAdapter }, { jwt }, { oauthProvider: realOauthProvider }] = await Promise.all([
    vi.importActual<typeof import('better-auth')>('better-auth'),
    import('better-auth/adapters/memory'),
    import('better-auth/plugins'),
    vi.importActual<typeof import('@better-auth/oauth-provider')>('@better-auth/oauth-provider'),
  ]);

  // Constructing the real plugin is itself load-bearing: 1.7.2 throws
  // `clientRegistrationDefaultResources resource <id> not found in resources`
  // when the two options disagree.
  const plugin = realOauthProvider(opts);

  // The memory adapter refuses a model it has no array for, so derive the
  // table list from the plugin's own resolved schema rather than a hand-kept
  // list that would rot on the next provider bump.
  const pluginSchema = (plugin as any).schema as Record<string, { modelName?: string }>;
  const db: Record<string, any[]> = {};
  for (const m of ['user', 'session', 'account', 'verification', 'jwks']) db[m] = [];
  for (const [model, def] of Object.entries(pluginSchema ?? {})) db[def.modelName ?? model] = [];

  const auth = betterAuth({
    baseURL: BASE_URL,
    basePath: AUTH_BASE_PATH,
    secret: 'test-secret-at-least-32-chars-long',
    database: memoryAdapter(db),
    emailAndPassword: { enabled: true },
    plugins: [jwt(), plugin as any],
  });
  // Forces plugin `init` — which is where the provider seeds `resources`.
  await auth.$context;

  const resourceModel = pluginSchema?.oauthResource?.modelName ?? 'oauthResource';
  const clientResourceModel = pluginSchema?.oauthClientResource?.modelName ?? 'oauthClientResource';

  return {
    auth,
    db,
    rows: () => ({
      resource: db[resourceModel]?.length ?? 0,
      clientResource: db[clientResourceModel]?.length ?? 0,
    }),
    resourceRows: () => db[resourceModel] ?? [],
  };
}

async function registerDcrClient(auth: any) {
  const res = await auth.handler(
    new Request(`${ISSUER}/oauth2/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        client_name: 'Claude Code (test)',
        redirect_uris: [REDIRECT_URI],
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'],
        token_endpoint_auth_method: 'none',
        application_type: 'native',
        scope: 'openid profile email offline_access data:read',
      }),
    }),
  );
  return { status: res.status, body: (await res.json().catch(() => null)) as any };
}

async function signUp(auth: any) {
  const res = await auth.handler(
    new Request(`${ISSUER}/sign-up/email`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'dev@acme.example.com', password: 'password-12345', name: 'Dev' }),
    }),
  );
  const cookie = (res.headers.get('set-cookie') ?? '')
    .split(',')
    .map((c) => c.split(';')[0]!.trim())
    .join('; ');
  return cookie;
}

async function authorizeWithResource(auth: any, clientId: string, cookie: string) {
  const url = new URL(`${ISSUER}/oauth2/authorize`);
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('redirect_uri', REDIRECT_URI);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', 'openid profile email offline_access data:read');
  url.searchParams.set('state', 'st');
  url.searchParams.set('code_challenge', PKCE_CHALLENGE);
  url.searchParams.set('code_challenge_method', 'S256');
  url.searchParams.set('resource', MCP_RESOURCE);
  const res = await auth.handler(new Request(url.toString(), { method: 'GET', headers: { cookie } }));
  return { status: res.status, location: res.headers.get('location') ?? '' };
}

function decodeJwtPayload(token: string): any {
  const parts = token.split('.');
  expect(parts.length, 'access token must be a signed JWT').toBe(3);
  return JSON.parse(Buffer.from(parts[1]!, 'base64url').toString('utf8'));
}

describe('oauthProvider option surface liveness (installed 1.7.2)', () => {
  // Two-way control on the scanner itself: it must be able to answer BOTH
  // "present" and "absent", or a 0-hit reading proves nothing.
  it('the dist scan fires in both directions', () => {
    const dist = installedProviderDistText();
    expect(dist.includes('enforcePerClientResources'), 'positive control: an option the provider reads').toBe(true);
    expect(dist.includes('objectstackOptionThatCannotExist'), 'negative control: a name nothing reads').toBe(false);
  });

  it('every option AuthManager passes occurs in the installed provider', async () => {
    const opts = await captureProviderOptions();
    const dist = installedProviderDistText();
    const dead = Object.keys(opts).filter((key) => !dist.includes(key));
    expect(
      dead,
      'options passed to @better-auth/oauth-provider that the INSTALLED version never reads — '
        + 'a field passed and read by nobody looks like configuration and enforces nothing; '
        + 'delete it or replace it with the option this version actually honours',
    ).toEqual([]);
  });
});

describe('MCP resource registration against the real provider (RFC 8707)', () => {
  it('seeds the MCP resource as an oauthResource row at plugin init', async () => {
    const opts = await captureProviderOptions();
    const server = await bootRealAuthorizationServer(opts);
    expect(server.rows().resource, 'the MCP resource must exist before any client asks for it').toBe(1);
    expect(server.resourceRows()[0]?.identifier).toBe(MCP_RESOURCE);
  });

  it('links a DCR-registered client to the MCP resource without an admin step', async () => {
    const opts = await captureProviderOptions();
    const server = await bootRealAuthorizationServer(opts);
    expect(server.rows().clientResource).toBe(0);
    const reg = await registerDcrClient(server.auth);
    expect(reg.status, JSON.stringify(reg.body)).toBe(201);
    // A client that registers anonymously one second before the login cannot
    // be linked by an admin in between — the link has to happen here.
    expect(server.rows().clientResource).toBe(1);
  });

  it('does NOT answer invalid_target for authorize?resource=<mcp url> (the production symptom)', async () => {
    const opts = await captureProviderOptions();
    const server = await bootRealAuthorizationServer(opts);
    const reg = await registerDcrClient(server.auth);
    const cookie = await signUp(server.auth);
    const az = await authorizeWithResource(server.auth, reg.body.client_id, cookie);
    expect(az.location, 'authorize must not refuse the advertised MCP resource').not.toContain('invalid_target');
    expect(az.location, 'authorize must hand off to the consent page').toContain('/oauth/consent');
  });

  it('mints a token whose audience is the MCP resource (discovery → DCR → authorize → consent → token)', async () => {
    const opts = await captureProviderOptions();
    const server = await bootRealAuthorizationServer(opts);

    const reg = await registerDcrClient(server.auth);
    expect(reg.status, JSON.stringify(reg.body)).toBe(201);
    const cookie = await signUp(server.auth);

    const az = await authorizeWithResource(server.auth, reg.body.client_id, cookie);
    expect(az.location).not.toContain('invalid_target');

    const consentRes = await server.auth.handler(
      new Request(`${ISSUER}/oauth2/consent`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie, origin: BASE_URL },
        body: JSON.stringify({ accept: true, oauth_query: az.location.slice(az.location.indexOf('?')) }),
      }),
    );
    const consentBody: any = await consentRes.json().catch(() => null);
    const target = consentBody?.redirect_uri ?? consentBody?.url;
    expect(target, `consent did not produce a redirect: ${JSON.stringify(consentBody)}`).toBeTruthy();
    const code = new URL(target).searchParams.get('code');
    expect(code, `consent returned no authorization code: ${target}`).toBeTruthy();

    const tokenRes = await server.auth.handler(
      new Request(`${ISSUER}/oauth2/token`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          code: code!,
          redirect_uri: REDIRECT_URI,
          client_id: reg.body.client_id,
          code_verifier: PKCE_VERIFIER,
          resource: MCP_RESOURCE,
        }).toString(),
      }),
    );
    const tokenBody: any = await tokenRes.json().catch(() => null);
    expect(tokenRes.status, JSON.stringify(tokenBody)).toBe(200);
    expect(tokenBody.access_token, 'no token was minted').toBeTruthy();

    const payload = decodeJwtPayload(tokenBody.access_token);
    const aud = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
    expect(aud, 'the minted token must be audienced to the MCP resource').toContain(MCP_RESOURCE);
    expect(payload.iss).toBe(ISSUER);
  });

  it('keeps the per-client resource check ON — an unlinked client is still refused', async () => {
    const opts = await captureProviderOptions();
    // Route (b) — `enforcePerClientResources: false` — would make the checks
    // above pass by switching a security check off instead of satisfying it.
    // This guard is what tells the two routes apart.
    expect(opts.enforcePerClientResources, 'the per-client resource check must not be disabled').not.toBe(false);

    const server = await bootRealAuthorizationServer(opts);
    const cookie = await signUp(server.auth);

    // A client created WITHOUT the registration defaults gets no link row.
    const unlinkedClientId = 'unlinked-test-client';
    server.db.oauthClient!.push({
      id: 'unlinked-row-id',
      clientId: unlinkedClientId,
      clientSecret: null,
      name: 'Unlinked client',
      redirectURLs: [REDIRECT_URI],
      type: 'public',
      applicationType: 'native',
      tokenEndpointAuthMethod: 'none',
      grantTypes: ['authorization_code'],
      responseTypes: ['code'],
      scopes: ['openid', 'profile', 'email', 'offline_access', 'data:read'],
      clientCredentialsScopes: [],
      disabled: false,
      skipConsent: false,
      requirePkce: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const az = await authorizeWithResource(server.auth, unlinkedClientId, cookie);
    expect(
      az.location,
      'a client with no oauthClientResource row must NOT be able to request the MCP resource — '
        + 'if this passes, enforcePerClientResources has been switched off',
    ).toContain('invalid_target');
  });
});
