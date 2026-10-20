// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// ADR-0069 D2 — the account lockout belongs to the ACCOUNT, never to the text
// a sign-in typed.
//
// ## The invariant
//
// A password sign-in names an account through its credential check
// (better-auth's `/sign-in/email`). The lockout's counter and its lock gate
// must name that same account for every identifier the credential check
// resolves to it:
//
//  - every refused sign-in that resolves to the account counts toward its one
//    lock, whichever spelling of the address it carried;
//  - an existing lock refuses every sign-in that resolves to the account, the
//    correct password included;
//  - a successful sign-in under any spelling clears the counter, as before;
//  - an identifier that resolves to no account changes no account and writes
//    no account event.
//
// The account events (`login_failed` / `account_locked`) name the account the
// same resolution names, so the ledger and the lock never disagree.
//
// ## Why the server here is the real one
//
// "Which account does this identifier name" is answered by the credential
// check, so every case drives a real `AuthManager` through
// `AuthManager.handleRequest` over the in-memory engine this package's
// better-auth suites share, whose equality is exact — the comparison a SQL
// column makes by default. The lock state is read back from the `sys_user`
// row itself.

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
/** The address the account signed up with. */
const EMAIL = 'holder.lockout-account@example.com';
/**
 * Other spellings of the same address, each of which the credential check
 * resolves to the account above (a correct password under each signs in).
 */
const SPELLINGS = [
  'Holder.Lockout-Account@Example.com',
  'HOLDER.LOCKOUT-ACCOUNT@EXAMPLE.COM',
] as const;
const PASSWORD = 'Corr3ct!Horse-Battery';
const WRONG_PASSWORD = 'Wr0ng!Guess-Zebra-7731';
const THRESHOLD = 3;

function deployment() {
  const engine = createMemoryEngine();
  const events: AuthSessionAuditEventInput[] = [];
  const manager = new AuthManager({
    secret: SECRET,
    baseUrl: 'http://localhost:3000',
    dataEngine: engine,
    lockoutThreshold: THRESHOLD,
    lockoutDurationMinutes: 15,
    getAuditSink: () => ({
      recordAuthEvent: async (event: AuthSessionAuditEventInput) => {
        events.push(event);
      },
    }),
  } as any);
  return { engine, manager, events };
}

const post = (manager: AuthManager, path: string, body: unknown) =>
  manager.handleRequest(
    new Request(`${BASE}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
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

/** The status and machine code a sign-in answered. */
async function outcome(res: Response): Promise<{ status: number; code: string | undefined }> {
  const body = (await res.clone().json().catch(() => ({}))) as { code?: unknown };
  return { status: res.status, code: typeof body.code === 'string' ? body.code : undefined };
}

const REFUSED = { status: 401, code: 'INVALID_EMAIL_OR_PASSWORD' };
const LOCKED = { status: 403, code: 'ACCOUNT_LOCKED' };

function accountRow(engine: any): any {
  const row = ((engine.tables.get('sys_user') ?? []) as any[]).find((r) => r.email === EMAIL);
  if (!row) throw new Error(`no sys_user row for ${EMAIL}`);
  return row;
}

const isLocked = (row: any) => !!row.locked_until && new Date(row.locked_until).getTime() > Date.now();

/** The account events, in order — `login` / `logout` filtered out. */
const accountEvents = (events: AuthSessionAuditEventInput[]) =>
  events.filter((e) => e.action === 'login_failed' || e.action === 'account_locked');

describe('ADR-0069 D2: the lockout counts and holds the account the credential check resolves', () => {
  it('each spelling below is one the credential check resolves to the account', async () => {
    const { engine, manager } = deployment();
    await signUp(manager);
    for (const spelling of SPELLINGS) {
      const res = await signIn(manager, spelling, PASSWORD);
      expect(res.status, spelling).toBe(200);
      const body = (await res.json()) as { user?: { id?: string } };
      expect(body.user?.id, spelling).toBe(accountRow(engine).id);
    }
  });

  it('refusals under different spellings of one address accumulate toward its one lock', async () => {
    const { engine, manager, events } = deployment();
    await signUp(manager);
    const userId = String(accountRow(engine).id);
    events.length = 0;

    const attempts = [SPELLINGS[0], EMAIL, SPELLINGS[1]];
    for (const [i, spelling] of attempts.entries()) {
      expect(await outcome(await signIn(manager, spelling, WRONG_PASSWORD)), spelling).toEqual(REFUSED);
      expect(Number(accountRow(engine).failed_login_count), spelling).toBe(i + 1);
    }

    expect(isLocked(accountRow(engine))).toBe(true);
    const recorded = accountEvents(events);
    expect(recorded.map((e) => e.action)).toEqual([
      'login_failed',
      'login_failed',
      'login_failed',
      'account_locked',
    ]);
    expect(recorded.every((e) => e.userId === userId)).toBe(true);
    expect(recorded[3]!.context?.threshold).toBe(THRESHOLD);
    expect(new Date(String(recorded[3]!.context?.locked_until)).getTime())
      .toBe(new Date(accountRow(engine).locked_until).getTime());
  });

  it('a locked account refuses the correct password under every spelling', async () => {
    const { engine, manager, events } = deployment();
    await signUp(manager);
    const userId = String(accountRow(engine).id);
    for (let i = 0; i < THRESHOLD; i++) {
      expect(await outcome(await signIn(manager, EMAIL, WRONG_PASSWORD))).toEqual(REFUSED);
    }
    expect(isLocked(accountRow(engine))).toBe(true);
    const lockedUntil = new Date(accountRow(engine).locked_until).getTime();
    events.length = 0;

    for (const spelling of [EMAIL, ...SPELLINGS]) {
      expect(await outcome(await signIn(manager, spelling, PASSWORD)), spelling).toEqual(LOCKED);
    }

    expect(events.some((e) => e.action === 'login'), 'no session was minted').toBe(false);
    expect(accountEvents(events)).toEqual(
      [EMAIL, ...SPELLINGS].map(() => expect.objectContaining({
        action: 'login_failed',
        userId,
        context: { endpoint: '/sign-in/email', reason: 'ACCOUNT_LOCKED' },
      })),
    );
    // The lock is the one the account already held: the refusals neither lift nor move it.
    expect(new Date(accountRow(engine).locked_until).getTime()).toBe(lockedUntil);
  });

  it('a lock reached under one spelling refuses the correct password under another', async () => {
    const { engine, manager } = deployment();
    await signUp(manager);
    for (let i = 0; i < THRESHOLD; i++) {
      expect(await outcome(await signIn(manager, SPELLINGS[1], WRONG_PASSWORD))).toEqual(REFUSED);
    }
    expect(isLocked(accountRow(engine))).toBe(true);

    expect(await outcome(await signIn(manager, EMAIL, PASSWORD))).toEqual(LOCKED);
    expect(await outcome(await signIn(manager, SPELLINGS[0], PASSWORD))).toEqual(LOCKED);
  });

  it('a successful sign-in under any spelling clears the counter', async () => {
    const { engine, manager } = deployment();
    await signUp(manager);

    for (const spelling of SPELLINGS) {
      for (let i = 0; i < THRESHOLD - 1; i++) {
        expect(await outcome(await signIn(manager, EMAIL, WRONG_PASSWORD))).toEqual(REFUSED);
      }
      expect(Number(accountRow(engine).failed_login_count)).toBe(THRESHOLD - 1);

      expect((await signIn(manager, spelling, PASSWORD)).status, spelling).toBe(200);
      expect(Number(accountRow(engine).failed_login_count), spelling).toBe(0);
      expect(isLocked(accountRow(engine)), spelling).toBe(false);
    }
  });

  it('an identifier that resolves to no account changes no account and writes no account event', async () => {
    const { engine, manager, events } = deployment();
    await signUp(manager);
    const before = structuredClone(engine.tables.get('sys_user'));
    events.length = 0;

    const unknown = ['nobody.lockout-account@example.com', 'Nobody.Lockout-Account@Example.com'];
    for (let i = 0; i < THRESHOLD + 1; i++) {
      for (const identifier of unknown) {
        expect(await outcome(await signIn(manager, identifier, WRONG_PASSWORD)), identifier).toEqual(REFUSED);
      }
    }

    expect(engine.tables.get('sys_user')).toEqual(before);
    expect(accountEvents(events)).toEqual([]);
    for (const identifier of unknown) expect(JSON.stringify(events)).not.toContain(identifier);
    // …and the real account still signs in.
    expect((await signIn(manager, EMAIL, PASSWORD)).status).toBe(200);
  });
});
