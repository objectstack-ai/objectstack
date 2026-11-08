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
// Only a refused CREDENTIAL moves the counter. A sign-in whose password passed
// and that a policy then refused (the organization's allowed IP ranges, judged
// when the session is scoped to it; a ban; an address the deployment requires
// verified) neither counts nor clears: the last two `describe`s below.
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

/** `extra` is merged into the manager's config (a plugin switch, an e-mail rule). */
function deployment(extra: Record<string, unknown> = {}) {
  const engine = createMemoryEngine();
  const events: AuthSessionAuditEventInput[] = [];
  const manager = new AuthManager({
    secret: SECRET,
    baseUrl: 'http://localhost:3000',
    dataEngine: engine,
    lockoutThreshold: THRESHOLD,
    lockoutDurationMinutes: 15,
    ...extra,
    getAuditSink: () => ({
      recordAuthEvent: async (event: AuthSessionAuditEventInput) => {
        events.push(event);
      },
    }),
  } as any);
  return { engine, manager, events };
}

const post = (manager: AuthManager, path: string, body: unknown, remoteAddress?: string) =>
  manager.handleRequest(
    new Request(`${BASE}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
    remoteAddress ? { remoteAddress } : undefined,
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
/**
 * A locked account's refusal: the wrong-password answer itself (ADR-0069 D2,
 * `sign-in-lockout-refusal.ts`). The cases below tell a lock from a wrong
 * password by submitting the CORRECT password, and by the reason the account's
 * `login_failed` row carries.
 */
const LOCKED = REFUSED;
/** The explicit refusal a deployment opts into with `lockoutRefusal: 'explicit'`. */
const LOCKED_EXPLICIT = { status: 403, code: 'ACCOUNT_LOCKED' };

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

/** The organization the account belongs to, and the one network its own list admits. */
const ORGANIZATION = 'org_lockout_policy';
const INSIDE = '10.1.0.7';
const OUTSIDE = '10.2.0.7';
const NOT_ADMITTED = { status: 403, code: 'IP_NOT_ALLOWED' };

/**
 * {@link deployment}, with the account a member of an organization whose own
 * allowed IP ranges admit only 10.1.0.0/16. The deployment sets no list of its
 * own, so the organization's list is judged where the sign-in's session is
 * scoped to it — after the password passed.
 */
async function organizationListDeployment() {
  const { engine, manager, events } = deployment();
  await signUp(manager);
  const userId = String(accountRow(engine).id);
  // Whatever membership the sign-up settled is replaced by the one under test.
  engine.tables.set('sys_member', (engine.tables.get('sys_member') ?? []).filter((m: any) => m.user_id !== userId));
  await engine.insert('sys_member', { user_id: userId, organization_id: ORGANIZATION, role: 'member', created_at: new Date() });
  manager.setOrganizationAccessPolicySource({
    read: async (id) => (id === ORGANIZATION ? { allowed_ip_ranges: '10.1.0.0/16' } : {}),
    anyOrganizationRequiresMfa: async () => false,
  });
  return { engine, manager, events };
}

const signInFrom = (manager: AuthManager, password: string, remoteAddress: string) =>
  post(manager, '/sign-in/email', { email: EMAIL, password }, remoteAddress);

describe('ADR-0069 D2: a correct password the organization\'s IP list refuses neither counts nor clears', () => {
  it('refusals past the threshold lock nothing, and the account signs in from inside the list', async () => {
    const { engine, manager, events } = await organizationListDeployment();
    events.length = 0;

    for (let i = 0; i < THRESHOLD; i++) {
      expect(await outcome(await signInFrom(manager, PASSWORD, OUTSIDE)), `attempt ${i + 1}`).toEqual(NOT_ADMITTED);
      expect(Number(accountRow(engine).failed_login_count ?? 0), `attempt ${i + 1}`).toBe(0);
    }
    expect(isLocked(accountRow(engine))).toBe(false);
    expect(events.some((e) => e.action === 'account_locked')).toBe(false);

    const home = await signInFrom(manager, PASSWORD, INSIDE);
    expect(home.status, await home.clone().text()).toBe(200);
    expect(Number(accountRow(engine).failed_login_count ?? 0)).toBe(0);
  });

  it('the refusal leaves a count earned by wrong passwords where it stands', async () => {
    const { engine, manager } = await organizationListDeployment();
    for (let i = 0; i < THRESHOLD - 1; i++) {
      expect(await outcome(await signInFrom(manager, WRONG_PASSWORD, INSIDE))).toEqual(REFUSED);
    }
    expect(Number(accountRow(engine).failed_login_count)).toBe(THRESHOLD - 1);

    expect(await outcome(await signInFrom(manager, PASSWORD, OUTSIDE))).toEqual(NOT_ADMITTED);
    expect(Number(accountRow(engine).failed_login_count)).toBe(THRESHOLD - 1);
    expect(isLocked(accountRow(engine))).toBe(false);
  });

  it('a wrong password counts from either side of the list, and a correct one from inside clears', async () => {
    const { engine, manager } = await organizationListDeployment();

    // From outside the credential refuses first: the list is judged only once a session is created.
    expect(await outcome(await signInFrom(manager, WRONG_PASSWORD, OUTSIDE))).toEqual(REFUSED);
    expect(Number(accountRow(engine).failed_login_count)).toBe(1);
    expect(await outcome(await signInFrom(manager, WRONG_PASSWORD, INSIDE))).toEqual(REFUSED);
    expect(Number(accountRow(engine).failed_login_count)).toBe(2);

    expect((await signInFrom(manager, PASSWORD, INSIDE)).status).toBe(200);
    expect(Number(accountRow(engine).failed_login_count)).toBe(0);

    for (let i = 0; i < THRESHOLD; i++) {
      expect(await outcome(await signInFrom(manager, WRONG_PASSWORD, OUTSIDE))).toEqual(REFUSED);
    }
    expect(isLocked(accountRow(engine))).toBe(true);
    expect(await outcome(await signInFrom(manager, PASSWORD, INSIDE))).toEqual(LOCKED);
  });
});

describe('ADR-0069 D2: a correct password refused for a ban or an unverified address neither counts nor clears', () => {
  it('a banned account: wrong passwords count, the correct one is refused BANNED_USER and moves nothing', async () => {
    const { engine, manager, events } = deployment({ plugins: { admin: true } });
    await signUp(manager);
    accountRow(engine).banned = true;
    for (let i = 0; i < THRESHOLD - 1; i++) {
      expect(await outcome(await signIn(manager, EMAIL, WRONG_PASSWORD))).toEqual(REFUSED);
    }
    expect(Number(accountRow(engine).failed_login_count)).toBe(THRESHOLD - 1);
    events.length = 0;

    for (let i = 0; i < THRESHOLD; i++) {
      expect(await outcome(await signIn(manager, EMAIL, PASSWORD)), `attempt ${i + 1}`)
        .toEqual({ status: 403, code: 'BANNED_USER' });
      expect(Number(accountRow(engine).failed_login_count), `attempt ${i + 1}`).toBe(THRESHOLD - 1);
    }
    expect(isLocked(accountRow(engine))).toBe(false);
    expect(events.some((e) => e.action === 'account_locked')).toBe(false);

    // Lifted, the ban leaves no lock behind: the correct password signs in and clears the count.
    accountRow(engine).banned = false;
    expect((await signIn(manager, EMAIL, PASSWORD)).status).toBe(200);
    expect(Number(accountRow(engine).failed_login_count)).toBe(0);
  });

  it('an unverified address: wrong passwords count, the correct one is refused EMAIL_NOT_VERIFIED and moves nothing', async () => {
    const { engine, manager } = deployment({ emailAndPassword: { enabled: true, requireEmailVerification: true } });
    await signUp(manager);
    accountRow(engine).email_verified = false;
    for (let i = 0; i < THRESHOLD - 1; i++) {
      expect(await outcome(await signIn(manager, EMAIL, WRONG_PASSWORD))).toEqual(REFUSED);
    }
    expect(Number(accountRow(engine).failed_login_count)).toBe(THRESHOLD - 1);

    for (let i = 0; i < THRESHOLD; i++) {
      expect(await outcome(await signIn(manager, EMAIL, PASSWORD)), `attempt ${i + 1}`)
        .toEqual({ status: 403, code: 'EMAIL_NOT_VERIFIED' });
      expect(Number(accountRow(engine).failed_login_count), `attempt ${i + 1}`).toBe(THRESHOLD - 1);
    }
    expect(isLocked(accountRow(engine))).toBe(false);

    // One more wrong password still reaches the threshold and locks.
    expect(await outcome(await signIn(manager, EMAIL, WRONG_PASSWORD))).toEqual(REFUSED);
    expect(isLocked(accountRow(engine))).toBe(true);
  });
});

/** Status, headers that describe the body, and the body itself, byte for byte. */
async function wholeAnswer(res: Response): Promise<{ status: number; contentType: string | null; body: string }> {
  return { status: res.status, contentType: res.headers.get('content-type'), body: await res.clone().text() };
}

/** The answer to `send`, and how many password derivations it ran (the work behind the answer). */
async function measured(send: () => Promise<Response>) {
  const before = scrypt.counts();
  const answer = await wholeAnswer(await send());
  const after = scrypt.counts();
  return { answer, derivations: after.derived + after.answered - before.derived - before.answered };
}

describe('ADR-0069 D2: a locked account is answered exactly as a wrong password is', () => {
  it('the same status and body, after the same one password check, whatever password it is sent', async () => {
    const { engine, manager } = deployment();
    await signUp(manager);
    const wrongWhileOpen = await measured(() => signIn(manager, EMAIL, WRONG_PASSWORD));
    const unknown = await measured(() => signIn(manager, 'nobody.lockout-account@example.com', WRONG_PASSWORD));
    for (let i = 1; i < THRESHOLD; i++) await signIn(manager, EMAIL, WRONG_PASSWORD);
    expect(isLocked(accountRow(engine))).toBe(true);

    const correctWhileLocked = await measured(() => signIn(manager, EMAIL, PASSWORD));
    const wrongWhileLocked = await measured(() => signIn(manager, EMAIL, WRONG_PASSWORD));

    expect(wrongWhileOpen.answer.status).toBe(401);
    expect(JSON.parse(wrongWhileOpen.answer.body)).toMatchObject({ code: 'INVALID_EMAIL_OR_PASSWORD' });
    for (const locked of [correctWhileLocked, wrongWhileLocked]) {
      expect(locked.answer).toEqual(wrongWhileOpen.answer);
      expect(locked.derivations).toBe(wrongWhileOpen.derivations);
    }
    // …and the same as an address that names no account at all.
    expect(unknown.answer).toEqual(wrongWhileOpen.answer);
    expect(unknown.derivations).toBe(wrongWhileOpen.derivations);
    expect(wrongWhileOpen.derivations).toBe(1);
  });

  it('a request the endpoint refuses before any password check is refused the same way for a locked account', async () => {
    const { engine, manager } = deployment();
    await signUp(manager);
    const malformed = [
      { email: EMAIL, password: 'x'.repeat(4096) },
      { email: EMAIL },
    ];
    const open = [];
    for (const body of malformed) open.push(await wholeAnswer(await post(manager, '/sign-in/email', body)));
    // Those refusals counted as attempts; reset the count before locking.
    accountRow(engine).failed_login_count = 0;
    for (let i = 0; i < THRESHOLD; i++) await signIn(manager, EMAIL, WRONG_PASSWORD);
    expect(isLocked(accountRow(engine))).toBe(true);

    for (const [i, body] of malformed.entries()) {
      const answer = await wholeAnswer(await post(manager, '/sign-in/email', body));
      expect(answer.status, JSON.stringify(Object.keys(body))).toBeGreaterThanOrEqual(400);
      expect(answer, JSON.stringify(Object.keys(body))).toEqual(open[i]);
    }
  });

  it('no session is issued and the account records the lock as the reason', async () => {
    const { engine, manager, events } = deployment();
    await signUp(manager);
    for (let i = 0; i < THRESHOLD; i++) await signIn(manager, EMAIL, WRONG_PASSWORD);
    events.length = 0;

    const res = await signIn(manager, EMAIL, PASSWORD);
    expect(await outcome(res)).toEqual(REFUSED);
    expect(res.headers.getSetCookie?.() ?? []).toEqual([]);
    expect(events.some((e) => e.action === 'login')).toBe(false);
    expect(accountEvents(events)).toEqual([
      expect.objectContaining({
        action: 'login_failed',
        userId: String(accountRow(engine).id),
        context: { endpoint: '/sign-in/email', reason: 'ACCOUNT_LOCKED' },
      }),
    ]);
  });
});

describe("ADR-0069 D2: a deployment that opts in answers a locked account 403 ACCOUNT_LOCKED", () => {
  it('the correct password is refused with the explicit code, and the account records the lock', async () => {
    const { engine, manager, events } = deployment({ lockoutRefusal: 'explicit' });
    await signUp(manager);
    for (let i = 0; i < THRESHOLD; i++) {
      expect(await outcome(await signIn(manager, EMAIL, WRONG_PASSWORD))).toEqual(REFUSED);
    }
    expect(isLocked(accountRow(engine))).toBe(true);
    const lockedUntil = new Date(accountRow(engine).locked_until).getTime();
    events.length = 0;

    expect(await outcome(await signIn(manager, EMAIL, PASSWORD))).toEqual(LOCKED_EXPLICIT);
    expect(await outcome(await signIn(manager, SPELLINGS[0], WRONG_PASSWORD))).toEqual(LOCKED_EXPLICIT);
    expect(events.some((e) => e.action === 'login')).toBe(false);
    expect(accountEvents(events).map((e) => e.context?.reason)).toEqual(['ACCOUNT_LOCKED', 'ACCOUNT_LOCKED']);
    expect(new Date(accountRow(engine).locked_until).getTime()).toBe(lockedUntil);
    // An address that names no account is still a wrong password.
    expect(await outcome(await signIn(manager, 'nobody.lockout-account@example.com', PASSWORD))).toEqual(REFUSED);
  });
});

describe('ADR-0069 D2: attempts that arrive together reach the credential check at most threshold times', () => {
  it('of many concurrent wrong passwords, exactly the threshold are checked and the rest meet the lock', async () => {
    const { engine, manager, events } = deployment();
    await signUp(manager);
    events.length = 0;
    const CONCURRENT = 30;

    const answers = await Promise.all(
      Array.from({ length: CONCURRENT }, () => signIn(manager, EMAIL, WRONG_PASSWORD).then(outcome)),
    );

    expect(answers).toEqual(answers.map(() => REFUSED));
    expect(isLocked(accountRow(engine))).toBe(true);
    expect(Number(accountRow(engine).failed_login_count)).toBeGreaterThanOrEqual(THRESHOLD);
    const failed = accountEvents(events).filter((e) => e.action === 'login_failed');
    expect(failed.filter((e) => e.context?.reason === 'INVALID_EMAIL_OR_PASSWORD')).toHaveLength(THRESHOLD);
    expect(failed.filter((e) => e.context?.reason === 'ACCOUNT_LOCKED')).toHaveLength(CONCURRENT - THRESHOLD);
    expect(accountEvents(events).filter((e) => e.action === 'account_locked')).toHaveLength(1);
    // The lock holds against the correct password.
    expect(await outcome(await signIn(manager, EMAIL, PASSWORD))).toEqual(LOCKED);
  });
});

describe('ADR-0069 D2: an account whose failed_login_count is NULL or absent is counted and cleared like one at 0', () => {
  const blank: Array<[string, (row: any) => void]> = [
    ['NULL', (row) => { row.failed_login_count = null; }],
    ['absent', (row) => { delete row.failed_login_count; }],
  ];
  for (const [label, clearCounter] of blank) {
    it(`${label}: the correct password signs in, and the counter is cleared to 0`, async () => {
      const { engine, manager } = deployment();
      await signUp(manager);
      clearCounter(accountRow(engine));
      const res = await signIn(manager, EMAIL, PASSWORD);
      expect(res.status, await res.clone().text()).toBe(200);
      expect(accountRow(engine).failed_login_count).toBe(0);
      expect(isLocked(accountRow(engine))).toBe(false);
    });

    it(`${label}: a wrong password counts to 1, and the correct one still signs in after it`, async () => {
      const { engine, manager } = deployment();
      await signUp(manager);
      clearCounter(accountRow(engine));
      expect(await outcome(await signIn(manager, EMAIL, WRONG_PASSWORD))).toEqual(REFUSED);
      expect(accountRow(engine).failed_login_count).toBe(1);
      expect(isLocked(accountRow(engine))).toBe(false);
      const res = await signIn(manager, EMAIL, PASSWORD);
      expect(res.status, await res.clone().text()).toBe(200);
      expect(accountRow(engine).failed_login_count).toBe(0);
    });
  }
});
