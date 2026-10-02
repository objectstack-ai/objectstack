// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#21237] The identity object's `Admin` field group is served to an org peer
// only when the reader holds an admin set — on a real boot, at the HTTP door.
//
// ## What the card measured
//
// `member_default` (the `everyone` baseline) opens every org peer's identity
// row through `sys_user_org_members` and declared no field-level security on
// it, so an org member reading a colleague's row was served the whole `Admin`
// group: the sign-in trail, the lockout state, the ban reason and expiry. With
// object-level activity read, the colleague's activity metadata carried the same
// group, because the activity field redaction serves exactly what the data
// plane serves.
//
// ## The ruled mechanism (triage, direction A; Q1 = B on the same card)
//
// The shipped non-admin sets withhold the group through the permission set's
// existing `fields` → `readable: false`, built from the identity object's
// declaration; the admin sets keep it. The deactivation flag is declared
// OUTSIDE the group: it is directory status, and every user picker filters its
// candidates on it.
//
// ## What is pinned here, persona by persona
//
//   - a MEMBER reading a colleague: no group field, the directory fields and the
//     deactivation flag served (the control that the row is not simply gone);
//   - the same member through the ACTIVITY door: rows still served, no group key
//     in any row's recorded change;
//   - the member's OWN row through the generic data API: no group field either
//     (field-level security is row-blind; every own-row reader of the group
//     reads through system or auth context);
//   - the member's user-context WRITE naming a group field: refused by the
//     field-level write gate, and a mixed payload does not partially succeed;
//   - the user picker's candidate query (the not-deactivated filter) as the
//     member: served, deactivated peers excluded;
//   - the ORG OWNER and a PLATFORM ADMIN (who holds no org-admin grant): the
//     full group on both doors, and the platform admin's write unchanged.
//
// Fixtures are synthetic. ⚠️ No test title states a value.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import showcaseStack from '@objectstack/example-showcase';
import { bootStack, type VerifyStack } from '@objectstack/verify';
import { AuditPlugin } from '@objectstack/plugin-audit';
import { PermissionSetSchema } from '@objectstack/spec/security';
import { SecurityPlugin, securityDefaultPermissionSets } from '@objectstack/plugin-security';
import { SysUser } from '@objectstack/platform-objects/identity';
import { assertArmed, armedWhen } from './armed.js';

const SYS = { isSystem: true } as const;
const DOMAIN = 'org-peer-21237.verify.test';

/** The declared group, read off the identity object's declaration — never listed here. */
const GROUP: string[] = Object.entries(SysUser.fields as Record<string, { group?: string }>)
  .filter(([, field]) => field.group === 'Admin')
  .map(([name]) => name)
  .sort();

/** Synthetic values for the colleague's group fields, written as the system. */
const SYNTHETIC: Record<string, unknown> = {
  last_login_ip: 'SYNTHETIC-ADDRESS-ONE',
  failed_login_count: 2,
  ban_reason: 'SYNTHETICREASON21237',
};
const SYNTHETIC_NEXT: Record<string, unknown> = { last_login_ip: 'SYNTHETIC-ADDRESS-TWO', failed_login_count: 3 };

/** Object-level activity read, granted to the member for the activity door. */
const activityReadSet = PermissionSetSchema.parse({
  name: 'org_peer_21237_activity_read',
  label: 'Activity read (fixture)',
  objects: { sys_activity: { allowRead: true, allowCreate: false, allowEdit: false, allowDelete: false } },
});

type Row = Record<string, any>;
const rowsOf = (body: any): Row[] => body?.records ?? body?.data ?? (Array.isArray(body) ? body : []);
const recordOf = (body: any): Row => body?.record ?? body;

async function findRows(ql: any, object: string, where: Record<string, unknown>, limit = 50): Promise<Row[]> {
  const rows = await ql.find(object, { where, limit, context: SYS });
  return Array.isArray(rows) ? rows : (rows?.records ?? []);
}

/** The group keys an activity row's recorded change (`metadata.old` / `.new`) carries. */
function groupKeysIn(rows: Row[]): string[] {
  const keys = new Set<string>();
  for (const row of rows) {
    let md: any = row.metadata;
    if (typeof md === 'string') {
      try { md = JSON.parse(md); } catch { md = {}; }
    }
    for (const side of ['old', 'new']) {
      for (const k of Object.keys(md?.[side] ?? {})) if (GROUP.includes(k)) keys.add(k);
    }
  }
  return [...keys].sort();
}

describe('[#21237] the identity object Admin group at the HTTP door: org peers are withheld it, admins keep it', () => {
  let stack: VerifyStack;
  let ql: any;
  let orgId = '';
  const token: Record<string, string> = {};
  const uid: Record<string, string> = {};

  const readRow = async (who: string, target: string) => {
    const res = await stack.apiAs(token[who], 'GET', `/data/sys_user/${uid[target]}`);
    const body = await res.json();
    return { status: res.status, row: recordOf(body) as Row };
  };
  const activityRows = async (who: string, target: string) => {
    const filter = encodeURIComponent(JSON.stringify({ object_name: 'sys_user', record_id: uid[target] }));
    const res = await stack.apiAs(token[who], 'GET', `/data/sys_activity?$filter=${filter}`);
    return { status: res.status, rows: rowsOf(await res.json()) };
  };
  const servedGroup = (row: Row) => GROUP.filter((f) => f in row);

  beforeAll(async () => {
    stack = await bootStack(showcaseStack as unknown as Parameters<typeof bootStack>[0], {
      security: new SecurityPlugin({ defaultPermissionSets: [...securityDefaultPermissionSets, activityReadSet] }),
      extraPlugins: [new AuditPlugin()],
    });
    token.admin = await stack.signIn(); // the seeded platform admin
    ql = await stack.kernel.getServiceAsync<any>('objectql');

    const org = await ql.insert('sys_organization', { name: 'Org Peer Fixture', slug: 'org-peer-21237' }, { context: SYS });
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

    // The platform admin is a plain MEMBER of the org: it holds no org-admin
    // grant, so what it keeps is `admin_full_access`'s own keeping entry.
    uid.admin = String((await findRows(ql, 'sys_user', { email: 'admin@objectos.ai' }, 1))[0]?.id ?? '');
    await memberOf(uid.admin, 'member');

    for (const [who, role] of [['owner', 'owner'], ['colleague', 'member'], ['member', 'member'], ['deactivated', 'member']] as const) {
      const email = `${who}@${DOMAIN}`;
      token[who] = await stack.signUp(email, 'OrgPeer!Pass123', `Org Peer ${who}`);
      uid[who] = String((await findRows(ql, 'sys_user', { email }, 1))[0]?.id ?? '');
      await memberOf(uid[who], role);
    }

    const [activitySet] = await findRows(ql, 'sys_permission_set', { name: activityReadSet.name }, 1);
    expect(activitySet, 'fixture permission set seeded').toBeTruthy();
    for (const who of ['member', 'owner', 'admin']) {
      await ql.insert('sys_user_permission_set', { user_id: uid[who], permission_set_id: activitySet.id }, { context: SYS });
    }

    // The colleague's group values, written as the system in two steps so the
    // activity mirror records a change of them; and one deactivated peer.
    const attributed = { context: { ...SYS, attributedUserId: uid.colleague } };
    await ql.update('sys_user', { id: uid.colleague, ...SYNTHETIC }, attributed);
    await ql.update('sys_user', { id: uid.colleague, ...SYNTHETIC_NEXT }, attributed);
    await ql.update('sys_user', { id: uid.deactivated, banned: true }, { context: SYS });

    await assertArmed([
      armedWhen({
        control: 'the declared group is non-empty and names the sign-in trail',
        disarmedBy: 'a renamed or emptied group would make every "no group field" assertion below pass over nothing',
        observe: async () => ({ size: GROUP.length, trail: GROUP.includes('last_login_ip') }),
        armed: (o) => o.size > 0 && o.trail,
        describe: (o) => `group of ${o.size}; sign-in trail in it: ${o.trail}`,
      }),
      armedWhen({
        control: 'the colleague row and its activity rows at rest carry group values',
        disarmedBy: 'a fixture write that never landed would let every negative case pass on empty columns',
        observe: async () => {
          const [row] = await findRows(ql, 'sys_user', { id: uid.colleague }, 1);
          const rows = await findRows(ql, 'sys_activity', { object_name: 'sys_user', record_id: uid.colleague });
          return {
            stored: Object.keys(SYNTHETIC_NEXT).every((k) => row?.[k] === SYNTHETIC_NEXT[k]),
            activityRows: rows.length,
            activityKeys: groupKeysIn(rows).length,
          };
        },
        armed: (o) => o.stored && o.activityRows > 0 && o.activityKeys > 0,
        describe: (o) => `stored: ${o.stored}; activity rows: ${o.activityRows}; group keys at rest: ${o.activityKeys}`,
      }),
      armedWhen({
        control: 'the member really reads the colleague row (the org-peer visibility policy applies)',
        disarmedBy: 'a member who could not read the row at all would pass "no group field" with a 404',
        observe: async () => {
          const { status, row } = await readRow('member', 'colleague');
          return { status, id: String(row?.id ?? '') };
        },
        armed: (o) => o.status === 200 && o.id === uid.colleague,
        describe: (o) => `status ${o.status}; row served: ${o.id === uid.colleague}`,
      }),
    ]);
  }, 240_000);

  afterAll(async () => {
    await stack?.stop?.();
  });

  it('the deactivation flag is declared outside the group (directory status: every user picker filters on it)', () => {
    expect(GROUP).not.toContain('banned');
  });

  it('a member reading a colleague is served no group field; the directory fields and the deactivation flag are served', async () => {
    const { status, row } = await readRow('member', 'colleague');
    expect(status).toBe(200);
    expect(servedGroup(row)).toEqual([]);
    for (const field of ['name', 'email', 'banned']) expect(row, field).toHaveProperty(field);
  });

  it('the list door serves the member the colleague row without any group field', async () => {
    const res = await stack.apiAs(token.member, 'GET', '/data/sys_user?$top=100');
    expect(res.status).toBe(200);
    const row = rowsOf(await res.json()).find((r) => String(r.id) === uid.colleague);
    expect(row, 'colleague listed').toBeTruthy();
    expect(servedGroup(row!)).toEqual([]);
  });

  it('through the activity door the member is served the colleague rows with no group key in any recorded change', async () => {
    const { status, rows } = await activityRows('member', 'colleague');
    expect(status).toBe(200);
    expect(rows.length).toBeGreaterThan(0);
    expect(groupKeysIn(rows)).toEqual([]);
  });

  it('the member own row through the generic data API is withheld the group too', async () => {
    const { status, row } = await readRow('member', 'member');
    expect(status).toBe(200);
    expect(String(row.id)).toBe(uid.member);
    expect(servedGroup(row)).toEqual([]);
  });

  it('a member write naming a group field is refused by the field-level write gate, and the mixed payload does not partially land', async () => {
    const [before] = await findRows(ql, 'sys_user', { id: uid.member }, 1);
    const res = await stack.apiAs(token.member, 'PATCH', `/data/sys_user/${uid.member}`, {
      name: 'Renamed By Mixed Payload',
      failed_login_count: 0,
    });
    expect(res.status).toBe(403);
    const body = (await res.json()) as { code?: string; error?: { code?: string } };
    expect(body.code ?? body.error?.code).toBe('PERMISSION_DENIED');
    // The refusal names the group field it refused — the field-level write
    // gate's verdict, not some other layer's.
    expect(JSON.stringify(body)).toContain('failed_login_count');
    const [after] = await findRows(ql, 'sys_user', { id: uid.member }, 1);
    expect(after.name).toBe(before.name);
  });

  it('a member profile write naming no group field still lands (the control for the refusal above)', async () => {
    const res = await stack.apiAs(token.member, 'PATCH', `/data/sys_user/${uid.member}`, { name: 'Renamed Profile Only' });
    expect(res.status).toBe(200);
    const [after] = await findRows(ql, 'sys_user', { id: uid.member }, 1);
    expect(after.name).toBe('Renamed Profile Only');
  });

  it('the user picker candidate query (the not-deactivated filter) is served to the member and excludes the deactivated peer', async () => {
    const filter = encodeURIComponent(JSON.stringify({ banned: { $ne: true } }));
    const res = await stack.apiAs(token.member, 'GET', `/data/sys_user?$filter=${filter}&$top=100`);
    expect(res.status).toBe(200);
    const ids = rowsOf(await res.json()).map((r) => String(r.id));
    expect(ids).toContain(uid.colleague);
    expect(ids).not.toContain(uid.deactivated);
    // …and the exclusion is the filter's doing: unfiltered, the member reads the
    // deactivated peer, with the flag served.
    const unfiltered = rowsOf(await (await stack.apiAs(token.member, 'GET', '/data/sys_user?$top=100')).json());
    const peer = unfiltered.find((r) => String(r.id) === uid.deactivated);
    expect(peer, 'deactivated peer listed unfiltered').toBeTruthy();
    expect(peer!.banned).toBeTruthy();
  });

  it('a member query filtering on a group field is still refused (the filter oracle stays closed)', async () => {
    const filter = encodeURIComponent(JSON.stringify({ failed_login_count: { $gt: 0 } }));
    const res = await stack.apiAs(token.member, 'GET', `/data/sys_user?$filter=${filter}`);
    expect(res.status).toBe(403);
    const body = (await res.json()) as { code?: string; error?: { code?: string } };
    expect(body.code ?? body.error?.code).toBe('PERMISSION_DENIED');
  });

  it.each(['owner', 'admin'])('the %s keeps the full group on the direct read and in the activity metadata', async (who) => {
    const { status, row } = await readRow(who, 'colleague');
    expect(status).toBe(200);
    expect(servedGroup(row)).toEqual(GROUP);
    const activity = await activityRows(who, 'colleague');
    expect(activity.status).toBe(200);
    expect(groupKeysIn(activity.rows)).toEqual(
      groupKeysIn(await findRows(ql, 'sys_activity', { object_name: 'sys_user', record_id: uid.colleague })),
    );
  });

  it('the platform admin write naming a group field is not refused by the field-level write gate (admin writes unchanged)', async () => {
    const res = await stack.apiAs(token.admin, 'PATCH', `/data/sys_user/${uid.colleague}`, {
      name: 'Renamed By Admin',
      failed_login_count: 0,
    });
    const text = await res.text();
    expect(text).not.toContain('Field write denied');
    expect(res.status, text).toBe(200);
    const [after] = await findRows(ql, 'sys_user', { id: uid.colleague }, 1);
    expect(after.name).toBe('Renamed By Admin');
  });
});
