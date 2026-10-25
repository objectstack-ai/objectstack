// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#7016 — the DECISION TABLE for `DashboardWidget.chartConfig`, pinned.
 *
 * `chartConfig` was declared as the full spec `ChartConfigSchema`, but the
 * dashboard dataset path only ever lowered `showLegend` (#3135). Since
 * `@objectstack/spec` 17.5.0 it is `DashboardWidgetChartConfigSchema`, the
 * same chrome keys with `type` / `xAxis` / `yAxis` / `series` (and, on every
 * chart config, `aria`) refused at parse. This file pins which keys reach the
 * chart schema and which are refused, because the split is a contract, not an
 * implementation detail:
 *
 *  - forwarded, because the chart block measurably draws it (the DOM half of
 *    that claim lives in `DatasetWidget.chartConfig.dom.test.tsx` for the keys
 *    drawn outside the plot and in `DatasetWidget.chartConfigMarks-9203.test.tsx`
 *    for the ones drawn inside it):
 *    `title`, `subtitle`, `description`, `height`, `colors`, `showDataLabels`,
 *    `annotations`, `interaction` — beside the pre-existing `showLegend`;
 *
 *    ⛔ That second citation used to name plugin-charts'
 *    `ChartRenderer.dashboardChartConfig.test.tsx`, and it was wrong:
 *    objectui#9203 deleted this face's forwarding and that file did not redden,
 *    because it hand-builds its own chart schema and never travels this seam.
 *    ⛔ Do not cite it as this face's coverage again — see its own header.
 *  - refused, because the dataset owns the chart's STRUCTURE: `type`, `xAxis`,
 *    `yAxis` and `series`, whole (objectui#11315);
 *  - refused, because nothing on this path reads it: `aria`.
 *
 * ⚠️ `xAxis`/`yAxis`/`series` were refused WHOLESALE until objectui#4229, which
 * merged their presentation half (per-series mark and axis binding, axis scale
 * and chrome) onto the derived bindings. Spec 17.5.0 took the keys whole on
 * this carrier, presentation included, so the refusal is wholesale again
 * (objectui#11315); `DatasetWidget.comboPresentation.test.tsx` pins what a
 * `combo` widget renders now.
 *
 * The refusals are pinned as hard as the forwards. The spec refuses all five
 * keys at parse; these cases pin that the renderer does not read them either,
 * for a stored widget that reaches it without a parse.
 *
 * Asserted at the source — the schema handed to the renderer — via a stubbed
 * SchemaRenderer, the same seam `DatasetWidget.showLegend`/`.animation` use.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, waitFor } from '@testing-library/react';

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

const rows = [
  { status: 'open', total: 120 },
  { status: 'paid', total: 80 },
];

/** Render a dataset chart widget with the given `chartConfig` and settle it. */
const renderWidget = async (chartConfig?: Record<string, unknown>, widgetType = 'bar') => {
  const src = { queryDataset: vi.fn(async () => ({ rows })) };
  render(
    <DatasetWidget
      widget={{
        type: widgetType,
        dataset: 'invoices',
        dimensions: ['status'],
        values: ['total'],
        ...(chartConfig ? { chartConfig } : {}),
      }}
      dataSource={src}
    />,
  );
  await waitFor(() => expect(lastChartSchema).not.toBeNull());
};

describe('DatasetWidget — chartConfig keys that ARE lowered (objectstack#7016)', () => {
  it('forwards the chart titles and the accessibility description', async () => {
    await renderWidget({
      title: 'Invoice value',
      subtitle: 'by status',
      description: 'Invoice value by status',
    });
    expect(lastChartSchema.title).toBe('Invoice value');
    expect(lastChartSchema.subtitle).toBe('by status');
    expect(lastChartSchema.description).toBe('Invoice value by status');
  });

  it('forwards an explicit plot height', async () => {
    await renderWidget({ height: 420 });
    expect(lastChartSchema.height).toBe(420);
  });

  // A non-positive height would collapse the plot to nothing; the container
  // default is a more honest answer than an invisible chart, so the key is
  // dropped rather than lowered.
  it('drops a non-positive or non-numeric height', async () => {
    await renderWidget({ height: 0 });
    expect('height' in lastChartSchema).toBe(false);
    cleanup();
    lastChartSchema = null;
    await renderWidget({ height: -10 });
    expect('height' in lastChartSchema).toBe(false);
  });

  it('forwards showDataLabels in both directions', async () => {
    await renderWidget({ showDataLabels: true });
    expect(lastChartSchema.showDataLabels).toBe(true);
    cleanup();
    lastChartSchema = null;
    await renderWidget({ showDataLabels: false });
    expect(lastChartSchema.showDataLabels).toBe(false);
  });

  it('forwards annotations and the interaction toggles', async () => {
    await renderWidget({
      annotations: [{ type: 'line', axis: 'y', value: 100, label: 'Target' }],
      interaction: { tooltips: false, brush: true },
    });
    expect(lastChartSchema.annotations).toEqual([
      { type: 'line', axis: 'y', value: 100, label: 'Target' },
    ]);
    expect(lastChartSchema.interaction).toEqual({ tooltips: false, brush: true });
  });

  it('drops an empty annotations array instead of emitting a dead key', async () => {
    await renderWidget({ annotations: [] });
    expect('annotations' in lastChartSchema).toBe(false);
  });

  // `colors` is overloaded: a string[] is the positional palette, a
  // { value: color } record is a per-category map. They reach the renderer
  // through two DIFFERENT props, so the widget splits them — the same split the
  // react tier's ObjectChart performs.
  it('lowers an array `colors` as the positional palette', async () => {
    await renderWidget({ colors: ['#111111', '#222222'] });
    expect(lastChartSchema.colors).toEqual(['#111111', '#222222']);
    expect('categoryColors' in lastChartSchema).toBe(false);
  });

  it('lowers a record `colors` as the per-category map, not as the palette', async () => {
    await renderWidget({ colors: { open: '#10B981', paid: '#EF4444' } });
    expect(lastChartSchema.categoryColors).toEqual({ open: '#10B981', paid: '#EF4444' });
    expect('colors' in lastChartSchema).toBe(false);
  });

  it('keeps the pre-existing showLegend behaviour (#3135)', async () => {
    await renderWidget({ showLegend: false });
    expect(lastChartSchema.showLegend).toBe(false);
  });

  // The whole point of a whitelist: an undeclared key leaves the renderer's own
  // default in charge, so every dashboard that never wrote `chartConfig` renders
  // byte-for-byte as before.
  it('emits none of the presentation keys when no chartConfig is declared', async () => {
    await renderWidget();
    for (const key of [
      'title', 'subtitle', 'description', 'height', 'colors', 'categoryColors',
      'showLegend', 'showDataLabels', 'annotations', 'interaction',
    ]) {
      expect({ key, present: key in lastChartSchema }).toEqual({ key, present: false });
    }
  });
});

describe('DatasetWidget — chartConfig keys that are REFUSED (objectstack#7016)', () => {
  // `xAxis` / `yAxis` / `series` were refused here until objectui#4229 merged
  // their presentation half forward, and are refused whole again since spec
  // 17.5.0 retired them on this carrier (objectui#11315). The widget's values
  // below are what a stored widget could still carry: nothing parses it on the
  // way to this renderer, so the refusal has to hold here too.
  it('emits no authored axis and keeps the derived axis binding', async () => {
    await renderWidget({
      xAxis: { field: 'not_a_column', title: 'Authored X' },
      yAxis: [{ field: 'not_a_measure', min: 0, max: 5 }, { position: 'right' }],
    });
    expect('xAxis' in lastChartSchema).toBe(false);
    expect('yAxis' in lastChartSchema).toBe(false);
    // The derived binding is untouched: the dimension is still the category axis.
    expect(lastChartSchema.xAxisKey).toBe('status');
  });

  it('ignores an authored series and keeps one derived series per measure', async () => {
    await renderWidget({ series: [{ name: 'total', type: 'line', yAxis: 'right', stack: 'g', color: '#ff0000' }] });
    // `series` on the emitted schema is the DERIVED one (internal `dataKey`
    // shape, one entry per selected measure) — not the authored array, and
    // nothing of the authored entry is merged onto it, even though it names a
    // selected measure: the derived binding is `dataKey` + `label`, and only that.
    expect(lastChartSchema.series).toHaveLength(1);
    expect(lastChartSchema.series[0].dataKey).toBe('total');
    expect(Object.keys(lastChartSchema.series[0]).sort()).toEqual(['dataKey', 'label']);
  });

  it('ignores chartConfig.type — the widget type owns the chart family', async () => {
    await renderWidget({ type: 'line' }, 'pie');
    expect(lastChartSchema.chartType).toBe('pie');
    // Neither the author `type` nor its rescued `specType` spelling is lowered,
    // so nothing can outrank CHART_TYPE_MAP.
    expect(lastChartSchema.type).toBe('chart');
    expect('specType' in lastChartSchema).toBe(false);
  });

  // Criterion 1: `aria` is read by NOTHING on this path — AdvancedChartImpl has
  // no `aria` prop, and SchemaRenderer's ARIA injection reads the FLAT
  // `ariaLabel`/`ariaDescribedBy`/`role`. Forwarding it (nested, or flattened
  // onto those three) would either stay inert or fight the accessible name
  // `description` already sets. Spec 17.5.0 retired it as a tombstone
  // (objectstack#17751, objectui#4044), so it is refused at parse as well.
  it('ignores aria — nested and flattened', async () => {
    await renderWidget({
      aria: { ariaLabel: 'Authored name', ariaDescribedBy: 'hint', role: 'figure' },
    });
    for (const key of ['aria', 'ariaLabel', 'ariaDescribedBy', 'role']) {
      expect(key in lastChartSchema).toBe(false);
    }
  });
});
