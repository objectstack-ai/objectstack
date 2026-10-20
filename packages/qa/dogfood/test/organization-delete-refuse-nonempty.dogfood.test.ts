// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#24948] Deleting an organization, on the wire, on a booted multi-organization
 * showcase (SQLite).
 *
 * ## The defect
 *
 * `POST /auth/organization/delete` runs better-auth's `deleteOrganization`,
 * which deletes the members, then the invitations, then the organization row,
 * with no transaction. The engine's cascade then applied the tenant column's
 * `set_null` default to every row the organization still owned. On a store
 * whose tenant column is NOT NULL (a ceremonied one) that failed on
 * `sys_team.organization_id` with a 500, after the members and invitations
 * were already gone, leaving an organization with no owner. On a store born
 * nullable (18.0.0) it answered 200 and orphaned the teams and records to
 * NULL. Every organization created through the door owns a default team, so
 * on a NOT NULL store not even an empty one could be deleted.
 *
 * ## The contract (maintainer ruling on #24948, letter B)
 *
 * - (a)(c) An organization that still owns records is refused with 409
 *   `DELETE_RESTRICTED`, naming each table and its count, before anything is
 *   deleted: every row is exactly as it was, the caller's active organization
 *   included.
 * - (b) An empty organization (only its own auth structure: members,
 *   invitations, the default team and its members, the organization-admin
 *   grant) deletes fully, and nothing is left naming it.
 * - (d) The engine refuses the same delete on its own, whatever path reaches
 *   it: the tenant column is never cleared.
 * - (e) The Default Organization keeps the last-administrator guard's answer:
 *   pinned in `organization-delete-federated-fixture.dogfood.test.ts`, whose
 *   `single` boot has one (this `posture-only` boot has none).
 *
 * The seam pins are `packages/objectql/src/engine-organization-delete-refusal.test.ts`
 * (the engine) and `packages/plugins/plugin-auth/src/organization-delete.test.ts`.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { type VerifyStack } from '@objectstack/verify';
import { bootShowcase } from './showcase-boot.js';

const SYSTEM_CTX = { isSystem: true };
const PASSWORD = 'OrgDelete!Pass123';

async function findRows(ql: any, object: string, where: Record<string, unknown>, limit = 500): Promise<any[]> {
  const rows = await ql.find(object, { where, limit, context: SYSTEM_CTX });
  return Array.isArray(rows) ? rows : (rows?.records ?? []);
}

describe('[#24948] organization delete: refused while it owns records, whole when it does not', () => {
  let stack: VerifyStack;
  let ql: any;
  let ownerToken: string;
  let adminToken: string;
  let ownerId: string;
  const org = { empty: '', full: '' };

  /** Every count the delete may touch, for one organization. */
  const snapshot = async (organizationId: string) => {
    const teams = await findRows(ql, 'sys_team', { organization_id: organizationId });
    const teamIds = teams.map((t) => t.id);
    return {
      sys_organization: (await findRows(ql, 'sys_organization', { id: organizationId })).length,
      sys_member: (await findRows(ql, 'sys_member', { organization_id: organizationId })).length,
      sys_invitation: (await findRows(ql, 'sys_invitation', { organization_id: organizationId })).length,
      sys_team: teams.length,
      sys_team_member: teamIds.length
        ? (await findRows(ql, 'sys_team_member', { team_id: { $in: teamIds } })).length
        : 0,
      sys_user_permission_set: (await findRows(ql, 'sys_user_permission_set', { organization_id: organizationId })).length,
      showcase_category: (await findRows(ql, 'showcase_category', { organization_id: organizationId })).length,
      showcase_preference: (await findRows(ql, 'showcase_preference', { organization_id: organizationId })).length,
    };
  };
  /** Rows orphaned to NULL in the tables an organization delete used to clear. */
  const orphans = async () => ({
    sys_team: (await findRows(ql, 'sys_team', { organization_id: null })).length,
    showcase_category: (await findRows(ql, 'showcase_category', { organization_id: null })).length,
  });
  const activeOrganizationOf = async (userId: string) =>
    (await findRows(ql, 'sys_session', { user_id: userId })).map((s) => s.active_organization_id ?? null);
  const createOrg = async (name: string, slug: string): Promise<string> => {
    const res = await stack.apiAs(ownerToken, 'POST', '/auth/organization/create', { name, slug });
    expect(res.status, await res.clone().text()).toBe(200);
    return String(((await res.json()) as { id: string }).id);
  };
  // Written in system context rather than through `invite-member`: the door
  // also queues the invitation EMAIL, a `sys_email` row naming the
  // organization, and whether that row is the organization's own structure is
  // an open question on #24948, so the refusal counts it today.
  const invite = async (organizationId: string, email: string) => {
    await ql.insert('sys_invitation', {
      organization_id: organizationId, email, role: 'member', status: 'pending',
      inviter_id: ownerId, expires_at: new Date(Date.now() + 86_400_000).toISOString(),
    }, { context: SYSTEM_CTX });
  };
  const deleteOrg = (token: string, organizationId: string) =>
    stack.apiAs(token, 'POST', '/auth/organization/delete', { organizationId });

  beforeAll(async () => {
    stack = await bootShowcase({ multiTenant: 'posture-only' });
    ql = await stack.kernel.getServiceAsync<any>('objectql');
    ownerToken = await stack.signUp('org-delete.owner@verify.test', PASSWORD, 'Org delete owner');
    adminToken = await stack.signUp('org-delete.admin@verify.test', PASSWORD, 'Org delete admin');
    [{ id: ownerId }] = await findRows(ql, 'sys_user', { email: 'org-delete.owner@verify.test' }, 1);
    const [{ id: adminId }] = await findRows(ql, 'sys_user', { email: 'org-delete.admin@verify.test' }, 1);

    // Both through the door: each is born with its default team, the team
    // member and the owner's organization-admin grant.
    org.empty = await createOrg('Org Delete Empty', 'org-delete-empty');
    org.full = await createOrg('Org Delete Full', 'org-delete-full');
    for (const id of [org.empty, org.full]) {
      await invite(id, `invitee.${id}@verify.test`);
      // An `admin` member: refused by the vendor, so never told a count.
      await ql.insert('sys_member', { user_id: String(adminId), organization_id: id, role: 'admin' }, { context: SYSTEM_CTX });
    }
    // The records the full organization owns: two tables.
    for (const name of ['Cat A', 'Cat B']) {
      await ql.insert('showcase_category', { name, organization_id: org.full }, { context: SYSTEM_CTX });
    }
    await ql.insert('showcase_preference', { name: 'Pref A', organization_id: org.full }, { context: SYSTEM_CTX });
    // The caller's active organization is a write the vendor makes before its
    // delete hook; a refused delete must not make it.
    const active = await stack.apiAs(ownerToken, 'POST', '/auth/organization/set-active', { organizationId: org.full });
    expect(active.status, await active.clone().text()).toBe(200);
  }, 240_000);

  afterAll(async () => {
    await stack?.stop?.();
  });

  it('PREMISE: a door-created organization owns its auth structure, and the full one owns records', async () => {
    for (const id of [org.empty, org.full]) {
      const counts = await snapshot(id);
      expect(counts.sys_organization).toBe(1);
      expect(counts.sys_member).toBe(2);
      expect(counts.sys_invitation).toBe(1);
      expect(counts.sys_team).toBe(1);
      expect(counts.sys_team_member).toBe(1);
      expect(counts.sys_user_permission_set).toBeGreaterThanOrEqual(1);
    }
    expect((await snapshot(org.full)).showcase_category).toBe(2);
    expect((await snapshot(org.full)).showcase_preference).toBe(1);
  });

  it('(a)(c) an organization that owns records is refused 409 with each table and its count, and nothing changes', async () => {
    const before = await snapshot(org.full);
    const orphansBefore = await orphans();
    const activeBefore = await activeOrganizationOf(ownerId);
    expect(activeBefore, 'PREMISE: the owner has the organization active').toContain(org.full);

    const res = await deleteOrg(ownerToken, org.full);

    expect(res.status, await res.clone().text()).toBe(409);
    const body = (await res.json()) as { code?: string; dependents?: Array<{ object: string; count: number }> };
    expect(body.code).toBe('DELETE_RESTRICTED');
    expect([...(body.dependents ?? [])].sort((x, y) => x.object.localeCompare(y.object))).toEqual([
      { object: 'showcase_category', count: 2 },
      { object: 'showcase_preference', count: 1 },
    ]);
    // Counts, never values: no record's name rides the refusal.
    expect(JSON.stringify(body)).not.toContain('Cat A');

    expect(await snapshot(org.full)).toEqual(before);
    expect(await orphans()).toEqual(orphansBefore);
    expect(await activeOrganizationOf(ownerId)).toEqual(activeBefore);
  });

  it('a caller the vendor refuses gets the vendor refusal, never a count', async () => {
    const res = await deleteOrg(adminToken, org.full);
    expect(res.status, await res.clone().text()).toBe(403);
    const body = (await res.json()) as { code?: string; dependents?: unknown };
    expect(body.code).toBe('YOU_ARE_NOT_ALLOWED_TO_DELETE_THIS_ORGANIZATION');
    expect(body.dependents).toBeUndefined();
  });

  it('(b) an empty organization deletes fully: its auth structure goes with it, and nothing is orphaned', async () => {
    const orphansBefore = await orphans();

    const res = await deleteOrg(ownerToken, org.empty);

    expect(res.status, await res.clone().text()).toBe(200);
    expect(await snapshot(org.empty)).toEqual({
      sys_organization: 0,
      sys_member: 0,
      sys_invitation: 0,
      sys_team: 0,
      sys_team_member: 0,
      sys_user_permission_set: 0,
      showcase_category: 0,
      showcase_preference: 0,
    });
    expect(await orphans()).toEqual(orphansBefore);
  });

  it('(d) the engine refuses the same delete on its own, and clears no tenant column', async () => {
    const before = await snapshot(org.full);
    const err: any = await ql
      .delete('sys_organization', { where: { id: org.full }, context: SYSTEM_CTX })
      .then(() => null, (e: unknown) => e);

    expect(err?.code).toBe('DELETE_RESTRICTED');
    expect(err?.status).toBe(409);
    const named = (err?.dependents ?? []).map((d: { object: string }) => d.object);
    expect(named).toEqual(expect.arrayContaining(['showcase_category', 'showcase_preference', 'sys_team']));
    expect(await snapshot(org.full)).toEqual(before);
  });

  it('the operator\'s remedy: once its records are deleted, the organization deletes', async () => {
    for (const object of ['showcase_category', 'showcase_preference']) {
      for (const row of await findRows(ql, object, { organization_id: org.full })) {
        await ql.delete(object, { where: { id: row.id }, context: SYSTEM_CTX });
      }
    }

    const res = await deleteOrg(ownerToken, org.full);

    expect(res.status, await res.clone().text()).toBe(200);
    const after = await snapshot(org.full);
    expect(Object.values(after).every((n) => n === 0), JSON.stringify(after)).toBe(true);
  });
});
