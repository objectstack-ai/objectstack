// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// #22782 — `HookSchema.onError`: "abort: Rollback transaction (if blocking)",
// default `abort`. Measured on a booted stack before the fix: an `afterInsert`
// hook that threw refused the caller while the row stayed stored, and so did
// the row an earlier `afterInsert` hook wrote through `ctx.api` — a plain write
// opened no unit of work, so the abort had nothing to roll back. A client that
// retries the refused create makes a duplicate.
//
// Pinned on the two published doors the card names: REST `POST /data/:object`
// (`createData`) and the engine door (`hooks.run`), each read back through the
// engine. The three controls are the triage's: `onError: 'log'` stores the
// row; a caller-opened `transaction()` stays the caller's to decide; a throwing
// `before*` hook refuses exactly as before.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { bootStack, type VerifyStack } from '@objectstack/verify';
import { defineStack } from '@objectstack/spec';
import { ObjectSchema, Field } from '@objectstack/spec/data';

const CASE = 'har_case';
const NOTE = 'har_note';
const LOGGED = 'har_logged';

const named = (name: string) => ObjectSchema.create({
  name, label: name, sharingModel: 'public_read_write',
  fields: { name: Field.text({ label: 'Name', required: true }), case_name: Field.text({ label: 'Case' }) },
});
const veto = (prefix: string) => (ctx: any) => {
  if (String(ctx.input?.data?.name ?? '').startsWith(prefix)) throw new Error(`refused: ${prefix}`);
};

const harStack = defineStack({
  manifest: {
    id: 'com.dogfood.hook-after-abort-rollback', namespace: 'har', version: '0.0.0', type: 'app',
    name: 'After-hook abort rollback fixture', description: 'An afterInsert abort, its log twin, and a beforeInsert veto.',
  },
  objects: [named(CASE), named(NOTE), named(LOGGED)],
  hooks: [
    // The earlier hook of the card's measurement: it writes through ctx.api first.
    { name: 'har_note_writer', object: CASE, events: ['afterInsert'], priority: 10,
      handler: (ctx: any) => ctx.api.object(NOTE).insert({ name: 'note', case_name: ctx.input.data.name }) },
    { name: 'har_after_veto', object: CASE, events: ['afterInsert'], priority: 20, handler: veto('veto') },
    { name: 'har_before_veto', object: CASE, events: ['beforeInsert'], handler: veto('block') },
    { name: 'har_logged_veto', object: LOGGED, events: ['afterInsert'], onError: 'log', handler: veto('veto') },
  ],
} as never);

describe('an aborting afterInsert rolls the write back (#22782)', () => {
  let stack: VerifyStack;
  let token: string;
  const uniq = (prefix: string) => `${prefix}-${Math.random().toString(36).slice(2, 8)}`;
  const stored = async (object: string, name: string) => (await stack.rows(object, { name })).length;
  const notes = async (name: string) => (await stack.rows(NOTE, { case_name: name })).length;

  beforeAll(async () => {
    stack = await bootStack(harStack);
    token = await stack.signIn();
  }, 120_000);
  afterAll(async () => { await stack?.stop(); });

  it('REST createData: the refused create leaves neither the row nor the hook chain\'s ctx.api write', async () => {
    const name = uniq('veto');
    const res = await stack.apiAs(token, 'POST', `/data/${CASE}`, { name });
    expect(res.status, await res.clone().text()).toBe(400);
    expect((await res.json() as any).error).toBe('refused: veto');
    expect(await stored(CASE, name)).toBe(0);
    expect(await notes(name)).toBe(0);
  });

  it('the engine door (hooks.run): refused, and nothing stored', async () => {
    const name = uniq('veto');
    await expect(stack.hooks.run(CASE, 'insert', { name }, { system: true })).rejects.toThrow('refused: veto');
    expect(await stored(CASE, name)).toBe(0);
    expect(await notes(name)).toBe(0);
  });

  it('positive control: an insert no hook refuses stores the row and the note', async () => {
    const name = uniq('ok');
    expect((await stack.apiAs(token, 'POST', `/data/${CASE}`, { name })).status).toBe(201);
    expect([await stored(CASE, name), await notes(name)]).toEqual([1, 1]);
  });

  it('CONTROL onError: \'log\' — the hook throws and the row is stored', async () => {
    const name = uniq('veto');
    expect((await stack.apiAs(token, 'POST', `/data/${LOGGED}`, { name })).status).toBe(201);
    expect(await stored(LOGGED, name)).toBe(1);
  });

  it('CONTROL a caller-opened transaction(): the caller that swallows the refusal and commits keeps the row', async () => {
    const name = uniq('veto');
    const ql = await stack.kernel.getServiceAsync<any>('objectql');
    await ql.transaction(async (trx: any) => {
      await expect(ql.insert(CASE, { name }, { context: { ...trx, isSystem: true } })).rejects.toThrow('refused: veto');
    });
    expect([await stored(CASE, name), await notes(name)]).toEqual([1, 1]);
  });

  it('CONTROL a throwing beforeInsert: refused, nothing stored', async () => {
    const name = uniq('block');
    const res = await stack.apiAs(token, 'POST', `/data/${CASE}`, { name });
    expect(res.status).toBe(400);
    expect(await stored(CASE, name)).toBe(0);
  });
});
