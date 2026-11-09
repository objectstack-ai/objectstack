/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `isExpressionComputedField` (objectstack#31759): a field carrying a non-empty
 * `expression` is computed, whatever its type — read the way the spec's own
 * `isComputed` (`packages/spec/src/data/inline-grid-columns.ts`) reads it.
 */
import { describe, it, expect } from 'vitest';
import { isExpressionComputedField } from '../expression-computed-field';
import { isExpressionComputedField as fromEntry } from '../../index';

describe('isExpressionComputedField', () => {
  it('a stored field carrying a bare CEL string is computed', () => {
    expect(isExpressionComputedField({ type: 'currency', expression: 'record.quantity * record.unit_price' })).toBe(true);
  });

  it('a stored field carrying the CEL envelope is computed', () => {
    expect(
      isExpressionComputedField({ type: 'number', expression: { dialect: 'cel', source: 'record.a + 1' } }),
    ).toBe(true);
  });

  it('a formula carries one too: the predicate does not ask the type', () => {
    expect(isExpressionComputedField({ type: 'formula', expression: 'record.a * 2' })).toBe(true);
  });

  it('CONTROL: a field with no expression, an empty one or a sourceless envelope is not computed', () => {
    expect(isExpressionComputedField({ type: 'currency' })).toBe(false);
    expect(isExpressionComputedField({ type: 'currency', expression: '' })).toBe(false);
    expect(isExpressionComputedField({ type: 'currency', expression: { dialect: 'cel' } })).toBe(false);
    expect(isExpressionComputedField({ type: 'currency', expression: { dialect: 'cel', source: '' } })).toBe(false);
    expect(isExpressionComputedField({ type: 'currency', expression: null })).toBe(false);
    expect(isExpressionComputedField({ type: 'currency', expression: 42 })).toBe(false);
  });

  it('CONTROL: no field at all is not computed', () => {
    expect(isExpressionComputedField(undefined)).toBe(false);
    expect(isExpressionComputedField(null)).toBe(false);
    expect(isExpressionComputedField('record.a')).toBe(false);
  });

  it('is exported from the package entry', () => {
    expect(fromEntry).toBe(isExpressionComputedField);
  });
});
