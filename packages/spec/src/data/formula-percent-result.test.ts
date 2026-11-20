// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #35047 — a formula field declares a percent result.
 *
 * `FieldSchema.returnType` gains `percent`, mirroring how #22727 added
 * `currency`: the result reads as a `percent` field reads its stored value,
 * one convention and never a second one. So the assertions below compare a
 * percent formula against a percent field rather than restating the rule.
 */

import { describe, it, expect } from 'vitest';

import { FieldSchema } from './field.zod';
import { ObjectSchema } from './object.zod';
import { percentScaleOf } from './percent-scale';
import { resolveFieldScale } from './field-scale';
import { FORMULA_RETURN_TYPE_AS_FIELD_TYPE } from './filter-text-operator-declared-type';
import { numberComparandFieldVerdict } from './filter-number-comparand-declared-type';
import { isAggregateCompatibleWithFieldType } from './aggregate-field-type-compatibility';

function percentFormula(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    name: 'budget_used_pct',
    label: 'Budget Used',
    type: 'formula',
    expression: 'record.spent / record.budget',
    returnType: 'percent',
    ...extra,
  };
}

describe('a formula declares a percent result', () => {
  it('`returnType: percent` parses, with a `scale`, a `max` and a `percentDisplay` as a percent field takes them', () => {
    for (const extra of [{}, { scale: 1 }, { max: 100 }, { percentDisplay: 'plain' }]) {
      const r = FieldSchema.safeParse(percentFormula(extra));
      expect(r.success, JSON.stringify(r.success ? extra : r.error.issues)).toBe(true);
      if (r.success) expect(r.data.returnType).toBe('percent');
    }
  });

  it('a percent formula over two amounts parses inside a legal object', () => {
    const r = ObjectSchema.safeParse({
      name: 'project',
      label: 'Project',
      fields: {
        budget: { name: 'budget', label: 'Budget', type: 'number' },
        spent: { name: 'spent', label: 'Spent', type: 'number' },
        budget_used_pct: percentFormula({ scale: 1 }),
      },
    });
    expect(r.success, r.success ? '' : JSON.stringify(r.error.issues)).toBe(true);
  });

  it('is judged as the `percent` field it reads like — the shared return-type map', () => {
    expect(FORMULA_RETURN_TYPE_AS_FIELD_TYPE.get('percent')).toBe('percent');
    expect(numberComparandFieldVerdict({ type: 'formula', returnType: 'percent' }))
      .toBe(numberComparandFieldVerdict({ type: 'percent' }));
  });

  it('reads with the percent field\'s convention: the storage and the absent width are the percent field\'s', () => {
    // The faces hand a percent formula to the percent field's own resolvers
    // as `percent`; these are the answers they get.
    expect(percentScaleOf({ type: 'percent' })).toBe('fraction');
    expect(percentScaleOf({ type: 'percent', max: 100 })).toBe('whole');
    expect(resolveFieldScale({ type: 'percent' })).toBe(0);
    expect(resolveFieldScale({ type: 'percent', scale: 1 })).toBe(1);
  });

  it('is refused by every value-reading aggregate, as every formula is, whatever it returns', () => {
    // A formula is computed on read and has no column: the aggregate table
    // keys on `formula`, not on the declared result.
    for (const fn of ['sum', 'avg', 'min', 'max'] as const) {
      expect(isAggregateCompatibleWithFieldType(fn, 'formula'), fn).toBe(false);
    }
    expect(isAggregateCompatibleWithFieldType('count', 'formula')).toBe(true);
  });
});

describe('CONTROL — the widening adds exactly `percent`', () => {
  it('the five earlier members are still declared', () => {
    const members = (FieldSchema.shape.returnType.unwrap().options as readonly string[]).slice().sort();
    expect(members).toEqual(['boolean', 'currency', 'date', 'number', 'percent', 'text']);
  });

  it('a value outside the six is still refused', () => {
    expect(FieldSchema.safeParse(percentFormula({ returnType: 'ratio' })).success).toBe(false);
  });
});
