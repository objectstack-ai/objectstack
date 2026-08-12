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
    // [#7867] Answers the row the by-id branch's not-found gate asks for.
    // This used to be `return null`, which — now that a by-id update refuses a
    // ghost id with `RECORD_NOT_FOUND` — would make every by-id case in this
    // file die at the gate and never reach the driver, i.e. a DOUBLE looser
    // than the producer hiding the very dispatch verdict the file exists to
    // observe (#4434/#4550's shape, in the file that pins against it). It
    // echoes back whatever id it was asked for, so it stays agnostic about the
    // dispatch: it can never make a `reject` case look like a `by-id` one.
    async findOne(_o: string, ast: any) {
      const id = ast?.where?.id;
      return id === undefined || id === null ? null : { id, title: 'stored' };
    },
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

/**
 * What the real engine actually did with this `(data, options)` pair — the
 * verdict, and for a `by-id` call the value it bound into the PRIMARY-KEY
 * position of `driver.update(object, id, …)`.
 *
 * The bound id is observed, not inferred, because #5748's fix is invisible in
 * the verdict alone on the shape that matters most: a payload carrying an
 * operator `id` beside a scalar `where.id` was `by-id` before the fix and is
 * `by-id` after it — what changed is WHICH value reaches the driver.
 */
async function observeEngine(
  data: unknown,
  options: unknown,
): Promise<{ kind: 'by-id' | 'multi' | 'reject'; boundId?: unknown }> {
  const { engine, calls } = await makeEngine();
  try {
    await engine.update('task', data as any, options as any);
  } catch (e) {
    if ((e as Error).message === ENGINE_UPDATE_REJECT_MESSAGE) return { kind: 'reject' };
    throw e;
  }
  if (calls.length !== 1) {
    throw new Error(`expected exactly one driver call, saw ${JSON.stringify(calls)}`);
  }
  return calls[0].fn === 'update'
    ? { kind: 'by-id', boundId: calls[0].arg }
    : { kind: 'multi' };
}

/** Did the engine reach the driver at all? A rejected call must write nothing. */
async function observeDriverCalls(data: unknown, options: unknown): Promise<unknown[]> {
  const { engine, calls } = await makeEngine();
  await engine.update('task', data as any, options as any).catch(() => undefined);
  return calls;
}

describe('engine update dispatch — the shared predicate IS the engine (#5480)', () => {
  it('has cases on both sides of the guard (an empty or one-sided set proves nothing)', () => {
    const kinds = new Set(ENGINE_UPDATE_DISPATCH_CASES.map((c) => c.expect));
    expect(kinds).toEqual(new Set(['by-id', 'multi', 'reject']));
    expect(ENGINE_UPDATE_DISPATCH_CASES.filter((c) => c.expect === 'reject').length).toBeGreaterThan(3);
  });

  for (const c of ENGINE_UPDATE_DISPATCH_CASES) {
    it(`real engine agrees with the predicate: ${c.what} → ${c.expect}`, async () => {
      const predicted = resolveEngineUpdateDispatch(c.data, c.options);
      expect(predicted.kind, 'predicate').toBe(c.expect);
      const observed = await observeEngine(c.data, c.options);
      expect(observed.kind, 'real ObjectQL.update').toBe(c.expect);
      if ('expectId' in c) {
        // Both halves must bind the SAME id, and it must be the declared one —
        // see `EngineUpdateDispatchCase.expectId` for why the verdict alone is
        // not enough on #5748's shapes.
        expect(predicted.kind === 'by-id' ? predicted.id : undefined, 'predicted id').toEqual(c.expectId);
        expect(observed.boundId, 'id bound into driver.update').toEqual(c.expectId);
      }
    });
  }

  it('never binds a non-scalar into the primary-key position, on ANY case (#5748)', async () => {
    // The whole-set invariant behind #5748: whatever the verdict, the value
    // `driver.update(object, id, …)` receives is a primary key — never an
    // operator object, an array or `null`. Before the fix, every `data.id`
    // case carrying one of those broke this.
    for (const c of ENGINE_UPDATE_DISPATCH_CASES) {
      const observed = await observeEngine(c.data, c.options);
      if (observed.kind !== 'by-id') continue;
      expect(['string', 'number', 'bigint'], `${c.what}: bound ${JSON.stringify(observed.boundId)}`)
        .toContain(typeof observed.boundId);
    }
  });

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

  // ── The place `update` is NOT `delete`: it has a second id source, the
  //    payload. It is pinned here rather than left to the reader, because it
  //    is exactly what a hand-copied guard gets wrong in the OTHER direction —
  //    too strict, and the double then refuses a call the producer accepts.
  it('a SCALAR data.id still outranks where and multi (the common legal spelling, untouched by #5748)', () => {
    expect(resolveEngineUpdateDispatch({ id: 'rec_1' }, { where: { id: { $in: ['a'] } }, multi: true }))
      .toEqual({ kind: 'by-id', id: 'rec_1' });
    expect(resolveEngineUpdateDispatch({ id: 'rec_1' }, { where: { id: 'rec_2' } }))
      .toEqual({ kind: 'by-id', id: 'rec_1' });
    expect(resolveEngineUpdateDispatch({ id: 42, title: 'x' }, { multi: true }))
      .toEqual({ kind: 'by-id', id: 42 });
  });

  // ── #5748, both halves of the flip. FROM: `data.id` was taken verbatim
  //    whenever truthy, so an operator object parked in the payload was bound
  //    into `driver.update`'s primary-key position and a declared
  //    `multi: true` was swallowed with no diagnostic. TO: `data.id` goes
  //    through the same scalar test as `where.id`, so a non-scalar names no
  //    row and the decision falls through the normal ladder.
  it('a NON-SCALAR data.id is not an id, so it no longer outranks a declared multi:true (#5748)', async () => {
    const operatorInPayload = resolveEngineUpdateDispatch({ id: { $in: ['a', 'b'] }, title: 'x' }, { multi: true });
    expect(operatorInPayload).toEqual({ kind: 'multi' });
    expect(resolveEngineUpdateDispatch({ id: ['a', 'b'], title: 'x' }, { multi: true })).toEqual({ kind: 'multi' });
    expect(resolveEngineUpdateDispatch({ id: null, title: 'x' }, { multi: true })).toEqual({ kind: 'multi' });
    // …and the real engine agrees: `driver.updateMany`, not a `driver.update`
    // with `{"$in":["a","b"]}` sitting where the primary key belongs.
    expect((await observeEngine({ id: { $in: ['a', 'b'] }, title: 'x' }, { multi: true })).kind).toBe('multi');
  });

  it('a NON-SCALAR data.id falls through to where.id, which is bound instead of the operator (#5748)', async () => {
    expect(resolveEngineUpdateDispatch({ id: { $in: ['a', 'b'] }, title: 'x' }, { where: { id: 'rec_1' } }))
      .toEqual({ kind: 'by-id', id: 'rec_1' });
    const observed = await observeEngine({ id: { $in: ['a', 'b'] }, title: 'x' }, { where: { id: 'rec_1' } });
    expect(observed.kind).toBe('by-id');
    expect(observed.boundId, 'the scalar where.id, not the payload operator').toBe('rec_1');
  });

  // ── The must-answer of the #5748 ruling. Option B's objection to option A
  //    was that an operator object in the payload is most likely a TYPO — the
  //    author meant to write it in `where` — and that A would turn that typo
  //    into a real bulk write. It does not: routing a non-scalar `data.id`
  //    through the ladder means it needs a DECLARED `multi` like every other
  //    non-identifying call. With no `multi`, it is the existing loud reject,
  //    and nothing reaches the driver.
  it('a NON-SCALAR data.id with NO multi is REJECTED, never silently promoted to a bulk write (#5748)', async () => {
    for (const data of [
      { id: { $in: ['a', 'b'] }, title: 'x' },
      { id: { $ne: 'a' }, title: 'x' },
      { id: ['a', 'b'], title: 'x' },
      { id: null, title: 'x' },
    ]) {
      for (const options of [undefined, {}, { multi: false }, { where: { tenant: 't1' } }]) {
        expect(resolveEngineUpdateDispatch(data, options), `${JSON.stringify({ data, options })}`)
          .toEqual({ kind: 'reject', message: ENGINE_UPDATE_REJECT_MESSAGE });
        expect(() => assertEngineUpdateDispatch(data, options)).toThrow(ENGINE_UPDATE_REJECT_MESSAGE);
      }
    }
    // The real engine throws the same message and writes NOTHING — no
    // `driver.update` with a bound operator object, and no `driver.updateMany`
    // quietly standing in for a `multi` the caller never declared.
    await expect(makeEngine().then(({ engine }) => engine.update('task', { id: { $in: ['a', 'b'] }, title: 'x' } as any)))
      .rejects.toThrow(ENGINE_UPDATE_REJECT_MESSAGE);
    expect(await observeDriverCalls({ id: { $in: ['a', 'b'] }, title: 'x' }, undefined)).toEqual([]);
    expect(await observeDriverCalls({ id: ['a', 'b'], title: 'x' }, { multi: false })).toEqual([]);
  });

  it('the scalar test is ONE rule: the same value verdicts alike in data.id and where.id (#5748)', () => {
    // The asymmetry #5748 removed, stated as the property that replaced it.
    // `where` carries a second key so the `where`-side call is never the
    // "empty where" reject for an unrelated reason.
    for (const value of [{ $in: ['a', 'b'] }, { $ne: 'a' }, ['a', 'b'], null, 'rec_1', 42, 0, '']) {
      for (const rest of [{}, { multi: true }]) {
        const viaPayload = resolveEngineUpdateDispatch({ id: value, title: 'x' }, { where: { tenant: 't1' }, ...rest });
        const viaWhere = resolveEngineUpdateDispatch({ title: 'x' }, { where: { tenant: 't1', id: value }, ...rest });
        expect(viaPayload, `${JSON.stringify({ value, rest })}`).toEqual(viaWhere);
      }
    }
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
