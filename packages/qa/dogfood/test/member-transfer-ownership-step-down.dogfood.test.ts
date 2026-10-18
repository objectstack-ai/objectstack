// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `sys_member.transfer_ownership` says what its door does — measured on a real
 * boot, on the wire, by reading both `sys_member` rows after every write.
 *
 * The action sends better-auth's `POST /organization/update-member-role` with
 * `{ memberId: TARGET, role: 'owner' }`. That endpoint writes the TARGET's role
 * and nothing else: the caller stays an owner, so the organization ends with
 * two. The action used to promise the caller "You will be demoted to admin";
 * nothing demoted anyone. Its copy now says the selected member becomes an
 * owner and the caller keeps their role, and names the step that really steps
 * the caller down: Change Role (`update_member_role`) on their own row.
 *
 * ## What this measures, in one organization beside a second one
 *
 *  1. the SERVED copy of `transfer_ownership` (`GET /meta/object/sys_member`):
 *     no transfer, no demotion promised; the step-down named;
 *  2. the action's own request, as an owner, on a plain member: the target
 *     becomes an owner and the caller is STILL an owner — both rows read;
 *  3. the step-down the copy names: the served `update_member_role` predicate
 *     offers it on the caller's OWN row, and the same door, sent by the caller
 *     for their own row with `role: 'admin'`, steps them down — both rows read;
 *  4. the vendor's last-owner guard: the new sole owner cannot step down the
 *     same way, refused with the vendor's own code, and its row stays `owner`.
 *
 * The second organization holds both principals with other grades; its rows
 * are read last and are unchanged, so every write above is the organization's
 * own and not a per-user one.
 *
 * Harness note: `bootStack` boots the production `single` shape (ADR-0131 D3);
 * the multi-organization runtime (`@objectstack/organizations`) is not a
 * dependency of this suite, so its gates skip here (`enterprise-organizations.ts`).
 * The two organizations are rows written in system context, the shape
 * `org-admin-affordance-reach.dogfood.test.ts` uses — the only writer
 * better-auth-managed tables accept (ADR-0092). The door under test is the
 * vendor's own `update-member-role` either way.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { type VerifyStack } from '@objectstack/verify';
import { celEngine } from '@objectstack/formula';
import { bootShowcase } from './showcase-boot.js';

const SYSTEM_CTX = { isSystem: true };

type ServedAction = {
  name: string;
  label?: string;
  confirmText?: string;
  successMessage?: string;
  target?: string;
  bodyExtra?: Record<string, unknown>;
  visible?: unknown;
};

async function findRows(ql: any, object: string, where: any, limit = 50): Promise<any[]> {
  const rows = await ql.find(object, { where, limit }, { context: SYSTEM_CTX });
  return Array.isArray(rows) ? rows : (rows?.records ?? []);
}

/** The sign-up reconciler's membership row lands after the signup transaction. */
async function waitForMembership(ql: any, userId: string): Promise<any> {
  for (let i = 0; i < 40; i++) {
    const rows = await findRows(ql, 'sys_member', { user_id: userId }, 5);
    if (rows.length > 0) return rows[0];
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`no sys_member row appeared for ${userId}`);
}

describe('sys_member.transfer_ownership makes the target an owner; the caller steps down through Change Role', () => {
  let stack: VerifyStack;
  let ql: any;
  let orgId: string;
  let otherOrgId: string;
  const owner = {} as { token: string; userId: string; rowId: string };
  const target = {} as { token: string; userId: string; rowId: string };
  let served: Map<string, ServedAction>;
  let features: Record<string, unknown>;

  /** Both principals' roles in an organization, read from storage. */
  const rolesIn = async (organizationId: string) => {
    const rows = await findRows(ql, 'sys_member', { organization_id: organizationId }, 50);
    const roleOf = (userId: string) => rows.find((r) => String(r.user_id) === userId)?.role;
    return { owner: roleOf(owner.userId), target: roleOf(target.userId) };
  };

  /** The action's request as the console sends it: the row id under `recordIdParam`, plus `bodyExtra`. */
  const updateMemberRole = (token: string, memberId: string, role: string) =>
    stack.apiAs(token, 'POST', '/auth/organization/update-member-role', { memberId, role, organizationId: orgId });

  beforeAll(async () => {
    stack = await bootShowcase({});
    await stack.signIn(); // the seeded dev admin: boots the identity plane
    ql = await stack.kernel.getServiceAsync<any>('objectql');

    // Two signed-up principals, neither a platform admin, so the verdicts
    // below are the membership grade's alone.
    for (const [who, email] of [[owner, 'transfer.owner@example.com'], [target, 'transfer.target@example.com']] as const) {
      who.token = await stack.signUp(email, 'Transfer!Pass123', email);
      const [user] = await findRows(ql, 'sys_user', { email }, 1);
      who.userId = String(user.id);
      await waitForMembership(ql, who.userId);
    }

    const org = await ql.insert('sys_organization', { name: 'Transfer Org', slug: 'transfer-org' }, { context: SYSTEM_CTX });
    orgId = String(org.id);
    const other = await ql.insert('sys_organization', { name: 'Transfer Other Org', slug: 'transfer-other-org' }, { context: SYSTEM_CTX });
    otherOrgId = String(other.id);

    owner.rowId = String((await ql.insert('sys_member', { user_id: owner.userId, organization_id: orgId, role: 'owner' }, { context: SYSTEM_CTX })).id);
    target.rowId = String((await ql.insert('sys_member', { user_id: target.userId, organization_id: orgId, role: 'member' }, { context: SYSTEM_CTX })).id);
    // The other organization: the same two people, the grades reversed.
    await ql.insert('sys_member', { user_id: owner.userId, organization_id: otherOrgId, role: 'member' }, { context: SYSTEM_CTX });
    await ql.insert('sys_member', { user_id: target.userId, organization_id: otherOrgId, role: 'owner' }, { context: SYSTEM_CTX });
    // The session's grade (`positions`) is the ACTIVE organization's, as in the
    // console after the organization switcher: activate the one under test.
    for (const who of [owner, target]) {
      const res = await stack.apiAs(who.token, 'POST', '/auth/organization/set-active', { organizationId: orgId });
      expect(res.status, `activates the organization: ${await res.clone().text()}`).toBe(200);
    }

    const meta = await stack.apiAs(owner.token, 'GET', '/meta/object/sys_member');
    expect(meta.status).toBe(200);
    const body = (await meta.json()) as { item?: { actions?: ServedAction[] } };
    served = new Map((body.item?.actions ?? []).map((a) => [a.name, a]));

    const config = await stack.apiAs(owner.token, 'GET', '/auth/config');
    expect(config.status).toBe(200);
    features = ((await config.json()) as { data: { features: Record<string, unknown> } }).data.features;
  }, 240_000);

  afterAll(async () => {
    await stack?.stop?.();
  });

  it('the served copy promises what the door does: the target becomes an owner, the caller keeps their role', () => {
    const action = served.get('transfer_ownership');
    expect(action, 'transfer_ownership is served').toBeDefined();
    // The request is unchanged: better-auth's update-member-role, role owner.
    expect(action!.target).toBe('/api/v1/auth/organization/update-member-role');
    expect(action!.bodyExtra).toEqual({ role: 'owner' });

    const copy = [action!.label, action!.confirmText, action!.successMessage].join(' | ');
    // No demotion and no transfer is promised anywhere in the copy.
    expect(copy).not.toMatch(/demot/i);
    expect(copy).not.toMatch(/transfer/i);
    expect(action!.label).toBe('Make Owner');
    // The confirm names the outcome and the real step-down, by the step-down's own label.
    expect(action!.confirmText).toContain('You stay an owner');
    expect(action!.confirmText).toContain(served.get('update_member_role')?.label ?? 'update_member_role is not served');
  });

  it('the action, as an owner, makes the target an owner and leaves the caller an owner', async () => {
    expect(await rolesIn(orgId)).toEqual({ owner: 'owner', target: 'member' });

    const res = await updateMemberRole(owner.token, target.rowId, 'owner');
    expect(res.status, await res.clone().text()).toBe(200);

    // Both rows: two owners. The caller was not demoted.
    expect(await rolesIn(orgId)).toEqual({ owner: 'owner', target: 'owner' });
  }, 60_000);

  it('Change Role is offered on the caller\'s own row, and steps the previous owner down to admin', async () => {
    const changeRole = served.get('update_member_role');
    expect(changeRole?.target).toBe('/api/v1/auth/organization/update-member-role');

    // The console's verdict for the caller on their OWN row, from the served
    // predicate and the caller's served session.
    const session = await stack.apiAs(owner.token, 'GET', '/auth/get-session');
    expect(session.status).toBe(200);
    const user = ((await session.json()) as { user: Record<string, unknown> }).user;
    expect(user.positions as string[], 'the caller is an owner on the session face').toContain('org_owner');
    const [ownRow] = await findRows(ql, 'sys_member', { id: owner.rowId }, 1);
    const verdict = celEngine.evaluate(changeRole!.visible as never, { record: ownRow, user: user as never, extra: { features } });
    if (!verdict.ok) throw new Error(`update_member_role faulted: ${JSON.stringify(verdict)}`);
    expect(verdict.value, 'Change Role is offered on the caller\'s own row').toBe(true);

    const res = await updateMemberRole(owner.token, owner.rowId, 'admin');
    expect(res.status, await res.clone().text()).toBe(200);

    // Both rows: the previous owner is an admin, the new owner is the owner.
    expect(await rolesIn(orgId)).toEqual({ owner: 'admin', target: 'owner' });
  }, 60_000);

  it('the vendor keeps one owner: the sole owner cannot step down the same way', async () => {
    const res = await updateMemberRole(target.token, target.rowId, 'admin');
    expect(res.status).toBe(400);
    expect(((await res.json()) as { code?: string }).code).toBe('YOU_CANNOT_LEAVE_THE_ORGANIZATION_WITHOUT_AN_OWNER');
    expect(await rolesIn(orgId)).toEqual({ owner: 'admin', target: 'owner' });
  }, 60_000);

  it('the other organization\'s rows are untouched', async () => {
    expect(await rolesIn(otherOrgId)).toEqual({ owner: 'member', target: 'owner' });
  });
});
