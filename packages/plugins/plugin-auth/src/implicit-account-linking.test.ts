// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// Implicit account linking on external sign-in — see
// `implicit-account-linking.ts` for the rules this file pins.
//
// Two layers:
//
//  1. PURE decision — `decideImplicitLink` over each condition.
//  2. END of the chain — a real better-auth pipeline over the in-memory
//     engine, driving a real OAuth round trip (`/sign-in/social` →
//     `/callback/:id`) through generic-OAuth providers whose token and
//     userinfo endpoints are stubbed. The assertions read what landed: the
//     `sys_account` rows, the local row's `email_verified`, and the redirect
//     the callback answered — never only a status.

import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import { assertEngineDeleteDispatch, assertEngineUpdateDispatch, assertEngineFindOnePredicate } from '@objectstack/objectql';
import { AuthManager } from './auth-manager';
import {
  IMPLICIT_LINK_REFUSED,
  PLATFORM_IDP_PROVIDER_ID,
  decideImplicitLink,
  linkSourceProviderId,
  unlinkTombstoneIdentifier,
  unlinkTombstoneUserPrefix,
} from './implicit-account-linking';

// ── In-memory IDataEngine (the audience-posture harness shape) ───────────────

const createMemoryEngine = () => {
  const tables = new Map<string, any[]>();
  const rows = (name: string) => {
    if (!tables.has(name)) tables.set(name, []);
    return tables.get(name)!;
  };
  const eq = (a: any, b: any) =>
    a instanceof Date || b instanceof Date
      ? new Date(a as any).getTime() === new Date(b as any).getTime()
      : a === b;
  const matches = (row: any, where: Record<string, any> = {}) =>
    Object.entries(where).every(([k, v]) => {
      if (k.startsWith('$')) throw new Error(`fake driver: unsupported operator ${k}`);
      const actual = row[k];
      if (v && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Date)) {
        if ('$ne' in v) return !eq(actual, v.$ne);
        if ('$in' in v) return (v.$in as any[]).some((x) => eq(actual, x));
        if ('$gt' in v) return actual > v.$gt;
        if ('$gte' in v) return actual >= v.$gte;
        if ('$lt' in v) return actual < v.$lt;
        if ('$lte' in v) return actual <= v.$lte;
        if ('$startsWith' in v) return typeof actual === 'string' && actual.startsWith(v.$startsWith);
      }
      return eq(actual, v);
    });
  const project = (row: any, fields?: string[]) => {
    if (!Array.isArray(fields) || fields.length === 0) return { ...row };
    const out: any = {};
    for (const f of ['id', ...fields]) if (f in row) out[f] = row[f];
    return out;
  };
  let seq = 0;
  /** Tables whose inserts fail — the store-fault seam for the fail-closed cases. */
  const failInserts = new Set<string>();
  return {
    tables,
    failInserts,
    async insert(name: string, data: any) {
      if (failInserts.has(name)) throw new Error(`fake driver: insert into ${name} refused`);
      const row = { id: data.id ?? `row_${++seq}`, ...data };
      rows(name).push(row);
      return { ...row };
    },
    async findOne(name: string, q: any = {}) {
      assertEngineFindOnePredicate(name, q);
      const row = rows(name).find((r) => matches(r, q.where));
      return row ? project(row, q.fields) : null;
    },
    async find(name: string, q: any = {}) {
      let out = rows(name).filter((r) => matches(r, q.where));
      if (q.offset) out = out.slice(q.offset);
      if (typeof q.limit === 'number') out = out.slice(0, q.limit);
      return out.map((r) => project(r, q.fields));
    },
    async count(name: string, q: any = {}) {
      return rows(name).filter((r) => matches(r, q.where)).length;
    },
    async update(name: string, patch: any, options?: any) {
      assertEngineUpdateDispatch(patch, options);
      const row = rows(name).find((r) => r.id === patch.id);
      if (!row) return null;
      Object.assign(row, patch);
      return { ...row };
    },
    async delete(name: string, q: any = {}) {
      assertEngineDeleteDispatch(q);
      const table = rows(name);
      const keep = table.filter((r) => !matches(r, q.where));
      tables.set(name, keep);
      return table.length - keep.length;
    },
  };
};

const SECRET = 'test-secret-at-least-32-chars-long!!';
const PASSWORD = 'S3cure!Passw0rd-link';
const BASE = 'http://localhost:3000';
const AFTER = `${BASE}/after-sign-in`;
const IDP = 'https://idp.example.test';
const EXTERNAL = 'acme-idp';
/** A generic OIDC provider configured by discovery (subject = `sub`). */
const OIDC = 'corp-oidc';
/** A built-in social provider, for the id-token sign-in path. */
const SOCIAL = 'google';

const provider = (providerId: string) => ({
  providerId,
  clientId: `${providerId}-client`,
  clientSecret: `${providerId}-secret`,
  authorizationUrl: `${IDP}/${providerId}/authorize`,
  tokenUrl: `${IDP}/${providerId}/token`,
  userInfoUrl: `${IDP}/${providerId}/userinfo`,
  pkce: false,
});

const makeManager = (engine: any, config: Record<string, unknown> = {}) =>
  new AuthManager({
    secret: SECRET,
    baseUrl: BASE,
    dataEngine: engine,
    oidcProviders: [
      provider(EXTERNAL),
      provider(PLATFORM_IDP_PROVIDER_ID),
      {
        providerId: OIDC,
        clientId: `${OIDC}-client`,
        clientSecret: `${OIDC}-secret`,
        discoveryUrl: `${IDP}/${OIDC}/.well-known/openid-configuration`,
        pkce: false,
      },
    ],
    socialProviders: {
      [SOCIAL]: {
        clientId: `${SOCIAL}-client`,
        clientSecret: `${SOCIAL}-secret`,
        // The id token is synthetic: verification and the profile come from
        // the stubbed IdP below, never from a real issuer.
        verifyIdToken: async () => true,
        getUserInfo: async () => {
          const profile = idpProfile[SOCIAL];
          if (!profile) return null;
          return {
            user: { id: profile.sub, email: profile.email, emailVerified: profile.email_verified, name: 'Synthetic Person' },
            data: { ...profile },
          };
        },
      },
    },
    ...config,
  } as any);

// ── The stubbed identity provider ────────────────────────────────────────────

/** What the stubbed IdP asserts about the person signing in, per provider. */
let idpProfile: Record<string, { sub: string; email: string; email_verified: boolean }> = {};

const realFetch = globalThis.fetch;
beforeEach(() => {
  idpProfile = {};
  vi.stubGlobal('fetch', async (input: any, init?: any) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (!url.startsWith(IDP)) return realFetch(input, init);
    const providerId = new URL(url).pathname.split('/')[1]!;
    if (url.endsWith('/.well-known/openid-configuration')) {
      return new Response(
        JSON.stringify({
          issuer: `${IDP}/${providerId}`,
          authorization_endpoint: `${IDP}/${providerId}/authorize`,
          token_endpoint: `${IDP}/${providerId}/token`,
          userinfo_endpoint: `${IDP}/${providerId}/userinfo`,
          id_token_signing_alg_values_supported: ['RS256'],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }
    if (url.endsWith('/token')) {
      return new Response(
        JSON.stringify({ access_token: `at-${providerId}`, token_type: 'Bearer', expires_in: 3600 }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }
    if (url.endsWith('/userinfo')) {
      const profile = idpProfile[providerId];
      if (!profile) return new Response('{}', { status: 401 });
      return new Response(JSON.stringify({ ...profile, id: profile.sub, name: 'Synthetic Person' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    return new Response('not found', { status: 404 });
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
});

// ── HTTP helpers ─────────────────────────────────────────────────────────────

const cookiesFrom = (response: Response): string[] =>
  (response.headers.getSetCookie?.() ?? [response.headers.get('set-cookie') ?? ''])
    .map((c) => c.split(';')[0]!)
    .filter(Boolean);

const joinCookies = (...sets: string[][]) => sets.flat().filter(Boolean).join('; ');

const post = (manager: AuthManager, path: string, body: unknown, cookie?: string) =>
  manager.handleRequest(
    new Request(`${BASE}/api/v1/auth/${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(cookie ? { cookie } : {}) },
      body: JSON.stringify(body),
    }),
  );

/** Sign up with email + password; answers the session cookies. */
const signUp = async (manager: AuthManager, email: string): Promise<string[]> => {
  const res = await post(manager, 'sign-up/email', { email, password: PASSWORD, name: 'Synthetic Person' });
  expect(res.status).toBe(200);
  return cookiesFrom(res);
};

/**
 * One OAuth round trip. `start` is `sign-in/social` (an implicit sign-in) or
 * `link-social` (an explicit link, which needs `sessionCookie`). Answers the
 * callback's redirect target.
 */
const oauthRoundTrip = async (
  manager: AuthManager,
  providerId: string,
  start: 'sign-in/social' | 'link-social',
  sessionCookie: string[] = [],
  extraBody: Record<string, unknown> = {},
): Promise<URL> => {
  const begin = await post(
    manager,
    start,
    { provider: providerId, callbackURL: AFTER, disableRedirect: true, ...extraBody },
    joinCookies(sessionCookie),
  );
  expect(begin.status).toBe(200);
  const { url } = (await begin.json()) as { url: string };
  const state = new URL(url).searchParams.get('state');
  expect(state).toBeTruthy();
  const callback = await manager.handleRequest(
    new Request(`${BASE}/api/v1/auth/callback/${providerId}?code=code-1&state=${encodeURIComponent(state!)}`, {
      headers: { cookie: joinCookies(sessionCookie, cookiesFrom(begin)) },
    }),
  );
  expect(callback.status).toBe(302);
  return new URL(callback.headers.get('location')!, BASE);
};

const userRow = (engine: any, email: string) =>
  (engine.tables.get('sys_user') ?? []).find((u: any) => u.email === email);
const accountsOf = (engine: any, userId: string, providerId: string) =>
  (engine.tables.get('sys_account') ?? []).filter((a: any) => a.user_id === userId && a.provider_id === providerId);
/** The providers the user has an unlink record for, sorted (none when there is no record). */
const unlinkedProviders = (engine: any, userId: string): string[] =>
  (engine.tables.get('sys_verification') ?? [])
    .filter((v: any) => typeof v.identifier === 'string' && v.identifier.startsWith(unlinkTombstoneUserPrefix(userId)))
    .map((v: any) => {
      const providerId = JSON.parse(v.value).providerId as string;
      expect(v.identifier).toBe(unlinkTombstoneIdentifier(userId, providerId));
      return providerId;
    })
    .sort();
const setVerified = (engine: any, email: string, verified: boolean) => {
  userRow(engine, email).email_verified = verified;
};

// ─────────────────────────────────────────────────────────────────────────────

describe('implicit link decision', () => {
  const base = {
    providerId: EXTERNAL,
    sourceMethod: 'oauth',
    localEmailVerified: false,
    requireLocalEmailVerified: true,
    unlinkedByUser: false,
  };

  it('refuses an unverified local row for an external provider', () => {
    expect(decideImplicitLink(base)).toEqual({ allow: false, reason: 'local-email-unverified' });
  });

  it('allows a verified local row', () => {
    expect(decideImplicitLink({ ...base, localEmailVerified: true })).toEqual({ allow: true });
  });

  it('exempts the platform identity provider from the local-verification precondition', () => {
    expect(decideImplicitLink({ ...base, providerId: PLATFORM_IDP_PROVIDER_ID })).toEqual({ allow: true });
  });

  it('binds the platform exception to the OAuth sign-in method, not the provider id alone', () => {
    for (const sourceMethod of ['sso-oidc', 'sso-saml', undefined]) {
      expect(decideImplicitLink({ ...base, providerId: PLATFORM_IDP_PROVIDER_ID, sourceMethod })).toEqual({
        allow: false,
        reason: 'local-email-unverified',
      });
    }
  });

  it('honours an unlink for every provider, the platform identity provider included', () => {
    for (const providerId of [EXTERNAL, PLATFORM_IDP_PROVIDER_ID]) {
      expect(decideImplicitLink({ ...base, providerId, localEmailVerified: true, unlinkedByUser: true })).toEqual({
        allow: false,
        reason: 'unlinked-by-user',
      });
    }
  });

  it('an explicit operator opt-out drops only the verification precondition', () => {
    expect(decideImplicitLink({ ...base, requireLocalEmailVerified: false })).toEqual({ allow: true });
    expect(decideImplicitLink({ ...base, requireLocalEmailVerified: false, unlinkedByUser: true }).allow).toBe(false);
  });

  it('reads the provider id from oauth and sso sources alike', () => {
    expect(linkSourceProviderId({ oauth: { providerId: 'p1' } })).toBe('p1');
    expect(linkSourceProviderId({ sso: { providerId: 'p2' } })).toBe('p2');
    expect(linkSourceProviderId({})).toBeUndefined();
  });
});

describe('vendor account-linking configuration', () => {
  const capture = async (config: Record<string, unknown> = {}) => {
    const manager = makeManager(createMemoryEngine(), config);
    const auth: any = await (manager as any).getOrCreateAuth();
    return auth.options.account.accountLinking;
  };

  it('pins the vendor flag off by default and always trusts the platform identity provider', async () => {
    const linking = await capture();
    expect(linking.requireLocalEmailVerified).toBe(false);
    expect(linking.trustedProviders).toContain(PLATFORM_IDP_PROVIDER_ID);
  });

  it('hands an explicit strict operator value to the vendor for every provider', async () => {
    const linking = await capture({ account: { accountLinking: { requireLocalEmailVerified: true, trustedProviders: ['p9'] } } });
    expect(linking.requireLocalEmailVerified).toBe(true);
    expect(linking.trustedProviders).toEqual(expect.arrayContaining([PLATFORM_IDP_PROVIDER_ID, 'p9']));
  });
});

describe('implicit link on external sign-in, end to end', () => {
  it('refuses an unverified local row, writes no link and leaves the row unverified', async () => {
    const engine = createMemoryEngine();
    const manager = makeManager(engine);
    const email = 'member@example.test';
    await signUp(manager, email);
    const user = userRow(engine, email);
    expect(Boolean(user.email_verified)).toBe(false);
    idpProfile[EXTERNAL] = { sub: 'ext-1', email, email_verified: true };

    const target = await oauthRoundTrip(manager, EXTERNAL, 'sign-in/social');

    expect(target.searchParams.get('error')).toBe(IMPLICIT_LINK_REFUSED);
    expect(accountsOf(engine, user.id, EXTERNAL)).toHaveLength(0);
    expect(Boolean(userRow(engine, email).email_verified)).toBe(false);
  });

  it('links a verified local row and signs the caller in', async () => {
    const engine = createMemoryEngine();
    const manager = makeManager(engine);
    const email = 'verified@example.test';
    await signUp(manager, email);
    setVerified(engine, email, true);
    const user = userRow(engine, email);
    idpProfile[EXTERNAL] = { sub: 'ext-2', email, email_verified: true };

    const target = await oauthRoundTrip(manager, EXTERNAL, 'sign-in/social');

    expect(target.searchParams.get('error')).toBeNull();
    expect(target.href).toBe(AFTER);
    expect(accountsOf(engine, user.id, EXTERNAL)).toHaveLength(1);
  });

  it('keeps the platform identity provider exception for an unverified owner-seeded row', async () => {
    const engine = createMemoryEngine();
    const manager = makeManager(engine);
    const email = 'owner@example.test';
    await signUp(manager, email);
    const user = userRow(engine, email);
    expect(Boolean(user.email_verified)).toBe(false);
    idpProfile[PLATFORM_IDP_PROVIDER_ID] = { sub: 'cloud-1', email, email_verified: true };

    const target = await oauthRoundTrip(manager, PLATFORM_IDP_PROVIDER_ID, 'sign-in/social');

    expect(target.searchParams.get('error')).toBeNull();
    expect(accountsOf(engine, user.id, PLATFORM_IDP_PROVIDER_ID)).toHaveLength(1);
  });

  it('an explicit operator opt-out restores the unverified-row link', async () => {
    const engine = createMemoryEngine();
    const manager = makeManager(engine, { account: { accountLinking: { requireLocalEmailVerified: false } } });
    const email = 'optout@example.test';
    await signUp(manager, email);
    const user = userRow(engine, email);
    idpProfile[EXTERNAL] = { sub: 'ext-3', email, email_verified: true };

    const target = await oauthRoundTrip(manager, EXTERNAL, 'sign-in/social');

    expect(target.searchParams.get('error')).toBeNull();
    expect(accountsOf(engine, user.id, EXTERNAL)).toHaveLength(1);
  });

  it('after an unlink, an implicit sign-in is refused; an explicit link is allowed and lifts the refusal', async () => {
    const engine = createMemoryEngine();
    const manager = makeManager(engine);
    const email = 'unlinker@example.test';
    const session = await signUp(manager, email);
    setVerified(engine, email, true);
    const user = userRow(engine, email);
    idpProfile[EXTERNAL] = { sub: 'ext-4', email, email_verified: true };

    // Linked implicitly (verified row).
    expect((await oauthRoundTrip(manager, EXTERNAL, 'sign-in/social')).searchParams.get('error')).toBeNull();
    const [linked] = accountsOf(engine, user.id, EXTERNAL);
    expect(linked).toBeTruthy();

    // The user unlinks it.
    const unlink = await post(manager, 'unlink-account', { accountId: linked.id }, joinCookies(session));
    expect(unlink.status).toBe(200);
    expect(accountsOf(engine, user.id, EXTERNAL)).toHaveLength(0);
    expect(unlinkedProviders(engine, user.id)).toEqual([EXTERNAL]);

    // An implicit sign-in through the same provider no longer re-links.
    const refused = await oauthRoundTrip(manager, EXTERNAL, 'sign-in/social');
    expect(refused.searchParams.get('error')).toBe(IMPLICIT_LINK_REFUSED);
    expect(accountsOf(engine, user.id, EXTERNAL)).toHaveLength(0);

    // An explicit, session-authenticated link is allowed and clears the record.
    const explicit = await oauthRoundTrip(manager, EXTERNAL, 'link-social', session);
    expect(explicit.searchParams.get('error')).toBeNull();
    expect(accountsOf(engine, user.id, EXTERNAL)).toHaveLength(1);
    expect(unlinkedProviders(engine, user.id)).toEqual([]);

    // …and the provider signs the user in again.
    expect((await oauthRoundTrip(manager, EXTERNAL, 'sign-in/social')).searchParams.get('error')).toBeNull();
  });
  it('refuses on the id-token sign-in path for an unverified local row', async () => {
    const engine = createMemoryEngine();
    const manager = makeManager(engine);
    const email = 'idtoken@example.test';
    await signUp(manager, email);
    const user = userRow(engine, email);
    idpProfile[SOCIAL] = { sub: 'social-1', email, email_verified: true };

    const res = await post(manager, 'sign-in/social', {
      provider: SOCIAL,
      idToken: { token: 'synthetic-id-token' },
    });

    expect(res.status).toBe(403);
    expect(((await res.json()) as any).code).toBe(IMPLICIT_LINK_REFUSED);
    expect(accountsOf(engine, user.id, SOCIAL)).toHaveLength(0);
    expect(Boolean(userRow(engine, email).email_verified)).toBe(false);

    // The same path links a verified row.
    setVerified(engine, email, true);
    const ok = await post(manager, 'sign-in/social', { provider: SOCIAL, idToken: { token: 'synthetic-id-token' } });
    expect(ok.status).toBe(200);
    expect(accountsOf(engine, user.id, SOCIAL)).toHaveLength(1);
  });

  it('a client-supplied link in additionalData does not make a sign-in an explicit link', async () => {
    const engine = createMemoryEngine();
    const manager = makeManager(engine);
    const email = 'forged@example.test';
    await signUp(manager, email);
    const user = userRow(engine, email);
    idpProfile[EXTERNAL] = { sub: 'ext-5', email, email_verified: true };

    const target = await oauthRoundTrip(manager, EXTERNAL, 'sign-in/social', [], {
      additionalData: { link: { userId: user.id, email } },
    });

    expect(target.searchParams.get('error')).toBe(IMPLICIT_LINK_REFUSED);
    expect(accountsOf(engine, user.id, EXTERNAL)).toHaveLength(0);
  });

  it('allows an explicit link-social for an unverified user, without marking the email verified', async () => {
    const engine = createMemoryEngine();
    const manager = makeManager(engine);
    const email = 'explicit@example.test';
    const session = await signUp(manager, email);
    const user = userRow(engine, email);
    expect(Boolean(user.email_verified)).toBe(false);
    idpProfile[EXTERNAL] = { sub: 'ext-6', email, email_verified: true };

    const target = await oauthRoundTrip(manager, EXTERNAL, 'link-social', session);

    expect(target.searchParams.get('error')).toBeNull();
    expect(accountsOf(engine, user.id, EXTERNAL)).toHaveLength(1);
    expect(Boolean(userRow(engine, email).email_verified)).toBe(false);
  });

  it('applies to a generic OIDC provider configured by discovery', async () => {
    const engine = createMemoryEngine();
    const manager = makeManager(engine);
    const email = 'oidc@example.test';
    await signUp(manager, email);
    const user = userRow(engine, email);
    idpProfile[OIDC] = { sub: 'oidc-1', email, email_verified: true };

    const refused = await oauthRoundTrip(manager, OIDC, 'sign-in/social');
    expect(refused.searchParams.get('error')).toBe(IMPLICIT_LINK_REFUSED);
    expect(accountsOf(engine, user.id, OIDC)).toHaveLength(0);

    setVerified(engine, email, true);
    const linked = await oauthRoundTrip(manager, OIDC, 'sign-in/social');
    expect(linked.searchParams.get('error')).toBeNull();
    expect(accountsOf(engine, user.id, OIDC)).toHaveLength(1);
  });

  it('refuses the unlink when its record cannot be written, leaving the provider linked', async () => {
    const engine = createMemoryEngine();
    const manager = makeManager(engine);
    const email = 'storefault@example.test';
    const session = await signUp(manager, email);
    setVerified(engine, email, true);
    const user = userRow(engine, email);
    idpProfile[EXTERNAL] = { sub: 'ext-7', email, email_verified: true };
    expect((await oauthRoundTrip(manager, EXTERNAL, 'sign-in/social')).searchParams.get('error')).toBeNull();
    const [linked] = accountsOf(engine, user.id, EXTERNAL);

    engine.failInserts.add('sys_verification');
    const unlink = await post(manager, 'unlink-account', { accountId: linked.id }, joinCookies(session));
    engine.failInserts.delete('sys_verification');

    expect(unlink.status).toBeGreaterThanOrEqual(400);
    expect(accountsOf(engine, user.id, EXTERNAL)).toHaveLength(1);
    expect(unlinkedProviders(engine, user.id)).toEqual([]);
  });

  it('deleting the user removes its unlink record', async () => {
    const engine = createMemoryEngine();
    const manager = makeManager(engine);
    const email = 'deleted@example.test';
    const session = await signUp(manager, email);
    setVerified(engine, email, true);
    const user = userRow(engine, email);
    idpProfile[EXTERNAL] = { sub: 'ext-8', email, email_verified: true };
    expect((await oauthRoundTrip(manager, EXTERNAL, 'sign-in/social')).searchParams.get('error')).toBeNull();
    const [linked] = accountsOf(engine, user.id, EXTERNAL);
    expect((await post(manager, 'unlink-account', { accountId: linked.id }, joinCookies(session))).status).toBe(200);
    expect(unlinkedProviders(engine, user.id)).toEqual([EXTERNAL]);

    // A server-side deletion: no endpoint context, so the hook resolves the
    // store from the auth instance.
    const auth: any = await (manager as any).getOrCreateAuth();
    await (await auth.$context).internalAdapter.deleteUser(user.id);

    expect(userRow(engine, email)).toBeUndefined();
    expect(unlinkedProviders(engine, user.id)).toEqual([]);
  });
  /** A verified user signed up with a password and linked to two external providers. */
  const twoLinkedProviders = async (manager: AuthManager, engine: any, email: string) => {
    const session = await signUp(manager, email);
    setVerified(engine, email, true);
    const user = userRow(engine, email);
    idpProfile[EXTERNAL] = { sub: `${email}-ext`, email, email_verified: true };
    idpProfile[OIDC] = { sub: `${email}-oidc`, email, email_verified: true };
    expect((await oauthRoundTrip(manager, EXTERNAL, 'sign-in/social')).searchParams.get('error')).toBeNull();
    expect((await oauthRoundTrip(manager, OIDC, 'sign-in/social')).searchParams.get('error')).toBeNull();
    const [first] = accountsOf(engine, user.id, EXTERNAL);
    const [second] = accountsOf(engine, user.id, OIDC);
    return { session, user, first, second };
  };

  it('a later unlink that cannot be recorded keeps every earlier unlink in force', async () => {
    const engine = createMemoryEngine();
    const manager = makeManager(engine);
    const { session, user, first, second } = await twoLinkedProviders(manager, engine, 'twice@example.test');

    expect((await post(manager, 'unlink-account', { accountId: first.id }, joinCookies(session))).status).toBe(200);
    expect(unlinkedProviders(engine, user.id)).toEqual([EXTERNAL]);

    engine.failInserts.add('sys_verification');
    const failed = await post(manager, 'unlink-account', { accountId: second.id }, joinCookies(session));
    engine.failInserts.delete('sys_verification');

    expect(failed.status).toBeGreaterThanOrEqual(400);
    expect(accountsOf(engine, user.id, OIDC)).toHaveLength(1);
    expect(unlinkedProviders(engine, user.id)).toEqual([EXTERNAL]);
    const refused = await oauthRoundTrip(manager, EXTERNAL, 'sign-in/social');
    expect(refused.searchParams.get('error')).toBe(IMPLICIT_LINK_REFUSED);
    expect(accountsOf(engine, user.id, EXTERNAL)).toHaveLength(0);
  });

  it('concurrent unlinks of two providers both stay recorded', async () => {
    const engine = createMemoryEngine();
    const manager = makeManager(engine);
    const { session, user, first, second } = await twoLinkedProviders(manager, engine, 'concurrent@example.test');

    const [a, b] = await Promise.all([
      post(manager, 'unlink-account', { accountId: first.id }, joinCookies(session)),
      post(manager, 'unlink-account', { accountId: second.id }, joinCookies(session)),
    ]);

    expect([a.status, b.status]).toEqual([200, 200]);
    expect(unlinkedProviders(engine, user.id)).toEqual([OIDC, EXTERNAL].sort());
    for (const providerId of [EXTERNAL, OIDC]) {
      const target = await oauthRoundTrip(manager, providerId, 'sign-in/social');
      expect(target.searchParams.get('error')).toBe(IMPLICIT_LINK_REFUSED);
    }
  });
  it('keeps the unlink record in the database when a secondaryStorage cache is configured', async () => {
    const engine = createMemoryEngine();
    const cache = new Map<string, string>();
    const manager = makeManager(engine, {
      // The embedded OAuth provider refuses a cache-held session store; it is
      // not what this case is about.
      plugins: { oidcProvider: false },
      secondaryStorage: {
        get: async (key: string) => cache.get(key) ?? null,
        set: async (key: string, value: string) => {
          cache.set(key, value);
        },
        delete: async (key: string) => {
          cache.delete(key);
        },
      },
    });
    const email = 'cached@example.test';
    const session = await signUp(manager, email);
    setVerified(engine, email, true);
    const user = userRow(engine, email);
    idpProfile[EXTERNAL] = { sub: 'ext-cache', email, email_verified: true };
    expect((await oauthRoundTrip(manager, EXTERNAL, 'sign-in/social')).searchParams.get('error')).toBeNull();
    const [linked] = accountsOf(engine, user.id, EXTERNAL);
    expect((await post(manager, 'unlink-account', { accountId: linked.id }, joinCookies(session))).status).toBe(200);

    // The record is a database row, not a cache entry: evicting every
    // verification value from the cache leaves the refusal in force.
    expect(unlinkedProviders(engine, user.id)).toEqual([EXTERNAL]);
    for (const key of [...cache.keys()]) if (key.startsWith('verification:')) cache.delete(key);
    const refused = await oauthRoundTrip(manager, EXTERNAL, 'sign-in/social');
    expect(refused.searchParams.get('error')).toBe(IMPLICIT_LINK_REFUSED);
  });
});
