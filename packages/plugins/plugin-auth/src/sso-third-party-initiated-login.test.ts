// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#32086] The third-party-initiated OIDC sign-in entry — see
 * `sso-third-party-initiated-login.ts` for the rule this file pins (maintainer
 * ruling A on #32150, record 6764924025).
 *
 * Two layers:
 *
 *  1. END of the chain — a real `AuthManager` with the real `sso()` plugin
 *     over the in-memory engine, driven through its HTTP surface: the IdP's
 *     `GET /sso/callback/:providerId?iss=…` → the IdP's authorization endpoint
 *     → `/sso/callback/:providerId?code=…&state=…`. Only the IdP is stubbed
 *     (its token and JWKS endpoints answer over `fetch`; the ID token is signed
 *     here). The pins of point 3: the entry sets no session cookie and writes
 *     no `sys_session` row; a later callback with a foreign or missing `state`
 *     is still refused; the four controls (toggle off, `iss` off by one
 *     character, a SAML provider, an untrusted `target_link_uri`) keep today's
 *     `state_not_found`.
 *  2. The shape, the gate and the entry's fall-through, read off their own
 *     inputs.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SignJWT, exportJWK, generateKeyPair, type JWK } from 'jose';
import { AuthManager } from './auth-manager';
import { createMemoryEngine } from './impersonation-bearer-rotation.test';
import {
  THIRD_PARTY_INITIATED_LOGIN_MISSES,
  judgeThirdPartyInitiatedLogin,
  readThirdPartyLoginProvider,
  runThirdPartyInitiatedLogin,
  thirdPartyInitiatedLoginOf,
  type ThirdPartyLoginHost,
} from './sso-third-party-initiated-login';
// better-auth's first module load is paid at module load, not inside the first
// clocked case (AGENTS.md, Build & Test). `AuthManager` reaches these through a
// lazy `await import()`.
import 'better-auth';
import 'better-auth/plugins';
import 'better-auth/plugins/organization';
import '@better-auth/sso';

const SECRET = 'test-secret-at-least-32-chars-long-third-party-login';
const BASE = 'http://localhost:3000';
const AUTH = `${BASE}/api/v1/auth`;
const IDP = 'https://idp.example.test';
const PROVIDER_ID = 'acme-okta';
const CLIENT_ID = 'acme-client-id';
const CLIENT_SECRET = 'acme-client-secret';
const KID = 'current-key';
const SUBJECT = 'okta-subject-00u1abcd';
const EMAIL = 'mia.chen@acme.com';

type Engine = ReturnType<typeof createMemoryEngine>;

// ── The IdP ─────────────────────────────────────────────────────────────────

let privateKey: CryptoKey;
let publicJwk: JWK;

beforeEach(async () => {
  if (privateKey) return;
  const pair = await generateKeyPair('RS256', { extractable: true });
  privateKey = pair.privateKey;
  publicJwk = { ...(await exportJWK(pair.publicKey)), kid: KID, alg: 'RS256', use: 'sig' };
});

async function idToken(): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({ email: EMAIL, email_verified: true, name: 'Mia Chen' })
    .setProtectedHeader({ alg: 'RS256', kid: KID })
    .setIssuer(IDP)
    .setAudience(CLIENT_ID)
    .setSubject(SUBJECT)
    .setIssuedAt(now - 600)
    .setExpirationTime(now + 300)
    .sign(privateKey);
}

/** Routes the IdP's token and JWKS endpoints; everything else at the IdP is refused loudly. */
function stubIdp(token: string) {
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : (input as Request).url;
    const json = (body: unknown) =>
      new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
    if (url.startsWith(`${IDP}/token`)) {
      return json({ access_token: 'at-opaque', token_type: 'Bearer', expires_in: 300, id_token: token });
    }
    if (url.startsWith(`${IDP}/jwks`)) return json({ keys: [publicJwk] });
    if (url.startsWith(IDP)) throw new Error(`unexpected IdP fetch: ${url}`);
    return realFetch(input as never, init);
  }) as typeof globalThis.fetch;
  return () => {
    globalThis.fetch = realFetch;
  };
}

// ── The relying party ───────────────────────────────────────────────────────

interface Rp {
  manager: AuthManager;
  engine: Engine;
  warn: ReturnType<typeof vi.fn>;
}

interface RpOptions {
  /** Extra provider-row fields, written through the vendor's adapter (e.g. `allowIdpInitiated`). */
  provider?: Record<string, unknown>;
  /** A SAML provider instead of an OIDC one. */
  saml?: boolean;
}

async function makeRp(opts: RpOptions = {}): Promise<Rp> {
  const engine = createMemoryEngine();
  // The host's secret store: the adapter lifts `clientSecret` out of the
  // provider row on write (`sso-client-secret.ts`) and reads it back here.
  (engine as any).resolveSecretField = async () => CLIENT_SECRET;
  const warn = vi.fn();
  const manager = new AuthManager({
    secret: SECRET,
    baseUrl: BASE,
    dataEngine: engine,
    trustedOrigins: [BASE, IDP],
    plugins: { sso: true },
    logger: { warn, error: vi.fn(), info: vi.fn() },
  } as unknown as ConstructorParameters<typeof AuthManager>[0]);
  const auth: any = await manager.getAuthInstance();
  const ctx = await auth.$context;
  await ctx.adapter.create({
    model: 'ssoProvider',
    data: {
      providerId: PROVIDER_ID,
      issuer: IDP,
      domain: 'acme.com',
      ...(opts.saml
        ? {
            samlConfig: JSON.stringify({
              issuer: IDP,
              entryPoint: `${IDP}/sso`,
              cert: 'MIIB',
              callbackUrl: `${AUTH}/sso/saml2/sp/acs/${PROVIDER_ID}`,
              spMetadata: {},
            }),
          }
        : {
            oidcConfig: JSON.stringify({
              issuer: IDP,
              clientId: CLIENT_ID,
              clientSecret: CLIENT_SECRET,
              authorizationEndpoint: `${IDP}/authorize`,
              tokenEndpoint: `${IDP}/token`,
              jwksEndpoint: `${IDP}/jwks`,
              discoveryEndpoint: `${IDP}/.well-known/openid-configuration`,
              pkce: true,
              scopes: ['openid', 'email', 'profile'],
              mapping: { id: 'sub', email: 'email', name: 'name' },
            }),
          }),
      allowJit: true,
      ...opts.provider,
    },
  });
  // A human who is not the newcomer, so no case rides the zero-user bootstrap carve-out.
  await engine.insert('sys_user', { id: 'usr_admin', email: 'admin@acme.com', name: 'Admin', email_verified: true });
  return { manager, engine, warn };
}

const setCookies = (res: Response): string[] => res.headers.getSetCookie?.() ?? [];
const cookiesOf = (res: Response): string =>
  setCookies(res)
    .map((c) => c.split(';')[0]!)
    .filter(Boolean)
    .join('; ');
const hasSessionCookie = (res: Response): boolean => /session_token=[^;]/.test(cookiesOf(res));
const rows = (rp: Rp, table: string): Array<Record<string, any>> => [...(rp.engine.tables.get(table) ?? [])];
const authStateRows = (rp: Rp) => rows(rp, 'sys_verification').filter((r) => String(r.identifier).includes('state'));

function landing(res: Response): { base: string; error: string | null } {
  const url = new URL(res.headers.get('location') ?? '', BASE);
  return { base: `${url.origin}${url.pathname}`, error: url.searchParams.get('error') };
}

/** The IdP's third-party-initiated request: `GET` the callback with `iss` and no code. */
function initiate(rp: Rp, query: Record<string, string> = { iss: IDP }): Promise<Response> {
  return rp.manager.handleRequest(new Request(`${AUTH}/sso/callback/${PROVIDER_ID}?${new URLSearchParams(query)}`));
}

/** The IdP sends the browser back with a code and `state`, carrying `cookie`. */
async function returnFromIdp(rp: Rp, state: string | undefined, cookie: string): Promise<Response> {
  const restore = stubIdp(await idToken());
  try {
    const query = new URLSearchParams({ code: 'idp-code', ...(state !== undefined ? { state } : {}) });
    return await rp.manager.handleRequest(
      new Request(`${AUTH}/sso/callback/${PROVIDER_ID}?${query}`, { headers: cookie ? { cookie } : {} }),
    );
  } finally {
    restore();
  }
}

/** The entry's `warn` lines. */
const entryLines = (rp: Rp): Array<[string, Record<string, unknown>]> =>
  rp.warn.mock.calls.filter(([, meta]) => (meta as any)?.entry === 'third_party_initiated') as never;

// ── 1. END of the chain ─────────────────────────────────────────────────────

describe('[#32086] an IdP app tile starts an OIDC sign-in (third-party-initiated login, ruling 6764924025)', () => {
  it('toggle on and iss the registered issuer: 302 to the IdP with a fresh state and PKCE, and the entry mints no session', async () => {
    const rp = await makeRp({ provider: { allowIdpInitiated: true } });
    const res = await initiate(rp, { iss: IDP, login_hint: EMAIL });

    expect(res.status).toBe(302);
    const location = new URL(res.headers.get('location')!);
    expect(`${location.origin}${location.pathname}`).toBe(`${IDP}/authorize`);
    expect(location.searchParams.get('client_id')).toBe(CLIENT_ID);
    expect(location.searchParams.get('redirect_uri')).toBe(`${AUTH}/sso/callback/${PROVIDER_ID}`);
    expect(location.searchParams.get('state')).toBeTruthy();
    expect(location.searchParams.get('code_challenge')).toBeTruthy();
    expect(location.searchParams.get('code_challenge_method')).toBe('S256');
    expect(location.searchParams.get('login_hint')).toBe(EMAIL);
    // The state cookie the vendor wrote, and nothing that is a session.
    expect(cookiesOf(res)).toMatch(/state=/);
    expect(hasSessionCookie(res)).toBe(false);
    expect(rows(rp, 'sys_session')).toHaveLength(0);
    expect(authStateRows(rp)).toHaveLength(1);
    expect(entryLines(rp)).toHaveLength(0);
  });

  it('finishing it at the IdP signs the person in through the vendor callback, on the base URL or on a trusted target_link_uri', async () => {
    const rp = await makeRp({ provider: { allowIdpInitiated: true } });
    const started = await initiate(rp);
    const state = new URL(started.headers.get('location')!).searchParams.get('state')!;
    const finished = await returnFromIdp(rp, state, cookiesOf(started));
    expect(finished.status).toBe(302);
    expect(landing(finished)).toEqual({ base: `${BASE}/`, error: null });
    expect(hasSessionCookie(finished)).toBe(true);
    expect(rows(rp, 'sys_session')).toHaveLength(1);

    const target = `${BASE}/_console/apps/crm`;
    const again = await initiate(rp, { iss: IDP, target_link_uri: target });
    const againState = new URL(again.headers.get('location')!).searchParams.get('state')!;
    const landed = await returnFromIdp(rp, againState, cookiesOf(again));
    expect(landed.headers.get('location')).toBe(target);
    expect(hasSessionCookie(landed)).toBe(true);
  });

  it('a later callback with a foreign or a missing state is still refused, and signs nobody in', async () => {
    const rp = await makeRp({ provider: { allowIdpInitiated: true } });
    const started = await initiate(rp);
    const cookie = cookiesOf(started);

    const foreign = await returnFromIdp(rp, 'state-this-deployment-never-issued', cookie);
    expect(foreign.status).toBe(302);
    expect(landing(foreign).error).toBe('state_mismatch');
    expect(hasSessionCookie(foreign)).toBe(false);

    // No state at all: with the toggle on, the vendor's own bounce restarts the
    // flow at the IdP (#30967); it is not a sign-in either.
    const missing = await returnFromIdp(rp, undefined, cookie);
    expect(missing.status).toBe(302);
    expect(landing(missing).base).toBe(`${IDP}/authorize`);
    expect(hasSessionCookie(missing)).toBe(false);
    expect(rows(rp, 'sys_session')).toHaveLength(0);
  });

  const controls: Array<{ name: string; reason: string; rp: () => Promise<Rp>; query: Record<string, string> }> = [
    {
      name: 'CONTROL toggle off (the default)',
      reason: 'idp_initiated_off',
      rp: () => makeRp(),
      query: { iss: IDP },
    },
    {
      name: 'CONTROL iss off by one character',
      reason: 'issuer_mismatch',
      rp: () => makeRp({ provider: { allowIdpInitiated: true } }),
      query: { iss: `${IDP}/` },
    },
    {
      name: 'CONTROL a SAML provider',
      reason: 'provider_not_oidc',
      rp: () => makeRp({ saml: true, provider: { allowIdpInitiated: true } }),
      query: { iss: IDP },
    },
    {
      name: 'CONTROL an untrusted target_link_uri',
      reason: 'target_link_uri_untrusted',
      rp: () => makeRp({ provider: { allowIdpInitiated: true } }),
      query: { iss: IDP, target_link_uri: 'https://attacker.example/after' },
    },
  ];
  for (const control of controls) {
    it(`${control.name}: today's 302 error=state_not_found, one warn line naming ${control.reason}, nothing written`, async () => {
      const rp = await control.rp();
      const res = await initiate(rp, control.query);
      expect(res.status).toBe(302);
      expect(landing(res)).toEqual({ base: `${BASE}/_console/login`, error: 'state_not_found' });
      expect(setCookies(res).filter((c) => !/=;|Max-Age=0/i.test(c))).toEqual([]);
      expect(authStateRows(rp)).toHaveLength(0);
      expect(rows(rp, 'sys_session')).toHaveLength(0);
      expect(entryLines(rp)).toEqual([
        [expect.stringContaining(`(${control.reason})`), { providerId: PROVIDER_ID, entry: 'third_party_initiated', reason: control.reason }],
      ]);
    });
  }

  it('the warn line carries neither the iss nor the target it refused', async () => {
    const rp = await makeRp({ provider: { allowIdpInitiated: true } });
    await initiate(rp, { iss: `${IDP}/evil`, target_link_uri: 'https://attacker.example/after' });
    const logged = JSON.stringify(entryLines(rp));
    expect(logged).not.toContain('evil');
    expect(logged).not.toContain('attacker');
  });

  it('a request that is not the §4 shape is the vendor\'s, untouched by the entry', async () => {
    const rp = await makeRp({ provider: { allowIdpInitiated: true } });
    const withError = await initiate(rp, { iss: IDP, error: 'access_denied' });
    expect(landing(withError).base).not.toBe(`${IDP}/authorize`);
    const withState = await initiate(rp, { iss: IDP, state: 'anything' });
    expect(landing(withState).base).not.toBe(`${IDP}/authorize`);
    expect(entryLines(rp)).toHaveLength(0);
    expect(authStateRows(rp)).toHaveLength(0);
  });
});

// ── 2. The shape, the gate, the fall-through ────────────────────────────────

describe('[#32086] the third-party-initiated shape and gate', () => {
  const at = (query: string, method = 'GET') => new Request(`${AUTH}/sso/callback/${PROVIDER_ID}?${query}`, { method });

  it('is a GET with one non-empty iss and no code, state or error', () => {
    expect(thirdPartyInitiatedLoginOf(at(`iss=${encodeURIComponent(IDP)}`))).toEqual({ iss: IDP });
    expect(
      thirdPartyInitiatedLoginOf(at(`iss=${encodeURIComponent(IDP)}&target_link_uri=%2Fhome&login_hint=mia`)),
    ).toEqual({ iss: IDP, targetLinkUri: '/home', loginHint: 'mia' });
    for (const query of ['', 'iss=', `iss=a&iss=b`, `iss=a&code=c`, `iss=a&state=s`, `iss=a&error=e`]) {
      expect(thirdPartyInitiatedLoginOf(at(query)), query).toBeUndefined();
    }
    expect(thirdPartyInitiatedLoginOf(at('iss=a', 'POST'))).toBeUndefined();
  });

  it('judges the four conditions in order; iss is compared byte for byte', () => {
    const on = { issuer: IDP, oidc: true, allowIdpInitiated: true };
    const trusted = (url: string) => url.startsWith(BASE) || url.startsWith('/');
    expect(judgeThirdPartyInitiatedLogin({ iss: IDP }, on, trusted)).toBeUndefined();
    expect(judgeThirdPartyInitiatedLogin({ iss: IDP, targetLinkUri: '/x' }, on, trusted)).toBeUndefined();
    expect(judgeThirdPartyInitiatedLogin({ iss: IDP }, undefined, trusted)).toBe('provider_not_registered');
    expect(judgeThirdPartyInitiatedLogin({ iss: IDP }, { ...on, oidc: false }, trusted)).toBe('provider_not_oidc');
    expect(judgeThirdPartyInitiatedLogin({ iss: IDP }, { ...on, allowIdpInitiated: false }, trusted)).toBe('idp_initiated_off');
    for (const iss of [`${IDP}/`, IDP.toUpperCase(), ` ${IDP}`]) {
      expect(judgeThirdPartyInitiatedLogin({ iss }, on, trusted), iss).toBe('issuer_mismatch');
    }
    expect(judgeThirdPartyInitiatedLogin({ iss: '' }, { ...on, issuer: '' }, trusted)).toBe('issuer_mismatch');
    expect(judgeThirdPartyInitiatedLogin({ iss: IDP, targetLinkUri: 'https://x.example' }, on, trusted)).toBe(
      'target_link_uri_untrusted',
    );
  });

  it('reads the provider row fail closed', async () => {
    const reader = (row: Record<string, unknown> | undefined) => ({ find: async () => (row ? [row] : []) });
    expect(await readThirdPartyLoginProvider(undefined, PROVIDER_ID)).toBeUndefined();
    expect(await readThirdPartyLoginProvider(reader(undefined), PROVIDER_ID)).toBeUndefined();
    expect(await readThirdPartyLoginProvider({ find: async () => Promise.reject(new Error('down')) }, PROVIDER_ID)).toBeUndefined();
    expect(await readThirdPartyLoginProvider(reader({ provider_id: 'other' }), PROVIDER_ID)).toBeUndefined();
    expect(
      await readThirdPartyLoginProvider(
        reader({ provider_id: PROVIDER_ID, issuer: IDP, oidc_config: '{"clientId":"c"}', allow_idp_initiated: 1 }),
        PROVIDER_ID,
      ),
    ).toEqual({ issuer: IDP, oidc: true, allowIdpInitiated: true });
    expect(
      await readThirdPartyLoginProvider(reader({ provider_id: PROVIDER_ID, issuer: IDP, saml_config: '{}', allow_idp_initiated: 0 }), PROVIDER_ID),
    ).toEqual({ issuer: IDP, oidc: false, allowIdpInitiated: false });
  });

  describe('the entry', () => {
    const vendorAnswer = new Response(null, { status: 302, headers: { location: `${BASE}/_console/login?error=state_not_found` } });
    const host = (over: Partial<ThirdPartyLoginHost> = {}): ThirdPartyLoginHost & { dispatch: ReturnType<typeof vi.fn> } =>
      ({
        readProvider: async () => ({ issuer: IDP, oidc: true, allowIdpInitiated: true }),
        context: async () => ({ isTrustedOrigin: (url: string) => url.startsWith(BASE), options: { baseURL: BASE } }),
        startUrl: `${AUTH}/sign-in/sso`,
        dispatch: vi.fn(async () =>
          new Response(JSON.stringify({ url: `${IDP}/authorize?state=s1`, redirect: true }), {
            status: 200,
            headers: [
              ['content-type', 'application/json'],
              ['set-cookie', 'better-auth.state=s1.sig; Path=/; HttpOnly; SameSite=Lax'],
            ],
          }),
        ),
        logger: { warn: vi.fn() },
        ...over,
      }) as never;
    const entry = (query: string, headers: Record<string, string> = {}) => ({
      providerId: PROVIDER_ID,
      request: new Request(`${AUTH}/sso/callback/${PROVIDER_ID}?${query}`, { headers }),
    });

    it('re-dispatches the vendor start without the browser cookies or navigation headers, and answers its URL and state cookie', async () => {
      const h = host();
      const fallThrough = vi.fn(async () => vendorAnswer);
      const res = await runThirdPartyInitiatedLogin(
        entry(`iss=${encodeURIComponent(IDP)}&target_link_uri=${encodeURIComponent(`${BASE}/x`)}&login_hint=mia`, {
          cookie: 'better-auth.session_token=secret',
          referer: IDP,
          'sec-fetch-site': 'cross-site',
          'user-agent': 'ua/1',
        }),
        h,
        fallThrough,
      );
      expect(fallThrough).not.toHaveBeenCalled();
      expect(res.status).toBe(302);
      expect(res.headers.get('location')).toBe(`${IDP}/authorize?state=s1`);
      expect(res.headers.getSetCookie()).toEqual(['better-auth.state=s1.sig; Path=/; HttpOnly; SameSite=Lax']);
      const sent: Request = h.dispatch.mock.calls[0]![0];
      expect(sent.method).toBe('POST');
      expect(sent.url).toBe(`${AUTH}/sign-in/sso`);
      expect(await sent.json()).toEqual({ providerId: PROVIDER_ID, providerType: 'oidc', callbackURL: `${BASE}/x`, loginHint: 'mia' });
      expect(sent.headers.get('cookie')).toBeNull();
      expect(sent.headers.get('referer')).toBeNull();
      expect(sent.headers.get('sec-fetch-site')).toBeNull();
      expect(sent.headers.get('user-agent')).toBe('ua/1');
    });

    it('a start the vendor refuses, an unreadable context or a missing base URL keeps the vendor answer, with one warn line', async () => {
      const cases: Array<Partial<ThirdPartyLoginHost>> = [
        { dispatch: async () => new Response(JSON.stringify({ message: 'Provider domain has not been verified' }), { status: 401 }) },
        { dispatch: async () => new Response(JSON.stringify({ url: 'javascript:alert(1)' }), { status: 200 }) },
        { dispatch: async () => Promise.reject(new Error('boom')) },
        { context: async () => ({ isTrustedOrigin: () => true, options: {} }) },
        { context: async () => Promise.reject(new Error('no context')) },
      ];
      for (const over of cases) {
        const h = host(over);
        const res = await runThirdPartyInitiatedLogin(entry(`iss=${encodeURIComponent(IDP)}`), h, async () => vendorAnswer);
        expect(res).toBe(vendorAnswer);
        expect((h.logger!.warn as any).mock.calls).toHaveLength(1);
      }
    });

    it('a request of any other shape goes straight to the vendor, with no read and no line', async () => {
      const h = host({ readProvider: vi.fn(async () => undefined) });
      const res = await runThirdPartyInitiatedLogin(entry('code=c'), h, async () => vendorAnswer);
      expect(res).toBe(vendorAnswer);
      expect(h.readProvider).not.toHaveBeenCalled();
      expect(h.dispatch).not.toHaveBeenCalled();
      expect((h.logger!.warn as any).mock.calls).toHaveLength(0);
    });

    it('names every miss it can write', () => {
      expect([...THIRD_PARTY_INITIATED_LOGIN_MISSES].sort()).toEqual(
        ['idp_initiated_off', 'issuer_mismatch', 'provider_not_oidc', 'provider_not_registered', 'start_refused', 'target_link_uri_untrusted'],
      );
    });
  });
});
