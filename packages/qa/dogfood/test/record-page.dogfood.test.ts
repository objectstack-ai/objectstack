// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#27627] The record page payload (`POST /data/:object/:id/page`) answers a
// member who is not an admin exactly what the separate reads it replaces
// answer that member, part by part, through the real HTTP + security stack:
// row-level security on a related list (owner-scoped notes), field-level
// security on the record and on related rows, a related list behind an object
// grant the member lacks (neither a count nor rows), and a record the member
// cannot read (the whole request refused as the record read refuses it).

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { bootStack, type VerifyStack } from '@objectstack/verify';
import { RecordPageResponseSchema } from '@objectstack/spec/api';
import { recordPageFixtureStack, recordPageFixtureSecurity } from './fixtures/record-page-fixture.js';

const SYS = { isSystem: true } as const;
const MEMBER = 'record-page@verify.test';

describe('[#27627] the record page payload, as a non-admin member', () => {
  let stack: VerifyStack;
  let ql: any;
  let adminTok: string;
  let memberTok: string;
  let accountId: string;
  let privateId: string;

  beforeAll(async () => {
    stack = await bootStack(recordPageFixtureStack, { security: recordPageFixtureSecurity() });
    adminTok = await stack.signIn();
    memberTok = await stack.signUp(MEMBER);
    ql = await stack.kernel.getServiceAsync('objectql');
    accountId = (await ql.insert('rp_account', { name: 'Acme', rating: 'hot' }, { context: SYS })).id;
    // Notes: two the member writes (visible to them), three someone else
    // writes (owner policy hides them). Each carries a secret, written by the
    // system after the fact (nobody's field grant admits writing it).
    for (const title of ['mine 1', 'mine 2']) {
      const res = await stack.apiAs(memberTok, 'POST', '/data/rp_note', { title, account: accountId });
      expect(res.status, await res.clone().text()).toBeLessThan(300);
    }
    for (const title of ['theirs 1', 'theirs 2', 'theirs 3']) {
      const res = await stack.apiAs(adminTok, 'POST', '/data/rp_note', { title, account: accountId });
      expect(res.status, await res.clone().text()).toBeLessThan(300);
    }
    await ql.update('rp_note', { secret: 's' }, { where: { account: accountId }, multi: true, context: SYS });
    const stored: any[] = await ql.find('rp_note', { where: { account: accountId } }, { context: SYS });
    expect(stored.map((r) => r.secret)).toEqual(['s', 's', 's', 's', 's']);
    for (const [title, status] of [['t1', 'open'], ['t2', 'open'], ['t3', 'done'], ['t4', 'open'], ['t5', 'open']]) {
      await ql.insert('rp_task', { title, status, account: accountId }, { context: SYS });
    }
    for (const title of ['l1', 'l2']) await ql.insert('rp_ledger', { title, account: accountId }, { context: SYS });
    // A task of another account: the parent condition keeps it out.
    const other = (await ql.insert('rp_account', { name: 'Other' }, { context: SYS })).id;
    await ql.insert('rp_task', { title: 'elsewhere', status: 'open', account: other }, { context: SYS });
    const priv = await stack.apiAs(adminTok, 'POST', '/data/rp_private', { title: 'admin only' });
    expect(priv.status, await priv.clone().text()).toBeLessThan(300);
    const privBody: any = await priv.json();
    privateId = privBody.id ?? privBody.record?.id ?? privBody.data?.id;
    expect(privateId, 'private id').toBeTruthy();
  }, 180_000);

  afterAll(async () => {
    await stack?.stop?.();
  });

  const send = async (path: string, method = 'GET', body?: unknown) => {
    const res = await stack.apiAs(memberTok, method, path, body);
    return { status: res.status, body: (await res.json().catch(() => undefined)) as any };
  };
  const list = (object: string, filter: unknown, top: number) =>
    send(`/data/${object}?$filter=${encodeURIComponent(JSON.stringify(filter))}&$top=${top}&$count=true`);
  const rowsOf = (body: any) => body?.data?.records ?? body?.records ?? body?.data ?? [];
  const totalOf = (body: any) => body?.data?.total ?? body?.total;

  const REQUEST = {
    related: [
      { object: 'rp_note', field: 'account', top: 3 },
      { object: 'rp_task', field: 'account', filter: { status: 'open' }, top: 3 },
      { object: 'rp_ledger', field: 'account', top: 3 },
    ],
    fieldAccess: true,
    explain: ['update', 'delete', 'transfer'],
    approvals: true,
  };

  it('answers every part as the read it replaces answers it, under RLS, FLS and a missing object grant', async () => {
    const page = await send(`/data/rp_account/${accountId}/page`, 'POST', REQUEST);
    expect(page.status, JSON.stringify(page.body)).toBe(200);
    const data = RecordPageResponseSchema.parse(page.body.data);

    // The record: the record read's answer, the unreadable field absent.
    const read = await send(`/data/rp_account/${accountId}`);
    expect(read.status).toBe(200);
    expect(data.record).toEqual(read.body.data?.record ?? read.body.record);
    expect(data.record).not.toHaveProperty('rating');

    // Row-level security: the member's two notes, counted and listed; the
    // three they cannot read neither counted nor listed; `secret` stripped.
    const notes = await list('rp_note', { account: accountId }, 3);
    expect(notes.status).toBe(200);
    expect(data.related[0]).toEqual({ object: 'rp_note', field: 'account', total: totalOf(notes.body), records: rowsOf(notes.body) });
    expect(data.related[0].total).toBe(2);
    expect(data.related[0].records?.map((r: any) => r.title).sort()).toEqual(['mine 1', 'mine 2']);
    for (const row of data.related[0].records ?? []) expect(row).not.toHaveProperty('secret');

    // A declared filter narrows the parent condition: four open tasks of
    // this account (the other account's task and the done one are out).
    const tasks = await list('rp_task', { account: accountId, status: 'open' }, 3);
    expect(tasks.status).toBe(200);
    expect(data.related[1]).toEqual({ object: 'rp_task', field: 'account', total: totalOf(tasks.body), records: rowsOf(tasks.body) });
    expect(data.related[1].total).toBe(4);
    expect(data.related[1].records).toHaveLength(3);

    // A list the member may not read: the list read's refusal, no count, no rows.
    const ledger = await list('rp_ledger', { account: accountId }, 3);
    expect(ledger.status).toBe(403);
    expect(data.related[2]).not.toHaveProperty('total');
    expect(data.related[2]).not.toHaveProperty('records');
    expect(data.related[2].error).toMatchObject({ status: 403, code: ledger.body?.error?.code ?? ledger.body?.code });

    // Field access: the record-scoped projection's answer.
    const access = await send(`/data/rp_account/${accountId}/field-access`);
    expect(access.status).toBe(200);
    expect(data.fieldAccess).toEqual(access.body.data);
    expect((data.fieldAccess as any).readable).not.toContain('rating');

    // Explain: the record-grained verdict per operation.
    for (const operation of ['update', 'delete', 'transfer'] as const) {
      const verdict = await send('/security/explain', 'POST', { object: 'rp_account', operation, recordId: accountId });
      expect(verdict.status).toBe(200);
      expect(data.explain?.[operation], operation).toEqual(verdict.body);
    }

    // Approvals: the record's requests as the list route answers them.
    const requests = await send(`/approvals/requests?object=rp_account&recordId=${accountId}`);
    expect(data.approvals).toMatchObject({ requests: requests.body?.data ?? [] });
  }, 120_000);

  it('a record the member cannot read refuses the whole request exactly as the record read does', async () => {
    for (const id of [privateId, 'rp_no_such_row']) {
      const read = await send(`/data/rp_private/${id}`);
      const page = await send(`/data/rp_private/${id}/page`, 'POST', { fieldAccess: true, explain: ['update'], approvals: true });
      expect(read.status).toBe(404);
      expect(page).toEqual(read);
    }
  }, 60_000);

  it('refuses an entry that is not a relationship to this record, and any query parameter', async () => {
    const wrong = await send(`/data/rp_account/${accountId}/page`, 'POST', { related: [{ object: 'rp_task', field: 'title', top: 1 }] });
    expect(wrong.status).toBe(400);
    expect(wrong.body?.fields?.[0]).toMatchObject({ field: 'related.0.field', code: 'invalid_relationship' });
    const query = await send(`/data/rp_account/${accountId}/page?top=1`, 'POST', {});
    expect(query.status).toBe(400);
    expect(query.body?.error?.code).toBe('VALIDATION_ERROR');
  }, 60_000);
});
