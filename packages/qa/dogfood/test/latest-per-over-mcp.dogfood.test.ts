// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// "Each X with its latest Y" in one MCP call: `query_records` with
// `latestPer` on the CRM example, as a member's agent asks it, over the live
// `/mcp` transport — real SecurityPlugin, real MCP plugin, the SQL driver,
// a real organization wall (`multiTenant: 'posture-only'`, the `isolated`
// posture).
//
// The member of organization A holds one app set: read on the CRM objects, a
// row-level policy that hides closed-lost deals, and `probability` withheld.
//
//   ⭐ one row per group: each account's latest deal, each owner's latest deal,
//      each deal's latest activity; a tie on the date goes to the record id;
//   ⭐ THE ROW-SECURITY PIN: an account whose newest deal the member may not
//      read answers its newest deal the member CAN read — never the hidden
//      one, and never nothing (the hidden row is the newest at rest);
//   ⭐ a partition or order field the member may not read is refused, and a
//      withheld field stays withheld on the served rows;
//   ⭐ the organization wall: a member of B, whose deals share A's stages and
//      are newer, never wins A's groups, and A's never reach B;
//   ⭐ more groups than the cap: `maxLimit` rows and `truncated: true`; under
//      it, no flag;
//   ⭐ control: the same query without `latestPer` answers every row.
//
// Drivers that cannot compile the window (the in-memory driver, the remote
// face of the Turso driver) refuse before anything is read: pinned against
// the engine in `packages/objectql/src/latest-per.test.ts`, and the Turso
// remote face's own word in `packages/drivers/driver-turso`.

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
const SYS = { context: { isSystem: true } } as const;
type Row = Record<string, any>;
const rowsOf = (r: any): Row[] =>
  (Array.isArray(r) ? r : Array.isArray(r?.records) ? r.records : Array.isArray(r?.value) ? r.value : []);

const DOMAIN = 'latestper.verify.test';
const OWNER_A = `owner-a@${DOMAIN}`;
const OWNER_B = `owner-b@${DOMAIN}`;
const MEMBER_A = `member-a@${DOMAIN}`;
const MEMBER_B = `member-b@${DOMAIN}`;
/** More activity groups than the tool's cap (`maxQueryLimit`, 50 by default). */
const CAP = 50;
const MANY = CAP + 5;

/** The member's app set: read on the CRM objects, closed-lost deals hidden, `probability` withheld. */
const memberSet: PermissionSet = PermissionSetSchema.parse({
  name: 'latestper_member',
  label: 'Latest per group over MCP — a CRM member',
  objects: {
    [OPP]: { allowRead: true, allowCreate: false, allowEdit: false, allowDelete: false },
    [ACCOUNT]: { allowRead: true, allowCreate: false, allowEdit: false, allowDelete: false },
    [ACTIVITY]: { allowRead: true, allowCreate: false, allowEdit: false, allowDelete: false },
  },
  fields: { [`${OPP}.probability`]: { readable: false, editable: false } },
  rowLevelSecurity: [
    { name: 'latestper_hide_lost', object: OPP, operation: 'select', using: "record.stage != 'closed_lost'" },
  ],
});

describe('query_records latestPer over MCP on the CRM example — one row per group under row, field and tenant security', () => {
  let stack: VerifyStack;
  let ql: any;
  const tok: Record<string, string> = {};
  const org: Record<string, string> = {};
  const uid: Record<string, string> = {};
  const acct: Record<string, string> = {};
  const opp: Record<string, string> = {};
  const act: Record<string, string> = {};

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
  const query = async (bearer: string, args: Record<string, unknown>) => {
    const answer = await tool(bearer, 'query_records', args);
    expect(answer.isError, answer.text).toBe(false);
    return answer.payload;
  };
  const ids = (payload: any): string[] => rowsOf(payload).map((r) => String(r.id));

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
  const deal = async (key: string, o: string, account: string, owner: string, stage: string, close: string) => {
    opp[key] = idOf(await ql.insert(OPP, {
      name: `LP ${key}`, account, owner_id: owner, stage, close_date: close, amount: 100, probability: 40, organization_id: o,
    }, SYS));
  };

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

    org.a = await organization(OWNER_A, 'LP Org A', 'latestper-a');
    org.b = await organization(OWNER_B, 'LP Org B', 'latestper-b');
    tok.a = await memberOf(MEMBER_A, org.a);
    tok.b = await memberOf(MEMBER_B, org.b);
    uid.a = await userId(MEMBER_A);
    uid.ownerA = await userId(OWNER_A);
    uid.b = await userId(MEMBER_B);

    for (const [key, o] of [['a1', org.a], ['a2', org.a], ['a3', org.a], ['b1', org.b]] as const) {
      acct[key] = idOf(await ql.insert(ACCOUNT, { name: `LP account ${key}`, organization_id: o }, SYS));
    }
    // Account a1: the newest deal (x1, closed lost) is hidden from the member;
    // its newest READABLE deal is x2. Account a2: two deals tie on the date.
    // Account a3: one deal. Organization B: one account whose deals share A's
    // stages and are newer than every deal of A.
    await deal('x1', org.a, acct.a1, uid.a, 'closed_lost', '2031-06-30');
    await deal('x2', org.a, acct.a1, uid.ownerA, 'proposal', '2031-05-01');
    await deal('x3', org.a, acct.a1, uid.a, 'qualification', '2031-01-15');
    await deal('y1', org.a, acct.a2, uid.ownerA, 'prospecting', '2031-03-03');
    await deal('y2', org.a, acct.a2, uid.ownerA, 'proposal', '2031-03-03');
    await deal('z1', org.a, acct.a3, uid.a, 'prospecting', '2030-12-01');
    await deal('b1', org.b, acct.b1, uid.b, 'proposal', '2032-01-01');
    await deal('b2', org.b, acct.b1, uid.b, 'prospecting', '2032-02-02');

    // Activities on x2 and y1 (each deal's latest activity), and MANY one-row
    // groups (one subject each) for the cap.
    const activity = async (key: string, opportunity: string | undefined, subject: string, due: string) => {
      act[key] = idOf(await ql.insert(ACTIVITY, {
        subject, type: 'call', status: 'planned', ...(opportunity ? { opportunity } : {}), due_date: due, organization_id: org.a,
      }, SYS));
    };
    await activity('t1', opp.x2, 'LP follow-up', '2031-04-01T09:00:00.000Z');
    await activity('t2', opp.x2, 'LP follow-up', '2031-04-20T09:00:00.000Z');
    await activity('t3', opp.y1, 'LP follow-up', '2031-02-01T09:00:00.000Z');
    for (let i = 0; i < MANY; i++) {
      await activity(`m${i}`, undefined, `LP many ${String(i).padStart(2, '0')}`, '2031-01-01T09:00:00.000Z');
    }

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
        control: 'at rest, the hidden closed-lost deal IS account a1\'s newest',
        disarmedBy: 'a hidden row that is not the newest would pass the row-security pin without testing it',
        observe: async () => {
          const rows = rowsOf(await ql.find(OPP, { where: { account: acct.a1 }, orderBy: [{ field: 'close_date', order: 'desc' }], context: SYS.context }));
          return { newest: String(rows[0]?.id), stage: String(rows[0]?.stage) };
        },
        armed: (o) => o.newest === opp.x1 && o.stage === 'closed_lost',
        describe: (o) => `newest ${o.newest} (${o.stage})`,
      }),
      armedWhen({
        control: 'the member\'s row policy really hides the closed-lost deal from an ordinary query',
        disarmedBy: 'a policy that never bound would let the hidden row be "newest visible" by accident',
        observe: async () => ({ ids: ids(await query(tok.a, { objectName: OPP, where: { account: acct.a1 } })) }),
        armed: (o) => !o.ids.includes(opp.x1) && o.ids.includes(opp.x2),
        describe: (o) => `member reads ${o.ids.length} deals of a1`,
      }),
    ]);
  }, 300_000);

  afterAll(async () => {
    await stack?.stop?.();
  });

  it('⭐ each account\'s latest deal: one row per group, the tie to the record id, the hidden newest replaced by the newest VISIBLE', async () => {
    const payload = await query(tok.a, {
      objectName: OPP,
      latestPer: { by: ['account'], orderBy: [{ field: 'close_date', order: 'desc' }] },
      fields: ['id', 'account', 'stage', 'close_date'],
    });
    const byAccount = Object.fromEntries(rowsOf(payload).map((r) => [String(r.account), String(r.id)]));
    const tie = [opp.y1, opp.y2].sort().reverse()[0];
    expect(byAccount).toEqual({ [acct.a1]: opp.x2, [acct.a2]: tie, [acct.a3]: opp.z1 });
    // ⭐ never the hidden row, and never nothing for its group.
    expect(ids(payload)).not.toContain(opp.x1);
    expect(payload.truncated).toBeUndefined();
    expect(payload.total).toBeUndefined();
    expect(payload.hasMore).toBe(false);
  });

  it('⭐ each owner\'s latest deal', async () => {
    const payload = await query(tok.a, {
      objectName: OPP,
      latestPer: { by: ['owner_id'], orderBy: [{ field: 'close_date', order: 'desc' }] },
    });
    const byOwner = Object.fromEntries(rowsOf(payload).map((r) => [String(r.owner_id), String(r.id)]));
    // The member's own newest deal (x1) is hidden: x3 answers for them.
    expect(byOwner).toEqual({ [uid.a]: opp.x3, [uid.ownerA]: opp.x2 });
  });

  it('⭐ each deal\'s latest activity', async () => {
    const payload = await query(tok.a, {
      objectName: ACTIVITY,
      where: { subject: 'LP follow-up' },
      latestPer: { by: ['opportunity'], orderBy: [{ field: 'due_date', order: 'desc' }] },
    });
    const byDeal = Object.fromEntries(rowsOf(payload).map((r) => [String(r.opportunity), String(r.id)]));
    expect(byDeal).toEqual({ [opp.x2]: act.t2, [opp.y1]: act.t3 });
  });

  it('⭐ a partition or order field the member may not read is refused; the withheld field stays withheld on the rows', async () => {
    for (const latestPer of [
      { by: ['probability'], orderBy: [{ field: 'close_date', order: 'desc' }] },
      { by: ['account'], orderBy: [{ field: 'probability', order: 'desc' }] },
    ]) {
      const answer = await tool(tok.a, 'query_records', { objectName: OPP, latestPer });
      expect(answer.isError, `${JSON.stringify(latestPer)}: ${answer.text}`).toBe(true);
      expect(answer.payload?.error?.code ?? answer.payload?.code, answer.text).toBe('PERMISSION_DENIED');
      expect(answer.text).not.toContain(opp.x2);
    }
    const served = await query(tok.a, { objectName: OPP, latestPer: { by: ['account'], orderBy: [{ field: 'close_date', order: 'desc' }] } });
    for (const row of rowsOf(served)) expect(row.probability).toBeUndefined();
  });

  it('⭐ the organization wall: B\'s newer deals never win A\'s groups, and A\'s never reach B', async () => {
    const latestPer = { by: ['stage'], orderBy: [{ field: 'close_date', order: 'desc' }] };
    const a = await query(tok.a, { objectName: OPP, latestPer });
    expect(ids(a)).not.toEqual(expect.arrayContaining([opp.b1]));
    expect(ids(a)).not.toContain(opp.b2);
    const byStageA = Object.fromEntries(rowsOf(a).map((r) => [String(r.stage), String(r.id)]));
    expect(byStageA).toEqual({ proposal: opp.x2, qualification: opp.x3, prospecting: opp.y1 });

    const b = await query(tok.b, { objectName: OPP, latestPer });
    expect(ids(b).sort()).toEqual([opp.b1, opp.b2].sort());
  });

  it('⭐ more groups than the cap: the cap\'s rows and truncated: true; one group fewer than the page, no flag', async () => {
    const latestPer = { by: ['subject'], orderBy: [{ field: 'due_date', order: 'desc' }] };
    const capped = await query(tok.a, { objectName: ACTIVITY, where: { subject: { $startsWith: 'LP many' } }, latestPer });
    expect(rowsOf(capped)).toHaveLength(CAP);
    expect(capped.truncated).toBe(true);
    expect(capped.hasMore).toBe(true);
    expect(capped.total).toBeUndefined();
    // The groups, not the rows, are what is counted: every served subject is distinct.
    expect(new Set(rowsOf(capped).map((r) => r.subject)).size).toBe(CAP);

    const whole = await query(tok.a, { objectName: ACTIVITY, where: { subject: 'LP follow-up' }, latestPer, limit: 2 });
    expect(rowsOf(whole)).toHaveLength(1);
    expect(whole.truncated).toBeUndefined();
  });

  it('control: without latestPer the same query answers every row the member reads', async () => {
    const payload = await query(tok.a, { objectName: OPP, where: { account: acct.a1 } });
    expect(ids(payload).sort()).toEqual([opp.x2, opp.x3].sort());
  });
});
