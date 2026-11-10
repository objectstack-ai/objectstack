// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Registering a Microsoft Entra ID OIDC provider: its discovery document names
 * `userinfo_endpoint` on Microsoft Graph, a host other than the issuer's — see
 * `sso-discovery-companion-origins.ts` for the rule this file pins.
 *
 * A real `AuthManager` with the real `sso()` plugin over the in-memory engine,
 * driven through `POST /sso/register`. Only the network is stubbed: the IdP's
 * discovery document answers over `fetch`. The platform-admin gate is answered
 * yes (its own file, `sso-register-platform-admin-gate.test.ts`, pins it), so
 * every answer below is the vendor's discovery validation judging the request.
 *
 *  - Entra-shaped discovery registers with no trusted-origins configuration;
 *  - CONTROL: an unknown issuer whose discovery names a foreign userinfo host is
 *    still refused, with a message that names the endpoint and how to name it
 *    explicitly, and naming it explicitly registers;
 *  - CONTROL: the CSRF allow-list does not gain the companion origin.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuthManager } from './auth-manager';
import { createMemoryEngine } from './impersonation-bearer-rotation.test';
import {
  SSO_DISCOVERY_COMPANION_ORIGINS,
  explainUntrustedDiscoveryEndpoint,
  ssoDiscoveryCompanionOrigins,
} from './sso-discovery-companion-origins';
// better-auth's first module load is paid at module load, not inside the first
// clocked case (AGENTS.md, Build & Test). `AuthManager` reaches these through a
// lazy `await import()`.
import 'better-auth';
import 'better-auth/plugins';
import '@better-auth/sso';

const SECRET = 'test-secret-at-least-32-chars-long-entra-discovery';
const BASE = 'http://localhost:3000';
const AUTH = `${BASE}/api/v1/auth`;

const ENTRA_ISSUER = 'https://login.microsoftonline.com/7d1c0f2e-0000-4a5b-8c6d-tenant000001/v2.0';
const ENTRA_USERINFO = 'https://graph.microsoft.com/oidc/userinfo';
const UNKNOWN_ISSUER = 'https://idp.unknown-corp.example';
const UNKNOWN_USERINFO = 'https://profile.unknown-corp-api.example/userinfo';

/** A discovery document whose endpoints sit on the issuer's host, except `userinfo_endpoint`. */
function discoveryDocument(issuer: string, userInfo: string): Record<string, unknown> {
  const origin = new URL(issuer).origin;
  return {
    issuer,
    authorization_endpoint: `${origin}/oauth2/v2.0/authorize`,
    token_endpoint: `${origin}/oauth2/v2.0/token`,
    jwks_uri: `${origin}/discovery/v2.0/keys`,
    userinfo_endpoint: userInfo,
    response_types_supported: ['code'],
    subject_types_supported: ['pairwise'],
    id_token_signing_alg_values_supported: ['RS256'],
  };
}

/** Serves each issuer's discovery document; any other fetch to those hosts is refused loudly. */
function stubDiscovery(documents: Record<string, Record<string, unknown>>) {
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : (input as Request).url;
    for (const [issuer, doc] of Object.entries(documents)) {
      if (url === `${issuer}/.well-known/openid-configuration`) {
        return new Response(JSON.stringify(doc), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      if (url.startsWith(new URL(issuer).origin)) throw new Error(`unexpected IdP fetch: ${url}`);
    }
    return realFetch(input as never, init);
  }) as typeof globalThis.fetch;
  return () => {
    globalThis.fetch = realFetch;
  };
}

interface Rp {
  manager: AuthManager;
  engine: ReturnType<typeof createMemoryEngine>;
  /** A platform administrator's bearer session. */
  token: string;
  /** better-auth's context: `skipOriginCheck` lives here. */
  ctx: { skipOriginCheck?: unknown };
}

async function makeRp(): Promise<Rp> {
  const engine = createMemoryEngine();
  (engine as any).resolveSecretField = async () => 'unused';
  const manager = new AuthManager({
    secret: SECRET,
    baseUrl: BASE,
    dataEngine: engine,
    // The deployment's own origin only: no IdP host is configured anywhere.
    trustedOrigins: [BASE],
    plugins: { sso: true },
    logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() },
  } as unknown as ConstructorParameters<typeof AuthManager>[0]);
  vi.spyOn(manager as any, 'isPlatformAdminUserId').mockResolvedValue(true);
  const ctx = await ((await manager.getAuthInstance()) as any).$context;
  const user = await ctx.adapter.create({
    model: 'user',
    data: { email: 'admin@acme.com', name: 'Admin', emailVerified: true, createdAt: new Date(), updatedAt: new Date() },
  });
  const token = (await ctx.internalAdapter.createSession(user.id)).token as string;
  return { manager, engine, token, ctx };
}

function register(rp: Rp, body: Record<string, unknown>, headers: Record<string, string> = {}): Promise<Response> {
  return rp.manager.handleRequest(
    new Request(`${AUTH}/sso/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: BASE, authorization: `Bearer ${rp.token}`, ...headers },
      body: JSON.stringify(body),
    }),
  );
}

function registration(providerId: string, issuer: string, oidcConfig: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    providerId,
    issuer,
    domain: 'acme.com',
    oidcConfig: {
      clientId: 'client-id',
      clientSecret: 'client-secret',
      scopes: ['openid', 'email', 'profile'],
      mapping: { email: 'email', name: 'name' },
      ...oidcConfig,
    },
  };
}

async function storedConfig(rp: Rp, providerId: string): Promise<Record<string, unknown>> {
  const rows = (rp.engine.tables.get('sys_sso_provider') ?? []) as Array<Record<string, unknown>>;
  const row = rows.find((r) => r.provider_id === providerId);
  expect(row, `no stored provider ${providerId}`).toBeTruthy();
  return JSON.parse(String(row!.oidc_config)) as Record<string, unknown>;
}

describe('registering an OIDC provider whose discovery names a userinfo host other than the issuer\'s', () => {
  let restore: (() => void) | undefined;
  afterEach(() => {
    restore?.();
    restore = undefined;
    vi.restoreAllMocks();
  });

  it('Microsoft Entra ID registers with no trusted-origins configuration, keeping its Graph userinfo endpoint', async () => {
    restore = stubDiscovery({ [ENTRA_ISSUER]: discoveryDocument(ENTRA_ISSUER, ENTRA_USERINFO) });
    const rp = await makeRp();
    const res = await register(rp, registration('entra-oidc', ENTRA_ISSUER));
    expect(res.status, await res.clone().text()).toBe(200);
    expect((await storedConfig(rp, 'entra-oidc')).userInfoEndpoint).toBe(ENTRA_USERINFO);
  });

  it('the userinfo opt-out registers with it: the provider row reads skip_user_info on, the endpoint stays stored', async () => {
    restore = stubDiscovery({ [ENTRA_ISSUER]: discoveryDocument(ENTRA_ISSUER, ENTRA_USERINFO) });
    const rp = await makeRp();
    const res = await register(rp, {
      ...registration('entra-oidc', ENTRA_ISSUER, { mapping: { email: 'preferred_username', name: 'name' } }),
      skipUserInfo: true,
    });
    expect(res.status, await res.clone().text()).toBe(200);
    const row = ((rp.engine.tables.get('sys_sso_provider') ?? []) as Array<Record<string, unknown>>)
      .find((r) => r.provider_id === 'entra-oidc');
    // The engine stores a boolean as the driver keeps it (1 in this one).
    expect([true, 1]).toContain(row?.skip_user_info);
    expect((await storedConfig(rp, 'entra-oidc')).userInfoEndpoint).toBe(ENTRA_USERINFO);
  });

  it('CONTROL: an unknown issuer whose discovery names a foreign userinfo host is still refused, naming the endpoint and the remedy', async () => {
    restore = stubDiscovery({ [UNKNOWN_ISSUER]: discoveryDocument(UNKNOWN_ISSUER, UNKNOWN_USERINFO) });
    const rp = await makeRp();
    const res = await register(rp, registration('unknown-oidc', UNKNOWN_ISSUER));
    const body = (await res.json()) as { code?: string; message?: string };
    expect(res.status).toBe(400);
    expect(String(body.code).toLowerCase()).toBe('discovery_untrusted_origin');
    expect(body.message).toContain(`The userinfo_endpoint "${UNKNOWN_USERINFO}" is not trusted`);
    expect(body.message).toContain(`"userInfoEndpoint": "${UNKNOWN_USERINFO}"`);
    expect(rp.engine.tables.get('sys_sso_provider') ?? []).toEqual([]);
  });

  it('naming that endpoint explicitly in the registration registers the provider', async () => {
    restore = stubDiscovery({ [UNKNOWN_ISSUER]: discoveryDocument(UNKNOWN_ISSUER, UNKNOWN_USERINFO) });
    const rp = await makeRp();
    const res = await register(rp, registration('unknown-oidc', UNKNOWN_ISSUER, { userInfoEndpoint: UNKNOWN_USERINFO }));
    expect(res.status, await res.clone().text()).toBe(200);
    expect((await storedConfig(rp, 'unknown-oidc')).userInfoEndpoint).toBe(UNKNOWN_USERINFO);
  });

  it('CONTROL: the CSRF allow-list does not gain the companion origin', async () => {
    restore = stubDiscovery({ [ENTRA_ISSUER]: discoveryDocument(ENTRA_ISSUER, ENTRA_USERINFO) });
    const rp = await makeRp();
    // better-auth skips its origin check when NODE_ENV is `test` (read once, at
    // its module load); a deployment runs it. Run it here, as a deployment does.
    rp.ctx.skipOriginCheck = false;
    // A request carrying a cookie has its Origin judged by the router's origin
    // check, against the same per-request trusted origins the registration
    // reads. Graph's origin is refused there, before the endpoint runs…
    const fromGraph = await register(rp, registration('entra-oidc', ENTRA_ISSUER), {
      origin: 'https://graph.microsoft.com',
      cookie: 'unrelated=1',
    });
    expect(fromGraph.status).toBe(403);
    expect(((await fromGraph.json()) as { code?: string }).code).toBe('INVALID_ORIGIN');
    expect(rp.engine.tables.get('sys_sso_provider') ?? []).toEqual([]);
    // …while the same request from the deployment's own origin registers.
    const fromSelf = await register(rp, registration('entra-oidc', ENTRA_ISSUER), { cookie: 'unrelated=1' });
    expect(fromSelf.status, await fromSelf.clone().text()).toBe(200);
  });
});

describe('the companion-origin table', () => {
  it('names Graph for an https issuer on login.microsoftonline.com only, by exact host', () => {
    expect(ssoDiscoveryCompanionOrigins(ENTRA_ISSUER)).toEqual(['https://graph.microsoft.com']);
    expect(ssoDiscoveryCompanionOrigins('https://login.microsoftonline.com/common/v2.0')).toEqual(['https://graph.microsoft.com']);
    for (const issuer of [
      'http://login.microsoftonline.com/tenant/v2.0',
      'https://login.microsoftonline.com.attacker.example/tenant/v2.0',
      'https://evil-login.microsoftonline.com/tenant/v2.0',
      'https://graph.microsoft.com',
      UNKNOWN_ISSUER,
      'not a url',
      undefined,
      '__proto__',
    ]) {
      expect(ssoDiscoveryCompanionOrigins(issuer), String(issuer)).toEqual([]);
    }
    expect(Object.isFrozen(SSO_DISCOVERY_COMPANION_ORIGINS)).toBe(true);
  });

  it('the remedy names the registration member for each endpoint a registration can name, and says when it cannot', () => {
    const vendor = (member: string, url: string) =>
      `Untrusted OIDC discovery URL: The ${member} "${url}" is not trusted by your trusted origins configuration.`;
    expect(explainUntrustedDiscoveryEndpoint(vendor('token_endpoint', 'https://t.example/token')))
      .toContain('"tokenEndpoint": "https://t.example/token"');
    expect(explainUntrustedDiscoveryEndpoint(vendor('jwks_uri', 'https://k.example/keys')))
      .toContain('"jwksEndpoint": "https://k.example/keys"');
    expect(explainUntrustedDiscoveryEndpoint(vendor('main discovery endpoint', 'https://d.example/.well-known/openid-configuration')))
      .toContain('"discoveryEndpoint"');
    expect(explainUntrustedDiscoveryEndpoint(vendor('end_session_endpoint', 'https://e.example/logout')))
      .toContain('cannot name this endpoint');
    expect(explainUntrustedDiscoveryEndpoint('Some other refusal.')).toBe('Some other refusal.');
  });
});
