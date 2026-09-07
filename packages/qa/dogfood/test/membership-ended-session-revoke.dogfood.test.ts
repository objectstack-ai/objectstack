// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#15784] "Remove member" actually signs the person out — the COURTESY half of
 * #15409's ruling, proven at better-auth's OWN endpoint.
 *
 * ⛔ **This file does not test the enforcement.** #15409's per-request check in
 * `resolve-authz-context.ts` is the wall and is pinned elsewhere
 * (`packages/core/src/security/resolve-authz-context.test.ts`,
 * `packages/rest/src/single-kernel-isolated-session-org-claim-matrix.test.ts`).
 * What is proven here is the product behaviour an admin was promised: the
 * session stops naming the organization the person was just removed from.
 *
 * Ruled shape (maintainer, decision batch #49 item 4, option B — act on the
 * ORGANIZATION'S CLAIM, never on the user):
 *
 *   - user holds ANOTHER membership  → the claim is re-pointed; ⛔ NOT signed out
 *   - user holds NO membership       → the session is revoked, and the next
 *                                      request is unauthenticated
 *
 * Why the endpoint and not the seam (#3106): a trigger that works when called
 * directly proves nothing about whether the route crosses it. The census on
 * #15784 measured which writers reach the seam; this file proves the one the
 * card names arrives there and produces the ruled outcome.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import showcaseStack from '@objectstack/example-showcase';
import { bootStack, type VerifyStack } from '@objectstack/verify';
import { MEMBERSHIP_ENDED_REVOKE_REASON } from '@objectstack/plugin-auth';

const SYSTEM_CTX = { isSystem: true };

async function findRows(ql: any, object: string, where: any, limit = 50): Promise<any[]> {
  const rows = await ql.find(object, { where, limit }, { context: SYSTEM_CTX });
  return Array.isArray(rows) ? rows : (rows?.records ?? []);
}

/** The sign-up reconciler's membership row lands asynchronously. */
async function waitForMembership(ql: any, userId: string): Promise<any> {
  for (let i = 0; i < 60; i++) {
    const rows = await findRows(ql, 'sys_member', { user_id: userId }, 5);
    if (rows.length > 0) return rows[0];
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`no sys_member row appeared for ${userId}`);
}

describe('#15784: a membership that ends takes the session\'s claim on that organization with it', () => {
  let stack: VerifyStack;
  let ql: any;
  let adminToken: string;
  let orgId: string;
  let partnerOrgId: string;

  beforeAll(async () => {
    stack = await bootStack(showcaseStack);
    adminToken = await stack.signIn();
    ql = await stack.kernel.getServiceAsync<any>('objectql');

    const org = await ql.insert('sys_organization', { name: 'Default Organization', slug: 'default' }, { context: SYSTEM_CTX });
    orgId = String(org.id);
    const partner = await ql.insert('sys_organization', { name: 'Partner Organization', slug: 'partner' }, { context: SYSTEM_CTX });
    partnerOrgId = String(partner.id);

    // The dev admin predates the org rows — give them the owner membership the
    // single-org bootstrap would have, in both orgs, so remove-member is
    // authorized in either.
    const [adminUser] = await findRows(ql, 'sys_user', { email: 'admin@objectos.ai' }, 1);
    const adminUserId = String(adminUser.id);
    const adminMembers = await findRows(ql, 'sys_member', { user_id: adminUserId }, 5);
    if (adminMembers.length > 0) {
      await ql.update('sys_member', { id: adminMembers[0].id, organization_id: orgId, role: 'owner' }, { context: SYSTEM_CTX });
    } else {
      await ql.insert('sys_member', { user_id: adminUserId, organization_id: orgId, role: 'owner' }, { context: SYSTEM_CTX });
    }
    await ql.insert('sys_member', { user_id: adminUserId, organization_id: partnerOrgId, role: 'owner' }, { context: SYSTEM_CTX });
  }, 240_000);

  afterAll(async () => { await stack?.stop?.(); });

  /**
   * A signed-up fixture: their user row, their reconciled membership (moved to
   * `org`), and their live session with `active_organization_id` naming it.
   *
   * The active-organization stamp is applied here rather than assumed: what
   * this file is about is a session that CLAIMS an organization, and the claim
   * has to be on the row for the trigger to have anything to act on.
   */
  async function fixture(tag: string, org: string): Promise<{
    userId: string; memberId: string; token: string; sessionId: string;
  }> {
    const email = `m15784.${tag}@example.com`;
    const token = await stack.signUp(email, 'Member!Pass123', `Member ${tag}`);
    const [u] = await findRows(ql, 'sys_user', { email }, 1);
    const userId = String(u.id);
    const member = await waitForMembership(ql, userId);
    await ql.update('sys_member', { id: member.id, organization_id: org }, { context: SYSTEM_CTX });
    const sessions = await findRows(ql, 'sys_session', { user_id: userId }, 5);
    expect(sessions.length, `${tag} should have a live session`).toBeGreaterThan(0);
    const sessionId = String(sessions[0].id);
    await ql.update('sys_session', { id: sessionId, active_organization_id: org }, { context: SYSTEM_CTX });
    return { userId, memberId: String(member.id), token, sessionId };
  }

  async function session(sessionId: string): Promise<any> {
    const [row] = await findRows(ql, 'sys_session', { id: sessionId }, 1);
    return row;
  }

  async function removeMember(memberId: string, organizationId: string): Promise<Response> {
    return stack.apiAs(adminToken, 'POST', '/auth/organization/remove-member', {
      memberIdOrEmail: memberId,
      organizationId,
    });
  }

  // ── W1: the acceptance case — no membership left ⇒ revoked ───────────────

  it('a removed member with NO remaining membership has their session revoked, and the next request is unauthenticated', async () => {
    const sole = await fixture('sole', orgId);
    // Two controls stood up alongside, so "unaffected" is measured on the same
    // run rather than asserted about a different one.
    const elsewhere = await fixture('elsewhere', partnerOrgId);   // control 1: a different org
    const intact = await fixture('intact', orgId);                // control 2: still a member

    const res = await removeMember(sole.memberId, orgId);
    expect(res.status, await res.clone().text()).toBe(200);

    // The membership really ended.
    expect(await findRows(ql, 'sys_member', { id: sole.memberId }, 1)).toHaveLength(0);

    // The session is revoked THROUGH THE EXISTING MECHANISM, with the new
    // event-driven reason — not deleted, so the audit trail survives.
    const revoked = await session(sole.sessionId);
    expect(revoked, 'the session row is a tombstone, not a deletion').toBeTruthy();
    expect(revoked.revoked_at).toBeTruthy();
    expect(revoked.revoke_reason).toBe(MEMBERSHIP_ENDED_REVOKE_REASON);
    expect(new Date(revoked.expires_at).getTime()).toBeLessThan(Date.now());

    // The whole point: better-auth returns nothing on the next request, which
    // is what the Console's existing 401 -> login redirect keys off. No client
    // change is involved in this assertion.
    const after = await stack.apiAs(sole.token, 'GET', '/auth/get-session');
    const body = await after.clone().text();
    expect(
      after.status === 401 || body === 'null' || body === '' || body === '{}',
      `expected an unauthenticated answer, got ${after.status} ${body.slice(0, 200)}`,
    ).toBe(true);

    // ── CONTROL 1 — a member of a DIFFERENT organization is unaffected ──────
    const other = await session(elsewhere.sessionId);
    expect(other.revoked_at ?? null).toBeNull();
    expect(String(other.active_organization_id)).toBe(partnerOrgId);

    // ── CONTROL 2 — an intact member's session is untouched ────────────────
    const kept = await session(intact.sessionId);
    expect(kept.revoked_at ?? null).toBeNull();
    expect(String(kept.active_organization_id)).toBe(orgId);
  }, 180_000);

  // ── W2: the ruled half the option text was silent about ──────────────────

  it('a removed member who still holds ANOTHER membership is RE-POINTED, never signed out', async () => {
    const dual = await fixture('dual', orgId);
    // A second, legitimate membership — the one option A would have signed
    // them out of.
    await ql.insert('sys_member', { user_id: dual.userId, organization_id: partnerOrgId, role: 'member' }, { context: SYSTEM_CTX });

    const res = await removeMember(dual.memberId, orgId);
    expect(res.status, await res.clone().text()).toBe(200);

    const row = await session(dual.sessionId);
    // ⛔ NOT revoked: this person legitimately belongs to the partner org.
    expect(row.revoked_at ?? null).toBeNull();
    expect(row.revoke_reason ?? null).toBeNull();
    // The claim moved to a membership they still hold.
    expect(String(row.active_organization_id)).toBe(partnerOrgId);

    // And the session still authenticates — the courtesy did not become a
    // punishment.
    const after = await stack.apiAs(dual.token, 'GET', '/auth/get-session');
    expect(after.status).toBe(200);
    expect((await after.clone().text()).length).toBeGreaterThan(2);
  }, 180_000);

  // ── W3: the OTHER measured removal shape — an organization re-point ──────

  it('a membership re-pointed at another organization ends the claim on the one it left', async () => {
    const moved = await fixture('moved', orgId);
    await ql.update('sys_member', { id: moved.memberId, organization_id: partnerOrgId }, { context: SYSTEM_CTX });

    const row = await session(moved.sessionId);
    // The row survives (they still hold a membership — the moved one), and the
    // claim follows it.
    expect(row.revoked_at ?? null).toBeNull();
    expect(String(row.active_organization_id)).toBe(partnerOrgId);
  }, 180_000);
});
