// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// #22856 — a hook `condition` that cannot be evaluated aborts the operation
// whatever the hook's `onError` says (#4775: the gate throws
// `HookConditionError` outside `onError`, and before an `async: true` hook
// detaches). Measured on a booted stack before the fix: an `afterInsert` hook
// with `onError: 'log'` and a condition reading `previous` (unbound on an
// insert) refused REST `POST /data/:object` with `500` while the row stayed
// stored — the write door opened its unit (#22782) only for `abort` hooks.
//
// Pinned on REST `createData`, read back through the engine. The controls are
// the triage's: a `log` hook whose condition evaluates stores the row although
// its handler throws; an `abort` hook with the same unbindable condition is
// rolled back as #22782 leaves it. One more: an `async: true` hook whose
// condition evaluates now starts inside the door's unit and writes after it
// commits — its late write must still land (#22855). The refusal is REST's
// sanitised `500 INTERNAL_ERROR` on both sides of the fix; what this file pins
// is what is STORED.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { bootStack, type VerifyStack } from '@objectstack/verify';
import { defineStack } from '@objectstack/spec';
import { ObjectSchema, Field } from '@objectstack/spec/data';

const LOGGED = 'hac_logged';
const DETACHED = 'hac_detached';
const BOUND = 'hac_bound';
const ABORTING = 'hac_aborting';
const LATE = 'hac_late';
const NOTE = 'hac_note';
/** `previous` is unbound on an insert, so this condition cannot be evaluated there. */
const UNBINDABLE = 'previous.name != record.name';

const named = (name: string) => ObjectSchema.create({
  name, label: name, sharingModel: 'public_read_write',
  fields: { name: Field.text({ label: 'Name', required: true }), case_name: Field.text({ label: 'Case' }) },
});

const hacStack = defineStack({
  manifest: {
    id: 'com.dogfood.hook-after-condition-rollback', namespace: 'hac', version: '0.0.0', type: 'app',
    name: 'After-hook condition rollback fixture', description: 'afterInsert hooks whose condition cannot be evaluated, and their controls.',
  },
  objects: [named(LOGGED), named(DETACHED), named(BOUND), named(ABORTING), named(LATE), named(NOTE)],
  hooks: [
    { name: 'hac_logged_watch', object: LOGGED, events: ['afterInsert'], onError: 'log', condition: UNBINDABLE, handler: () => {} },
    { name: 'hac_detached_watch', object: DETACHED, events: ['afterInsert'], async: true, onError: 'log', condition: UNBINDABLE, handler: () => {} },
    { name: 'hac_bound_veto', object: BOUND, events: ['afterInsert'], onError: 'log', condition: 'record.name.startsWith("veto")',
      handler: () => { throw new Error('refused by the hook'); } },
    { name: 'hac_aborting_watch', object: ABORTING, events: ['afterInsert'], condition: UNBINDABLE, handler: () => {} },
    { name: 'hac_late_note', object: LATE, events: ['afterInsert'], async: true, onError: 'log', condition: 'record.name != ""',
      handler: async (ctx: any) => {
        await new Promise((r) => setTimeout(r, 40));
        await ctx.api.object(NOTE).insert({ name: 'late', case_name: ctx.input.data.name });
      } },
  ],
} as never);

describe('an after* hook whose condition cannot be evaluated rolls the write back, whatever its onError (#22856)', () => {
  let stack: VerifyStack;
  let token: string;
  const uniq = (prefix: string) => `${prefix}-${Math.random().toString(36).slice(2, 8)}`;
  const stored = async (object: string, name: string) => (await stack.rows(object, { name })).length;
  const refusal = async (res: Response) => ({ status: res.status, code: ((await res.json()) as any).code });
  const create = (object: string, name: string) => stack.apiAs(token, 'POST', `/data/${object}`, { name });

  beforeAll(async () => {
    stack = await bootStack(hacStack);
    token = await stack.signIn();
  }, 120_000);
  afterAll(async () => { await stack?.stop(); });

  it('onError: \'log\' — REST createData is refused and the row is absent', async () => {
    const name = uniq('c');
    expect(await refusal(await create(LOGGED, name))).toEqual({ status: 500, code: 'INTERNAL_ERROR' });
    expect(await stored(LOGGED, name)).toBe(0);
  });

  it('async: true — the condition is evaluated before the hook detaches: refused, the row absent', async () => {
    const name = uniq('c');
    expect(await refusal(await create(DETACHED, name))).toEqual({ status: 500, code: 'INTERNAL_ERROR' });
    expect(await stored(DETACHED, name)).toBe(0);
  });

  it('CONTROL onError: \'log\' with a condition that evaluates: the handler throws and the row is stored', async () => {
    const name = uniq('veto');
    expect((await create(BOUND, name)).status).toBe(201);
    expect(await stored(BOUND, name)).toBe(1);
  });

  it('CONTROL an abort hook with the same condition: refused, the row absent — as #22782 leaves it', async () => {
    const name = uniq('c');
    expect(await refusal(await create(ABORTING, name))).toEqual({ status: 500, code: 'INTERNAL_ERROR' });
    expect(await stored(ABORTING, name)).toBe(0);
  });

  it('CONTROL async: true with a condition that evaluates: started inside the unit, its late write still lands', async () => {
    const name = uniq('c');
    expect((await create(LATE, name)).status).toBe(201);
    expect(await stored(LATE, name)).toBe(1);
    const late = async () => (await stack.rows(NOTE, { case_name: name, name: 'late' })).length;
    for (let i = 0; i < 40 && (await late()) === 0; i++) await new Promise((r) => setTimeout(r, 50));
    expect(await late()).toBe(1);
  });
});
