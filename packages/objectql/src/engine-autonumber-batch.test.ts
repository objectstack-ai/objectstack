// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.
//
// framework#3152: a batch insert that dies in validation must not have already
// consumed autonumber sequence values for its good rows. Autonumbers are now
// assigned AFTER validation, so a doomed attempt (which bulkWrite then degrades
// to per-row) leaves no gaps in the number range.

import { describe, it, expect } from 'vitest';
import { ObjectQL } from './engine.js';

function makeDriver() {
  const stores = new Map<string, Map<string, any>>();
  const storeFor = (o: string) => {
    let s = stores.get(o);
    if (!s) { s = new Map(); stores.set(o, s); }
    return s;
  };
  let n = 0;
  const driver: any = {
    name: 'memory', version: '0.0.0', supports: {},
    async connect() {}, async disconnect() {}, async checkHealth() { return true; }, async execute() { return null; },
    async find(object: string) { return Array.from(storeFor(object).values()); },
    async findOne() { return null; },
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
    async delete(object: string, id: string) { return storeFor(object).delete(id); },
    async count() { return 0; },
    async bulkCreate(object: string, rows: Record<string, unknown>[]) {
      const out: any[] = [];
      for (const r of rows) out.push(await this.create(object, r));
      return out;
    },
    async bulkUpdate() { return []; }, async bulkDelete() {},
    async beginTransaction() { return { __trx: true, commit: async () => {}, rollback: async () => {} }; },
    async commit() {}, async rollback() {},
  };
  return { driver, storeFor };
}

async function makeEngine() {
  const engine = new ObjectQL();
  const d = makeDriver();
  engine.registerDriver(d.driver, true);
  await engine.init();
  engine.registry.registerObject({
    name: 'task',
    fields: {
      name: { type: 'text', required: true },
      code: { type: 'autonumber', format: 'T-{000}' },
    },
  } as any);
  return { engine, storeFor: d.storeFor };
}

describe('batch insert — autonumber assigned after validation (framework#3152)', () => {
  it('a validation-failed batch consumes no autonumber, leaving no gap for the degraded per-row retry', async () => {
    const { engine } = await makeEngine();

    // A batch with a bad (name-less) middle row fails in validation before any
    // driver write. Previously the good rows had already been numbered.
    await expect(engine.insert('task', [{ name: 'a' }, { slug: 'no-name' }, { name: 'b' }]))
      .rejects.toThrow();

    // bulkWrite would now degrade to per-row; simulate that by inserting the
    // good rows individually. Their numbers must be contiguous from 1.
    const a = await engine.insert('task', { name: 'a' });
    const b = await engine.insert('task', { name: 'b' });

    expect(a.code).toBe('T-001');
    expect(b.code).toBe('T-002'); // no gap — the failed batch consumed nothing
  });

  it('a fully-valid batch still numbers every row contiguously', async () => {
    const { engine } = await makeEngine();
    const rows = await engine.insert('task', [{ name: 'a' }, { name: 'b' }, { name: 'c' }]);
    expect((rows as any[]).map((r) => r.code)).toEqual(['T-001', 'T-002', 'T-003']);
  });
});
