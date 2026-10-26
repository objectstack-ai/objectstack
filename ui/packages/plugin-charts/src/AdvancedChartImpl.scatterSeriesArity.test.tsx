/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * Scatter — handed MORE THAN ONE series (objectui#7194). The fifth mechanism
 * on this surface, and the first whose input is VALID.
 *
 * ## Why this is not another degenerate-data card
 *
 * Every refusal before it (objectui#7146 / #7147 / #7148 / #7171) answers a
 * row the chart genuinely could not draw. Here the rows are fine. Scatter
 * binds ONE measure — `series[0].dataKey` is the `YAxis` key and every
 * `<Scatter>` reads the same rows through it — so a second series added a
 * colour and a legend entry and nothing else. Measured on `origin/main`:
 * `series: [{ dataKey: 'ym' }, { dataKey: 'zm' }]` over two rows painted FOUR
 * `path.recharts-symbols` at TWO distinct transforms, each drawn twice, and
 * `zm`'s values (5 and 90) were nowhere on the plot. The picture was
 * well-formed and false, and nothing on screen could say so.
 *
 * Ruled B (maintainer, 2026-09-02): refuse a second series loudly under the
 * file's existing refusal shell; do not build the multi-measure projection
 * (option A) until a real caller needs it; do not pin the wrong picture as
 * intended (option C). Render-time only — the authoring-time rejection follows
 * objectui#7113's shape when that card rules.
 *
 * The first test is the load-bearing one, for the reason
 * `AdvancedChartImpl.degeneratePosition.test.tsx` gives: a control that draws
 * nothing makes every zero below it void. It asserts the single-series control
 * DRAWS, and that its picture is byte-identical in the one way that matters —
 * no refusal, no wrapper.
 */
import React from 'react';
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { I18nProvider } from '@object-ui/i18n';
import { builtInLocales } from '@object-ui/i18n/locales';

vi.mock('recharts', async () => {
  const actual = await vi.importActual<any>('recharts');
  return {
    ...actual,
    ResponsiveContainer: ({ children }: any) =>
      React.cloneElement(children, { width: 480, height: 320 }),
  };
});

import AdvancedChartImpl from './AdvancedChartImpl';

afterEach(cleanup);

type Row = Record<string, unknown>;

/** The card's own fixture: two measures, both plottable on every row. */
const ROWS: Row[] = [{ xm: 10, ym: 40, zm: 5 }, { xm: 20, ym: 25, zm: 90 }];
const ONE_SERIES = [{ dataKey: 'ym', label: 'Y' }];
const TWO_SERIES = [{ dataKey: 'ym', label: 'Y' }, { dataKey: 'zm', label: 'Z' }];

/** The sentence the `en` pack carries — the provider-less fallback must equal it. */
const EN_COPY = 'A scatter plots one measure. Keep exactly one series:';

const renderScatter = (series: unknown, data: Row[] = ROWS, props: Record<string, unknown> = {}) =>
  render(
    <AdvancedChartImpl
      chartType="scatter"
      xAxisKey="xm"
      series={series as any}
      data={data as any}
      isAnimationActive={false}
      {...(props as any)}
    />,
  );

const arityRefusalOf = (c: HTMLElement) => c.querySelector('[data-chart-error="scatter-multi-series"]');
const positionRefusalOf = (c: HTMLElement) => c.querySelector('[data-chart-error="no-plottable-points"]');
const anyRefusalOf = (c: HTMLElement) => c.querySelector('[data-chart-error]');
const plotOf = (c: HTMLElement) => c.querySelector('[data-slot="chart"]');
/** Recharts paints one `path.recharts-symbols` per PLACED point. */
const marksOf = (c: HTMLElement) => c.querySelectorAll('path.recharts-symbols').length;

describe('objectui#7194 — THE CONTROL. A single-series scatter is unchanged', () => {
  it('draws every row, with no refusal and no note', () => {
    const { container } = renderScatter(ONE_SERIES);
    expect(marksOf(container), 'the single-series control MUST draw').toBe(2);
    expect(plotOf(container)).not.toBeNull();
    expect(anyRefusalOf(container)).toBeNull();
    expect(container.querySelector('[data-chart-note]')).toBeNull();
  });

  it('`series: []` and no `series` at all still reach the chart through the `value` fallback', () => {
    // Pinned by `AdvancedChartImpl.unprojectedSeriesDimension.test.tsx` from
    // the other side; re-asserted here because the guard reads
    // `series.length`, and "more than one" must never be read as "not one".
    // Asserted the way that pin asserts it — the chart container and its svg
    // paint — not by mark count: with no series there is no `<Scatter>`
    // element to paint marks, which is that fallback's shape, not a refusal.
    const rows: Row[] = [{ xm: 12, value: 30 }, { xm: 20, value: 45 }];
    for (const series of [[], undefined]) {
      const { container } = renderScatter(series, rows);
      expect(anyRefusalOf(container), `series=${JSON.stringify(series)} is not refused`).toBeNull();
      expect(plotOf(container), `series=${JSON.stringify(series)} reaches the chart`).not.toBeNull();
      expect(container.querySelector('svg'), `series=${JSON.stringify(series)} paints`).not.toBeNull();
      cleanup();
    }
  });
});

describe('objectui#7194 — a scatter handed two or more series refuses', () => {
  it('two series ⇒ the refusal surface, and NOTHING is drawn', () => {
    const { container } = renderScatter(TWO_SERIES);
    const refusal = arityRefusalOf(container);
    expect(refusal, 'the refusal shell must render').not.toBeNull();
    // The shell's own contract: a state, not an alert.
    expect(refusal!.getAttribute('role')).toBe('status');
    // The false picture must be GONE, not sitting under the refusal: no chart
    // container, no symbols — before this card the same input painted four.
    expect(plotOf(container)).toBeNull();
    expect(marksOf(container)).toBe(0);
    expect(container.querySelector('.recharts-legend-wrapper')).toBeNull();
  });

  it('the copy states that a scatter plots ONE measure and names the fix, then lists every key it was handed', () => {
    const { container } = renderScatter(TWO_SERIES);
    const text = arityRefusalOf(container)!.textContent ?? '';
    expect(text).toContain(EN_COPY);
    // Both keys, as data outside the sentence, so the author can see WHICH
    // series to drop without diffing their spec against the chart.
    const codes = [...arityRefusalOf(container)!.querySelectorAll('code')].map((c) => c.textContent);
    expect(codes).toEqual(['ym', 'zm']);
  });

  it('three series refuse too — the predicate is "more than one", not "exactly two"', () => {
    const { container } = renderScatter([...TWO_SERIES, { dataKey: 'xm', label: 'X' }]);
    expect(arityRefusalOf(container)).not.toBeNull();
    const codes = [...arityRefusalOf(container)!.querySelectorAll('code')].map((c) => c.textContent);
    expect(codes).toEqual(['ym', 'zm', 'xm']);
  });

  it('the BINDING refusal wins over the positional one when both apply', () => {
    // Two series over rows none of which can be placed: the spec is wrong
    // whatever the rows say, so that is the sentence the author gets — the
    // same precedence the missing-category-key guard has over the series
    // guard. Fixing the rows would only reveal the binding fault next.
    const { container } = renderScatter(TWO_SERIES, [{ xm: null, ym: null, zm: null }, { xm: 'n/a', ym: 'n/a', zm: 'n/a' }]);
    expect(arityRefusalOf(container)).not.toBeNull();
    expect(positionRefusalOf(container)).toBeNull();
  });

  it('is a statement about the SPEC, so it holds with no rows at all', () => {
    // Unlike the four data refusals (each gated on `total > 0` because a
    // sentence about rows needs rows), "you declared two series" is true of
    // an empty result too — and it would be the tile's final state whatever
    // the query returned.
    const { container } = renderScatter(TWO_SERIES, []);
    expect(arityRefusalOf(container)).not.toBeNull();
  });

  it('prints no console warning, matching the three scatter/magnitude answers in this file', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    renderScatter(TWO_SERIES);
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it('is scatter-specific — a two-series bar still draws both series', () => {
    // The multi-series families read every `series[].dataKey` off the rows;
    // only scatter routes all of them through one axis. The guard must not
    // widen past the family whose defect it answers.
    const { container } = render(
      <AdvancedChartImpl
        chartType="bar"
        xAxisKey="name"
        series={TWO_SERIES as any}
        data={[{ name: 'a', ym: 40, zm: 5 }, { name: 'b', ym: 25, zm: 90 }] as any}
        isAnimationActive={false}
      />,
    );
    expect(anyRefusalOf(container)).toBeNull();
    expect(container.querySelectorAll('.recharts-bar').length).toBe(2);
  });
});

describe('objectui#7194 — the copy lives in the locale packs', () => {
  it('the `en` pack carries the sentence the provider-less fallback renders', () => {
    // ⛔ NO gate covers this equality — this assertion is the only thing
    // holding the inline fallback and the `en` pack value together, so deleting
    // it as redundant silently un-guards them.
    //
    // `check:i18n-keys` compares an inline default against its pack value only
    // when it is written as an options bag: `inlineDefaultValue`
    // (`scripts/check-i18n-call-site-keys.mjs`) reads a `defaultValue` property
    // off an object literal, and `interpolationOptions` skips a positional
    // string outright. This call site passes the English POSITIONALLY —
    // `tt('chart.scatterOneMeasure', 'A scatter plots one measure. …')` — so no
    // gate ever sees the pair. Measured on this head: with the inline fallback
    // changed to `Keep ONE series:`, all three i18n gates (`check:i18n-keys`,
    // `check:i18n-drift`, `check:i18n-dead-keys`) still exit 0. This test is
    // what goes red.
    expect(builtInLocales.en.chart.scatterOneMeasure).toBe(EN_COPY);
    const { container } = renderScatter(TWO_SERIES);
    expect(arityRefusalOf(container)!.textContent).toContain(EN_COPY);
  });

  it('every built-in pack carries it, and none copies the English', () => {
    for (const [lang, pack] of Object.entries(builtInLocales)) {
      const value = (pack as typeof builtInLocales.en).chart.scatterOneMeasure;
      expect(typeof value, `${lang} defines chart.scatterOneMeasure`).toBe('string');
      expect(value.length, `${lang} is not empty`).toBeGreaterThan(0);
      if (lang !== 'en') expect(value, `${lang} is translated`).not.toBe(EN_COPY);
    }
  });

  it('under a provider the sentence resolves from the pack, not the fallback', () => {
    const { container } = render(
      <I18nProvider config={{ defaultLanguage: 'zh', detectBrowserLanguage: false, resources: {} }}>
        <AdvancedChartImpl
          chartType="scatter"
          xAxisKey="xm"
          series={TWO_SERIES as any}
          data={ROWS as any}
          isAnimationActive={false}
        />
      </I18nProvider>,
    );
    const text = arityRefusalOf(container)!.textContent ?? '';
    expect(text).toContain(builtInLocales.zh.chart.scatterOneMeasure);
    expect(text).not.toContain(EN_COPY);
    // The keys are data and are not translated.
    const codes = [...arityRefusalOf(container)!.querySelectorAll('code')].map((c) => c.textContent);
    expect(codes).toEqual(['ym', 'zm']);
  });
});
