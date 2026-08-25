// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// objectstack#11957 — the shared `findOne` predicate must be the REAL engine's
// answer, not a second opinion that happens to agree today.
//
// A shared predicate that drifted from `ObjectQL.findOne` would be worse than no
// predicate at all: every fake engine pinned to it would be confidently,
// uniformly wrong, and the gate over them would report success (route-ownership
// rule 3 — prefer failing to falling back). So this file does not test the
// predicate against a table of expectations written next to it. It drives the
// **real engine** with a recording driver over `ENGINE_FINDONE_PREDICATE_CASES`
// and asserts the engine's observed behaviour equals the predicate's verdict,
// case by case — the same construction `engine-delete-dispatch.test.ts` uses for
// the write side, and for the same reason.
//
// If someone changes `requireFindOnePredicate` in `engine.ts` without changing
// `engine-findone-predicate.ts`, this goes red here — the one place where both
// halves are in the room together.

import { describe, it, expect } from 'vitest';
import type { EngineQueryOptions } from '@objectstack/spec/data';
import { ObjectQL } from './engine.js';
import {
  ENGINE_FINDONE_PREDICATE_CASES,
  engineFindOnePredicateRefusalMessage,
  resolveEngineFindOnePredicate,
  assertEngineFindOnePredicate,
} from './engine-findone-predicate.js';

const OBJECT = 'task';

/** Records whether the engine ever reached the driver's read path. */
function makeRecordingDriver() {
  const calls: Array<{ fn: 'find' | 'findOne'; ast: unknown }> = [];
  const driver: any = {
    name: 'recording',
    version: '0.0.0',
    supports: {},
    async connect() {}, async disconnect() {}, async checkHealth() { return true; }, async execute() { return null; },
    async find(_o: string, ast: unknown) { calls.push({ fn: 'find', ast }); return []; },
    async findOne(_o: string, ast: unknown) { calls.push({ fn: 'findOne', ast }); return null; },
    async create(_o: string, data: Record<string, unknown>) { return { id: 'r1', ...data }; },
    async update(_o: string, id: string, data: Record<string, unknown>) { return { id, ...data }; },
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
  // `title`/`status` are declared because the filter doors that run BEFORE the
  // #4419 guard (`assertFilterIsMaterializable`, `assertOrderByIsMaterializable`)
  // judge against the real field map — a case naming an undeclared column would
  // die at a different door and tell us nothing about this one.
  // `searchableFields` is explicit so the `search` case resolves deterministically
  // rather than through the auto-default.
  // `packageId` is REQUIRED (`registerObject(schema, packageId, …)`); the
  // one-argument spelling some older doubles in this package still use is a
  // TS2554 that objectql's own `tsconfig.json` hides, because it excludes
  // `**/*.test.ts` — visible only to the TEST_DEBT re-measure, which is a
  // shrink-only ratchet. Passing it keeps this file out of that pile.
  engine.registry.registerObject(
    {
      name: OBJECT,
      fields: { title: { type: 'text' }, status: { type: 'text' } },
      searchableFields: ['title', 'status'],
    },
    'test-package',
  );
  return { engine, calls };
}

/** What the real engine actually did with this query bag. */
async function observeEngine(query: unknown): Promise<'selective' | 'reject'> {
  const { engine, calls } = await makeEngine();
  try {
    // `as unknown as EngineQueryOptions`, never a bare `as any`: the case-set
    // deliberately carries OFF-CONTRACT bags (`where: []`, an `orderBy` record)
    // because those are the shapes the guard exists to refuse, and this spelling
    // names the contract being bypassed instead of erasing it (#4674/#4918).
    await engine.findOne(OBJECT, query as unknown as EngineQueryOptions);
  } catch (e) {
    const message = (e as Error).message;
    // Only the #4419 refusal counts as this predicate's verdict. Anything else
    // — a malformed filter array, an unmaterializable column, an unknown option
    // — is a DIFFERENT door and must not be laundered into a passing case.
    if (message === engineFindOnePredicateRefusalMessage(OBJECT)) return 'reject';
    throw e;
  }
  if (calls.length !== 1) {
    throw new Error(`expected exactly one driver read, saw ${JSON.stringify(calls)}`);
  }
  return 'selective';
}

describe('engine findOne predicate — the shared predicate IS the engine (#11957)', () => {
  it('has cases on both sides of the guard (an empty or one-sided set proves nothing)', () => {
    const kinds = new Set(ENGINE_FINDONE_PREDICATE_CASES.map((c) => c.expect));
    expect(kinds).toEqual(new Set(['selective', 'reject']));
    expect(ENGINE_FINDONE_PREDICATE_CASES.filter((c) => c.expect === 'reject').length)
      .toBeGreaterThan(3);
    expect(ENGINE_FINDONE_PREDICATE_CASES.filter((c) => c.expect === 'selective').length)
      .toBeGreaterThan(3);
  });

  for (const c of ENGINE_FINDONE_PREDICATE_CASES) {
    it(`real engine agrees with the predicate: ${c.what} → ${c.expect}`, async () => {
      expect(resolveEngineFindOnePredicate(OBJECT, c.query).kind, 'predicate').toBe(c.expect);
      expect(await observeEngine(c.query), 'real ObjectQL.findOne').toBe(c.expect);
    });
  }

  it('refuses with the exact message a fake must reproduce, object name included', () => {
    expect(() => assertEngineFindOnePredicate(OBJECT, { where: [] }))
      .toThrow(engineFindOnePredicateRefusalMessage(OBJECT));
    // The message quotes the object twice — a fake reproducing only the prefix
    // would let a test assert on wording the producer never emits.
    const message = engineFindOnePredicateRefusalMessage('sys_user');
    expect(message).toContain("findOne('sys_user')");
    expect(message).toContain("find('sys_user', { limit: 1 })");
  });

  it('returns the verdict (never `reject`) when the call selects a record', () => {
    expect(assertEngineFindOnePredicate(OBJECT, { where: { id: 'a' } }))
      .toEqual({ kind: 'selective', by: 'where' });
    expect(assertEngineFindOnePredicate(OBJECT, { filter: { status: 'open' } }))
      .toEqual({ kind: 'selective', by: 'where' });
    expect(assertEngineFindOnePredicate(OBJECT, { orderBy: [{ field: 'title', order: 'desc' }] }))
      .toEqual({ kind: 'selective', by: 'orderBy' });
    expect(assertEngineFindOnePredicate(OBJECT, { search: 'widget' }))
      .toEqual({ kind: 'selective', by: 'search' });
  });

  // The three shapes a hand-mirrored `if (!query?.where && !query?.orderBy)`
  // gets wrong, spelled out because they are the whole argument for importing
  // the producer's decision instead of copying it.
  it('reads `where: []` as NO predicate — the #11767 shape a truthiness copy accepts', () => {
    expect(resolveEngineFindOnePredicate(OBJECT, { where: [] }).kind).toBe('reject');
    // …while a non-empty filter array lowers to a real condition.
    expect(resolveEngineFindOnePredicate(OBJECT, { where: ['status', '=', 'open'] }).kind)
      .toBe('selective');
  });

  it('reads `where: {}` as NO predicate and the `filter` alias as one', () => {
    expect(resolveEngineFindOnePredicate(OBJECT, { where: {} }).kind).toBe('reject');
    expect(resolveEngineFindOnePredicate(OBJECT, { filter: { status: 'open' } }).kind)
      .toBe('selective');
  });

  it('requires orderBy to be a NON-EMPTY ARRAY, as `Array.isArray` does in the engine', () => {
    expect(resolveEngineFindOnePredicate(OBJECT, { orderBy: [] }).kind).toBe('reject');
    // `EngineFindOneQueryInput.orderBy` is `unknown`, so the record form needs no
    // assertion at all — the predicate's own input type admits it and answers.
    expect(resolveEngineFindOnePredicate(OBJECT, { orderBy: { title: 'desc' } }).kind)
      .toBe('reject');
  });
});
