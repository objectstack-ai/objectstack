// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.
//
// Guard for ADR-0034: while a transaction() callback runs, EVERY data op —
// including a write/read given no explicit transaction context — must bind to
// the active transaction (via the ambient AsyncLocalStorage store). Without
// this, internal queries during a write ask the pool for another connection
// and deadlock on the single-connection SQLite pool.

import { describe, it, expect, beforeEach } from 'vitest';
import { ObjectQL } from './engine.js';

function makeRecordingDriver() {
  const stores = new Map<string, Map<string, any>>();
  const seen: {
    create: Array<{ object: string; transaction: unknown }>;
    find: Array<{ object: string; transaction: unknown }>;
    commit: unknown[];
    rollback: unknown[];
  } = {
    create: [],
    find: [],
    commit: [],
    rollback: [],
  };
  const storeFor = (o: string) => {
    let s = stores.get(o);
    if (!s) { s = new Map(); stores.set(o, s); }
    return s;
  };
  let nextId = 0;
  const driver: any = {
    name: 'memory',
    version: '0.0.0',
    supports: {},
    async connect() {},
    async disconnect() {},
    async checkHealth() { return true; },
    async execute() { return null; },
    async find(object: string, _ast: any, options: any) {
      seen.find.push({ object, transaction: options?.transaction });
      return Array.from(storeFor(object).values());
    },
    findStream() { throw new Error('not implemented'); },
    async findOne(object: string) {
      for (const r of storeFor(object).values()) return r;
      return null;
    },
    async create(object: string, data: Record<string, unknown>, options: any) {
      seen.create.push({ object, transaction: options?.transaction });
      nextId += 1;
      const id = (data.id as string) ?? `r_${nextId}`;
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
    async delete(object: string, id: string) { return storeFor(object).delete(id); },
    async count() { return 0; },
    async bulkCreate(object: string, rows: Record<string, unknown>[]) {
      return Promise.all(rows.map((r) => this.create(object, r, undefined)));
    },
    async bulkUpdate() { return []; },
    async bulkDelete() {},
    async beginTransaction() { return { __trx: true, commit: async () => {}, rollback: async () => {} }; },
    async commit(trx: unknown) { seen.commit.push(trx); },
    async rollback(trx: unknown) { seen.rollback.push(trx); },
  };
  return { driver, seen };
}

describe('engine ambient transaction (ADR-0034)', () => {
  let engine: ObjectQL;
  let seen: ReturnType<typeof makeRecordingDriver>['seen'];

  beforeEach(async () => {
    engine = new ObjectQL();
    const d = makeRecordingDriver();
    seen = d.seen;
    engine.registerDriver(d.driver, true);
    await engine.init();
    engine.registry.registerObject({ name: 'thing', fields: { name: { type: 'text' } } } as any);
  });

  it('threads the active transaction into writes given NO explicit context', async () => {
    await engine.transaction(async () => {
      // No context passed — must inherit the transaction ambiently.
      await engine.insert('thing', { name: 'A' });
      await engine.insert('thing', { name: 'B' });
    });
    expect(seen.create.length).toBe(2);
    expect(seen.create[0].transaction).toBeTruthy();
    // both writes ran on the SAME transaction (no second connection)
    expect(seen.create[1].transaction).toBe(seen.create[0].transaction);
  });

  it('does not leak a transaction to ops outside the transaction() scope', async () => {
    await engine.insert('thing', { name: 'outside' });
    expect(seen.create.at(-1)!.transaction).toBeUndefined();
  });

  // ADR-0067 D2 — a nested transaction() JOINS the ambient one instead of
  // opening a second driver transaction (which would deadlock a
  // single-connection pool and escape the outer rollback). The outer call
  // owns the one-and-only commit/rollback.
  it('a nested transaction() joins the ambient transaction (no second begin)', async () => {
    let outerTrx: unknown;
    let innerTrx: unknown;
    await engine.transaction(async (ctx: any) => {
      outerTrx = ctx.transaction;
      await engine.transaction(async (innerCtx: any) => {
        innerTrx = innerCtx.transaction;
        await engine.insert('thing', { name: 'nested' });
      });
    });
    expect(innerTrx).toBe(outerTrx); // joined, not a fresh begin
    expect(seen.create[0].transaction).toBe(outerTrx);
  });

  it('a throw inside a JOINED nested transaction() rolls back the OUTER one', async () => {
    await expect(engine.transaction(async () => {
      await engine.insert('thing', { name: 'first' });
      await engine.transaction(async () => {
        throw new Error('inner boom');
      });
    })).rejects.toThrow('inner boom');
    // the recording driver saw the write, but the outer tx rolled back —
    // rollback tracking lives on the driver; assert it was invoked.
    expect(seen.rollback.length).toBe(1);
    expect(seen.commit.length).toBe(0);
  });
});
