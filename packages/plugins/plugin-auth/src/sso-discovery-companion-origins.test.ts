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
  refuseSsoDiscoveryHostNotPublic,
  ssoDiscoveryCompanionOrigins,
  trustingBodyNamedOrigins,
} from './sso-discovery-companion-origins';
import { runRegisterSsoProviderFromForm } from './register-sso-provider';
import dnsPromises from 'node:dns/promises';
import { syncBuiltinESMExports } from 'node:module';
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

/**
 * Name resolution for a case: each listed host answers its addresses, and
 * every other name answers ENOTFOUND, so no case leans on the runner's own
 * resolver. The vendor and plugin-auth load `node:dns/promises` natively, so
 * the double goes on the builtin's exports and is published to ES importers
 * (as `sso-domain-verification-instructed-record.test.ts` does for TXT
 * records). `asked` lists every name looked up.
 */
function stubNameResolution(addresses: Record<string, readonly string[]>): { asked: string[]; restore: () => void } {
  const exportsObject = dnsPromises as unknown as { lookup: typeof dnsPromises.lookup };
  const original = exportsObject.lookup;
  const asked: string[] = [];
  exportsObject.lookup = (async (name: string) => {
    asked.push(name);
    const answer = Object.prototype.hasOwnProperty.call(addresses, name) ? addresses[name] : undefined;
    if (answer) return answer.map((address) => ({ address, family: address.includes(':') ? 6 : 4 }));
    throw Object.assign(new Error(`getaddrinfo ENOTFOUND ${name}`), { code: 'ENOTFOUND', hostname: name });
  }) as unknown as typeof dnsPromises.lookup;
  syncBuiltinESMExports();
  return {
    asked,
    restore: () => {
      exportsObject.lookup = original;
      syncBuiltinESMExports();
    },
  };
}

/** Records the URL of every fetch made while it is installed, then hands the fetch on. */
function recordFetches(): { fetched: string[]; restore: () => void } {
  const inner = globalThis.fetch;
  const fetched: string[] = [];
  globalThis.fetch = ((input: unknown, init?: RequestInit) => {
    fetched.push(typeof input === 'string' ? input : input instanceof URL ? input.href : (input as Request).url);
    return inner(input as never, init);
  }) as typeof globalThis.fetch;
  return {
    fetched,
    restore: () => {
      globalThis.fetch = inner;
    },
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

async function makeRp(trustedOrigins: string[] = [BASE]): Promise<Rp> {
  const engine = createMemoryEngine();
  (engine as any).resolveSecretField = async () => 'unused';
  const manager = new AuthManager({
    secret: SECRET,
    baseUrl: BASE,
    dataEngine: engine,
    // The deployment's own origin only, unless a case lists more: by default
    // no IdP host is configured anywhere.
    trustedOrigins,
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

const GOOGLE_ISSUER = 'https://accounts.google.com';
/** Google's endpoints: authorization on the issuer's host, the other three each on a host of its own. */
const GOOGLE_ENDPOINTS = {
  authorizationEndpoint: 'https://accounts.google.com/o/oauth2/v2/auth',
  tokenEndpoint: 'https://oauth2.googleapis.com/token',
  jwksEndpoint: 'https://www.googleapis.com/oauth2/v3/certs',
  userInfoEndpoint: 'https://openidconnect.googleapis.com/v1/userinfo',
};
const GOOGLE_DISCOVERY = {
  issuer: GOOGLE_ISSUER,
  authorization_endpoint: GOOGLE_ENDPOINTS.authorizationEndpoint,
  token_endpoint: GOOGLE_ENDPOINTS.tokenEndpoint,
  jwks_uri: GOOGLE_ENDPOINTS.jwksEndpoint,
  userinfo_endpoint: GOOGLE_ENDPOINTS.userInfoEndpoint,
  response_types_supported: ['code'],
  subject_types_supported: ['public'],
  id_token_signing_alg_values_supported: ['RS256'],
};

/** The Register SSO Provider bridge (`POST /admin/sso/register`), re-dispatching to this manager. */
function registerThroughBridge(rp: Rp, form: Record<string, unknown>) {
  return runRegisterSsoProviderFromForm(
    (request) => rp.manager.handleRequest(request),
    new Request(`${AUTH}/admin/sso/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: BASE, authorization: `Bearer ${rp.token}` },
      body: JSON.stringify(form),
    }),
  );
}

const GOOGLE_FORM = { providerId: 'google-oidc', issuer: GOOGLE_ISSUER, domain: 'acme.com', clientId: 'client-id', clientSecret: 'client-secret' };

describe('the Register SSO Provider bridge registers an IdP whose token endpoint is on another host (Google)', () => {
  let restore: (() => void) | undefined;
  afterEach(() => {
    restore?.();
    restore = undefined;
    vi.restoreAllMocks();
  });

  it('naming the token, key and userinfo endpoints on the form registers it, and the provider keeps them', async () => {
    restore = stubDiscovery({ [GOOGLE_ISSUER]: GOOGLE_DISCOVERY });
    const rp = await makeRp();
    const res = await registerThroughBridge(rp, { ...GOOGLE_FORM, ...GOOGLE_ENDPOINTS });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.data?.providerId).toBe('google-oidc');
    const stored = await storedConfig(rp, 'google-oidc');
    for (const [member, url] of Object.entries(GOOGLE_ENDPOINTS)) expect(stored[member], member).toBe(url);
  });

  it('CONTROL: without them the bridge relays the refusal, which names the token endpoint as a field the bridge takes; nothing is stored', async () => {
    restore = stubDiscovery({ [GOOGLE_ISSUER]: GOOGLE_DISCOVERY });
    const rp = await makeRp();
    const res = await registerThroughBridge(rp, GOOGLE_FORM);
    expect(res.status).toBe(400);
    expect(res.body.error?.code).toBe('SSO_REGISTER_FAILED');
    expect(res.body.error?.message).toContain(`The token_endpoint "${GOOGLE_ENDPOINTS.tokenEndpoint}" is not trusted`);
    expect(res.body.error?.message).toContain('POST /admin/sso/register, takes it as the field "tokenEndpoint"');
    expect(rp.engine.tables.get('sys_sso_provider') ?? []).toEqual([]);
  });

  it('CONTROL: naming the token endpoint alone moves the refusal on to the next foreign endpoint, the key set', async () => {
    restore = stubDiscovery({ [GOOGLE_ISSUER]: GOOGLE_DISCOVERY });
    const rp = await makeRp();
    const res = await registerThroughBridge(rp, { ...GOOGLE_FORM, tokenEndpoint: GOOGLE_ENDPOINTS.tokenEndpoint });
    expect(res.status).toBe(400);
    expect(res.body.error?.message).toContain(`The jwks_uri "${GOOGLE_ENDPOINTS.jwksEndpoint}" is not trusted`);
    expect(res.body.error?.message).toContain('takes it as the field "jwksEndpoint"');
    expect(rp.engine.tables.get('sys_sso_provider') ?? []).toEqual([]);
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

  it('the logout-endpoint verdict trusts a body-named origin by exact origin, beside the request\'s own predicate', () => {
    const configured = (url: string) => url.startsWith(BASE);
    const trusted = trustingBodyNamedOrigins(configured, ['https://idp.example']);
    expect(trusted(`${BASE}/x`)).toBe(true);
    expect(trusted('https://idp.example/logout')).toBe(true);
    for (const url of ['https://idp.example:8443/logout', 'http://idp.example/logout', 'https://sub.idp.example/logout', 'ftp://idp.example/x', 'not a url']) {
      expect(trusted(url), url).toBe(false);
    }
    expect(trustingBodyNamedOrigins(configured, [])).toBe(configured);
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

// ── An origin a register or update body names is trusted for discovery only ──

/** A public host that no deployment setting names: only a request body names it. */
const BODY_HOST = 'https://sso.body-named-idp.example';
const OTHER_ISSUER = 'https://idp.other-corp.example';

/** `POST {AUTH}{path}` as a browser sends it: a cookie, and an `Origin`. */
function postAs(rp: Rp, path: string, body: Record<string, unknown>, origin: string): Promise<Response> {
  return rp.manager.handleRequest(
    new Request(`${AUTH}${path}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin,
        cookie: 'unrelated=1',
        authorization: `Bearer ${rp.token}`,
      },
      body: JSON.stringify(body),
    }),
  );
}

function storedRows(rp: Rp): Array<Record<string, unknown>> {
  return (rp.engine.tables.get('sys_sso_provider') ?? []) as Array<Record<string, unknown>>;
}

async function expectOriginRefused(res: Response): Promise<void> {
  expect(res.status, await res.clone().text()).toBe(403);
  expect(((await res.json()) as { code?: string }).code).toBe('INVALID_ORIGIN');
}

describe('an origin a register or update body names is trusted for that provider\'s discovery, never as the request\'s Origin', () => {
  let restore: (() => void) | undefined;
  afterEach(() => {
    restore?.();
    restore = undefined;
    vi.restoreAllMocks();
  });

  /** A relying party whose origin check runs, as a deployment's does. */
  async function makeCheckedRp(): Promise<Rp> {
    const rp = await makeRp();
    // better-auth skips its origin check when NODE_ENV is `test` (read once, at
    // its module load); a deployment runs it.
    rp.ctx.skipOriginCheck = false;
    return rp;
  }

  it('register: an Origin equal to the body-named issuer is refused by the origin check; no provider row is written', async () => {
    restore = stubDiscovery({ [BODY_HOST]: discoveryDocument(BODY_HOST, `${BODY_HOST}/userinfo`) });
    const rp = await makeCheckedRp();
    await expectOriginRefused(await postAs(rp, '/sso/register', registration('body-oidc', BODY_HOST), BODY_HOST));
    expect(storedRows(rp)).toEqual([]);
  });

  it('register: an Origin equal to a body-named oidcConfig endpoint\'s host is refused by the origin check; no provider row is written', async () => {
    restore = stubDiscovery({ [OTHER_ISSUER]: discoveryDocument(OTHER_ISSUER, `${OTHER_ISSUER}/userinfo`) });
    const rp = await makeCheckedRp();
    const body = registration('other-oidc', OTHER_ISSUER, { tokenEndpoint: `${BODY_HOST}/token` });
    await expectOriginRefused(await postAs(rp, '/sso/register', body, BODY_HOST));
    expect(storedRows(rp)).toEqual([]);
  });

  it('update: an Origin equal to a body-named host is refused by the origin check; the provider row is unchanged', async () => {
    restore = stubDiscovery({ [OTHER_ISSUER]: discoveryDocument(OTHER_ISSUER, `${OTHER_ISSUER}/userinfo`) });
    const rp = await makeCheckedRp();
    const reg = await postAs(rp, '/sso/register', registration('other-oidc', OTHER_ISSUER), BASE);
    expect(reg.status, await reg.clone().text()).toBe(200);
    const before = JSON.stringify(storedRows(rp));

    const update = { providerId: 'other-oidc', oidcConfig: { clientSecret: 'client-secret', tokenEndpoint: `${BODY_HOST}/token` } };
    await expectOriginRefused(await postAs(rp, '/sso/update-provider', update, BODY_HOST));
    await expectOriginRefused(await postAs(rp, '/sso/update-provider', { providerId: 'other-oidc', issuer: BODY_HOST }, BODY_HOST));
    expect(JSON.stringify(storedRows(rp))).toBe(before);
  });

  it('CONTROL: the same request with the body naming a different host is refused by the origin check too', async () => {
    restore = stubDiscovery({ [OTHER_ISSUER]: discoveryDocument(OTHER_ISSUER, `${OTHER_ISSUER}/userinfo`) });
    const rp = await makeCheckedRp();
    await expectOriginRefused(await postAs(rp, '/sso/register', registration('other-oidc', OTHER_ISSUER), BODY_HOST));
    expect(storedRows(rp)).toEqual([]);
  });

  it('CONTROL: a same-origin register naming an external issuer and a foreign endpoint still discovers and registers', async () => {
    restore = stubDiscovery({ [OTHER_ISSUER]: discoveryDocument(OTHER_ISSUER, `${BODY_HOST}/userinfo`) });
    const rp = await makeCheckedRp();
    const body = registration('other-oidc', OTHER_ISSUER, { userInfoEndpoint: `${BODY_HOST}/userinfo` });
    const res = await postAs(rp, '/sso/register', body, BASE);
    expect(res.status, await res.clone().text()).toBe(200);
    const stored = await storedConfig(rp, 'other-oidc');
    expect(stored.userInfoEndpoint).toBe(`${BODY_HOST}/userinfo`);
    expect(stored.tokenEndpoint).toBe(`${OTHER_ISSUER}/oauth2/v2.0/token`);
  });

  it('CONTROL: a same-origin register whose discovery names an endpoint the body does not is still refused discovery_untrusted_origin', async () => {
    restore = stubDiscovery({ [OTHER_ISSUER]: discoveryDocument(OTHER_ISSUER, `${BODY_HOST}/userinfo`) });
    const rp = await makeCheckedRp();
    const res = await postAs(rp, '/sso/register', registration('other-oidc', OTHER_ISSUER), BASE);
    expect(res.status).toBe(400);
    expect(String(((await res.json()) as { code?: string }).code).toLowerCase()).toBe('discovery_untrusted_origin');
    expect(storedRows(rp)).toEqual([]);
  });

  it('CONTROL: a same-origin update naming a foreign endpoint still validates and is saved', async () => {
    restore = stubDiscovery({ [OTHER_ISSUER]: discoveryDocument(OTHER_ISSUER, `${OTHER_ISSUER}/userinfo`) });
    const rp = await makeCheckedRp();
    expect((await postAs(rp, '/sso/register', registration('other-oidc', OTHER_ISSUER), BASE)).status).toBe(200);
    const update = { providerId: 'other-oidc', oidcConfig: { clientSecret: 'client-secret', tokenEndpoint: `${BODY_HOST}/token` } };
    const res = await postAs(rp, '/sso/update-provider', update, BASE);
    expect(res.status, await res.clone().text()).toBe(200);
    expect((await storedConfig(rp, 'other-oidc')).tokenEndpoint).toBe(`${BODY_HOST}/token`);
  });

  /** A discovery document for `issuer` that publishes a logout endpoint at `endSession`. */
  function withLogout(issuer: string, endSession: string): Record<string, unknown> {
    return { ...discoveryDocument(issuer, `${issuer}/userinfo`), end_session_endpoint: endSession };
  }

  /**
   * The identity provider's environment for a switch-on case: its discovery
   * documents over `fetch`, and name resolution ({@link stubNameResolution}):
   * `privateHost` resolves to a private address, every other name answers
   * ENOTFOUND.
   */
  function stubIdp(documents: Record<string, Record<string, unknown>>, privateHost?: string): () => void {
    const names = stubNameResolution(privateHost === undefined ? {} : { [privateHost]: ['10.0.0.5'] });
    const undoDiscovery = stubDiscovery(documents);
    return () => {
      undoDiscovery();
      names.restore();
    };
  }

  it('the sign-out check\'s logout-endpoint verdict trusts a body-named origin: a same-origin register with the switch on saves, keeping the logout endpoint', async () => {
    restore = stubIdp({ [OTHER_ISSUER]: withLogout(OTHER_ISSUER, `${OTHER_ISSUER}/logout`) });
    const rp = await makeCheckedRp();
    const res = await postAs(rp, '/sso/register', { ...registration('other-oidc', OTHER_ISSUER), signOutOfIdp: true }, BASE);
    expect(res.status, await res.clone().text()).toBe(200);
    expect((await storedConfig(rp, 'other-oidc')).endSessionEndpoint).toBe(`${OTHER_ISSUER}/logout`);
  });

  it('the sign-out check\'s logout-endpoint verdict trusts a body-named origin: a same-origin update with the switch on saves, keeping the logout endpoint', async () => {
    restore = stubIdp({ [OTHER_ISSUER]: withLogout(OTHER_ISSUER, `${OTHER_ISSUER}/logout`) });
    const rp = await makeCheckedRp();
    expect((await postAs(rp, '/sso/register', registration('other-oidc', OTHER_ISSUER), BASE)).status).toBe(200);
    const res = await postAs(rp, '/sso/update-provider', { providerId: 'other-oidc', issuer: OTHER_ISSUER, signOutOfIdp: true }, BASE);
    expect(res.status, await res.clone().text()).toBe(200);
    expect((await storedConfig(rp, 'other-oidc')).endSessionEndpoint).toBe(`${OTHER_ISSUER}/logout`);
  });

  it('CONTROL: the sign-out capability check still refuses a logout endpoint on a host the body does not name', async () => {
    restore = stubIdp({ [OTHER_ISSUER]: withLogout(OTHER_ISSUER, `${BODY_HOST}/logout`) });
    const rp = await makeCheckedRp();
    const res = await postAs(rp, '/sso/register', { ...registration('other-oidc', OTHER_ISSUER), signOutOfIdp: true }, BASE);
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: 'VALIDATION_FAILED', field: 'signOutOfIdp' });
    expect(storedRows(rp)).toEqual([]);
  });

  it('a body-named origin with the switch on is still refused as the request\'s Origin, on register and on update', async () => {
    restore = stubIdp({ [OTHER_ISSUER]: withLogout(OTHER_ISSUER, `${OTHER_ISSUER}/logout`) });
    const rp = await makeCheckedRp();
    await expectOriginRefused(await postAs(rp, '/sso/register', { ...registration('other-oidc', OTHER_ISSUER), signOutOfIdp: true }, OTHER_ISSUER));
    expect(storedRows(rp)).toEqual([]);
    expect((await postAs(rp, '/sso/register', registration('other-oidc', OTHER_ISSUER), BASE)).status).toBe(200);
    const before = JSON.stringify(storedRows(rp));
    await expectOriginRefused(await postAs(rp, '/sso/update-provider', { providerId: 'other-oidc', issuer: OTHER_ISSUER, signOutOfIdp: true }, OTHER_ISSUER));
    expect(JSON.stringify(storedRows(rp))).toBe(before);
  });

  it('CONTROL: on update too, the sign-out capability check refuses a logout endpoint on a host the body does not name', async () => {
    // Registered while the IdP publishes no logout endpoint (the vendor's own
    // discovery check judges a published one too); it publishes one on a
    // foreign host by the time the update turns the switch on.
    restore = stubIdp({ [OTHER_ISSUER]: discoveryDocument(OTHER_ISSUER, `${OTHER_ISSUER}/userinfo`) });
    const rp = await makeCheckedRp();
    expect((await postAs(rp, '/sso/register', registration('other-oidc', OTHER_ISSUER), BASE)).status).toBe(200);
    restore();
    restore = stubIdp({ [OTHER_ISSUER]: withLogout(OTHER_ISSUER, `${BODY_HOST}/logout`) });
    const before = JSON.stringify(storedRows(rp));
    const res = await postAs(rp, '/sso/update-provider', { providerId: 'other-oidc', issuer: OTHER_ISSUER, signOutOfIdp: true }, BASE);
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: 'VALIDATION_FAILED', field: 'signOutOfIdp' });
    expect(JSON.stringify(storedRows(rp))).toBe(before);
  });

  it('on register with the switch on, an issuer whose host resolves to a private address is refused on issuer, before the sign-out check reads it', async () => {
    restore = stubIdp({ [OTHER_ISSUER]: withLogout(OTHER_ISSUER, `${OTHER_ISSUER}/logout`) }, new URL(OTHER_ISSUER).hostname);
    const rp = await makeCheckedRp();
    const res = await postAs(rp, '/sso/register', { ...registration('other-oidc', OTHER_ISSUER), signOutOfIdp: true }, BASE);
    expect(res.status, await res.clone().text()).toBe(400);
    expect(await res.json()).toMatchObject({ code: 'VALIDATION_FAILED', field: 'issuer' });
    expect(storedRows(rp)).toEqual([]);
  });

  it('the sign-out capability check trusts a body-named origin for the logout endpoint only: on update, its discovery read keeps the configured trust', async () => {
    // Registered while the issuer's host does not resolve to a private address
    // (a registration reads its discovery document only from a host that
    // resolves to public addresses); it does by the time the update turns the
    // switch on.
    restore = stubIdp({ [OTHER_ISSUER]: withLogout(OTHER_ISSUER, `${OTHER_ISSUER}/logout`) });
    const rp = await makeCheckedRp();
    expect((await postAs(rp, '/sso/register', registration('other-oidc', OTHER_ISSUER), BASE)).status).toBe(200);
    restore();
    restore = stubIdp({ [OTHER_ISSUER]: withLogout(OTHER_ISSUER, `${OTHER_ISSUER}/logout`) }, new URL(OTHER_ISSUER).hostname);
    const before = JSON.stringify(storedRows(rp));
    const res = await postAs(rp, '/sso/update-provider', { providerId: 'other-oidc', issuer: OTHER_ISSUER, signOutOfIdp: true }, BASE);
    expect(res.status, await res.clone().text()).toBe(400);
    expect(await res.json()).toMatchObject({ code: 'VALIDATION_FAILED', field: 'signOutOfIdp' });
    expect(JSON.stringify(storedRows(rp))).toBe(before);
  });

  it('CONTROL: an origin the deployment lists keeps both the discovery read and the logout endpoint trusted', async () => {
    restore = stubIdp({ [OTHER_ISSUER]: withLogout(OTHER_ISSUER, `${OTHER_ISSUER}/logout`) }, new URL(OTHER_ISSUER).hostname);
    const rp = await makeRp([BASE, OTHER_ISSUER]);
    rp.ctx.skipOriginCheck = false;
    const res = await postAs(rp, '/sso/register', { ...registration('other-oidc', OTHER_ISSUER), signOutOfIdp: true }, BASE);
    expect(res.status, await res.clone().text()).toBe(200);
    expect((await storedConfig(rp, 'other-oidc')).endSessionEndpoint).toBe(`${OTHER_ISSUER}/logout`);
  });

  it('CONTROL: another POST is judged against the configured origins alone, as before', async () => {
    const rp = await makeCheckedRp();
    await expectOriginRefused(await postAs(rp, '/sign-out', { issuer: BODY_HOST }, BODY_HOST));
    const fromSelf = await postAs(rp, '/sign-out', {}, BASE);
    expect(fromSelf.status, await fromSelf.clone().text()).toBe(200);
  });
});

// ── SSO discovery reads only hosts that resolve to public addresses ─────────

/** An address no non-public range holds. */
const PUBLIC_ADDRESS = '93.184.215.14';
const RESOLVED_ISSUER = 'https://idp.resolved-corp.example';
const RESOLVED_HOST = new URL(RESOLVED_ISSUER).hostname;
const RESOLVED_DISCOVERY = `${RESOLVED_ISSUER}/.well-known/openid-configuration`;
/** A discovery host other than the issuer's, named by `oidcConfig.discoveryEndpoint`. */
const DISCOVERY_ORIGIN = 'https://discovery.resolved-corp.example';
const DISCOVERY_HOST = new URL(DISCOVERY_ORIGIN).hostname;

describe('SSO discovery reads only hosts that resolve to public addresses', () => {
  let undo: Array<() => void> = [];
  afterEach(() => {
    for (const step of undo.reverse()) step();
    undo = [];
    vi.restoreAllMocks();
  });

  /** The IdP's discovery documents over `fetch` and its name resolution, with a record of both. */
  function idp(documents: Record<string, Record<string, unknown>>, addresses: Record<string, readonly string[]>) {
    const undoDiscovery = stubDiscovery(documents);
    const reads = recordFetches();
    const names = stubNameResolution(addresses);
    undo.push(undoDiscovery, reads.restore, names.restore);
    return { fetched: reads.fetched, asked: names.asked };
  }

  const readFrom = (fetched: readonly string[], host: string) => fetched.filter((url) => new URL(url).hostname === host);

  it.each(['10.0.0.5', '127.0.0.1', '169.254.169.254'])(
    'a registration whose discovery host resolves to %s is refused on issuer, and nothing is read from that host',
    async (address) => {
      const io = idp({ [RESOLVED_ISSUER]: discoveryDocument(RESOLVED_ISSUER, `${RESOLVED_ISSUER}/userinfo`) }, { [RESOLVED_HOST]: [address] });
      const rp = await makeRp();
      const res = await register(rp, registration('resolved-oidc', RESOLVED_ISSUER));
      expect(res.status, await res.clone().text()).toBe(400);
      expect(await res.json()).toMatchObject({ code: 'VALIDATION_FAILED', field: 'issuer' });
      expect(io.asked).toContain(RESOLVED_HOST);
      expect(readFrom(io.fetched, RESOLVED_HOST)).toEqual([]);
      expect(storedRows(rp)).toEqual([]);
    },
  );

  it('with the sign-out switch on, the registration is refused on issuer by this rule, and nothing is read from that host', async () => {
    const io = idp(
      { [RESOLVED_ISSUER]: { ...discoveryDocument(RESOLVED_ISSUER, `${RESOLVED_ISSUER}/userinfo`), end_session_endpoint: `${RESOLVED_ISSUER}/logout` } },
      { [RESOLVED_HOST]: ['10.0.0.5'] },
    );
    const rp = await makeRp();
    const res = await register(rp, { ...registration('resolved-oidc', RESOLVED_ISSUER), signOutOfIdp: true });
    expect(res.status, await res.clone().text()).toBe(400);
    expect(await res.json()).toMatchObject({ code: 'VALIDATION_FAILED', field: 'issuer' });
    expect(io.asked).toContain(RESOLVED_HOST);
    expect(readFrom(io.fetched, RESOLVED_HOST)).toEqual([]);
    expect(storedRows(rp)).toEqual([]);
  });

  it('a discovery host with one public and one private address is refused: every address must be public', async () => {
    const io = idp(
      { [RESOLVED_ISSUER]: discoveryDocument(RESOLVED_ISSUER, `${RESOLVED_ISSUER}/userinfo`) },
      { [RESOLVED_HOST]: [PUBLIC_ADDRESS, '10.0.0.5'] },
    );
    const rp = await makeRp();
    const res = await register(rp, registration('resolved-oidc', RESOLVED_ISSUER));
    expect(res.status, await res.clone().text()).toBe(400);
    expect(await res.json()).toMatchObject({ code: 'VALIDATION_FAILED', field: 'issuer' });
    expect(readFrom(io.fetched, RESOLVED_HOST)).toEqual([]);
    expect(storedRows(rp)).toEqual([]);
  });

  it('an explicit discovery endpoint on a host that resolves to a private address is refused on that member', async () => {
    const io = idp(
      { [DISCOVERY_ORIGIN]: discoveryDocument(RESOLVED_ISSUER, `${RESOLVED_ISSUER}/userinfo`) },
      { [RESOLVED_HOST]: [PUBLIC_ADDRESS], [DISCOVERY_HOST]: ['10.0.0.5'] },
    );
    const rp = await makeRp();
    const body = registration('resolved-oidc', RESOLVED_ISSUER, { discoveryEndpoint: `${DISCOVERY_ORIGIN}/.well-known/openid-configuration` });
    const res = await register(rp, body);
    expect(res.status, await res.clone().text()).toBe(400);
    expect(await res.json()).toMatchObject({ code: 'VALIDATION_FAILED', field: 'oidcConfig.discoveryEndpoint' });
    expect(readFrom(io.fetched, DISCOVERY_HOST)).toEqual([]);
    expect(storedRows(rp)).toEqual([]);
  });

  it('the Register SSO Provider bridge answers the same rule, and nothing is read from the host', async () => {
    const io = idp({ [RESOLVED_ISSUER]: discoveryDocument(RESOLVED_ISSUER, `${RESOLVED_ISSUER}/userinfo`) }, { [RESOLVED_HOST]: ['127.0.0.1'] });
    const rp = await makeRp();
    const res = await registerThroughBridge(rp, { ...GOOGLE_FORM, providerId: 'resolved-oidc', issuer: RESOLVED_ISSUER });
    expect(res.status, JSON.stringify(res.body)).toBe(400);
    expect(res.body.error?.code).toBe('SSO_REGISTER_FAILED');
    expect(readFrom(io.fetched, RESOLVED_HOST)).toEqual([]);
    expect(storedRows(rp)).toEqual([]);
  });

  it('CONTROL: a discovery host that resolves to public addresses registers, reading its discovery document alone, and the endpoints the body names stay trusted for the discovery checks', async () => {
    const io = idp(
      { [RESOLVED_ISSUER]: discoveryDocument(RESOLVED_ISSUER, `${BODY_HOST}/userinfo`) },
      { [RESOLVED_HOST]: [PUBLIC_ADDRESS], [new URL(BODY_HOST).hostname]: [PUBLIC_ADDRESS] },
    );
    const rp = await makeRp();
    const res = await register(rp, registration('resolved-oidc', RESOLVED_ISSUER, { userInfoEndpoint: `${BODY_HOST}/userinfo` }));
    expect(res.status, await res.clone().text()).toBe(200);
    expect(io.asked).toContain(RESOLVED_HOST);
    expect(io.fetched).toEqual([RESOLVED_DISCOVERY]);
    expect((await storedConfig(rp, 'resolved-oidc')).userInfoEndpoint).toBe(`${BODY_HOST}/userinfo`);
  });

  it('CONTROL: an origin the deployment lists registers though its host resolves to a private address', async () => {
    idp({ [RESOLVED_ISSUER]: discoveryDocument(RESOLVED_ISSUER, `${RESOLVED_ISSUER}/userinfo`) }, { [RESOLVED_HOST]: ['10.0.0.5'] });
    const rp = await makeRp([BASE, RESOLVED_ISSUER]);
    const res = await register(rp, registration('resolved-oidc', RESOLVED_ISSUER));
    expect(res.status, await res.clone().text()).toBe(200);
    expect((await storedConfig(rp, 'resolved-oidc')).issuer).toBe(RESOLVED_ISSUER);
  });

  it('CONTROL: a registration with no session resolves no name and is answered 401', async () => {
    const io = idp({ [RESOLVED_ISSUER]: discoveryDocument(RESOLVED_ISSUER, `${RESOLVED_ISSUER}/userinfo`) }, { [RESOLVED_HOST]: ['10.0.0.5'] });
    const rp = await makeRp();
    const res = await rp.manager.handleRequest(
      new Request(`${AUTH}/sso/register`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: BASE },
        body: JSON.stringify(registration('resolved-oidc', RESOLVED_ISSUER)),
      }),
    );
    expect(res.status, await res.clone().text()).toBe(401);
    expect(io.asked).toEqual([]);
    expect(readFrom(io.fetched, RESOLVED_HOST)).toEqual([]);
    expect(storedRows(rp)).toEqual([]);
  });

  it('CONTROL: a registration by a signed-in user who is not a platform admin resolves no name and is answered 403', async () => {
    const io = idp({ [RESOLVED_ISSUER]: discoveryDocument(RESOLVED_ISSUER, `${RESOLVED_ISSUER}/userinfo`) }, { [RESOLVED_HOST]: ['10.0.0.5'] });
    const rp = await makeRp();
    vi.spyOn(rp.manager as any, 'isPlatformAdminUserId').mockResolvedValue(false);
    const res = await register(rp, registration('resolved-oidc', RESOLVED_ISSUER));
    expect(res.status, await res.clone().text()).toBe(403);
    expect(await res.json()).toMatchObject({ code: 'SSO_REGISTER_FORBIDDEN' });
    expect(io.asked).toEqual([]);
    expect(readFrom(io.fetched, RESOLVED_HOST)).toEqual([]);
    expect(storedRows(rp)).toEqual([]);
  });
});

describe('the host a registration\'s discovery reads is the one host resolved', () => {
  /** A resolver answering a private address for every name, recording each name asked. */
  function privateResolver() {
    const asked: string[] = [];
    const resolve = async (hostname: string) => {
      asked.push(hostname);
      return [{ address: '10.0.0.5' }];
    };
    return { asked, resolve };
  }
  const configured = (url: string) => url.startsWith(BASE);
  const oidc = (extra: Record<string, unknown> = {}) => ({ clientId: 'client-id', clientSecret: 'client-secret', ...extra });

  it('the issuer\'s well-known URL is resolved when the registration names no discovery endpoint, and refused on issuer', async () => {
    const r = privateResolver();
    const refusal = await refuseSsoDiscoveryHostNotPublic({
      body: { issuer: RESOLVED_ISSUER, oidcConfig: oidc() },
      isConfiguredTrusted: configured,
      resolve: r.resolve,
    });
    expect(refusal).toMatchObject({ status: 'BAD_REQUEST', code: 'VALIDATION_FAILED', field: 'issuer' });
    expect(r.asked).toEqual([RESOLVED_HOST]);
  });

  it('an explicit discovery endpoint is the host resolved, not the issuer\'s, and the refusal names that member', async () => {
    const r = privateResolver();
    const refusal = await refuseSsoDiscoveryHostNotPublic({
      body: { issuer: RESOLVED_ISSUER, oidcConfig: oidc({ discoveryEndpoint: `${DISCOVERY_ORIGIN}/.well-known/openid-configuration` }) },
      isConfiguredTrusted: configured,
      resolve: r.resolve,
    });
    expect(refusal).toMatchObject({ code: 'VALIDATION_FAILED', field: 'oidcConfig.discoveryEndpoint' });
    expect(r.asked).toEqual([DISCOVERY_HOST]);
  });

  it('a registration that reads no discovery document resolves nothing: a SAML registration, and skipDiscovery', async () => {
    for (const body of [
      { issuer: RESOLVED_ISSUER, samlConfig: { entryPoint: `${RESOLVED_ISSUER}/sso` } },
      { issuer: RESOLVED_ISSUER, oidcConfig: oidc({ skipDiscovery: true, tokenEndpoint: `${RESOLVED_ISSUER}/token` }) },
      {},
      undefined,
    ]) {
      const r = privateResolver();
      expect(await refuseSsoDiscoveryHostNotPublic({ body, isConfiguredTrusted: configured, resolve: r.resolve }), JSON.stringify(body)).toBeUndefined();
      expect(r.asked, JSON.stringify(body)).toEqual([]);
    }
  });

  it('a discovery URL the deployment trusts, an address literal and a non-public name are not resolved here', async () => {
    for (const issuer of [RESOLVED_ISSUER, 'https://10.0.0.5', 'https://[fd00::1]', 'http://localhost:9000', 'https://metadata.google.internal']) {
      const r = privateResolver();
      const refusal = await refuseSsoDiscoveryHostNotPublic({
        body: { issuer, oidcConfig: oidc() },
        isConfiguredTrusted: (url) => url.startsWith(RESOLVED_ISSUER),
        resolve: r.resolve,
      });
      expect(refusal, issuer).toBeUndefined();
      expect(r.asked, issuer).toEqual([]);
    }
  });

  it('a name that does not resolve is left to the read, as the vendor\'s own check leaves it', async () => {
    const refusal = await refuseSsoDiscoveryHostNotPublic({
      body: { issuer: RESOLVED_ISSUER, oidcConfig: oidc() },
      isConfiguredTrusted: configured,
      resolve: async (hostname) => {
        throw Object.assign(new Error(`getaddrinfo ENOTFOUND ${hostname}`), { code: 'ENOTFOUND' });
      },
    });
    expect(refusal).toBeUndefined();
  });

  it('a name whose every address is public is not refused', async () => {
    const refusal = await refuseSsoDiscoveryHostNotPublic({
      body: { issuer: RESOLVED_ISSUER, oidcConfig: oidc() },
      isConfiguredTrusted: configured,
      resolve: async () => [{ address: PUBLIC_ADDRESS }, { address: '2606:2800:21f:cb07:6820:80da:af6b:8b2c' }],
    });
    expect(refusal).toBeUndefined();
  });
});
