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
  return {
    tables,
    async insert(name: string, data: any) {
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
    oidcProviders: [provider(EXTERNAL), provider(PLATFORM_IDP_PROVIDER_ID)],
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
): Promise<URL> => {
  const begin = await post(
    manager,
    start,
    { provider: providerId, callbackURL: AFTER, disableRedirect: true },
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
const tombstones = (engine: any, userId: string, providerId: string) =>
  (engine.tables.get('sys_verification') ?? []).filter(
    (v: any) => v.identifier === unlinkTombstoneIdentifier(userId, providerId),
  );
const setVerified = (engine: any, email: string, verified: boolean) => {
  userRow(engine, email).email_verified = verified;
};

// ─────────────────────────────────────────────────────────────────────────────

describe('implicit link decision', () => {
  const base = {
    providerId: EXTERNAL,
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
    expect(tombstones(engine, user.id, EXTERNAL)).toHaveLength(1);

    // An implicit sign-in through the same provider no longer re-links.
    const refused = await oauthRoundTrip(manager, EXTERNAL, 'sign-in/social');
    expect(refused.searchParams.get('error')).toBe(IMPLICIT_LINK_REFUSED);
    expect(accountsOf(engine, user.id, EXTERNAL)).toHaveLength(0);

    // An explicit, session-authenticated link is allowed and clears the record.
    const explicit = await oauthRoundTrip(manager, EXTERNAL, 'link-social', session);
    expect(explicit.searchParams.get('error')).toBeNull();
    expect(accountsOf(engine, user.id, EXTERNAL)).toHaveLength(1);
    expect(tombstones(engine, user.id, EXTERNAL)).toHaveLength(0);

    // …and the provider signs the user in again.
    expect((await oauthRoundTrip(manager, EXTERNAL, 'sign-in/social')).searchParams.get('error')).toBeNull();
  });
});
