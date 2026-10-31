// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// `os migrate record-currency-codes` — the explicit backfill of the currency
// code a `record`-mode amount owes on rows stored before the switch (ADR-0144,
// ruling 6492000994, letter B).
//
// Every fixture writes its rows STRAIGHT INTO THE DRIVER STORE, bypassing the
// engine's insert path, which is exactly what a database holds after an
// existing `dynamic` / `fixed` amount was switched to `record`: amounts stored
// when no code was owed. Inserting them through the engine now would be
// refused (`ERR_CURRENCY_CODE_REQUIRED`), and there would be nothing to test.
// The backfill's writes go through the real engine, so its own record-mode
// guard and the code field's `valueDomain` judge each one.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ObjectQL } from './engine.js';
import {
  backfillRecordCurrencyCodes,
  formatRecordCurrencyBackfillReport,
  recordCurrencyBackfillComplete,
} from './record-currency-backfill.js';

function makeDriver() {
  const stores = new Map<string, Map<string, any>>();
  const writes: Array<{ object: string; id: string; data: Record<string, unknown> }> = [];
  const storeFor = (o: string) => {
    let s = stores.get(o);
    if (!s) { s = new Map(); stores.set(o, s); }
    return s;
  };
  // Implicit equality plus the comparison operators the keyset walk emits.
  const checkOp = (value: any, cond: any): boolean => {
    if (cond === null || typeof cond !== 'object' || Array.isArray(cond) || cond instanceof Date) {
      return value === cond;
    }
    return Object.entries(cond).every(([op, target]: [string, any]) => {
      switch (op) {
        case '$eq': return value === target;
        case '$ne': return value !== target;
        case '$gt': return value > target;
        case '$gte': return value >= target;
        case '$lt': return value < target;
        case '$lte': return value <= target;
        case '$in': return Array.isArray(target) && target.includes(value);
        case '$nin': return Array.isArray(target) && !target.includes(value);
        default: return true;
      }
    });
  };
  const matches = (row: any, where: any): boolean => {
    if (!where || typeof where !== 'object') return true;
    return Object.entries(where).every(([k, v]: [string, any]) => {
      if (k === '$and') return (v as any[]).every((w) => matches(row, w));
      if (k === '$or') return (v as any[]).some((w) => matches(row, w));
      if (k === '$not') return !matches(row, v);
      return checkOp(row?.[k], v);
    });
  };
  let failUpdateFor: string | null = null;
  const driver: any = {
    name: 'memory', version: '0.0.0', supports: {},
    async connect() {}, async disconnect() {}, async checkHealth() { return true; }, async execute() { return null; },
    async find(object: string, ast: any) {
      // Rows are seeded in id order and never re-keyed, so the store's order is
      // the `id` order the keyset walk seeks by.
      const rows = Array.from(storeFor(object).values()).filter((r) => matches(r, ast?.where));
      return typeof ast?.limit === 'number' ? rows.slice(0, ast.limit) : rows;
    },
    async findOne(object: string, ast: any) {
      for (const r of storeFor(object).values()) if (matches(r, ast?.where)) return r;
      return null;
    },
    async create(object: string, data: Record<string, unknown>) {
      const row = { ...data };
      storeFor(object).set(String(row.id), row);
      return row;
    },
    async update(object: string, id: string, data: Record<string, unknown>) {
      if (failUpdateFor && id === failUpdateFor) throw new Error('driver refused this row');
      writes.push({ object, id, data });
      const s = storeFor(object);
      const row = { ...s.get(id), ...data, id };
      s.set(id, row);
      return row;
    },
    async delete(object: string, id: string) { return storeFor(object).delete(id); },
    async count() { return 0; },
    async bulkCreate(object: string, rows: Record<string, unknown>[]) {
      return Promise.all(rows.map((r) => this.create(object, r, undefined)));
    },
    async bulkUpdate() { return []; }, async bulkDelete() {},
    async beginTransaction() { return { __trx: true, commit: async () => {}, rollback: async () => {} }; },
    async commit() {}, async rollback() {},
  };
  return {
    driver,
    storeFor,
    writes,
    failUpdateFor: (id: string | null) => { failUpdateFor = id; },
  };
}

const quietLogger = { info: () => {}, warn: () => {} };

describe('backfillRecordCurrencyCodes — rows stored before the switch to record mode', () => {
  let engine: ObjectQL;
  let d: ReturnType<typeof makeDriver>;

  /** A row as the database holds it after the switch: written before any code was owed. */
  const stored = (id: string, row: Record<string, unknown>) => {
    d.storeFor('deal').set(id, { id, name: id, ...row });
  };
  const deal = (id: string) => d.storeFor('deal').get(id);
  /** Every row read the driver was asked for, counted beside the double rather than inside it. */
  const reads = () => vi.mocked(d.driver.find).mock.calls.length + vi.mocked(d.driver.findOne).mock.calls.length;

  beforeEach(async () => {
    engine = new ObjectQL();
    d = makeDriver();
    vi.spyOn(d.driver, 'find');
    vi.spyOn(d.driver, 'findOne');
    engine.registerDriver(d.driver, true);
    await engine.init();
    engine.registry.registerObject({
      name: 'deal',
      fields: {
        name: { type: 'text' },
        amount: { type: 'currency', currencyConfig: { currencyMode: 'record', currencyField: 'currency_code' } },
        currency_code: { type: 'text', valueDomain: 'iso_4217_currency' },
        // Still `dynamic`: it owes no code, and a run naming it is refused.
        budget: { type: 'currency', currencyConfig: { currencyMode: 'dynamic' } },
      },
    } as any);
  });

  /** The state every case starts from: one row of each kind the walk tells apart. */
  const seedMixed = () => {
    stored('d1', { amount: 120 });                           // codeless — filled
    stored('d2', { amount: 0, currency_code: null });        // 0 is an amount — filled
    stored('d3', { amount: 75, currency_code: '   ' });      // white space is no code — filled
    stored('d4', { amount: 300, currency_code: 'EUR' });     // holds a code — never touched
    stored('d5', { amount: null });                          // no amount — no code owed
    stored('d6', { currency_code: 'JPY' });                  // code and no amount — never touched
  };

  it('a dry run counts every kind of row and writes nothing', async () => {
    seedMixed();
    const report = await backfillRecordCurrencyCodes(engine, quietLogger, {
      object: 'deal', field: 'amount', code: 'USD',
    });

    expect(report).toMatchObject({
      object: 'deal', field: 'amount', codeField: 'currency_code', code: 'USD',
      scannedRecords: 6, codeless: 3, written: 0, skippedCodePresent: 2, skippedAmountBlank: 1,
      applied: false, truncated: false, failures: [],
    });
    expect(report.sampleRecordIds).toEqual(['d1', 'd2', 'd3']);
    expect(d.writes).toEqual([]);
    expect(deal('d1').currency_code).toBeUndefined();
  });

  it('--apply writes the supplied code into the codeless rows only, through the engine', async () => {
    seedMixed();
    const report = await backfillRecordCurrencyCodes(engine, quietLogger, {
      object: 'deal', field: 'amount', code: 'USD', apply: true,
    });

    expect(report).toMatchObject({ codeless: 3, written: 3, skippedCodePresent: 2, skippedAmountBlank: 1, applied: true });
    expect(deal('d1').currency_code).toBe('USD');
    expect(deal('d2').currency_code).toBe('USD');
    expect(deal('d3').currency_code).toBe('USD');
    // A row holding a code keeps it; a blank amount gets none.
    expect(deal('d4').currency_code).toBe('EUR');
    expect(deal('d5').currency_code).toBeUndefined();
    expect(deal('d6').currency_code).toBe('JPY');
    expect(d.writes.map((w) => w.id).sort()).toEqual(['d1', 'd2', 'd3']);
    // The amounts are the rows' own and are never rewritten.
    expect(deal('d1').amount).toBe(120);
    expect(recordCurrencyBackfillComplete(report)).toBe(true);
  });

  it('is idempotent — a second run finds nothing left and writes nothing', async () => {
    seedMixed();
    await backfillRecordCurrencyCodes(engine, quietLogger, { object: 'deal', field: 'amount', code: 'USD', apply: true });
    const writesAfterFirst = d.writes.length;

    const again = await backfillRecordCurrencyCodes(engine, quietLogger, {
      object: 'deal', field: 'amount', code: 'USD', apply: true,
    });
    expect(again).toMatchObject({ codeless: 0, written: 0, skippedCodePresent: 5, skippedAmountBlank: 1 });
    expect(d.writes.length).toBe(writesAfterFirst);
    expect(formatRecordCurrencyBackfillReport(again)).toContain(
      '✓ Every deal.amount amount already has its currency code — nothing to backfill.',
    );
  });

  it('a code that is not an ISO 4217 member is refused before any row is read', async () => {
    seedMixed();
    for (const code of ['usd', 'XYZ', 'US', ' USD', '']) {
      const before = reads();
      const err = await backfillRecordCurrencyCodes(engine, quietLogger, {
        object: 'deal', field: 'amount', code, apply: true,
      }).then(() => null, (e: unknown) => e as Record<string, unknown>);
      expect(err, code).toMatchObject({ code: 'INVALID_FIELD', status: 400, httpStatus: 400, field: 'currency_code' });
      expect(String(err?.message)).toContain('Refused before the walk read or wrote any row.');
      expect(reads(), code).toBe(before);
    }
    expect(d.writes).toEqual([]);
  });

  it('a field that is not a record-mode currency field is refused before any row is read', async () => {
    seedMixed();
    for (const field of ['budget', 'name', 'nope']) {
      const err = await backfillRecordCurrencyCodes(engine, quietLogger, {
        object: 'deal', field, code: 'USD', apply: true,
      }).then(() => null, (e: unknown) => e as Record<string, unknown>);
      expect(err, field).toMatchObject({ code: 'INVALID_FIELD', status: 400, field });
      expect(String(err?.message)).toContain(`'deal.${field}' is not a record-mode currency field`);
    }
    expect(reads()).toBe(0);
    expect(d.writes).toEqual([]);
  });

  it('an object the registry does not declare is refused with OBJECT_NOT_FOUND', async () => {
    await expect(backfillRecordCurrencyCodes(engine, quietLogger, {
      object: 'nope', field: 'amount', code: 'USD',
    })).rejects.toMatchObject({ code: 'OBJECT_NOT_FOUND', status: 404, object: 'nope' });
  });

  it('one row whose write fails is reported and does not stop the rest; a re-run finishes it', async () => {
    seedMixed();
    d.failUpdateFor('d2');
    const report = await backfillRecordCurrencyCodes(engine, quietLogger, {
      object: 'deal', field: 'amount', code: 'USD', apply: true,
    });
    expect(report.written).toBe(2);
    expect(report.failures).toEqual([{ recordId: 'd2', error: expect.stringContaining('driver refused this row') }]);
    expect(recordCurrencyBackfillComplete(report)).toBe(false);
    expect(deal('d2').currency_code).toBeNull();

    d.failUpdateFor(null);
    const again = await backfillRecordCurrencyCodes(engine, quietLogger, {
      object: 'deal', field: 'amount', code: 'USD', apply: true,
    });
    expect(again).toMatchObject({ codeless: 1, written: 1, failures: [] });
    expect(deal('d2').currency_code).toBe('USD');
  });

  it('the dry-run report names what it would write, what it skipped, and claims no row or table', async () => {
    seedMixed();
    const report = await backfillRecordCurrencyCodes(engine, quietLogger, { object: 'deal', field: 'amount', code: 'USD' });
    expect(formatRecordCurrencyBackfillReport(report)).toEqual([
      'Scanned 6 row(s) of deal for an amount in amount beside a blank currency code in currency_code.',
      'Would write USD into currency_code on 3 codeless row(s).',
      '  e.g. d1, d2, d3',
      '· Skipped: 2 row(s) already holding a code (never overwritten), 1 row(s) with a blank amount (no code owed).',
      'Dry run — no row or table was written. Re-run with --apply to backfill.',
    ]);
  });
});
