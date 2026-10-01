// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#21175] `sys_audit_log` parent-record read visibility, through the public
// data doors.
//
// A reader whose sets grant the compliance ledger read gets back only the
// ledger rows about records it can read, plus the rows that are about no
// record. This file drives that on a real org-bound boot — better-auth
// sign-ups, the platform permission sets plus one explicit ledger read grant,
// plugin-audit's real CRUD mirror and auth-event sink writing the rows, and
// service-settings writing a run-level `config_change` row — through every
// generic door that reads the object:
//
//   GET  /data/sys_audit_log              list (+ its `total`)
//   GET  /data/sys_audit_log/:id          by id
//   POST /data/sys_audit_log/query        a filtered query, and a grouped count
//
// The invariant is asserted per returned row (the reader can open the row's
// record through the same data door), so it holds for every record the boot
// writes ledger rows about — the session a `login` row names included — not
// only for the fixture records named below. The admin, who reads every
// record, is the control.
//
// `@objectstack/plugin-audit` resolves through its BUILT output here (a
// ledgered pair in `scripts/check-test-source-alias.mjs`), so a verdict on a
// change to it is a verdict on its last build. ⚠️ No test title states a value.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { bootStack, type VerifyStack } from '@objectstack/verify';
import { AuditPlugin } from '@objectstack/plugin-audit';
import { SecurityPlugin, securityDefaultPermissionSets } from '@objectstack/plugin-security';
import { PermissionSetSchema, type PermissionSet } from '@objectstack/spec/security';
import { commentsFixtureStack, cmtFixtureBaselineSet } from './fixtures/comments-fixture.js';
import { armedWhen, assertArmed, principalArmed } from './armed.js';

const SYS = { isSystem: true } as const;
const LEDGER = 'sys_audit_log';
const READER_EMAIL = 'ledger-gate-reader@verify.test';

/** The grant under test: object-level read on the ledger, nothing more. */
const ledgerReaderSet: PermissionSet = PermissionSetSchema.parse({
  name: 'led_ledger_reader',
  label: 'Ledger gate fixture — object-level sys_audit_log read',
  objects: { [LEDGER]: { allowRead: true } },
});

type Row = Record<string, any>;
const rowsOf = async (res: Response): Promise<Row[]> => ((await res.json()) as any).records ?? [];

describe('[#21175] sys_audit_log: a ledger reader reads the rows about records it can read, and nothing else', () => {
  let stack: VerifyStack;
  let ql: any;
  let adminTok: string;
  let readerTok: string;
  let privateId: string; // cmt_private, owned by the admin — the reader cannot read it
  let openId: string; // cmt_open, created by the reader — the reader reads it
  let goneId: string; // cmt_open, created and deleted by the admin

  const ledgerAtRest = (where: Record<string, unknown>): Promise<Row[]> =>
    ql.find(LEDGER, { where, context: { ...SYS } });

  beforeAll(async () => {
    stack = await bootStack(commentsFixtureStack as never, {
      security: new SecurityPlugin({
        defaultPermissionSets: [...securityDefaultPermissionSets, cmtFixtureBaselineSet, ledgerReaderSet],
        fallbackPermissionSet: cmtFixtureBaselineSet.name,
      }),
      extraPlugins: [new AuditPlugin()],
      // Org-bound: the reader holds `org_member`, the position the platform's
      // member floors are domained to.
      orgContext: true,
    });
    adminTok = await stack.signIn();
    readerTok = await stack.signUp(READER_EMAIL);
    ql = await stack.kernel.getServiceAsync('objectql');

    const readerId = (await ql.findOne('sys_user', { where: { email: READER_EMAIL }, context: SYS }))?.id;
    const set = await ql.findOne('sys_permission_set', { where: { name: ledgerReaderSet.name }, context: SYS });
    expect(set?.id, 'fixture permission set seeded').toBeTruthy();
    await ql.insert('sys_user_permission_set', { user_id: readerId, permission_set_id: set.id }, { context: { ...SYS } });

    const idOf = async (res: Response) => {
      expect(res.status, 'fixture write').toBeLessThan(300);
      const j = (await res.json()) as any;
      return String(j.id ?? j.record?.id ?? j.data?.id);
    };
    privateId = await idOf(await stack.apiAs(adminTok, 'POST', '/data/cmt_private', { name: 'admin only' }));
    expect((await stack.apiAs(adminTok, 'PATCH', `/data/cmt_private/${privateId}`, { name: 'admin only, renamed' })).status).toBeLessThan(300);
    openId = await idOf(await stack.apiAs(readerTok, 'POST', '/data/cmt_open', { name: 'shared board' }));
    goneId = await idOf(await stack.apiAs(adminTok, 'POST', '/data/cmt_open', { name: 'board, gone' }));
    expect((await stack.apiAs(adminTok, 'DELETE', `/data/cmt_open/${goneId}`)).status).toBeLessThan(300);
    // A run-level row, from its real producer: a settings write is a
    // `config_change` row that names no record.
    const put = await stack.raw('/api/settings/branding', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminTok}` },
      body: JSON.stringify({ workspace_name: 'Ledger gate fixture' }),
    });
    expect(put.status, await put.clone().text()).toBe(200);

    await assertArmed([
      principalArmed({
        stack,
        token: readerTok,
        who: 'the member holding object-level sys_audit_log read',
        positions: ['org_member'],
        permissions: [ledgerReaderSet.name],
        control: 'object-level read on sys_audit_log, granted by an explicit permission set',
        disarmedBy: 'a reader that never resolved the grant would read nothing at all, and every narrowing case below would pass on an empty list',
      }),
      armedWhen({
        control: 'the data plane answers the reader 404 on the private record and 200 on its own',
        disarmedBy: 'a reader who could open the private record would make every "not served" case below a statement about nothing',
        observe: async () => ({
          private: (await stack.apiAs(readerTok, 'GET', `/data/cmt_private/${privateId}`)).status,
          open: (await stack.apiAs(readerTok, 'GET', `/data/cmt_open/${openId}`)).status,
        }),
        armed: (o) => o.private === 404 && o.open === 200,
      }),
      armedWhen({
        control: 'the ledger at rest holds the rows this file reasons about, from their real producers',
        disarmedBy: 'a mirror or sink that stopped writing would let every negative case below pass on rows that never existed',
        observe: async () => ({
          private: (await ledgerAtRest({ object_name: 'cmt_private', record_id: privateId })).length,
          open: (await ledgerAtRest({ object_name: 'cmt_open', record_id: openId })).length,
          gone: (await ledgerAtRest({ object_name: 'cmt_open', record_id: goneId })).length,
          aboutNoRecord: (await ledgerAtRest({ action: 'config_change' })).filter((r) => r.record_id == null).length,
        }),
        armed: (o) => o.private === 2 && o.open >= 1 && o.gone === 2 && o.aboutNoRecord >= 1,
      }),
    ]);
  }, 180_000);

  afterAll(async () => {
    await stack?.stop();
  });

  it('list: every row returned that names a record is about one the reader can open, and its own record is among them', async () => {
    const res = await stack.apiAs(readerTok, 'GET', `/data/${LEDGER}?limit=1000`);
    expect(res.status).toBe(200);
    const rows = await rowsOf(res);
    expect(rows.some((r) => r.object_name === 'cmt_open' && r.record_id === openId)).toBe(true);
    expect(rows.some((r) => r.object_name === 'cmt_private')).toBe(false);
    const opened = new Map<string, number>();
    for (const r of rows.filter((row) => row.record_id != null)) {
      const key = `${r.object_name}/${r.record_id}`;
      if (!opened.has(key)) opened.set(key, (await stack.apiAs(readerTok, 'GET', `/data/${key}`)).status);
      expect(opened.get(key), `ledger row ${r.id} is about ${key}`).toBe(200);
    }
  });

  it('list: the total is narrowed exactly like the rows', async () => {
    const body = (await (await stack.apiAs(readerTok, 'GET', `/data/${LEDGER}?limit=1000`)).json()) as any;
    expect(body.total).toBe((body.records ?? []).length);
  });

  it('by id: a row about a record the reader cannot read answers 404; a row about its own answers 200', async () => {
    const [hidden] = await ledgerAtRest({ object_name: 'cmt_private', record_id: privateId });
    const [shown] = await ledgerAtRest({ object_name: 'cmt_open', record_id: openId });
    expect((await stack.apiAs(readerTok, 'GET', `/data/${LEDGER}/${hidden.id}`)).status).toBe(404);
    expect((await stack.apiAs(readerTok, 'GET', `/data/${LEDGER}/${shown.id}`)).status).toBe(200);
  });

  it('query: a filter naming a record the reader cannot read returns nothing', async () => {
    const res = await stack.apiAs(readerTok, 'POST', `/data/${LEDGER}/query`, {
      where: { object_name: 'cmt_private', record_id: privateId },
    });
    expect(res.status).toBe(200);
    expect(((await res.json()) as any).records ?? []).toEqual([]);
  });

  it('query: a grouped count sees only the readable rows', async () => {
    const res = await stack.apiAs(readerTok, 'POST', `/data/${LEDGER}/query`, {
      groupBy: ['object_name'],
      aggregations: [{ function: 'count', alias: 'n' }],
    });
    expect(res.status).toBe(200);
    const groups = ((await res.json()) as any).records ?? [];
    expect(groups.some((g: Row) => g.object_name === 'cmt_private')).toBe(false);
    const listTotal = ((await (await stack.apiAs(readerTok, 'GET', `/data/${LEDGER}?limit=1000`)).json()) as any).total;
    expect(groups.reduce((sum: number, g: Row) => sum + Number(g.n), 0)).toBe(listTotal);
  });

  it('a row about no record is still served to the ledger reader', async () => {
    const [runLevel] = (await ledgerAtRest({ action: 'config_change' })).filter((r) => r.record_id == null);
    expect((await stack.apiAs(readerTok, 'GET', `/data/${LEDGER}/${runLevel.id}`)).status).toBe(200);
  });

  it('a row about a record that no longer exists is served to neither the reader nor the admin', async () => {
    for (const tok of [readerTok, adminTok]) {
      const rows = await rowsOf(await stack.apiAs(tok, 'GET', `/data/${LEDGER}?limit=1000`));
      expect(rows.some((r) => r.record_id === goneId)).toBe(false);
    }
  });

  it('control: the admin, who reads both records, is served the rows about each', async () => {
    const rows = await rowsOf(await stack.apiAs(adminTok, 'GET', `/data/${LEDGER}?limit=1000`));
    expect(rows.filter((r) => r.object_name === 'cmt_private' && r.record_id === privateId)).toHaveLength(2);
    expect(rows.some((r) => r.object_name === 'cmt_open' && r.record_id === openId)).toBe(true);
  });
});
