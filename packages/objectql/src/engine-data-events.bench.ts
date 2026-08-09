// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Write-path cost of publishing realtime data events.
 *
 * #4655 (the #4626 fix) claimed this had been measured and never published the
 * numbers — so the per-event `crypto.randomUUID()` + `DataEventSchema.parse()`
 * added to every insert/update/delete has had no evidence behind it since.
 * #4639 adds a second publisher (`BulkDataEventSchema.parse` on predicate
 * writes), which is the moment to actually pay that debt rather than repeat the
 * claim.
 *
 * Run: `pnpm --filter @objectstack/objectql exec vitest bench src/engine-data-events.bench.ts`
 *
 * Each pair below is the SAME write with and without a realtime service
 * attached, so the delta is exactly the event-publishing work: uuid generation,
 * schema validation, envelope construction, and the (no-op) publish. The
 * stub driver keeps driver cost near zero, which flatters the event cost —
 * i.e. the relative overhead measured here is an upper bound on what a real
 * SQL/HTTP driver would show.
 */

import { bench, describe } from 'vitest';
import type { IRealtimeService, RealtimeEventPayload } from '@objectstack/spec/contracts';
import { ObjectQL } from './engine.js';

const task = {
  name: 'task',
  label: 'Task',
  fields: {
    id: { name: 'id', type: 'text' as const, primaryKey: true },
    title: { name: 'title', type: 'text' as const },
    status: { name: 'status', type: 'text' as const },
  },
};

function makeStubDriver() {
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
      nextId += 1;
      const id = (data.id as string) ?? `r_${nextId}`;
      const row = { ...data, id };
      storeFor(o).set(id, row);
      return row;
    },
    async update(o: string, id: string, data: Record<string, unknown>) {
      const s = storeFor(o); const cur = s.get(id);
      if (!cur) throw new Error(`nf ${o}/${id}`);
      const up = { ...cur, ...data, id }; s.set(id, up); return up;
    },
    async upsert(o: string, data: Record<string, unknown>) {
      const id = data.id as string | undefined;
      return id && storeFor(o).has(id) ? this.update(o, id, data) : this.create(o, data);
    },
    async delete(o: string, id: string) { return storeFor(o).delete(id); },
    async count(o: string, ast: any) { return (await this.find(o, ast)).length; },
    async bulkCreate(o: string, rows: Record<string, unknown>[]) { return Promise.all(rows.map((r) => this.create(o, r))); },
    async updateMany(o: string, ast: any, data: Record<string, unknown>) {
      const rows = await this.find(o, ast);
      for (const r of rows) storeFor(o).set(r.id as string, { ...r, ...data });
      return rows.length;
    },
    async deleteMany(o: string, ast: any) {
      const rows = await this.find(o, ast);
      for (const r of rows) storeFor(o).delete(r.id as string);
      return rows.length;
    },
    async bulkUpdate() { return []; }, async bulkDelete() {},
    async beginTransaction() { return { commit: async () => {}, rollback: async () => {} }; },
    async commit() {}, async rollback() {},
  };
  return driver;
}

/** A publish sink that does nothing, so we time the PRODUCER, not a transport. */
const nullRealtime: IRealtimeService = {
  publish: async (_event: RealtimeEventPayload) => undefined,
  subscribe: async () => 'sub',
  unsubscribe: async () => undefined,
};

async function makeEngine(withRealtime: boolean): Promise<ObjectQL> {
  const engine = new ObjectQL();
  engine.registerDriver(makeStubDriver(), true);
  await engine.init();
  engine.registry.registerObject(task, 'bench');
  if (withRealtime) engine.setRealtimeService(nullRealtime);
  // Silence the per-write logger so log formatting is not in the measurement.
  const logger = (engine as any).logger;
  for (const level of ['debug', 'info', 'warn']) logger[level] = () => undefined;
  return engine;
}

/**
 * Each case gets its OWN engine pair. Sharing one pair across cases invalidates
 * the comparison: vitest runs the two arms of a case for a fixed WALL-CLOCK
 * budget, not a fixed iteration count, so the faster arm executes far more
 * iterations — and any state those iterations accumulate (rows inserted, rows
 * flipped) then diverges between the two engines. A later case measured on
 * those engines is comparing different table sizes, not different event
 * settings. The first draft of this file shared one pair and duly reported the
 * predicate write as *faster* with events enabled, because the events-off
 * engine had ~84k rows to scan against the events-on engine's ~47k.
 */
const SEED_ROWS = 100;

async function makePair(): Promise<[ObjectQL, ObjectQL]> {
  const pair = [await makeEngine(true), await makeEngine(false)] as [ObjectQL, ObjectQL];
  for (const engine of pair) {
    await engine.insert(
      'task',
      Array.from({ length: SEED_ROWS }, (_, i) => ({ title: `seed ${i}`, status: 'open' })),
    );
  }
  return pair;
}

/**
 * Memoized lazy init. Two constraints rule out the obvious alternatives:
 * this package compiles to CommonJS, so a top-level `await` is a TS1309 error;
 * and vitest's benchmark mode is experimental and does NOT run `beforeAll`, so
 * a hook-based setup leaves every engine `undefined`, every iteration throwing,
 * and the summary reporting `NaNx faster` off zero samples.
 *
 * Awaiting an already-settled promise costs one microtask, paid identically by
 * both arms, so the delta each case reports is unaffected — and the actual
 * construction happens during vitest's warmup iterations, outside the measured
 * samples.
 */
function lazyPair(): () => Promise<[ObjectQL, ObjectQL]> {
  let pending: Promise<[ObjectQL, ObjectQL]> | undefined;
  return () => (pending ??= makePair());
}

const insertPair = lazyPair();
const updatePair = lazyPair();
const bulkPair = lazyPair();

describe('insert — per-record DataEvent (#4626)', () => {
  bench('with realtime service', async () => {
    const [on] = await insertPair();
    await on.insert('task', { title: 'bench', status: 'open' });
  });

  bench('without realtime service', async () => {
    const [, off] = await insertPair();
    await off.insert('task', { title: 'bench', status: 'open' });
  });
});

describe('single-id update — per-record DataEvent (#4626)', () => {
  bench('with realtime service', async () => {
    const [on] = await updatePair();
    await on.update('task', { id: 'r_1', title: 'bench' });
  });

  bench('without realtime service', async () => {
    const [, off] = await updatePair();
    await off.update('task', { id: 'r_1', title: 'bench' });
  });
});

describe('predicate update — one aggregate BulkDataEvent (#4639)', () => {
  // The event cost here is per WRITE, not per row: one uuid + one
  // `BulkDataEventSchema.parse` regardless of how many rows matched. The gap
  // between these two arms is the whole of what #4639 adds to a bulk write.
  //
  // The predicate writes `title` and filters on `status`, so it matches the
  // same SEED_ROWS rows on every iteration — a filter that mutated the column
  // it selects on would shrink its own match set as the bench ran, making the
  // two arms diverge exactly like the shared-engine bug above.
  bench('with realtime service', async () => {
    const [on] = await bulkPair();
    await on.update('task', { title: 'bench' }, { multi: true, where: { status: 'open' } } as any);
  });

  bench('without realtime service', async () => {
    const [, off] = await bulkPair();
    await off.update('task', { title: 'bench' }, { multi: true, where: { status: 'open' } } as any);
  });
});
