// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#26594 / ruling of record 6457467702] A row-conditioned field lock
// (`FieldPermissionSchema.when`), end to end through the real HTTP + security
// stack: what the console is told about a field on ONE record, against what the
// write gate does with a write of it.
//
// The two `measure` legs are the card's symptom and stay as its record: the
// row-less reader (`/auth/me/permissions`) reports the conditioned entry as its
// lock on every row, while the write gate admits the field on a draft. The rest
// pin the record-scoped projection (`GET /data/:object/:id/field-access`): it
// answers what the gate does, row by row and field by field, and never more
// than the record read discloses.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { bootStack, type VerifyStack } from '@objectstack/verify';
import { GetRecordFieldAccessResponseSchema } from '@objectstack/spec/api';
import {
  recordFieldAccessFixtureStack,
  recordFieldAccessFixtureSecurity,
} from './fixtures/record-field-access-fixture.js';

const SYS = { isSystem: true } as const;
const MEMBER = 'record-field-access@verify.test';

describe('a row-conditioned field lock, on the record the form edits', () => {
  let stack: VerifyStack;
  let ql: any;
  let memberTok: string;
  let memberId: string;
  let draftId: string;
  let approvedId: string;
  let hiddenMemoId: string;
  let othersNoticeId: string;

  beforeAll(async () => {
    stack = await bootStack(recordFieldAccessFixtureStack, { security: recordFieldAccessFixtureSecurity() });
    await stack.signIn();
    memberTok = await stack.signUp(MEMBER);
    ql = await stack.kernel.getServiceAsync('objectql');
    memberId = (await ql.findOne('sys_user', { where: { email: MEMBER }, context: SYS }))?.id;
    expect(memberId, 'member provisioned').toBeTruthy();
    draftId = (await ql.insert('rfa_contract', { title: 'D', status: 'draft' }, { context: SYS })).id;
    approvedId = (await ql.insert('rfa_contract', { title: 'A', status: 'approved' }, { context: SYS })).id;
    // A private row the member does not own, so cannot read.
    hiddenMemoId = (await ql.insert('rfa_memo', { title: 'approved' }, { context: SYS })).id;
    // A public-read row someone else owns: readable, not writable, for the member.
    othersNoticeId = (await ql.insert('rfa_notice', { title: 'N' }, { context: SYS })).id;
  }, 180_000);

  afterAll(async () => {
    await stack?.stop?.();
  });

  it('measure — the row-less reader reports the conditioned entry as its lock', async () => {
    const res = await stack.apiAs(memberTok, 'GET', '/auth/me/permissions');
    expect(res.status).toBe(200);
    const body: any = await res.json();
    expect(body.fields['rfa_contract.summary']).toEqual({ readable: true, editable: false });
  }, 60_000);

  it('measure — the write gate admits the field on the draft and refuses it on the approved row', async () => {
    const onDraft = await stack.apiAs(memberTok, 'PATCH', `/data/rfa_contract/${draftId}`, { summary: 'filled' });
    expect(onDraft.status, await onDraft.clone().text()).toBe(200);
    const onApproved = await stack.apiAs(memberTok, 'PATCH', `/data/rfa_contract/${approvedId}`, { summary: 'filled' });
    expect(onApproved.status).toBe(403);
  }, 60_000);

  const fieldAccess = async (object: string, id: string, query = '') => {
    const res = await stack.apiAs(memberTok, 'GET', `/data/${object}/${id}/field-access${query}`);
    return { status: res.status, body: (await res.json().catch(() => undefined)) as any };
  };
  const stored = async (id: string) => ql.findOne('rfa_contract', { where: { id }, context: SYS });
  const FIELDS = ['title', 'status', 'summary', 'ref_no'] as const;

  it('the record-scoped projection unlocks the conditioned field on a row the condition does not name', async () => {
    const { status, body } = await fieldAccess('rfa_contract', draftId);
    expect(status).toBe(200);
    expect(body.success).toBe(true);
    const access = GetRecordFieldAccessResponseSchema.parse(body.data);
    expect(access.object).toBe('rfa_contract');
    expect(access.recordId).toBe(draftId);
    expect(access.editable).toEqual(expect.arrayContaining(['title', 'status', 'summary']));
    // The unconditioned lock stays a lock on every row.
    expect(access.editable).not.toContain('ref_no');
    expect(access.readable).toEqual(expect.arrayContaining([...FIELDS]));
  }, 60_000);

  it('and locks it on a row the condition names', async () => {
    const { status, body } = await fieldAccess('rfa_contract', approvedId);
    expect(status).toBe(200);
    const access = GetRecordFieldAccessResponseSchema.parse(body.data);
    expect(access.editable).not.toContain('summary');
    expect(access.editable).not.toContain('ref_no');
    expect(access.editable).toEqual(expect.arrayContaining(['title', 'status']));
  }, 60_000);

  it('equals the write gate, field by field, on a row each side of the condition (allowed and refused)', async () => {
    for (const id of [draftId, approvedId]) {
      const access = GetRecordFieldAccessResponseSchema.parse((await fieldAccess('rfa_contract', id)).body.data);
      const row: any = await stored(id);
      for (const field of FIELDS) {
        // Write the stored value back (a placeholder where none is stored), so
        // no write moves the row across its own condition.
        const value = row[field] ?? 'x';
        const res = await stack.apiAs(memberTok, 'PATCH', `/data/rfa_contract/${id}`, { [field]: value });
        const admitted = res.status === 200;
        if (!admitted) expect(res.status, `${row.status}.${field}: ${await res.clone().text()}`).toBe(403);
        expect(access.editable.includes(field), `${row.status}.${field}`).toBe(admitted);
      }
    }
  }, 120_000);

  it('a record the caller cannot read answers exactly as the record read does — no projection leaks it', async () => {
    for (const id of [hiddenMemoId, 'rfa_no_such_row']) {
      const read = await stack.apiAs(memberTok, 'GET', `/data/rfa_memo/${id}`);
      const projected = await fieldAccess('rfa_memo', id);
      expect(read.status).toBe(404);
      expect(projected.status).toBe(read.status);
      expect(projected.body).toEqual(await read.json());
    }
  }, 60_000);

  it('measure — a row the caller may read but not write: the projection is field-level only, the PATCH refuses the row', async () => {
    // The row-level write scope (sharing, row-level security, ownership) is
    // declared outside `editable`: the projection lists the fields
    // field-level security admits, and the write is refused for the row as a
    // whole. A reader ANDs this answer with the record's own write scope; the
    // console's edit dialog has never gated on that scope, so the server's
    // 403 on save is its answer there, before this card and after it.
    const read = await stack.apiAs(memberTok, 'GET', `/data/rfa_notice/${othersNoticeId}`);
    expect(read.status, await read.clone().text()).toBe(200);
    const { status, body } = await fieldAccess('rfa_notice', othersNoticeId);
    expect(status).toBe(200);
    const access = GetRecordFieldAccessResponseSchema.parse(body.data);
    expect(access.editable).toEqual(expect.arrayContaining(['title', 'summary']));
    const patch = await stack.apiAs(memberTok, 'PATCH', `/data/rfa_notice/${othersNoticeId}`, { title: 'N' });
    expect(patch.status, await patch.clone().text()).toBe(403);
  }, 60_000);

  it('the row-less reader still answers as before, and the route takes no query parameter', async () => {
    const res = await stack.apiAs(memberTok, 'GET', '/auth/me/permissions');
    const body: any = await res.json();
    expect(body.fields['rfa_contract.summary']).toEqual({ readable: true, editable: false });
    expect(body.fields['rfa_contract.ref_no']).toEqual({ readable: true, editable: false });
    const refused = await fieldAccess('rfa_contract', draftId, '?fields=summary');
    expect(refused.status).toBe(400);
    expect(refused.body?.error?.code).toBe('VALIDATION_ERROR');
  }, 60_000);
});
