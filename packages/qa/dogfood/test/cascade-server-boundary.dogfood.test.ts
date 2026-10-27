// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// Checklist item `records-forms.cascading-multilevel-and-clear` (#26573): its
// api clauses at the REST data door of the booted showcase, as shipped —
// `showcase_cascade` (country → province, per-option visibleWhen) and the
// invoice's dependent `contact` lookup (dependsOn ['account']).
//
//   acceptance[2], negative[2] — RECORDED GAP: a parent-only PATCH does not
//     revalidate the unwritten child. Create {cn, zj}, PATCH {country: 'us'}
//     → 200, and the row still holds province 'zj'.
//   acceptance[4], negative[2] — RECORDED GAP: lookup cascade scope is not
//     server-enforced. An invoice on Contoso naming a Northwind contact that
//     exists is stored; a fabricated contact id is refused reference_not_found.
//   acceptance[5] — a legal selection on each cascade re-reads verbatim.
//
// The two gap cases pin TODAY's behaviour on purpose, exactly as the item
// records it: the day the server starts revalidating the stale child or
// scoping the contact, these go red, which is the item's own instruction —
// "a run that shows the server auto-clearing/rejecting … would be NEW
// enforcement to file, not a pass here" — made mechanical. The client clear
// (acceptance[0]) and the picker re-query (acceptance[3]) stay browser legs.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { type VerifyStack } from '@objectstack/verify';
import { bootShowcase } from './showcase-boot.js';

type Answer = { status: number; json: any };

describe('records-forms.cascading-multilevel-and-clear — the server boundary over REST', () => {
  let stack: VerifyStack;
  let token = '';
  let northwindId = '';
  let contosoId = '';
  let northwindContactId = '';

  const call = async (method: string, path: string, body?: unknown): Promise<Answer> => {
    const res = await stack.apiAs(token, method, path, body);
    return { status: res.status, json: await res.json().catch(() => ({})) };
  };
  const uniq = (prefix: string) => `${prefix}-${Math.random().toString(36).slice(2, 8)}`;
  const record = (json: any) => json?.record ?? json;
  const idOf = async (object: string, name: string) => String((await stack.rows(object, { name }))[0]?.id ?? '');

  beforeAll(async () => {
    stack = await bootShowcase();
    token = await stack.signIn();
    northwindId = await idOf('showcase_account', 'Northwind');
    contosoId = await idOf('showcase_account', 'Contoso');
    expect(northwindId && contosoId, 'the showcase seed carries Northwind and Contoso').toBeTruthy();
    const [contact] = await stack.rows('showcase_contact', { account: northwindId });
    expect(contact, 'the showcase seed carries a Northwind contact').toBeTruthy();
    northwindContactId = String(contact.id);
  }, 180_000);

  afterAll(async () => {
    await stack?.stop();
  });

  it('acceptance[2], negative[2]: a parent-only PATCH is accepted and the stale child is kept (recorded gap)', async () => {
    const name = uniq('csb-stale');
    const created = await call('POST', '/data/showcase_cascade', { name, country: 'cn', province: 'zj' });
    expect(created.status, JSON.stringify(created.json)).toBe(201);
    const id = await idOf('showcase_cascade', name);

    const patched = await call('PATCH', `/data/showcase_cascade/${id}`, { country: 'us' });
    expect(patched.status, JSON.stringify(patched.json)).toBe(200);
    const read = await call('GET', `/data/showcase_cascade/${id}`);
    expect(read.status).toBe(200);
    expect(record(read.json)).toMatchObject({ country: 'us', province: 'zj' });

    // Control: the same stale child IN the payload is the written-value gate's to refuse.
    const written = await call('PATCH', `/data/showcase_cascade/${id}`, { country: 'us', province: 'zj' });
    expect(written.status, JSON.stringify(written.json)).toBe(400);
    expect((written.json.fields ?? []).map((f: any) => [f.field, f.code])).toEqual([['province', 'invalid_option']]);
  });

  it('acceptance[4], negative[2]: a cross-account contact that exists is stored (recorded gap); a fabricated one is reference_not_found', async () => {
    const crossName = uniq('csb-cross');
    const cross = await call('POST', '/data/showcase_invoice', { name: crossName, account: contosoId, contact: northwindContactId });
    expect(cross.status, JSON.stringify(cross.json)).toBe(201);
    const [stored] = await stack.rows('showcase_invoice', { name: crossName });
    expect(stored).toMatchObject({ account: contosoId, contact: northwindContactId });

    const fakeName = uniq('csb-fake');
    const fake = await call('POST', '/data/showcase_invoice', { name: fakeName, account: contosoId, contact: 'no_such_contact_26573' });
    expect(fake.status, JSON.stringify(fake.json)).toBe(400);
    expect((fake.json.fields ?? []).map((f: any) => [f.field, f.code])).toEqual([['contact', 'reference_not_found']]);
    expect(await stack.rows('showcase_invoice', { name: fakeName })).toHaveLength(0);
  });

  it('acceptance[5]: a legal selection on each cascade re-reads verbatim', async () => {
    const name = uniq('csb-legal');
    const created = await call('POST', '/data/showcase_cascade', { name, country: 'cn', province: 'zj' });
    expect(created.status, JSON.stringify(created.json)).toBe(201);
    const read = await call('GET', `/data/showcase_cascade/${await idOf('showcase_cascade', name)}`);
    expect(record(read.json)).toMatchObject({ name, country: 'cn', province: 'zj' });

    const invoiceName = uniq('csb-twin');
    const invoice = await call('POST', '/data/showcase_invoice', { name: invoiceName, account: northwindId, contact: northwindContactId });
    expect(invoice.status, JSON.stringify(invoice.json)).toBe(201);
    const invoiceRead = await call('GET', `/data/showcase_invoice/${await idOf('showcase_invoice', invoiceName)}`);
    expect(record(invoiceRead.json)).toMatchObject({ account: northwindId, contact: northwindContactId });
  });
});
