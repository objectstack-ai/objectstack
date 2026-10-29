// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// The IdP's `locale` claim → `sys_user.locale` — see `idp-locale-claim.ts`
// for the rule this file pins.
//
// Three layers:
//
//  1. PURE — reading the claim off a `validateUserInfo` source, closing it
//     against the supported locales, and the write decision.
//  2. END of the chain — a real better-auth pipeline over the in-memory
//     engine, driving real OAuth round trips (`/sign-in/social` →
//     `/callback/:id`) through the platform IdP, a generic-OAuth provider
//     whose token and userinfo endpoints are stubbed. The assertions read
//     what landed: the `sys_user.locale` column and the IdP record beside it.
//  3. The PACKAGE ENTRY — `AuthManager.applyIdpLocaleClaim`, the call a host
//     whose sign-in skips the OIDC seams makes (the cloud's sso-exchange
//     hand-off), imported from `./index` and run over the same engine; and
//     the pin that it and the OIDC settle step are one method.

import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import { assertEngineDeleteDispatch, assertEngineUpdateDispatch, assertEngineFindOnePredicate } from '@objectstack/objectql';
import { AuthManager } from './auth-manager';
// The package entry, as a host outside the package imports it.
import * as entry from './index';
import { PLATFORM_IDP_PROVIDER_ID } from './implicit-account-linking';
import {
  IdpLocaleSync,
  decideIdpLocaleWrite,
  idpLocaleRecordIdentifier,
  readIdpLocaleClaim,
  resolveIdpLocale,
} from './idp-locale-claim';
// better-auth's first module load is paid at module load, not inside the first
// clocked case (AGENTS.md, Build & Test: clocked windows measure behaviour,
// never loading). `AuthManager` reaches these through a lazy `await import()`.
import 'better-auth';
import 'better-auth/api';
import 'better-auth/plugins';
import 'better-auth/plugins/bearer';
import 'better-auth/plugins/custom-session';
import 'better-auth/plugins/generic-oauth';
import 'better-auth/plugins/organization';
import 'better-auth/plugins/organization/access';
import '@better-auth/oauth-provider';

const SUPPORTED = ['en', 'zh-CN', 'ja-JP'];

// ── PURE ─────────────────────────────────────────────────────────────────────

describe('reading the claim off a validateUserInfo source', () => {
  it('reads the profile of a generic-OAuth / social sign-in and of an SSO OIDC sign-in', () => {
    expect(readIdpLocaleClaim({ method: 'oauth', oauth: { providerId: 'p1', profile: { locale: 'zh-CN' } } })).toEqual({
      providerId: 'p1',
      value: 'zh-CN',
    });
    expect(readIdpLocaleClaim({ method: 'sso-oidc', sso: { providerId: 'p2', profile: { locale: 'ja' } } })).toEqual({
      providerId: 'p2',
      value: 'ja',
    });
  });

  it('a present-but-unusable value is still a claim; an absent key is none', () => {
    expect(readIdpLocaleClaim({ method: 'oauth', oauth: { providerId: 'p1', profile: { locale: null } } })).toEqual({
      providerId: 'p1',
      value: null,
    });
    expect(readIdpLocaleClaim({ method: 'oauth', oauth: { providerId: 'p1', profile: { email: 'a@b.c' } } })).toBeUndefined();
    expect(readIdpLocaleClaim({ method: 'oauth', oauth: { providerId: 'p1' } })).toBeUndefined();
  });

  it('reads no claim from a sign-in whose profile is not an OIDC claim set', () => {
    for (const method of ['sso-saml', 'email-password', 'scim', undefined]) {
      expect(readIdpLocaleClaim({ method, sso: { profile: { locale: 'zh-CN' } }, oauth: { profile: { locale: 'zh-CN' } } })).toBeUndefined();
    }
    expect(readIdpLocaleClaim(undefined)).toBeUndefined();
  });
});

describe('closing the claim against the supported locales', () => {
  it('answers the SUPPORTED spelling: exact, case, base language, variant', () => {
    expect(resolveIdpLocale('zh-CN', SUPPORTED)).toBe('zh-CN');
    expect(resolveIdpLocale('zh-cn', SUPPORTED)).toBe('zh-CN');
    expect(resolveIdpLocale('en-US', SUPPORTED)).toBe('en');
    expect(resolveIdpLocale('ja', SUPPORTED)).toBe('ja-JP');
  });

  it('reads the underscore spelling OIDC Core §5.1 notes as the tag it stands for', () => {
    expect(resolveIdpLocale('zh_CN', SUPPORTED)).toBe('zh-CN');
  });

  it('an unsupported or unknown claim names no locale', () => {
    for (const claim of ['fr', 'de-DE', 'not a tag', '', '   ', 'undefined', null, 42, {}]) {
      expect(resolveIdpLocale(claim, SUPPORTED)).toBeUndefined();
    }
  });
});

describe('the write decision', () => {
  it('first creation: the claim sets the preference', () => {
    expect(decideIdpLocaleWrite({ resolved: 'zh-CN', stored: undefined, recorded: undefined })).toEqual({
      locale: 'zh-CN',
      record: 'zh-CN',
    });
  });

  it('a later sign-in follows the claim while the column still holds what the IdP wrote', () => {
    expect(decideIdpLocaleWrite({ resolved: 'en', stored: 'zh-CN', recorded: 'zh-CN' })).toEqual({ locale: 'en', record: 'en' });
  });

  it('a local choice wins: a value the IdP did not write is never overwritten', () => {
    expect(decideIdpLocaleWrite({ resolved: 'en', stored: 'ja-JP', recorded: 'zh-CN' })).toBeNull();
    // A value set before any IdP record existed is a local choice too.
    expect(decideIdpLocaleWrite({ resolved: 'en', stored: 'ja-JP', recorded: undefined })).toBeNull();
    // ... even when the claim is unsupported: it does not clear a local choice.
    expect(decideIdpLocaleWrite({ resolved: undefined, stored: 'ja-JP', recorded: 'zh-CN' })).toBeNull();
  });

  it('an unsupported claim clears an IdP-written value, so the deployment default applies', () => {
    expect(decideIdpLocaleWrite({ resolved: undefined, stored: 'zh-CN', recorded: 'zh-CN' })).toEqual({ locale: null, record: null });
    expect(decideIdpLocaleWrite({ resolved: undefined, stored: undefined, recorded: undefined })).toBeNull();
  });

  it('a column cleared locally is handed back to the IdP', () => {
    expect(decideIdpLocaleWrite({ resolved: 'en', stored: undefined, recorded: 'zh-CN' })).toEqual({ locale: 'en', record: 'en' });
  });

  it('nothing to change, nothing written', () => {
    expect(decideIdpLocaleWrite({ resolved: 'en', stored: 'en', recorded: 'en' })).toBeNull();
  });
});

describe('the deleted-user half', () => {
  it('drops only that user’s record, and never throws', async () => {
    const deleteMany = vi.fn(async () => 1);
    const adapter = { findOne: vi.fn(), create: vi.fn(), deleteMany };
    const warn = vi.fn();
    const sync = new IdpLocaleSync({
      getEngine: () => undefined,
      getSupportedLocales: () => SUPPORTED,
      resolveAuth: async () => ({ adapter }),
      warn,
    });
    await sync.forget({ id: 'usr_1' }, undefined);
    expect(deleteMany).toHaveBeenCalledWith({
      model: 'verification',
      where: [{ field: 'identifier', value: idpLocaleRecordIdentifier('usr_1') }],
    });

    deleteMany.mockRejectedValueOnce(new Error('store down'));
    await expect(sync.forget({ id: 'usr_1' }, undefined)).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledTimes(1);
  });
});

// ── END of the chain ─────────────────────────────────────────────────────────

/** An in-memory IDataEngine (the implicit-account-linking harness shape). */
const createMemoryEngine = () => {
  const tables = new Map<string, any[]>();
  const rows = (name: string) => {
    if (!tables.has(name)) tables.set(name, []);
    return tables.get(name)!;
  };
  const eq = (a: any, b: any) =>
    a instanceof Date || b instanceof Date ? new Date(a as any).getTime() === new Date(b as any).getTime() : a === b;
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
  /** Objects whose updates fail — the store-fault seam. */
  const failUpdates = new Set<string>();
  return {
    tables,
    failUpdates,
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
      if (failUpdates.has(name)) throw new Error(`fake driver: update of ${name} refused`);
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
const BASE = 'http://localhost:3000';
const AFTER = `${BASE}/after-sign-in`;
const IDP = 'https://idp.example.test';
const EMAIL = 'person@example.test';

const makeManager = (engine: any, config: Record<string, unknown> = {}) =>
  new AuthManager({
    secret: SECRET,
    baseUrl: BASE,
    dataEngine: engine,
    oidcProviders: [
      {
        providerId: PLATFORM_IDP_PROVIDER_ID,
        clientId: 'cloud-client',
        clientSecret: 'cloud-secret',
        authorizationUrl: `${IDP}/${PLATFORM_IDP_PROVIDER_ID}/authorize`,
        tokenUrl: `${IDP}/${PLATFORM_IDP_PROVIDER_ID}/token`,
        userInfoUrl: `${IDP}/${PLATFORM_IDP_PROVIDER_ID}/userinfo`,
        pkce: false,
      },
    ],
    getI18n: () => ({ getLocales: () => SUPPORTED }),
    ...config,
  } as any);

/** What the stubbed IdP asserts about the person signing in. `locale` absent = no claim. */
let idpProfile: Record<string, unknown> = {};

const realFetch = globalThis.fetch;
beforeEach(() => {
  idpProfile = {};
  vi.stubGlobal('fetch', async (input: any, init?: any) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (!url.startsWith(IDP)) return realFetch(input, init);
    if (url.endsWith('/token')) {
      return new Response(JSON.stringify({ access_token: 'at-cloud', token_type: 'Bearer', expires_in: 3600 }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    if (url.endsWith('/userinfo')) {
      return new Response(
        JSON.stringify({ sub: 'cloud-sub-1', id: 'cloud-sub-1', email: EMAIL, email_verified: true, name: 'Synthetic Person', ...idpProfile }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }
    return new Response('not found', { status: 404 });
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
});

const cookiesFrom = (response: Response): string[] =>
  (response.headers.getSetCookie?.() ?? [response.headers.get('set-cookie') ?? ''])
    .map((c) => c.split(';')[0]!)
    .filter(Boolean);

/** One implicit sign-in through the platform IdP; answers the callback's redirect target. */
const signInWithIdp = async (manager: AuthManager): Promise<URL> => {
  const begin = await manager.handleRequest(
    new Request(`${BASE}/api/v1/auth/sign-in/social`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider: PLATFORM_IDP_PROVIDER_ID, callbackURL: AFTER, disableRedirect: true }),
    }),
  );
  expect(begin.status).toBe(200);
  const { url } = (await begin.json()) as { url: string };
  const state = new URL(url).searchParams.get('state');
  const callback = await manager.handleRequest(
    new Request(`${BASE}/api/v1/auth/callback/${PLATFORM_IDP_PROVIDER_ID}?code=code-1&state=${encodeURIComponent(state!)}`, {
      headers: { cookie: cookiesFrom(begin).join('; ') },
    }),
  );
  expect(callback.status).toBe(302);
  return new URL(callback.headers.get('location')!, BASE);
};

const userRow = (engine: any) => (engine.tables.get('sys_user') ?? []).find((u: any) => u.email === EMAIL);
const recordOf = (engine: any, userId: string) => {
  const row = (engine.tables.get('sys_verification') ?? []).find(
    (v: any) => v.identifier === idpLocaleRecordIdentifier(userId),
  );
  return row ? (JSON.parse(row.value).locale as string) : undefined;
};
/** The user picks a language in the environment itself (the profile page's write). */
const pickLocally = (engine: any, locale: string) => {
  userRow(engine).locale = locale;
};

describe('a JIT sign-in through the platform IdP sets the user language preference', () => {
  it('⭐ a sign-in with `locale: "zh-CN"` creates a user whose language is zh-CN', async () => {
    const engine = createMemoryEngine();
    idpProfile = { locale: 'zh-CN' };

    const landed = await signInWithIdp(makeManager(engine));

    expect(landed.href).toBe(AFTER);
    expect(userRow(engine).locale).toBe('zh-CN');
    expect(recordOf(engine, userRow(engine).id)).toBe('zh-CN');
  });

  it('⭐ a later sign-in with `locale: "en"` after the user picked ja locally keeps ja', async () => {
    const engine = createMemoryEngine();
    const manager = makeManager(engine);
    idpProfile = { locale: 'zh-CN' };
    await signInWithIdp(manager);
    pickLocally(engine, 'ja-JP');

    idpProfile = { locale: 'en' };
    const landed = await signInWithIdp(manager);

    expect(landed.href).toBe(AFTER);
    expect(userRow(engine).locale).toBe('ja-JP');
  });

  it('⭐ an unsupported locale falls back to the default: the column stays unset', async () => {
    const engine = createMemoryEngine();
    idpProfile = { locale: 'fr-FR' };

    const landed = await signInWithIdp(makeManager(engine));

    expect(landed.href).toBe(AFTER);
    expect(userRow(engine).locale ?? null).toBeNull();
    expect(recordOf(engine, userRow(engine).id)).toBeUndefined();
  });

  it('a later sign-in follows the cloud account language while the user has not picked one', async () => {
    const engine = createMemoryEngine();
    const manager = makeManager(engine);
    idpProfile = { locale: 'zh-CN' };
    await signInWithIdp(manager);

    idpProfile = { locale: 'en-US' };
    await signInWithIdp(manager);

    expect(userRow(engine).locale).toBe('en');
    expect(recordOf(engine, userRow(engine).id)).toBe('en');
  });

  it('a later unsupported claim clears an IdP-written value, never a local one', async () => {
    const engine = createMemoryEngine();
    const manager = makeManager(engine);
    idpProfile = { locale: 'zh-CN' };
    await signInWithIdp(manager);

    idpProfile = { locale: 'fr' };
    await signInWithIdp(manager);
    expect(userRow(engine).locale ?? null).toBeNull();
    expect(recordOf(engine, userRow(engine).id)).toBeUndefined();

    pickLocally(engine, 'ja-JP');
    await signInWithIdp(manager);
    expect(userRow(engine).locale).toBe('ja-JP');
  });

  it('an IdP that sends no `locale` changes nothing', async () => {
    const engine = createMemoryEngine();
    const manager = makeManager(engine);
    idpProfile = { locale: 'zh-CN' };
    await signInWithIdp(manager);

    idpProfile = {};
    await signInWithIdp(manager);

    expect(userRow(engine).locale).toBe('zh-CN');
    expect(recordOf(engine, userRow(engine).id)).toBe('zh-CN');
  });

  it('a user who held a language before any IdP record keeps it', async () => {
    const engine = createMemoryEngine();
    const manager = makeManager(engine);
    idpProfile = {};
    await signInWithIdp(manager);
    pickLocally(engine, 'ja-JP');

    idpProfile = { locale: 'zh-CN' };
    await signInWithIdp(manager);

    expect(userRow(engine).locale).toBe('ja-JP');
  });

  it('a user store that refuses the write never fails the sign-in, and says so at warn', async () => {
    const engine = createMemoryEngine();
    const warn = vi.fn();
    const manager = makeManager(engine, { logger: { warn, info: () => {}, error: () => {}, debug: () => {} } });
    engine.failUpdates.add('sys_user');
    idpProfile = { locale: 'zh-CN' };

    const landed = await signInWithIdp(manager);

    expect(landed.href).toBe(AFTER);
    expect(userRow(engine).locale ?? null).toBeNull();
    expect(recordOf(engine, userRow(engine).id)).toBeUndefined();
    expect(warn.mock.calls.some(([m]) => String(m).includes('IdP locale claim was not applied'))).toBe(true);
  });

  it('with no i18n service to close the claim against, nothing is written, once said at warn', async () => {
    const engine = createMemoryEngine();
    const warn = vi.fn();
    const manager = makeManager(engine, {
      getI18n: () => undefined,
      logger: { warn, info: () => {}, error: () => {}, debug: () => {} },
    });
    idpProfile = { locale: 'zh-CN' };

    await signInWithIdp(manager);
    await signInWithIdp(manager);

    expect(userRow(engine).locale ?? null).toBeNull();
    expect(warn.mock.calls.filter(([m]) => String(m).includes('no i18n service reports a supported locale'))).toHaveLength(1);
  });
});

describe('the OIDC JIT path and the entry call apply the rule through one method', () => {
  it('a sign-in through the platform IdP settles its claim through IdpLocaleSync.apply', async () => {
    const apply = vi.spyOn(IdpLocaleSync.prototype, 'apply');
    try {
      const engine = createMemoryEngine();
      idpProfile = { locale: 'zh-CN' };

      await signInWithIdp(makeManager(engine));

      expect(apply).toHaveBeenCalledTimes(1);
      expect(apply).toHaveBeenCalledWith(
        userRow(engine).id,
        { providerId: PLATFORM_IDP_PROVIDER_ID, value: 'zh-CN' },
        expect.anything(),
      );
      expect(userRow(engine).locale).toBe('zh-CN');
    } finally {
      apply.mockRestore();
    }
  });
});

describe('the package entry applies the rule for a sign-in that skips the OIDC seams', () => {
  const USER_ID = 'usr_entry_1';
  const CLOUD = 'objectos-cloud';

  /** A user the host's own hand-off already holds: created, never signed in through OIDC. */
  const seedUser = async (engine: ReturnType<typeof createMemoryEngine>) => {
    await engine.insert('sys_user', { id: USER_ID, email: EMAIL, name: 'Synthetic Person' });
  };
  const entryManager = (engine: unknown, config: Record<string, unknown> = {}) =>
    new entry.AuthManager({
      secret: SECRET,
      baseUrl: BASE,
      dataEngine: engine,
      getI18n: () => ({ getLocales: () => SUPPORTED }),
      ...config,
    } as any);
  const claim = (value: unknown): entry.IdpLocaleClaim => ({ providerId: CLOUD, value });
  const userOf = (engine: ReturnType<typeof createMemoryEngine>) =>
    (engine.tables.get('sys_user') ?? []).find((u: any) => u.id === USER_ID);
  const verificationRows = (engine: ReturnType<typeof createMemoryEngine>) =>
    JSON.stringify(engine.tables.get('sys_verification') ?? []);

  it('⭐ unset: the claim is written, with the idp-locale record beside it', async () => {
    const engine = createMemoryEngine();
    await seedUser(engine);
    const manager = entryManager(engine);

    await expect(manager.applyIdpLocaleClaim(USER_ID, claim('zh-CN'))).resolves.toBeUndefined();

    expect(userOf(engine).locale).toBe('zh-CN');
    expect(recordOf(engine, USER_ID)).toBe('zh-CN');
  });

  it('⭐ still the recorded value: a later claim overwrites it, record and column alike', async () => {
    const engine = createMemoryEngine();
    await seedUser(engine);
    const manager = entryManager(engine);
    await manager.applyIdpLocaleClaim(USER_ID, claim('zh-CN'));

    await manager.applyIdpLocaleClaim(USER_ID, claim('en-US'));

    expect(userOf(engine).locale).toBe('en');
    expect(recordOf(engine, USER_ID)).toBe('en');
  });

  it('⭐ a local choice: kept, and neither the column nor the record is written', async () => {
    const engine = createMemoryEngine();
    await seedUser(engine);
    const manager = entryManager(engine);
    await manager.applyIdpLocaleClaim(USER_ID, claim('zh-CN'));
    userOf(engine).locale = 'ja-JP';
    const update = vi.spyOn(engine, 'update');
    const recordsBefore = verificationRows(engine);

    await manager.applyIdpLocaleClaim(USER_ID, claim('en'));

    expect(userOf(engine).locale).toBe('ja-JP');
    expect(update).not.toHaveBeenCalled();
    expect(verificationRows(engine)).toBe(recordsBefore);
  });

  it('runs through the same IdpLocaleSync.apply the OIDC settle step calls', async () => {
    const apply = vi.spyOn(IdpLocaleSync.prototype, 'apply');
    try {
      const engine = createMemoryEngine();
      await seedUser(engine);

      await entryManager(engine).applyIdpLocaleClaim(USER_ID, claim('zh-CN'));

      expect(apply).toHaveBeenCalledTimes(1);
      expect(apply).toHaveBeenCalledWith(USER_ID, claim('zh-CN'));
    } finally {
      apply.mockRestore();
    }
  });

  it('never throws: a user store that refuses the write is reported at warn', async () => {
    const engine = createMemoryEngine();
    await seedUser(engine);
    const warn = vi.fn();
    const manager = entryManager(engine, { logger: { warn, info: () => {}, error: () => {}, debug: () => {} } });
    engine.failUpdates.add('sys_user');

    await expect(manager.applyIdpLocaleClaim(USER_ID, claim('zh-CN'))).resolves.toBeUndefined();
    await expect(manager.applyIdpLocaleClaim('', claim('zh-CN'))).resolves.toBeUndefined();
    await expect(manager.applyIdpLocaleClaim(USER_ID, undefined as never)).resolves.toBeUndefined();

    expect(userOf(engine).locale ?? null).toBeNull();
    expect(recordOf(engine, USER_ID)).toBeUndefined();
    expect(warn.mock.calls.filter(([m]) => String(m).includes('IdP locale claim was not applied'))).toHaveLength(1);
  });
});
