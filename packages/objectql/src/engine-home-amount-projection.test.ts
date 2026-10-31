// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [ADR-0144 D5] The write-time home projection through the engine's write
// seams, on the in-memory face: a driver double whose `find` is the engine's
// own in-memory reading of a driver query (`applyDriverQueryInMemory`: where,
// orderBy, limit, fields), so the rate row the projection picks is chosen by
// the same `effective_date <= date ORDER BY effective_date DESC LIMIT 1` a
// SQL driver runs. ⛔ No driver-memory arm: its test consumers are a closed
// census (`check:driver-memory-census`). The same pins on SQLite and Postgres
// are packages/qa/dogfood's `test/home-amount-projection.test.ts`.
//
// Pinned here, per seam (insert, insertMany, by-id update, predicate update,
// the validate() preview):
//
//  - the stored home amount is amount ÷ rate, rounded to the home minor units,
//    stored with the rate used; the same currency as home is rate 1, read-free;
//  - a missing rate refuses ERR_EXCHANGE_RATE_MISSING and an unset home
//    currency ERR_HOME_CURRENCY_UNSET, and nothing is written;
//  - the two projected fields: a caller's value is stripped (`readonly`) and
//    recomputed over, a system or `preserveAudit` writer's value is recomputed
//    over, a `defaultValue` never stands, a rate field `scale` below the
//    rate's decimals refuses `max_scale` (never rounded);
//  - an update projects when it moves the amount, its code or its document
//    date, and never otherwise (a corrected rate reaches stored rows only
//    through a recompute).

import { describe, it, expect, beforeEach } from 'vitest';
import type { EngineUpdateOptions } from '@objectstack/spec/data';
import { ObjectQL } from './engine.js';
import { applyDriverQueryInMemory } from './driver-query-in-memory.js';

function makeDriver() {
  const stores = new Map<string, Map<string, Record<string, unknown>>>();
  const storeFor = (o: string) => {
    let s = stores.get(o);
    if (!s) { s = new Map(); stores.set(o, s); }
    return s;
  };
  const finds: Record<string, number> = {};
  let n = 0;
  const select = (object: string, ast: any) =>
    applyDriverQueryInMemory(Array.from(storeFor(object).values()), {
      where: ast?.where, orderBy: ast?.orderBy, limit: ast?.limit, offset: ast?.offset,
    });
  const driver: any = {
    name: 'memory', version: '0.0.0', supports: {},
    async connect() {}, async disconnect() {}, async checkHealth() { return true; }, async execute() { return null; },
    async find(object: string, ast: any) {
      finds[object] = (finds[object] ?? 0) + 1;
      return select(object, ast).map((r) => ({ ...r }));
    },
    async findOne(object: string, ast: any) {
      const [hit] = select(object, { ...ast, limit: 1 });
      return hit ? { ...hit } : null;
    },
    async create(object: string, data: Record<string, unknown>) {
      n += 1;
      const id = (data.id as string) ?? `r_${n}`;
      const row = { ...data, id };
      storeFor(object).set(id, row);
      return { ...row };
    },
    async update(object: string, id: string, data: Record<string, unknown>) {
      const s = storeFor(object);
      const row = { ...s.get(id), ...data, id };
      s.set(id, row);
      return { ...row };
    },
    async updateMany(object: string, ast: any, data: Record<string, unknown>) {
      const s = storeFor(object);
      const hits = select(object, ast);
      for (const r of hits) s.set(r.id as string, { ...s.get(r.id as string), ...data });
      return hits.length;
    },
    async delete(object: string, id: string) { return storeFor(object).delete(id); },
    async deleteMany() { return 0; },
    async count(object: string, ast: any) { return select(object, ast).length; },
    async bulkCreate(object: string, rows: Record<string, unknown>[]) {
      return Promise.all(rows.map((r) => this.create(object, r)));
    },
    async bulkUpdate() { return []; }, async bulkDelete() {},
    async beginTransaction() { return { commit: async () => {}, rollback: async () => {} }; },
    async commit() {}, async rollback() {},
  };
  return { driver, storeFor, finds };
}

/** The rate table's shape (`sys_exchange_rate`, owned by platform-objects; a stand-in here). */
const RATE_OBJECT = {
  name: 'sys_exchange_rate',
  fields: {
    currency: { type: 'text', valueDomain: 'iso_4217_currency' },
    rate: { type: 'number', scale: 12, precision: 24 },
    effective_date: { type: 'date' },
  },
};

const HOME_AMOUNT = { field: 'amount_home', rateDate: 'invoice_date', rateField: 'amount_rate' };
const invoice = (over: { home?: Record<string, unknown>; rate?: Record<string, unknown> } = {}) => ({
  name: 'fx_invoice',
  fields: {
    title: { type: 'text' },
    currency_code: { type: 'text', valueDomain: 'iso_4217_currency' },
    invoice_date: { type: 'date' },
    amount: { type: 'currency', currencyConfig: { currencyMode: 'record', currencyField: 'currency_code', homeAmount: HOME_AMOUNT } },
    amount_home: { type: 'currency', readonly: true, ...over.home },
    amount_rate: { type: 'number', readonly: true, ...over.rate },
  },
});

type Thrown = (Error & { code?: string; status?: number; field?: string; fields?: Array<{ field: string; code: string }> }) | null;
const refusalOf = async (p: Promise<unknown>): Promise<Thrown> => p.then(() => null, (e) => e as Thrown);

const SYS = { context: { isSystem: true } } as const;
const BATCH: EngineUpdateOptions = { where: { title: 'batch' }, multi: true };

async function boot(object = invoice(), home: string | undefined = 'CNY') {
  const engine = new ObjectQL();
  const d = makeDriver();
  engine.registerDriver(d.driver, true);
  await engine.init();
  engine.registry.registerObject(RATE_OBJECT as any);
  engine.registry.registerObject(object as any);
  if (home !== undefined) engine.setHomeCurrencyResolver(async () => home);
  const rate = (currency: string, effective_date: string, value: number) =>
    d.storeFor('sys_exchange_rate').set(`${currency}_${effective_date}`, { id: `${currency}_${effective_date}`, currency, effective_date, rate: value });
  return { engine, ...d, rate };
}

describe('insert: the home amount is the amount divided by the rate in force on the document date', () => {
  let t: Awaited<ReturnType<typeof boot>>;
  beforeEach(async () => {
    t = await boot();
    t.rate('USD', '2026-01-01', 0.1389);
    t.rate('USD', '2026-04-01', 0.15);
    t.rate('EUR', '2026-01-01', 0.128);
  });

  it('USD 10,000 at 0.1389 into CNY stores ¥71,994.24 and the rate 0.1389', async () => {
    const row = await t.engine.insert('fx_invoice', { title: 'i1', currency_code: 'USD', invoice_date: '2026-03-15', amount: 10000 });
    expect(t.storeFor('fx_invoice').get(row.id)).toMatchObject({ amount_home: 71994.24, amount_rate: 0.1389 });
    expect(row).toMatchObject({ amount_home: 71994.24, amount_rate: 0.1389 });
  });

  it('a batch converts each row at its own currency and date, reading each (currency, date) rate once', async () => {
    const before = t.finds.sys_exchange_rate ?? 0;
    await t.engine.insert('fx_invoice', [
      { title: 'a', currency_code: 'USD', invoice_date: '2026-03-15', amount: 100 },
      { title: 'b', currency_code: 'USD', invoice_date: '2026-03-15', amount: 200 },
      { title: 'c', currency_code: 'USD', invoice_date: '2026-04-02', amount: 150 },
      { title: 'd', currency_code: 'EUR', invoice_date: '2026-03-15', amount: 64 },
    ]);
    const byTitle = Object.fromEntries([...t.storeFor('fx_invoice').values()].map((r) => [r.title, [r.amount_home, r.amount_rate]]));
    expect(byTitle).toEqual({ a: [719.94, 0.1389], b: [1439.88, 0.1389], c: [1000, 0.15], d: [500, 0.128] });
    expect((t.finds.sys_exchange_rate ?? 0) - before).toBe(3);
  });

  it('the same currency as home is rate 1 and reads no rate', async () => {
    const before = t.finds.sys_exchange_rate ?? 0;
    const row = await t.engine.insert('fx_invoice', { title: 'i1', currency_code: 'CNY', amount: 12.345 });
    expect(t.storeFor('fx_invoice').get(row.id)).toMatchObject({ amount_home: 12.35, amount_rate: 1 });
    expect(t.finds.sys_exchange_rate ?? 0).toBe(before);
  });

  it('a blank amount stores a blank home amount and rate', async () => {
    const row = await t.engine.insert('fx_invoice', { title: 'i1', currency_code: 'USD', invoice_date: '2026-03-15' });
    expect(t.storeFor('fx_invoice').get(row.id)).toMatchObject({ amount_home: null, amount_rate: null });
  });

  it('no rate on or before the document date refuses ERR_EXCHANGE_RATE_MISSING, and nothing is written', async () => {
    const err = await refusalOf(t.engine.insert('fx_invoice', { title: 'i1', currency_code: 'USD', invoice_date: '2025-12-31', amount: 1 }));
    expect({ code: err?.code, status: err?.status, field: err?.field }).toEqual({ code: 'ERR_EXCHANGE_RATE_MISSING', status: 400, field: 'amount' });
    expect(err?.message).toContain('no exchange rate for USD has an effective date on or before 2025-12-31');
    const noRow = await refusalOf(t.engine.insert('fx_invoice', { title: 'i2', currency_code: 'JPY', invoice_date: '2026-03-15', amount: 1 }));
    expect(noRow?.code).toBe('ERR_EXCHANGE_RATE_MISSING');
    expect(t.storeFor('fx_invoice').size).toBe(0);
  });

  it('a foreign amount with a blank document date is refused on the date', async () => {
    const err = await refusalOf(t.engine.insert('fx_invoice', { title: 'i1', currency_code: 'USD', amount: 1 }));
    expect(err?.code).toBe('VALIDATION_FAILED');
    expect(err?.fields?.map((f) => [f.field, f.code])).toEqual([['invoice_date', 'required']]);
    expect(t.storeFor('fx_invoice').size).toBe(0);
  });

  it('a blank code is the currency-code refusal, not a rate lookup', async () => {
    const err = await refusalOf(t.engine.insert('fx_invoice', { title: 'i1', invoice_date: '2026-03-15', amount: 1 }));
    expect(err?.code).toBe('ERR_CURRENCY_CODE_REQUIRED');
  });

  it('insertMany culls a refused row per row and stores the rest', async () => {
    const outcomes = await t.engine.insertMany('fx_invoice', [
      { title: 'ok', currency_code: 'USD', invoice_date: '2026-03-15', amount: 100 },
      { title: 'no-rate', currency_code: 'JPY', invoice_date: '2026-03-15', amount: 100 },
    ]);
    expect(outcomes.map((o: any) => [o.ok, o.error?.code])).toEqual([[true, undefined], [false, 'ERR_EXCHANGE_RATE_MISSING']]);
    expect([...t.storeFor('fx_invoice').values()].map((r) => r.title)).toEqual(['ok']);
  });
});

describe('the home currency is the organization\'s setting, never a default', () => {
  it('no resolver (no settings service) refuses ERR_HOME_CURRENCY_UNSET', async () => {
    const t = await boot(invoice(), undefined);
    const err = await refusalOf(t.engine.insert('fx_invoice', { title: 'i1', currency_code: 'USD', invoice_date: '2026-03-15', amount: 1 }));
    expect({ code: err?.code, status: err?.status }).toEqual({ code: 'ERR_HOME_CURRENCY_UNSET', status: 400 });
    expect(err?.message).toContain('localization.currency');
    expect(t.storeFor('fx_invoice').size).toBe(0);
  });

  it('the resolver is asked for the row\'s organization', async () => {
    const t = await boot(invoice(), undefined);
    const asked: Array<string | undefined> = [];
    t.engine.setHomeCurrencyResolver(async (org) => { asked.push(org); return 'CNY'; });
    await t.engine.insert('fx_invoice', { title: 'i1', currency_code: 'CNY', amount: 1 }, { context: { isSystem: true, tenantId: 'org_a' } } as any);
    expect(asked).toEqual(['org_a']);
  });
});

describe('only the engine writes the home and rate fields', () => {
  it('a caller\'s value is stripped as readonly and the projection is stored', async () => {
    const t = await boot();
    t.rate('USD', '2026-01-01', 0.1389);
    const events: any[] = [];
    const row = await t.engine.insert(
      'fx_invoice',
      { title: 'i1', currency_code: 'USD', invoice_date: '2026-03-15', amount: 10000, amount_home: 1, amount_rate: 2 },
      { onFieldsDropped: (e: any) => events.push(e) } as any,
    );
    expect(t.storeFor('fx_invoice').get(row.id)).toMatchObject({ amount_home: 71994.24, amount_rate: 0.1389 });
    expect(events.map((e) => [e.reason, e.fields])).toEqual([['readonly', ['amount_home', 'amount_rate']]]);
    const strict = await refusalOf(t.engine.insert(
      'fx_invoice', { title: 'i2', currency_code: 'USD', invoice_date: '2026-03-15', amount: 1, amount_home: 1 }, { strictReadonlyWrites: true } as any,
    ));
    expect(strict?.code).toBe('ERR_READONLY_FIELD_REJECTED');
  });

  it('a system writer\'s value is recomputed over, on insert and on update', async () => {
    const t = await boot();
    t.rate('USD', '2026-01-01', 0.1389);
    const row = await t.engine.insert('fx_invoice', { title: 'i1', currency_code: 'USD', invoice_date: '2026-03-15', amount: 10000, amount_home: 1, amount_rate: 2 }, SYS);
    expect(t.storeFor('fx_invoice').get(row.id)).toMatchObject({ amount_home: 71994.24, amount_rate: 0.1389 });
    await t.engine.update('fx_invoice', { id: row.id, amount_home: 5 }, SYS);
    expect(t.storeFor('fx_invoice').get(row.id)).toMatchObject({ amount_home: 71994.24, amount_rate: 0.1389 });
  });

  it('a preserveAudit (historical import) update of the home field is recomputed over, not kept', async () => {
    const t = await boot();
    t.rate('USD', '2026-01-01', 0.1389);
    const row = await t.engine.insert('fx_invoice', { title: 'i1', currency_code: 'USD', invoice_date: '2026-03-15', amount: 10000 });
    await t.engine.update('fx_invoice', { id: row.id, amount_home: 99999, amount_rate: 0.5 }, { context: { preserveAudit: true } } as any);
    expect(t.storeFor('fx_invoice').get(row.id)).toMatchObject({ amount_home: 71994.24, amount_rate: 0.1389 });
  });

  it('a defaultValue on the home or rate field never stands', async () => {
    const t = await boot(invoice({ home: { defaultValue: 0 }, rate: { defaultValue: 1 } }));
    t.rate('USD', '2026-01-01', 0.1389);
    const row = await t.engine.insert('fx_invoice', { title: 'i1', currency_code: 'USD', invoice_date: '2026-03-15', amount: 10000 });
    expect(t.storeFor('fx_invoice').get(row.id)).toMatchObject({ amount_home: 71994.24, amount_rate: 0.1389 });
    const blank = await t.engine.insert('fx_invoice', { title: 'i2', currency_code: 'USD', invoice_date: '2026-03-15' });
    expect(t.storeFor('fx_invoice').get(blank.id)).toMatchObject({ amount_home: null, amount_rate: null });
  });

  it('a rate field whose scale keeps fewer decimals than the rate refuses max_scale — the rate is never rounded', async () => {
    const t = await boot(invoice({ rate: { scale: 4 } }));
    t.rate('USD', '2026-01-01', 0.1389);
    t.rate('USD', '2026-02-01', 0.138912);
    const fits = await t.engine.insert('fx_invoice', { title: 'i1', currency_code: 'USD', invoice_date: '2026-01-15', amount: 10000 });
    expect(t.storeFor('fx_invoice').get(fits.id)).toMatchObject({ amount_rate: 0.1389 });
    const err = await refusalOf(t.engine.insert('fx_invoice', { title: 'i2', currency_code: 'USD', invoice_date: '2026-02-15', amount: 10000 }));
    expect(err?.code).toBe('VALIDATION_FAILED');
    expect(err?.fields?.map((f) => [f.field, f.code])).toEqual([['amount_rate', 'max_scale']]);
    expect(t.storeFor('fx_invoice').size).toBe(1);
  });
});

describe('update: the projection follows the amount, its code and its document date', () => {
  let t: Awaited<ReturnType<typeof boot>>;
  let id: string;
  beforeEach(async () => {
    t = await boot();
    t.rate('USD', '2026-01-01', 0.1389);
    t.rate('USD', '2026-04-01', 0.15);
    t.rate('EUR', '2026-01-01', 0.128);
    id = (await t.engine.insert('fx_invoice', { title: 'i1', currency_code: 'USD', invoice_date: '2026-03-15', amount: 10000 })).id;
  });
  const stored = () => t.storeFor('fx_invoice').get(id);

  it('an amount change converts again at the same rate', async () => {
    await t.engine.update('fx_invoice', { id, amount: 1389 });
    expect(stored()).toMatchObject({ amount_home: 10000, amount_rate: 0.1389 });
  });

  it('a code change converts at the new currency\'s rate', async () => {
    await t.engine.update('fx_invoice', { id, currency_code: 'EUR' });
    expect(stored()).toMatchObject({ amount_home: 78125, amount_rate: 0.128 });
    await t.engine.update('fx_invoice', { id, currency_code: 'CNY' });
    expect(stored()).toMatchObject({ amount_home: 10000, amount_rate: 1 });
  });

  it('a date change picks the rate in force on the new date', async () => {
    await t.engine.update('fx_invoice', { id, invoice_date: '2026-04-01' });
    expect(stored()).toMatchObject({ amount_home: 66666.67, amount_rate: 0.15 });
  });

  it('clearing the amount clears the home amount and rate', async () => {
    await t.engine.update('fx_invoice', { id, amount: null });
    expect(stored()).toMatchObject({ amount_home: null, amount_rate: null });
  });

  it('an unrelated edit after a rate correction leaves the stored conversion alone', async () => {
    t.rate('USD', '2026-01-01', 0.2);
    const before = t.finds.sys_exchange_rate ?? 0;
    await t.engine.update('fx_invoice', { id, title: 'renamed' });
    expect(stored()).toMatchObject({ title: 'renamed', amount_home: 71994.24, amount_rate: 0.1389 });
    expect(t.finds.sys_exchange_rate ?? 0).toBe(before);
  });

  it('a date change with no rate in force refuses, and the stored row is untouched', async () => {
    const err = await refusalOf(t.engine.update('fx_invoice', { id, invoice_date: '2025-06-30' }));
    expect(err?.code).toBe('ERR_EXCHANGE_RATE_MISSING');
    expect(err?.message).toContain(`(record ${id})`);
    expect(stored()).toMatchObject({ invoice_date: '2026-03-15', amount_home: 71994.24 });
  });
});

describe('predicate update: one patch for every matched row', () => {
  let t: Awaited<ReturnType<typeof boot>>;
  beforeEach(async () => {
    t = await boot();
    t.rate('USD', '2026-01-01', 0.1389);
    t.rate('EUR', '2026-01-01', 0.128);
    await t.engine.insert('fx_invoice', { title: 'batch', currency_code: 'USD', invoice_date: '2026-03-15', amount: 10000 });
    await t.engine.insert('fx_invoice', { title: 'batch', currency_code: 'USD', invoice_date: '2026-03-15', amount: 2000 });
  });

  it('a patch that converts every row to one value stores it', async () => {
    await t.engine.update('fx_invoice', { amount: 128, currency_code: 'EUR' }, BATCH);
    expect([...t.storeFor('fx_invoice').values()].map((r) => [r.amount_home, r.amount_rate])).toEqual([[1000, 0.128], [1000, 0.128]]);
  });

  it('a patch that converts rows to different values is refused before anything is written', async () => {
    const err = await refusalOf(t.engine.update('fx_invoice', { currency_code: 'EUR' }, BATCH));
    expect(err?.code).toBe('VALIDATION_FAILED');
    expect(err?.message).toContain('update those rows by id');
    expect([...t.storeFor('fx_invoice').values()].map((r) => r.currency_code)).toEqual(['USD', 'USD']);
  });
});

describe('validate(): the preview refuses what the write refuses', () => {
  it('insert and by-id update previews answer the projection\'s refusal as the row\'s finding', async () => {
    const t = await boot();
    t.rate('USD', '2026-01-01', 0.1389);
    const preview = await t.engine.validate('fx_invoice', [
      { title: 'p1', currency_code: 'JPY', invoice_date: '2026-03-15', amount: 1 },
      { title: 'p2', currency_code: 'USD', invoice_date: '2026-03-15', amount: 1 },
    ]);
    expect(preview.results?.map((r) => r.valid)).toEqual([false, true]);
    expect(preview.results?.[0]?.errors).toEqual([
      { field: 'amount', code: 'ERR_EXCHANGE_RATE_MISSING', message: expect.stringContaining('no exchange rate for JPY') },
    ]);
    const row = await t.engine.insert('fx_invoice', { title: 'i1', currency_code: 'USD', invoice_date: '2026-03-15', amount: 1 });
    const update = await t.engine.validate('fx_invoice', { id: row.id, invoice_date: '2025-01-01' }, { mode: 'update' });
    expect(update.results?.[0]?.errors?.map((e) => e.code)).toEqual(['ERR_EXCHANGE_RATE_MISSING']);
    expect((await t.engine.validate('fx_invoice', { id: row.id, title: 'x' }, { mode: 'update' })).valid).toBe(true);
  });
});
