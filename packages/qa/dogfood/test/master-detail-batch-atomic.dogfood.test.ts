// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// Checklist item `records-forms.master-detail-atomic-save` (#26573): its api
// clauses at the door the master-detail form saves through — the cross-object
// `POST /api/v1/batch`, one transaction, child ops pointing at the parent by
// `{ $ref: 0 }` (the shape objectui's master-detail live spec reads off the
// wire) — on the showcase invoice and its lines, as shipped.
//
//   acceptance[1], acceptance[5] — the invoice and two lines re-read over
//     REST with the values sent (the catalog product's description and
//     unit_price, which the grid copies client-side on a product pick), and
//     each line's stored amount is quantity × unit_price, computed by the
//     server: a client-sent amount does not stand.
//   acceptance[2] — invoice.total is a SERVER roll-up: it equals the sum of
//     the line amounts on the atomic create, again after a line is added, and
//     again after one is deleted.
//   acceptance[3], negative[0] — a failing child aborts the WHOLE batch: the
//     answer is a refusal, and neither the invoice nor its valid sibling line
//     exists afterwards (read by API, not by the grid).
//
// The batch-count clause (acceptance[0], negative[1]), the live client
// recompute (acceptance[5]'s first half) and the derived grid (acceptance[4])
// stay network/dom legs.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { type VerifyStack } from '@objectstack/verify';
import { bootShowcase } from './showcase-boot.js';

const INVOICE = 'showcase_invoice';
const LINE = 'showcase_invoice_line';

type Answer = { status: number; json: any };

describe('records-forms.master-detail-atomic-save — the atomic batch and the server roll-up over REST', () => {
  let stack: VerifyStack;
  let token = '';
  let accountId = '';
  let widget: any;
  let service: any;

  const call = async (method: string, path: string, body?: unknown): Promise<Answer> => {
    const res = await stack.apiAs(token, method, path, body);
    return { status: res.status, json: await res.json().catch(() => ({})) };
  };
  const uniq = (prefix: string) => `${prefix}-${Math.random().toString(36).slice(2, 8)}`;
  const listOf = async (object: string, filter: unknown[]): Promise<any[]> => {
    const res = await call('GET', `/data/${object}?$filter=${encodeURIComponent(JSON.stringify(filter))}&$top=100`);
    expect(res.status, JSON.stringify(res.json)).toBe(200);
    return res.json.records ?? res.json.data ?? res.json.value ?? res.json;
  };
  const invoiceNamed = async (name: string) => (await listOf(INVOICE, [['name', '=', name]]))[0];
  const linesOf = (invoiceId: string) => listOf(LINE, [['invoice', '=', invoiceId]]);
  const expectTotalIsSum = async (invoiceId: string, expected: number) => {
    const lines = await linesOf(invoiceId);
    const sum = lines.reduce((acc, l) => acc + Number(l.amount), 0);
    expect(sum).toBeCloseTo(expected, 2);
    const [invoice] = await listOf(INVOICE, [['id', '=', invoiceId]]);
    expect(Number(invoice.total)).toBeCloseTo(expected, 2);
  };

  beforeAll(async () => {
    stack = await bootShowcase();
    token = await stack.signIn();
    const [account] = await stack.rows('showcase_account', { status: 'active' });
    accountId = String(account.id);
    [widget] = await stack.rows('showcase_product', { sku: 'WIDGET-A' });
    [service] = await stack.rows('showcase_product', { sku: 'SERVICE-HR' });
    expect(widget && service, 'the showcase seed carries WIDGET-A and SERVICE-HR').toBeTruthy();
  }, 180_000);

  afterAll(async () => {
    await stack?.stop();
  });

  it('acceptance[1], acceptance[5], acceptance[2]: one batch lands the invoice and two lines, the stored amounts are the server\'s, and the total rolls up', async () => {
    const name = uniq('mda-ok');
    const res = await call('POST', '/batch', {
      operations: [
        { object: INVOICE, action: 'create', data: { name, account: accountId, status: 'draft' } },
        { object: LINE, action: 'create', data: { invoice: { $ref: 0 }, product: widget.id, description: widget.description, quantity: 2, unit_price: widget.unit_price, amount: 1 } },
        { object: LINE, action: 'create', data: { invoice: { $ref: 0 }, product: service.id, description: service.description, quantity: 3, unit_price: service.unit_price } },
      ],
    });
    expect(res.status, JSON.stringify(res.json)).toBe(200);

    const invoice = await invoiceNamed(name);
    expect(invoice).toMatchObject({ name, account: accountId, status: 'draft' });
    const lines = (await linesOf(invoice.id)).sort((a, b) => Number(a.quantity) - Number(b.quantity));
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatchObject({ invoice: invoice.id, product: widget.id, description: 'Standard widget', quantity: 2 });
    expect(Number(lines[0].unit_price)).toBeCloseTo(29.99, 2);
    expect(Number(lines[0].amount), 'a client-sent amount does not stand').toBeCloseTo(2 * 29.99, 2);
    expect(lines[1]).toMatchObject({ invoice: invoice.id, product: service.id, description: 'Professional services, per hour', quantity: 3 });
    expect(Number(lines[1].amount)).toBeCloseTo(3 * 150, 2);
    await expectTotalIsSum(invoice.id, 2 * 29.99 + 3 * 150);

    // A line added later re-rolls the total; a line deleted re-rolls it again.
    const added = await call('POST', `/data/${LINE}`, { invoice: invoice.id, product: widget.id, quantity: 1, unit_price: 10 });
    expect(added.status, JSON.stringify(added.json)).toBe(201);
    await expectTotalIsSum(invoice.id, 2 * 29.99 + 3 * 150 + 10);
    const removed = await call('DELETE', `/data/${LINE}/${lines[1].id}`);
    expect(removed.status, JSON.stringify(removed.json)).toBe(200);
    await expectTotalIsSum(invoice.id, 2 * 29.99 + 10);
  });

  it('acceptance[3], negative[0]: a failing child aborts the whole batch — no invoice and no sibling line survive', async () => {
    const name = uniq('mda-bad');
    const marker = uniq('mda-sibling');
    const res = await call('POST', '/batch', {
      operations: [
        { object: INVOICE, action: 'create', data: { name, account: accountId, status: 'draft' } },
        { object: LINE, action: 'create', data: { invoice: { $ref: 0 }, product: widget.id, description: marker, quantity: 1, unit_price: 5 } },
        // The failing child: product is required.
        { object: LINE, action: 'create', data: { invoice: { $ref: 0 }, description: `${marker}-bad`, quantity: 1, unit_price: 5 } },
      ],
    });
    expect(res.status, JSON.stringify(res.json)).toBe(400);
    expect(res.json).toMatchObject({ code: 'VALIDATION_FAILED', fields: [{ field: 'product', code: 'required' }] });
    expect(await listOf(INVOICE, [['name', '=', name]])).toHaveLength(0);
    expect(await listOf(LINE, [['description', 'startswith', marker]])).toHaveLength(0);
  });
});
