// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// SHOWCASE turnkey-demo proof (ADR-0055). The showcase now SEEDS invoices owned
// by different contributors (ada/linus/grace) + their lines, and the
// `showcase_contributor` permission set scopes invoice SELECT to
// `owner == current_user.name`. Because `showcase_invoice_line` is
// `controlled_by_parent`, each contributor sees ONLY their own invoices' lines.
//
// This boots the REAL showcase app (its seed data loads at ready) and asserts the
// per-owner isolation over that seed, through the real HTTP stack. To exercise the
// owner predicate without a contributor-role user (the showcase seeds no
// non-admin users), it governs sign-ups with an equivalent, non-role-gated mirror
// of the contributor set — same `owner = current_user.email` predicate, same
// derived-line behavior. Sign-ups use the seed owners' emails so
// `current_user.email` resolves and matches.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import showcaseStack from '@objectstack/example-showcase';
import { bootStack, type VerifyStack } from '@objectstack/verify';
import { SecurityPlugin, securityDefaultPermissionSets } from '@objectstack/plugin-security';
import { PermissionSetSchema } from '@objectstack/spec/security';

// Non-role-gated mirror of `showcase_contributor`'s invoice access, so a plain
// sign-up (which holds no role) is governed by it.
const demoSet = PermissionSetSchema.parse({
  name: 'showcase_cbp_demo',
  label: 'Showcase CBP Demo',
  objects: {
    showcase_account: { allowRead: true, allowCreate: false, allowEdit: false, allowDelete: false },
    showcase_product: { allowRead: true, allowCreate: false, allowEdit: false, allowDelete: false },
    showcase_invoice: { allowRead: true, allowCreate: true, allowEdit: true, allowDelete: false },
    showcase_invoice_line: { allowRead: true, allowCreate: true, allowEdit: true, allowDelete: false },
  },
  rowLevelSecurity: [
    {
      name: 'invoice_own_rows_demo',
      label: 'Own Invoices Only (demo)',
      object: 'showcase_invoice',
      operation: 'select',
      using: 'owner = current_user.email',
      enabled: true,
      priority: 10,
    },
  ],
});

describe('showcase: seeded invoice/line owner isolation (ADR-0055 turnkey demo)', () => {
  let stack: VerifyStack;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let ql: any;
  let adaToken: string;
  let linusToken: string;
  let adaLineId: string;
  let linusLineId: string;

  const lineUnder = async (invoiceName: string) => {
    const inv = await ql.findOne('showcase_invoice', { where: { name: invoiceName }, context: { isSystem: true } });
    expect(inv, `seed invoice ${invoiceName} must exist`).toBeTruthy();
    const line = await ql.findOne('showcase_invoice_line', { where: { invoice: inv.id }, context: { isSystem: true } });
    expect(line, `seed line under ${invoiceName} must exist`).toBeTruthy();
    return { invoiceId: inv.id as string, lineId: line.id as string, owner: inv.owner as string };
  };

  beforeAll(async () => {
    stack = await bootStack(showcaseStack, {
      security: new SecurityPlugin({
        defaultPermissionSets: [...securityDefaultPermissionSets, demoSet],
        fallbackPermissionSet: 'showcase_cbp_demo',
      }),
    });
    await stack.signIn();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ql = await stack.kernel.getServiceAsync<any>('objectql');

    const ada = await lineUnder('INV-1001'); // owner ada@example.com
    const linus = await lineUnder('INV-1003'); // owner linus@example.com
    adaLineId = ada.lineId;
    linusLineId = linus.lineId;
    expect(ada.owner).toBe('ada@example.com');
    expect(linus.owner).toBe('linus@example.com');

    // Sign-ups whose EMAIL matches the seed owner -> `current_user.email` resolves.
    adaToken = await stack.signUp('ada@example.com', 'Member-Pass-123');
    linusToken = await stack.signUp('linus@example.com', 'Member-Pass-123');
  }, 60_000);

  afterAll(async () => {
    await stack?.stop();
  });

  it('seed loaded: 4 invoices with expected owners + their lines', async () => {
    const invoices = (await ql.find('showcase_invoice', { context: { isSystem: true } })) as Array<{ name: string; owner: string }>;
    const byName = Object.fromEntries(invoices.map((i) => [i.name, i.owner]));
    expect(byName['INV-1001']).toBe('ada@example.com');
    expect(byName['INV-1002']).toBe('ada@example.com');
    expect(byName['INV-1003']).toBe('linus@example.com');
    expect(byName['INV-1004']).toBe('grace@example.com');
    const lines = await ql.find('showcase_invoice_line', { context: { isSystem: true } });
    expect(lines.length).toBeGreaterThanOrEqual(5);
  });

  it('invoice RLS: a contributor lists only the invoices they own', async () => {
    const r = await stack.apiAs(adaToken, 'GET', '/data/showcase_invoice');
    expect(r.status).toBe(200);
    const body = (await r.json()) as any;
    const rows: Array<{ name: string }> = body.records ?? body.data ?? body;
    const names = rows.map((x) => x.name);
    expect(names).toContain('INV-1001');
    expect(names).toContain('INV-1002');
    expect(names).not.toContain('INV-1003'); // linus's
    expect(names).not.toContain('INV-1004'); // grace's
  });

  it('DERIVED: ada reads her own invoice line but not linus line', async () => {
    const own = await stack.apiAs(adaToken, 'GET', `/data/showcase_invoice_line/${adaLineId}`);
    expect(own.status, 'ada reads INV-1001 line').toBe(200);
    const foreign = await stack.apiAs(adaToken, 'GET', `/data/showcase_invoice_line/${linusLineId}`);
    expect(foreign.status, 'ada must not read INV-1003 line').not.toBe(200);
  });

  it('DERIVED: linus reads his own invoice line but not ada line', async () => {
    const own = await stack.apiAs(linusToken, 'GET', `/data/showcase_invoice_line/${linusLineId}`);
    expect(own.status, 'linus reads INV-1003 line').toBe(200);
    const foreign = await stack.apiAs(linusToken, 'GET', `/data/showcase_invoice_line/${adaLineId}`);
    expect(foreign.status, 'linus must not read INV-1001 line').not.toBe(200);
  });
});
