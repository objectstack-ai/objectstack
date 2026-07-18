// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.
//
// framework#3147: a roll-up summary recompute that fails on the parent
// aggregate/update must be retried (transient), and — if it still fails — must
// be surfaced to the caller (SummaryRecomputeError / ERR_SUMMARY_RECOMPUTE)
// rather than swallowed with a warn. The triggering child records ARE written.

import { describe, it, expect } from 'vitest';
import { ObjectQL } from './engine.js';

function makeDriver(opts: { onParentUpdate?: (parentId: string, callN: number) => void } = {}) {
  const stores = new Map<string, Map<string, any>>();
  const storeFor = (o: string) => {
    let s = stores.get(o);
    if (!s) { s = new Map(); stores.set(o, s); }
    return s;
  };
  const matches = (row: any, where: any): boolean => {
    if (!where || typeof where !== 'object') return true;
    return Object.entries(where).every(([k, v]) => row?.[k] === v);
  };
  const parentCalls = new Map<string, number>();
  let n = 0;
  const driver: any = {
    name: 'memory', version: '0.0.0', supports: {},
    async connect() {}, async disconnect() {}, async checkHealth() { return true; }, async execute() { return null; },
    async find(object: string, ast: any) {
      return Array.from(storeFor(object).values()).filter((r) => matches(r, ast?.where));
    },
    findStream() { throw new Error('ni'); },
    async findOne(object: string, ast: any) {
      for (const r of storeFor(object).values()) if (matches(r, ast?.where)) return r;
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
      if (object === 'inv' && opts.onParentUpdate) {
        const callN = (parentCalls.get(id) ?? 0) + 1;
        parentCalls.set(id, callN);
        opts.onParentUpdate(id, callN); // may throw
      }
      const s = storeFor(object);
      const row = { ...s.get(id), ...data, id };
      s.set(id, row);
      return row;
    },
    async delete(object: string, id: string) { return storeFor(object).delete(id); },
    async count() { return 0; },
    async bulkCreate(object: string, rows: Record<string, unknown>[]) {
      return Promise.all(rows.map((r) => this.create(object, r)));
    },
    async bulkUpdate() { return []; }, async bulkDelete() {},
    async beginTransaction() { return { __trx: true, commit: async () => {}, rollback: async () => {} }; },
    async commit() {}, async rollback() {},
  };
  return { driver, storeFor, parentCalls };
}

async function makeEngine(driverOpts?: { onParentUpdate?: (parentId: string, callN: number) => void }) {
  const engine = new ObjectQL();
  const d = makeDriver(driverOpts);
  engine.registerDriver(d.driver, true);
  await engine.init();
  // Deterministic, fast backoff for the retry tests.
  engine.summaryRetryOptions = { sleep: async () => {}, backoffBaseMs: 0 };
  engine.registry.registerObject({
    name: 'inv',
    fields: {
      name: { type: 'text' },
      line_total: { type: 'summary', summaryOperations: { object: 'inv_line', field: 'amount', function: 'sum' } },
    },
  } as any);
  engine.registry.registerObject({
    name: 'inv_line',
    fields: { amount: { type: 'number' }, inv: { type: 'master_detail', reference: 'inv' } },
  } as any);
  return { engine, storeFor: d.storeFor, parentCalls: d.parentCalls };
}

describe('roll-up summary recompute — retry + surface failures (framework#3147)', () => {
  it('retries a transient parent-update failure and lands the correct summary', async () => {
    const { engine, storeFor } = await makeEngine({
      onParentUpdate: (_id, callN) => { if (callN === 1) throw new Error('fetch failed'); },
    });
    const p = await engine.insert('inv', { name: 'INV-1' });
    // Child insert succeeds; the parent summary update throws once then retries.
    await engine.insert('inv_line', { inv: p.id, amount: 42 });

    expect(storeFor('inv').get(p.id).line_total).toBe(42);
  });

  it('surfaces ERR_SUMMARY_RECOMPUTE when retries are exhausted, and the child is still written', async () => {
    const { engine, storeFor } = await makeEngine({
      onParentUpdate: () => { throw new Error('ETIMEDOUT'); }, // persistent transient
    });
    const p = await engine.insert('inv', { name: 'INV-2' });

    let caught: any;
    await engine.insert('inv_line', { inv: p.id, amount: 10 }).catch((e) => { caught = e; });

    expect(caught?.code).toBe('ERR_SUMMARY_RECOMPUTE');
    expect(Array.isArray(caught?.failures)).toBe(true);
    expect(caught.failures[0]).toMatchObject({ parentObject: 'inv', field: 'line_total' });
    // The child record WAS written (only the summary recompute failed).
    expect(caught?.written).toBeTruthy();
    expect(Array.from(storeFor('inv_line').values())).toHaveLength(1);
  });

  it('does not retry a non-transient parent-update failure (single attempt), still surfaces it', async () => {
    const { engine, parentCalls } = await makeEngine({
      onParentUpdate: () => { throw new Error('validation failed: bad summary'); },
    });
    const p = await engine.insert('inv', { name: 'INV-3' });

    let caught: any;
    await engine.insert('inv_line', { inv: p.id, amount: 5 }).catch((e) => { caught = e; });

    expect(caught?.code).toBe('ERR_SUMMARY_RECOMPUTE');
    expect(parentCalls.get(p.id)).toBe(1); // no retry on a logical error
  });

  it('one failing parent does not block another parent recompute; failures list only the failed one', async () => {
    let failId: string | null = null;
    const { engine, storeFor } = await makeEngine({
      onParentUpdate: (id) => { if (id === failId) throw new Error('ETIMEDOUT'); },
    });
    const a = await engine.insert('inv', { name: 'A' });
    const b = await engine.insert('inv', { name: 'B' });
    failId = a.id; // only A's summary update fails

    // Insert one child per parent as a single batch so both recompute in one call.
    let caught: any;
    await engine.insert('inv_line', [
      { inv: a.id, amount: 7 },
      { inv: b.id, amount: 3 },
    ]).catch((e) => { caught = e; });

    expect(caught?.code).toBe('ERR_SUMMARY_RECOMPUTE');
    expect(caught.failures).toHaveLength(1);
    expect(caught.failures[0].parentId).toBe(a.id);
    // B's summary recomputed correctly despite A failing.
    expect(storeFor('inv').get(b.id).line_total).toBe(3);
  });
});
