// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `DatasetMeasureSchema.polarity` — which direction of change is good news for
 * a measure, so a "lower is better" KPI colours a rising delta as bad (#26602).
 *
 * The key is optional and closed: the three peer values parse and keep their
 * value, an absent key parses exactly as before it existed (no default is
 * materialized, so the renderer's undeclared arm keeps today's colours), any
 * other value is refused at the key, and the near-miss spellings an author
 * reaches for are pointed at it. The wire descriptor (`fields[].polarity`)
 * declares the same vocabulary as the measure, by construction.
 */

import { describe, it, expect } from 'vitest';
import { DatasetMeasurePolarity, DatasetMeasureSchema, DatasetSchema } from './dataset.zod';
import { AnalyticsResultResponseSchema } from '../api/analytics.zod';

const measure = { name: 'turnaround', aggregate: 'avg' as const, field: 'turnaround_days' };

describe('DatasetMeasureSchema.polarity', () => {
  it.each(['higher', 'lower', 'neutral'] as const)('accepts %s and keeps the value', (polarity) => {
    const parsed = DatasetMeasureSchema.safeParse({ ...measure, polarity });
    expect(parsed.success).toBe(true);
    expect(parsed.data?.polarity).toBe(polarity);
  });

  it('the closed vocabulary is exactly higher / lower / neutral', () => {
    expect(DatasetMeasurePolarity.options).toEqual(['higher', 'lower', 'neutral']);
  });

  it('an absent polarity parses exactly as before: no key is materialized', () => {
    const parsed = DatasetMeasureSchema.safeParse(measure);
    expect(parsed.success).toBe(true);
    expect(parsed.data).toEqual(measure);
    expect(Object.prototype.hasOwnProperty.call(parsed.data, 'polarity')).toBe(false);
  });

  it.each(['up', 'down', 'good', 'inverse', true])('refuses %j at the key', (polarity) => {
    const parsed = DatasetMeasureSchema.safeParse({ ...measure, polarity });
    expect(parsed.success).toBe(false);
    expect(parsed.error?.issues.map((i) => [i.code, i.path])).toEqual([['invalid_value', ['polarity']]]);
  });

  it.each(['betterWhen', 'direction'])('points the near-miss `%s` at `polarity`', (key) => {
    const parsed = DatasetMeasureSchema.safeParse({ ...measure, [key]: 'lower' });
    expect(parsed.success).toBe(false);
    const issue = parsed.error?.issues.find((i) => i.code === 'unrecognized_keys');
    expect(issue).toBeDefined();
    expect(issue?.message).toContain('`polarity`');
  });

  it.each(['lowerIsBetter', 'higherIsBetter'])('answers the boolean-flag spelling `%s` with the three values', (key) => {
    const parsed = DatasetMeasureSchema.safeParse({ ...measure, [key]: true });
    expect(parsed.success).toBe(false);
    const issue = parsed.error?.issues.find((i) => i.code === 'unrecognized_keys');
    expect(issue?.message).toContain("polarity: 'lower'");
    expect(issue?.message).toContain("polarity: 'neutral'");
  });

  it('a whole dataset carrying it parses clean', () => {
    const parsed = DatasetSchema.safeParse({
      name: 'approval_turnaround',
      label: 'Approval Turnaround',
      object: 'approval',
      dimensions: [{ name: 'status', field: 'status', type: 'string' }],
      measures: [{ ...measure, polarity: 'lower' }],
    });
    expect(parsed.success).toBe(true);
    expect(parsed.data?.measures[0]?.polarity).toBe('lower');
  });
});

describe('fields[].polarity on the dataset answer', () => {
  const answer = (polarity: unknown) => ({
    success: true,
    data: { rows: [], fields: [{ name: 'turnaround', type: 'number', polarity }] },
  });

  it('declares the measure\'s own vocabulary', () => {
    for (const polarity of DatasetMeasurePolarity.options) {
      const parsed = AnalyticsResultResponseSchema.safeParse(answer(polarity));
      expect(parsed.success, polarity).toBe(true);
      expect(parsed.data?.data.fields[0]?.polarity).toBe(polarity);
    }
    expect(AnalyticsResultResponseSchema.safeParse(answer('up')).success).toBe(false);
  });

  it('is optional: a descriptor without it parses as before', () => {
    const parsed = AnalyticsResultResponseSchema.safeParse({
      success: true,
      data: { rows: [], fields: [{ name: 'turnaround', type: 'number' }] },
    });
    expect(parsed.success).toBe(true);
    expect(Object.prototype.hasOwnProperty.call(parsed.data?.data.fields[0], 'polarity')).toBe(false);
  });
});
