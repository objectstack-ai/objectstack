/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * "Is this field's value the producer's to supply?" — the classifier every
 * required-ness decision reads (#4069 / #4085).
 *
 * The runtime shapes come from `@objectstack/spec`'s own `DEFAULT_VALUE_TOKENS`
 * rather than a hand-copied list, so a token added to the family tomorrow is
 * pinned here without an edit — and so this suite cannot drift from the
 * classifier the way a literal list would. `@object-ui/plugin-form`'s
 * `createDefaults.test.tsx` pins the same predicate from the seeding side; both
 * import ONE implementation, which is the point.
 */

import { describe, it, expect } from 'vitest';
import { DEFAULT_VALUE_TOKENS } from '@objectstack/spec/data';
import { isRuntimeDefault, isServerOwnedValue } from '../server-owned-value.js';

/** A CEL Expression envelope — the non-token half of "the server resolves it". */
const CEL_DEFAULT = { dialect: 'cel', source: 'today()' };

const RUNTIME_SHAPES: Array<readonly [string, unknown]> = [
  ...DEFAULT_VALUE_TOKENS.map((t) => [String(t), t as unknown] as const),
  ['CEL envelope', CEL_DEFAULT as unknown] as const,
];

describe('isRuntimeDefault', () => {
  it.each(RUNTIME_SHAPES)('%s is an instruction the server resolves', (_what, value) => {
    expect(isRuntimeDefault(value)).toBe(true);
  });

  it.each([
    ['a static literal', 'draft'],
    ['a number', 0],
    ['a boolean', false],
    ['an empty string', ''],
    ['no default', undefined],
    ['null', null],
    ['a plain object', { foo: 'bar' }],
    // Structural, not dialect-specific: the point is "the server evaluates
    // this", which is true for every dialect — but BOTH halves must be there.
    ['a half-formed envelope', { dialect: 'cel' }],
  ])('%s is a literal value, not an instruction', (_what, value) => {
    expect(isRuntimeDefault(value)).toBe(false);
  });
});

describe('isServerOwnedValue (#4085)', () => {
  /** A runtime FormField as the object-bound builders produce it. */
  const withDefault = (defaultValue: unknown) => ({ name: 'remind_at', field: { defaultValue } });

  it.each(RUNTIME_SHAPES)('%s makes a CREATE form field server-owned', (_what, value) => {
    expect(isServerOwnedValue(withDefault(value), true)).toBe(true);
  });

  it.each(RUNTIME_SHAPES)('%s is NOT server-owned on an EDIT form', (_what, value) => {
    // The token was resolved at insert; the control shows a persisted value, so
    // blanking it is a real removal and every required rule enforces normally.
    expect(isServerOwnedValue(withDefault(value), false)).toBe(false);
  });

  it('a STATIC literal default is never server-owned — that control was seeded', () => {
    expect(isServerOwnedValue(withDefault('draft'), true)).toBe(false);
  });

  it('a field declaring no default is never server-owned', () => {
    expect(isServerOwnedValue(withDefault(undefined), true)).toBe(false);
    expect(isServerOwnedValue({ name: 'title' }, true)).toBe(false);
  });

  it('a hand-authored FormField carries no object metadata, so it is untouched', () => {
    // Only the object-bound builders stash `field`; a form schema written by
    // hand has no declared default the server knows about, so its rules stand.
    expect(isServerOwnedValue({ name: 'title', defaultValue: 'NOW()' } as any, true)).toBe(false);
  });

  it('tolerates a missing field descriptor', () => {
    expect(isServerOwnedValue(undefined, true)).toBe(false);
    expect(isServerOwnedValue(null, true)).toBe(false);
    expect(isServerOwnedValue({ field: null }, true)).toBe(false);
  });
});
