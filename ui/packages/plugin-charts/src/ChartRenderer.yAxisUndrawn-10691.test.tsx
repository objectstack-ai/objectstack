/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#10691 — a `yAxis` entry after the second is drawn on no axis, and
 * the chart says so.
 *
 * `@objectstack/spec` declares `ChartConfig.yAxis` as an uncapped list, so a
 * third entry validates; a cartesian chart draws at most two value axes, one
 * per slot. The ruling on the card is "say so, don't narrow": the entry keeps
 * validating, and the chart carries a note in the `ChartFootnote` channel the
 * `x-axis-position` / `y-axis-position` notes use, naming `yAxis[N]` and the
 * axis a series derived from it plots against.
 *
 * The answer is `placeYAxes`'s (its `undrawn` list): the normalizer binds the
 * series it derives from such an entry with it, and the renderer writes the
 * note from it, so the note cannot name one axis while the series plots
 * against another. The render rows below check the note's binding against the
 * ticks the series is actually measured on.
 *
 * Every row goes through `ChartRenderer`, with the axes in the spec's shape,
 * and is measured against a two-entry control that must carry no such note.
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

// `units` (50..90) sits an order of magnitude above `cost` (3..5), so the axis
// it is measured on is readable from that axis's top tick.
const ROWS = [
  { month: 'Jan', revenue: 10, cost: 3, units: 50, visits: 400 },
  { month: 'Feb', revenue: 20, cost: 5, units: 90, visits: 800 },
  { month: 'Mar', revenue: 15, cost: 4, units: 70, visits: 600 },
];
const CATEGORIES = new Set(ROWS.map((r) => r.month));

async function draw(schema: Record<string, unknown>) {
  const { container } = render(
    <ChartRenderer
      schema={{ type: 'chart', data: ROWS, xAxis: { field: 'month' }, isAnimationActive: false, ...schema } as never}
    />,
  );
  await waitFor(() => expect(container.querySelector('svg')).toBeTruthy());
  return container;
}

const undrawnNotes = (c: HTMLElement) => [...c.querySelectorAll('[role="note"][data-chart-note="y-axis-undrawn"]')];
const noteKinds = (c: HTMLElement) => [...c.querySelectorAll('[role="note"]')].map((n) => n.getAttribute('data-chart-note'));
const text = (el: Element) => (el.textContent ?? '').replace(/\s+/g, ' ');
const axisTitles = (c: HTMLElement) => [...c.querySelectorAll('text.recharts-label')].map((t) => (t.textContent ?? '').trim());

/** The value tick labels drawn on one side, in order. */
const ticksOn = (c: HTMLElement, side: string) =>
  [...c.querySelectorAll('text.recharts-cartesian-axis-tick-value')]
    .filter((t) => !CATEGORIES.has((t.textContent ?? '').trim()) && t.getAttribute('orientation') === side)
    .map((t) => (t.textContent ?? '').trim());
const topTick = (c: HTMLElement, side: string) => Number(ticksOn(c, side).at(-1));

const THREE = [
  { field: 'revenue', title: 'Revenue' },
  { field: 'cost', title: 'Cost' },
  { field: 'units', title: 'third', min: 0, max: 1000 },
];
const FOUR = [...THREE, { field: 'visits', title: 'fourth' }];

describe('objectui#10691 — a `yAxis` entry after the second is drawn on no axis, and the chart says so', () => {
  // ── A third entry draws one note, naming it and the axis its series plots against
  it.each([
    ['bar', 'on the right'],
    ['line', 'on the right'],
    ['area', 'on the right'],
    ['combo', 'on the right'],
    ['horizontal-bar', 'at the top'],
  ] as const)('%s, three entries: one note names `yAxis[2]`, and its series plots against the axis %s', async (chartType, side) => {
    const c = await draw({ chartType, yAxis: THREE });
    const notes = undrawnNotes(c);
    expect(notes, `a third \`yAxis\` entry on ${chartType} went unused in silence`).toHaveLength(1);
    expect(text(notes[0])).toContain('yAxis[2]');
    expect(text(notes[0])).toContain('units');
    expect(text(notes[0])).toContain(`the axis ${side}, yAxis[1]`);
    // The note is true: the entry drew no axis of its own (its `title` is not
    // on screen, its 0..1000 domain is not a scale), and `units` is measured
    // against the right-slot axis, `yAxis[1]`'s — its top tick covers 90.
    expect(axisTitles(c)).toEqual(['Revenue', 'Cost']);
    const slotSide = chartType === 'horizontal-bar' ? 'top' : 'right';
    expect(topTick(c, slotSide)).toBeGreaterThanOrEqual(90);
    expect(topTick(c, slotSide)).toBeLessThan(1000);
  });

  it('bar, four entries: two notes, naming `yAxis[2]` and `yAxis[3]` in order', async () => {
    const c = await draw({ chartType: 'bar', yAxis: FOUR });
    const notes = undrawnNotes(c).map(text);
    expect(notes).toHaveLength(2);
    expect(notes[0]).toContain('yAxis[2]');
    expect(notes[0]).toContain('units');
    expect(notes[1]).toContain('yAxis[3]');
    expect(notes[1]).toContain('visits');
  });

  it('bar, three entries with the first at `right`: the note names the entry drawn in the right-hand slot, `yAxis[0]`', async () => {
    const c = await draw({
      chartType: 'bar',
      yAxis: [{ field: 'revenue', position: 'right' }, { field: 'cost', position: 'left' }, { field: 'units' }],
    });
    const notes = undrawnNotes(c);
    expect(notes).toHaveLength(1);
    expect(text(notes[0])).toContain('the axis on the right, yAxis[0]');
    // `revenue` (10..20) and `units` (50..90) share the right-hand axis.
    expect(topTick(c, 'right')).toBeGreaterThanOrEqual(90);
    expect(noteKinds(c)).toEqual(['y-axis-undrawn']);
  });

  it('bar, three entries, the second conflicting: the `y-axis-position` note is kept beside the new one', async () => {
    const c = await draw({
      chartType: 'bar',
      yAxis: [{ field: 'revenue', position: 'left' }, { field: 'cost', position: 'left' }, { field: 'units' }],
    });
    expect(noteKinds(c)).toEqual(['y-axis-position', 'y-axis-undrawn']);
    expect(text(undrawnNotes(c)[0])).toContain('yAxis[2]');
  });

  it('bar, three entries and authored `series`: the note still names `yAxis[2]`', async () => {
    const c = await draw({ chartType: 'bar', yAxis: THREE, series: [{ name: 'revenue' }, { name: 'cost', yAxis: 'right' }] });
    const notes = undrawnNotes(c);
    expect(notes).toHaveLength(1);
    expect(text(notes[0])).toContain('yAxis[2]');
  });

  // ── Controls: two entries (or no cartesian value axis) carry no such note ──
  it.each(['bar', 'line', 'area', 'combo', 'horizontal-bar'])('(control) %s, two entries: no `y-axis-undrawn` note', async (chartType) => {
    const c = await draw({ chartType, yAxis: THREE.slice(0, 2) });
    expect(noteKinds(c)).toEqual([]);
  });

  it('(control) bar, two entries, the second conflicting: exactly the `y-axis-position` note', async () => {
    const c = await draw({ chartType: 'bar', yAxis: [{ field: 'revenue', position: 'left' }, { field: 'cost', position: 'left' }] });
    expect(noteKinds(c)).toEqual(['y-axis-position']);
    expect(text(c.querySelector('[data-chart-note="y-axis-position"]')!)).toContain('yAxis[1].position');
  });

  it('(control) pie, three entries: no note', async () => {
    const c = await draw({ chartType: 'pie', yAxis: THREE });
    expect(noteKinds(c)).toEqual([]);
  });

  // ── One answer: the normalizer binds from the placement the note reads ──
  it('`placeYAxes` lists every entry after the second as undrawn, and the normalizer binds its derived series from that answer', () => {
    const axes = normalizeChartSchema({ chartType: 'bar', yAxis: FOUR }).yAxes!;
    const placement = placeYAxes(axes, 'bar');
    expect(placement.undrawn.map((n) => n.index)).toEqual([2, 3]);
    const series = normalizeChartSchema({ chartType: 'bar', yAxis: FOUR }).series!;
    for (const note of placement.undrawn) {
      expect(series[note.index]).toMatchObject({ dataKey: axes[note.index].field, yAxis: note.boundTo });
    }
  });

  it('`placeYAxes` lists nothing as undrawn for two entries or fewer', () => {
    for (const n of [0, 1, 2]) {
      expect(placeYAxes(THREE.slice(0, n), 'bar').undrawn).toEqual([]);
    }
  });
});
