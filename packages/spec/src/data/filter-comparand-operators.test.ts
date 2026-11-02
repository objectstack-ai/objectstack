// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `isListComparandOperator`, the one piece of the operator split the `data`
 * barrel publishes. A consumer reads it instead of keeping its own copy of
 * the list half, so this file holds it to the enforced grammar: it answers
 * `true` exactly for the operators whose `FieldOperatorsSchema` slot accepts
 * a list, and a list operator added to the grammar reds here.
 */

import { describe, it, expect } from 'vitest';
import { FieldOperatorsSchema, isListComparandOperator } from './index';

describe('isListComparandOperator — the published list half of the operator split', () => {
  const declared = Object.keys(FieldOperatorsSchema.shape);

  it('answers true exactly for every declared operator whose enforced slot takes a list', () => {
    expect(declared.length, 'control: the grammar declares its operators').toBeGreaterThan(10);
    const pair = ['2026-01-01', '2026-12-31'];
    for (const op of declared) {
      const takesList = FieldOperatorsSchema.safeParse({ [op]: pair }).success;
      expect(isListComparandOperator(op), `${op}: the grammar ${takesList ? 'takes' : 'refuses'} a list`).toBe(takesList);
    }
    expect(declared.filter(isListComparandOperator).sort()).toEqual(['$between', '$in', '$nin']);
  });

  it('answers false for a spelling the grammar does not declare', () => {
    for (const op of ['in', 'between', '$and', '$or', '$not', '$IN', '', 'has']) {
      expect(isListComparandOperator(op), op).toBe(false);
    }
  });
});
