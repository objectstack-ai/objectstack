/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#10516 — `normalizeChartSchema` keeps an `xAxis` object whenever it
 * carries ANY declared presentation key, not only `format`, `title` or
 * `showGridLines`.
 *
 * The x-axis gate used to name three keys by hand. An axis carrying only
 * `min` / `max` / `stepSize` / `logarithmic` / `position` beside its `field`
 * failed it, so the whole object was dropped and only `xAxisKey` survived: a
 * scatter's authored x domain, tick spacing and scale never reached its
 * `XAxis`, and nothing said so.
 *
 * ## The key set is the spec's, read off the installed spec
 *
 * The presentation keys are `ChartAxisSchema`'s keys minus `field`, which is
 * the one DATA key on an axis and is hoisted to `xAxisKey`. The sibling file
 * `normalizeChartSchema.specAxisKeys-7690.test.ts` ties `normalizeAxis`' read
 * set to that same list in both directions, so a key the spec adds joins the
 * per-key pins below on the next install, with no edit here.
 *
 * ## Controls
 *
 *   - `title` — kept before the fix and after it: the lit control that this
 *     read observes a surviving object at all (`format` and `showGridLines`,
 *     the gate's other two hand-named keys, behave the same way);
 *   - `{ field }` alone — no presentation key, so still no `xAxis`;
 *   - a value `normalizeAxis` refuses is not a presentation key, so the gate
 *     reads the NORMALIZED axis, not the author's raw object;
 *   - a falsy declared value (`min: 0`, `logarithmic: false`,
 *     `showGridLines: false`) still counts: the gate asks which keys survived,
 *     never how truthy their values are.
 */

import { describe, it, expect } from 'vitest';
import { ChartAxisSchema as SpecChartAxisSchema } from '@objectstack/spec/ui';
import { normalizeChartSchema } from './normalizeChartSchema';

/** Every spec axis key except `field`, the data key the x axis hoists to `xAxisKey`. */
const PRESENTATION_KEYS = Object.keys(SpecChartAxisSchema.shape)
  .filter((key) => key !== 'field')
  .sort();

/** One value per presentation key that `normalizeAxis` admits. */
const SAMPLE: Record<string, unknown> = {
  title: 'Progress',
  format: '0.0%',
  min: 0,
  max: 200,
  stepSize: 50,
  showGridLines: true,
  position: 'top',
  logarithmic: true,
};

const normalizeX = (xAxis: Record<string, unknown>) =>
  normalizeChartSchema({ type: 'chart', chartType: 'scatter', xAxis });

describe('objectui#10516 — the x-axis object survives on any declared presentation key', () => {
  it('the sample covers exactly the spec presentation keys — a new spec key fails here first', () => {
    expect(Object.keys(SAMPLE).sort()).toEqual(PRESENTATION_KEYS);
  });

  it.each(PRESENTATION_KEYS)('`%s` alone beside `field` keeps the x-axis object', (key) => {
    const axis = { field: 'progress', [key]: SAMPLE[key] };
    const out = normalizeX(axis);
    expect(out.xAxis, `an xAxis carrying only \`${key}\` beside its field was dropped`).toEqual(axis);
    expect(out.xAxisKey).toBe('progress');
  });

  it('the card reproduction — min, max, stepSize, logarithmic and position together, with no title', () => {
    const axis = { field: 'progress', min: 0, max: 200, stepSize: 50, logarithmic: true, position: 'top' };
    const out = normalizeX(axis);
    expect(out.xAxis).toEqual(axis);
    expect(out.xAxisKey).toBe('progress');
  });

  it('a falsy declared value still counts — the gate reads which keys survived, not their truthiness', () => {
    for (const axis of [
      { field: 'progress', min: 0 },
      { field: 'progress', logarithmic: false },
      { field: 'progress', showGridLines: false },
    ]) {
      expect(normalizeX(axis).xAxis).toEqual(axis);
    }
  });

  it('(control) `field` alone carries no presentation key — no xAxis, and the column still lands on xAxisKey', () => {
    const out = normalizeX({ field: 'progress' });
    expect(out.xAxis).toBeUndefined();
    expect(out.xAxisKey).toBe('progress');
  });

  it('(control) a value normalizeAxis refuses is not a presentation key', () => {
    // A non-positive `stepSize`, a non-numeric `min` and an undeclared
    // `position` are each dropped by `normalizeAxis`; none keeps the object.
    const out = normalizeX({ field: 'progress', stepSize: -5, min: 'zero', position: 'middle' });
    expect(out.xAxis).toBeUndefined();
    expect(out.xAxisKey).toBe('progress');
  });
});
