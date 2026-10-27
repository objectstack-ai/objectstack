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
// persisted, while the grid still drew the cell locked. ADR-0124 D1 makes the
// SERVER the enforcement point and the client courtesy; here it was inverted.
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
  let ql: any;
  let product: string;

  beforeAll(async () => {
    stack = await getSharedShowcase();
    token = await stack.signIn(); // the issue's own principal: admin@objectos.ai

    ql = await stack.kernel.getServiceAsync<any>('objectql');
    const sys = { context: { isSystem: true } };

    // Own fixtures (uniquely named — the stack is shared across files).
    const account = idOf(await ql.insert('showcase_account', { name: 'Frozen Lines Co #4889', status: 'prospect' }, sys));
    product = idOf(await ql.insert('showcase_product', { name: 'Frozen Widget #4889', unit_price: 49.99 }, sys));

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

  // ── access-security.write-path-guards acceptance[5] and [6] (#26571) ────────

  const storedLine = async (id: string) =>
    ql.findOne('showcase_invoice_line', { where: { id }, context: { isSystem: true } });
  const resultFor = (body: any, id: string) => (body?.results ?? []).find((r: any) => r.id === id);
  const draftLine = async (description: string, quantity: number) =>
    idOf(await ql.insert('showcase_invoice_line', {
      invoice: draftInvoiceId, product, description, quantity, unit_price: 49.99,
    }, { context: { isSystem: true } }));

  it("the paid invoice's line keeps its product too — the third locked field", async () => {
    const other = idOf(await ql.insert('showcase_product', { name: 'Swap Widget #26571', unit_price: 1 }, { context: { isSystem: true } }));
    const res = await stack.apiAs(token, 'PATCH', `${LINES}/${paidLineId}`, { product: other });
    expect(res.status, 'the strip is silent').toBe(200);
    expect(res.headers.get('X-ObjectStack-Dropped-Fields') ?? '').toContain('product;reason=readonly_when');
    expect((await storedLine(paidLineId)).product, 'frozen product must survive the PATCH').toBe(product);
  });

  it('a mixed updateMany is judged PER ROW: the locked row reports droppedFields, the open row in the same batch lands', async () => {
    const res = await stack.apiAs(token, 'POST', `${LINES}/updateMany`, {
      records: [
        { id: paidLineId, data: { quantity: 77 } },
        { id: draftLineId, data: { quantity: 77 } },
      ],
    });
    expect(res.status).toBe(200);
    const body: any = await res.json();
    const locked = resultFor(body, paidLineId);
    const open = resultFor(body, draftLineId);
    expect(locked?.success, `the locked row still succeeds — got ${JSON.stringify(body)}`).toBe(true);
    expect(locked?.droppedFields, 'the locked row names the field it dropped').toEqual(
      expect.arrayContaining([expect.objectContaining({ fields: ['quantity'], reason: 'readonly_when' })]),
    );
    expect(open?.success).toBe(true);
    expect(open?.droppedFields, 'the open row dropped nothing').toBeUndefined();
    expect((await storedLine(paidLineId)).quantity, 'locked row unchanged').toBe(6);
    expect((await storedLine(draftLineId)).quantity, 'open row changed').toBe(77);
  });

  it('updateMany evaluates validation PER ROW under continueOnError: the violating row fails alone', async () => {
    const before = await draftLine('validation row before', 3);
    const bad = await draftLine('validation row violating', 3);
    const after = await draftLine('validation row after', 3);
    const res = await stack.apiAs(token, 'POST', `${LINES}/updateMany`, {
      records: [
        { id: before, data: { quantity: 5 } },
        { id: bad, data: { quantity: -1 } }, // below the field's min: 0
        { id: after, data: { quantity: 7 } },
      ],
      options: { continueOnError: true },
    });
    expect(res.status).toBe(200);
    const body: any = await res.json();
    expect([body.total, body.succeeded, body.failed], JSON.stringify(body)).toEqual([3, 2, 1]);
    expect(resultFor(body, before)?.success).toBe(true);
    expect(resultFor(body, after)?.success, 'the row AFTER the violation is still applied').toBe(true);
    const failed = (body.results ?? []).find((r: any) => r.success === false);
    expect(failed?.errors?.[0]?.code, 'the violating row carries its own validation error').toBe('VALIDATION_FAILED');
    expect((await storedLine(before)).quantity).toBe(5);
    expect((await storedLine(bad)).quantity, 'the violating row is unchanged').toBe(3);
    expect((await storedLine(after)).quantity).toBe(7);
  });

  it('CONTRAST: without continueOnError the run stops at the first failure and reports the tail NOT_ATTEMPTED', async () => {
    const before = await draftLine('stop row before', 3);
    const bad = await draftLine('stop row violating', 3);
    const after = await draftLine('stop row after', 3);
    const res = await stack.apiAs(token, 'POST', `${LINES}/updateMany`, {
      records: [
        { id: before, data: { quantity: 5 } },
        { id: bad, data: { quantity: -1 } },
        { id: after, data: { quantity: 7 } },
      ],
    });
    expect(res.status).toBe(200);
    const body: any = await res.json();
    expect(resultFor(body, before)?.success, JSON.stringify(body)).toBe(true);
    const tail = (body.results ?? [])[2];
    expect(tail?.errors?.[0]?.code, 'the row after the failure is reported, not omitted').toBe('NOT_ATTEMPTED');
    expect((await storedLine(before)).quantity, 'rows before the failure stay written').toBe(5);
    expect((await storedLine(bad)).quantity).toBe(3);
    expect((await storedLine(after)).quantity, 'the un-attempted row is unchanged').toBe(3);
  });
});
