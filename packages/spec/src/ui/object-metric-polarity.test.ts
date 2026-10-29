// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `object-metric.polarity` — which direction of change is good news for an
 * inline KPI tile, so a "lower is better" tile colours a rising delta as bad
 * (#27347).
 *
 * The tile aggregates a field, not a dataset measure, so the measure's own
 * `polarity` (#26602) had nothing to attach to. The tile now declares the SAME
 * key, by reference to `DatasetMeasurePolarity`: the three peer values parse
 * and keep their value, an absent key parses exactly as before (no default is
 * materialized, so the renderer's undeclared arm keeps today's colours), any
 * other value is refused at the key, and the near-miss spellings are pointed
 * at it — except the bare `direction`, which on this tile is the static
 * `trend` badge's arrow and gets a prescription naming both keys.
 */

import { describe, it, expect } from 'vitest';
import { ObjectMetricPropsSchema, type ObjectMetricProps } from './component.zod';
import { DatasetMeasurePolarity } from './dataset.zod';

const tile = {
  objectName: 'approval',
  label: 'Avg. turnaround',
  aggregate: { field: 'turnaround_days', function: 'avg' as const },
  compareTo: { kind: 'previousPeriod' as const },
};

describe('ObjectMetricPropsSchema.polarity', () => {
  it.each(['higher', 'lower', 'neutral'] as const)('accepts %s and keeps the value', (polarity) => {
    const parsed = ObjectMetricPropsSchema.safeParse({ ...tile, polarity });
    expect(parsed.success).toBe(true);
    expect(parsed.data?.polarity).toBe(polarity);
  });

  it('is the dataset measure\'s vocabulary, by reference — not a second spelling', () => {
    expect(ObjectMetricPropsSchema.shape.polarity.unwrap()).toBe(DatasetMeasurePolarity);
  });

  it('an absent polarity parses exactly as before: no key is materialized', () => {
    const parsed = ObjectMetricPropsSchema.safeParse(tile);
    expect(parsed.success).toBe(true);
    expect(Object.prototype.hasOwnProperty.call(parsed.data, 'polarity')).toBe(false);
  });

  it.each(['up', 'down', 'good', 'inverse', true])('refuses %j at the key', (polarity) => {
    const parsed = ObjectMetricPropsSchema.safeParse({ ...tile, polarity });
    expect(parsed.success).toBe(false);
    expect(parsed.error?.issues.map((i) => [i.code, i.path])).toEqual([['invalid_value', ['polarity']]]);
  });

  it.each(['betterWhen', 'goodDirection', 'trendDirection'])('points the near-miss `%s` at `polarity`', (key) => {
    const parsed = ObjectMetricPropsSchema.safeParse({ ...tile, [key]: 'lower' });
    expect(parsed.success).toBe(false);
    const issue = parsed.error?.issues.find((i) => i.code === 'unrecognized_keys');
    expect(issue).toBeDefined();
    expect(issue?.message).toContain('`polarity`');
  });

  it('answers a top-level `direction` with BOTH keys it could mean', () => {
    const parsed = ObjectMetricPropsSchema.safeParse({ ...tile, direction: 'lower' });
    expect(parsed.success).toBe(false);
    const issue = parsed.error?.issues.find((i) => i.code === 'unrecognized_keys');
    expect(issue?.message).toContain('`trend`');
    expect(issue?.message).toContain('`polarity`');
  });

  it.each(['lowerIsBetter', 'higherIsBetter'])('answers the boolean-flag spelling `%s` with the three values', (key) => {
    const parsed = ObjectMetricPropsSchema.safeParse({ ...tile, [key]: true });
    expect(parsed.success).toBe(false);
    const issue = parsed.error?.issues.find((i) => i.code === 'unrecognized_keys');
    expect(issue?.message).toContain("polarity: 'lower'");
    expect(issue?.message).toContain("polarity: 'neutral'");
  });

  it('the authored type admits the three values and refuses any other', () => {
    const lower: ObjectMetricProps = { ...tile, polarity: 'lower' };
    // @ts-expect-error — `up` is a trend direction, not a polarity.
    const wrong: ObjectMetricProps = { ...tile, polarity: 'up' };
    expect([lower.polarity, wrong.polarity]).toEqual(['lower', 'up']);
  });
});
