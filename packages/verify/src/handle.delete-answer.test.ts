// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#22599] What `hooks.run` declares each write resolves with. A delete
// resolves with what the engine's `delete` answers (`true` for the row it
// removed), never with a row: typed as a row, a test that read a field of a
// delete's answer type-checked and then read `undefined`.
//
// A TYPE test. Its assertions are checked by the package's test-layer tsc
// program (`pnpm --filter @objectstack/verify typecheck`, which runs
// `check:test-typecheck` over `tsconfig.test.json`); at run time they are
// no-ops, and nothing here boots a stack.

import { describe, it, expectTypeOf } from 'vitest';
import type { ObjectQL } from '@objectstack/objectql';

import type { EngineRow, VerifyHandle } from './handle.js';

/** The engine's own declaration, the one the handle reads its delete answer off. */
type EngineDeleteAnswer = Awaited<ReturnType<ObjectQL['delete']>>;

/** Never called: each call is here to be resolved against the overloads, not run. */
function answersOf(hooks: VerifyHandle['hooks'], anyOperation: 'insert' | 'update' | 'delete') {
  return {
    personDelete: hooks.run('obj', 'delete', { id: 'x' }, { as: 'token' }),
    systemDelete: hooks.run('obj', 'delete', { id: 'x' }, { system: true }),
    personInsert: hooks.run('obj', 'insert', { name: 'x' }, { as: 'token' }),
    systemInsert: hooks.run('obj', 'insert', { name: 'x' }, { system: true }),
    personUpdate: hooks.run('obj', 'update', { id: 'x' }, { as: 'token' }),
    systemUpdate: hooks.run('obj', 'update', { id: 'x' }, { system: true }),
    unionOperation: hooks.run('obj', anyOperation, { id: 'x' }, { as: 'token' }),
  };
}
type Answers = { [K in keyof ReturnType<typeof answersOf>]: Awaited<ReturnType<typeof answersOf>[K]> };

describe("hooks.run(object, 'delete', …) resolves with what the engine answers", () => {
  it('a delete, by a person or by the system, resolves with the engine delete answer', () => {
    expectTypeOf<Answers['personDelete']>().toEqualTypeOf<EngineDeleteAnswer>();
    expectTypeOf<Answers['systemDelete']>().toEqualTypeOf<EngineDeleteAnswer>();
  });

  it("a delete's answer is not a row: reading a field of it does not type-check", () => {
    expectTypeOf<Answers['personDelete']>().not.toHaveProperty('id');
    expectTypeOf<Answers['systemDelete']>().not.toHaveProperty('id');
  });

  it('an insert or an update still resolves with the row', () => {
    expectTypeOf<Answers['personInsert']>().toEqualTypeOf<EngineRow>();
    expectTypeOf<Answers['systemInsert']>().toEqualTypeOf<EngineRow>();
    expectTypeOf<Answers['personUpdate']>().toEqualTypeOf<EngineRow>();
    expectTypeOf<Answers['systemUpdate']>().toEqualTypeOf<EngineRow>();
  });

  it('an operation of the union type resolves with the union of the answers', () => {
    expectTypeOf<Answers['unionOperation']>().toEqualTypeOf<EngineRow | EngineDeleteAnswer>();
  });
});
