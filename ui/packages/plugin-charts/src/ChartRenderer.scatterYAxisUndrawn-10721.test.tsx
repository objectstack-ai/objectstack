/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#10721 — a `scatter` chart draws one value axis, the first `yAxis`
 * entry's, and says so for every entry after it.
 *
 * `@objectstack/spec` declares `ChartConfig.yAxis` as an uncapped list, so a
 * second entry validates. objectui#10691 gave the two-slot families (bar, line,
 * area, combo, `horizontal-bar`) a `y-axis-undrawn` note for each entry past
 * the second; `scatter` places only its first entry, so its threshold is "past
 * the first", and until this card nothing named it when `series` was authored.
 * The ruling is objectui#10691's: say so, don't narrow — the entry keeps
 * validating, and the chart carries the note in the same `ChartFootnote`.
 *
 * The answer is `placeYAxes`'s: the scatter slice lives inside it, so its
 * `undrawn` list carries the entry for the renderer's note and the
 * normalizer's derived-series binding alike.
 *
 * Every render row goes through `ChartRenderer`, with the axes in the spec's
 * shape. The derived-series refusal (`scatter-multi-series`) is the visible
 * control: without authored `series`, several fielded entries still refuse.
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
import { normalizeChartSchema, placeYAxes } from './normalizeChartSchema';
// `ChartRenderer` lazy-loads `./AdvancedChartImpl`. Importing it here with the
// SAME specifier moves that cost into the import phase, which no test timeout
// applies to (AGENTS.md "测试纪律").
import './AdvancedChartImpl';

afterEach(cleanup);

// `cost` is scatter's x measure (the card's probe shape); `units` (50..90)
// sits well above `revenue` (10..20), so the one y axis's top tick tells which
// column it is measured on.
const ROWS = [
  { month: 'Jan', revenue: 10, cost: 3, units: 50, visits: 400 },
  { month: 'Feb', revenue: 20, cost: 5, units: 90, visits: 800 },
  { month: 'Mar', revenue: 15, cost: 4, units: 70, visits: 600 },
];

async function draw(schema: Record<string, unknown>) {
  const { container } = render(
    <ChartRenderer
      schema={{ type: 'chart', data: ROWS, xAxis: { field: 'cost' }, isAnimationActive: false, ...schema } as never}
    />,
  );
  await waitFor(() => expect(container.querySelector('svg, [data-chart-error]')).toBeTruthy());
  return container;
}

const undrawnNotes = (c: HTMLElement) => [...c.querySelectorAll('[role="note"][data-chart-note="y-axis-undrawn"]')];
const noteKinds = (c: HTMLElement) => [...c.querySelectorAll('[role="note"]')].map((n) => n.getAttribute('data-chart-note'));
/** What a note names — its `code` spans, in order. */
const named = (note: Element) => [...note.querySelectorAll('code')].map((code) => (code.textContent ?? '').trim());
const axisTitles = (c: HTMLElement) => [...c.querySelectorAll('text.recharts-label')].map((t) => (t.textContent ?? '').trim());
/** The value tick labels drawn up one side, in order. */
const ticksOn = (c: HTMLElement, side: string) =>
  [...c.querySelectorAll('text.recharts-cartesian-axis-tick-value')]
    .filter((t) => t.getAttribute('orientation') === side)
    .map((t) => (t.textContent ?? '').trim());

const TWO = [
  { field: 'revenue', title: 'Revenue' },
  { field: 'units', title: 'Units', min: 0, max: 1000 },
];
const THREE = [...TWO, { field: 'visits', title: 'Visits' }];
const AUTHORED = [{ name: 'revenue' }];

describe('objectui#10721 — a `scatter` entry after the first is drawn on no axis, and the chart says so', () => {
  // ── An entry after the first draws one note each, naming it and the axis drawn ──
  it('scatter, two entries and authored `series`: one note names `yAxis[1]` and the axis drawn, `yAxis[0]`', async () => {
    const c = await draw({ chartType: 'scatter', yAxis: TWO, series: AUTHORED });
    const notes = undrawnNotes(c);
    expect(notes, 'a second `yAxis` entry on scatter went unused in silence').toHaveLength(1);
    expect(named(notes[0])).toEqual(['yAxis[1]', 'yAxis[0]']);
    expect(c.querySelector('[data-chart-error]')).toBeNull();
    // The note is true: one value axis is drawn, `yAxis[0]`'s — its title is
    // the only one on screen, and `Units`' 0..1000 domain is not a scale.
    expect(axisTitles(c)).toEqual(['Revenue']);
    expect(ticksOn(c, 'right')).toEqual([]);
    expect(Number(ticksOn(c, 'left').at(-1))).toBeLessThan(1000);
  });

  it('scatter, three entries and authored `series`: two notes, naming `yAxis[1]` and `yAxis[2]` in order', async () => {
    const c = await draw({ chartType: 'scatter', yAxis: THREE, series: AUTHORED });
    const notes = undrawnNotes(c);
    expect(notes, 'a second or third `yAxis` entry on scatter went unused in silence').toHaveLength(2);
    expect(notes.map(named)).toEqual([
      ['yAxis[1]', 'yAxis[0]'],
      ['yAxis[2]', 'yAxis[0]'],
    ]);
    expect(noteKinds(c)).toEqual(['y-axis-undrawn', 'y-axis-undrawn']);
    expect(c.querySelector('[data-chart-error]')).toBeNull();
    expect(axisTitles(c)).toEqual(['Revenue']);
  });

  // ── Controls ──────────────────────────────────────────────────────────────
  it('(control) scatter, one entry: no note', async () => {
    const c = await draw({ chartType: 'scatter', yAxis: TWO.slice(0, 1), series: AUTHORED });
    expect(noteKinds(c)).toEqual([]);
    expect(axisTitles(c)).toEqual(['Revenue']);
  });

  it('(control) line, the same three entries: today\'s one note, naming `yAxis[2]` only', async () => {
    const c = await draw({ chartType: 'line', xAxis: { field: 'month' }, yAxis: THREE, series: AUTHORED });
    const notes = undrawnNotes(c);
    expect(notes).toHaveLength(1);
    expect(named(notes[0])).toEqual(['yAxis[2]', 'series', 'categories', 'visits', 'yAxis[1]']);
    expect(noteKinds(c)).toEqual(['y-axis-undrawn']);
  });

  it('(control) scatter, three entries and no `series`: the derived series still refuse, visibly', async () => {
    const c = await draw({ chartType: 'scatter', yAxis: THREE });
    expect(c.querySelector('[data-chart-error="scatter-multi-series"]')).not.toBeNull();
    expect(noteKinds(c)).toEqual([]);
  });

  // ── One answer: the slice is `placeYAxes`'s, and the normalizer binds from it ──
  it('`placeYAxes` places the first entry on scatter, lists the rest as undrawn, and the normalizer binds its derived series from that answer', () => {
    const axes = normalizeChartSchema({ chartType: 'scatter', yAxis: THREE }).yAxes!;
    const placement = placeYAxes(axes, 'scatter');
    expect(placement.slotOf).toEqual(['left']);
    expect(placement.undrawn).toEqual([
      { index: 1, boundTo: 'left' },
      { index: 2, boundTo: 'left' },
    ]);
    const series = normalizeChartSchema({ chartType: 'scatter', yAxis: THREE }).series!;
    for (const note of placement.undrawn) {
      expect(series[note.index]).toMatchObject({ dataKey: axes[note.index].field, yAxis: note.boundTo });
    }
  });

  it('`placeYAxes` binds an undrawn scatter entry to the slot the one axis is drawn in', () => {
    const placement = placeYAxes([{ field: 'revenue', position: 'right' }, { field: 'units' }], 'scatter');
    expect(placement.slotOf).toEqual(['right']);
    expect(placement.right).toBe(0);
    expect(placement.undrawn).toEqual([{ index: 1, boundTo: 'right' }]);
  });
});
