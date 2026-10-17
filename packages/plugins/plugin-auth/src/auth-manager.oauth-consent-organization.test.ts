// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#24166, ruling 6232069920 A] An OAuth consent binds the consenting user's
 * current organization, the access token carries it as `organization_id`, and
 * `verifyMcpAccessToken` returns it as `organizationId`.
 *
 * Every reading here is taken from a REAL authorization server — the installed
 * `@better-auth/oauth-provider` plus better-auth's real `organization` plugin —
 * booted from the exact options a real `AuthManager` hands `oauthProvider()`,
 * and driven through its HTTP surface: DCR → sign-up → organization →
 * authorize → consent → token → refresh. The same harness shape as
 * auth-manager.mcp-oauth-resource.test.ts, for the reason that file states: an
 * assertion on the options object stays green under a provider that never
 * reads it, so the reading has to come off the minted token and the stored
 * rows.
 *
 * What the ruling binds, and the leg that pins each:
 *
 *  - the token's `organization_id` is the consenting SESSION's active
 *    organization, recorded on the consent row and the refresh family it
 *    starts, and `verifyMcpAccessToken` returns it;
 *  - a refresh keeps the consent's organization, never the session's current
 *    one;
 *  - no active organization at consent ⇒ no reference, no claim, no
 *    `organizationId` — never a guessed or default one;
 *  - the authorize request cannot choose the organization;
 *  - an existing consent (its reference is null) re-confirms ONCE, and until
 *    then an old refresh family mints tokens with no claim.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { AuthManager } from './auth-manager';
import { buildJwtPluginSchema } from './auth-schema-config.js';

// better-auth is mocked so AuthManager's own instance build stays cheap; the
// authorization server every assertion reads is a SEPARATE, real one booted
// below from the options captured here.
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
const SCOPE = 'openid profile email offline_access data:read';
// RFC 7636 Appendix B verifier/challenge pair.
const PKCE_VERIFIER = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
const PKCE_CHALLENGE = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';
const SECRET = 'test-secret-at-least-32-chars-long';

const ENV_KEYS = ['OS_MCP_SERVER_ENABLED', 'OS_OIDC_PROVIDER_ENABLED', 'OS_OIDC_DCR_ENABLED'] as const;
const savedEnv: Record<string, string | undefined> = {};

beforeEach(() => {
  vi.clearAllMocks();
  for (const k of ENV_KEYS) {
    savedEnv[k] = process.env[k];
    delete process.env[k];
  }
  process.env.OS_MCP_SERVER_ENABLED = 'true';
});
afterEach(() => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
});

/** The options a real AuthManager hands `oauthProvider()`. */
async function captureProviderOptions(): Promise<any> {
  const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  try {
    await new AuthManager({ secret: SECRET, baseUrl: BASE_URL }).getAuthInstance();
  } finally {
    warnSpy.mockRestore();
  }
  const opts = (oauthProvider as any).mock.calls.at(-1)?.[0];
  expect(opts, 'AuthManager must register the oauthProvider plugin').toBeDefined();
  return opts;
}

/**
 * A REAL better-auth server carrying the REAL oauth provider (from `opts`) and
 * the REAL organization plugin, on the in-memory adapter. Table names are
 * derived from each plugin's own resolved schema, so they are the platform's
 * `sys_*` names whenever a plugin resolves to them.
 */
async function bootServer(opts: any) {
  const [{ betterAuth }, { memoryAdapter }, { jwt }, { organization }, { oauthProvider: realOauthProvider }] =
    await Promise.all([
      vi.importActual<typeof import('better-auth')>('better-auth'),
      import('better-auth/adapters/memory'),
      import('better-auth/plugins'),
      import('better-auth/plugins/organization'),
      vi.importActual<typeof import('@better-auth/oauth-provider')>('@better-auth/oauth-provider'),
    ]);

  const provider = realOauthProvider(opts);
  const orgPlugin = organization();
  // ⛔ The same schema the platform gives `jwt()` — a bare `jwt()` comes back
  // mapped to `sys_jwks` anyway once AuthManager has built one in this process
  // (see auth-manager.mcp-oauth-resource.test.ts).
  const jwtPlugin = jwt({ schema: buildJwtPluginSchema() as any });

  const db: Record<string, any[]> = {};
  for (const m of ['user', 'session', 'account', 'verification']) db[m] = [];
  for (const plugin of [provider, orgPlugin, jwtPlugin] as any[]) {
    for (const [model, def] of Object.entries((plugin.schema ?? {}) as Record<string, { modelName?: string }>)) {
      db[def.modelName ?? model] = db[def.modelName ?? model] ?? [];
    }
  }

  const auth = betterAuth({
    baseURL: BASE_URL,
    basePath: AUTH_BASE_PATH,
    secret: SECRET,
    database: memoryAdapter(db),
    emailAndPassword: { enabled: true },
    plugins: [jwtPlugin, orgPlugin as any, provider as any],
  });
  await auth.$context;

  const providerSchema = (provider as any).schema as Record<string, { modelName?: string }>;
  const consentModel = providerSchema?.oauthConsent?.modelName ?? 'oauthConsent';
  const refreshModel = providerSchema?.oauthRefreshToken?.modelName ?? 'oauthRefreshToken';
  return {
    auth,
    consentModel,
    refreshModel,
    /** The stored rows, by the platform's column name. */
    consentRows: () => db[consentModel] ?? [],
    refreshRows: () => db[refreshModel] ?? [],
  };
}

type Server = Awaited<ReturnType<typeof bootServer>>;

async function post(server: Server, path: string, body: unknown, cookie?: string) {
  const res = await server.auth.handler(
    new Request(`${ISSUER}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: BASE_URL, ...(cookie ? { cookie } : {}) },
      body: JSON.stringify(body),
    }),
  );
  return { res, body: (await res.json().catch(() => null)) as any };
}

async function registerClient(server: Server): Promise<string> {
  const { res, body } = await post(server, '/oauth2/register', {
    client_name: 'Claude Code (test)',
    redirect_uris: [REDIRECT_URI],
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'],
    token_endpoint_auth_method: 'none',
    application_type: 'native',
    scope: SCOPE,
  });
  expect(res.status, JSON.stringify(body)).toBe(201);
  return body.client_id as string;
}

async function signUp(server: Server, email: string): Promise<string> {
  const { res, body } = await post(server, '/sign-up/email', { email, password: 'password-12345', name: 'Mia' });
  expect(res.status, JSON.stringify(body)).toBe(200);
  return String(res.headers.get('set-cookie') ?? '')
    .split(',')
    .map((c: string) => c.split(';')[0]!.trim())
    .join('; ');
}

/** Creates an organization; better-auth makes it the session's active one. */
async function createOrganization(server: Server, cookie: string, slug: string): Promise<string> {
  const { res, body } = await post(server, '/organization/create', { name: slug, slug }, cookie);
  expect(res.status, JSON.stringify(body)).toBe(200);
  expect(body?.id, 'organization/create returned no id').toBeTruthy();
  return body.id as string;
}

async function setActiveOrganization(server: Server, cookie: string, organizationId: string): Promise<void> {
  const { res, body } = await post(server, '/organization/set-active', { organizationId }, cookie);
  expect(res.status, JSON.stringify(body)).toBe(200);
}

/** The session row's own active organization — read back so a leg states what it ran under. */
async function sessionActiveOrganization(server: Server, cookie: string): Promise<string | null | undefined> {
  const res = await server.auth.handler(new Request(`${ISSUER}/get-session`, { headers: { cookie } }));
  const body: any = await res.json();
  return body?.session?.activeOrganizationId;
}

async function authorize(server: Server, clientId: string, cookie: string, extra: Record<string, string> = {}) {
  const url = new URL(`${ISSUER}/oauth2/authorize`);
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('redirect_uri', REDIRECT_URI);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', SCOPE);
  url.searchParams.set('state', 'st');
  url.searchParams.set('code_challenge', PKCE_CHALLENGE);
  url.searchParams.set('code_challenge_method', 'S256');
  url.searchParams.set('resource', MCP_RESOURCE);
  for (const [k, v] of Object.entries(extra)) url.searchParams.set(k, v);
  const res = await server.auth.handler(new Request(url.toString(), { method: 'GET', headers: { cookie } }));
  return res.headers.get('location') ?? '';
}

/** An authorize answer that skipped the consent page and handed back a code. */
function codeOf(location: string): string | null {
  return location.startsWith(REDIRECT_URI) ? new URL(location).searchParams.get('code') : null;
}

function isConsentPrompt(location: string): boolean {
  return location.includes('/oauth/consent') && codeOf(location) === null;
}

async function consent(server: Server, consentLocation: string, cookie: string): Promise<string> {
  expect(isConsentPrompt(consentLocation), `expected a consent prompt, got ${consentLocation}`).toBe(true);
  const { body } = await post(
    server,
    '/oauth2/consent',
    { accept: true, oauth_query: consentLocation.slice(consentLocation.indexOf('?')) },
    cookie,
  );
  const target = body?.redirect_uri ?? body?.url;
  expect(target, `consent did not produce a redirect: ${JSON.stringify(body)}`).toBeTruthy();
  const code = codeOf(target);
  expect(code, `consent returned no authorization code: ${target}`).toBeTruthy();
  return code!;
}

async function tokenRequest(server: Server, params: Record<string, string>) {
  const res = await server.auth.handler(
    new Request(`${ISSUER}/oauth2/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(params).toString(),
    }),
  );
  const body: any = await res.json().catch(() => null);
  expect(res.status, JSON.stringify(body)).toBe(200);
  expect(body?.access_token, 'no access token was minted').toBeTruthy();
  return body as { access_token: string; refresh_token?: string };
}

const exchange = (server: Server, clientId: string, code: string) =>
  tokenRequest(server, {
    grant_type: 'authorization_code',
    code,
    redirect_uri: REDIRECT_URI,
    client_id: clientId,
    code_verifier: PKCE_VERIFIER,
    resource: MCP_RESOURCE,
  });

const refresh = (server: Server, clientId: string, refreshToken: string) =>
  tokenRequest(server, {
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    client_id: clientId,
    resource: MCP_RESOURCE,
  });

function claimsOf(token: string): Record<string, unknown> {
  const parts = token.split('.');
  expect(parts.length, 'access token must be a signed JWT').toBe(3);
  return JSON.parse(Buffer.from(parts[1]!, 'base64url').toString('utf8'));
}

/** A real AuthManager verifying against the running server's JWKS. */
function verifier(server: Server): AuthManager {
  const m = new AuthManager({ secret: SECRET, baseUrl: BASE_URL });
  vi.spyOn(m, 'getApi').mockResolvedValue({ getJwks: async () => await server.auth.api.getJwks() } as any);
  return m;
}

/** Drives a first consent for a fresh user and returns everything a leg reads. */
async function consentedGrant(server: Server, clientId: string, cookie: string, extra: Record<string, string> = {}) {
  const code = await consent(server, await authorize(server, clientId, cookie, extra), cookie);
  const tokens = await exchange(server, clientId, code);
  expect(tokens.refresh_token, 'offline_access must earn a refresh token').toBeTruthy();
  return tokens;
}

describe('an OAuth consent binds the consenting session\'s active organization', () => {
  it('records it on the consent and the refresh family, mints it as `organization_id`, and verifyMcpAccessToken returns it', async () => {
    const server = await bootServer(await captureProviderOptions());
    const clientId = await registerClient(server);
    const cookie = await signUp(server, 'mia@acme.example.com');
    const orgA = await createOrganization(server, cookie, 'acme-a');
    expect(await sessionActiveOrganization(server, cookie), 'the leg runs under org A').toBe(orgA);

    const tokens = await consentedGrant(server, clientId, cookie);
    const claims = claimsOf(tokens.access_token);

    expect(claims.organization_id, 'the token carries the consenting session\'s organization').toBe(orgA);
    expect(server.consentRows().map((r) => r.reference_id), 'the consent row records it').toEqual([orgA]);
    expect(server.refreshRows().map((r) => r.reference_id), 'the refresh family records it').toEqual([orgA]);
    expect(await verifier(server).verifyMcpAccessToken(tokens.access_token)).toEqual({
      userId: claims.sub,
      scopes: SCOPE.split(' '),
      clientId,
      organizationId: orgA,
    });
  });

  it('a refresh keeps the consent\'s organization — not the organization the session holds now', async () => {
    const server = await bootServer(await captureProviderOptions());
    const clientId = await registerClient(server);
    const cookie = await signUp(server, 'mia@acme.example.com');
    const orgA = await createOrganization(server, cookie, 'acme-a');
    const tokens = await consentedGrant(server, clientId, cookie);

    // The user moves the browser session to another organization after
    // consenting. The agent must not move with it.
    const orgB = await createOrganization(server, cookie, 'acme-b');
    expect(await sessionActiveOrganization(server, cookie), 'the session now holds org B').toBe(orgB);

    const refreshed = await refresh(server, clientId, tokens.refresh_token!);
    expect(claimsOf(refreshed.access_token).organization_id).toBe(orgA);
    expect((await verifier(server).verifyMcpAccessToken(refreshed.access_token))?.organizationId).toBe(orgA);
  });

  it('no active organization at consent ⇒ no reference, no claim, and no `organizationId`', async () => {
    const server = await bootServer(await captureProviderOptions());
    const clientId = await registerClient(server);
    const cookie = await signUp(server, 'pat@acme.example.com');
    expect(await sessionActiveOrganization(server, cookie), 'the leg runs with no organization').toBeFalsy();

    const tokens = await consentedGrant(server, clientId, cookie);
    const claims = claimsOf(tokens.access_token);

    expect(Object.keys(claims), 'never a guessed or default organization').not.toContain('organization_id');
    expect(server.consentRows().map((r) => r.reference_id ?? null)).toEqual([null]);
    expect(server.refreshRows().map((r) => r.reference_id ?? null)).toEqual([null]);
    expect(await verifier(server).verifyMcpAccessToken(tokens.access_token)).toEqual({
      userId: claims.sub,
      scopes: SCOPE.split(' '),
      clientId,
    });
  });

  it('the authorize request cannot choose the organization — organization-looking parameters change nothing recorded', async () => {
    const server = await bootServer(await captureProviderOptions());
    const clientId = await registerClient(server);
    const cookie = await signUp(server, 'mia@acme.example.com');
    const orgA = await createOrganization(server, cookie, 'acme-a');
    // A REAL organization the user belongs to, so a parameter naming it is a
    // plausible choice rather than a value the server could reject on sight.
    const orgB = await createOrganization(server, cookie, 'acme-b');
    await setActiveOrganization(server, cookie, orgA);
    expect(await sessionActiveOrganization(server, cookie), 'the session holds org A').toBe(orgA);

    const tokens = await consentedGrant(server, clientId, cookie, {
      organization_id: orgB,
      organizationId: orgB,
      reference_id: orgB,
      referenceId: orgB,
    });

    expect(claimsOf(tokens.access_token).organization_id).toBe(orgA);
    expect(server.consentRows().map((r) => r.reference_id)).toEqual([orgA]);
    expect(server.refreshRows().map((r) => r.reference_id)).toEqual([orgA]);
  });
});

describe('existing consents re-confirm once (ruling 6232069920, item 4)', () => {
  it('a consent with no reference re-prompts once under an organization; an old refresh family stays unbound', async () => {
    const server = await bootServer(await captureProviderOptions());
    const clientId = await registerClient(server);
    const cookie = await signUp(server, 'mia@acme.example.com');

    // A consent and a refresh family with NO reference — the shape every
    // consent stored before this binding has.
    const old = await consentedGrant(server, clientId, cookie);
    expect(server.consentRows().map((r) => r.reference_id ?? null)).toEqual([null]);

    // Control: that consent is a valid one. With no organization in play the
    // provider honours it and hands back a code without a prompt, so the
    // re-prompt below is caused by the organization and nothing else.
    expect(codeOf(await authorize(server, clientId, cookie)), 'the stored consent is honoured').toBeTruthy();

    const orgA = await createOrganization(server, cookie, 'acme-a');

    // Re-prompt: the stored consent does not satisfy an authorize made in an
    // organization.
    const prompt = await authorize(server, clientId, cookie);
    expect(isConsentPrompt(prompt), `an unbound consent must re-prompt, got ${prompt}`).toBe(true);
    const bound = await exchange(server, clientId, await consent(server, prompt, cookie));
    expect(claimsOf(bound.access_token).organization_id).toBe(orgA);
    expect(server.consentRows().map((r) => r.reference_id ?? null).sort()).toEqual([orgA, null].sort());

    // ONCE: the re-confirmed consent is honoured from here on.
    const again = codeOf(await authorize(server, clientId, cookie));
    expect(again, 'a re-confirmed consent must not prompt a second time').toBeTruthy();
    expect(claimsOf((await exchange(server, clientId, again!)).access_token).organization_id).toBe(orgA);

    // Until it re-confirms, an old refresh family has global grants only: it
    // carries its own (null) reference, never the session's organization.
    const oldFamily = await refresh(server, clientId, old.refresh_token!);
    expect(Object.keys(claimsOf(oldFamily.access_token))).not.toContain('organization_id');
    expect((await verifier(server).verifyMcpAccessToken(oldFamily.access_token))?.organizationId).toBeUndefined();
  });
});
