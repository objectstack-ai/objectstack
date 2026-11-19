// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// #22855 — work a unit of work starts and does not await (an `async: true`
// hook) must not keep the unit's finished transaction handle. Measured on a
// booted stack before the fix: a handler inside `ctx.api.transaction(fn)`
// inserted a record whose object has an `async: true` `afterInsert` hook that
// writes a note after a short wait; the record was stored and the late note was
// not — the hook failed with "Transaction query already complete".
//
// The handle reaches that hook two ways, and each is pinned on its own:
//  - AMBIENT: `ScopedContext.transaction()` published its unit into the
//    engine's ambient store and never closed the entry, so the hook's late
//    write, still in that async context, read the finished handle there;
//  - EXPLICIT: the unit's handle is threaded into the callback's context
//    (`tx.object(…)`), so the triggered hook's `ctx.api` carries it too — and a
//    caller-opened `engine.transaction()` threads it the same way.
// The unit closes when its callback settles, on both surfaces, through the one
// helper `engine.transaction()` already used for the ambient half (#22782).
//
// Driven through the engine door (`hooks.run`); every row is read back
// through the engine. CONTROL: the same insert with no transaction is
// unchanged — the late note is stored.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { bootStack, type VerifyStack } from '@objectstack/verify';
import { defineStack } from '@objectstack/spec';
import { ObjectSchema, Field } from '@objectstack/spec/data';

const TRIGGER = 'stl_trigger';
const REC = 'stl_rec';
const NOTE = 'stl_note';
/** The commit-dispatch describe's objects: `UNIT` is written inside units, `DOOR` opens the door's own. */
const UNIT = 'stl_unit';
const DOOR = 'stl_door';
/** Read inside units: its `async` `afterFind` hook is not the unit's to hold or drop (#33760 review#2). */
const READ = 'stl_read';

/** Names whose `async` hook has STARTED (set synchronously, at the first line of its body). */
const started = new Set<string>();
/** Names whose `async` hook has FINISHED, with the count of its own row its read saw. */
const finished = new Map<string, number>();
/** Per `DOOR` name: had the `async` hook started when the blocking hook after it ran? */
const startedAtGate = new Map<string, boolean>();
/**
 * The card's `async` hook: mark the start, re-read the triggering row through
 * `ctx.api` (what a multi-connection database shows it depends on whether the
 * unit has committed), and write a note that references it.
 */
const commitProbe = (object: string) => async (ctx: any) => {
  const name = String(ctx.input.data.name);
  started.add(name);
  const seen = (await ctx.api.object(object).find({ where: { name } })).length;
  await ctx.api.object(NOTE).insert({ name: 'after-commit', rec_name: name });
  finished.set(name, seen);
};

const named = (name: string) => ObjectSchema.create({
  name, label: name, sharingModel: 'public_read_write',
  fields: { name: Field.text({ label: 'Name', required: true }), rec_name: Field.text({ label: 'Record' }) },
});

const stlStack = defineStack({
  manifest: {
    id: 'com.dogfood.scoped-transaction-late-write', namespace: 'stl', version: '0.0.0', type: 'app',
    name: 'Scoped transaction late-write fixture',
    description: 'A handler that writes inside ctx.api.transaction, and an async hook that writes after the unit commits.',
  },
  objects: [named(TRIGGER), named(REC), named(NOTE), named(UNIT), named(DOOR), named(READ)],
  hooks: [
    // The handler of the card's measurement. A blocking `afterInsert` with
    // `onError: 'log'` and no `condition`, so the write door opens no unit of
    // its own (#22782, #22856) and `ctx.api.transaction` really opens — and
    // owns — one. Not a `before*` hook: a `before*` hook declared in metadata
    // opens the door's unit (#34412), and `ctx.api.transaction` would only
    // join it. The name's prefix picks the shape.
    { name: 'stl_writer', object: TRIGGER, events: ['afterInsert'], onError: 'log',
      handler: async (ctx: any) => {
        const name = String(ctx.input.data.name);
        if (name.startsWith('explicit')) {
          // The card's probe: the write goes through the unit's own context.
          await ctx.api.transaction(async (tx: any) => { await tx.object(REC).insert({ name }); });
        } else if (name.startsWith('unit')) {
          // The commit-dispatch describe: a unit this hook opens and owns
          // (`unit-commit`), or one it rolls back (`unit-rollback`) and
          // swallows, so the trigger row itself is stored either way. Inside
          // a caller's unit the same call joins it (`unit-nested`).
          try {
            await ctx.api.transaction(async (tx: any) => {
              await tx.object(UNIT).insert({ name });
              if (name.startsWith('unit-rollback')) throw new Error('rolled back by the probe');
            });
          } catch (e) {
            if (!name.startsWith('unit-rollback')) throw e;
          }
        } else if (name.startsWith('ambient')) {
          // Same unit, but the write goes through the OUTER api: only the
          // ambient store enrols it.
          await ctx.api.transaction(async () => { await ctx.api.object(REC).insert({ name }); });
        } else {
          // CONTROL: no transaction at all.
          await ctx.api.object(REC).insert({ name });
        }
      } },
    { name: 'stl_late_note', object: REC, events: ['afterInsert'], async: true, onError: 'log',
      handler: async (ctx: any) => {
        await new Promise((r) => setTimeout(r, 40));
        await ctx.api.object(NOTE).insert({ name: 'late', rec_name: ctx.input.data.name });
      } },
    { name: 'stl_unit_async', object: UNIT, events: ['afterInsert'], async: true, onError: 'log', handler: commitProbe(UNIT) },
    // The door's own unit (#22782): a blocking `afterInsert` that can abort
    // makes the write door open one. It runs after the `async` hook is
    // dispatched (priority 400 > 100), records whether that hook had already
    // started, and vetoes a `veto-` name, which rolls the door's unit back.
    // A read's `async` hook: per row read, mark the start and write a note.
    { name: 'stl_read_async', object: READ, events: ['afterFind'], async: true, onError: 'log',
      handler: async (ctx: any) => {
        const names = (Array.isArray(ctx.result) ? ctx.result : []).map((r: any) => String(r.name));
        for (const name of names) started.add(name);
        for (const name of names) await ctx.api.object(NOTE).insert({ name: 'after-read', rec_name: name });
        for (const name of names) finished.set(name, 1);
      } },
    { name: 'stl_door_async', object: DOOR, events: ['afterInsert'], async: true, onError: 'log', handler: commitProbe(DOOR) },
    { name: 'stl_door_gate', object: DOOR, events: ['afterInsert'], priority: 400,
      handler: (ctx: any) => {
        const name = String(ctx.input.data.name);
        startedAtGate.set(name, started.has(name));
        if (name.startsWith('veto')) throw new Error('refused by the gate');
      } },
  ],
} as never);

describe('un-awaited work does not keep a finished unit\'s handle (#22855)', () => {
  let stack: VerifyStack;
  const uniq = (prefix: string) => `${prefix}-${Math.random().toString(36).slice(2, 8)}`;
  const stored = async (object: string, name: string) => (await stack.rows(object, { name })).length;
  /** The async hook writes 40 ms after its record; poll up to 2 s for it. */
  const lateNotes = async (name: string) => {
    for (let i = 0; i < 40 && (await stack.rows(NOTE, { rec_name: name })).length === 0; i++) {
      await new Promise((r) => setTimeout(r, 50));
    }
    return (await stack.rows(NOTE, { rec_name: name })).length;
  };

  beforeAll(async () => {
    stack = await bootStack(stlStack);
  }, 120_000);
  afterAll(async () => { await stack?.stop(); });

  it('ctx.api.transaction, the write through the unit\'s context (the card\'s probe): the late note is stored', async () => {
    const name = uniq('explicit');
    await stack.hooks.run(TRIGGER, 'insert', { name }, { system: true });
    expect([await stored(REC, name), await lateNotes(name)]).toEqual([1, 1]);
  });

  it('ctx.api.transaction, the write enrolled only ambiently: the late note is stored', async () => {
    const name = uniq('ambient');
    await stack.hooks.run(TRIGGER, 'insert', { name }, { system: true });
    expect([await stored(REC, name), await lateNotes(name)]).toEqual([1, 1]);
  });

  it('a caller-opened engine transaction() whose handle the write carries explicitly: the late note is stored', async () => {
    const name = uniq('engine');
    const ql = await stack.kernel.getServiceAsync<any>('objectql');
    await ql.transaction(async (trx: any) => {
      await ql.insert(REC, { name }, { context: { ...trx, isSystem: true } });
    });
    expect([await stored(REC, name), await lateNotes(name)]).toEqual([1, 1]);
  });

  it('CONTROL no transaction: the record and the late note are stored, unchanged', async () => {
    const name = uniq('plain');
    await stack.hooks.run(TRIGGER, 'insert', { name }, { system: true });
    expect([await stored(REC, name), await lateNotes(name)]).toEqual([1, 1]);
  });
});

// #33760 — an `async: true` after-hook fired inside a unit of work runs once the
// OUTERMOST unit commits, and not at all when it rolls back. Before, it started
// at dispatch, while the unit was still open: on a multi-connection database its
// `ctx.api` reads could not see the triggering row yet, and a rollback did not
// stop it. On this single-connection SQLite pool its statements queued behind
// the unit; the start, and the run after a rollback, were the same.
//
// The three units the card names: the write door's own (a blocking `afterInsert`
// beside the async one), a caller's `engine.transaction()`, and a hook's
// `ctx.api.transaction(fn)`. A rollback is judged after a SENTINEL: the same
// object written outside any unit, whose hook runs at once — when its note is
// in, a hook queued earlier on the same connection would have run too.
describe('an async after-hook fired inside a unit runs on its commit, not on its rollback (#33760)', () => {
  let stack: VerifyStack;
  let ql: any;
  const uniq = (prefix: string) => `${prefix}-${Math.random().toString(36).slice(2, 8)}`;
  const notesOf = async (name: string) => (await stack.rows(NOTE, { rec_name: name, name: 'after-commit' })).length;
  /** Wait (up to 2 s) for `name`'s async hook to finish; answer [notes, rows its read saw]. */
  const ran = async (name: string) => {
    for (let i = 0; i < 40 && !finished.has(name); i++) await new Promise((r) => setTimeout(r, 50));
    return [await notesOf(name), finished.get(name)];
  };
  /** Write a sentinel outside any unit and wait for its hook; then `name`'s hook would have run. */
  const settled = async (name: string) => {
    const sentinel = uniq('sentinel');
    await ql.insert(UNIT, { name: sentinel }, { context: { isSystem: true } });
    expect(await ran(sentinel)).toEqual([1, 1]);
    return [started.has(name), await notesOf(name)];
  };
  const sys = (trx: any) => ({ context: { ...trx, isSystem: true } });

  beforeAll(async () => {
    stack = await bootStack(stlStack);
    ql = await stack.kernel.getServiceAsync<any>('objectql');
  }, 120_000);
  afterAll(async () => { await stack?.stop(); });

  it('engine.transaction() that commits: the hook has not started when the callback returns, then runs and sees its row', async () => {
    const name = uniq('engine-commit');
    let startedInUnit: boolean | undefined;
    await ql.transaction(async (trx: any) => {
      await ql.insert(UNIT, { name }, sys(trx));
      startedInUnit = started.has(name);
    });
    expect(startedInUnit).toBe(false);
    expect(await ran(name)).toEqual([1, 1]);
  });

  it('engine.transaction() that rolls back: the hook never runs', async () => {
    const name = uniq('engine-rollback');
    await expect(ql.transaction(async (trx: any) => {
      await ql.insert(UNIT, { name }, sys(trx));
      throw new Error('rolled back by the probe');
    })).rejects.toThrow('rolled back by the probe');
    expect(await settled(name)).toEqual([false, 0]);
  });

  it('ctx.api.transaction(fn) that commits: the hook runs after it and sees its row', async () => {
    const name = uniq('unit-commit');
    await stack.hooks.run(TRIGGER, 'insert', { name }, { system: true });
    expect(await ran(name)).toEqual([1, 1]);
  });

  it('ctx.api.transaction(fn) that rolls back: the hook never runs', async () => {
    const name = uniq('unit-rollback');
    await stack.hooks.run(TRIGGER, 'insert', { name }, { system: true });
    expect(await stack.rows(UNIT, { name })).toHaveLength(0);
    expect(await settled(name)).toEqual([false, 0]);
  });

  it('nested: ctx.api.transaction(fn) joins a caller\'s engine.transaction(); its return is no commit, and the outer rollback drops the hook', async () => {
    const name = uniq('unit-nested');
    let startedAfterInner: boolean | undefined;
    await expect(ql.transaction(async (trx: any) => {
      await ql.insert(TRIGGER, { name }, sys(trx));
      startedAfterInner = started.has(name);
      throw new Error('rolled back by the probe');
    })).rejects.toThrow('rolled back by the probe');
    expect(startedAfterInner).toBe(false);
    expect(await settled(name)).toEqual([false, 0]);
  });

  it('the door\'s own unit (blocking + async afterInsert on one event) commits: the blocking hook runs first, the async one after the commit', async () => {
    const name = uniq('door');
    await stack.hooks.run(DOOR, 'insert', { name }, { system: true });
    expect(startedAtGate.get(name)).toBe(false);
    expect(await ran(name)).toEqual([1, 1]);
  });

  it('the door\'s own unit rolls back on the blocking hook\'s abort: the async hook never runs', async () => {
    const name = uniq('veto');
    await expect(stack.hooks.run(DOOR, 'insert', { name }, { system: true })).rejects.toThrow('refused by the gate');
    expect(await stack.rows(DOOR, { name })).toHaveLength(0);
    expect(startedAtGate.get(name)).toBe(false);
    expect(await settled(name)).toEqual([false, 0]);
  });

  const readNotesOf = async (name: string) => (await stack.rows(NOTE, { rec_name: name, name: 'after-read' })).length;
  /** Inside the unit: has `name`'s read hook started within 500 ms? A run held for the commit has not. */
  const startedWhileOpen = async (name: string) => {
    for (let i = 0; i < 10 && !started.has(name); i++) await new Promise((r) => setTimeout(r, 50));
    return started.has(name);
  };
  const readRan = async (name: string) => {
    for (let i = 0; i < 40 && !finished.has(name); i++) await new Promise((r) => setTimeout(r, 50));
    return readNotesOf(name);
  };

  it('afterFind inside engine.transaction() that commits: the read\'s async hook starts in the unit\'s lifetime, not after the commit', async () => {
    const name = uniq('read-commit');
    await ql.insert(READ, { name }, { context: { isSystem: true } });
    let startedInUnit: boolean | undefined;
    await ql.transaction(async (trx: any) => {
      await ql.find(READ, { where: { name } }, sys(trx));
      startedInUnit = await startedWhileOpen(name);
    });
    expect(startedInUnit).toBe(true);
    expect(await readRan(name)).toBe(1);
  });

  it('afterFind inside engine.transaction() that rolls back: the read\'s async hook still runs, and its own write stands', async () => {
    const name = uniq('read-rollback');
    await ql.insert(READ, { name }, { context: { isSystem: true } });
    let startedInUnit: boolean | undefined;
    await expect(ql.transaction(async (trx: any) => {
      await ql.find(READ, { where: { name } }, sys(trx));
      startedInUnit = await startedWhileOpen(name);
      throw new Error('rolled back by the probe');
    })).rejects.toThrow('rolled back by the probe');
    expect(startedInUnit).toBe(true);
    expect(await readRan(name)).toBe(1);
  });

  it('CONTROL afterFind outside any unit: the read\'s async hook runs, unchanged', async () => {
    const name = uniq('read-plain');
    await ql.insert(READ, { name }, { context: { isSystem: true } });
    await ql.find(READ, { where: { name } }, { context: { isSystem: true } });
    expect(await readRan(name)).toBe(1);
  });

  it('CONTROL outside any unit: the hook runs and sees its row, unchanged', async () => {
    const name = uniq('plain');
    await ql.insert(UNIT, { name }, { context: { isSystem: true } });
    expect(await ran(name)).toEqual([1, 1]);
  });
});
