/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `FieldValidationRules.pattern.value` is `RegExp` — never `string` — on the
 * hand-written surface (objectui#5099, maintainer ruling 2026-08-18).
 *
 * The old declaration said `string | RegExp`, and `string` was a lie the type
 * system told on behalf of a runtime that never honored it: the form
 * renderer's single read point spreads `validation` verbatim into
 * react-hook-form rules, and react-hook-form's field validator applies
 * `pattern` only when `value instanceof RegExp` (verified against the
 * installed 7.85.0 bundle — see
 * `packages/components/src/renderers/form/__tests__/rhf-recognized-rule-keys.test.ts`,
 * which re-derives that premise from the bundle at test time). So
 *
 *     validation: { pattern: { value: '^[a-zA-Z0-9_]+$', message: '…' } }
 *
 * — a declaration the old type accepted without complaint — ran ZERO
 * validations and raised zero errors. The form looked validated; nothing was.
 *
 * The ruling settles the direction as producer-side strictness (AGENTS.md
 * #0.1): the hand-written surface narrows to `RegExp`, so a string pattern is
 * a compile-time error instead of a silently-unvalidated field. Strings stay
 * legal exactly where they are actually compiled — the metadata route's field
 * declaration (`FieldSchema.pattern`), which `buildValidationRules` in
 * `@object-ui/fields` turns into `new RegExp(...)` before the renderer sees
 * it. The renderer deliberately does NOT compile strings at its read point:
 * the ruling explicitly rejected that normalization as consumer tolerance
 * that would harden the ambiguous declaration into contract.
 *
 * The `@ts-expect-error` below is REAL enforcement, not decoration: this
 * package's `type-check` script compiles the tests (`tsc -p
 * tsconfig.test.json`), so if someone widens `pattern.value` back to
 * `string | RegExp`, the directive turns into an "unused '@ts-expect-error'"
 * compile error and this file goes red.
 */

import { describe, it, expect } from 'vitest';
import type { FieldValidationRules } from '../form';

describe('FieldValidationRules.pattern.value is RegExp-only (objectui#5099)', () => {
  it('accepts a compiled RegExp', () => {
    const rules: FieldValidationRules = {
      pattern: { value: /^[a-zA-Z0-9_]+$/, message: 'Letters, digits and underscores only' },
    };
    expect(rules.pattern?.value).toBeInstanceOf(RegExp);
    expect(rules.pattern?.value.test('valid_name_1')).toBe(true);
    expect(rules.pattern?.value.test('invalid name!')).toBe(false);
  });

  it('rejects a string pattern at compile time', () => {
    const rules: FieldValidationRules = {
      // @ts-expect-error a string pattern type-checked for years and then
      // validated NOTHING — react-hook-form only applies `pattern` when the
      // value is a RegExp instance. Strings belong to the metadata route
      // (`FieldSchema.pattern`), which `buildValidationRules` compiles.
      pattern: { value: '^[a-zA-Z0-9_]+$', message: 'silently dead until #5099' },
    };
    // Runtime half of the pin: the string really is inert exactly the way the
    // issue measured — the check react-hook-form gates on is `instanceof`.
    expect(rules.pattern!.value instanceof RegExp).toBe(false);
  });
});
