// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#21388] An org peer is not served the activity rows of a colleague's
// identity updates whose every recorded change it is withheld: no sign-in
// stamp, no failed-sign-in counter. On a real boot, at the HTTP door, on every
// listing face.
//
// ## What the card measured
//
// Since #21237 the identity object's `Admin` field group is withheld from an
// org peer key by key, also inside the activity stream's recorded change. Each
// sign-in still stamped the colleague's identity row with an update the peer
// was served as a row: an empty change, a summary, an actor and a timestamp,
// so the peer read WHEN each sign-in happened. The lockout counter, the
// password-change stamp and the MFA stamp are the same class: updates of
// withheld fields only.
//
// ## The ruled mechanism (triage, direction 1)
//
// The activity read side withholds, from a reader, an update row whose stored
// change had keys and every one of them is withheld from that reader. It is a
// WHERE built by a SYSTEM pre-scan, so the list's `total`, its pages, a by-id
// read and a grouped count all agree with the rows served. A mixed update keeps
// its row with the served key; an admin keeps every row with its change.
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
const DOMAIN = 'withheld-update-21388.verify.test';
const PASS = 'Withheld!Pass123';

/** The declared group, read off the identity object's declaration — never listed here. */
const GROUP: string[] = Object.entries(SysUser.fields as Record<string, { group?: string }>)
  .filter(([, field]) => field.group === 'Admin')
  .map(([name]) => name)
  .sort();

/** Object-level activity read, granted to the member and the admin for the activity door. */
const activityReadSet = PermissionSetSchema.parse({
  name: 'withheld_update_21388_activity_read',
  label: 'Activity read (fixture)',
  objects: { sys_activity: { allowRead: true, allowCreate: false, allowEdit: false, allowDelete: false } },
});

type Row = Record<string, any>;

/** The keys an activity row's recorded change (`metadata.old` / `.new`) carries. */
function changeKeys(row: Row | undefined): string[] {
  let md: any = row?.metadata;
  if (typeof md === 'string') {
    try { md = JSON.parse(md); } catch { md = {}; }
  }
  return [...new Set([...Object.keys(md?.old ?? {}), ...Object.keys(md?.new ?? {})])].sort();
}

describe('[#21388] an org peer is withheld the activity rows of a colleague’s withheld-only identity updates, on every face', () => {
  let stack: VerifyStack;
  let ql: any;
  const token: Record<string, string> = {};
  const uid: Record<string, string> = {};
  /** Classified once from the at-rest read: the rows whose change is group keys only, and the mixed row. */
  const withheldIds: string[] = [];
  let mixedId = '';

  const plain = async (object: string, where: Record<string, unknown>, limit = 50): Promise<Row[]> => {
    const rows = await ql.find(object, { where, limit, context: SYS });
    return Array.isArray(rows) ? rows : (rows?.records ?? []);
  };
  const atRest = () => plain('sys_activity', { object_name: 'sys_user', record_id: uid.colleague }, 200);
  const filter = () => encodeURIComponent(JSON.stringify({ object_name: 'sys_user', record_id: uid.colleague }));
  const list = async (who: string, extra = '') => {
    const res = await stack.apiAs(token[who], 'GET', `/data/sys_activity?$filter=${filter()}&$orderby=timestamp asc${extra}`);
    const body = (await res.json()) as any;
    return { status: res.status, rows: (body.records ?? []) as Row[], total: body.total as number, hasMore: body.hasMore as boolean };
  };

  beforeAll(async () => {
    stack = await bootStack(showcaseStack as unknown as Parameters<typeof bootStack>[0], {
      security: new SecurityPlugin({ defaultPermissionSets: [...securityDefaultPermissionSets, activityReadSet] }),
      extraPlugins: [new AuditPlugin()],
    });
    token.admin = await stack.signIn(); // the seeded platform admin
    ql = await stack.kernel.getServiceAsync<any>('objectql');

    const org = await ql.insert('sys_organization', { name: 'Withheld Update Fixture', slug: 'withheld-update-21388' }, { context: SYS });
    const orgId = String(org.id);
    const memberOf = async (userId: string, role: string) => {
      const existing = await plain('sys_member', { user_id: userId }, 5);
      if (existing.length > 0) {
        await ql.update('sys_member', { id: existing[0].id, organization_id: orgId, role }, { context: SYS });
      } else {
        await ql.insert('sys_member', { user_id: userId, organization_id: orgId, role }, { context: SYS });
      }
      for (const s of await plain('sys_session', { user_id: userId }, 20)) {
        await ql.update('sys_session', { id: s.id, active_organization_id: orgId }, { context: SYS });
      }
    };
    uid.admin = String((await plain('sys_user', { email: 'admin@objectos.ai' }, 1))[0]?.id ?? '');
    await memberOf(uid.admin, 'member');
    for (const who of ['colleague', 'member']) {
      const email = `${who}@${DOMAIN}`;
      token[who] = await stack.signUp(email, PASS, `Withheld Update ${who}`);
      uid[who] = String((await plain('sys_user', { email }, 1))[0]?.id ?? '');
      await memberOf(uid[who], 'member');
    }
    const [activitySet] = await plain('sys_permission_set', { name: activityReadSet.name }, 1);
    expect(activitySet, 'fixture permission set seeded').toBeTruthy();
    for (const who of ['member', 'admin']) {
      await ql.insert('sys_user_permission_set', { user_id: uid[who], permission_set_id: activitySet.id }, { context: SYS });
    }

    // The colleague signs in twice through the auth door (two sign-in stamps),
    // fails one sign-in with lockout accounting on (a counter bump), and is
    // renamed together with a group field (the mixed control).
    await stack.signIn(`colleague@${DOMAIN}`, PASS);
    await stack.signIn(`colleague@${DOMAIN}`, PASS);
    const auth = await stack.kernel.getServiceAsync<any>('auth');
    auth.applyConfigPatch({ lockoutThreshold: 5, lockoutDurationMinutes: 40 });
    const failed = await stack.api('/auth/sign-in/email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: `colleague@${DOMAIN}`, password: 'Not-The-Pass-000' }),
    });
    expect(failed.ok, 'the failed sign-in is refused').toBe(false);
    await ql.update('sys_user', { id: uid.colleague, name: 'Withheld Update Renamed', ban_reason: 'SYNTHETICREASON21388' }, { context: SYS });

    for (const row of await atRest()) {
      const keys = changeKeys(row);
      if (row.type !== 'updated' || keys.length === 0) continue;
      if (keys.every((k) => GROUP.includes(k))) withheldIds.push(String(row.id));
      else if (keys.includes('name') && keys.some((k) => GROUP.includes(k))) mixedId = String(row.id);
    }

    await assertArmed([
      armedWhen({
        control: 'the declared group is non-empty and names the sign-in stamp and the lockout counter',
        disarmedBy: 'a renamed or emptied group would classify no row as withheld, and every absence below would pass over nothing',
        observe: async () => ({ size: GROUP.length, stamp: GROUP.includes('last_login_at'), counter: GROUP.includes('failed_login_count') }),
        armed: (o) => o.size > 0 && o.stamp && o.counter,
        describe: (o) => `group of ${o.size}; stamp in it: ${o.stamp}; counter in it: ${o.counter}`,
      }),
      armedWhen({
        control: 'at rest, the mirror wrote the two sign-in stamps, the counter bump and the mixed rename',
        disarmedBy: 'a fixture write that never landed would let "no such row is served" pass on rows that do not exist',
        observe: async () => {
          const rows = await atRest();
          const keysOf = (id: string) => changeKeys(rows.find((r) => String(r.id) === id));
          return {
            stamps: withheldIds.filter((id) => keysOf(id).includes('last_login_at')).length,
            counter: withheldIds.filter((id) => keysOf(id).includes('failed_login_count')).length,
            mixed: mixedId !== '',
          };
        },
        armed: (o) => o.stamps >= 2 && o.counter >= 1 && o.mixed,
        describe: (o) => `stamp rows: ${o.stamps}; counter rows: ${o.counter}; mixed row: ${o.mixed}`,
      }),
      armedWhen({
        control: 'the member really reads the colleague row (the org-peer visibility policy applies)',
        disarmedBy: 'a member who could not read the record would be served no activity about it at all, and every absence below would pass on the parent gate',
        observe: async () => (await stack.apiAs(token.member, 'GET', `/data/sys_user/${uid.colleague}`)).status,
        armed: (status) => status === 200,
        describe: (status) => `status ${status}`,
      }),
    ]);
  }, 240_000);

  afterAll(async () => {
    await stack?.stop?.();
  });

  it('list: the member is served no withheld-only update row, and the total agrees with the rows', async () => {
    const { status, rows, total, hasMore } = await list('member');
    expect(status).toBe(200);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.map((r) => String(r.id)).filter((id) => withheldIds.includes(id))).toEqual([]);
    expect(total).toBe(rows.length);
    expect(hasMore).toBe(false);
  });

  it('list: the mixed update is still served to the member, with the served key and no group key', async () => {
    const row = (await list('member')).rows.find((r) => String(r.id) === mixedId);
    expect(row, 'mixed row served').toBeTruthy();
    expect(changeKeys(row)).toEqual(['name']);
  });

  it('pages: one row per page, the member walks exactly the listed rows, and every page reports the same total', async () => {
    const full = await list('member');
    const walked: string[] = [];
    for (let skip = 0; skip < full.rows.length + 2; skip++) {
      const page = await list('member', `&$top=1&$skip=${skip}`);
      expect(page.total).toBe(full.total);
      if (page.rows.length === 0) break;
      walked.push(String(page.rows[0].id));
      expect(page.hasMore).toBe(skip + 1 < full.total);
    }
    expect(walked).toEqual(full.rows.map((r) => String(r.id)));
  });

  it('by id: each withheld-only row answers 404 to the member', async () => {
    for (const id of withheldIds) {
      expect((await stack.apiAs(token.member, 'GET', `/data/sys_activity/${id}`)).status, id).toBe(404);
    }
    expect((await stack.apiAs(token.member, 'GET', `/data/sys_activity/${mixedId}`)).status).toBe(200);
  });

  it('query: a filtered query and a grouped count agree with the served rows', async () => {
    const served = await list('member');
    const where = { object_name: 'sys_user', record_id: uid.colleague };
    const q = await stack.apiAs(token.member, 'POST', '/data/sys_activity/query', { where });
    expect(q.status).toBe(200);
    const qb = (await q.json()) as any;
    expect((qb.records ?? []).map((r: Row) => String(r.id)).sort()).toEqual(served.rows.map((r) => String(r.id)).sort());
    const g = await stack.apiAs(token.member, 'POST', '/data/sys_activity/query', {
      where, groupBy: ['type'], aggregations: [{ function: 'count', alias: 'n' }],
    });
    expect(g.status).toBe(200);
    const groups = ((await g.json()) as any).records ?? [];
    expect(groups.reduce((sum: number, row: Row) => sum + Number(row.n), 0)).toBe(served.total);
  });

  it('the admin keeps every row, each withheld-only row with its recorded change', async () => {
    const admin = await list('admin');
    const member = await list('member');
    expect(admin.status).toBe(200);
    const ids = admin.rows.map((r) => String(r.id));
    for (const id of withheldIds) expect(ids, id).toContain(id);
    for (const row of admin.rows.filter((r) => withheldIds.includes(String(r.id)))) {
      expect(changeKeys(row).length).toBeGreaterThan(0);
      expect(changeKeys(row).every((k) => GROUP.includes(k))).toBe(true);
    }
    expect(admin.total).toBe(member.total + withheldIds.length);
  });
});
