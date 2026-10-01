// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// `sys_activity` parent-record read visibility, through the public data doors.
//
// A principal holding object-level `sys_activity` read gets back only the
// activity rows whose parent record (`object_name`, `record_id`) it can read,
// the same way plugin-audit narrows `sys_comment`. This file drives that on a
// real org-bound boot — better-auth sign-ups, the platform permission sets
// plus one explicit `sys_activity` read grant, plugin-audit's real CRUD mirror
// writing the rows — through every generic door that reads the object:
//
//   GET  /data/sys_activity              list (+ its `total`)
//   GET  /data/sys_activity/:id          by id
//   POST /data/sys_activity/query        a filtered query, and a grouped count
//
// The invariant is asserted per returned row (the member can open the row's
// parent record through the same data door), so it holds for every parent the
// boot writes activity about — platform objects included — not only for the
// two fixture records named below.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { bootStack, type VerifyStack } from '@objectstack/verify';
import { AuditPlugin } from '@objectstack/plugin-audit';
import { SecurityPlugin, securityDefaultPermissionSets } from '@objectstack/plugin-security';
import { PermissionSetSchema, type PermissionSet } from '@objectstack/spec/security';
import { commentsFixtureStack, cmtFixtureBaselineSet } from './fixtures/comments-fixture.js';
import { assertArmed, principalArmed } from './armed.js';

const SYS = { isSystem: true } as const;
const MEMBER_EMAIL = 'act-gate-member@verify.test';

/** The grant under test: object-level read on the activity stream, nothing more. */
const activityReaderSet: PermissionSet = PermissionSetSchema.parse({
  name: 'act_activity_reader',
  label: 'Activity gate fixture — object-level sys_activity read',
  objects: { sys_activity: { allowRead: true } },
});

type Row = Record<string, any>;
const rowsOf = async (res: Response): Promise<Row[]> => ((await res.json()) as any).records ?? [];

describe('sys_activity: a member reads the activity of records it can read, and nothing else', () => {
  let stack: VerifyStack;
  let ql: any;
  let adminTok: string;
  let memberTok: string;
  let privateId: string; // cmt_private, owned by the admin — the member cannot read it
  let openId: string; // cmt_open, created by the member — the member reads it

  beforeAll(async () => {
    stack = await bootStack(commentsFixtureStack as never, {
      security: new SecurityPlugin({
        defaultPermissionSets: [...securityDefaultPermissionSets, cmtFixtureBaselineSet, activityReaderSet],
        fallbackPermissionSet: cmtFixtureBaselineSet.name,
      }),
      extraPlugins: [new AuditPlugin()],
      // Org-bound: the member holds `org_member`, the position the platform's
      // member floors are domained to.
      orgContext: true,
    });
    adminTok = await stack.signIn();
    memberTok = await stack.signUp(MEMBER_EMAIL);
    ql = await stack.kernel.getServiceAsync('objectql');

    const memberId = (await ql.findOne('sys_user', { where: { email: MEMBER_EMAIL }, context: SYS }))?.id;
    const set = await ql.findOne('sys_permission_set', { where: { name: activityReaderSet.name }, context: SYS });
    expect(set?.id, 'fixture permission set seeded').toBeTruthy();
    await ql.insert('sys_user_permission_set', { user_id: memberId, permission_set_id: set.id }, { context: { ...SYS } });

    await assertArmed([
      principalArmed({
        stack,
        token: memberTok,
        who: 'the member holding object-level sys_activity read',
        positions: ['org_member'],
        permissions: [activityReaderSet.name],
        control: 'object-level read on sys_activity, granted by an explicit permission set',
        disarmedBy: 'a member that never resolved the grant would read nothing at all, and every narrowing case below would pass on an empty list',
      }),
    ]);

    const idOf = async (res: Response) => {
      expect(res.status, 'fixture write').toBeLessThan(300);
      const j = (await res.json()) as any;
      return String(j.id ?? j.record?.id ?? j.data?.id);
    };
    privateId = await idOf(await stack.apiAs(adminTok, 'POST', '/data/cmt_private', { name: 'admin only' }));
    expect((await stack.apiAs(adminTok, 'PATCH', `/data/cmt_private/${privateId}`, { name: 'admin only, renamed' })).status).toBeLessThan(300);
    openId = await idOf(await stack.apiAs(memberTok, 'POST', '/data/cmt_open', { name: 'shared board' }));

    // Controls: the parent readability this file leans on, read through the same door.
    expect((await stack.apiAs(memberTok, 'GET', `/data/cmt_private/${privateId}`)).status).toBe(404);
    expect((await stack.apiAs(memberTok, 'GET', `/data/cmt_open/${openId}`)).status).toBe(200);
    const stored = await ql.find('sys_activity', { where: { object_name: 'cmt_private', record_id: privateId }, context: SYS });
    expect(stored.length, 'the CRUD mirror wrote activity about the private record').toBe(2);
  }, 120_000);

  afterAll(async () => {
    await stack?.stop();
  });

  it('list: every row returned is about a record the member can open, and its own record is among them', async () => {
    const res = await stack.apiAs(memberTok, 'GET', '/data/sys_activity?limit=1000');
    expect(res.status).toBe(200);
    const rows = await rowsOf(res);
    expect(rows.some((r) => r.object_name === 'cmt_open' && r.record_id === openId)).toBe(true);
    expect(rows.some((r) => r.object_name === 'cmt_private')).toBe(false);
    for (const r of rows) {
      const parent = await stack.apiAs(memberTok, 'GET', `/data/${r.object_name}/${r.record_id}`);
      expect(parent.status, `activity row ${r.id} is about ${r.object_name}/${r.record_id}`).toBe(200);
    }
  });

  it('list: the total is narrowed exactly like the rows', async () => {
    const body = (await (await stack.apiAs(memberTok, 'GET', '/data/sys_activity?limit=1000')).json()) as any;
    expect(body.total).toBe((body.records ?? []).length);
  });

  it('by id: a row about a record the member cannot read answers 404', async () => {
    const [hidden] = await ql.find('sys_activity', { where: { object_name: 'cmt_private', record_id: privateId }, context: SYS });
    const res = await stack.apiAs(memberTok, 'GET', `/data/sys_activity/${hidden.id}`);
    expect(res.status).toBe(404);
  });

  it('query: a filter naming a record the member cannot read returns nothing', async () => {
    const res = await stack.apiAs(memberTok, 'POST', '/data/sys_activity/query', {
      where: { object_name: 'cmt_private', record_id: privateId },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.records ?? []).toEqual([]);
  });

  it('query: a grouped count sees only the readable rows', async () => {
    const res = await stack.apiAs(memberTok, 'POST', '/data/sys_activity/query', {
      groupBy: ['object_name'],
      aggregations: [{ function: 'count', alias: 'n' }],
    });
    expect(res.status).toBe(200);
    const groups = ((await res.json()) as any).records ?? [];
    expect(groups.some((g: Row) => g.object_name === 'cmt_private')).toBe(false);
    const listTotal = ((await (await stack.apiAs(memberTok, 'GET', '/data/sys_activity?limit=1000')).json()) as any).total;
    expect(groups.reduce((sum: number, g: Row) => sum + Number(g.n), 0)).toBe(listTotal);
  });

  it('an admin still reads the activity of both records', async () => {
    const rows = await rowsOf(await stack.apiAs(adminTok, 'GET', '/data/sys_activity?limit=1000'));
    expect(rows.filter((r) => r.object_name === 'cmt_private' && r.record_id === privateId)).toHaveLength(2);
    expect(rows.some((r) => r.object_name === 'cmt_open' && r.record_id === openId)).toBe(true);
  });
});
