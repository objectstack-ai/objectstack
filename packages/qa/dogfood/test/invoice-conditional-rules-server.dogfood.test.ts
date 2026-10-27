// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// Checklist item `records-forms.conditional-rules-header` (#26573): the
// server half of the invoice's header rules, at the REST data door of the
// booted showcase, as shipped (`showcase_invoice`, invoice.object.ts):
//
//   acceptance[1], negative[0] — `issued_on` requiredWhen status in
//     ['sent', 'paid']: a direct POST of a 'sent' invoice with no issued_on is
//     400 VALIDATION_FAILED naming issued_on with code 'required', and no
//     invoice of that name exists. The draft twin is the 201 control.
//   acceptance[2], negative[1] — `tax_rate` readonlyWhen status == 'paid': a
//     PATCH to tax_rate on the seeded paid invoice INV-1003 answers 200 and is
//     DISCARDED (stripReadonlyWhenFields keeps, never rejects) — the re-read
//     equals the read before. A draft invoice's tax_rate PATCH persisting is
//     the control that the strip is the rule's, not the door's.
//   acceptance[5] — the API half of "one rule, not two": the predicates the
//     form evaluates (status in sent/paid, status == paid) are the ones these
//     refusals answer to. The form half is the objectui live specs'.
//
// The dom clauses (acceptance[0], [3], [4], negative[2]) stay browser legs.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { type VerifyStack } from '@objectstack/verify';
import { bootShowcase } from './showcase-boot.js';

const INVOICE = 'showcase_invoice';

type Answer = { status: number; json: any };

describe('records-forms.conditional-rules-header — the invoice rules at the server', () => {
  let stack: VerifyStack;
  let token = '';
  let accountId = '';

  const call = async (method: string, path: string, body?: unknown): Promise<Answer> => {
    const res = await stack.apiAs(token, method, path, body);
    return { status: res.status, json: await res.json().catch(() => ({})) };
  };
  const uniq = (prefix: string) => `${prefix}-${Math.random().toString(36).slice(2, 8)}`;

  beforeAll(async () => {
    stack = await bootShowcase();
    token = await stack.signIn();
    const [account] = await stack.rows('showcase_account', { status: 'active' });
    accountId = String(account.id);
  }, 180_000);

  afterAll(async () => {
    await stack?.stop();
  });

  it('acceptance[1], negative[0]: a sent invoice with no issued_on is refused, naming issued_on, and nothing is stored', async () => {
    const name = uniq('icr-sent');
    const refused = await call('POST', `/data/${INVOICE}`, { name, account: accountId, status: 'sent' });
    expect(refused.status, JSON.stringify(refused.json)).toBe(400);
    expect(refused.json.code).toBe('VALIDATION_FAILED');
    expect((refused.json.fields ?? []).map((f: any) => [f.field, f.code])).toEqual([['issued_on', 'required']]);
    expect(await stack.rows(INVOICE, { name })).toHaveLength(0);

    // Control: the draft twin is admitted; the same sent invoice with its date is too.
    const draft = await call('POST', `/data/${INVOICE}`, { name: uniq('icr-draft'), account: accountId, status: 'draft' });
    expect(draft.status, JSON.stringify(draft.json)).toBe(201);
    const dated = await call('POST', `/data/${INVOICE}`, { name: uniq('icr-dated'), account: accountId, status: 'sent', issued_on: '2026-10-01' });
    expect(dated.status, JSON.stringify(dated.json)).toBe(201);
  });

  it('acceptance[2], negative[1]: a tax_rate PATCH on the paid invoice answers 200 and is discarded', async () => {
    const [paid] = await stack.rows(INVOICE, { name: 'INV-1003' });
    expect(paid?.status, 'the showcase seed carries the paid INV-1003').toBe('paid');
    const before = (await call('GET', `/data/${INVOICE}/${paid.id}`)).json;
    const beforeRate = (before.record ?? before).tax_rate;
    expect(beforeRate).not.toBe(99);

    const patched = await call('PATCH', `/data/${INVOICE}/${paid.id}`, { tax_rate: 99 });
    expect(patched.status, JSON.stringify(patched.json)).toBe(200);
    const after = (await call('GET', `/data/${INVOICE}/${paid.id}`)).json;
    expect((after.record ?? after).tax_rate).toBe(beforeRate);

    // Control: on a draft invoice the same PATCH persists.
    const name = uniq('icr-rate');
    expect((await call('POST', `/data/${INVOICE}`, { name, account: accountId, status: 'draft' })).status).toBe(201);
    const [draft] = await stack.rows(INVOICE, { name });
    expect((await call('PATCH', `/data/${INVOICE}/${draft.id}`, { tax_rate: 12 })).status).toBe(200);
    const [rated] = await stack.rows(INVOICE, { name });
    expect(rated.tax_rate).toBe(12);
  });
});
