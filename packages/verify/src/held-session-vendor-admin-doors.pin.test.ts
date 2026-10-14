// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * ADR-0069 D3 at the platform-admin doors better-auth serves itself, on a real
 * boot.
 *
 * A held session (an expired or administrator-forced password; enforced MFA
 * not yet enrolled, globally or by the organization the session operates in)
 * is gated out of every protected resource until it remediates. The raw
 * platform-admin mounts already refuse it (`judgePlatformAdmin`,
 * `held-session-platform-admin.pin.test.ts`). Three doors never reach that
 * judge, and nothing on their path read the posture. Measured on this
 * composition before the fix, in every held state:
 *
 *  - **impersonation** (`/admin/impersonate-user`, re-authorized in
 *    `admin-impersonate-endpoint.ts`): a held platform admin answered `200`
 *    with a session for the target, and that session is not held, so the hold
 *    was bypassed outright;
 *  - **SSO-provider registration** (`/sso/register`'s before-hook): a held
 *    platform admin answered `200` and the provider row landed;
 *  - **the `admin` plugin's role-scalar actions** (`VENDOR_ROLE_SCALAR_ADMIN_PATHS`):
 *    a held caller carrying the legacy `role = 'admin'` scalar was admitted to
 *    every one, writes included.
 *
 * Each door now asks the session gate's own posture carrier (the first entry
 * of `resolveUserAuthGates`) for the acting user in the session's organization
 * and refuses a held one with the refusal the session gate and the judge give.
 * What this file pins, per door and per held state: `403`, `success: false`,
 * the posture's own code, and the effect NEVER landing (a bare status would
 * stay green on a refusal raised after the write). Beside them: the unheld
 * controls (each door still works), an organization-only MFA requirement
 * holding, a held non-admin reading the posture first, and a failing posture
 * lookup failing open at the door exactly as it does for the session.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { bootStack } from './harness.js';

const app = {
  manifest: {
    id: 'com.example.held-vendor-admin-doors',
    namespace: 'heldvendoradmindoors',
    version: '0.0.1',
    type: 'app',
    name: 'Held Vendor Admin Doors Fixture',
  },
  objects: [],
};

const BOOT_TIMEOUT = 180_000;
const SYS = { context: { isSystem: true } };
const DAY_MS = 86_400_000;

const MEMBER_EMAIL = 'held-vendor-doors-member@example.com';
const MEMBER_PASSWORD = 'HeldVendorDoors!Member1';
const SCALAR_EMAIL = 'held-vendor-doors-scalar@example.com';
const SCALAR_PASSWORD = 'HeldVendorDoors!Scalar1';

/**
 * Read when the auth instance is built, so they precede the boot.
 * `OS_SCIM_ENABLED` turns the better-auth `admin` plugin on (SCIM forces it,
 * ADR-0134) — the plugin that serves impersonation and the role-scalar actions;
 * `OS_SSO_ENABLED` mounts `@better-auth/sso`'s `/sso/register`.
 */
const ENV = { OS_SCIM_ENABLED: 'true', OS_SSO_ENABLED: 'true' } as const;

/** The `admin` plugin routes the vendor authorizes on the role scalar (`VENDOR_ROLE_SCALAR_ADMIN_PATHS`). */
const ROLE_SCALAR_CALLS: ReadonlyArray<readonly [string, string, (memberId: string) => unknown]> = [
  ['POST', '/auth/admin/set-role', (id) => ({ userId: id, role: 'user' })],
  ['GET', '/auth/admin/get-user?id=MEMBER', () => undefined],
  ['POST', '/auth/admin/update-user', (id) => ({ userId: id, data: { name: 'renamed-by-held-caller' } })],
  ['GET', '/auth/admin/list-users?limit=1', () => undefined],
  ['POST', '/auth/admin/list-user-sessions', (id) => ({ userId: id })],
  ['POST', '/auth/admin/revoke-user-session', () => ({ sessionToken: 'no-such-session-token' })],
  ['POST', '/auth/admin/revoke-user-sessions', (id) => ({ userId: id })],
];

let stack: Awaited<ReturnType<typeof bootStack>>;
let ql: any;
let auth: any;
let adminId: string;
let memberId: string;
let scalarId: string;
let providerSeq = 0;
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
  memberId = (await sessionOf(await stack.signUp(MEMBER_EMAIL, MEMBER_PASSWORD))).userId;
  scalarId = (await sessionOf(await stack.signUp(SCALAR_EMAIL, SCALAR_PASSWORD))).userId;
  // A pre-ADR-0068 deployment's admin: the legacy scalar the vendor reads.
  await ql.update('sys_user', { id: scalarId, role: 'admin' }, SYS);
}, BOOT_TIMEOUT);

afterAll(async () => {
  await stack?.stop();
  for (const [k, v] of Object.entries(savedEnv)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
}, BOOT_TIMEOUT);

async function sessionOf(token: string): Promise<{ userId: string; organizationId?: string }> {
  const res = await stack.apiAs(token, 'GET', '/auth/get-session');
  const body = (await res.json()) as { user?: { id?: string }; session?: { activeOrganizationId?: string } };
  if (!body.user?.id) throw new Error(`get-session answered ${res.status} with no user`);
  return { userId: body.user.id, organizationId: body.session?.activeOrganizationId ?? undefined };
}

const signInScalar = () => stack.signIn(SCALAR_EMAIL, SCALAR_PASSWORD);
const signInMember = () => stack.signIn(MEMBER_EMAIL, MEMBER_PASSWORD);

/** Impersonation sessions `actorId` has minted so far. */
async function impersonationsBy(actorId: string): Promise<number> {
  return ql.count('sys_session', { where: { impersonated_by: actorId } }, SYS);
}

function impersonate(token: string, userId: string) {
  return stack.apiAs(token, 'POST', '/auth/admin/impersonate-user', { userId });
}

/** A complete OIDC registration that lands offline (`skipDiscovery`), under a fresh provider id. */
function registerProvider(token: string): { providerId: string; res: Promise<Response> } {
  const providerId = `held-vendor-doors-${++providerSeq}`;
  const res = stack.apiAs(token, 'POST', '/auth/sso/register', {
    providerId,
    issuer: 'https://idp.example.com',
    domain: `${providerId}.example.com`,
    oidcConfig: {
      clientId: 'client-id',
      clientSecret: 'client-secret',
      skipDiscovery: true,
      authorizationEndpoint: 'https://idp.example.com/authorize',
      tokenEndpoint: 'https://idp.example.com/token',
      jwksEndpoint: 'https://idp.example.com/jwks',
      scopes: ['openid', 'email', 'profile'],
      mapping: { email: 'email', name: 'name' },
    },
  });
  return { providerId, res };
}

async function providerRows(providerId: string): Promise<number> {
  return ql.count('sys_sso_provider', { where: { provider_id: providerId } }, SYS);
}

async function memberName(): Promise<unknown> {
  const row = await ql.findOne('sys_user', { where: { id: memberId }, fields: ['name'] }, SYS);
  return row?.name ?? null;
}

function updateMemberName(token: string, name: string) {
  return stack.apiAs(token, 'POST', '/auth/admin/update-user', { userId: memberId, data: { name } });
}

/** The session gate's refusal, as every door here must answer it. */
async function expectHeldRefusal(res: Response, code: string): Promise<void> {
  expect(res.status).toBe(403);
  const body = (await res.json()) as { success?: boolean; error?: { code?: string; message?: string } };
  expect(body.success).toBe(false);
  expect(body.error?.code).toBe(code);
}

/** Armed, or every refusal below would be vacuous: the protected data read answers the code. */
async function expectArmed(token: string, code: string): Promise<void> {
  const read = await stack.apiAs(token, 'GET', '/data/sys_user?limit=1');
  const body = (await read.json()) as { error?: { code?: string } };
  if (read.status !== 403 || body.error?.code !== code) {
    throw new Error(
      `the ${code} hold is not armed: the protected read answered ${read.status} ` +
        `${JSON.stringify(body)}, so no refusal in this block would test anything`,
    );
  }
}

const everyone = () => [adminId, memberId, scalarId];

describe('controls: unheld callers still pass every door', () => {
  it('a platform admin impersonates (200, the session is the target, one impersonation session)', async () => {
    const before = await impersonationsBy(adminId);
    const res = await impersonate(await stack.signIn(), memberId);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { user?: { id?: string } };
    expect(body.user?.id).toBe(memberId);
    expect(await impersonationsBy(adminId)).toBe(before + 1);
  });

  it('a platform admin registers an SSO provider (200, the row lands)', async () => {
    const { providerId, res } = registerProvider(await stack.signIn());
    expect((await res).status).toBe(200);
    expect(await providerRows(providerId)).toBe(1);
  });

  it('a role-scalar admin updates a user (200, the write lands)', async () => {
    const res = await updateMemberName(await signInScalar(), 'renamed-by-unheld-scalar');
    expect(res.status).toBe(200);
    expect(await memberName()).toBe('renamed-by-unheld-scalar');
  });
});

interface HeldState {
  readonly code: 'PASSWORD_EXPIRED' | 'MFA_REQUIRED' | 'PASSWORD_RESET_REQUIRED';
  arm(): Promise<void>;
  disarm(): Promise<void>;
}

const HELD_STATES: readonly HeldState[] = [
  {
    code: 'PASSWORD_EXPIRED',
    async arm() {
      auth.applyConfigPatch({ passwordExpiryDays: 1 });
      const stale = new Date(Date.now() - 10 * DAY_MS);
      for (const id of everyone()) await ql.update('sys_user', { id, password_changed_at: stale }, SYS);
    },
    async disarm() {
      auth.applyConfigPatch({ passwordExpiryDays: 0 });
      for (const id of everyone()) await ql.update('sys_user', { id, password_changed_at: new Date() }, SYS);
    },
  },
  {
    code: 'MFA_REQUIRED',
    async arm() {
      auth.applyConfigPatch({ mfaRequired: true, mfaGracePeriodDays: 0 });
      const lapsed = new Date(Date.now() - 10 * DAY_MS);
      for (const id of everyone()) await ql.update('sys_user', { id, mfa_required_at: lapsed }, SYS);
    },
    async disarm() {
      auth.applyConfigPatch({ mfaRequired: false });
    },
  },
  {
    code: 'PASSWORD_RESET_REQUIRED',
    async arm() {
      for (const id of everyone()) await ql.update('sys_user', { id, must_change_password: true }, SYS);
      // What the administrator's forced-reset route does after setting the flag.
      auth.noteMustChangePasswordIssued();
    },
    async disarm() {
      for (const id of everyone()) await ql.update('sys_user', { id, must_change_password: false }, SYS);
    },
  },
];

for (const state of HELD_STATES) {
  describe(`a held caller (${state.code})`, () => {
    beforeAll(async () => {
      await state.arm();
      await expectArmed(await stack.signIn(), state.code);
    }, 60_000);

    afterAll(async () => {
      await state.disarm();
    });

    it(`refuses a platform admin's impersonation 403 ${state.code}, and no session is minted`, async () => {
      const before = await impersonationsBy(adminId);
      await expectHeldRefusal(await impersonate(await stack.signIn(), memberId), state.code);
      expect(await impersonationsBy(adminId)).toBe(before);
    });

    it(`refuses a platform admin's SSO-provider registration 403 ${state.code}, and no row lands`, async () => {
      const { providerId, res } = registerProvider(await stack.signIn());
      await expectHeldRefusal(await res, state.code);
      expect(await providerRows(providerId)).toBe(0);
    });

    it(`refuses a role-scalar admin's user update 403 ${state.code}, and the write never lands`, async () => {
      const before = await memberName();
      await expectHeldRefusal(await updateMemberName(await signInScalar(), `renamed-while-${state.code}`), state.code);
      expect(await memberName()).toBe(before);
    });

    it(`refuses a role-scalar admin on every role-scalar action 403 ${state.code}`, async () => {
      const token = await signInScalar();
      for (const [method, path, body] of ROLE_SCALAR_CALLS) {
        const res = await stack.apiAs(token, method, path.replace('MEMBER', memberId), body(memberId));
        await expectHeldRefusal(res, state.code);
      }
    });

    it(`answers a held non-admin at the impersonation door with the posture first (${state.code})`, async () => {
      await expectHeldRefusal(await impersonate(await signInMember(), scalarId), state.code);
    });
  });
}

describe("a hold only the session's organization declares (MFA required by the organization)", () => {
  let organizationId: string | undefined;

  beforeAll(async () => {
    organizationId = (await sessionOf(await stack.signIn())).organizationId;
    if (!organizationId) throw new Error('the platform admin session operates in no organization');
    await ql.update('sys_organization', { id: organizationId, require_mfa: true }, SYS);
    // The 60-second "does any organization require MFA" cache, primed as the
    // background refresh would after this write.
    auth._orgMfaCache = { value: true, at: Date.now() };
    const lapsed = new Date(Date.now() - 10 * DAY_MS);
    for (const id of everyone()) await ql.update('sys_user', { id, mfa_required_at: lapsed }, SYS);
    await expectArmed(await stack.signIn(), 'MFA_REQUIRED');
  }, 60_000);

  afterAll(async () => {
    if (organizationId) await ql.update('sys_organization', { id: organizationId, require_mfa: false }, SYS);
    auth._orgMfaCache = { value: false, at: Date.now() };
  });

  it('holds the admin in that organization and in no other reading (the floor holds no one)', async () => {
    const inOrg = await auth.resolveUserAuthGates(adminId, { organizationId });
    expect(inOrg.map((g: { code: string }) => g.code)).toEqual(['MFA_REQUIRED']);
    expect(await auth.resolveUserAuthGates(adminId, {})).toEqual([]);
  });

  it('refuses the impersonation 403 MFA_REQUIRED, and no session is minted', async () => {
    const before = await impersonationsBy(adminId);
    await expectHeldRefusal(await impersonate(await stack.signIn(), memberId), 'MFA_REQUIRED');
    expect(await impersonationsBy(adminId)).toBe(before);
  });

  it('refuses the SSO-provider registration 403 MFA_REQUIRED, and no row lands', async () => {
    const { providerId, res } = registerProvider(await stack.signIn());
    await expectHeldRefusal(await res, 'MFA_REQUIRED');
    expect(await providerRows(providerId)).toBe(0);
  });

  it('refuses a role-scalar admin user update 403 MFA_REQUIRED, and the write never lands', async () => {
    const before = await memberName();
    await expectHeldRefusal(await updateMemberName(await signInScalar(), 'renamed-under-org-mfa'), 'MFA_REQUIRED');
    expect(await memberName()).toBe(before);
  });
});

describe('a posture lookup that fails holds no one, at the door as for the session', () => {
  const state = HELD_STATES.find((s) => s.code === 'MFA_REQUIRED')!;
  let engine: any;
  let original: unknown;
  let hadOwn = false;

  beforeAll(async () => {
    await state.arm();
    await expectArmed(await stack.signIn(), 'MFA_REQUIRED');
    // Fail exactly the posture computation's own read of the user row.
    engine = auth.getDataEngine();
    hadOwn = Object.prototype.hasOwnProperty.call(engine, 'findOne');
    original = engine.findOne;
    engine.findOne = function (object: string, query: any, ...rest: unknown[]) {
      if (object === 'sys_user' && Array.isArray(query?.fields) && query.fields.includes('mfa_required_at')) {
        return Promise.reject(new Error('posture store unavailable (pin)'));
      }
      return (original as (...a: unknown[]) => unknown).call(this, object, query, ...rest);
    };
  }, 60_000);

  afterAll(async () => {
    if (hadOwn) engine.findOne = original;
    else delete engine.findOne;
    await state.disarm();
  });

  it('the computation answers [] for the held admin (its declared fail-open)', async () => {
    const { organizationId } = await sessionOf(await stack.signIn());
    expect(await auth.resolveUserAuthGates(adminId, { organizationId })).toEqual([]);
  });

  it('the session gate admits the data read, and the impersonation door admits the admin (200)', async () => {
    const token = await stack.signIn();
    expect((await stack.apiAs(token, 'GET', '/data/sys_user?limit=1')).status).toBe(200);
    const before = await impersonationsBy(adminId);
    const res = await impersonate(token, memberId);
    expect(res.status).toBe(200);
    expect(await impersonationsBy(adminId)).toBe(before + 1);
  });
});
