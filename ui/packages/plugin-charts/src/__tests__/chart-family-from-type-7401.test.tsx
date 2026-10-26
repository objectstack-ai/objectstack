/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#7401 — a chart-type registration draws the family it names.
 *
 * ## What was broken
 *
 * `pie-chart`, `donut-chart`, `radar-chart` and `scatter-chart` declared their
 * family as `defaultProps: { chartType: … }` on the registration, and
 * **nothing on the SDUI path has ever read a registration's `defaultProps`**.
 * `ChartRenderer` computed `schema.chartType ?? spec.chartType` — both
 * `undefined` — and `AdvancedChartImpl` fell to its `'bar'` default. Four
 * documented component types were one family, on valid data, with no
 * `data-chart-error` that could fire. The card's measurement, which the
 * `renders as itself` block below reproduces as a REGRESSION table:
 *
 *   | schema `type`                    | scatter | bar | pie | refusal |
 *   |----------------------------------|--------:|----:|----:|---------|
 *   | `scatter-chart`                  |       0 |   2 |   0 | none    |
 *   | `plugin-charts:scatter-chart`    |       0 |   2 |   0 | none    |
 *   | `pie-chart`                      |       0 |   2 |   0 | none    |
 *
 * ⚠️ Since objectui#10859 batch 8 (phase 2b) `scatter-chart` is RETIRED: its
 * registration and its `CHART_TYPE_KEYWORD_FAMILIES` row are gone, and the
 * scatter family is reached as `{ type: 'chart', chartType: 'scatter' }`. The
 * two scatter rows of the table above are the card's historical measurement;
 * the scatter cases below pin the retirement and the spelling that draws.
 *
 * ⚠️ Since phase 2c, `pie-chart`, `donut-chart` and `radar-chart` are RETIRED
 * the same way, after `examples/chart-examples.ts` (their last producer) moved
 * to `{ type: 'chart', chartType: 'pie' | 'donut' | 'radar' }`. Of the keywords
 * the card fixed, `chart:bar` alone stays registered, so the "renders as
 * itself" rows now run on it and on the spelling that draws, and the retired
 * keys are pinned absent under both spellings with no family derived.
 *
 * ## Why these render through the REAL SDUI path
 *
 * The defect lived between the registry and the renderer, so a unit test on
 * either side of that seam could not see it — `normalizeChartSchema` was
 * asked the right question and `AdvancedChartImpl` gave the right answer for
 * the family it was handed. Only a schema going in through `SchemaRenderer`
 * with the package's own registrations live reproduces it, which is also the
 * form the card measured in.
 *
 * ## Ruled route C (director seat, 2026-09-06, on maintainer authorisation)
 *
 * The family is derived from the schema's own `type`, and the five inert
 * `defaultProps: { chartType: … }` are removed rather than left beside a
 * mechanism that works (`AGENTS.md` #0.1). ⛔ A/B are closed: A (activating
 * registration `defaultProps` on the SDUI path generally) is a feature with a
 * measured 32-site / 12-package blast radius and is its own card.
 */

import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, waitFor } from '@testing-library/react';

// Recharts' ResponsiveContainer measures its parent via ResizeObserver, which
// reports 0x0 under the headless DOM, so nothing paints. Fix its size — the
// 480x320 the card measured at, and the size every other render pin in this
// package uses.
vi.mock('recharts', async () => {
  const actual = await vi.importActual<any>('recharts');
  return {
    ...actual,
    ResponsiveContainer: ({ children }: any) =>
      React.cloneElement(children, { width: 480, height: 320 }),
  };
});

import { ComponentRegistry } from '@object-ui/core';
import { SchemaRenderer, SchemaRendererProvider } from '@object-ui/react';
// The package entry, for its REGISTRATION side effects — this is the half of
// the seam a unit test cannot reach. Relative, not `@object-ui/plugin-charts`:
// a package must not import itself (`pnpm check:self-import`).
import '../index';
import { ChartRenderer } from '../ChartRenderer';
import {
  CHART_TYPE_KEYWORD_FAMILIES,
  familyFromComponentType,
  normalizeChartSchema,
} from '../normalizeChartSchema';
// Ruling item 3: the in-repo example that drew a bar has to draw a pie now.
import { pieChartExample, donutChartExample, radarChartExample } from '../../examples/chart-examples';

afterEach(cleanup);

/** The card's fixture: two rows, one category column, two measures. */
const ROWS = [
  { xm: 'a', ym: 1, zm: 5 },
  { xm: 'b', ym: 2, zm: 90 },
];
/**
 * The same two rows with a NUMERIC category column, for scatter only.
 *
 * Scatter is the one family whose x-axis is a measure, not a category: a row
 * whose `xm` is `'a'` has no position and `countPlottablePoints` refuses the
 * whole chart (`no-plottable-points`). Handing scatter categorical rows would
 * assert the wrong refusal and never reach the marks.
 */
const NUMERIC_ROWS = [
  { xm: 1, ym: 1, zm: 5 },
  { xm: 2, ym: 2, zm: 90 },
];
const TWO_SERIES = [{ dataKey: 'ym' }, { dataKey: 'zm' }];
const ONE_SERIES = [{ dataKey: 'ym' }];

/**
 * `SchemaRendererProvider` requires a data source, and every schema below
 * carries its rows INLINE — so this one answers with nothing, exactly as the
 * app-shell sweep's does. A chart that started querying instead of plotting
 * its own `data` would show up here as an empty plot, not as a pass.
 */
const NO_ROWS_SOURCE = {
  find: async () => [],
  findOne: async () => null,
  aggregate: async () => [],
  count: async () => 0,
  getObject: async () => null,
};

async function renderSchema(schema: Record<string, unknown>): Promise<HTMLElement> {
  const { container } = render(
    <SchemaRendererProvider dataSource={NO_ROWS_SOURCE as never}>
      <SchemaRenderer schema={schema as never} />
    </SchemaRendererProvider>,
  );
  // `ChartRenderer` is behind a `React.lazy` boundary; the chart shell is what
  // says the implementation module actually landed.
  await waitFor(
    () => {
      const painted =
        container.querySelector('[data-slot="chart"]') ??
        container.querySelector('[data-chart-error]');
      expect(painted, 'the chart never rendered past its Suspense skeleton').not.toBeNull();
    },
    { timeout: 10_000 },
  );
  return container;
}

const marks = (c: HTMLElement, family: string) => c.querySelectorAll(`.recharts-${family}`).length;
const refusal = (c: HTMLElement) =>
  c.querySelector('[data-chart-error]')?.getAttribute('data-chart-error') ?? null;

describe('objectui#7401 — a chart-type registration renders as itself', () => {
  /**
   * Both spellings of the surviving keyword, because the SDUI path reaches one
   * registration by either and the card measured BOTH drawing the default bar.
   * `chart:bar` names the bar family, so this row pins the derivation through
   * the registry; the next row pins the families the retired keywords named,
   * through the spelling that draws them.
   */
  it.each([
    ['chart:bar'],
    ['plugin-charts:chart:bar'],
  ])('%s draws bar marks through the derived family', async (type) => {
    const container = await renderSchema({ type, data: ROWS, xAxisKey: 'xm', series: ONE_SERIES });
    expect(marks(container, 'bar'), `${type} drew no bar`).toBeGreaterThan(0);
    expect(refusal(container)).toBeNull();
  });

  it.each([
    ['pie', 'pie'],
    ['donut', 'pie'],
    ['radar', 'radar'],
  ])('chart with chartType %s draws %s marks and no bars', async (chartType, family) => {
    const container = await renderSchema({ type: 'chart', chartType, data: ROWS, xAxisKey: 'xm', series: ONE_SERIES });
    expect(marks(container, family), `chartType ${chartType} drew no ${family}`).toBeGreaterThan(0);
    expect(marks(container, 'bar'), `chartType ${chartType} still drew bars`).toBe(0);
    expect(refusal(container)).toBeNull();
  });

  /**
   * Donut is a pie with a HOLE, and the hole is a prop rather than a class:
   * `AdvancedChartImpl` draws both families with Recharts' `Pie` and separates
   * them only by `innerRadius` (`'52%'` for donut, `0` for pie). Under the
   * headless DOM the sector's shape layer renders empty — there is no `path`
   * whose geometry could be compared — so the DOM cannot tell the two apart at
   * all, and asserting the mark class alone would let a donut that had
   * silently become a pie pass.
   *
   * The family VALUE is therefore what is pinned for this pair, at the seam
   * that carries it. Both halves are needed: the row above proves the marks
   * reach the DOM, this proves which of the two families they were drawn as.
   */
  it('chartType donut and chartType pie resolve to DIFFERENT families', () => {
    expect(normalizeChartSchema({ type: 'chart', chartType: 'donut' }).chartType).toBe('donut');
    expect(normalizeChartSchema({ type: 'plugin-charts:chart', chartType: 'donut' }).chartType).toBe('donut');
    expect(normalizeChartSchema({ type: 'chart', chartType: 'pie' }).chartType).toBe('pie');
    expect(normalizeChartSchema({ type: 'plugin-charts:chart', chartType: 'pie' }).chartType).toBe('pie');
  });

  /**
   * ⭐ The interaction the ruling asked to be CONFIRMED, not folded in.
   *
   * `scatter-chart` reaching the scatter arm for the first time meant it also
   * reached PR #7400's `scatter-multi-series` refusal (objectui#7194) — which
   * is how the whole defect surfaced: that refusal *should* have reddened the
   * two-series `scatter-chart` entry in `app-shell`'s DOM-leak sweep, and did
   * not. ⛔ Not folded in: #7194 is ruled and landed.
   *
   * objectui#10859 batch 8 (phase 2b) retired the `scatter-chart` key, so the
   * scatter family is pinned through the spelling that draws — the generic
   * `chart` with `chartType: 'scatter'` — and the retired key is pinned ABSENT
   * under both spellings, with no family derived for it.
   */
  it('chart with chartType scatter and one series draws scatter marks', async () => {
    const container = await renderSchema({
      type: 'chart', chartType: 'scatter', data: NUMERIC_ROWS, xAxisKey: 'xm', series: ONE_SERIES,
    });
    expect(marks(container, 'scatter')).toBeGreaterThan(0);
    expect(marks(container, 'bar')).toBe(0);
  });

  it('the retired scatter-chart key is unregistered under both spellings and derives no family', () => {
    // Lit control first: the keyword this package still registers.
    expect(ComponentRegistry.get('chart:bar')).toBe(ChartRenderer);
    expect(ComponentRegistry.get('scatter-chart')).toBeUndefined();
    expect(ComponentRegistry.get('plugin-charts:scatter-chart')).toBeUndefined();
    expect(familyFromComponentType('scatter-chart')).toBeUndefined();
    expect(familyFromComponentType('plugin-charts:scatter-chart')).toBeUndefined();
  });

  it('the retired pie-chart, donut-chart and radar-chart keys are unregistered under both spellings and derive no family', () => {
    // Lit control first, as above. Literal keys, one per assertion.
    expect(ComponentRegistry.get('plugin-charts:chart:bar')).toBe(ChartRenderer);
    expect(ComponentRegistry.get('pie-chart')).toBeUndefined();
    expect(ComponentRegistry.get('plugin-charts:pie-chart')).toBeUndefined();
    expect(ComponentRegistry.get('donut-chart')).toBeUndefined();
    expect(ComponentRegistry.get('plugin-charts:donut-chart')).toBeUndefined();
    expect(ComponentRegistry.get('radar-chart')).toBeUndefined();
    expect(ComponentRegistry.get('plugin-charts:radar-chart')).toBeUndefined();
    expect(familyFromComponentType('pie-chart')).toBeUndefined();
    expect(familyFromComponentType('donut-chart')).toBeUndefined();
    expect(familyFromComponentType('radar-chart')).toBeUndefined();
  });

  /**
   * The card's CONTROL row, unchanged: the generic `chart` type with an
   * explicit `chartType` already reached the family it named, and an explicit
   * `chartType` still wins over the derivation.
   */
  it('plugin-charts:chart with an explicit chartType is unchanged', async () => {
    const container = await renderSchema({
      type: 'plugin-charts:chart', chartType: 'scatter', data: NUMERIC_ROWS, xAxisKey: 'xm', series: TWO_SERIES,
    });
    expect(refusal(container)).toBe('scatter-multi-series');
  });

  it('an explicit chartType wins over the type-derived family', async () => {
    // `chart:bar` derives `bar`; the explicit `line` still wins.
    const container = await renderSchema({
      type: 'chart:bar', chartType: 'line', data: ROWS, xAxisKey: 'xm', series: ONE_SERIES,
    });
    expect(marks(container, 'line')).toBeGreaterThan(0);
    expect(marks(container, 'bar')).toBe(0);
  });
});

/**
 * Ruling item 3 — `packages/plugin-charts/examples/chart-examples.ts` is the
 * in-repo victim the card named (`type: 'pie-chart'`, drawing a bar). It is
 * confirmed here rather than argued: the example object itself is rendered.
 *
 * objectui#10859 batch 8 (phase 2c, the seat's fork ruling) moved the three
 * examples to the spelling that draws — `{ type: 'chart', chartType }` — before
 * retiring the keys they used to author. The intent of this pin survives the
 * move: each example still draws the family it names and no bar. The spelling
 * is pinned too, so an example cannot drift back onto a retired key.
 */
describe('objectui#7401 — the in-repo examples draw what they say', () => {
  it.each([
    ['pieChartExample', 'pie', 'pie', pieChartExample],
    ['donutChartExample', 'donut', 'pie', donutChartExample],
    ['radarChartExample', 'radar', 'radar', radarChartExample],
  ])('%s (chartType %s) draws %s marks and no bars', async (_name, chartType, family, example) => {
    expect((example as Record<string, unknown>).type).toBe('chart');
    expect((example as Record<string, unknown>).chartType).toBe(chartType);
    const container = await renderSchema(example as Record<string, unknown>);
    expect(marks(container, family)).toBeGreaterThan(0);
    expect(marks(container, 'bar')).toBe(0);
  });
});

/**
 * The two halves of the ONE mechanism, pinned against each other.
 *
 * The family table and the `register()` calls are in different files, so
 * either can be edited alone. These make that a red test rather than a chart
 * that silently draws a bar again — which is the exact failure the removed
 * `defaultProps` produced for two years.
 */
describe('objectui#7401 — the family table and the registry agree', () => {
  const NAMESPACE = 'plugin-charts';
  /** The generic type: it carries no family of its own by design. */
  const GENERIC = 'chart';

  it('every keyword in the table is registered to ChartRenderer, both spellings', () => {
    for (const keyword of CHART_TYPE_KEYWORD_FAMILIES.keys()) {
      expect(ComponentRegistry.get(keyword), `${keyword} is not registered`).toBe(ChartRenderer);
      expect(
        ComponentRegistry.get(`${NAMESPACE}:${keyword}`),
        `${NAMESPACE}:${keyword} is not registered`,
      ).toBe(ChartRenderer);
      expect(familyFromComponentType(keyword)).toBe(CHART_TYPE_KEYWORD_FAMILIES.get(keyword));
      expect(familyFromComponentType(`${NAMESPACE}:${keyword}`)).toBe(
        CHART_TYPE_KEYWORD_FAMILIES.get(keyword),
      );
    }
  });

  it('every ChartRenderer registration except the generic `chart` names a family', () => {
    const bareTypes = new Set(
      ComponentRegistry.getNamespaceComponents(NAMESPACE)
        .filter((config) => config.component === ChartRenderer)
        .map((config) => config.type.replace(`${NAMESPACE}:`, '')),
    );
    const unnamed = [...bareTypes].filter(
      (type) => type !== GENERIC && !CHART_TYPE_KEYWORD_FAMILIES.has(type),
    );
    expect(
      unnamed,
      'these render through ChartRenderer with no family — they will draw a BAR ' +
        '(objectui#7401). Add each to CHART_TYPE_KEYWORD_FAMILIES.',
    ).toEqual([]);
  });

  it('a type that names no registered keyword derives nothing', () => {
    // The honest answer; the caller's own default is better than a guess.
    expect(familyFromComponentType('object-chart')).toBeUndefined();
    expect(familyFromComponentType('chart')).toBeUndefined();
    expect(familyFromComponentType(undefined)).toBeUndefined();
    // ⛔ Not a `-chart` SUFFIX rule: `funnel-chart` is not a registered
    // keyword, so it resolves to nothing rather than to a family no
    // registration draws.
    expect(familyFromComponentType('funnel-chart')).toBeUndefined();
  });
});
