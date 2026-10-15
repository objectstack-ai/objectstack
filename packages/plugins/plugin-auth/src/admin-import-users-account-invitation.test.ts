// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#23343] An imported user is invited with `auth.account_invitation`, and
 * every other password reset still sends `auth.password_reset`.
 *
 * The identity import invites an email row by asking better-auth for a reset
 * on that address, and better-auth hands the link only to `sendResetPassword`.
 * So the import marks its own request (`account-invitation-marker.ts`) and
 * `sendResetPassword` picks the template. These pins drive that on a real
 * stack: real `ObjectQL` over `@objectstack/driver-sql` + better-sqlite3, the
 * objects from this plugin's own manifest, a real `AuthManager` with the
 * origin check ON, and a capturing email service.
 *
 * Pinned:
 *  ① Through the plugin's REAL `POST /admin/import-users` mount: the invitation
 *    names the new account, the inviter as their own `sys_user` row spells
 *    them, the set-password link (whose token really sets the password) and
 *    the token's REAL lifetime, read back off its verification row.
 *  ② NEGATIVE CONTROL: a user-requested `POST /request-password-reset` sends
 *    `auth.password_reset`, and no invitation is sent at all.
 *  ③ After the import, a public reset for the imported address sends
 *    `auth.password_reset`: the marker died with the import's request.
 *  ④ While the import's invitation send is held open INSIDE the marker's
 *    store, a public reset for the very same address runs to completion and
 *    sends `auth.password_reset` (Node: each request has its own store).
 *  ⑤ The stated expiry is the configured TTL, not a constant — and a
 *    configured `0`, which better-auth mints as its 3600 s default, reads 60
 *    on the invitation AND on a user-requested reset.
 *  ⑥ The inviter falls back to the session address when the admin has no
 *    `sys_user` row; with no address at all the row gets the reset copy
 *    rather than an invitation with a hole in it.
 *
 * Only the platform-admin gate's session read is a stand-in on the mounted
 * route (the `admin-import-users-invite-link.test.ts` shape); every other
 * manager call reaches the real `AuthManager`.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { Hono } from 'hono';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import type { PluginContext } from '@objectstack/core';
import { AuthManager } from './auth-manager.js';
import { AuthPlugin } from './auth-plugin.js';
import { authIdentityObjects } from './manifest.js';
import { runAdminImportUsers, type IdentityImportDeps } from './admin-import-users.js';

const ORIGIN = 'https://acme.example.com';
const BASE = '/api/v1/auth';
const SECRET = 'test-secret-at-least-32-chars-long-23343';
const SET_PASSWORD_PAGE = `${ORIGIN}/_console/reset-password`;
const APP_NAME = 'Acme Cloud';
const ADMIN_EMAIL = 'ada.admin@acme.example.com';
const ADMIN_NAME = 'Ada Admin';

type SentMail = { template: string; to: { address: string }; locale?: string; data: Record<string, any> };

const engines: ObjectQL[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  while (engines.length) {
    try {
      await (engines.pop() as unknown as { destroy?(): Promise<void> })?.destroy?.();
    } catch {
      /* noop */
    }
  }
});

async function bootEngine(): Promise<ObjectQL> {
  const engine = new ObjectQL();
  engines.push(engine);
  engine.registerDriver(
    new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true }),
    true,
  );
  await engine.init();
  for (const object of authIdentityObjects) engine.registry.registerObject(object as never, '@objectstack/plugin-auth');
  await engine.syncSchemas();
  return engine;
}

interface Booted {
  manager: AuthManager;
  sent: SentMail[];
  /**
   * Hold every `auth.account_invitation` send until `release()`; `entered`
   * resolves once one is parked — inside the import's marker store.
   */
  holdInvitations(): { entered: Promise<void>; release: () => void };
}

/** A real manager with a capturing email service and the origin check ON. */
async function bootManager(emailAndPassword?: Record<string, unknown>): Promise<Booted> {
  const engine = await bootEngine();
  const manager = new AuthManager({
    secret: SECRET,
    baseUrl: ORIGIN,
    dataEngine: engine as never,
    plugins: { admin: true },
    ...(emailAndPassword ? { emailAndPassword } : {}),
  } as never);
  manager.setAppName(APP_NAME);
  const sent: SentMail[] = [];
  let gate: Promise<void> | undefined;
  let onEntered: (() => void) | undefined;
  manager.setEmailService({
    sendTemplate: async (input: SentMail) => {
      if (input.template === 'auth.account_invitation' && gate) {
        onEntered?.();
        await gate;
      }
      sent.push(input);
      return { status: 'sent' };
    },
  } as never);
  const authContext = (await manager.getAuthContext()) as { skipOriginCheck: unknown };
  authContext.skipOriginCheck = false;
  return {
    manager,
    sent,
    holdInvitations() {
      let open!: () => void;
      gate = new Promise<void>((resolve) => { open = resolve; });
      const entered = new Promise<void>((resolve) => { onEntered = resolve; });
      return { entered, release: () => { gate = undefined; open(); } };
    },
  };
}

/** A real platform-admin row, so the invitation can name its inviter the way `sys_user` does. */
async function createAdmin(manager: AuthManager): Promise<{ id: string; email: string }> {
  const api = (await manager.getApi()) as any;
  const created = await api.createUser({ body: { email: ADMIN_EMAIL, name: ADMIN_NAME, password: 'Adm1n!Passw0rd-23343' } });
  return { id: String(created.user.id), email: ADMIN_EMAIL };
}

const mockCtx = (): PluginContext =>
  ({
    registerService: vi.fn(),
    getService: vi.fn((name: string) => (name === 'manifest' ? { register: vi.fn() } : undefined)),
    getServices: vi.fn(() => new Map()),
    hook: vi.fn(),
    trigger: vi.fn(),
    logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
    getKernel: vi.fn(),
  }) as unknown as PluginContext;

/** The plugin's REAL route registration; only the gate's session read is a stand-in. */
async function mountImport(manager: AuthManager, admin: { id: string; email: string }): Promise<Hono> {
  const app = new Hono();
  const ctx = mockCtx();
  const plugin = new AuthPlugin({ secret: SECRET, plugins: { oidcProvider: false } });
  await plugin.init(ctx);
  const realApi = await manager.getApi();
  const gated = new Proxy(manager, {
    get(target, key) {
      if (key === 'getApi') {
        return async () => ({ ...realApi, getSession: async () => ({ user: { ...admin, isPlatformAdmin: true } }) });
      }
      const value = Reflect.get(target, key, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
  (plugin as unknown as { authManager: unknown }).authManager = gated;
  (plugin as unknown as {
    registerAuthRoutes(server: unknown, ctx: PluginContext): void;
  }).registerAuthRoutes({ getRawApp: () => app, getPort: () => 0 }, ctx);
  return app;
}

const importBody = (email: string, name = 'Invitee') =>
  JSON.stringify({ format: 'json', mode: 'insert', passwordPolicy: 'auto', rows: [{ email, name }] });

async function importThroughMount(app: Hono, email: string): Promise<void> {
  const res = await app.request(`${ORIGIN}${BASE}/admin/import-users`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: ORIGIN },
    body: importBody(email),
  });
  const answer = (await res.json()) as { data?: { rows?: Array<Record<string, unknown>> } };
  expect(res.status, JSON.stringify(answer)).toBe(200);
  expect(answer.data?.rows?.[0]?.delivery).toBe('email');
  expect(answer.data?.rows?.[0]?.code, 'the invitation was requested').toBeUndefined();
}

/** Deps for calling the import directly (no mount), as the invite-link file's ② does. */
const directDeps = (manager: AuthManager, logger?: IdentityImportDeps['logger']): IdentityImportDeps => ({
  getAuthApi: () => manager.getApi(),
  getDataEngine: () => manager.getDataEngine() as never,
  phoneNumberEnabled: () => manager.isPhoneNumberEnabled(),
  emailServiceAvailable: () => manager.isEmailServiceAvailable(),
  smsInviteAvailable: () => false,
  sendInviteSms: (phone: string) => manager.sendPhoneInviteSms(phone),
  consoleResetPasswordUrl: () => manager.getConsoleUrl('/reset-password'),
  noteMustChangePasswordIssued: () => manager.noteMustChangePasswordIssued(),
  ...(logger ? { logger } : {}),
});

async function importDirect(manager: AuthManager, actor: { id: string; email?: string }, email: string, logger?: IdentityImportDeps['logger']) {
  const res = await runAdminImportUsers(
    directDeps(manager, logger),
    new Request(`${ORIGIN}${BASE}/admin/import-users`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: importBody(email),
    }),
    actor,
  );
  expect(res.status, JSON.stringify(res.body)).toBe(200);
}

/** A user-requested reset through the public door — what `forget password` sends. */
async function publicReset(manager: AuthManager, email: string): Promise<void> {
  const res = await manager.handleRequest(
    new Request(`${ORIGIN}${BASE}/request-password-reset`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: ORIGIN },
      body: JSON.stringify({ email, redirectTo: SET_PASSWORD_PAGE }),
    }),
  );
  expect(res.status, await res.clone().text()).toBe(200);
}

const mailsTo = (sent: SentMail[], address: string, template: string) =>
  sent.filter((m) => m.template === template && m.to.address === address);

async function mailTo(sent: SentMail[], address: string, template: string): Promise<SentMail> {
  await vi.waitFor(() => expect(mailsTo(sent, address, template).length).toBeGreaterThan(0));
  return mailsTo(sent, address, template)[0]!;
}

/** The token a better-auth reset link carries in its path. */
const tokenOf = (link: string) => new URL(link).pathname.split('/').pop()!;

/** Seconds the token's verification row really lives, measured from now. */
async function tokenLifetimeSec(manager: AuthManager, token: string): Promise<number> {
  const ctx = (await manager.getAuthContext()) as any;
  const row = await ctx.internalAdapter.findVerificationValue(`reset-password:${token}`);
  expect(row, 'the reset token has a verification row').toBeTruthy();
  return (new Date(row.expiresAt).getTime() - Date.now()) / 1000;
}

describe('[#23343] the identity import invites with auth.account_invitation', () => {
  it('① through the mounted import: the new account, its inviter, the set-password link and its real expiry', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { manager, sent } = await bootManager();
    const admin = await createAdmin(manager);
    const app = await mountImport(manager, admin);
    const email = 'invitee-23343@acme.example.com';

    await importThroughMount(app, email);

    const mail = await mailTo(sent, email, 'auth.account_invitation');
    const link = String(mail.data.setPasswordUrl);
    const token = tokenOf(link);
    // Exactly the variables the template declares — nothing the import does not hold.
    expect(mail.data).toEqual({
      user: { name: 'Invitee', email },
      inviter: { name: ADMIN_NAME, email: ADMIN_EMAIL },
      setPasswordUrl: `${ORIGIN}${BASE}/reset-password/${token}?callbackURL=${encodeURIComponent(SET_PASSWORD_PAGE)}`,
      expiresInMinutes: 60,
      appName: APP_NAME,
    });
    expect(mail.to.address).toBe(email);
    // No reset copy reached this address.
    expect(mailsTo(sent, email, 'auth.password_reset')).toHaveLength(0);

    // The stated expiry is the token's own: better-auth's default 3600 s.
    const lifetime = await tokenLifetimeSec(manager, token);
    expect(Math.abs(lifetime - 3600)).toBeLessThan(120);

    // The link lands on the set-password page, and its token sets the password.
    const landed = await manager.handleRequest(new Request(link));
    expect(landed.status).toBe(302);
    expect(landed.headers.get('location')).toBe(`${SET_PASSWORD_PAGE}?token=${token}`);
    const set = await manager.handleRequest(
      new Request(`${ORIGIN}${BASE}/reset-password`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: ORIGIN },
        body: JSON.stringify({ token, newPassword: 'Inv1ted!Passw0rd-23343' }),
      }),
    );
    expect(set.status, await set.clone().text()).toBe(200);
  }, 120_000);

  it('② NEGATIVE CONTROL: a user-requested reset still sends auth.password_reset, and no invitation', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { manager, sent } = await bootManager();
    await createAdmin(manager);

    await publicReset(manager, ADMIN_EMAIL);

    const mail = await mailTo(sent, ADMIN_EMAIL, 'auth.password_reset');
    expect(mail.data.resetUrl).toContain(`${ORIGIN}${BASE}/reset-password/`);
    expect(mail.data.expiresInMinutes).toBe(60);
    expect(sent.filter((m) => m.template === 'auth.account_invitation')).toHaveLength(0);
  }, 120_000);

  it('③ after the import, a public reset for the imported address sends auth.password_reset', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { manager, sent } = await bootManager();
    const admin = await createAdmin(manager);
    const app = await mountImport(manager, admin);
    const email = 'invitee-then-reset@acme.example.com';

    await importThroughMount(app, email);
    await mailTo(sent, email, 'auth.account_invitation');
    await publicReset(manager, email);

    await mailTo(sent, email, 'auth.password_reset');
    expect(mailsTo(sent, email, 'auth.account_invitation')).toHaveLength(1);
    expect(mailsTo(sent, email, 'auth.password_reset')).toHaveLength(1);
  }, 120_000);

  it('④ while the invitation send is held inside the marker, a public reset for the same address sends auth.password_reset', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const booted = await bootManager();
    const { manager, sent } = booted;
    const admin = await createAdmin(manager);
    const app = await mountImport(manager, admin);
    const email = 'invitee-concurrent@acme.example.com';

    const { entered, release } = booted.holdInvitations();
    const importing = importThroughMount(app, email);
    // The import's request is now parked inside its marker store, mid-send.
    await entered;
    await publicReset(manager, email);
    const publicMail = await mailTo(sent, email, 'auth.password_reset');
    expect(publicMail.data.resetUrl).toBeDefined();
    expect(mailsTo(sent, email, 'auth.account_invitation')).toHaveLength(0);

    release();
    await importing;
    await mailTo(sent, email, 'auth.account_invitation');
    expect(mailsTo(sent, email, 'auth.account_invitation')).toHaveLength(1);
    expect(mailsTo(sent, email, 'auth.password_reset')).toHaveLength(1);
  }, 120_000);

  it('⑤ the expiry is the configured TTL; a configured 0 is better-auth\'s 3600 s default on both sends', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    const thirty = await bootManager({ resetPasswordTokenExpiresIn: 1800 });
    const admin30 = await createAdmin(thirty.manager);
    await importDirect(thirty.manager, admin30, 'ttl-1800@acme.example.com');
    const mail30 = await mailTo(thirty.sent, 'ttl-1800@acme.example.com', 'auth.account_invitation');
    expect(mail30.data.expiresInMinutes).toBe(30);
    expect(Math.abs((await tokenLifetimeSec(thirty.manager, tokenOf(mail30.data.setPasswordUrl))) - 1800)).toBeLessThan(120);

    const zero = await bootManager({ resetPasswordTokenExpiresIn: 0 });
    const admin0 = await createAdmin(zero.manager);
    await importDirect(zero.manager, admin0, 'ttl-0@acme.example.com');
    const mail0 = await mailTo(zero.sent, 'ttl-0@acme.example.com', 'auth.account_invitation');
    expect(Math.abs((await tokenLifetimeSec(zero.manager, tokenOf(mail0.data.setPasswordUrl))) - 3600)).toBeLessThan(120);
    expect(mail0.data.expiresInMinutes).toBe(60);
    await publicReset(zero.manager, ADMIN_EMAIL);
    const reset0 = await mailTo(zero.sent, ADMIN_EMAIL, 'auth.password_reset');
    expect(reset0.data.expiresInMinutes).toBe(60);
  }, 120_000);

  it('⑥ the inviter falls back to the session address; with no address at all the row gets the reset copy', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { manager, sent } = await bootManager();

    // An actor with no sys_user row: named by the address the gate carried.
    await importDirect(manager, { id: 'usr_absent_23343', email: 'gate@acme.example.com' }, 'fallback@acme.example.com');
    const mail = await mailTo(sent, 'fallback@acme.example.com', 'auth.account_invitation');
    expect(mail.data.inviter).toEqual({ name: 'gate@acme.example.com', email: 'gate@acme.example.com' });

    // No address anywhere: no invitation with a hole — the reset copy, said once.
    const warn = vi.fn();
    await importDirect(manager, { id: 'usr_nameless_23343' }, 'no-inviter@acme.example.com', { warn });
    await mailTo(sent, 'no-inviter@acme.example.com', 'auth.password_reset');
    expect(mailsTo(sent, 'no-inviter@acme.example.com', 'auth.account_invitation')).toHaveLength(0);
    expect(warn.mock.calls.some(([m]) => String(m).includes('has no email address'))).toBe(true);
  }, 120_000);
});
