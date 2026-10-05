// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * On a real boot: a user created after the default organization is deleted
 * and recreated in the same process is bound to the organization that exists,
 * not to the deleted one's id.
 *
 * The tenancy service memoizes the default organization id. Under the `auto`
 * membership policy a user's membership is decided once, at creation
 * (ADR-0093 D7), so a bind to a deleted id is never repaired. The sequence is
 * driven through the real surface: an administrator deletes the default
 * organization through better-auth's own endpoint, and the next sign-up's
 * `sys_user` insert is what makes the single-org bootstrap recreate it, ahead
 * of that same sign-up's membership bind. The first sign-up, before the
 * delete, is asserted bound to the original organization on the same run, so
 * the memo is warm and the second half measures the revalidation and not a
 * deployment that binds nobody.
 *
 * Booted with `orgContext`, the harness's switch for the real single-org
 * default-organization bootstrap (it is off by default there): that bootstrap
 * is what creates the original organization and what recreates it.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import showcaseStack from '@objectstack/example-showcase';
import { bootStack, type VerifyStack } from '@objectstack/verify';

const SYSTEM_CTX = { isSystem: true };

async function findRows(ql: any, object: string, where: any, limit = 50): Promise<any[]> {
  const rows = await ql.find(object, { where, limit }, { context: SYSTEM_CTX });
  return Array.isArray(rows) ? rows : (rows?.records ?? []);
}

/** The creation-time membership may land after the sign-up response. */
async function waitForMembership(ql: any, userId: string): Promise<any> {
  for (let i = 0; i < 60; i++) {
    const rows = await findRows(ql, 'sys_member', { user_id: userId }, 5);
    if (rows.length > 0) return rows[0];
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`no sys_member row appeared for ${userId}`);
}

async function signUpAndFindUser(stack: VerifyStack, ql: any, email: string, name: string): Promise<string> {
  await stack.signUp(email, 'Recreated!Pass123', name);
  const [user] = await findRows(ql, 'sys_user', { email }, 1);
  expect(user, `sys_user row for ${email}`).toBeTruthy();
  return String(user.id);
}

describe('the default organization id is revalidated when a user is bound', () => {
  let stack: VerifyStack;
  let ql: any;
  let adminToken: string;
  let originalOrgId: string;

  beforeAll(async () => {
    stack = await bootStack(showcaseStack, { orgContext: true });
    adminToken = await stack.signIn();
    ql = await stack.kernel.getServiceAsync<any>('objectql');

    // PREMISE: the bootstrap created the default organization and bound the
    // admin as its owner, which is what lets better-auth delete it below.
    const [existing] = await findRows(ql, 'sys_organization', { slug: 'default' }, 1);
    expect(existing, 'PREMISE: the bootstrap created the default organization').toBeTruthy();
    originalOrgId = String(existing.id);
    const [adminUser] = await findRows(ql, 'sys_user', { email: 'admin@objectos.ai' }, 1);
    const adminMembers = await findRows(ql, 'sys_member', { user_id: String(adminUser.id), organization_id: originalOrgId }, 5);
    expect(adminMembers.map((m) => m.role), 'PREMISE: the admin owns the default organization').toEqual(['owner']);
  }, 240_000);

  afterAll(async () => { await stack?.stop?.(); });

  it('a user signed up after the default organization is deleted and recreated binds to the new id', async () => {
    // ── before the delete: creation binds to the original organization ───
    const firstUserId = await signUpAndFindUser(stack, ql, 'before.default.recreate@example.com', 'Before Recreate');
    const firstMember = await waitForMembership(ql, firstUserId);
    expect(String(firstMember.organization_id)).toBe(originalOrgId);

    // ── an administrator deletes the default organization ────────────────
    const deleted = await stack.apiAs(adminToken, 'POST', '/auth/organization/delete', {
      organizationId: originalOrgId,
    });
    expect(deleted.status, await deleted.clone().text()).toBe(200);
    expect(await findRows(ql, 'sys_organization', { id: originalOrgId }, 1)).toHaveLength(0);

    // ── the next sign-up recreates it, and is bound to the recreated one ──
    const secondUserId = await signUpAndFindUser(stack, ql, 'after.default.recreate@example.com', 'After Recreate');
    const [recreated] = await findRows(ql, 'sys_organization', { slug: 'default' }, 1);
    expect(recreated, 'the bootstrap recreated the default organization').toBeTruthy();
    const recreatedOrgId = String(recreated.id);
    expect(recreatedOrgId).not.toBe(originalOrgId);

    const secondMember = await waitForMembership(ql, secondUserId);
    expect(String(secondMember.organization_id)).toBe(recreatedOrgId);

    // The creating request's first session carries the same organization.
    const firstSessions = await findRows(ql, 'sys_session', { user_id: secondUserId }, 5);
    expect(firstSessions.length).toBeGreaterThan(0);
    expect(String(firstSessions[0].active_organization_id)).toBe(recreatedOrgId);
  }, 180_000);
});
