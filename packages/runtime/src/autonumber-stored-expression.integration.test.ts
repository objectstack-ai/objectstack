// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #25073 — over a real SQLite database: a stored field whose `expression`
 * reads an `autonumber` is stored computed WITH the number, in the one INSERT.
 *
 * `SqlDriver` owns its record-number counter (`supports.autonumber`), and
 * used to issue the number inside `create()` / `bulkCreate()` — after the
 * engine had computed every stored field. Measured at the base on this very
 * setup (#25073's probe):
 *
 * | insert | stored `display_title` | stored `title` (`has()`) |
 * |:--|:--|:--|
 * | before | `null` | `"Probe product"` (the fallback) |
 * | after  | `"CASE-00001 - one"` | `"PRD-0001 Probe product"` |
 *
 * The engine now asks the driver for the number through
 * `IDataDriver.issueAutonumbers` after validation, computes the readers
 * again, and hands the row to the write, so the stored row is the declared
 * expression over itself the moment it lands, and `afterInsert` sees it. An
 * object no stored expression reads a number on keeps the driver's own
 * issue-at-write path. A collision on an issued number is re-seeded by the
 * member and re-issued by the engine's one retry loop, which computes the
 * readers again.
 *
 * The engine's half over hand-rolled drivers (both issuers) is
 * `packages/objectql/src/engine-autonumber-stored-expression.test.ts`; the
 * member's own half is driver-sql's
 * `sql-driver-autonumber-issue-ahead.test.ts`.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';

const CASE = {
  name: 'ncase',
  fields: {
    subject: { type: 'text' },
    case_number: { type: 'autonumber', format: 'CASE-{00000}', unique: true },
    display_title: { type: 'text', expression: 'record.case_number + " - " + record.subject' },
    headline: { type: 'text', expression: 'record.display_title + "!"' },
    plain_title: { type: 'text', expression: '"S:" + record.subject' },
    must: { type: 'text', required: true },
  },
} as any;

const PRODUCT = {
  name: 'nproduct',
  fields: {
    name: { type: 'text' },
    product_code: { type: 'autonumber', format: 'PRD-{0000}' },
    title: { type: 'text', expression: 'has(record.product_code) ? record.product_code + " " + record.name : record.name' },
  },
} as any;

/** Control: an autonumber that no stored expression reads. */
const NOTE = {
  name: 'nnote',
  fields: {
    name: { type: 'text' },
    code: { type: 'autonumber', format: 'N-{000}' },
    summary: { type: 'text', expression: '"N:" + record.name' },
  },
} as any;

const SYSTEM = { context: { isSystem: true } } as any;

const open: SqlDriver[] = [];
afterEach(async () => {
  while (open.length) await open.pop()!.disconnect().catch(() => {});
});

async function boot() {
  const driver = new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true });
  open.push(driver);
  const engine = new ObjectQL();
  engine.registerDriver(driver as any, true);
  await engine.init();
  for (const schema of [CASE, PRODUCT, NOTE]) engine.registry.registerObject(schema, 'probe');
  await driver.initObjects([CASE, PRODUCT, NOTE]);
  const knex = (driver as any).knex;
  const rows = async (table: string) => (await knex(table).select('*').orderBy('case_number')) as any[];
  const lastValue = async (object: string) =>
    Number(((await knex('_objectstack_sequences').where({ object }).select('last_value')) as any[])[0]?.last_value);
  return {
    engine,
    driver,
    knex,
    rows,
    lastValue,
    issue: vi.spyOn(driver, 'issueAutonumbers'),
    create: vi.spyOn(driver, 'create'),
    bulkCreate: vi.spyOn(driver, 'bulkCreate'),
  };
}

describe('[#25073] SQLite: a stored expression reading the record number', () => {
  it('single insert: the stored row carries the number in its readers, written once, one number drawn', async () => {
    const { engine, rows, lastValue, issue, create } = await boot();
    const one: any = await engine.insert('ncase', { subject: 'one', must: 'x' }, SYSTEM);
    expect(one).toMatchObject({ case_number: 'CASE-00001', display_title: 'CASE-00001 - one', headline: 'CASE-00001 - one!' });
    expect(await rows('ncase')).toMatchObject([
      { case_number: 'CASE-00001', display_title: 'CASE-00001 - one', headline: 'CASE-00001 - one!', plain_title: 'S:one' },
    ]);
    expect(create).toHaveBeenCalledTimes(1);
    expect(issue).toHaveBeenCalledTimes(1);
    expect(await lastValue('ncase')).toBe(1);
  });

  it('batch insert: each row its own number, one bulkCreate', async () => {
    const { engine, rows, bulkCreate } = await boot();
    await engine.insert('ncase', [{ subject: 'b1', must: 'x' }, { subject: 'b2', must: 'x' }], SYSTEM);
    expect((await rows('ncase')).map((r) => r.display_title)).toEqual(['CASE-00001 - b1', 'CASE-00002 - b2']);
    expect(bulkCreate).toHaveBeenCalledTimes(1);
  });

  it('partial mode: a rejected row draws no number', async () => {
    const { engine, rows, lastValue } = await boot();
    const outcomes: any[] = await engine.insertMany(
      'ncase',
      [{ subject: 'p1', must: 'x' }, { subject: 'dead' }, { subject: 'p3', must: 'x' }],
      SYSTEM,
    );
    expect(outcomes.map((o) => o.ok)).toEqual([true, false, true]);
    expect((await rows('ncase')).map((r) => r.display_title)).toEqual(['CASE-00001 - p1', 'CASE-00002 - p3']);
    expect(await lastValue('ncase')).toBe(2);
  });

  it('the has() shape takes the branch that sees the number', async () => {
    const { engine, knex } = await boot();
    const product: any = await engine.insert('nproduct', { name: 'Probe product' }, SYSTEM);
    expect(product.title).toBe('PRD-0001 Probe product');
    expect((await knex('nproduct').select('title'))[0].title).toBe('PRD-0001 Probe product');
  });

  it('a forced collision re-issues past the store and computes the readers from the new number', async () => {
    const { engine, knex, rows } = await boot();
    await engine.insert('ncase', { subject: 'seed', must: 'x' }, SYSTEM);
    await knex('ncase').insert({ id: 'oob', subject: 'oob', must: 'x', case_number: 'CASE-00002' });
    const collided: any = await engine.insert('ncase', { subject: 'collide', must: 'x' }, SYSTEM);
    expect(collided).toMatchObject({ case_number: 'CASE-00003', display_title: 'CASE-00003 - collide' });
    expect((await rows('ncase')).find((r) => r.subject === 'collide')).toMatchObject({
      case_number: 'CASE-00003', display_title: 'CASE-00003 - collide', headline: 'CASE-00003 - collide!',
    });
  });

  it('a batch collision lands nothing, re-seeds the counter, and the next insert is past the store', async () => {
    const { engine, knex, rows } = await boot();
    await engine.insert('ncase', { subject: 'seed', must: 'x' }, SYSTEM);
    await knex('ncase').insert({ id: 'oob', subject: 'oob', must: 'x', case_number: 'CASE-00005' });
    // Issued 2 and 3: no collision. Push the store past them so the batch collides.
    await knex('ncase').insert({ id: 'oob2', subject: 'oob2', must: 'x', case_number: 'CASE-00003' });
    const error: any = await engine
      .insert('ncase', [{ subject: 'b1', must: 'x' }, { subject: 'b2', must: 'x' }], SYSTEM)
      .then(() => null, (e) => e);
    expect(error?.code).toBe('DUPLICATE_RECORD');
    expect((await rows('ncase')).map((r) => r.case_number)).toEqual(['CASE-00001', 'CASE-00003', 'CASE-00005']);
    const next: any = await engine.insert('ncase', { subject: 'next', must: 'x' }, SYSTEM);
    expect(next).toMatchObject({ case_number: 'CASE-00006', display_title: 'CASE-00006 - next' });
  });

  it('afterInsert sees the stored value', async () => {
    const { engine } = await boot();
    const seen: unknown[] = [];
    engine.registerHook('afterInsert', async (ctx: any) => { seen.push(ctx.result?.display_title); }, { object: 'ncase' });
    await engine.insert('ncase', { subject: 'hooked', must: 'x' }, SYSTEM);
    expect(seen).toEqual(['CASE-00001 - hooked']);
  });

  it('inside a caller transaction: the number and its readers commit together', async () => {
    const { engine, rows } = await boot();
    await engine.transaction(async (ctx: any) => engine.insert('ncase', { subject: 'unit', must: 'x' }, { context: ctx } as any));
    expect(await rows('ncase')).toMatchObject([{ case_number: 'CASE-00001', display_title: 'CASE-00001 - unit' }]);
  });

  describe('controls', () => {
    it('an object no stored expression reads a number on keeps the driver\'s issue-at-write', async () => {
      const { engine, knex, issue } = await boot();
      const note: any = await engine.insert('nnote', { name: 'n' }, SYSTEM);
      expect(note).toMatchObject({ code: 'N-001', summary: 'N:n' });
      expect(issue).not.toHaveBeenCalled();
      expect((await knex('nnote').select('code', 'summary'))[0]).toEqual({ code: 'N-001', summary: 'N:n' });
    });

    it('an update by id computes the reader from the stored number', async () => {
      const { engine, rows } = await boot();
      const one: any = await engine.insert('ncase', { subject: 'one', must: 'x' }, SYSTEM);
      const updated: any = await engine.update('ncase', { id: one.id, subject: 'renamed' }, SYSTEM);
      expect(updated.display_title).toBe('CASE-00001 - renamed');
      expect((await rows('ncase'))[0].display_title).toBe('CASE-00001 - renamed');
    });
  });
});
