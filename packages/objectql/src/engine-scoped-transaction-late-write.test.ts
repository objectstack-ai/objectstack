// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #22855 — work a unit starts and does not await (an `async: true` hook) does
 * not keep the unit's finished transaction handle, on either transaction
 * surface.
 *
 * The handle reaches such work two ways: AMBIENTLY, through the entry the unit
 * publishes into the engine's store (ADR-0034), and EXPLICITLY, threaded into
 * the callback's context (`tx.object(…)`, or a caller's `{ context: trx }`)
 * and from there into the triggered hook's `ctx.api`. Both close when the
 * callback settles, through the one helper both surfaces run their body in
 * (`ObjectQL.runOpenedUnit`, #22782's mechanism).
 *
 * The driver's handle refuses use once its unit committed or rolled back,
 * exactly as a knex transaction does ("Transaction query already complete"):
 * a stub that accepts a finished handle cannot tell the defect from the fix.
 * The real-driver twin is `packages/qa/dogfood/test/scoped-transaction-late-write.dogfood.test.ts`.
 */

import { describe, it, expect } from 'vitest';
import type { Hook } from '@objectstack/spec/data';
import { ObjectQL, ScopedContext } from './engine.js';
import { bindHooksToEngine } from './hook-binder.js';

function makeDriver() {
  const stores = new Map<string, Map<string, Record<string, unknown>>>();
  const storeFor = (o: string) => stores.get(o) ?? (stores.set(o, new Map()), stores.get(o)!);
  const finished = new WeakSet<object>();
  const creates: Array<{ object: string; transaction: unknown }> = [];
  const use = (options: any) => {
    const trx = options?.transaction;
    if (trx && finished.has(trx)) throw new Error('Transaction query already complete');
  };
  let n = 0;
  const driver: any = {
    name: 'primary', version: '0.0.0', supports: {}, creates,
    rowsOf: (o: string) => Array.from(storeFor(o).values()),
    async connect() {}, async disconnect() {}, async checkHealth() { return true; }, async execute() { return null; },
    async syncSchema() {},
    async find(o: string, ast: any, options: any) {
      use(options);
      const rows = Array.from(storeFor(o).values());
      return typeof ast?.limit === 'number' ? rows.slice(0, ast.limit) : rows;
    },
    async findOne(o: string, ast: any, options: any) { return (await this.find(o, ast, options))[0] ?? null; },
    async create(o: string, data: Record<string, unknown>, options: any) {
      use(options);
      creates.push({ object: o, transaction: options?.transaction });
      const row = { ...data, id: (data.id as string) ?? `${o}_${++n}` };
      storeFor(o).set(row.id as string, row);
      return row;
    },
    async update(o: string, id: string, data: Record<string, unknown>, options: any) {
      use(options);
      const row = { ...storeFor(o).get(String(id)), ...data, id };
      storeFor(o).set(String(id), row);
      return row;
    },
    async delete(o: string, id: string, options: any) { use(options); return storeFor(o).delete(String(id)); },
    async count(o: string, ast: any, options: any) { return (await this.find(o, ast, options)).length; },
    async bulkCreate(o: string, rows: Record<string, unknown>[], options: any) { return Promise.all(rows.map((r) => this.create(o, r, options))); },
    async bulkUpdate() { return []; }, async bulkDelete() {},
    async beginTransaction() { return { trx: ++n }; },
    async commit(h: object) { finished.add(h); },
    async rollback(h: object) { finished.add(h); },
  };
  return driver;
}

/** Each create the driver saw, as `[object, ran outside any unit]`. */
const unenrolled = (driver: { creates: Array<{ object: string; transaction: unknown }> }) =>
  driver.creates.map((c) => [c.object, c.transaction === undefined]);

const obj = (name: string) => ({
  name, label: name, fields: { id: { name: 'id', type: 'text', primaryKey: true }, name: { name: 'name', type: 'text' } },
});

/**
 * An engine whose `rec` object carries the card's `async: true` `afterInsert`
 * hook. The hook waits for `release()` — called once the unit has returned,
 * so the write it then makes is "later" by construction, not by a timer — and
 * reports what became of that write.
 */
async function makeEngine() {
  const log = () => {};
  const engine = new ObjectQL({ logger: { debug: log, info: log, warn: log, error: log } } as any);
  const driver = makeDriver();
  engine.registerDriver(driver, true);
  await engine.init();
  engine.registry.registerObject(obj('rec') as any, '__test__');
  engine.registry.registerObject(obj('note') as any, '__test__');
  let release!: () => void;
  const released = new Promise<void>((r) => { release = r; });
  let report!: (outcome: string) => void;
  const late = new Promise<string>((r) => { report = r; });
  const lateNote = {
    name: 'late_note', object: 'rec', events: ['afterInsert'], async: true, onError: 'log',
    handler: async (ctx: any) => {
      await released;
      try {
        await ctx.api.object('note').insert({ name: 'late' });
        report('stored');
      } catch (e) {
        report((e as Error).message);
      }
    },
  } as unknown as Hook;
  bindHooksToEngine(engine, [lateNote], { packageId: 'app:t' });
  const api = new ScopedContext({ isSystem: true } as any, engine as any);
  /** Let the hook make its late write, and wait for its outcome. */
  const lateOutcome = () => { release(); return late; };
  return { engine, driver, api, lateOutcome };
}

describe('#22855 — un-awaited work does not keep a finished unit\'s handle', () => {
  it('ctx.api.transaction, the write through the unit\'s own context (the card\'s probe): the late write is stored', async () => {
    const { driver, api, lateOutcome } = await makeEngine();
    await api.transaction(async (tx) => { await tx.object('rec').insert({ name: 'r1' }); });
    expect(await lateOutcome()).toBe('stored');
    expect(driver.rowsOf('note')).toMatchObject([{ name: 'late' }]);
    // The awaited write is still the unit's; the late one runs on its own connection.
    const [inUnit, lateWrite] = driver.creates;
    expect(inUnit).toMatchObject({ object: 'rec', transaction: { trx: expect.any(Number) } });
    expect(lateWrite).toEqual({ object: 'note', transaction: undefined });
  });

  it('ctx.api.transaction, the write enrolled only through the ambient store: the late write is stored', async () => {
    const { driver, api, lateOutcome } = await makeEngine();
    await api.transaction(async () => { await api.object('rec').insert({ name: 'r1' }); });
    expect(await lateOutcome()).toBe('stored');
    expect(unenrolled(driver)).toEqual([['rec', false], ['note', true]]);
  });

  it('a caller-opened engine transaction() whose handle the write carries explicitly: the late write is stored', async () => {
    const { engine, driver, lateOutcome } = await makeEngine();
    await engine.transaction(async (trx: any) => { await engine.insert('rec', { name: 'r1' }, { context: { ...trx, isSystem: true } }); });
    expect(await lateOutcome()).toBe('stored');
    expect(unenrolled(driver)).toEqual([['rec', false], ['note', true]]);
  });

  it('CONTROL no transaction: the late write is stored, unchanged', async () => {
    const { driver, api, lateOutcome } = await makeEngine();
    await api.object('rec').insert({ name: 'r1' });
    expect(await lateOutcome()).toBe('stored');
    expect(unenrolled(driver)).toEqual([['rec', true], ['note', true]]);
  });

  it('a JOINED unit\'s handle stays live until the OUTER callback settles', async () => {
    const { engine, driver, api } = await makeEngine();
    await engine.transaction(async () => {
      let joined!: ScopedContext;
      await api.transaction(async (tx, info) => { expect(info.owned).toBe(false); joined = tx; });
      // The inner callback has settled, the outer has not: still one unit.
      await joined.object('note').insert({ name: 'after-inner' });
    });
    expect(driver.creates).toMatchObject([{ object: 'note', transaction: { trx: expect.any(Number) } }]);
  });
});
