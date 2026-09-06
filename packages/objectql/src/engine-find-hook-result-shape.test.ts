// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// #15823 — `find()` guarantees the array, and an `afterFind` that REPLACES the
// container is refused loudly.
//
// ## The seam, and what used to happen
//
// `ObjectQL.find` declares `Promise<any[]>`, and on the hook path it ended with
// `return hookContext.result` with nothing between the `afterFind` dispatch and
// that return asserting the value was still an array. An `afterFind` handler
// assigning `ctx.result = { records: [ … ] }` therefore made a `find()` declared
// to resolve to an array resolve to an envelope — no throw, no diagnostic, no
// log. Measured on a real `ObjectQL` over a real `SqlDriver` (#15823's own
// table: `ARRAY(len=1)` with no hooks, `OBJECT{records}` with the hook), and
// reproduced live before this suite was written by
// `plugin-auth/src/find-envelope-limb-removal.test.ts`, whose #15597 control
// drives fourteen real read call sites into a non-array through exactly this
// handler.
//
// Two readings of that fact pointed opposite ways — the engine guarantees the
// array, or the declaration is wrong and a hook may reshape a read — and the
// maintainer ruled the first (2026-09-06, director seat, #15823): the refusal
// goes in, and every array-or-envelope normalizer limb downstream of `find()`
// is dead BY TYPE.
//
// ## What this suite pins
//
// The ruling's three cases, verbatim, plus the one it left open:
//
//   (a) an `afterFind` that assigns `ctx.result = { records: [...] }`
//       ⇒ refused with `FIND_HOOK_RESULT_NOT_ARRAY`;
//   (b) an `afterFind` that mutates rows in place, or reassigns a DIFFERENT
//       ARRAY ⇒ still returns an array — SHAPING STAYS LEGAL, which is the
//       half that keeps this from being a behaviour regression;
//   (c) the no-hook path unchanged;
//   (d) `undefined` / `null` — not named by the ruling, decided here and
//       argued in `find-hook-result-shape.ts`: refused, same code.
//
// ⚠️ (b) is written against the container SHAPE, never identity: a handler that
// builds a brand-new array (`ctx.result = rows.map(…)`) is doing exactly what
// ADR-0077 line 71 means by "shape reads", and a check comparing against
// `opCtx.result` — or freezing, or cloning — would break it. `Array.isArray` is
// the whole predicate, and the reassign-a-different-array case below is what
// holds it to that.

import { describe, it, expect } from 'vitest';
import { ObjectQL } from './engine.js';
import {
  FIND_HOOK_RESULT_NOT_ARRAY_CODE,
  FIND_HOOK_RESULT_NOT_ARRAY_STATUS,
  FindHookResultNotArrayError,
} from './find-hook-result-shape.js';

function silentLogger() {
  const logger: any = {
    trace() {}, debug() {}, info() {}, warn() {}, error() {}, fatal() {},
    child() { return logger; },
  };
  return logger;
}

/** Two stored rows, so "the array survived" is observable as a length. */
const ROWS = [
  { id: 't1', name: 'first', done: false },
  { id: 't2', name: 'second', done: true },
];

function makeDriver() {
  const driver: any = {
    name: 'memory', version: '0.0.0', supports: {},
    async connect() {}, async disconnect() {}, async checkHealth() { return true; },
    async execute() { return null; },
    async find() { return ROWS.map((r) => ({ ...r })); },
    async findOne() { return { ...ROWS[0] }; },
    async create(_o: string, data: any) { return data; },
    async update(_o: string, id: string, data: any) { return { id, ...data }; },
    async updateMany() { return 0; },
    async delete() { return true; },
    async deleteMany() { return 0; },
    async count() { return ROWS.length; },
    async bulkCreate(_o: string, rows: any[]) { return rows; },
    async bulkUpdate() { return []; },
    async bulkDelete() {},
  };
  return driver;
}

async function makeEngine() {
  const engine = new ObjectQL({ logger: silentLogger() });
  engine.registerDriver(makeDriver(), true);
  await engine.init();
  engine.registry.registerObject({
    name: 'task',
    fields: {
      id: { name: 'id', type: 'text', primaryKey: true, readonly: true },
      name: { name: 'name', type: 'text' },
      done: { name: 'done', type: 'boolean' },
    },
  } as any, 'test');
  return engine;
}

/** Run and return whatever came out — a value or the thrown error. */
async function outcomeOf(run: () => Promise<unknown>): Promise<{ value?: unknown; error?: any }> {
  try {
    return { value: await run() };
  } catch (error) {
    return { error };
  }
}

describe('#15823 (c) — the no-hook path is unchanged', () => {
  it('find() with no hooks registered still answers the bare array', async () => {
    const engine = await makeEngine();
    const out = await engine.find('task', {});
    expect(Array.isArray(out)).toBe(true);
    expect(out).toHaveLength(2);
    expect(out.map((r: any) => r.id)).toEqual(['t1', 't2']);
  });
});

describe('#15823 (a) — an afterFind that REPLACES the container is refused', () => {
  it('assigning ctx.result = { records: [...] } is refused with FIND_HOOK_RESULT_NOT_ARRAY', async () => {
    const engine = await makeEngine();
    engine.registerHook('afterFind', (ctx: any) => {
      ctx.result = { records: [{ id: 'ENVELOPE' }] };
    }, { object: 'task' } as any);

    const { value, error } = await outcomeOf(() => engine.find('task', {}));

    // The defect shape: it must NOT come back as a value at all.
    expect(value, 'find() answered instead of refusing').toBeUndefined();
    expect(error, 'find() did not refuse').toBeInstanceOf(FindHookResultNotArrayError);
    // ADR-0112 envelope: the code AND the status, never a bare `toThrow()`.
    expect(error.code).toBe(FIND_HOOK_RESULT_NOT_ARRAY_CODE);
    expect(error.code).toBe('FIND_HOOK_RESULT_NOT_ARRAY');
    expect(error.status).toBe(FIND_HOOK_RESULT_NOT_ARRAY_STATUS);
    // The ruling: "the message names the hook event and the object".
    expect(error.message).toContain('afterFind');
    expect(error.message).toContain('task');
    // The observed shape is named, so the author is not left guessing which
    // handler did it or what it produced.
    expect(error.event).toBe('afterFind');
    expect(error.object).toBe('task');
    expect(error.observed).toBe('object');
  });

  it('the refusal fires BEFORE maskSecretFields / stripSearchCompanionFromRead see it', async () => {
    // Both consumers assume the array and run on `hookContext.result` between
    // the dispatch and the return; the ruling puts the refusal ahead of them
    // precisely because they already assume what it now enforces. Driven, not
    // asserted about source: a handler that replaces the container with an
    // object carrying a poisoned `length` would make an array-assuming consumer
    // iterate garbage if either ran first.
    const engine = await makeEngine();
    let poisonRead = 0;
    engine.registerHook('afterFind', (ctx: any) => {
      ctx.result = {
        get length() { poisonRead += 1; return 3; },
        get 0() { poisonRead += 1; return { id: 'x' }; },
      };
    }, { object: 'task' } as any);

    const { error } = await outcomeOf(() => engine.find('task', {}));
    expect(error?.code).toBe(FIND_HOOK_RESULT_NOT_ARRAY_CODE);
    expect(poisonRead, 'a consumer walked the replaced container before the refusal').toBe(0);
  });
});

describe('#15823 (b) — SHAPING STAYS LEGAL', () => {
  it('an afterFind that mutates rows IN PLACE still returns the array', async () => {
    const engine = await makeEngine();
    engine.registerHook('afterFind', (ctx: any) => {
      for (const row of ctx.result) delete row.name;
    }, { object: 'task' } as any);

    const out: any = await engine.find('task', {});
    expect(Array.isArray(out)).toBe(true);
    expect(out).toHaveLength(2);
    expect('name' in out[0]).toBe(false);
    expect(out[0].id).toBe('t1');
  });

  it('an afterFind that reassigns a DIFFERENT array still returns the array', async () => {
    // The identity half of the predicate, and the reason it is `Array.isArray`
    // and nothing cleverer: this handler replaces the container object, and
    // that is legal because the container is still an array.
    const engine = await makeEngine();
    engine.registerHook('afterFind', (ctx: any) => {
      ctx.result = ctx.result.map((r: any) => ({ id: r.id }));
    }, { object: 'task' } as any);

    const out: any = await engine.find('task', {});
    expect(Array.isArray(out)).toBe(true);
    expect(out).toEqual([{ id: 't1' }, { id: 't2' }]);
  });

  it('an afterFind that reassigns an EMPTY array still returns the array', async () => {
    // Filtering rows down to none is shaping, not container replacement — and
    // `[]` is exactly the value a lenient guard written as a truthiness check
    // would have refused by accident.
    const engine = await makeEngine();
    engine.registerHook('afterFind', (ctx: any) => { ctx.result = []; }, { object: 'task' } as any);

    const out: any = await engine.find('task', {});
    expect(Array.isArray(out)).toBe(true);
    expect(out).toEqual([]);
  });
});

describe('#15823 (d) — the case the ruling did not name: undefined / null', () => {
  // Decided here, argued in the module: a handler that assigns neither is not
  // "replacing the container with an envelope", but it is equally not an array,
  // so `find()`'s declared `Promise<any[]>` is broken exactly as much. The
  // supported way for an `afterFind` to refuse a read is to THROW from the
  // handler; clearing the result is not a second spelling of that.
  for (const [label, value] of [['undefined', undefined], ['null', null]] as const) {
    it(`assigning ctx.result = ${label} is refused with the same code`, async () => {
      const engine = await makeEngine();
      engine.registerHook('afterFind', (ctx: any) => { ctx.result = value; }, { object: 'task' } as any);

      const { value: answered, error } = await outcomeOf(() => engine.find('task', {}));
      expect(answered, 'find() answered instead of refusing').toBeUndefined();
      expect(error?.code).toBe(FIND_HOOK_RESULT_NOT_ARRAY_CODE);
      expect(error.observed).toBe(label);
      expect(error.message).toContain('afterFind');
      expect(error.message).toContain('task');
    });
  }

  it('a string result is refused too — the predicate is Array.isArray, not typeof', async () => {
    const engine = await makeEngine();
    engine.registerHook('afterFind', (ctx: any) => { ctx.result = 'rows'; }, { object: 'task' } as any);

    const { error } = await outcomeOf(() => engine.find('task', {}));
    expect(error?.code).toBe(FIND_HOOK_RESULT_NOT_ARRAY_CODE);
    expect(error.observed).toBe('string');
  });
});

describe('#15823 — the refusal is registered ADR-0112 vocabulary', () => {
  it('the code is a member of the generated ErrorCode union', async () => {
    const { ErrorCode } = await import('@objectstack/spec/api');
    expect(ErrorCode.safeParse(FIND_HOOK_RESULT_NOT_ARRAY_CODE).success).toBe(true);
    // Control: the union really does reject an unregistered spelling, so the
    // assertion above is a reading rather than a schema that accepts anything.
    expect(ErrorCode.safeParse('FIND_HOOK_RESULT_NOT_AN_ARRAY').success).toBe(false);
  });
});
