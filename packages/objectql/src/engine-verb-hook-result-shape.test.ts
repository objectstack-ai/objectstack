// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// #16231 — `findOne`, `update` and `delete` DECLARE what they answer, and the
// `after*` seam that could break each declaration is closed.
//
// ## What this suite is for
//
// `engine.ts` has four `return hookContext.result` sites. #15823 closed the
// `find()` one and recorded why it could close only that one: `find` declared
// `Promise<any[]>`, a concrete container to violate, while these three declared
// `Promise<any>` and so carried nothing an `after*` handler could break.
//
// The maintainer ruled that gap shut (option A, 2026-09-07, director seat
// summon #17, decision batch #2; options B "declare only" and C "record `any`
// as intended" were refused). The declarations moved onto what each verb
// actually answers — read off the driver contract each exit delegates to, not
// invented — and each seam is guarded as `find()`'s is:
//
//   findOne → `Record<string, any> | null`            (driver.findOne)
//   update  → `Record<string, any> | number | null`   (driver.update | driver.updateMany)
//   delete  → `boolean | number`                      (driver.delete | driver.updateMany's twin)
//
// ## The three things this suite has to hold apart
//
//   (a) the declared limbs are ANSWERABLE — including the ones a lenient guard
//       would eat: `null` from `findOne`, `null` and a count from `update`,
//       and — the load-bearing pair — `false` and `0` from `delete`;
//   (b) SHAPING STAYS LEGAL — a handler may mutate what it is handed, or assign
//       a different value of a declared shape. This is the half that keeps the
//       refusal from being a behaviour regression, and it is written against
//       the SHAPE and never against identity;
//   (c) a value outside the declaration is REFUSED, with the registered
//       ADR-0112 envelope — asserted by `code` AND `status`, never a bare
//       `toThrow()`: an unfixed engine throws nothing at all here, so a bare
//       `toThrow()` would be satisfied by any unrelated failure.
//
// ⚠️ (a) is where this suite differs most from its `find()` elder. There, every
// non-array was refusable and `[]` was the only "nothing" answer. Here each
// verb has MORE than one legal answer and two of them are falsy, so a guard
// written as a truthiness check passes `find()`'s suite and destroys this one.

import { describe, it, expect } from 'vitest';
// [check:test-source-alias] Module-top, not `await import(...)` inside a case:
// objectql resolves this specifier through `dist/`, so a first load paid inside
// a test body transforms that whole module graph while `testTimeout` runs.
import { ErrorCode } from '@objectstack/spec/api';
import { ObjectQL } from './engine.js';
import {
  FIND_ONE_HOOK_RESULT_NOT_RECORD_CODE,
  FIND_ONE_HOOK_RESULT_NOT_RECORD_STATUS,
  FindOneHookResultNotRecordError,
  UPDATE_HOOK_RESULT_NOT_WRITE_SHAPE_CODE,
  UPDATE_HOOK_RESULT_NOT_WRITE_SHAPE_STATUS,
  UpdateHookResultNotWriteShapeError,
  DELETE_HOOK_RESULT_NOT_WRITE_SHAPE_CODE,
  DELETE_HOOK_RESULT_NOT_WRITE_SHAPE_STATUS,
  DeleteHookResultNotWriteShapeError,
} from './verb-hook-result-shape.js';

function silentLogger() {
  const logger: any = {
    trace() {}, debug() {}, info() {}, warn() {}, error() {}, fatal() {},
    child() { return logger; },
  };
  return logger;
}

const ROW = { id: 't1', name: 'first', done: false };

/**
 * A driver that answers each exit the way `IDataDriver` declares it, so the
 * engine's own limbs are exercised rather than simulated:
 * `findOne` → record-or-null, `update` → record-or-null, `updateMany` → count,
 * `delete` → boolean, `deleteMany` → count.
 *
 * `missing` flips the reads to their empty answer, which is how the `null` and
 * `false` limbs below are reached through the REAL engine path rather than by
 * a handler assigning them.
 */
function makeDriver(opts: { missing?: boolean } = {}) {
  const driver: any = {
    name: 'memory', version: '0.0.0', supports: {},
    async connect() {}, async disconnect() {}, async checkHealth() { return true; },
    async execute() { return null; },
    async find() { return opts.missing ? [] : [{ ...ROW }]; },
    async findOne() { return opts.missing ? null : { ...ROW }; },
    async create(_o: string, data: any) { return data; },
    async update(_o: string, id: string, data: any) {
      return opts.missing ? null : { ...ROW, ...data, id };
    },
    async updateMany() { return 2; },
    async delete() { return !opts.missing; },
    async deleteMany() { return 2; },
    async count() { return opts.missing ? 0 : 1; },
    async bulkCreate(_o: string, rows: any[]) { return rows; },
    async bulkUpdate() { return []; },
    async bulkDelete() {},
  };
  return driver;
}

async function makeEngine(opts: { missing?: boolean } = {}) {
  const engine = new ObjectQL({ logger: silentLogger() });
  engine.registerDriver(makeDriver(opts), true);
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

// ---------------------------------------------------------------------------
// findOne
// ---------------------------------------------------------------------------

describe('#16231 findOne — the declared limbs are answerable', () => {
  it('answers the record on the no-hook path', async () => {
    const engine = await makeEngine();
    const row: any = await engine.findOne('task', { where: { id: 't1' } });
    expect(row).not.toBeNull();
    expect(row.id).toBe('t1');
  });

  it('answers `null` when the query selects nothing — through the ENGINE, not a handler', async () => {
    // The limb the declaration exists to write down, reached the way a caller
    // reaches it. A guard that refused nullish would break this.
    const engine = await makeEngine({ missing: true });
    expect(await engine.findOne('task', { where: { id: 'nope' } })).toBeNull();
  });
});

describe('#16231 findOne — shaping stays legal', () => {
  it('an afterFind that mutates the record IN PLACE still answers the record', async () => {
    const engine = await makeEngine();
    engine.registerHook('afterFind', (ctx: any) => { delete ctx.result.name; }, { object: 'task' } as any);

    const row: any = await engine.findOne('task', { where: { id: 't1' } });
    expect(row.id).toBe('t1');
    expect('name' in row).toBe(false);
  });

  it('an afterFind that assigns a DIFFERENT record still answers the record', async () => {
    // The identity half of the predicate: the container object is replaced and
    // that is legal, because what replaced it is still a record.
    const engine = await makeEngine();
    engine.registerHook('afterFind', (ctx: any) => { ctx.result = { id: ctx.result.id }; }, { object: 'task' } as any);

    expect(await engine.findOne('task', { where: { id: 't1' } })).toEqual({ id: 't1' });
  });

  it('an afterFind that assigns `null` is LEGAL — it is a declared limb', async () => {
    // ⚠️ The sharpest difference from `find()`'s guard, where nullish is
    // refused because `[]` is the only way to answer "nothing". Here `null` IS
    // the way to answer "no record", so refusing it would refuse the
    // documented spelling.
    const engine = await makeEngine();
    engine.registerHook('afterFind', (ctx: any) => { ctx.result = null; }, { object: 'task' } as any);

    expect(await engine.findOne('task', { where: { id: 't1' } })).toBeNull();
  });
});

describe('#16231 findOne — a value outside the declaration is refused', () => {
  it('an envelope is refused with FIND_ONE_HOOK_RESULT_NOT_RECORD', async () => {
    const engine = await makeEngine();
    engine.registerHook('afterFind', (ctx: any) => {
      ctx.result = [{ id: 'ENVELOPE' }];
    }, { object: 'task' } as any);

    const { value, error } = await outcomeOf(() => engine.findOne('task', { where: { id: 't1' } }));

    expect(value, 'findOne() answered instead of refusing').toBeUndefined();
    expect(error, 'findOne() did not refuse').toBeInstanceOf(FindOneHookResultNotRecordError);
    // ADR-0112 envelope: the code AND the status, never a bare `toThrow()`.
    expect(error.code).toBe(FIND_ONE_HOOK_RESULT_NOT_RECORD_CODE);
    expect(error.code).toBe('FIND_ONE_HOOK_RESULT_NOT_RECORD');
    expect(error.status).toBe(FIND_ONE_HOOK_RESULT_NOT_RECORD_STATUS);
    expect(error.status).toBe(500);
    expect(error.event).toBe('afterFind');
    expect(error.object).toBe('task');
    expect(error.observed).toBe('array');
    // The remedy half is addressed to the handler's author and names both
    // supported spellings — `null` for no record, a throw to refuse the read.
    expect(error.developerMessage).toContain("assign 'null'");
    expect(error.developerMessage).toContain('throw from the handler');
    // ⚠️ …and it names BOTH sources, because the seam sees a driver's answer as
    // well as a handler's. The user-facing sentence therefore states what is
    // AT the seam and accuses nobody: a `driver.update` double resolving
    // `undefined` is the measured case this wording exists for, and a sentence
    // reading "your handler replaced it" would have sent four repairs in this
    // repository to the wrong file.
    expect(error.developerMessage).toContain('off its own contract');
    expect(error.message).toContain("after the 'afterFind' dispatch");
    expect(error.message).not.toContain('handler replaced');
  });

  it('`undefined` is refused — decided here, and it is NOT the same as `null`', async () => {
    const engine = await makeEngine();
    engine.registerHook('afterFind', (ctx: any) => { ctx.result = undefined; }, { object: 'task' } as any);

    const { error } = await outcomeOf(() => engine.findOne('task', { where: { id: 't1' } }));
    expect(error?.code).toBe(FIND_ONE_HOOK_RESULT_NOT_RECORD_CODE);
    expect(error.observed).toBe('undefined');
  });

  it('a string is refused — the predicate is a shape test, not `typeof`', async () => {
    const engine = await makeEngine();
    engine.registerHook('afterFind', (ctx: any) => { ctx.result = 'row'; }, { object: 'task' } as any);

    const { error } = await outcomeOf(() => engine.findOne('task', { where: { id: 't1' } }));
    expect(error?.code).toBe(FIND_ONE_HOOK_RESULT_NOT_RECORD_CODE);
    expect(error.observed).toBe('string');
  });

  it('the refusal fires BEFORE maskSecretFields / stripSearchCompanionFromRead see it', async () => {
    // Driven, not asserted about source, exactly as #15823 drives the same
    // placement claim on `find()`: both consumers run on `hookContext.result`
    // between the dispatch and the return, so a replaced value they walked
    // first would be diagnosed from the wrong place.
    const engine = await makeEngine();
    let poisonRead = 0;
    engine.registerHook('afterFind', (ctx: any) => {
      ctx.result = new Proxy([], {
        get(target, prop, recv) { poisonRead += 1; return Reflect.get(target, prop, recv); },
      });
    }, { object: 'task' } as any);

    const { error } = await outcomeOf(() => engine.findOne('task', { where: { id: 't1' } }));
    expect(error?.code).toBe(FIND_ONE_HOOK_RESULT_NOT_RECORD_CODE);
    expect(poisonRead, 'a consumer walked the replaced value before the refusal').toBe(0);
  });
});

// ---------------------------------------------------------------------------
// update
// ---------------------------------------------------------------------------

describe('#16231 update — the declared limbs are answerable', () => {
  it('a BY-ID write answers the record', async () => {
    const engine = await makeEngine();
    const out: any = await engine.update('task', { id: 't1', name: 'renamed' });
    expect(typeof out).toBe('object');
    expect(out.name).toBe('renamed');
  });

  it('a PREDICATE write answers the affected-row COUNT, and the guard admits it', async () => {
    // #4639: a predicate write names no row. This is the limb that made
    // `update`'s declaration a UNION rather than a record type, and the
    // measurement that a record-only guard would have refused.
    const engine = await makeEngine();
    const out = await engine.update('task', { done: true }, { multi: true, where: { done: false } } as any);
    expect(out).toBe(2);
  });
});

describe('#16231 update — shaping stays legal', () => {
  it('an afterUpdate that mutates the record IN PLACE still answers the record', async () => {
    const engine = await makeEngine();
    engine.registerHook('afterUpdate', (ctx: any) => { ctx.result.stamped = true; }, { object: 'task' } as any);

    const out: any = await engine.update('task', { id: 't1', name: 'renamed' });
    expect(out.stamped).toBe(true);
  });

  it('an afterUpdate may assign a different RECORD, `null`, or a count', async () => {
    for (const [label, assigned, expected] of [
      ['a different record', { id: 't1' }, { id: 't1' }],
      ['null', null, null],
      ['a count', 7, 7],
      ['a zero count', 0, 0],
    ] as const) {
      const engine = await makeEngine();
      engine.registerHook('afterUpdate', (ctx: any) => { ctx.result = assigned; }, { object: 'task' } as any);
      expect(await engine.update('task', { id: 't1', name: 'x' }), label).toEqual(expected);
    }
  });
});

describe('#16231 update — a value outside the declaration is refused', () => {
  for (const [label, assigned, observed] of [
    ['a string', 'done', 'string'],
    ['an array', [{ id: 't1' }], 'array'],
    ['a boolean', true, 'boolean'],
    ['undefined', undefined, 'undefined'],
  ] as const) {
    it(`${label} is refused with UPDATE_HOOK_RESULT_NOT_WRITE_SHAPE`, async () => {
      const engine = await makeEngine();
      engine.registerHook('afterUpdate', (ctx: any) => { ctx.result = assigned; }, { object: 'task' } as any);

      const { value, error } = await outcomeOf(() => engine.update('task', { id: 't1', name: 'x' }));
      expect(value, 'update() answered instead of refusing').toBeUndefined();
      expect(error, 'update() did not refuse').toBeInstanceOf(UpdateHookResultNotWriteShapeError);
      expect(error.code).toBe(UPDATE_HOOK_RESULT_NOT_WRITE_SHAPE_CODE);
      expect(error.code).toBe('UPDATE_HOOK_RESULT_NOT_WRITE_SHAPE');
      expect(error.status).toBe(UPDATE_HOOK_RESULT_NOT_WRITE_SHAPE_STATUS);
      expect(error.status).toBe(500);
      expect(error.event).toBe('afterUpdate');
      expect(error.object).toBe('task');
      expect(error.observed).toBe(observed);
    });
  }

  it("the message does NOT begin with a SQL verb — `sanitizeRowError` would blank it", async () => {
    // ⛔ Load-bearing here in a way it was not on `find()`: this refusal is
    // ABOUT `update`, so the obvious first word is the one `@objectstack/rest`'s
    // importer replaces with generic text. The constraint is pinned rather than
    // trusted to a comment.
    const engine = await makeEngine();
    engine.registerHook('afterUpdate', (ctx: any) => { ctx.result = 'done'; }, { object: 'task' } as any);

    const { error } = await outcomeOf(() => engine.update('task', { id: 't1', name: 'x' }));
    expect(error.message.startsWith('Refusing')).toBe(true);
    for (const verb of ['insert', 'update', 'delete']) {
      expect(error.message.toLowerCase().startsWith(verb), `message starts with '${verb}'`).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// delete
// ---------------------------------------------------------------------------

describe('#16231 delete — the declared limbs are answerable, INCLUDING the falsy ones', () => {
  it('a BY-ID delete answers `true` when the row was there', async () => {
    const engine = await makeEngine();
    expect(await engine.delete('task', { where: { id: 't1' } })).toBe(true);
  });

  it('a PREDICATE delete answers the affected-row COUNT', async () => {
    const engine = await makeEngine();
    expect(await engine.delete('task', { multi: true, where: { done: false } } as any)).toBe(2);
  });

  it('an afterDelete may assign `false` or `0` — a truthiness guard would refuse both', async () => {
    // ⭐ The case that separates this guard from a lenient one. `false` is what
    // `@objectstack/metadata-protocol`'s `deleteData` turns into its 404, and
    // `0` is "the predicate matched nothing". Both are ordinary answers.
    for (const falsy of [false, 0] as const) {
      const engine = await makeEngine();
      engine.registerHook('afterDelete', (ctx: any) => { ctx.result = falsy; }, { object: 'task' } as any);
      expect(await engine.delete('task', { where: { id: 't1' } }), String(falsy)).toBe(falsy);
    }
  });
});

describe('#16231 delete — a value outside the declaration is refused', () => {
  for (const [label, assigned, observed] of [
    ['a record', { deleted: 1 }, 'object'],
    ['an array', [], 'array'],
    ['null', null, 'null'],
    ['undefined', undefined, 'undefined'],
    ['a string', 'ok', 'string'],
  ] as const) {
    it(`${label} is refused with DELETE_HOOK_RESULT_NOT_WRITE_SHAPE`, async () => {
      const engine = await makeEngine();
      engine.registerHook('afterDelete', (ctx: any) => { ctx.result = assigned; }, { object: 'task' } as any);

      const { value, error } = await outcomeOf(() => engine.delete('task', { where: { id: 't1' } }));
      expect(value, 'delete() answered instead of refusing').toBeUndefined();
      expect(error, 'delete() did not refuse').toBeInstanceOf(DeleteHookResultNotWriteShapeError);
      expect(error.code).toBe(DELETE_HOOK_RESULT_NOT_WRITE_SHAPE_CODE);
      expect(error.code).toBe('DELETE_HOOK_RESULT_NOT_WRITE_SHAPE');
      expect(error.status).toBe(DELETE_HOOK_RESULT_NOT_WRITE_SHAPE_STATUS);
      expect(error.status).toBe(500);
      expect(error.event).toBe('afterDelete');
      expect(error.object).toBe('task');
      expect(error.observed).toBe(observed);
    });
  }

  it('`{ deleted: 1 }` — the invented envelope two test doubles carried — is refused', async () => {
    // Not hypothetical: `packages/spec/src/contracts/data-engine.test.ts` and
    // `packages/runtime/src/seed-loader.test.ts` both modelled `delete` as
    // answering this shape, which no driver and no engine has ever produced.
    // `Promise<any>` admitted it. Both were repaired with this card, and this
    // case is what stops the shape coming back.
    const engine = await makeEngine();
    engine.registerHook('afterDelete', (ctx: any) => { ctx.result = { deleted: 1 }; }, { object: 'task' } as any);

    const { error } = await outcomeOf(() => engine.delete('task', { where: { id: 't1' } }));
    expect(error?.code).toBe(DELETE_HOOK_RESULT_NOT_WRITE_SHAPE_CODE);
  });
});

// ---------------------------------------------------------------------------
// The vocabulary
// ---------------------------------------------------------------------------

describe('#16231 — all three refusals are registered ADR-0112 vocabulary', () => {
  it('each code is a member of the generated ErrorCode union', () => {
    for (const code of [
      FIND_ONE_HOOK_RESULT_NOT_RECORD_CODE,
      UPDATE_HOOK_RESULT_NOT_WRITE_SHAPE_CODE,
      DELETE_HOOK_RESULT_NOT_WRITE_SHAPE_CODE,
    ]) {
      expect(ErrorCode.safeParse(code).success, code).toBe(true);
    }
    // Control: the union really does reject an unregistered spelling, so the
    // assertions above are a reading rather than a schema that accepts
    // anything.
    expect(ErrorCode.safeParse('FIND_ONE_HOOK_RESULT_NOT_A_RECORD').success).toBe(false);
  });

  it('the three codes are distinct — one per declaration, not one shared refusal', () => {
    const codes = new Set([
      FIND_ONE_HOOK_RESULT_NOT_RECORD_CODE,
      UPDATE_HOOK_RESULT_NOT_WRITE_SHAPE_CODE,
      DELETE_HOOK_RESULT_NOT_WRITE_SHAPE_CODE,
    ]);
    expect(codes.size).toBe(3);
  });
});
