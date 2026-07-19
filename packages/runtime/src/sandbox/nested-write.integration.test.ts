// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * End-to-end regression for #1867 — nested cross-object writes from a hook.
 *
 * A child object's `afterInsert` / `afterUpdate` hook issues an engine write to
 * its parent (`ctx.api.object('parent').update(...)`). The parent *also* has a
 * hook, so the child's nested write fires a SECOND sandbox VM while the child's
 * hook is still in flight — the exact re-entrancy that used to crash the process
 * with `memory access out of bounds` under the old single-suspended-asyncify
 * model. This wires a REAL {@link ObjectQL} engine (in-memory driver) to the
 * real {@link QuickJSScriptRunner} through {@link hookBodyRunnerFactory}, so the
 * whole hook → sandbox → nested-write → nested-hook path is exercised.
 *
 * This is the "when a child changes, update the parent" rollup the issue says
 * authors could not write; it must complete without a crash and land the
 * correct denormalized total on the parent.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { ObjectQL, bindHooksToEngine } from '@objectstack/objectql';
import { hookBodyRunnerFactory } from './body-runner.js';
import { QuickJSScriptRunner } from './quickjs-runner.js';

const parent = {
  name: 'parent',
  label: 'Parent',
  fields: {
    id: { name: 'id', type: 'text' as const, primaryKey: true },
    total_amount: { name: 'total_amount', type: 'number' as const },
    child_count: { name: 'child_count', type: 'number' as const },
  },
};
const child = {
  name: 'child',
  label: 'Child',
  fields: {
    id: { name: 'id', type: 'text' as const, primaryKey: true },
    amount: { name: 'amount', type: 'number' as const },
    parent_id: { name: 'parent_id', type: 'text' as const },
  },
};

function makeMemoryDriver() {
  const stores = new Map<string, Map<string, Record<string, unknown>>>();
  const storeFor = (o: string) => {
    let s = stores.get(o);
    if (!s) { s = new Map(); stores.set(o, s); }
    return s;
  };
  let nextId = 0;
  const matches = (row: Record<string, unknown>, where: any): boolean => {
    if (!where || typeof where !== 'object') return true;
    for (const [k, v] of Object.entries(where)) {
      if (k.startsWith('$')) continue;
      const exp = (v && typeof v === 'object' && '$eq' in (v as any)) ? (v as any).$eq : v;
      if ((row[k] ?? null) !== (exp ?? null)) return false;
    }
    return true;
  };
  const driver: any = {
    name: 'memory', version: '0.0.0', supports: {},
    async connect() {}, async disconnect() {}, async checkHealth() { return true; }, async execute() { return null; },
    async find(o: string, ast: any) { return Array.from(storeFor(o).values()).filter((r) => matches(r, ast?.where)); },
    findStream() { throw new Error('ns'); },
    async findOne(o: string, ast: any) { for (const r of storeFor(o).values()) if (matches(r, ast?.where)) return r; return null; },
    async create(o: string, data: Record<string, unknown>) {
      nextId += 1; const id = (data.id as string) ?? `r_${nextId}`; const row = { ...data, id }; storeFor(o).set(id, row); return row;
    },
    async update(o: string, id: string, data: Record<string, unknown>) {
      const s = storeFor(o); const cur = s.get(id); if (!cur) throw new Error(`nf ${o}/${id}`);
      const up = { ...cur, ...data, id }; s.set(id, up); return up;
    },
    async upsert(o: string, data: Record<string, unknown>) { const id = data.id as string | undefined; return id && storeFor(o).has(id) ? this.update(o, id, data) : this.create(o, data); },
    async delete(o: string, id: string) { return storeFor(o).delete(id); },
    async count(o: string, ast: any) { return (await this.find(o, ast)).length; },
    async bulkCreate(o: string, rows: Record<string, unknown>[]) { return Promise.all(rows.map((r) => this.create(o, r))); },
    async bulkUpdate() { return []; }, async bulkDelete() {},
    async beginTransaction() { return { commit: async () => {}, rollback: async () => {} }; }, async commit() {}, async rollback() {},
  };
  return { driver, stores };
}

describe('#1867 nested cross-object write from a hook (real engine + sandbox)', () => {
  let engine: ObjectQL;

  beforeEach(async () => {
    engine = new ObjectQL();
    const { driver } = makeMemoryDriver();
    engine.registerDriver(driver, true);
    await engine.init();
    for (const o of [parent, child]) engine.registry.registerObject(o as any);
    // Generous hook budget: the subject here is nested-write correctness, not
    // the 250ms default. Each hook invocation compiles a fresh WASM module and
    // the nested parent hook compiles another inside the child's budget — on a
    // loaded CI machine that overhead alone blew 250ms ("hook
    // 'rollup_parent_total' exceeded timeout of 250ms").
    engine.setDefaultBodyRunner(
      hookBodyRunnerFactory(new QuickJSScriptRunner({ hookTimeoutMs: 10_000 }), { ql: engine, appId: 'test' }),
    );
  });

  it('a child afterInsert hook writes the parent rollup without crashing (parent has its own hook → real nested VM)', async () => {
    bindHooksToEngine(
      engine,
      [
        {
          name: 'rollup_parent_total',
          object: 'child',
          events: ['afterInsert', 'afterUpdate'],
          body: {
            language: 'js',
            source: `
              // On update the patch may omit parent_id; fall back to the
              // pre-write record so the rollup targets the right parent.
              const pid = ctx.input.parent_id || (ctx.previous && ctx.previous.parent_id);
              const rows = await ctx.api.object('child').find({ where: { parent_id: pid } });
              const total = rows.reduce((s, r) => s + (r.amount || 0), 0);
              await ctx.api.object('parent').update({ id: pid, total_amount: total, child_count: rows.length });
            `,
            capabilities: ['api.read', 'api.write'],
          },
        } as any,
        {
          name: 'parent_touch_marker',
          object: 'parent',
          events: ['afterUpdate'],
          // Trivial body — its mere presence forces a second sandbox VM to run
          // (re-entrant) while the child's hook VM is still suspended.
          body: { language: 'js', source: "return { seen: ctx.input.id };", capabilities: [] },
        } as any,
      ],
      { packageId: 'test' },
    );

    const p = await engine.insert('parent', { id: 'p1', total_amount: 0, child_count: 0 });
    await engine.insert('child', { id: 'c1', amount: 100, parent_id: p.id });
    await engine.insert('child', { id: 'c2', amount: 50, parent_id: p.id });

    const parentRow = (await engine.findOne('parent', { where: { id: 'p1' } })) as any;
    expect(parentRow.total_amount).toBe(150);
    expect(parentRow.child_count).toBe(2);
  }, 20000);

  it('re-rolls up on child update (afterUpdate nested write)', async () => {
    bindHooksToEngine(
      engine,
      [
        {
          name: 'rollup_parent_total',
          object: 'child',
          events: ['afterInsert', 'afterUpdate'],
          body: {
            language: 'js',
            source: `
              // On update the patch may omit parent_id; fall back to the
              // pre-write record so the rollup targets the right parent.
              const pid = ctx.input.parent_id || (ctx.previous && ctx.previous.parent_id);
              const rows = await ctx.api.object('child').find({ where: { parent_id: pid } });
              const total = rows.reduce((s, r) => s + (r.amount || 0), 0);
              await ctx.api.object('parent').update({ id: pid, total_amount: total, child_count: rows.length });
            `,
            capabilities: ['api.read', 'api.write'],
          },
        } as any,
      ],
      { packageId: 'test' },
    );

    await engine.insert('parent', { id: 'p1', total_amount: 0, child_count: 0 });
    await engine.insert('child', { id: 'c1', amount: 100, parent_id: 'p1' });
    expect(((await engine.findOne('parent', { where: { id: 'p1' } })) as any).total_amount).toBe(100);

    await engine.update('child', { id: 'c1', amount: 250, parent_id: 'p1' });
    expect(((await engine.findOne('parent', { where: { id: 'p1' } })) as any).total_amount).toBe(250);
  }, 20000);
});
