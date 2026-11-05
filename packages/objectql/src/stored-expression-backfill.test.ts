// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// #29961 — `os migrate stored-expressions`: a stored computed field declared
// on an object that already holds rows is NULL on every one of them, because
// the engine computes it on writes only.
//
// Every fixture builds the state the run exists for: rows written STRAIGHT
// INTO THE DRIVER STORE, as an upgraded database holds them — stored before
// the field was declared, never written since. Inserting them through the
// engine would compute the field and leave nothing to fill.
//
// The engine is the real one, over an in-file driver; the values compared are
// the ones a write of the same row stores.

import { describe, it, expect, beforeEach } from 'vitest';
import { ObjectQL } from './engine.js';
import {
  announceStoredExpressionHoles,
  backfillStoredExpressions,
  formatStoredExpressionBackfillReport,
  sameStoredValue,
  storedExpressionBackfillComplete,
} from './stored-expression-backfill.js';

function makeDriver() {
  const stores = new Map<string, Map<string, any>>();
  const writes: Array<{ object: string; id: string; data: Record<string, unknown> }> = [];
  const storeFor = (o: string) => {
    let s = stores.get(o);
    if (!s) { s = new Map(); stores.set(o, s); }
    return s;
  };
  // Implicit equality, the comparison operators the keyset walk emits (`$gt` on `id`), and `$in`.
  const checkOp = (value: any, cond: any): boolean => {
    if (cond === null || typeof cond !== 'object' || Array.isArray(cond) || cond instanceof Date) return value === cond;
    return Object.entries(cond).every(([op, target]: [string, any]) => {
      switch (op) {
        case '$eq': return value === target;
        case '$ne': return value !== target;
        case '$gt': return value > target;
        case '$in': return Array.isArray(target) && target.includes(value);
        default: return true;
      }
    });
  };
  const matches = (row: any, where: any): boolean => {
    if (!where || typeof where !== 'object') return true;
    return Object.entries(where).every(([k, v]: [string, any]) => {
      if (k === '$and') return (v as any[]).every((w) => matches(row, w));
      if (k === '$or') return (v as any[]).some((w) => matches(row, w));
      return checkOp(row?.[k], v);
    });
  };
  let failFind: string | null = null;
  let failUpdateFor: string | null = null;
  const driver: any = {
    name: 'memory', version: '0.0.0', supports: {},
    async connect() {}, async disconnect() {}, async checkHealth() { return true; }, async execute() { return null; },
    async find(object: string, ast: any) {
      if (failFind === object) throw new Error('driver cannot read this table');
      const rows = Array.from(storeFor(object).values()).filter((r) => matches(r, ast?.where));
      rows.sort((a, b) => String(a.id).localeCompare(String(b.id)));
      return typeof ast?.limit === 'number' ? rows.slice(0, ast.limit) : rows;
    },
    async findOne(object: string, ast: any) {
      for (const r of storeFor(object).values()) if (matches(r, ast?.where)) return r;
      return null;
    },
    async create(object: string, data: Record<string, unknown>) {
      const row = { ...data, id: data.id as string };
      storeFor(object).set(row.id, row);
      return row;
    },
    async update(object: string, id: string, data: Record<string, unknown>) {
      if (failUpdateFor === id) throw new Error('driver refused this row');
      writes.push({ object, id, data });
      const s = storeFor(object);
      const row = { ...s.get(id), ...data, id };
      s.set(id, row);
      return row;
    },
    async delete(object: string, id: string) { return storeFor(object).delete(id); },
    async count() { return 0; },
    async bulkCreate() { return []; }, async bulkUpdate() { return []; }, async bulkDelete() {},
    async beginTransaction() { return { __trx: true, commit: async () => {}, rollback: async () => {} }; },
    async commit() {}, async rollback() {},
  };
  return {
    driver,
    storeFor,
    writes,
    failFind: (object: string | null) => { failFind = object; },
    failUpdateFor: (id: string | null) => { failUpdateFor = id; },
  };
}

const quietLogger = { info: () => {}, warn: () => {} };
const cel = (source: string) => ({ dialect: 'cel', source });

describe('backfillStoredExpressions — stored computed fields on rows stored before the field (#29961)', () => {
  let engine: ObjectQL;
  let d: ReturnType<typeof makeDriver>;
  const contract = (id: string) => d.storeFor('contract').get(id);

  beforeEach(async () => {
    engine = new ObjectQL();
    d = makeDriver();
    engine.registerDriver(d.driver, true);
    await engine.init();
    engine.registry.registerObject({
      name: 'contract_type',
      fields: { name: { type: 'text' }, review_sla_days: { type: 'number' } },
    } as any);
    engine.registry.registerObject({
      name: 'contract',
      fields: {
        name: { type: 'text' },
        qty: { type: 'number' },
        contract_type: { type: 'lookup', reference: 'contract_type' },
        updated_at: { type: 'datetime' },
        // The hotclm shape: an offset read through a lookup.
        review_sla_days_offset: { type: 'number', expression: cel('0 - record.contract_type.review_sla_days') },
        qty_double: { type: 'number', expression: cel('record.qty * 2') },
        // Read on every read; it has no column and is never a backfill's.
        qty_label: { type: 'formula', expression: cel("string(record.qty) + ' pcs'") },
      },
    } as any);
    engine.registry.registerObject({ name: 'note', fields: { body: { type: 'text' } } } as any);
    d.storeFor('contract_type').set('t1', { id: 't1', name: 'NDA', review_sla_days: 5 });
    // Stored before the two fields were declared: neither column holds a value.
    d.storeFor('contract').set('c1', { id: 'c1', name: 'c1', qty: 1, contract_type: 't1', updated_at: '2026-01-01T00:00:00.000Z' });
    d.storeFor('contract').set('c2', { id: 'c2', name: 'c2', qty: 2, contract_type: 't1', updated_at: '2026-01-02T00:00:00.000Z' });
    // No contract type: the offset's own value is NULL here (the hop has nothing to read).
    d.storeFor('contract').set('c3', { id: 'c3', name: 'c3', qty: 3, contract_type: null, updated_at: '2026-01-03T00:00:00.000Z' });
  });

  it('a dry run counts each NULL the expression fills and writes nothing', async () => {
    const report = await backfillStoredExpressions(engine, quietLogger);

    expect(report.applied).toBe(false);
    expect(report.scannedObjects).toEqual(['contract']);
    expect(report.scannedRecords).toBe(3);
    const byField = Object.fromEntries(report.fields.map((f) => [f.field, f]));
    expect(byField.qty_double).toMatchObject({ nullRows: 3, written: 0 });
    // c3's NULL is the expression's own value (an empty reference), not a hole.
    expect(byField.review_sla_days_offset).toMatchObject({ nullRows: 2, faultedRows: 1, written: 0 });
    expect(byField.review_sla_days_offset.sampleRecordIds).toEqual(['c1', 'c2']);
    expect(report.fields.map((f) => f.field)).not.toContain('qty_label');
    expect(report.nullRows).toBe(5);
    expect(d.writes).toEqual([]);
    expect(contract('c1').qty_double).toBeUndefined();
    expect(formatStoredExpressionBackfillReport(report).at(-1)).toMatch(/^Dry run — no row or table was written\./);
    expect(storedExpressionBackfillComplete(report)).toBe(false);
  });

  it('--apply fills each hole with what a write stores, keeps updated_at, and a re-run finds nothing', async () => {
    const report = await backfillStoredExpressions(engine, quietLogger, { apply: true });

    expect(report.writtenRows).toBe(3);
    expect(report.failures).toEqual([]);
    expect(contract('c1')).toMatchObject({ qty_double: 2, review_sla_days_offset: -5, updated_at: '2026-01-01T00:00:00.000Z' });
    expect(contract('c2')).toMatchObject({ qty_double: 4, review_sla_days_offset: -5, updated_at: '2026-01-02T00:00:00.000Z' });
    expect(contract('c3').qty_double).toBe(6);
    expect(contract('c3').review_sla_days_offset ?? null).toBeNull();
    expect(storedExpressionBackfillComplete(report)).toBe(true);

    const again = await backfillStoredExpressions(engine, quietLogger);
    expect(again.nullRows).toBe(0);
    expect(again.staleRows).toBe(0);
    expect(storedExpressionBackfillComplete(again)).toBe(true);
  });

  it('a value the expression no longer gives is counted on every run and rewritten only under changed', async () => {
    await backfillStoredExpressions(engine, quietLogger, { apply: true });
    engine.registry.registerObject({
      name: 'contract',
      fields: { ...(engine.getObject('contract') as any).fields, qty_double: { type: 'number', expression: cel('record.qty * 3') } },
    } as any);
    d.writes.length = 0;

    const plain = await backfillStoredExpressions(engine, quietLogger, { apply: true });
    expect(plain.staleRows).toBe(3);
    expect(plain.writtenRows).toBe(0);
    expect(contract('c1').qty_double).toBe(2);
    expect(formatStoredExpressionBackfillReport(plain).join('\n')).toContain('re-run with --changed');

    const changed = await backfillStoredExpressions(engine, quietLogger, { apply: true, changed: true });
    expect(changed.writtenRows).toBe(3);
    expect([contract('c1').qty_double, contract('c2').qty_double, contract('c3').qty_double]).toEqual([3, 6, 9]);
    expect((await backfillStoredExpressions(engine, quietLogger, { changed: true })).staleRows).toBe(0);
  });

  it('a row holding a value an expression can no longer compute is listed and never written over', async () => {
    // c3 holds an offset, but has no contract type: the write would store NULL over it.
    d.storeFor('contract').set('c3', { ...contract('c3'), review_sla_days_offset: -9 });

    const report = await backfillStoredExpressions(engine, quietLogger, { apply: true });

    expect(report.skippedRows).toBe(1);
    expect(report.faults).toEqual([
      expect.objectContaining({ object: 'contract', field: 'review_sla_days_offset', recordId: 'c3', blocksWrite: true }),
    ]);
    expect(contract('c3')).toMatchObject({ review_sla_days_offset: -9 });
    expect(contract('c3').qty_double).toBeUndefined();
    expect(contract('c1').qty_double).toBe(2);
    expect(storedExpressionBackfillComplete(report)).toBe(false);
  });

  it('one row failing to write does not stop the run, and is listed', async () => {
    d.failUpdateFor('c2');
    const report = await backfillStoredExpressions(engine, quietLogger, { apply: true, retry: { maxRetries: 1 } });

    expect(report.failures).toEqual([expect.objectContaining({ object: 'contract', recordId: 'c2' })]);
    expect(report.writtenRows).toBe(2);
    expect(contract('c1').qty_double).toBe(2);
    expect(contract('c3').qty_double).toBe(6);
    expect(storedExpressionBackfillComplete(report)).toBe(false);
  });

  it('field narrows the walk to one stored computed field', async () => {
    const report = await backfillStoredExpressions(engine, quietLogger, { objects: ['contract'], field: 'qty_double' });
    expect(report.fields.map((f) => f.field)).toEqual(['qty_double']);
    expect(report.nullRows).toBe(3);
  });

  it('refuses, before any row is read, a scope it cannot act on', async () => {
    const refused = (options: Parameters<typeof backfillStoredExpressions>[2]) =>
      backfillStoredExpressions(engine, quietLogger, options).then(() => null, (e) => e);

    expect(await refused({ objects: ['nope'] })).toMatchObject({ code: 'OBJECT_NOT_FOUND' });
    expect(await refused({ objects: ['note'] })).toMatchObject({ code: 'INVALID_FIELD', status: 400, httpStatus: 400 });
    expect(await refused({ objects: ['contract'], field: 'qty_label' }))
      .toMatchObject({ code: 'INVALID_FIELD', status: 400, field: 'qty_label' });
    expect(await refused({ field: 'qty_double' })).toMatchObject({ code: 'INVALID_FIELD', status: 400 });
    expect(d.writes).toEqual([]);
  });

  it('an object it cannot read is reported unreadable and truncates the run', async () => {
    d.failFind('contract');
    const report = await backfillStoredExpressions(engine, quietLogger);
    expect(report.unreadableObjects).toEqual(['contract']);
    expect(report.truncated).toBe(true);
    expect(storedExpressionBackfillComplete(report)).toBe(false);
  });

  describe('the boot advisory', () => {
    const capture = () => {
      const warned: string[] = [];
      return { warned, logger: { info: () => {}, warn: (m: string) => warned.push(m), debug: () => {} } };
    };

    it('names each field holding a hole and the command, once', async () => {
      const { warned, logger } = capture();
      const samples = await announceStoredExpressionHoles(engine, logger);

      expect(samples).toEqual([{ object: 'contract', fields: { review_sla_days_offset: 2, qty_double: 3 }, sampled: 3 }]);
      expect(warned).toHaveLength(1);
      expect(warned[0]).toContain('contract.qty_double (3 of the first 3 rows)');
      expect(warned[0]).toContain('contract.review_sla_days_offset (2 of the first 3 rows)');
      expect(warned[0]).toContain('os migrate stored-expressions');
      expect(d.writes).toEqual([]);
    });

    it('is silent once the holes are filled', async () => {
      await backfillStoredExpressions(engine, quietLogger, { apply: true });
      const { warned, logger } = capture();
      expect(await announceStoredExpressionHoles(engine, logger)).toEqual([]);
      expect(warned).toEqual([]);
    });

    it('never fails the boot over a table it cannot read', async () => {
      d.failFind('contract');
      const { warned, logger } = capture();
      await expect(announceStoredExpressionHoles(engine, logger)).resolves.toEqual([]);
      expect(warned).toEqual([]);
    });
  });
});

describe('sameStoredValue — a driver\'s spelling of the value a write stored', () => {
  it.each([
    [4, 4, true], ['4', 4, true], ['4.50', 4.5, true], [5, 4, false],
    [1, true, true], [0, false, true], ['1', true, true], [1, false, false],
    ['c1-x', 'c1-x', true], ['c1', 'c1-x', false],
    ['2026-01-02T00:00:00.000Z', new Date('2026-01-02T00:00:00.000Z'), true],
    ['2026-01-02', new Date('2026-01-02T00:00:00.000Z'), true],
    ['2026-01-03', new Date('2026-01-02T00:00:00.000Z'), false],
    ['["a","b"]', ['a', 'b'], true],
    [null, null, true], [undefined, null, true], [null, 0, false], [0, null, false],
  ])('%j vs %j → %s', (stored, computed, same) => {
    expect(sameStoredValue(stored, computed)).toBe(same);
  });
});
