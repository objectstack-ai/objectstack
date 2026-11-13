// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// #32768 — `ObjectQL#judgeFieldWriteLock`: the update's own `readonlyWhen`
// verdict on one field of one record, asked without writing. A door that hands
// out a promise to write a field later (the upload link) asks it first.
//
// Pinned against the write itself: for every row below, the judgement says
// LOCKED exactly when an update of the field reports it dropped under
// `readonly_when`, and nothing the judgement does reaches the driver's write
// verbs.

import { describe, it, expect, beforeEach } from 'vitest';
import type { DroppedFieldsEvent } from '@objectstack/spec/data';
import { ObjectQL } from './engine.js';

function makeDriver() {
  const stores = new Map<string, Map<string, any>>();
  const writes: string[] = [];
  const storeFor = (o: string) => {
    let s = stores.get(o);
    if (!s) { s = new Map(); stores.set(o, s); }
    return s;
  };
  const matches = (row: any, where: any): boolean => {
    if (!where || typeof where !== 'object') return true;
    return Object.entries(where).every(([k, v]: [string, any]) => {
      if (k.startsWith('$')) throw new Error(`fake driver: unsupported operator ${k}`);
      return row?.[k] === v;
    });
  };
  const driver: any = {
    name: 'memory', version: '0.0.0', supports: {},
    async connect() {}, async disconnect() {}, async checkHealth() { return true; }, async execute() { return null; },
    async find(object: string, ast: any) {
      const rows = Array.from(storeFor(object).values()).filter((r) => matches(r, ast?.where));
      return typeof ast?.limit === 'number' ? rows.slice(0, ast.limit) : rows;
    },
    async findOne(object: string, ast: any) {
      for (const r of storeFor(object).values()) if (matches(r, ast?.where)) return r;
      return null;
    },
    async create(object: string, data: Record<string, unknown>) {
      writes.push(`create ${object}`);
      const row = { ...data, id: data.id as string };
      storeFor(object).set(row.id, row);
      return row;
    },
    async update(object: string, id: string, data: Record<string, unknown>) {
      writes.push(`update ${object}`);
      const s = storeFor(object);
      const row = { ...s.get(id), ...data, id };
      s.set(id, row);
      return row;
    },
    async updateMany() { writes.push('updateMany'); return 0; },
    async delete() { writes.push('delete'); return true; },
    async count() { return 0; },
    async bulkCreate() { writes.push('bulkCreate'); return []; },
    async bulkUpdate() { writes.push('bulkUpdate'); return []; }, async bulkDelete() { writes.push('bulkDelete'); },
    async beginTransaction() { return { __trx: true, commit: async () => {}, rollback: async () => {} }; },
    async commit() {}, async rollback() {},
  };
  return { driver, storeFor, writes };
}

const PHRASE = "read-only in the target record's current state (a TRUE `readonlyWhen` predicate)";

describe('judgeFieldWriteLock: the update\'s readonlyWhen verdict, without the write (#32768)', () => {
  let engine: ObjectQL;
  let d: ReturnType<typeof makeDriver>;
  let warns: string[];

  beforeEach(async () => {
    warns = [];
    const logger: any = {
      warn: (m: string) => warns.push(String(m)),
      debug() {}, info() {}, error() {}, trace() {}, fatal() {},
      child() { return logger; },
    };
    engine = new ObjectQL({ logger });
    d = makeDriver();
    engine.registerDriver(d.driver, true);
    await engine.init();

    engine.registry.registerObject({
      name: 'expense_claim',
      fields: {
        name: { type: 'text' },
        status: { type: 'text' },
        invoices: { type: 'file', multiple: true, readonlyWhen: "record.status == 'approved'" },
        note: { type: 'text' },
        broken: { type: 'text', readonlyWhen: 'record.no_such_field == 1' },
      },
    } as any, 'test');
    engine.registry.registerObject({
      name: 'expense_report',
      fields: { name: { type: 'text' }, status: { type: 'text' } },
    } as any, 'test');
    engine.registry.registerObject({
      name: 'expense_line',
      fields: {
        report: { type: 'master_detail', reference: 'expense_report', required: true },
        receipt: { type: 'file', readonlyWhen: "parent.status == 'paid'" },
      },
    } as any, 'test');

    d.storeFor('expense_claim').set('c_draft', { id: 'c_draft', name: 'Lyon', status: 'draft', invoices: null, note: null, broken: null });
    d.storeFor('expense_claim').set('c_approved', { id: 'c_approved', name: 'Rome', status: 'approved', invoices: null, note: null, broken: null });
    d.storeFor('expense_report').set('r_paid', { id: 'r_paid', name: 'Q3', status: 'paid' });
    d.storeFor('expense_report').set('r_open', { id: 'r_open', name: 'Q4', status: 'open' });
    d.storeFor('expense_line').set('l_paid', { id: 'l_paid', report: 'r_paid', receipt: null });
    d.storeFor('expense_line').set('l_open', { id: 'l_open', report: 'r_open', receipt: null });
  });

  /** What the update itself reports for `field` on `id`: dropped under `readonly_when`, or kept. */
  async function updateDrops(object: string, id: string, field: string, value: unknown = 'f_new'): Promise<boolean> {
    const events: DroppedFieldsEvent[] = [];
    await engine.update(object, { [field]: value }, {
      where: { id },
      context: { isSystem: true },
      onFieldsDropped: (e: DroppedFieldsEvent) => { events.push(e); },
    } as any);
    return events.some((e) => e.reason === 'readonly_when' && e.fields.includes(field));
  }

  it('a field whose readonlyWhen holds now is locked, with the update\'s reason and its strict refusal\'s words', async () => {
    const lock = await engine.judgeFieldWriteLock('expense_claim', 'c_approved', 'invoices', { context: { isSystem: true } as any });
    expect(lock).toEqual({ reason: 'readonly_when', phrase: PHRASE });
    expect(d.writes).toEqual([]);
    expect(await updateDrops('expense_claim', 'c_approved', 'invoices', ['f_new'])).toBe(true);
  });

  it('the same field while the condition is false is writable', async () => {
    expect(await engine.judgeFieldWriteLock('expense_claim', 'c_draft', 'invoices', { context: { isSystem: true } as any })).toBeNull();
    expect(d.writes).toEqual([]);
    expect(await updateDrops('expense_claim', 'c_draft', 'invoices', ['f_new'])).toBe(false);
  });

  it('a parent-scoped lock reads the master-detail header, as the update does', async () => {
    expect(await engine.judgeFieldWriteLock('expense_line', 'l_paid', 'receipt', { context: { isSystem: true } as any }))
      .toEqual({ reason: 'readonly_when', phrase: PHRASE });
    expect(await engine.judgeFieldWriteLock('expense_line', 'l_open', 'receipt', { context: { isSystem: true } as any })).toBeNull();
    expect(d.writes).toEqual([]);
    expect(await updateDrops('expense_line', 'l_paid', 'receipt')).toBe(true);
    expect(await updateDrops('expense_line', 'l_open', 'receipt')).toBe(false);
  });

  it('a field that declares no readonlyWhen is writable and costs no read', async () => {
    const findOne = d.driver.findOne;
    let reads = 0;
    d.driver.findOne = async (...a: any[]) => { reads += 1; return findOne(...a); };
    expect(await engine.judgeFieldWriteLock('expense_claim', 'c_approved', 'note', { context: { isSystem: true } as any })).toBeNull();
    expect(reads).toBe(0);
  });

  it('a predicate that faults refuses as the write refuses it, and writes nothing', async () => {
    const err = await engine.judgeFieldWriteLock('expense_claim', 'c_draft', 'broken', { context: { isSystem: true } as any })
      .then(() => null, (e: unknown) => e as { code?: string; name?: string });
    expect(err).not.toBeNull();
    expect(err?.name).toBe('ValidationError');
    expect(d.writes).toEqual([]);
  });

  it('a record that is not there answers as the by-id update answers it', async () => {
    const err = await engine.judgeFieldWriteLock('expense_claim', 'c_missing', 'invoices', { context: { isSystem: true } as any })
      .then(() => null, (e: unknown) => e as { code?: string; status?: number });
    expect(err).toMatchObject({ code: 'RECORD_NOT_FOUND', status: 404 });
  });

  it('logs no strip line: nothing was written, so "ignoring incoming change" is not true', async () => {
    await engine.judgeFieldWriteLock('expense_claim', 'c_approved', 'invoices', { context: { isSystem: true } as any });
    expect(warns.filter((w) => w.includes('ignoring incoming change'))).toEqual([]);
  });
});
