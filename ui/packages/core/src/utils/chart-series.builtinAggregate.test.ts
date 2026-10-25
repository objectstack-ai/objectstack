/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#7258 — a dataset chart's aggregate axis / legend title read the
 * server's English `Count` on a zh console whose category labels were already
 * Chinese (合作中 / 已流失 / 潜在).
 *
 * The literal is not minted here: `buildChartSeries` passes `fields[].label`
 * through verbatim, which objectui#4106 pinned for a REAL author measure
 * (`'Tasks'`), and the analytics service hard-codes `label: 'Count'` on the
 * built-in default measure with no i18n hook. Maintainer ruling B (2026-09-02):
 * the wire grows an OPTIONAL structural discriminator,
 * `fields[].builtinAggregate` (objectstack#14492, populated only on the
 * server-side built-in defaults), and this consumer resolves such a field's
 * label through the locale bundle — keyed by that discriminator, never by the
 * label's text or the field's name (option A, rejected: it would clobber a
 * real author measure called `count`, and text-matching dies the moment the
 * string is anything but that exact English literal).
 *
 * `@object-ui/core` is React-free and i18n-free, so the resolved strings arrive
 * as `ChartSeriesOptions.builtinAggregateLabels` (the `nullCategoryLabel`
 * division of labour); the bundle-reading half is pinned in `@object-ui/i18n`.
 *
 * DIRECTIONS, written before the reverse verification was run:
 *  - every case handing a discriminator AND a labels map is RED before the
 *    change (the series reads the wire `Count`);
 *  - every "verbatim" and "fallback" case is GREEN on both sides — they are the
 *    pre-#7258 behaviour restated, and the whole safety argument of the change
 *    is that a field without the discriminator, or a host without labels, keeps
 *    exactly the label it had;
 *  - `isBuiltinAggregate` / `resolveMeasureLabel` do not exist before it, so
 *    those blocks fail at import.
 */

import { describe, it, expect } from 'vitest';
import {
  BUILTIN_AGGREGATES,
  buildChartSeries,
  isBuiltinAggregate,
  resolveMeasureLabel,
  type BuiltinAggregateLabels,
  type ChartMeasureField,
  type ChartResultField,
} from './chart-series';

/** What `builtinAggregateLabels(tt)` resolves under the zh pack. */
const ZH: BuiltinAggregateLabels = {
  count: '计数',
  count_distinct: '去重计数',
  sum: '求和',
  avg: '平均',
  min: '最小值',
  max: '最大值',
};

/** … and under the en pack. */
const EN: BuiltinAggregateLabels = {
  count: 'Count',
  count_distinct: 'Distinct Count',
  sum: 'Sum',
  avg: 'Average',
  min: 'Min',
  max: 'Max',
};

/** The card's own chart: customers by status, categories already localized. */
const ROWS = [
  { status: '合作中', count: 3 },
  { status: '已流失', count: 1 },
  { status: '潜在', count: 2 },
];

/** The wire shape objectstack#14492 emits for the server's built-in count. */
const BUILTIN_COUNT: ChartMeasureField = { name: 'count', label: 'Count', builtinAggregate: 'count' };

/** objectui#4106's fixture: an author-declared measure, no discriminator. */
const AUTHORED: ChartResultField = { name: 'task_count', label: 'Tasks' };

describe('buildChartSeries — built-in aggregate labels resolve through the locale (objectui#7258)', () => {
  it('zh: the server`s built-in count draws under 计数, not the wire`s English', () => {
    const r = buildChartSeries(ROWS, ['status'], ['count'], [BUILTIN_COUNT], { builtinAggregateLabels: ZH });
    expect(r.series).toEqual([{ dataKey: 'count', label: '计数' }]);
    // Only the LABEL moved: the key, the axis and the rows are what they were.
    expect(r.xAxisKey).toBe('status');
    expect(r.data).toEqual(ROWS);
  });

  it('en: the same wire field draws under Count', () => {
    const r = buildChartSeries(ROWS, ['status'], ['count'], [BUILTIN_COUNT], { builtinAggregateLabels: EN });
    expect(r.series).toEqual([{ dataKey: 'count', label: 'Count' }]);
  });

  it('every member of the closed vocabulary resolves through the map', () => {
    for (const aggregate of BUILTIN_AGGREGATES) {
      const field: ChartMeasureField = { name: `m_${aggregate}`, label: 'server default', builtinAggregate: aggregate };
      const r = buildChartSeries([], ['status'], [field.name], [field], { builtinAggregateLabels: ZH });
      expect(r.series, aggregate).toEqual([{ dataKey: field.name, label: ZH[aggregate] }]);
    }
  });

  it('keeps an author-declared label VERBATIM when the field carries no discriminator (objectui#4106)', () => {
    // Control, green on both sides: a labels map in play changes nothing for a
    // measure the author labelled — `'Tasks'` reaches the legend untouched.
    const r = buildChartSeries([], ['status'], ['task_count'], [AUTHORED], { builtinAggregateLabels: ZH });
    expect(r.series).toEqual([{ dataKey: 'task_count', label: 'Tasks' }]);
  });

  it('never infers from the NAME or the label TEXT — the rejected option A', () => {
    // A real author measure that happens to be called `count` and labelled
    // `Count`, with NO discriminator: it is the author's, and it keeps its own
    // label under a zh map. Only the structural field can switch the lookup on.
    const authoredCount: ChartResultField = { name: 'count', label: 'Count' };
    const r = buildChartSeries(ROWS, ['status'], ['count'], [authoredCount], { builtinAggregateLabels: ZH });
    expect(r.series).toEqual([{ dataKey: 'count', label: 'Count' }]);
  });

  it('resolves each measure independently in a multi-measure chart', () => {
    const r = buildChartSeries(
      [{ status: '合作中', count: 3, task_count: 9 }],
      ['status'],
      ['count', 'task_count'],
      [BUILTIN_COUNT, AUTHORED],
      { builtinAggregateLabels: ZH },
    );
    expect(r.series).toEqual([
      { dataKey: 'count', label: '计数' },
      { dataKey: 'task_count', label: 'Tasks' },
    ]);
  });

  it('falls back to the wire label for a discriminator OUTSIDE the closed vocabulary', () => {
    // An unrecognised value is not "a new aggregate", it is absent: the field
    // renders exactly what it rendered before the discriminator existed.
    const median: ChartMeasureField = { name: 'median_age', label: 'Median', builtinAggregate: 'median' };
    const r = buildChartSeries([], ['status'], ['median_age'], [median], { builtinAggregateLabels: ZH });
    expect(r.series).toEqual([{ dataKey: 'median_age', label: 'Median' }]);
  });

  it('falls back to the NAME when an unknown discriminator comes with no label at all', () => {
    const bare: ChartMeasureField = { name: 'median_age', builtinAggregate: 'median' };
    const r = buildChartSeries([], ['status'], ['median_age'], [bare], { builtinAggregateLabels: ZH });
    expect(r.series).toEqual([{ dataKey: 'median_age', label: 'median_age' }]);
  });

  it('keeps the wire label when the caller resolved NO labels (a provider-less host)', () => {
    // The floor: without a bundle the server's English is still the best
    // string available, and it is exactly the pre-#7258 rendering.
    expect(buildChartSeries([], ['status'], ['count'], [BUILTIN_COUNT]).series).toEqual([
      { dataKey: 'count', label: 'Count' },
    ]);
    expect(buildChartSeries([], ['status'], ['count'], [BUILTIN_COUNT], {}).series).toEqual([
      { dataKey: 'count', label: 'Count' },
    ]);
  });

  it('keeps the wire label when the map lacks that aggregate, or resolves it to the empty string', () => {
    expect(
      buildChartSeries([], ['status'], ['count'], [BUILTIN_COUNT], { builtinAggregateLabels: { sum: '求和' } }).series,
    ).toEqual([{ dataKey: 'count', label: 'Count' }]);
    expect(
      buildChartSeries([], ['status'], ['count'], [BUILTIN_COUNT], { builtinAggregateLabels: { count: '' } }).series,
    ).toEqual([{ dataKey: 'count', label: 'Count' }]);
  });

  it('leaves the pivot branch alone — its series are the second dimension`s VALUES, not measures', () => {
    const rows = [
      { status: '合作中', tier: 'High', count: 5 },
      { status: '合作中', tier: 'Low', count: 3 },
    ];
    const r = buildChartSeries(rows, ['status', 'tier'], ['count'], [BUILTIN_COUNT], { builtinAggregateLabels: ZH });
    expect(r.series).toEqual([
      { dataKey: 'High', label: 'High' },
      { dataKey: 'Low', label: 'Low' },
    ]);
  });
});

describe('resolveMeasureLabel — the resolution order, stated on its own', () => {
  it('locale label → wire label → name', () => {
    expect(resolveMeasureLabel(BUILTIN_COUNT, ZH)).toBe('计数');
    expect(resolveMeasureLabel(BUILTIN_COUNT)).toBe('Count');
    expect(resolveMeasureLabel({ name: 'count', builtinAggregate: 'count' })).toBe('count');
    expect(resolveMeasureLabel(AUTHORED, ZH)).toBe('Tasks');
    expect(resolveMeasureLabel({ name: 'raw' }, ZH)).toBe('raw');
  });
});

describe('isBuiltinAggregate — the closed vocabulary, spelled the spec`s way', () => {
  it('accepts exactly the six wire spellings', () => {
    expect([...BUILTIN_AGGREGATES].sort()).toEqual(['avg', 'count', 'count_distinct', 'max', 'min', 'sum']);
    for (const aggregate of BUILTIN_AGGREGATES) expect(isBuiltinAggregate(aggregate), aggregate).toBe(true);
  });

  it('rejects other spellings, other types, and the bundle key`s camelCase', () => {
    // `countDistinct` is the i18n KEY, not the wire value — the seam maps one
    // to the other, so only one spelling may exist on the wire.
    for (const value of ['COUNT', 'Count', 'countDistinct', 'median', 'first', '', undefined, null, 1, {}]) {
      expect(isBuiltinAggregate(value), String(value)).toBe(false);
    }
  });
});
