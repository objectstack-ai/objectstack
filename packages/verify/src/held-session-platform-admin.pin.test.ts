// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
// test-budget: 20 — spawns the real producer once per single-cause fixture: one in-process bootStack boot in beforeAll shared by all 13 cases, plus one hold per posture state and real better-auth sign-ins, the held session being the subject; 5.3 s in a local run, the boot most of it; slowest CI reading 10.3 s (scheduled full-battery run 41199450735, Test Core shard log) x 1.25, rounded up

/**
 * ADR-0069 D3 on the platform-admin surface, on a real boot.
 *
 * A held session (an expired password; enforced MFA not yet enrolled) is gated
 * out of every protected resource until it remediates, and the platform-admin
 * surface is one. Its mounts sit under the auth namespace on the raw host app,
 * where neither ADR-0069 transport seam (the REST server, the runtime
 * dispatcher) runs, and their one judge (`judgePlatformAdmin`, plugin-auth)
 * read the session and the admin rung but never the posture. Measured on this
 * composition before the fix, in both held states: the protected data read
 * answered `403` with the gate's code, and a platform-admin write answered
 * `200` and landed.
 *
 * The judge now consults the gate's shared decision (`evaluateAuthGate`), so
 * every mount it judges refuses a held session with `403` and the gate's own
 * code. What this file pins, per held state:
 *
 *  - the refusal: status, the gate's code, and the write NEVER landing (a bare
 *    status would stay green on a refusal raised after the write);
 *  - remediation is unchanged: two-factor enrollment answers `200`,
 *    change-password reaches its own validation (not the gate), sign-out
 *    answers `200`, and an anonymous sign-in answers `200`;
 *  - a held NON-admin reads the posture refusal on the same mount.
 *
 * And outside both: an unheld platform admin's identical write lands (the
 * control that makes the refusal mean something).
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { bootStack } from './harness.js';

const app = {
  manifest: {
    id: 'com.example.held-admin-gate',
    namespace: 'heldadmingate',
    version: '0.0.1',
    type: 'app',
    name: 'Held Admin Gate Fixture',
  },
  objects: [],
};

const BOOT_TIMEOUT = 180_000;
const SYS = { context: { isSystem: true } };
const DAY_MS = 86_400_000;

/** The dev admin the harness seeds (a platform admin) and its password. */
const ADMIN_EMAIL = 'admin@objectos.ai';
const ADMIN_PASSWORD = 'admin123';
const MEMBER_EMAIL = 'held-admin-gate-member@example.com';
const MEMBER_PASSWORD = 'HeldAdminGate!Member1';

/**
 * `OS_AUTH_TWO_FACTOR` mounts the two-factor endpoints the remediation case
 * drives; it is read when the auth instance is built, so it precedes the boot.
 */
const ENV = { OS_AUTH_TWO_FACTOR: 'true' } as const;

let stack: Awaited<ReturnType<typeof bootStack>>;
let ql: any;
let auth: any;
let adminId: string;
let memberId: string;
const savedEnv: Record<string, string | undefined> = {};

beforeAll(async () => {
  for (const [k, v] of Object.entries(ENV)) {
    savedEnv[k] = process.env[k];
    process.env[k] = v;
  }
  stack = await bootStack(app);
  ql = await stack.kernel.getServiceAsync<any>('objectql');
  auth = await stack.kernel.getServiceAsync<any>('auth');
  adminId = await sessionUserId(await stack.signIn());
  memberId = await sessionUserId(await stack.signUp(MEMBER_EMAIL, MEMBER_PASSWORD));
}, BOOT_TIMEOUT);

afterAll(async () => {
  await stack?.stop();
  for (const [k, v] of Object.entries(savedEnv)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
}, BOOT_TIMEOUT);

async function sessionUserId(token: string): Promise<string> {
  const res = await stack.apiAs(token, 'GET', '/auth/get-session');
  const body = (await res.json()) as { user?: { id?: string } };
  if (!body.user?.id) throw new Error(`get-session answered ${res.status} with no user`);
  return body.user.id;
}

/** `sys_user.manager_id` of the member, read with system context. */
async function memberManagerId(): Promise<unknown> {
  const row = await ql.findOne('sys_user', { where: { id: memberId }, fields: ['manager_id'] }, SYS);
  return row?.manager_id ?? null;
}

/** One platform-admin write with an observable effect: set the member's manager. */
function setMemberManager(token: string, managerId: string | null) {
  return stack.apiAs(token, 'POST', '/auth/admin/set-user-manager', { userId: memberId, managerId });
}

/** Sign in through the real route with no credential on the request. */
function anonymousSignIn(email: string, password: string) {
  return stack.api('/auth/sign-in/email', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
}

describe('control: an unheld platform admin', () => {
  it('lands the same platform-admin write (200, the row changes)', async () => {
    const token = await stack.signIn();
    const res = await setMemberManager(token, adminId);
    expect(res.status).toBe(200);
    expect(await memberManagerId()).toBe(adminId);
    const reset = await setMemberManager(token, null);
    expect(reset.status).toBe(200);
    expect(await memberManagerId()).toBeNull();
  });
});

interface HeldState {
  readonly code: 'PASSWORD_EXPIRED' | 'MFA_REQUIRED';
  arm(): Promise<void>;
  disarm(): Promise<void>;
}

const HELD_STATES: readonly HeldState[] = [
  {
    code: 'PASSWORD_EXPIRED',
    async arm() {
      auth.applyConfigPatch({ passwordExpiryDays: 1 });
      const stale = new Date(Date.now() - 10 * DAY_MS);
      for (const id of [adminId, memberId]) {
        await ql.update('sys_user', { id, password_changed_at: stale }, SYS);
      }
    },
    async disarm() {
      auth.applyConfigPatch({ passwordExpiryDays: 0 });
      for (const id of [adminId, memberId]) {
        await ql.update('sys_user', { id, password_changed_at: new Date() }, SYS);
      }
    },
  },
  {
    code: 'MFA_REQUIRED',
    async arm() {
      auth.applyConfigPatch({ mfaRequired: true, mfaGracePeriodDays: 0 });
      const lapsed = new Date(Date.now() - 10 * DAY_MS);
      for (const id of [adminId, memberId]) {
        await ql.update('sys_user', { id, mfa_required_at: lapsed }, SYS);
      }
    },
    async disarm() {
      auth.applyConfigPatch({ mfaRequired: false });
    },
  },
];

for (const state of HELD_STATES) {
  describe(`a held session (${state.code})`, () => {
    let adminToken: string;

    beforeAll(async () => {
      await state.arm();
      adminToken = await stack.signIn();
      // Armed, or every refusal below would be vacuous: the protected data read
      // is refused with this state's code, at the REST seam, before any case runs.
      const read = await stack.apiAs(adminToken, 'GET', '/data/sys_user?limit=1');
      const body = (await read.json()) as { error?: { code?: string } };
      if (read.status !== 403 || body.error?.code !== state.code) {
        throw new Error(
          `the ${state.code} hold is not armed: the protected read answered ${read.status} ` +
            `${JSON.stringify(body)}, so no refusal in this block would test anything`,
        );
      }
    }, 60_000);

    afterAll(async () => {
      await state.disarm();
    });

    it(`refuses a platform admin's write 403 ${state.code}, and the write never lands`, async () => {
      const res = await setMemberManager(adminToken, adminId);
      expect(res.status).toBe(403);
      const body = (await res.json()) as { success?: boolean; error?: { code?: string } };
      expect(body.success).toBe(false);
      expect(body.error?.code).toBe(state.code);
      expect(await memberManagerId()).toBeNull();
    });

    it(`answers a held non-admin on the same mount with the posture (${state.code})`, async () => {
      const memberToken = await stack.signIn(MEMBER_EMAIL, MEMBER_PASSWORD);
      const res = await setMemberManager(memberToken, null);
      expect(res.status).toBe(403);
      const body = (await res.json()) as { error?: { code?: string } };
      expect(body.error?.code).toBe(state.code);
    });

    it('still passes two-factor enrollment (200, a TOTP URI to confirm)', async () => {
      const res = await stack.apiAs(adminToken, 'POST', '/auth/two-factor/enable', { password: ADMIN_PASSWORD });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { totpURI?: string };
      expect(typeof body.totpURI).toBe('string');
    });

    it("still lets change-password reach its own validation, not the gate's 403", async () => {
      // A wrong current password: the endpoint's own refusal proves the request
      // reached it. The gate would have answered 403 with the posture's code.
      const res = await stack.apiAs(adminToken, 'POST', '/auth/change-password', {
        currentPassword: 'not-the-current-password',
        newPassword: 'HeldAdminGate!Next2',
      });
      expect(res.status).toBe(400);
      const body = (await res.json()) as { code?: string };
      expect(body.code).toBe('INVALID_PASSWORD');
    });

    it('still passes an anonymous sign-in (200)', async () => {
      const res = await anonymousSignIn(ADMIN_EMAIL, ADMIN_PASSWORD);
      expect(res.status).toBe(200);
    });

    it('still passes sign-out (200)', async () => {
      const token = await stack.signIn();
      const res = await stack.apiAs(token, 'POST', '/auth/sign-out', {});
      expect(res.status).toBe(200);
    });
  });
}
