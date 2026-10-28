// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [ADR-0144 D6, D8 rule 4] The three record-currency guards, through the engine
// and the registry:
//
//  - a write storing a `record`-mode amount beside a blank code is refused
//    `ERR_CURRENCY_CODE_REQUIRED` / 400 (insert, by-id update, predicate update);
//  - `sum` / `avg` / `min` / `max` over a `record`-mode amount is refused
//    `INVALID_FIELD` / 400 unless the query groups by the code field;
//  - a `summary` roll-up reading one is refused `INVALID_METADATA` / 422 at
//    registration, whichever end registers second.
//
// The fixture is the measurement round's `fx_invoice` (epic #8345, comment
// 6041378776), with the sibling code field DECLARED as the record currency.
// Every refusal here precedes the driver, so the driver is the rows-shaped
// in-memory double the roll-up suite uses; the same probes on driver-memory and
// on SqlDriver over better-sqlite3 are packages/qa/dogfood's
// `record-currency-probes.dogfood.test.ts`.

import { describe, it, expect, beforeEach } from 'vitest';
import { ObjectQL } from './engine.js';

function makeDriver() {
  const stores = new Map<string, Map<string, any>>();
  const storeFor = (o: string) => {
    let s = stores.get(o);
    if (!s) { s = new Map(); stores.set(o, s); }
    return s;
  };
  const matches = (row: any, where: any): boolean => {
    if (!where || typeof where !== 'object') return true;
    return Object.entries(where).every(([k, v]: [string, any]) => {
      if (k === '$and') return (v as any[]).every((w) => matches(row, w));
      if (k === '$or') return (v as any[]).some((w) => matches(row, w));
      if (v !== null && typeof v === 'object' && '$eq' in v) return row?.[k] === v.$eq;
      if (v !== null && typeof v === 'object' && '$in' in v) return (v.$in as unknown[]).includes(row?.[k]);
      return row?.[k] === v;
    });
  };
  let n = 0;
  const driver: any = {
    name: 'memory', version: '0.0.0', supports: {},
    async connect() {}, async disconnect() {}, async checkHealth() { return true; }, async execute() { return null; },
    async find(object: string, ast: any) {
      return Array.from(storeFor(object).values()).filter((r) => matches(r, ast?.where)).map((r) => ({ ...r }));
    },
    async findOne(object: string, ast: any) {
      for (const r of storeFor(object).values()) if (matches(r, ast?.where)) return { ...r };
      return null;
    },
    async create(object: string, data: Record<string, unknown>) {
      n += 1;
      const id = (data.id as string) ?? `r_${n}`;
      const row = { ...data, id };
      storeFor(object).set(id, row);
      return row;
    },
    async update(object: string, id: string, data: Record<string, unknown>) {
      const s = storeFor(object);
      const row = { ...s.get(id), ...data, id };
      s.set(id, row);
      return row;
    },
    async updateMany(object: string, ast: any, data: Record<string, unknown>) {
      const s = storeFor(object);
      let count = 0;
      for (const [id, r] of Array.from(s.entries())) {
        if (matches(r, ast?.where)) { s.set(id, { ...r, ...data, id }); count += 1; }
      }
      return count;
    },
    async delete(object: string, id: string) { return storeFor(object).delete(id); },
    async deleteMany() { return 0; },
    async count() { return 0; },
    async bulkCreate(object: string, rows: Record<string, unknown>[]) {
      return Promise.all(rows.map((r) => this.create(object, r)));
    },
    async bulkUpdate() { return []; }, async bulkDelete() {},
    async beginTransaction() { return { commit: async () => {}, rollback: async () => {} }; },
    async commit() {}, async rollback() {},
  };
  return { driver, storeFor };
}

type Thrown = (Error & {
  code?: string; status?: number; httpStatus?: number; field?: string; fields?: string[];
  amountField?: string; object?: string; param?: string; objectName?: string; fieldName?: string;
}) | null;

const refusalOf = async (p: Promise<unknown> | (() => unknown)): Promise<Thrown> => {
  try {
    await (typeof p === 'function' ? p() : p);
    return null;
  } catch (e) {
    return e as Thrown;
  }
};
const envelopeOf = (err: Thrown) => ({ code: err?.code, status: err?.status, httpStatus: err?.httpStatus });

const CODE_REQUIRED = { code: 'ERR_CURRENCY_CODE_REQUIRED', status: 400, httpStatus: 400 };
const INVALID_FIELD = { code: 'INVALID_FIELD', status: 400, httpStatus: 400 };
const INVALID_METADATA = { code: 'INVALID_METADATA', status: 422, httpStatus: 422 };

const RECORD = { currencyMode: 'record', currencyField: 'currency_code' } as const;

const FX_INVOICE = {
  name: 'fx_invoice',
  fields: {
    title: { type: 'text' },
    currency_code: { type: 'text', valueDomain: 'iso_4217_currency' },
    amount: { type: 'currency', currencyConfig: RECORD },
    amt_usd: { type: 'currency', currencyConfig: { currencyMode: 'fixed', defaultCurrency: 'USD' } },
  },
};

async function bootEngine() {
  const engine = new ObjectQL();
  const d = makeDriver();
  engine.registerDriver(d.driver, true);
  await engine.init();
  return { engine, storeFor: d.storeFor };
}

describe('a record-mode amount is stored with its currency code (ERR_CURRENCY_CODE_REQUIRED)', () => {
  let engine: ObjectQL;
  let storeFor: ReturnType<typeof makeDriver>['storeFor'];

  beforeEach(async () => {
    ({ engine, storeFor } = await bootEngine());
    engine.registry.registerObject(FX_INVOICE as any);
  });

  it('insert: an amount beside a blank code is refused, naming the code field, and nothing is written', async () => {
    for (const code of [undefined, null, '', '   ']) {
      const err = await refusalOf(engine.insert('fx_invoice', { title: 'i1', amount: 100, ...(code === undefined ? {} : { currency_code: code }) }));
      expect(envelopeOf(err), String(code)).toEqual(CODE_REQUIRED);
      expect(err?.field).toBe('currency_code');
      expect(err?.fields).toEqual(['currency_code']);
      expect(err?.amountField).toBe('amount');
      expect(err?.message).toContain("'currency_code' is blank");
    }
    expect(storeFor('fx_invoice').size).toBe(0);
  });

  it('insert: an amount with its code, or no amount at all, is written', async () => {
    await engine.insert('fx_invoice', { title: 'i1', amount: 100, currency_code: 'USD' });
    await engine.insert('fx_invoice', { title: 'i2', amount: 0, currency_code: 'JPY' });
    await engine.insert('fx_invoice', { title: 'i3' });
    await engine.insert('fx_invoice', { title: 'i4', amount: null });
    expect(storeFor('fx_invoice').size).toBe(4);
  });

  it('by-id update: clearing the code under a stored amount, or writing an amount onto a row with none, is refused', async () => {
    const withCode = await engine.insert('fx_invoice', { title: 'i1', amount: 100, currency_code: 'USD' });
    const noAmount = await engine.insert('fx_invoice', { title: 'i2' });

    const cleared = await refusalOf(engine.update('fx_invoice', { id: withCode.id, currency_code: null }));
    expect(envelopeOf(cleared)).toEqual(CODE_REQUIRED);
    expect(cleared?.message).toContain(`(record ${withCode.id})`);
    expect(storeFor('fx_invoice').get(withCode.id).currency_code).toBe('USD');

    const amountOnly = await refusalOf(engine.update('fx_invoice', { id: noAmount.id, amount: 50 }));
    expect(envelopeOf(amountOnly)).toEqual(CODE_REQUIRED);
    expect(storeFor('fx_invoice').get(noAmount.id).amount).toBeUndefined();

    // The controls: the stored code covers a new amount; amount and code cleared together.
    await engine.update('fx_invoice', { id: withCode.id, amount: 250 });
    expect(storeFor('fx_invoice').get(withCode.id).amount).toBe(250);
    await engine.update('fx_invoice', { id: withCode.id, amount: null, currency_code: null });
    expect(storeFor('fx_invoice').get(withCode.id).currency_code).toBeNull();
  });

  it('by-id update: a row stored before the guard is not refused for an edit that leaves the pair alone', async () => {
    storeFor('fx_invoice').set('legacy', { id: 'legacy', title: 'old', amount: 100, currency_code: null });
    await engine.update('fx_invoice', { id: 'legacy', title: 'renamed' });
    expect(storeFor('fx_invoice').get('legacy').title).toBe('renamed');
  });

  it('predicate update: one matched row left without a code refuses the whole write', async () => {
    const a = await engine.insert('fx_invoice', { title: 'batch', amount: 1, currency_code: 'EUR' });
    const b = await engine.insert('fx_invoice', { title: 'batch' });

    const err = await refusalOf(engine.update('fx_invoice', { amount: 9 }, { where: { title: 'batch' }, multi: true } as any));
    expect(envelopeOf(err)).toEqual(CODE_REQUIRED);
    expect(err?.message).toContain(`(record ${b.id})`);
    expect(storeFor('fx_invoice').get(a.id).amount).toBe(1);

    // The control: the same write carrying the code.
    await engine.update('fx_invoice', { amount: 9, currency_code: 'EUR' }, { where: { title: 'batch' }, multi: true } as any);
    expect(storeFor('fx_invoice').get(b.id)).toMatchObject({ amount: 9, currency_code: 'EUR' });
  });
});

describe('a raw aggregate over a record-mode amount groups by its code field (PROBE-A, PROBE-C)', () => {
  let engine: ObjectQL;

  beforeEach(async () => {
    ({ engine } = await bootEngine());
    engine.registry.registerObject(FX_INVOICE as any);
    await engine.insert('fx_invoice', { title: 'i1', currency_code: 'USD', amount: 100, amt_usd: 100 });
    await engine.insert('fx_invoice', { title: 'i2', currency_code: 'EUR', amount: 100, amt_usd: 0 });
  });

  it('sum / avg / min / max ungrouped is refused INVALID_FIELD, with the route first', async () => {
    for (const fn of ['sum', 'avg', 'min', 'max']) {
      const err = await refusalOf(engine.aggregate('fx_invoice', {
        aggregations: [{ function: fn, field: 'amount', alias: 'v' }],
      } as any));
      expect(envelopeOf(err), fn).toEqual(INVALID_FIELD);
      expect(err?.field).toBe('amount');
      expect(err?.param).toBe('aggregations');
      expect(err?.message).toContain("does not group by 'currency_code'");
      expect(err?.message.indexOf("Add 'currency_code' to groupBy")).toBeLessThan(500);
    }
  });

  it('grouped by a field other than the code is still refused', async () => {
    const err = await refusalOf(engine.aggregate('fx_invoice', {
      groupBy: ['title'],
      aggregations: [{ function: 'sum', field: 'amount', alias: 'v' }],
    } as any));
    expect(envelopeOf(err)).toEqual(INVALID_FIELD);
  });

  it('grouped by the code field answers one correct total per currency', async () => {
    for (const groupBy of [['currency_code'], [{ field: 'currency_code' }]]) {
      const rows = await engine.aggregate('fx_invoice', {
        groupBy,
        aggregations: [{ function: 'sum', field: 'amount', alias: 'total' }],
      } as any);
      const byCode = Object.fromEntries(rows.map((r: any) => [r.currency_code, r.total]));
      expect(byCode).toEqual({ USD: 100, EUR: 100 });
    }
  });

  it('count, and a fixed-currency amount, are not judged', async () => {
    const rows = await engine.aggregate('fx_invoice', {
      aggregations: [
        { function: 'count', field: 'amount', alias: 'n' },
        { function: 'sum', field: 'amt_usd', alias: 'usd' },
      ],
    } as any);
    expect(rows[0]).toMatchObject({ n: 2, usd: 100 });
  });
});

describe('a summary roll-up over a record-mode amount is refused at registration (PROBE-R)', () => {
  const LINE = {
    name: 'fx_line',
    fields: {
      currency_code: { type: 'text', valueDomain: 'iso_4217_currency' },
      amount: { type: 'currency', currencyConfig: RECORD },
      invoice: { type: 'master_detail', reference: 'fx_parent' },
    },
  };
  const parentWith = (fn: string, field = 'amount') => ({
    name: 'fx_parent',
    fields: {
      title: { type: 'text' },
      billed: { type: 'summary', summaryOperations: { object: 'fx_line', field, function: fn } },
    },
  });

  it('the parent registering after the child is refused, naming the roll-up', async () => {
    for (const fn of ['sum', 'avg', 'min', 'max']) {
      const { engine } = await bootEngine();
      engine.registry.registerObject(LINE as any);
      const err = await refusalOf(() => engine.registry.registerObject(parentWith(fn) as any));
      expect(envelopeOf(err), fn).toEqual(INVALID_METADATA);
      expect(err?.name).toBe('RecordCurrencySummaryRefusedError');
      expect(err?.objectName).toBe('fx_parent');
      expect(err?.fieldName).toBe('billed');
      expect(err?.message).toContain(`rolls up ${fn}(fx_line.amount)`);
      expect(engine.registry.getObject('fx_parent')).toBeUndefined();
    }
  });

  it('the child registering after the parent is refused, naming the same roll-up', async () => {
    const { engine } = await bootEngine();
    engine.registry.registerObject(parentWith('sum') as any);
    const err = await refusalOf(() => engine.registry.registerObject(LINE as any));
    expect(envelopeOf(err)).toEqual(INVALID_METADATA);
    expect(err?.objectName).toBe('fx_parent');
    expect(err?.message).toContain('rolls up sum(fx_line.amount)');
    expect(engine.registry.getObject('fx_line')).toBeUndefined();
  });

  it('a count roll-up over the amount, and a sum over a non-record child field, register', async () => {
    const { engine } = await bootEngine();
    engine.registry.registerObject(LINE as any);
    engine.registry.registerObject(parentWith('count') as any);
    expect(engine.registry.getObject('fx_parent')).toBeDefined();

    const other = await bootEngine();
    other.engine.registry.registerObject({
      ...LINE,
      fields: { ...LINE.fields, qty: { type: 'number' } },
    } as any);
    other.engine.registry.registerObject(parentWith('sum', 'qty') as any);
    expect(other.engine.registry.getObject('fx_parent')).toBeDefined();
  });
});
