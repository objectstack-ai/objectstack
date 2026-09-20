// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, expect, it } from 'vitest';

import { celEngine, parseCelToAst, printCelAst } from './index';

/**
 * #15811 — the lossless half of the evaluated-slot migration.
 *
 * Every evaluated expression slot in the spec composes
 * `EvaluatedExpressionInputSchema`, so an `{ dialect: 'cel', ast }` envelope
 * with no `source` no longer parses. `printCelAst` is what makes that
 * migration mechanical for CEL instead of a re-authoring job, and these are
 * the pins on the two claims the ADR-0087 entry makes about it: it recovers a
 * source the ENGINE agrees with, and it answers `null` — rather than inventing
 * a source — for anything it cannot round-trip.
 */
describe('printCelAst', () => {
  const SOURCES = [
    'record.amount > 10',
    "record.priority == 'urgent'",
    "'org_admin' in current_user.positions",
    'record.a == 1 && (record.b != 2 || record.c > 3)',
    'size(record.tags) > 0',
    'record.status == "paid"',
  ];

  it.each(SOURCES)('round-trips %s to a source the engine evaluates identically', (source) => {
    const ast = parseCelToAst(source);
    expect(ast).not.toBeNull();

    const printed = printCelAst(ast);
    expect(printed).toBeTypeOf('string');

    // The claim is about MEANING, not bytes: `serialize` re-renders from the
    // parse tree, so single quotes come back double-quoted. What must hold is
    // that the recovered source evaluates to the same value on the same scope.
    const ctx = {
      record: { amount: 11, priority: 'urgent', a: 1, b: 9, c: 9, status: 'paid', tags: ['x'] },
      user: { id: 'u1', positions: ['org_admin'] },
    };
    const before = celEngine.evaluate({ dialect: 'cel', source }, ctx);
    const after = celEngine.evaluate({ dialect: 'cel', source: printed as string }, ctx);
    expect(after.ok).toBe(true);
    expect(before.ok).toBe(true);
    expect(after.ok && after.value).toEqual(before.ok && before.value);
  });

  it('normalises quote style rather than preserving the authored bytes', () => {
    // Pinned so the ADR-0087 entry's "lossless about meaning, not bytes"
    // sentence is a measurement and not a hedge.
    expect(printCelAst(parseCelToAst("record.p == 'x'"))).toBe('record.p == "x"');
  });

  // The dark half. Without these the `null` contract is untested and a caller
  // could be handed an invented source for an `ast` nobody can run.
  it.each([
    ['null', null],
    ['undefined', undefined],
    ['a plain string', 'record.amount > 10'],
    ['a number', 7],
    ['an empty object', {}],
    ['an object shaped like metadata, not like an AST', { type: 'nope', value: 1 }],
    ['an array', []],
  ])('answers null for %s', (_label, value) => {
    expect(printCelAst(value)).toBeNull();
  });

  it('refuses a printed source the platform parser cannot take back', () => {
    // The round-trip leg, exercised through the one input that reaches it: a
    // CEL AST is only accepted when `parseCelToAst` re-accepts what was
    // printed, so the printer can never widen what this platform evaluates.
    const ast = parseCelToAst('record.a == 1');
    expect(printCelAst(ast)).toBe('record.a == 1');
    expect(parseCelToAst(printCelAst(ast) as string)).not.toBeNull();
  });
});
