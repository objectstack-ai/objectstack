/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#10587 — the spec `xAxis.position` places the x axis.
 *
 * `position` is one of the keys of `@objectstack/spec`'s `ChartAxisSchema`,
 * which `ChartSchema.xAxis` takes by reference; since objectui#10516 the
 * normalizer keeps it on the x-axis object. No `<XAxis>` read it, so
 * `position: 'top'` validated, survived normalization and drew the axis along
 * the bottom.
 *
 * These go through `ChartRenderer`, the component `type: 'chart'` resolves to,
 * with the axis written in the spec's shape, so the normalizer and the
 * renderer run as one path. The reading is the rendered DOM: recharts stamps
 * each tick label with the `orientation` of the axis that drew it.
 *
 * The mapping these pin is `placeXAxis`'s:
 *   - bar / line / area / combo / scatter — the x axis runs across the plot:
 *     `top` / `bottom` place it, `left` / `right` are refused;
 *   - horizontal-bar — the `xAxis` object configures the category axis, which
 *     runs down the plot: `left` / `right` place it, `top` / `bottom` are
 *     refused.
 * A refused side leaves the axis at its default side and adds the
 * `x-axis-position` note naming the key. Every case that names an open side
 * (and every case that names none) is also the control that no note appears.
 */

import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, waitFor } from '@testing-library/react';

// Recharts' ResponsiveContainer measures via ResizeObserver, which reports 0x0
// under the headless DOM, so nothing paints. Hand it a fixed box.
vi.mock('recharts', async () => {
  const actual = await vi.importActual<typeof import('recharts')>('recharts');
  return {
    ...actual,
    ResponsiveContainer: ({ children }: { children: React.ReactElement<{ width?: number; height?: number }> }) =>
      React.cloneElement(children, { width: 510, height: 350 }),
  };
});

import { ChartRenderer } from './ChartRenderer';
// `ChartRenderer` lazy-loads `./AdvancedChartImpl`. Importing it here with the
// SAME specifier moves that cost into the import phase, which no test timeout
// applies to (AGENTS.md "测试纪律").
import './AdvancedChartImpl';

afterEach(cleanup);

const ROWS = [
  { month: 'Jan', revenue: 10, cost: 3 },
  { month: 'Feb', revenue: 20, cost: 5 },
  { month: 'Mar', revenue: 15, cost: 4 },
];
const CATEGORIES = new Set(ROWS.map((r) => r.month));

type Side = 'left' | 'right' | 'top' | 'bottom';

async function draw(
  chartType: string,
  xAxis: Record<string, unknown>,
  extra: Record<string, unknown> = {},
  data: Array<Record<string, unknown>> = ROWS,
) {
  const { container } = render(
    <ChartRenderer
      schema={{
        type: 'chart',
        chartType,
        data,
        xAxis,
        yAxis: [{ field: 'revenue' }],
        isAnimationActive: false,
        ...extra,
      } as never}
    />,
  );
  await waitFor(() => expect(container.querySelector('.recharts-surface')).toBeTruthy());
  return container;
}

const tickTexts = (c: HTMLElement) => [...c.querySelectorAll('text.recharts-cartesian-axis-tick-value')];

/** The sides the CATEGORY tick labels (`Jan` / `Feb` / `Mar`) were drawn on. */
const categorySides = (c: HTMLElement) =>
  [...new Set(tickTexts(c).filter((t) => CATEGORIES.has((t.textContent ?? '').trim())).map((t) => t.getAttribute('orientation')))];

/** Every side any tick label was drawn on. */
const allSides = (c: HTMLElement) => new Set(tickTexts(c).map((t) => t.getAttribute('orientation')));

const positionNote = (c: HTMLElement) => c.querySelector('[data-chart-note="x-axis-position"]');

const at = (position: Side | undefined) => ({ field: 'month', ...(position ? { position } : {}) });

const COMBO = { series: [{ name: 'revenue', type: 'bar' }, { name: 'cost', type: 'line' }] };

describe('objectui#10587 — `xAxis.position` places an x axis that runs across the plot', () => {
  it.each(['bar', 'line', 'area'])('%s: `top` draws the category axis along the top', async (chartType) => {
    const c = await draw(chartType, at('top'));
    expect(categorySides(c), '`position: top` was not read by the x axis').toEqual(['top']);
    expect(positionNote(c)).toBeNull();
  });

  it('combo: `top` draws the category axis along the top', async () => {
    const c = await draw('bar', at('top'), COMBO);
    expect(categorySides(c)).toEqual(['top']);
    expect(positionNote(c)).toBeNull();
  });

  it('scatter: `top` draws the measure x axis along the top', async () => {
    const c = await draw('scatter', { field: 'cost', position: 'top' });
    const sides = allSides(c);
    expect(sides.has('top'), 'the scatter x axis ignored `position: top`').toBe(true);
    expect(sides.has('bottom')).toBe(false);
    expect(positionNote(c)).toBeNull();
  });

  it.each([
    ['bar', 'bottom'],
    ['bar', undefined],
    ['line', 'bottom'],
    ['line', undefined],
    ['area', 'bottom'],
    ['area', undefined],
  ] as const)('(control) %s with position %s draws the category axis along the bottom', async (chartType, position) => {
    const c = await draw(chartType, at(position));
    expect(categorySides(c)).toEqual(['bottom']);
    expect(positionNote(c)).toBeNull();
  });

  it('(control) scatter with no position draws its x axis along the bottom', async () => {
    const c = await draw('scatter', { field: 'cost' });
    expect(allSides(c).has('bottom')).toBe(true);
    expect(allSides(c).has('top')).toBe(false);
  });
});

describe('objectui#10587 — on horizontal-bar `xAxis.position` places the category axis, which runs down the plot', () => {
  it('`right` draws the category axis on the right', async () => {
    const c = await draw('horizontal-bar', at('right'));
    expect(categorySides(c), 'horizontal-bar ignored `xAxis.position: right`').toEqual(['right']);
    expect(positionNote(c)).toBeNull();
  });

  it.each(['left', undefined] as const)('(control) position %s draws the category axis on the left', async (position) => {
    const c = await draw('horizontal-bar', at(position));
    expect(categorySides(c)).toEqual(['left']);
    expect(positionNote(c)).toBeNull();
  });

  it.each(['top', 'bottom'] as const)('`%s` is refused: the note names `xAxis.position` and the axis stays on the left', async (position) => {
    const c = await draw('horizontal-bar', at(position));
    const note = positionNote(c);
    expect(note, `horizontal-bar took \`xAxis.position: ${position}\` in silence`).not.toBeNull();
    expect(note!.textContent).toContain('xAxis.position');
    expect(note!.textContent).toContain(position);
    // The chart still draws: the category axis sits at its default side.
    expect(categorySides(c)).toEqual(['left']);
  });
});

describe('objectui#10587 — `left` / `right` on an x axis that runs across the plot are refused, loudly', () => {
  it.each([
    ['bar', 'left'],
    ['bar', 'right'],
    ['line', 'left'],
    ['line', 'right'],
    ['area', 'left'],
    ['area', 'right'],
  ] as const)('%s: `%s` adds the note naming `xAxis.position`, and the axis stays at the bottom', async (chartType, position) => {
    const c = await draw(chartType, at(position));
    const note = positionNote(c);
    expect(note, `\`xAxis.position: ${position}\` was taken in silence`).not.toBeNull();
    expect(note!.textContent).toContain('xAxis.position');
    expect(note!.textContent).toContain(position);
    expect(categorySides(c)).toEqual(['bottom']);
  });

  it('combo: `left` adds the same note', async () => {
    const c = await draw('bar', at('left'), COMBO);
    expect(positionNote(c)).not.toBeNull();
    expect(categorySides(c)).toEqual(['bottom']);
  });

  it('scatter: `right` adds the same note', async () => {
    const c = await draw('scatter', { field: 'cost', position: 'right' });
    expect(positionNote(c)).not.toBeNull();
    expect(allSides(c).has('bottom')).toBe(true);
  });
});

describe('objectui#10587 — a top x axis keeps its title and rotated labels on the far side from the plot', () => {
  /** The rendered `y` of the axis title and of each category tick label. */
  const geometry = (c: HTMLElement) => {
    const title = [...c.querySelectorAll('text.recharts-label')].find((t) => (t.textContent ?? '').trim() === 'Month');
    const ticks = tickTexts(c).filter((t) => CATEGORIES.has((t.textContent ?? '').trim()));
    return { titleY: Number(title?.getAttribute('y')), tickYs: ticks.map((t) => Number(t.getAttribute('y'))) };
  };

  it('`top`: the title sits above the tick labels', async () => {
    const c = await draw('bar', { ...at('top'), title: 'Month' });
    const { titleY, tickYs } = geometry(c);
    expect(tickYs.length).toBe(3);
    expect(Number.isFinite(titleY)).toBe(true);
    expect(titleY).toBeLessThan(Math.min(...tickYs));
  });

  it('(control) `bottom`: the title sits below the tick labels', async () => {
    const c = await draw('bar', { ...at('bottom'), title: 'Month' });
    const { titleY, tickYs } = geometry(c);
    expect(tickYs.length).toBe(3);
    expect(titleY).toBeGreaterThan(Math.max(...tickYs));
  });

  const LONG = [
    { month: 'Quarter One', revenue: 10 },
    { month: 'Quarter Two', revenue: 20 },
  ];
  const rotations = (c: HTMLElement) =>
    tickTexts(c)
      .filter((t) => (t.textContent ?? '').startsWith('Quarter'))
      .map((t) => /rotate\((-?\d+)/.exec(t.getAttribute('transform') ?? '')?.[1]);

  it('`top`: long labels slant up, away from the plot', async () => {
    const c = await draw('bar', at('top'), {}, LONG);
    expect(rotations(c)).toEqual(['35', '35']);
  });

  it('(control) `bottom`: long labels slant down, away from the plot', async () => {
    const c = await draw('bar', at('bottom'), {}, LONG);
    expect(rotations(c)).toEqual(['-35', '-35']);
  });
});
