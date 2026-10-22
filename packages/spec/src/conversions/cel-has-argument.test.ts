// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, expect, it } from 'vitest';

import { refusedHasArguments } from './cel-has-argument.js';

/**
 * [#25281] The listing's `has()` argument reading, held to the shapes the
 * engine (`@objectstack/formula`'s `celEngine.compile`, cel-js 8.0.0) was
 * measured on. Every source in the first table compiles to `has() invalid
 * argument`; every one in the second compiles, or fails for a reason that is
 * not the macro's. The lint side pins the same listing against the refusing
 * door itself (`validate-visibility-predicates.stored-listing.test.ts`).
 */
describe('refusedHasArguments — the shapes the engine refuses', () => {
  it.each([
    ['has(status)', 'status', 'bare'],
    ['has(record)', 'record', 'bare'],
    ['has (status)', 'status', 'bare'],
    ['has(\n status )', 'status', 'bare'],
    ['has(record.items[0])', 'record.items[0]', 'index'],
    ["has(record['k'])", "record['k']", 'index'],
    ['has(record.items[0][1])', 'record.items[0][1]', 'index'],
    ['has(record.items[size(record.items) - 1])', 'record.items[size(record.items) - 1]', 'index'],
    ['has(record.?a)', 'record.?a', 'other'],
    ['has(record.a.?b)', 'record.a.?b', 'other'],
    ['has(1)', '1', 'other'],
    ['has(1.5)', '1.5', 'other'],
    ['has(0x1)', '0x1', 'other'],
    ['has(1u)', '1u', 'other'],
    ["has('x')", "'x'", 'other'],
    ['has(b"x")', 'b"x"', 'other'],
    ['has(true)', 'true', 'other'],
    ['has(null)', 'null', 'other'],
    ['has(f(x))', 'f(x)', 'other'],
    ['has(record.x.size())', 'record.x.size()', 'other'],
    ['has(-record.a)', '-record.a', 'other'],
    ['has(!record.a)', '!record.a', 'other'],
    ['has(record.a == 1)', 'record.a == 1', 'other'],
    ['has(record.a + 1)', 'record.a + 1', 'other'],
    ['has(record.a ? record.b : record.c)', 'record.a ? record.b : record.c', 'other'],
    ['has(record.a in record.b)', 'record.a in record.b', 'other'],
    ['has(record.a.b.has(c))', 'record.a.b.has(c)', 'other'],
  ])('%s → `%s` (%s)', (source, argument, kind) => {
    expect(refusedHasArguments(source)).toEqual([{ argument, kind }]);
  });

  it('reads every call, in source order, inside a macro body too', () => {
    expect(refusedHasArguments('has(record.x) || has(y) && has(record.items[0])')).toEqual([
      { argument: 'y', kind: 'bare' },
      { argument: 'record.items[0]', kind: 'index' },
    ]);
    expect(refusedHasArguments('record.items.exists(i, has(i))')).toEqual([{ argument: 'i', kind: 'bare' }]);
  });
});

describe('refusedHasArguments — what it does not list', () => {
  it.each([
    ['has(record.a)', 'a field selection'],
    ['has(record.a.b.c.d)', 'a deeper selection'],
    ['has((record.a))', 'a parenthesised selection — grouping adds no node'],
    ['has(record.items[0].x)', 'a selection over an indexed receiver, lowered by the engine'],
    ["has(record['a'].b)", 'a selection over a bracketed receiver'],
    ['has(dyn(record).a)', 'a selection over a call'],
    ['has(record.a.?b.c)', 'a plain last step after an optional one'],
    ['has(1.x)', 'a selection on a literal — the engine refuses it for its type, not as the macro'],
    ['record.items.exists(i, has(i.x))', 'a selection on a comprehension variable'],
    ["has(record.a) && record.a != ''", 'the guard idiom'],
    ['record.tags.has(x)', 'a member call named `has`, not the macro'],
    ["record.note == 'has(x)'", 'a `has(` inside a string literal'],
    ['record.note == r"has(x)" && has(record.a)', 'inside a raw string'],
    ["record.note == '''has(x)\n'''", 'inside a triple-quoted string'],
    ["record.note == 'it\\'s has(x)'", 'past an escaped quote'],
    ['has()', 'no argument — the engine refuses it under another message'],
    ['has(record.a, record.b)', 'two arguments — likewise'],
    ["record.note == 'has(x)", 'a string left open — not CEL, nothing to read'],
    ['', 'an empty source'],
  ])('%s is not listed (%s)', (source) => {
    expect(refusedHasArguments(source)).toEqual([]);
  });
});
