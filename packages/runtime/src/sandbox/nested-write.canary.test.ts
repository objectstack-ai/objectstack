// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Flake canary for #3259 (ADR-0102 D1 — the CPU-time budget).
 *
 * #3259 was a LOAD flake, not a logic bug: on an oversubscribed CI runner the
 * fixed per-invocation WASM-module creation cost alone tripped the 250ms hook
 * deadline while the VM was still progressing — because the budget was
 * WALL-CLOCK. When many hook invocations run concurrently on one JS thread, any
 * single invocation spends most of its wall time PARKED at an `await` (host call
 * / `setImmediate` yield) while the OTHER invocations run; the old budget charged
 * that parked time to the parked invocation, so it blew 250ms under load even
 * though its own VM did microseconds of work. D1 made the budget script
 * CPU-time: only VM-active slices are charged, parked time is not, so the stock
 * 250ms budget is meaningful again under load.
 *
 * This canary reproduces that exact condition and asserts the fix holds: it runs
 * the real nested-write scenario (child `afterInsert` → nested `parent.update`
 * → the parent's OWN hook = a second re-entrant VM) across many chains
 * CONCURRENTLY through one shared stock runner. Every invocation runs at the
 * STOCK 250ms budget and must land the correct rollup with NOT ONE CPU-budget /
 * wall-ceiling error. Revert D1 to a wall-clock budget and the parked-while-
 * others-run time reappears on the charge → this goes red. That is the
 * regression it guards.
 *
 * Why the canary is itself robust (not flaky): the stressor is CONCURRENCY, not
 * unrelated CPU busy-loops. JS runs each synchronous VM slice to completion, so
 * concurrent chains interleave only BETWEEN slices (at `await` points), never
 * mid-slice — the `Date.now()`-measured slices stay accurate and no legitimate
 * tiny rollup body ever approaches 250ms of charged VM-active time regardless of
 * how many chains are in flight.
 */

import { describe, it, expect } from 'vitest';
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

// The rollup hook the issue says authors could not write, plus a trivial parent
// hook whose mere presence forces a SECOND, re-entrant sandbox VM while the
// child's hook VM is still in flight.
const hooks = [
  {
    name: 'rollup_parent_total',
    object: 'child',
    events: ['afterInsert', 'afterUpdate'],
    body: {
      language: 'js',
      source: `
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
    body: { language: 'js', source: "return { seen: ctx.input.id };", capabilities: [] },
  } as any,
];

describe('#3259 flake canary — nested writes stay green at the stock 250ms CPU budget under concurrency', () => {
  // One shared stock runner (250ms CPU budget), exactly as production wires it —
  // many concurrent invocations, each still getting its own isolated WASM module.
  const runner = new QuickJSScriptRunner();

  async function rollupChain(n: number) {
    const engine = new ObjectQL();
    const { driver } = makeMemoryDriver();
    engine.registerDriver(driver, true);
    await engine.init();
    for (const o of [parent, child]) engine.registry.registerObject(o as any);
    engine.setDefaultBodyRunner(hookBodyRunnerFactory(runner, { ql: engine, appId: 'test' }));
    bindHooksToEngine(engine, hooks, { packageId: 'test' });

    const pid = `p_${n}`;
    await engine.insert('parent', { id: pid, total_amount: 0, child_count: 0 });
    await engine.insert('child', { id: `c_${n}_1`, amount: 100, parent_id: pid });
    await engine.insert('child', { id: `c_${n}_2`, amount: 50, parent_id: pid });
    return (await engine.findOne('parent', { where: { id: pid } })) as any;
  }

  it('runs many concurrent nested-write rollups with no CPU-budget / wall-ceiling errors', async () => {
    // Enough chains in flight that, under the OLD wall-clock budget, each one's
    // parked-while-others-run time blows past 250ms; under the CPU budget it does
    // not, because that parked time is not charged. Validated during development:
    // temporarily reverting the interrupt handler to a `Date.now() - start` wall
    // budget turns this suite RED from ~64 chains up, while the shipped CPU budget
    // stays green through 256 — so this is a real regression gate, not a no-op.
    // `OS_CANARY_CONCURRENCY` overrides it for an ad-hoc heavier soak.
    const CONCURRENCY = Number(process.env.OS_CANARY_CONCURRENCY) || 128;

    const results = await Promise.allSettled(
      Array.from({ length: CONCURRENCY }, (_, n) => rollupChain(n)),
    );

    const reasons = results
      .filter((r): r is PromiseRejectedResult => r.status === 'rejected')
      .map((r) => String(r.reason?.message ?? r.reason));

    // The signature of a #3259 regression: a load-induced budget/ceiling trip.
    // Assert it separately so a failure names the actual cause, not a generic count.
    const budgetTrips = reasons.filter((m) => /CPU budget|wall-clock ceiling/.test(m));
    expect(budgetTrips, 'no load-induced CPU-budget / wall-ceiling trips at the stock 250ms budget').toEqual([]);

    // No failures of any kind, and every rollup landed the correct denormalized total.
    expect(reasons, 'all concurrent nested-write chains succeed').toEqual([]);
    for (const r of results) {
      expect(r.status).toBe('fulfilled');
      if (r.status === 'fulfilled') {
        expect(r.value.total_amount).toBe(150);
        expect(r.value.child_count).toBe(2);
      }
    }
  }, 120000);
});
