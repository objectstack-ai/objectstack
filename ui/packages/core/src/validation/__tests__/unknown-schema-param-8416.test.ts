/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#8416 — `validateSchema`'s published parameter was a bare `any`.
 *
 * ## The acceptance criterion is a CLASS predicate, not a diff
 *
 * Two halves, and the second is the one with teeth:
 *
 *   1. the published parameter is no longer a bare `any`, and
 *   2. the implementation NARROWS the value before it reads a key off it.
 *
 * Half 1 alone is a type annotation, and a type annotation is erased. It is
 * pinned here anyway — by a compile-time refusal that `tsc -p tsconfig.test.json`
 * evaluates, since vitest cannot see it — but half 2 is what this file mostly
 * asserts, because half 2 is where the parameter's old `any` was actually
 * costing something.
 *
 * ## What half 2 was costing (measured on 256c709e2, before the change)
 *
 * `validateSchema` calls four rules unconditionally, and only ONE of them had a
 * guard: `validateBaseSchema` refused a non-object and returned. The other
 * three read straight through, so on `null` and `undefined` the third one
 * (`validateFormSchema`, `schema.type === 'form'`) threw
 *
 *     TypeError: Cannot read properties of null (reading 'type')
 *
 * — from a function whose declared contract is a `SchemaNodeValidationResult`
 * with an `INVALID_SCHEMA` error in it, and whose `isValidSchema` face is
 * documented "@returns True if the value is a valid schema". `assertValidSchema`
 * threw that `TypeError` in place of its own `Schema validation failed:` refusal.
 * `SchemaRenderer` (`@object-ui/react`) wraps its call in a `try`/`catch`
 * commented "Validator itself failed — surface but don't crash render", which is
 * where the crash was landing in the one shipped consumer.
 *
 * That is why these are BEHAVIOUR tests: revert the narrowing and they go red
 * by name, which a signature-only pin could never do.
 *
 * ## Caller compatibility (the card's premise, and its own falsifier)
 *
 * The card's argument for grading this cheap is that for a PARAMETER, `any` ->
 * `unknown` is caller-compatible: every value is assignable to `unknown`, so no
 * call site breaks and the cost lands inside the implementation. Its falsifier
 * was that the function's return type or generics might thread the parameter's
 * `any` outward. They do not — `validateSchema` is non-generic and returns the
 * concrete `SchemaNodeValidationResult`, which names no parameter type — and the
 * first `describe` below is that reading, written as an executable one: every
 * probe is passed WITHOUT a cast.
 */

import { describe, it, expect } from 'vitest';
import {
  validateSchema,
  assertValidSchema,
  isValidSchema,
} from '../schema-validator.js';

/** `true` only for `any` — the `1 & T` distributes to `any` for nothing else. */
type IsAny<T> = 0 extends 1 & T ? true : false;

describe('objectui#8416 — the published parameter', () => {
  it('is not a bare `any` — a compile-time refusal, erased at runtime', () => {
    // If `validateSchema`'s first parameter goes back to `any`, `IsAny<...>`
    // becomes `true`, the annotation below resolves to `never`, and the
    // initializer stops compiling. vitest proves nothing about this line; the
    // package's `type-check` (`tsc -p tsconfig.test.json`) is what evaluates it,
    // the same mechanism objectui#3181 established for this package.
    const parameterIsNotAny: IsAny<Parameters<typeof validateSchema>[0]> extends false
      ? true
      : never = true;
    expect(parameterIsNotAny).toBe(true);
  });

  it('takes every value UNCAST, which is what makes the narrowing caller-compatible', () => {
    // Not one `as any` in this list. That is the whole caller-compatibility
    // claim, executed rather than asserted: `unknown` accepts what `any`
    // accepted, so no call site outside this package had to move.
    const probes: unknown[] = [null, undefined, 0, '', false, 42, 'str', [], {}, () => {}];
    for (const probe of probes) {
      const result = validateSchema(probe);
      expect(typeof result.valid, `probe ${String(probe)}`).toBe('boolean');
    }
  });
});

describe('objectui#8416 — the implementation narrows BEFORE it reads', () => {
  it('`validateSchema(null)` returns INVALID_SCHEMA instead of throwing a raw TypeError', () => {
    const result = validateSchema(null);
    expect(result.valid).toBe(false);
    // Named, not merely `valid === false`: a validator that broke outright and
    // a validator that reported nothing would both satisfy the boolean.
    expect(result.errors.map((e) => e.code)).toEqual(['INVALID_SCHEMA']);
    expect(result.errors[0].path).toBe('schema');
  });

  it('`validateSchema(undefined)` returns INVALID_SCHEMA instead of throwing a raw TypeError', () => {
    const result = validateSchema(undefined);
    expect(result.valid).toBe(false);
    expect(result.errors.map((e) => e.code)).toEqual(['INVALID_SCHEMA']);
  });

  it('`isValidSchema(null)` answers `false`, which is the boolean its docblock promises', () => {
    expect(isValidSchema(null)).toBe(false);
    expect(isValidSchema(undefined)).toBe(false);
  });

  it("`assertValidSchema(null)` throws the validator's OWN refusal, not a TypeError", () => {
    // The distinction is the point. Both spellings "throw", so a bare
    // `.toThrow()` would have passed before this change too — the pin is on
    // WHICH error, because a `TypeError` from inside the validator is the
    // failure and `Schema validation failed:` is the contract.
    expect(() => assertValidSchema(null)).toThrow(/Schema validation failed:/);
    expect(() => assertValidSchema(null)).not.toThrow(TypeError);
  });

  it('a `null` entry inside `fields` is REPORTED, not thrown on', () => {
    // The same defect one level down: `fields` is authored data too, and its
    // entries were read with `field.name` before anything checked them.
    const result = validateSchema({ type: 'form', fields: [null, { name: 'ok' }] });
    expect(result.valid).toBe(false);
    expect(result.errors.map((e) => e.code)).toContain('MISSING_FIELD_NAME');
    expect(result.errors.find((e) => e.code === 'MISSING_FIELD_NAME')?.path).toBe(
      'schema.fields[0]',
    );
  });

  it('a `null` entry inside `children` is still SKIPPED, as it always was', () => {
    // The counterpart, and the reason the narrowing is not a licence to start
    // reporting things: `validateChildren` already guarded each child, so a
    // `null` hole stays silent. Only the guard's SPELLING moved.
    const result = validateSchema({ type: 'form', children: [null, { type: 'input' }] });
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });
});

describe('objectui#8416 — every verdict that already existed is unchanged', () => {
  it('primitives keep their single INVALID_SCHEMA error', () => {
    for (const probe of [42, 'str', true, 0, '', false]) {
      const result = validateSchema(probe);
      expect(result.errors.map((e) => e.code), `probe ${String(probe)}`).toEqual([
        'INVALID_SCHEMA',
      ]);
    }
  });

  it('an ARRAY node keeps its MISSING_REQUIRED verdict — `typeof [] === "object"` still passes', () => {
    // Deliberately inside the narrowed type. An array is not a schema, but the
    // guard this replaces let it through to the `type` rule and reported the
    // missing key, and that is the message an author already gets.
    const result = validateSchema([]);
    expect(result.errors.map((e) => e.code)).toEqual(['MISSING_REQUIRED']);
  });

  it('a retired type nested under `children` is still refused, with its own path', () => {
    const result = validateSchema({ type: 'form', children: [{ type: 'crud' }] });
    const refusal = result.errors.find((e) => e.code === 'RETIRED_TYPE');
    expect(refusal).toBeDefined();
    expect(refusal?.path).toBe('schema.children[0].type');
  });

  it('duplicate field names still warn, once per offending field', () => {
    const result = validateSchema({
      type: 'form',
      fields: [{ name: 'a' }, { name: 'a' }],
    });
    expect(result.warnings.map((w) => w.code)).toEqual([
      'DUPLICATE_FIELD_NAME',
      'DUPLICATE_FIELD_NAME',
    ]);
    expect(result.warnings[0].message).toBe('Duplicate field name: a');
  });
});
