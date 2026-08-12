// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#7626] `$expand` must not become a second, ungated read door.
//
// The defect this file pins was a CROSS-PERSONA DISCLOSURE on the real
// showcase app: a `contributor`-only member is 403'd on `showcase_contact`
// (neither `showcase_contributor` nor `showcase_member_default` grants it),
// yet `GET /data/showcase_invoice?$expand=contact` handed back the referenced
// contact FULLY MATERIALISED — byte-identical to what the admin sees — because
// the #2850 expand waiver (`expandSkipCrud`) keyed on `access.default`, an axis
// `showcase_contact` never declares, so it read as "public, already broadly
// readable" and waived the object-level gate for EVERY referenced object.
//
// WHY THIS FILE IS END-TO-END AND TWO-PERSONA. The #2850 pin lives in
// `security-plugin.test.ts` and asserts only that the expand sub-read re-enters
// `find()` tagged `__expandRead`. That is a WIRING assertion: it stayed green
// for the whole life of the disclosure because it never asked what a real
// denied caller actually receives. So this file drives the live HTTP stack with
// TWO real sessions and compares outcomes — the admin sees the expansion, the
// denied persona must not, through every expand door the API offers.
//
// It also carries the OVER-CORRECTION guard: a contributor's query for an
// invoice they do not own still returns 200 with the foreign row filtered out
// (RLS on the direct path was never broken and must stay unbroken).
//
// Boots its OWN stack rather than the shared showcase: `shared-showcase.ts`
// hands its baseline an explicit `showcase_contact` read grant for an unrelated
// fixture, which is exactly the grant whose ABSENCE this file is about.
//
// Deliberately carries no `@proof:` tag: ADR-0054 proofs gate the `live` status
// of an AUTHORABLE property, and this file gates none — it pins a security
// regression on the engine's expand seam. A tag here would only add an
// unregistered orphan to `proof-registry.mts`.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import showcaseStack from '@objectstack/example-showcase';
import { bootStack, type VerifyStack } from '@objectstack/verify';
import { showcaseAppDefaultSecurity } from './showcase-security.js';

const SYS = { isSystem: true } as const;

const CONTRIB_EMAIL = 'expand-contrib@verify.test';
/** The field the disclosure actually handed over — the canary for "leaked". */
const SECRET_EMAIL = 'expand-secret-contact@verify.test';

const idOf = (b: any) => b?.id ?? b?.record?.id ?? b?.data?.id ?? b?.recordId;
const recordsOf = (b: any): any[] => b?.records ?? b?.data ?? (Array.isArray(b) ? b : []);

describe('showcase: $expand honours the referenced object’s CRUD gate + OWD (#7626)', () => {
  let stack: VerifyStack;
  let ql: any;
  let adminTok: string;
  let contribTok: string;
  let contactId: string;
  let ownInvoiceId: string;
  let foreignInvoiceId: string;

  beforeAll(async () => {
    stack = await bootStack(showcaseStack, { security: showcaseAppDefaultSecurity() });
    adminTok = await stack.signIn();
    contribTok = await stack.signUp(CONTRIB_EMAIL);
    ql = await stack.kernel.getServiceAsync('objectql');

    // The persona: `contributor` and nothing else — the app's OWN
    // `showcase_contributor` set, unmodified. It names `showcase_invoice` and
    // does NOT name `showcase_contact`; the `showcase_member_default` baseline
    // every member also holds does not name it either. That absence IS the
    // fixture.
    //
    // Both rows are needed and they carry different halves: the POSITION is
    // what the set's RLS rules bind to (`positions: ['contributor']` on
    // `invoice_own_rows`), and the direct set assignment is the CAPABILITY
    // (the same system-plumbing shape `showcase-permission-zoo` uses for its
    // auditor/delegate personas).
    const contribId = (await ql.findOne('sys_user', { where: { email: CONTRIB_EMAIL }, context: SYS }))?.id;
    expect(contribId, 'contributor user provisioned').toBeTruthy();
    await ql.insert('sys_user_position', { user_id: contribId, position: 'contributor' }, { context: SYS });
    const contribSet = await ql.findOne('sys_permission_set', { where: { name: 'showcase_contributor' }, context: SYS });
    expect(contribSet?.id, 'the app’s contributor set is seeded').toBeTruthy();
    await ql.insert(
      'sys_user_permission_set',
      { user_id: contribId, permission_set_id: contribSet.id },
      { context: SYS },
    );

    // Substrate the invoice's required `account` lookup can point at.
    const acct = await stack.apiAs(adminTok, 'POST', '/data/showcase_account', {
      name: 'Expand Gate Co',
      status: 'prospect',
    });
    expect(acct.status, 'admin creates the account').toBeLessThan(300);
    const accountId = idOf(await acct.json());

    // The withheld record: a `sharingModel: 'private'` contact OWNED BY THE
    // ADMIN. The contributor holds no grant on the object AND does not own the
    // row, so both gates — CRUD and OWD — say no to a direct read.
    const contact = await stack.apiAs(adminTok, 'POST', '/data/showcase_contact', {
      name: 'Withheld Contact',
      email: SECRET_EMAIL,
      phone: '+1-555-0100',
      company: 'Expand Gate Co',
      account: accountId,
    });
    expect(contact.status, 'admin creates the private contact').toBeLessThan(300);
    contactId = idOf(await contact.json());
    expect(contactId, 'contact id').toBeTruthy();

    // The parent the contributor IS allowed to read: an invoice they own
    // (`invoice_own_rows` RLS is `owner == current_user.email`) that references
    // the withheld contact.
    const own = await stack.apiAs(adminTok, 'POST', '/data/showcase_invoice', {
      name: 'INV-7626-OWN',
      account: accountId,
      contact: contactId,
      owner: CONTRIB_EMAIL,
      status: 'draft',
    });
    expect(own.status, 'admin creates the contributor-owned invoice').toBeLessThan(300);
    ownInvoiceId = idOf(await own.json());
    expect(ownInvoiceId, 'own invoice id').toBeTruthy();

    // A second invoice the contributor does NOT own — the direct-path RLS guard.
    const foreign = await stack.apiAs(adminTok, 'POST', '/data/showcase_invoice', {
      name: 'INV-7626-FOREIGN',
      account: accountId,
      contact: contactId,
      owner: 'someone-else@verify.test',
      status: 'draft',
    });
    expect(foreign.status, 'admin creates the foreign invoice').toBeLessThan(300);
    foreignInvoiceId = idOf(await foreign.json());
    expect(foreignInvoiceId, 'foreign invoice id').toBeTruthy();
  }, 120_000);

  afterAll(async () => {
    await stack?.stop?.();
  });

  // ── The premise: the direct door is shut ─────────────────────────────────
  it('the contributor is 403’d reading the contact DIRECTLY (the door expand must not reopen)', async () => {
    const byId = await stack.apiAs(contribTok, 'GET', `/data/showcase_contact/${contactId}`);
    expect(byId.status, 'by-id read of a contact the persona holds no grant on').toBe(403);

    const list = await stack.apiAs(contribTok, 'GET', '/data/showcase_contact');
    expect(list.status, 'list read of the same object').toBe(403);
  });

  it('the contributor CAN read the parent invoice they own (so expand is reachable at all)', async () => {
    const r = await stack.apiAs(contribTok, 'GET', `/data/showcase_invoice/${ownInvoiceId}`);
    expect(r.status).toBe(200);
    const body: any = await r.json();
    expect(body?.record?.name ?? body?.name).toBe('INV-7626-OWN');
  });

  // ── Door 1: query-string `$expand` on the list route ─────────────────────
  it('admin sees the contact materialised through `?$expand=contact` (the capability still works)', async () => {
    const r = await stack.apiAs(adminTok, 'GET', `/data/showcase_invoice?$expand=contact&name=INV-7626-OWN`);
    expect(r.status).toBe(200);
    const body: any = await r.json();
    const row = recordsOf(body).find((x: any) => x.name === 'INV-7626-OWN');
    expect(row, 'admin sees the invoice').toBeTruthy();
    expect(row.contact, 'admin gets the expanded record, not the bare id').toMatchObject({
      id: contactId,
      email: SECRET_EMAIL,
    });
  });

  it('the contributor does NOT get the contact through `?$expand=contact`', async () => {
    const r = await stack.apiAs(contribTok, 'GET', `/data/showcase_invoice?$expand=contact&name=INV-7626-OWN`);
    // The parent read is legitimate — it must still succeed.
    expect(r.status, 'the parent read is allowed').toBe(200);
    const raw = await r.text();
    expect(raw, 'no field of the withheld contact reaches the wire').not.toContain(SECRET_EMAIL);

    const body: any = JSON.parse(raw);
    const row = recordsOf(body).find((x: any) => x.name === 'INV-7626-OWN');
    expect(row, 'the invoice itself is still returned').toBeTruthy();
    // Graceful degradation: the FK id is retained, the record is not expanded.
    expect(typeof row.contact === 'object' && row.contact !== null).toBe(false);
  });

  // ── Door 2: query-string `$expand` on the by-id route ────────────────────
  it('the contributor does NOT get the contact through by-id `?expand=contact`', async () => {
    const r = await stack.apiAs(contribTok, 'GET', `/data/showcase_invoice/${ownInvoiceId}?expand=contact`);
    expect(r.status, 'the parent read is allowed').toBe(200);
    const raw = await r.text();
    expect(raw, 'no field of the withheld contact reaches the wire').not.toContain(SECRET_EMAIL);
  });

  it('admin DOES get it through the same by-id door (both personas, one gate)', async () => {
    const r = await stack.apiAs(adminTok, 'GET', `/data/showcase_invoice/${ownInvoiceId}?expand=contact`);
    expect(r.status).toBe(200);
    const raw = await r.text();
    expect(raw, 'the admin expansion is unchanged').toContain(SECRET_EMAIL);
  });

  // ── Door 3: the body door (`POST …/query` with a nested `expand`) ─────────
  it('the contributor does NOT get the contact through the body `expand` door', async () => {
    const r = await stack.apiAs(contribTok, 'POST', '/data/showcase_invoice/query', {
      where: { name: 'INV-7626-OWN' },
      // `id` is deliberately present: without it the expansion is a silent
      // no-op (#7537) and the assertion would pass for the wrong reason.
      expand: { contact: { object: 'showcase_contact', fields: ['id', 'name', 'email'] } },
    });
    expect(r.status, 'the parent read is allowed').toBe(200);
    const raw = await r.text();
    expect(raw, 'no field of the withheld contact reaches the wire').not.toContain(SECRET_EMAIL);
  });

  it('admin DOES get it through the body `expand` door', async () => {
    const r = await stack.apiAs(adminTok, 'POST', '/data/showcase_invoice/query', {
      where: { name: 'INV-7626-OWN' },
      expand: { contact: { object: 'showcase_contact', fields: ['id', 'name', 'email'] } },
    });
    expect(r.status).toBe(200);
    const body: any = await r.json();
    const row = recordsOf(body).find((x: any) => x.name === 'INV-7626-OWN');
    expect(row?.contact, 'admin body-door expansion is unchanged').toMatchObject({ email: SECRET_EMAIL });
  });

  // ── The over-correction guard ────────────────────────────────────────────
  //
  // The fix narrows the EXPAND seam only. A contributor's ordinary query over
  // an object they DO hold is unchanged: it succeeds (200) and the rows they
  // may not see are filtered out by RLS rather than the request being refused.
  it('direct-path RLS is unchanged: a foreign invoice query is 200 with 0 rows, not a 403', async () => {
    const r = await stack.apiAs(contribTok, 'POST', '/data/showcase_invoice/query', {
      where: { name: 'INV-7626-FOREIGN' },
    });
    expect(r.status, 'RLS filters, it does not refuse').toBe(200);
    const body: any = await r.json();
    expect(recordsOf(body), 'the foreign row is filtered out').toHaveLength(0);

    // …and the persona's own row is still returned by the same door.
    const mine = await stack.apiAs(contribTok, 'POST', '/data/showcase_invoice/query', {
      where: { name: 'INV-7626-OWN' },
    });
    expect(mine.status).toBe(200);
    expect(recordsOf(await mine.json()), 'own row still visible').toHaveLength(1);
  });

  it('a PUBLIC referenced object the persona DOES hold still expands (no over-block)', async () => {
    // `showcase_account` is granted to `showcase_contributor` (read). The fix
    // must leave a legitimate lookup expansion working — the capability #2850
    // shipped is what the invoice detail page depends on.
    const r = await stack.apiAs(contribTok, 'GET', `/data/showcase_invoice/${ownInvoiceId}?expand=account`);
    expect(r.status).toBe(200);
    const body: any = await r.json();
    const rec = body?.record ?? body;
    expect(rec?.account, 'a granted lookup still materialises').toMatchObject({ name: 'Expand Gate Co' });
  });
});
