// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#28000] A hook tells the person who saved a record what the save set in
 * motion, and the message reaches THAT person's write answer as `notice`.
 *
 * The transport, as built:
 *
 *   createData / updateData → pass THIS write's `onNotice` listener
 *                             (`WriteObservabilityOptions`) in the engine bag
 *   engine (insert / update) → never calls it; hands the caller's bag to every
 *                             hook on `ctx.input.options` (a `before*` hook reads
 *                             it as passed, an `after*` hook after
 *                             `buildDriverOptions` widened it, never stripped)
 *   a hook                   → calls it with one message
 *   createData / updateData → answer the last non-empty message as `notice`,
 *                             omit-when-absent
 *
 * A REAL `ObjectQL` engine and the REAL `ObjectStackProtocolImplementation` run
 * below, on both hook surfaces an app reaches the bag from: the raw
 * `registerHook` envelope and a declarative `handler` bound through
 * `bindHooksToEngine` (whose flat record view passes `options` through to the
 * envelope). The hooks say what the written row asks them to: `say` from the
 * `before*` phase, `say_after` from the `after*` phase.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
import { CreateDataResponseSchema, UpdateDataResponseSchema } from '@objectstack/spec/api';
import type { WriteObservabilityOptions } from '@objectstack/spec/contracts';
import { ObjectQL } from './engine.js';
import { bindHooksToEngine } from './hook-binder.js';

const DEAL = {
  name: 'sn_deal',
  label: 'Deal',
  fields: {
    body: { name: 'body', label: 'Body', type: 'text' },
    say: { name: 'say', label: 'Say', type: 'text' },
    say_after: { name: 'say_after', label: 'Say after', type: 'text' },
  },
};

function makeMemoryDriver() {
  const stores = new Map<string, Map<string, Record<string, unknown>>>();
  const storeFor = (obj: string) => {
    let s = stores.get(obj);
    if (!s) { s = new Map(); stores.set(obj, s); }
    return s;
  };
  let nextId = 0;
  const matches = (row: Record<string, unknown>, where: any): boolean => {
    if (!where || typeof where !== 'object') return true;
    return Object.entries(where).every(([k, v]) => {
      if (k.startsWith('$')) return true;
      const expected = v && typeof v === 'object' && '$eq' in (v as any) ? (v as any).$eq : v;
      return (row[k] ?? null) === (expected ?? null);
    });
  };
  const driver: any = {
    name: 'memory', version: '0.0.0', supports: {} as any,
    async connect() {}, async disconnect() {}, async checkHealth() { return true; },
    async execute() { return null; },
    async find(object: string, ast: any) {
      const rows = [...storeFor(object).values()].filter((r) => matches(r, ast?.where));
      return typeof ast?.limit === 'number' ? rows.slice(0, ast.limit) : rows;
    },
    async findOne(object: string, ast: any) {
      for (const r of storeFor(object).values()) if (matches(r, ast?.where)) return r;
      return null;
    },
    async create(object: string, data: Record<string, unknown>) {
      nextId += 1;
      const row = { ...data, id: (data.id as string) ?? `r_${nextId}` };
      storeFor(object).set(row.id as string, row);
      return row;
    },
    async update(object: string, id: string, data: Record<string, unknown>) {
      const row = { ...storeFor(object).get(id), ...data, id };
      storeFor(object).set(id, row);
      return row;
    },
    async delete(object: string, id: string) { return storeFor(object).delete(id); },
    async count(object: string, ast: any) { return (await this.find(object, ast)).length; },
    async beginTransaction() { return { commit: async () => {}, rollback: async () => {} }; },
    async commit() {}, async rollback() {},
  };
  return { driver, storeFor };
}

const noopLogger = { info() {}, debug() {}, warn() {}, error() {} };

let engine: ObjectQL;
let protocol: ObjectStackProtocolImplementation;
let storeFor: ReturnType<typeof makeMemoryDriver>['storeFor'];
/** Set by a test: the after-hook writes a nested deal asking for this notice inside the outer write. */
let nestedSay: string | undefined;

const listenerOf = (ctx: any) => (ctx.input?.options as WriteObservabilityOptions | undefined)?.onNotice;

/** Raw-envelope hooks: `ctx.input.data` is the payload, `ctx.input.options` the caller's bag. */
const beforeSay = async (ctx: any) => {
  const say = ctx.input?.data?.say;
  if (say !== undefined) listenerOf(ctx)?.(say);
  if (ctx.input?.data?.body === 'refuse') throw new Error('refused by a before hook');
};
const afterSay = async (ctx: any) => {
  const say = ctx.result?.say_after;
  if (say !== undefined) listenerOf(ctx)?.(say);
  if (nestedSay !== undefined && ctx.event === 'afterInsert') {
    const nested = nestedSay;
    nestedSay = undefined;
    await engine.insert(DEAL.name, { body: 'nested', say: nested });
  }
};

/** What the `ctx.notice` member did on each dispatch, by event (#28251). */
let memberSeen: Array<{ event: string; type: string }> = [];

async function boot(surface: 'envelope' | 'declarative' | 'member') {
  engine = new ObjectQL({ logger: noopLogger } as any);
  const d = makeMemoryDriver();
  storeFor = d.storeFor;
  engine.registerDriver(d.driver, true);
  await engine.init();
  engine.registry.registerObject(DEAL as never, 'com.objectstack.test.28000');
  memberSeen = [];
  if (surface === 'member') {
    // [#28251] The `ctx.notice` member, on both hook surfaces: a raw-envelope
    // handler for the insert phases, a declarative `handler` (the flat record
    // view a lowered body also sees) for the update phases. Each records
    // whether the member was there, so delete / find dispatches are read too.
    for (const e of ['beforeInsert', 'afterInsert', 'beforeDelete', 'afterDelete', 'beforeFind'] as const) {
      engine.registerHook(e, async (ctx: any) => {
        memberSeen.push({ event: e, type: typeof ctx.notice });
        const say = e === 'beforeInsert' ? ctx.input?.data?.say : e === 'afterInsert' ? ctx.result?.say_after : undefined;
        if (say !== undefined) ctx.notice(say);
      }, { object: DEAL.name });
    }
    const bound = bindHooksToEngine(engine, [
      {
        name: 'sn_deal_member', object: DEAL.name, events: ['beforeUpdate', 'afterUpdate'],
        handler: async (ctx: any) => {
          const say = ctx.event === 'beforeUpdate' ? ctx.input.say : ctx.result?.say_after;
          if (say !== undefined) ctx.notice(say);
        },
      },
    ] as never, { logger: noopLogger as never });
    expect(bound.errors).toEqual([]);
  } else if (surface === 'envelope') {
    for (const e of ['beforeInsert', 'beforeUpdate'] as const) engine.registerHook(e, beforeSay, { object: DEAL.name });
    for (const e of ['afterInsert', 'afterUpdate'] as const) engine.registerHook(e, afterSay, { object: DEAL.name });
  } else {
    // A declarative `handler` sees the flat record view: `input.say` is the
    // field, and `input.options` passes through to the envelope's bag.
    const bound = bindHooksToEngine(engine, [
      {
        name: 'sn_deal_before', object: DEAL.name, events: ['beforeInsert', 'beforeUpdate'],
        handler: async (ctx: any) => { if (ctx.input.say !== undefined) listenerOf(ctx)?.(ctx.input.say); },
      },
      {
        name: 'sn_deal_after', object: DEAL.name, events: ['afterInsert', 'afterUpdate'],
        handler: async (ctx: any) => { if (ctx.result?.say_after !== undefined) listenerOf(ctx)?.(ctx.result.say_after); },
      },
    ] as never, { logger: noopLogger as never });
    expect(bound.errors).toEqual([]);
    expect(bound.registered).toBe(4); // one registration per (hook, event)
  }
  protocol = new ObjectStackProtocolImplementation(engine as never);
  nestedSay = undefined;
}

describe('[#28000] createData answers a hook-set message as `notice`', () => {
  beforeEach(() => boot('envelope'));

  it('answers the message a beforeInsert hook set, and the answer conforms', async () => {
    const answer: any = await protocol.createData({ object: DEAL.name, data: { body: 'hi', say: 'Sent for approval' } });
    expect(answer.notice).toBe('Sent for approval');
    expect(CreateDataResponseSchema.safeParse(answer).success).toBe(true);
  });

  it('answers the message an afterInsert hook set', async () => {
    const answer: any = await protocol.createData({ object: DEAL.name, data: { body: 'hi', say_after: 'Renewal created' } });
    expect(answer.notice).toBe('Renewal created');
  });

  it('control: no hook set one → no `notice` key at all', async () => {
    const answer: any = await protocol.createData({ object: DEAL.name, data: { body: 'hi' } });
    expect('notice' in answer).toBe(false);
  });

  it('one message: the last call wins', async () => {
    const answer: any = await protocol.createData({
      object: DEAL.name, data: { body: 'hi', say: 'first', say_after: 'second' },
    });
    expect(answer.notice).toBe('second');
  });

  it('a blank message sets nothing, and never clears an earlier one', async () => {
    const blank: any = await protocol.createData({ object: DEAL.name, data: { body: 'hi', say: '   ' } });
    expect('notice' in blank).toBe(false);
    const kept: any = await protocol.createData({ object: DEAL.name, data: { body: 'hi', say: 'kept', say_after: '' } });
    expect(kept.notice).toBe('kept');
  });

  it('a refused write answers its error, never the notice a before hook set first', async () => {
    await expect(protocol.createData({ object: DEAL.name, data: { body: 'refuse', say: 'Sent for approval' } }))
      .rejects.toThrow(/refused by a before hook/);
  });

  it('nothing is stored: the persisted row and the answered record carry no `notice`', async () => {
    const answer: any = await protocol.createData({ object: DEAL.name, data: { body: 'hi', say: 'Sent for approval' } });
    expect(Object.keys(storeFor(DEAL.name).get(answer.id)!)).not.toContain('notice');
    expect('notice' in answer.record).toBe(false);
  });

  it('a nested write a hook makes inside this one adds nothing to the outer answer, though its hook DID call', async () => {
    nestedSay = 'nested notice';
    const answer: any = await protocol.createData({ object: DEAL.name, data: { body: 'outer' } });
    expect(nestedSay).toBeUndefined(); // the nested deal was written, asking for a notice …
    expect([...storeFor(DEAL.name).values()].some((r) => r.say === 'nested notice')).toBe(true);
    expect('notice' in answer).toBe(false); // … and the outer answer was told nothing.
  });

  it('each request answers only its own: a second create is not told the first one\'s notice', async () => {
    const first: any = await protocol.createData({ object: DEAL.name, data: { body: 'a', say: 'Sent for approval' } });
    const second: any = await protocol.createData({ object: DEAL.name, data: { body: 'b' } });
    expect(first.notice).toBe('Sent for approval');
    expect('notice' in second).toBe(false);
  });
});

describe('[#28000] updateData answers a hook-set message as `notice`', () => {
  beforeEach(() => boot('envelope'));

  it('answers the message a beforeUpdate hook set, and the answer conforms', async () => {
    const created: any = await protocol.createData({ object: DEAL.name, data: { body: 'hi' } });
    const answer: any = await protocol.updateData({ object: DEAL.name, id: created.id, data: { say: 'Sent for approval' } });
    expect(answer.notice).toBe('Sent for approval');
    expect(UpdateDataResponseSchema.safeParse(answer).success).toBe(true);
  });

  it('answers the message an afterUpdate hook set, the last call winning', async () => {
    const created: any = await protocol.createData({ object: DEAL.name, data: { body: 'hi' } });
    const answer: any = await protocol.updateData({
      object: DEAL.name, id: created.id, data: { say: 'first', say_after: 'Approval requested' },
    });
    expect(answer.notice).toBe('Approval requested');
  });

  it('control: no hook set one → no `notice` key at all', async () => {
    const created: any = await protocol.createData({ object: DEAL.name, data: { body: 'hi' } });
    const answer: any = await protocol.updateData({ object: DEAL.name, id: created.id, data: { body: 'edited' } });
    expect('notice' in answer).toBe(false);
  });
});

describe('[#28000] a declarative `handler` reaches the same listener through its flat record view', () => {
  beforeEach(() => boot('declarative'));

  it('a beforeInsert handler sets the create answer\'s notice', async () => {
    const answer: any = await protocol.createData({ object: DEAL.name, data: { body: 'hi', say: 'Sent for approval' } });
    expect(answer.notice).toBe('Sent for approval');
  });

  it('an afterUpdate handler sets the update answer\'s notice', async () => {
    const created: any = await protocol.createData({ object: DEAL.name, data: { body: 'hi' } });
    const answer: any = await protocol.updateData({ object: DEAL.name, id: created.id, data: { say_after: 'Approval requested' } });
    expect(answer.notice).toBe('Approval requested');
  });
});

describe('[#28251] `ctx.notice(message)` — the hook member bound from the same listener', () => {
  beforeEach(() => boot('member'));

  it('a beforeInsert call sets the create answer\'s notice, and the answer conforms', async () => {
    const answer: any = await protocol.createData({ object: DEAL.name, data: { body: 'hi', say: 'Sent for approval' } });
    expect(answer.notice).toBe('Sent for approval');
    expect(CreateDataResponseSchema.safeParse(answer).success).toBe(true);
  });

  it('an afterInsert call wins over the beforeInsert one', async () => {
    const answer: any = await protocol.createData({
      object: DEAL.name, data: { body: 'hi', say: 'first', say_after: 'Renewal created' },
    });
    expect(answer.notice).toBe('Renewal created');
  });

  it('a declarative handler sets the update answer\'s notice, both phases', async () => {
    const created: any = await protocol.createData({ object: DEAL.name, data: { body: 'hi' } });
    const before: any = await protocol.updateData({ object: DEAL.name, id: created.id, data: { say: 'Sent for approval' } });
    expect(before.notice).toBe('Sent for approval');
    const after: any = await protocol.updateData({ object: DEAL.name, id: created.id, data: { say_after: 'Approval requested' } });
    expect(after.notice).toBe('Approval requested');
    expect(UpdateDataResponseSchema.safeParse(after).success).toBe(true);
  });

  it('is bound on insert dispatches and absent on delete and find ones', async () => {
    const created: any = await protocol.createData({ object: DEAL.name, data: { body: 'hi' } });
    await engine.find(DEAL.name, {});
    await engine.delete(DEAL.name, { where: { id: created.id } });
    const byEvent = Object.fromEntries(memberSeen.map((m) => [m.event, m.type]));
    expect(byEvent).toEqual({
      beforeInsert: 'function', afterInsert: 'function',
      beforeFind: 'undefined', beforeDelete: 'undefined', afterDelete: 'undefined',
    });
  });

  it('a write no one listens on (no onNotice in its bag) sets nothing and does not throw', async () => {
    const row: any = await engine.insert(DEAL.name, { body: 'seeded', say: 'Sent for approval' });
    expect(row.body).toBe('seeded');
  });

  it.each([
    ['a blank string', '   '],
    ['a number', 42],
    ['null', null],
  ])('refuses %s with a TypeError naming the call, and the write is refused', async (_label, say) => {
    await expect(protocol.createData({ object: DEAL.name, data: { body: 'hi', say } }))
      .rejects.toThrow(/ctx\.notice\(message\) takes one non-empty string/);
  });
});
