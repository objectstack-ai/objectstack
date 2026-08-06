// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// objectstack#5480 — the shared update-dispatch predicate must be the REAL
// engine's answer, not a second opinion that happens to agree today.
//
// Exactly the argument `engine-delete-dispatch.test.ts` makes for `delete`,
// and it matters more here rather than less: a shared predicate that drifted
// from `ObjectQL.update` would make every fake engine pinned to it confidently,
// uniformly wrong, while the gate over them reported success. So this file does
// not test the predicate against a table of expectations written next to it. It
// drives the **real engine** with a recording driver over
// `ENGINE_UPDATE_DISPATCH_CASES` and asserts the engine's observed behaviour
// equals the predicate's verdict, case by case.
//
// If someone changes the dispatch rule in `engine.ts` without changing
// `engine-update-dispatch.ts`, this goes red here — the one place where both
// halves are in the room together.

import { describe, it, expect } from 'vitest';
import { ObjectQL } from './engine.js';
import {
  ENGINE_UPDATE_DISPATCH_CASES,
  ENGINE_UPDATE_REJECT_MESSAGE,
  resolveEngineUpdateDispatch,
  assertEngineUpdateDispatch,
  scalarUpdateId,
} from './engine-update-dispatch.js';

/** Records which driver entry point the engine chose, if any. */
function makeRecordingDriver() {
  const calls: Array<{ fn: 'update' | 'updateMany'; arg: unknown }> = [];
  const driver: any = {
    name: 'recording',
    version: '0.0.0',
    supports: {},
    async connect() {}, async disconnect() {}, async checkHealth() { return true; }, async execute() { return null; },
    async find() { return []; },
    async findOne() { return null; },
    async create(_o: string, data: Record<string, unknown>) { return { id: 'r1', ...data }; },
    async update(_o: string, id: string, data: Record<string, unknown>) { calls.push({ fn: 'update', arg: id }); return { id, ...data }; },
    async updateMany(_o: string, ast: unknown) { calls.push({ fn: 'updateMany', arg: ast }); return 0; },
    async delete() { return true; },
    async deleteMany() { return 0; },
    async count() { return 0; },
    async bulkCreate() { return []; }, async bulkUpdate() { return []; }, async bulkDelete() {},
    async beginTransaction() { return { __trx: true, commit: async () => {}, rollback: async () => {} }; },
    async commit() {}, async rollback() {},
  };
  return { driver, calls };
}

async function makeEngine() {
  const engine = new ObjectQL();
  const { driver, calls } = makeRecordingDriver();
  engine.registerDriver(driver, true);
  await engine.init();
  engine.registry.registerObject({
    name: 'task',
    fields: { title: { type: 'text' }, tenant: { type: 'text' } },
  } as any);
  return { engine, calls };
}

/** What the real engine actually did with this `(data, options)` pair. */
async function observeEngine(data: unknown, options: unknown): Promise<'by-id' | 'multi' | 'reject'> {
  const { engine, calls } = await makeEngine();
  try {
    await engine.update('task', data as any, options as any);
  } catch (e) {
    if ((e as Error).message === ENGINE_UPDATE_REJECT_MESSAGE) return 'reject';
    throw e;
  }
  if (calls.length !== 1) {
    throw new Error(`expected exactly one driver call, saw ${JSON.stringify(calls)}`);
  }
  return calls[0].fn === 'update' ? 'by-id' : 'multi';
}

describe('engine update dispatch — the shared predicate IS the engine (#5480)', () => {
  it('has cases on both sides of the guard (an empty or one-sided set proves nothing)', () => {
    const kinds = new Set(ENGINE_UPDATE_DISPATCH_CASES.map((c) => c.expect));
    expect(kinds).toEqual(new Set(['by-id', 'multi', 'reject']));
    expect(ENGINE_UPDATE_DISPATCH_CASES.filter((c) => c.expect === 'reject').length).toBeGreaterThan(3);
  });

  for (const c of ENGINE_UPDATE_DISPATCH_CASES) {
    it(`real engine agrees with the predicate: ${c.what} → ${c.expect}`, async () => {
      expect(resolveEngineUpdateDispatch(c.data, c.options).kind, 'predicate').toBe(c.expect);
      expect(await observeEngine(c.data, c.options), 'real ObjectQL.update').toBe(c.expect);
    });
  }

  it('rejects with the exact message a fake must reproduce', () => {
    expect(() => assertEngineUpdateDispatch({ title: 'x' }, { where: { tenant: 't1' } }))
      .toThrow(ENGINE_UPDATE_REJECT_MESSAGE);
    // …and returns the dispatch (never `reject`) when the call is legal.
    expect(assertEngineUpdateDispatch({ title: 'x' }, { where: { id: 'a' } })).toEqual({ kind: 'by-id', id: 'a' });
    expect(assertEngineUpdateDispatch({ id: 'a' }, undefined)).toEqual({ kind: 'by-id', id: 'a' });
    expect(assertEngineUpdateDispatch({ title: 'x' }, { multi: true })).toEqual({ kind: 'multi' });
  });

  it('scalarUpdateId treats operator objects and arrays as predicates, not ids', () => {
    expect(scalarUpdateId({ where: { id: 'a' } })).toBe('a');
    expect(scalarUpdateId({ where: { id: 7 } })).toBe(7);
    expect(scalarUpdateId({ where: { id: { $in: ['a'] } } })).toBeUndefined();
    expect(scalarUpdateId({ where: { id: ['a'] } })).toBeUndefined();
    expect(scalarUpdateId({ where: { id: null } })).toBeUndefined();
    expect(scalarUpdateId({ where: {} })).toBeUndefined();
    expect(scalarUpdateId(undefined)).toBeUndefined();
  });

  // ── The two places `update` is NOT `delete`. Both are pinned here rather
  //    than left to the reader, because they are exactly what a hand-copied
  //    guard gets wrong in the OTHER direction: too strict, and the double
  //    then refuses a call the producer accepts.
  it('data.id outranks where and multi, and is NOT scalar-tested (the producer\'s rule, verbatim)', () => {
    expect(resolveEngineUpdateDispatch({ id: 'rec_1' }, { where: { id: { $in: ['a'] } }, multi: true }))
      .toEqual({ kind: 'by-id', id: 'rec_1' });
    // An operator object parked in the PAYLOAD is taken as an id — the engine
    // does exactly this today, so the predicate must say so too. Improving on
    // the producer here would make this module a second opinion, which is the
    // thing #4550 removed. Tracked as #5748; when it is fixed it is fixed in
    // both files at once, which is now one edit instead of two, and this
    // assertion is what tells the next author to turn BOTH halves over.
    const operatorInPayload = resolveEngineUpdateDispatch({ id: { $in: ['a', 'b'] } }, { multi: true });
    expect(operatorInPayload.kind).toBe('by-id');
  });

  it('branches on TRUTHINESS, so a falsy scalar id does not identify a row', () => {
    expect(resolveEngineUpdateDispatch({ title: 'x' }, { where: { id: 0 } }).kind).toBe('reject');
    expect(resolveEngineUpdateDispatch({ title: 'x' }, { where: { id: '' } }).kind).toBe('reject');
    expect(resolveEngineUpdateDispatch({ id: 0, title: 'x' }, { multi: true }).kind).toBe('multi');
    // …while `scalarUpdateId` still reports the raw scalar it found. The two
    // answer different questions and only `resolveEngineUpdateDispatch`
    // answers the engine's.
    expect(scalarUpdateId({ where: { id: 0 } })).toBe(0);
  });

  it('reads data UNGUARDED, exactly like the producer', () => {
    // `ObjectQL.update` opens with `data.id`, so a missing payload is a
    // TypeError there. A double kinder than the producer about it would hide
    // the producer's behaviour.
    expect(() => resolveEngineUpdateDispatch(undefined as any, { multi: true })).toThrow(TypeError);
  });
});
