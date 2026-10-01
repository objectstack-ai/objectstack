// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#21080] An object that carries an object-keyed ENGINE middleware answers on
// the analytics dataset door exactly as it answers on the generic data door,
// for the same caller.
//
// ## The defect, by class
//
// On a SQL driver the analytics native-SQL strategy compiles the query itself
// and runs it through the driver's raw-SQL seam. No engine operation runs, so
// no engine middleware does. It applied the security service's object
// admission and read filter, and nothing else, so the read gates that live in
// the engine as per-object middlewares did not apply there: a member admitted
// to the gated object at object level read grouped results and counts over
// every row, the rows about parents that member cannot read included.
//
// The engine now answers, read-only, which objects carry a middleware
// registered for them (`IObjectQLEngine.hasObjectMiddleware`), and the native
// strategy declines such an object. The query routes to the ObjectQL strategy,
// which hands it to the engine with the caller's context, so the gates run.
//
// ## What is asserted
//
// A real org-bound boot (better-auth sign-ups, the real security plugin, the
// real audit and storage plugins writing their rows, SQLite), per gated object:
//
// - the restricted member's analytics answer equals the data door's answer for
//   that member, grouped the same way, and its count equals the door's total;
// - the unrestricted reader (the admin) is the control: the same equality
//   holds, and the admin's answer carries rows the member's does not, so a
//   gate that simply denied everything could not pass.
//
// Fixtures are synthetic.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { bootStack, type VerifyStack } from '@objectstack/verify';
import { AuditPlugin } from '@objectstack/plugin-audit';
import { SecurityPlugin, securityDefaultPermissionSets } from '@objectstack/plugin-security';
import { PermissionSetSchema, type PermissionSet } from '@objectstack/spec/security';
import { commentsFixtureStack, cmtFixtureBaselineSet } from './fixtures/comments-fixture.js';
import {
  bootAttachmentsHarness,
  stopAttachmentsHarness,
  uploadFile,
  FILE_BYTES,
  type AttachmentsHarness,
} from './fixtures/attachments-authz-harness.js';

const SYS = { isSystem: true } as const;
type Row = Record<string, unknown>;

/** An inline dataset over `object`: one count, grouped by each named field. */
function datasetBody(object: string, fields: string[]) {
  const dims = fields.map((field, i) => ({ name: `d${i}_key`, label: field, field, type: 'string' }));
  return {
    dataset: {
      name: 'mw_probe_ds',
      label: 'Middleware objects fixture',
      object,
      dimensions: dims,
      measures: [{ name: 'row_count', label: 'Rows', aggregate: 'count' }],
    },
    selection: { dimensions: dims.map((d) => d.name), measures: ['row_count'] },
  };
}

/** The analytics door's groups, as `key → count`, the key joined over the grouped fields. */
async function analyticsGroups(stack: VerifyStack, token: string, object: string, fields: string[]) {
  const res = await stack.apiAs(token, 'POST', '/analytics/dataset/query', datasetBody(object, fields));
  expect(res.status, 'the analytics dataset door answers').toBe(200);
  const body = (await res.json()) as { rows?: Row[]; data?: { rows?: Row[] } };
  const rows = body.rows ?? body.data?.rows ?? [];
  const out = new Map<string, number>();
  for (const r of rows) out.set(fields.map((_, i) => String(r[`d${i}_key`])).join('|'), Number(r.row_count));
  return out;
}

/** The analytics door's ungrouped count. */
async function analyticsCount(stack: VerifyStack, token: string, object: string) {
  const res = await stack.apiAs(token, 'POST', '/analytics/dataset/query', datasetBody(object, []));
  expect(res.status, 'the analytics dataset door answers').toBe(200);
  const body = (await res.json()) as { rows?: Row[]; data?: { rows?: Row[] } };
  const rows = body.rows ?? body.data?.rows ?? [];
  return rows.reduce((sum, r) => sum + Number(r.row_count ?? 0), 0);
}

/** The data door's rows for `object`, grouped the same way, and its total. */
async function dataDoorGroups(stack: VerifyStack, token: string, object: string, fields: string[]) {
  const res = await stack.apiAs(token, 'GET', `/data/${object}?limit=1000`);
  expect(res.status, 'the data door answers').toBe(200);
  const body = (await res.json()) as { records?: Row[]; total?: number };
  const out = new Map<string, number>();
  for (const r of body.records ?? []) {
    const key = fields.map((f) => String(r[f])).join('|');
    out.set(key, (out.get(key) ?? 0) + 1);
  }
  return { groups: out, total: Number(body.total ?? (body.records ?? []).length) };
}

const sorted = (m: Map<string, number>) => [...m.entries()].sort(([a], [b]) => a.localeCompare(b));

describe('[#21080] comment threads and activity rows: the analytics door answers as the data door does', () => {
  let stack: VerifyStack;
  let adminTok: string;
  let memberTok: string;

  /** Object-level read on the activity stream, nothing more. */
  const activityReaderSet: PermissionSet = PermissionSetSchema.parse({
    name: 'mw_activity_reader',
    label: 'Middleware objects fixture — object-level sys_activity read',
    objects: { sys_activity: { allowRead: true } },
  });

  beforeAll(async () => {
    stack = await bootStack(commentsFixtureStack as never, {
      security: new SecurityPlugin({
        defaultPermissionSets: [...securityDefaultPermissionSets, cmtFixtureBaselineSet, activityReaderSet],
        fallbackPermissionSet: cmtFixtureBaselineSet.name,
      }),
      extraPlugins: [new AuditPlugin()],
      orgContext: true,
    });
    const ql: any = await stack.kernel.getServiceAsync('objectql');
    adminTok = await stack.signIn();
    memberTok = await stack.signUp('mw-objects-member@verify.test');
    const memberId = (await ql.findOne('sys_user', { where: { email: 'mw-objects-member@verify.test' }, context: SYS }))?.id;
    const set = await ql.findOne('sys_permission_set', { where: { name: activityReaderSet.name }, context: SYS });
    expect(set?.id, 'fixture permission set seeded').toBeTruthy();
    await ql.insert('sys_user_permission_set', { user_id: memberId, permission_set_id: set.id }, { context: { ...SYS } });

    const idOf = async (res: Response) => {
      expect(res.status, 'fixture write').toBeLessThan(300);
      const j = (await res.json()) as any;
      return String(j.id ?? j.record?.id ?? j.data?.id);
    };
    // A parent the member cannot read (private, admin-owned) and one it can.
    const hidden = await idOf(await stack.apiAs(adminTok, 'POST', '/data/cmt_private', { name: 'fixture hidden parent' }));
    const open = await idOf(await stack.apiAs(memberTok, 'POST', '/data/cmt_open', { name: 'fixture open parent' }));
    expect((await stack.apiAs(memberTok, 'GET', `/data/cmt_private/${hidden}`)).status, 'the member cannot read the hidden parent').toBe(404);
    expect((await stack.apiAs(adminTok, 'POST', '/data/sys_comment', { thread_id: `cmt_private:${hidden}`, body: 'fixture note one' })).status).toBe(201);
    expect((await stack.apiAs(memberTok, 'POST', '/data/sys_comment', { thread_id: `cmt_open:${open}`, body: 'fixture note two' })).status).toBe(201);
  }, 120_000);

  afterAll(async () => {
    await stack?.stop();
  });

  it('comment threads: a member who cannot read a parent gets the data door\'s groups and count', async () => {
    const door = await dataDoorGroups(stack, memberTok, 'sys_comment', ['thread_id']);
    expect(sorted(await analyticsGroups(stack, memberTok, 'sys_comment', ['thread_id']))).toEqual(sorted(door.groups));
    expect(await analyticsCount(stack, memberTok, 'sys_comment')).toBe(door.total);
  });

  it('comment threads, control: the admin gets the data door\'s groups, including a thread the member does not', async () => {
    const door = await dataDoorGroups(stack, adminTok, 'sys_comment', ['thread_id']);
    const member = await dataDoorGroups(stack, memberTok, 'sys_comment', ['thread_id']);
    expect(door.groups.size).toBeGreaterThan(member.groups.size);
    expect(sorted(await analyticsGroups(stack, adminTok, 'sys_comment', ['thread_id']))).toEqual(sorted(door.groups));
    expect(await analyticsCount(stack, adminTok, 'sys_comment')).toBe(door.total);
  });

  it('activity rows: a member who cannot read a parent gets the data door\'s groups and count', async () => {
    const fields = ['object_name', 'record_id'];
    const door = await dataDoorGroups(stack, memberTok, 'sys_activity', fields);
    expect(sorted(await analyticsGroups(stack, memberTok, 'sys_activity', fields))).toEqual(sorted(door.groups));
    expect(await analyticsCount(stack, memberTok, 'sys_activity')).toBe(door.total);
  });

  it('activity rows, control: the admin gets the data door\'s groups, including rows the member does not', async () => {
    const fields = ['object_name', 'record_id'];
    const door = await dataDoorGroups(stack, adminTok, 'sys_activity', fields);
    const member = await dataDoorGroups(stack, memberTok, 'sys_activity', fields);
    expect(door.total).toBeGreaterThan(member.total);
    expect(sorted(await analyticsGroups(stack, adminTok, 'sys_activity', fields))).toEqual(sorted(door.groups));
    expect(await analyticsCount(stack, adminTok, 'sys_activity')).toBe(door.total);
  });
});

describe('[#21080] attachments: the analytics door answers as the data door does', () => {
  let harness: AttachmentsHarness;
  let stack: VerifyStack;
  let adminTok: string;
  let memberTok: string;

  beforeAll(async () => {
    harness = await bootAttachmentsHarness();
    stack = harness.stack;
    const ql: any = await stack.kernel.getServiceAsync('objectql');
    adminTok = await stack.signIn();
    memberTok = await stack.signUp('mw-objects-att@verify.test');
    const adminId = (await ql.findOne('sys_user', { where: { email: 'admin@objectos.ai' }, context: SYS }))?.id;
    const caseRes = await stack.apiAs(adminTok, 'POST', '/data/att_case', { name: 'fixture visible parent' });
    expect(caseRes.status).toBeLessThan(300);
    const caseBody = (await caseRes.json()) as any;
    const caseId = String(caseBody.id ?? caseBody.record?.id ?? caseBody.data?.id);
    // A private parent anchored to the admin: the member can neither read nor edit it.
    const secret = await ql.insert('att_secret', { name: 'fixture hidden parent', owner_id: adminId }, { context: { ...SYS } });
    expect((await stack.apiAs(memberTok, 'GET', `/data/att_secret/${secret.id}`)).status, 'the member cannot read the hidden parent').toBe(404);
    const attach = async (parentObject: string, parentId: string) => {
      const fileId = await uploadFile(stack, adminTok);
      const res = await stack.apiAs(adminTok, 'POST', '/data/sys_attachment', {
        parent_object: parentObject,
        parent_id: parentId,
        file_id: fileId,
        file_name: 'fixture.txt',
        mime_type: 'text/plain',
        size: FILE_BYTES.length,
      });
      expect(res.status, `attach to ${parentObject}`).toBeLessThan(300);
    };
    for (let i = 0; i < 2; i++) await attach('att_case', caseId);
    for (let i = 0; i < 3; i++) await attach('att_secret', secret.id);
  }, 180_000);

  afterAll(async () => {
    await stopAttachmentsHarness(harness);
  });

  it('a member who cannot read a parent gets the data door\'s groups and count', async () => {
    const door = await dataDoorGroups(stack, memberTok, 'sys_attachment', ['parent_object']);
    expect(sorted(await analyticsGroups(stack, memberTok, 'sys_attachment', ['parent_object']))).toEqual(sorted(door.groups));
    expect(await analyticsCount(stack, memberTok, 'sys_attachment')).toBe(door.total);
  });

  it('control: the admin gets the data door\'s groups, including a parent the member does not', async () => {
    const door = await dataDoorGroups(stack, adminTok, 'sys_attachment', ['parent_object']);
    const member = await dataDoorGroups(stack, memberTok, 'sys_attachment', ['parent_object']);
    expect(door.total).toBeGreaterThan(member.total);
    expect(sorted(await analyticsGroups(stack, adminTok, 'sys_attachment', ['parent_object']))).toEqual(sorted(door.groups));
    expect(await analyticsCount(stack, adminTok, 'sys_attachment')).toBe(door.total);
  });
});
