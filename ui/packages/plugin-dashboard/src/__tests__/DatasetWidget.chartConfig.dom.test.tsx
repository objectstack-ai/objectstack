// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#7016 — END TO END: dashboard metadata → real chart DOM.
 *
 * The sibling `DatasetWidget.chartConfig.test.tsx` pins the decision at the
 * schema seam. That is necessary and not sufficient: the criterion for lowering
 * a `chartConfig` key is that the chart block *draws* it, and a seam assertion
 * cannot tell a honoured prop from an ignored one. So this file renders the REAL
 * chain — `DatasetWidget` → `SchemaRenderer` → the registry's `chart`
 * (`ChartRenderer`) → `AdvancedChartImpl` — with no renderer stub at all, and
 * reads the resulting DOM.
 *
 * Scope of THIS file: everything the chart draws OUTSIDE Recharts'
 * `ResponsiveContainer` — the ChartFrame titles, and the chart container's
 * height and accessible name. Recharts' own marks (bars, LabelList, reference
 * lines, Brush) need a measured box, which this harness does not give them
 * (`ResponsiveContainer` measures 0×0 and renders no children), so asserting
 * their absence *here* would pass for the wrong reason.
 *
 * ⚠️ This header used to end by saying those marks could be pinned in
 * `packages/plugin-charts/src/ChartRenderer.dashboardChartConfig.test.tsx`
 * alone, "the only place in this repo that can, since `recharts` resolves
 * inside plugin-charts alone". objectui#9203 corrected that, and both halves
 * of the correction matter:
 *
 *  - The premise survives — `recharts` does resolve inside `plugin-charts`
 *    alone, so `vi.mock('recharts')` is genuinely unavailable here.
 *  - ⭐ The conclusion was false, and worse than false: that file hand-builds
 *    its own chart schema, so it never travels the dashboard seam at all. When
 *    PR objectui#9202 ablated the inline relays' forwarding, **46 assertions
 *    went red across the three dashboard files and 0 in that one**. It was
 *    never coverage for the plot-internal keys on any dashboard face — an
 *    assertion that stays green while the thing it names is deleted is not
 *    evidence (objectui#7963's `confirmVariant`, same shape).
 *
 * No module mock is needed to close that: `ResponsiveContainer` seeds its size
 * from `getBoundingClientRect` on its OWN element, so a stub scoped to the
 * `recharts-responsive-container` element is enough. The dataset face's
 * plot-internal keys (`colors`, `categoryColors`, `showDataLabels`,
 * `annotations`, `interaction`) are pinned that way, on this seam, in
 * `DatasetWidget.chartConfigMarks-9203.test.tsx` — the sibling to this file.
 * ⛔ Do not cite `plugin-charts`' file as their coverage again.
 *
 * The assertions below are deliberately left exactly as they were: they are the
 * LIT CONTROL for that ablation (the four keys that do redden here), and this
 * file's own harness stays box-free so the negative `aria` pin at the bottom
 * keeps meaning what it says.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, screen, waitFor } from '@testing-library/react';

// Registers `chart` in the ComponentRegistry, which is what `SchemaRenderer`
// resolves the widget's `{ type: 'chart' }` schema through. This is the
// package's whole published surface, and it is all this file needs: production
// reaches `AdvancedChartImpl` ONLY through the `React.lazy(() =>
// import('./AdvancedChartImpl'))` factory inside `ChartRenderer`, so this test
// reaches it the same way — by rendering the real chain and awaiting the
// Suspense boundary (objectui#4529). It used to also side-effect import
// `@object-ui/plugin-charts/AdvancedChartImpl` to pre-warm that chunk, but the
// package publishes `"."` alone, so that specifier resolved only through this
// repo's vitest alias — the objectui#4325 packaging gap, whose ruling (PR
// #4460) is that the unpublished deep subpath goes rather than the surface
// growing to keep it alive. See `renderWidget` for how the wait it used to
// shorten is now budgeted instead.
import '@object-ui/plugin-charts';
import { DatasetWidget } from '../DatasetWidget';

afterEach(cleanup);

const rows = [
  { status: 'open', total: 120 },
  { status: 'paid', total: 80 },
];

const renderWidget = async (chartConfig?: Record<string, unknown>) => {
  const src = { queryDataset: vi.fn(async () => ({ rows })) };
  const view = render(
    <DatasetWidget
      widget={{
        type: 'bar',
        dataset: 'invoices',
        dimensions: ['status'],
        values: ['total'],
        ...(chartConfig ? { chartConfig } : {}),
      }}
      dataSource={src}
    />,
  );
  // The chart container only exists once the dataset resolves AND the lazy chart
  // chunk has mounted — i.e. once the whole dashboard chart path really ran.
  //
  // Every witness in this file is post-boundary DOM by design (that is the point
  // of the file — see the header), so unlike objectui#4325's case the race
  // cannot be removed by choosing a witness that survives every state of the
  // boundary. It is BUDGETED instead. Measured on an idle container: 359 ms from
  // render to chart mount with the lazy chunk cold, against 91 ms when it had
  // been eagerly pre-imported — so dropping the pre-import moves ~270 ms inside
  // this wait. That fits RTL's 1000 ms default here and would still be a coin
  // flip on a loaded machine: AGENTS.md records first-`import()` latencies up to
  // 976 ms under full parallelism. The budget below is generous on purpose —
  // `waitFor` polls and returns as soon as the node appears, so a large timeout
  // costs nothing when the chunk is warm and only spends time it actually needs.
  await waitFor(() => expect(view.container.querySelector('[data-slot="chart"]')).not.toBeNull(), {
    timeout: 15000,
  });
  return view;
};

const chartEl = (container: HTMLElement) => container.querySelector('[data-slot="chart"]') as HTMLElement;

describe('DatasetWidget — chartConfig reaches the real chart DOM (objectstack#7016)', () => {
  it('draws chartConfig.title / .subtitle above the plot', async () => {
    const { container } = await renderWidget({ type: 'bar', title: 'Invoice value', subtitle: 'by status' });
    expect(screen.getByText('Invoice value')).toBeTruthy();
    expect(screen.getByText('by status')).toBeTruthy();
    // The titles are drawn in a FRAME wrapping the plot, so the chart container
    // is no longer the widget root's direct child — the structural counterpart of
    // the "no chrome" case below.
    expect(chartEl(container).parentElement).not.toBe(container.firstElementChild);
  });

  it('adds no title chrome when chartConfig declares none', async () => {
    const { container } = await renderWidget({ type: 'bar' });
    // ChartFrame is a passthrough with neither title nor subtitle, so the plot
    // sits directly under the widget root — no wrapper, no empty header row.
    expect(chartEl(container).parentElement).toBe(container.firstElementChild);
  });

  it('announces chartConfig.description as the chart graphic accessible name', async () => {
    const { container } = await renderWidget({ type: 'bar', description: 'Invoice value by status' });
    expect(chartEl(container).getAttribute('role')).toBe('img');
    expect(chartEl(container).getAttribute('aria-label')).toBe('Invoice value by status');
  });

  it('leaves the graphic unlabelled when no description is declared', async () => {
    // Not the same as an empty one: role="img" with no name is worse for a
    // screen reader than a plain div it can skip past.
    const { container } = await renderWidget({ type: 'bar' });
    expect(chartEl(container).getAttribute('role')).toBeNull();
    expect(chartEl(container).getAttribute('aria-label')).toBeNull();
  });

  it('applies chartConfig.height over the container default', async () => {
    const { container } = await renderWidget({ type: 'bar', height: 420 });
    expect(chartEl(container).style.height).toBe('420px');
  });

  it('keeps the container default height when none is declared', async () => {
    const { container } = await renderWidget({ type: 'bar' });
    expect(chartEl(container).style.height).toBe('');
    expect(chartEl(container).className).toContain('h-[350px]');
  });

  // Negative pin for the one key refused on criterion 1 (nothing reads it). This
  // assertion is meaningful in this harness precisely because BOTH elements that
  // could have carried the name render outside `ResponsiveContainer`: the chart
  // container (which `description` does label, above) and the SchemaRenderer
  // wrapper (which would pick up a FLATTENED `ariaLabel`). Written, still
  // ignored. The protocol has since settled the same way: spec 17.5.0 retired
  // `ChartConfig.aria` (objectstack#17751), so an authored one is refused at
  // parse, and this pin holds the renderer side for a widget that reaches it
  // without that parse.
  it('ignores chartConfig.aria — no accessible name appears anywhere', async () => {
    const { container } = await renderWidget({
      type: 'bar',
      aria: { ariaLabel: 'Authored name', role: 'figure' },
    });
    expect(container.querySelector('[aria-label]')).toBeNull();
    expect(container.querySelector('[role="figure"]')).toBeNull();
    expect(chartEl(container).getAttribute('role')).toBeNull();
  });
});
