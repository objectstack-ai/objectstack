// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#25338] Create User can grant a permission set in the same step — measured
 * on the real route, with the real security plugin judging the grant.
 *
 * The grant is the one Setup's "Permission Sets → New" writes: a
 * `sys_user_permission_set` insert under the CALLER's own context, so the
 * ADR-0090 D12 delegated-administration gate decides it. The gate is also the
 * only writer that stamps `granted_by` on a non-system insert (a system write
 * keeps the id or null it wrote), so `granted_by === the admin` is the
 * evidence the grant went through the gate and not around it.
 *
 *   G1  assigned: the account and its grant both land; `granted_by` is the admin.
 *   G2  a name the catalog does not hold is refused 400, and the account rolls
 *       back with it — no user is left without the access that was asked for.
 *   G3  a caller without the authority to create users is refused 403, and
 *       nothing is written.
 *
 * Harness: the admin identity routes 501 unless better-auth's `admin` plugin
 * is on; `OS_SCIM_ENABLED` is the one env knob that reaches it (see
 * `admin-identity-audit-trail.dogfood.test.ts`, which documents the derivation).
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { type VerifyStack } from '@objectstack/verify';
import { bootShowcase } from './showcase-boot.js';

const SYSTEM_CTX = { isSystem: true };
/** A showcase permission set without administration (`examples/app-showcase`). */
const GRANTED_SET = 'showcase_contributor';

async function findRows(ql: any, object: string, where: any, limit = 50): Promise<any[]> {
  const rows = await ql.find(object, { where, limit }, { context: SYSTEM_CTX });
  return Array.isArray(rows) ? rows : (rows?.records ?? []);
}

describe('#25338: Create User grants a permission set through the delegated-administration gate', () => {
  let stack: VerifyStack;
  let ql: any;
  let adminToken: string;
  let adminUserId: string;
  let priorScim: string | undefined;

  beforeAll(async () => {
    priorScim = process.env.OS_SCIM_ENABLED;
    process.env.OS_SCIM_ENABLED = 'true';
    stack = await bootShowcase();
    adminToken = await stack.signIn(); // the seeded dev admin (platform admin)
    ql = await stack.kernel.getServiceAsync<any>('objectql');
    const [admin] = await findRows(ql, 'sys_user', { email: 'admin@objectos.ai' }, 1);
    adminUserId = String(admin.id);
  }, 180_000);

  afterAll(async () => {
    await stack?.stop?.();
    if (priorScim === undefined) delete process.env.OS_SCIM_ENABLED;
    else process.env.OS_SCIM_ENABLED = priorScim;
  });

  it('G1 assigned: the user and the grant land together, stamped as granted by the admin', async () => {
    const email = 'granted.25338@example.com';
    const res = await stack.apiAs(adminToken, 'POST', '/auth/admin/create-user', {
      email,
      password: 'Granted!Pass123',
      permissionSet: GRANTED_SET,
    });
    expect(res.status, await res.clone().text()).toBe(200);
    const body = await res.json();
    expect(body.data.permissionSet).toBe(GRANTED_SET);
    const userId = String(body.data.user.id);

    const grants = await findRows(ql, 'sys_user_permission_set', { user_id: userId });
    expect(grants.map((g) => g.permission_set)).toEqual([GRANTED_SET]);
    expect(String(grants[0].granted_by)).toBe(adminUserId);
  }, 120_000);

  it('G2 a set the catalog does not hold: 400, and no user is created', async () => {
    const email = 'refused.25338@example.com';
    const res = await stack.apiAs(adminToken, 'POST', '/auth/admin/create-user', {
      email,
      password: 'Refused!Pass123',
      permissionSet: 'no_such_set_25338',
    });
    expect(res.status, await res.clone().text()).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe('VALIDATION_FAILED');
    expect(await findRows(ql, 'sys_user', { email })).toHaveLength(0);
    expect(await findRows(ql, 'sys_user_permission_set', { permission_set: 'no_such_set_25338' })).toHaveLength(0);
  }, 120_000);

  it('G3 a caller without authority: 403, and nothing is written', async () => {
    const memberToken = await stack.signUp('member.25338@example.com');
    const email = 'escalated.25338@example.com';
    const res = await stack.apiAs(memberToken, 'POST', '/auth/admin/create-user', {
      email,
      password: 'Escalate!Pass123',
      permissionSet: GRANTED_SET,
    });
    expect(res.status, await res.clone().text()).toBe(403);
    expect(await findRows(ql, 'sys_user', { email })).toHaveLength(0);
  }, 120_000);
});
