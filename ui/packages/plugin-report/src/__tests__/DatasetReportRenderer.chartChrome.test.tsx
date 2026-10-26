// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#4877 — a report's embedded chart dropped every authored chrome key.
 *
 * `DatasetReportChart` forwarded exactly six keys to the registered chart
 * component — `chartType`, `data`, `height`, `isAnimationActive`, `series`,
 * `xAxisKey`. Everything else `ReportChartSchema` declares as authorable was
 * inert metadata: the author writes it, the schema accepts it, nothing reads
 * it. `showLegend` was the sharpest case because it is not merely ignored but
 * INVERTED in effect — `AdvancedChartImpl` computes
 * `legendVisible = showLegend !== false`, so an absent value means the legend is
 * ON and an author's explicit `false` drew one anyway.
 *
 * The fix lowers the same whitelist the dashboard already used
 * (`chartConfigPresentation`) plus the series half of #4229's split
 * (`mergeAuthoredSeries`), both moved to `@object-ui/core` so the two surfaces
 * lower ONE vocabulary once.
 *
 * DIRECTIONS, written before the reverse verification was run. The mutation is
 * to stop forwarding — drop the `...chrome` spread and hand
 * `series: [{ dataKey: yAxis, label: measureLabel }]` again:
 *
 * Measured: 11 red / 8 green, matching the prediction case for case.
 *
 *  - every "reaches the chart component" case goes RED, and the `showLegend`
 *    one goes red in the card's own way: the key is `undefined`, i.e. absent,
 *    i.e. a legend;
 *  - the TITLE cases stay GREEN on both sides. `title` is deliberately NOT
 *    forwarded — this renderer paints it as its own `h3` — so those pin a
 *    decision, not a change, and would go red only if a future edit spread the
 *    chart config wholesale and drew the title twice;
 *  - the `aria` case likewise stays GREEN on both sides: it is the one declared
 *    key with no reader anywhere on this path, so it is deliberately not
 *    lowered and the assertion records that as a decision.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { ComponentRegistry } from '@object-ui/core';
import { DatasetReportRenderer } from '../DatasetReportRenderer';

let captured: { schema: Record<string, any> } | null = null;

beforeEach(() => {
  captured = null;
  ComponentRegistry.register('chart', (props: any) => {
    captured = props;
    return null;
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const RESULT = {
  rows: [
    { stage: 'Qualification', amount: 120 },
    { stage: 'Negotiation', amount: 80 },
  ],
  fields: [
    { name: 'stage', type: 'text', label: 'Stage' },
    { name: 'amount', type: 'number', label: 'Amount' },
  ],
};

const sourceOf = (result: unknown) => ({ queryDataset: vi.fn(async () => result) });

const BASE = {
  name: 'pipeline_by_stage',
  type: 'tabular',
  dataset: 'pipeline_metrics',
  rows: ['stage'],
  values: ['amount'],
};

/** The schema the registered chart component was handed for this `chart` block. */
async function chartSchema(chart: Record<string, unknown>) {
  render(
    <DatasetReportRenderer
      report={{ ...BASE, chart } as never}
      dataSource={sourceOf(RESULT) as never}
    />,
  );
  await waitFor(() => expect(captured?.schema?.data?.length).toBe(2));
  return captured!.schema;
}

const CHART = { type: 'bar', xAxis: 'stage', yAxis: 'amount' } as const;

describe('report chart chrome — the declared-but-unread set now reaches the renderer (objectui#4877)', () => {
  it('`showLegend: false` arrives as `false`, not as absent', async () => {
    // The card's headline. Absent is not a neutral value here: the renderer
    // reads `showLegend !== false`, so dropping the key turned the author's
    // "no legend" into "legend".
    const schema = await chartSchema({ ...CHART, showLegend: false });
    expect(schema.showLegend).toBe(false);
  });

  it('`showLegend: true` also travels — the author said it, not the default', async () => {
    const schema = await chartSchema({ ...CHART, showLegend: true });
    expect(schema.showLegend).toBe(true);
  });

  it('`showDataLabels` travels', async () => {
    const schema = await chartSchema({ ...CHART, showDataLabels: true });
    expect(schema.showDataLabels).toBe(true);
  });

  it('a `colors` ARRAY travels as the positional palette', async () => {
    const schema = await chartSchema({ ...CHART, colors: ['#f00', '#0f0'] });
    expect(schema.colors).toEqual(['#f00', '#0f0']);
    // The two arms reach the renderer through two DIFFERENT props; an array is
    // not a per-category map and must not become one.
    expect(schema.categoryColors).toBeUndefined();
  });

  it('a `colors` RECORD travels as the per-category map', async () => {
    // `ReportChartSchema.colors` is `string[] | Record<string, string>`, the
    // same overload the dashboard's split already rules on.
    const schema = await chartSchema({ ...CHART, colors: { Qualification: '#f00' } });
    expect(schema.categoryColors).toEqual({ Qualification: '#f00' });
    expect(schema.colors).toBeUndefined();
  });

  it('`subtitle` and `description` travel', async () => {
    const schema = await chartSchema({
      ...CHART,
      subtitle: 'Open pipeline only',
      description: 'Amount by stage for the current quarter',
    });
    expect(schema.subtitle).toBe('Open pipeline only');
    expect(schema.description).toBe('Amount by stage for the current quarter');
  });

  it('`annotations` and `interaction` travel', async () => {
    const annotations = [{ type: 'line', axis: 'y', value: 100, label: 'Target' }];
    const schema = await chartSchema({ ...CHART, annotations, interaction: { brush: true } });
    expect(schema.annotations).toEqual(annotations);
    expect(schema.interaction).toEqual({ brush: true });
  });

  it('an authored `height` wins over the renderer default', async () => {
    const schema = await chartSchema({ ...CHART, height: 420 });
    expect(schema.height).toBe(420);
  });

  it('a non-positive `height` falls back to the default instead of collapsing the plot', async () => {
    // The whitelist drops it, which leaves the 280 default standing — an
    // invisible plot is a worse answer than a default-sized one.
    const schema = await chartSchema({ ...CHART, height: 0 });
    expect(schema.height).toBe(280);
  });

  it('a chart authoring NO chrome keeps the renderer defaults', async () => {
    // Byte-for-byte the pre-change forwarding for the overwhelming majority of
    // stored reports: nothing authored, nothing added.
    const schema = await chartSchema({ ...CHART });
    for (const key of [
      'showLegend',
      'showDataLabels',
      'colors',
      'categoryColors',
      'subtitle',
      'description',
      'annotations',
      'interaction',
    ]) {
      expect(schema[key]).toBeUndefined();
    }
    expect(schema.height).toBe(280);
  });
});

describe('report chart chrome — `title` stays the report renderer’s own (decision, not change)', () => {
  it('the chart component is NOT handed a title', async () => {
    // Green before and after. This renderer paints the title as an `h3` above
    // the plot; forwarding it as well would draw a SECOND one inside the
    // chart's own frame.
    const schema = await chartSchema({ ...CHART, title: 'Pipeline by stage' });
    expect(schema.title).toBeUndefined();
  });

  it('and the report still paints it itself', async () => {
    render(
      <DatasetReportRenderer
        report={{ ...BASE, chart: { ...CHART, title: 'Pipeline by stage' } } as never}
        dataSource={sourceOf(RESULT) as never}
      />,
    );
    const heading = await screen.findByRole('heading', { name: 'Pipeline by stage' });
    expect(heading).toBeInTheDocument();
  });
});

describe('report chart chrome — `aria` is deliberately not lowered', () => {
  it('does not reach the chart component under any spelling', async () => {
    // Green before and after, and recorded on purpose: `aria` is the one key
    // `ReportChartSchema` declares that NOTHING on this path reads —
    // `AdvancedChartImpl` has no `aria` prop, and this renderer hands the
    // component a schema directly rather than through `SchemaRenderer`'s flat
    // ARIA injection. Forwarding it would move declared-but-unread one layer
    // down, which is the very failure this card removes.
    const schema = await chartSchema({ ...CHART, aria: { ariaLabel: 'Pipeline chart' } });
    expect(schema.aria).toBeUndefined();
    expect(schema.ariaLabel).toBeUndefined();
  });
});

describe('report chart series presentation — the #4229 split, series half (objectui#4877)', () => {
  it('every authored presentation key survives onto the plotted series', async () => {
    const schema = await chartSchema({
      ...CHART,
      series: [
        {
          name: 'amount',
          type: 'line',
          color: '#f00',
          stack: 'a',
          yAxis: 'right',
          dashArray: '4 2',
          opacity: 0.5,
          variant: 'comparison',
        },
      ],
    });
    expect(schema.series[0]).toMatchObject({
      dataKey: 'amount',
      chartType: 'line',
      color: '#f00',
      stack: 'a',
      yAxis: 'right',
      dashArray: '4 2',
      opacity: 0.5,
      variant: 'comparison',
    });
  });

  it('MEMBERSHIP stays with the dataset — an entry naming another measure is ignored', async () => {
    // An author cannot add, remove or re-point a series from the chart block;
    // `values` / `yAxis` decide what is plotted.
    const schema = await chartSchema({
      ...CHART,
      series: [{ name: 'forecast_amount', color: '#f00' }],
    });
    expect(schema.series).toHaveLength(1);
    expect(schema.series[0].dataKey).toBe('amount');
    expect(schema.series[0].color).toBeUndefined();
  });

  it('the FIRST entry naming the measure wins over a later duplicate', async () => {
    const schema = await chartSchema({
      ...CHART,
      series: [
        { name: 'amount', color: '#f00' },
        { name: 'amount', color: '#0f0' },
      ],
    });
    expect(schema.series[0].color).toBe('#f00');
  });

  it('an out-of-family `type` does not become a per-series mark', async () => {
    // `pie` composes with nothing on a cartesian plot; taken literally it would
    // count as a family disagreement, flip the chart to a combo, and then draw
    // the series as a bar anyway.
    const schema = await chartSchema({ ...CHART, series: [{ name: 'amount', type: 'pie' }] });
    expect(schema.series[0].chartType).toBeUndefined();
  });

  it('presentation does not displace the #4020 display name', async () => {
    // The two cards meet on this line: the merge carries `color`/`stack`, and
    // the LABEL still comes from #4020's three-level resolution.
    const schema = await chartSchema({
      ...CHART,
      series: [{ name: 'amount', color: '#f00', label: '金额' }],
    });
    expect(schema.series[0]).toMatchObject({ color: '#f00', label: '金额' });
  });

  it('a chart authoring no series keeps the derived binding untouched', async () => {
    const schema = await chartSchema({ ...CHART });
    expect(schema.series).toEqual([{ dataKey: 'amount', label: 'Amount' }]);
  });
});
