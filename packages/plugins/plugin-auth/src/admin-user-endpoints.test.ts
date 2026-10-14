// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, vi } from 'vitest';
import { assertEngineUpdateDispatch } from '@objectstack/objectql';
import { SysUser } from '@objectstack/platform-objects/identity';
import {
  runAdminCreateUser,
  runAdminSetUserPassword,
  generateTemporaryPassword,
  type AdminUserEndpointDeps,
  type AdminActor,
} from './admin-user-endpoints.js';

const ACTOR: AdminActor = { id: 'admin-1', email: 'admin@example.com' };

function makeRequest(body: unknown): Request {
  return new Request('http://localhost/api/v1/auth/admin/create-user', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function makeDeps(overrides: Partial<Record<string, any>> = {}) {
  const createUser = vi.fn(async ({ body }: any) => ({
    user: { id: 'user-9', email: body.email, name: body.name },
  }));
  const engineUpdate = vi.fn(async () => ({}));
  const engineCreate = vi.fn(async () => ({}));
  const authCtx = {
    password: {
      hash: vi.fn(async (pw: string) => `hashed(${pw})`),
      config: { minPasswordLength: 8, maxPasswordLength: 128 },
    },
    internalAdapter: {
      findUserById: vi.fn(async () => ({ id: 'user-9' })),
      findAccounts: vi.fn(async () => [{ providerId: 'credential' }]),
      updatePassword: vi.fn(async () => ({})),
      createAccount: vi.fn(async () => ({})),
    },
  };
  const warn = vi.fn();
  const noteMustChangePasswordIssued = vi.fn();
  const deps: AdminUserEndpointDeps = {
    getAuthApi: async () => ({ createUser }) as any,
    getAuthContext: async () => authCtx as any,
    getDataEngine: () => ({ update: engineUpdate, insert: engineCreate }),
    assertPasswordComplexity: vi.fn(async () => undefined),
    noteMustChangePasswordIssued,
    logger: { warn },
    ...overrides,
  };
  return { deps, createUser, engineUpdate, engineCreate, authCtx, warn, noteMustChangePasswordIssued };
}

/**
 * Read a mock's recorded calls at their real arity.
 *
 * `vi.fn(async () => ({}))` infers a ZERO-length parameter tuple, so `c[0]` on
 * `mock.calls` is a type error (`TS2493`) even though every recorded call has
 * two arguments — the shape `scripts/check-test-typecheck.mts` ledgers for this
 * file. New assertions go through here so the ledger keeps ratcheting DOWN.
 */
function callsOf(fn: { mock: { calls: unknown[][] } }): Array<[string, any]> {
  return fn.mock.calls as unknown as Array<[string, any]>;
}

/**
 * Security red line (#2766): no mock the endpoint touched may ever have seen
 * the plaintext password outside the better-auth hashing surface.
 */
function expectNoPasswordLeak(mocks: ReturnType<typeof makeDeps>, password: string) {
  const persistedCalls = [
    ...mocks.engineCreate.mock.calls, // audit rows
    ...mocks.warn.mock.calls, // logs
  ];
  for (const call of persistedCalls) {
    expect(JSON.stringify(call)).not.toContain(password);
  }
  // must_change_password stamps must not carry the password either
  for (const call of mocks.engineUpdate.mock.calls) {
    expect(JSON.stringify(call)).not.toContain(password);
  }
}

describe('isLikelyEmail (linear-time, no regex backtracking)', () => {
  it('accepts normal addresses and rejects junk', async () => {
    const { isLikelyEmail } = await import('./admin-user-endpoints.js');
    expect(isLikelyEmail('a@b.co')).toBe(true);
    expect(isLikelyEmail('first.last@sub.example.com')).toBe(true);
    expect(isLikelyEmail('')).toBe(false);
    expect(isLikelyEmail('no-at.example.com')).toBe(false);
    expect(isLikelyEmail('a@b')).toBe(false);
    expect(isLikelyEmail('a@@b.co')).toBe(false);
    expect(isLikelyEmail('a@.co')).toBe(false);
    expect(isLikelyEmail('a@b.')).toBe(false);
    expect(isLikelyEmail('has space@b.co')).toBe(false);
  });

  it('rejects non-ASCII addresses (framework#3566)', async () => {
    const { isLikelyEmail } = await import('./admin-user-endpoints.js');
    // Chinese domain — passes the structural checks but better-auth's strict
    // ASCII validator would reject it, so reject it here (and in the dry-run).
    expect(isLikelyEmail('735431496@柴仟.com')).toBe(false);
    // Full-width / invisible characters anywhere in the address.
    expect(isLikelyEmail('ａｂｃ@b.com')).toBe(false);
    expect(isLikelyEmail('a@b​.com')).toBe(false);
  });

  it('is fast on the CodeQL adversarial inputs', async () => {
    const { isLikelyEmail } = await import('./admin-user-endpoints.js');
    const attack = '!@'.repeat(100_000);
    const attack2 = '!@!.' + '!.'.repeat(100_000);
    const t0 = Date.now();
    expect(isLikelyEmail(attack)).toBe(false);
    expect(isLikelyEmail(attack2)).toBe(false);
    expect(Date.now() - t0).toBeLessThan(200);
  });
});

describe('generateTemporaryPassword', () => {
  it('meets the 4-class complexity policy and min length', () => {
    for (let i = 0; i < 50; i++) {
      const pw = generateTemporaryPassword();
      expect(pw.length).toBeGreaterThanOrEqual(16);
      expect(/[a-z]/.test(pw)).toBe(true);
      expect(/[A-Z]/.test(pw)).toBe(true);
      expect(/[0-9]/.test(pw)).toBe(true);
      expect(/[^A-Za-z0-9]/.test(pw)).toBe(true);
    }
  });

  it('produces distinct values', () => {
    expect(generateTemporaryPassword()).not.toBe(generateTemporaryPassword());
  });
});

describe('runAdminCreateUser', () => {
  it('rejects a missing/invalid email without calling createUser', async () => {
    const m = makeDeps();
    const res = await runAdminCreateUser(m.deps, makeRequest({ name: 'x', generatePassword: true }), ACTOR);
    expect(res.status).toBe(400);
    expect(m.createUser).not.toHaveBeenCalled();

    const res2 = await runAdminCreateUser(m.deps, makeRequest({ email: 'not-an-email', generatePassword: true }), ACTOR);
    expect(res2.status).toBe(400);
  });

  it('rejects when neither password nor generatePassword is provided', async () => {
    // CONTROL for the Setup dialog's one password rule: a caller that is not
    // the dialog and sends neither still gets the 400 — the endpoint's
    // contract did not move when the dialog started sending the constant.
    const m = makeDeps();
    const res = await runAdminCreateUser(m.deps, makeRequest({ email: 'a@b.co' }), ACTOR);
    expect(res.status).toBe(400);
    expect(res.body.error?.code).toBe('INVALID_REQUEST');
    expect(m.createUser).not.toHaveBeenCalled();
  });

  it('prefers an explicit password over generatePassword (console dialog sends both)', async () => {
    const m = makeDeps();
    const res = await runAdminCreateUser(
      m.deps,
      makeRequest({ email: 'a@b.co', password: 'Explicit1!', generatePassword: true }),
      ACTOR,
    );
    expect(res.status).toBe(200);
    expect(m.createUser.mock.calls[0][0].body.password).toBe('Explicit1!');
    // Explicit password → nothing to hand back once; no temporaryPassword leak.
    expect((res.body.data as any).temporaryPassword).toBeUndefined();
  });

  it('still generates when generatePassword is true and the password is empty', async () => {
    const m = makeDeps();
    const res = await runAdminCreateUser(
      m.deps,
      makeRequest({ email: 'a@b.co', password: '', generatePassword: true }),
      ACTOR,
    );
    expect(res.status).toBe(200);
    expect(typeof (res.body.data as any).temporaryPassword).toBe('string');
  });

  it('creates a user via better-auth, stamps must_change_password, audits, and returns the temp password once', async () => {
    const m = makeDeps();
    const res = await runAdminCreateUser(
      m.deps,
      makeRequest({ email: 'New.User@Example.com', generatePassword: true }),
      ACTOR,
    );
    expect(res.status).toBe(200);
    const data = res.body.data as any;
    expect(data.user.id).toBe('user-9');
    // email is normalized to lowercase before hitting better-auth
    expect(m.createUser.mock.calls[0][0].body.email).toBe('new.user@example.com');
    // name defaults to the email local part
    expect(m.createUser.mock.calls[0][0].body.name).toBe('New.User');
    const temp = data.temporaryPassword as string;
    expect(typeof temp).toBe('string');
    expect(temp.length).toBeGreaterThanOrEqual(16);

    // must_change_password stamped true + gate cache primed
    expect(m.engineUpdate).toHaveBeenCalledWith(
      'sys_user',
      { id: 'user-9', must_change_password: true },
      expect.anything(),
    );
    expect(m.noteMustChangePasswordIssued).toHaveBeenCalled();

    // audit row written without password material
    expect(m.engineCreate).toHaveBeenCalledTimes(1);
    const [auditObject, auditRow] = m.engineCreate.mock.calls[0];
    expect(auditObject).toBe('sys_audit_log');
    expect(auditRow.object_name).toBe('sys_user');
    expect(auditRow.record_id).toBe('user-9');
    expect(JSON.parse(auditRow.metadata).passwordGenerated).toBe(true);

    expectNoPasswordLeak(m, temp);
  });

  it('checks complexity for an explicit password and does not return it', async () => {
    const m = makeDeps();
    const res = await runAdminCreateUser(
      m.deps,
      makeRequest({ email: 'a@b.co', password: 'Str0ng!Pass', mustChangePassword: false }),
      ACTOR,
    );
    expect(res.status).toBe(200);
    expect(m.deps.assertPasswordComplexity).toHaveBeenCalledWith('Str0ng!Pass');
    expect((res.body.data as any).temporaryPassword).toBeUndefined();
    // mustChangePassword: false → no stamp
    expect(m.engineUpdate).not.toHaveBeenCalled();
    expectNoPasswordLeak(m, 'Str0ng!Pass');
  });

  it('maps a complexity violation to 400 with the policy code', async () => {
    const m = makeDeps({
      assertPasswordComplexity: vi.fn(async () => {
        throw { code: 'PASSWORD_POLICY_VIOLATION', message: 'too weak' };
      }),
    });
    const res = await runAdminCreateUser(m.deps, makeRequest({ email: 'a@b.co', password: 'weak' }), ACTOR);
    expect(res.status).toBe(400);
    expect(res.body.error?.code).toBe('PASSWORD_POLICY_VIOLATION');
    expect(m.createUser).not.toHaveBeenCalled();
  });

  it('maps USER_ALREADY_EXISTS to 409', async () => {
    const m = makeDeps();
    m.createUser.mockRejectedValueOnce({
      statusCode: 400,
      body: { code: 'USER_ALREADY_EXISTS', message: 'User already exists' },
    });
    const res = await runAdminCreateUser(m.deps, makeRequest({ email: 'a@b.co', generatePassword: true }), ACTOR);
    expect(res.status).toBe(409);
    expect(res.body.error?.code).toBe('USER_ALREADY_EXISTS');
  });

  it('reports mustChangePassword: false when the stamp fails (fail-open honesty)', async () => {
    const m = makeDeps();
    m.engineUpdate.mockRejectedValueOnce(new Error('db down'));
    const res = await runAdminCreateUser(m.deps, makeRequest({ email: 'a@b.co', generatePassword: true }), ACTOR);
    expect(res.status).toBe(200);
    expect((res.body.data as any).mustChangePassword).toBe(false);
    expect(m.warn).toHaveBeenCalled();
    expectNoPasswordLeak(m, (res.body.data as any).temporaryPassword);
  });

  // ── #2766 V1.5: phone-only users ────────────────────────────────────────

  it('rejects phone-only creation when the phoneNumber plugin is off', async () => {
    const m = makeDeps({ phoneNumberEnabled: () => false });
    const res = await runAdminCreateUser(
      m.deps,
      makeRequest({ phoneNumber: '+8613800000000', generatePassword: true }),
      ACTOR,
    );
    expect(res.status).toBe(400);
    expect(m.createUser).not.toHaveBeenCalled();
  });

  it('creates a phone-only user with a placeholder email that never contains the phone number', async () => {
    const m = makeDeps({ phoneNumberEnabled: () => true });
    const res = await runAdminCreateUser(
      m.deps,
      makeRequest({ phoneNumber: '+86 138-0000-0000', generatePassword: true }),
      ACTOR,
    );
    expect(res.status).toBe(200);
    const sent = m.createUser.mock.calls[0][0].body;
    expect(sent.email).toMatch(/@placeholder\.invalid$/);
    expect(sent.email).not.toContain('138');
    expect(sent.data.phoneNumber).toBe('+8613800000000'); // normalized
    expect(sent.name).toBe('+8613800000000'); // defaults to the phone
    expect((res.body.data as any).placeholderEmail).toBe(true);
    expectNoPasswordLeak(m, (res.body.data as any).temporaryPassword);
  });

  it('rejects a malformed phone number', async () => {
    const m = makeDeps({ phoneNumberEnabled: () => true });
    const res = await runAdminCreateUser(
      m.deps,
      makeRequest({ phoneNumber: 'not-a-phone', generatePassword: true }),
      ACTOR,
    );
    expect(res.status).toBe(400);
  });

  it('rejects when neither email nor phone is given', async () => {
    const m = makeDeps({ phoneNumberEnabled: () => true });
    const res = await runAdminCreateUser(m.deps, makeRequest({ generatePassword: true }), ACTOR);
    expect(res.status).toBe(400);
  });

  it('email + phone together: real email wins, phone stored', async () => {
    const m = makeDeps({ phoneNumberEnabled: () => true });
    const res = await runAdminCreateUser(
      m.deps,
      makeRequest({ email: 'a@b.co', phoneNumber: '+8613800000000', generatePassword: true }),
      ACTOR,
    );
    expect(res.status).toBe(200);
    const sent = m.createUser.mock.calls[0][0].body;
    expect(sent.email).toBe('a@b.co');
    expect(sent.data.phoneNumber).toBe('+8613800000000');
    expect((res.body.data as any).placeholderEmail).toBe(false);
  });

  // ── single-org membership: bind the created user to the sole org ─────────

  /**
   * Build deps whose data engine also exposes `find`, seeded with a fixed set
   * of `sys_organization` / `sys_member` rows. Records `sys_member` inserts so
   * a test can assert the membership bind.
   */
  function makeDepsWithOrgs(opts: {
    orgs?: Array<{ id: string; slug?: string }>;
    members?: Array<{ organization_id: string; user_id: string }>;
  }) {
    const orgs = opts.orgs ?? [];
    const members = opts.members ?? [];
    const find = vi.fn(async (object: string, query: any) => {
      const where = query?.where ?? {};
      if (object === 'sys_organization') {
        // Honor the slug filter like the real engine — resolveDefaultOrgId
        // queries { slug: 'default' } first, then an unfiltered top-2.
        const rows = where.slug === undefined ? orgs : orgs.filter((o) => o.slug === where.slug);
        return rows.slice(0, query?.limit ?? rows.length);
      }
      if (object === 'sys_member') {
        return members.filter(
          (m) =>
            (where.organization_id === undefined || m.organization_id === where.organization_id) &&
            (where.user_id === undefined || m.user_id === where.user_id),
        );
      }
      return [];
    });
    const engineUpdate = vi.fn(async (_obj: string, data: any, options?: any) => {
      assertEngineUpdateDispatch(data, options);
      return {};
    });
    const engineInsert = vi.fn(async () => ({}));
    const m = makeDeps({
      getDataEngine: () => ({ update: engineUpdate, insert: engineInsert, find }),
    });
    return { ...m, find, engineUpdate, engineInsert };
  }

  it('binds the created user to the sole organization (single-org)', async () => {
    const m = makeDepsWithOrgs({ orgs: [{ id: 'org_only' }] });
    const res = await runAdminCreateUser(
      m.deps,
      makeRequest({ email: 'a@b.co', generatePassword: true }),
      ACTOR,
    );
    expect(res.status).toBe(200);
    const data = res.body.data as any;
    expect(data.organizationId).toBe('org_only');
    expect(data.membershipCreated).toBe(true);

    const memberInsert = m.engineInsert.mock.calls.find((c) => c[0] === 'sys_member');
    expect(memberInsert).toBeTruthy();
    expect(memberInsert![1]).toMatchObject({
      organization_id: 'org_only',
      user_id: 'user-9',
      role: 'member',
    });
    // audit records the membership outcome
    const auditRow = m.engineInsert.mock.calls.find((c) => c[0] === 'sys_audit_log')![1];
    const meta = JSON.parse(auditRow.metadata);
    expect(meta.organizationId).toBe('org_only');
    expect(meta.membershipCreated).toBe(true);
  });

  it('does NOT bind when the org is ambiguous (multi-org, ≥2 orgs)', async () => {
    const m = makeDepsWithOrgs({ orgs: [{ id: 'org_a' }, { id: 'org_b' }] });
    const res = await runAdminCreateUser(
      m.deps,
      makeRequest({ email: 'a@b.co', generatePassword: true }),
      ACTOR,
    );
    expect(res.status).toBe(200);
    const data = res.body.data as any;
    expect(data.organizationId).toBeUndefined();
    expect(data.membershipCreated).toBe(false);
    expect(m.engineInsert.mock.calls.some((c) => c[0] === 'sys_member')).toBe(false);
  });

  it('is idempotent when a membership already exists', async () => {
    const m = makeDepsWithOrgs({
      orgs: [{ id: 'org_only' }],
      members: [{ organization_id: 'org_only', user_id: 'user-9' }],
    });
    const res = await runAdminCreateUser(
      m.deps,
      makeRequest({ email: 'a@b.co', generatePassword: true }),
      ACTOR,
    );
    expect(res.status).toBe(200);
    const data = res.body.data as any;
    expect(data.organizationId).toBe('org_only');
    expect(data.membershipCreated).toBe(false);
    expect(m.engineInsert.mock.calls.some((c) => c[0] === 'sys_member')).toBe(false);
  });

  it('does not fail account creation when the membership bind throws', async () => {
    const m = makeDepsWithOrgs({ orgs: [{ id: 'org_only' }] });
    m.engineInsert.mockImplementation(async (object: string) => {
      if (object === 'sys_member') throw new Error('unique violation');
      return {};
    });
    const res = await runAdminCreateUser(
      m.deps,
      makeRequest({ email: 'a@b.co', generatePassword: true }),
      ACTOR,
    );
    expect(res.status).toBe(200);
    const data = res.body.data as any;
    expect(data.user.id).toBe('user-9');
    expect(data.membershipCreated).toBe(false);
    expect(m.warn).toHaveBeenCalled();
  });

  it('multi-org via tenancy: does NOT bind even when a slug=default org exists (ADR-0093 D3 regression)', async () => {
    // A multi-org deployment carries the bootstrap default org NEXT TO real
    // tenant orgs. Without the tenancy service the raw resolver would prefer
    // slug='default' and mis-bind the new user into it; the tenancy service
    // reports multi mode (defaultOrgId → null) and the bind must no-op.
    const m = makeDepsWithOrgs({
      orgs: [{ id: 'org_default', slug: 'default' }, { id: 'org_tenant_b' }],
    });
    m.deps.getTenancy = () => ({ defaultOrgId: async () => null });
    const res = await runAdminCreateUser(
      m.deps,
      makeRequest({ email: 'a@b.co', generatePassword: true }),
      ACTOR,
    );
    expect(res.status).toBe(200);
    const data = res.body.data as any;
    expect(data.organizationId).toBeUndefined();
    expect(data.membershipCreated).toBe(false);
    expect(m.engineInsert.mock.calls.some((c) => c[0] === 'sys_member')).toBe(false);
  });

  it('single-org via tenancy: binds to the org the tenancy service resolves', async () => {
    const m = makeDepsWithOrgs({ orgs: [{ id: 'org_default', slug: 'default' }] });
    m.deps.getTenancy = () => ({ defaultOrgId: async () => 'org_default' });
    const res = await runAdminCreateUser(
      m.deps,
      makeRequest({ email: 'a@b.co', generatePassword: true }),
      ACTOR,
    );
    expect(res.status).toBe(200);
    const data = res.body.data as any;
    expect(data.organizationId).toBe('org_default');
    expect(data.membershipCreated).toBe(true);
  });

  // ── ADR-0093 D1: the deployment membership policy governs THIS path too ──
  //
  // The endpoint used to hand the reconciler a literal `policy: 'auto'`, so an
  // `invite-only` deployment — where the `user.create.after` reconciler and the
  // D6 backfill both correctly bound nobody — got the membership bound anyway
  // by this belt-and-suspenders call, and a `membershipCreated: true` that read
  // as success. The failure direction was OPEN: it GRANTED what the policy is
  // set to withhold. Nothing pinned either direction before these tests, which
  // is why the literal survived.

  it("invite-only: creates the account and binds NO membership (ADR-0093 D1)", async () => {
    const m = makeDepsWithOrgs({ orgs: [{ id: 'org_only' }] });
    m.deps.getMembershipPolicy = () => 'invite-only';
    const res = await runAdminCreateUser(
      m.deps,
      makeRequest({ email: 'a@b.co', generatePassword: true }),
      ACTOR,
    );

    // The ACCOUNT is still created — `invite-only` withholds the membership,
    // not the login. That distinction is the whole ruling.
    expect(res.status).toBe(200);
    expect(m.createUser).toHaveBeenCalledTimes(1);

    const data = res.body.data as any;
    expect(data.user.id).toBe('user-9');
    expect(data.membershipCreated).toBe(false);
    expect(data.organizationId).toBeUndefined();
    expect(callsOf(m.engineInsert).some((c) => c[0] === 'sys_member')).toBe(false);

    // `policy-skip` is decided BEFORE any target-org resolution, so the org
    // lookup never runs. This separates "policy said no" from "no target org
    // was found" — two outcomes that would both show membershipCreated:false.
    expect(m.find.mock.calls.some((c) => c[0] === 'sys_organization')).toBe(false);

    // The audit row records the refusal, so the trail shows the account was
    // created member-less on purpose rather than by a failed bind.
    const auditRow = callsOf(m.engineInsert).find((c) => c[0] === 'sys_audit_log')?.[1];
    expect(auditRow).toBeTruthy();
    const meta = JSON.parse(auditRow.metadata);
    expect(meta.membershipCreated).toBe(false);
    expect(meta.organizationId).toBeUndefined();
  });

  it('invite-only in multi-org mode: also binds nothing (both reasons hold)', async () => {
    const m = makeDepsWithOrgs({
      orgs: [{ id: 'org_default', slug: 'default' }, { id: 'org_tenant_b' }],
    });
    m.deps.getTenancy = () => ({ defaultOrgId: async () => null });
    m.deps.getMembershipPolicy = () => 'invite-only';
    const res = await runAdminCreateUser(
      m.deps,
      makeRequest({ email: 'a@b.co', generatePassword: true }),
      ACTOR,
    );
    expect(res.status).toBe(200);
    const data = res.body.data as any;
    expect(data.membershipCreated).toBe(false);
    expect(data.organizationId).toBeUndefined();
    expect(callsOf(m.engineInsert).some((c) => c[0] === 'sys_member')).toBe(false);
  });

  it('auto (explicit): still binds — the default posture is untouched', async () => {
    const m = makeDepsWithOrgs({ orgs: [{ id: 'org_only' }] });
    m.deps.getMembershipPolicy = () => 'auto';
    const res = await runAdminCreateUser(
      m.deps,
      makeRequest({ email: 'a@b.co', generatePassword: true }),
      ACTOR,
    );
    expect(res.status).toBe(200);
    const data = res.body.data as any;
    expect(data.organizationId).toBe('org_only');
    expect(data.membershipCreated).toBe(true);
    expect(callsOf(m.engineInsert).some((c) => c[0] === 'sys_member')).toBe(true);
  });

  /**
   * NEGATIVE CONTROL (the ruling requires it, and it is not decorative).
   *
   * Under `auto` the behaviour must be BYTE-IDENTICAL to the pre-change
   * literal. A green `invite-only` assertion alone would also be green if the
   * endpoint had been changed to "never bind": that mistake passes the pin
   * above and silently breaks every default deployment. So compare the whole
   * observable surface — response body and every engine write — across the
   * three ways `auto` can be reached: an explicit `'auto'`, no policy dep at
   * all (unwired host: the accessor's own `?? 'auto'` default), and a dep that
   * is present but returns `undefined`.
   *
   * `sys_member.id` is a fresh random id per run, so it is normalized out;
   * everything else, including the audit metadata JSON, is compared verbatim.
   * The password is passed explicitly so no random temporary one is minted.
   */
  async function autoPathSurface(
    policyDep: undefined | (() => any),
  ): Promise<{ body: string; writes: string }> {
    const m = makeDepsWithOrgs({ orgs: [{ id: 'org_only' }] });
    if (policyDep) m.deps.getMembershipPolicy = policyDep as any;
    const res = await runAdminCreateUser(
      m.deps,
      makeRequest({ email: 'a@b.co', password: 'Sup3rSecret!x' }),
      ACTOR,
    );
    const writes = callsOf(m.engineInsert).map(([object, doc]) => [
      object,
      object === 'sys_member' ? { ...doc, id: '(generated)' } : doc,
    ]);
    return { body: JSON.stringify(res.body), writes: JSON.stringify(writes) };
  }

  it('auto: byte-identical across explicit / unwired / undefined policy deps', async () => {
    const explicitAuto = await autoPathSurface(() => 'auto');
    const unwired = await autoPathSurface(undefined);
    const returnsUndefined = await autoPathSurface(() => undefined);

    expect(unwired).toEqual(explicitAuto);
    expect(returnsUndefined).toEqual(explicitAuto);

    // And the shared surface is the BINDING one — a suite that agreed on
    // "nothing happened" three times would satisfy the equalities above.
    expect(explicitAuto.body).toContain('"membershipCreated":true');
    expect(explicitAuto.writes).toContain('sys_member');
  });

  it('no-ops the bind (no throw) when the engine has no find surface', async () => {
    // Default makeDeps engine exposes only update/insert — the bind must be a
    // clean no-op, leaving exactly the audit insert.
    const m = makeDeps();
    const res = await runAdminCreateUser(
      m.deps,
      makeRequest({ email: 'a@b.co', generatePassword: true }),
      ACTOR,
    );
    expect(res.status).toBe(200);
    expect((res.body.data as any).membershipCreated).toBe(false);
    expect((res.body.data as any).organizationId).toBeUndefined();
    expect(m.engineCreate).toHaveBeenCalledTimes(1); // audit only
  });
});

describe('runAdminSetUserPassword', () => {
  it('requires userId', async () => {
    const m = makeDeps();
    const res = await runAdminSetUserPassword(m.deps, makeRequest({ generatePassword: true }), ACTOR);
    expect(res.status).toBe(400);
  });

  it('404s for an unknown user', async () => {
    const m = makeDeps();
    m.authCtx.internalAdapter.findUserById.mockResolvedValueOnce(null);
    const res = await runAdminSetUserPassword(
      m.deps,
      makeRequest({ userId: 'ghost', generatePassword: true }),
      ACTOR,
    );
    expect(res.status).toBe(404);
  });

  it('updates the credential account when one exists', async () => {
    const m = makeDeps();
    const res = await runAdminSetUserPassword(
      m.deps,
      makeRequest({ userId: 'user-9', newPassword: 'Str0ng!Pass' }),
      ACTOR,
    );
    expect(res.status).toBe(200);
    expect(m.authCtx.password.hash).toHaveBeenCalledWith('Str0ng!Pass');
    expect(m.authCtx.internalAdapter.updatePassword).toHaveBeenCalledWith('user-9', 'hashed(Str0ng!Pass)');
    expect(m.authCtx.internalAdapter.createAccount).not.toHaveBeenCalled();
    // default mustChangePassword: true
    expect(m.engineUpdate).toHaveBeenCalledWith(
      'sys_user',
      { id: 'user-9', must_change_password: true },
      expect.anything(),
    );
    expectNoPasswordLeak(m, 'Str0ng!Pass');
  });

  it('creates a credential account for SSO-onboarded users without one', async () => {
    const m = makeDeps();
    m.authCtx.internalAdapter.findAccounts.mockResolvedValueOnce([{ providerId: 'oidc' }]);
    const res = await runAdminSetUserPassword(
      m.deps,
      makeRequest({ userId: 'user-9', generatePassword: true }),
      ACTOR,
    );
    expect(res.status).toBe(200);
    expect(m.authCtx.internalAdapter.createAccount).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'user-9', providerId: 'credential' }),
    );
    const temp = (res.body.data as any).temporaryPassword as string;
    expect(typeof temp).toBe('string');
    expectNoPasswordLeak(m, temp);
  });

  it('enforces better-auth min password length', async () => {
    const m = makeDeps();
    const res = await runAdminSetUserPassword(
      m.deps,
      makeRequest({ userId: 'user-9', newPassword: 'Ab1!' }),
      ACTOR,
    );
    expect(res.status).toBe(400);
    expect(m.authCtx.internalAdapter.updatePassword).not.toHaveBeenCalled();
  });

  it('mustChangePassword: false clears any pending flag instead of setting it', async () => {
    const m = makeDeps();
    const res = await runAdminSetUserPassword(
      m.deps,
      makeRequest({ userId: 'user-9', newPassword: 'Str0ng!Pass', mustChangePassword: false }),
      ACTOR,
    );
    expect(res.status).toBe(200);
    expect(m.engineUpdate).toHaveBeenCalledWith(
      'sys_user',
      { id: 'user-9', must_change_password: false },
      expect.anything(),
    );
    expect((res.body.data as any).mustChangePassword).toBe(false);
  });

  it('audits without password material', async () => {
    const m = makeDeps();
    await runAdminSetUserPassword(m.deps, makeRequest({ userId: 'user-9', generatePassword: true }), ACTOR);
    const [auditObject, auditRow] = m.engineCreate.mock.calls[0];
    expect(auditObject).toBe('sys_audit_log');
    const meta = JSON.parse(auditRow.metadata);
    expect(meta.event).toBe('user.admin_password_set');
    expect(meta.passwordGenerated).toBe(true);
  });

  it('prefers an explicit newPassword over generatePassword (the dialog sends both)', async () => {
    const m = makeDeps();
    const res = await runAdminSetUserPassword(
      m.deps,
      makeRequest({ userId: 'user-9', newPassword: 'Str0ng!Pass', generatePassword: true }),
      ACTOR,
    );
    expect(res.status).toBe(200);
    expect(m.authCtx.internalAdapter.updatePassword).toHaveBeenCalledWith('user-9', 'hashed(Str0ng!Pass)');
    expect((res.body.data as any).temporaryPassword).toBeUndefined();
  });

  it('generates when generatePassword is true and newPassword is empty', async () => {
    const m = makeDeps();
    const res = await runAdminSetUserPassword(
      m.deps,
      makeRequest({ userId: 'user-9', newPassword: '', generatePassword: true }),
      ACTOR,
    );
    expect(res.status).toBe(200);
    const temp = (res.body.data as any).temporaryPassword as string;
    expect(typeof temp).toBe('string');
    expect(m.authCtx.internalAdapter.updatePassword).toHaveBeenCalledWith('user-9', `hashed(${temp})`);
  });

  it('rejects when neither newPassword nor generatePassword is provided', async () => {
    // CONTROL, as for create-user: a caller that is not the dialog and sends
    // neither still gets the 400, and nothing is written.
    const m = makeDeps();
    const res = await runAdminSetUserPassword(m.deps, makeRequest({ userId: 'user-9' }), ACTOR);
    expect(res.status).toBe(400);
    expect(res.body.error?.code).toBe('INVALID_REQUEST');
    expect(m.authCtx.internalAdapter.updatePassword).not.toHaveBeenCalled();
    expect(m.authCtx.internalAdapter.createAccount).not.toHaveBeenCalled();
  });
});

// ── The Setup dialogs: the password field is the one rule ──────────────────
//
// `sys_user`'s `create_user` and `set_user_password` actions are this
// endpoint's first-party callers. Their dialog offers one rule — the password
// field's own label, "leave empty to generate" — so `generatePassword` is not a
// control the admin sees: it rides in `bodyExtra` as a constant, and the
// explicit-wins rule above turns that into the label's behaviour. A ticked box
// beside a typed password was a control the server ignored.
//
// These pins read the DECLARED actions and compose the request body the way
// the console does for a `type: 'api'` action: the values the dialog collected,
// the `recordIdParam`, then `bodyExtra` merged last (the spec's documented
// semantics for that key). The dialog submits only the params it shows, so a
// param left out of `params` is never on the wire — `bodyExtra` is the one
// place a constant the admin does not see can come from.
describe('Setup dialogs: one password rule (sys_user create_user / set_user_password)', () => {
  function declaredAction(name: string) {
    const action = (SysUser.actions ?? []).find((a) => a.name === name);
    if (!action) throw new Error(`sys_user declares no action named "${name}"`);
    return action;
  }

  function dialogBody(name: string, collected: Record<string, unknown>, recordId?: string) {
    const action = declaredAction(name);
    const body: Record<string, unknown> = { ...collected };
    if (action.recordIdParam && recordId !== undefined) body[action.recordIdParam] = recordId;
    return { ...body, ...(action.bodyExtra ?? {}) };
  }

  const DIALOGS = [
    {
      action: 'create_user',
      explicitKey: 'password',
      base: { email: 'a@b.co', mustChangePassword: true },
      recordId: undefined,
      run: (m: ReturnType<typeof makeDeps>, body: Record<string, unknown>) =>
        runAdminCreateUser(m.deps, makeRequest(body), ACTOR),
      appliedPassword: (m: ReturnType<typeof makeDeps>) =>
        callsOf(m.createUser).map((c) => (c[0] as unknown as { body: { password: string } }).body.password),
    },
    {
      action: 'set_user_password',
      explicitKey: 'newPassword',
      base: { mustChangePassword: true },
      recordId: 'user-9',
      run: (m: ReturnType<typeof makeDeps>, body: Record<string, unknown>) =>
        runAdminSetUserPassword(m.deps, makeRequest(body), ACTOR),
      appliedPassword: (m: ReturnType<typeof makeDeps>) =>
        callsOf(m.authCtx.password.hash).map((c) => c[0]),
    },
  ] as const;

  for (const d of DIALOGS) {
    it(`${d.action}: offers no generatePassword control and sends it as a constant`, () => {
      const action = declaredAction(d.action);
      const offered = (action.params ?? []).map((p) => p.name ?? p.field);
      expect(offered).toContain(d.explicitKey);
      expect(offered).not.toContain('generatePassword');
      expect(action.bodyExtra?.generatePassword).toBe(true);
    });

    it(`${d.action}: a typed password is the one applied, and nothing is generated`, async () => {
      const m = makeDeps();
      const body = dialogBody(d.action, { ...d.base, [d.explicitKey]: 'Explicit1!' }, d.recordId);
      const res = await d.run(m, body);
      expect(res.status).toBe(200);
      expect(d.appliedPassword(m)).toEqual(['Explicit1!']);
      expect((res.body.data as any).temporaryPassword).toBeUndefined();
    });

    for (const [shape, collected] of [
      ['left untouched (absent)', {}],
      ['typed then cleared (empty string)', { [d.explicitKey]: '' }],
    ] as const) {
      it(`${d.action}: a password ${shape} generates a temporary one, returned once`, async () => {
        const m = makeDeps();
        const body = dialogBody(d.action, { ...d.base, ...collected }, d.recordId);
        const res = await d.run(m, body);
        expect(res.status).toBe(200);
        const temp = (res.body.data as any).temporaryPassword as string;
        expect(typeof temp).toBe('string');
        expect(d.appliedPassword(m)).toEqual([temp]);
        expectNoPasswordLeak(m, temp);
      });
    }
  }
});

// ── The ledger row records the admin's decisions, never a field value ──────
//
// `sys_audit_log.metadata` is free text. The ledger's read side narrows the
// before/after snapshot columns to what each reader is served; it cannot
// narrow `metadata` without mapping decision names back to fields, which would
// derive masking a second time. So the producer must not put a value it wrote
// into a field of the user there: that value is on plugin-audit's mirror row
// for the same write, in a column the read side narrows. These pins hold the
// row to its decisions and its reference (`object_name` + `record_id`).
describe('admin ledger rows: decisions and a reference, never a field value of the user', () => {
  const CREATE_DECISIONS = ['event', 'membershipCreated', 'passwordGenerated', 'placeholderEmail'];
  // [#23287] The forced reset's revocation switch is a decision too (on by
  // default), and what it landed is recorded as counts beside it.
  const PASSWORD_SET_DECISIONS = [
    'event',
    'passwordGenerated',
    'revocationComplete',
    'revokeSessionsAndKeys',
    'revokedApiKeys',
    'revokedSessions',
  ];

  /** Normalise a key so a camelCase metadata key and a snake_case field name compare equal. */
  const norm = (k: string) => k.replace(/_/g, '').toLowerCase();

  /** Every field this call wrote on the user, with the value it wrote. */
  function userFieldWrites(m: ReturnType<typeof makeDeps>): Array<[string, unknown]> {
    const writes: Array<[string, unknown]> = [];
    for (const call of m.createUser.mock.calls) {
      const { data, ...body } = call[0].body as Record<string, any>;
      for (const [k, v] of Object.entries({ ...body, ...(data ?? {}) })) {
        if (k !== 'password') writes.push([k, v]);
      }
    }
    for (const [object, doc] of callsOf(m.engineUpdate)) {
      if (object !== 'sys_user') continue;
      for (const [k, v] of Object.entries(doc as Record<string, unknown>)) {
        if (k !== 'id') writes.push([k, v]);
      }
    }
    return writes;
  }

  /** The one ledger row the call wrote, with its metadata parsed. */
  function ledgerRow(m: ReturnType<typeof makeDeps>, insert = m.engineCreate) {
    const rows = callsOf(insert).filter(([object]) => object === 'sys_audit_log');
    expect(rows).toHaveLength(1);
    const row = rows[0][1] as Record<string, any>;
    return { row, metadata: JSON.parse(row.metadata) as Record<string, unknown> };
  }

  /** No metadata key names a written field, and no metadata value is a written string value. */
  function expectNoFieldValue(metadata: Record<string, unknown>, writes: Array<[string, unknown]>) {
    expect(writes.length).toBeGreaterThan(0);
    const keys = new Set(Object.keys(metadata).map(norm));
    const blob = JSON.stringify(metadata);
    for (const [field, value] of writes) {
      expect(keys.has(norm(field)), `metadata names the written field ${field}`).toBe(false);
      if (typeof value === 'string' && value.length > 0) {
        expect(blob.includes(value), `metadata carries the value written to ${field}`).toBe(false);
      }
    }
  }

  it('create-user: the row carries the closed decision set and none of the values written into the user', async () => {
    const m = makeDeps({ phoneNumberEnabled: () => true });
    const res = await runAdminCreateUser(
      m.deps,
      makeRequest({
        email: 'Ledger.Subject@Example.com',
        name: 'Ledger Subject',
        role: 'ledgerrole',
        phoneNumber: '+8613811112222',
        generatePassword: true,
      }),
      ACTOR,
    );
    expect(res.status).toBe(200);
    const writes = userFieldWrites(m);
    // Armed: the call really wrote the identity, the role scalar, the phone
    // and the must-change-password stamp, so the row had them to copy.
    expect(writes.map(([k]) => norm(k)).sort()).toEqual(
      ['email', 'mustchangepassword', 'name', 'phonenumber', 'role'],
    );

    const { row, metadata } = ledgerRow(m);
    expect(row.object_name).toBe('sys_user');
    expect(row.record_id).toBe('user-9');
    expect(Object.keys(metadata).sort()).toEqual(CREATE_DECISIONS);
    expect(metadata).toMatchObject({ event: 'user.admin_created', placeholderEmail: false, passwordGenerated: true });
    expectNoFieldValue(metadata, writes);
  });

  it('create-user, phone-only: the placeholder decision is recorded, the generated address is not', async () => {
    const m = makeDeps({ phoneNumberEnabled: () => true });
    const res = await runAdminCreateUser(
      m.deps,
      makeRequest({ phoneNumber: '+8613833334444', generatePassword: true }),
      ACTOR,
    );
    expect(res.status).toBe(200);
    const { metadata } = ledgerRow(m);
    expect(Object.keys(metadata).sort()).toEqual(CREATE_DECISIONS);
    expect(metadata.placeholderEmail).toBe(true);
    expectNoFieldValue(metadata, userFieldWrites(m));
  });

  it('create-user, membership bound: the organization rides as a reference beside the decisions', async () => {
    const m = makeDeps();
    const engineInsert = vi.fn(async () => ({}));
    const find = vi.fn(async (object: string) => (object === 'sys_organization' ? [{ id: 'org_only' }] : []));
    m.deps.getDataEngine = () => ({ update: m.engineUpdate, insert: engineInsert, find });
    const res = await runAdminCreateUser(
      m.deps,
      makeRequest({ email: 'bound.subject@example.com', role: 'boundrole', generatePassword: true }),
      ACTOR,
    );
    expect(res.status).toBe(200);
    const { metadata } = ledgerRow(m, engineInsert);
    expect(Object.keys(metadata).sort()).toEqual([...CREATE_DECISIONS, 'organizationId'].sort());
    expect(metadata).toMatchObject({ organizationId: 'org_only', membershipCreated: true });
    expectNoFieldValue(metadata, userFieldWrites(m));
  });

  it('set-user-password: the row carries the closed decision set and not the stamp it wrote', async () => {
    const m = makeDeps();
    const res = await runAdminSetUserPassword(
      m.deps,
      makeRequest({ userId: 'user-9', generatePassword: true }),
      ACTOR,
    );
    expect(res.status).toBe(200);
    const writes = userFieldWrites(m);
    // Armed: the stamp really was written on the user.
    expect(writes.map(([k]) => norm(k))).toEqual(['mustchangepassword']);

    const { row, metadata } = ledgerRow(m);
    expect(row.object_name).toBe('sys_user');
    expect(row.record_id).toBe('user-9');
    expect(Object.keys(metadata).sort()).toEqual(PASSWORD_SET_DECISIONS);
    expect(metadata).toMatchObject({ event: 'user.admin_password_set', passwordGenerated: true });
    expectNoFieldValue(metadata, writes);
  });
});

// ── [#23287 — ruling C′ item 2] the forced reset's revocation switch ──────
//
// The forced reset raises `PASSWORD_RESET_REQUIRED`, a `credential`-scope
// posture: it holds the password sign-in and NOT the user's API keys. The
// administrator's act therefore carries an explicit switch that revokes the
// user's sessions and keys, ON by default (the act records no reason, and the
// default is the one for a suspected compromise). Both positions pinned, plus
// the honesty of an incomplete revocation.
describe('set-user-password: the revoke-sessions-and-keys switch (#23287)', () => {
  const FUTURE = () => new Date(Date.now() + 86_400_000).toISOString();
  const PAST = () => new Date(Date.now() - 86_400_000).toISOString();

  /** The data engine with a read surface over the user's sessions and keys. */
  function withCredentials(m: ReturnType<typeof makeDeps>) {
    const find = vi.fn(async (object: string, q: any) => {
      if (object === 'sys_session') {
        return [
          { id: 'sess_live', expires_at: FUTURE() },
          { id: 'sess_no_expiry' },
          { id: 'sess_already_revoked', expires_at: FUTURE(), revoked_at: PAST() },
          { id: 'sess_expired', expires_at: PAST() },
        ];
      }
      if (object === 'sys_api_key') return q?.where?.revoked === false && q?.where?.user_id === 'user-9' ? [{ id: 'key_1' }, { id: 'key_2' }] : [];
      return [];
    });
    m.deps.getDataEngine = () => ({ update: m.engineUpdate, insert: m.engineCreate, find });
    return find;
  }

  const writesTo = (m: ReturnType<typeof makeDeps>, object: string) =>
    callsOf(m.engineUpdate).filter(([o]) => o === object).map(([, doc]) => doc);

  it('DEFAULT ON: revokes every live session and every unrevoked API key, after the password is set', async () => {
    const m = makeDeps();
    withCredentials(m);
    const res = await runAdminSetUserPassword(
      m.deps,
      makeRequest({ userId: 'user-9', newPassword: 'Str0ng!Pass' }),
      ACTOR,
    );
    expect(res.status).toBe(200);
    const data = res.body.data as any;
    expect(data.revokeSessionsAndKeys).toBe(true);
    expect(data.revoked).toEqual({ sessions: 2, apiKeys: 2, failed: 0, complete: true });

    const sessions = writesTo(m, 'sys_session');
    expect(sessions.map((d) => d.id).sort()).toEqual(['sess_live', 'sess_no_expiry']);
    for (const doc of sessions) {
      expect(doc.revoke_reason).toBe('admin_password_reset');
      expect(doc.expires_at instanceof Date && doc.expires_at.getTime() < Date.now()).toBe(true);
      expect(doc.revoked_at instanceof Date).toBe(true);
    }
    expect(writesTo(m, 'sys_api_key')).toEqual([
      { id: 'key_1', revoked: true },
      { id: 'key_2', revoked: true },
    ]);
    // The new password landed BEFORE anything was revoked.
    const pw = m.authCtx.internalAdapter.updatePassword.mock.invocationCallOrder[0];
    const firstRevoke = m.engineUpdate.mock.invocationCallOrder[
      callsOf(m.engineUpdate).findIndex(([o]) => o === 'sys_session')
    ];
    expect(pw).toBeLessThan(firstRevoke);
    expectNoPasswordLeak(m, 'Str0ng!Pass');
  });

  it('OFF: `revokeSessionsAndKeys: false` revokes nothing and says so', async () => {
    const m = makeDeps();
    const find = withCredentials(m);
    const res = await runAdminSetUserPassword(
      m.deps,
      makeRequest({ userId: 'user-9', newPassword: 'Str0ng!Pass', revokeSessionsAndKeys: false }),
      ACTOR,
    );
    expect(res.status).toBe(200);
    const data = res.body.data as any;
    expect(data.revokeSessionsAndKeys).toBe(false);
    expect(data.revoked).toBeUndefined();
    expect(writesTo(m, 'sys_session')).toEqual([]);
    expect(writesTo(m, 'sys_api_key')).toEqual([]);
    expect(find.mock.calls.filter(([o]) => o === 'sys_session' || o === 'sys_api_key')).toEqual([]);
  });

  it('only a literal `false` turns it off: a malformed value keeps the safe default', async () => {
    const m = makeDeps();
    withCredentials(m);
    const res = await runAdminSetUserPassword(
      m.deps,
      makeRequest({ userId: 'user-9', newPassword: 'Str0ng!Pass', revokeSessionsAndKeys: 'no' }),
      ACTOR,
    );
    expect((res.body.data as any).revoked).toEqual({ sessions: 2, apiKeys: 2, failed: 0, complete: true });
  });

  it('a refused write is reported, never silent: complete false, the reset still succeeds', async () => {
    const m = makeDeps();
    withCredentials(m);
    m.engineUpdate.mockImplementation((async (object: string, doc: any) => {
      if (object === 'sys_api_key' && doc?.id === 'key_2') throw new Error('write refused');
      return {};
    }) as any);
    const res = await runAdminSetUserPassword(
      m.deps,
      makeRequest({ userId: 'user-9', newPassword: 'Str0ng!Pass' }),
      ACTOR,
    );
    expect(res.status).toBe(200);
    expect((res.body.data as any).revoked).toEqual({ sessions: 2, apiKeys: 1, failed: 1, complete: false });
    expect(m.warn.mock.calls.map((c) => String(c[0])).some((l) => l.includes('revocation INCOMPLETE'))).toBe(true);
  });

  it('an engine with no read surface cannot measure the revocation, so it is never reported complete', async () => {
    const m = makeDeps();
    const res = await runAdminSetUserPassword(
      m.deps,
      makeRequest({ userId: 'user-9', newPassword: 'Str0ng!Pass' }),
      ACTOR,
    );
    expect((res.body.data as any).revoked).toEqual({ sessions: 0, apiKeys: 0, failed: 0, complete: false });
  });
});
