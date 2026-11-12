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

import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SignJWT, exportJWK, generateKeyPair, type JWK } from 'jose';
import { AuthManager } from './auth-manager';
import { createMemoryEngine } from './impersonation-bearer-rotation.test';
import { inviteForAudienceGate } from './audience-gate-test-support';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { SecurityPlugin } from '@objectstack/plugin-security';
import { ADMIN_FULL_ACCESS } from '@objectstack/spec/identity';
import { authIdentityObjects, authObjectExtensions } from './manifest.js';
import { SysSecret } from '@objectstack/platform-objects';
import type { CryptoHandle, ICryptoProvider } from '@objectstack/spec/contracts';
import { registerLastAdminGuard, type LastAdminGuardEngine } from './last-admin-guard.js';
import { runDeleteIdpGroupMapping, runSetIdpGroupMapping, type IdpGroupMappingAdminDeps } from './idp-group-mapping-admin.js';
import { createEngineSsoProviderConfigReader, runSetSsoGroupsClaim, runShowSsoGroupsClaim } from './register-sso-provider.js';
import type { OrganizationBoundaryJudge } from './scim-group-projection.js';
import { bindTestSecurityCatalog } from './__tests__/security-catalog.testkit.js';
import { sqliteEnginePool, type BootedSqliteEngine } from './__tests__/sqlite-engine-pool.testkit.js';
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
  /** `null` asserts no email claim at all (an Entra ID user without a mailbox). */
  email?: string | null;
  /** Further claims the IdP asserts (e.g. `groups`). */
  claims?: Record<string, unknown>;
}

async function idToken(shape: TokenShape = {}): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const claims: Record<string, unknown> = {
    ...(shape.email === null ? {} : { email: shape.email ?? EMAIL }),
    email_verified: true,
    name: 'Mia Chen',
    ...shape.claims,
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

/** Userinfo on a host other than the issuer's, as Microsoft Entra ID's discovery names it (Microsoft Graph). */
const USERINFO_HOST = 'https://graph.idp.example.test';
const USERINFO_ENDPOINT = `${USERINFO_HOST}/oidc/userinfo`;

/** The userinfo calls the stubbed IdP answered in this process. */
const userInfoCalls: string[] = [];

/**
 * Routes the IdP's token and JWKS endpoints, and its userinfo endpoint when
 * `userInfo` is given; everything else at the IdP is refused loudly.
 */
function stubIdp(token: string, userInfo?: Record<string, unknown>) {
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : (input as Request).url;
    const json = (body: unknown) =>
      new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
    if (userInfo && url.startsWith(USERINFO_ENDPOINT)) {
      userInfoCalls.push(url);
      return json(userInfo);
    }
    if (url.startsWith(USERINFO_HOST)) throw new Error(`unexpected userinfo fetch: ${url}`);
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

interface RpOptions {
  /** Extra provider-row fields, written through the vendor's adapter (e.g. `allowJit`). */
  provider?: Record<string, unknown>;
  /** Extra `AuthManager` config (e.g. `audience`). */
  config?: Record<string, unknown>;
}

async function makeRp(opts: RpOptions = {}): Promise<Rp> {
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
    ...opts.config,
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
      ...opts.provider,
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
async function signInThroughIdp(rp: Rp, token: string, userInfo?: Record<string, unknown>): Promise<Response> {
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

  const restore = stubIdp(token, userInfo);
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
function refusalLines(rp: Pick<Rp, 'warn'>): Array<[string, Record<string, unknown>]> {
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

// ── 3. Per-provider sign-in options (`sso-sign-in-options.ts`) ──────────────

/** A human who is not the newcomer, so no case below rides the zero-user bootstrap carve-out. */
const seedAdmin = async (rp: Rp) => {
  await rp.engine.insert('sys_user', { id: 'usr_admin', email: 'admin@acme.com', name: 'Admin', email_verified: true });
};

/**
 * An IdP-initiated OIDC sign-in: the IdP sends the browser to the callback
 * with a `code` and no `state`. Answers the callback's response, and — when
 * the vendor restarted the flow — the response of finishing it at the IdP.
 */
async function idpInitiated(rp: Rp, token: string): Promise<{ first: Response; finished?: Response }> {
  const first = await rp.manager.handleRequest(new Request(`${AUTH}/sso/callback/${PROVIDER_ID}?code=idp-code`));
  const location = first.headers.get('location') ?? '';
  if (!location.startsWith(`${IDP}/authorize`)) return { first };
  const state = new URL(location).searchParams.get('state');
  const restore = stubIdp(token);
  try {
    const finished = await rp.manager.handleRequest(
      new Request(`${AUTH}/sso/callback/${PROVIDER_ID}?code=idp-code&state=${encodeURIComponent(state!)}`, {
        headers: { cookie: cookiesOf(first) },
      }),
    );
    return { first, finished };
  } finally {
    restore();
  }
}

describe('OIDC IdP-initiated sign-in is a per-provider toggle, off by default', () => {
  it('off (the default): a stateless callback is refused 302 error=state_not_found, and signs nobody in', async () => {
    const rp = await makeRp({ provider: { allowJit: true } });
    await seedAdmin(rp);
    const { first, finished } = await idpInitiated(rp, await idToken());
    expect(first.status).toBe(302);
    expect(errorParams(first).error).toBe('state_not_found');
    expect(finished).toBeUndefined();
    expect(cookiesOf(first)).not.toMatch(/session_token=[^;]/);
  });

  it('on: the vendor restarts the flow at the IdP with a fresh state, and finishing it signs the person in', async () => {
    const rp = await makeRp({ provider: { allowIdpInitiated: true, allowJit: true } });
    await seedAdmin(rp);
    const { first, finished } = await idpInitiated(rp, await idToken());
    expect(first.status).toBe(302);
    expect(new URL(first.headers.get('location')!).searchParams.get('state')).toBeTruthy();
    expect(finished?.status).toBe(302);
    expect(errorParams(finished!).error).toBeNull();
    expect(cookiesOf(finished!)).toMatch(/session_token=[^;]/);
  });

  it('the toggle is the column alone: a value smuggled into the stored OIDC blob is not read, and is never written', async () => {
    const rp = await makeRp({ provider: { allowJit: true } });
    await seedAdmin(rp);
    const row = rp.engine.tables.get('sys_sso_provider')![0];
    row.oidc_config = JSON.stringify({ ...JSON.parse(row.oidc_config), allowIdpInitiated: true });
    const { first } = await idpInitiated(rp, await idToken());
    expect(errorParams(first).error).toBe('state_not_found');

    // A write that carries the blob back (update-provider merges what it read) stores none.
    const auth: any = await rp.manager.getAuthInstance();
    const ctx = await auth.$context;
    await ctx.adapter.update({
      model: 'ssoProvider',
      where: [{ field: 'providerId', value: PROVIDER_ID }],
      update: { oidcConfig: JSON.stringify({ issuer: IDP, clientId: CLIENT_ID, allowIdpInitiated: true }) },
    });
    expect(JSON.parse(rp.engine.tables.get('sys_sso_provider')![0].oidc_config)).not.toHaveProperty('allowIdpInitiated');
  });
});

describe('invite_only refuses an unknown OIDC user unless the provider allows JIT', () => {
  it('invite_only (the default) + no account + no invitation: refused 302 error=SELF_REGISTRATION_CLOSED, no user created', async () => {
    const rp = await makeRp();
    await seedAdmin(rp);
    const res = await signInThroughIdp(rp, await idToken());
    expect(res.status).toBe(302);
    expect(errorParams(res)).toMatchObject({ base: FAILED, error: 'SELF_REGISTRATION_CLOSED' });
    expect(cookiesOf(res)).not.toMatch(/session_token=[^;]/);
    expect(rp.engine.tables.get('sys_user')?.map((u: any) => u.email)).toEqual(['admin@acme.com']);
  });

  it('the provider allows JIT: the same person is provisioned and signed in', async () => {
    const rp = await makeRp({ provider: { allowJit: true } });
    await seedAdmin(rp);
    const res = await signInThroughIdp(rp, await idToken());
    expect(res.headers.get('location')).toBe(AFTER);
    expect(cookiesOf(res)).toMatch(/session_token=/);
  });

  it('CONTROL: an invited person is provisioned with JIT off', async () => {
    const rp = await makeRp();
    await seedAdmin(rp);
    await inviteForAudienceGate(rp.engine, EMAIL);
    const res = await signInThroughIdp(rp, await idToken());
    expect(res.headers.get('location')).toBe(AFTER);
    expect(cookiesOf(res)).toMatch(/session_token=/);
  });

  it('CONTROL: posture email_domain provisions with JIT off, as before', async () => {
    const rp = await makeRp({
      config: { audience: { posture: 'email_domain', allowedEmailDomains: ['other.example'], selfRegistrationPermissionSet: 'member_default' } },
    });
    await seedAdmin(rp);
    const res = await signInThroughIdp(rp, await idToken());
    expect(res.headers.get('location')).toBe(AFTER);
    expect(cookiesOf(res)).toMatch(/session_token=/);
  });
});

// ── 4. IdP group → permission set at sign-in ────────────────────────────────
//
// Ruling A on the Enterprise SSO knobs (record 6718355623), item 3: an SSO
// provider's group claim grants the ordinary permission set a
// `sys_idp_group_mapping` row names, the same mapping model as SCIM. The
// sign-in is the real one above (`/sign-in/sso` → stubbed IdP → callback), on a
// real ObjectQL engine over better-sqlite3 with the break-glass guard
// registered as `auth-plugin.ts` registers it; the mapping is saved through
// the platform-admin door's own function and judged by plugin-security's REAL
// `organizationBoundaryFailure`.

const GROUP_ORG = 'org_acme_sso';
const DEFAULT_ORG = 'org_default';
const SALES = 'sales_reader';
/** Outside the boundary by condition (c): a capability no catalog entry declares `scope: 'org'`. */
const PLATFORM_OPS = 'platform_ops';
/** The marker every grant this provider's sign-ins project carries (its wire value, pinned literally). */
const SSO_MARKER = `sso-group-projection: provider '${PROVIDER_ID}'`;
const SYSTEM = { context: { isSystem: true } } as const;
const PLATFORM_ADMIN = { id: 'usr_platform_admin' };

/** The grant table, down to the columns the projection and the guard read. */
const sysUserPermissionSet = {
  name: 'sys_user_permission_set',
  label: 'User Permission Set',
  fields: {
    id: { name: 'id', type: 'text' as const, primaryKey: true },
    user_id: { name: 'user_id', type: 'text' as const },
    permission_set: { name: 'permission_set', type: 'text' as const },
    organization_id: { name: 'organization_id', type: 'text' as const },
    reason: { name: 'reason', type: 'text' as const },
    valid_from: { name: 'valid_from', type: 'datetime' as const },
    valid_until: { name: 'valid_until', type: 'datetime' as const },
  },
};

const groupEnginePool = sqliteEnginePool(bootGroupEngine, { keepBootOrganizations: true });
afterEach(groupEnginePool.release);
afterAll(groupEnginePool.destroy);

async function bootGroupEngine(): Promise<BootedSqliteEngine> {
  const engine = new ObjectQL();
  const driver = new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true });
  engine.registerDriver(driver, true);
  await engine.init();
  for (const object of [...authIdentityObjects, sysUserPermissionSet, SysSecret]) {
    engine.registry.registerObject(withAuthExtensions(object) as never, '@objectstack/plugin-auth');
  }
  await engine.syncSchemas();
  // The OIDC client secret's encrypted channel, as the host composes it: a provider
  // write through the vendor (`/sso/update-provider`) lifts the secret onto
  // `oidc_client_secret` (`sso-client-secret.ts`), which needs the column and a
  // crypto provider. Rows these cases insert keep it in the blob (an un-migrated row).
  engine.setCryptoProvider(base64Crypto());
  await engine.insert('sys_organization', { id: DEFAULT_ORG, name: 'Default Organization', slug: 'default' }, SYSTEM);
  await engine.insert('sys_organization', { id: GROUP_ORG, name: 'Acme', slug: 'acme' }, SYSTEM);
  // [ADR-0131 D3/D4] `admin_full_access` is a catalog definition the guard resolves a grant's set name to.
  bindTestSecurityCatalog(engine, { permissions: [{ name: ADMIN_FULL_ACCESS }] });
  registerLastAdminGuard(engine as unknown as LastAdminGuardEngine, { packageId: 'test.last-admin-guard' });
  return { engine, driver };
}

/** An object with the fields plugin-auth's manifest adds to it (`authObjectExtensions`). */
function withAuthExtensions(object: { name?: string; fields?: Record<string, unknown> }): unknown {
  const extension = authObjectExtensions.find((e) => e.extend === object.name);
  return extension ? { ...object, fields: { ...object.fields, ...extension.fields } } : object;
}

/** A stand-in `ICryptoProvider`: base64 is enough to round-trip the secret column. */
function base64Crypto(): ICryptoProvider {
  let n = 0;
  return {
    async encrypt(plain: string): Promise<CryptoHandle> {
      n += 1;
      return { id: `sec_${n}`, kmsKeyId: 'local', alg: 'test-b64', version: 1, ciphertext: Buffer.from(plain, 'utf8').toString('base64') };
    },
    async decrypt(handle: CryptoHandle): Promise<string> { return Buffer.from(handle.ciphertext, 'base64').toString('utf8'); },
    async rotateKey(handle: CryptoHandle): Promise<CryptoHandle> { return { ...handle, version: handle.version + 1 }; },
    digest(plain: string): string { return `d:${plain.length}`; },
    async keyedDigest(plain: string): Promise<string> { return `k:${plain.length}`; },
  };
}

/** The catalog the security service judges against; a case may redefine a set after its mapping is saved. */
let groupCatalog: Array<Record<string, unknown>> = [];

/** The `security` service plugin-security registers, over a catalog bound to a stub engine. */
async function boundaryJudge(): Promise<OrganizationBoundaryJudge> {
  groupCatalog = [{ name: SALES }, { name: ADMIN_FULL_ACCESS }, { name: PLATFORM_OPS, systemPermissions: ['manage_platform_settings'] }];
  const ql = bindTestSecurityCatalog({ registerMiddleware: vi.fn(), getSchema: () => undefined }, () => ({ permissions: groupCatalog }));
  const services: Record<string, unknown> = {
    manifest: { register: vi.fn() },
    objectql: ql,
    metadata: { get: async () => undefined, list: async () => [] },
  };
  const registerService = vi.fn();
  const ctx = {
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    registerService,
    getService: (name: string) => {
      if (!(name in services)) throw new Error(`service not registered: ${name}`);
      return services[name];
    },
  };
  const plugin = new SecurityPlugin();
  await plugin.init(ctx as never);
  await plugin.start(ctx as never);
  const svc = registerService.mock.calls.find((c: unknown[]) => c[0] === 'security')?.[1] as Partial<OrganizationBoundaryJudge>;
  expect(typeof svc?.organizationBoundaryFailure, 'the security service serves organizationBoundaryFailure').toBe('function');
  return svc as OrganizationBoundaryJudge;
}

interface GroupRp {
  manager: AuthManager;
  engine: ObjectQL;
  door: IdpGroupMappingAdminDeps;
  warn: ReturnType<typeof vi.fn>;
  error: ReturnType<typeof vi.fn>;
}

/**
 * A relying party whose provider belongs to `GROUP_ORG` and maps the `groups`
 * claim through its own `mapping.extraFields`, JIT on. `judge: false` composes
 * no security service (the boundary seam is absent).
 */
async function makeGroupRp(opts: { judge?: boolean; provider?: Record<string, unknown> } = {}): Promise<GroupRp> {
  const engine = await groupEnginePool.take();
  const judge = opts.judge === false ? undefined : await boundaryJudge();
  const warn = vi.fn();
  const error = vi.fn();
  const manager = new AuthManager({
    secret: SECRET,
    baseUrl: BASE,
    dataEngine: engine,
    // The userinfo host is listed as an operator would list it: these cases
    // pin what a sign-in reads, not how a provider is registered.
    trustedOrigins: [BASE, IDP, USERINFO_HOST],
    plugins: { sso: true, organization: true },
    logger: { warn, error, info: vi.fn() },
    organizationBoundary: async () => judge,
  } as unknown as ConstructorParameters<typeof AuthManager>[0]);
  // Stored the way an un-migrated row is (cleartext secret in the blob), so the
  // callback reads it back without a crypto provider.
  await engine.insert('sys_sso_provider', {
    provider_id: PROVIDER_ID,
    issuer: IDP,
    domain: 'acme.com',
    organization_id: GROUP_ORG,
    allow_jit: true,
    oidc_config: JSON.stringify({
      issuer: IDP,
      clientId: CLIENT_ID,
      clientSecret: CLIENT_SECRET,
      authorizationEndpoint: `${IDP}/authorize`,
      tokenEndpoint: `${IDP}/token`,
      jwksEndpoint: `${IDP}/jwks`,
      discoveryEndpoint: `${IDP}/.well-known/openid-configuration`,
      pkce: true,
      scopes: ['openid', 'email', 'profile'],
      mapping: { email: 'email', name: 'name', extraFields: { groups: 'groups' } },
    }),
    ...opts.provider,
  }, SYSTEM);
  await engine.insert('sys_user', { id: 'usr_admin', email: 'admin@acme.com', name: 'Admin', email_verified: true }, SYSTEM);
  const door: IdpGroupMappingAdminDeps = {
    getDataEngine: () => manager.getDataEngine() as never,
    isScimEnabled: () => manager.isScimWired(),
    isSsoEnabled: () => manager.isSsoWired(),
    boundary: () => manager.organizationBoundaryJudge(),
    reconcile: (domain) => manager.reconcileScimProjectionDomain(domain),
    attributed: (fn) => fn(),
    logger: { warn, error },
  } as IdpGroupMappingAdminDeps;
  return { manager, engine, door, warn, error };
}

function saveGroupMapping(rp: GroupRp, body: Record<string, unknown>) {
  return runSetIdpGroupMapping(
    rp.door,
    PLATFORM_ADMIN,
    new Request(`${AUTH}/admin/scim/set-group-mapping`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
  );
}

function deleteGroupMapping(rp: GroupRp, mappingId: string) {
  return runDeleteIdpGroupMapping(
    rp.door,
    PLATFORM_ADMIN,
    new Request(`${AUTH}/admin/scim/delete-group-mapping`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ mappingId }) }),
  );
}

function savedMappingId(saved: Awaited<ReturnType<typeof runSetIdpGroupMapping>>): string {
  expect(saved.status, JSON.stringify(saved.body)).toBe(200);
  if (!saved.body.success) throw new Error('the mapping save was refused');
  return String(saved.body.data.mappingId);
}

/** Sign Mia in through the IdP with the given claims; answers the callback and Mia's user id. */
async function signInWithClaims(rp: GroupRp, claims?: Record<string, unknown>): Promise<{ res: Response; userId: string }> {
  const res = await signInThroughIdp(rp as unknown as Rp, await idToken({ claims }));
  expect(res.status).toBe(302);
  expect(res.headers.get('location'), `the sign-in did not land: ${res.headers.get('location')}`).toBe(AFTER);
  expect(cookiesOf(res)).toMatch(/session_token=[^;]/);
  const user = (await rp.engine.findOne('sys_user', { where: { email: EMAIL }, fields: ['id'] }, SYSTEM)) as { id: string } | null;
  expect(user, 'the sign-in landed a sys_user row').toBeTruthy();
  return { res, userId: String(user!.id) };
}

async function grantsOf(rp: GroupRp, userId: string): Promise<Array<{ permission_set: string; organization_id: string | null; reason: string | null }>> {
  const rows = (await rp.engine.find('sys_user_permission_set', { where: { user_id: userId } }, SYSTEM)) as Array<Record<string, unknown>>;
  return rows
    .map((r) => ({ permission_set: String(r.permission_set), organization_id: (r.organization_id as string) ?? null, reason: (r.reason as string) ?? null }))
    .sort((a, b) => a.permission_set.localeCompare(b.permission_set));
}

/** Every grant-table write the engine is asked for. */
function observeGrantWrites(rp: GroupRp): string[] {
  const writes: string[] = [];
  const engine = rp.engine as unknown as Record<string, (...a: unknown[]) => unknown>;
  for (const op of ['insert', 'update', 'delete'] as const) {
    const original = engine[op].bind(rp.engine);
    vi.spyOn(engine, op).mockImplementation(async (object: unknown, ...rest: unknown[]) => {
      if (object === 'sys_user_permission_set') writes.push(op);
      return original(object, ...rest);
    });
  }
  return writes;
}

const projectedSales = { permission_set: SALES, organization_id: GROUP_ORG, reason: SSO_MARKER };

describe('an SSO sign-in grants the permission set its IdP group is mapped to', () => {
  afterEach(() => vi.restoreAllMocks());

  it('a mapped group grants the set in the provider\'s organization, by display name and by external id', async () => {
    const rp = await makeGroupRp();
    savedMappingId(await saveGroupMapping(rp, { providerId: PROVIDER_ID, groupDisplayName: 'Acme Sales', permissionSet: SALES }));
    const { userId } = await signInWithClaims(rp, { groups: ['Acme Everyone', 'Acme Sales'] });
    expect(await grantsOf(rp, userId)).toEqual([projectedSales]);

    // Entra ID sends group object ids: a mapping by external id matches the same claim.
    const other = await makeGroupRp();
    savedMappingId(await saveGroupMapping(other, { providerId: PROVIDER_ID, groupExternalId: '6f1b2c3d-sales', permissionSet: SALES }));
    const signedIn = await signInWithClaims(other, { groups: '6f1b2c3d-sales' });
    expect(await grantsOf(other, signedIn.userId)).toEqual([projectedSales]);
    expect(rp.error).not.toHaveBeenCalled();
  });

  it('leaving the group revokes the projected grant at the next sign-in; a grant made by hand stays', async () => {
    const rp = await makeGroupRp();
    savedMappingId(await saveGroupMapping(rp, { providerId: PROVIDER_ID, groupDisplayName: 'Acme Sales', permissionSet: SALES }));
    const { userId } = await signInWithClaims(rp, { groups: ['Acme Sales'] });
    expect(await grantsOf(rp, userId)).toEqual([projectedSales]);
    await rp.engine.insert('sys_user_permission_set', { user_id: userId, permission_set: 'support_agent', organization_id: GROUP_ORG }, SYSTEM);

    await signInWithClaims(rp, { groups: ['Acme Everyone'] });
    expect(await grantsOf(rp, userId)).toEqual([{ permission_set: 'support_agent', organization_id: GROUP_ORG, reason: null }]);
  });

  it('CONTROL: an unmapped group grants nothing', async () => {
    const rp = await makeGroupRp();
    savedMappingId(await saveGroupMapping(rp, { providerId: PROVIDER_ID, groupDisplayName: 'Acme Sales', permissionSet: SALES }));
    const { userId } = await signInWithClaims(rp, { groups: ['Acme Marketing'] });
    expect(await grantsOf(rp, userId)).toEqual([]);
  });

  it('CONTROL: a sign-in with no groups claim behaves as before — signed in, nothing written to the grant table, nothing logged', async () => {
    const rp = await makeGroupRp();
    savedMappingId(await saveGroupMapping(rp, { providerId: PROVIDER_ID, groupDisplayName: 'Acme Sales', permissionSet: SALES }));
    const writes = observeGrantWrites(rp);
    const { userId } = await signInWithClaims(rp);
    expect(writes).toEqual([]);
    expect(await grantsOf(rp, userId)).toEqual([]);
    expect(rp.error).not.toHaveBeenCalled();
    expect(rp.warn).not.toHaveBeenCalled();
  });

  it('a mapping naming an administrator set, or a set outside the organization boundary, is refused at save and stores nothing', async () => {
    const rp = await makeGroupRp();
    for (const set of [ADMIN_FULL_ACCESS, PLATFORM_OPS]) {
      const saved = await saveGroupMapping(rp, { providerId: PROVIDER_ID, groupDisplayName: 'Acme Admins', permissionSet: set });
      expect(saved.status).toBe(400);
      expect(saved.body).toMatchObject({ success: false, error: { code: 'VALIDATION_FAILED', fields: [{ field: 'permissionSet', code: 'rule_violation' }] } });
    }
    expect(await rp.engine.find('sys_idp_group_mapping', {}, SYSTEM)).toEqual([]);
  });

  it('a set redefined outside the boundary after its mapping was saved grants nothing at sign-in', async () => {
    const rp = await makeGroupRp();
    savedMappingId(await saveGroupMapping(rp, { providerId: PROVIDER_ID, groupDisplayName: 'Acme Sales', permissionSet: SALES }));
    groupCatalog = groupCatalog.map((p) => (p.name === SALES ? { ...p, adminScope: { businessUnits: ['*'] } } : p));
    const { userId } = await signInWithClaims(rp, { groups: ['Acme Sales'] });
    expect(await grantsOf(rp, userId)).toEqual([]);
    expect(String(rp.warn.mock.calls.map((c) => c[0]))).toMatch(/SSO group mapping .* grants nothing/);
  });

  it('with no security service composed, a save is refused 503 and a stored mapping grants nothing at sign-in (fail closed)', async () => {
    const rp = await makeGroupRp({ judge: false });
    const saved = await saveGroupMapping(rp, { providerId: PROVIDER_ID, groupDisplayName: 'Acme Sales', permissionSet: SALES });
    expect(saved.status).toBe(503);
    expect(await rp.engine.find('sys_idp_group_mapping', {}, SYSTEM)).toEqual([]);

    await rp.engine.insert('sys_idp_group_mapping', {
      source_kind: 'sso', source_id: PROVIDER_ID, group_display_name: 'Acme Sales', permission_set: SALES, organization_id: GROUP_ORG,
    }, SYSTEM);
    const { userId } = await signInWithClaims(rp, { groups: ['Acme Sales'] });
    expect(await grantsOf(rp, userId)).toEqual([]);
  });

  it('the break-glass guard still refuses through the sign-in: the last administrator\'s grant is not removed, and the sign-in still lands', async () => {
    const rp = await makeGroupRp();
    // Mia is the only administrator, through a grant carrying this provider's marker
    // (a row the projection would remove: no mapping names it).
    const { userId } = await signInWithClaims(rp, { groups: [] });
    await rp.engine.insert('sys_user_permission_set', {
      user_id: userId, permission_set: ADMIN_FULL_ACCESS, organization_id: DEFAULT_ORG, reason: SSO_MARKER,
    }, SYSTEM);

    await signInWithClaims(rp, { groups: [] });
    expect(await grantsOf(rp, userId)).toEqual([{ permission_set: ADMIN_FULL_ACCESS, organization_id: DEFAULT_ORG, reason: SSO_MARKER }]);
    expect(rp.error).toHaveBeenCalledTimes(1);
    expect(String(rp.error.mock.calls[0][0])).toMatch(/applying the provider's IdP group mappings .* FAILED/);
  });

  it('deleting the mapping removes the grants it projected at once', async () => {
    const rp = await makeGroupRp();
    const mappingId = savedMappingId(await saveGroupMapping(rp, { providerId: PROVIDER_ID, groupDisplayName: 'Acme Sales', permissionSet: SALES }));
    const { userId } = await signInWithClaims(rp, { groups: ['Acme Sales'] });
    expect(await grantsOf(rp, userId)).toEqual([projectedSales]);

    const deleted = await deleteGroupMapping(rp, mappingId);
    expect(deleted.status, JSON.stringify(deleted.body)).toBe(200);
    expect(deleted.body).toMatchObject({ success: true, data: { providerId: PROVIDER_ID, deleted: true, reprojected: true, reconciledUsers: 1 } });
    expect(await grantsOf(rp, userId)).toEqual([]);
  });

  it('the door names exactly one source, and an SSO source must be a provider in an organization', async () => {
    const rp = await makeGroupRp();
    const both = await saveGroupMapping(rp, { connectionId: 'okta-prod', providerId: PROVIDER_ID, groupDisplayName: 'Acme Sales', permissionSet: SALES });
    expect(both.status).toBe(400);
    expect(both.body).toMatchObject({ error: { code: 'VALIDATION_FAILED', fields: [{ field: 'providerId', code: 'rule_violation' }] } });
    const unknown = await saveGroupMapping(rp, { providerId: 'nobody', groupDisplayName: 'Acme Sales', permissionSet: SALES });
    expect(unknown.body).toMatchObject({ error: { code: 'VALIDATION_FAILED', fields: [{ field: 'providerId', code: 'reference_not_found' }] } });
    await rp.engine.update('sys_sso_provider', { organization_id: null }, { where: { provider_id: PROVIDER_ID }, multi: true, context: { isSystem: true } } as never);
    const orphan = await saveGroupMapping(rp, { providerId: PROVIDER_ID, groupDisplayName: 'Acme Sales', permissionSet: SALES });
    expect(orphan.body).toMatchObject({ error: { code: 'VALIDATION_FAILED', fields: [{ field: 'providerId', code: 'rule_violation' }] } });
    expect(await rp.engine.find('sys_idp_group_mapping', {}, SYSTEM)).toEqual([]);
  });
});

// ── The groups claim, set through the SSO Providers form ────────────────────
//
// The form's save path for an existing provider is the `edit_sso_groups_claim`
// action's bridge (`runSetSsoGroupsClaim`), which writes through the vendor's
// own `/sso/update-provider`; its show path is `show_sso_groups_claim`'s
// (`runShowSsoGroupsClaim`). Both run here against the real `AuthManager`,
// the real `sso()` plugin and the SQLite engine of the group cases above, so
// what the form stores is the row the vendor stores and what a sign-in grants
// is the #30967 item 3 projection's own answer.

describe('the SSO Providers form sets the groups claim a sign-in grants from, and clears it', () => {
  afterEach(() => vi.restoreAllMocks());

  const configWith = (mapping: Record<string, unknown>) => JSON.stringify({
    issuer: IDP,
    clientId: CLIENT_ID,
    clientSecret: CLIENT_SECRET,
    authorizationEndpoint: `${IDP}/authorize`,
    tokenEndpoint: `${IDP}/token`,
    jwksEndpoint: `${IDP}/jwks`,
    discoveryEndpoint: `${IDP}/.well-known/openid-configuration`,
    pkce: true,
    scopes: ['openid', 'email', 'profile'],
    mapping,
  });
  /** The mapping the register door stores for a provider with a groups claim (`makeGroupRp`'s row). */
  const DOOR_MAPPING = { email: 'email', name: 'name', extraFields: { groups: 'groups' } };
  const PLAIN_MAPPING = { email: 'email', name: 'name' };

  /** The form's caller: an owner of the provider's organization (the vendor's provider-access check), by bearer. */
  async function formCaller(rp: GroupRp): Promise<string> {
    await rp.engine.insert('sys_member', { user_id: 'usr_admin', organization_id: GROUP_ORG, role: 'owner' }, SYSTEM);
    const ctx = await ((await rp.manager.getAuthInstance()) as any).$context;
    return (await ctx.internalAdapter.createSession('usr_admin')).token as string;
  }
  const formRequest = (path: string, token: string, body: Record<string, unknown>) =>
    new Request(`${AUTH}/admin/sso/${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: BASE, authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    });
  const readerOf = (rp: GroupRp) => createEngineSsoProviderConfigReader(() => rp.engine as never);
  async function saveClaim(rp: GroupRp, token: string, groupsClaim: string) {
    const res = await runSetSsoGroupsClaim((req) => rp.manager.handleRequest(req), formRequest('set-groups-claim', token, { providerId: PROVIDER_ID, groupsClaim }), readerOf(rp));
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    return res.body.data!.groupsClaim;
  }
  async function storedConfig(rp: GroupRp): Promise<Record<string, unknown>> {
    const stored = await readerOf(rp)(PROVIDER_ID);
    return JSON.parse(String(stored!.oidcConfig));
  }
  /** The stored config apart from the mapping and the client secret (the vendor's write lifts it to its encrypted column). */
  const withoutMapping = ({ mapping: _mapping, clientSecret: _secret, ...rest }: Record<string, unknown>) => rest;

  it('a claim saved through the form is stored as the register door stores it, and a sign-in grants its mapped set', async () => {
    const rp = await makeGroupRp({ provider: { oidc_config: configWith(PLAIN_MAPPING) } });
    const token = await formCaller(rp);
    savedMappingId(await saveGroupMapping(rp, { providerId: PROVIDER_ID, groupDisplayName: 'Acme Sales', permissionSet: SALES }));
    const before = await storedConfig(rp);

    expect(await saveClaim(rp, token, 'groups')).toBe('groups');
    const after = await storedConfig(rp);
    expect(after.mapping).toEqual(DOOR_MAPPING);
    expect(withoutMapping(after)).toEqual(withoutMapping(before));

    const { userId } = await signInWithClaims(rp, { groups: ['Acme Everyone', 'Acme Sales'] });
    expect(await grantsOf(rp, userId)).toEqual([projectedSales]);
    expect(rp.error).not.toHaveBeenCalled();
  });

  it('CONTROL: a provider saved without the claim signs users in as today — nothing granted, nothing written, nothing logged', async () => {
    const rp = await makeGroupRp({ provider: { oidc_config: configWith(PLAIN_MAPPING) } });
    const token = await formCaller(rp);
    savedMappingId(await saveGroupMapping(rp, { providerId: PROVIDER_ID, groupDisplayName: 'Acme Sales', permissionSet: SALES }));
    expect(await saveClaim(rp, token, '')).toBeNull();
    expect((await storedConfig(rp)).mapping).toEqual(PLAIN_MAPPING);

    const writes = observeGrantWrites(rp);
    const { userId } = await signInWithClaims(rp, { groups: ['Acme Sales'] });
    expect(writes).toEqual([]);
    expect(await grantsOf(rp, userId)).toEqual([]);
    expect(rp.error).not.toHaveBeenCalled();
    expect(rp.warn).not.toHaveBeenCalled();
  });

  it('CONTROL: the form shows the claim of a provider the register door wrote; clearing it there signs users in as a provider saved without it', async () => {
    const rp = await makeGroupRp();
    const token = await formCaller(rp);
    savedMappingId(await saveGroupMapping(rp, { providerId: PROVIDER_ID, groupDisplayName: 'Acme Sales', permissionSet: SALES }));
    const shown = await runShowSsoGroupsClaim(formRequest('get-groups-claim', token, { providerId: PROVIDER_ID }), readerOf(rp));
    expect(shown.body).toEqual({ success: true, data: { providerId: PROVIDER_ID, groupsClaim: 'groups' } });

    expect(await saveClaim(rp, token, '')).toBeNull();
    expect((await storedConfig(rp)).mapping).toEqual(PLAIN_MAPPING);
    const writes = observeGrantWrites(rp);
    const { userId } = await signInWithClaims(rp, { groups: ['Acme Sales'] });
    expect(writes).toEqual([]);
    expect(await grantsOf(rp, userId)).toEqual([]);
  });

  it('round trip: every other mapping member is kept verbatim, on a register-door row and on a row this action changed', async () => {
    const rich = { email: 'upn', name: 'display_name', image: 'picture', extraFields: { department: 'dept', groups: 'groups' } };
    const rp = await makeGroupRp({ provider: { oidc_config: configWith(rich) } });
    const token = await formCaller(rp);
    const before = await storedConfig(rp);

    expect(await saveClaim(rp, token, 'memberOf')).toBe('memberOf');
    const changed = await storedConfig(rp);
    expect(changed.mapping).toEqual({ ...rich, extraFields: { department: 'dept', groups: 'memberOf' } });
    expect(withoutMapping(changed)).toEqual(withoutMapping(before));

    expect(await saveClaim(rp, token, '')).toBeNull();
    const cleared = await storedConfig(rp);
    expect(cleared.mapping).toEqual({ email: 'upn', name: 'display_name', image: 'picture', extraFields: { department: 'dept' } });
    expect(withoutMapping(cleared)).toEqual(withoutMapping(before));
  });
});

// ── Microsoft Entra ID shapes: userinfo that carries less than the ID token ─
//
// A provider registered from Entra ID's discovery document has a
// `userInfoEndpoint` (on Microsoft Graph), and `@better-auth/sso` then reads
// every claim from the userinfo answer alone. Entra ID's answers `sub`,
// `name`, `given_name`, `family_name`, `picture` and `email`: no `groups`, no
// `preferred_username`, no `upn`. These cases sign in through the real chain
// above with a userinfo answer of that shape beside an ID token that carries
// the rest.

/** The configuration Entra ID's discovery document hydrates (userinfo on another host), with `mapping`. */
function entraConfig(mapping: Record<string, unknown>): string {
  return JSON.stringify({
    issuer: IDP,
    clientId: CLIENT_ID,
    clientSecret: CLIENT_SECRET,
    authorizationEndpoint: `${IDP}/authorize`,
    tokenEndpoint: `${IDP}/token`,
    jwksEndpoint: `${IDP}/jwks`,
    userInfoEndpoint: USERINFO_ENDPOINT,
    discoveryEndpoint: `${IDP}/.well-known/openid-configuration`,
    pkce: true,
    scopes: ['openid', 'email', 'profile'],
    mapping,
  });
}

/** Entra ID's userinfo answer: the standard profile claims, never `groups`. */
const ENTRA_USERINFO = { sub: SUBJECT, name: 'Mia Chen', given_name: 'Mia', family_name: 'Chen', email: EMAIL };

/** The Entra ID group object id the mapping names. */
const ENTRA_SALES_GROUP = '9f1c2d3e-0000-4a5b-8c6d-sales0000001';

describe('Entra ID: the groups claim reaches the group mapping when userinfo does not carry it', () => {
  afterEach(() => vi.restoreAllMocks());

  async function entraRp() {
    const rp = await makeGroupRp({ provider: { oidc_config: entraConfig({ email: 'email', name: 'name', extraFields: { groups: 'groups' } }) } });
    savedMappingId(await saveGroupMapping(rp, { providerId: PROVIDER_ID, groupExternalId: ENTRA_SALES_GROUP, permissionSet: SALES }));
    return rp;
  }

  async function signInEntra(rp: GroupRp, idClaims: Record<string, unknown>, userInfo: Record<string, unknown> = ENTRA_USERINFO) {
    userInfoCalls.length = 0;
    const res = await signInThroughIdp(rp as unknown as Rp, await idToken({ claims: idClaims }), userInfo);
    expect(res.headers.get('location'), `the sign-in did not land: ${res.headers.get('location')}`).toBe(AFTER);
    expect(userInfoCalls, 'the userinfo endpoint was called, as it is for every provider that has one').toHaveLength(1);
    const user = (await rp.engine.findOne('sys_user', { where: { email: EMAIL }, fields: ['id'] }, SYSTEM)) as { id: string };
    return String(user.id);
  }

  it('a group member is granted with userinfo present: the groups come from the verified ID token', async () => {
    const rp = await entraRp();
    const userId = await signInEntra(rp, { groups: [ENTRA_SALES_GROUP, 'another-group-id'] });
    expect(await grantsOf(rp, userId)).toEqual([projectedSales]);
  });

  it('removal from the group revokes the projected grant at the next sign-in', async () => {
    const rp = await entraRp();
    const userId = await signInEntra(rp, { groups: [ENTRA_SALES_GROUP] });
    expect(await grantsOf(rp, userId)).toEqual([projectedSales]);
    await signInEntra(rp, { groups: ['another-group-id'] });
    expect(await grantsOf(rp, userId)).toEqual([]);
  });

  it('a groups overage grants nothing from groups, revokes what the provider projected, and warns once per provider', async () => {
    const rp = await entraRp();
    const userId = await signInEntra(rp, { groups: [ENTRA_SALES_GROUP] });
    expect(await grantsOf(rp, userId)).toEqual([projectedSales]);

    const overage = {
      _claim_names: { groups: 'src1' },
      _claim_sources: { src1: { endpoint: 'https://graph.windows.net/tenant/users/oid/getMemberObjects' } },
    };
    await signInEntra(rp, overage);
    expect(await grantsOf(rp, userId)).toEqual([]);
    await signInEntra(rp, overage);
    const overageLines = rp.warn.mock.calls.filter(([message]) => String(message).includes('groups overage'));
    expect(overageLines).toHaveLength(1);
    expect(String(overageLines[0]![0])).toContain(`'${PROVIDER_ID}'`);
    expect(String(overageLines[0]![0])).toContain('groups assigned to the application');
    // No Graph call was made for the groups.
    expect(userInfoCalls.every((url) => url.startsWith(USERINFO_ENDPOINT))).toBe(true);
  });

  it('CONTROL (Okta shape): userinfo that carries the groups claim still wins over the ID token', async () => {
    const rp = await makeGroupRp({ provider: { oidc_config: entraConfig({ email: 'email', name: 'name', extraFields: { groups: 'groups' } }) } });
    savedMappingId(await saveGroupMapping(rp, { providerId: PROVIDER_ID, groupDisplayName: 'Acme Sales', permissionSet: SALES }));
    const userId = await signInEntra(rp, { groups: ['Acme Everyone'] }, { ...ENTRA_USERINFO, groups: ['Acme Sales'] });
    expect(await grantsOf(rp, userId)).toEqual([projectedSales]);
    // …and a userinfo answer whose groups leave out the mapped group grants nothing, whatever the ID token says.
    await signInEntra(rp, { groups: ['Acme Sales'] }, { ...ENTRA_USERINFO, groups: ['Acme Everyone'] });
    expect(await grantsOf(rp, userId)).toEqual([]);
  });
});

describe('Entra ID: a user without a mailbox signs in through an explicit email mapping', () => {
  afterEach(() => vi.restoreAllMocks());

  /** An Entra ID user with no `mail`: no `email` in the ID token or in userinfo, a `preferred_username` in the ID token. */
  const MAILBOXLESS = 'kai.ng@acme.onmicrosoft.com';
  const mailboxlessToken = () => idToken({ email: null, claims: { preferred_username: MAILBOXLESS, upn: MAILBOXLESS } });
  const { email: _noEmail, ...MAILBOXLESS_USERINFO } = ENTRA_USERINFO;

  async function signInMailboxless(rp: GroupRp): Promise<Response> {
    userInfoCalls.length = 0;
    return signInThroughIdp(rp as unknown as Rp, await mailboxlessToken(), MAILBOXLESS_USERINFO);
  }

  it('mapping preferred_username with claims from the ID token signs in, and userinfo is not called', async () => {
    const rp = await makeGroupRp({
      provider: { oidc_config: entraConfig({ email: 'preferred_username', name: 'name' }), skip_user_info: true },
    });
    const res = await signInMailboxless(rp);
    expect(res.headers.get('location'), `the sign-in did not land: ${res.headers.get('location')}`).toBe(AFTER);
    expect(cookiesOf(res)).toMatch(/session_token=[^;]/);
    expect(userInfoCalls).toEqual([]);
    const user = await rp.engine.findOne('sys_user', { where: { email: MAILBOXLESS }, fields: ['id', 'email_verified'] }, SYSTEM);
    expect(user, 'the user is provisioned with the mapped claim as the email').toBeTruthy();
  });

  it('no mapping: refused naming the missing claim and the mapping key that would supply it', async () => {
    const rp = await makeGroupRp({ provider: { oidc_config: entraConfig({ email: 'email', name: 'name' }), skip_user_info: true } });
    const res = await signInMailboxless(rp);
    expect(errorParams(res)).toEqual({ base: FAILED, error: 'invalid_provider', description: 'email_claim_missing' });
    expect(refusalLines(rp)).toEqual([
      [
        expect.stringContaining('mapping.email'),
        { providerId: PROVIDER_ID, protocol: 'oidc', cause: 'email_claim_missing', claim: 'email', mappingKey: 'mapping.email' },
      ],
    ]);
    expect(await rp.engine.find('sys_user', { where: { email: MAILBOXLESS } }, SYSTEM)).toEqual([]);
    // No claim value and no account signal in the refusal.
    const logged = JSON.stringify(rp.warn.mock.calls);
    expect(logged).not.toContain(MAILBOXLESS);
    expect(res.headers.get('location')).not.toContain(MAILBOXLESS);
  });

  it('a mapping userinfo cannot satisfy is refused naming that claim: preferred_username is read from userinfo while it is on', async () => {
    const rp = await makeGroupRp({ provider: { oidc_config: entraConfig({ email: 'preferred_username', name: 'name' }) } });
    const res = await signInMailboxless(rp);
    expect(userInfoCalls).toHaveLength(1);
    expect(errorParams(res)).toEqual({ base: FAILED, error: 'invalid_provider', description: 'email_claim_missing' });
    expect(refusalLines(rp)[0]?.[1]).toMatchObject({ cause: 'email_claim_missing', claim: 'preferred_username' });
  });

  it('CONTROL: a user with a mailbox signs in through userinfo as before, and no refusal line is written', async () => {
    const rp = await makeGroupRp({ provider: { oidc_config: entraConfig({ email: 'email', name: 'name' }) } });
    userInfoCalls.length = 0;
    const res = await signInThroughIdp(rp as unknown as Rp, await idToken(), ENTRA_USERINFO);
    expect(res.headers.get('location')).toBe(AFTER);
    expect(userInfoCalls).toHaveLength(1);
    expect(refusalLines(rp)).toEqual([]);
  });

  it('a vendor write of an opted-out provider keeps its stored userinfo endpoint', async () => {
    const rp = await makeGroupRp({
      provider: { oidc_config: entraConfig({ email: 'preferred_username', name: 'name' }), skip_user_info: true },
    });
    await rp.engine.insert('sys_member', { user_id: 'usr_admin', organization_id: GROUP_ORG, role: 'owner' }, SYSTEM);
    const ctx = await ((await rp.manager.getAuthInstance()) as any).$context;
    const token = (await ctx.internalAdapter.createSession('usr_admin')).token as string;
    // The Edit Groups Claim bridge writes through the vendor's update-provider,
    // which merges the configuration it read (with the endpoint parked) and stores it.
    const reader = createEngineSsoProviderConfigReader(() => rp.engine as never);
    const res = await runSetSsoGroupsClaim(
      (req) => rp.manager.handleRequest(req),
      new Request(`${AUTH}/admin/sso/set-groups-claim`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: BASE, authorization: `Bearer ${token}` },
        body: JSON.stringify({ providerId: PROVIDER_ID, groupsClaim: 'groups' }),
      }),
      reader,
    );
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const stored = JSON.parse(String((await reader(PROVIDER_ID))!.oidcConfig)) as Record<string, unknown>;
    expect(stored.userInfoEndpoint).toBe(USERINFO_ENDPOINT);
    expect(Object.keys(stored).filter((k) => /parked/i.test(k))).toEqual([]);
    expect(stored.mapping).toEqual({ email: 'preferred_username', name: 'name', extraFields: { groups: 'groups' } });
  });
});

// ── 5. With SSO domain verification on, a provider creates an account only at a domain it has proven ──
//
// `sso-account-at-proven-domain.ts` states the rule. Every case runs with
// verification on, the provider's `domain_verified` on and its JIT toggle on,
// and one human already present, so the audience gate would admit each
// newcomer: the rule alone decides.

describe('with SSO domain verification on, an OIDC provider creates an account only at a domain it has proven', () => {
  const VERIFICATION_ON = { plugins: { sso: true, ssoDomainVerification: true } };
  const verifiedRp = async (domain = 'acme.com', provider: Record<string, unknown> = {}) => {
    const rp = await makeRp({ config: VERIFICATION_ON, provider: { domain, domainVerified: true, allowJit: true, ...provider } });
    await seedAdmin(rp);
    return rp;
  };
  /** What a sign-in left behind besides the seeded admin. */
  const written = (rp: Rp) => ({
    users: (rp.engine.tables.get('sys_user') ?? []).map((u: any) => u.email).filter((e: string) => e !== 'admin@acme.com'),
    accounts: (rp.engine.tables.get('sys_account') ?? []).length,
    members: (rp.engine.tables.get('sys_member') ?? []).length,
    sessions: (rp.engine.tables.get('sys_session') ?? []).length,
  });
  const NOTHING = { users: [], accounts: 0, members: 0, sessions: 0 };

  const expectAdmitted = (res: Response) => {
    expect(res.status).toBe(302);
    expect(res.headers.get('location'), res.headers.get('location') ?? '').toBe(AFTER);
    expect(cookiesOf(res)).toMatch(/session_token=[^;]/);
  };
  const expectRefused = (rp: Rp, res: Response) => {
    expect(res.status).toBe(302);
    expect(errorParams(res)).toMatchObject({ base: FAILED, error: 'EMAIL_DOMAIN_NOT_ALLOWED' });
    expect(cookiesOf(res)).not.toMatch(/session_token=[^;]/);
    expect(written(rp)).toEqual(NOTHING);
  };

  it('admits an address exactly at the single listed domain', async () => {
    const rp = await verifiedRp();
    expectAdmitted(await signInThroughIdp(rp, await idToken({ email: 'bob@acme.com' })));
    expect(written(rp).users).toEqual(['bob@acme.com']);
  });

  it('admits an address exactly at the second entry of a multi-entry list', async () => {
    const rp = await verifiedRp('acme.com, acme.co.uk');
    expectAdmitted(await signInThroughIdp(rp, await idToken({ email: 'bob@acme.co.uk' })));
  });

  const refused: Array<[string, string, string?]> = [
    ['another domain', 'bob@other.example'],
    ['a subdomain of a listed domain', 'bob@eng.acme.com'],
    ['a parent of a listed domain', 'bob@acme.com', 'eng.acme.com'],
    ['a look-alike of a listed domain', 'bob@acme.com.other.example'],
    ['an asserted email that is not an address', 'bob.acme.com'],
    ['a domain part with a port', 'bob@acme.com:443'],
    ['a domain part with a path', 'bob@acme.com/x'],
  ];
  for (const [what, email, domain] of refused) {
    it(`refuses ${what}, and writes no user, account, membership or session`, async () => {
      const rp = await verifiedRp(domain);
      expectRefused(rp, await signInThroughIdp(rp, await idToken({ email })));
    });
  }

  it('case, a trailing dot, and punycode against Unicode are one domain', async () => {
    for (const [domain, email] of [
      ['acme.com', 'Bob@ACME.com'],
      ['acme.com', 'bob@acme.com.'],
      ['bücher.de', 'bob@xn--bcher-kva.de'],
      ['xn--bcher-kva.de', 'bob@bücher.de'],
    ]) {
      const rp = await verifiedRp(domain);
      expectAdmitted(await signInThroughIdp(rp, await idToken({ email })));
    }
  });

  it('CONTROL (stays green under ablation): a provider whose domain is not verified signs nobody in', async () => {
    // The vendor refuses this at the start of the sign-in, before any account
    // is judged, so it does not pin the rule above.
    const rp = await makeRp({ config: VERIFICATION_ON, provider: { domainVerified: false, allowJit: true } });
    await seedAdmin(rp);
    const start = await rp.manager.handleRequest(
      new Request(`${AUTH}/sign-in/sso`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: BASE },
        body: JSON.stringify({ providerId: PROVIDER_ID, callbackURL: AFTER, errorCallbackURL: FAILED }),
      }),
    );
    expect(start.status).toBe(401);
    expect(written(rp)).toEqual(NOTHING);
  });

  it('CONTROL: with verification off, the outside-domain account is created as today', async () => {
    const rp = await makeRp({ provider: { allowJit: true } });
    await seedAdmin(rp);
    expectAdmitted(await signInThroughIdp(rp, await idToken({ email: 'bob@other.example' })));
    expect(written(rp).users).toEqual(['bob@other.example']);
  });

  it('CONTROL: an existing linked account at an outside domain still signs in', async () => {
    const rp = await verifiedRp();
    // The account is made while the environment reports verification off (as
    // it was before it was turned on); the vendor's own provider gate stays on.
    const off = vi.spyOn(rp.manager, 'isSsoDomainVerificationEnabled').mockReturnValue(false);
    expectAdmitted(await signInThroughIdp(rp, await idToken({ email: 'bob@other.example' })));
    off.mockRestore();
    expect(rp.manager.isSsoDomainVerificationEnabled()).toBe(true);
    expectAdmitted(await signInThroughIdp(rp, await idToken({ email: 'bob@other.example' })));
    expect(written(rp).users).toEqual(['bob@other.example']);
  });

  it('CONTROL: invite_only without allowJit still answers SELF_REGISTRATION_CLOSED for an on-domain stranger', async () => {
    const rp = await verifiedRp('acme.com', { allowJit: false });
    const res = await signInThroughIdp(rp, await idToken({ email: 'bob@acme.com' }));
    expect(errorParams(res)).toMatchObject({ base: FAILED, error: 'SELF_REGISTRATION_CLOSED' });
    expect(written(rp)).toEqual(NOTHING);
  });
});
