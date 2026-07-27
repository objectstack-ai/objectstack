// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// END-TO-END gate for #3602 residual 1 — "the dimension-label lookup is scoped
// to the referenced object's RLS" — proven through the REAL stack: HTTP → REST
// exec context → SecurityPlugin → AnalyticsServicePlugin auto-bridges → the
// plugin's real fetchRecordLabels closure that ANDs the referenced object's
// scope into the label read.
//
// The member owns a deal that points at a vendor OWNED BY THE ADMIN. Grouping
// deals by vendor, the member's bucket carries the vendor id; resolving that id
// to a NAME reads the vendor object, which the member cannot read. Before the
// fix the member got the vendor's name (leak); after it, the vendor scope
// excludes the admin's vendor so the raw id renders. The admin — who owns the
// vendor — still sees the name, proving the fix SCOPES rather than blanks.
//
// This is the only gate that exercises the plugin's real label closure; the
// service-analytics unit/integration tests fake fetchRecordLabels.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { bootStack, type VerifyStack } from '@objectstack/verify';
import { labelScopeStack, labelScopeSecurity } from './fixtures/label-scope-fixture.js';

const VENDOR_NAME = 'Admin-Owned Vendor';

const dealsByVendor = {
  name: 'deals_by_vendor',
  label: 'Deals by vendor',
  object: 'lbl_deal',
  dimensions: [{ name: 'vendor', label: 'Vendor', field: 'vendor', type: 'lookup' }],
  measures: [{ name: 'cnt', label: 'Count', aggregate: 'count' }],
};

describe('dogfood: dimension-label lookup is RLS-scoped to the referenced object (#3602)', () => {
  let stack: VerifyStack;
  let adminToken: string;
  let memberToken: string;
  let vendorId: string;

  beforeAll(async () => {
    stack = await bootStack(labelScopeStack as never, { security: labelScopeSecurity() });
    adminToken = await stack.signIn();
    memberToken = await stack.signUp('lbl-member@verify.test');

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ql = await stack.kernel.getServiceAsync<any>('objectql');
    const sys = { context: { isSystem: true } };
    const uid = async (email: string): Promise<string> => {
      const u = await ql.findOne('sys_user', { where: { email }, ...sys });
      if (!u?.id) throw new Error(`no sys_user for ${email}`);
      return u.id as string;
    };
    const adminId = await uid('admin@objectos.ai');
    const memberId = await uid('lbl-member@verify.test');

    // Vendor owned by the admin — the member must NOT be able to read it.
    const vendor = await ql.insert('lbl_vendor', { name: VENDOR_NAME, created_by: adminId }, sys);
    vendorId = vendor.id as string;

    // One deal per principal, BOTH pointing at the admin's vendor. Authored as
    // system with an explicit owner so the owner policy binds deterministically
    // (and the member's deal can reference a vendor it cannot itself read).
    await ql.insert('lbl_deal', { name: 'member deal', amount: 10, vendor: vendorId, created_by: memberId }, sys);
    await ql.insert('lbl_deal', { name: 'admin deal', amount: 20, vendor: vendorId, created_by: adminId }, sys);

    // Preconditions: the member reads their deal but NOT the admin's vendor.
    const deals = await stack.apiAs(memberToken, 'GET', '/data/lbl_deal');
    expect(((await deals.json()).records ?? []).map((r: any) => r.name)).toEqual(['member deal']);
    const vendors = await stack.apiAs(memberToken, 'GET', '/data/lbl_vendor');
    expect((await vendors.json()).records ?? []).toHaveLength(0);
  }, 90_000);

  afterAll(async () => {
    await stack?.stop();
  });

  async function vendorCellFor(token: string): Promise<unknown> {
    const res = await stack.apiAs(token, 'POST', '/analytics/dataset/query', {
      dataset: dealsByVendor,
      selection: { dimensions: ['vendor'], measures: ['cnt'] },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { rows?: Array<Record<string, unknown>> };
    // Exactly one deal is visible to each principal → one vendor bucket.
    expect(body.rows ?? []).toHaveLength(1);
    return (body.rows ?? [])[0].vendor;
  }

  it('the member sees the vendor id RAW — the name it cannot read does not leak', async () => {
    const cell = await vendorCellFor(memberToken);
    expect(cell).toBe(vendorId);
    expect(cell).not.toBe(VENDOR_NAME);
  });

  it('the admin — who owns the vendor — still sees the resolved name (scopes, not blanks)', async () => {
    const cell = await vendorCellFor(adminToken);
    expect(cell).toBe(VENDOR_NAME);
  });
});
