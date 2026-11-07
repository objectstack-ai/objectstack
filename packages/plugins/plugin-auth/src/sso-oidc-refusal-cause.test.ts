// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * A refused enterprise OIDC sign-in names its cause — see
 * `sso-oidc-refusal-cause.ts` for the rule this file pins.
 *
 * Two layers:
 *
 *  1. END of the chain — a real `AuthManager` with the real `sso()` plugin
 *     over the in-memory engine, driven through its HTTP surface:
 *     `/sign-in/sso` → `/sso/callback/:providerId`. Only the IdP is stubbed
 *     (its token and JWKS endpoints answer over `fetch`); the ID token is
 *     signed here with a key this file generates, so each refusal class is
 *     produced by the vendor's real verifier, not by a double. One case per
 *     cause, a CONTROL that signs in, an unclassified refusal that keeps the
 *     vendor's description, and a no-leak pin on the redirect and the log.
 *  2. The classification and the redirect rewrite, read off their own inputs.
 *
 * The END cases are what goes red if the side channel stops carrying the
 * cause (a vendor bump that logs a string instead of the error object, or a
 * sink that is no longer handed to `betterAuth`): the redirect falls back to
 * `token_not_verified`, and every per-cause assertion fails.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SignJWT, exportJWK, generateKeyPair, type JWK } from 'jose';
import { AuthManager } from './auth-manager';
import { createMemoryEngine } from './impersonation-bearer-rotation.test';
import {
  SSO_OIDC_REFUSAL_CAUSES,
  SSO_OIDC_UNCLASSIFIED_REFUSAL,
  classifySsoOidcIdTokenError,
  createBetterAuthLogSink,
  runSsoOidcCallbackScope,
  ssoOidcCallbackProviderId,
} from './sso-oidc-refusal-cause';
// better-auth's first module load is paid at module load, not inside the first
// clocked case (AGENTS.md, Build & Test). `AuthManager` reaches these through a
// lazy `await import()`.
import 'better-auth';
import 'better-auth/plugins';
import 'better-auth/plugins/organization';
import '@better-auth/sso';

const SECRET = 'test-secret-at-least-32-chars-long-sso-refusal';
const BASE = 'http://localhost:3000';
const AUTH = `${BASE}/api/v1/auth`;
const IDP = 'https://idp.example.test';
const PROVIDER_ID = 'acme-okta';
const CLIENT_ID = 'acme-client-id';
const CLIENT_SECRET = 'acme-client-secret';
const KID = 'current-key';
const AFTER = `${BASE}/after-sign-in`;
const FAILED = `${BASE}/sign-in-failed`;
const SUBJECT = 'okta-subject-00u1abcd';
const EMAIL = 'mia.chen@acme.com';

type Engine = ReturnType<typeof createMemoryEngine>;

// ── The IdP ─────────────────────────────────────────────────────────────────

interface IdpKeys {
  privateKey: CryptoKey;
  publicJwk: JWK;
  /** A second key pair the JWKS never publishes. */
  otherPrivateKey: CryptoKey;
}

let keys: IdpKeys;

beforeEach(async () => {
  if (keys) return;
  const current = await generateKeyPair('RS256', { extractable: true });
  const other = await generateKeyPair('RS256', { extractable: true });
  keys = {
    privateKey: current.privateKey,
    publicJwk: { ...(await exportJWK(current.publicKey)), kid: KID, alg: 'RS256', use: 'sig' },
    otherPrivateKey: other.privateKey,
  };
});

interface TokenShape {
  iss?: string;
  aud?: string;
  azp?: string;
  /** Seconds from now. */
  exp?: number;
  /** Seconds from now. */
  nbf?: number;
  kid?: string;
  signWith?: 'current' | 'other';
  email?: string;
}

async function idToken(shape: TokenShape = {}): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const claims: Record<string, unknown> = {
    email: shape.email ?? EMAIL,
    email_verified: true,
    name: 'Mia Chen',
  };
  if (shape.azp) claims.azp = shape.azp;
  const jwt = new SignJWT(claims)
    .setProtectedHeader({ alg: 'RS256', kid: shape.kid ?? KID })
    .setIssuer(shape.iss ?? IDP)
    .setAudience(shape.aud ?? CLIENT_ID)
    .setSubject(SUBJECT)
    .setIssuedAt(now - 600)
    .setExpirationTime(now + (shape.exp ?? 300));
  if (shape.nbf !== undefined) jwt.setNotBefore(now + shape.nbf);
  return jwt.sign(shape.signWith === 'other' ? keys.otherPrivateKey : keys.privateKey);
}

/** Routes the IdP's token and JWKS endpoints; everything else is refused loudly. */
function stubIdp(token: string) {
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : (input as Request).url;
    const json = (body: unknown) =>
      new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
    if (url.startsWith(`${IDP}/token`)) {
      return json({ access_token: 'at-opaque', token_type: 'Bearer', expires_in: 300, id_token: token });
    }
    if (url.startsWith(`${IDP}/jwks`)) return json({ keys: [keys.publicJwk] });
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
  error: ReturnType<typeof vi.fn>;
  info: ReturnType<typeof vi.fn>;
}

async function makeRp(): Promise<Rp> {
  const engine = createMemoryEngine();
  // The host's secret store: the adapter lifts `clientSecret` out of the
  // provider row on write (`sso-client-secret.ts`) and reads it back through
  // this accessor on the callback's provider read.
  (engine as any).resolveSecretField = async () => CLIENT_SECRET;
  const warn = vi.fn();
  const error = vi.fn();
  const info = vi.fn();
  const manager = new AuthManager({
    secret: SECRET,
    baseUrl: BASE,
    dataEngine: engine,
    trustedOrigins: [BASE, IDP],
    plugins: { sso: true },
    logger: { warn, error, info },
  } as unknown as ConstructorParameters<typeof AuthManager>[0]);
  // The provider, written through the vendor's own adapter so it is stored the
  // way `/sso/register` stores it. All endpoints are declared, so the callback
  // needs no discovery fetch.
  const auth: any = await manager.getAuthInstance();
  const ctx = await auth.$context;
  await ctx.adapter.create({
    model: 'ssoProvider',
    data: {
      providerId: PROVIDER_ID,
      issuer: IDP,
      domain: 'acme.com',
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
    },
  });
  return { manager, engine, warn, error, info };
}

const cookiesOf = (res: Response): string =>
  (res.headers.getSetCookie?.() ?? [res.headers.get('set-cookie') ?? ''])
    .map((c) => c.split(';')[0]!)
    .filter(Boolean)
    .join('; ');

/** `/sign-in/sso` → the IdP → `/sso/callback/:providerId`; answers the callback response. */
async function signInThroughIdp(rp: Rp, token: string): Promise<Response> {
  const start = await rp.manager.handleRequest(
    new Request(`${AUTH}/sign-in/sso`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: BASE },
      body: JSON.stringify({ providerId: PROVIDER_ID, callbackURL: AFTER, errorCallbackURL: FAILED }),
    }),
  );
  const body: any = await start.clone().json().catch(() => null);
  expect(start.status, JSON.stringify(body)).toBe(200);
  const state = new URL(body.url).searchParams.get('state');
  expect(state, `sign-in/sso answered no state: ${JSON.stringify(body)}`).toBeTruthy();

  const restore = stubIdp(token);
  try {
    return await rp.manager.handleRequest(
      new Request(`${AUTH}/sso/callback/${PROVIDER_ID}?code=idp-code&state=${encodeURIComponent(state!)}`, {
        headers: { cookie: cookiesOf(start) },
      }),
    );
  } finally {
    restore();
  }
}

function errorParams(res: Response): { base: string; error: string | null; description: string | null } {
  const location = res.headers.get('location') ?? '';
  const url = new URL(location, BASE);
  return {
    base: `${url.origin}${url.pathname}`,
    error: url.searchParams.get('error'),
    description: url.searchParams.get('error_description'),
  };
}

/** The structured refusal lines this package wrote: `warn` calls carrying `protocol: 'oidc'`. */
function refusalLines(rp: Rp): Array<[string, Record<string, unknown>]> {
  return rp.warn.mock.calls.filter(([, meta]) => (meta as any)?.protocol === 'oidc') as never;
}

/** Every argument any host-logger channel received, serialized. */
function everythingLogged(rp: Rp): string {
  return JSON.stringify([...rp.warn.mock.calls, ...rp.error.mock.calls, ...rp.info.mock.calls]);
}

// ── 1. END of the chain ─────────────────────────────────────────────────────

describe('an enterprise OIDC callback names the cause of a refused ID token', () => {
  let rp: Rp;
  beforeEach(async () => {
    rp = await makeRp();
  });

  it('CONTROL: a valid ID token signs in, and no refusal line is written', async () => {
    const res = await signInThroughIdp(rp, await idToken());
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe(AFTER);
    expect(cookiesOf(res)).toMatch(/session_token=/);
    expect(refusalLines(rp)).toEqual([]);
  });

  const cases: Array<[(typeof SSO_OIDC_REFUSAL_CAUSES)[number], TokenShape]> = [
    ['id_token_expired', { exp: -600 }],
    ['id_token_not_yet_valid', { nbf: 3600 }],
    ['id_token_audience_mismatch', { aud: 'someone-elses-client' }],
    ['id_token_issuer_mismatch', { iss: 'https://foreign-idp.example.test' }],
    ['id_token_signing_key_unknown', { kid: 'retired-key', signWith: 'other' }],
    ['id_token_signature_invalid', { signWith: 'other' }],
  ];

  it('covers every exported cause', () => {
    expect(cases.map(([cause]) => cause).sort()).toEqual([...SSO_OIDC_REFUSAL_CAUSES].sort());
  });

  for (const [cause, shape] of cases) {
    it(`${cause}: the redirect carries the cause, error= is unchanged, one warn line names it`, async () => {
      const res = await signInThroughIdp(rp, await idToken(shape));
      expect(res.status).toBe(302);
      expect(errorParams(res)).toEqual({ base: FAILED, error: 'invalid_provider', description: cause });
      expect(refusalLines(rp)).toEqual([
        [expect.stringContaining(cause), { providerId: PROVIDER_ID, protocol: 'oidc', cause }],
      ]);
      // The vendor's own error line for this refusal is replaced, not doubled.
      expect(rp.error).not.toHaveBeenCalled();
    });
  }

  it('an unclassified refusal keeps the vendor description, and still writes the warn line', async () => {
    // An `azp` naming another client is refused by the vendor's own check,
    // which throws a plain Error with no `jose` code.
    const res = await signInThroughIdp(rp, await idToken({ azp: 'another-client' }));
    expect(errorParams(res)).toEqual({ base: FAILED, error: 'invalid_provider', description: SSO_OIDC_UNCLASSIFIED_REFUSAL });
    expect(refusalLines(rp)).toEqual([
      [expect.any(String), { providerId: PROVIDER_ID, protocol: 'oidc', cause: SSO_OIDC_UNCLASSIFIED_REFUSAL }],
    ]);
    // Nothing was classified, so the vendor's diagnosis still reaches the log.
    expect(JSON.stringify(rp.error.mock.calls)).toContain('authorized party');
  });

  it('no token content and no account signal, on the redirect or in any log line', async () => {
    const token = await idToken({ exp: -600 });
    const res = await signInThroughIdp(rp, token);
    const location = res.headers.get('location') ?? '';
    const logged = everythingLogged(rp);
    for (const secret of [token, token.split('.')[1]!, SUBJECT, EMAIL, 'Mia Chen']) {
      expect(location).not.toContain(secret);
      expect(logged).not.toContain(secret);
    }

    // The same refusal for an account that exists and one that does not.
    await rp.engine.insert('sys_user', { id: 'usr_known', email: EMAIL, name: 'Mia Chen', email_verified: true });
    const other = await makeRp();
    const known = await signInThroughIdp(rp, await idToken({ exp: -600 }));
    const unknown = await signInThroughIdp(other, await idToken({ exp: -600, email: 'nobody@acme.com' }));
    expect(errorParams(known)).toEqual(errorParams(unknown));
    const last = (r: Rp) => refusalLines(r)[refusalLines(r).length - 1];
    expect(last(rp)).toEqual(last(other));
  });
});

// ── 2. Classification and rewrite ───────────────────────────────────────────

describe('classifying a jose verification error', () => {
  it('reads the code and claim, never the message', () => {
    expect(classifySsoOidcIdTokenError({ code: 'ERR_JWT_EXPIRED' })).toBe('id_token_expired');
    expect(classifySsoOidcIdTokenError({ code: 'ERR_JWT_CLAIM_VALIDATION_FAILED', claim: 'aud' })).toBe('id_token_audience_mismatch');
    expect(classifySsoOidcIdTokenError({ code: 'ERR_JWT_CLAIM_VALIDATION_FAILED', claim: 'iss' })).toBe('id_token_issuer_mismatch');
    expect(classifySsoOidcIdTokenError({ code: 'ERR_JWT_CLAIM_VALIDATION_FAILED', claim: 'nbf' })).toBe('id_token_not_yet_valid');
    expect(classifySsoOidcIdTokenError({ code: 'ERR_JWKS_NO_MATCHING_KEY' })).toBe('id_token_signing_key_unknown');
    expect(classifySsoOidcIdTokenError({ code: 'ERR_JWS_SIGNATURE_VERIFICATION_FAILED' })).toBe('id_token_signature_invalid');
    // A message that names a cause is not a code.
    expect(classifySsoOidcIdTokenError(new Error('"exp" claim timestamp check failed'))).toBeUndefined();
    expect(classifySsoOidcIdTokenError({ code: 'ERR_JWT_CLAIM_VALIDATION_FAILED', claim: 'sub' })).toBeUndefined();
    expect(classifySsoOidcIdTokenError('ERR_JWT_EXPIRED')).toBeUndefined();
    expect(classifySsoOidcIdTokenError(undefined)).toBeUndefined();
  });

  it('scopes only the per-provider callback path', () => {
    expect(ssoOidcCallbackProviderId('/sso/callback/acme-okta')).toBe('acme-okta');
    expect(ssoOidcCallbackProviderId('/sso/callback')).toBeUndefined();
    expect(ssoOidcCallbackProviderId('/sso/callback/a/b')).toBeUndefined();
    expect(ssoOidcCallbackProviderId('/sso/saml2/sp/acs/acme')).toBeUndefined();
    expect(ssoOidcCallbackProviderId(undefined)).toBeUndefined();
  });
});

describe('the redirect rewrite', () => {
  const host = () => ({ warn: vi.fn(), error: vi.fn() });
  const redirect = (location: string) => new Response(null, { status: 302, headers: { location, 'set-cookie': 'a=1' } });
  const expiredLine = (sink: ReturnType<typeof createBetterAuthLogSink>) =>
    sink.log('error', Object.assign(new Error('"exp" claim timestamp check failed'), { code: 'ERR_JWT_EXPIRED', payload: { sub: SUBJECT } }));

  it('changes only the description segment, and keeps every other byte and header', async () => {
    const h = host();
    const sink = createBetterAuthLogSink(() => h);
    const res = await runSsoOidcCallbackScope('p1', h, async () => {
      expiredLine(sink);
      return redirect('/fail?x=a%20b&error=invalid_provider&error_description=token_not_verified#frag');
    });
    expect(res.headers.get('location')).toBe('/fail?x=a%20b&error=invalid_provider&error_description=id_token_expired#frag');
    expect(res.headers.get('set-cookie')).toBe('a=1');
    expect(h.error).not.toHaveBeenCalled();
  });

  it('a held line is released unchanged when the answer is not the opaque refusal', async () => {
    const h = host();
    const sink = createBetterAuthLogSink(() => h);
    const res = await runSsoOidcCallbackScope('p1', h, async () => {
      expiredLine(sink);
      return redirect('/fail?error=invalid_state');
    });
    expect(res.headers.get('location')).toBe('/fail?error=invalid_state');
    expect(h.warn).not.toHaveBeenCalled();
    expect(h.error).toHaveBeenCalledTimes(1);
    // The claim set a jose claim error carries is never handed to a log line.
    expect(JSON.stringify(h.error.mock.calls)).not.toContain(SUBJECT);
  });

  it('outside a callback scope the sink only forwards, level for level', () => {
    const h = { warn: vi.fn(), error: vi.fn(), info: vi.fn() };
    const sink = createBetterAuthLogSink(() => h);
    expiredLine(sink);
    sink.log('warn', 'a warning', { providerId: 'p1' });
    expect(h.error).toHaveBeenCalledTimes(1);
    expect(h.warn).toHaveBeenCalledWith('[better-auth] a warning', { providerId: 'p1' });
  });
});
