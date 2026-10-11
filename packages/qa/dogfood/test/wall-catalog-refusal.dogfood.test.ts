// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [ADR-0131 D3] The walled catalog refusal, on a REAL booted stack.
//
// ADR-0131 D3: under `group` / `isolated` "tenant admins cannot create or edit
// catalog items; the operator defines the catalog for every tenant … Creation
// through Setup or the API is refused with a message naming the posture and
// the capability." The catalog (positions, permission sets, capabilities) is
// environment-level, and every organization resolves it by name.
//
// What this file measured before the refusal, on this same harness, under both
// walled postures: organization A's owner, granted `manage_metadata` inside
// organization A only (an organization-scoped grant, never the platform
// operator rung), saved `PUT /meta/permission/:name` over an environment
// permission set organization B's member holds, adding `manage_users`; B's
// member's next resolution carried `manage_users`. One organization's write
// changed what another organization's members resolve. The same principal
// created and deleted catalog items at `/meta`, and a holder of CRUD on
// `sys_permission_set` created an environment permission set through the data
// door's write-through.
//
// Pinned here:
//   - walled: org A's catalog writes at `/meta` (save, create, delete) answer
//     `403 FORBIDDEN`, and B's resolution does not move;
//   - walled: the data door's catalog creates answer `403 PERMISSION_DENIED`,
//     and nothing reaches the environment ledger;
//   - walled: the permission-set clone door refuses org A a clone
//     `403 PERMISSION_DENIED`, and nothing is saved;
//   - walled CONTROLS: org A still assigns a catalog permission set to its own
//     member, and the platform operator still saves the catalog;
//   - `single` CONTROL: a `manage_metadata` holder who is not the platform
//     administrator still saves a position (#22621 → A, unchanged).
//
// The boot is `multiTenant: 'posture-only'`: a real, non-degraded walled
// posture. The refusal keys on the posture and the caller's rung, never on row
// isolation, so the stand-in's lack of a row wall measures nothing away here.
// `OS_TENANCY_POSTURE` selects `group`; the harness declares the seeded admin
// as `OS_PLATFORM_OWNER_EMAIL`, so that admin is the platform operator.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import crmStack from '@objectstack/example-crm';
import { resolveUserAuthzGrants } from '@objectstack/core';
import { bootStack, type VerifyStack } from '@objectstack/verify';

const SYS = { isSystem: true, positions: [], permissions: [] };

interface Engine {
  find(object: string, options?: unknown): Promise<Array<Record<string, unknown>>>;
  insert(object: string, data: Record<string, unknown>, options?: unknown): Promise<unknown>;
}

/** The ADR-0112 envelope a refusal answered: `error.code` and the HTTP status. */
async function envelopeOf(res: Response): Promise<{ status: number; code: unknown }> {
  const body = (await res.clone().json().catch(() => ({}))) as { error?: { code?: unknown }; code?: unknown };
  return { status: res.status, code: body?.error?.code ?? body?.code };
}

const META_AUTHOR = 'w_meta_author';
const SHARED = 'w_shared';
const RBAC_WRITER = 'w_rbac_writer';

for (const posture of ['isolated', 'group'] as const) {
  describe(`[ADR-0131 D3] ${posture}: the security catalog is the platform operator's`, () => {
    let stack: VerifyStack;
    let ql: Engine;
    let operator: string;
    let tokA: string;
    let orgA: string;
    let orgB: string;
    let userA: string;
    let userB: string;
    const previous = process.env.OS_TENANCY_POSTURE;

    const idOf = async (email: string) =>
      String((await ql.find('sys_user', { where: { email }, limit: 1, context: SYS }))[0]?.id);
    const bSystemPermissions = async () =>
      (await resolveUserAuthzGrants(ql as never, userB, { tenantId: orgB })).systemPermissions;
    const definitionOf = async (type: string, name: string) => {
      const res = await stack.apiAs(operator, 'GET', `/meta/${type}/${name}`);
      return res.status === 200 ? ((await res.json()) as any) : null;
    };

    beforeAll(async () => {
      process.env.OS_TENANCY_POSTURE = posture;
      stack = await bootStack(crmStack as never, { multiTenant: 'posture-only' });
      ql = (await stack.kernel.getServiceAsync('objectql')) as unknown as Engine;
      operator = await stack.signIn();
      tokA = await stack.signUp(`w-a-${posture}@wall.test`);
      const tokB = await stack.signUp(`w-b-${posture}@wall.test`);
      for (const [tok, slug] of [[tokA, `w-a-${posture}`], [tokB, `w-b-${posture}`]] as const) {
        const created = await stack.apiAs(tok, 'POST', '/auth/organization/create', { name: slug, slug });
        expect(created.status, await created.clone().text()).toBe(200);
        const id = ((await created.json()) as { id: string }).id;
        if (tok === tokA) orgA = id; else orgB = id;
        const active = await stack.apiAs(tok, 'POST', '/auth/organization/set-active', { organizationSlug: slug });
        expect(active.status, await active.clone().text()).toBe(200);
      }
      userA = await idOf(`w-a-${posture}@wall.test`);
      userB = await idOf(`w-b-${posture}@wall.test`);

      // The operator authors the catalog, and grants inside each organization:
      // A holds `manage_metadata` and CRUD on the catalog and assignment tables
      // in org A only (the stock `organization_admin` denies those tables, so
      // without this grant the data door would refuse A on CRUD alone);
      // B's member holds the shared set in org B.
      const rbac = { allowRead: true, allowCreate: true, allowEdit: true, allowDelete: true };
      for (const body of [
        { name: META_AUTHOR, label: 'Meta author', objects: {}, systemPermissions: ['manage_metadata'] },
        { name: SHARED, label: 'Shared', objects: {}, systemPermissions: [] },
        { name: RBAC_WRITER, label: 'Catalog table writer', systemPermissions: [], objects: { sys_permission_set: rbac, sys_position: rbac, sys_user_permission_set: rbac, sys_user_position: rbac } },
      ]) {
        const saved = await stack.apiAs(operator, 'PUT', `/meta/permission/${body.name}`, body);
        expect(saved.status, await saved.clone().text()).toBe(200);
      }
      for (const name of [META_AUTHOR, RBAC_WRITER]) {
        await ql.insert('sys_user_permission_set', { user_id: userA, permission_set: name, organization_id: orgA },
          { context: { ...SYS, tenantId: orgA } });
      }
      await ql.insert('sys_user_permission_set', { user_id: userB, permission_set: SHARED, organization_id: orgB },
        { context: { ...SYS, tenantId: orgB } });
    }, 180_000);

    afterAll(async () => {
      await stack?.stop?.();
      if (previous === undefined) delete process.env.OS_TENANCY_POSTURE;
      else process.env.OS_TENANCY_POSTURE = previous;
    });

    it('guard the guard: a real walled posture; A holds `manage_metadata` in org A and is not the platform operator', async () => {
      const tenancy = await stack.kernel.getServiceAsync<{ posture: string; degraded: boolean }>('tenancy');
      expect(tenancy.posture).toBe(posture);
      expect(tenancy.degraded).toBe(false);
      expect(orgA).toBeTruthy();
      expect(orgB).toBeTruthy();
      expect(orgA).not.toBe(orgB);
      const a = await resolveUserAuthzGrants(ql as never, userA, { tenantId: orgA });
      expect(a.systemPermissions).toContain('manage_metadata');
      expect(a.posture).not.toBe('PLATFORM_ADMIN');
      const session = (await (await stack.apiAs(tokA, 'GET', '/auth/get-session')).json()) as any;
      expect(session.user?.isPlatformAdmin).toBe(false);
      expect(session.session?.activeOrganizationId).toBe(orgA);
    });

    it("org A's edit of a permission set org B's member holds is refused 403 FORBIDDEN, and B's resolution does not move", async () => {
      const before = await bSystemPermissions();
      expect(before).not.toContain('manage_users');
      const res = await stack.apiAs(tokA, 'PUT', `/meta/permission/${SHARED}`, {
        name: SHARED, label: 'Edited by organization A', objects: {}, systemPermissions: ['manage_users'],
      });
      expect(await envelopeOf(res)).toEqual({ status: 403, code: 'FORBIDDEN' });
      expect(await bSystemPermissions()).toEqual(before);
      expect((await definitionOf('permission', SHARED))?.item?.label).toBe('Shared');
    });

    it('org A cannot create a position, a permission set or a capability at `/meta`, nor delete one', async () => {
      for (const [type, name, body] of [
        ['position', 'w_tenant_pos', { name: 'w_tenant_pos', label: 'Tenant position', permissionSets: [SHARED] }],
        ['permission', 'w_tenant_set', { name: 'w_tenant_set', label: 'Tenant set', objects: {} }],
        ['capability', 'w.tenant', { name: 'w.tenant', label: 'Tenant capability', scope: 'org' }],
      ] as const) {
        const res = await stack.apiAs(tokA, 'PUT', `/meta/${type}/${name}`, body);
        expect(await envelopeOf(res), `${type} ${name}`).toEqual({ status: 403, code: 'FORBIDDEN' });
      }
      expect((await definitionOf('position', 'w_tenant_pos'))?.item).toBeFalsy();
      expect((await definitionOf('permission', 'w_tenant_set'))?.item).toBeFalsy();

      const del = await stack.apiAs(tokA, 'DELETE', `/meta/permission/${SHARED}`);
      expect(await envelopeOf(del)).toEqual({ status: 403, code: 'FORBIDDEN' });
      expect((await definitionOf('permission', SHARED))?.item?.name).toBe(SHARED);
    });

    it('the data door refuses org A a catalog create 403 PERMISSION_DENIED, and nothing reaches the environment ledger', async () => {
      const set = await stack.apiAs(tokA, 'POST', '/data/sys_permission_set', { name: 'w_dd_set', label: 'Data door set' });
      expect(await envelopeOf(set)).toEqual({ status: 403, code: 'PERMISSION_DENIED' });
      expect((await definitionOf('permission', 'w_dd_set'))?.item).toBeFalsy();

      const position = await stack.apiAs(tokA, 'POST', '/data/sys_position', { name: 'w_dd_pos', label: 'Data door position' });
      expect(await envelopeOf(position)).toEqual({ status: 403, code: 'PERMISSION_DENIED' });
      expect(await ql.find('sys_position', { where: { name: 'w_dd_pos' }, context: SYS })).toEqual([]);
    });

    it("the clone door refuses org A a clone of an environment set 403 PERMISSION_DENIED, and nothing is saved", async () => {
      const res = await stack.apiAs(tokA, 'POST', `/security/permission-sets/${SHARED}/clone`, {
        name: 'w_tenant_clone', label: 'Tenant clone',
      });
      expect(await envelopeOf(res)).toEqual({ status: 403, code: 'PERMISSION_DENIED' });
      expect((await definitionOf('permission', 'w_tenant_clone'))?.item).toBeFalsy();
    });

    it('CONTROL: the platform operator still clones a catalog set', async () => {
      const res = await stack.apiAs(operator, 'POST', `/security/permission-sets/${SHARED}/clone`, {
        name: 'w_operator_clone', label: 'Operator clone',
      });
      expect(res.status, await res.clone().text()).toBe(200);
      expect((await definitionOf('permission', 'w_operator_clone'))?.item?.name).toBe('w_operator_clone');
    });

    it('CONTROL: org A still assigns a catalog permission set to its own member', async () => {
      const res = await stack.apiAs(tokA, 'POST', '/data/sys_user_permission_set', { user_id: userA, permission_set: SHARED });
      expect(res.status, await res.clone().text()).toBe(201);
    });

    it('CONTROL: the platform operator still saves the catalog', async () => {
      const res = await stack.apiAs(operator, 'PUT', '/meta/position/w_operator_pos', {
        name: 'w_operator_pos', label: 'Operator position', permissionSets: [SHARED],
      });
      expect(res.status, await res.clone().text()).toBe(200);
      expect((await definitionOf('position', 'w_operator_pos'))?.item?.name).toBe('w_operator_pos');
    });
  });
}

describe('[ADR-0131 D3] single: a `manage_metadata` holder still authors the catalog (control)', () => {
  let stack: VerifyStack;
  let ql: Engine;
  let author: string;

  beforeAll(async () => {
    stack = await bootStack(crmStack as never, {});
    ql = (await stack.kernel.getServiceAsync('objectql')) as unknown as Engine;
    const operator = await stack.signIn();
    author = await stack.signUp('w-single-author@wall.test');
    const saved = await stack.apiAs(operator, 'PUT', `/meta/permission/${META_AUTHOR}`, {
      name: META_AUTHOR, label: 'Meta author', objects: {}, systemPermissions: ['manage_metadata'],
    });
    expect(saved.status, await saved.clone().text()).toBe(200);
    const [user] = await ql.find('sys_user', { where: { email: 'w-single-author@wall.test' }, limit: 1, context: SYS });
    await ql.insert('sys_user_permission_set', { user_id: String(user.id), permission_set: META_AUTHOR }, { context: SYS });
  }, 180_000);

  afterAll(async () => {
    await stack?.stop?.();
  });

  it('saves a position: 200, unchanged by the walled refusal', async () => {
    const tenancy = await stack.kernel.getServiceAsync<{ posture: string }>('tenancy').catch(() => undefined);
    expect(tenancy?.posture ?? 'single').toBe('single');
    const session = (await (await stack.apiAs(author, 'GET', '/auth/get-session')).json()) as any;
    expect(session.user?.isPlatformAdmin).toBe(false);
    const res = await stack.apiAs(author, 'PUT', '/meta/position/w_single_pos', { name: 'w_single_pos', label: 'Single position' });
    expect(res.status, await res.clone().text()).toBe(200);
  });
});
