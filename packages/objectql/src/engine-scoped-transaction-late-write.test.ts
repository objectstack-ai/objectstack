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
 * (`ObjectQL.runOpenedUnit`, #22782's mechanism). The write door reads the
 * handle the same way, so a late write opens the door's own unit (#22782)
 * when its hooks call for one, as a write outside any unit does.
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
  let stores = new Map<string, Map<string, Record<string, unknown>>>();
  const storeFor = (o: string) => stores.get(o) ?? (stores.set(o, new Map()), stores.get(o)!);
  const finished = new WeakSet<object>();
  const creates: Array<{ object: string; transaction: unknown }> = [];
  // A rollback restores the snapshot its unit began from, so "rolled back" is
  // observable in the rows, not only in a call count.
  const snapshots = new Map<object, typeof stores>();
  const begun: object[] = [];
  const rolledBack: object[] = [];
  const use = (options: any) => {
    const trx = options?.transaction;
    if (trx && finished.has(trx)) throw new Error('Transaction query already complete');
  };
  let n = 0;
  const driver: any = {
    name: 'primary', version: '0.0.0', supports: {}, creates, begun, rolledBack,
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
    async beginTransaction() {
      const handle = { trx: ++n };
      snapshots.set(handle, new Map(Array.from(stores, ([o, rows]) => [o, new Map(Array.from(rows, ([k, v]) => [k, { ...v }]))])));
      begun.push(handle);
      return handle;
    },
    async commit(h: object) { finished.add(h); snapshots.delete(h); },
    async rollback(h: object) { finished.add(h); stores = snapshots.get(h) ?? stores; rolledBack.push(h); },
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
 * reports what became of that write. `noteVeto` gives `note` a blocking
 * `afterInsert` with the default `onError` (`abort`) that throws.
 */
async function makeEngine(opts: { noteVeto?: boolean } = {}) {
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
  const noteVeto = {
    name: 'note_veto', object: 'note', events: ['afterInsert'],
    handler: () => { throw new Error('refused by the note hook'); },
  } as unknown as Hook;
  bindHooksToEngine(engine, opts.noteVeto ? [lateNote, noteVeto] : [lateNote], { packageId: 'app:t' });
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

  it('a late write in a closed unit opens the door\'s own unit when a blocking after* hook can abort it, and the abort rolls it back', async () => {
    const { driver, api, lateOutcome } = await makeEngine({ noteVeto: true });
    await api.transaction(async (tx) => { await tx.object('rec').insert({ name: 'r1' }); });
    const [begun, rolledBack] = [driver.begun.length, driver.rolledBack.length];
    expect(await lateOutcome()).toBe('refused by the note hook');
    expect([driver.begun.length - begun, driver.rolledBack.length - rolledBack]).toEqual([1, 1]);
    expect(driver.rowsOf('note')).toEqual([]);
    expect(driver.rowsOf('rec')).toMatchObject([{ name: 'r1' }]);
  });

  it('CONTROL the same late write with no transaction: one door unit, rolled back, unchanged', async () => {
    const { driver, api, lateOutcome } = await makeEngine({ noteVeto: true });
    await api.object('rec').insert({ name: 'r1' });
    const [begun, rolledBack] = [driver.begun.length, driver.rolledBack.length];
    expect(await lateOutcome()).toBe('refused by the note hook');
    expect([driver.begun.length - begun, driver.rolledBack.length - rolledBack]).toEqual([1, 1]);
    expect(driver.rowsOf('note')).toEqual([]);
    expect(driver.rowsOf('rec')).toMatchObject([{ name: 'r1' }]);
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

/**
 * An `async: true` after-hook's work runs outside the write's unit, whoever
 * opened it. The write door opens a unit of its own when the object has a
 * blocking `after*` hook that can abort (#22782): adding such a hook beside an
 * `async` one used to enrol the async hook's `ctx.api` writes in that unit,
 * because the async hook starts while the unit is still open and reads it
 * ambiently. The unit then committed under them and the writes failed with
 * "Transaction query already complete".
 *
 * [#33760] The async hook no longer starts inside that unit at all: it waits
 * for the unit's commit (the commit-dispatch describe at the end of this
 * file). The blocking leg used to wait here until the async hook's write had
 * reached the driver, which fixed the order the real failure took; that write
 * cannot reach the driver before the commit now, so the leg records whether
 * the async hook had started instead, and the pins below read `false`. What
 * they still pin is #33651's: the async hook's write is stored, outside the
 * unit, on its own connection.
 */
async function makeUpdateEngine(legs: { blocking?: boolean; secondAsync?: boolean; asyncLeg?: boolean; ownUnit?: boolean } = {}) {
  const log = () => {};
  const engine = new ObjectQL({ logger: { debug: log, info: log, warn: log, error: log } } as any);
  const driver = makeDriver();
  let reached = () => {};
  let landed!: () => void;
  const commitLanded = new Promise<void>((r) => { landed = r; });
  const commit = driver.commit;
  driver.commit = async (h: object) => { await commit(h); landed(); };
  // The async hook's statement, issued on the handle of a unit open when the
  // hook started, runs once that unit's commit has landed: a knex query queued
  // on the unit's connection behind its COMMIT. Outside any unit, or in a unit
  // the hook opened itself, it runs at once.
  let openAtDispatch = new Set<object>();
  const create = driver.create.bind(driver);
  driver.create = async (o: string, data: Record<string, unknown>, options: any) => {
    if (o === 'note' && data.name === 'drafted') {
      reached();
      if (openAtDispatch.has(options?.transaction)) await commitLanded;
    }
    return create(o, data, options);
  };
  engine.registerDriver(driver, true);
  await engine.init();
  engine.registry.registerObject(obj('rec') as any, '__test__');
  engine.registry.registerObject(obj('note') as any, '__test__');
  const outcomes: string[] = [];
  let asyncStarted = false;
  let report!: (outcome: string) => void;
  const drafted = new Promise<string>((r) => { report = r; });
  const draftNote = {
    name: 'draft_note', object: 'rec', events: ['afterUpdate'], async: true, runAs: 'system', onError: 'log',
    handler: async (ctx: any) => {
      asyncStarted = true;
      openAtDispatch = new Set(driver.begun);
      try {
        if (legs.ownUnit) {
          await ctx.api.transaction(async (tx: any) => { await tx.object('note').insert({ name: 'drafted' }); });
        } else {
          await ctx.api.object('note').insert({ name: 'drafted' });
        }
        report('stored');
      } catch (e) {
        report((e as Error).message);
      }
    },
  } as unknown as Hook;
  const blockingLeg = {
    name: 'blocking_leg', object: 'rec', events: ['afterUpdate'], priority: 400,
    handler: async (ctx: any) => {
      await ctx.api.object('note').insert({ name: 'blocking' });
      outcomes.push(asyncStarted ? 'blocking ran after the async hook started' : 'blocking ran');
    },
  } as unknown as Hook;
  const secondAsync = { ...blockingLeg, name: 'second_async', async: true, onError: 'log' } as unknown as Hook;
  const hooks = [
    ...(legs.asyncLeg === false ? [] : [draftNote]),
    ...(legs.blocking ? [blockingLeg] : []),
    ...(legs.secondAsync ? [secondAsync] : []),
  ];
  bindHooksToEngine(engine, hooks, { packageId: 'app:t' });
  const api = new ScopedContext({ isSystem: true } as any, engine as any);
  await api.object('rec').insert({ id: 'r1', name: 'r1' });
  driver.creates.length = 0;
  return { engine, driver, api, drafted, outcomes };
}

/** Each `note` create the driver saw: did it run outside any unit? */
const noteUnenrolled = (driver: any) =>
  driver.creates.filter((c: any) => c.object === 'note').map((c: any) => c.transaction === undefined);

describe('an async after-hook beside a blocking one writes outside the door\'s unit', () => {
  it('a blocking afterUpdate beside an async one: the async hook\'s write is stored, on its own connection', async () => {
    const { driver, api, drafted, outcomes } = await makeUpdateEngine({ blocking: true });
    await api.object('rec').updateById('r1', { name: 'accepted' });
    expect(outcomes).toEqual(['blocking ran']);
    expect(await drafted).toBe('stored');
    // The door still opened its unit for the blocking leg, and that leg's write is the unit's.
    expect(driver.begun).toHaveLength(1);
    expect(noteUnenrolled(driver).sort()).toEqual([false, true]);
    expect(driver.rowsOf('note').map((r: any) => r.name).sort()).toEqual(['blocking', 'drafted']);
  });

  it('inside a caller\'s ctx.api.transaction, the write threaded through the unit\'s own context: the async hook\'s write is stored outside it', async () => {
    const { driver, api, drafted } = await makeUpdateEngine();
    await api.transaction(async (tx) => { await tx.object('rec').updateById('r1', { name: 'accepted' }); });
    expect(await drafted).toBe('stored');
    expect(driver.begun).toHaveLength(1);
    expect(noteUnenrolled(driver)).toEqual([true]);
  });

  it('inside a caller\'s engine transaction(), the write enrolled only ambiently: the async hook\'s write is stored outside it', async () => {
    const { engine, driver, api, drafted } = await makeUpdateEngine();
    await engine.transaction(async () => { await api.object('rec').updateById('r1', { name: 'accepted' }); });
    expect(await drafted).toBe('stored');
    expect(driver.begun).toHaveLength(1);
    expect(noteUnenrolled(driver)).toEqual([true]);
  });

  it('a unit the async hook opens itself is its own: its write is enrolled in it and stored', async () => {
    const { driver, api, drafted } = await makeUpdateEngine({ ownUnit: true });
    await api.object('rec').updateById('r1', { name: 'accepted' });
    expect(await drafted).toBe('stored');
    expect(driver.begun).toHaveLength(1);
    expect(noteUnenrolled(driver)).toEqual([false]);
  });

  it('CONTROL async only: no unit, the write is stored outside any, unchanged', async () => {
    const { driver, api, drafted } = await makeUpdateEngine();
    await api.object('rec').updateById('r1', { name: 'accepted' });
    expect(await drafted).toBe('stored');
    expect(driver.begun).toHaveLength(0);
    expect(noteUnenrolled(driver)).toEqual([true]);
    expect(driver.rowsOf('note')).toMatchObject([{ name: 'drafted' }]);
  });

  it('CONTROL the second leg async too: no unit, both writes stored, unchanged', async () => {
    const { driver, api, drafted } = await makeUpdateEngine({ secondAsync: true });
    await api.object('rec').updateById('r1', { name: 'accepted' });
    expect(await drafted).toBe('stored');
    expect(driver.begun).toHaveLength(0);
  });

  it('CONTROL blocking only: its write joins the door\'s unit, unchanged', async () => {
    const { driver, api, outcomes } = await makeUpdateEngine({ blocking: true, asyncLeg: false });
    await api.object('rec').updateById('r1', { name: 'accepted' });
    expect(outcomes).toEqual(['blocking ran']);
    expect(driver.begun).toHaveLength(1);
    expect(noteUnenrolled(driver)).toEqual([false]);
  });
});

/**
 * #33760 — an `async: true` after-hook fired inside a unit of work starts once
 * the OUTERMOST unit commits, and never when it rolls back (`unit-detach.ts`,
 * `runOutsideOpenUnitsOnCommit`). Before, it started at dispatch, inside the
 * unit: on a multi-connection database its `ctx.api` reads ran before the
 * triggering write was visible, and a rollback did not stop it.
 *
 * Every unit the engine owns is one: a caller's `engine.transaction()`, a
 * hook's or handler's `ctx.api.transaction(fn)`, and the write door's own unit
 * for a blocking `after*` hook that can abort (#22782). The order is read off
 * one event log the driver's commit and rollback write to, and a dropped run
 * is read off the engine's own `debug` line for it, so "never ran" is an
 * event, not a timeout.
 */
async function makeCommitEngine() {
  const events: string[] = [];
  let dropped!: (hook: string) => void;
  const drops: string[] = [];
  const quiet = () => {};
  // A deferred run's failure reaches the wrapper's error line (fire-and-forget).
  let errored!: (hook: string) => void;
  const erroredRun = new Promise<string>((r) => { errored = r; });
  const logger = {
    debug: (msg: string, meta?: any) => { if (/rolled back/.test(msg)) { drops.push(meta?.hook); dropped?.(meta?.hook); } },
    info: quiet, warn: quiet,
    error: (msg: string, _err?: unknown, meta?: any) => {
      if (/fire-and-forget/.test(msg)) { events.push(`error logged:${meta?.hook}`); errored(meta?.hook); }
    },
  };
  const engine = new ObjectQL({ logger } as any);
  const driver = makeDriver();
  const commit = driver.commit;
  driver.commit = async (h: object) => { await commit(h); events.push('commit'); };
  const rollback = driver.rollback;
  driver.rollback = async (h: object) => { await rollback(h); events.push('rollback'); };
  engine.registerDriver(driver, true);
  await engine.init();
  engine.registry.registerObject(obj('rec') as any, '__test__');
  engine.registry.registerObject(obj('note') as any, '__test__');
  const ran: Record<string, Promise<number>> = {};
  const settle: Record<string, (seen: number) => void> = {};
  const runOf = (name: string) => (ran[name] ??= new Promise<number>((r) => { settle[name] = r; }));
  const asyncNote = {
    name: 'async_note', object: 'rec', events: ['afterInsert'], async: true, onError: 'log',
    handler: async (ctx: any) => {
      const name = String(ctx.input.name);
      events.push(`async started:${name}`);
      runOf(name);
      // What the hook sees of its triggering row, and a write that references it.
      const seen = (await ctx.api.object('rec').find({})).filter((r: any) => r.name === name).length;
      await ctx.api.object('note').insert({ name: `note:${name}` });
      settle[name]!(seen);
    },
  } as unknown as Hook;
  // The door's unit: a blocking `afterInsert` that can abort (default `onError`),
  // after the async one (priority 400 > 100), which vetoes a `veto` name.
  const gate = {
    name: 'gate', object: 'rec', events: ['afterInsert'], priority: 400,
    handler: (ctx: any) => {
      events.push(`gate:${ctx.input.name}`);
      if (String(ctx.input.name).startsWith('veto')) throw new Error('refused by the gate');
    },
  } as unknown as Hook;
  // [#33760 review] A `'user'` pin on a trigger that carries no user: the
  // handler's `ctx.api` is the unscoped api (`UnscopedHookApi`), which has no
  // engine and no detach of its own. It records the api it got, and touches no
  // data (that api refuses every data door).
  const apiKinds: string[] = [];
  const userPin = {
    name: 'user_pin', object: 'rec', events: ['afterInsert'], async: true, runAs: 'user', onError: 'log',
    handler: (ctx: any) => {
      const name = String(ctx.input.name);
      events.push(`user-pin started:${name}`);
      apiKinds.push(ctx.api?.constructor?.name);
      runOf(name);
      settle[name]!(0);
    },
  } as unknown as Hook;
  // [#33760 review#2] A read's `async` hook: a rollback does not undo the read,
  // so its run is not the unit's to hold or drop. It writes a note of its own.
  const readNote = {
    name: 'read_note', object: 'rec', events: ['afterFind'], async: true, onError: 'log',
    handler: async (ctx: any) => {
      events.push('read-hook started');
      runOf('read');
      await ctx.api.object('note').insert({ name: 'note:read' });
      settle.read!(0);
    },
  } as unknown as Hook;
  // A deferred run that throws once it starts, after the commit. The default
  // `onError` ('abort'), so the throw reaches the fire-and-forget catch.
  const thrower = {
    name: 'thrower', object: 'rec', events: ['afterInsert'], async: true,
    handler: async () => { events.push('thrower started'); throw new Error('the deferred run fails'); },
  } as unknown as Hook;
  const bind = (withGate: boolean, opts: { userPin?: boolean; read?: boolean; thrower?: boolean } = {}) => bindHooksToEngine(
    engine,
    opts.read ? [readNote] : opts.thrower ? [thrower] : opts.userPin ? [userPin] : withGate ? [asyncNote, gate] : [asyncNote],
    { packageId: 'app:t', logger: logger as any },
  );
  const api = new ScopedContext({ isSystem: true } as any, engine as any);
  const droppedRun = () => new Promise<string>((r) => { dropped = r; });
  const notes = () => driver.rowsOf('note').map((r: any) => r.name);
  return { engine, driver, api, events, drops, bind, runOf, droppedRun, notes, apiKinds, erroredRun };
}

/** Did the read's hook start while the unit is still open? Bounded, so a run held for the commit reads as `not started`. */
const startedInUnit = (started: Promise<unknown>) => Promise.race([
  started.then(() => 'started in the unit'),
  new Promise<string>((r) => setTimeout(() => r('not started in the unit'), 200)),
]);

describe('#33760 — an async after-hook fired inside a unit runs on its commit, never on its rollback', () => {
  it('engine.transaction() commits: the hook starts after the commit, sees its row, and writes outside the unit', async () => {
    const { engine, driver, events, bind, runOf, notes } = await makeCommitEngine();
    bind(false);
    await engine.transaction(async (trx: any) => {
      await engine.insert('rec', { name: 'r1' }, { context: { ...trx, isSystem: true } });
      events.push('callback returns');
    });
    expect(await runOf('r1')).toBe(1);
    expect(events).toEqual(['callback returns', 'commit', 'async started:r1']);
    expect(notes()).toEqual(['note:r1']);
    expect(unenrolled(driver)).toEqual([['rec', false], ['note', true]]);
  });

  it('engine.transaction() rolls back: the hook never starts and writes nothing', async () => {
    const { engine, driver, events, drops, bind, droppedRun, notes } = await makeCommitEngine();
    bind(false);
    const drop = droppedRun();
    await expect(engine.transaction(async (trx: any) => {
      await engine.insert('rec', { name: 'r1' }, { context: { ...trx, isSystem: true } });
      throw new Error('the caller rolls back');
    })).rejects.toThrow('the caller rolls back');
    expect(await drop).toBe('async_note');
    expect(events).toEqual(['rollback']);
    expect(drops).toEqual(['async_note']);
    expect([driver.rowsOf('rec'), notes()]).toEqual([[], []]);
  });

  it('ctx.api.transaction(fn) commits: the hook starts after the commit and sees its row', async () => {
    const { api, events, bind, runOf, notes } = await makeCommitEngine();
    bind(false);
    await api.transaction(async (tx) => { await tx.object('rec').insert({ name: 'r1' }); events.push('callback returns'); });
    expect(await runOf('r1')).toBe(1);
    expect(events).toEqual(['callback returns', 'commit', 'async started:r1']);
    expect(notes()).toEqual(['note:r1']);
  });

  it('ctx.api.transaction(fn) rolls back: the hook never starts and writes nothing', async () => {
    const { api, events, bind, droppedRun, notes } = await makeCommitEngine();
    bind(false);
    const drop = droppedRun();
    await expect(api.transaction(async (tx) => {
      await tx.object('rec').insert({ name: 'r1' });
      throw new Error('the caller rolls back');
    })).rejects.toThrow('the caller rolls back');
    expect(await drop).toBe('async_note');
    expect(events).toEqual(['rollback']);
    expect(notes()).toEqual([]);
  });

  it('nested: an inner ctx.api.transaction(fn) that returns is no commit, and the outer rollback drops the hook', async () => {
    const { engine, api, events, bind, droppedRun, notes } = await makeCommitEngine();
    bind(false);
    const drop = droppedRun();
    await expect(engine.transaction(async () => {
      await api.transaction(async (tx, info) => {
        expect(info.owned).toBe(false);
        await tx.object('rec').insert({ name: 'r1' });
      });
      events.push('inner returned');
      throw new Error('the outer caller rolls back');
    })).rejects.toThrow('the outer caller rolls back');
    expect(await drop).toBe('async_note');
    expect(events).toEqual(['inner returned', 'rollback']);
    expect(notes()).toEqual([]);
  });

  it('nested: the outer commit starts the hook once, after it', async () => {
    const { engine, api, events, bind, runOf } = await makeCommitEngine();
    bind(false);
    await engine.transaction(async () => {
      await api.transaction(async (tx) => { await tx.object('rec').insert({ name: 'r1' }); });
      events.push('inner returned');
    });
    expect(await runOf('r1')).toBe(1);
    expect(events).toEqual(['inner returned', 'commit', 'async started:r1']);
  });

  it('blocking + async on the same event, the door\'s own unit commits: the blocking hook runs in the unit, the async one after the commit', async () => {
    const { driver, api, events, bind, runOf, notes } = await makeCommitEngine();
    bind(true);
    await api.object('rec').insert({ name: 'r1' });
    expect(await runOf('r1')).toBe(1);
    expect(driver.begun).toHaveLength(1);
    expect(events).toEqual(['gate:r1', 'commit', 'async started:r1']);
    expect(notes()).toEqual(['note:r1']);
  });

  it('blocking + async on the same event, the blocking hook aborts: the door\'s unit rolls back and the async hook never starts', async () => {
    const { driver, api, events, bind, droppedRun, notes } = await makeCommitEngine();
    bind(true);
    const drop = droppedRun();
    await expect(api.object('rec').insert({ name: 'veto' })).rejects.toThrow('refused by the gate');
    expect(await drop).toBe('async_note');
    expect(events).toEqual(['gate:veto', 'rollback']);
    expect([driver.rowsOf('rec'), notes()]).toEqual([[], []]);
  });

  it('the beginTransaction trio (the sandbox runner\'s ctx.api.transaction): the hook waits for its commitTransaction', async () => {
    const { api, events, bind, runOf } = await makeCommitEngine();
    bind(false);
    const unit = (await api.beginTransaction())!;
    expect(unit.owned).toBe(true);
    await unit.ctx.object('rec').insert({ name: 'r1' });
    events.push('body done');
    await api.commitTransaction(unit.handle);
    expect(await runOf('r1')).toBe(1);
    expect(events).toEqual(['body done', 'commit', 'async started:r1']);
  });

  it('the beginTransaction trio rolls back: the hook never starts', async () => {
    const { api, events, bind, droppedRun, notes } = await makeCommitEngine();
    bind(false);
    const drop = droppedRun();
    const unit = (await api.beginTransaction())!;
    await unit.ctx.object('rec').insert({ name: 'r1' });
    await api.rollbackTransaction(unit.handle);
    expect(await drop).toBe('async_note');
    expect(events).toEqual(['rollback']);
    expect(notes()).toEqual([]);
  });

  it('runAs \'user\' on a user-less system write in engine.transaction(): the unscoped api still waits for the commit', async () => {
    const { engine, events, bind, runOf, apiKinds } = await makeCommitEngine();
    bind(false, { userPin: true });
    await engine.transaction(async (trx: any) => {
      await engine.insert('rec', { name: 'r1' }, { context: { ...trx, isSystem: true } });
      events.push('callback returns');
    });
    await runOf('r1');
    expect(events).toEqual(['callback returns', 'commit', 'user-pin started:r1']);
    expect(apiKinds).toEqual(['UnscopedHookApi']);
  });

  it('runAs \'user\' on a user-less system write in engine.transaction() that rolls back: the hook never starts', async () => {
    const { engine, events, drops, bind, droppedRun } = await makeCommitEngine();
    bind(false, { userPin: true });
    const drop = droppedRun();
    await expect(engine.transaction(async (trx: any) => {
      await engine.insert('rec', { name: 'r1' }, { context: { ...trx, isSystem: true } });
      throw new Error('the caller rolls back');
    })).rejects.toThrow('the caller rolls back');
    expect(await drop).toBe('user_pin');
    expect(events).toEqual(['rollback']);
    expect(drops).toEqual(['user_pin']);
  });

  it('a deferred run that throws after the commit: transaction() still resolves and the failure is logged', async () => {
    const { engine, events, bind, erroredRun } = await makeCommitEngine();
    bind(false, { thrower: true });
    await expect(engine.transaction(async (trx: any) => {
      await engine.insert('rec', { name: 'r1' }, { context: { ...trx, isSystem: true } });
      events.push('callback returns');
      return 'resolved';
    })).resolves.toBe('resolved');
    expect(await erroredRun).toBe('thrower');
    expect(events).toEqual(['callback returns', 'commit', 'thrower started', 'error logged:thrower']);
  });

  it('afterFind inside engine.transaction() that commits: a read\'s async hook starts at dispatch, in the unit\'s lifetime, not after the commit', async () => {
    const { engine, driver, events, bind, runOf, notes } = await makeCommitEngine();
    await engine.insert('rec', { name: 'r0' }, { context: { isSystem: true } });
    bind(false, { read: true });
    await engine.transaction(async (trx: any) => {
      await engine.find('rec', {}, { context: { ...trx, isSystem: true } });
      events.push(await startedInUnit(runOf('read')));
    });
    await runOf('read');
    expect(events).toEqual(['read-hook started', 'started in the unit', 'commit']);
    expect(notes()).toEqual(['note:read']);
    // Outside the unit, as under #33651: its write enrolled in nothing.
    expect(unenrolled(driver).filter(([o]) => o === 'note')).toEqual([['note', true]]);
  });

  it('afterFind inside engine.transaction() that rolls back: the read\'s async hook still runs, outside the unit', async () => {
    const { engine, driver, events, drops, bind, runOf } = await makeCommitEngine();
    await engine.insert('rec', { name: 'r0' }, { context: { isSystem: true } });
    bind(false, { read: true });
    await expect(engine.transaction(async (trx: any) => {
      await engine.find('rec', {}, { context: { ...trx, isSystem: true } });
      events.push(await startedInUnit(runOf('read')));
      throw new Error('the caller rolls back');
    })).rejects.toThrow('the caller rolls back');
    await runOf('read');
    expect(events).toEqual(['read-hook started', 'started in the unit', 'rollback']);
    expect(drops).toEqual([]);
    // Its write enrolled in nothing. (This double's rollback restores a whole
    // store snapshot, so the row itself is not read here; the dogfood twin
    // reads it standing on SQLite.)
    expect(unenrolled(driver).filter(([o]) => o === 'note')).toEqual([['note', true]]);
  });

  it('CONTROL afterFind outside any unit: the read\'s async hook starts at dispatch, unchanged', async () => {
    const { driver, api, events, bind, runOf, notes } = await makeCommitEngine();
    await api.object('rec').insert({ name: 'r0' });
    bind(false, { read: true });
    await api.object('rec').find({});
    events.push('find returns');
    await runOf('read');
    expect(events).toEqual(['read-hook started', 'find returns']);
    expect(driver.begun).toHaveLength(0);
    expect(notes()).toEqual(['note:read']);
  });

  it('CONTROL outside any unit: the hook starts at dispatch, before the write returns, unchanged', async () => {
    const { driver, api, events, bind, runOf } = await makeCommitEngine();
    bind(false);
    await api.object('rec').insert({ name: 'r1' });
    events.push('insert returns');
    expect(await runOf('r1')).toBe(1);
    expect(events).toEqual(['async started:r1', 'insert returns']);
    expect(driver.begun).toHaveLength(0);
  });
});
