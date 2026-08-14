// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.
//
// framework#3172: engine.insertMany — batch insert with partial success. Bad
// rows are culled after beforeInsert (per-row verdicts), good rows are written
// in one driver batch, and beforeInsert hooks run exactly ONCE per row even
// when the batch contains bad rows (no whole-batch abort → no degradation
// re-run). This is the root fix for the #3152 probe scenario.

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
  const calls = { bulkCreate: 0, create: 0 };
  const driver: any = {
    name: 'memory', version: '0.0.0', supports: {},
    async connect() {}, async disconnect() {}, async checkHealth() { return true; }, async execute() { return null; },
    async find(object: string) { return Array.from(storeFor(object).values()); },
    async findOne() { return null; },
    async create(object: string, data: Record<string, unknown>) {
      calls.create += 1;
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
      calls.bulkCreate += 1;
      const out: any[] = [];
      for (const r of rows) {
        n += 1;
        const id = (r.id as string) ?? `r_${n}`;
        const row = { ...r, id };
        storeFor(object).set(id, row);
        out.push(row);
      }
      return out;
    },
    async bulkUpdate() { return []; }, async bulkDelete() {},
    async beginTransaction() { return { __trx: true, commit: async () => {}, rollback: async () => {} }; },
    async commit() {}, async rollback() {},
  };
  return { driver, storeFor, calls };
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
  return { engine, storeFor: d.storeFor, calls: d.calls };
}

describe('engine.insertMany — partial-success batch insert (framework#3172)', () => {
  it('runs beforeInsert exactly once per row even with a bad row in the batch (#3152 probe)', async () => {
    const { engine, storeFor } = await makeEngine();
    const beforeRuns: Record<string, number> = {};
    const afterRuns: Record<string, number> = {};
    engine.registerHook('beforeInsert', async (ctx: any) => {
      const key = ctx.input.data.name ?? '(missing)';
      beforeRuns[key] = (beforeRuns[key] ?? 0) + 1;
    }, { object: 'task' });
    engine.registerHook('afterInsert', async (ctx: any) => {
      const key = ctx.result?.name ?? '(missing)';
      afterRuns[key] = (afterRuns[key] ?? 0) + 1;
    }, { object: 'task' });

    const outcomes = await engine.insertMany('task', [
      // [#8682] The middle row's defect is the MISSING REQUIRED `name` — which
      // is what this case is about, and what makes the hook run for it. It used
      // to be spelled `{ slug: 'no-name' }`, which carried a second, undeclared
      // defect nobody meant to test: `slug` is not a field of `task`, so the
      // declared-field door now refuses that row BEFORE the hooks, and the
      // assertion below would be measuring the wrong refusal. An empty row says
      // exactly the one thing intended.
      { name: 'good1' }, {}, { name: 'good2' },
    ]);

    // The #3152 acceptance criterion: hooks fired ONCE per row.
    expect(beforeRuns).toEqual({ good1: 1, '(missing)': 1, good2: 1 });
    expect(afterRuns).toEqual({ good1: 1, good2: 1 }); // never for the dead row

    expect(outcomes).toHaveLength(3);
    expect(outcomes[0]).toMatchObject({ ok: true });
    expect(outcomes[1].ok).toBe(false);
    expect((outcomes[1] as any).error).toBeInstanceOf(Error);
    expect(outcomes[2]).toMatchObject({ ok: true });
    expect(Array.from(storeFor('task').values())).toHaveLength(2); // only good rows written
  });

  it('writes survivors in ONE driver batch and dead rows consume no autonumber', async () => {
    const { engine, calls } = await makeEngine();
    const outcomes = await engine.insertMany('task', [
      { name: 'a' }, { nope: true }, { name: 'b' },
    ]);

    expect(calls.bulkCreate).toBe(1);
    expect(calls.create).toBe(0); // no per-row fallback, no degradation
    const written = outcomes.filter((o) => o.ok) as Array<{ ok: true; record: any }>;
    // Contiguous numbering — the dead middle row consumed nothing.
    expect(written.map((o) => o.record.code)).toEqual(['T-001', 'T-002']);
  });

  it('returns all-error outcomes without touching the driver when every row is bad', async () => {
    const { engine, calls } = await makeEngine();
    const outcomes = await engine.insertMany('task', [{ x: 1 }, { y: 2 }]);

    expect(outcomes.every((o) => !o.ok)).toBe(true);
    expect(calls.bulkCreate).toBe(0);
    expect(calls.create).toBe(0);
  });

  it('leaves plain insert(array) semantics untouched (whole batch still aborts)', async () => {
    const { engine, storeFor } = await makeEngine();
    await expect(engine.insert('task', [{ name: 'a' }, { nope: 1 }]))
      .rejects.toThrow();
    expect(Array.from(storeFor('task').values())).toHaveLength(0);
  });
});
