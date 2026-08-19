// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// #4889 — PARENT-scoped `readonlyWhen` over the REAL showcase, over real HTTP.
//
// The showcase declares, on `showcase_invoice_line.{product,quantity,unit_price}`:
//
//     readonlyWhen: P`parent.status == 'paid'`
//     // "once the header invoice is Paid, its lines are frozen"
//
// It was enforced in the client grid only. The server strip bound `record` and
// `previous` and had no `parent`, so every one of those predicates faulted, the
// fail-OPEN branch let the write through, and a single PATCH rewrote the
// quantity and unit price of a settled invoice's line — HTTP 200, value
// persisted, while the grid still drew the cell locked. The rule this repo
// cites as ADR-0057 D10 (an attribution, not a resolvable anchor — #9628)
// makes the SERVER the enforcement point and the client courtesy; here it was
// inverted.
//
// This is the issue's own repro, run against the shipped metadata rather than a
// hand-built fixture: the unit + engine suites in `@objectstack/objectql` pin
// the mechanism, and this pins that the mechanism is actually wired to the
// surface a caller reaches.
//
// The record-scoped contrast the issue drew — `showcase_invoice.tax_rate` with
// `readonlyWhen: record.status == 'paid'`, correct all along — rides along, so a
// future change cannot repair one by breaking the other.

import { describe, it, expect, beforeAll } from 'vitest';
import { type VerifyStack } from '@objectstack/verify';
import { getSharedShowcase } from './shared-showcase.js';

const LINES = '/data/showcase_invoice_line';
const INVOICES = '/data/showcase_invoice';
const idOf = (r: any) => r?.id ?? r?.record?.id ?? r?.data?.id ?? r;
const recordOf = (b: any) => b?.record ?? b?.data ?? b;

describe('showcase: parent-scoped readonlyWhen is server-enforced (#4889)', () => {
  let stack: VerifyStack;
  let token: string;
  let paidInvoiceId: string;
  let draftInvoiceId: string;
  let paidLineId: string;
  let draftLineId: string;

  beforeAll(async () => {
    stack = await getSharedShowcase();
    token = await stack.signIn(); // the issue's own principal: admin@objectos.ai

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ql = await stack.kernel.getServiceAsync<any>('objectql');
    const sys = { context: { isSystem: true } };

    // Own fixtures (uniquely named — the stack is shared across files).
    const account = idOf(await ql.insert('showcase_account', { name: 'Frozen Lines Co #4889', status: 'prospect' }, sys));
    const product = idOf(await ql.insert('showcase_product', { name: 'Frozen Widget #4889', unit_price: 49.99 }, sys));

    // A SETTLED invoice — the INV-1003 shape from the issue. `issued_on` /
    // `paid_on` satisfy the header's own `requiredWhen` rules for `paid`.
    paidInvoiceId = idOf(await ql.insert('showcase_invoice', {
      name: 'INV-4889-PAID', account, status: 'paid', tax_rate: 8,
      issued_on: '2026-01-05', paid_on: '2026-01-20',
    }, sys));
    draftInvoiceId = idOf(await ql.insert('showcase_invoice', {
      name: 'INV-4889-DRAFT', account, status: 'draft', tax_rate: 8,
    }, sys));

    paidLineId = idOf(await ql.insert('showcase_invoice_line', {
      invoice: paidInvoiceId, product, description: 'frozen line', quantity: 6, unit_price: 49.99,
    }, sys));
    draftLineId = idOf(await ql.insert('showcase_invoice_line', {
      invoice: draftInvoiceId, product, description: 'open line', quantity: 6, unit_price: 49.99,
    }, sys));
    expect(paidLineId && draftLineId).toBeTruthy();
  }, 60_000);

  const readLine = async (id: string) =>
    recordOf(await (await stack.apiAs(token, 'GET', `${LINES}/${id}`)).json());
  const readInvoice = async (id: string) =>
    recordOf(await (await stack.apiAs(token, 'GET', `${INVOICES}/${id}`)).json());

  it("THE REGRESSION: a paid invoice's frozen line cannot be rewritten over the API", async () => {
    const before = await readLine(paidLineId);
    expect(before.quantity, 'fixture precondition').toBe(6);

    // Verbatim from the issue report.
    const res = await stack.apiAs(token, 'PATCH', `${LINES}/${paidLineId}`, {
      quantity: 9999, unit_price: 0.01,
    });
    // The strip is SILENT by contract (a legal drop, not an error) — the
    // regression is about what LANDS, not about the status code.
    expect(res.status, 'the strip is silent: the request still succeeds').toBe(200);

    const after = await readLine(paidLineId);
    expect(after.quantity, 'frozen quantity must survive the PATCH').toBe(6);
    expect(after.unit_price, 'frozen unit price must survive the PATCH').toBe(49.99);
  });

  it('tells the caller what it dropped (X-ObjectStack-Dropped-Fields, #3431)', async () => {
    const res = await stack.apiAs(token, 'PATCH', `${LINES}/${paidLineId}`, { quantity: 1234 });
    expect(res.status).toBe(200);
    expect(res.headers.get('X-ObjectStack-Dropped-Fields') ?? '').toContain('quantity;reason=readonly_when');
  });

  it('leaves an unlocked field on the same frozen line writable', async () => {
    const res = await stack.apiAs(token, 'PATCH', `${LINES}/${paidLineId}`, {
      quantity: 4242, description: 'note added after settlement',
    });
    expect(res.status).toBe(200);
    const after = await readLine(paidLineId);
    expect(after.quantity, 'still frozen').toBe(6);
    expect(after.description, 'the field the author left open still lands').toBe('note added after settlement');
  });

  it('does NOT freeze a line whose header is still draft', async () => {
    const res = await stack.apiAs(token, 'PATCH', `${LINES}/${draftLineId}`, { quantity: 42 });
    expect(res.status).toBe(200);
    expect((await readLine(draftLineId)).quantity, 'an open invoice edits normally').toBe(42);
  });

  it('CONTRAST: the record-scoped lock on the header still behaves as it always did', async () => {
    const locked = await stack.apiAs(token, 'PATCH', `${INVOICES}/${paidInvoiceId}`, { tax_rate: 99 });
    expect(locked.status).toBe(200);
    expect((await readInvoice(paidInvoiceId)).tax_rate, 'paid ⇒ tax rate frozen').toBe(8);

    const open = await stack.apiAs(token, 'PATCH', `${INVOICES}/${draftInvoiceId}`, { tax_rate: 12 });
    expect(open.status).toBe(200);
    expect((await readInvoice(draftInvoiceId)).tax_rate, 'draft ⇒ tax rate editable').toBe(12);
  });
});
