// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
// test-budget: 20 — spawns the real producer once per single-cause fixture: one in-process bootStack boot in beforeAll shared by all eight cases, plus real better-auth sign-ins, a session per case, since revocation and holds on that session are the subject; 6.2 s in a local run, the boot about 4.3 s of it; slowest CI reading 10.4 s (scheduled full-battery run 41255489006, Test Core shard log) x 1.25, rounded up

/**
 * ADR-0069 on an IMPERSONATION session, on a real boot: which of the TARGET's
 * postures hold the session an administrator impersonates them with.
 *
 * The defect: an administrator impersonating a user who must change their
 * password (the default of Create User, Set Password and Import) got an
 * impersonation session that every protected route refused with the target's
 * `403 PASSWORD_RESET_REQUIRED`, so the console showed the TARGET's
 * change-password screen and the only exit was signing out. The session gate
 * read the target's postures with no regard to what the session was.
 *
 * The rule (#24762, ruling 6288774214, letter E, items 1 and 2): a posture
 * holds what its declared scope says (`AUTH_GATE_SCOPES`). A `credential`
 * posture (`PASSWORD_RESET_REQUIRED`, `PASSWORD_EXPIRED`) holds the user's
 * password sign-in alone, and an impersonation session is not that: it is
 * minted from the administrator's own session, which passed its own posture
 * check at the impersonation door. An `account` posture (`MFA_REQUIRED`) holds
 * every credential of the user, an impersonation session included. Applied
 * once, where `customSession` stamps `user.authGate`; every transport seam
 * reads that stamp and restates nothing.
 *
 * Pinned here (item 3), each refusal as the ADR-0112 envelope (`status` and
 * nested `error.code`), each impersonation session proved to be one (the
 * session payload names the target as its user and the administrator as
 * `impersonatedBy`):
 *
 *  (a) a `PASSWORD_RESET_REQUIRED` target's impersonation session reads a
 *      protected route `200`;
 *  (b) the target's own session still answers `403 PASSWORD_RESET_REQUIRED`;
 *  (c) an `MFA_REQUIRED` target's impersonation session still answers
 *      `403 MFA_REQUIRED`;
 *  (d) a target held by both answers `MFA_REQUIRED` on the impersonation
 *      session, never nothing: the account-scope posture is found wherever it
 *      sits in the list, not by dropping the first.
 *
 * Beside them, the control item 7 keeps unchanged: the forced reset's
 * revocation (on by default) still ends every session of the user, an
 * impersonation session included.
 *
 * The forced reset is armed through the real door an administrator uses
 * (`/admin/set-user-password`, its `mustChangePassword` default), exactly as
 * the report measured it. The producer-level cases, including
 * `PASSWORD_EXPIRED`, are `@objectstack/plugin-auth`'s `auth-manager.test.ts`.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { bootStack } from './harness.js';

const app = {
  manifest: {
    id: 'com.example.held-impersonation-target',
    namespace: 'heldimpersonationtarget',
    version: '0.0.1',
    type: 'app',
    name: 'Held Impersonation Target Fixture',
  },
  objects: [],
};

const BOOT_TIMEOUT = 180_000;
const SYS = { context: { isSystem: true } };
const DAY_MS = 86_400_000;

const TARGET_EMAIL = 'held-impersonation-target@example.com';
/** Every forced reset below sets a new password, so the target's own sign-in tracks it. */
let targetPassword = 'HeldImpersonation!Target0';
let resetSeq = 0;

/** A protected route: the session gate's allow-list does not reach it. */
const PROTECTED_READ = '/data/sys_user?limit=1';

/**
 * Read when the auth instance is built, so it precedes the boot.
 * `OS_SCIM_ENABLED` turns the better-auth `admin` plugin on (SCIM forces it,
 * ADR-0134): the plugin that serves impersonation.
 */
const ENV = { OS_SCIM_ENABLED: 'true' } as const;

let stack: Awaited<ReturnType<typeof bootStack>>;
let ql: any;
let auth: any;
let adminId: string;
let targetId: string;
const savedEnv: Record<string, string | undefined> = {};

beforeAll(async () => {
  for (const [k, v] of Object.entries(ENV)) {
    savedEnv[k] = process.env[k];
    process.env[k] = v;
  }
  stack = await bootStack(app);
  ql = await stack.kernel.getServiceAsync<any>('objectql');
  auth = await stack.kernel.getServiceAsync<any>('auth');
  adminId = (await sessionOf(await stack.signIn())).userId;
  targetId = (await sessionOf(await stack.signUp(TARGET_EMAIL, targetPassword))).userId;
}, BOOT_TIMEOUT);

afterAll(async () => {
  await stack?.stop();
  for (const [k, v] of Object.entries(savedEnv)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
}, BOOT_TIMEOUT);

async function sessionOf(token: string): Promise<{ userId: string; impersonatedBy?: string; authGate?: unknown }> {
  const res = await stack.apiAs(token, 'GET', '/auth/get-session');
  const body = (await res.json()) as {
    user?: { id?: string; authGate?: unknown };
    session?: { impersonatedBy?: string | null };
  };
  if (!body.user?.id) throw new Error(`get-session answered ${res.status} with no user`);
  return {
    userId: body.user.id,
    impersonatedBy: body.session?.impersonatedBy ?? undefined,
    authGate: body.user.authGate,
  };
}

const signInTarget = () => stack.signIn(TARGET_EMAIL, targetPassword);

/**
 * The administrator impersonates the target and the impersonation session's
 * bearer is returned, proved to BE one. A fresh admin sign-in each time: the
 * impersonation rotates the caller's own bearer away.
 */
async function impersonateTarget(): Promise<string> {
  const res = await stack.apiAs(await stack.signIn(), 'POST', '/auth/admin/impersonate-user', { userId: targetId });
  if (res.status !== 200) throw new Error(`impersonate-user answered ${res.status} ${await res.text()}`);
  const token = res.headers.get('set-auth-token');
  if (!token) throw new Error('impersonate-user answered 200 with no set-auth-token');
  const session = await sessionOf(token);
  expect(session.userId).toBe(targetId);
  expect(session.impersonatedBy).toBe(adminId);
  return token;
}

/** The administrator's forced reset, through the real door, with its revocation default unless told otherwise. */
async function forceReset(opts: { revokeSessionsAndKeys?: boolean } = {}): Promise<any> {
  targetPassword = `HeldImpersonation!Target${++resetSeq}`;
  const res = await stack.apiAs(await stack.signIn(), 'POST', '/auth/admin/set-user-password', {
    userId: targetId,
    newPassword: targetPassword,
    mustChangePassword: true,
    ...opts,
  });
  const body = (await res.json()) as any;
  if (res.status !== 200 || body?.data?.mustChangePassword !== true) {
    throw new Error(`set-user-password answered ${res.status} ${JSON.stringify(body)}`);
  }
  return body.data;
}

async function clearReset(): Promise<void> {
  await ql.update('sys_user', { id: targetId, must_change_password: false }, SYS);
}

/** Enforced MFA that holds the target (grace lapsed) and not the administrator (inside the grace window). */
async function armMfa(): Promise<void> {
  auth.applyConfigPatch({ mfaRequired: true, mfaGracePeriodDays: 7 });
  await ql.update('sys_user', { id: targetId, mfa_required_at: new Date(Date.now() - 10 * DAY_MS) }, SYS);
  await ql.update('sys_user', { id: adminId, mfa_required_at: new Date() }, SYS);
}

async function disarmMfa(): Promise<void> {
  auth.applyConfigPatch({ mfaRequired: false });
}

/**
 * The session gate's refusal, as the data plane's seam renders it (ADR-0112:
 * the `403` status and the posture's code nested under `error`).
 */
async function expectHeld(res: Response, code: string): Promise<void> {
  expect(res.status).toBe(403);
  const body = (await res.json()) as { error?: { code?: string } };
  expect(body.error?.code).toBe(code);
}

describe('control: an unheld target', () => {
  it('reads the protected route 200 on its own session and on an impersonation session', async () => {
    expect((await stack.apiAs(await signInTarget(), 'GET', PROTECTED_READ)).status).toBe(200);
    expect((await stack.apiAs(await impersonateTarget(), 'GET', PROTECTED_READ)).status).toBe(200);
  });
});

describe('a target the administrator forced to change their password (PASSWORD_RESET_REQUIRED, credential scope)', () => {
  beforeAll(async () => {
    await forceReset();
  }, 60_000);

  afterAll(async () => {
    await clearReset();
  });

  it('(b) the target\'s own session still answers 403 PASSWORD_RESET_REQUIRED', async () => {
    await expectHeld(await stack.apiAs(await signInTarget(), 'GET', PROTECTED_READ), 'PASSWORD_RESET_REQUIRED');
  });

  it('(a) the impersonation session reads the protected route 200, and carries no posture', async () => {
    const token = await impersonateTarget();
    expect((await stack.apiAs(token, 'GET', PROTECTED_READ)).status).toBe(200);
    expect((await sessionOf(token)).authGate).toBeUndefined();
  });

  it('control: the forced reset\'s revocation (on by default) still ends the impersonation session', async () => {
    const token = await impersonateTarget();
    expect((await stack.apiAs(token, 'GET', PROTECTED_READ)).status).toBe(200);
    const done = await forceReset();
    expect(done.revokeSessionsAndKeys).toBe(true);
    expect(done.revoked?.sessions).toBeGreaterThanOrEqual(1);
    expect((await stack.apiAs(token, 'GET', PROTECTED_READ)).status).toBe(401);
  });
});

describe('a target enforced MFA holds (MFA_REQUIRED, account scope)', () => {
  beforeAll(async () => {
    await armMfa();
  }, 60_000);

  afterAll(async () => {
    await disarmMfa();
  });

  it('the target\'s own session answers 403 MFA_REQUIRED (the hold is armed)', async () => {
    await expectHeld(await stack.apiAs(await signInTarget(), 'GET', PROTECTED_READ), 'MFA_REQUIRED');
  });

  it('(c) the impersonation session still answers 403 MFA_REQUIRED', async () => {
    await expectHeld(await stack.apiAs(await impersonateTarget(), 'GET', PROTECTED_READ), 'MFA_REQUIRED');
  });
});

describe('a target held by both the forced reset and enforced MFA', () => {
  beforeAll(async () => {
    await armMfa();
    await forceReset({ revokeSessionsAndKeys: false });
  }, 60_000);

  afterAll(async () => {
    await clearReset();
    await disarmMfa();
  });

  it('the target\'s own session shows the most urgent posture, 403 PASSWORD_RESET_REQUIRED', async () => {
    await expectHeld(await stack.apiAs(await signInTarget(), 'GET', PROTECTED_READ), 'PASSWORD_RESET_REQUIRED');
  });

  it('(d) the impersonation session answers 403 MFA_REQUIRED, never nothing', async () => {
    await expectHeld(await stack.apiAs(await impersonateTarget(), 'GET', PROTECTED_READ), 'MFA_REQUIRED');
  });
});
