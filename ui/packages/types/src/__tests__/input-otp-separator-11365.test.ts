/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#11365 — `InputOTPSchema.separator` is declared on BOTH faces, as a
 * boolean (triage's enforce arm under ADR-0049).
 *
 * The TypeScript face carried `BaseSchema`'s `[key: string]: any` when this was
 * written, so an undeclared `separator` already compiled whatever its value; the declared
 * member is what makes a non-boolean refused. The compile-time rows below are
 * checked by `tsc -p tsconfig.test.json`; the `describe` block reads the zod
 * mirror at runtime, value probe and control included. The rendering half
 * (one `role="separator"`, and none without the key) is pinned beside the
 * catalog entries in `examples/schema-catalog/test/input-otp-separator-11365.test.tsx`.
 */

import { describe, it, expect } from 'vitest';
import { InputOTPSchema } from '../zod/form.zod';
import type { InputOTPSchema as TsInputOTPSchema } from '../form';

/** Compile-time truth assertion, erased at runtime — only `tsc` checks these. */
type Expect<T extends true> = T;
/** Compile-time equality, exact in both directions; `any` equals nothing but `any`. */
type Equal<X, Y> = (<T>() => T extends X ? 1 : 2) extends (<T>() => T extends Y ? 1 : 2) ? true : false;

export type _SeparatorIsABoolean = Expect<Equal<TsInputOTPSchema['separator'], boolean | undefined>>;

/** CONTROL — the declared spelling compiles. */
export const _separatorAccepted: TsInputOTPSchema = { type: 'input-otp', length: 6, separator: true };
// @ts-expect-error -- `separator` is a declared boolean, so a string is refused
export const _separatorRefused: TsInputOTPSchema = { type: 'input-otp', length: 6, separator: 'yes' };

describe('InputOTPSchema.separator on the zod mirror (objectui#11365)', () => {
  it('a boolean `separator` parses and survives', () => {
    const result = InputOTPSchema.safeParse({ type: 'input-otp', separator: true });
    expect(result.success).toBe(true);
    expect(result.success && result.data.separator).toBe(true);
  });

  it('a non-boolean `separator` is refused with `invalid_type` at the key', () => {
    const result = InputOTPSchema.safeParse({ type: 'input-otp', separator: 'yes' });
    expect(result.success).toBe(false);
    const found = result.success ? [] : result.error.issues.map((i) => [i.code, i.path.join('.')]);
    expect(found).toEqual([['invalid_type', 'separator']]);
  });

  it('CONTROL — the same probe on an undeclared key passes through, so the refusal above is the declaration', () => {
    expect(InputOTPSchema.safeParse({ type: 'input-otp', notAKey11365: 'yes' }).success).toBe(true);
  });
});
