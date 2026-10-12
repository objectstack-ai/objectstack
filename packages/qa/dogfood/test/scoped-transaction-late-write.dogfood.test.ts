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
  objects: [named(TRIGGER), named(REC), named(NOTE)],
  hooks: [
    // The handler of the card's measurement. A `before*` hook, so the write
    // door opens no unit of its own (#22782) and `ctx.api.transaction` really
    // opens — and owns — one. The name's prefix picks the shape.
    { name: 'stl_writer', object: TRIGGER, events: ['beforeInsert'],
      handler: async (ctx: any) => {
        const name = String(ctx.input.data.name);
        if (name.startsWith('explicit')) {
          // The card's probe: the write goes through the unit's own context.
          await ctx.api.transaction(async (tx: any) => { await tx.object(REC).insert({ name }); });
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
