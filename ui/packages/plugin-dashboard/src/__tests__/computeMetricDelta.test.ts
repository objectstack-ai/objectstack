/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { describe, it, expect } from 'vitest';
import { computeMetricDelta, formatMetricDeltaPercent } from '../utils';

describe('computeMetricDelta', () => {
  it('returns null when previousValue is missing', () => {
    expect(computeMetricDelta(100, null)).toBeNull();
    expect(computeMetricDelta(100, undefined)).toBeNull();
  });

  it('returns null when current is not a finite number', () => {
    expect(computeMetricDelta(null, 100)).toBeNull();
    expect(computeMetricDelta(undefined, 100)).toBeNull();
    expect(computeMetricDelta(NaN, 100)).toBeNull();
    expect(computeMetricDelta(Infinity, 100)).toBeNull();
  });

  it('computes positive delta', () => {
    expect(computeMetricDelta(120, 100)).toEqual({ value: 20, direction: 'up' });
  });

  it('computes negative delta', () => {
    expect(computeMetricDelta(80, 100)).toEqual({ value: 20, direction: 'down' });
  });

  it('returns neutral on equal values', () => {
    expect(computeMetricDelta(50, 50)).toEqual({ value: 0, direction: 'neutral' });
  });

  describe('previousValue === 0', () => {
    it('returns neutral when both are 0', () => {
      expect(computeMetricDelta(0, 0)).toEqual({ value: 0, direction: 'neutral' });
    });
    // objectui#12677 — a percent change from zero is undefined: 0 → 42 is not
    // "+100%". The delta keeps its direction and states no percentage.
    it('returns up with NO percentage when current is positive', () => {
      expect(computeMetricDelta(42, 0)).toEqual({ value: null, direction: 'up' });
    });
    it('returns down with NO percentage when current is negative', () => {
      expect(computeMetricDelta(-42, 0)).toEqual({ value: null, direction: 'down' });
    });
  });

  describe('negative previousValue', () => {
    it('uses abs(previous) as denominator so improvement reads as positive', () => {
      // -10 → -5 : (delta = 5 / 10 = 50% up)
      expect(computeMetricDelta(-5, -10)).toEqual({ value: 50, direction: 'up' });
    });

    it('worsening reads as negative', () => {
      // -10 → -15: (delta = -5 / 10 = 50% down)
      expect(computeMetricDelta(-15, -10)).toEqual({ value: 50, direction: 'down' });
    });
  });
});

describe('formatMetricDeltaPercent (objectui#12677)', () => {
  it('draws a defined percentage with its % sign', () => {
    expect(formatMetricDeltaPercent(20)).toBe('20%');
    expect(formatMetricDeltaPercent(0)).toBe('0%');
  });
  it('draws an em dash, and no number or %, when there is no percentage', () => {
    expect(formatMetricDeltaPercent(null)).toBe('\u2014');
  });
});
