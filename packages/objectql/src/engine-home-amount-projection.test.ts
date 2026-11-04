// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [ADR-0144 D5] The write-time home projection through the engine's write
// seams, on the in-memory face: a driver double whose `find` is the engine's
// own in-memory reading of a driver query (`applyDriverQueryInMemory`: where,
// orderBy, limit, fields), so the rate row the projection picks is chosen by
// the same `effective_date <= date ORDER BY effective_date DESC LIMIT 1` a
// SQL driver runs. ⛔ No driver-memory arm: its test consumers are a closed
// census (`check:driver-memory-census`). The double ignores `tenantId`, so
// organization isolation of the rate read is not pinned here: the same pins,
// and the two-organization one, on SQLite and Postgres are packages/qa/dogfood's
// `test/home-amount-projection.test.ts`.
//
// Pinned here, per seam (insert, insertMany, by-id update, predicate update,
// the validate() preview):
//
//  - the stored home amount is amount ÷ rate, rounded to the home currency's
//    CLDR fraction digits,
//    stored with the rate used; the same currency as home is rate 1, read-free;
//  - a missing rate refuses ERR_EXCHANGE_RATE_MISSING and an unset home
//    currency ERR_HOME_CURRENCY_UNSET, and nothing is written;
//  - the two projected fields: a caller's value is stripped (`readonly`) and
//    recomputed over, a system or `preserveAudit` writer's value is recomputed
//    over, a `defaultValue` never stands; a rate field declaring a `scale`
//    below the rate's decimals stores the full rate, never rounded and never
//    refused (a `readonly` value is checked for shape only, so the declared
//    scale reaches display only);
//  - a `datetime` document date is dated in the organization's
//    `localization.timezone` (UTC when unset); a `date` is its own day;
//  - an update projects when it moves the amount, its code or its document
//    date, and never otherwise (a corrected rate reaches stored rows only
//    through a recompute).

import { describe, it, expect, beforeEach } from 'vitest';
import type { EngineUpdateOptions } from '@objectstack/spec/data';
import { ObjectQL } from './engine.js';
import { applyDriverQueryInMemory } from './driver-query-in-memory.js';
import { recomputeHomeAmounts, homeAmountRecomputeComplete, formatHomeAmountRecomputeReport, type HomeAmountRecomputeOptions } from './home-amount-recompute.js';

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
const invoice = (over: { home?: Record<string, unknown>; rate?: Record<string, unknown>; dateType?: 'date' | 'datetime' } = {}) => ({
  name: 'fx_invoice',
  fields: {
    title: { type: 'text' },
    currency_code: { type: 'text', valueDomain: 'iso_4217_currency' },
    invoice_date: { type: over.dateType ?? 'date' },
    amount: { type: 'currency', currencyConfig: { currencyMode: 'record', currencyField: 'currency_code', homeAmount: HOME_AMOUNT } },
    amount_home: { type: 'currency', readonly: true, ...over.home },
    amount_rate: { type: 'number', readonly: true, ...over.rate },
  },
});

type Thrown = (Error & { code?: string; status?: number; field?: string; fields?: Array<{ field: string; code: string }> }) | null;
const refusalOf = async (p: Promise<unknown>): Promise<Thrown> => p.then(() => null, (e) => e as Thrown);

const SYS = { context: { isSystem: true } } as const;
const BATCH: EngineUpdateOptions = { where: { title: 'batch' }, multi: true };

/** `home: null` composes no home-currency resolver at all (no settings service). */
async function boot(object = invoice(), home: string | null = 'CNY') {
  const engine = new ObjectQL();
  const d = makeDriver();
  engine.registerDriver(d.driver, true);
  await engine.init();
  engine.registry.registerObject(RATE_OBJECT as any);
  engine.registry.registerObject(object as any);
  if (home !== null) engine.setHomeLocalizationResolver(async () => ({ currency: home }));
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
    // 1.005 is 1.00499999… as a double: a float rounding stores 1.00, the decimal one 1.01.
    const half = await t.engine.insert('fx_invoice', { title: 'i2', currency_code: 'CNY', amount: 1.005 });
    expect(t.storeFor('fx_invoice').get(half.id)).toMatchObject({ amount_home: 1.01, amount_rate: 1 });
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
    const t = await boot(invoice(), null);
    const err = await refusalOf(t.engine.insert('fx_invoice', { title: 'i1', currency_code: 'USD', invoice_date: '2026-03-15', amount: 1 }));
    expect({ code: err?.code, status: err?.status }).toEqual({ code: 'ERR_HOME_CURRENCY_UNSET', status: 400 });
    expect(err?.message).toContain('localization.currency');
    expect(t.storeFor('fx_invoice').size).toBe(0);
  });

  it('the resolver is asked for the row\'s organization', async () => {
    const t = await boot(invoice(), null);
    const asked: Array<string | undefined> = [];
    t.engine.setHomeLocalizationResolver(async (org) => { asked.push(org); return { currency: 'CNY' }; });
    await t.engine.insert('fx_invoice', { title: 'i1', currency_code: 'CNY', amount: 1 }, { context: { isSystem: true, tenantId: 'org_a' } } as any);
    expect(asked).toEqual(['org_a']);
  });
});

describe('a datetime document date is dated in the organization\'s localization.timezone', () => {
  // 2026-03-15T17:00Z is 01:00 on 2026-03-16 in Shanghai, and still the 15th in UTC.
  const AT_0100_SHANGHAI = '2026-03-15T17:00:00Z';
  async function bootZoned(zones: Record<string, string | undefined>) {
    const t = await boot(invoice({ dateType: 'datetime' }), null);
    const asked: Array<string | undefined> = [];
    t.engine.setHomeLocalizationResolver(async (org) => { asked.push(org); return { currency: 'CNY', timezone: zones[org ?? ''] }; });
    t.rate('USD', '2026-03-15', 0.1389);
    t.rate('USD', '2026-03-16', 0.15);
    return { ...t, asked };
  }
  const as = (org: string) => ({ context: { isSystem: true, tenantId: org } }) as any;

  it('an Asia/Shanghai organization writing at 01:00 local time gets the rate of that local day', async () => {
    const t = await bootZoned({ org_sh: 'Asia/Shanghai' });
    const row = await t.engine.insert('fx_invoice', { title: 'sh', currency_code: 'USD', invoice_date: AT_0100_SHANGHAI, amount: 1500 }, as('org_sh'));
    expect(t.storeFor('fx_invoice').get(row.id)).toMatchObject({ amount_home: 10000, amount_rate: 0.15 });
    // One localization read per organization per write answers the currency and the timezone.
    expect(t.asked).toEqual(['org_sh']);
  });

  it('a UTC organization, or one with no timezone set, keeps the UTC day', async () => {
    const t = await bootZoned({ org_utc: 'UTC', org_unset: undefined });
    for (const org of ['org_utc', 'org_unset']) {
      const row = await t.engine.insert('fx_invoice', { title: org, currency_code: 'USD', invoice_date: AT_0100_SHANGHAI, amount: 1389 }, as(org));
      expect(t.storeFor('fx_invoice').get(row.id)).toMatchObject({ amount_home: 10000, amount_rate: 0.1389 });
    }
  });

  it('an update of the datetime re-dates it in the same timezone', async () => {
    const t = await bootZoned({ org_sh: 'Asia/Shanghai' });
    const row = await t.engine.insert('fx_invoice', { title: 'sh', currency_code: 'USD', invoice_date: '2026-03-15T03:00:00Z', amount: 1389 }, as('org_sh'));
    expect(t.storeFor('fx_invoice').get(row.id)).toMatchObject({ amount_home: 10000, amount_rate: 0.1389 });
    await t.engine.update('fx_invoice', { id: row.id, invoice_date: AT_0100_SHANGHAI }, as('org_sh'));
    expect(t.storeFor('fx_invoice').get(row.id)).toMatchObject({ amount_home: 9260, amount_rate: 0.15 });
  });

  it('a date document date is never moved by the timezone', async () => {
    const t = await boot(invoice(), null);
    t.engine.setHomeLocalizationResolver(async () => ({ currency: 'CNY', timezone: 'Asia/Shanghai' }));
    t.rate('USD', '2026-03-15', 0.1389);
    t.rate('USD', '2026-03-16', 0.15);
    const row = await t.engine.insert('fx_invoice', { title: 'd', currency_code: 'USD', invoice_date: '2026-03-15', amount: 1389 }, as('org_sh'));
    expect(t.storeFor('fx_invoice').get(row.id)).toMatchObject({ amount_home: 10000, amount_rate: 0.1389 });
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

  it('a rate field declaring a scale below the rate\'s decimals stores the rate unrounded, and converts with all of it', async () => {
    // `readonly` values are judged for SHAPE only (`ReadonlyValueScope`), so a
    // declared `scale` is no write constraint on the rate field, and every
    // numeric column is the same exact decimal: the stored rate is the rate
    // row's own value, and the stored home amount reproduces from it.
    const t = await boot(invoice({ rate: { scale: 4 } }));
    t.rate('USD', '2026-02-01', 0.138912345678);
    const row = await t.engine.insert('fx_invoice', { title: 'i1', currency_code: 'USD', invoice_date: '2026-02-15', amount: 10000 });
    // 10000 ÷ 0.138912345678 = 71987.84…; at the rounded 0.1389 it would be 71994.24.
    expect(t.storeFor('fx_invoice').get(row.id)).toMatchObject({ amount_home: 71987.84, amount_rate: 0.138912345678 });
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

// ── The explicit recompute (`recomputeHomeAmounts`, `os migrate recompute-home-amounts`) ──
//
// [ADR-0144 D5, D7 parameter 1, Open item 8] A stored home amount moves only
// through this run. Pinned on the same harness, so every number it reports and
// writes is checked against what the write stores for the same row.

/** The audit ledger's shape (`sys_audit_log`, owned by plugin-audit; a stand-in here). */
const AUDIT_OBJECT = {
  name: 'sys_audit_log',
  fields: { action: { type: 'text' }, object_name: { type: 'text' }, record_id: { type: 'text' }, metadata: { type: 'textarea' } },
};

const noopLogger = { info: () => {}, warn: () => {} };
const recompute = (t: Awaited<ReturnType<typeof boot>>, options: Partial<HomeAmountRecomputeOptions> = {}) =>
  recomputeHomeAmounts(t.engine as never, noopLogger, { object: 'fx_invoice', ...options });
const auditRows = (t: Awaited<ReturnType<typeof boot>>) =>
  [...t.storeFor('sys_audit_log').values()].map((r) => ({ ...r, metadata: JSON.parse(String(r.metadata)) }));

describe('recompute: a corrected rate reaches stored rows through an explicit, reported run', () => {
  let t: Awaited<ReturnType<typeof boot>>;
  let id: string;
  const stored = () => t.storeFor('fx_invoice').get(id)!;
  beforeEach(async () => {
    t = await boot();
    t.engine.registry.registerObject(AUDIT_OBJECT as any);
    t.rate('USD', '2026-01-01', 0.1389);
    ({ id } = await t.engine.insert('fx_invoice', { title: 'i1', currency_code: 'USD', invoice_date: '2026-03-15', amount: 10000 }));
    t.rate('USD', '2026-01-01', 0.125); // the correction: 10,000 ÷ 0.125 = 80,000
  });

  it('the dry run lists the row with its stored and recomputed values, and writes nothing', async () => {
    const before = { ...stored() };
    const report = await recompute(t);
    expect(report).toMatchObject({ applied: false, amounts: 1, changed: 1, unchanged: 0, written: 0, skippedTotal: 0 });
    expect(report.changes).toEqual([
      { recordId: id, organizationId: null, field: 'amount', from: { home: 71994.24, rate: 0.1389 }, to: { home: 80000, rate: 0.125 } },
    ]);
    expect(stored()).toEqual(before);
    expect(t.storeFor('sys_audit_log').size).toBe(0);
    expect(homeAmountRecomputeComplete(report)).toBe(false);
  });

  it('the apply writes only the home and rate fields, and a second run finds nothing', async () => {
    const before = { ...stored() };
    const applied = await recompute(t, { apply: true });
    expect(applied).toMatchObject({ applied: true, changed: 1, written: 1, failures: [], audit: { written: true } });
    const after = stored();
    expect(after).toMatchObject({ amount_home: 80000, amount_rate: 0.125 });
    const moved = Object.keys(after).filter((k) => !Object.is(after[k], before[k])).sort();
    expect(moved).toEqual(['amount_home', 'amount_rate']);
    const again = await recompute(t, { apply: true });
    expect(again).toMatchObject({ changed: 0, unchanged: 1, written: 0 });
    expect(homeAmountRecomputeComplete(again)).toBe(true);
  });

  it('a recomputed row equals what a fresh write of the same row stores', async () => {
    await recompute(t, { apply: true });
    const fresh = await t.engine.insert('fx_invoice', { title: 'fresh', currency_code: 'USD', invoice_date: '2026-03-15', amount: 10000 });
    const pick = (r: Record<string, unknown>) => [r.amount_home, r.amount_rate];
    expect(pick(stored())).toEqual(pick(t.storeFor('fx_invoice').get(fresh.id)!));
  });

  it('one audit entry per applied run, carrying its counts per organization; none for a dry run', async () => {
    await recompute(t);
    await recompute(t, { apply: true, source: 'test' });
    const rows = auditRows(t);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ action: 'update', object_name: 'fx_invoice' });
    expect(rows[0]!.metadata).toMatchObject({
      event: 'home_amount.recompute', source: 'test', object: 'fx_invoice', fields: ['amount'], since: null,
      changed: 1, written: 1, skipped: [],
      organizations: [{ organizationId: null, homeCurrency: 'CNY', amounts: 1, changed: 1, written: 1 }],
    });
  });

  it('without the audit ledger in the composition the run says so instead of failing', async () => {
    const bare = await boot();
    bare.rate('CNY', '2026-01-01', 1);
    await bare.engine.insert('fx_invoice', { title: 'i', currency_code: 'CNY', amount: 5 });
    bare.storeFor('fx_invoice').forEach((r) => { r.amount_home = 4; });
    const report = await recompute(bare, { apply: true });
    expect(report).toMatchObject({ written: 1, audit: { written: false, reason: 'ledger_not_mounted' } });
  });
});

describe('recompute: rows that cannot be converted are listed, skipped and never written (parameter 1, Open item 8)', () => {
  let t: Awaited<ReturnType<typeof boot>>;
  beforeEach(async () => {
    t = await boot();
    t.engine.registry.registerObject(AUDIT_OBJECT as any);
    t.rate('USD', '2026-01-01', 0.1389);
  });

  it('a missing rate: listed with its currency and date, skipped, nothing written, the run stays incomplete', async () => {
    const { id } = await t.engine.insert('fx_invoice', { title: 'i1', currency_code: 'USD', invoice_date: '2026-03-15', amount: 10000 });
    const ok = await t.engine.insert('fx_invoice', { title: 'i2', currency_code: 'CNY', amount: 3 });
    t.storeFor('fx_invoice').get(ok.id)!.amount_home = 2; // stale, recomputable
    t.storeFor('sys_exchange_rate').clear(); // the USD rate row is gone
    const before = { ...t.storeFor('fx_invoice').get(id)! };
    const report = await recompute(t, { apply: true });
    expect(report.skipped).toEqual([{ recordId: id, organizationId: null, field: 'amount', reason: 'rate_missing', currency: 'USD', date: '2026-03-15' }]);
    expect(report).toMatchObject({ skippedTotal: 1, changed: 1, written: 1 });
    expect(report.skippedByReason).toMatchObject({ rate_missing: 1, code_blank: 0 });
    expect(t.storeFor('fx_invoice').get(id)).toEqual(before);
    expect(t.storeFor('fx_invoice').get(ok.id)).toMatchObject({ amount_home: 3, amount_rate: 1 });
    // The gap outlives the report: the run stays incomplete and its audit entry names the row.
    expect(homeAmountRecomputeComplete(report)).toBe(false);
    expect(auditRows(t)[0]!.metadata.skipped).toEqual(report.skipped);
    expect(auditRows(t)[0]!.metadata.skippedByReason).toMatchObject({ rate_missing: 1 });
    expect(formatHomeAmountRecomputeReport(report).join('\n')).toContain('no USD rate on or before 2026-03-15');
  });

  it('a home field added over stored rows: rows without a rate stay blank, never 0, the rest are filled', async () => {
    // Rows stored before the declaration: an amount, its code, a document date, no home amount.
    const legacy = (id: string, code: string, date: string) =>
      t.storeFor('fx_invoice').set(id, { id, title: id, currency_code: code, invoice_date: date, amount: 1389, amount_home: null, amount_rate: null });
    legacy('old_usd', 'USD', '2026-03-15');
    legacy('old_jpy', 'JPY', '2026-03-15');
    const report = await recompute(t, { apply: true });
    expect(report).toMatchObject({ changed: 1, written: 1, skippedTotal: 1 });
    expect(t.storeFor('fx_invoice').get('old_usd')).toMatchObject({ amount_home: 10000, amount_rate: 0.1389 });
    expect(t.storeFor('fx_invoice').get('old_jpy')).toMatchObject({ amount_home: null, amount_rate: null });
  });

  it('a blank code beside an amount is its own class, apart from a missing rate, with its own remedy', async () => {
    t.storeFor('fx_invoice').set('codeless', { id: 'codeless', title: 'c', invoice_date: '2026-03-15', amount: 50, amount_home: null, amount_rate: null });
    const report = await recompute(t, { apply: true });
    expect(report.skipped).toEqual([{ recordId: 'codeless', organizationId: null, field: 'amount', reason: 'code_blank' }]);
    expect(report.skippedByReason).toMatchObject({ code_blank: 1, rate_missing: 0 });
    expect(t.storeFor('fx_invoice').get('codeless')).toMatchObject({ amount_home: null, amount_rate: null });
    expect(formatHomeAmountRecomputeReport(report).join('\n')).toContain('os migrate record-currency-codes --object fx_invoice');
  });

  it('a blank document date and an unset home currency are their own classes', async () => {
    t.storeFor('fx_invoice').set('undated', { id: 'undated', title: 'u', currency_code: 'USD', amount: 50 });
    expect((await recompute(t)).skipped.map((s) => s.reason)).toEqual(['document_date_blank']);
    const unset = await boot(invoice(), null);
    unset.storeFor('fx_invoice').set('x', { id: 'x', title: 'x', currency_code: 'USD', invoice_date: '2026-03-15', amount: 50 });
    const report = await recompute(unset);
    expect(report.skipped.map((s) => s.reason)).toEqual(['home_currency_unset']);
    expect(report.organizations).toEqual([expect.objectContaining({ homeCurrency: null, amounts: 1 })]);
  });
});

describe('recompute: the write\'s own rules, per organization', () => {
  it('the same currency as home is rate 1 and reads no rate', async () => {
    const t = await boot();
    const { id } = await t.engine.insert('fx_invoice', { title: 'i', currency_code: 'CNY', amount: 1.005 });
    t.storeFor('fx_invoice').get(id)!.amount_home = 1; // a stale value
    const before = t.finds.sys_exchange_rate ?? 0;
    const report = await recompute(t, { apply: true });
    expect(report.changes[0]!.to).toEqual({ home: 1.01, rate: 1 });
    expect(t.storeFor('fx_invoice').get(id)).toMatchObject({ amount_home: 1.01, amount_rate: 1 });
    expect(t.finds.sys_exchange_rate ?? 0).toBe(before);
  });

  it('a datetime document date is dated in the organization\'s timezone, for the rate and for since', async () => {
    const t = await boot(invoice({ dateType: 'datetime' }));
    let timezone: string | undefined;
    t.engine.setHomeLocalizationResolver(async () => ({ currency: 'CNY', timezone }));
    t.rate('USD', '2026-01-01', 0.1389);
    t.rate('USD', '2026-04-01', 0.15);
    // 2026-03-31T17:00Z is 01:00 on 2026-04-01 in Shanghai.
    const { id } = await t.engine.insert('fx_invoice', { title: 'o', currency_code: 'USD', invoice_date: '2026-03-31T17:00:00Z', amount: 1500 });
    expect(t.storeFor('fx_invoice').get(id)).toMatchObject({ amount_rate: 0.1389 });
    expect(await recompute(t, { since: '2026-04-01' })).toMatchObject({ amounts: 0, outsideSince: 1 });
    timezone = 'Asia/Shanghai';
    const report = await recompute(t, { since: '2026-04-01', apply: true });
    expect(report).toMatchObject({ amounts: 1, outsideSince: 0, written: 1 });
    expect(t.storeFor('fx_invoice').get(id)).toMatchObject({ amount_home: 10000, amount_rate: 0.15 });
  });

  it('since filters on the document date; a row with none is outside every window', async () => {
    const t = await boot();
    t.rate('USD', '2026-01-01', 0.1389);
    await t.engine.insert('fx_invoice', { title: 'march', currency_code: 'USD', invoice_date: '2026-03-15', amount: 1 });
    await t.engine.insert('fx_invoice', { title: 'april', currency_code: 'USD', invoice_date: '2026-04-15', amount: 1 });
    await t.engine.insert('fx_invoice', { title: 'undated', currency_code: 'CNY', amount: 1 });
    t.rate('USD', '2026-01-01', 0.5);
    const report = await recompute(t, { since: '2026-04-01' });
    expect(report).toMatchObject({ since: '2026-04-01', amounts: 1, outsideSince: 2, changed: 1 });
    const april = [...t.storeFor('fx_invoice').values()].find((r) => r.title === 'april')!;
    expect(report.changes.map((c) => c.recordId)).toEqual([april.id]);
    expect((await recompute(t)).changed).toBe(2);
  });

  it('two organizations convert into their own home currencies and are counted apart', async () => {
    const t = await boot();
    const homes: Record<string, string> = { org_a: 'CNY', org_b: 'JPY' };
    t.engine.setHomeLocalizationResolver(async (org) => ({ currency: org ? homes[org] : undefined }));
    t.rate('USD', '2026-01-01', 0.1389); // org_a's rate for USD (home CNY)
    t.rate('CNY', '2026-01-01', 0.05); // org_b's rate for CNY (home JPY)
    const as = (org: string) => ({ context: { isSystem: true, tenantId: org } }) as any;
    const a = await t.engine.insert('fx_invoice', { title: 'a', currency_code: 'USD', invoice_date: '2026-03-15', amount: 1389, organization_id: 'org_a' }, as('org_a'));
    const b = await t.engine.insert('fx_invoice', { title: 'b', currency_code: 'CNY', invoice_date: '2026-03-15', amount: 721, organization_id: 'org_b' }, as('org_b'));
    expect(t.storeFor('fx_invoice').get(b.id)).toMatchObject({ amount_home: 14420, amount_rate: 0.05 });
    t.rate('CNY', '2026-01-01', 0.048); // a correction that only org_b's row reads
    const report = await recompute(t, { apply: true });
    expect(report.organizations).toEqual([
      expect.objectContaining({ organizationId: 'org_a', homeCurrency: 'CNY', amounts: 1, unchanged: 1, changed: 0 }),
      expect.objectContaining({ organizationId: 'org_b', homeCurrency: 'JPY', amounts: 1, unchanged: 0, changed: 1, written: 1 }),
    ]);
    expect(t.storeFor('fx_invoice').get(a.id)).toMatchObject({ amount_home: 10000, amount_rate: 0.1389 });
    // 721 ÷ 0.048 = 15020.83…, whole yen: JPY has no fraction digits.
    expect(t.storeFor('fx_invoice').get(b.id)).toMatchObject({ amount_home: 15021, amount_rate: 0.048 });
  });
});

describe('recompute: refused before any row is read', () => {
  it('an unknown object, an object with no home amount, a field without one, and a malformed since', async () => {
    const t = await boot();
    t.engine.registry.registerObject({ name: 'plain', fields: { title: { type: 'text' } } } as any);
    const before = t.finds.fx_invoice ?? 0;
    const codes = await Promise.all([
      refusalOf(recompute(t, { object: 'nope' })),
      refusalOf(recompute(t, { object: 'plain' })),
      refusalOf(recompute(t, { field: 'title' })),
      refusalOf(recompute(t, { since: '2026-02-30' })),
      refusalOf(recompute(t, { since: '15/03/2026' })),
    ]);
    expect(codes.map((e) => [e?.code, e?.status])).toEqual([
      ['OBJECT_NOT_FOUND', 404], ['INVALID_FIELD', 400], ['INVALID_FIELD', 400], ['VALIDATION_FAILED', 400], ['VALIDATION_FAILED', 400],
    ]);
    expect(codes[2]?.message).toContain("'amount'");
    expect(t.finds.fx_invoice ?? 0).toBe(before);
  });
});
