// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import { defaultAggregateFor, emptyGroupValueFor, isIncoherentAggregate, MEASURE_FIELD_TYPES } from './aggregation-policy';

describe('defaultAggregateFor', () => {
  it('SUMs additive amounts', () => {
    expect(defaultAggregateFor('currency')).toBe('sum');
    expect(defaultAggregateFor('number')).toBe('sum');
  });

  it('AVGs rates (percent)', () => {
    expect(defaultAggregateFor('percent')).toBe('avg');
  });

  it('defaults to sum for unknown/undefined types', () => {
    expect(defaultAggregateFor(undefined)).toBe('sum');
    expect(defaultAggregateFor('text')).toBe('sum');
  });
});

describe('isIncoherentAggregate', () => {
  it('counts and sums over an empty group are 0; avg/min/max stay undefined', () => {
    // A group every row of which a measure filter excluded is a MEASURED zero
    // for a count or a sum — not missing data. Averaging nothing is genuinely
    // unanswerable and must not be flattened to a zero that reads as real.
    expect(emptyGroupValueFor('count')).toBe(0);
    expect(emptyGroupValueFor('count_distinct')).toBe(0);
    expect(emptyGroupValueFor('sum')).toBe(0);
    expect(emptyGroupValueFor('avg')).toBeUndefined();
    expect(emptyGroupValueFor('min')).toBeUndefined();
    expect(emptyGroupValueFor('max')).toBeUndefined();
    expect(emptyGroupValueFor(undefined)).toBeUndefined();
  });

  it('flags SUM and count_distinct of a percentage', () => {
    expect(isIncoherentAggregate('sum', 'percent')).toBe(true);
    expect(isIncoherentAggregate('count_distinct', 'percent')).toBe(true);
  });

  it('allows AVG / min / max / count of a percentage', () => {
    expect(isIncoherentAggregate('avg', 'percent')).toBe(false);
    expect(isIncoherentAggregate('min', 'percent')).toBe(false);
    expect(isIncoherentAggregate('max', 'percent')).toBe(false);
    expect(isIncoherentAggregate('count', 'percent')).toBe(false);
  });

  it('allows SUM of additive amounts', () => {
    expect(isIncoherentAggregate('sum', 'currency')).toBe(false);
    expect(isIncoherentAggregate('sum', 'number')).toBe(false);
  });

  it('never false-positives on an unknown field type', () => {
    expect(isIncoherentAggregate('sum', undefined)).toBe(false);
    expect(isIncoherentAggregate('sum', 'text')).toBe(false);
  });
});

describe('MEASURE_FIELD_TYPES', () => {
  it('covers the numeric measure-backing field types', () => {
    expect([...MEASURE_FIELD_TYPES].sort()).toEqual(['currency', 'number', 'percent']);
  });
});
