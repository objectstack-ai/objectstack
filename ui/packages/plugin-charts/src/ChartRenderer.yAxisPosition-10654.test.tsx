/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#10654 — the spec `yAxis[].position` places each value axis, and
 * `horizontal-bar` lays out and binds its axes (the y-side twin of
 * objectui#10587, with objectui#10655 folded in).
 *
 * One enumeration over the card's rows. Each row is measured against the
 * `bar` control that draws the same thing correctly, so a row that goes green
 * because nothing renders at all fails its control instead.
 *
 * These go through `ChartRenderer`, the component `type: 'chart'` resolves to,
 * with the axes written in the spec's shape, so the normalizer (which binds a
 * derived series to its entry's axis) and the renderer (which places the axes)
 * run as one path. The readings are the rendered DOM: recharts stamps each tick
 * label with the `orientation` of the axis that drew it, draws an axis title as
 * a `text.recharts-label`, and draws one `.recharts-bar-rectangle` per bar.
 *
 * The rule these pin is `placeYAxes`'s (see its doc comment): a side a value
 * axis cannot take is refused with a note naming `yAxis[N].position`; an open
 * side is honoured; when both entries name the same side the first keeps it;
 * an entry naming no side takes the one left free.
 *
 * Rows 10 and 11 are the same family on the axes this change places: a
 * right-hand value axis's title laid out between the plot and its tick labels,
 * and a grid or an annotation bound to an axis id the branch does not render
 * (see `valueAxisIdFor`).
 */

import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, waitFor } from '@testing-library/react';

// Recharts' ResponsiveContainer measures via ResizeObserver, which reports 0x0
// under the headless DOM, so nothing paints. Hand it a fixed box (the literal
// is `WIDTH` below; a hoisted mock factory cannot read a module constant).
vi.mock('recharts', async () => {
  const actual = await vi.importActual<typeof import('recharts')>('recharts');
  return {
    ...actual,
    ResponsiveContainer: ({ children }: { children: React.ReactElement<{ width?: number; height?: number }> }) =>
      React.cloneElement(children, { width: 510, height: 350 }),
  };
});

import { ChartRenderer } from './ChartRenderer';
import { normalizeChartSchema } from './normalizeChartSchema';
// `ChartRenderer` lazy-loads `./AdvancedChartImpl`. Importing it here with the
// SAME specifier moves that cost into the import phase, which no test timeout
// applies to (AGENTS.md "测试纪律").
import './AdvancedChartImpl';

afterEach(cleanup);

const WIDTH = 510;
const ROWS = [
  { month: 'Jan', revenue: 10, cost: 3 },
  { month: 'Feb', revenue: 20, cost: 5 },
  { month: 'Mar', revenue: 15, cost: 4 },
];
const CATEGORIES = new Set(ROWS.map((r) => r.month));

type Side = 'left' | 'right' | 'top' | 'bottom';

async function draw(schema: Record<string, unknown>) {
  const { container } = render(
    <ChartRenderer
      schema={{ type: 'chart', data: ROWS, xAxis: { field: 'month' }, isAnimationActive: false, ...schema } as never}
    />,
  );
  await waitFor(() => expect(container.querySelector('.recharts-surface')).toBeTruthy());
  return container;
}

const tickTexts = (c: HTMLElement) => [...c.querySelectorAll('text.recharts-cartesian-axis-tick-value')];
const isCategory = (t: Element) => CATEGORIES.has((t.textContent ?? '').trim());

/** The sides the VALUE tick labels were drawn on. */
const valueSides = (c: HTMLElement) =>
  [...new Set(tickTexts(c).filter((t) => !isCategory(t)).map((t) => t.getAttribute('orientation')))].sort();

/** The sides the CATEGORY tick labels (`Jan` / `Feb` / `Mar`) were drawn on. */
const categorySides = (c: HTMLElement) =>
  [...new Set(tickTexts(c).filter(isCategory).map((t) => t.getAttribute('orientation')))];

/** The value tick labels drawn on one side, in order. */
const ticksOn = (c: HTMLElement, side: Side) =>
  tickTexts(c)
    .filter((t) => !isCategory(t) && t.getAttribute('orientation') === side)
    .map((t) => (t.textContent ?? '').trim());

/** One axis title: where it sits and whether it is rotated. */
function title(c: HTMLElement, text: string) {
  const found = [...c.querySelectorAll('text.recharts-label')].filter((t) => (t.textContent ?? '').trim() === text);
  const el = found[0];
  return {
    count: found.length,
    x: Number(el?.getAttribute('x')),
    y: Number(el?.getAttribute('y')),
    rotated: /rotate\(/.test(el?.getAttribute('transform') ?? ''),
  };
}

const bars = (c: HTMLElement) => c.querySelectorAll('.recharts-bar-rectangle').length;
const yNotes = (c: HTMLElement) => [...c.querySelectorAll('[data-chart-note="y-axis-position"]')];
const referenceLines = (c: HTMLElement) => c.querySelectorAll('.recharts-reference-line').length;

const onLeft = (x: number) => Number.isFinite(x) && x < WIDTH / 2;
const onRight = (x: number) => Number.isFinite(x) && x > WIDTH / 2;

describe('objectui#10654 — the y side of `position` and horizontal-bar\'s axes, row by row, each against the `bar` control', () => {
  // ── Row 1: a lone `position: 'right'` entry draws on the left ────────────
  it.each(['bar', 'line', 'area'])('row 1 · %s: a lone `right` entry draws the value axis on the right', async (chartType) => {
    const c = await draw({ chartType, yAxis: [{ field: 'revenue', position: 'right' }] });
    expect(valueSides(c), `${chartType} drew a lone \`position: right\` value axis on the left`).toEqual(['right']);
    expect(yNotes(c)).toHaveLength(0);
  });

  it('row 1 · scatter: a lone `right` entry draws the y axis on the right', async () => {
    const c = await draw({ chartType: 'scatter', xAxis: { field: 'cost' }, yAxis: [{ field: 'revenue', position: 'right' }] });
    // The x axis is a number axis on scatter, so its ticks count as values too.
    expect(valueSides(c)).toEqual(['bottom', 'right']);
    expect(yNotes(c)).toHaveLength(0);
  });

  it.each([['left'], [undefined]] as const)('row 1 · (bar control) a lone entry at %s draws on the left', async (position) => {
    const c = await draw({ chartType: 'bar', yAxis: [{ field: 'revenue', ...(position ? { position } : {}) }] });
    expect(valueSides(c)).toEqual(['left']);
    expect(yNotes(c)).toHaveLength(0);
  });

  // ── Row 2: `top` / `bottom` on a y entry pass silently ───────────────────
  it.each([
    ['bar', 'top'],
    ['bar', 'bottom'],
    ['line', 'top'],
    ['area', 'bottom'],
    ['scatter', 'top'],
  ] as const)('row 2 · %s: `%s` is refused with a note naming `yAxis[0].position`, and the axis stays on the left', async (chartType, position) => {
    const c = await draw({
      chartType,
      ...(chartType === 'scatter' ? { xAxis: { field: 'cost' } } : {}),
      yAxis: [{ field: 'revenue', position }],
    });
    const notes = yNotes(c);
    expect(notes, `\`yAxis[0].position: ${position}\` was taken in silence`).toHaveLength(1);
    expect(notes[0].textContent).toContain('yAxis[0].position');
    expect(notes[0].textContent).toContain(position);
    expect(notes[0].textContent).toContain('drawn on the left');
    expect(valueSides(c)).toContain('left');
    expect(valueSides(c)).not.toContain('right');
  });

  it('row 2 · (bar control) `right` is an open side: no note', async () => {
    const c = await draw({ chartType: 'bar', yAxis: [{ field: 'revenue', position: 'right' }] });
    expect(yNotes(c)).toHaveLength(0);
  });

  // ── Row 3: a second entry is always the right axis ───────────────────────
  const SWAPPED = [
    { field: 'revenue', position: 'right', title: 'Revenue' },
    { field: 'cost', position: 'left', title: 'Cost' },
  ];
  const BOUND = { series: [{ name: 'revenue', yAxis: 'right' }, { name: 'cost' }] };

  it.each(['bar', 'line', 'area'])('row 3 · %s: `[right, left]` draws the first entry on the right and the second on the left', async (chartType) => {
    const c = await draw({ chartType, yAxis: SWAPPED, ...BOUND });
    expect(onRight(title(c, 'Revenue').x), 'the first entry, `position: right`, was drawn on the left').toBe(true);
    expect(onLeft(title(c, 'Cost').x), 'the second entry, `position: left`, was drawn on the right').toBe(true);
    expect(yNotes(c)).toHaveLength(0);
  });

  it('row 3 · combo: the same, on the two axes a combo always draws', async () => {
    const c = await draw({ chartType: 'combo', yAxis: SWAPPED, series: [{ name: 'revenue', type: 'bar', yAxis: 'right' }, { name: 'cost', type: 'line', yAxis: 'left' }] });
    expect(onRight(title(c, 'Revenue').x)).toBe(true);
    expect(onLeft(title(c, 'Cost').x)).toBe(true);
  });

  it.each([
    ['bar', [{ field: 'revenue', title: 'Revenue' }, { field: 'cost', position: 'left', title: 'Cost' }]],
    ['column', [{ field: 'revenue', position: 'right', title: 'Revenue' }, { field: 'cost', title: 'Cost' }]],
  ] as const)('row 3 · %s: an entry naming no side takes the side the other left free', async (chartType, yAxis) => {
    const c = await draw({ chartType, yAxis, ...BOUND });
    expect(onRight(title(c, 'Revenue').x)).toBe(true);
    expect(onLeft(title(c, 'Cost').x)).toBe(true);
    expect(yNotes(c)).toHaveLength(0);
  });

  it('row 3 · (bar control) two entries naming no side: the first on the left, the second on the right', async () => {
    const c = await draw({
      chartType: 'bar',
      yAxis: [{ field: 'revenue', title: 'Revenue' }, { field: 'cost', title: 'Cost' }],
      ...BOUND,
    });
    expect(onLeft(title(c, 'Revenue').x)).toBe(true);
    expect(onRight(title(c, 'Cost').x)).toBe(true);
  });

  // ── Row 4: with no `series`, a FIRST entry of `right` moves both series ──
  // The first entry pins its domain to 0..100, so its axis reads 0..100 and
  // the cost series (3..5) reads 0..8 wherever it is drawn.
  const DERIVED = [
    { field: 'revenue', position: 'right', min: 0, max: 100 },
    { field: 'cost', position: 'left' },
  ];

  it.each(['bar', 'line', 'area', 'combo'])('row 4 · %s, no series: each derived series plots against its own entry\'s axis', async (chartType) => {
    const c = await draw({ chartType, yAxis: DERIVED });
    expect(ticksOn(c, 'right'), 'the first entry\'s axis is not on the right').toEqual(['0', '25', '50', '75', '100']);
    expect(ticksOn(c, 'left'), 'the cost series was not measured against the second entry\'s (left) axis').toEqual(['0', '2', '4', '6', '8']);
  });

  it('row 4 · the normalizer binds each derived series to its entry\'s slot', () => {
    expect(normalizeChartSchema({ chartType: 'bar', yAxis: DERIVED }).series).toEqual([
      { dataKey: 'revenue', yAxis: 'right' },
      { dataKey: 'cost', yAxis: 'left' },
    ]);
  });

  it('row 4 · (bar control) no series, no positions: the first series on the left, the second on the right', async () => {
    const c = await draw({ chartType: 'bar', yAxis: [{ field: 'revenue', min: 0, max: 100 }, { field: 'cost' }] });
    expect(ticksOn(c, 'left')).toEqual(['0', '25', '50', '75', '100']);
    expect(ticksOn(c, 'right')).toEqual(['0', '2', '4', '6', '8']);
  });

  // ── Row 5: `horizontal-bar` with two y entries drops bars ───────────────
  const TWO = [{ field: 'revenue' }, { field: 'cost' }];

  it.each([
    ['no series', {}],
    ['authored series', { series: [{ name: 'revenue' }, { name: 'cost', yAxis: 'right' }] }],
  ] as const)('row 5 · horizontal-bar, two entries, %s: every bar is drawn, against a value axis at the bottom and one at the top', async (_label, extra) => {
    const c = await draw({ chartType: 'horizontal-bar', yAxis: TWO, ...extra });
    expect(bars(c), 'horizontal-bar bound its bars to axes it did not render').toBe(6);
    expect(valueSides(c)).toEqual(['bottom', 'top']);
    expect(ticksOn(c, 'bottom')).toEqual(['0', '5', '10', '15', '20']);
    expect(ticksOn(c, 'top')).toEqual(['0', '2', '4', '6', '8']);
  });

  it('row 5 · (bar control) two entries draw every bar', async () => {
    const c = await draw({ chartType: 'bar', yAxis: TWO, series: [{ name: 'revenue' }, { name: 'cost', yAxis: 'right' }] });
    expect(bars(c)).toBe(6);
    expect(valueSides(c)).toEqual(['left', 'right']);
  });

  // ── Row 6: `horizontal-bar` never draws `xAxis.title`, and lays the
  //    `yAxis` title beside the wrong axis (objectui#10655) ───────────────
  const TITLED = { xAxis: { field: 'month', title: 'Month' }, yAxis: [{ field: 'revenue', title: 'Revenue' }] };

  it('row 6 · horizontal-bar: `xAxis.title` names the category axis, and the `yAxis` title sits under the value axis', async () => {
    const c = await draw({ chartType: 'horizontal-bar', ...TITLED });
    const month = title(c, 'Month');
    const revenue = title(c, 'Revenue');
    expect(month.count, 'horizontal-bar never drew `xAxis.title`').toBe(1);
    expect(month.rotated, 'the category axis runs down the plot, so its title reads up it').toBe(true);
    expect(onLeft(month.x)).toBe(true);
    expect(revenue.count).toBe(1);
    expect(revenue.rotated, 'the value axis runs across the plot; its title was laid out for a vertical axis').toBe(false);
    const valueTickYs = tickTexts(c).filter((t) => !isCategory(t)).map((t) => Number(t.getAttribute('y')));
    expect(revenue.y).toBeGreaterThan(Math.max(...valueTickYs));
  });

  it('row 6 · (bar control) the category title sits under the category axis and the value title reads up the left', async () => {
    const c = await draw({ chartType: 'bar', ...TITLED });
    const month = title(c, 'Month');
    const revenue = title(c, 'Revenue');
    expect(month.count).toBe(1);
    expect(month.rotated).toBe(false);
    const categoryTickYs = tickTexts(c).filter(isCategory).map((t) => Number(t.getAttribute('y')));
    expect(month.y).toBeGreaterThan(Math.max(...categoryTickYs));
    expect(revenue.count).toBe(1);
    expect(revenue.rotated).toBe(true);
    expect(onLeft(revenue.x)).toBe(true);
  });

  // ── Row 7: which entry is primary when both name a side ──────────────────
  it.each([
    ['bar', 'left', 'on the right'],
    ['bar', 'right', 'on the left'],
    ['horizontal-bar', 'bottom', 'at the top'],
  ] as const)('row 7 · %s: both entries at `%s` — the first keeps it, the second is drawn %s with a note naming `yAxis[1].position`', async (chartType, position, drawn) => {
    const c = await draw({
      chartType,
      yAxis: [{ field: 'revenue', position }, { field: 'cost', position }],
    });
    const notes = yNotes(c);
    expect(notes, `two entries at \`${position}\` were resolved in silence`).toHaveLength(1);
    expect(notes[0].textContent).toContain('yAxis[1].position');
    expect(notes[0].textContent).toContain(`drawn ${drawn}`);
    // The first entry's series (revenue, 10..20) is on the side it named.
    const first = ticksOn(c, position);
    expect(first[first.length - 1]).toBe('20');
  });

  it('row 7 · (bar control) `[left, right]` draws each where it asked, with no note', async () => {
    const c = await draw({ chartType: 'bar', yAxis: [{ field: 'revenue', position: 'left' }, { field: 'cost', position: 'right' }] });
    expect(yNotes(c)).toHaveLength(0);
    expect(ticksOn(c, 'left')).toEqual(['0', '5', '10', '15', '20']);
    expect(ticksOn(c, 'right')).toEqual(['0', '2', '4', '6', '8']);
  });

  // ── Row 8: on `horizontal-bar` the value axes run across the plot ────────
  it('row 8 · horizontal-bar: a lone `top` entry draws the value axis along the top', async () => {
    const c = await draw({ chartType: 'horizontal-bar', yAxis: [{ field: 'revenue', position: 'top' }] });
    expect(valueSides(c)).toEqual(['top']);
    expect(categorySides(c)).toEqual(['left']);
    expect(yNotes(c)).toHaveLength(0);
  });

  it.each(['left', 'right'] as const)('row 8 · horizontal-bar: `%s` is refused with a note naming `yAxis[0].position`, and the axis stays at the bottom', async (position) => {
    const c = await draw({ chartType: 'horizontal-bar', yAxis: [{ field: 'revenue', position }] });
    const notes = yNotes(c);
    expect(notes).toHaveLength(1);
    expect(notes[0].textContent).toContain('yAxis[0].position');
    expect(notes[0].textContent).toContain(position);
    expect(notes[0].textContent).toContain('drawn at the bottom');
    expect(valueSides(c)).toEqual(['bottom']);
  });

  it.each([
    ['bar', undefined, 'left'],
    ['horizontal-bar', undefined, 'bottom'],
    ['horizontal-bar', 'bottom', 'bottom'],
  ] as const)('row 8 · (control) %s with position %s draws its value axis at its default side, the %s, with no note', async (chartType, position, side) => {
    const c = await draw({ chartType, yAxis: [{ field: 'revenue', ...(position ? { position } : {}) }] });
    expect(valueSides(c)).toEqual([side]);
    expect(yNotes(c)).toHaveLength(0);
  });

  // ── Row 9: a lone right entry on a combo drew its title on both sides ───
  it('row 9 · combo: a lone `right` entry\'s title is drawn once, on the right', async () => {
    const c = await draw({ chartType: 'combo', yAxis: [{ field: 'revenue', position: 'right', title: 'Revenue' }] });
    const revenue = title(c, 'Revenue');
    expect(revenue.count, 'the entry\'s title was drawn on both sides').toBe(1);
    expect(onRight(revenue.x)).toBe(true);
  });

  it('row 9 · (bar control) a lone entry\'s title is drawn once, on the side its axis sits', async () => {
    const c = await draw({ chartType: 'bar', yAxis: [{ field: 'revenue', title: 'Revenue' }] });
    const revenue = title(c, 'Revenue');
    expect(revenue.count).toBe(1);
    expect(onLeft(revenue.x)).toBe(true);
  });

  // ── Row 10: a right-hand title sits on the far side of its tick labels ───
  const tickXs = (c: HTMLElement, side: Side) =>
    tickTexts(c).filter((t) => !isCategory(t) && t.getAttribute('orientation') === side).map((t) => Number(t.getAttribute('x')));

  it.each([
    ['bar', 'the second entry', [{ field: 'revenue' }, { field: 'cost', title: 'Cost' }]],
    ['combo', 'the second entry', [{ field: 'revenue' }, { field: 'cost', title: 'Cost' }]],
    ['bar', 'a lone `right` entry', [{ field: 'cost', position: 'right', title: 'Cost' }]],
  ] as const)('row 10 · %s: %s — a right-hand value axis\'s title sits beyond its tick labels, away from the plot', async (chartType, _label, yAxis) => {
    const c = await draw({ chartType, yAxis, series: [{ name: 'revenue', type: 'bar' }, { name: 'cost', type: 'bar', yAxis: 'right' }] });
    const xs = tickXs(c, 'right');
    expect(xs.length).toBeGreaterThan(0);
    expect(title(c, 'Cost').x, 'the title sits between the plot and the tick labels').toBeGreaterThan(Math.max(...xs));
  });

  it('row 10 · (bar control) a left-hand value axis\'s title sits beyond its tick labels, away from the plot', async () => {
    const c = await draw({ chartType: 'bar', yAxis: [{ field: 'revenue', title: 'Revenue' }] });
    const xs = tickXs(c, 'left');
    expect(xs.length).toBeGreaterThan(0);
    expect(title(c, 'Revenue').x).toBeLessThan(Math.min(...xs));
  });

  // ── Row 11: the grid and the annotations bind to a value axis the branch
  //    renders. With two entries (and on every combo) the value axes carry
  //    ids, and recharts binds a grid or an annotation to id `0` by default ─
  const gridLines = (c: HTMLElement, direction: 'horizontal' | 'vertical') =>
    c.querySelectorAll(`.recharts-cartesian-grid-${direction} line`).length;
  const ANNOTATIONS = [
    { type: 'line', axis: 'x', value: 'Feb' },
    { type: 'line', axis: 'y', value: 5 },
  ];
  const TWO_SERIES = [{ name: 'revenue', type: 'bar' }, { name: 'cost', type: 'line' }];

  it.each([
    ['bar, two entries', { chartType: 'bar', yAxis: TWO }],
    ['combo, one entry', { chartType: 'combo', yAxis: [{ field: 'revenue' }], series: TWO_SERIES }],
    ['combo, no entry', { chartType: 'combo', series: TWO_SERIES }],
    ['combo, two entries', { chartType: 'combo', yAxis: TWO, series: TWO_SERIES }],
  ] as const)('row 11 · %s: both annotations are drawn and the grid has one horizontal line per left value tick', async (_label, schema) => {
    const c = await draw({ ...schema, annotations: ANNOTATIONS });
    expect(referenceLines(c), 'an annotation was bound to an axis id the chart does not render').toBe(2);
    expect(gridLines(c, 'horizontal')).toBe(ticksOn(c, 'left').length);
  });

  it('row 11 · horizontal-bar, two entries: both annotations are drawn and the grid has one vertical line per bottom value tick', async () => {
    const c = await draw({
      chartType: 'horizontal-bar',
      xAxis: { field: 'month', showGridLines: true },
      yAxis: [{ field: 'revenue' }, { field: 'cost' }],
      annotations: [{ type: 'line', axis: 'x', value: 5 }, { type: 'line', axis: 'y', value: 'Feb' }],
    });
    expect(referenceLines(c)).toBe(2);
    expect(gridLines(c, 'vertical')).toBe(ticksOn(c, 'bottom').length);
  });

  it('row 11 · (bar control) one entry: both annotations are drawn and the grid has one horizontal line per value tick', async () => {
    const c = await draw({ chartType: 'bar', yAxis: [{ field: 'revenue' }], annotations: ANNOTATIONS });
    expect(referenceLines(c)).toBe(2);
    expect(gridLines(c, 'horizontal')).toBe(ticksOn(c, 'left').length);
  });
});
