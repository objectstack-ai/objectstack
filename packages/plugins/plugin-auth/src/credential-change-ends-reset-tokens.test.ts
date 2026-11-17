// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * A change to a user's credential ends every other outstanding password-reset
 * token of that user (`credential-change-ends-reset-tokens.ts`).
 *
 * Every door is driven through the real routes: a real `AuthManager` over a
 * real `ObjectQL` engine (better-sqlite3, this plugin's own manifest), behind
 * `AuthPlugin.registerAuthRoutes` mounted on a Hono app — the administrator's
 * `/admin/set-user-password` included, which that mount serves itself.
 *
 * Pinned:
 *  - after a completed emailed-link reset, the user's other link answers what
 *    a link never issued answers, whichever of the two was spent first, and
 *    the password is the one the spent link set;
 *  - after the user's own `/change-password` and after an administrator's
 *    `/admin/set-user-password`, every link outstanding before the change
 *    answers what a link never issued answers — at the reset door and at the
 *    link's landing (`GET /reset-password/:token`) — and a link requested
 *    after the change resets (the control); the same after a first password
 *    set through `/set-initial-password`;
 *  - a texted reset code outstanding before a password change answers what a
 *    code never sent answers, and a code requested after it resets; a
 *    completed texted-code reset ends the user's outstanding links;
 *  - another user's links are untouched by this user's change (the control);
 *  - with a `secondaryStorage` cache, an ended link answers what a link never
 *    issued answers from the cache's reads too;
 *  - a password write whose tokens cannot be ended does not land: the old
 *    password stands and the outstanding link resets.
 */

import { describe, it, expect, afterAll, afterEach, vi } from 'vitest';
import { Hono } from 'hono';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { AuthManager } from './auth-manager.js';
import { AuthPlugin } from './auth-plugin.js';
import { authIdentityObjects } from './manifest.js';
import { inviteForAudienceGate } from './audience-gate-test-support';
import { memoizeScrypt } from './__tests__/scrypt-memo.testkit';
import { sqliteEnginePool } from './__tests__/sqlite-engine-pool.testkit';
// better-auth's first module load is paid here, at module load, not inside the
// first case (AGENTS.md, Build & Test: clocked windows measure behaviour).
import 'better-auth';
import 'better-auth/api';
import 'better-auth/plugins';

const ORIGIN = 'http://localhost:3000';
const BASE = '/api/v1/auth';
const SECRET = 'test-secret-at-least-32-chars-long-reset-tokens-end';
const ADMIN_EMAIL = 'reset-tokens-admin@example.com';
const EMAIL = 'reset-tokens-user@example.com';
const OTHER_EMAIL = 'reset-tokens-other@example.com';
const PHONE = '+15550177';
const FIRST = 'F1rst!Password-Tokens';
const SECOND = 'S3cond!Password-Tokens';
const THIRD = 'Th1rd!Password-Tokens';
const FOURTH = 'F0urth!Password-Tokens';
const SYS = { context: { isSystem: true } } as never;

const engines = sqliteEnginePool(async () => {
  const engine = new ObjectQL();
  const driver = new SqlDriver({
    client: 'better-sqlite3',
    connection: { filename: ':memory:' },
    useNullAsDefault: true,
  });
  engine.registerDriver(driver, true);
  await engine.init();
  for (const object of authIdentityObjects) {
    engine.registry.registerObject(object as never, '@objectstack/plugin-auth');
  }
  await engine.syncSchemas();
  return { engine, driver };
});
afterEach(engines.release);
afterAll(engines.destroy);

const scrypt = memoizeScrypt();
afterAll(scrypt.restore);

afterEach(() => {
  vi.restoreAllMocks();
});

const mockCtx = () =>
  ({
    registerService: vi.fn(),
    getService: vi.fn((name: string) => (name === 'manifest' ? { register: vi.fn() } : undefined)),
    getServices: vi.fn(() => new Map()),
    hook: vi.fn(),
    trigger: vi.fn(),
    logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
    getKernel: vi.fn(),
  }) as any;

/** Status and the error code, in either envelope the auth doors answer with. */
async function answer(res: Response): Promise<{ status: number; code?: string }> {
  const body = (await res.clone().json().catch(() => null)) as { code?: unknown; error?: { code?: unknown } } | null;
  const code = body?.error?.code ?? body?.code;
  return { status: res.status, ...(typeof code === 'string' ? { code } : {}) };
}

/**
 * One deployment: an administrator (the first account) and the user under test
 * (signed up through an invitation, as `invite_only` admits a second account),
 * behind the real route mount.
 */
async function stage(config: Record<string, unknown> = {}) {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'info').mockImplementation(() => {});
  const engine = await engines.take();
  const manager = new AuthManager({
    secret: SECRET,
    baseUrl: ORIGIN,
    dataEngine: engine as never,
    ...config,
    plugins: { admin: true, ...((config.plugins as Record<string, unknown>) ?? {}) },
  } as never);
  const mail: Array<{ template: string; data: Record<string, unknown> }> = [];
  manager.setEmailService({
    sendTemplate: async (input: any) => {
      mail.push(input);
      return { status: 'sent' };
    },
  } as never);
  const texts: Array<{ to: string; templateParams?: { code?: string } }> = [];
  manager.setSmsService({
    async send(input: { to: string; templateParams?: { code?: string } }) {
      texts.push(input);
      return { id: `sms${texts.length}`, status: 'sent' };
    },
    isConfigured: () => true,
  } as never);

  const app = new Hono();
  const ctx = mockCtx();
  const plugin = new AuthPlugin({ secret: SECRET });
  await plugin.init(ctx);
  (plugin as any).authManager = manager;
  (plugin as any).registerAuthRoutes({ getRawApp: () => app, getPort: () => 0 }, ctx);

  const fire = (path: string, body: unknown, bearer?: string) =>
    app.request(`${ORIGIN}${BASE}${path}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: ORIGIN,
        ...(bearer ? { authorization: `Bearer ${bearer}` } : {}),
      },
      body: JSON.stringify(body),
    });

  const signUp = async (email: string, invited: boolean) => {
    const invitationId = invited ? await inviteForAudienceGate(engine, email) : undefined;
    const res = await fire('/sign-up/email', { email, password: FIRST, name: email, ...(invitationId ? { invitationId } : {}) });
    expect(res.status, `sign-up ${email}: ${await res.clone().text()}`).toBe(200);
  };
  await signUp(ADMIN_EMAIL, false);
  await signUp(EMAIL, true);

  const idOf = async (email: string) =>
    String(((await engine.find('sys_user', { where: { email }, limit: 1 }, SYS)) as Array<{ id: string }>)[0].id);
  await engine.update('sys_user', { id: await idOf(ADMIN_EMAIL), role: 'admin' }, SYS);

  /** The bearer a password sign-in mints, or the refusal's status. */
  const signIn = async (email: string, password: string) => {
    const res = await fire('/sign-in/email', { email, password });
    return { status: res.status, bearer: res.headers.get('set-auth-token') ?? undefined };
  };

  /** The token the reset mail carries, read the way its recipient reads it. */
  const requestLink = async (email = EMAIL): Promise<string> => {
    const before = mail.filter((m) => m.template === 'auth.password_reset').length;
    const res = await fire('/request-password-reset', { email, redirectTo: `${ORIGIN}/reset` });
    expect(res.status, await res.clone().text()).toBe(200);
    await vi.waitFor(() => expect(mail.filter((m) => m.template === 'auth.password_reset').length).toBe(before + 1));
    return String(mail.filter((m) => m.template === 'auth.password_reset')[before].data.token);
  };

  const reset = async (token: string, newPassword: string) =>
    answer(await fire('/reset-password', { token, newPassword }));

  /** The `error` the link's landing redirects with (`null` = it hands the token on). */
  const landing = async (token: string) => {
    const res = await app.request(
      `${ORIGIN}${BASE}/reset-password/${token}?callbackURL=${encodeURIComponent(`${ORIGIN}/reset`)}`,
      { method: 'GET', headers: { origin: ORIGIN } },
    );
    const location = res.headers.get('location');
    expect(location, `the landing redirects: ${res.status}`).toBeTruthy();
    return new URL(location!).searchParams.get('error');
  };

  /** The code the reset text carries. */
  const requestCode = async (): Promise<string> => {
    const before = texts.length;
    const res = await fire('/phone-number/request-password-reset', { phoneNumber: PHONE });
    expect(res.status, await res.clone().text()).toBe(200);
    await vi.waitFor(() => expect(texts.length).toBe(before + 1));
    const code = String(texts[before].templateParams?.code ?? '');
    expect(code, 'the reset text carries its code').not.toBe('');
    return code;
  };

  const userId = await idOf(EMAIL);
  const admin = await signIn(ADMIN_EMAIL, FIRST);
  expect(admin.bearer, 'the administrator signs in on the bearer lane').toBeTruthy();

  return { engine, manager, fire, signUp, signIn, requestLink, reset, landing, requestCode, userId, adminBearer: admin.bearer! };
}

/** What a link that was never issued answers, at the reset door and at its landing. */
async function neverIssued(s: Awaited<ReturnType<typeof stage>>) {
  const token = 'a-reset-link-never-issued-0000';
  return { reset: await s.reset(token, FOURTH), landing: await s.landing(token) };
}

describe("a completed reset ends the user's other reset links", () => {
  it('the earlier link answers what a link never issued answers, and the password is the one the spent link set', async () => {
    const s = await stage();
    const unknown = await neverIssued(s);
    expect(unknown.reset).toEqual({ status: 400, code: 'INVALID_TOKEN' });
    const earlier = await s.requestLink();
    const later = await s.requestLink();

    expect(await s.reset(later, SECOND)).toEqual({ status: 200 });

    expect(await s.landing(earlier)).toBe(unknown.landing);
    expect(await s.reset(earlier, THIRD)).toEqual(unknown.reset);
    expect((await s.signIn(EMAIL, SECOND)).status).toBe(200);
    expect((await s.signIn(EMAIL, THIRD)).status).not.toBe(200);
  }, 60_000);

  it('the later link answers what a link never issued answers once the earlier one is spent', async () => {
    const s = await stage();
    const unknown = await neverIssued(s);
    const earlier = await s.requestLink();
    const later = await s.requestLink();

    expect(await s.reset(earlier, SECOND)).toEqual({ status: 200 });

    expect(await s.landing(later)).toBe(unknown.landing);
    expect(await s.reset(later, THIRD)).toEqual(unknown.reset);
    expect((await s.signIn(EMAIL, SECOND)).status).toBe(200);
  }, 60_000);
});

describe('a password change ends every reset link outstanding before it', () => {
  it("the user's own /change-password: an earlier link answers what a link never issued answers; a link requested after it resets", async () => {
    const s = await stage();
    const unknown = await neverIssued(s);
    const earlier = await s.requestLink();
    const { bearer } = await s.signIn(EMAIL, FIRST);

    const changed = await s.fire('/change-password', { currentPassword: FIRST, newPassword: SECOND, revokeOtherSessions: true }, bearer);
    expect(changed.status, await changed.clone().text()).toBe(200);

    expect(await s.landing(earlier)).toBe(unknown.landing);
    expect(await s.reset(earlier, THIRD)).toEqual(unknown.reset);
    expect((await s.signIn(EMAIL, SECOND)).status).toBe(200);

    // The control: a link requested after the change resets.
    const fresh = await s.requestLink();
    expect(await s.landing(fresh)).toBeNull();
    expect(await s.reset(fresh, THIRD)).toEqual({ status: 200 });
    expect((await s.signIn(EMAIL, THIRD)).status).toBe(200);
  }, 60_000);

  it("an administrator's /admin/set-user-password: an earlier link answers what a link never issued answers; a link requested after it resets", async () => {
    const s = await stage();
    const unknown = await neverIssued(s);
    const earlier = await s.requestLink();

    const set = await s.fire(
      '/admin/set-user-password',
      { userId: s.userId, newPassword: SECOND, mustChangePassword: false },
      s.adminBearer,
    );
    expect(set.status, await set.clone().text()).toBe(200);

    expect(await s.landing(earlier)).toBe(unknown.landing);
    expect(await s.reset(earlier, THIRD)).toEqual(unknown.reset);
    expect((await s.signIn(EMAIL, SECOND)).status).toBe(200);

    // The control: a link requested after the change resets.
    const fresh = await s.requestLink();
    expect(await s.reset(fresh, THIRD)).toEqual({ status: 200 });
    expect((await s.signIn(EMAIL, THIRD)).status).toBe(200);
  }, 60_000);

  it('a first password set through /set-initial-password: an earlier link answers what a link never issued answers', async () => {
    const s = await stage();
    const unknown = await neverIssued(s);
    const earlier = await s.requestLink();
    const { bearer } = await s.signIn(EMAIL, FIRST);
    // The account as an identity provider leaves one: no local credential.
    const credentials = (await s.engine.find(
      'sys_account',
      { where: { user_id: s.userId, provider_id: 'credential' } },
      SYS,
    )) as Array<{ id: string }>;
    expect(credentials).toHaveLength(1);
    await s.engine.delete('sys_account', { where: { id: credentials[0].id }, context: { isSystem: true } } as never);

    const set = await s.fire('/set-initial-password', { newPassword: SECOND }, bearer);
    expect(set.status, await set.clone().text()).toBe(200);

    expect(await s.reset(earlier, THIRD)).toEqual(unknown.reset);
    expect((await s.signIn(EMAIL, SECOND)).status).toBe(200);
  }, 60_000);

  it("another user's links are untouched by this user's password change", async () => {
    const s = await stage();
    await s.signUp(OTHER_EMAIL, true);
    const others = await s.requestLink(OTHER_EMAIL);
    const mine = await s.requestLink();

    expect(await s.reset(mine, SECOND)).toEqual({ status: 200 });

    expect(await s.reset(others, THIRD)).toEqual({ status: 200 });
    expect((await s.signIn(OTHER_EMAIL, THIRD)).status).toBe(200);
  }, 60_000);
});

describe('a password change ends the texted reset code outstanding before it', () => {
  const phoneStage = async () => {
    const s = await stage({ plugins: { phoneNumber: true }, phoneOtp: { cooldownSeconds: 0 } });
    await s.engine.update('sys_user', { id: s.userId, phone_number: PHONE, phone_number_verified: true }, SYS);
    return s;
  };
  const resetByCode = async (s: Awaited<ReturnType<typeof phoneStage>>, otp: string, newPassword: string) =>
    answer(await s.fire('/phone-number/reset-password', { phoneNumber: PHONE, otp, newPassword }));

  it("the user's own /change-password: an earlier code answers what a code never sent answers; a code requested after it resets", async () => {
    const s = await phoneStage();
    const neverSent = await resetByCode(s, '000000', FOURTH);
    expect(neverSent.status).toBe(400);
    const earlier = await s.requestCode();
    const { bearer } = await s.signIn(EMAIL, FIRST);

    const changed = await s.fire('/change-password', { currentPassword: FIRST, newPassword: SECOND }, bearer);
    expect(changed.status, await changed.clone().text()).toBe(200);

    expect(await resetByCode(s, earlier, THIRD)).toEqual(neverSent);
    expect((await s.signIn(EMAIL, SECOND)).status).toBe(200);

    // The control: a code requested after the change resets.
    const fresh = await s.requestCode();
    expect(await resetByCode(s, fresh, THIRD)).toEqual({ status: 200 });
    expect((await s.signIn(EMAIL, THIRD)).status).toBe(200);
  }, 60_000);

  it('a completed texted-code reset ends the reset links outstanding before it', async () => {
    const s = await phoneStage();
    const unknown = await neverIssued(s);
    const link = await s.requestLink();
    const code = await s.requestCode();

    expect(await resetByCode(s, code, SECOND)).toEqual({ status: 200 });

    expect(await s.reset(link, THIRD)).toEqual(unknown.reset);
    expect((await s.signIn(EMAIL, SECOND)).status).toBe(200);
  }, 60_000);
});

describe('with a secondaryStorage cache, an ended link answers what a link never issued answers', () => {
  it('at the landing and at the reset door, the cache read first', async () => {
    const cache = new Map<string, string>();
    const s = await stage({
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
        increment: async (key: string) => {
          const next = Number(cache.get(key) ?? 0) + 1;
          cache.set(key, String(next));
          return next;
        },
      },
    });
    const unknown = await neverIssued(s);
    const earlier = await s.requestLink();
    expect(cache.has(`verification:reset-password:${earlier}`), 'the link is cached as it is issued').toBe(true);
    const { bearer } = await s.signIn(EMAIL, FIRST);

    const changed = await s.fire('/change-password', { currentPassword: FIRST, newPassword: SECOND }, bearer);
    expect(changed.status, await changed.clone().text()).toBe(200);

    expect(cache.has(`verification:reset-password:${earlier}`)).toBe(false);
    expect(await s.landing(earlier)).toBe(unknown.landing);
    expect(await s.reset(earlier, THIRD)).toEqual(unknown.reset);
  }, 60_000);
});

describe('a password write whose reset tokens cannot be ended does not land', () => {
  it('the old password stands and the outstanding link resets', async () => {
    const s = await stage();
    const earlier = await s.requestLink();
    const { bearer } = await s.signIn(EMAIL, FIRST);

    const remove = s.engine.delete.bind(s.engine);
    const refuse = vi.spyOn(s.engine, 'delete').mockImplementation((async (object: string, ...rest: unknown[]) => {
      if (object === 'sys_verification') throw new Error('store unavailable');
      return (remove as (...a: unknown[]) => unknown)(object, ...rest);
    }) as never);
    const changed = await s.fire('/change-password', { currentPassword: FIRST, newPassword: SECOND }, bearer);
    expect(changed.status).toBeGreaterThanOrEqual(400);
    refuse.mockRestore();

    expect((await s.signIn(EMAIL, FIRST)).status).toBe(200);
    expect((await s.signIn(EMAIL, SECOND)).status).not.toBe(200);
    expect(await s.reset(earlier, THIRD)).toEqual({ status: 200 });
  }, 60_000);
});
