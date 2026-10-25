/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * A series bound to a key NO row carries (objectui#10396, the objectui#8266
 * shape): the tile says so, naming the column, instead of drawing an axis frame
 * with zero marks.
 *
 * The series half of `missing-category-key` (framework#4033). Rows that carry
 * `count` under a series bound to `value` drew the categories and nothing else,
 * and nothing said so: `missing-category-key` was satisfied (the rows DO carry
 * the category), `no-plottable-series` keys on `series: []`, and
 * `no-numeric-value` (objectui#7195) keeps a key no row carries out of its
 * answer on purpose. Every refused shape below drew 0 marks on the base tree,
 * and every shape pinned as drawing drew marks; the counts are re-derived in
 * this file under the package's fixed 480x320 harness.
 *
 * ## What it asks: key ABSENT, on EVERY row, for EVERY bound series
 *
 * `key in row`, the category guard's own test. One row carrying the key draws;
 * one series whose key a row carries draws; a key present with a `null` value
 * is `no-numeric-value`'s diagnosis, not this one. A path-shaped key (`a.b`,
 * which Recharts walks through `get`) is never judged absent.
 */
import React from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render as rtlRender, cleanup, type RenderOptions } from '@testing-library/react';
import { I18nProvider } from '@object-ui/i18n';

vi.mock('recharts', async () => {
  const actual = await vi.importActual<any>('recharts');
  return {
    ...actual,
    ResponsiveContainer: ({ children }: any) =>
      React.cloneElement(children, { width: 480, height: 320 }),
  };
});

import AdvancedChartImpl from './AdvancedChartImpl';

/**
 * Mounted under an `I18nProvider`, as the console always does, so the
 * provider-less `NO_I18NEXT_INSTANCE` notice cannot reach the `console.warn`
 * spy that reads the chart's own diagnostics.
 */
function EnSession({ children }: { children: React.ReactNode }) {
  return (
    <I18nProvider config={{ defaultLanguage: 'en', detectBrowserLanguage: false }} persistLanguage={false}>
      {children}
    </I18nProvider>
  );
}
const render = ((ui: React.ReactElement, options?: RenderOptions) =>
  rtlRender(ui, { wrapper: EnSession, ...options })) as typeof rtlRender;

// The chart's own diagnostics are read off this spy; one per test, so a
// loop of renders inside one test counts into the same record.
beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

type Row = Record<string, unknown>;

const CODE = 'missing-series-key';
const refusalOf = (c: HTMLElement) => c.querySelector(`[data-chart-error="${CODE}"]`);
const anyRefusalOf = (c: HTMLElement) =>
  c.querySelector('[data-chart-error]')?.getAttribute('data-chart-error') ?? null;
const plotOf = (c: HTMLElement) => c.querySelector('[data-slot="chart"]');

/** Every mark a cartesian family paints, as a count of non-empty shapes. */
const marksOf = (c: HTMLElement) =>
  c.querySelectorAll('path.recharts-rectangle').length +
  Array.from(c.querySelectorAll('.recharts-line-curve, .recharts-area-area')).filter(
    (p) => (p.getAttribute('d') ?? '').length > 0,
  ).length;

/** The rows a fieldless count returns: the measure is keyed `count`. */
const COUNT_ROWS: Row[] = [{ k: 'a', count: 2 }, { k: 'b', count: 5 }];

const renderFamily = (
  chartType: string,
  data: Row[],
  series: Array<Record<string, unknown>>,
  props: Record<string, unknown> = {},
) =>
  render(
    <AdvancedChartImpl
      chartType={chartType as any}
      xAxisKey="k"
      series={series as any}
      data={data as any}
      isAnimationActive={false}
      {...(props as any)}
    />,
  );

/**
 * The series-only families — the card's four (bar, line, area, combo), plus
 * `column` (the spec alias of `bar`) and `horizontal-bar`, which share the
 * same cartesian tail.
 */
const FAMILIES = ['bar', 'column', 'horizontal-bar', 'line', 'area', 'combo'];

describe('objectui#10396 — THE CONTROL: a key the rows carry draws, so every zero below carries information', () => {
  for (const family of FAMILIES) {
    it(`${family}: series bound to the carried column draws`, () => {
      const { container } = renderFamily(family, COUNT_ROWS, [{ dataKey: 'count' }]);
      expect(marksOf(container)).toBeGreaterThan(0);
      expect(anyRefusalOf(container)).toBeNull();
    });
  }
});

describe('objectui#10396 — a series key no row carries is refused, naming the column', () => {
  for (const family of FAMILIES) {
    it(`${family}: refused with ${CODE}, the missing key named`, () => {
      const { container } = renderFamily(family, COUNT_ROWS, [{ dataKey: 'value' }]);
      const refusal = refusalOf(container);
      expect(refusal).not.toBeNull();
      expect(refusal!.getAttribute('role')).toBe('status');
      expect(refusal!.textContent).toContain('no row has a value field');
      expect(refusal!.querySelector('code')?.textContent).toBe('value');
      expect(plotOf(container)).toBeNull();
      expect(marksOf(container)).toBe(0);
    });
  }

  it('every bound key absent: refused, naming each of them', () => {
    const { container } = renderFamily('bar', COUNT_ROWS, [{ dataKey: 'value' }, { dataKey: 'amount' }]);
    expect(refusalOf(container)!.textContent).toContain('no row has a value or amount field');
  });

  it('warns once, naming the missing key and the keys the rows DO carry', () => {
    const { container } = renderFamily('bar', COUNT_ROWS, [{ dataKey: 'value' }]);
    expect(refusalOf(container)).not.toBeNull();
    const warn = vi.mocked(console.warn);
    expect(warn).toHaveBeenCalledTimes(1);
    const msg = String(warn.mock.calls[0]?.[0] ?? '');
    expect(msg).toContain('value');
    expect(msg).toContain('count');
  });

  for (const family of FAMILIES) {
    it(`${family}: refused whatever else the tile declares — a stack, a declared scale, a second axis`, () => {
      // Each of these drew 0 marks on the base tree: none gives a mark a value.
      for (const [series, props] of [
        [[{ dataKey: 'value', stack: 's' }], {}],
        [[{ dataKey: 'value' }], { yAxes: [{ min: 0, max: 10 }] }],
        [[{ dataKey: 'value' }], { yAxes: [{ min: 0, stepSize: 2 }] }],
        [
          [{ dataKey: 'value' }, { dataKey: 'amount', yAxis: 'right' }],
          { yAxes: [{ position: 'left' }, { position: 'right' }] },
        ],
      ] as Array<[Array<Record<string, unknown>>, Record<string, unknown>]>) {
        const { container } = renderFamily(family, COUNT_ROWS, series, props);
        expect(refusalOf(container), JSON.stringify({ series, props })).not.toBeNull();
        cleanup();
      }
    });
  }
});

describe('objectui#10396 — what must keep DRAWING, with no refusal', () => {
  for (const family of FAMILIES) {
    it(`${family}: ONE row carrying the key draws`, () => {
      const { container } = renderFamily(family, [{ k: 'a', value: 3 }, { k: 'b', count: 5 }], [{ dataKey: 'value' }]);
      expect(marksOf(container)).toBeGreaterThan(0);
      expect(anyRefusalOf(container)).toBeNull();
    });

    it(`${family}: an absent key beside a carried one draws the carried one`, () => {
      const { container } = renderFamily(family, COUNT_ROWS, [{ dataKey: 'value' }, { dataKey: 'count' }]);
      expect(marksOf(container)).toBeGreaterThan(0);
      expect(anyRefusalOf(container)).toBeNull();
    });

    it(`${family}: a DOTTED key Recharts resolves through \`get\` draws — a path is never judged absent`, () => {
      const { container } = renderFamily(family, [{ k: 'a', a: { b: 3 } }, { k: 'b', a: { b: 5 } }], [{ dataKey: 'a.b' }]);
      expect(marksOf(container)).toBeGreaterThan(0);
      expect(anyRefusalOf(container)).toBeNull();
    });
  }

  it('a dual-axis tile with one axis bound to a carried key draws it', () => {
    const { container } = renderFamily(
      'bar',
      COUNT_ROWS,
      [{ dataKey: 'count' }, { dataKey: 'amount', yAxis: 'right' }],
      { yAxes: [{ position: 'left' }, { position: 'right' }] },
    );
    expect(marksOf(container)).toBeGreaterThan(0);
    expect(anyRefusalOf(container)).toBeNull();
  });
});

describe('objectui#10396 — the seams with the refusals already on this surface', () => {
  it('missing-category-key WINS when the category key is absent too (the objectui#8269 name/value pair)', () => {
    const { container } = renderFamily('bar', COUNT_ROWS, [{ dataKey: 'value' }], { xAxisKey: 'name' });
    expect(anyRefusalOf(container)).toBe('missing-category-key');
  });

  it('no-plottable-series still owns "no series at all"', () => {
    const { container } = renderFamily('bar', COUNT_ROWS, []);
    expect(anyRefusalOf(container)).toBe('no-plottable-series');
  });

  it('a key PRESENT with a null value on every row is no-numeric-value, not this code', () => {
    const { container } = renderFamily('bar', [{ k: 'a', value: null }, { k: 'b', value: null }], [{ dataKey: 'value' }]);
    expect(anyRefusalOf(container)).toBe('no-numeric-value');
  });

  it('an absent key beside an all-boolean one: neither refusal fires (measured, 0 marks, as on the base tree)', () => {
    // Two diagnoses on one tile. The absent key keeps `no-numeric-value`
    // silent (its resolved-key gate), and this refusal fires only when EVERY
    // bound key is absent, so the carried `w` keeps it silent too.
    const { container } = renderFamily('bar', [{ k: 'a', w: true }, { k: 'b', w: false }], [{ dataKey: 'value' }, { dataKey: 'w' }]);
    expect(anyRefusalOf(container)).toBeNull();
    expect(marksOf(container)).toBe(0);
  });

  it('a path-shaped key that resolves nothing stays silent (0 marks, as on the base tree)', () => {
    const { container } = renderFamily('bar', COUNT_ROWS, [{ dataKey: 'a.b' }]);
    expect(anyRefusalOf(container)).toBeNull();
  });

  it('scatter and the magnitude families never receive this code', () => {
    for (const family of ['scatter', 'pie', 'donut', 'funnel', 'treemap', 'radar']) {
      const { container } = renderFamily(family, COUNT_ROWS, [{ dataKey: 'value' }]);
      expect(refusalOf(container), `${family} must not get ${CODE}`).toBeNull();
      cleanup();
    }
  });

  it('prints no warning when a key is carried', () => {
    renderFamily('bar', COUNT_ROWS, [{ dataKey: 'count' }]);
    expect(vi.mocked(console.warn)).not.toHaveBeenCalled();
  });
});
