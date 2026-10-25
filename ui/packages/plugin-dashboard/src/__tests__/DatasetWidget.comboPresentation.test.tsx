// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#11315 — what a `combo` widget renders on the DATASET path, now that
 * a dashboard widget's `chartConfig` carries no `series` / `xAxis` / `yAxis`.
 *
 * ## History
 *
 * objectui#4229 measured a widget authoring the spec's combo shape
 * (`series[].type` + `series[].yAxis` + two `yAxis` entries) and got grouped
 * bars. Two halves caused it: `CHART_TYPE_MAP` had no `combo` entry, and the
 * widget forwarded none of `series` / `xAxis` / `yAxis`. #4229 fixed both, the
 * second by merging the keys' PRESENTATION half (per-series mark and axis
 * binding, axis scale and chrome) onto the dataset-derived bindings, through
 * `@object-ui/core`'s `mergeAuthoredPresentation` (since removed by
 * objectui#11372). This file pinned that merge.
 *
 * `@objectstack/spec` 17.5.0 then gave the dashboard widget its own chart
 * config carrier, `DashboardWidgetChartConfigSchema`, which refuses `type`,
 * `xAxis`, `yAxis` and `series` at parse (ADR-0021 · ADR-0049 D2; maintainer
 * ruling 2026-09-12, decision batch #121 item 1). The dataset owns a
 * dataset-bound chart's structure, presentation included: an authored axis
 * `field` had been a live channel that could re-point a dataset-bound series at
 * another column. The spec's liveness ledger records the cost by name: the
 * per-series mark that made a dataset-bound combo authorable goes with the key.
 *
 * ## What is pinned now
 *
 *  - The first half of #4229 survives: a `combo` widget resolves the `combo`
 *    family instead of falling through to `bar`.
 *  - The second half is retired, and these are its REFUSAL pins. A stored widget
 *    that still carries the combo shape (nothing parses it on the way to this
 *    renderer) gets the dataset's derivation: one series per measure with no
 *    authored mark or axis, and no authored axes on the chart schema.
 *  - The comparison overlay carries no mark or axis either: there is no merged
 *    one to copy.
 *
 * The CONTROL for the other carrier lives with the renderer it is about:
 * `packages/plugin-charts/src/ObjectChart.inlineComboSeries-11315.test.tsx`
 * pins that the react `ObjectChart` tier, where the spec keeps the four keys
 * authorable, still draws an authored `series` as a combo.
 *
 * ## Where these assertions stop
 *
 * At the shape handed to the renderer, read through `normalizeChartSchema`, the
 * ONE translation layer `ChartRenderer` puts between the schema and
 * `AdvancedChartImpl` (#2880 S1). They do not count recharts marks: `recharts`
 * resolves inside `plugin-charts` alone, so a `vi.mock('recharts')` in THIS
 * package cannot resolve the specifier (`DatasetWidget.chartConfig.dom.test.tsx`
 * records the same constraint).
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, waitFor } from '@testing-library/react';
// The renderer's own translation layer, imported read-only so these assertions
// are made against what `AdvancedChartImpl` receives rather than a restatement
// of it. `plugin-charts` is a devDependency of this package, and this is its
// PUBLISHED root entry — the same module `ChartRenderer` calls, reached the way
// any consumer outside this repo would reach it (objectui#4529).
import { normalizeChartSchema } from '@object-ui/plugin-charts';

let lastChartSchema: any = null;

vi.mock('@object-ui/react', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  SchemaRenderer: (props: any) => {
    lastChartSchema = props.schema;
    return null;
  },
}));

import { DatasetWidget } from '../DatasetWidget';

afterEach(() => {
  cleanup();
  lastChartSchema = null;
});

/** #4229's fixture: a count and a percentage. */
const rows = [
  { assignee: 'ann', task_count: 12, avg_progress: 64 },
  { assignee: 'bob', task_count: 7, avg_progress: 88 },
];

const fields = [
  { name: 'assignee', label: 'Assignee' },
  { name: 'task_count', label: 'Tasks' },
  { name: 'avg_progress', label: 'Avg progress' },
];

/** `combo_count_vs_progress` as #4229's QA run authored it — retired since spec 17.5.0. */
const retiredComboChartConfig = {
  series: [
    { name: 'task_count', type: 'bar', yAxis: 'left' },
    { name: 'avg_progress', type: 'line', yAxis: 'right' },
  ],
  xAxis: { field: 'assignee', title: 'By assignee' },
  yAxis: [
    { field: 'task_count', title: 'Tasks' },
    { field: 'avg_progress', title: 'Avg progress', position: 'right', min: 0, max: 100 },
  ],
};

const renderWidget = async (widget: Record<string, unknown>, src?: { queryDataset: unknown }) => {
  render(<DatasetWidget widget={widget} dataSource={src ?? { queryDataset: vi.fn(async () => ({ rows, fields })) }} />);
  await waitFor(() => expect(lastChartSchema).not.toBeNull());
};

const comboWidget = (overrides: Record<string, unknown> = {}) => ({
  type: 'combo',
  dataset: 'tasks',
  dimensions: ['assignee'],
  values: ['task_count', 'avg_progress'],
  ...overrides,
});

/** The dataset's own derivation for `comboWidget()`, as the widget emits it. */
const DERIVED_SERIES = [
  { dataKey: 'task_count', label: 'Tasks' },
  { dataKey: 'avg_progress', label: 'Avg progress' },
];

describe('DatasetWidget — a `combo` widget is still a combo (#4229, first half)', () => {
  // `combo` is a `ChartTypeSchema` member since spec 17.0.0-rc.1 and the
  // renderer draws it distinctly, so it maps to itself instead of falling
  // through the `?? 'bar'` default that produced #4229's grouped bars.
  it('resolves the `combo` family instead of falling through to bar', async () => {
    await renderWidget(comboWidget());
    expect(lastChartSchema.chartType).toBe('combo');
    expect(normalizeChartSchema(lastChartSchema).chartType).toBe('combo');
    // One series per selected measure, derived from the dataset.
    expect(lastChartSchema.series).toEqual(DERIVED_SERIES);
  });
});

describe('DatasetWidget — the retired combo shape is not read (objectui#11315)', () => {
  // The control: the same widget with no `chartConfig` at all. Every refusal
  // below compares against it, so "nothing authored reached the renderer" is a
  // measured equality, not an absence that a missing render would also satisfy.
  it('emits the derived series and no authored axes when nothing is authored', async () => {
    await renderWidget(comboWidget());
    expect(lastChartSchema.series).toEqual(DERIVED_SERIES);
    expect('xAxis' in lastChartSchema).toBe(false);
    expect('yAxis' in lastChartSchema).toBe(false);
    expect(lastChartSchema.xAxisKey).toBe('assignee');
  });

  it('merges no authored per-series mark or axis binding onto the derived series', async () => {
    await renderWidget(comboWidget({ chartConfig: retiredComboChartConfig }));
    // Byte-identical to the control: no `chartType`, no `yAxis`, no label from
    // the authored entry.
    expect(lastChartSchema.series).toEqual(DERIVED_SERIES);
    expect(lastChartSchema.series.some((s: any) => 'chartType' in s || 'yAxis' in s)).toBe(false);
  });

  it('spreads no authored axis onto the chart schema, so no second y-axis is declared', async () => {
    // The control render first: what the renderer is handed for the axes when
    // nothing is authored.
    await renderWidget(comboWidget());
    const control = normalizeChartSchema(lastChartSchema);
    cleanup();
    lastChartSchema = null;

    await renderWidget(comboWidget({ chartConfig: retiredComboChartConfig }));
    expect('xAxis' in lastChartSchema).toBe(false);
    expect('yAxis' in lastChartSchema).toBe(false);
    // Two authored `yAxis` entries no longer declare two axes: the renderer is
    // handed exactly the control's axes.
    const retired = normalizeChartSchema(lastChartSchema);
    expect(retired.yAxes).toEqual(control.yAxes);
    expect(retired.xAxisKey).toBe(control.xAxisKey);
    // The derived category binding is untouched by the authored `xAxis.field`.
    expect(lastChartSchema.xAxisKey).toBe('assignee');
  });

  it('a bar widget authoring one line series stays a plain bar chart', async () => {
    // Before 17.5.0 this was the dataset path's "derived combo" (#2945): one
    // `series[].type: 'line'` turned a bar widget into a combo. The key is
    // retired on this carrier, so the widget's own family is the whole answer.
    await renderWidget({
      type: 'bar',
      dataset: 'tasks',
      dimensions: ['assignee'],
      values: ['task_count', 'avg_progress'],
      chartConfig: { series: [{ name: 'avg_progress', type: 'line', yAxis: 'right' }] },
    });
    expect(lastChartSchema.chartType).toBe('bar');
    expect(normalizeChartSchema(lastChartSchema).chartType).toBe('bar');
    expect(lastChartSchema.series).toEqual(DERIVED_SERIES);
  });

  // The appearance keys this carrier keeps still lower beside the refusal: the
  // retirement took the structure keys, not the chart config.
  it('still lowers the chrome a combo widget authors beside the retired keys', async () => {
    await renderWidget(
      comboWidget({ chartConfig: { ...retiredComboChartConfig, title: 'Tasks vs progress', showLegend: false } }),
    );
    expect(lastChartSchema.title).toBe('Tasks vs progress');
    expect(lastChartSchema.showLegend).toBe(false);
    expect(lastChartSchema.series).toEqual(DERIVED_SERIES);
  });
});

describe('DatasetWidget — a comparison overlay carries no merged mark (objectui#11315)', () => {
  // `compareTo` adds one overlay series per compared measure. Until 17.5.0 each
  // overlay copied its primary's MERGED mark and axis (#4229). With no authored
  // series there is no merged mark to copy, so the overlays and their primaries
  // alike carry none, and the renderer decides every mark.
  it('appends one overlay per measure, with no mark or axis of its own', async () => {
    const src = {
      queryDataset: vi.fn(async () => ({
        rows: rows.map((r) => ({ ...r, task_count__compare: 9, avg_progress__compare: 55 })),
        fields,
      })),
    };
    await renderWidget(comboWidget({ compareTo: { kind: 'previousYear' }, chartConfig: retiredComboChartConfig }), src);

    const series = lastChartSchema.series;
    expect(series.map((s: any) => [s.dataKey, s.variant])).toEqual([
      ['task_count', 'current'],
      ['avg_progress', 'current'],
      ['task_count__compare', 'comparison'],
      ['avg_progress__compare', 'comparison'],
    ]);
    expect(series.some((s: any) => 'chartType' in s || 'yAxis' in s || 'stack' in s)).toBe(false);
  });
});
