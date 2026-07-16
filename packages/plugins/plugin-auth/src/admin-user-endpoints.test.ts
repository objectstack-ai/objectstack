// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, vi } from 'vitest';
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
    const m = makeDeps();
    const res = await runAdminCreateUser(m.deps, makeRequest({ email: 'a@b.co' }), ACTOR);
    expect(res.status).toBe(400);
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
    const engineUpdate = vi.fn(async () => ({}));
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
});
