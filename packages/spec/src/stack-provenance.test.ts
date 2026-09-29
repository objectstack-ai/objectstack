// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Stack provenance (#20367 ruling B — one authoring shape).
 *
 * What is pinned:
 *
 *  - both stack producers stamp their output (`defineStack` in BOTH modes,
 *    `composeStacks` at every arity), and {@link hasStackProvenance} is `false`
 *    for everything else — a literal, a spread copy, a JSON copy;
 *  - the mark is invisible to every data reader: `Object.keys`, the strict
 *    stack schema, `JSON.stringify` (so it never reaches a compiled artifact);
 *  - `composeStacks` refuses an unbuilt input with `STACK_PROVENANCE_MISSING`
 *    / 422, naming each refused input, before anything else — a lone input
 *    included;
 *  - the code is registered for both emitters in the ADR-0112 ledger.
 *
 * Every refusal has its control: the same content, built, is accepted.
 */
import { describe, it, expect } from 'vitest';
import { composeStacks, defineStack, hasStackProvenance, ObjectStackDefinitionSchema, type ObjectStackDefinition } from './stack.zod';
import { ERROR_CODE_LEDGER } from './api/error-code-ledger.zod';

type Envelope = Error & { code?: string; status?: number; issues?: readonly unknown[] };

function refusal(fn: () => unknown): Envelope | null {
  try {
    fn();
    return null;
  } catch (e) {
    return e as Envelope;
  }
}

const config = (id: string, ns: string) => ({
  manifest: { id, name: ns, version: '1.0.0', type: 'app' as const, namespace: ns },
  objects: [{ name: `${ns}_thing`, label: 'Thing', fields: { title: { type: 'text' as const, label: 'Title' } } }],
  // A bound standalone action: `defineStack` merges it into `objects[].actions`
  // as well, the echo a door-side re-judgement would refuse.
  actions: [{ name: `${ns}_go`, label: 'Go', type: 'script' as const, target: 'noop', objectName: `${ns}_thing` }],
});

const literal = (id: string, ns: string) => config(id, ns) as unknown as ObjectStackDefinition;

describe('the producers stamp their output', () => {
  it('defineStack (strict) output carries provenance', () => {
    expect(hasStackProvenance(defineStack(config('com.example.a', 'aa')))).toBe(true);
  });

  it('defineStack (strict: false) output carries provenance too — the choice is made inside the producer', () => {
    expect(hasStackProvenance(defineStack(config('com.example.a', 'aa'), { strict: false }))).toBe(true);
  });

  it('composeStacks output carries provenance at every arity', () => {
    const a = defineStack(config('com.example.a', 'aa'));
    const b = defineStack(config('com.example.b', 'bb'));
    expect(hasStackProvenance(composeStacks([]))).toBe(true);
    expect(hasStackProvenance(composeStacks([a]))).toBe(true);
    expect(hasStackProvenance(composeStacks([a, b]))).toBe(true);
    expect(hasStackProvenance(composeStacks([a, b], { manifest: 'preserve' }))).toBe(true);
  });

  it('a nested composition accepts a composed stack as an input', () => {
    const a = defineStack(config('com.example.a', 'aa'));
    const b = defineStack(config('com.example.b', 'bb'));
    const c = defineStack(config('com.example.c', 'cc'));
    expect(refusal(() => composeStacks([composeStacks([a, b]), c]))).toBeNull();
  });

  it('the stamp does not mutate the author input', () => {
    const input = config('com.example.a', 'aa');
    defineStack(input);
    defineStack(input, { strict: false });
    expect(hasStackProvenance(input)).toBe(false);
  });
});

describe('hasStackProvenance is false for everything no producer returned', () => {
  const built = () => defineStack(config('com.example.a', 'aa'));

  it.each([
    ['a plain object literal', () => config('com.example.a', 'aa')],
    ['a spread copy of a built stack', () => ({ ...built() })],
    ['an Object.assign copy of a built stack', () => Object.assign({}, built())],
    ['a JSON round-trip of a built stack', () => JSON.parse(JSON.stringify(built()))],
    ['a structured clone of a built stack', () => structuredClone(built())],
    ['null', () => null],
    ['undefined', () => undefined],
    ['a string', () => 'defineStack'],
    ['an array', () => []],
  ])('%s', (_label, make) => {
    expect(hasStackProvenance(make())).toBe(false);
  });

  it('a mark carrying any value other than a producer literal is not a mark', () => {
    const forged = config('com.example.a', 'aa');
    Object.defineProperty(forged, Symbol.for('objectstack.stack.provenance'), { value: 'hand', enumerable: false });
    expect(hasStackProvenance(forged)).toBe(false);
  });

  it('the mark survives an in-place mutation of the built stack (it marks the object, not its content)', () => {
    const stack = built();
    (stack as Record<string, unknown>).description = 'edited after build';
    expect(hasStackProvenance(stack)).toBe(true);
  });
});

describe('the mark is invisible to every data reader', () => {
  const stack = defineStack(config('com.example.a', 'aa'));
  const KEY = Symbol.for('objectstack.stack.provenance');

  it('is non-enumerable, non-writable and not an own string key', () => {
    const desc = Object.getOwnPropertyDescriptor(stack, KEY);
    expect(desc?.enumerable).toBe(false);
    expect(desc?.writable).toBe(false);
    expect(desc?.configurable).toBe(false);
    expect(Object.keys(stack)).not.toContain(String(KEY));
  });

  it('never reaches JSON — the compiled artifact carries no authoring bookkeeping', () => {
    expect(JSON.stringify(stack)).not.toContain('provenance');
    expect(JSON.stringify(stack)).toBe(JSON.stringify({ ...stack }));
  });

  it('the strict stack schema neither sees nor refuses it', () => {
    expect(ObjectStackDefinitionSchema.safeParse(stack).success).toBe(true);
  });
});

describe('composeStacks refuses an input no producer built', () => {
  const a = () => defineStack(config('com.example.a', 'aa'));

  it('refuses a plain object input with STACK_PROVENANCE_MISSING / 422, naming it', () => {
    const refused = refusal(() => composeStacks([a(), literal('com.example.b', 'bb')]));
    expect(refused?.code).toBe('STACK_PROVENANCE_MISSING');
    expect(refused?.status).toBe(422);
    expect(refused?.issues).toEqual(["'com.example.b' (stack #1)"]);
    expect(refused?.message).toMatch(/^composeStacks provenance check failed \(1 input\): 'com\.example\.b' \(stack #1\) was not built by `defineStack`/);
  });

  it('names every unbuilt input, in input order', () => {
    const refused = refusal(() => composeStacks([literal('com.example.b', 'bb'), a(), literal('com.example.c', 'cc')]));
    expect(refused?.code).toBe('STACK_PROVENANCE_MISSING');
    expect(refused?.issues).toEqual(["'com.example.b' (stack #0)", "'com.example.c' (stack #2)"]);
  });

  it('refuses a lone unbuilt input too — the check precedes the single-input early return', () => {
    const refused = refusal(() => composeStacks([literal('com.example.b', 'bb')]));
    expect(refused?.code).toBe('STACK_PROVENANCE_MISSING');
    expect(refused?.issues).toEqual(["'com.example.b' (stack #0)"]);
  });

  it('refuses a spread copy of a built stack — the copy is not the built stack', () => {
    const refused = refusal(() => composeStacks([a(), { ...defineStack(config('com.example.b', 'bb')) }]));
    expect(refused?.code).toBe('STACK_PROVENANCE_MISSING');
  });

  it('refuses before any other judgement: a conflicting unbuilt input is refused for provenance, not the conflict', () => {
    // Same object name in both inputs — the default `objectConflict: 'error'`
    // would refuse STACK_COMPOSE_OBJECT_CONFLICT if it ever got that far.
    const refused = refusal(() => composeStacks([a(), literal('com.example.b', 'aa')]));
    expect(refused?.code).toBe('STACK_PROVENANCE_MISSING');
  });

  it('control: the same inputs, built, compose — including the bound-action echo', () => {
    const composed = refusal(() => composeStacks([a(), defineStack(config('com.example.b', 'bb'))]));
    expect(composed).toBeNull();
  });
});

describe('ADR-0112 ledger', () => {
  it('registers STACK_PROVENANCE_MISSING under both emitters', () => {
    expect(ERROR_CODE_LEDGER['@objectstack/spec']).toContain('STACK_PROVENANCE_MISSING');
    expect(ERROR_CODE_LEDGER['@objectstack/cli']).toContain('STACK_PROVENANCE_MISSING');
  });
});
