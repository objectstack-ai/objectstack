// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The refusal a write answers when a nested write's stale-roll-up refusal
 * stopped it (`summary-errors.ts`, #29291) leads with the write its caller
 * asked for, and never claims a rollback that failed.
 *
 *  1. A nested cascade: deleting an account walks its lines, each line's
 *     delete walks its subs, and a sub's delete refuses on recompute (its
 *     roll-up into `bucket` cannot be recomputed). The line's walk converts
 *     first, naming the line; the account's walk then received a code-less
 *     error and passed it through, so the account's caller read
 *     `The delete of "line" did not complete`. Now each outer walk re-leads
 *     it, at every depth, and `cause` stays the sub's own refusal.
 *  2. `ObjectQL.transaction` swallows a failing rollback so the original error
 *     surfaces. It still converted that error to "The transaction rolled back,
 *     so nothing written inside it was stored". Now, when the rollback threw,
 *     the lead says that nothing is known about what is stored.
 *
 * Controls: a delete of the sub itself still answers `ERR_SUMMARY_RECOMPUTE`
 * with its own result; a transaction whose rollback succeeds still says it
 * rolled back.
 *
 * The driver rolls back for real (a snapshot per transaction), refuses every
 * write to `bucket` while `refuseBucket` is set (the roll-up recompute's parent
 * update, refused without a transient message, so no retry runs), and makes
 * `rollback()` throw while `failRollback` is set.
 */

import { describe, it, expect } from 'vitest';
import { ObjectQL } from './engine.js';
import { SummaryRecomputeError, cascadeStoppedRefusal, hookStoppedRefusal } from './summary-errors.js';

type Row = Record<string, unknown>;

function matches(row: Row, where: any): boolean {
  if (!where || typeof where !== 'object') return true;
  return Object.entries(where).every(([k, v]) => {
    if (k === '$and') return (v as any[]).every((w) => matches(row, w));
    if (k === '$or') return (v as any[]).some((w) => matches(row, w));
    if (k.startsWith('$')) return true;
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      const ops = v as Record<string, unknown>;
      if ('$in' in ops) return (ops.$in as unknown[]).map(String).includes(String(row[k]));
      if ('$eq' in ops) return String(row[k]) === String(ops.$eq);
      if ('$ne' in ops) return String(row[k]) !== String(ops.$ne);
      return true;
    }
    return row[k] === v || (row[k] != null && v != null && String(row[k]) === String(v));
  });
}

function makeDriver() {
  let stores = new Map<string, Map<string, Row>>();
  const storeFor = (o: string) => stores.get(o) ?? (stores.set(o, new Map()), stores.get(o)!);
  const rolledBack: unknown[] = [];
  const snapshots = new Map<unknown, typeof stores>();
  const state = { refuseBucket: false, failRollback: false };
  let n = 0;
  const driver: any = {
    name: 'primary', version: '0.0.0', supports: {}, rolledBack, state,
    rowsOf: (o: string) => Array.from(storeFor(o).values()),
    async connect() {}, async disconnect() {}, async checkHealth() { return true; }, async execute() { return null; },
    async syncSchema() {},
    async find(o: string, ast: any) {
      const rows = Array.from(storeFor(o).values()).filter((r) => matches(r, ast?.where));
      return typeof ast?.limit === 'number' ? rows.slice(0, ast.limit) : rows;
    },
    async findOne(o: string, ast: any) { return (await this.find(o, ast))[0] ?? null; },
    async create(o: string, data: Row) {
      const row = { ...data, id: (data.id as string) ?? `${o}_${++n}` };
      storeFor(o).set(String(row.id), row);
      return row;
    },
    async update(o: string, id: string, data: Row) {
      if (state.refuseBucket && o === 'bucket') throw new Error('bucket store refused the write');
      const row = { ...storeFor(o).get(String(id)), ...data, id };
      storeFor(o).set(String(id), row);
      return row;
    },
    async delete(o: string, id: string) { return storeFor(o).delete(String(id)); },
    async deleteMany(o: string, ast: any) {
      const doomed = Array.from(storeFor(o).values()).filter((r) => matches(r, ast?.where));
      for (const r of doomed) storeFor(o).delete(String(r.id));
      return doomed.length;
    },
    async count(o: string, ast: any) { return (await this.find(o, ast)).length; },
    async bulkCreate(o: string, rows: Row[]) { return Promise.all(rows.map((r) => this.create(o, r))); },
    async bulkUpdate() { return []; }, async bulkDelete() {},
    async beginTransaction() {
      const handle = { trx: snapshots.size + 1 };
      snapshots.set(handle, new Map(Array.from(stores, ([o, s]) => [o, new Map(Array.from(s, ([k, v]) => [k, { ...v }]))])));
      return handle;
    },
    async commit(h: unknown) { snapshots.delete(h); },
    async rollback(h: unknown) {
      if (state.failRollback) throw new Error('connection lost during rollback');
      stores = snapshots.get(h) ?? stores;
      rolledBack.push(h);
    },
  };
  return driver;
}

async function makeEngine() {
  const log = () => {};
  const engine = new ObjectQL({ logger: { debug: log, info: log, warn: log, error: log } } as any);
  (engine as any).summaryRetryOptions = { sleep: async () => {}, backoffBaseMs: 0 };
  const driver = makeDriver();
  engine.registerDriver(driver, true);
  await engine.init();
  const text = (name: string) => ({ name, type: 'text' });
  const id = { ...text('id'), primaryKey: true };
  engine.registry.registerObject({ name: 'acct', label: 'acct', fields: { id, name: text('name') } } as any, '__test__');
  engine.registry.registerObject({
    name: 'bucket', label: 'bucket',
    fields: { id, name: text('name'), sub_count: { name: 'sub_count', type: 'summary', summaryOperations: { object: 'sub', function: 'count' } } },
  } as any, '__test__');
  engine.registry.registerObject({
    name: 'line', label: 'line',
    fields: { id, name: text('name'), acct: { name: 'acct', type: 'master_detail', reference: 'acct', deleteBehavior: 'cascade' } },
  } as any, '__test__');
  engine.registry.registerObject({
    name: 'sub', label: 'sub',
    fields: {
      id, name: text('name'),
      line: { name: 'line', type: 'master_detail', reference: 'line', deleteBehavior: 'cascade' },
      bucket: { name: 'bucket', type: 'lookup', reference: 'bucket' },
    },
  } as any, '__test__');
  await engine.insert('acct', { id: 'a1', name: 'A' });
  await engine.insert('bucket', { id: 'b1', name: 'B' });
  await engine.insert('line', { id: 'l1', name: 'L1', acct: 'a1' });
  await engine.insert('sub', { id: 's1', name: 'S1', line: 'l1', bucket: 'b1' });
  driver.rolledBack.length = 0;
  driver.state.refuseBucket = true;
  return { engine, driver };
}

const refusal = (p: Promise<unknown>): Promise<any> => p.then(() => null, (e: unknown) => e);
const ids = (rows: Row[]) => rows.map((r) => r.id).sort();

describe('the unlanded-write refusal leads with the write its caller asked for', () => {
  it('a three-level cascade: the account\'s caller reads the account, and `cause` is the sub\'s own refusal', async () => {
    const { engine, driver } = await makeEngine();
    const err = await refusal(engine.delete('acct', { where: { id: 'a1' } }));
    expect(err).toBeInstanceOf(Error);
    expect(err.code).toBe('INTERNAL_ERROR');
    expect(err.status).toBe(500);
    expect(err.message.startsWith('The delete of "acct" did not complete: its cascade stopped'), err.message).toBe(true);
    expect(err.message).not.toContain('"line"');
    expect(err.message).toContain('bucket.sub_count');
    expect(err.cause?.code).toBe('ERR_SUMMARY_RECOMPUTE');
    expect(err.cause?.failures?.[0]?.childObject).toBe('sub');
    expect(ids(driver.rowsOf('acct'))).toEqual(['a1']);
    expect(ids(driver.rowsOf('line'))).toEqual(['l1']);
    expect(ids(driver.rowsOf('sub'))).toEqual(['s1']);
  });

  it('the middle level\'s own caller still reads the line', async () => {
    const { engine } = await makeEngine();
    const err = await refusal(engine.delete('line', { where: { id: 'l1' } }));
    expect(err.message.startsWith('The delete of "line" did not complete'), err.message).toBe(true);
    expect(err.cause?.code).toBe('ERR_SUMMARY_RECOMPUTE');
  });

  it('every outer conversion re-leads, whatever the depth, and keeps the original refusal as cause', () => {
    const original = new SummaryRecomputeError([{ childObject: 'sub', parentObject: 'bucket', parentId: 'b1', field: 'sub_count', error: null }], true);
    const inner = cascadeStoppedRefusal(original, 'line') as any;
    const outer = cascadeStoppedRefusal(inner, 'acct') as any;
    const hooked = hookStoppedRefusal(outer, 'afterInsert', 'case', 'cleanup') as any;
    expect(outer.message.startsWith('The delete of "acct" did not complete'), outer.message).toBe(true);
    expect(hooked.message.startsWith('The insert of "case" did not complete: its afterInsert hook "cleanup" stopped.'), hooked.message).toBe(true);
    for (const e of [inner, outer, hooked]) {
      expect(e.cause).toBe(original);
      expect(e.code).toBe('INTERNAL_ERROR');
      expect(e.status).toBe(500);
      expect(e.message).toContain('bucket.sub_count');
    }
  });

  it('CONTROL a code-less error that is no conversion passes every conversion unchanged', () => {
    const other = new Error('something else');
    expect(cascadeStoppedRefusal(other, 'acct')).toBe(other);
    expect(hookStoppedRefusal(other, 'afterInsert', 'case', undefined)).toBe(other);
  });

  it('CONTROL the sub\'s own delete landed: ERR_SUMMARY_RECOMPUTE, carrying its result', async () => {
    const { engine, driver } = await makeEngine();
    const err = await refusal(engine.delete('sub', { where: { id: 's1' } }));
    expect(err?.code).toBe('ERR_SUMMARY_RECOMPUTE');
    expect(err.written).toBe(true);
    expect(driver.rowsOf('sub')).toHaveLength(0);
  });
});

describe('ObjectQL.transaction never claims "rolled back" when its rollback threw', () => {
  const escapeRefusal = (engine: ObjectQL) =>
    refusal(engine.transaction(async (trx: any) => engine.delete('sub', { where: { id: 's1' }, context: trx })));

  it('the rollback throws: refused with a lead that says nothing is known, the refusal as cause', async () => {
    const { engine, driver } = await makeEngine();
    driver.state.failRollback = true;
    const err = await escapeRefusal(engine);
    expect(err).toBeInstanceOf(Error);
    expect(err.code).toBe('INTERNAL_ERROR');
    expect(err.status).toBe(500);
    expect(err.written).toBeUndefined();
    expect(err.message.startsWith(
      'The transaction did not complete, and its rollback failed too, so what was written inside it may or may not be stored.',
    ), err.message).toBe(true);
    expect(err.message).not.toContain('rolled back');
    expect(err.cause?.code).toBe('ERR_SUMMARY_RECOMPUTE');
    expect(driver.rolledBack).toHaveLength(0);
  });

  it('CONTROL the rollback succeeds: "The transaction rolled back", and nothing is stored', async () => {
    const { engine, driver } = await makeEngine();
    const err = await escapeRefusal(engine);
    expect(err.message.startsWith('The transaction rolled back, so nothing written inside it was stored.'), err.message).toBe(true);
    expect(err.cause?.code).toBe('ERR_SUMMARY_RECOMPUTE');
    expect(driver.rolledBack).toHaveLength(1);
    expect(ids(driver.rowsOf('sub'))).toEqual(['s1']);
  });
});
