// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// objectstack#4550 — the shared delete-dispatch predicate must be the REAL
// engine's answer, not a second opinion that happens to agree today.
//
// A shared predicate that drifted from `ObjectQL.delete` would be worse than
// no predicate at all: every fake engine pinned to it would be confidently,
// uniformly wrong, and the gate over them would report success (route-ownership
// rule 3 — prefer failing to falling back). So this file does not test the
// predicate against a table of expectations written next to it. It drives the
// **real engine** with a recording driver over `ENGINE_DELETE_DISPATCH_CASES`
// and asserts the engine's observed behaviour equals the predicate's verdict,
// case by case.
//
// If someone changes the dispatch rule in `engine.ts` without changing
// `engine-delete-dispatch.ts`, this goes red here — the one place where both
// halves are in the room together.

import { describe, it, expect } from 'vitest';
import { ObjectQL } from './engine.js';
import {
  ENGINE_DELETE_DISPATCH_CASES,
  ENGINE_DELETE_REJECT_MESSAGE,
  resolveEngineDeleteDispatch,
  assertEngineDeleteDispatch,
  scalarDeleteId,
} from './engine-delete-dispatch.js';

/** Records which driver entry point the engine chose, if any. */
function makeRecordingDriver() {
  const calls: Array<{ fn: 'delete' | 'deleteMany'; arg: unknown }> = [];
  const driver: any = {
    name: 'recording',
    version: '0.0.0',
    supports: {},
    async connect() {}, async disconnect() {}, async checkHealth() { return true; }, async execute() { return null; },
    async find() { return []; },
    // [#7867] Answers the row the by-id branch's not-found gate asks for.
    // This used to be `return null`, which — now that a by-id update/delete
    // refuses a ghost id with `RECORD_NOT_FOUND` — would make every by-id case
    // in this file die at the gate and never reach the driver: a DOUBLE looser
    // than the producer, hiding the very behaviour the file exists to observe
    // (#4434/#4550's shape). It echoes back whatever id it was asked for, so it
    // stays agnostic about the dispatch and can never make a `reject` case look
    // like a `by-id` one.
    async findOne(_o: string, ast: any) {
      const id = ast?.where?.id;
      return id === undefined || id === null ? null : { id, title: 'stored' };
    },
    async create(_o: string, data: Record<string, unknown>) { return { id: 'r1', ...data }; },
    async update(_o: string, id: string, data: Record<string, unknown>) { return { id, ...data }; },
    async delete(_o: string, id: string) { calls.push({ fn: 'delete', arg: id }); return true; },
    async deleteMany(_o: string, ast: unknown) { calls.push({ fn: 'deleteMany', arg: ast }); return 0; },
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
  engine.registry.registerObject({ name: 'task', fields: { title: { type: 'text' } } });
  return { engine, calls };
}

/** What the real engine actually did with this options bag. */
async function observeEngine(options: unknown): Promise<'by-id' | 'multi' | 'reject'> {
  const { engine, calls } = await makeEngine();
  try {
    await engine.delete('task', options as any);
  } catch (e) {
    if ((e as Error).message === ENGINE_DELETE_REJECT_MESSAGE) return 'reject';
    throw e;
  }
  if (calls.length !== 1) {
    throw new Error(`expected exactly one driver call, saw ${JSON.stringify(calls)}`);
  }
  return calls[0].fn === 'delete' ? 'by-id' : 'multi';
}

describe('engine delete dispatch — the shared predicate IS the engine (#4550)', () => {
  it('has cases on both sides of the guard (an empty or one-sided set proves nothing)', () => {
    const kinds = new Set(ENGINE_DELETE_DISPATCH_CASES.map((c) => c.expect));
    expect(kinds).toEqual(new Set(['by-id', 'multi', 'reject']));
    expect(ENGINE_DELETE_DISPATCH_CASES.filter((c) => c.expect === 'reject').length).toBeGreaterThan(3);
  });

  for (const c of ENGINE_DELETE_DISPATCH_CASES) {
    it(`real engine agrees with the predicate: ${c.what} → ${c.expect}`, async () => {
      expect(resolveEngineDeleteDispatch(c.options).kind, 'predicate').toBe(c.expect);
      expect(await observeEngine(c.options), 'real ObjectQL.delete').toBe(c.expect);
    });
  }

  it('rejects with the exact message a fake must reproduce', () => {
    expect(() => assertEngineDeleteDispatch({ where: { rule_id: 'r1' } }))
      .toThrow(ENGINE_DELETE_REJECT_MESSAGE);
    // …and returns the dispatch (never `reject`) when the call is legal.
    expect(assertEngineDeleteDispatch({ where: { id: 'a' } })).toEqual({ kind: 'by-id', id: 'a' });
    expect(assertEngineDeleteDispatch({ multi: true })).toEqual({ kind: 'multi' });
  });

  it('scalarDeleteId treats operator objects and arrays as predicates, not ids', () => {
    expect(scalarDeleteId({ where: { id: 'a' } })).toBe('a');
    expect(scalarDeleteId({ where: { id: 7 } })).toBe(7);
    expect(scalarDeleteId({ where: { id: { $in: ['a'] } } })).toBeUndefined();
    expect(scalarDeleteId({ where: { id: ['a'] } })).toBeUndefined();
    expect(scalarDeleteId({ where: { id: null } })).toBeUndefined();
    expect(scalarDeleteId({ where: {} })).toBeUndefined();
    expect(scalarDeleteId(undefined)).toBeUndefined();
  });

  // ── objectstack#5747. The twin's `branches on TRUTHINESS` test, on this side.
  it('branches on TRUTHINESS, so a falsy scalar where.id does not identify a row', () => {
    expect(resolveEngineDeleteDispatch({ where: { id: 0 } }).kind).toBe('reject');
    expect(resolveEngineDeleteDispatch({ where: { id: '' } }).kind).toBe('reject');
    expect(resolveEngineDeleteDispatch({ where: { id: 0 }, multi: true }).kind).toBe('multi');
    expect(resolveEngineDeleteDispatch({ where: { id: '' }, multi: true }).kind).toBe('multi');
    // …while `scalarDeleteId` still reports the raw scalar it found. The two
    // answer different questions and only `resolveEngineDeleteDispatch`
    // answers the engine's. Same split as `scalarUpdateId` on the twin.
    expect(scalarDeleteId({ where: { id: 0 } })).toBe(0);
    expect(scalarDeleteId({ where: { id: '' } })).toBe('');
  });

  it('a fake pinned to assertEngineDeleteDispatch now refuses the falsy scalar ids too (#5747)', () => {
    // This is the whole point of the issue: before #5747 both of these
    // RETURNED `{ kind: 'by-id', id: 0 }` / `{ kind: 'by-id', id: '' }`, so
    // every double pinned to this line accepted a call the real server
    // answers `ENGINE_DELETE_REJECT_MESSAGE` to — looser than the producer on
    // exactly one input, which is the #4434 shape.
    expect(() => assertEngineDeleteDispatch({ where: { id: 0 } })).toThrow(ENGINE_DELETE_REJECT_MESSAGE);
    expect(() => assertEngineDeleteDispatch({ where: { id: '' } })).toThrow(ENGINE_DELETE_REJECT_MESSAGE);
    expect(assertEngineDeleteDispatch({ where: { id: 0 }, multi: true })).toEqual({ kind: 'multi' });
  });

  it('a falsy-id `multi` delete is still SCOPED by the caller where, not a whole-table purge', () => {
    // `multi` is the honest verdict for `{ where: { id: 0 }, multi: true }`,
    // and the reason it is safe is that the caller's own predicate still
    // rides onto the #2982 AST — the bulk delete filters on `id = 0`, it does
    // not match every row. Asserted against the REAL engine because that is
    // the only place the claim is true or false.
    return (async () => {
      const { engine, calls } = await makeEngine();
      await engine.delete('task', { where: { id: 0 }, multi: true } as any);
      expect(calls).toHaveLength(1);
      expect(calls[0].fn).toBe('deleteMany');
      expect(calls[0].arg).toMatchObject({ object: 'task', where: { id: 0 } });
    })();
  });
});
