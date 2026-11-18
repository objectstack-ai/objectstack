// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// A record with the records it points at, and a parent with its children, in
// one MCP call: `query_records` with `expand` and `get_record` with `related`
// on the CRM example, as a member's agent asks them, over the live `/mcp`
// transport — real SecurityPlugin, real MCP plugin, the SQL driver, a real
// organization wall (`multiTenant: 'posture-only'`, the `isolated` posture).
//
// The member of organization A holds one app set: read on accounts, deals and
// activities (not contacts), a row-level policy that hides closed-lost deals,
// and `crm_opportunity.probability` and `crm_account.annual_revenue` withheld.
//
//   ⭐ expand: each deal answers its account and its owner as records, the
//      account's withheld field still withheld;
//   ⭐ related: an account answers its deals and its activities, filtered by
//      the link alone; a deal the row policy hides never appears in the list;
//      a withheld field stays withheld on the listed rows;
//   ⭐ THE RULE: an object the MCP read guard refuses, reached through expand
//      or related, refuses the whole call with PERMISSION_DENIED and no rows;
//      a related object the member may not read refuses it too;
//   ⭐ the organization wall: a deal of organization B that points at A's
//      account never appears in A's list, and A's account is not B's to read;
//   ⭐ a list with more rows than its cap answers the cap and truncated: true;
//   ⭐ an unknown field, or a field that is no relation, is INVALID_FIELD;
//   ⭐ controls: without expand / related each tool answers as before.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import crmStack from '@objectstack/example-crm';
import { bootStack, type VerifyStack } from '@objectstack/verify';
import { MCPServerPlugin } from '@objectstack/mcp';
import { PermissionSetSchema, type PermissionSet } from '@objectstack/spec/security';
import { SecurityPlugin, securityDefaultPermissionSets } from '@objectstack/plugin-security';
import { assertArmed, armedWhen } from './armed.js';

const OPP = 'crm_opportunity';
const ACCOUNT = 'crm_account';
const ACTIVITY = 'crm_activity';
const CONTACT = 'crm_contact';
const SYS = { context: { isSystem: true } } as const;
type Row = Record<string, any>;
const rowsOf = (r: any): Row[] =>
  (Array.isArray(r) ? r : Array.isArray(r?.records) ? r.records : Array.isArray(r?.value) ? r.value : []);

const DOMAIN = 'relatedread.verify.test';
const OWNER_A = `owner-a@${DOMAIN}`;
const OWNER_B = `owner-b@${DOMAIN}`;
const MEMBER_A = `member-a@${DOMAIN}`;
const MEMBER_B = `member-b@${DOMAIN}`;
/** A related list's row cap (`RELATED_LIST_MAX_ROWS`, under the door's 50). */
const LIST_CAP = 20;
const MANY = LIST_CAP + 5;

/** The member's app set: read on accounts, deals and activities; closed-lost deals hidden; two fields withheld. */
const memberSet: PermissionSet = PermissionSetSchema.parse({
  name: 'relatedread_member',
  label: 'Related reads over MCP — a CRM member',
  objects: {
    [OPP]: { allowRead: true, allowCreate: false, allowEdit: false, allowDelete: false },
    [ACCOUNT]: { allowRead: true, allowCreate: false, allowEdit: false, allowDelete: false },
    [ACTIVITY]: { allowRead: true, allowCreate: false, allowEdit: false, allowDelete: false },
  },
  fields: {
    [`${OPP}.probability`]: { readable: false, editable: false },
    [`${ACCOUNT}.annual_revenue`]: { readable: false, editable: false },
  },
  rowLevelSecurity: [
    { name: 'relatedread_hide_lost', object: OPP, operation: 'select', using: "record.stage != 'closed_lost'" },
  ],
});

describe('query_records expand and get_record related over MCP on the CRM example — under row, field and tenant security', () => {
  let stack: VerifyStack;
  let ql: any;
  const tok: Record<string, string> = {};
  const org: Record<string, string> = {};
  const uid: Record<string, string> = {};
  const acct: Record<string, string> = {};
  const opp: Record<string, string> = {};

  const idOf = (b: any): string => String(b?.id ?? b?.record?.id ?? '');
  const userId = async (email: string): Promise<string> =>
    String((await ql.findOne('sys_user', { where: { email }, context: SYS.context }))?.id ?? '');

  /** One MCP `tools/call` over the live transport, as a bearer; its first content block parsed. */
  const tool = async (bearer: string, name: string, args: Record<string, unknown>) => {
    const res = await stack.api('/mcp', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        Authorization: `Bearer ${bearer}`,
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
    });
    expect(res.status).toBe(200);
    const body: any = await res.json();
    const text = String(body.result?.content?.[0]?.text ?? body.error?.message ?? '');
    let payload: any;
    try { payload = JSON.parse(text); } catch { payload = { message: text }; }
    return { isError: body.result?.isError === true || body.error !== undefined, payload, text };
  };
  const ok = async (bearer: string, name: string, args: Record<string, unknown>) => {
    const answer = await tool(bearer, name, args);
    expect(answer.isError, answer.text).toBe(false);
    return answer.payload;
  };
  const refused = async (bearer: string, name: string, args: Record<string, unknown>) => {
    const answer = await tool(bearer, name, args);
    expect(answer.isError, answer.text).toBe(true);
    return { code: answer.payload?.error?.code, status: answer.payload?.error?.status, text: answer.text };
  };
  const ids = (rows: Row[]): string[] => rows.map((r) => String(r.id)).sort();
  const listOf = (payload: any, object: string): Row => payload.related.find((l: Row) => l.object === object);

  /** A new organization, created and made active by its owner. */
  const organization = async (ownerEmail: string, name: string, slug: string): Promise<string> => {
    const owner = await stack.signUp(ownerEmail);
    const created = await stack.apiAs(owner, 'POST', '/auth/organization/create', { name, slug });
    expect(created.status, `org create ${slug}: ${await created.clone().text()}`).toBe(200);
    const id = String(((await created.json()) as { id: string }).id);
    const active = await stack.apiAs(owner, 'POST', '/auth/organization/set-active', { organizationId: id });
    expect(active.status, `set-active ${slug}: ${await active.clone().text()}`).toBe(200);
    return id;
  };
  /** A plain member of `orgId`, active in it. */
  const memberOf = async (email: string, orgId: string): Promise<string> => {
    const bearer = await stack.signUp(email);
    await ql.insert('sys_member', { user_id: await userId(email), organization_id: orgId, role: 'member' }, SYS);
    const active = await stack.apiAs(bearer, 'POST', '/auth/organization/set-active', { organizationId: orgId });
    expect(active.status, `member set-active: ${await active.clone().text()}`).toBe(200);
    return bearer;
  };
  const deal = async (key: string, o: string, account: string, owner: string, stage: string) => {
    opp[key] = idOf(await ql.insert(OPP, {
      name: `RR ${key}`, account, owner_id: owner, stage, close_date: '2031-06-30', amount: 100, probability: 40, organization_id: o,
    }, SYS));
  };
  const activity = async (o: string, account: string, subject: string) =>
    idOf(await ql.insert(ACTIVITY, { subject, type: 'call', status: 'planned', account, organization_id: o }, SYS));

  beforeAll(async () => {
    stack = await bootStack(crmStack as never, {
      multiTenant: 'posture-only',
      security: new SecurityPlugin({
        defaultPermissionSets: [...securityDefaultPermissionSets, memberSet],
        fallbackPermissionSet: memberSet.name,
      }),
      extraPlugins: [new MCPServerPlugin()],
    });
    ql = await stack.kernel.getServiceAsync('objectql');

    org.a = await organization(OWNER_A, 'RR Org A', 'relatedread-a');
    org.b = await organization(OWNER_B, 'RR Org B', 'relatedread-b');
    tok.a = await memberOf(MEMBER_A, org.a);
    tok.b = await memberOf(MEMBER_B, org.b);
    uid.a = await userId(MEMBER_A);
    uid.b = await userId(MEMBER_B);

    for (const [key, o] of [['a1', org.a], ['a2', org.a], ['b1', org.b]] as const) {
      acct[key] = idOf(await ql.insert(ACCOUNT, { name: `RR account ${key}`, annual_revenue: 1000, organization_id: o }, SYS));
    }
    // Account a1: two readable deals and one closed-lost deal the member may
    // not read. Organization B: a deal of its own on b1, and one that points
    // at A's account a1 (a cross-tenant link a related list must not follow).
    await deal('x1', org.a, acct.a1, uid.a, 'proposal');
    await deal('x2', org.a, acct.a1, uid.a, 'qualification');
    await deal('lost', org.a, acct.a1, uid.a, 'closed_lost');
    await deal('y1', org.a, acct.a2, uid.a, 'prospecting');
    await deal('b1', org.b, acct.b1, uid.b, 'proposal');
    await deal('bx', org.b, acct.a1, uid.b, 'proposal');
    // Activities: two on a1, MANY on a2 (more than a list's cap).
    await activity(org.a, acct.a1, 'RR call 1');
    await activity(org.a, acct.a1, 'RR call 2');
    for (let i = 0; i < MANY; i++) await activity(org.a, acct.a2, `RR many ${String(i).padStart(2, '0')}`);

    await assertArmed([
      armedWhen({
        control: 'a real wall: two organizations, each member active in its own',
        disarmedBy: 'a single organization would pass every tenant pin over one tenant',
        observe: async () => {
          const tenancy = await stack.kernel.getServiceAsync<{ posture: string; isolationActive: boolean }>('tenancy');
          return { posture: tenancy.posture, active: tenancy.isolationActive, distinct: org.a !== org.b && !!org.a && !!org.b };
        },
        armed: (o) => o.posture === 'isolated' && o.active && o.distinct,
        describe: (o) => `posture ${o.posture}, active ${o.active}, distinct orgs ${o.distinct}`,
      }),
      armedWhen({
        control: 'at rest, account a1 has the hidden deal and organization B\'s deal pointing at it',
        disarmedBy: 'without them at rest, the row-security and tenant pins would pass over rows that do not exist',
        observe: async () => ({ ids: ids(rowsOf(await ql.find(OPP, { where: { account: acct.a1 }, context: SYS.context }))) }),
        armed: (o) => o.ids.includes(opp.lost) && o.ids.includes(opp.bx) && o.ids.length === 4,
        describe: (o) => `${o.ids.length} deals point at a1 at rest`,
      }),
      armedWhen({
        control: 'the member\'s row policy really hides the closed-lost deal from an ordinary query',
        disarmedBy: 'a policy that never bound would let the related-list pin pass without testing it',
        observe: async () => ({ ids: ids(rowsOf(await ok(tok.a, 'query_records', { objectName: OPP, where: { account: acct.a1 } }))) }),
        armed: (o) => !o.ids.includes(opp.lost) && o.ids.includes(opp.x1),
        describe: (o) => `member reads ${o.ids.length} deals of a1`,
      }),
      armedWhen({
        control: 'the member may not read contacts at all',
        disarmedBy: 'a readable contact object would pass the unreadable-related-object pin without testing it',
        observe: async () => {
          const answer = await tool(tok.a, 'query_records', { objectName: CONTACT });
          return { isError: answer.isError, code: String(answer.payload?.error?.code) };
        },
        armed: (o) => o.isError && o.code === 'PERMISSION_DENIED',
        describe: (o) => `contact read isError ${o.isError} (${o.code})`,
      }),
    ]);
  }, 300_000);

  afterAll(async () => {
    await stack?.stop?.();
  });

  it('⭐ expand: each deal answers its account and its owner as records; the account\'s withheld field stays withheld', async () => {
    const payload = await ok(tok.a, 'query_records', {
      objectName: OPP, where: { account: acct.a1 }, expand: ['account', 'owner_id'],
    });
    const rows = rowsOf(payload);
    expect(ids(rows)).toEqual([opp.x1, opp.x2].sort());
    for (const row of rows) {
      expect(row.account?.id, JSON.stringify(row.account)).toBe(acct.a1);
      expect(row.account.name).toBe('RR account a1');
      expect(row.account.annual_revenue).toBeUndefined();
      expect(row.probability).toBeUndefined();
      expect(row.owner_id?.id, JSON.stringify(row.owner_id)).toBe(uid.a);
    }
  });

  it('⭐ related: an account answers its deals and activities by the link alone; the hidden deal never appears; withheld fields stay withheld', async () => {
    const payload = await ok(tok.a, 'get_record', {
      objectName: ACCOUNT, recordId: acct.a1, related: [{ object: OPP }, { object: ACTIVITY }],
    });
    expect(payload.record.id).toBe(acct.a1);
    expect(payload.record.annual_revenue).toBeUndefined();
    const deals = listOf(payload, OPP);
    expect(deals.field).toBe('account');
    expect(ids(rowsOf(deals))).toEqual([opp.x1, opp.x2].sort());
    expect(ids(rowsOf(deals))).not.toContain(opp.lost);
    for (const row of rowsOf(deals)) expect(row.probability).toBeUndefined();
    expect(deals.truncated).toBeUndefined();
    const acts = listOf(payload, ACTIVITY);
    expect(rowsOf(acts).map((r) => r.subject).sort()).toEqual(['RR call 1', 'RR call 2']);
  });

  it('⭐ the organization wall: B\'s deal pointing at A\'s account is not in A\'s list, and A\'s account is not B\'s to read', async () => {
    const a = await ok(tok.a, 'get_record', { objectName: ACCOUNT, recordId: acct.a1, related: [{ object: OPP }] });
    expect(ids(rowsOf(listOf(a, OPP)))).not.toContain(opp.bx);
    expect(JSON.stringify(a)).not.toContain(opp.bx);

    const b = await ok(tok.b, 'get_record', { objectName: ACCOUNT, recordId: acct.b1, related: [{ object: OPP }] });
    expect(ids(rowsOf(listOf(b, OPP)))).toEqual([opp.b1]);

    const crossed = await refused(tok.b, 'get_record', { objectName: ACCOUNT, recordId: acct.a1, related: [{ object: OPP }] });
    expect(crossed.code).toBe('RECORD_NOT_FOUND');
    expect(crossed.text).not.toContain(opp.x1);
    expect(crossed.text).not.toContain(opp.bx);
  });

  it('⭐ a list with more rows than its cap answers the cap and truncated: true; a smaller limit is a cap too', async () => {
    const capped = await ok(tok.a, 'get_record', { objectName: ACCOUNT, recordId: acct.a2, related: [{ object: ACTIVITY }] });
    const list = listOf(capped, ACTIVITY);
    expect(rowsOf(list)).toHaveLength(LIST_CAP);
    expect(list.truncated).toBe(true);
    expect(list.total).toBe(MANY);

    const small = await ok(tok.a, 'get_record', {
      objectName: ACCOUNT, recordId: acct.a2, related: [{ object: ACTIVITY, limit: 5, orderBy: [{ field: 'subject', order: 'asc' }] }],
    });
    expect(rowsOf(listOf(small, ACTIVITY)).map((r) => r.subject)).toEqual(
      ['RR many 00', 'RR many 01', 'RR many 02', 'RR many 03', 'RR many 04'],
    );
    expect(listOf(small, ACTIVITY).truncated).toBe(true);
  });

  it('⭐ THE RULE: an object the MCP read guard refuses, reached through expand or related, refuses the whole call', async () => {
    const viaExpand = await refused(tok.a, 'query_records', { objectName: OPP, expand: ['account', 'organization_id'] });
    expect({ code: viaExpand.code, status: viaExpand.status }).toEqual({ code: 'PERMISSION_DENIED', status: 403 });
    expect(viaExpand.text).toContain('sys_organization');
    expect(viaExpand.text).not.toContain(opp.x1);

    const viaRelated = await refused(tok.a, 'get_record', {
      objectName: ACCOUNT, recordId: acct.a1, related: [{ object: OPP }, { object: 'sys_organization', field: 'id' }],
    });
    expect({ code: viaRelated.code, status: viaRelated.status }).toEqual({ code: 'PERMISSION_DENIED', status: 403 });
    expect(viaRelated.text).not.toContain(opp.x1);
    expect(viaRelated.text).not.toContain('RR account a1');
  });

  it('⭐ a related object the member may not read refuses the whole call', async () => {
    const answer = await refused(tok.a, 'get_record', { objectName: ACCOUNT, recordId: acct.a1, related: [{ object: OPP }, { object: CONTACT }] });
    expect(answer.code).toBe('PERMISSION_DENIED');
    expect(answer.text).not.toContain(opp.x1);
  });

  it('⭐ an unknown field, or a field that is no relation, is INVALID_FIELD', async () => {
    for (const expand of [['nope'], ['stage']]) {
      const answer = await refused(tok.a, 'query_records', { objectName: OPP, expand });
      expect({ code: answer.code, status: answer.status }).toEqual({ code: 'INVALID_FIELD', status: 400 });
    }
    for (const field of ['nope', 'stage', 'renewal_of']) {
      const answer = await refused(tok.a, 'get_record', { objectName: ACCOUNT, recordId: acct.a1, related: [{ object: OPP, field }] });
      expect({ code: answer.code, status: answer.status }).toEqual({ code: 'INVALID_FIELD', status: 400 });
    }
  });

  it('control: without expand or related, each tool answers as before', async () => {
    const plain = await ok(tok.a, 'query_records', { objectName: OPP, where: { account: acct.a1 } });
    for (const row of rowsOf(plain)) expect(row.account).toBe(acct.a1);
    const record = await ok(tok.a, 'get_record', { objectName: ACCOUNT, recordId: acct.a1 });
    expect(record.id).toBe(acct.a1);
    expect(record.related).toBeUndefined();
  });
});
