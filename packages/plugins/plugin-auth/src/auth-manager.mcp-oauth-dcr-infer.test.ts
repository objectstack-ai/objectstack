// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * MCP OAuth: anonymous Dynamic Client Registration (RFC 7591) by a client that
 * sends NO `application_type` (#25118, ruling 6329352251, A1). Every reading
 * is taken from the REAL `@better-auth/oauth-provider`, booted from the exact
 * options AuthManager hands it, never from that options object.
 *
 * ## Why this file exists
 *
 * Local MCP clients (Claude Code, Cursor, VS Code, Codex CLI) register with a
 * loopback `http` or a custom-scheme redirect and omit `application_type`. The
 * provider's default filled the missing type with `web` and refused both
 * redirect forms, so the client failed before its browser opened.
 * `auth-manager.mcp-oauth-resource.test.ts` registers with an explicit
 * `application_type: 'native'`, which is why it stayed green through that
 * defect. Every body below omits the field the way those clients do, and the
 * first cell sends the card's own request body byte for byte.
 *
 * ## The boundary as measured, not as it reads
 *
 * 1. A public client with a loopback (`localhost`, `127.0.0.1`) or a
 *    custom-scheme redirect registers as `native`.
 * 2. `https://evil.example/cb` alone stays `web`; `http://evil.example/cb` and
 *    `http://localhost.evil.example` stay refused; an explicit `web` with a
 *    loopback redirect stays refused (a sent type is never overridden).
 * 3. The provider classifies by redirect URIs and never reads
 *    `token_endpoint_auth_method`. So this is NOT "public clients only": a
 *    CONFIDENTIAL registration with a loopback or custom-scheme redirect and no
 *    type registers as `native` and is issued a `client_secret`. The same body
 *    with `application_type: 'native'` spelled out was already accepted.
 *    "Any redirect qualifies" also lets an https redirect ride beside a
 *    loopback one in the same body.
 * 4. For EVERY client registered here, /oauth2/authorize without PKCE is
 *    refused, and the same request with S256 PKCE reaches consent. The pair
 *    differs only in the PKCE parameters, so the refusal cannot have another
 *    cause.
 * 5. With DCR off the option opens nothing: the card's body is refused.
 */

import { describe, it, expect, vi, beforeAll } from 'vitest';

import { AuthManager } from './auth-manager';
import { buildJwtPluginSchema } from './auth-schema-config.js';

// Same pattern as auth-manager.mcp-oauth-resource.test.ts: better-auth is
// mocked so AuthManager's own instance build stays cheap, and the options it
// hands `oauthProvider()` are captured. The server every assertion runs
// against is a SEPARATE, REAL one booted from those options.
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
// RFC 7636 Appendix B challenge.
const PKCE_CHALLENGE = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';

const LOOPBACK = 'http://localhost:63678/callback';
const LOOPBACK_IPV4 = 'http://127.0.0.1:5000/callback';
const CUSTOM_SCHEME = 'cursor://anysphere.cursor-retrieval/oauth/callback';
const HTTPS_FOREIGN = 'https://evil.example/cb';
const HTTP_FOREIGN = 'http://evil.example/cb';
const LOOPBACK_LOOKALIKE = 'http://localhost.evil.example/cb';

/**
 * The card's reproduction body, verbatim: a public client, a loopback `http`
 * redirect, and no `application_type`.
 */
const CARD_BODY = {
  client_name: 'probe',
  redirect_uris: [LOOPBACK],
  grant_types: ['authorization_code', 'refresh_token'],
  response_types: ['code'],
  token_endpoint_auth_method: 'none',
};

/** The card's body with other redirects and/or another auth method. */
function cardBodyWith(overrides: Record<string, unknown>, dropAuthMethod = false): Record<string, unknown> {
  const body: Record<string, unknown> = { ...CARD_BODY, ...overrides };
  if (dropAuthMethod) delete body.token_endpoint_auth_method;
  return body;
}

const ENV_KEYS = ['OS_MCP_SERVER_ENABLED', 'OS_OIDC_PROVIDER_ENABLED', 'OS_OIDC_DCR_ENABLED'] as const;

/**
 * The options AuthManager actually hands `oauthProvider()`, under `env`.
 * The process env is restored before this returns.
 */
async function captureProviderOptions(env: Partial<Record<(typeof ENV_KEYS)[number], string>>): Promise<any> {
  const saved: Record<string, string | undefined> = {};
  for (const k of ENV_KEYS) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
  Object.assign(process.env, env);
  const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  try {
    const manager = new AuthManager({ secret: 'test-secret-at-least-32-chars-long', baseUrl: BASE_URL });
    await manager.getAuthInstance();
  } finally {
    warnSpy.mockRestore();
    for (const k of ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  }
  const opts = (oauthProvider as any).mock.calls.at(-1)?.[0];
  expect(opts, 'AuthManager must register the oauthProvider plugin').toBeDefined();
  return opts;
}

/**
 * Boots a REAL better-auth server carrying the REAL provider configured with
 * `opts`, on the in-memory adapter. The table list is derived from the
 * plugin's own resolved schema, and `jwt()` gets the platform's schema; both
 * reasons are recorded in auth-manager.mcp-oauth-resource.test.ts.
 */
async function bootRealAuthorizationServer(opts: any): Promise<{ auth: any; clientCount: () => number }> {
  const [{ betterAuth }, { memoryAdapter }, { jwt }, { oauthProvider: realOauthProvider }] = await Promise.all([
    vi.importActual<typeof import('better-auth')>('better-auth'),
    import('better-auth/adapters/memory'),
    import('better-auth/plugins'),
    vi.importActual<typeof import('@better-auth/oauth-provider')>('@better-auth/oauth-provider'),
  ]);
  const plugin = realOauthProvider(opts);
  const pluginSchema = (plugin as any).schema as Record<string, { modelName?: string }>;
  const db: Record<string, any[]> = {};
  for (const m of ['user', 'session', 'account', 'verification', 'jwks']) db[m] = [];
  for (const [model, def] of Object.entries(pluginSchema ?? {})) db[def.modelName ?? model] = [];
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
  await auth.$context;
  const clientModel = pluginSchema?.oauthClient?.modelName ?? 'oauthClient';
  return { auth, clientCount: () => db[clientModel]?.length ?? 0 };
}

async function register(auth: any, body: Record<string, unknown>): Promise<{ status: number; body: any }> {
  const res = await auth.handler(
    new Request(`${ISSUER}/oauth2/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
  );
  return { status: res.status, body: (await res.json().catch(() => null)) as any };
}

async function signUp(auth: any): Promise<string> {
  const res = await auth.handler(
    new Request(`${ISSUER}/sign-up/email`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'dev@acme.example.com', password: 'password-12345', name: 'Dev' }),
    }),
  );
  return String(res.headers.get('set-cookie') ?? '')
    .split(',')
    .map((c: string) => c.split(';')[0]!.trim())
    .join('; ');
}

/** GET /oauth2/authorize for `clientId`, with or without S256 PKCE. */
async function authorize(
  auth: any,
  cookie: string,
  clientId: string,
  redirectUri: string,
  pkce: boolean,
): Promise<{ status: number; location: string }> {
  const url = new URL(`${ISSUER}/oauth2/authorize`);
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', 'openid profile email data:read');
  url.searchParams.set('state', 'st');
  url.searchParams.set('resource', MCP_RESOURCE);
  if (pkce) {
    url.searchParams.set('code_challenge', PKCE_CHALLENGE);
    url.searchParams.set('code_challenge_method', 'S256');
  }
  const res = await auth.handler(new Request(url.toString(), { method: 'GET', headers: { cookie } }));
  return { status: res.status, location: res.headers.get('location') ?? '' };
}

describe("DCR of a client that omits application_type, on the real provider (#25118, 'infer')", () => {
  let server: { auth: any; clientCount: () => number };
  let cookie: string;

  beforeAll(async () => {
    // MCP on ⇒ the OAuth provider is wired and DCR follows it (resolveDcrEnabled).
    const opts = await captureProviderOptions({ OS_MCP_SERVER_ENABLED: 'true' });
    server = await bootRealAuthorizationServer(opts);
    cookie = await signUp(server.auth);
  });

  /**
   * The registration is accepted with `applicationType`, and the authorize
   * step refuses it without PKCE while the same request with PKCE reaches
   * consent.
   */
  async function expectRegisteredAndPkceBound(
    body: Record<string, unknown>,
    expected: { applicationType: 'native' | 'web'; authMethod: string; secret: boolean },
  ): Promise<void> {
    const reg = await register(server.auth, body);
    expect(reg.status, JSON.stringify(reg.body)).toBe(201);
    expect(reg.body.client_id, 'a registered client has an id').toBeTruthy();
    expect(reg.body.application_type).toBe(expected.applicationType);
    expect(reg.body.token_endpoint_auth_method).toBe(expected.authMethod);
    expect(typeof reg.body.client_secret === 'string', 'whether a client_secret is issued').toBe(expected.secret);

    const redirectUri = (body.redirect_uris as string[])[0]!;

    const withoutPkce = await authorize(server.auth, cookie, reg.body.client_id, redirectUri, false);
    expect(withoutPkce.location, 'the refusal goes back to the client, never to consent').not.toContain('/oauth/consent');
    expect(withoutPkce.location.startsWith(redirectUri), withoutPkce.location).toBe(true);
    const refusal = new URL(withoutPkce.location);
    expect(refusal.searchParams.get('error'), withoutPkce.location).toBe('invalid_request');
    expect(refusal.searchParams.get('error_description') ?? '', 'the refusal names PKCE').toMatch(/pkce/i);
    expect(refusal.searchParams.get('code'), 'no authorization code without PKCE').toBeNull();

    // Differential: the same client, session, redirect and scopes, plus PKCE.
    const withPkce = await authorize(server.auth, cookie, reg.body.client_id, redirectUri, true);
    expect(withPkce.location, 'with PKCE the same request reaches consent').toContain('/oauth/consent');
    expect(withPkce.location).not.toContain('error=');
  }

  async function expectRefusedRedirect(body: Record<string, unknown>): Promise<void> {
    const before = server.clientCount();
    const reg = await register(server.auth, body);
    expect(reg.status, JSON.stringify(reg.body)).toBe(400);
    expect(reg.body?.error, JSON.stringify(reg.body)).toBe('invalid_redirect_uri');
    expect(reg.body?.client_id, 'a refused registration has no client id').toBeUndefined();
    expect(server.clientCount(), 'a refused registration stores no client').toBe(before);
  }

  describe('accepted as native: the shapes native MCP clients send', () => {
    it("the card's own body (public client, loopback http redirect) registers as native", async () => {
      expect(Object.keys(CARD_BODY), 'the card body omits application_type, as MCP clients do').not.toContain(
        'application_type',
      );
      await expectRegisteredAndPkceBound(CARD_BODY, { applicationType: 'native', authMethod: 'none', secret: false });
    });

    it('a public client with an http://127.0.0.1 redirect registers as native', async () => {
      await expectRegisteredAndPkceBound(cardBodyWith({ redirect_uris: [LOOPBACK_IPV4] }), {
        applicationType: 'native',
        authMethod: 'none',
        secret: false,
      });
    });

    it('a public client with a custom-scheme redirect registers as native', async () => {
      await expectRegisteredAndPkceBound(cardBodyWith({ redirect_uris: [CUSTOM_SCHEME] }), {
        applicationType: 'native',
        authMethod: 'none',
        secret: false,
      });
    });
  });

  describe('unchanged: what a web client may and may not register', () => {
    it('https://evil.example/cb alone stays web', async () => {
      await expectRegisteredAndPkceBound(cardBodyWith({ redirect_uris: [HTTPS_FOREIGN] }), {
        applicationType: 'web',
        authMethod: 'none',
        secret: false,
      });
    });

    it('http://evil.example/cb stays refused', async () => {
      await expectRefusedRedirect(cardBodyWith({ redirect_uris: [HTTP_FOREIGN] }));
    });

    it('http://localhost.evil.example stays refused (the loopback match is exact)', async () => {
      await expectRefusedRedirect(cardBodyWith({ redirect_uris: [LOOPBACK_LOOKALIKE] }));
    });

    it('an explicit application_type web with a loopback redirect stays refused (a sent type is never overridden)', async () => {
      await expectRefusedRedirect(cardBodyWith({ application_type: 'web' }));
    });
  });

  describe('NOT "public clients only": the classifier reads redirect URIs, never the auth method', () => {
    it('a confidential client (client_secret_basic) with a loopback redirect registers as native and is issued a client_secret', async () => {
      await expectRegisteredAndPkceBound(cardBodyWith({ token_endpoint_auth_method: 'client_secret_basic' }), {
        applicationType: 'native',
        authMethod: 'client_secret_basic',
        secret: true,
      });
    });

    it('a body that omits the auth method (filled as client_secret_basic) with a loopback redirect registers as native and is issued a client_secret', async () => {
      await expectRegisteredAndPkceBound(cardBodyWith({}, true), {
        applicationType: 'native',
        authMethod: 'client_secret_basic',
        secret: true,
      });
    });

    it('a confidential client with a custom-scheme redirect registers as native and is issued a client_secret', async () => {
      await expectRegisteredAndPkceBound(
        cardBodyWith({ token_endpoint_auth_method: 'client_secret_basic', redirect_uris: [CUSTOM_SCHEME] }),
        { applicationType: 'native', authMethod: 'client_secret_basic', secret: true },
      );
    });

    it('ANY qualifying redirect classifies the body: a loopback plus https://evil.example/cb registers as native', async () => {
      await expectRegisteredAndPkceBound(cardBodyWith({ redirect_uris: [LOOPBACK, HTTPS_FOREIGN] }), {
        applicationType: 'native',
        authMethod: 'none',
        secret: false,
      });
    });
  });
});

describe("DCR off: 'infer' opens nothing while the registration door is shut", () => {
  it("refuses the card's own body with access_denied", async () => {
    const opts = await captureProviderOptions({ OS_MCP_SERVER_ENABLED: 'true', OS_OIDC_DCR_ENABLED: 'false' });
    const server = await bootRealAuthorizationServer(opts);
    const reg = await register(server.auth, CARD_BODY);
    expect(reg.status, JSON.stringify(reg.body)).toBe(403);
    expect(reg.body?.error, JSON.stringify(reg.body)).toBe('access_denied');
    expect(server.clientCount(), 'no client is stored').toBe(0);
  });
});
