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
 * 4. The wrong-resource control asks the SAME server, over the SAME client and
 *    session, for a resource that was never registered, and requires
 *    `invalid_target`. Without it a green suite cannot tell "we registered the
 *    MCP resource" from "resource checking is off": seeding by wildcard, or a
 *    build that stopped resolving `resource` at all, leaves 1-3 green. It is
 *    written as a DIFFERENTIAL — accepted resource and refused resource in one
 *    run, one variable apart — so it reddens from either side: remove the
 *    registration and the accepted half fails; widen it and the refused half
 *    does.
 * 5. [#16418] The principal-binding block does the same for
 *    `verifyMcpAccessToken`: it mints a REAL `client_credentials` token from
 *    this server and hands it to a real AuthManager verifying against this
 *    server's JWKS. The refusal it pins used to be asserted against a
 *    HAND-BUILT token with no `sub` at all — a shape the provider does not
 *    mint — so that assertion passed for years while the method admitted
 *    every real M2M token. A minted token is the only subject that can tell
 *    those two apart, and the user leg beside it is the differential: same
 *    server, same JWKS, same audience, one variable (which grant produced the
 *    token).
 */

import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import path from 'node:path';
import fs from 'node:fs';

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { AuthManager } from './auth-manager';
import { buildJwtPluginSchema } from './auth-schema-config.js';

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
// Never registered as an `oauthResource` row, and never advertised by the RFC
// 9728 document. The AS must refuse it for the same client that the MCP
// resource is granted to.
const UNREGISTERED_RESOURCE = `${BASE_URL}/api/v1/other`;
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

/**
 * The options AuthManager actually hands `oauthProvider()`, together with the
 * RFC 9728 document the SAME manager advertises. Both come from one manager on
 * purpose: the defect class here is a drift between the resource identifier a
 * client is TOLD to request and the one the AS will accept, and only a reading
 * that carries both can see it.
 */
async function captureProviderOptions(): Promise<any> {
  return (await captureManagerSurface()).opts;
}

async function captureManagerSurface(): Promise<{ opts: any; discovery: any }> {
  process.env.OS_MCP_SERVER_ENABLED = 'true';
  const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  let discovery: any;
  try {
    const manager = new AuthManager({
      secret: 'test-secret-at-least-32-chars-long',
      baseUrl: BASE_URL,
    });
    await manager.getAuthInstance();
    discovery = manager.getMcpProtectedResourceMetadata();
  } finally {
    warnSpy.mockRestore();
  }
  const opts = (oauthProvider as any).mock.calls.at(-1)?.[0];
  expect(opts, 'AuthManager must register the oauthProvider plugin').toBeDefined();
  return { opts, discovery };
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

  // ⛔ `jwt()` must be given the SAME schema the platform gives it. Two
  // reasons, and the second is a trap: (1) the harness should carry the
  // deployment's real table names; (2) better-auth 1.7.2's `jwt()` MUTATES its
  // shared default schema object, so once anything in this process has built
  // `jwt({ schema: buildJwtPluginSchema() })` — AuthManager does, above — a
  // later bare `jwt()` silently comes back mapped to `sys_jwks` too, and the
  // token endpoint 500s on a model this store never created.
  const jwtPlugin = jwt({ schema: buildJwtPluginSchema() as any });
  const jwksModel = (jwtPlugin as any).schema?.jwks?.modelName ?? 'jwks';
  db[jwksModel] = db[jwksModel] ?? [];

  const auth = betterAuth({
    baseURL: BASE_URL,
    basePath: AUTH_BASE_PATH,
    secret: 'test-secret-at-least-32-chars-long',
    database: memoryAdapter(db),
    emailAndPassword: { enabled: true },
    plugins: [jwtPlugin, plugin as any],
  });
  // Forces plugin `init` — which is where the provider seeds `resources`.
  await auth.$context;

  // The schema maps these onto ObjectStack's `sys_oauth_*` tables, so resolve
  // the store keys through it rather than assuming better-auth's model names.
  const resourceModel = pluginSchema?.oauthResource?.modelName ?? 'oauthResource';
  const clientResourceModel = pluginSchema?.oauthClientResource?.modelName ?? 'oauthClientResource';
  const accessTokenModel = pluginSchema?.oauthAccessToken?.modelName ?? 'oauthAccessToken';
  const refreshTokenModel = pluginSchema?.oauthRefreshToken?.modelName ?? 'oauthRefreshToken';

  return {
    auth,
    db,
    rows: () => ({
      resource: db[resourceModel]?.length ?? 0,
      clientResource: db[clientResourceModel]?.length ?? 0,
    }),
    /** Keyed by the platform table names the bug report counted. */
    tableCounts: () => ({
      [resourceModel]: db[resourceModel]?.length ?? 0,
      [clientResourceModel]: db[clientResourceModel]?.length ?? 0,
      [accessTokenModel]: db[accessTokenModel]?.length ?? 0,
      [refreshTokenModel]: db[refreshTokenModel]?.length ?? 0,
    }),
    resourceRows: () => db[resourceModel] ?? [],
    clientResourceRows: () => db[clientResourceModel] ?? [],
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
  const cookie = String(res.headers.get('set-cookie') ?? '')
    .split(',')
    .map((c: string) => c.split(';')[0]!.trim())
    .join('; ');
  return cookie;
}

async function authorizeWithResource(
  auth: any,
  clientId: string,
  cookie: string,
  resource: string = MCP_RESOURCE,
) {
  const url = new URL(`${ISSUER}/oauth2/authorize`);
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('redirect_uri', REDIRECT_URI);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', 'openid profile email offline_access data:read');
  url.searchParams.set('state', 'st');
  url.searchParams.set('code_challenge', PKCE_CHALLENGE);
  url.searchParams.set('code_challenge_method', 'S256');
  url.searchParams.set('resource', resource);
  const res = await auth.handler(new Request(url.toString(), { method: 'GET', headers: { cookie } }));
  return { status: res.status, location: res.headers.get('location') ?? '' };
}

/**
 * Drives the consent POST the authorize redirect asks for and returns the
 * authorization code. Fails loudly rather than returning an empty code, so a
 * caller can never mistake "consent broke" for "the grant was refused".
 */
async function consentToCode(auth: any, azLocation: string, cookie: string): Promise<string> {
  const consentRes = await auth.handler(
    new Request(`${ISSUER}/oauth2/consent`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie, origin: BASE_URL },
      body: JSON.stringify({ accept: true, oauth_query: azLocation.slice(azLocation.indexOf('?')) }),
    }),
  );
  const consentBody: any = await consentRes.json().catch(() => null);
  const target = consentBody?.redirect_uri ?? consentBody?.url;
  expect(target, `consent did not produce a redirect: ${JSON.stringify(consentBody)}`).toBeTruthy();
  const code = new URL(target).searchParams.get('code');
  expect(code, `consent returned no authorization code: ${target}`).toBeTruthy();
  return code!;
}

function decodeJwtPayload(token: string): any {
  const parts = token.split('.');
  expect(parts.length, 'access token must be a signed JWT').toBe(3);
  return JSON.parse(Buffer.from(parts[1]!, 'base64url').toString('utf8'));
}

/**
 * The at-rest form the installed provider expects for a client secret. 1.7.2
 * defaults `storeClientSecret` to `"hashed"` whenever the jwt plugin is on
 * (it is here), and hashes with SHA-256 → unpadded base64url. Seeding the raw
 * secret instead produces `invalid_client`, i.e. NO token — which the mint
 * assertions below turn into a loud failure rather than a quiet "refused".
 */
function storedClientSecret(secret: string): string {
  return createHash('sha256').update(secret).digest('base64url');
}

const M2M_CLIENT_ID = 'headless-integration-client';
const M2M_CLIENT_SECRET = 'headless-integration-secret';

/**
 * Registers a CONFIDENTIAL `client_credentials` client on the running AS and
 * links it to the MCP resource — the shape #16418's trace names: a client row
 * carrying `client_credentials_scopes`, plus the `oauthClientResource` link
 * `enforcePerClientResources` requires.
 *
 * ⚠️ Seeded through the AS's OWN adapter, not by pushing a row into the store:
 * the memory adapter persists under the schema's `fieldName` mapping
 * (`client_credentials_scopes`, not `clientCredentialsScopes`), so a raw push
 * is not found and the grant fails as "missing client" — a refusal for the
 * wrong reason. It is also NOT registered through DCR, because 1.7.2 refuses
 * `client_credentials` in an unauthenticated registration and only an
 * administrative registration may set the scope ceiling.
 */
async function seedClientCredentialsClient(server: { auth: any; pluginSchema?: any }) {
  const ctx = await server.auth.$context;
  await ctx.adapter.create({
    model: 'oauthClient',
    data: {
      clientId: M2M_CLIENT_ID,
      clientSecret: storedClientSecret(M2M_CLIENT_SECRET),
      name: 'Headless integration',
      redirectUris: [REDIRECT_URI],
      grantTypes: ['client_credentials'],
      responseTypes: [],
      tokenEndpointAuthMethod: 'client_secret_post',
      scopes: ['data:read'],
      clientCredentialsScopes: ['data:read'],
      disabled: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  });
  await ctx.adapter.create({
    model: 'oauthClientResource',
    data: { clientId: M2M_CLIENT_ID, resourceId: MCP_RESOURCE, createdAt: new Date() },
  });
}

/** Runs the real `client_credentials` grant and returns the minted token. */
async function mintClientCredentialsToken(server: { auth: any }): Promise<string> {
  const res = await server.auth.handler(
    new Request(`${ISSUER}/oauth2/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: M2M_CLIENT_ID,
        client_secret: M2M_CLIENT_SECRET,
        scope: 'data:read',
        resource: MCP_RESOURCE,
      }).toString(),
    }),
  );
  const body: any = await res.json().catch(() => null);
  // ⛔ "the grant failed" must never be spellable as "the door refused it".
  expect(res.status, `the client_credentials grant did not mint a token: ${JSON.stringify(body)}`).toBe(200);
  expect(body?.access_token, 'no M2M access token was minted').toBeTruthy();
  return body.access_token as string;
}

/**
 * An AuthManager whose JWKS comes from the RUNNING authorization server, so
 * `verifyMcpAccessToken` verifies signatures the same server produced. Issuer
 * and audience already agree by construction (both derive from BASE_URL).
 */
function managerVerifyingAgainst(server: { auth: any }): AuthManager {
  process.env.OS_MCP_SERVER_ENABLED = 'true';
  const m = new AuthManager({ secret: 'test-secret-at-least-32-chars-long', baseUrl: BASE_URL });
  vi.spyOn(m, 'getApi').mockResolvedValue({
    getJwks: async () => await server.auth.api.getJwks(),
  } as any);
  return m;
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
    const { opts, discovery } = await captureManagerSurface();

    // -- discovery leg (RFC 9728) ----------------------------------------
    // The client learns the resource identifier HERE and asks for exactly this
    // string below - it is never re-typed from a constant. That is the point:
    // an AS that seeds one spelling while advertising another reproduces this
    // very defect, and a flow that hard-codes the resource cannot see it.
    expect(discovery?.resource, 'discovery must advertise the MCP resource').toBe(MCP_RESOURCE);
    expect(discovery?.authorization_servers).toEqual([ISSUER]);
    const advertisedResource: string = discovery.resource;
    expect(
      opts.resources,
      'the AS must be seeded with the SAME identifier discovery advertises',
    ).toContain(advertisedResource);

    const server = await bootRealAuthorizationServer(opts);

    expect(server.tableCounts()).toEqual({
      sys_oauth_resource: 1,
      sys_oauth_client_resource: 0,
      sys_oauth_access_token: 0,
      sys_oauth_refresh_token: 0,
    });

    const reg = await registerDcrClient(server.auth);
    expect(reg.status, JSON.stringify(reg.body)).toBe(201);
    const cookie = await signUp(server.auth);

    const az = await authorizeWithResource(server.auth, reg.body.client_id, cookie, advertisedResource);
    expect(az.location).not.toContain('invalid_target');

    const code = await consentToCode(server.auth, az.location, cookie);

    const tokenRes = await server.auth.handler(
      new Request(`${ISSUER}/oauth2/token`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          code,
          redirect_uri: REDIRECT_URI,
          client_id: reg.body.client_id,
          code_verifier: PKCE_VERIFIER,
          resource: advertisedResource,
        }).toString(),
      }),
    );
    const tokenBody: any = await tokenRes.json().catch(() => null);
    expect(tokenRes.status, JSON.stringify(tokenBody)).toBe(200);
    expect(tokenBody.access_token, 'no token was minted').toBeTruthy();

    const payload = decodeJwtPayload(tokenBody.access_token);
    const aud = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
    expect(aud, 'the minted token must be audienced to the MCP resource').toContain(advertisedResource);
    expect(payload.iss).toBe(ISSUER);

    // The three tables the bug report counted, plus the refresh row. ⚠️
    // `sys_oauth_access_token` legitimately stays 0: the jwt plugin is on, so
    // the access token is a signed JWT and 1.7.2 only persists a row for the
    // OPAQUE variant (`createOpaqueAccessToken`). The minted-token evidence is
    // the JWT above; the persisted evidence of a completed grant is the
    // refresh row, which `offline_access` earns.
    expect(server.tableCounts()).toEqual({
      sys_oauth_resource: 1,
      sys_oauth_client_resource: 1,
      sys_oauth_access_token: 0,
      sys_oauth_refresh_token: 1,
    });
  });

  it('keeps the per-client resource check ON — an unlinked client is still refused', async () => {
    const opts = await captureProviderOptions();
    // Route (b) — `enforcePerClientResources: false` — would make the checks
    // above pass by switching a security check off instead of satisfying it.
    // This guard is what tells the two routes apart.
    expect(opts.enforcePerClientResources, 'the per-client resource check must not be disabled').not.toBe(false);

    const server = await bootRealAuthorizationServer(opts);
    const reg = await registerDcrClient(server.auth);
    expect(reg.status, JSON.stringify(reg.body)).toBe(201);
    const cookie = await signUp(server.auth);

    // Drop the link the DCR defaults created. Everything else about the client
    // is untouched, so the ONLY difference from the passing flow above is the
    // per-client authorisation this check is supposed to enforce.
    server.clientResourceRows().length = 0;

    const az = await authorizeWithResource(server.auth, reg.body.client_id, cookie);
    expect(
      az.location,
      'a client with no oauthClientResource row must NOT be able to request the MCP resource — '
        + 'if this passes, enforcePerClientResources has been switched off',
    ).toContain('invalid_target');
  });

  it('still refuses an UNREGISTERED resource at authorize — the fix registers ONE resource, it does not switch resource checking off', async () => {
    // ⛔ No assertion here on `opts.resources`. Asserting the option we passed
    // is the very shape this file exists to replace — it would stay green under
    // a provider that ignored the option. Every reading below is taken from the
    // running AS.
    const opts = await captureProviderOptions();
    const server = await bootRealAuthorizationServer(opts);
    const reg = await registerDcrClient(server.auth);
    expect(reg.status, JSON.stringify(reg.body)).toBe(201);
    const cookie = await signUp(server.auth);

    // DIFFERENTIAL. Same server, same client, same session, same scopes — the
    // ONLY difference between these two requests is the `resource` value, so
    // the pair isolates exactly the thing under test. Asserting both halves in
    // one run is what makes this control refutable from both sides: drop the
    // registration and the granted half fails, widen the registration and the
    // refused half does.
    const granted = await authorizeWithResource(server.auth, reg.body.client_id, cookie, MCP_RESOURCE);
    expect(granted.location, 'the registered MCP resource must still be granted').not.toContain('invalid_target');
    expect(granted.location, 'the registered MCP resource must reach consent').toContain('/oauth/consent');

    const refused = await authorizeWithResource(
      server.auth,
      reg.body.client_id,
      cookie,
      UNREGISTERED_RESOURCE,
    );
    expect(
      refused.location,
      `a resource that was never registered must still be refused, and this client was just `
        + `granted ${MCP_RESOURCE} in the same run — if this passes, the AS is accepting `
        + `resources it was never told about, which is "resource checking is off", not "the MCP `
        + `resource is registered"`,
    ).toContain('invalid_target');
    expect(refused.location, 'the refusal must not leak into a consent hand-off').not.toContain('/oauth/consent');

    // Read from the AS's own store, not from the options: exactly one resource
    // was seeded and it is the MCP one. A wildcard or catch-all seed shows up
    // here, and would have shown up one assertion earlier as a granted
    // redirect for a resource nobody registered.
    expect(
      server.resourceRows().map((r: any) => r.identifier),
      'the AS must hold exactly the one resource this fix registers',
    ).toEqual([MCP_RESOURCE]);
  });

  it('refuses at /oauth2/token a resource that was not bound at authorize', async () => {
    const opts = await captureProviderOptions();
    const server = await bootRealAuthorizationServer(opts);
    const reg = await registerDcrClient(server.auth);
    expect(reg.status, JSON.stringify(reg.body)).toBe(201);
    const cookie = await signUp(server.auth);

    // A complete, VALID grant for the MCP resource — so the only defect the
    // exchange below can carry is the swapped `resource`.
    const az = await authorizeWithResource(server.auth, reg.body.client_id, cookie, MCP_RESOURCE);
    expect(az.location).not.toContain('invalid_target');
    const code = await consentToCode(server.auth, az.location, cookie);

    const tokenRes = await server.auth.handler(
      new Request(`${ISSUER}/oauth2/token`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          code,
          redirect_uri: REDIRECT_URI,
          client_id: reg.body.client_id,
          code_verifier: PKCE_VERIFIER,
          resource: UNREGISTERED_RESOURCE,
        }).toString(),
      }),
    );
    const tokenBody: any = await tokenRes.json().catch(() => null);
    expect(
      tokenRes.status,
      `redeeming a code bound to ${MCP_RESOURCE} against ${UNREGISTERED_RESOURCE} must fail: `
        + JSON.stringify(tokenBody),
    ).not.toBe(200);
    expect(tokenBody?.error, JSON.stringify(tokenBody)).toBe('invalid_target');
    expect(tokenBody?.access_token, 'no token may be minted for an unbound resource').toBeFalsy();
  });
});

describe('[#16418] MCP is principal-bound — a minted client_credentials token resolves to NO principal', () => {
  it('mints a REAL M2M token whose `sub` is the client id and which carries no `sid` (the claim reading, off the token)', async () => {
    const opts = await captureProviderOptions();
    const server = await bootRealAuthorizationServer(opts);
    await seedClientCredentialsClient(server);

    const payload = decodeJwtPayload(await mintClientCredentialsToken(server));

    // Re-derive #3 from the card, kept live: the subject is read OFF THE
    // TOKEN, never inferred from the provider's source. This is the fact the
    // docblock used to deny ("carries no `sub`").
    expect(payload.sub, 'the M2M token must carry a subject at all').toBeTruthy();
    expect(payload.sub, "and that subject is the CLIENT — RFC 9068 §2.2.3.1's no-resource-owner shape").toBe(
      M2M_CLIENT_ID,
    );
    expect(payload.client_id).toBe(M2M_CLIENT_ID);
    expect(payload.azp).toBe(M2M_CLIENT_ID);
    // Measured absence, recorded because it names the discriminator this fix
    // deliberately did NOT choose: `sid` separates the two shapes today, but
    // it is upstream-optional (already gated per client on ID tokens), so
    // relying on it would 401 every human the moment a bump gated it here.
    expect(payload.sid, 'no session exists behind a client_credentials grant').toBeUndefined();
  });

  it('DIFFERENTIAL: same server, same JWKS — the user token resolves, the M2M token does not', async () => {
    const opts = await captureProviderOptions();
    const server = await bootRealAuthorizationServer(opts);
    await seedClientCredentialsClient(server);
    const manager = managerVerifyingAgainst(server);

    // -- machine leg -------------------------------------------------------
    const m2mToken = await mintClientCredentialsToken(server);
    expect(
      await manager.verifyMcpAccessToken(m2mToken),
      'a client_credentials token must assemble NO principal on the MCP surface — '
        + 'headless callers use API keys (ADR-0101 D1), which is a separate chain entirely',
    ).toBeNull();

    // -- human leg (the negative control) ----------------------------------
    // The full flow on the SAME server: DCR → sign-up → authorize → consent →
    // token. If this half went red the refusal above would be worthless — a
    // method that refuses everything satisfies it.
    const reg = await registerDcrClient(server.auth);
    expect(reg.status, JSON.stringify(reg.body)).toBe(201);
    const cookie = await signUp(server.auth);
    const az = await authorizeWithResource(server.auth, reg.body.client_id, cookie, MCP_RESOURCE);
    expect(az.location).not.toContain('invalid_target');
    const code = await consentToCode(server.auth, az.location, cookie);
    const tokenRes = await server.auth.handler(
      new Request(`${ISSUER}/oauth2/token`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          code,
          redirect_uri: REDIRECT_URI,
          client_id: reg.body.client_id,
          code_verifier: PKCE_VERIFIER,
          resource: MCP_RESOURCE,
        }).toString(),
      }),
    );
    const tokenBody: any = await tokenRes.json().catch(() => null);
    expect(tokenRes.status, JSON.stringify(tokenBody)).toBe(200);
    const userToken: string = tokenBody.access_token;
    const userPayload = decodeJwtPayload(userToken);

    expect(
      await manager.verifyMcpAccessToken(userToken),
      'an authorization-code token must still resolve — this narrows the M2M shape and nothing else',
    ).toEqual({
      userId: userPayload.sub,
      scopes: ['openid', 'profile', 'email', 'offline_access', 'data:read'],
      clientId: reg.body.client_id,
    });

    // The one variable between the two legs, stated as an assertion: the
    // human token's subject is NOT its client, the machine token's subject IS.
    expect(userPayload.sub).not.toBe(userPayload.client_id);
    expect(decodeJwtPayload(m2mToken).sub).toBe(decodeJwtPayload(m2mToken).client_id);
  });
});
