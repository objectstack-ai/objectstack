// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * A cascade dependent's stale-roll-up refusal never answers for a delete that
 * did not land.
 *
 * `SummaryRecomputeError` (`ERR_SUMMARY_RECOMPUTE`) means "this write is
 * stored, only a parent's roll-up recompute failed", and every answering
 * surface (the data doors, the action / sandbox / flow writers) turns it into
 * the write's own success. A by-id delete walks its `master_detail`
 * dependents first, each through the public `delete()`. When one dependent's
 * delete raises that refusal (its roll-up into ANOTHER parent cannot be
 * recomputed), the walk stops before the parent's own row is removed, so the
 * parent delete did not land — under the `'atomic'` plan the transaction then
 * rolls the dependent back too. The refusal used to leave the parent's
 * `delete()` unchanged, and the caller was told the delete succeeded.
 *
 * Pinned here: the parent delete refuses with an error that is NOT the
 * stale-roll-up refusal, on the atomic plan (nothing stored changes) and on a
 * runtime that cannot roll back (the parent is still stored), by id and by
 * predicate; a refusal that
 * escapes a caller's own `transaction()` (engine or scoped context) that rolls
 * back is converted the same way. Controls: a delete of the dependent itself — its own write landed, only
 * its recompute failed — still answers `ERR_SUMMARY_RECOMPUTE` carrying its
 * result, and so does a caller's transaction that catches it and commits.
 *
 * The driver rolls back for real (a snapshot per transaction), and refuses
 * every write to `bucket` while `refuseBucket` is set: that is the roll-up
 * recompute's parent update, refused without a transient message, so no retry
 * runs.
 */

import { describe, it, expect } from 'vitest';
import { ObjectQL } from './engine.js';

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

function makeDriver(transactional: boolean) {
  let stores = new Map<string, Map<string, Row>>();
  const storeFor = (o: string) => stores.get(o) ?? (stores.set(o, new Map()), stores.get(o)!);
  const begun: unknown[] = [];
  const rolledBack: unknown[] = [];
  const snapshots = new Map<unknown, typeof stores>();
  const state = { refuseBucket: false };
  let n = 0;
  const driver: any = {
    name: 'primary', version: '0.0.0', supports: {}, begun, rolledBack, state,
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
  };
  if (transactional) {
    driver.beginTransaction = async () => {
      const handle = { trx: begun.length + 1 };
      snapshots.set(handle, new Map(Array.from(stores, ([o, s]) => [o, new Map(Array.from(s, ([k, v]) => [k, { ...v }]))])));
      begun.push(handle);
      return handle;
    };
    driver.commit = async (h: unknown) => { snapshots.delete(h); };
    driver.rollback = async (h: unknown) => { stores = snapshots.get(h) ?? stores; rolledBack.push(h); };
  }
  return driver;
}

async function makeEngine(transactional: boolean) {
  const log = () => {};
  const engine = new ObjectQL({ logger: { debug: log, info: log, warn: log, error: log } } as any);
  const driver = makeDriver(transactional);
  engine.registerDriver(driver, true);
  await engine.init();
  const text = (name: string) => ({ name, type: 'text' });
  engine.registry.registerObject({ name: 'acct', label: 'acct', fields: { id: { ...text('id'), primaryKey: true }, name: text('name') } } as any, '__test__');
  engine.registry.registerObject({
    name: 'bucket', label: 'bucket',
    fields: {
      id: { ...text('id'), primaryKey: true }, name: text('name'),
      line_count: { name: 'line_count', type: 'summary', summaryOperations: { object: 'line', function: 'count' } },
    },
  } as any, '__test__');
  engine.registry.registerObject({
    name: 'line', label: 'line',
    fields: {
      id: { ...text('id'), primaryKey: true }, name: text('name'),
      acct: { name: 'acct', type: 'master_detail', reference: 'acct', deleteBehavior: 'cascade' },
      bucket: { name: 'bucket', type: 'lookup', reference: 'bucket' },
    },
  } as any, '__test__');
  await engine.insert('acct', { id: 'a1', name: 'A' });
  await engine.insert('bucket', { id: 'b1', name: 'B' });
  await engine.insert('line', { id: 'l1', name: 'L1', acct: 'a1', bucket: 'b1' });
  await engine.insert('line', { id: 'l2', name: 'L2', acct: 'a1', bucket: 'b1' });
  driver.begun.length = 0;
  driver.rolledBack.length = 0;
  driver.state.refuseBucket = true;
  return { engine, driver };
}

const ids = (rows: Row[]) => rows.map((r) => r.id).sort();

describe('a cascade dependent\'s ERR_SUMMARY_RECOMPUTE never answers for a parent delete that did not land', () => {
  it('atomic plan: the parent delete refuses with another error, and nothing stored changes', async () => {
    const { engine, driver } = await makeEngine(true);
    const err: any = await engine.delete('acct', { where: { id: 'a1' } }).then(() => null, (e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err.code).toBe('INTERNAL_ERROR');
    expect(err.status).toBe(500);
    expect(err.cause?.code).toBe('ERR_SUMMARY_RECOMPUTE');
    expect(err.written).toBeUndefined();
    expect(driver.rolledBack).toHaveLength(1);
    expect(ids(driver.rowsOf('acct'))).toEqual(['a1']);
    expect(ids(driver.rowsOf('line'))).toEqual(['l1', 'l2']);
  });

  it('a runtime that cannot roll back: the parent is still stored, and the caller is refused', async () => {
    const { engine, driver } = await makeEngine(false);
    const err: any = await engine.delete('acct', { where: { id: 'a1' } }).then(() => null, (e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err.code).toBe('INTERNAL_ERROR');
    expect(err.status).toBe(500);
    expect(err.cause?.code).toBe('ERR_SUMMARY_RECOMPUTE');
    expect(ids(driver.rowsOf('acct'))).toEqual(['a1']);
    // The dependent the walk reached first is gone: nothing can roll it back.
    expect(ids(driver.rowsOf('line'))).toEqual(['l2']);
  });

  it('a predicate delete (multi) on a runtime that cannot roll back: refused the same way, the parent still stored', async () => {
    const { engine, driver } = await makeEngine(false);
    const err: any = await engine.delete('acct', { where: { name: 'A' }, multi: true }).then(() => null, (e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err.code).toBe('INTERNAL_ERROR');
    expect(err.status).toBe(500);
    expect(err.cause?.code).toBe('ERR_SUMMARY_RECOMPUTE');
    expect(ids(driver.rowsOf('acct'))).toEqual(['a1']);
  });

  it('a caller\'s own transaction that the refusal rolls back: refused with another error, nothing stored', async () => {
    const { engine, driver } = await makeEngine(true);
    const err: any = await engine
      .transaction(async (trx: any) => engine.delete('line', { where: { id: 'l1' }, context: trx }))
      .then(() => null, (e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err.code).toBe('INTERNAL_ERROR');
    expect(err.status).toBe(500);
    expect(err.cause?.code).toBe('ERR_SUMMARY_RECOMPUTE');
    expect(driver.rolledBack).toHaveLength(1);
    expect(ids(driver.rowsOf('line'))).toEqual(['l1', 'l2']);
  });

  it('the same through a scoped context\'s transaction (ctx.api)', async () => {
    const { engine, driver } = await makeEngine(true);
    const scoped = (engine as any).createContext({ isSystem: true });
    const err: any = await scoped
      .transaction(async (trx: any) => trx.object('line').deleteById('l1'))
      .then(() => null, (e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err.code).toBe('INTERNAL_ERROR');
    expect(err.status).toBe(500);
    expect(err.cause?.code).toBe('ERR_SUMMARY_RECOMPUTE');
    expect(driver.rolledBack).toHaveLength(1);
    expect(ids(driver.rowsOf('line'))).toEqual(['l1', 'l2']);
  });

  it('CONTROL the dependent\'s own delete landed: ERR_SUMMARY_RECOMPUTE, carrying its result', async () => {
    const { engine, driver } = await makeEngine(true);
    const err: any = await engine.delete('line', { where: { id: 'l1' } }).then(() => null, (e: unknown) => e);
    expect(err?.code).toBe('ERR_SUMMARY_RECOMPUTE');
    expect(err.written).toBe(true);
    expect(ids(driver.rowsOf('line'))).toEqual(['l2']);
  });

  it('CONTROL a caller\'s transaction that catches the refusal commits, and the refusal stays true', async () => {
    const { engine, driver } = await makeEngine(true);
    let caught: any;
    await engine.transaction(async (trx: any) => {
      await engine.delete('line', { where: { id: 'l1' }, context: trx }).catch((e: unknown) => { caught = e; });
    });
    expect(caught?.code).toBe('ERR_SUMMARY_RECOMPUTE');
    expect(driver.rolledBack).toHaveLength(0);
    expect(ids(driver.rowsOf('line'))).toEqual(['l2']);
  });
});
