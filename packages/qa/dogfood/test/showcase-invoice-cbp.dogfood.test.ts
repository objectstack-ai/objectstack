// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// SHOWCASE scenario proof for ADR-0055 — `showcase_invoice_line` is declared
// `sharingModel: 'controlled_by_parent'`, so a line's access is derived from its
// parent `showcase_invoice`. This exercises the feature on the REAL showcase
// metadata, end-to-end through the real HTTP stack (the same requests a browser
// would issue; the security boundary is server-side).
//
// Setup uses system inserts (to sidestep the showcase's authoring-validation
// rules — not what's under test); the controlled-by-parent READ/WRITE behavior
// is then exercised as a real member over HTTP.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import showcaseStack from '@objectstack/example-showcase';
import { bootStack, type VerifyStack } from '@objectstack/verify';
import { SecurityPlugin, securityDefaultPermissionSets } from '@objectstack/plugin-security';
import { PermissionSetSchema, RLS } from '@objectstack/spec/security';

const MEMBER_EMAIL = 'showcase-cbp-member@verify.test';
const ADMIN_EMAIL = 'admin@objectos.ai';

// Member fallback set: full CRUD on the invoice graph (so requests reach the RLS
// layer) + an OWNER policy on the MASTER invoice. The detail line carries no RLS
// — its scoping is derived from the master by `controlled_by_parent`.
const memberSet = PermissionSetSchema.parse({
  name: 'showcase_cbp_member',
  label: 'Showcase CBP Member',
  objects: {
    showcase_account: { allowRead: true, allowCreate: true, allowEdit: true, allowDelete: true },
    showcase_product: { allowRead: true, allowCreate: true, allowEdit: true, allowDelete: true },
    showcase_invoice: { allowRead: true, allowCreate: true, allowEdit: true, allowDelete: true },
    showcase_invoice_line: { allowRead: true, allowCreate: true, allowEdit: true, allowDelete: true },
  },
  rowLevelSecurity: [RLS.ownerPolicy('showcase_invoice', 'created_by')],
});

describe('showcase: invoice-line controlled-by-parent (ADR-0055)', () => {
  let stack: VerifyStack;
  let memberToken: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let ql: any;
  let adminInvoiceId: string;
  let adminLineId: string;
  let memberLineId: string;

  beforeAll(async () => {
    stack = await bootStack(showcaseStack, {
      security: new SecurityPlugin({
        defaultPermissionSets: [...securityDefaultPermissionSets, memberSet],
        fallbackPermissionSet: 'showcase_cbp_member',
      }),
    });
    await stack.signIn(); // seed dev admin
    memberToken = await stack.signUp(MEMBER_EMAIL);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ql = await stack.kernel.getServiceAsync<any>('objectql');
    const sys = { context: { isSystem: true } };
    const idOf = (r: any) => r?.id ?? r?.record?.id ?? r;

    const users = (await ql.find('sys_user', {
      where: { email: { $in: [ADMIN_EMAIL, MEMBER_EMAIL] } },
      context: { isSystem: true },
    })) as Array<{ id: string; email: string }>;
    const adminId = users.find((u) => u.email === ADMIN_EMAIL)!.id;
    const memberId = users.find((u) => u.email === MEMBER_EMAIL)!.id;

    // Shared (non-owner-scoped) account + product.
    const acc = idOf(await ql.insert('showcase_account', { name: 'CBP Co', status: 'prospect' }, sys));
    const prod = idOf(await ql.insert('showcase_product', { name: 'Widget' }, sys));

    // Two invoices: one owned by the admin, one by the member.
    adminInvoiceId = idOf(await ql.insert('showcase_invoice', { name: 'INV-ADMIN', account: acc, status: 'draft', created_by: adminId }, sys));
    const memberInvoiceId = idOf(await ql.insert('showcase_invoice', { name: 'INV-MEMBER', account: acc, status: 'draft', created_by: memberId }, sys));

    // A line under each invoice (the detail under test).
    adminLineId = idOf(await ql.insert('showcase_invoice_line', { invoice: adminInvoiceId, product: prod, quantity: 1, unit_price: 10, description: 'admin line' }, sys));
    memberLineId = idOf(await ql.insert('showcase_invoice_line', { invoice: memberInvoiceId, product: prod, quantity: 1, unit_price: 20, description: 'member line' }, sys));

    // Premise sanity: the admin invoice really is admin-owned (else the proof is void).
    const adminInv = await ql.findOne('showcase_invoice', { where: { id: adminInvoiceId }, context: { isSystem: true } });
    expect(adminInv?.created_by, 'admin invoice must be admin-owned').toBe(adminId);
  }, 60_000);

  afterAll(async () => {
    await stack?.stop();
  });

  it('precondition: member cannot read the admin-owned master invoice (owner RLS)', async () => {
    const r = await stack.apiAs(memberToken, 'GET', `/data/showcase_invoice/${adminInvoiceId}`);
    expect(r.status).not.toBe(200);
  });

  it('DERIVED READ: member cannot read a line under an invoice they cannot read', async () => {
    const r = await stack.apiAs(memberToken, 'GET', `/data/showcase_invoice_line/${adminLineId}`);
    expect(r.status, 'line under unreadable invoice must be hidden').not.toBe(200);
  });

  it('DERIVED WRITE: member cannot by-id mutate a line whose master they cannot edit', async () => {
    const w = await stack.apiAs(memberToken, 'PATCH', `/data/showcase_invoice_line/${adminLineId}`, { description: 'hacked' });
    expect(w.status).not.toBeLessThan(300);
    const after = await ql.findOne('showcase_invoice_line', { where: { id: adminLineId }, context: { isSystem: true } });
    expect(after?.description, 'admin line must be unchanged').toBe('admin line');
  });

  it('NOT over-blocked: member CAN read + edit a line under an invoice they own', async () => {
    const read = await stack.apiAs(memberToken, 'GET', `/data/showcase_invoice_line/${memberLineId}`);
    expect(read.status, 'member should read their own line').toBe(200);

    const edit = await stack.apiAs(memberToken, 'PATCH', `/data/showcase_invoice_line/${memberLineId}`, { description: 'updated' });
    expect(edit.status, 'member should edit their own line').toBeLessThan(300);
    const after = await ql.findOne('showcase_invoice_line', { where: { id: memberLineId }, context: { isSystem: true } });
    expect(after?.description).toBe('updated');
  });
});
