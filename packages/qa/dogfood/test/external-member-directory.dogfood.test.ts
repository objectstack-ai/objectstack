// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#25233] The `external` organization role on a real boot, at the HTTP door
// (ruling 6355206139, letter B, stages 1 and 2).
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
// Stage 2 (the EXTERNAL rung):
//
//   - the OWD baseline never widens an external: on a `public_read` object it
//     reads the rows it owns and the rows shared to it, not every row;
//   - a held grant's RLS lifts that floor for its object, and the RLS bounds
//     the rows (`supplier in current_user.<key>` is this shape);
//   - a `controlled_by_parent` detail is not floored on its own: an external
//     reads the lines of a master shared to it, and no other master's lines;
//   - list-teams and get-full-organization's teams answer an external the
//     teams it sits on; list-invitations answers it its own invitations.
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

/** A `public_read_write` master and its `controlled_by_parent` detail (ADR-0055). */
const MASTER = 'showcase_invoice';
const DETAIL = 'showcase_invoice_line';

/** Read on the master and its detail, nothing else. */
const portalLinesSet = PermissionSetSchema.parse({
  name: 'supplier_portal_lines_25233',
  label: 'Supplier portal, invoices (fixture)',
  objects: {
    [MASTER]: { allowRead: true, allowCreate: false, allowEdit: false, allowDelete: false },
    [DETAIL]: { allowRead: true, allowCreate: false, allowEdit: false, allowDelete: false },
  },
});

/** Title the RLS-bounded portal grant admits. */
const PORTAL_TITLE = 'portal-25233';

/** The same read, bounded by a row policy — a held grant whose RLS speaks for the object. */
const portalRlsSet = PermissionSetSchema.parse({
  name: 'supplier_portal_rls_25233',
  label: 'Supplier portal, row-bounded (fixture)',
  objects: { [GRANTED]: { allowRead: true, allowCreate: false, allowEdit: false, allowDelete: false } },
  rowLevelSecurity: [{ name: 'portal_rows_25233', object: GRANTED, operation: 'select', using: `title == '${PORTAL_TITLE}'` }],
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
  const row: Record<string, string> = {};
  const team: Record<string, string> = {};
  const line: Record<string, string> = {};

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
        defaultPermissionSets: [...securityDefaultPermissionSets, portalSet, portalRlsSet, portalLinesSet],
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
      ['supplierC', 'external'],
      ['supplierD', 'external'],
    ] as const) {
      const email = `${who.toLowerCase()}@${DOMAIN}`;
      token[who] = await stack.signUp(email, 'External!Pass123', `External ${who}`);
      uid[who] = String((await findRows(ql, 'sys_user', { email }, 1))[0]?.id ?? '');
      await memberOf(uid[who], role);
    }

    const portal = await catalogPermissionSet(ql, portalSet.name);
    expect(portal, 'fixture permission set served by the security catalog').toBeTruthy();
    await ql.insert('sys_user_permission_set', { user_id: uid.supplierA, permission_set: portal.name, organization_id: orgId }, { context: SYS });
    const portalRls = await catalogPermissionSet(ql, portalRlsSet.name);
    expect(portalRls, 'fixture row-bounded permission set served by the security catalog').toBeTruthy();
    await ql.insert('sys_user_permission_set', { user_id: uid.supplierC, permission_set: portalRls.name, organization_id: orgId }, { context: SYS });

    // Stage 2 rows on the `public_read` object: the owner's plain row, the
    // owner's row shared to supplierA, the owner's row the RLS grant admits,
    // and supplierA's own row.
    const announce = async (key: string, title: string, owner: string) => {
      const r = await ql.insert(GRANTED, { title, owner_id: uid[owner], organization_id: orgId }, { context: SYS });
      row[key] = String(r.id);
    };
    await announce('plain', 'plain-25233', 'owner');
    await announce('shared', 'shared-25233', 'owner');
    await announce('portal', PORTAL_TITLE, 'owner');
    await announce('ownA', 'own-a-25233', 'supplierA');
    await ql.insert('sys_record_share', {
      object_name: GRANTED, record_id: row.shared, recipient_type: 'user', recipient_id: uid.supplierA,
      access_level: 'read', source: 'manual', organization_id: orgId,
    }, { context: SYS });

    // Two of the owner's invoices, two lines each; the first invoice is shared
    // to supplierD. supplierD and the ordinary member (the control) hold the
    // same read on both objects, and neither owns any of the rows.
    const portalLines = await catalogPermissionSet(ql, portalLinesSet.name);
    expect(portalLines, 'fixture invoice permission set served by the security catalog').toBeTruthy();
    for (const who of ['supplierD', 'member'] as const) {
      await ql.insert('sys_user_permission_set', { user_id: uid[who], permission_set: portalLines.name, organization_id: orgId }, { context: SYS });
    }
    const account = await ql.insert('showcase_account', { name: 'Account 25233', status: 'active', organization_id: orgId }, { context: SYS });
    const product = await ql.insert('showcase_product', { name: 'Product 25233', organization_id: orgId }, { context: SYS });
    for (const key of ['shared', 'other'] as const) {
      const inv = await ql.insert(MASTER, {
        name: `INV-25233-${key}`, account: String(account.id), status: 'draft', owner_id: uid.owner, organization_id: orgId,
      }, { context: SYS });
      row[`inv_${key}`] = String(inv.id);
      for (const n of [1, 2]) {
        const l = await ql.insert(DETAIL, { invoice: String(inv.id), product: String(product.id), description: `${key}-${n}`, owner_id: uid.owner, organization_id: orgId }, { context: SYS });
        line[`${key}${n}`] = String(l.id);
      }
    }
    await ql.insert('sys_record_share', {
      object_name: MASTER, record_id: row.inv_shared, recipient_type: 'user', recipient_id: uid.supplierD,
      access_level: 'read', source: 'manual', organization_id: orgId,
    }, { context: SYS });

    // Two teams; supplierA sits on the first only. One invitation to
    // supplierA's address, one to an outsider.
    for (const [key, name] of [['onA', 'Team A 25233'], ['other', 'Team Other 25233']] as const) {
      const t = await ql.insert('sys_team', { name, organization_id: orgId }, { context: SYS });
      team[key] = String(t.id);
    }
    await ql.insert('sys_team_member', { team_id: team.onA, user_id: uid.supplierA }, { context: SYS });
    for (const email of [`suppliera@${DOMAIN}`, `outsider@${DOMAIN}`]) {
      await ql.insert('sys_invitation', {
        organization_id: orgId, email, role: 'member', status: 'pending',
        inviter_id: uid.owner, expires_at: new Date(Date.now() + 86_400_000).toISOString(),
      }, { context: SYS });
    }

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
      armedWhen({
        control: 'the ordinary member reads every fixture row on the public_read object (the OWD baseline applies)',
        disarmedBy: 'rows a member cannot read either would let the external floor below pass over an empty answer',
        observe: async () => ids('member', `/data/${GRANTED}?limit=200`),
        armed: (o) => o.status === 200 && ['plain', 'shared', 'portal', 'ownA'].every((k) => o.ids.includes(row[k])),
        describe: (o) => `status ${o.status}; rows ${o.ids.length}`,
      }),
      armedWhen({
        control: 'the ordinary member reads both fixture invoices and all four of their lines',
        disarmedBy: 'lines nobody may read would let the master-detail case below pass over an empty answer',
        observe: async () => ({
          invoices: await ids('member', `/data/${MASTER}?limit=200`),
          lines: await ids('member', `/data/${DETAIL}?limit=200`),
        }),
        armed: (o) =>
          o.invoices.status === 200 && [row.inv_shared, row.inv_other].every((id) => o.invoices.ids.includes(id)) &&
          o.lines.status === 200 && Object.values(line).every((id) => o.lines.ids.includes(id)),
        describe: (o) => `invoices ${o.invoices.status}/${o.invoices.ids.length}; lines ${o.lines.status}/${o.lines.ids.length}`,
      }),
      armedWhen({
        control: 'the ordinary member is answered both teams and both invitations',
        disarmedBy: 'a door that answered nobody would let the external narrowing below pass for free',
        observe: async () => ({
          teams: (await auth('member', `list-teams?organizationId=${orgId}`)).body,
          invitations: (await auth('member', `list-invitations?organizationId=${orgId}`)).body,
        }),
        armed: (o) =>
          Array.isArray(o.teams) && [team.onA, team.other].every((id) => o.teams.some((t: any) => t.id === id)) &&
          Array.isArray(o.invitations) && o.invitations.length >= 2,
        describe: (o) => JSON.stringify({ teams: o.teams?.length, invitations: o.invitations?.length }),
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
    for (const who of ['owner', 'member', 'supplierA', 'supplierB', 'supplierC', 'supplierD']) expect(seen).toContain(uid[who]);
    const list = await auth('member', `list-members?organizationId=${orgId}`);
    expect(list.status).toBe(200);
    expect(list.body.members.map((m: any) => m.userId).sort()).toEqual(
      ['owner', 'member', 'supplierA', 'supplierB', 'supplierC', 'supplierD'].map((w) => uid[w]).sort(),
    );
    expect(await statusOf('member', `/data/${APP_DEFAULT_ONLY}`)).toBe(200);
  });

  it('stage 2: the OWD baseline never widens an external — its own rows and the rows shared to it', async () => {
    const { status, ids: seen } = await ids('supplierA', `/data/${GRANTED}?limit=200`);
    expect(status).toBe(200);
    expect(seen.sort()).toEqual([row.shared, row.ownA].sort());
  });

  it('stage 2: a held grant’s RLS lifts the floor for its object, and the RLS bounds the rows', async () => {
    const { status, ids: seen } = await ids('supplierC', `/data/${GRANTED}?limit=200`);
    expect(status).toBe(200);
    expect(seen).toEqual([row.portal]);
  });

  it('stage 2: a controlled_by_parent detail follows its master — the lines of the shared master, and no other', async () => {
    const invoices = await ids('supplierD', `/data/${MASTER}?limit=200`);
    expect(invoices.status).toBe(200);
    expect(invoices.ids).toEqual([row.inv_shared]);
    const lines = await ids('supplierD', `/data/${DETAIL}?limit=200`);
    expect(lines.status).toBe(200);
    expect(lines.ids.sort()).toEqual([line.shared1, line.shared2].sort());
  });

  it('stage 2: list-teams and get-full-organization answer an external the teams it sits on', async () => {
    const teams = await auth('supplierA', `list-teams?organizationId=${orgId}`);
    expect(teams.status).toBe(200);
    expect(teams.body.map((t: any) => t.id)).toEqual([team.onA]);
    const full = await auth('supplierA', `get-full-organization?organizationId=${orgId}`);
    expect(full.status).toBe(200);
    expect((full.body.teams ?? []).map((t: any) => t.id)).toEqual([team.onA]);
    // An external on no team is answered none.
    expect((await auth('supplierB', `list-teams?organizationId=${orgId}`)).body).toEqual([]);
  });

  it('stage 2: list-invitations answers an external its own invitations only', async () => {
    const mine = await auth('supplierA', `list-invitations?organizationId=${orgId}`);
    expect(mine.status).toBe(200);
    expect(mine.body.map((i: any) => i.email)).toEqual([`suppliera@${DOMAIN}`]);
    expect((await auth('supplierB', `list-invitations?organizationId=${orgId}`)).body).toEqual([]);
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
