/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * THE ARRAY-ELEMENT READER PROVES ITSELF — once, for the three gates that used
 * to write this walk out by hand (objectui#5872 class (2)).
 *
 * Same two halves as `spec-enum-options.test.ts`, and the same reason: the
 * value of a shared reader is the spellings it adds to whichever one copy a
 * given site happened to carry, so every added spelling is pinned ALONE.
 *
 * What is different here is that this class's three copies DISAGREED, so this
 * file also has to pin the choices made between them — each of which could
 * change a verdict rather than preserve one:
 *
 *   - `undefined` for a node that is not an array. `clientValidation.optOuts`
 *     asserts `expect(element, '… must be an array collection').toBeDefined()`;
 *     a reader that answered with the node itself would make that assertion
 *     pass for every input, deleting a non-vacuity check in silence.
 *   - the element is returned AS FOUND. `zod@4.4.3` puts `unwrap()` on
 *     `ZodArray` itself, so a reader that unwrapped its own answer would
 *     descend into an array-of-arrays and report the wrong entry shape.
 *   - Zod 3's `_def.type` is read only behind `_def.typeName === 'ZodArray'`.
 *     On Zod 4 `_def.type` is the type-name STRING, and the hand copy in
 *     `recordDetailsInputs.spec-parity.test.ts` ended its chain with an
 *     unguarded read of it.
 */

import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { RecordDetailsProps } from '@objectstack/spec/ui';
import { arrayElementSchema } from '../spec-array-element';
import { listedShapeKeys, resolvePropsShape } from '../spec-tombstones';
import { MAX_WRAPPER_DEPTH } from '../spec-zod-wrappers';

const Entry = z.object({ name: z.string(), label: z.string() });
const entryKeys = ['name', 'label'];

describe('arrayElementSchema — the wrapper spellings it walks', () => {
  it('reads a bare `z.array()`', () => {
    expect(listedShapeKeys(arrayElementSchema(z.array(Entry)))).toEqual(entryKeys);
  });

  it.each([
    ['.optional()', z.array(Entry).optional()],
    ['.nullable()', z.array(Entry).nullable()],
    ['.default([])', z.array(Entry).default([])],
    ['.readonly()', z.array(Entry).readonly()],
    ['z.lazy()', z.lazy(() => z.array(Entry))],
  ])('walks past %s', (_spelling, schema) => {
    expect(listedShapeKeys(arrayElementSchema(schema))).toEqual(entryKeys);
  });

  it('walks a STACK of wrappers, not just one level', () => {
    // The copy in `recordDetailsInputs` did no walk at all; the one in
    // `block-config` stopped at six. Both answered only because their input
    // happened to be shallow.
    const stacked = z.array(Entry).optional().nullable().readonly();
    expect(listedShapeKeys(arrayElementSchema(stacked))).toEqual(entryKeys);
  });

  it('gives up at the declared depth instead of hanging on a self-unwrapping node', () => {
    // Reached through `unknown`, so this shape cannot be ruled out. The bound
    // is imported rather than restated — a restated `8` is one more copy.
    const looping: { unwrap: () => unknown } = { unwrap: () => looping };
    expect(MAX_WRAPPER_DEPTH).toBe(8);
    expect(arrayElementSchema(looping)).toBeUndefined();
  });
});

describe('arrayElementSchema — `undefined` is the "could not read" answer', () => {
  it.each([
    ['a plain object schema', z.object({ a: z.string() })],
    ['an enum', z.enum(['a', 'b'])],
    ['a string', z.string()],
    ['an optional object', z.object({ a: z.string() }).optional()],
  ])('answers `undefined` for %s — it is not an array', (_what, schema) => {
    expect(arrayElementSchema(schema)).toBeUndefined();
  });

  it.each([
    ['undefined', undefined],
    ['null', null],
    ['a non-schema object', { nope: true }],
    ['a string', 'array'],
  ])('answers `undefined` for %s', (_what, node) => {
    expect(arrayElementSchema(node)).toBeUndefined();
  });
});

describe('arrayElementSchema — the choices made between three disagreeing copies', () => {
  it('returns the element AS FOUND, without unwrapping it again', () => {
    // `zod@4.4.3` puts `unwrap()` on `ZodArray`, so a reader that unwrapped its
    // own answer would return `Entry` here instead of the inner array.
    const nested = z.array(z.array(Entry));
    const element = arrayElementSchema(nested);
    expect(element).toBe(nested.element);
    expect(listedShapeKeys(element)).toEqual([]);
    expect(listedShapeKeys(arrayElementSchema(element))).toEqual(entryKeys);
  });

  it('reads Zod 3’s `_def.type` element ONLY behind the `ZodArray` type name', () => {
    const zod3Array = { _def: { typeName: 'ZodArray', type: Entry } };
    expect(arrayElementSchema(zod3Array)).toBe(Entry);
  });

  it('never returns Zod 4’s `_def.type` STRING as if it were a schema', () => {
    // The unguarded limb this reader replaces: on the installed pin
    // `_def.type` is `'array'`, and `listedShapeKeys('array')` is `[]` — the
    // quiet empty set this card family exists to stop.
    const zod4Shaped = { _def: { type: 'array' } };
    expect(arrayElementSchema(zod4Shaped)).toBeUndefined();
    expect(z.array(Entry)._def.type).toBe('array');
  });
});

describe('arrayElementSchema — against the real installed contract', () => {
  it('reads a NON-EMPTY entry shape for `RecordDetailsProps.sections`', () => {
    // The non-vacuity half, stated here once for the same reason the enum
    // reader states it: `undefined` and "this array has no entry shape" are
    // different facts, and every consuming suite owes its own version of this.
    const element = arrayElementSchema(resolvePropsShape(RecordDetailsProps)?.sections);
    expect(element, 'could not read RecordDetailsProps.sections[] element').toBeDefined();
    expect(listedShapeKeys(element)).not.toEqual([]);
  });

  it('discriminates: `RecordDetailsProps` itself is not an array', () => {
    expect(arrayElementSchema(RecordDetailsProps)).toBeUndefined();
  });

  it('reads the element of an array-of-strings, which simply has no shape', () => {
    // `fields` / `hideFields` in the converged suite: the element is real, and
    // `[]` there means "no entry shape", not "the reader broke". Both facts are
    // needed, which is why the assertion above is `toBeDefined` and not `!= []`.
    const element = arrayElementSchema(resolvePropsShape(RecordDetailsProps)?.fields);
    expect(element).toBeDefined();
    expect(listedShapeKeys(element)).toEqual([]);
  });
});
