/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#7690 — the renderer reads EXACTLY the axis keys the protocol declares.
 *
 * `@object-ui/types` now declares `ChartSchema.xAxis` / `ChartSchema.yAxis` as
 * `@objectstack/spec`'s `ChartAxisSchema`, by reference (ruling 5809510046,
 * branch 2: "declare exactly the keys the renderer reads"). That ruling holds
 * only while the two key sets are the same set, and they live in two packages
 * that are edited separately — the spec's schema on one side, `normalizeAxis`
 * in `./normalizeChartSchema.ts` on the other. This file is the tie, in both
 * directions, with the spec's key list read off the installed spec:
 *
 *   - DECLARED ⊆ READ — every spec axis key, written alone beside `field`,
 *     reaches the normalized axis. A key the spec adds and the renderer does not
 *     read fails here, instead of shipping as declared-but-inert (ADR-0049);
 *   - READ ⊆ DECLARED — a normalized axis carries no key the spec does not
 *     declare, so the renderer cannot grow an axis dialect the validator refuses.
 *
 * It goes through the y-axis list, the arm on which the normalizer forwards
 * every key it reads. `field` on the x-axis object answers the category column
 * instead (`xAxisKey` in the output), which (c) pins.
 */

import { describe, it, expect } from 'vitest';
import { ChartAxisSchema as SpecChartAxisSchema } from '@objectstack/spec/ui';
import { normalizeChartSchema } from './normalizeChartSchema';

const SPEC_AXIS_KEYS = Object.keys(SpecChartAxisSchema.shape).sort();

/** One value per spec key that the read admits and that differs from any renderer default. */
const SAMPLE: Record<string, unknown> = {
  field: 'total',
  title: 'Total',
  format: '$0,0',
  min: 0,
  max: 100,
  stepSize: 10,
  showGridLines: false,
  position: 'right',
  logarithmic: true,
};

describe('objectui#7690 — the axis keys the renderer reads are the spec\'s', () => {
  it('(a) the sample covers exactly the spec axis keys — a new spec key fails here first', () => {
    expect(Object.keys(SAMPLE).sort()).toEqual(SPEC_AXIS_KEYS);
  });

  it.each(SPEC_AXIS_KEYS)('(b) DECLARED ⊆ READ — `%s` reaches the normalized y axis', (key) => {
    const axis = { field: 'total', [key]: SAMPLE[key] };
    const out = normalizeChartSchema({ type: 'chart', chartType: 'bar', yAxis: [axis] });
    expect(out.yAxes?.[0]).toHaveProperty(key, SAMPLE[key]);
  });

  it('(b) READ ⊆ DECLARED — a normalized axis carries no key the spec does not declare', () => {
    const out = normalizeChartSchema({ type: 'chart', chartType: 'bar', yAxis: [SAMPLE] });
    expect(Object.keys(out.yAxes?.[0] ?? {}).sort()).toEqual(SPEC_AXIS_KEYS);
  });

  it('(c) the x-axis object\'s `field` answers the category column, and `xAxisKey` wins over it', () => {
    expect(normalizeChartSchema({ xAxis: { field: 'month', title: 'Month' } }).xAxisKey).toBe('month');
    expect(normalizeChartSchema({ xAxisKey: 'week', xAxis: { field: 'month', title: 'Month' } }).xAxisKey).toBe('week');
  });
});
