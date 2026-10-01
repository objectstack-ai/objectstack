// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// SHOWCASE turnkey-demo proof (ADR-0055), on the SHIPPED contributor set.
//
// The showcase SEEDS invoices owned by three addresses (ada/linus/grace) plus
// their lines. `showcase_contributor` scopes invoice SELECT to
// `owner == current_user.email` (`invoice_own_rows`) and refuses an UPDATE whose
// post-image moves the owner off the caller (`invoice_owner_immutable`,
// ADR-0058 D4). `showcase_invoice_line` is `controlled_by_parent`, so a line is
// read and written only through its master invoice.
//
// This boots the REAL showcase app with its own `isDefault` baseline and grants
// the app's OWN `showcase_contributor` — the row the security bootstrap seeds
// from `permission-sets.ts`, unmodified — through BOTH ways a member can hold a
// permission set (ADR-0090):
//
//   • DIRECT   — a `sys_user_permission_set` row, and no position;
//   • POSITION — a `sys_user_position` row for `contributor`, and no direct set
//                row: the set reaches the member through the position binding.
//
// Every isolation assertion below runs once per holder shape, because a set's
// row-level policies are part of what the set grants and so must hold for every
// holder of it; a pin that drives one shape cannot tell the two apart. The
// premise test proves each persona really holds the set by its route alone.
//
// Sign-ups use the seed owners' emails so `current_user.email` resolves and
// matches the seeded `owner` values.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import showcaseStack from '@objectstack/example-showcase';
import { bootStack, type VerifyStack } from '@objectstack/verify';
import { showcaseAppDefaultSecurity } from './showcase-security.js';

const SYS = { isSystem: true } as const;
const SET = 'showcase_contributor';
const POSITION = 'contributor';

interface Persona {
  /** How the persona holds `showcase_contributor`. */
  route: 'direct' | 'position';
  email: string;
  /** A seeded invoice owned by someone else — the by-id read target. */
  foreignInvoice: string;
  /** A seeded, unpaid invoice owned by someone else whose line is the PATCH target. */
  foreignLineInvoice: string;
  /** A seeded, unpaid invoice owned by someone else — the re-own target. */
  foreignUnpaidInvoice: string;
  /** A seeded, unpaid invoice this persona owns — the reassign target. */
  ownUnpaidInvoice: string;
}

// Line targets sit under UNPAID invoices on purpose: a paid invoice freezes its
// lines (`readonlyWhen: parent.status == 'paid'`), which would make an unchanged
// quantity prove nothing about access.
const PERSONAS: Persona[] = [
  {
    route: 'direct',
    email: 'ada@example.com',
    foreignInvoice: 'INV-1003', // linus's
    foreignLineInvoice: 'INV-1004', // grace's, draft
    foreignUnpaidInvoice: 'INV-1004', // grace's, draft
    ownUnpaidInvoice: 'INV-1002', // ada's, draft
  },
  {
    route: 'position',
    email: 'linus@example.com',
    foreignInvoice: 'INV-1002', // ada's
    foreignLineInvoice: 'INV-1001', // ada's, sent
    foreignUnpaidInvoice: 'INV-1010', // grace's, sent
    ownUnpaidInvoice: 'INV-1012', // linus's, sent
  },
];

const rowsOf = (b: any): any[] => b?.records ?? b?.data ?? (Array.isArray(b) ? b : []);
const idOf = (b: any) => b?.id ?? b?.record?.id ?? b?.data?.id;

describe('showcase: seeded invoice/line owner isolation on the shipped contributor set (ADR-0055)', () => {
  let stack: VerifyStack;
  let ql: any;
  const token = new Map<string, string>();
  const userId = new Map<string, string>();
  let setId: string;
  let positionId: string;

  const invoice = async (name: string) => {
    const inv = await ql.findOne('showcase_invoice', { where: { name }, context: SYS });
    expect(inv, `seed invoice ${name} must exist`).toBeTruthy();
    return inv as { id: string; owner: string; status: string };
  };
  const lineUnder = async (invoiceId: string) => {
    const line = await ql.findOne('showcase_invoice_line', { where: { invoice: invoiceId }, context: SYS });
    expect(line, `a seed line under invoice ${invoiceId} must exist`).toBeTruthy();
    return line as { id: string; quantity: number };
  };

  beforeAll(async () => {
    stack = await bootStack(showcaseStack, { security: showcaseAppDefaultSecurity() });
    await stack.signIn();
    ql = await stack.kernel.getServiceAsync<any>('objectql');

    const set = await ql.findOne('sys_permission_set', { where: { name: SET }, context: SYS });
    expect(set?.id, `the app's ${SET} set is seeded by the security bootstrap`).toBeTruthy();
    setId = set.id;
    const position = await ql.findOne('sys_position', { where: { name: POSITION }, context: SYS });
    expect(position?.id, `the app's ${POSITION} position is seeded`).toBeTruthy();
    positionId = position.id;

    // The position → set edge. The app writes it on `kernel:bootstrapped` from
    // its `onEnable` (bind-position-sets.ts); the verify harness boots the stack
    // object, which carries no `onEnable`, so the same idempotent write is made
    // here — the pair is exactly the app's `contributor → showcase_contributor`.
    const bound = await ql.findOne('sys_position_permission_set', {
      where: { position_id: positionId, permission_set_id: setId },
      context: SYS,
    });
    if (!bound) {
      await ql.insert(
        'sys_position_permission_set',
        { position_id: positionId, permission_set_id: setId },
        { context: SYS },
      );
    }

    for (const p of PERSONAS) {
      token.set(p.email, await stack.signUp(p.email, 'Member-Pass-123'));
      const uid = (await ql.findOne('sys_user', { where: { email: p.email }, context: SYS }))?.id;
      expect(uid, `persona ${p.email} provisioned`).toBeTruthy();
      userId.set(p.email, uid);
      if (p.route === 'direct') {
        await ql.insert('sys_user_permission_set', { user_id: uid, permission_set_id: setId }, { context: SYS });
      } else {
        await ql.insert('sys_user_position', { user_id: uid, position: POSITION }, { context: SYS });
      }
    }
  }, 120_000);

  afterAll(async () => {
    await stack?.stop();
  });

  it('seed loaded: invoices with the expected owners + their lines', async () => {
    const invoices = (await ql.find('showcase_invoice', { context: SYS })) as Array<{ name: string; owner: string }>;
    const byName = Object.fromEntries(invoices.map((i) => [i.name, i.owner]));
    expect(byName['INV-1001']).toBe('ada@example.com');
    expect(byName['INV-1002']).toBe('ada@example.com');
    expect(byName['INV-1003']).toBe('linus@example.com');
    expect(byName['INV-1004']).toBe('grace@example.com');
    const lines = await ql.find('showcase_invoice_line', { context: SYS });
    expect(lines.length).toBeGreaterThanOrEqual(5);
  });

  it('premise: each persona holds the shipped set through its route alone', async () => {
    for (const p of PERSONAS) {
      const uid = userId.get(p.email)!;
      const direct = (await ql.find('sys_user_permission_set', { where: { user_id: uid }, context: SYS })) ?? [];
      const positions = (await ql.find('sys_user_position', { where: { user_id: uid }, context: SYS })) ?? [];
      if (p.route === 'direct') {
        expect(direct.map((r: any) => r.permission_set_id), `${p.email}: one direct grant, the set`).toEqual([setId]);
        expect(positions, `${p.email}: holds no position row`).toHaveLength(0);
      } else {
        expect(direct, `${p.email}: holds no direct set row`).toHaveLength(0);
        expect(positions.map((r: any) => r.position), `${p.email}: holds the position`).toEqual([POSITION]);
      }

      // Both resolve the set, and the explain surface reports row-level
      // narrowing on the invoice for both.
      const r = await stack.apiAs(token.get(p.email)!, 'GET', '/security/explain?object=showcase_invoice&operation=read');
      expect(r.status, `${p.email}: explain answers`).toBe(200);
      const body = (await r.json()) as any;
      expect(body?.principal?.permissionSets, `${p.email} (${p.route}) resolves the set`).toContain(SET);
      if (p.route === 'position') expect(body?.principal?.positions).toContain(POSITION);
      else expect(body?.principal?.positions ?? []).not.toContain(POSITION);
      const rls = (body?.layers ?? []).find((l: any) => l.layer === 'rls');
      expect(rls?.verdict, `${p.email} (${p.route}): the rls layer narrows`).toBe('narrows');
    }
  });

  for (const p of PERSONAS) {
    describe(`${p.route} holder (${p.email})`, () => {
      const tok = () => token.get(p.email)!;

      it('lists exactly the invoices they own', async () => {
        const all = (await ql.find('showcase_invoice', { context: SYS })) as Array<{ name: string; owner: string }>;
        const owned = all.filter((i) => i.owner === p.email).map((i) => i.name).sort();
        expect(owned.length, 'the persona owns seeded invoices').toBeGreaterThan(0);
        expect(owned.length, 'and others own the rest').toBeLessThan(all.length);

        const r = await stack.apiAs(tok(), 'GET', '/data/showcase_invoice');
        expect(r.status).toBe(200);
        const names = rowsOf(await r.json()).map((x: any) => x.name).sort();
        expect(names).toEqual(owned);
      });

      it('reads its own line by id; a foreign invoice and its line answer 404', async () => {
        const own = await invoice(p.ownUnpaidInvoice);
        const ownInvoice = await stack.apiAs(tok(), 'GET', `/data/showcase_invoice/${own.id}`);
        expect(ownInvoice.status, 'own invoice by id').toBe(200);

        const foreign = await invoice(p.foreignInvoice);
        expect(foreign.owner).not.toBe(p.email);
        const foreignLine = await lineUnder(foreign.id);

        const inv = await stack.apiAs(tok(), 'GET', `/data/showcase_invoice/${foreign.id}`);
        expect(inv.status, `${p.foreignInvoice} by id`).toBe(404);
        expect(((await inv.json()) as any)?.code).toBe('RECORD_NOT_FOUND');

        const line = await stack.apiAs(tok(), 'GET', `/data/showcase_invoice_line/${foreignLine.id}`);
        expect(line.status, `${p.foreignInvoice} line by id`).toBe(404);
        expect(((await line.json()) as any)?.code).toBe('RECORD_NOT_FOUND');
      });

      it('edits a line under its own invoice; a foreign line PATCH is refused and changes nothing', async () => {
        // Allow half: a line the persona adds under an invoice it owns is
        // writable, so the refusal below is a record-level verdict, not a
        // missing object grant.
        const own = await invoice(p.ownUnpaidInvoice);
        const product = await ql.findOne('showcase_product', { where: { sku: 'WIDGET-A' }, context: SYS });
        expect(product?.id, 'seed product WIDGET-A must exist').toBeTruthy();
        const created = await stack.apiAs(tok(), 'POST', '/data/showcase_invoice_line', {
          invoice: own.id,
          product: product.id,
          quantity: 1,
          description: `isolation-${p.route}`,
        });
        expect(created.status, 'line under an owned invoice').toBeLessThan(300);
        const ownLineId = String(idOf(await created.json()));
        const ownPatch = await stack.apiAs(tok(), 'PATCH', `/data/showcase_invoice_line/${ownLineId}`, { quantity: 2 });
        expect(ownPatch.status, 'own line PATCH').toBeLessThan(300);
        expect((await ql.findOne('showcase_invoice_line', { where: { id: ownLineId }, context: SYS }))?.quantity).toBe(2);

        const foreign = await invoice(p.foreignLineInvoice);
        expect(foreign.owner).not.toBe(p.email);
        expect(foreign.status).not.toBe('paid');
        const target = await lineUnder(foreign.id);
        const r = await stack.apiAs(tok(), 'PATCH', `/data/showcase_invoice_line/${target.id}`, { quantity: 9 });
        expect(r.status, 'foreign line PATCH').toBe(403);
        expect(((await r.json()) as any)?.code).toBe('PERMISSION_DENIED');
        const after = await ql.findOne('showcase_invoice_line', { where: { id: target.id }, context: SYS });
        expect(after?.quantity, 'the foreign line is unchanged').toBe(target.quantity);
      });

      it('cannot re-own a foreign invoice to itself', async () => {
        const foreign = await invoice(p.foreignUnpaidInvoice);
        const r = await stack.apiAs(tok(), 'PATCH', `/data/showcase_invoice/${foreign.id}`, { owner: p.email });
        expect(r.status).toBe(403);
        expect(((await r.json()) as any)?.code).toBe('PERMISSION_DENIED');
        expect((await invoice(p.foreignUnpaidInvoice)).owner, 'owner unchanged').toBe(foreign.owner);
      });

      it('cannot reassign an invoice it owns to someone else (write-time check)', async () => {
        const own = await invoice(p.ownUnpaidInvoice);
        expect(own.owner).toBe(p.email);
        const r = await stack.apiAs(tok(), 'PATCH', `/data/showcase_invoice/${own.id}`, { owner: 'grace@example.com' });
        expect(r.status).toBe(403);
        expect(((await r.json()) as any)?.code).toBe('PERMISSION_DENIED');
        expect((await invoice(p.ownUnpaidInvoice)).owner, 'owner unchanged').toBe(p.email);
      });
    });
  }
});
