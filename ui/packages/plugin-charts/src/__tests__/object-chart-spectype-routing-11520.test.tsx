/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#11520: an `object-chart` whose family rides on `specType` draws the
 * form its family routes to, and never a silent bar.
 *
 * ## The defect this pins
 *
 * `specType` is the react tier's chart family: the react-page wrapper parks the
 * author's `<ObjectChart type="…">` there, because `type` is the node's
 * discriminator. Both faces declare it as the spec's whole `ChartTypeSchema`.
 * `normalizeChartSchema` read it, then dropped any family outside the drawn set,
 * so `ChartRenderer` handed `AdvancedChartImpl` no family at all, and
 * `AdvancedChartImpl` defaulted to `'bar'`. A `gauge`, `kpi`, `metric`,
 * `bullet`, `solid-gauge`, `table` or `pivot` document that both faces accept
 * drew a bar chart, with no note. The same families on `chartType` already drew
 * a number card or the tabular notice.
 *
 * ## What this pins
 *
 * Triage's ruling on objectui#11520: the `specType` channel routes a family
 * this block draws no chart of through the same dispatch the `chartType`
 * channel reaches, and the `'bar'` default is gone. So every cell below is
 * held to its ROUTED FORM, read off the dispatch's own sets in
 * `normalizeChartSchema.ts` (no family list is restated here):
 *
 * - `SINGLE_VALUE_CHART_TYPES` → the number card (`advanced-chart-single-value`);
 * - `TABULAR_CHART_TYPES` → the tabular notice (`advanced-chart-tabular-notice`);
 * - `RENDERABLE` → the family's OWN marks, so a family silently drawn as a bar
 *   fails;
 * - anything else (the off-spec `sunburst`) → the unknown-type notice, naming
 *   the value.
 *
 * The matrix is every family of the installed spec plus `sunburst`, in five
 * node shapes, each carrying the family on `specType`:
 *
 * 1. the flat node with inline rows (`data`, `xAxisKey`, `series[{ dataKey }]`);
 * 2. the authored `properties` bag on the object path (`objectName`,
 *    `aggregate`, the spec's `xAxis` and `series[{ name }]`): the document the
 *    card measured, which both faces accept;
 * 3. the dashboard producer's flat node (`objectName`, `aggregate`, `xAxisKey`,
 *    `series[{ dataKey }]`);
 * 4. the react-page wrapper's own output, `{ ...props, specType, type }`, from
 *    the react tier's `<ObjectChart>` props;
 * 5. a dataset-bound node (`dataset`, one dimension, one value).
 *
 * Controls: `bar` (and `column`, `horizontal-bar`) still draw bars, so the mark
 * counters can see a chart. `sunburst` draws no chart and names itself. A node
 * that names no family at all shows the notice instead of the bar it used to
 * get. The two channels are held to one answer: per family, `specType` draws
 * the same form `chartType` draws. `object-chart-declared-families-11513.test.tsx`
 * holds the `chartType` channel's refusals.
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
import { StrictAnyComponentSchema, safeValidateSchema } from '@object-ui/types/zod';
import { RENDERABLE, SINGLE_VALUE_CHART_TYPES, TABULAR_CHART_TYPES } from '../normalizeChartSchema';
// The package entry, for its REGISTRATION side effects. Relative: a package
// must not import itself (`pnpm check:self-import`).
import '../index';
// `ChartRenderer` renders its implementation behind
// `React.lazy(() => import('./AdvancedChartImpl'))`; importing it here pays the
// recharts graph in the import phase, which no test timeout applies to
// (AGENTS.md §测试纪律).
import '../AdvancedChartImpl';

afterEach(cleanup);

// `ObjectChart` loads the grouped field's (or the dataset's) metadata over
// `fetch` for its labels. Answer it here, for the whole file, so no read
// reaches a socket.
vi.stubGlobal('fetch', async () => new Response('{}', { status: 404 }));

/** The off-spec family: both faces refuse it, and it draws no chart. */
const OFF_SPEC = 'sunburst';
const SPEC_FAMILIES: string[] = enumOptions(ChartTypeSchema);
const FAMILIES: string[] = [...SPEC_FAMILIES, OFF_SPEC];

const AGGREGATE = { field: 'amount', function: 'sum', groupBy: 'stage' } as const;
const MEASURE = chartMeasureKey(AGGREGATE, 'value');
const CATEGORY = chartCategoryKey(AGGREGATE, 'name');

/** Scatter plots its category as a position, so its categories are numeric. */
const categoriesFor = (family: string) => (family === 'scatter' ? [1, 2, 3] : ['won', 'open', 'lost']);
/** The rows the object path's `aggregate` answers, and the inline rows. */
const rowsFor = (family: string) => categoriesFor(family).map((stage, i) => ({ [CATEGORY]: stage, [MEASURE]: i + 1 }));
/** The rows the dataset path's `queryDataset` answers, keyed by dimension and value name. */
const datasetRowsFor = (family: string) => categoriesFor(family).map((stage, i) => ({ stage, amount: i + 1 }));

const sourceFor = (family: string) => ({
  find: async () => [],
  findOne: async () => null,
  aggregate: async () => rowsFor(family),
  queryDataset: async () => ({ rows: datasetRowsFor(family), fields: [], object: 'probe_deal' }),
  count: async () => 0,
  getObject: async () => null,
});

/** The react tier's `<ObjectChart>` props, as an author writes them on the block. */
const reactTierProps = (family: string) => ({
  type: family,
  objectName: 'probe_deal',
  aggregate: AGGREGATE,
  xAxis: { field: CATEGORY },
  series: [{ name: MEASURE }],
});

/**
 * The react-page wrapper's node, built the way `react-page.tsx`'s `Wrapper`
 * builds it: the author's `type` is parked as `specType`, and the block's own
 * discriminator wins the `type` slot.
 */
const reactPageNode = (tag: string, props: Record<string, unknown>) => {
  const specType = typeof props.type === 'string' && props.type !== tag ? props.type : undefined;
  return { ...props, ...(specType ? { specType } : {}), type: tag };
};

/** The five node shapes, each carrying the family on `specType`. */
const SPELLINGS: Record<string, (family: string) => Record<string, unknown>> = {
  'flat node, inline rows': (family) => ({
    type: 'object-chart',
    specType: family,
    data: rowsFor(family),
    xAxisKey: CATEGORY,
    series: [{ dataKey: MEASURE }],
  }),
  'properties bag, object path': (family) => ({
    type: 'object-chart',
    properties: {
      specType: family,
      objectName: 'probe_deal',
      aggregate: AGGREGATE,
      xAxis: { field: CATEGORY },
      series: [{ name: MEASURE }],
    },
  }),
  "dashboard producer's node": (family) => ({
    type: 'object-chart',
    specType: family,
    objectName: 'probe_deal',
    aggregate: AGGREGATE,
    xAxisKey: CATEGORY,
    series: [{ dataKey: MEASURE }],
  }),
  "react-page wrapper's node": (family) => reactPageNode('object-chart', reactTierProps(family)),
  'dataset node': (family) => ({
    type: 'object-chart',
    specType: family,
    dataset: 'probe_deal_dataset',
    dimensions: ['stage'],
    values: ['amount'],
  }),
};

interface Drawn {
  marks: Record<string, number>;
  valueAxes: number;
  xTicks: string[];
  yTicks: string[];
  notice: string | null;
  noticeText: string;
  refusal: string | null;
  surface: boolean;
}

async function renderNode(node: Record<string, unknown>, family: string): Promise<Drawn> {
  const { container: c } = render(
    <SchemaRendererProvider dataSource={sourceFor(family) as never}>
      <SchemaRenderer schema={{ ...node, isAnimationActive: false } as never} />
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
  const notice = c.querySelector('[data-testid^="advanced-chart-"]');
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
    notice: notice?.getAttribute('data-testid') ?? null,
    noticeText: notice?.textContent ?? '',
    refusal: c.querySelector('[data-chart-error]')?.getAttribute('data-chart-error') ?? null,
    surface: !!c.querySelector('.recharts-surface'),
  };
}

const drawsAChart = (d: Drawn) => d.surface && d.notice === null && d.refusal === null;
const markKinds = (d: Drawn) => Object.entries(d.marks).filter(([, n]) => n > 0).map(([name]) => name).join(',');

/** What each drawn family's own marks look like, read off what recharts put in the DOM. */
const OWN_MARKS: Record<string, (d: Drawn) => boolean> = {
  bar: (d) => markKinds(d) === 'bar' && d.xTicks.includes('won') && d.valueAxes === 1,
  column: (d) => markKinds(d) === 'bar' && d.xTicks.includes('won') && d.valueAxes === 1,
  'horizontal-bar': (d) => markKinds(d) === 'bar' && d.yTicks.includes('won') && !d.xTicks.includes('won'),
  line: (d) => markKinds(d) === 'line',
  area: (d) => markKinds(d) === 'area',
  pie: (d) => markKinds(d) === 'pie',
  donut: (d) => markKinds(d) === 'pie',
  funnel: (d) => markKinds(d) === 'funnel',
  scatter: (d) => markKinds(d) === 'scatter',
  treemap: (d) => markKinds(d) === 'treemap',
  sankey: (d) => markKinds(d) === 'sankey',
  radar: (d) => markKinds(d) === 'radar',
  // One measure on the combo arm: its positional first mark, on the arm's two value axes.
  combo: (d) => markKinds(d) === 'bar' && d.valueAxes === 2,
};

/** The form a family routes to, by the dispatch's own sets. */
const routedForm = (family: string): string => {
  if (SINGLE_VALUE_CHART_TYPES.has(family)) return 'advanced-chart-single-value';
  if (TABULAR_CHART_TYPES.has(family)) return 'advanced-chart-tabular-notice';
  if (RENDERABLE.has(family)) return `chart:${family}`;
  return 'advanced-chart-unknown-type';
};

/** The form a render actually took: a notice's test id, or the chart its marks say it drew. */
const drawnForm = (family: string, d: Drawn): string => {
  if (d.notice) return d.notice;
  if (d.refusal) return `refusal:${d.refusal}`;
  if (!drawsAChart(d)) return 'nothing';
  // A drawn family must draw ITS OWN marks; anything else names the marks it drew instead.
  return OWN_MARKS[family]?.(d) ? `chart:${family}` : `marks:${markKinds(d) || 'none'}`;
};

describe('an object-chart draws its specType family\'s routed form, never a silent bar (objectui#11520)', () => {
  it('reads the spec\'s families, and each one has a routed form', () => {
    expect(SPEC_FAMILIES.length, 'could not read ChartTypeSchema.options from the spec').toBeGreaterThan(0);
    // Every drawn family has its own mark predicate, so none can pass as "some chart".
    expect(Object.keys(OWN_MARKS).sort()).toEqual([...RENDERABLE].filter((f) => SPEC_FAMILIES.includes(f)).sort());
    // Every spec family lands on a branch of the dispatch, and the off-spec control does not.
    for (const family of SPEC_FAMILIES) expect(routedForm(family), family).not.toBe('advanced-chart-unknown-type');
    expect(routedForm(OFF_SPEC)).toBe('advanced-chart-unknown-type');
  });

  it('the card\'s document parses on both faces for every spec family on specType, and the off-spec control does not', () => {
    for (const family of FAMILIES) {
      const doc = SPELLINGS['properties bag, object path'](family);
      for (const parse of [safeValidateSchema, (d: unknown) => StrictAnyComponentSchema.safeParse(d)]) {
        expect(parse(doc).success, `${family}: parses exactly when it is a spec family`).toBe(SPEC_FAMILIES.includes(family));
      }
    }
  });

  describe.each(Object.keys(SPELLINGS).map((s) => [s] as const))('%s', (spelling) => {
    it.each(FAMILIES.map((f) => [f] as const))('`%s` on specType draws its routed form', async (family) => {
      const drawn = await renderNode(SPELLINGS[spelling](family), family);
      expect(drawnForm(family, drawn), `${family} (${spelling}): ${JSON.stringify(drawn)}`).toBe(routedForm(family));
      if (routedForm(family) === 'advanced-chart-unknown-type') expect(drawn.noticeText).toContain(family);
    });
  });

  it.each(FAMILIES.map((f) => [f] as const))('`%s`: specType draws the same form chartType draws', async (family) => {
    const viaSpecType = await renderNode(SPELLINGS['properties bag, object path'](family), family);
    cleanup();
    const bag = SPELLINGS['properties bag, object path'](family).properties as Record<string, unknown>;
    const { specType: _specType, ...rest } = bag;
    const viaChartType = await renderNode({ type: 'object-chart', properties: { ...rest, chartType: family } }, family);
    expect(drawnForm(family, viaSpecType)).toBe(drawnForm(family, viaChartType));
  });

  it('a node that names no family shows the notice, not a bar', async () => {
    // Both faces refuse it ("names no chart family"); the render door now says so too.
    const familyless = SPELLINGS['properties bag, object path']('bar');
    const { specType: _specType, ...rest } = familyless.properties as Record<string, unknown>;
    const node = { type: 'object-chart', properties: rest };
    expect(safeValidateSchema(node).success).toBe(false);
    expect(StrictAnyComponentSchema.safeParse(node).success).toBe(false);
    const drawn = await renderNode(node, 'bar');
    expect(drawn.notice, JSON.stringify(drawn)).toBe('advanced-chart-unknown-type');
    expect(drawn.noticeText).toContain('names no chart type');
    expect(drawn.marks.bar).toBe(0);
  });

  it('the bare `chart` node that names no family shows the same notice; naming `bar` still draws a bar', async () => {
    // `ChartRenderer` directly, without `ObjectChart`: the registration that used to
    // reach `AdvancedChartImpl`'s `'bar'` default with nothing in between.
    const inline = { type: 'chart', data: rowsFor('bar'), xAxisKey: CATEGORY, series: [{ dataKey: MEASURE }] };
    const familyless = await renderNode(inline, 'bar');
    expect(familyless.notice, JSON.stringify(familyless)).toBe('advanced-chart-unknown-type');
    expect(familyless.marks.bar).toBe(0);
    cleanup();
    const bar = await renderNode({ ...inline, chartType: 'bar' }, 'bar');
    expect(drawnForm('bar', bar), JSON.stringify(bar)).toBe('chart:bar');
  });
});
