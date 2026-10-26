/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#11513 — `ObjectChartSchema.chartType` declares exactly the
 * `@objectstack/spec` chart families this block draws as a chart.
 *
 * ## What this pins
 *
 * The seat's ruling A: the face declares the installed spec's families that
 * plugin-charts draws, and ⛔ no family nothing draws. So the declared set is
 * a measurement, and this file re-takes it on every run: every family the
 * installed spec's `ChartTypeSchema` lists is authored as an `object-chart`
 * document in the `properties` bag, on the inline object path the dashboard
 * composes (`objectName` + `aggregate`), and rendered through the real
 * `SchemaRenderer` with this package's registrations live.
 *
 * - A family the face declares parses on both faces and draws ITS OWN marks:
 *   bars for the bar family (categories across for `bar` / `column`, down for
 *   `horizontal-bar`), a line, an area, pie sectors, funnel trapezoids,
 *   scatter symbols, treemap cells, sankey nodes and links, a radar polygon,
 *   and for `combo` the bar mark on the combo arm's two value axes. A family
 *   silently drawn as a bar fails here.
 * - A spec family the face does not declare draws no chart: the single-value
 *   families render one row's number, the tabular ones a notice. If one of
 *   them starts drawing a chart, this file goes red, and the family is
 *   measured and declared rather than drawn undeclared.
 *
 * The declared set is read off the zod mirror, and the spec's list off the
 * installed `@objectstack/spec`, so neither list is restated here.
 * `@object-ui/types`' `object-chart-families-11513.test.ts` holds the two faces
 * to the same set at the type level.
 *
 * Controls: `bar` is the lit control (a family that draws, so the mark
 * counters can see a chart), and the off-spec `sunburst` is the dark one: it
 * draws no chart, and the notice it renders is the one the "no chart"
 * predicate must be able to see.
 */

import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, waitFor } from '@testing-library/react';

// Recharts' ResponsiveContainer measures via ResizeObserver, which reports 0x0
// under the headless DOM, so nothing paints. Fix its size.
vi.mock('recharts', async () => {
  const actual = await vi.importActual<any>('recharts');
  return {
    ...actual,
    ResponsiveContainer: ({ children }: any) =>
      React.cloneElement(children, { width: 480, height: 320 }),
  };
});

import { ChartTypeSchema } from '@objectstack/spec/ui';
import { chartCategoryKey, chartMeasureKey } from '@object-ui/core';
import { SchemaRenderer, SchemaRendererProvider } from '@object-ui/react';
import { enumOptions } from '@object-ui/test-support';
import { ObjectChartSchema, StrictAnyComponentSchema, safeValidateSchema } from '@object-ui/types/zod';
// The package entry, for its REGISTRATION side effects. Relative: a package
// must not import itself (`pnpm check:self-import`).
import '../index';
// `ChartRenderer` renders its implementation behind
// `React.lazy(() => import('./AdvancedChartImpl'))`; importing it here pays the
// recharts graph in the import phase, which no test timeout applies to
// (AGENTS.md §测试纪律).
import '../AdvancedChartImpl';

afterEach(cleanup);

// `ObjectChart` loads the grouped field's metadata over `fetch` for its labels.
// Answer it here, for the whole file, so no read reaches a socket.
vi.stubGlobal('fetch', async () => new Response('{}', { status: 404 }));

const SPEC_FAMILIES: string[] = enumOptions(ChartTypeSchema);
const DECLARED: string[] = enumOptions(ObjectChartSchema.shape.chartType);

const AGGREGATE = { field: 'amount', function: 'sum', groupBy: 'stage' } as const;
const MEASURE = chartMeasureKey(AGGREGATE, 'value');
const CATEGORY = chartCategoryKey(AGGREGATE, 'name');

/** The rows the aggregate answers. Scatter plots its category as a position, so its rows are numeric. */
const rowsFor = (family: string) =>
  (family === 'scatter' ? [1, 2, 3] : ['won', 'open', 'lost']).map((stage, i) => ({ [CATEGORY]: stage, [MEASURE]: i + 1 }));

const sourceFor = (family: string) => ({
  find: async () => [],
  findOne: async () => null,
  aggregate: async () => rowsFor(family),
  count: async () => 0,
  getObject: async () => null,
});

/**
 * The authored document: the `object-chart` node with its props in the `properties` bag, its
 * category on the spec's `xAxis` and its measure on the spec's `{ name }` series arm.
 */
const documentFor = (family: string) => ({
  type: 'object-chart',
  properties: {
    chartType: family,
    objectName: 'probe_deal',
    aggregate: AGGREGATE,
    xAxis: { field: CATEGORY },
    series: [{ name: MEASURE }],
  },
});

interface Drawn {
  marks: Record<string, number>;
  valueAxes: number;
  xTicks: string[];
  yTicks: string[];
  notice: string | null;
  refusal: string | null;
  surface: boolean;
}

async function renderFamily(family: string): Promise<Drawn> {
  const { container: c } = render(
    <SchemaRendererProvider dataSource={sourceFor(family) as never}>
      <SchemaRenderer schema={{ ...documentFor(family), properties: { ...documentFor(family).properties, isAnimationActive: false } } as never} />
    </SchemaRendererProvider>,
  );
  await waitFor(
    () => {
      const painted =
        c.querySelector('.recharts-surface') ??
        c.querySelector('[data-chart-error]') ??
        c.querySelector('[data-testid^="advanced-chart-"]');
      expect(painted, `${family}: the chart never rendered past its loading state`).not.toBeNull();
    },
    { timeout: 10_000 },
  );
  const ticks = (axis: 'x' | 'y') =>
    [...c.querySelectorAll(`.recharts-${axis}Axis-tick-labels .recharts-cartesian-axis-tick-value`)].map((e) => e.textContent ?? '');
  const count = (selector: string) => c.querySelectorAll(selector).length;
  return {
    marks: {
      bar: count('.recharts-bar'),
      line: count('.recharts-line'),
      area: count('.recharts-area'),
      pie: count('.recharts-pie'),
      funnel: count('.recharts-trapezoids'),
      scatter: count('.recharts-scatter'),
      treemap: count('.recharts-treemap-depth-1'),
      sankey: count('.recharts-sankey-nodes') + count('.recharts-sankey-links'),
      radar: count('.recharts-radar'),
    },
    valueAxes: count('.recharts-yAxis'),
    xTicks: ticks('x'),
    yTicks: ticks('y'),
    notice: c.querySelector('[data-testid^="advanced-chart-"]')?.getAttribute('data-testid') ?? null,
    refusal: c.querySelector('[data-chart-error]')?.getAttribute('data-chart-error') ?? null,
    surface: !!c.querySelector('.recharts-surface'),
  };
}

const drawsAChart = (d: Drawn) => d.surface && d.notice === null && d.refusal === null;
const onlyMark = (d: Drawn, mark: string) =>
  Object.entries(d.marks).filter(([, n]) => n > 0).map(([name]) => name).join(',') === mark;

/** What each declared family draws, read off what recharts put in the DOM. */
const DRAWS_ITS_OWN_MARKS: Record<string, (d: Drawn) => boolean> = {
  bar: (d) => onlyMark(d, 'bar') && d.xTicks.includes('won') && d.valueAxes === 1,
  column: (d) => onlyMark(d, 'bar') && d.xTicks.includes('won') && d.valueAxes === 1,
  'horizontal-bar': (d) => onlyMark(d, 'bar') && d.yTicks.includes('won') && !d.xTicks.includes('won'),
  line: (d) => onlyMark(d, 'line'),
  area: (d) => onlyMark(d, 'area'),
  pie: (d) => onlyMark(d, 'pie'),
  donut: (d) => onlyMark(d, 'pie'),
  funnel: (d) => onlyMark(d, 'funnel'),
  scatter: (d) => onlyMark(d, 'scatter'),
  treemap: (d) => onlyMark(d, 'treemap'),
  sankey: (d) => onlyMark(d, 'sankey'),
  radar: (d) => onlyMark(d, 'radar'),
  // One measure on the combo arm: its positional first mark, on the arm's two value axes.
  combo: (d) => onlyMark(d, 'bar') && d.valueAxes === 2,
};

describe('object-chart draws a chart of exactly the families its `chartType` declares (objectui#11513)', () => {
  it('reads both lists, and the declared one is a strict subset of the spec\'s', () => {
    expect(SPEC_FAMILIES.length, 'could not read ChartTypeSchema.options from the spec').toBeGreaterThan(0);
    expect(DECLARED.length, 'could not read the declared families off the mirror').toBeGreaterThan(0);
    expect(DECLARED.filter((f) => !SPEC_FAMILIES.includes(f))).toEqual([]);
    expect(DECLARED.length).toBeLessThan(SPEC_FAMILIES.length);
    // Every declared family has its own mark predicate below, so none can pass as "some chart".
    expect(Object.keys(DRAWS_ITS_OWN_MARKS).sort()).toEqual([...DECLARED].sort());
  });

  it('LIT and DARK controls: `bar` draws a chart, the off-spec `sunburst` draws none and says so', async () => {
    const lit = await renderFamily('bar');
    expect(drawsAChart(lit), JSON.stringify(lit)).toBe(true);
    cleanup();
    const dark = await renderFamily('sunburst');
    expect(drawsAChart(dark), JSON.stringify(dark)).toBe(false);
    expect(dark.notice).toBe('advanced-chart-unknown-type');
  });

  it.each(SPEC_FAMILIES.map((f) => [f] as const))('`%s`: declared on the face if and only if it draws a chart', async (family) => {
    const declared = DECLARED.includes(family);
    for (const parse of [safeValidateSchema, (doc: unknown) => StrictAnyComponentSchema.safeParse(doc)]) {
      expect(parse(documentFor(family)).success, `${family} parses exactly when it is declared`).toBe(declared);
    }
    const drawn = await renderFamily(family);
    expect(drawsAChart(drawn), `${family}: ${JSON.stringify(drawn)}`).toBe(declared);
    if (declared) {
      expect(DRAWS_ITS_OWN_MARKS[family](drawn), `${family} drew another family's marks: ${JSON.stringify(drawn)}`).toBe(true);
    } else {
      // What an undeclared spec family renders instead of a chart: a number, or a notice.
      expect(['advanced-chart-single-value', 'advanced-chart-tabular-notice']).toContain(drawn.notice);
    }
  });
});
