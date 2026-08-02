// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#4586] `sys_member` grade changes keep the true actor — proven at the REAL
 * better-auth routes, not against the seam in isolation.
 *
 * The gap: `sys_member` is `trackHistory: true`, so every role transition was
 * already recorded — with "system" as the actor. Every writer is a better-auth
 * path, the adapter runs them `isSystem: true` on purpose (the route already
 * authorized under better-auth's own ACL, and ADR-0092 D2 refuses user-context
 * writes to identity tables), and the human who clicked *make admin* was known
 * exactly once, in the hook layer, then discarded. Second hop, same story:
 * `auto-org-admin-grant` wrote `granted_by: null` into a column that exists, so
 * "why is X a tenant admin" dead-ended one row in.
 *
 * Why this file exists rather than more unit tests (#3106): the seam's own
 * mechanics are covered in `plugin-auth/src/auth-actor-attribution.test.ts`,
 * and a seam that works when called directly proves nothing about whether the
 * routes cross it. So these drive the actual endpoints — `invite-member` →
 * `accept-invitation`, `update-member-role` up and back down — over the real
 * HTTP stack, and read the rows the platform actually wrote.
 *
 * The one constraint the whole change hangs on is pinned here too: the threaded
 * actor is ATTRIBUTION. It must never become the write's authorization subject
 * — that would put a second adjudication track at exactly the boundary
 * ADR-0095 D3 closed — so the promotion is asserted to be refused for a
 * caller better-auth does not authorize, no matter who the write would be
 * credited to.
 *
 * Harness note: `bootStack` disables the default-org bootstrap and installs no
 * audit plugin, so this file mints the Default Organization itself (system
 * context — exactly what the bootstrap would do) and adds `AuditPlugin`, which
 * is what turns `trackHistory` into rows.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import showcaseStack from '@objectstack/example-showcase';
import { bootStack, type VerifyStack } from '@objectstack/verify';
import { AuditPlugin } from '@objectstack/plugin-audit';
import { AUTO_ORG_ADMIN_GRANT_REASON_PREFIX } from '@objectstack/plugin-security';

const SYSTEM_CTX = { isSystem: true };

async function findRows(ql: any, object: string, where: any, limit = 50): Promise<any[]> {
  const rows = await ql.find(object, { where, limit }, { context: SYSTEM_CTX });
  return Array.isArray(rows) ? rows : (rows?.records ?? []);
}

/** The sign-up reconciler's membership row lands asynchronously (better-auth
 *  defers `user.create.after` past the signup transaction). */
async function waitForMembership(ql: any, userId: string): Promise<any> {
  for (let i = 0; i < 40; i++) {
    const rows = await findRows(ql, 'sys_member', { user_id: userId }, 5);
    if (rows.length > 0) return rows[0];
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`no sys_member row appeared for ${userId}`);
}

/** Audit rows this stack wrote for one `sys_member` row. */
async function memberHistory(ql: any, memberId: string, action?: string): Promise<any[]> {
  const rows = await findRows(
    ql,
    'sys_audit_log',
    { object_name: 'sys_member', record_id: memberId },
    100,
  );
  return action ? rows.filter((r: any) => r.action === action) : rows;
}

/**
 * Wait for the history row that records a SPECIFIC transition, identified by
 * what it says rather than by its position.
 *
 * Selecting "the last row" is wrong twice over here: `find` is unordered
 * without an explicit sort, and — the trap this file walked into — the audit
 * row lands ASYNCHRONOUSLY after the endpoint returns, so a promote/demote
 * pair polled by count alone happily returns the *previous* transition and
 * asserts against it. Matching on the row's own `new_value` is immune to both.
 *
 * On `action: 'update'` the audit writer stores a CHANGED-FIELDS DIFF: the
 * before-state in `old_value`, the after-state in `new_value` (a demotion is
 * `old_value {"role":"admin"}` → `new_value {"role":"member"}`). Both halves
 * are recorded — this change adds WHO to a row that already knew WHAT.
 */
async function waitForHistoryMatching(
  ql: any,
  memberId: string,
  action: string,
  matches: (row: any) => boolean,
  what = action,
): Promise<any> {
  for (let i = 0; i < 20; i++) {
    const hit = (await memberHistory(ql, memberId, action)).find(matches);
    if (hit) return hit;
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`no '${what}' history row appeared for sys_member ${memberId}`);
}

async function waitForHistory(ql: any, memberId: string, action: string): Promise<any> {
  return waitForHistoryMatching(ql, memberId, action, () => true);
}

describe('#4586: the better-auth actor reaches sys_member history and the grant', () => {
  let stack: VerifyStack;
  let ql: any;
  let orgId: string;
  let partnerOrgId: string;
  let adminToken: string;
  let adminUserId: string;
  let memberToken: string;
  let memberUserId: string;
  let memberRowId: string;

  beforeAll(async () => {
    stack = await bootStack(showcaseStack, { extraPlugins: [new AuditPlugin()] });
    adminToken = await stack.signIn(); // the seeded dev admin
    ql = await stack.kernel.getServiceAsync<any>('objectql');

    const org = await ql.insert(
      'sys_organization',
      { name: 'Default Organization', slug: 'default' },
      { context: SYSTEM_CTX },
    );
    orgId = String(org.id);

    // A second org, so invite-accept has somewhere to add a membership that the
    // single-org reconciler has not already created.
    const partner = await ql.insert(
      'sys_organization',
      { name: 'Partner Organization', slug: 'partner' },
      { context: SYSTEM_CTX },
    );
    partnerOrgId = String(partner.id);

    // The dev admin predates the org rows — give them the owner membership the
    // single-org bootstrap would have, in both orgs.
    const [adminUser] = await findRows(ql, 'sys_user', { email: 'admin@objectos.ai' }, 1);
    adminUserId = String(adminUser.id);
    const adminMembers = await findRows(ql, 'sys_member', { user_id: adminUserId }, 5);
    if (adminMembers.length > 0) {
      await ql.update(
        'sys_member',
        { id: adminMembers[0].id, organization_id: orgId, role: 'owner' },
        { context: SYSTEM_CTX },
      );
    } else {
      await ql.insert(
        'sys_member',
        { user_id: adminUserId, organization_id: orgId, role: 'owner' },
        { context: SYSTEM_CTX },
      );
    }
    await ql.insert(
      'sys_member',
      { user_id: adminUserId, organization_id: partnerOrgId, role: 'owner' },
      { context: SYSTEM_CTX },
    );

    // The subject: an ordinary member the admin will promote and demote.
    memberToken = await stack.signUp('member.4586@example.com', 'Member!Pass123', 'Member 4586');
    const [memberUser] = await findRows(ql, 'sys_user', { email: 'member.4586@example.com' }, 1);
    memberUserId = String(memberUser.id);
    const bound = await waitForMembership(ql, memberUserId);
    memberRowId = String(bound.id);
    expect(bound.role).toBe('member');
  }, 180_000);

  afterAll(async () => {
    await stack?.stop?.();
  });

  // ── W1: the grade change names the human ────────────────────────────────

  it('update-member-role: the history row names the admin who promoted, not "system"', async () => {
    const res = await stack.apiAs(adminToken, 'POST', '/auth/organization/update-member-role', {
      memberId: memberRowId,
      role: 'admin',
      organizationId: orgId,
    });
    expect(res.status, await res.clone().text()).toBe(200);

    const [row] = await findRows(ql, 'sys_member', { id: memberRowId }, 1);
    expect(row.role).toBe('admin');

    const history = await waitForHistory(ql, memberRowId, 'update');
    // Before this change the write reached ObjectQL as bare `{ isSystem: true }`
    // and this column was null — the transition was recorded, the actor was not.
    expect(history.user_id).toBe(adminUserId);
    // A real `sys_user` id, so the lookup still joins (ADR-0118 D1: an id or
    // null, never a sentinel string like 'system').
    expect(await findRows(ql, 'sys_user', { id: history.user_id }, 1)).toHaveLength(1);
    // The diff itself is unchanged — this adds WHO, it does not alter WHAT.
    expect(String(history.new_value)).toContain('admin');
  }, 60_000);

  // ── W2: the capability grant records its whole provenance ───────────────

  it('the auto-granted capability names the admin in granted_by and the membership in reason', async () => {
    // The elevation chain's second hop: sys_member.role → auto-org-admin-grant
    // → sys_user_permission_set → isTenantAdmin().
    let grants: any[] = [];
    for (let i = 0; i < 20 && grants.length === 0; i++) {
      grants = await findRows(
        ql,
        'sys_user_permission_set',
        { user_id: memberUserId, organization_id: orgId },
        5,
      );
      if (grants.length === 0) await new Promise((r) => setTimeout(r, 250));
    }
    expect(grants).toHaveLength(1);
    const grant = grants[0];

    // WHO: the human whose better-auth call caused the elevation.
    expect(grant.granted_by).toBe(adminUserId);
    // WHY: the machine writer that minted the row, and the membership that
    // triggered it — so `explain` can walk the chain instead of inferring it.
    expect(String(grant.reason).startsWith(AUTO_ORG_ADMIN_GRANT_REASON_PREFIX)).toBe(true);
    expect(String(grant.reason)).toContain(memberRowId);
  }, 60_000);

  // ── W1 again, on the OTHER membership-creating route ────────────────────

  it('accept-invitation: the new membership is attributed to the person who accepted', async () => {
    const invite = await stack.apiAs(adminToken, 'POST', '/auth/organization/invite-member', {
      email: 'member.4586@example.com',
      role: 'member',
      organizationId: partnerOrgId,
    });
    expect(invite.status, await invite.clone().text()).toBe(200);
    const [invitation] = await findRows(
      ql,
      'sys_invitation',
      { email: 'member.4586@example.com', organization_id: partnerOrgId },
      1,
    );
    expect(invitation).toBeDefined();

    const accept = await stack.apiAs(memberToken, 'POST', '/auth/organization/accept-invitation', {
      invitationId: String(invitation.id),
    });
    expect(accept.status, await accept.clone().text()).toBe(200);

    const partnerMembers = await findRows(
      ql,
      'sys_member',
      { user_id: memberUserId, organization_id: partnerOrgId },
      5,
    );
    expect(partnerMembers).toHaveLength(1);

    // The ACCEPTOR is the actor here, not the inviter — which is the point of
    // threading the real session actor rather than hard-coding one route's idea
    // of who is responsible.
    const created = await waitForHistory(ql, String(partnerMembers[0].id), 'create');
    expect(created.user_id).toBe(memberUserId);
  }, 60_000);

  // ── W1 + W2 on the way back down ────────────────────────────────────────

  it('demotion: the grade change back down is attributed to the admin too', async () => {
    const res = await stack.apiAs(adminToken, 'POST', '/auth/organization/update-member-role', {
      memberId: memberRowId,
      role: 'member',
      organizationId: orgId,
    });
    expect(res.status, await res.clone().text()).toBe(200);

    const [row] = await findRows(ql, 'sys_member', { id: memberRowId }, 1);
    expect(row.role).toBe('member');

    // Identify the demotion row by what it RECORDS, not by its position: the
    // promotion row is already there, and the new row lands asynchronously.
    const demotion = await waitForHistoryMatching(
      ql,
      memberRowId,
      'update',
      (r) => String(r.new_value).includes('member'),
      'demotion',
    );
    // The pair the diff actually stores: admin → member.
    expect(String(demotion.old_value)).toContain('admin');
    expect(String(demotion.new_value)).toContain('member');
    // Attribution works in both directions — taking authority away is exactly
    // as answerable as handing it out.
    expect(demotion.user_id).toBe(adminUserId);
    // …and it is a DISTINCT row from the promotion, which keeps its own actor.
    const promotion = await waitForHistoryMatching(
      ql,
      memberRowId,
      'update',
      (r) => String(r.new_value).includes('admin'),
      'promotion',
    );
    expect(String(promotion.id)).not.toBe(String(demotion.id));
    expect(promotion.user_id).toBe(adminUserId);

    // NOTE: whether the org-admin GRANT is revoked on demotion is deliberately
    // not asserted here. It currently is not — `auto-org-admin-grant`'s only
    // delete channel calls `ql.delete(object, id, ctx)` while the engine takes
    // `(object, { where, context })`, so every revoke throws into a swallowing
    // catch. That is a separate, pre-existing defect (its unit stub implements
    // the wrong signature, so the suite never saw it) filed as #4640 — a
    // security behaviour change that deserves its own review and changeset, not
    // a rider on an attribution PR.
  }, 60_000);

  // ── The hard constraint ─────────────────────────────────────────────────

  it('attribution is not authority: a plain member cannot promote themselves', async () => {
    // The failure mode this change must not create. If the threaded actor had
    // become the write's authorization subject, the platform would be
    // adjudicating membership writes a second time, beside better-auth's own
    // route ACL — the boundary ADR-0095 D3 closed. better-auth still owns the
    // decision, and it says no.
    const before = (await memberHistory(ql, memberRowId, 'update')).length;

    const res = await stack.apiAs(memberToken, 'POST', '/auth/organization/update-member-role', {
      memberId: memberRowId,
      role: 'admin',
      organizationId: orgId,
    });
    expect(res.status).toBeGreaterThanOrEqual(400);

    // Refused at the door: no grade change, and therefore nothing to attribute.
    const [row] = await findRows(ql, 'sys_member', { id: memberRowId }, 1);
    expect(row.role).toBe('member');
    expect((await memberHistory(ql, memberRowId, 'update')).length).toBe(before);
  }, 60_000);

  it('a machine-originated membership write still records as the system', async () => {
    // ADR-0118 D1/D2: no actor in scope means `null` — absence is never
    // upgraded into a caller, and never written as a sentinel.
    const orphan = await ql.insert(
      'sys_user',
      { name: 'Orphan 4586', email: 'orphan.4586@example.com' },
      { context: SYSTEM_CTX },
    );
    const row = await ql.insert(
      'sys_member',
      { user_id: String(orphan.id), organization_id: partnerOrgId, role: 'member' },
      { context: SYSTEM_CTX },
    );
    const created = await waitForHistory(ql, String(row.id), 'create');
    expect(created.user_id).toBeNull();
    expect(created.actor).toBeNull();
  }, 60_000);
});
