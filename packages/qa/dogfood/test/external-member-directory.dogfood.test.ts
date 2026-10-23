// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#25233] The `external` organization role on a real boot, at the HTTP door
// (ruling 6355206139, letter B, stage 1).
//
// ## What the card measured
//
// A supplier's portal user, added to the buyer's organization as a plain
// member and granted one portal permission set, read every employee and every
// other supplier's users through `GET /data/sys_user`: the member baseline's
// `sys_user_org_members` scope (`id in current_user.org_user_ids`) OR-combines
// with any application policy, and better-auth's list-members and
// get-full-organization doors check membership only.
//
// ## What is pinned here (the app-side acceptance, hotsrm 6366488714)
//
//   - an external holder reads only its own `sys_user` and `sys_member` rows,
//     at the data door and at both better-auth directory doors;
//   - with a permission set granting one object, it reads that object and
//     nothing else — not the showcase's `isDefault` objects, which the
//     deployment's baseline hands every member;
//   - an ordinary member is unchanged: the directory, and the app default;
//   - E5: a role list carrying `external` beside another role is refused.
//
// Fixtures are synthetic. ⚠️ No test title states a value.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { type VerifyStack } from '@objectstack/verify';
import { bootShowcase } from './showcase-boot.js';
import { PermissionSetSchema } from '@objectstack/spec/security';
import showcaseStack from '@objectstack/example-showcase';
import { SecurityPlugin, appSecurityPluginOptions, securityDefaultPermissionSets } from '@objectstack/plugin-security';
import { assertArmed, armedWhen } from './armed.js';
import { catalogPermissionSet } from './catalog-permission-set.js';

const SYS = { isSystem: true } as const;
const DOMAIN = 'external-25233.verify.test';
/** The one application object the portal grant opens. */
const GRANTED = 'showcase_announcement';
/** An application object the showcase's `isDefault` set opens to every member — and the portal grant does not. */
const APP_DEFAULT_ONLY = 'showcase_product';

/** The portal grant: read on ONE application object, nothing else. */
const portalSet = PermissionSetSchema.parse({
  name: 'supplier_portal_25233',
  label: 'Supplier portal (fixture)',
  objects: { [GRANTED]: { allowRead: true, allowCreate: false, allowEdit: false, allowDelete: false } },
});

type Row = Record<string, any>;
const rowsOf = (body: any): Row[] => body?.records ?? body?.data ?? (Array.isArray(body) ? body : []);

async function findRows(ql: any, object: string, where: Record<string, unknown>, limit = 50): Promise<Row[]> {
  const rows = await ql.find(object, { where, limit, context: SYS });
  return Array.isArray(rows) ? rows : (rows?.records ?? []);
}

describe('[#25233] an external organization member reads its own identity rows and its explicit grants only', () => {
  let stack: VerifyStack;
  let ql: any;
  let orgId = '';
  const token: Record<string, string> = {};
  const uid: Record<string, string> = {};

  const ids = async (who: string, path: string) => {
    const res = await stack.apiAs(token[who], 'GET', path);
    return { status: res.status, ids: rowsOf(await res.json()).map((r) => String(r.id ?? r.user_id)) };
  };
  const statusOf = async (who: string, path: string) => (await stack.apiAs(token[who], 'GET', path)).status;
  const auth = async (who: string, path: string) => {
    const res = await stack.apiAs(token[who], 'GET', `/auth/organization/${path}`);
    return { status: res.status, body: await res.json() };
  };

  beforeAll(async () => {
    // The showcase's own declared `isDefault` set stays the configured app
    // default (what `objectstack serve` wires), so the external cases measure
    // a deployment default that really reaches every member.
    stack = await bootShowcase({
      security: new SecurityPlugin({
        ...appSecurityPluginOptions(showcaseStack),
        defaultPermissionSets: [...securityDefaultPermissionSets, portalSet],
      }),
    });
    ql = await stack.kernel.getServiceAsync<any>('objectql');

    const org = await ql.insert('sys_organization', { name: 'External Fixture', slug: 'external-25233' }, { context: SYS });
    orgId = String(org.id);
    const memberOf = async (userId: string, role: string) => {
      const existing = await findRows(ql, 'sys_member', { user_id: userId }, 5);
      if (existing.length > 0) {
        await ql.update('sys_member', { id: existing[0].id, organization_id: orgId, role }, { context: SYS });
      } else {
        await ql.insert('sys_member', { user_id: userId, organization_id: orgId, role }, { context: SYS });
      }
      for (const s of await findRows(ql, 'sys_session', { user_id: userId }, 20)) {
        await ql.update('sys_session', { id: s.id, active_organization_id: orgId }, { context: SYS });
      }
    };

    for (const [who, role] of [
      ['owner', 'owner'],
      ['member', 'member'],
      ['supplierA', 'external'],
      ['supplierB', 'external'],
    ] as const) {
      const email = `${who.toLowerCase()}@${DOMAIN}`;
      token[who] = await stack.signUp(email, 'External!Pass123', `External ${who}`);
      uid[who] = String((await findRows(ql, 'sys_user', { email }, 1))[0]?.id ?? '');
      await memberOf(uid[who], role);
    }

    const portal = await catalogPermissionSet(ql, portalSet.name);
    expect(portal, 'fixture permission set served by the security catalog').toBeTruthy();
    await ql.insert('sys_user_permission_set', { user_id: uid.supplierA, permission_set: portal.name, organization_id: orgId }, { context: SYS });

    await assertArmed([
      armedWhen({
        control: 'the four memberships are stored with the roles the cases name',
        disarmedBy: 'a fixture role that never landed would make every external case measure a plain member',
        observe: async () => {
          const rows = await findRows(ql, 'sys_member', { organization_id: orgId });
          return Object.fromEntries(rows.map((r) => [String(r.user_id), String(r.role)]));
        },
        armed: (o) => o[uid.supplierA] === 'external' && o[uid.supplierB] === 'external' && o[uid.member] === 'member',
        describe: (o) => JSON.stringify(o),
      }),
      armedWhen({
        control: 'the ordinary member reads fellow members at the data door (the directory scope applies)',
        disarmedBy: 'a member who could read no one would let "only its own row" pass for an external over an empty answer',
        observe: async () => ids('member', '/data/sys_user'),
        armed: (o) => o.status === 200 && [uid.owner, uid.supplierA, uid.supplierB].every((id) => o.ids.includes(id)),
        describe: (o) => `status ${o.status}; rows ${o.ids.length}`,
      }),
      armedWhen({
        control: 'the showcase isDefault set opens the app-default object to an ordinary member',
        disarmedBy: 'an object nobody may read would let the external refusal below pass for the wrong reason',
        observe: async () => statusOf('member', `/data/${APP_DEFAULT_ONLY}`),
        armed: (s) => s === 200,
        describe: (s) => `status ${s}`,
      }),
    ]);
  }, 180_000);

  afterAll(async () => {
    await stack?.stop?.();
  });

  it('the data door: an external reads its own sys_user row, and no fellow member', async () => {
    for (const who of ['supplierA', 'supplierB']) {
      const { status, ids: seen } = await ids(who, '/data/sys_user');
      expect(status, who).toBe(200);
      expect(seen, who).toEqual([uid[who]]);
    }
  });

  it('the data door: an external reads its own sys_member row only', async () => {
    for (const who of ['supplierA', 'supplierB']) {
      const res = await stack.apiAs(token[who], 'GET', '/data/sys_member');
      expect(res.status, who).toBe(200);
      const rows = rowsOf(await res.json());
      expect(rows.map((r) => String(r.user_id)), who).toEqual([uid[who]]);
    }
  });

  it('the better-auth directory doors answer an external its own member row only', async () => {
    const list = await auth('supplierA', `list-members?organizationId=${orgId}`);
    expect(list.status).toBe(200);
    expect(list.body.members.map((m: any) => m.userId)).toEqual([uid.supplierA]);
    expect(list.body.total).toBe(1);

    const full = await auth('supplierA', `get-full-organization?organizationId=${orgId}`);
    expect(full.status).toBe(200);
    expect(full.body.members.map((m: any) => m.userId)).toEqual([uid.supplierA]);
  });

  it('with one grant it reads that object, and not the objects the deployment defaults open to members', async () => {
    expect(await statusOf('supplierA', `/data/${GRANTED}`)).toBe(200);
    expect(await statusOf('supplierA', `/data/${APP_DEFAULT_ONLY}`)).toBe(403);
    // The grant is the whole of it: the external without one reads neither.
    expect(await statusOf('supplierB', `/data/${GRANTED}`)).toBe(403);
    expect(await statusOf('supplierB', `/data/${APP_DEFAULT_ONLY}`)).toBe(403);
  });

  it('CONTROL: an ordinary member is unchanged — the directory at both doors, and the app default', async () => {
    const { ids: seen } = await ids('member', '/data/sys_user');
    for (const who of ['owner', 'member', 'supplierA', 'supplierB']) expect(seen).toContain(uid[who]);
    const list = await auth('member', `list-members?organizationId=${orgId}`);
    expect(list.status).toBe(200);
    expect(list.body.members.map((m: any) => m.userId).sort()).toEqual(
      ['owner', 'member', 'supplierA', 'supplierB'].map((w) => uid[w]).sort(),
    );
    expect(await statusOf('member', `/data/${APP_DEFAULT_ONLY}`)).toBe(200);
  });

  it('E5: an owner cannot give a member external beside another role', async () => {
    const [row] = await findRows(ql, 'sys_member', { user_id: uid.member, organization_id: orgId }, 1);
    const res = await stack.apiAs(token.owner, 'POST', '/auth/organization/update-member-role', {
      memberId: row.id,
      role: ['external', 'member'],
      organizationId: orgId,
    });
    expect(res.status).toBe(400);
    const [after] = await findRows(ql, 'sys_member', { id: row.id }, 1);
    expect(after.role).toBe('member');
  });
});
