/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#11530: an `object-chart` reads the family it DRAWS when it decides
 * whether `compareTo` applies, on either family channel.
 *
 * ## The defect this pins
 *
 * `ObjectChart` gates two things on `chartTypeIgnoresCompareTo` from
 * `@object-ui/core`'s chart-presentation: the comparison fetch, and the
 * `__comparison` overlay series it synthesises from that fetch's column. Both
 * gates read `schema.chartType` alone. A family on `specType` (the react
 * tier's channel, which objectui#11520 routes to the family dispatch) was
 * invisible to them, so a family that ignores `compareTo` still fetched the
 * comparison window and still got the overlay:
 *
 * - `specType: scatter` then refused its own two series ("A scatter plots one
 *   measure. Keep exactly one series: …");
 * - `specType: pie` paid for a comparison fetch it never drew.
 *
 * The same documents with the family on `chartType` made one call and drew.
 *
 * ## What this pins
 *
 * Triage's ruling on objectui#11530: both gates read the effective family, the
 * one `normalizeChartSchema` hands the dispatch (`chartType`, else
 * `specType`), through `chartTypeIgnoresCompareTo`. So every expectation
 * below is read off that predicate; ⛔ no family list is restated here
 * (objectui#7495).
 *
 * Through the real `SchemaRenderer` and this package's registrations, in the
 * node shapes objectui#11520's matrix covers:
 *
 * 1. the authored `properties` bag on the object path: the card's document;
 * 2. the dashboard producer's flat node;
 * 3. the react-page wrapper's own output, `{ ...props, specType, type }`;
 * 4. the flat node with inline rows. It fetches nothing, so it isolates the
 *    OVERLAY gate: its rows carry the comparison column already;
 * 5. a dataset-bound node. Its `queryDataset` leg forwards no `compareTo` for
 *    any family, so it is held only to "both channels agree".
 *
 * Controls: `bar` keeps its comparison fetch and its overlay on `specType`,
 * so a fix that switched `compareTo` off for that channel fails; and the
 * `chartType` twins are held to the same answers.
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
import { chartCategoryKey, chartMeasureKey, chartTypeIgnoresCompareTo } from '@object-ui/core';
import { SchemaRenderer, SchemaRendererProvider } from '@object-ui/react';
import { enumOptions } from '@object-ui/test-support';
import { StrictAnyComponentSchema, safeValidateSchema } from '@object-ui/types/zod';
import { COMPARISON_SUFFIX } from '../ObjectChart';
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

const SPEC_FAMILIES: string[] = enumOptions(ChartTypeSchema);

const AGGREGATE = { field: 'amount', function: 'sum', groupBy: 'stage' } as const;
const MEASURE = chartMeasureKey(AGGREGATE, 'value');
const CATEGORY = chartCategoryKey(AGGREGATE, 'name');
const COMPARISON = `${MEASURE}${COMPARISON_SUFFIX}`;
// A date-window filter, so `compareTo` has a window to shift: with no filter
// there is no comparison query to run for any family.
const FILTER = { close_date: { $gte: '{current_quarter_start}', $lte: '{current_quarter_end}' } };
const COMPARE_TO = { kind: 'previousYear' } as const;

/** Scatter plots its category as a position, so its categories are numeric. */
const categoriesFor = (family: string) => (family === 'scatter' ? [1, 2, 3] : ['won', 'open', 'lost']);
/** The rows each `aggregate` call answers, current and comparison window alike. */
const rowsFor = (family: string) => categoriesFor(family).map((stage, i) => ({ [CATEGORY]: stage, [MEASURE]: i + 1 }));

/** A source that counts its calls, per query leg. */
function sourceFor(family: string) {
  const calls = { aggregate: 0, queryDataset: 0 };
  const source = {
    find: async () => [],
    findOne: async () => null,
    aggregate: async () => {
      calls.aggregate += 1;
      return rowsFor(family);
    },
    queryDataset: async () => {
      calls.queryDataset += 1;
      return {
        rows: categoriesFor(family).map((stage, i) => ({ stage, amount: i + 1 })),
        fields: [],
        object: 'probe_deal',
      };
    },
    count: async () => 0,
    getObject: async () => null,
  };
  return { source, calls };
}

/**
 * The react-page wrapper's node, built the way `react-page.tsx`'s `Wrapper`
 * builds it: the author's `type` is parked as `specType`, and the block's own
 * discriminator wins the `type` slot.
 */
const reactPageNode = (tag: string, props: Record<string, unknown>) => {
  const specType = typeof props.type === 'string' && props.type !== tag ? props.type : undefined;
  return { ...props, ...(specType ? { specType } : {}), type: tag };
};

type Channel = 'specType' | 'chartType';

/** The object-path shapes: each runs the aggregate query, so each meets the FETCH gate. */
const OBJECT_SHAPES: Record<string, (family: string, channel: Channel) => Record<string, unknown>> = {
  'properties bag, object path': (family, channel) => ({
    type: 'object-chart',
    properties: {
      [channel]: family,
      objectName: 'probe_deal',
      aggregate: AGGREGATE,
      filter: FILTER,
      xAxis: { field: CATEGORY },
      series: [{ name: MEASURE }],
      compareTo: COMPARE_TO,
    },
  }),
  "dashboard producer's node": (family, channel) => ({
    type: 'object-chart',
    [channel]: family,
    objectName: 'probe_deal',
    aggregate: AGGREGATE,
    filter: FILTER,
    xAxisKey: CATEGORY,
    series: [{ dataKey: MEASURE }],
    compareTo: COMPARE_TO,
  }),
  "react-page wrapper's node": (family, channel) => {
    const props = {
      objectName: 'probe_deal',
      aggregate: AGGREGATE,
      filter: FILTER,
      xAxis: { field: CATEGORY },
      series: [{ name: MEASURE }],
      compareTo: COMPARE_TO,
    };
    // The react tier spells the family as `type`; the wrapper parks it on
    // `specType`. The `chartType` twin is the same output with the family moved.
    if (channel === 'specType') return reactPageNode('object-chart', { ...props, type: family });
    return { ...reactPageNode('object-chart', props), chartType: family };
  },
};

/**
 * The flat node with inline rows that ALREADY carry the comparison column. It
 * fetches nothing, so the fetch gate never runs: only the OVERLAY gate decides
 * whether that column becomes a second series.
 */
const inlineNode = (family: string, channel: Channel) => ({
  type: 'object-chart',
  [channel]: family,
  aggregate: AGGREGATE,
  data: rowsFor(family).map((row, i) => ({ ...row, [COMPARISON]: (i + 1) * 10 })),
  xAxisKey: CATEGORY,
  series: [{ dataKey: MEASURE }],
  compareTo: COMPARE_TO,
});

const datasetNode = (family: string, channel: Channel) => ({
  type: 'object-chart',
  [channel]: family,
  dataset: 'probe_deal_dataset',
  dimensions: ['stage'],
  values: ['amount'],
  compareTo: COMPARE_TO,
});

interface Drawn {
  marks: Record<string, number>;
  notice: string | null;
  refusal: string | null;
  refusalText: string;
  surface: boolean;
  calls: { aggregate: number; queryDataset: number };
}

async function renderNode(node: Record<string, unknown>, family: string): Promise<Drawn> {
  const { source, calls } = sourceFor(family);
  const { container: c } = render(
    <SchemaRendererProvider dataSource={source as never}>
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
  const count = (selector: string) => c.querySelectorAll(selector).length;
  const refusal = c.querySelector('[data-chart-error]');
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
    notice: c.querySelector('[data-testid^="advanced-chart-"]')?.getAttribute('data-testid') ?? null,
    refusal: refusal?.getAttribute('data-chart-error') ?? null,
    refusalText: refusal?.textContent ?? '',
    surface: !!c.querySelector('.recharts-surface'),
    calls: { ...calls },
  };
}

/** The marks a render drew, by kind and count, e.g. `scatter:1`. */
const markCounts = (d: Drawn) =>
  Object.entries(d.marks)
    .filter(([, n]) => n > 0)
    .map(([name, n]) => `${name}:${n}`)
    .join(',');
/** What a render showed: a notice, a refusal, or the marks it drew. */
const shown = (d: Drawn) => d.notice ?? (d.refusal ? `refusal:${d.refusal}` : markCounts(d) || 'nothing');

/** Aggregate calls an object-path chart of this family makes under `compareTo`. */
const expectedAggregateCalls = (family: string) => (chartTypeIgnoresCompareTo(family) ? 1 : 2);

describe('an object-chart reads the family it draws for compareTo, on either channel (objectui#11530)', () => {
  it('reads the families that ignore compareTo off the core predicate, and the card\'s two are among them', () => {
    expect(SPEC_FAMILIES.length, 'could not read ChartTypeSchema.options from the spec').toBeGreaterThan(0);
    expect(chartTypeIgnoresCompareTo('scatter')).toBe(true);
    expect(chartTypeIgnoresCompareTo('pie')).toBe(true);
    expect(chartTypeIgnoresCompareTo('bar')).toBe(false);
  });

  it('premise: the card\'s document parses on both faces with scatter, pie and bar on specType', () => {
    for (const family of ['scatter', 'pie', 'bar']) {
      const doc = OBJECT_SHAPES['properties bag, object path'](family, 'specType');
      expect(safeValidateSchema(doc).success, `${family}: safeValidateSchema`).toBe(true);
      expect(StrictAnyComponentSchema.safeParse(doc).success, `${family}: StrictAnyComponentSchema`).toBe(true);
    }
  });

  describe.each(Object.keys(OBJECT_SHAPES).map((s) => [s] as const))('%s', (shape) => {
    it('`specType: scatter` with compareTo draws after 1 aggregate call, with no overlay', async () => {
      const drawn = await renderNode(OBJECT_SHAPES[shape]('scatter', 'specType'), 'scatter');
      expect(drawn.calls.aggregate, JSON.stringify(drawn)).toBe(1);
      expect(drawn.refusal, drawn.refusalText).toBeNull();
      expect(shown(drawn), JSON.stringify(drawn)).toBe('scatter:1');
    });

    it('`specType: pie` with compareTo makes no comparison fetch', async () => {
      const drawn = await renderNode(OBJECT_SHAPES[shape]('pie', 'specType'), 'pie');
      expect(drawn.calls.aggregate, JSON.stringify(drawn)).toBe(1);
      expect(shown(drawn), JSON.stringify(drawn)).toBe('pie:1');
    });

    it('CONTROL: `specType: bar` with compareTo still fetches the comparison and draws its overlay', async () => {
      const drawn = await renderNode(OBJECT_SHAPES[shape]('bar', 'specType'), 'bar');
      expect(drawn.calls.aggregate, JSON.stringify(drawn)).toBe(2);
      expect(shown(drawn), JSON.stringify(drawn)).toBe('bar:2');
    });

    it('CONTROL: the `chartType` twins answer the same: scatter 1 call, pie 1 call, bar 2 calls and the overlay', async () => {
      const answers: Record<string, string> = {};
      for (const family of ['scatter', 'pie', 'bar']) {
        const drawn = await renderNode(OBJECT_SHAPES[shape](family, 'chartType'), family);
        answers[family] = `${drawn.calls.aggregate} ${shown(drawn)}`;
        cleanup();
      }
      expect(answers).toEqual({ scatter: '1 scatter:1', pie: '1 pie:1', bar: '2 bar:2' });
    });
  });

  it('moving the `specType` family from bar to pie re-runs the fetch under pie\'s gate: 2 calls, then 1 more', async () => {
    // The fetch is keyed on the family its gate reads, so a family change on
    // `specType` alone (every other key equal) re-runs it with the new answer.
    const { source, calls } = sourceFor('bar');
    const nodeFor = (family: string) => ({
      ...OBJECT_SHAPES['properties bag, object path'](family, 'specType'),
      isAnimationActive: false,
    });
    const { container: c, rerender } = render(
      <SchemaRendererProvider dataSource={source as never}>
        <SchemaRenderer schema={nodeFor('bar') as never} />
      </SchemaRendererProvider>,
    );
    await waitFor(() => expect(c.querySelectorAll('.recharts-bar').length).toBe(2), { timeout: 10_000 });
    expect(calls.aggregate).toBe(2);
    rerender(
      <SchemaRendererProvider dataSource={source as never}>
        <SchemaRenderer schema={nodeFor('pie') as never} />
      </SchemaRendererProvider>,
    );
    await waitFor(() => expect(c.querySelectorAll('.recharts-pie').length).toBe(1), { timeout: 10_000 });
    await waitFor(() => expect(calls.aggregate).toBe(3));
    expect(c.querySelector('[data-chart-error]')).toBeNull();
  });

  describe('flat node, inline rows carrying the comparison column (the overlay gate alone)', () => {
    it('`specType: scatter` synthesises no overlay series, so it draws instead of refusing', async () => {
      const drawn = await renderNode(inlineNode('scatter', 'specType'), 'scatter');
      expect(drawn.calls.aggregate).toBe(0);
      expect(drawn.refusal, drawn.refusalText).toBeNull();
      expect(shown(drawn), JSON.stringify(drawn)).toBe('scatter:1');
    });

    it('CONTROL: `specType: bar` turns the column into the overlay series, as its `chartType` twin does', async () => {
      const viaSpecType = await renderNode(inlineNode('bar', 'specType'), 'bar');
      cleanup();
      const viaChartType = await renderNode(inlineNode('bar', 'chartType'), 'bar');
      expect(shown(viaSpecType), JSON.stringify(viaSpecType)).toBe('bar:2');
      expect(shown(viaChartType), JSON.stringify(viaChartType)).toBe('bar:2');
    });
  });

  it.each(SPEC_FAMILIES.map((f) => [f] as const))(
    '`%s`: specType makes the calls and draws the form chartType does under compareTo (card\'s document)',
    async (family) => {
      const viaSpecType = await renderNode(OBJECT_SHAPES['properties bag, object path'](family, 'specType'), family);
      cleanup();
      const viaChartType = await renderNode(OBJECT_SHAPES['properties bag, object path'](family, 'chartType'), family);
      expect(viaChartType.calls.aggregate, `${family} (chartType)`).toBe(expectedAggregateCalls(family));
      expect(viaSpecType.calls.aggregate, `${family} (specType): ${JSON.stringify(viaSpecType)}`).toBe(
        expectedAggregateCalls(family),
      );
      expect(shown(viaSpecType), family).toBe(shown(viaChartType));
    },
  );

  it.each(['scatter', 'pie', 'bar'].map((f) => [f] as const))(
    'dataset node: `%s` on specType makes the calls and draws the form its chartType twin does',
    async (family) => {
      const viaSpecType = await renderNode(datasetNode(family, 'specType'), family);
      cleanup();
      const viaChartType = await renderNode(datasetNode(family, 'chartType'), family);
      expect(viaSpecType.calls).toEqual(viaChartType.calls);
      expect(shown(viaSpecType), JSON.stringify(viaSpecType)).toBe(shown(viaChartType));
    },
  );
});
