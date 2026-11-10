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
// in-memory double the roll-up suite uses; the same probes on SqlDriver over
// better-sqlite3 and on SqliteWasmDriver are packages/qa/dogfood's
// `test/record-currency-probes.test.ts`. The write's blank-code refusal is
// also the `validate()` preview's finding (changeset 26684's parity).
//
// [ADR-0144 D2 and D6, amended 2026-11-09 by #31743] The last four describes
// pin a child amount that follows its parent's currency through a
// `master_detail` (`currencyField: 'invoice.currency_code'`): its code is the
// parent's at every write, an aggregate over it is refused whatever it groups
// by, a `summary` through that very `master_detail` registers and totals each
// parent's own rows, and the parent's code locks while a child row (a binned
// one included) follows it.

import { describe, it, expect, beforeEach } from 'vitest';
import { defineStack } from '@objectstack/spec';
import { RECYCLE_BIN_ENTRY_FIELDS, RECYCLE_BIN_OBJECT, type EngineAggregateOptions, type EngineUpdateOptions } from '@objectstack/spec/data';
import { resolveThrownHttpError } from '@objectstack/types';
import { ObjectQL } from './engine.js';
import { aggregateSummaryValue } from './summary-aggregate.js';
import { assertRecordCurrencyCodes, followParentCurrencyCodes, recordCurrencyPairs } from './validation/record-currency-code.js';

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
      const rows = Array.from(storeFor(object).values()).filter((r) => matches(r, ast?.where));
      const page = typeof ast?.limit === 'number' ? rows.slice(0, ast.limit) : rows;
      return page.map((r) => ({ ...r }));
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
/** Typed at the call, never asserted (`check:query-options-erasure`). */
const aggregateQuery = (query: EngineAggregateOptions): EngineAggregateOptions => query;
const BATCH: EngineUpdateOptions = { where: { title: 'batch' }, multi: true };

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

    const err = await refusalOf(engine.update('fx_invoice', { amount: 9 }, BATCH));
    expect(envelopeOf(err)).toEqual(CODE_REQUIRED);
    expect(err?.message).toContain(`(record ${b.id})`);
    expect(storeFor('fx_invoice').get(a.id).amount).toBe(1);

    // The control: the same write carrying the code.
    await engine.update('fx_invoice', { amount: 9, currency_code: 'EUR' }, BATCH);
    expect(storeFor('fx_invoice').get(b.id)).toMatchObject({ amount: 9, currency_code: 'EUR' });
  });
  it('validate(): the insert and by-id update previews refuse what the write refuses, as the row\'s finding', async () => {
    const insertPreview = await engine.validate('fx_invoice', [
      { title: 'p1', amount: 100 },
      { title: 'p2', amount: 100, currency_code: 'USD' },
      { title: 'p3' },
    ]);
    expect(insertPreview.valid).toBe(false);
    expect(insertPreview.results?.map((r) => r.valid)).toEqual([false, true, true]);
    expect(insertPreview.results?.[0]?.errors).toEqual([
      { field: 'currency_code', code: 'ERR_CURRENCY_CODE_REQUIRED', message: expect.stringContaining("'currency_code' is blank") },
    ]);

    const withCode = await engine.insert('fx_invoice', { title: 'i1', amount: 100, currency_code: 'USD' });
    storeFor('fx_invoice').set('legacy', { id: 'legacy', title: 'old', amount: 100, currency_code: null });
    const cleared = await engine.validate('fx_invoice', { id: withCode.id, currency_code: null }, { mode: 'update' });
    expect(cleared.valid).toBe(false);
    expect(cleared.results?.[0]?.errors).toEqual([
      { field: 'currency_code', code: 'ERR_CURRENCY_CODE_REQUIRED', message: expect.stringContaining(`(record ${withCode.id})`) },
    ]);

    // The controls, answered as the write answers them: the stored code covers
    // a new amount, and a codeless legacy row's unrelated edit is not judged.
    expect((await engine.validate('fx_invoice', { id: withCode.id, amount: 250 }, { mode: 'update' })).valid).toBe(true);
    expect((await engine.validate('fx_invoice', { id: 'legacy', title: 'renamed' }, { mode: 'update' })).valid).toBe(true);
    expect(storeFor('fx_invoice').get(withCode.id)).toMatchObject({ amount: 100, currency_code: 'USD' });
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
    for (const fn of ['sum', 'avg', 'min', 'max'] as const) {
      const err = await refusalOf(engine.aggregate('fx_invoice', aggregateQuery({
        aggregations: [{ function: fn, field: 'amount', alias: 'v' }],
      })));
      expect(envelopeOf(err), fn).toEqual(INVALID_FIELD);
      expect(err?.field).toBe('amount');
      expect(err?.param).toBe('aggregations');
      expect(err?.message).toContain("does not group by 'currency_code'");
      expect(err?.message.indexOf("Add 'currency_code' to groupBy")).toBeLessThan(500);
    }
  });

  it('grouped by a field other than the code is still refused', async () => {
    const err = await refusalOf(engine.aggregate('fx_invoice', aggregateQuery({
      groupBy: ['title'],
      aggregations: [{ function: 'sum', field: 'amount', alias: 'v' }],
    })));
    expect(envelopeOf(err)).toEqual(INVALID_FIELD);
  });

  it('grouped by the code field answers one correct total per currency', async () => {
    const groupings: Array<EngineAggregateOptions['groupBy']> = [['currency_code'], [{ field: 'currency_code' }]];
    for (const groupBy of groupings) {
      const rows = await engine.aggregate('fx_invoice', aggregateQuery({
        groupBy,
        aggregations: [{ function: 'sum', field: 'amount', alias: 'total' }],
      }));
      const byCode = Object.fromEntries(rows.map((r: any) => [r.currency_code, r.total]));
      expect(byCode).toEqual({ USD: 100, EUR: 100 });
    }
  });

  it('count, and a fixed-currency amount, are not judged', async () => {
    const rows = await engine.aggregate('fx_invoice', aggregateQuery({
      aggregations: [
        { function: 'count', field: 'amount', alias: 'n' },
        { function: 'sum', field: 'amt_usd', alias: 'usd' },
      ],
    }));
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

  it('[#29673] the pre-flight `objectRegistrationRefusal` leaves this door to the registration: it reads other objects, not the body alone', async () => {
    const { engine } = await bootEngine();
    engine.registry.registerObject(LINE as any);
    // A sibling drafted in the same batch may take the child's amount out of
    // record-currency mode before this parent registers, so the pre-flight a
    // save or promote asks does not refuse it; the registration still does.
    expect(engine.registry.objectRegistrationRefusal(parentWith('sum') as any)).toBeNull();
    const err = await refusalOf(() => engine.registry.registerObject(parentWith('sum') as any));
    expect(err?.name).toBe('RecordCurrencySummaryRefusedError');
    expect(engine.registry.getObject('fx_parent')).toBeUndefined();
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

// ── [ADR-0144 D2 and D6, amended 2026-11-09 by #31743] A child that follows its parent's currency ──

const CODE_FIELD = { type: 'text', valueDomain: 'iso_4217_currency' } as const;
const FOLLOWS = { currencyMode: 'record', currencyField: 'invoice.currency_code' } as const;
const PP_INVOICE = {
  name: 'pp_invoice',
  fields: {
    title: { type: 'text' },
    currency_code: CODE_FIELD,
    billing_currency: CODE_FIELD,
    subtotal: {
      type: 'summary',
      currencyConfig: { currencyMode: 'record', currencyField: 'currency_code' },
      summaryOperations: { object: 'pp_line', field: 'amount', function: 'sum' },
    },
  },
};
const PP_LINE = {
  name: 'pp_line',
  fields: {
    title: { type: 'text' },
    invoice: { type: 'master_detail', reference: 'pp_invoice' },
    amount: { type: 'currency', currencyConfig: FOLLOWS },
  },
};
const VALIDATION_FAILED = { code: 'VALIDATION_FAILED', status: 400 };
/** The refusal as every HTTP door reads it (ADR-0112): a `ValidationError` carries its 400 there, not on itself. */
const httpOf = (err: Thrown) => {
  const { code, status } = resolveThrownHttpError(err);
  return { code, status };
};
const BIN = { name: RECYCLE_BIN_OBJECT, label: 'Recycle Bin Entry', managedBy: 'engine-owned', fields: { ...RECYCLE_BIN_ENTRY_FIELDS } };

async function bootFollowing(options: { bin?: boolean; parentFirst?: boolean } = {}) {
  const booted = await bootEngine();
  const { engine } = booted;
  if (options.bin) engine.registry.registerObject(BIN as any);
  for (const o of options.parentFirst === false ? [PP_LINE, PP_INVOICE] : [PP_INVOICE, PP_LINE]) engine.registry.registerObject(o as any);
  await engine.insert('pp_invoice', { id: 'inv_usd', title: 'usd', currency_code: 'USD' });
  await engine.insert('pp_invoice', { id: 'inv_eur', title: 'eur', currency_code: 'EUR' });
  await engine.insert('pp_invoice', { id: 'inv_blank', title: 'blank' });
  return booted;
}

describe('a child amount that follows its parent\'s currency is written with the parent\'s code (ADR-0144 D2, amended)', () => {
  let engine: ObjectQL;
  let storeFor: ReturnType<typeof makeDriver>['storeFor'];

  beforeEach(async () => {
    ({ engine, storeFor } = await bootFollowing());
  });

  it('insert: a line under a parent holding a code is written, and stores no code of its own', async () => {
    const line = await engine.insert('pp_line', { title: 'l1', invoice: 'inv_usd', amount: 100 });
    const stored = storeFor('pp_line').get(line.id);
    expect(stored).toMatchObject({ invoice: 'inv_usd', amount: 100 });
    expect(Object.keys(stored).filter((k) => k.includes('.') || k === 'currency_code')).toEqual([]);
  });

  it('insert: a line with an amount under a parent with no code is refused ERR_CURRENCY_CODE_REQUIRED, and nothing is written', async () => {
    const err = await refusalOf(engine.insert('pp_line', { title: 'l1', invoice: 'inv_blank', amount: 100 }));
    expect(envelopeOf(err)).toEqual(CODE_REQUIRED);
    expect(err?.field).toBe('invoice.currency_code');
    expect(err?.amountField).toBe('amount');
    expect(err?.message).toContain("the 'pp_invoice' record it names has a blank 'currency_code'");
    expect(storeFor('pp_line').size).toBe(0);
    // The control: no amount needs no code.
    await engine.insert('pp_line', { title: 'l2', invoice: 'inv_blank' });
    expect(storeFor('pp_line').size).toBe(1);
  });

  it('insert: a line naming a parent that is not there is answered by the reference check, not the currency guard', async () => {
    const err = await refusalOf(engine.insert('pp_line', { title: 'l1', invoice: 'inv_gone', amount: 100 }));
    expect(err?.code).not.toBe('ERR_CURRENCY_CODE_REQUIRED');
    expect(httpOf(err)).toEqual(VALIDATION_FAILED);
    expect((err as any)?.fields?.map((f: any) => [f.field, f.code])).toEqual([['invoice', 'reference_not_found']]);
    expect(storeFor('pp_line').size).toBe(0);
  });

  it('by-id update: moving a line to a parent with no code is refused; to a parent with one it passes; an unrelated edit is not judged', async () => {
    const line = await engine.insert('pp_line', { title: 'l1', invoice: 'inv_usd', amount: 100 });
    const moved = await refusalOf(engine.update('pp_line', { id: line.id, invoice: 'inv_blank' }));
    expect(envelopeOf(moved)).toEqual(CODE_REQUIRED);
    expect(moved?.message).toContain(`(record ${line.id})`);
    expect(storeFor('pp_line').get(line.id).invoice).toBe('inv_usd');

    await engine.update('pp_line', { id: line.id, invoice: 'inv_eur' });
    expect(storeFor('pp_line').get(line.id).invoice).toBe('inv_eur');
    storeFor('pp_line').set('legacy', { id: 'legacy', title: 'old', invoice: 'inv_blank', amount: 5 });
    await engine.update('pp_line', { id: 'legacy', title: 'renamed' });
    expect(storeFor('pp_line').get('legacy').title).toBe('renamed');
  });

  it('predicate update: one matched line whose parent holds no code refuses the whole write', async () => {
    const a = await engine.insert('pp_line', { title: 'batch', invoice: 'inv_usd', amount: 1 });
    const b = await engine.insert('pp_line', { title: 'batch', invoice: 'inv_blank' });
    const err = await refusalOf(engine.update('pp_line', { amount: 9 }, BATCH));
    expect(envelopeOf(err)).toEqual(CODE_REQUIRED);
    expect(err?.message).toContain(`(record ${b.id})`);
    expect(storeFor('pp_line').get(a.id).amount).toBe(1);
    // The control: the same write, moving every line under a parent with a code.
    await engine.update('pp_line', { amount: 9, invoice: 'inv_eur' }, BATCH);
    expect(storeFor('pp_line').get(b.id)).toMatchObject({ amount: 9, invoice: 'inv_eur' });
  });

  it('validate(): the insert and update previews refuse what the write refuses', async () => {
    const preview = await engine.validate('pp_line', [
      { title: 'p1', invoice: 'inv_blank', amount: 1 },
      { title: 'p2', invoice: 'inv_usd', amount: 1 },
    ]);
    expect(preview.results?.map((r) => r.valid)).toEqual([false, true]);
    expect(preview.results?.[0]?.errors?.[0]).toMatchObject({ field: 'invoice.currency_code', code: 'ERR_CURRENCY_CODE_REQUIRED' });
    const line = await engine.insert('pp_line', { title: 'l1', invoice: 'inv_usd', amount: 1 });
    const moved = await engine.validate('pp_line', { id: line.id, invoice: 'inv_blank' }, { mode: 'update' });
    expect(moved.results?.[0]?.errors?.[0]).toMatchObject({ field: 'invoice.currency_code', code: 'ERR_CURRENCY_CODE_REQUIRED' });
    expect((await engine.validate('pp_line', { id: line.id, invoice: 'inv_eur' }, { mode: 'update' })).valid).toBe(true);
  });
});

describe('an aggregate over a child amount that follows its parent is refused whatever it groups by (ADR-0144 D6, Open item 14)', () => {
  let engine: ObjectQL;

  beforeEach(async () => {
    ({ engine } = await bootFollowing());
    await engine.insert('pp_line', { title: 'u', invoice: 'inv_usd', amount: 100 });
    await engine.insert('pp_line', { title: 'e', invoice: 'inv_eur', amount: 100 });
  });

  it('ungrouped, grouped by the parent path, and grouped by the master_detail are each refused INVALID_FIELD', async () => {
    // Grouped by the parent path, the engine read the dotted key as a column of
    // the line, which no line stores: USD 100 and EUR 100 answered one null
    // group of 200. The door refuses before any driver is asked.
    for (const groupBy of [undefined, ['invoice.currency_code'], [{ field: 'invoice.currency_code' }], ['invoice']]) {
      const err = await refusalOf(engine.aggregate('pp_line', aggregateQuery({
        ...(groupBy ? { groupBy: groupBy as EngineAggregateOptions['groupBy'] } : {}),
        aggregations: [{ function: 'sum', field: 'amount', alias: 'total' }],
      })));
      expect(envelopeOf(err), JSON.stringify(groupBy)).toEqual(INVALID_FIELD);
      expect(err?.field).toBe('amount');
      expect(err?.message).toContain("following 'invoice.currency_code' through the master_detail 'invoice'");
      expect(err?.message.indexOf('Aggregate a stored home-currency amount field')).toBeLessThan(500);
    }
  });

  it('count is not judged', async () => {
    const rows = await engine.aggregate('pp_line', aggregateQuery({ aggregations: [{ function: 'count', field: 'amount', alias: 'n' }] }));
    expect(rows[0]).toMatchObject({ n: 2 });
  });

  it('the parent\'s roll-up is in each parent\'s own currency: refused ungrouped, one total per currency grouped by its code', async () => {
    const err = await refusalOf(engine.aggregate('pp_invoice', aggregateQuery({ aggregations: [{ function: 'sum', field: 'subtotal', alias: 'v' }] })));
    expect(envelopeOf(err)).toEqual(INVALID_FIELD);
    expect(err?.message).toContain("does not group by 'currency_code'");
    const rows = await engine.aggregate('pp_invoice', aggregateQuery({
      groupBy: ['currency_code'],
      aggregations: [{ function: 'sum', field: 'subtotal', alias: 'v' }],
    }));
    expect(Object.fromEntries(rows.filter((r: any) => r.currency_code).map((r: any) => [r.currency_code, r.v]))).toEqual({ USD: 100, EUR: 100 });
  });
});

describe('a summary rolled up through the master_detail its children follow registers, in the parent\'s currency (ADR-0144 D6, amended)', () => {
  it('registers in either order, and each parent totals its own lines', async () => {
    for (const parentFirst of [true, false]) {
      const { engine, storeFor } = await bootFollowing({ parentFirst });
      expect(engine.registry.getObject('pp_invoice'), String(parentFirst)).toBeDefined();
      await engine.insert('pp_line', { title: 'u1', invoice: 'inv_usd', amount: 100 });
      await engine.insert('pp_line', { title: 'u2', invoice: 'inv_usd', amount: 50 });
      await engine.insert('pp_line', { title: 'e1', invoice: 'inv_eur', amount: 100 });
      expect(storeFor('pp_invoice').get('inv_usd').subtotal, String(parentFirst)).toBe(150);
      expect(storeFor('pp_invoice').get('inv_eur').subtotal, String(parentFirst)).toBe(100);
    }
  });

  const PROJECT = { name: 'pp_project', fields: { title: { type: 'text' } } };
  const lineWith = (extra: Record<string, unknown>) => ({ ...PP_LINE, fields: { ...PP_LINE.fields, ...extra } });

  it('a summary through another relation is refused INVALID_METADATA, whichever end registers second', async () => {
    const PROJECT_TOTAL = {
      ...PROJECT,
      fields: { ...PROJECT.fields, total: { type: 'summary', summaryOperations: { object: 'pp_line', field: 'amount', function: 'sum' } } },
    };
    const line = lineWith({ project: { type: 'master_detail', reference: 'pp_project' } });
    for (const order of [[line, PROJECT_TOTAL], [PROJECT_TOTAL, line]]) {
      const { engine } = await bootEngine();
      engine.registry.registerObject(PP_INVOICE as any);
      engine.registry.registerObject(order[0] as any);
      const err = await refusalOf(() => engine.registry.registerObject(order[1] as any));
      expect(envelopeOf(err)).toEqual(INVALID_METADATA);
      expect(err?.name).toBe('RecordCurrencySummaryRefusedError');
      expect(err?.objectName).toBe('pp_project');
      expect(err?.message).toContain("totals the rows of 'pp_project' records, not of the 'pp_invoice' record each row follows");
    }
  });

  it('a summary on the parent read through another relation back to it is refused, naming the relation', async () => {
    const { engine } = await bootEngine();
    engine.registry.registerObject(lineWith({ origin: { type: 'lookup', reference: 'pp_invoice' } }) as any);
    const err = await refusalOf(() => engine.registry.registerObject({
      ...PP_INVOICE,
      fields: {
        ...PP_INVOICE.fields,
        subtotal: { ...PP_INVOICE.fields.subtotal, summaryOperations: { ...PP_INVOICE.fields.subtotal.summaryOperations, relationshipField: 'origin' } },
      },
    } as any));
    expect(envelopeOf(err)).toEqual(INVALID_METADATA);
    expect(err?.message).toContain("goes through 'origin'");
    // The control: the same roll-up written through the master_detail the amount follows registers.
    engine.registry.registerObject({
      ...PP_INVOICE,
      fields: {
        ...PP_INVOICE.fields,
        subtotal: { ...PP_INVOICE.fields.subtotal, summaryOperations: { ...PP_INVOICE.fields.subtotal.summaryOperations, relationshipField: 'invoice' } },
      },
    } as any);
    expect(engine.registry.getObject('pp_invoice')).toBeDefined();
  });

  it('a roll-up one level up over the parent\'s roll-up is refused: each parent total is in its own currency', async () => {
    const { engine } = await bootEngine();
    engine.registry.registerObject({ ...PP_INVOICE, fields: { ...PP_INVOICE.fields, account: { type: 'master_detail', reference: 'pp_account' } } } as any);
    engine.registry.registerObject(PP_LINE as any);
    const err = await refusalOf(() => engine.registry.registerObject({
      name: 'pp_account',
      fields: { total: { type: 'summary', summaryOperations: { object: 'pp_invoice', field: 'subtotal', function: 'sum' } } },
    } as any));
    expect(envelopeOf(err)).toEqual(INVALID_METADATA);
    expect(err?.message).toContain("rolls up sum(pp_invoice.subtotal)");
    expect(err?.message).toContain("the code in 'currency_code'");
  });
});

describe('a record a child row follows keeps its code field (ADR-0144 D2, amended: the lock)', () => {
  let engine: ObjectQL;
  let storeFor: ReturnType<typeof makeDriver>['storeFor'];

  beforeEach(async () => {
    ({ engine, storeFor } = await bootFollowing({ bin: true }));
    await engine.insert('pp_line', { id: 'l_usd', title: 'batch', invoice: 'inv_usd', amount: 100 });
    await engine.insert('pp_line', { id: 'l_blank', title: 'n', invoice: 'inv_blank' });
  });

  const expectLocked = (err: Thrown, record: string, to: string) => {
    expect(httpOf(err)).toEqual(VALIDATION_FAILED);
    expect((err as any)?.fields?.map((f: any) => [f.field, f.code])).toEqual([['currency_code', 'invalid_value']]);
    expect(err?.message).toContain(`'currency_code' on 'pp_invoice' (record ${record}) cannot change from 'USD' to ${to}`);
    expect(err?.message).toContain("rows of 'pp_line' follow this record's currency");
    expect(err?.message).toContain('The code can change once no child row follows it');
  };

  it('by id: another code, or blank, is refused VALIDATION_FAILED / invalid_value, and nothing is written', async () => {
    expectLocked(await refusalOf(engine.update('pp_invoice', { id: 'inv_usd', currency_code: 'EUR' })), 'inv_usd', "'EUR'");
    expectLocked(await refusalOf(engine.update('pp_invoice', { id: 'inv_usd', currency_code: null })), 'inv_usd', 'blank');
    expect(storeFor('pp_invoice').get('inv_usd').currency_code).toBe('USD');
  });

  it('by predicate: a matched record a child follows refuses the whole write', async () => {
    expectLocked(await refusalOf(engine.update('pp_invoice', { currency_code: 'JPY' }, { where: { title: 'usd' }, multi: true })), 'inv_usd', "'JPY'");
    expect(storeFor('pp_invoice').get('inv_usd').currency_code).toBe('USD');
  });

  it('the same code again, a first code over a blank one, another field, and a record no child follows all pass', async () => {
    await engine.update('pp_invoice', { id: 'inv_usd', currency_code: 'USD', title: 'same' });
    await engine.update('pp_invoice', { id: 'inv_blank', currency_code: 'EUR' });
    await engine.update('pp_invoice', { id: 'inv_usd', billing_currency: 'GBP' });
    await engine.update('pp_invoice', { id: 'inv_eur', currency_code: 'JPY' });
    expect([...storeFor('pp_invoice').values()].map((r) => [r.id, r.currency_code])).toEqual([
      ['inv_usd', 'USD'], ['inv_eur', 'JPY'], ['inv_blank', 'EUR'],
    ]);
  });

  it('validate(): the update preview refuses what the write refuses', async () => {
    const preview = await engine.validate('pp_invoice', { id: 'inv_usd', currency_code: 'EUR' }, { mode: 'update' });
    expect(preview.valid).toBe(false);
    expect(preview.results?.[0]?.errors?.[0]).toMatchObject({ field: 'currency_code', code: 'invalid_value' });
  });

  it('a deleted line in the recycle bin still follows: the lock holds until it is purged, then lifts', async () => {
    await engine.delete('pp_line', { where: { id: 'l_usd' } } as any);
    expect(storeFor('pp_line').has('l_usd')).toBe(false);
    const [entry] = [...storeFor(RECYCLE_BIN_OBJECT).values()];
    expect(entry?.object_name).toBe('pp_line');
    const held = await refusalOf(engine.update('pp_invoice', { id: 'inv_usd', currency_code: 'EUR' }));
    expectLocked(held, 'inv_usd', "'EUR'");
    expect(held?.message).toContain('a deleted row in the recycle bin included');

    await engine.purge(entry.id, { context: { isSystem: true } } as any);
    await engine.update('pp_invoice', { id: 'inv_usd', currency_code: 'EUR' });
    expect(storeFor('pp_invoice').get('inv_usd').currency_code).toBe('EUR');
  });
});

// ── [ADR-0144 D2, amended] The parent a child amount follows is read through the writer's read door ──
//
// Review record 6773022506 on PR #32216, F1 and F2. A non-system writer that
// names a parent it cannot read (another owner's row, another organization's
// row) is answered `reference_not_found` before any currency verdict, exactly
// as a parent that exists nowhere: no missing-rate refusal naming the
// parent's currency, no blank-code refusal saying the parent has none. A
// writer with no read door (a system writer) never stores a following amount
// without a currency either: a parent its elevated read does not find is no
// code, and the amount is refused.

const ORG_X = 'org_x_acme';
const ORG_Y = 'org_y_globex';
const GP_INVOICE = {
  name: 'gp_invoice',
  fields: { title: { type: 'text' }, owner_name: { type: 'text' }, currency_code: CODE_FIELD },
};
const GP_LINE = {
  name: 'gp_line',
  fields: {
    title: { type: 'text' },
    invoice: { type: 'master_detail', reference: 'gp_invoice' },
    line_date: { type: 'date' },
    amount: {
      type: 'currency',
      currencyConfig: {
        currencyMode: 'record',
        currencyField: 'invoice.currency_code',
        homeAmount: { field: 'amount_home', rateDate: 'line_date', rateField: 'amount_rate' },
      },
    },
    amount_home: { type: 'currency', readonly: true },
    amount_rate: { type: 'number', readonly: true },
  },
};
/** Alice, a member of organization X, reads the invoices she owns. */
const ALICE = { context: { userId: 'alice', tenantId: ORG_X } } as const;
/** Carol's read of the invoice object fails outright. */
const CAROL = { context: { userId: 'carol', tenantId: ORG_X } } as const;
/** A system writer bound to organization X. */
const SYSTEM_X = { context: { isSystem: true, tenantId: ORG_X } } as const;

/** The guards' driver, scoped to the organization the driver options name (`SqlDriver.applyTenantScope`). */
function makeTenantDriver() {
  const d = makeDriver();
  const inScope = (row: Record<string, unknown>, options: any): boolean => {
    const tenantId = options?.tenantId;
    if (tenantId === undefined || tenantId === null || tenantId === '') return true;
    const own = row?.organization_id ?? null;
    return own === null || String(own) === String(tenantId);
  };
  const find = d.driver.find.bind(d.driver);
  d.driver.find = async (o: string, ast: any, options?: any) => (await find(o, ast)).filter((r: any) => inScope(r, options));
  d.driver.findOne = async (o: string, ast: any, options?: any) => (await d.driver.find(o, ast, options))[0] ?? null;
  return d;
}

async function bootGated() {
  const engine = new ObjectQL();
  engine.setTenancyPostureProvider(() => 'isolated');
  const d = makeTenantDriver();
  engine.registerDriver(d.driver, true);
  await engine.init();
  engine.registry.registerObject(GP_INVOICE as any);
  engine.registry.registerObject(GP_LINE as any);
  engine.setHomeLocalizationResolver(async () => ({ currency: 'CNY' }));
  // A non-system caller reads only the invoices it owns; Carol's read fails.
  engine.registerMiddleware(async (ctx: any, next: () => Promise<void>) => {
    if (ctx.object === 'gp_invoice' && ['find', 'findOne'].includes(ctx.operation) && ctx.context?.isSystem !== true) {
      if (ctx.context?.userId === 'carol') throw Object.assign(new Error('[Security] Access denied: read on gp_invoice'), { code: 'PERMISSION_DENIED', status: 403 });
      const scoped = { owner_name: ctx.context?.userId ?? '' };
      const ast: any = ctx.ast ?? { object: ctx.object };
      ast.where = ast.where ? { $and: [ast.where, scoped] } : scoped;
      ctx.ast = ast;
    }
    await next();
  });
  // No rate table is registered: an amount converted from any code but the home one (CNY) would be
  // refused ERR_EXCHANGE_RATE_MISSING naming that code, the oracle these pins rule out.
  const invoices = d.storeFor('gp_invoice');
  invoices.set('inv_mine', { id: 'inv_mine', title: 'mine', owner_name: 'alice', currency_code: 'CNY', organization_id: ORG_X });
  invoices.set('inv_hidden', { id: 'inv_hidden', title: 'hidden', owner_name: 'bob', currency_code: 'EUR', organization_id: ORG_X });
  invoices.set('inv_other_org', { id: 'inv_other_org', title: 'other org', owner_name: 'alice', currency_code: 'JPY', organization_id: ORG_Y });
  const lines = d.storeFor('gp_line');
  for (const [id, title] of [['l1', 'one'], ['b1', 'batch'], ['b2', 'batch']] as const) {
    lines.set(id, { id, title, invoice: 'inv_mine', line_date: '2026-03-15', amount: 10, amount_home: 10, amount_rate: 1, organization_id: ORG_X });
  }
  return { engine, storeFor: d.storeFor };
}

/** The answer with the parent's id taken out, so two refusals of two ids compare. */
const withoutId = (err: Thrown, id: string) => ({
  ...httpOf(err),
  fields: ((err as any)?.fields ?? []).map((f: any) => [f.field, f.code]),
  message: String(err?.message ?? '').split(id).join('ID'),
});

describe('a followed parent the writer cannot read answers reference_not_found before any currency verdict (F1)', () => {
  let engine: ObjectQL;
  let storeFor: ReturnType<typeof makeDriver>['storeFor'];

  beforeEach(async () => {
    ({ engine, storeFor } = await bootGated());
  });

  /** The reference check's answer for a parent that exists nowhere: the answer an unreadable one must give. */
  const nowhere = async () => withoutId(
    await refusalOf(engine.insert('gp_line', { title: 'n', invoice: 'inv_nowhere', line_date: '2026-03-15', amount: 5 }, ALICE as any)),
    'inv_nowhere',
  );
  const expectAsNowhere = async (err: Thrown, id: string) => {
    const answer = withoutId(err, id);
    expect(answer).toMatchObject({ code: 'VALIDATION_FAILED', status: 400, fields: [['invoice', 'reference_not_found']] });
    expect(answer.message).not.toMatch(/EUR|JPY|currenc|rate/i);
    expect(answer).toEqual(await nowhere());
  };

  it('the control: a line under an invoice the writer reads is written and converted', async () => {
    const row = await engine.insert('gp_line', { title: 'ok', invoice: 'inv_mine', line_date: '2026-03-15', amount: 5 }, ALICE as any);
    expect(storeFor('gp_line').get(row.id)).toMatchObject({ amount_home: 5, amount_rate: 1 });
  });

  for (const [parent, why] of [['inv_hidden', 'another owner\'s invoice'], ['inv_other_org', 'another organization\'s invoice']] as const) {
    it(`insert under ${why}`, async () => {
      const before = storeFor('gp_line').size;
      await expectAsNowhere(await refusalOf(engine.insert('gp_line', { title: 'x', invoice: parent, line_date: '2026-03-15', amount: 5 }, ALICE as any)), parent);
      expect(storeFor('gp_line').size).toBe(before);
    });

    it(`by-id update moving a line under ${why}`, async () => {
      await expectAsNowhere(await refusalOf(engine.update('gp_line', { id: 'l1', invoice: parent }, ALICE as any)), parent);
      expect(storeFor('gp_line').get('l1')).toMatchObject({ invoice: 'inv_mine', amount_home: 10 });
    });

    it(`predicate update moving lines under ${why}`, async () => {
      await expectAsNowhere(await refusalOf(engine.update('gp_line', { invoice: parent }, { where: { title: 'batch' }, multi: true, ...ALICE } as any)), parent);
      expect(storeFor('gp_line').get('b1')).toMatchObject({ invoice: 'inv_mine' });
    });

    it(`the validate() previews of an insert and an update under ${why}`, async () => {
      const inserted = await engine.validate('gp_line', { title: 'x', invoice: parent, line_date: '2026-03-15', amount: 5 }, ALICE as any);
      const moved = await engine.validate('gp_line', { id: 'l1', invoice: parent }, { mode: 'update', ...ALICE } as any);
      for (const preview of [inserted, moved]) {
        expect(preview.valid).toBe(false);
        expect(preview.results?.[0]?.errors?.map((e) => [e.field, e.code])).toEqual([['invoice', 'reference_not_found']]);
        expect(JSON.stringify(preview.results?.[0]?.errors)).not.toMatch(/EUR|JPY|currenc|rate/i);
      }
    });
  }

  it('a read door that fails answers as one that returns nothing: reference_not_found, no currency', async () => {
    const err = await refusalOf(engine.insert('gp_line', { title: 'c', invoice: 'inv_hidden', line_date: '2026-03-15', amount: 5 }, CAROL as any));
    expect(withoutId(err, 'inv_hidden')).toMatchObject({ code: 'VALIDATION_FAILED', status: 400, fields: [['invoice', 'reference_not_found']] });
    expect(String(err?.message)).not.toMatch(/EUR|currenc|rate/i);
  });
});

describe('no following amount is stored without a currency, whoever writes it (F2)', () => {
  let engine: ObjectQL;
  let storeFor: ReturnType<typeof makeDriver>['storeFor'];

  beforeEach(async () => {
    ({ engine, storeFor } = await bootGated());
  });

  it('a system insert naming a parent that is not there, or one in another organization, is refused ERR_CURRENCY_CODE_REQUIRED', async () => {
    for (const parent of ['inv_nowhere', 'inv_other_org']) {
      const before = storeFor('gp_line').size;
      const err = await refusalOf(engine.insert('gp_line', { title: 's', invoice: parent, line_date: '2026-03-15', amount: 5 }, SYSTEM_X as any));
      expect(envelopeOf(err), parent).toEqual(CODE_REQUIRED);
      expect(err?.field).toBe('invoice.currency_code');
      expect(storeFor('gp_line').size, parent).toBe(before);
    }
  });

  it('a system update moving a line under a parent that is not there is refused, and the old home amount is not kept beside it', async () => {
    const err = await refusalOf(engine.update('gp_line', { id: 'l1', invoice: 'inv_nowhere' }, SYSTEM_X as any));
    expect(envelopeOf(err)).toEqual(CODE_REQUIRED);
    expect(storeFor('gp_line').get('l1')).toMatchObject({ invoice: 'inv_mine', amount_home: 10, amount_rate: 1 });
  });

  it('an update that would convert a line again (its document date) is judged too: under a parent that is gone it is refused', async () => {
    storeFor('gp_line').set('orphan', { id: 'orphan', title: 'o', invoice: 'inv_gone', line_date: '2026-03-15', amount: 7, amount_home: 7, amount_rate: 1, organization_id: ORG_X });
    const err = await refusalOf(engine.update('gp_line', { id: 'orphan', line_date: '2026-04-01' }, SYSTEM_X as any));
    expect(envelopeOf(err)).toEqual(CODE_REQUIRED);
    expect(storeFor('gp_line').get('orphan')).toMatchObject({ line_date: '2026-03-15', amount_home: 7 });
    // The control: under a parent with a code, the same update converts again.
    await engine.update('gp_line', { id: 'l1', line_date: '2026-04-01' }, SYSTEM_X as any);
    expect(storeFor('gp_line').get('l1')).toMatchObject({ line_date: '2026-04-01', amount_home: 10, amount_rate: 1 });
  });

  it('a parent named by a value that is no row id reads as no code', async () => {
    const follow = await followParentCurrencyCodes(
      recordCurrencyPairs(GP_LINE.fields),
      [{ invoice: { id: 'inv_mine' } }, { invoice: ['inv_mine'] }],
      async () => new Map([['inv_mine', { id: 'inv_mine', currency_code: 'CNY' }]]),
    );
    for (const invoice of [{ id: 'inv_mine' }, ['inv_mine']]) {
      const image = follow({ invoice, amount: 5 });
      expect(image['invoice.currency_code']).toBeNull();
      const err = await refusalOf(() => assertRecordCurrencyCodes('gp_line', GP_LINE.fields, image, 'insert'));
      expect(envelopeOf(err)).toEqual(CODE_REQUIRED);
    }
  });
});

describe('the roll-up channel rides one concrete parent id (F3)', () => {
  it('aggregateSummaryValue, a public export, admits one parent\'s total and refuses a cross-parent sum', async () => {
    const { engine } = await bootFollowing();
    await engine.insert('pp_line', { title: 'u', invoice: 'inv_usd', amount: 100 });
    await engine.insert('pp_line', { title: 'e', invoice: 'inv_eur', amount: 100 });
    const desc = { parentObject: 'pp_invoice', summaryField: 'subtotal', childObject: 'pp_line', fkField: 'invoice', fn: 'sum', sourceField: 'amount' } as const;
    expect(await aggregateSummaryValue(engine as never, desc as never, 'inv_usd')).toBe(100);
    for (const parentId of [{ $ne: null }, { $in: ['inv_usd', 'inv_eur'] }, '']) {
      const err = await refusalOf(aggregateSummaryValue(engine as never, desc as never, parentId as never));
      expect(envelopeOf(err), JSON.stringify(parentId)).toEqual(INVALID_FIELD);
      expect(err?.field).toBe('amount');
    }
  });
});

// ── [ADR-0144 D2 and D6, amended] The follow door: what `defineStack` judges across two objects, at a single-object save ──

describe('a single-object save is refused when the currency it follows is not there (ADR-0144 D2 and D6, amended: the follow door)', () => {
  /** A registry past its cold boot: the seal the engine plugin sets at `kernel:bootstrapped`. */
  async function bootSealed() {
    const booted = await bootEngine();
    booted.engine.registry.sealBareNameHolders();
    return booted;
  }
  const lineFollowing = (pointer: string) => ({
    ...PP_LINE,
    fields: { ...PP_LINE.fields, amount: { type: 'currency', currencyConfig: { currencyMode: 'record', currencyField: pointer } } },
  });
  const invoiceWithout = (field: string) => {
    const fields: Record<string, unknown> = { ...PP_INVOICE.fields };
    delete fields[field];
    return { ...PP_INVOICE, fields };
  };
  /** The same pair through `defineStack`: its one cross-reference finding. */
  const stackFinding = (objects: unknown[]): string => {
    try {
      defineStack({ manifest: { id: 'com.example.followdoor', name: 'follow-door', version: '1.0.0', type: 'app' }, objects } as Parameters<typeof defineStack>[0]);
    } catch (e) {
      const issues = (e as { issues?: unknown[] }).issues ?? [];
      expect(issues).toHaveLength(1);
      return String(issues[0]);
    }
    throw new Error('defineStack accepted the pair');
  };
  const FOLLOW_REFUSED = 'RecordCurrencyFollowRefusedError';

  it('a child whose path names no field of the registered parent is refused 422 at its save, in defineStack\'s words', async () => {
    const { engine } = await bootSealed();
    engine.registry.registerObject(PP_INVOICE as any);
    const child = lineFollowing('invoice.currency');
    const err = await refusalOf(() => engine.registry.registerObject(child as any));
    expect(envelopeOf(err)).toEqual(INVALID_METADATA);
    expect(err?.name).toBe(FOLLOW_REFUSED);
    expect(err?.objectName).toBe('pp_line');
    expect(err?.fieldName).toBe('amount');
    expect(err?.message).toBe(stackFinding([PP_INVOICE, child]));
    expect(err?.message).toContain("'pp_invoice' declares no field 'currency'");
    expect(engine.registry.getObject('pp_line')).toBeUndefined();
  });

  it('a child whose path names a field that holds no ISO 4217 code is refused 422 at its save, in defineStack\'s words', async () => {
    const { engine } = await bootSealed();
    engine.registry.registerObject(PP_INVOICE as any);
    const child = lineFollowing('invoice.title');
    const err = await refusalOf(() => engine.registry.registerObject(child as any));
    expect(envelopeOf(err)).toEqual(INVALID_METADATA);
    expect(err?.name).toBe(FOLLOW_REFUSED);
    expect(err?.message).toBe(stackFinding([PP_INVOICE, child]));
    expect(err?.message).toContain("follows 'pp_invoice.title', a 'text' field that does not hold an ISO 4217 code");
    expect(engine.registry.getObject('pp_line')).toBeUndefined();
  });

  it('the parent registering, or re-registering, without the code field a registered child follows is refused at its save', async () => {
    // Child first: no parent yet, so no verdict at the child.
    const first = await bootSealed();
    first.engine.registry.registerObject(PP_LINE as any);
    expect(first.engine.registry.getObject('pp_line')).toBeDefined();
    const late = await refusalOf(() => first.engine.registry.registerObject(invoiceWithout('currency_code') as any));
    expect(envelopeOf(late)).toEqual(INVALID_METADATA);
    expect(late?.name).toBe(FOLLOW_REFUSED);
    expect(late?.objectName).toBe('pp_line');
    expect(late?.message).toContain("'pp_invoice' would no longer hold the code a registered amount follows.");
    expect(late?.message).toContain("'pp_invoice' declares no field 'currency_code'");
    expect(first.engine.registry.getObject('pp_invoice')).toBeUndefined();

    // Re-registration: the registered parent stays as it was.
    const { engine } = await bootSealed();
    engine.registry.registerObject(PP_INVOICE as any);
    engine.registry.registerObject(PP_LINE as any);
    const demoted = { ...PP_INVOICE, fields: { ...PP_INVOICE.fields, currency_code: { type: 'text' } } };
    const err = await refusalOf(() => engine.registry.registerObject(demoted as any));
    expect(envelopeOf(err)).toEqual(INVALID_METADATA);
    expect(err?.message).toContain("a 'text' field that does not hold an ISO 4217 code");
    expect((engine.registry.getObject('pp_invoice')?.fields as any)?.currency_code?.valueDomain).toBe('iso_4217_currency');
  });

  it('a `record` roll-up over a child amount that follows nothing is refused, whichever end registers second', async () => {
    const cases = [
      { label: 'fixed', amount: { type: 'currency', currencyConfig: { currencyMode: 'fixed', defaultCurrency: 'EUR' } }, says: 'is fixed to EUR' },
      { label: 'no currency', amount: { type: 'number' }, says: 'declares no currency that follows this record' },
    ];
    for (const { label, amount, says } of cases) {
      const child = { ...PP_LINE, fields: { ...PP_LINE.fields, amount } };
      for (const order of [[child, PP_INVOICE], [PP_INVOICE, child]]) {
        const { engine } = await bootSealed();
        engine.registry.registerObject(order[0] as any);
        const err = await refusalOf(() => engine.registry.registerObject(order[1] as any));
        const at = `${label}, ${(order[1] as { name: string }).name} second`;
        expect(envelopeOf(err), at).toEqual(INVALID_METADATA);
        expect(err?.name, at).toBe(FOLLOW_REFUSED);
        expect(err?.objectName, at).toBe('pp_invoice');
        expect(err?.fieldName, at).toBe('subtotal');
        expect(err?.message, at).toBe(stackFinding([PP_INVOICE, child]));
        expect(err?.message, at).toContain(says);
        expect(engine.registry.getObject((order[1] as { name: string }).name), at).toBeUndefined();
      }
    }
  });

  it('a `record` roll-up over a child amount in its own record currency was already refused by D6 (pinned, not re-judged)', async () => {
    const child = { ...PP_LINE, fields: { ...PP_LINE.fields, currency_code: CODE_FIELD, amount: { type: 'currency', currencyConfig: RECORD } } };
    for (const sealed of [false, true]) {
      const { engine } = sealed ? await bootSealed() : await bootEngine();
      engine.registry.registerObject(child as any);
      const err = await refusalOf(() => engine.registry.registerObject(PP_INVOICE as any));
      expect(envelopeOf(err), String(sealed)).toEqual(INVALID_METADATA);
      expect(err?.name, String(sealed)).toBe('RecordCurrencySummaryRefusedError');
    }
  });

  it('CONTROL: a path to a code field, and the roll-up through that master_detail, register in either order', async () => {
    for (const order of [[PP_INVOICE, PP_LINE], [PP_LINE, PP_INVOICE]]) {
      const { engine } = await bootSealed();
      for (const o of order) engine.registry.registerObject(o as any);
      expect(engine.registry.getObject('pp_invoice')).toBeDefined();
      expect(engine.registry.getObject('pp_line')).toBeDefined();
    }
    // A summary declaring no currency over a fixed amount is not judged here.
    const { engine } = await bootSealed();
    engine.registry.registerObject({ ...PP_LINE, fields: { ...PP_LINE.fields, amount: { type: 'number' } } } as any);
    const plain = { ...PP_INVOICE, fields: { ...PP_INVOICE.fields, subtotal: { ...PP_INVOICE.fields.subtotal, currencyConfig: undefined } } };
    engine.registry.registerObject(plain as any);
    expect(engine.registry.getObject('pp_invoice')).toBeDefined();
  });

  it('CONTROL: a code field the parent gets from a registered extension counts, and an extension body is judged only on its own roll-ups', async () => {
    const { engine } = await bootSealed();
    engine.registry.registerObject(invoiceWithout('currency_code') as any, 'pkg_owner');
    engine.registry.registerObject({ name: 'pp_invoice', fields: { currency_code: CODE_FIELD } } as any, 'pkg_ext', undefined, 'extend');
    engine.registry.registerObject(PP_LINE as any);
    expect(engine.registry.getObject('pp_line')).toBeDefined();
    // The owner re-registering keeps the extension's code field under it.
    engine.registry.registerObject(invoiceWithout('currency_code') as any, 'pkg_owner');
    expect(engine.registry.getObject('pp_invoice')).toBeDefined();
  });

  it('during the cold boot nothing is judged: the boot registers what it registered before the seal', async () => {
    const { engine } = await bootEngine();
    engine.registry.registerObject(PP_INVOICE as any);
    engine.registry.registerObject(lineFollowing('invoice.title') as any);
    expect(engine.registry.getObject('pp_line')).toBeDefined();
    engine.registry.registerObject(invoiceWithout('currency_code') as any);
    expect(engine.registry.getObject('pp_invoice')).toBeDefined();
  });
});
