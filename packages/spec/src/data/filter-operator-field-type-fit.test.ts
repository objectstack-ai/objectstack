// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, expect, it } from 'vitest';
import { FieldType } from './field.zod';
import {
  FILTER_OPERATOR_FIELD_TYPE_FIT,
  filterOperatorFieldTypeFit,
} from './filter-operator-field-type-fit';
import {
  TEXT_FILTER_OPERATORS,
  textOperatorDoorVerdict,
} from './filter-text-operator-declared-type';
import { VIEW_FILTER_OPERATORS } from '../ui/view.zod';

describe('filterOperatorFieldTypeFit — the one operator-by-field-type judgement', () => {
  it('answers the text-operator door\'s verdict for every field type and every text operator', () => {
    for (const type of FieldType.options) {
      const door = textOperatorDoorVerdict({ type });
      const want = door === 'door-refusal' ? 'unfit' : door === 'deferred' ? 'unjudged' : 'fits';
      for (const op of TEXT_FILTER_OPERATORS) {
        expect(filterOperatorFieldTypeFit(op, { type }), `${op} over ${type}`).toBe(want);
      }
    }
  });

  it('folds the view vocabulary and its aliases onto the same answer', () => {
    expect(filterOperatorFieldTypeFit('contains', { type: 'number' })).toBe('unfit');
    expect(filterOperatorFieldTypeFit('not_contains', { type: 'date' })).toBe('unfit');
    expect(filterOperatorFieldTypeFit('notContains', { type: 'boolean' })).toBe('unfit');
    expect(filterOperatorFieldTypeFit('startsWith', { type: 'currency' })).toBe('unfit');
    expect(filterOperatorFieldTypeFit('contains', { type: 'text' })).toBe('fits');
    expect(filterOperatorFieldTypeFit('contains', { type: 'select' })).toBe('fits');
  });

  it('calls an operator no door judges by type a fit, and an unknown spelling unjudged', () => {
    expect(filterOperatorFieldTypeFit('greater_than', { type: 'boolean' })).toBe('fits');
    expect(filterOperatorFieldTypeFit('equals', { type: 'number' })).toBe('fits');
    expect(filterOperatorFieldTypeFit('$gt', { type: 'text' })).toBe('fits');
    expect(filterOperatorFieldTypeFit('resembles', { type: 'text' })).toBe('unjudged');
    expect(filterOperatorFieldTypeFit('$resembles', { type: 'text' })).toBe('unjudged');
  });

  it('defers a formula whose return type it cannot read', () => {
    expect(filterOperatorFieldTypeFit('contains', { type: 'formula' })).toBe('unjudged');
    expect(filterOperatorFieldTypeFit('contains', { type: 'formula', returnType: 'number' })).toBe('unfit');
  });

  it('judges every canonical view operator (none falls outside the vocabulary)', () => {
    for (const op of VIEW_FILTER_OPERATORS) {
      expect(filterOperatorFieldTypeFit(op, { type: 'text' }), op).not.toBe('unjudged');
    }
  });

  it('holds one row per door, each naming operators the door itself exports', () => {
    expect(FILTER_OPERATOR_FIELD_TYPE_FIT.map((r) => r.door)).toEqual(['filter-text-operator-declared-type']);
    expect(FILTER_OPERATOR_FIELD_TYPE_FIT[0].operators).toBe(TEXT_FILTER_OPERATORS);
    expect(Object.isFrozen(FILTER_OPERATOR_FIELD_TYPE_FIT)).toBe(true);
  });
});
