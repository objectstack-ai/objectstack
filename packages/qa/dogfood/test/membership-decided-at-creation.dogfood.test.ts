// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * ADR-0093 D7 on a real boot: under the `auto` membership policy a user is
 * bound to the default organization when the user is CREATED, and a user
 * whose membership was removed is never bound again automatically — not by
 * signing in again.
 *
 * Driven through the real HTTP surface: sign-up, better-auth's own
 * remove-member endpoint, and sign-in. The positive half (creation binds, and
 * the creating request's first session carries the organization) is asserted
 * on the same run, so the negative half measures the decision and not a
 * deployment that binds nobody.
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

describe('membership under the auto policy is decided at user creation (ADR-0093 D7)', () => {
  let stack: VerifyStack;
  let ql: any;
  let adminToken: string;
  let orgId: string;

  beforeAll(async () => {
    stack = await bootStack(showcaseStack);
    adminToken = await stack.signIn();
    ql = await stack.kernel.getServiceAsync<any>('objectql');

    // The single-org default organization — reuse the bootstrap's when the
    // boot made one, otherwise stand it up the way the bootstrap would.
    const [existing] = await findRows(ql, 'sys_organization', { slug: 'default' }, 1);
    orgId = existing
      ? String(existing.id)
      : String((await ql.insert('sys_organization', { name: 'Default Organization', slug: 'default' }, { context: SYSTEM_CTX })).id);

    // The admin must own the organization for remove-member to be authorized.
    const [adminUser] = await findRows(ql, 'sys_user', { email: 'admin@objectos.ai' }, 1);
    const adminUserId = String(adminUser.id);
    const adminMembers = await findRows(ql, 'sys_member', { user_id: adminUserId, organization_id: orgId }, 5);
    if (adminMembers.length > 0) {
      await ql.update('sys_member', { id: adminMembers[0].id, role: 'owner' }, { context: SYSTEM_CTX });
    } else {
      await ql.insert('sys_member', { user_id: adminUserId, organization_id: orgId, role: 'owner' }, { context: SYSTEM_CTX });
    }
  }, 240_000);

  afterAll(async () => { await stack?.stop?.(); });

  it('membership is decided once, at creation', async () => {
    const email = 'member.decided.at.creation@example.com';
    const password = 'Member!Pass123';

    // ── creation binds ───────────────────────────────────────────────────
    await stack.signUp(email, password, 'Decided At Creation');
    const [user] = await findRows(ql, 'sys_user', { email }, 1);
    const userId = String(user.id);
    const member = await waitForMembership(ql, userId);
    expect(String(member.organization_id)).toBe(orgId);
    expect(member.role).toBe('member');

    // The creating request's first session carries the organization: the
    // creation-time settle still runs ahead of the deferred creation hook.
    const firstSessions = await findRows(ql, 'sys_session', { user_id: userId }, 5);
    expect(firstSessions.length).toBeGreaterThan(0);
    expect(String(firstSessions[0].active_organization_id)).toBe(orgId);

    // ── an administrator removes the membership ──────────────────────────
    const removed = await stack.apiAs(adminToken, 'POST', '/auth/organization/remove-member', {
      memberIdOrEmail: String(member.id),
      organizationId: orgId,
    });
    expect(removed.status, await removed.clone().text()).toBe(200);
    expect(await findRows(ql, 'sys_member', { user_id: userId }, 5)).toHaveLength(0);

    // ── signing in again does not put them back ──────────────────────────
    const token = await stack.signIn(email, password);
    const session = await stack.apiAs(token, 'GET', '/auth/get-session');
    expect(session.status).toBe(200);
    const body = (await session.json()) as any;
    expect(body?.user?.id).toBe(userId);
    expect(body?.session?.activeOrganizationId ?? null).toBeNull();

    // Allow any deferred hook of the sign-in to finish before reading the
    // store, so an absence is not merely "not yet".
    await new Promise((r) => setTimeout(r, 1_000));
    expect(await findRows(ql, 'sys_member', { user_id: userId }, 5)).toHaveLength(0);
  }, 180_000);
});
