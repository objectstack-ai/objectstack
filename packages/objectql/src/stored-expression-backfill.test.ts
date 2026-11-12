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

// Pays the lint root's first load at collection, never inside a clocked case (the door cases run the gate).
import './__fixtures__/lint-root-preload.testkit.js';
import { describe, it, expect, beforeEach } from 'vitest';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
import { SysMetadataAuditObject, SysMetadataCommitObject, SysMetadataHistoryObject } from '@objectstack/metadata-core';
import {
  PublishMetaItemResponseSchema,
  PublishPackageDraftsResponseSchema,
  RevertPackageCommitResponseSchema,
  RollbackMetaItemResponseSchema,
  RollbackToPackageCommitResponseSchema,
  SaveMetaItemResponseSchema,
} from '@objectstack/spec/api';
import { ObjectQL } from './engine.js';
import {
  announceStoredExpressionHoles,
  backfillStoredExpressions,
  captureStoredExpressions,
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

  it('[#32527] fields walks several stored computed fields of one object in one pass, in declaration order', async () => {
    const report = await backfillStoredExpressions(engine, quietLogger, {
      objects: ['contract'], fields: ['qty_double', 'review_sla_days_offset'], apply: true,
    });
    expect(report.fields.map((f) => f.field)).toEqual(['review_sla_days_offset', 'qty_double']);
    expect(report.fields.map((f) => f.written)).toEqual([2, 3]);
    expect(report.writtenRows).toBe(3);
  });

  it('[#32527] refuses a fields scope it cannot act on, before any row is read', async () => {
    const refused = (options: Parameters<typeof backfillStoredExpressions>[2]) =>
      backfillStoredExpressions(engine, quietLogger, options).then(() => null, (e) => e);

    expect(await refused({ objects: ['contract'], fields: ['qty_double', 'qty_label'] }))
      .toMatchObject({ code: 'INVALID_FIELD', status: 400, httpStatus: 400, field: 'qty_label' });
    expect(await refused({ objects: ['contract', 'note'], fields: ['qty_double'] }))
      .toMatchObject({ code: 'INVALID_FIELD', status: 400 });
    expect(await refused({ objects: ['contract'], fields: [] })).toMatchObject({ code: 'INVALID_FIELD', status: 400 });
    expect(await refused({ objects: ['nope'], fields: ['qty_double'] })).toMatchObject({ code: 'OBJECT_NOT_FOUND', status: 404 });
    expect(d.writes).toEqual([]);
  });

  describe('[#32527] captureStoredExpressions — the fill a door owes its change', () => {
    const redeclare = (fields: Record<string, unknown>) => engine.registry.registerObject({
      name: 'contract', fields: { ...(engine.getObject('contract') as any).fields, ...fields },
    } as any);

    it('a change that computes nothing new reads and writes no row', async () => {
      const capture = captureStoredExpressions(engine, quietLogger, 'contract');
      redeclare({ name: { type: 'text', label: 'Contract name' } });
      expect(capture.changedFields()).toEqual([]);
      expect(await capture.fillChanged()).toBeUndefined();
      expect(d.writes).toEqual([]);
    });

    it('fills only the fields the change touched: an expression changed, a formula turned stored', async () => {
      await backfillStoredExpressions(engine, quietLogger, { apply: true });
      const capture = captureStoredExpressions(engine, quietLogger, 'contract');
      redeclare({
        qty_double: { type: 'number', expression: cel('record.qty * 3') },
        qty_label: { type: 'text', expression: cel("string(record.qty) + ' pcs'") },
      });
      d.writes.length = 0;

      expect(capture.changedFields()).toEqual(['qty_double', 'qty_label']);
      const report = await capture.fillChanged();

      expect(report?.fields.map((f) => [f.field, f.written])).toEqual([['qty_double', 3], ['qty_label', 3]]);
      expect(report?.changed).toBe(true);
      expect(contract('c2')).toMatchObject({ qty_double: 6, qty_label: '2 pcs', updated_at: '2026-01-02T00:00:00.000Z' });
      expect(await captureStoredExpressions(engine, quietLogger, 'contract').fillChanged()).toBeUndefined();
    });

    it('the same expression spelled with its keys in another order is no change', () => {
      const capture = captureStoredExpressions(engine, quietLogger, 'contract');
      redeclare({ qty_double: { expression: { source: 'record.qty * 2', dialect: 'cel' }, type: 'number' } });
      expect(capture.changedFields()).toEqual([]);
    });

    it('every stored computed field of an object the capture did not see yet is new', () => {
      const capture = captureStoredExpressions(engine, quietLogger, 'fresh');
      engine.registry.registerObject({
        name: 'fresh',
        fields: { qty: { type: 'number' }, twice: { type: 'number', expression: cel('record.qty * 2') }, shown: { type: 'formula', expression: cel('record.qty') } },
      } as any);
      expect(capture.changedFields()).toEqual(['twice']);
    });
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

// ---------------------------------------------------------------------------
// [#32527] Ruling 6816429574, letter A — the doors fill at the change.
//
// Driven through the REAL protocol on a REAL ObjectQL engine, over an in-file
// driver that seeks and orders by `id` (the fill's keyset walk) and honours the
// `$null` and implicit-null predicates the metadata repository reads with.
// The card's case: a `formula` turned into `type: 'number'` with the same
// `expression` on an object that already holds rows, then the total.
// ---------------------------------------------------------------------------

const sysMetadataObject = {
  name: 'sys_metadata',
  label: 'System Metadata',
  fields: {
    id: { name: 'id', label: 'ID', type: 'text' as const },
    type: { name: 'type', label: 'Type', type: 'text' as const, required: true },
    name: { name: 'name', label: 'Name', type: 'text' as const, required: true },
    organization_id: { name: 'organization_id', label: 'Org', type: 'text' as const },
    package_id: { name: 'package_id', label: 'Package', type: 'text' as const },
    metadata: { name: 'metadata', label: 'Body', type: 'textarea' as const },
    draft_changes: { name: 'draft_changes', label: 'Draft Changes', type: 'textarea' as const },
    checksum: { name: 'checksum', label: 'Checksum', type: 'text' as const, maxLength: 71 },
    state: { name: 'state', label: 'State', type: 'text' as const },
    version: { name: 'version', label: 'Version', type: 'number' as const },
    created_at: { name: 'created_at', label: 'Created', type: 'datetime' as const },
    updated_at: { name: 'updated_at', label: 'Updated', type: 'datetime' as const },
  },
};

function makeDoorDriver() {
  const stores = new Map<string, Map<string, Record<string, unknown>>>();
  const storeFor = (o: string) => {
    let s = stores.get(o);
    if (!s) { s = new Map(); stores.set(o, s); }
    return s;
  };
  let nextId = 0;
  const holds = (value: unknown, cond: any): boolean => {
    const a = value === undefined ? null : value;
    if (cond === null || typeof cond !== 'object' || Array.isArray(cond) || cond instanceof Date) return a === (cond ?? null);
    return Object.entries(cond).every(([op, target]: [string, any]) => {
      switch (op) {
        case '$null': return (a === null) === (target === true);
        case '$eq': return a === (target ?? null);
        case '$ne': return a !== (target ?? null);
        case '$gt': return a !== null && (a as any) > target;
        case '$in': return Array.isArray(target) && target.includes(a);
        default: return true;
      }
    });
  };
  const matches = (row: Record<string, unknown>, where: any): boolean => {
    if (!where || typeof where !== 'object') return true;
    return Object.entries(where).every(([k, v]: [string, any]) => {
      if (k === '$and') return (v as any[]).every((w) => matches(row, w));
      if (k === '$or') return (v as any[]).some((w) => matches(row, w));
      if (k.startsWith('$')) return true;
      return holds(row[k], v);
    });
  };
  const updates: Array<{ object: string; id: string }> = [];
  let failUpdateFor: string | null = null;
  /** Runs once, after the first keyset page (`limit` 200, ordered by `id`) of a user object is read. */
  let afterFirstPage: ((object: string) => Promise<void>) | null = null;
  const driver: any = {
    name: 'memory', version: '0.0.0', supports: {},
    async connect() {}, async disconnect() {}, async checkHealth() { return true; }, async execute() { return null; },
    async find(object: string, ast: any) {
      const page = await this.read(object, ast);
      const order = Array.isArray(ast?.orderBy) ? ast.orderBy[0] : undefined;
      if (afterFirstPage && !object.startsWith('sys_') && ast?.limit === 200 && order?.field === 'id') {
        const run = afterFirstPage;
        afterFirstPage = null;
        await run(object);
      }
      return page;
    },
    // The conditional write the engine's by-id precondition issues (ADR-0142 D4).
    async updateMany(object: string, ast: any, data: Record<string, unknown>) {
      const hit = Array.from(storeFor(object).values()).filter((r) => matches(r, ast?.where));
      for (const r of hit) await this.update(object, String(r.id), data);
      return hit.length;
    },
    async read(object: string, ast: any) {
      let rows = Array.from(storeFor(object).values()).filter((r) => matches(r, ast?.where));
      const order = Array.isArray(ast?.orderBy) ? ast.orderBy[0] : undefined;
      if (order?.field === 'id') {
        rows = rows.sort((a, b) => String(a.id).localeCompare(String(b.id)) * (order.order === 'desc' ? -1 : 1));
      }
      return typeof ast?.limit === 'number' ? rows.slice(0, ast.limit) : rows;
    },
    async findOne(object: string, ast: any) {
      for (const r of storeFor(object).values()) if (matches(r, ast?.where)) return r;
      return null;
    },
    async create(object: string, data: Record<string, unknown>) {
      nextId += 1;
      const id = (data.id as string) ?? `r_${String(nextId).padStart(4, '0')}`;
      const row = { ...data, id };
      storeFor(object).set(id, row);
      return row;
    },
    async update(object: string, id: string, data: Record<string, unknown>) {
      if (failUpdateFor === id) throw new Error('driver refused this row');
      if (object !== 'sys_metadata' && !object.startsWith('sys_')) updates.push({ object, id });
      const s = storeFor(object);
      const cur = s.get(id);
      if (!cur) throw new Error(`not found: ${object}/${id}`);
      const row = { ...cur, ...data, id };
      s.set(id, row);
      return row;
    },
    async upsert(object: string, data: Record<string, unknown>) {
      const id = data.id as string | undefined;
      if (id && storeFor(object).has(id)) return this.update(object, id, data);
      return this.create(object, data);
    },
    async delete(object: string, id: string) { return storeFor(object).delete(id); },
    async count(object: string, ast: any) {
      return Array.from(storeFor(object).values()).filter((r) => matches(r, ast?.where)).length;
    },
    async bulkCreate(object: string, rows: Record<string, unknown>[]) {
      return Promise.all(rows.map((r) => this.create(object, r)));
    },
    async bulkUpdate() { return []; }, async bulkDelete() {},
    async beginTransaction() { return { commit: async () => {}, rollback: async () => {} }; },
    async commit() {}, async rollback() {},
  };
  return {
    driver, storeFor, updates,
    failUpdateFor: (id: string | null) => { failUpdateFor = id; },
    afterFirstPage: (fn: (object: string) => Promise<void>) => { afterFirstPage = fn; },
  };
}

// The rig both door describes below drive: the REAL protocol on a REAL engine.
const PKG = 'app.leave';
const OBJ = 'leave_request';
const DAYS = cel('record.end_day - record.start_day');
const objectBody = (days: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({
  name: OBJ,
  label: 'Leave Request',
  sharingModel: 'public_read_write',
  fields: {
    title: { name: 'title', label: 'Title', type: 'text' },
    start_day: { name: 'start_day', label: 'Start', type: 'number' },
    end_day: { name: 'end_day', label: 'End', type: 'number' },
    // The stamp the fill keeps, and the one its write is conditional on.
    updated_at: { name: 'updated_at', label: 'Updated', type: 'datetime' },
    days: { name: 'days', label: 'Days', ...days },
    ...extra,
  },
});
const FORMULA = { type: 'formula', returnType: 'number', expression: DAYS };
const STORED = { type: 'number', expression: DAYS };

async function makeRig() {
  const engine = new ObjectQL();
  const mem = makeDoorDriver();
  engine.registerDriver(mem.driver, true);
  await engine.init();
  engine.registry.registerObject(sysMetadataObject as any, 'test-package');
  for (const o of [SysMetadataHistoryObject, SysMetadataAuditObject, SysMetadataCommitObject]) {
    engine.registry.registerObject(o as any, 'test-package');
  }
  engine.registry.installPackage({ id: PKG, name: 'Leave', version: '1.0.0' } as never, 'code');
  const protocol = new ObjectStackProtocolImplementation(engine);
  const save = (days: Record<string, unknown>, mode?: 'draft', extra?: Record<string, unknown>) =>
    (protocol as any).saveMetaItem({ type: 'object', name: OBJ, item: objectBody(days, extra), packageId: PKG, ...(mode ? { mode } : {}) });
  return { engine, protocol, save, ...mem };
}

/** A live object whose `days` is a formula, holding three requests of 1 + 2 + 3 = 6 days. */
async function populated() {
  const rig = await makeRig();
  await rig.save(FORMULA);
  for (const [start, end] of [[1, 2], [3, 5], [10, 13]]) {
    await rig.engine.insert(OBJ, { title: `r${start}`, start_day: start, end_day: end }, { context: { isSystem: true } });
  }
  // Each row as stored carries its stamp (this bare engine runs no audit writer that would stamp one).
  let day = 0;
  for (const row of rig.storeFor(OBJ).values()) row.updated_at = `2026-01-0${++day}T00:00:00.000Z`;
  rig.updates.length = 0;
  return rig;
}

const stored = async (rig: Awaited<ReturnType<typeof makeRig>>) =>
  Array.from(rig.storeFor(OBJ).values()).map((r) => r.days ?? null);
const total = async (rig: Awaited<ReturnType<typeof makeRig>>) =>
  (await stored(rig)).reduce<number>((n, v) => n + (typeof v === 'number' ? v : 0), 0);
const notices = (res: any, rule: string) => (res.advisories ?? []).filter((a: any) => a.rule === rule);

describe('[#32527] the save and publish doors fill a stored computed field the change made live', () => {
  it('the card: a formula turned into a stored number with the same expression — the save fills the rows, the total reads 6', async () => {
    const rig = await populated();
    expect(await stored(rig)).toEqual([null, null, null]);

    const res = await rig.save(STORED);

    expect(res.success).toBe(true);
    expect(await stored(rig)).toEqual([1, 2, 3]);
    expect(await total(rig)).toBe(6);
    expect(notices(res, 'stored-expression-filled')).toEqual([expect.objectContaining({
      severity: 'info',
      path: `objects.${OBJ}.fields.days`,
      where: `object "${OBJ}" · field "days"`,
    })]);
    expect(notices(res, 'stored-expression-filled')[0].message).toContain('3 rows of 3 written');
    // The declared answer carries the notice through parse unstripped.
    expect(SaveMetaItemResponseSchema.parse(res).advisories).toEqual(res.advisories);
  });

  it('a changed expression rewrites every row it changes, and counts them', async () => {
    const rig = await populated();
    await rig.save(STORED);
    rig.updates.length = 0;

    const res = await rig.save({ type: 'number', expression: cel('(record.end_day - record.start_day) * 8') });

    expect(await stored(rig)).toEqual([8, 16, 24]);
    expect(rig.updates).toHaveLength(3);
    expect(notices(res, 'stored-expression-filled')[0].message).toContain('3 rows of 3 written');
  });

  it('a save that computes nothing new reads no row, writes none, and answers no fill notice', async () => {
    const rig = await populated();
    await rig.save(STORED);
    rig.updates.length = 0;

    const res = await rig.save({ ...STORED, label: 'Days off' });

    expect(rig.updates).toEqual([]);
    expect(notices(res, 'stored-expression-filled')).toEqual([]);
    expect(notices(res, 'stored-expression-fill-incomplete')).toEqual([]);
  });

  it('a new object that holds no row answers no fill notice: a clean save is unchanged', async () => {
    const rig = await makeRig();
    const res = await rig.save(STORED);
    expect(res.success).toBe(true);
    expect('advisories' in res).toBe(false);
  });

  it('a draft save makes nothing live and fills nothing; its publish fills and reports on the publish answer', async () => {
    const rig = await populated();

    const draft = await rig.save(STORED, 'draft');
    expect(draft.state).toBe('draft');
    expect(await stored(rig)).toEqual([null, null, null]);
    expect(notices(draft, 'stored-expression-filled')).toEqual([]);

    const res = await rig.protocol.publishMetaItem({ type: 'object', name: OBJ, packageId: PKG } as any);

    expect(await stored(rig)).toEqual([1, 2, 3]);
    expect(notices(res, 'stored-expression-filled')[0].message).toContain('3 rows of 3 written');
    expect(PublishMetaItemResponseSchema.parse(res).advisories).toEqual(res.advisories);
  });

  it('a package publish fills and reports on the object\'s published element', async () => {
    const rig = await populated();
    await rig.save(STORED, 'draft');

    const res = await rig.protocol.publishPackageDrafts({ packageId: PKG });

    expect(res.outcome).toBe('published');
    expect(await total(rig)).toBe(6);
    const element = res.published.find((p) => p.name === OBJ)!;
    expect(notices(element, 'stored-expression-filled')[0].message).toContain('3 rows of 3 written');
    expect(PublishPackageDraftsResponseSchema.parse(res).published).toEqual(res.published);
  });

  it('a row the fill cannot write is reported as a warning naming what is left and the command; the save stands', async () => {
    const rig = await populated();
    const [, second] = Array.from(rig.storeFor(OBJ).keys());
    rig.failUpdateFor(second!);

    const res = await rig.save(STORED);

    expect(res.success).toBe(true);
    expect(await stored(rig)).toEqual([1, null, 3]);
    const [warning] = notices(res, 'stored-expression-fill-incomplete');
    expect(warning).toMatchObject({ severity: 'warning', path: `objects.${OBJ}.fields.days` });
    expect(warning.message).toContain('2 rows written, 1 row not (1 row refused the write)');
    expect(warning.hint).toContain(`os migrate stored-expressions --object ${OBJ} --field days --changed --apply`);
    expect(notices(res, 'stored-expression-filled')).toEqual([]);
  });

  it('a write landing between the fill\'s read and its write keeps its updated_at, and its own computed value', async () => {
    const rig = await populated();
    const [, second] = Array.from(rig.storeFor(OBJ).keys());
    const stampBefore = rig.storeFor(OBJ).get(second!)!.updated_at;
    expect(stampBefore, 'the rows carry the stamp the guard keys on').toBeTruthy();
    const EDITED = '2099-01-01T00:00:00.000Z';
    // A user's edit lands after the walk read its first page, before the fill writes that row.
    rig.afterFirstPage(async (object) => {
      await rig.engine.update(object, { id: second, end_day: 13, updated_at: EDITED }, {
        context: { isSystem: true, preserveAudit: true },
      });
    });

    const res = await rig.save(STORED);

    const edited = rig.storeFor(OBJ).get(second!)!;
    expect(edited.updated_at).toBe(EDITED);
    // The edit computed the field itself (13 - 3), under the definition the save made live.
    expect(edited.days).toBe(10);
    expect(await stored(rig)).toEqual([1, 10, 3]);
    const [notice] = notices(res, 'stored-expression-filled');
    expect(notice.message).toContain('2 rows of 3 written');
    expect(notice.message).toContain('1 row written by another write while the fill ran');
  });

  it('a refused storage sync is not followed by a fill: no row is written, and each field is reported unfilled', async () => {
    const rig = await populated();
    (rig.engine as any).syncObjectSchema = async () => { throw new Error('the datasource is read-only'); };

    const res = await rig.save(STORED);

    expect(res.success).toBe(true);
    expect(rig.updates).toEqual([]);
    expect(notices(res, 'object-storage-sync-refused')).toHaveLength(1);
    const [warning] = notices(res, 'stored-expression-fill-incomplete');
    expect(warning.message).toContain('were NOT filled');
    expect(notices(res, 'stored-expression-filled')).toEqual([]);
  });
});

describe('[#32700] a rollback or revert that makes a changed stored computed field live fills it as the save door does', () => {
  const TIMES_EIGHT = { type: 'number', expression: cel('(record.end_day - record.start_day) * 8') };
  const rollback = (rig: Awaited<ReturnType<typeof makeRig>>, toVersion: number) =>
    (rig.protocol as any).rollbackMetaItem({ type: 'object', name: OBJ, toVersion });
  /** The history version the live row of the object holds now. */
  const liveVersion = async (rig: Awaited<ReturnType<typeof makeRig>>) =>
    Number(Array.from(rig.storeFor('sys_metadata').values())
      .find((r) => r.type === 'object' && r.name === OBJ && r.state === 'active')!.version);
  /** The object's body with `days` left out: the version a field the change brings back is absent from. */
  const withoutDays = () => {
    const body: any = objectBody(STORED);
    delete body.fields.days;
    return body;
  };

  it('a rollback to an earlier expression rewrites every row the expression it rolled away from computed', async () => {
    const rig = await populated();
    await rig.save(STORED);
    const v2 = await liveVersion(rig);
    await rig.save(TIMES_EIGHT);
    expect(await stored(rig)).toEqual([8, 16, 24]);
    rig.updates.length = 0;

    const res = await rollback(rig, v2);

    expect(res.success).toBe(true);
    expect(await stored(rig)).toEqual([1, 2, 3]);
    expect(await total(rig)).toBe(6);
    expect(rig.updates).toHaveLength(3);
    expect(notices(res, 'stored-expression-filled')).toEqual([expect.objectContaining({
      severity: 'info',
      path: `objects.${OBJ}.fields.days`,
      where: `object "${OBJ}" · field "days"`,
    })]);
    expect(notices(res, 'stored-expression-filled')[0].message).toContain('3 rows of 3 written');
    // The declared answer carries the notice through parse unstripped.
    expect(RollbackMetaItemResponseSchema.parse(res).advisories).toEqual(res.advisories);
  });

  it('a rollback that turns a formula back into a stored field fills the rows written while it was a formula', async () => {
    const rig = await populated();
    await rig.save(STORED);
    const v2 = await liveVersion(rig);
    // `force`: the save door's own data-loss guard asks for it on a stored field turned formula.
    await (rig.protocol as any).saveMetaItem({ type: 'object', name: OBJ, item: objectBody(FORMULA), packageId: PKG, force: true });
    // Written while `days` is a formula: the column is not computed, so it keeps what it held.
    const [first] = Array.from(rig.storeFor(OBJ).keys());
    await rig.engine.update(OBJ, { id: first, end_day: 4 }, { context: { isSystem: true } });
    await rig.engine.insert(OBJ, { title: 'r20', start_day: 20, end_day: 24 }, { context: { isSystem: true } });
    expect(await stored(rig)).toEqual([1, 2, 3, null]);

    const res = await rollback(rig, v2);

    expect(await stored(rig)).toEqual([3, 2, 3, 4]);
    expect(notices(res, 'stored-expression-filled')[0].message).toContain('2 rows of 4 written');
  });

  it('a rollback that computes nothing new writes no row, and its answer carries no advisories key', async () => {
    const rig = await populated();
    await rig.save(STORED);
    const v2 = await liveVersion(rig);
    await rig.save({ ...STORED, label: 'Days off' });
    rig.updates.length = 0;

    const res = await rollback(rig, v2);

    expect(res.success).toBe(true);
    expect(rig.updates).toEqual([]);
    expect('advisories' in res).toBe(false);
  });

  it('a rollback whose storage sync is refused writes no row, and says so per field', async () => {
    const rig = await populated();
    await rig.save(STORED);
    const v2 = await liveVersion(rig);
    await rig.save(TIMES_EIGHT);
    rig.updates.length = 0;
    (rig.engine as any).syncObjectSchema = async () => { throw new Error('the datasource is read-only'); };

    const res = await rollback(rig, v2);

    expect(res.success).toBe(true);
    expect(rig.updates).toEqual([]);
    expect(notices(res, 'object-storage-sync-refused')).toHaveLength(1);
    expect(notices(res, 'stored-expression-fill-incomplete')[0].message).toContain('were NOT filled');
    expect(RollbackMetaItemResponseSchema.parse(res).advisories).toEqual(res.advisories);
  });

  it('a revert of a package commit that changed the expression fills the rows back, and reports on the revert answer', async () => {
    const rig = await populated();
    await rig.save(STORED);
    await rig.save(TIMES_EIGHT, 'draft');
    const published = await rig.protocol.publishPackageDrafts({ packageId: PKG });
    expect(published.commitId).toBeTruthy();
    expect(await stored(rig)).toEqual([8, 16, 24]);
    rig.updates.length = 0;

    const res: any = await rig.protocol.revertCommit({ commitId: published.commitId!, packageId: PKG });

    expect(res.reverted).toEqual([{ type: 'object', name: OBJ, action: 'restored' }]);
    expect(await stored(rig)).toEqual([1, 2, 3]);
    expect(rig.updates).toHaveLength(3);
    expect(notices(res, 'stored-expression-filled')[0].message).toContain('3 rows of 3 written');
    expect(RevertPackageCommitResponseSchema.parse(res).advisories).toEqual(res.advisories);
  });

  it('a revert records its own commit row before the fill walks the rows', async () => {
    const rig = await populated();
    await rig.save(STORED);
    await rig.save(TIMES_EIGHT, 'draft');
    const published = await rig.protocol.publishPackageDrafts({ packageId: PKG });
    const revertRows = () => Array.from(rig.storeFor('sys_metadata_commit').values())
      .filter((r) => r.operation === 'revert' && r.parent_commit_id === published.commitId);
    let recordedWhenTheFillRead: number | undefined;
    rig.afterFirstPage(async () => { recordedWhenTheFillRead = revertRows().length; });

    const res: any = await rig.protocol.revertCommit({ commitId: published.commitId!, packageId: PKG });

    expect(await stored(rig)).toEqual([1, 2, 3]);
    expect(recordedWhenTheFillRead, 'the revert commit row, when the fill read its first page').toBe(1);
    expect(res.revertCommitId).toBeTruthy();
  });

  it('a revert whose storage sync is refused writes no row, and says so per field', async () => {
    const rig = await populated();
    await rig.save(STORED);
    await rig.save(TIMES_EIGHT, 'draft');
    const published = await rig.protocol.publishPackageDrafts({ packageId: PKG });
    rig.updates.length = 0;
    (rig.engine as any).syncObjectSchema = async () => { throw new Error('the datasource is read-only'); };

    const res: any = await rig.protocol.revertCommit({ commitId: published.commitId!, packageId: PKG });

    expect(res.reverted).toEqual([{ type: 'object', name: OBJ, action: 'restored' }]);
    expect(rig.updates).toEqual([]);
    expect(notices(res, 'object-storage-sync-refused')).toHaveLength(1);
    expect(notices(res, 'stored-expression-fill-incomplete')[0].message).toContain('were NOT filled');
    expect(RevertPackageCommitResponseSchema.parse(res).advisories).toEqual(res.advisories);
  });

  it('a package rollback through a commit that changed the expression carries the step\'s fill notice on its own answer', async () => {
    const rig = await populated();
    await rig.save(STORED, 'draft');
    const target = await rig.protocol.publishPackageDrafts({ packageId: PKG });
    expect(await stored(rig)).toEqual([1, 2, 3]);
    // The rollback reverts the commits strictly NEWER than its target, by instant.
    await new Promise((r) => setTimeout(r, 5));
    await rig.save(TIMES_EIGHT, 'draft');
    await rig.protocol.publishPackageDrafts({ packageId: PKG });
    expect(await stored(rig)).toEqual([8, 16, 24]);

    const res: any = await rig.protocol.rollbackToPackageCommit({ commitId: target.commitId!, packageId: PKG });

    expect(res.revertedCommits).toHaveLength(1);
    expect(await stored(rig)).toEqual([1, 2, 3]);
    expect(notices(res, 'stored-expression-filled')).toEqual([expect.objectContaining({
      severity: 'info',
      path: `objects.${OBJ}.fields.days`,
    })]);
    expect(notices(res, 'stored-expression-filled')[0].message).toContain('3 rows of 3 written');
    expect(RollbackToPackageCommitResponseSchema.parse(res).advisories).toEqual(res.advisories);
  });

  it('a revert of a commit that removed the stored field brings it back filled on the rows written without it', async () => {
    const rig = await populated();
    await rig.save(STORED);
    await (rig.protocol as any).saveMetaItem({ type: 'object', name: OBJ, item: withoutDays(), packageId: PKG, mode: 'draft', force: true });
    const published = await rig.protocol.publishPackageDrafts({ packageId: PKG });
    await rig.engine.insert(OBJ, { title: 'r20', start_day: 20, end_day: 24 }, { context: { isSystem: true } });
    expect((await stored(rig))[3]).toBeNull();

    const res: any = await rig.protocol.revertCommit({ commitId: published.commitId!, packageId: PKG });

    expect(await stored(rig)).toEqual([1, 2, 3, 4]);
    expect(notices(res, 'stored-expression-filled')[0].message).toContain('1 row of 4 written');
  });

  it('a revert that removes the package\'s own object extension hands the owner\'s expression back, and fills it', async () => {
    const rig = await populated();
    await rig.save(STORED);
    // An extension of the package's own object re-declaring `days` with another expression (ADR-0146 D10 judges
    // only another package's extension): its fields are merged over the owner's.
    await (rig.protocol as any).saveMetaItem({
      type: 'object_extension', name: OBJ, packageId: PKG, mode: 'draft',
      item: { extend: OBJ, fields: { days: { name: 'days', label: 'Days', ...TIMES_EIGHT } } },
    });
    const published = await rig.protocol.publishPackageDrafts({ packageId: PKG });
    expect(await stored(rig)).toEqual([8, 16, 24]);
    rig.updates.length = 0;

    const res: any = await rig.protocol.revertCommit({ commitId: published.commitId!, packageId: PKG });

    expect(res.reverted).toEqual([{ type: 'object_extension', name: OBJ, action: 'removed' }]);
    expect(await stored(rig)).toEqual([1, 2, 3]);
    expect(rig.updates).toHaveLength(3);
    expect(notices(res, 'stored-expression-filled')[0].message).toContain('3 rows of 3 written');
  });

  it('a revert of a commit that added the stored field computes nothing new: no row written, no advisories key', async () => {
    const rig = await makeRig();
    await (rig.protocol as any).saveMetaItem({ type: 'object', name: OBJ, item: withoutDays(), packageId: PKG });
    await rig.engine.insert(OBJ, { title: 'r1', start_day: 1, end_day: 2 }, { context: { isSystem: true } });
    await rig.save(STORED, 'draft');
    const published = await rig.protocol.publishPackageDrafts({ packageId: PKG });
    expect(await stored(rig)).toEqual([1]);
    rig.updates.length = 0;

    const res: any = await rig.protocol.revertCommit({ commitId: published.commitId!, packageId: PKG });

    expect(res.reverted).toEqual([{ type: 'object', name: OBJ, action: 'restored' }]);
    expect(rig.updates).toEqual([]);
    expect('advisories' in res).toBe(false);
  });
});
