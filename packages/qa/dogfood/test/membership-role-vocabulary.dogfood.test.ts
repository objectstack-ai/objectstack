// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0108 / #3723] The organization-role vocabulary is CLOSED, and the
 * capability it used to smuggle travels the governed path instead.
 *
 * This file replaces `app-org-role-invite.dogfood.test.ts`, which proved the
 * opposite. That proof was real — an app-declared `position` / `permission`
 * name could be registered with better-auth, stored in `sys_invitation.role`
 * and held on `sys_member.role` — and it was proving the wrong thing:
 *
 *   `resolve-authz-context.ts` projects EVERY value in `sys_member.role` into
 *   `current_user.positions`. So a business role handed out through the
 *   membership role WAS capability, granted with none of ADR-0090 D12's
 *   controls — no `granted_by`, no ADR-0091 validity window, no BU-subtree
 *   check, no `assignablePermissionSets` allowlist.
 *
 * That is what ADR-0057 D4 ruled out ("never as the authority for RBAC"), what
 * ADR-0090 D3's word ban restates (**distribution = `position`**; `role` is a
 * third-party column we tolerate, not a channel we use), and what ADR-0095 D3
 * keeps out of the enforcement path.
 *
 * Three properties, in the order a reader needs them:
 *
 *  1. both enforced selects offer the four framework roles and nothing else —
 *     the closed list is the write-side guardrail;
 *  2. an app-declared name is refused AT BETTER-AUTH'S DOOR, leaving no row —
 *     it fails early and loudly, not at the insert (the #3747 symptom) and not
 *     silently (the pre-#3747 symptom);
 *  3. the same intent — "this person arrives as a `contributor`" — succeeds
 *     through invitation placement (ADR-0105 D8), which writes a real
 *     `sys_user_position` row with a `granted_by` stamp.
 *
 * (3) is why this is a retirement and not a removal: the replacement reaches
 * FURTHER than what it replaces. The membership-role channel needed an org
 * admin (the invitation role cap holds anyone below admin grade to plain
 * `member`); placement is authorized against the issuer's `adminScope`, so a
 * delegated admin can use it inside their own subtree.
 *
 * Why a dogfood and not a unit test: the original bug shipped green unit tests
 * twice. Only the real HTTP route drives better-auth's role check AND the
 * ObjectQL validator behind it.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import showcaseStack from '@objectstack/example-showcase';
import { bootStack, type VerifyStack } from '@objectstack/verify';

const SYSTEM_CTX = { isSystem: true };

/** The four framework roles — `BUILTIN_MEMBERSHIP_ROLE_OPTIONS`, in order. */
const CLOSED_VOCABULARY = ['owner', 'admin', 'delegated_admin', 'member'];

/** A `position` the showcase stack declares. Under the retired channel this was
 *  a storable membership role; it must now be reachable only as a position. */
const APP_POSITION = 'contributor';
/** A `permission` (PermissionSet) the showcase declares — the other route in. */
const APP_PERMISSION_SET = 'showcase_manager';

async function findRows(ql: any, object: string, where: any, limit = 50): Promise<any[]> {
  const rows = await ql.find(object, { where, limit }, { context: SYSTEM_CTX });
  return Array.isArray(rows) ? rows : (rows?.records ?? []);
}

describe('ADR-0108: the membership-role vocabulary is closed; capability goes through positions', () => {
  let stack: VerifyStack;
  let ql: any;
  let orgId: string;
  let buId: string;
  let ownerToken: string;

  beforeAll(async () => {
    stack = await bootStack(showcaseStack, {});
    ownerToken = await stack.signIn(); // the seeded dev admin
    ql = await stack.kernel.getServiceAsync<any>('objectql');

    // `bootStack` disables the default-org bootstrap, so mint the org the way
    // the bootstrap would (system context — the only writer better-auth-managed
    // tables accept, ADR-0092) and bind the dev admin as its owner.
    const org = await ql.insert(
      'sys_organization',
      { name: 'Default Organization', slug: 'default' },
      { context: SYSTEM_CTX },
    );
    orgId = String(org.id);

    const [adminUser] = await findRows(ql, 'sys_user', { email: 'admin@objectos.ai' }, 1);
    const adminMembers = await findRows(ql, 'sys_member', { user_id: adminUser.id }, 5);
    if (adminMembers.length > 0) {
      await ql.update(
        'sys_member',
        { id: adminMembers[0].id, organization_id: orgId, role: 'owner' },
        { context: SYSTEM_CTX },
      );
    } else {
      await ql.insert(
        'sys_member',
        { user_id: adminUser.id, organization_id: orgId, role: 'owner' },
        { context: SYSTEM_CTX },
      );
    }

    // Placement lands people in a business unit, so the governed path needs one.
    const bu = await ql.insert(
      'sys_business_unit',
      { name: 'Field Sales', kind: 'department', organization_id: orgId, active: true },
      { context: SYSTEM_CTX },
    );
    buId = String(bu.id);
  }, 180_000);

  afterAll(async () => {
    await stack?.stop?.();
  });

  const optionValues = async (object: string) => {
    const schema = await ql.getSchema(object);
    return ((schema.fields.role.options ?? []) as { value: string }[]).map((o) => o.value);
  };

  it('both enforced selects offer the four framework roles and nothing else', async () => {
    // The registered schema is what the write-path validator reads AND what the
    // Setup picker renders. Nothing widens it at boot any more: no
    // `withMembershipRoleOptions`, no `kernel:ready` re-registration.
    expect(await optionValues('sys_invitation')).toEqual(CLOSED_VOCABULARY);
    expect(await optionValues('sys_member')).toEqual(CLOSED_VOCABULARY);
  }, 30_000);

  it('a stack-declared position is NOT an organization role — refused at the door', async () => {
    // The showcase declares `contributor` as a `position`. Under the retired
    // channel this returned 200 and stored the name. It must now fail at
    // better-auth's role check (ROLE_NOT_FOUND), before any insert.
    const email = 'invitee.contributor.3723@example.com';
    const res = await stack.apiAs(ownerToken, 'POST', '/auth/organization/invite-member', {
      email,
      role: APP_POSITION,
      organizationId: orgId,
    });

    expect(res.status, await res.clone().text()).not.toBe(200);
    expect((await findRows(ql, 'sys_invitation', { email }, 5)).length).toBe(0);
  }, 30_000);

  it('a declared PermissionSet name is refused the same way — both routes closed', async () => {
    // `permission` names were the second collection route into the old feed.
    const email = 'invitee.manager.3723@example.com';
    const res = await stack.apiAs(ownerToken, 'POST', '/auth/organization/invite-member', {
      email,
      role: APP_PERMISSION_SET,
      organizationId: orgId,
    });

    expect(res.status).not.toBe(200);
    expect((await findRows(ql, 'sys_invitation', { email }, 5)).length).toBe(0);
  }, 30_000);

  it('the membership row refuses the name too — the second enforced select', async () => {
    // The value the old channel ultimately wanted on `sys_member`. The select is
    // enforced on write and system context does not exempt it, so the ungoverned
    // grant is unrepresentable at the table, not merely unreachable by route.
    const [adminUser] = await findRows(ql, 'sys_user', { email: 'admin@objectos.ai' }, 1);
    const [membership] = await findRows(ql, 'sys_member', { user_id: adminUser.id }, 1);

    await expect(
      ql.update(
        'sys_member',
        { id: membership.id, role: APP_POSITION },
        { context: SYSTEM_CTX },
      ),
    ).rejects.toThrow(/must be one of|invalid_option/i);
  }, 30_000);

  it('the SAME intent succeeds through placement — governed, audited, and further-reaching', async () => {
    // "This person arrives as a contributor", expressed the ADR-0105 D8 way:
    // grade stays `member`; the capability rides in `positions`, authorized at
    // issuance against the issuer's adminScope by dry-running DelegatedAdminGate.
    const email = 'invitee.placed.3723@example.com';
    const res = await stack.apiAs(ownerToken, 'POST', '/auth/organization/invite-member', {
      email,
      role: 'member',
      organizationId: orgId,
      businessUnitId: buId,
      positions: [APP_POSITION],
    });

    expect(res.status, await res.clone().text()).toBe(200);
    const [row] = await findRows(ql, 'sys_invitation', { email }, 5);
    expect(row).toBeDefined();
    // Grade and capability are now separate columns — which is the whole point.
    expect(row.role).toBe('member');
    const positions =
      typeof row.positions === 'string' ? JSON.parse(row.positions) : row.positions;
    expect(positions).toEqual([APP_POSITION]);
    expect(String(row.business_unit_id ?? row.businessUnitId)).toBe(buId);
  }, 30_000);

  it('a name no one ever declared is still refused — nothing opened up', async () => {
    const email = 'invitee.undeclared.3723@example.com';
    const res = await stack.apiAs(ownerToken, 'POST', '/auth/organization/invite-member', {
      email,
      role: 'not_a_declared_role',
      organizationId: orgId,
    });

    expect(res.status).not.toBe(200);
    expect((await findRows(ql, 'sys_invitation', { email }, 5)).length).toBe(0);
  }, 30_000);
});
