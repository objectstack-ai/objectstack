// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#23598] A user import reports an invitation it could not deliver.
 *
 * The import invites an email row by asking better-auth for a password reset,
 * and better-auth runs `sendResetPassword` through `runInBackgroundOrAwait`,
 * which catches and logs whatever the send throws and still answers
 * `{ status: true }` (better-auth 1.7.12, `dist/context/create-context.mjs`,
 * re-measured 2026-10-21 for #25096). So a
 * throw inside the send can never reach the import. `sendResetPassword` now
 * settles a delivery receipt the import's own request carries
 * (`account-invitation-marker.ts`), and the import reads it after the request
 * returns.
 *
 * Real stack: `ObjectQL` over `@objectstack/driver-sql` + better-sqlite3, the
 * objects from this plugin's manifest, a real `AuthManager` with the origin
 * check ON, and an email service whose answer is chosen per recipient. Only the
 * platform-admin gate's session read is a stand-in on the mounted route.
 *
 * Pinned:
 *  ① Through the plugin's REAL `POST /admin/import-users` mount, a transport
 *    that ANSWERS `failed`: the row is not ok, carries no `delivery`, names
 *    `INVITE_EMAIL_FAILED` and the transport's reason, and `summary.errors`
 *    counts it. The account itself was created.
 *  ② The same through a transport that THROWS.
 *  ③ NEGATIVE CONTROL: a transport that answers `sent` (and one that answers
 *    `queued`) is reported as today: `delivery: 'email'`, no code, no error.
 *  ④ One batch, a failing and a succeeding recipient: each row gets its own
 *    verdict, so the receipt is per row.
 *  ⑤ The row whose inviter cannot be named (no invitation marker, the reset
 *    copy) is reported failed the same way: the receipt does not ride the
 *    invitation marker.
 *  ⑥ A public `POST /request-password-reset` through a failing transport
 *    answers exactly what it answers through a succeeding one, and what it
 *    answers for an address with no account.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { Hono } from 'hono';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import type { PluginContext } from '@objectstack/core';
import { AuthManager } from './auth-manager.js';
import { AuthPlugin } from './auth-plugin.js';
import { authIdentityObjects } from './manifest.js';
import { runAdminImportUsers } from './admin-import-users.js';

const ORIGIN = 'https://acme.example.com';
const BASE = '/api/v1/auth';
const SECRET = 'test-secret-at-least-32-chars-long-23598';
const ADMIN_EMAIL = 'ada.admin@acme.example.com';
const REFUSAL = '550 5.1.1 mailbox unavailable';
const OUTAGE = 'connect ECONNREFUSED 10.0.0.25:587';

type Answer = 'sent' | 'queued' | 'failed' | 'throws';
type SentMail = { template: string; to: { address: string } };
type Row = Record<string, unknown>;
type ImportAnswer = { rows: Row[]; summary: Record<string, any> };

/** How the email service answers each recipient; unlisted addresses are `sent`. */
const answers = new Map<string, Answer>();
const attempts: SentMail[] = [];

let engine: ObjectQL;
let manager: AuthManager;
let app: Hono;

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

beforeAll(async () => {
  // better-auth logs the swallowed send failure; the assertions are on the answer.
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});

  engine = new ObjectQL();
  engine.registerDriver(
    new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true }),
    true,
  );
  await engine.init();
  for (const object of authIdentityObjects) engine.registry.registerObject(object as never, '@objectstack/plugin-auth');
  await engine.syncSchemas();

  manager = new AuthManager({
    secret: SECRET,
    baseUrl: ORIGIN,
    dataEngine: engine as never,
    plugins: { admin: true },
  } as never);
  manager.setEmailService({
    sendTemplate: async (input: SentMail) => {
      attempts.push(input);
      const answer = answers.get(input.to.address) ?? 'sent';
      if (answer === 'throws') throw new Error(OUTAGE);
      if (answer === 'failed') return { id: 'em_failed', status: 'failed', error: REFUSAL };
      return { id: 'em_ok', status: answer };
    },
  } as never);
  const authContext = (await manager.getAuthContext()) as { skipOriginCheck: unknown };
  authContext.skipOriginCheck = false;

  const realApi = (await manager.getApi()) as any;
  const created = await realApi.createUser({
    body: { email: ADMIN_EMAIL, name: 'Ada Admin', password: 'Adm1n!Passw0rd-23598' },
  });
  const admin = { id: String(created.user.id), email: ADMIN_EMAIL };

  // The plugin's REAL route registration; only the gate's session read is a stand-in.
  app = new Hono();
  const ctx = mockCtx();
  const plugin = new AuthPlugin({ secret: SECRET, plugins: { oidcProvider: false } });
  await plugin.init(ctx);
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
}, 120_000);

afterAll(async () => {
  vi.restoreAllMocks();
  try {
    await (engine as unknown as { destroy?(): Promise<void> })?.destroy?.();
  } catch {
    /* noop */
  }
});

const importBody = (emails: string[], passwordPolicy: 'invite' | 'auto' = 'invite') =>
  JSON.stringify({
    format: 'json',
    mode: 'insert',
    passwordPolicy,
    rows: emails.map((email, i) => ({ email, name: `Invitee ${i + 1}` })),
  });

async function importThroughMount(emails: string[], passwordPolicy: 'invite' | 'auto' = 'invite'): Promise<ImportAnswer> {
  const res = await app.request(`${ORIGIN}${BASE}/admin/import-users`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: ORIGIN },
    body: importBody(emails, passwordPolicy),
  });
  const answer = (await res.json()) as { data?: ImportAnswer };
  expect(res.status, JSON.stringify(answer)).toBe(200);
  return answer.data!;
}

/** The account the import created, read back off `sys_user`. */
async function userRow(email: string): Promise<Row | undefined> {
  const found = await engine.find('sys_user', { where: { email }, limit: 1, context: { isSystem: true } } as never);
  return (found as Row[])[0];
}

function expectDeliveryFailed(row: Row, reason: string): void {
  expect(row.delivery, 'nothing was delivered').toBeUndefined();
  expect(row.code).toBe('INVITE_EMAIL_FAILED');
  expect(String(row.error)).toContain(reason);
  expect(row.ok, 'the invitation the administrator asked for did not happen').toBe(false);
  expect(row.action, 'the account was created').toBe('created');
  expect(row.id).toEqual(expect.any(String));
}

function expectDelivered(row: Row): void {
  expect(row.action).toBe('created');
  expect(row.ok).toBe(true);
  expect(row.delivery).toBe('email');
  expect(row.code).toBeUndefined();
  expect(row.error).toBeUndefined();
}

describe('[#23598] the import reports an invitation the email transport did not deliver', () => {
  it('① a transport that answers failed: the row is failed, not delivered, and summary.errors counts it', async () => {
    const email = 'answers-failed@acme.example.com';
    answers.set(email, 'failed');

    const { rows, summary } = await importThroughMount([email]);

    // The send really was attempted, with the invitation copy.
    expect(attempts.filter((m) => m.to.address === email).map((m) => m.template)).toEqual(['auth.account_invitation']);
    expectDeliveryFailed(rows[0]!, REFUSAL);
    expect(summary.created).toBe(1);
    expect(summary.errors).toBe(1);
    expect(summary.delivery).toEqual({ emailInvite: 0, smsInvite: 0, temporary: 0 });
    expect(await userRow(email), 'not a rollback: the account exists').toBeTruthy();
  }, 60_000);

  it('② a transport that throws: the same verdict', async () => {
    const email = 'throws@acme.example.com';
    answers.set(email, 'throws');

    const { rows, summary } = await importThroughMount([email], 'auto');

    expect(attempts.filter((m) => m.to.address === email)).toHaveLength(1);
    expectDeliveryFailed(rows[0]!, OUTAGE);
    // `auto` does not quietly downgrade a failed invitation to a temporary password.
    expect(rows[0]!.temporaryPassword).toBeUndefined();
    expect(summary.errors).toBe(1);
    expect(summary.delivery.emailInvite).toBe(0);
  }, 60_000);

  it('③ NEGATIVE CONTROL: a transport that answers sent or queued is reported as today', async () => {
    const sent = 'answers-sent@acme.example.com';
    const queued = 'answers-queued@acme.example.com';
    answers.set(queued, 'queued');

    const { rows, summary } = await importThroughMount([sent, queued]);

    expectDelivered(rows[0]!);
    expectDelivered(rows[1]!);
    expect(summary.created).toBe(2);
    expect(summary.errors).toBe(0);
    expect(summary.delivery).toEqual({ emailInvite: 2, smsInvite: 0, temporary: 0 });
  }, 60_000);

  it('④ one batch, a failing and a succeeding recipient: each row carries its own verdict', async () => {
    const failing = 'batch-failing@acme.example.com';
    const fine = 'batch-fine@acme.example.com';
    answers.set(failing, 'failed');

    const { rows, summary } = await importThroughMount([fine, failing]);

    expectDelivered(rows[0]!);
    expectDeliveryFailed(rows[1]!, REFUSAL);
    expect(summary.created).toBe(2);
    expect(summary.errors).toBe(1);
    expect(summary.delivery.emailInvite).toBe(1);
  }, 60_000);

  it('⑤ a row sent the reset copy (no nameable inviter) is reported failed the same way', async () => {
    const email = 'no-inviter-failing@acme.example.com';
    answers.set(email, 'failed');

    const res = await runAdminImportUsers(
      {
        getAuthApi: () => manager.getApi(),
        getAuthContext: () => manager.getAuthContext(),
        getDataEngine: () => manager.getDataEngine() as never,
        phoneNumberEnabled: () => false,
        emailServiceAvailable: () => manager.isEmailServiceAvailable(),
        smsInviteAvailable: () => false,
        sendInviteSms: async () => {},
        noteMustChangePasswordIssued: () => {},
        logger: { warn: () => {} },
      },
      new Request(`${ORIGIN}${BASE}/admin/import-users`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: importBody([email]),
      }),
      // An actor with no address anywhere: no invitation marker is set.
      { id: 'usr_nameless_23598' },
    );

    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const data = res.body.data as ImportAnswer;
    expect(attempts.filter((m) => m.to.address === email).map((m) => m.template)).toEqual(['auth.password_reset']);
    expectDeliveryFailed(data.rows[0]!, REFUSAL);
    expect(data.summary.errors).toBe(1);
  }, 60_000);

  it('⑥ a public reset through a failing transport answers exactly as through a succeeding one', async () => {
    const failing = 'public-failing@acme.example.com';
    const fine = 'public-fine@acme.example.com';
    const api = (await manager.getApi()) as any;
    for (const email of [failing, fine]) {
      await api.createUser({ body: { email, name: 'Public', password: 'Pub1ic!Passw0rd-23598' } });
    }
    answers.set(failing, 'failed');

    const publicReset = async (email: string) => {
      const res = await manager.handleRequest(
        new Request(`${ORIGIN}${BASE}/request-password-reset`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', origin: ORIGIN },
          body: JSON.stringify({ email }),
        }),
      );
      return { status: res.status, body: await res.text() };
    };

    const throughFailing = await publicReset(failing);
    const throughFine = await publicReset(fine);
    const noAccount = await publicReset('nobody-23598@acme.example.com');

    expect(throughFailing.status).toBe(200);
    expect(JSON.parse(throughFailing.body)).toEqual({
      status: true,
      message: 'If this email exists in our system, check your email for the reset link',
    });
    // No new error surface, and the answer says nothing about whether the
    // address has an account or whether its mail went out.
    expect(throughFailing).toEqual(throughFine);
    expect(throughFailing).toEqual(noAccount);
    // Both sends really ran, with the reset copy.
    expect(attempts.filter((m) => m.to.address === failing).map((m) => m.template)).toEqual(['auth.password_reset']);
    expect(attempts.filter((m) => m.to.address === fine).map((m) => m.template)).toEqual(['auth.password_reset']);
  }, 60_000);
});
