// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// A refused password sign-in and an account lockout each hand the audit sink
// one account event, as a successful sign-in hands it a `login`.
//
// ## Why the server here is the real one
//
// The invariant is about what a sign-in leaves behind, so every case drives a
// real `AuthManager` over the in-memory engine this package's better-auth
// suites share, through `AuthManager.handleRequest`, and reads what the audit
// sink was handed. The sink is a recording spy: the row it turns an event into
// is `@objectstack/plugin-audit`'s concern, pinned in its own
// `auth-event-audit.test.ts`.
//
// ## The three halves
//
//  - A refused sign-in → one `login_failed` naming the account, the refusal's
//    machine code, and the client fingerprint read by the rule a `login`
//    event's fingerprint comes from; never the attempted password.
//  - The refusal that reaches the lockout threshold → one `account_locked`.
//  - A successful sign-in → `login`, exactly as before, and no account event.

import { describe, it, expect, afterAll } from 'vitest';
import { AuthManager } from './auth-manager';
import { createMemoryEngine } from './impersonation-bearer-rotation.test';
import { inviteForAudienceGate } from './audience-gate-test-support';
import { memoizeScrypt } from './__tests__/scrypt-memo.testkit';
import type { AuthSessionAuditEventInput } from './auth-session-audit';

const scrypt = memoizeScrypt();
afterAll(scrypt.restore);

const SECRET = 'test-secret-at-least-32-chars-long!!';
const BASE = 'http://localhost:3000/api/v1/auth';
const EMAIL = 'holder.account-audit@example.com';
const PASSWORD = 'Corr3ct!Horse-Battery';
/** The attempted password of every refused case. No part of it may reach the sink. */
const WRONG_PASSWORD = 'Wr0ng!Guess-Zebra-7731';
const CLIENT_IP = '203.0.113.9';
const CLIENT_UA = 'Mozilla/5.0 (account-audit probe)';

function deployment(config: Record<string, unknown> = {}) {
  const engine = createMemoryEngine();
  const events: AuthSessionAuditEventInput[] = [];
  const manager = new AuthManager({
    secret: SECRET,
    baseUrl: 'http://localhost:3000',
    dataEngine: engine,
    getAuditSink: () => ({
      recordAuthEvent: async (event: AuthSessionAuditEventInput) => {
        events.push(event);
      },
    }),
    ...config,
  } as any);
  return { engine, manager, events };
}

const post = (manager: AuthManager, path: string, body: unknown) =>
  manager.handleRequest(
    new Request(`${BASE}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-forwarded-for': CLIENT_IP,
        'user-agent': CLIENT_UA,
      },
      body: JSON.stringify(body),
    }),
  );

async function signUp(manager: AuthManager): Promise<void> {
  inviteForAudienceGate(manager, EMAIL);
  const res = await post(manager, '/sign-up/email', { email: EMAIL, password: PASSWORD, name: 'Holder' });
  expect(res.status, await res.clone().text()).toBe(200);
}

const signIn = (manager: AuthManager, email: string, password: string) =>
  post(manager, '/sign-in/email', { email, password });

function userIdFor(engine: any): string {
  const row = ((engine.tables.get('sys_user') ?? []) as any[]).find((r) => r.email === EMAIL);
  if (!row) throw new Error(`no sys_user row for ${EMAIL}`);
  return String(row.id);
}

/** The account events, in order — `login` / `logout` filtered out. */
const accountEvents = (events: AuthSessionAuditEventInput[]) =>
  events.filter((e) => e.action === 'login_failed' || e.action === 'account_locked');

/** No credential material anywhere in what the sink was handed. */
function expectNoPasswordMaterial(events: AuthSessionAuditEventInput[]): void {
  const serialized = JSON.stringify(events);
  for (const fragment of [
    WRONG_PASSWORD,
    PASSWORD,
    WRONG_PASSWORD.slice(0, 8),
    WRONG_PASSWORD.slice(-8),
    PASSWORD.slice(0, 8),
    PASSWORD.slice(-8),
  ]) {
    expect(serialized).not.toContain(fragment);
  }
  const allowed = ['action', 'userId', 'ipAddress', 'userAgent', 'context'];
  for (const event of accountEvents(events)) {
    expect(
      Object.keys(event).filter((k) => !allowed.includes(k)),
      'an account event carries only the account, the outcome and the client fingerprint',
    ).toEqual([]);
    expect(
      Object.keys(event.context ?? {}).filter((k) => !['endpoint', 'reason', 'locked_until', 'threshold'].includes(k)),
      'an account event context carries only the endpoint, the refusal code and the lock',
    ).toEqual([]);
  }
}

describe('a refused password sign-in records one login_failed event for the account it named', () => {
  it('names the account, the refusal code and the client, and carries no password material', async () => {
    const { engine, manager, events } = deployment();
    await signUp(manager);
    events.length = 0;

    const res = await signIn(manager, EMAIL, WRONG_PASSWORD);
    expect(res.status).toBe(401);

    const recorded = accountEvents(events);
    expect(recorded).toHaveLength(1);
    expect(recorded[0]).toEqual({
      action: 'login_failed',
      userId: userIdFor(engine),
      ipAddress: CLIENT_IP,
      userAgent: CLIENT_UA,
      context: { endpoint: '/sign-in/email', reason: 'INVALID_EMAIL_OR_PASSWORD' },
    });
    expectNoPasswordMaterial(events);
  });

  it('its client fingerprint is the one a login event for the same client carries', async () => {
    const { manager, events } = deployment();
    await signUp(manager);
    events.length = 0;

    expect((await signIn(manager, EMAIL, WRONG_PASSWORD)).status).toBe(401);
    expect((await signIn(manager, EMAIL, PASSWORD)).status).toBe(200);

    const failed = events.find((e) => e.action === 'login_failed');
    const login = events.find((e) => e.action === 'login');
    expect(failed, 'no login_failed event').toBeDefined();
    expect(login, 'no login event').toBeDefined();
    expect(failed!.ipAddress).toBe(login!.ipAddress);
    expect(failed!.userAgent).toBe(login!.userAgent);
  });

  it('is recorded whether or not a lockout threshold is configured', async () => {
    const { manager, events } = deployment({ lockoutThreshold: 0 });
    await signUp(manager);
    events.length = 0;

    expect((await signIn(manager, EMAIL, WRONG_PASSWORD)).status).toBe(401);
    expect(accountEvents(events).map((e) => e.action)).toEqual(['login_failed']);
  });

  it('names the account the credential check resolved, whatever the letter case of the address', async () => {
    const { engine, manager, events } = deployment();
    await signUp(manager);
    events.length = 0;

    expect((await signIn(manager, EMAIL.toUpperCase(), WRONG_PASSWORD)).status).toBe(401);
    const recorded = accountEvents(events);
    expect(recorded).toHaveLength(1);
    expect(recorded[0]!.userId).toBe(userIdFor(engine));
  });

  it('an identifier that resolves to no account records nothing, and is never handed to the sink', async () => {
    const { manager, events } = deployment();
    await signUp(manager);
    events.length = 0;

    const unknown = 'nobody.account-audit@example.com';
    expect((await signIn(manager, unknown, WRONG_PASSWORD)).status).toBe(401);
    // An identifier that is not an address at all is refused before any account
    // is looked up; it must not reach the ledger either.
    expect((await signIn(manager, WRONG_PASSWORD, WRONG_PASSWORD)).status).toBe(400);

    expect(accountEvents(events)).toEqual([]);
    expect(JSON.stringify(events)).not.toContain(unknown);
    expectNoPasswordMaterial(events);
  });
});

describe('reaching the lockout threshold records one account_locked event', () => {
  it('the refusal that stamps the lock records login_failed and then account_locked', async () => {
    const { engine, manager, events } = deployment({ lockoutThreshold: 3, lockoutDurationMinutes: 15 });
    await signUp(manager);
    events.length = 0;

    for (let i = 0; i < 3; i++) expect((await signIn(manager, EMAIL, WRONG_PASSWORD)).status).toBe(401);

    const recorded = accountEvents(events);
    expect(recorded.map((e) => e.action)).toEqual([
      'login_failed',
      'login_failed',
      'login_failed',
      'account_locked',
    ]);
    const locked = recorded[3]!;
    expect(locked.userId).toBe(userIdFor(engine));
    expect(locked.ipAddress).toBe(CLIENT_IP);
    expect(locked.context?.endpoint).toBe('/sign-in/email');
    expect(locked.context?.threshold).toBe(3);
    const until = new Date(String(locked.context?.locked_until)).getTime();
    expect(until).toBeGreaterThan(Date.now() + 14 * 60_000);
    // The lock the event reports is the lock the account holds.
    const row = ((engine.tables.get('sys_user') ?? []) as any[]).find((r) => r.email === EMAIL);
    expect(new Date(row.locked_until).getTime()).toBe(until);
    expectNoPasswordMaterial(events);
  });

  it('a sign-in refused while locked records login_failed with the lock as its reason, and no second lock', async () => {
    const { engine, manager, events } = deployment({ lockoutThreshold: 3 });
    await signUp(manager);
    for (let i = 0; i < 3; i++) await signIn(manager, EMAIL, WRONG_PASSWORD);
    events.length = 0;

    // Refused by the lock even with the right password.
    const res = await signIn(manager, EMAIL, PASSWORD);
    expect(res.status).toBe(403);

    expect(accountEvents(events)).toEqual([
      {
        action: 'login_failed',
        userId: userIdFor(engine),
        ipAddress: CLIENT_IP,
        userAgent: CLIENT_UA,
        context: { endpoint: '/sign-in/email', reason: 'ACCOUNT_LOCKED' },
      },
    ]);
    expect(events.some((e) => e.action === 'login')).toBe(false);
    expectNoPasswordMaterial(events);
  });

  it('refusals below the threshold record no account_locked', async () => {
    const { manager, events } = deployment({ lockoutThreshold: 3 });
    await signUp(manager);
    events.length = 0;

    for (let i = 0; i < 2; i++) await signIn(manager, EMAIL, WRONG_PASSWORD);
    expect(accountEvents(events).map((e) => e.action)).toEqual(['login_failed', 'login_failed']);
  });
});

describe('a successful sign-in is recorded as before', () => {
  it('records login and no account event', async () => {
    const { engine, manager, events } = deployment({ lockoutThreshold: 3 });
    await signUp(manager);
    events.length = 0;

    expect((await signIn(manager, EMAIL, PASSWORD)).status).toBe(200);

    expect(accountEvents(events)).toEqual([]);
    const logins = events.filter((e) => e.action === 'login');
    expect(logins).toHaveLength(1);
    expect(logins[0]!.userId).toBe(userIdFor(engine));
    expect(logins[0]!.context).toEqual({ endpoint: '/sign-in/email' });
    expectNoPasswordMaterial(events);
  });
});
