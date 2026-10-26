// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#23152] The identity import's automatic invitation email carries a link
 * that lands on the Console's set-password page.
 *
 * The import requests a password reset for every email-invited row. better-auth
 * writes the request's `redirectTo` into the emailed link as `callbackURL`, and
 * its `GET /reset-password/:token` refuses an EMPTY one: it redirects to
 * `?error=INVALID_TOKEN` although the token itself still redeems. So the link
 * works only when the request names where it lands.
 *
 * Real `ObjectQL` over `@objectstack/driver-sql` + better-sqlite3, the objects
 * from this plugin's own manifest, and a real `AuthManager` (admin plugin on,
 * an `https` origin that is not a localhost one). better-auth's origin check is
 * switched ON here: it defaults to off under a test runner
 * (`skipOriginCheck: isTest()` in better-auth's context), and with it off the
 * landing would never be judged against the trusted origins a deployment has.
 *
 * Pinned:
 *  ① Through the plugin's REAL `POST /admin/import-users` mount, so the one
 *    wiring line in `auth-plugin.ts` is under test (the deps member is
 *    optional, so a missing wiring line compiles): the emailed link's GET lands
 *    on `/_console/reset-password?token=…`, and that token sets the password.
 *    A control GET naming a foreign `callbackURL` is refused, which proves the
 *    origin check judged the landing.
 *  ② `runAdminImportUsers` handed deps WITHOUT `consoleResetPasswordUrl` keeps
 *    today's link, an empty `callbackURL`.
 *
 * Only the platform-admin gate's session read is a stand-in (the
 * `principal-less-producers-system-context.test.ts` shape); the gate has its
 * own suites. Every other manager call reaches the real `AuthManager`.
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
const SECRET = 'test-secret-at-least-32-chars-long-23152';
const SET_PASSWORD_PAGE = `${ORIGIN}/_console/reset-password`;
const ADMIN = { id: 'usr_platform_admin_23152', email: 'admin@acme.example.com' };

type SentMail = { template: string; to: { address: string }; data: Record<string, unknown> };

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

/** A real manager with a capturing email service and the origin check ON. */
async function bootManager(): Promise<{ manager: AuthManager; sent: SentMail[] }> {
  const engine = await bootEngine();
  const manager = new AuthManager({
    secret: SECRET,
    baseUrl: ORIGIN,
    dataEngine: engine as never,
    plugins: { admin: true },
  } as never);
  const sent: SentMail[] = [];
  manager.setEmailService({
    sendTemplate: async (input: SentMail) => {
      sent.push(input);
      return { status: 'sent' };
    },
  } as never);
  const authContext = (await manager.getAuthContext()) as { skipOriginCheck: unknown };
  authContext.skipOriginCheck = false;
  return { manager, sent };
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

/**
 * The plugin's REAL route registration on a real Hono app. Its manager is the
 * real one, with one seam replaced: `getApi()` answers better-auth's real api
 * whose `getSession` reports a platform admin, which is what the gate judges.
 */
async function mountImport(manager: AuthManager): Promise<Hono> {
  const app = new Hono();
  const ctx = mockCtx();
  const plugin = new AuthPlugin({ secret: SECRET, plugins: { oidcProvider: false } });
  await plugin.init(ctx);
  const realApi = await manager.getApi();
  const gated = new Proxy(manager, {
    get(target, key) {
      if (key === 'getApi') {
        return async () => ({ ...realApi, getSession: async () => ({ user: { ...ADMIN, isPlatformAdmin: true } }) });
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

const importBody = (email: string) =>
  JSON.stringify({ format: 'json', mode: 'insert', passwordPolicy: 'auto', rows: [{ email, name: 'Invitee' }] });

/**
 * The invitation email better-auth sent to `address`, once its background send
 * settles. [#23343] It is `auth.account_invitation`, whose link variable is
 * `setPasswordUrl`; the token is the link's last path segment.
 */
async function invitationTo(sent: SentMail[], address: string): Promise<SentMail> {
  await vi.waitFor(() =>
    expect(sent.some((m) => m.template === 'auth.account_invitation' && m.to.address === address)).toBe(true),
  );
  return sent.find((m) => m.template === 'auth.account_invitation' && m.to.address === address)!;
}

const linkOf = (mail: SentMail) => new URL(String(mail.data.setPasswordUrl));
const tokenOf = (mail: SentMail) => linkOf(mail).pathname.split('/').pop()!;

/** GET a link the way a browser follows it, with no redirect followed. */
const follow = (manager: AuthManager, link: string) => manager.handleRequest(new Request(link));

describe('[#23152] the identity import invitation link', () => {
  it('① through the mounted import, lands on the Console set-password page with the origin check on', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { manager, sent } = await bootManager();
    const app = await mountImport(manager);
    const email = 'invitee-mounted@acme.example.com';

    const res = await app.request(`${ORIGIN}${BASE}/admin/import-users`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: ORIGIN },
      body: importBody(email),
    });
    const answer = (await res.json()) as { data?: { rows?: Array<Record<string, unknown>> } };
    expect(res.status, JSON.stringify(answer)).toBe(200);
    expect(answer.data?.rows?.[0]?.delivery).toBe('email');
    expect(answer.data?.rows?.[0]?.code, 'the invitation was requested').toBeUndefined();

    const mail = await invitationTo(sent, email);
    const link = linkOf(mail);
    const token = tokenOf(mail);
    expect(link.origin + link.pathname).toBe(`${ORIGIN}${BASE}/reset-password/${token}`);

    // Where the invitee lands first: before the fix this read
    // `${ORIGIN}${BASE}/error?error=INVALID_TOKEN`.
    const landed = await follow(manager, link.href);
    expect(landed.status).toBe(302);
    expect(landed.headers.get('location')).toBe(`${SET_PASSWORD_PAGE}?token=${token}`);
    expect(link.searchParams.get('callbackURL')).toBe(SET_PASSWORD_PAGE);

    // Control: the same token with a callbackURL on a foreign origin is refused
    // rather than redirected, so the landing above was judged, not waved through.
    const foreign = new URL(link.href);
    foreign.searchParams.set('callbackURL', 'https://elsewhere.example.net/_console/reset-password');
    const refused = await follow(manager, foreign.href);
    expect(refused.status).toBe(403);
    expect(refused.headers.get('location')).toBeNull();

    // The token the page receives sets the invitee's password.
    const reset = await manager.handleRequest(
      new Request(`${ORIGIN}${BASE}/reset-password`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: ORIGIN },
        body: JSON.stringify({ token, newPassword: 'Inv1ted!Passw0rd-23152' }),
      }),
    );
    expect(reset.status, await reset.clone().text()).toBe(200);
  }, 120_000);

  it('② a caller whose deps carry no consoleResetPasswordUrl keeps today\'s link, an empty callbackURL', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { manager, sent } = await bootManager();
    const email = 'invitee-direct@acme.example.com';
    const deps: IdentityImportDeps = {
      getAuthApi: () => manager.getApi(),
      getAuthContext: () => manager.getAuthContext(),
      getDataEngine: () => manager.getDataEngine() as never,
      phoneNumberEnabled: () => manager.isPhoneNumberEnabled(),
      emailServiceAvailable: () => manager.isEmailServiceAvailable(),
      smsInviteAvailable: () => false,
      sendInviteSms: (phone: string) => manager.sendPhoneInviteSms(phone),
      noteMustChangePasswordIssued: () => manager.noteMustChangePasswordIssued(),
    };

    const res = await runAdminImportUsers(
      deps,
      new Request(`${ORIGIN}${BASE}/admin/import-users`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: importBody(email),
      }),
      ADMIN,
    );
    expect(res.status, JSON.stringify(res.body)).toBe(200);

    const mail = await invitationTo(sent, email);
    expect(String(mail.data.setPasswordUrl)).toBe(`${ORIGIN}${BASE}/reset-password/${tokenOf(mail)}?callbackURL=`);
  }, 120_000);
});
