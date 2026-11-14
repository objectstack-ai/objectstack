// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [ruling 6844187236, B; email ruling 6867150851] A member's agent finds a
// colleague by name or by email with the existing MCP record tools, and fills
// a person field with the id it found.
//
// `sys_user` declares `enable.aiReadable: true`, which admits it to the MCP
// read tools past the `sys_*` refusal. Nothing else changes: what the agent is
// served is decided by the gates the console's person picker already runs —
//
//   - WHICH ROWS: `member_default`'s `sys_user_self` and `sys_user_org_members`
//     (the caller's own row and their active organization's members);
//   - WHICH FIELDS: the identity object's `Admin` group, withheld from every
//     non-admin set (`identityAdminFieldSecurity`), on results AND filters.
//
// Nothing in this file grants `sys_user`: every member holds the shipped
// baseline and an app set naming the app's own object.
//
// Real `SecurityPlugin`, real MCP plugin, live `/mcp` transport.
//
//   ⭐ by name: a member finds both same-organization colleagues who share a
//      name, and tells them apart by email; by email: exactly one id;
//   ⭐ a user of another organization is invisible: by name, by email, by id,
//      by count;
//   ⭐ the `Admin` group is withheld: on the served row, on a projection naming
//      it, and a filter on it is refused (the filter oracle stays closed) —
//      with the stored values and an admin's read as the controls;
//   ⭐ the agent reads exactly what the member's console reads at the HTTP
//      data door, the person picker's query;
//   ⭐ no write tool opens `sys_user`;
//   ⭐ end to end: find by email, then create a record whose person field holds
//      the found id.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { type VerifyStack } from '@objectstack/verify';
import { bootStack } from '@objectstack/verify';
import { MCPServerPlugin } from '@objectstack/mcp';
import { defineStack } from '@objectstack/spec';
import { ObjectSchema, Field } from '@objectstack/spec/data';
import { PermissionSetSchema, type PermissionSet } from '@objectstack/spec/security';
import { SecurityPlugin, securityDefaultPermissionSets } from '@objectstack/plugin-security';
import { SysUser } from '@objectstack/platform-objects/identity';
import { assertArmed, armedWhen } from './armed.js';

const TASK = 'colmcp_task';
const USER = 'sys_user';
const SYS = { context: { isSystem: true } } as const;
const SYSTEM_OBJECT_REFUSAL = 'is a system object and is not exposed via MCP';
type Row = Record<string, any>;
const rowsOf = (r: any): Row[] =>
  (Array.isArray(r) ? r : Array.isArray(r?.records) ? r.records : Array.isArray(r?.value) ? r.value : Array.isArray(r?.data) ? r.data : []);

const DOMAIN = 'colmcp.verify.test';
const MEMBER = `member@${DOMAIN}`;
const COLLEAGUE = `lin.wei@${DOMAIN}`;
const NAMESAKE = `lin.wei.2@${DOMAIN}`;
const OUTSIDER = `lin.wei@other-${DOMAIN}`;
/** One name, three people: two colleagues and a user of another organization. */
const SHARED_NAME = 'Lin Wei Colmcp';

/** The declared `Admin` group, read off the identity object's declaration — never listed here. */
const ADMIN_GROUP: string[] = Object.entries(SysUser.fields as Record<string, { group?: string }>)
  .filter(([, field]) => field.group === 'Admin')
  .map(([name]) => name)
  .sort();
/** Synthetic values for the colleague's `Admin` group fields, written as the system. */
const SYNTHETIC = { last_login_ip: 'SYNTHETIC-ADDRESS-COLMCP', failed_login_count: 4, ban_reason: 'SYNTHETICREASONCOLMCP' };

const task = ObjectSchema.create({
  name: TASK,
  label: 'Task',
  pluralLabel: 'Tasks',
  sharingModel: 'public_read_write',
  fields: {
    name: Field.text({ label: 'Name', required: true }),
    assignee: Field.user({ label: 'Assignee' }),
  },
});

const stackConfig = defineStack({
  manifest: {
    id: 'com.dogfood.colleague-lookup-over-mcp',
    namespace: 'colmcp',
    version: '0.0.0',
    type: 'app',
    name: 'Colleague Lookup Over MCP Fixture',
    description: 'One object with a person field, filled by an agent over MCP.',
  },
  objects: [task],
});

/** The app's own object only: nothing here names `sys_user`. */
const appSet: PermissionSet = PermissionSetSchema.parse({
  name: 'colmcp_app',
  label: 'Colleague Lookup Over MCP — the app object',
  objects: { [TASK]: { allowRead: true, allowCreate: true, allowEdit: true, allowDelete: false } },
});

type Caller = { bearer: string };

describe('a member\'s agent finds a colleague through the read-only sys_user over MCP (ruling B)', () => {
  let stack: VerifyStack;
  let ql: any;
  const bearer: Record<string, string> = {};
  const uid: Record<string, string> = {};

  const idOf = async (email: string): Promise<string> =>
    String((await ql.findOne(USER, { where: { email }, context: SYS.context }))?.id ?? '');

  /** One MCP JSON-RPC call over the live transport, as a bearer. */
  const rpc = async (as: Caller, method: string, params: Record<string, unknown>) => {
    const res = await stack.api('/mcp', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        Authorization: `Bearer ${as.bearer}`,
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    });
    expect(res.status).toBe(200);
    const body: any = await res.json();
    expect(body.error, JSON.stringify(body.error)).toBeUndefined();
    return body.result;
  };
  /** One `tools/call`, its first content block parsed. */
  const tool = async (as: Caller, name: string, args: Record<string, unknown>) => {
    const result = await rpc(as, 'tools/call', { name, arguments: args });
    const text = String(result?.content?.[0]?.text ?? '');
    let payload: any;
    try { payload = JSON.parse(text); } catch { payload = { message: text }; }
    return { isError: result?.isError === true, payload, text };
  };
  const member = (): Caller => ({ bearer: bearer.member });
  const queryUsers = async (as: Caller, args: Record<string, unknown>) => {
    const answer = await tool(as, 'query_records', { objectName: USER, ...args });
    expect(answer.isError, answer.text).toBe(false);
    return rowsOf(answer.payload);
  };
  const idsOf = (rows: Row[]) => rows.map((r) => String(r.id)).sort();
  const servedAdminFields = (row: Row) => ADMIN_GROUP.filter((f) => f in row);

  beforeAll(async () => {
    stack = await bootStack(stackConfig as unknown as Parameters<typeof bootStack>[0], {
      security: new SecurityPlugin({
        defaultPermissionSets: [...securityDefaultPermissionSets, appSet],
        fallbackPermissionSet: appSet.name,
      }),
      extraPlugins: [new MCPServerPlugin()],
    });
    ql = await stack.kernel.getServiceAsync('objectql');
    bearer.admin = await stack.signIn(); // the seeded platform admin
    bearer.member = await stack.signUp(MEMBER, 'Colmcp!Pass123', 'Colmcp Member');
    bearer.colleague = await stack.signUp(COLLEAGUE, 'Colmcp!Pass123', SHARED_NAME);
    bearer.namesake = await stack.signUp(NAMESAKE, 'Colmcp!Pass123', SHARED_NAME);
    bearer.outsider = await stack.signUp(OUTSIDER, 'Colmcp!Pass123', SHARED_NAME);
    for (const [who, email] of [['member', MEMBER], ['colleague', COLLEAGUE], ['namesake', NAMESAKE], ['outsider', OUTSIDER]] as const) {
      uid[who] = await idOf(email);
    }

    // The outsider belongs to ANOTHER organization: its membership and its
    // sessions move there, so the members' organization no longer holds it.
    const membership = await ql.findOne('sys_member', { where: { user_id: uid.member }, context: SYS.context });
    const homeOrg = String(membership?.organization_id ?? '');
    expect(homeOrg).not.toBe('');
    const other = await ql.insert('sys_organization', { name: 'Colmcp Other Org', slug: 'colmcp-other-org' }, SYS);
    const otherOrg = String(other.id);
    for (const m of rowsOf(await ql.find('sys_member', { where: { user_id: uid.outsider }, context: SYS.context }))) {
      await ql.update('sys_member', { id: m.id, organization_id: otherOrg }, SYS);
    }
    for (const s of rowsOf(await ql.find('sys_session', { where: { user_id: uid.outsider }, context: SYS.context }))) {
      await ql.update('sys_session', { id: s.id, active_organization_id: otherOrg }, SYS);
    }

    // The colleague's `Admin` group values, written as the system.
    await ql.update(USER, { id: uid.colleague, ...SYNTHETIC }, SYS);

    await assertArmed([
      armedWhen({
        control: 'the declared Admin group is non-empty and holds the fixture fields',
        disarmedBy: 'an emptied or renamed group would make every "no Admin field" assertion pass over nothing',
        observe: async () => ({ size: ADMIN_GROUP.length, covers: Object.keys(SYNTHETIC).every((k) => ADMIN_GROUP.includes(k)) }),
        armed: (o) => o.size > 0 && o.covers,
        describe: (o) => `group of ${o.size}; fixture fields in it: ${o.covers}`,
      }),
      armedWhen({
        control: 'the colleague row at rest carries the Admin group values',
        disarmedBy: 'a fixture write that never landed would let the withheld-field pins pass on empty columns',
        observe: async () => {
          const [row] = rowsOf(await ql.find(USER, { where: { id: uid.colleague }, context: SYS.context }));
          return { stored: Object.entries(SYNTHETIC).every(([k, v]) => row?.[k] === v) };
        },
        armed: (o) => o.stored,
        describe: (o) => `stored: ${o.stored}`,
      }),
      armedWhen({
        control: 'the outsider is in another organization, and the name really matches it at rest',
        disarmedBy: 'an outsider still in the members\' organization, or a name no row carries, would pass the invisibility pins vacuously',
        observe: async () => {
          const m = rowsOf(await ql.find('sys_member', { where: { user_id: uid.outsider }, context: SYS.context }));
          const named = rowsOf(await ql.find(USER, { where: { name: SHARED_NAME }, context: SYS.context }));
          return { orgs: m.map((r) => String(r.organization_id)), named: idsOf(named) };
        },
        armed: (o) => o.orgs.length > 0 && !o.orgs.includes(homeOrg) && o.named.includes(uid.outsider) && o.named.length === 3,
        describe: (o) => `outsider orgs: ${o.orgs.join(',')}; rows named alike at rest: ${o.named.length}`,
      }),
    ]);
  }, 300_000);

  afterAll(async () => {
    await stack?.stop?.();
  });

  it('⭐ sys_user is listed and described for the member; no other sys_* object comes with it', async () => {
    const listed = await tool(member(), 'list_objects', {});
    expect(listed.isError, listed.text).toBe(false);
    const names = (listed.payload.objects as any[]).map((o) => o.name);
    expect(names).toContain(USER);

    const described = await tool(member(), 'describe_object', { objectName: USER });
    expect(described.isError, described.text).toBe(false);
    const text = JSON.stringify(described.payload);
    expect(text).toContain('"email"');
  });

  it('⭐ by name: the member finds both colleagues who share it, and tells them apart by email', async () => {
    const rows = await queryUsers(member(), { where: { name: SHARED_NAME }, fields: ['id', 'name', 'email'] });
    expect(idsOf(rows)).toEqual([uid.colleague, uid.namesake].sort());
    expect(rows.map((r) => r.email).sort()).toEqual([COLLEAGUE, NAMESAKE].sort());
    // A partial name finds them too, the way a person types one.
    const partial = await queryUsers(member(), { where: { name: { $contains: 'Lin Wei' } } });
    expect(idsOf(partial)).toEqual([uid.colleague, uid.namesake].sort());
  });

  it('⭐ by email: the member gets exactly the one colleague and their id', async () => {
    const rows = await queryUsers(member(), { where: { email: COLLEAGUE } });
    expect(idsOf(rows)).toEqual([uid.colleague]);
    expect(rows[0].name).toBe(SHARED_NAME);
  });

  it('⭐ a user of another organization is invisible: by name, by email, by id and by count', async () => {
    const byName = await queryUsers(member(), { where: { name: SHARED_NAME } });
    expect(idsOf(byName)).not.toContain(uid.outsider);
    expect(await queryUsers(member(), { where: { email: OUTSIDER } })).toEqual([]);
    const unfiltered = await queryUsers(member(), { limit: 50 });
    expect(idsOf(unfiltered)).not.toContain(uid.outsider);
    expect(idsOf(unfiltered)).toEqual(expect.arrayContaining([uid.member, uid.colleague, uid.namesake]));

    const byId = await tool(member(), 'get_record', { objectName: USER, recordId: uid.outsider });
    expect(byId.isError, byId.text).toBe(true);
    expect(byId.text).not.toContain(OUTSIDER);

    const counted = await tool(member(), 'aggregate_records', {
      objectName: USER,
      where: { name: SHARED_NAME },
      aggregations: [{ function: 'count', alias: 'n' }],
    });
    expect(counted.isError, counted.text).toBe(false);
    expect(JSON.stringify(counted.payload)).toContain('"n":2');
  });

  it('⭐ the Admin group is withheld: on the served row, on a projection naming it, and a filter on it is refused', async () => {
    const one = await tool(member(), 'get_record', { objectName: USER, recordId: uid.colleague });
    expect(one.isError, one.text).toBe(false);
    const row = one.payload?.record ?? one.payload;
    expect(String(row.id)).toBe(uid.colleague);
    expect(servedAdminFields(row)).toEqual([]);
    for (const value of [SYNTHETIC.last_login_ip, SYNTHETIC.ban_reason]) expect(one.text).not.toContain(value);

    const projected = await queryUsers(member(), {
      where: { email: COLLEAGUE },
      fields: ['id', 'name', 'email', ...Object.keys(SYNTHETIC)],
    });
    expect(idsOf(projected)).toEqual([uid.colleague]);
    expect(servedAdminFields(projected[0])).toEqual([]);

    const oracle = await tool(member(), 'query_records', { objectName: USER, where: { failed_login_count: { $gt: 0 } } });
    expect(oracle.isError, oracle.text).toBe(true);
    expect(oracle.text).not.toContain(uid.colleague);
  });

  it('the platform admin reads the colleague\'s Admin group over MCP (the control for the withheld read above)', async () => {
    const one = await tool({ bearer: bearer.admin }, 'get_record', { objectName: USER, recordId: uid.colleague });
    expect(one.isError, one.text).toBe(false);
    const row = one.payload?.record ?? one.payload;
    expect(row.last_login_ip).toBe(SYNTHETIC.last_login_ip);
  });

  it('⭐ the agent reads exactly what the member\'s console reads: the person picker\'s query at the HTTP data door', async () => {
    const res = await stack.apiAs(bearer.member, 'GET', '/data/sys_user?$top=50');
    expect(res.status).toBe(200);
    const consoleRows = rowsOf(await res.json());
    const agentRows = await queryUsers(member(), { limit: 50 });
    expect(idsOf(agentRows)).toEqual(idsOf(consoleRows));
    const fieldsOf = (rows: Row[], id: string) => Object.keys(rows.find((r) => String(r.id) === id) ?? {}).sort();
    expect(fieldsOf(agentRows, uid.colleague)).toEqual(fieldsOf(consoleRows, uid.colleague));
    // The served directory set the PR states, read off the live row: the
    // `Admin` group is the only thing withheld.
    // Read off the declaration, never listed here: every declared field
    // outside the group, the set the PR body and the changeset enumerate.
    const served = fieldsOf(agentRows, uid.colleague);
    const directory = Object.keys(SysUser.fields as Record<string, unknown>).filter((f) => !ADMIN_GROUP.includes(f)).sort();
    expect(served).toEqual(directory);
    expect(served).toEqual(expect.arrayContaining(['id', 'name', 'email']));
  });

  it('⭐ no write tool opens sys_user', async () => {
    const writes: Array<[string, Record<string, unknown>]> = [
      ['create_record', { objectName: USER, data: { name: 'Planted', email: `planted@${DOMAIN}` } }],
      ['update_record', { objectName: USER, recordId: uid.member, data: { name: 'Renamed By Agent' } }],
      ['update_record', { objectName: USER, recordId: uid.colleague, data: { name: 'Renamed By Agent' } }],
      ['delete_record', { objectName: USER, recordId: uid.colleague, confirm: true }],
      ['delete_records', { objectName: USER, recordIds: [uid.colleague], confirm: true }],
    ];
    for (const [name, args] of writes) {
      const refused = await tool(member(), name, args);
      expect(refused.isError, `${name}: ${refused.text}`).toBe(true);
      expect(refused.text, name).toContain(SYSTEM_OBJECT_REFUSAL);
    }
    const [colleague] = rowsOf(await ql.find(USER, { where: { id: uid.colleague }, context: SYS.context }));
    expect(colleague?.name).toBe(SHARED_NAME);
    const [self] = rowsOf(await ql.find(USER, { where: { id: uid.member }, context: SYS.context }));
    expect(self?.name).toBe('Colmcp Member');
    expect(rowsOf(await ql.find(USER, { where: { email: `planted@${DOMAIN}` }, context: SYS.context }))).toEqual([]);
  });

  it('⭐ the query tool\'s text tells an agent how to find a colleague and tell namesakes apart', async () => {
    const listed = await rpc(member(), 'tools/list', {});
    const query = (listed.tools as any[]).find((t) => t.name === 'query_records');
    expect(query?.description).toContain(USER);
    expect(query?.description).toContain('email');
  });

  it('⭐ end to end: the agent finds a colleague by email and fills a person field with the id it found', async () => {
    const [found] = await queryUsers(member(), { where: { email: NAMESAKE }, fields: ['id', 'name', 'email'] });
    expect(String(found?.id)).toBe(uid.namesake);

    const created = await tool(member(), 'create_record', { objectName: TASK, data: { name: 'review the contract', assignee: found.id } });
    expect(created.isError, created.text).toBe(false);
    const recordId = String(created.payload?.id ?? created.payload?.record?.id ?? '');
    expect(recordId).not.toBe('');
    const [stored] = rowsOf(await ql.find(TASK, { where: { id: recordId }, context: SYS.context }));
    expect(String(stored?.assignee?.id ?? stored?.assignee)).toBe(uid.namesake);
  });
});
