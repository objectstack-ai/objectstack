// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * A PAID invoice's lines are locked: a line cannot be added to it, removed
 * from it, or moved onto or off it, and its `total` does not move.
 *
 * `readonlyWhen: parent.status == 'paid'` on the line's `product`, `quantity`
 * and `unit_price` locks EDITS of a line (#4889). It is insert-exempt by
 * design and judges field values, so measured on a booted showcase a new line
 * under the paid INV-1003 answered `201`, a delete of its line `200`, and a
 * repoint of a line onto or off it `200`, and the paid `total` moved every
 * time. The three guards that close those doors are the app's own hooks
 * (`src/data/hooks/index.ts`); this file pins them on the production harness
 * `task-reopen-hook-refusal.test.ts` uses: real `ObjectQL`, real `SqlDriver`
 * (better-sqlite3), real `QuickJSScriptRunner` behind `hookBodyRunnerFactory`,
 * and the app's real objects and hooks.
 *
 * Every refusal is read twice: the error is the hook's business refusal (a
 * `SandboxError` whose `innerMessage` is the sentence, which the `/data` door
 * serves as `400` with that sentence), and the store is unchanged — the line
 * count and the invoice's rolled-up `total`. The draft control proves the
 * guards are about the header's status, not about lines in general.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { QuickJSScriptRunner, SandboxError, hookBodyRunnerFactory } from '@objectstack/runtime';

import { Account, Product, Invoice, InvoiceLine } from '../src/data/objects/index.js';
import {
  allHooks,
  PAID_INVOICE_LINE_ADD_REFUSAL,
  PAID_INVOICE_LINE_REMOVE_REFUSAL,
  PAID_INVOICE_LINE_MOVE_REFUSAL,
} from '../src/data/hooks/index.js';

const APP_ID = 'com.objectstack.showcase';
const PACKAGE_ID = `app:${APP_ID}`;

const openEngines: ObjectQL[] = [];
afterEach(async () => {
  while (openEngines.length) {
    try { await openEngines.pop()?.destroy(); } catch { /* noop */ }
  }
});

async function bootShowcase(hooks: unknown[] = allHooks): Promise<ObjectQL> {
  const driver = new SqlDriver({
    client: 'better-sqlite3',
    connection: { filename: ':memory:' },
    useNullAsDefault: true,
  });
  await driver.connect();

  const engine = new ObjectQL();
  openEngines.push(engine);
  engine.registerDriver(driver as never, true);
  await engine.init();
  for (const def of [Account, Product, Invoice, InvoiceLine]) {
    engine.registry.registerObject(def as never, PACKAGE_ID, 'showcase');
  }
  await engine.syncSchemas();
  engine.bindHooks(hooks as never[], {
    packageId: PACKAGE_ID,
    bodyRunner: hookBodyRunnerFactory(new QuickJSScriptRunner(), { ql: engine, appId: APP_ID }),
  });
  return engine;
}

/** The fixture loader's identity: a system write, which every guard lets through (the seed's own case). */
const SYSTEM = { context: { userId: 'u_seed', isSystem: true } };
/** An ordinary user's write: the identity the guards judge. */
const USER = { context: { userId: 'u_showcase' } };

interface Fixture {
  engine: ObjectQL;
  paid: string;
  draft: string;
  product: string;
  paidLine: string;
  draftLine: string;
}

/**
 * One paid and one draft invoice, each with one line. Lines go in while the
 * paid header is still a draft, then the header is marked paid, the order a
 * real invoice takes — every fixture write is a system write.
 */
async function invoicesWithLines(hooks?: unknown[]): Promise<Fixture> {
  const engine = await bootShowcase(hooks);
  const account: any = await engine.insert('showcase_account', { name: 'Contoso', status: 'active' }, SYSTEM as never);
  const product: any = await engine.insert('showcase_product', { name: 'Widget B', unit_price: 49.99 }, SYSTEM as never);
  const header = async (name: string) =>
    String(((await engine.insert('showcase_invoice', { name, account: String(account.id), status: 'draft' }, SYSTEM as never)) as any).id);
  const paid = await header('INV-1003');
  const draft = await header('INV-1004');
  const line = async (invoice: string) =>
    String(((await engine.insert(
      'showcase_invoice_line',
      { invoice, product: String(product.id), quantity: 6, unit_price: 49.99, amount: 299.94 },
      SYSTEM as never,
    )) as any).id);
  const paidLine = await line(paid);
  const draftLine = await line(draft);
  await engine.update(
    'showcase_invoice',
    { id: paid, status: 'paid', issued_on: '2026-09-20', paid_on: '2026-10-18' },
    SYSTEM as never,
  );
  return { engine, paid, draft, product: String(product.id), paidLine, draftLine };
}

/** What a header holds: its status, its rolled-up `total`, and how many lines hang off it. */
async function headerState(engine: ObjectQL, invoice: string) {
  const row: any = (await engine.find('showcase_invoice', { where: { id: invoice } }, SYSTEM as never))[0];
  const lines = await engine.find('showcase_invoice_line', { where: { invoice } }, SYSTEM as never);
  return { status: row?.status, total: Number(row?.total), lines: lines.length };
}

/** Run a write and hand back what it threw (null if it resolved). */
const refusalOf = (write: Promise<unknown>) => write.then(() => null, (e: unknown) => e);

/** The hook's business refusal: the sentence rides `innerMessage`, the field the `/data` door serves. */
function expectBusinessRefusal(err: unknown, sentence: string): void {
  expect(err, 'expected the write to be refused, but it resolved').not.toBeNull();
  expect(err).toBeInstanceOf(SandboxError);
  expect((err as SandboxError).innerMessage).toBe(sentence);
}

const newLine = (f: Fixture, invoice: string) => ({
  invoice, product: f.product, quantity: 2, unit_price: 10, amount: 20,
});

describe('a paid invoice\'s lines are locked against adding, removing and moving', () => {
  it('the fixture rolls the lines up: each header totals its one line', async () => {
    const f = await invoicesWithLines();
    expect(await headerState(f.engine, f.paid)).toEqual({ status: 'paid', total: 299.94, lines: 1 });
    expect(await headerState(f.engine, f.draft)).toEqual({ status: 'draft', total: 299.94, lines: 1 });
  }, 30000);

  it('a new line under a paid header is refused, and the total does not move', async () => {
    const f = await invoicesWithLines();
    const err = await refusalOf(f.engine.insert('showcase_invoice_line', newLine(f, f.paid), USER as never));
    expectBusinessRefusal(err, PAID_INVOICE_LINE_ADD_REFUSAL);
    expect(await headerState(f.engine, f.paid)).toEqual({ status: 'paid', total: 299.94, lines: 1 });
  }, 30000);

  it('removing a line from a paid header is refused, and the total does not move', async () => {
    const f = await invoicesWithLines();
    const err = await refusalOf(f.engine.delete('showcase_invoice_line', { where: { id: f.paidLine }, context: USER.context } as never));
    expectBusinessRefusal(err, PAID_INVOICE_LINE_REMOVE_REFUSAL);
    expect(await headerState(f.engine, f.paid)).toEqual({ status: 'paid', total: 299.94, lines: 1 });
  }, 30000);

  it('a bulk delete reaching a paid header\'s line is refused too', async () => {
    // The predicate path dispatches `beforeDelete` per row with its pre-image,
    // so the guard is not a by-id-only door.
    const f = await invoicesWithLines();
    const err = await refusalOf(
      f.engine.delete('showcase_invoice_line', { where: { invoice: f.paid }, multi: true, context: USER.context } as never),
    );
    expectBusinessRefusal(err, PAID_INVOICE_LINE_REMOVE_REFUSAL);
    expect(await headerState(f.engine, f.paid)).toEqual({ status: 'paid', total: 299.94, lines: 1 });
  }, 30000);

  it('moving a line ONTO a paid header is refused; both totals stay', async () => {
    const f = await invoicesWithLines();
    const err = await refusalOf(f.engine.update('showcase_invoice_line', { id: f.draftLine, invoice: f.paid }, USER as never));
    expectBusinessRefusal(err, PAID_INVOICE_LINE_MOVE_REFUSAL);
    expect(await headerState(f.engine, f.paid)).toEqual({ status: 'paid', total: 299.94, lines: 1 });
    expect(await headerState(f.engine, f.draft)).toEqual({ status: 'draft', total: 299.94, lines: 1 });
  }, 30000);

  it('moving a line OFF a paid header is refused; both totals stay', async () => {
    const f = await invoicesWithLines();
    const err = await refusalOf(f.engine.update('showcase_invoice_line', { id: f.paidLine, invoice: f.draft }, USER as never));
    expectBusinessRefusal(err, PAID_INVOICE_LINE_MOVE_REFUSAL);
    expect(await headerState(f.engine, f.paid)).toEqual({ status: 'paid', total: 299.94, lines: 1 });
    expect(await headerState(f.engine, f.draft)).toEqual({ status: 'draft', total: 299.94, lines: 1 });
  }, 30000);

  it('deleting the paid header itself still cascades its lines (the cascade is not a line removal)', async () => {
    const f = await invoicesWithLines();
    await f.engine.delete('showcase_invoice', { where: { id: f.paid }, context: USER.context } as never);
    const lines = await f.engine.find('showcase_invoice_line', { where: { invoice: f.paid } }, SYSTEM as never);
    expect(lines).toHaveLength(0);
  }, 30000);
});

describe('the draft control: a draft header\'s lines add, edit, move and remove as before', () => {
  it('a new line under a draft header lands and rolls up', async () => {
    const f = await invoicesWithLines();
    await f.engine.insert('showcase_invoice_line', newLine(f, f.draft), USER as never);
    expect(await headerState(f.engine, f.draft)).toEqual({ status: 'draft', total: 319.94, lines: 2 });
  }, 30000);

  it('removing a line from a draft header lands and rolls up', async () => {
    const f = await invoicesWithLines();
    await f.engine.delete('showcase_invoice_line', { where: { id: f.draftLine }, context: USER.context } as never);
    expect(await headerState(f.engine, f.draft)).toEqual({ status: 'draft', total: 0, lines: 0 });
  }, 30000);

  it('moving a line between two draft headers lands', async () => {
    const f = await invoicesWithLines();
    const other = String(((await f.engine.insert(
      'showcase_invoice',
      { name: 'INV-1002', account: String(((await f.engine.find('showcase_account', {}, SYSTEM as never))[0] as any).id), status: 'draft' },
      SYSTEM as never,
    )) as any).id);
    await f.engine.update('showcase_invoice_line', { id: f.draftLine, invoice: other }, USER as never);
    expect((await headerState(f.engine, other)).lines).toBe(1);
    expect((await headerState(f.engine, f.draft)).lines).toBe(0);
  }, 30000);

  it('an edit of a line under a draft header that leaves `invoice` alone lands', async () => {
    const f = await invoicesWithLines();
    await f.engine.update('showcase_invoice_line', { id: f.draftLine, description: 'Widget B units' }, USER as never);
    const row: any = (await f.engine.find('showcase_invoice_line', { where: { id: f.draftLine } }, SYSTEM as never))[0];
    expect(row.description).toBe('Widget B units');
  }, 30000);
});

describe('REVERSE: with the hooks unbound the same writes land — the lock is the hooks', () => {
  it('a line is added to, moved onto and removed from a paid header, and its total moves', async () => {
    const f = await invoicesWithLines([]);
    await f.engine.insert('showcase_invoice_line', newLine(f, f.paid), USER as never);
    expect(await headerState(f.engine, f.paid)).toEqual({ status: 'paid', total: 319.94, lines: 2 });
    await f.engine.update('showcase_invoice_line', { id: f.draftLine, invoice: f.paid }, USER as never);
    expect((await headerState(f.engine, f.paid)).lines).toBe(3);
    await f.engine.delete('showcase_invoice_line', { where: { id: f.paidLine }, context: USER.context } as never);
    expect((await headerState(f.engine, f.paid)).lines).toBe(2);
  }, 30000);
});
