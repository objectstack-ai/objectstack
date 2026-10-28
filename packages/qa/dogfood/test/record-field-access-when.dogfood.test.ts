// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// A row-conditioned field lock (`FieldPermissionSchema.when`), end to end
// through the real HTTP + security stack: what the console is told about a
// field on ONE record, against what the write gate does with a write of it.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { bootStack, type VerifyStack } from '@objectstack/verify';
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

  beforeAll(async () => {
    stack = await bootStack(recordFieldAccessFixtureStack, { security: recordFieldAccessFixtureSecurity() });
    await stack.signIn();
    memberTok = await stack.signUp(MEMBER);
    ql = await stack.kernel.getServiceAsync('objectql');
    memberId = (await ql.findOne('sys_user', { where: { email: MEMBER }, context: SYS }))?.id;
    expect(memberId, 'member provisioned').toBeTruthy();
    draftId = (await ql.insert('rfa_contract', { title: 'D', status: 'draft' }, { context: SYS })).id;
    approvedId = (await ql.insert('rfa_contract', { title: 'A', status: 'approved' }, { context: SYS })).id;
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
});
