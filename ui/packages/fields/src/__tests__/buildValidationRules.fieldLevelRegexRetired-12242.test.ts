/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#12242 (maintainer ruling A) — `buildValidationRules` no longer
 * compiles a field-level `pattern` / `pattern_message` or `validate`.
 *
 * `@objectstack/spec`'s `FieldSchema` refuses all three by name, so no
 * published object carries them; `@object-ui/types` retires them as `never`
 * tombstones. An object's regex check is its `format` validation rule, which
 * the server runs on save, and no client pre-check of it is added.
 *
 * Each row carries a control from the same call, so "no rule" reads as "the key
 * was not read" and never as "this function emits nothing":
 *  - the `email` / `url` format rules and the length bounds still compile;
 *  - a `location` field keeps its stored-value check, alone.
 */
import { describe, it, expect } from 'vitest';
import { buildValidationRules } from '../index';

describe('buildValidationRules — the field-level regex keys are not read (objectui#12242)', () => {
  it('a field-level `pattern` (string or RegExp) and its `pattern_message` produce no rule', () => {
    expect(buildValidationRules({ type: 'text', name: 'sku', pattern: '^[A-Z]{3}-[0-9]{4}$' })).toBeUndefined();
    expect(
      buildValidationRules({ type: 'text', name: 'sku', pattern: /^[A-Z]+$/, pattern_message: 'Capitals only' }),
    ).toBeUndefined();
  });

  it('CONTROL — the same field with a declared bound still compiles that bound, and nothing for the pattern', () => {
    const rules = buildValidationRules({ type: 'text', name: 'sku', maxLength: 8, pattern: '^[A-Z]+$' });
    expect(Object.keys(rules)).toEqual(['maxLength']);
    expect(rules.maxLength.value).toBe(8);
  });

  it('CONTROL — the `email` and `url` types keep their own format rule', () => {
    expect(buildValidationRules({ type: 'email', name: 'contact' }).pattern.messageKey).toBe('validation.email');
    expect(buildValidationRules({ type: 'url', name: 'site' }).pattern.messageKey).toBe('validation.url');
  });

  it('a field-level `validate` produces no rule', () => {
    expect(buildValidationRules({ type: 'text', name: 'sku', validate: () => 'never valid' })).toBeUndefined();
  });

  it('CONTROL — a `location` field keeps its stored-value check, and only that', () => {
    const rules = buildValidationRules({ type: 'location', name: 'site', validate: () => 'never valid' });
    expect(Object.keys(rules.validate)).toEqual(['location']);
    expect(typeof rules.validate.location).toBe('function');
  });
});
