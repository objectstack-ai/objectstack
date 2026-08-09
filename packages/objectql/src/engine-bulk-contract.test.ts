// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.
//
// framework#3151 (engine layer): engine.insert(array) must not fabricate
// afterInsert contexts (or caller results) when the driver's bulkCreate
// returns the wrong number of records. A short / non-array return is refused
// with ERR_BULK_RESULT_MISMATCH rather than padded with undefined.

import { describe, it, expect } from 'vitest';
import { ObjectQL } from './engine.js';

function makeDriver(opts: { bulkCreate?: (object: string, rows: any[]) => Promise<any> } = {}) {
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
      if (opts.bulkCreate) return opts.bulkCreate(object, rows);
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

async function makeEngine(driverOpts?: { bulkCreate?: (object: string, rows: any[]) => Promise<any> }) {
  const engine = new ObjectQL();
  const d = makeDriver(driverOpts);
  engine.registerDriver(d.driver, true);
  await engine.init();
  engine.registry.registerObject({ name: 'task', fields: { title: { type: 'text' } } });
  return { engine, storeFor: d.storeFor };
}

describe('engine.insert(array) — driver result contract (framework#3151)', () => {
  it('rejects a short bulkCreate return and runs no afterInsert for the phantom rows', async () => {
    // Driver drops one row from its return set.
    const { engine } = await makeEngine({
      bulkCreate: async (_o, rows) => rows.slice(1).map((r, i) => ({ id: `id-${i}`, ...r })),
    });
    const afterCalls: any[] = [];
    engine.registerHook('afterInsert', async (ctx: any) => { afterCalls.push(ctx.result); }, { object: 'task' });

    await expect(engine.insert('task', [{ title: 'a' }, { title: 'b' }]))
      .rejects.toMatchObject({ code: 'ERR_BULK_RESULT_MISMATCH' });
    expect(afterCalls).toHaveLength(0); // never fed undefined
  });

  it('rejects a non-array bulkCreate return', async () => {
    const { engine } = await makeEngine({ bulkCreate: async () => undefined });
    await expect(engine.insert('task', [{ title: 'a' }, { title: 'b' }]))
      .rejects.toMatchObject({ code: 'ERR_BULK_RESULT_MISMATCH' });
  });

  it('accepts a correct one-per-row bulkCreate return (regression)', async () => {
    const { engine } = await makeEngine();
    const res = await engine.insert('task', [{ title: 'a' }, { title: 'b' }]);
    expect(res).toHaveLength(2);
    expect((res as any[]).every((r) => r?.id)).toBe(true);
  });

  it('leaves the single-record insert path unaffected by the batch guard', async () => {
    const { engine } = await makeEngine();
    const res = await engine.insert('task', { title: 'solo' });
    expect((res as any).id).toBeTruthy();
  });
});
