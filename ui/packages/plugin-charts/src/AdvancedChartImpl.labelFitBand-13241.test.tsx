/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * objectui#13241 — a vertical bar chart rotated every category label over 5
 * characters and cut it at 12, whatever its width: a full-width report chart
 * read "Qualificati…" and "Needs Analy…" with about 160px of band per stage.
 * Rotation and the cut now follow whether the label fits its band, read from
 * the measured surface width; the objectui#7247 / #11796 cap stays for a band
 * that cannot hold the name.
 *
 * happy-dom has no layout: recharts' `ResponsiveContainer` is handed the width
 * the way the sibling axis tests do it, and `ResizeObserver` (a no-op in
 * happy-dom) is replaced by one that reports that same width for the chart's
 * SVG surface, as a browser does once the chart is painted.
 */
import React from 'react';
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, cleanup, fireEvent, act } from '@testing-library/react';

/** Chart width under test, in px. Read at render time by both stand-ins. */
let containerWidth = 1044;

vi.mock('recharts', async () => {
  const actual = await vi.importActual<typeof import('recharts')>('recharts');
  return {
    ...actual,
    ResponsiveContainer: ({ children }: { children: React.ReactElement<{ width: number; height: number }> }) =>
      React.cloneElement(children, { width: containerWidth, height: 260 }),
  };
});

import AdvancedChartImpl from './AdvancedChartImpl';

/** Reports `containerWidth` for an observed SVG surface; ignores every other node. */
class SurfaceResizeObserver {
  constructor(private readonly callback: ResizeObserverCallback) {}
  observe(target: Element) {
    if (!(target instanceof SVGElement)) return;
    this.callback(
      [{ target, contentRect: { width: containerWidth, height: 260 } } as unknown as ResizeObserverEntry],
      this as unknown as ResizeObserver,
    );
  }
  unobserve() {}
  disconnect() {}
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  containerWidth = 1044;
});

/** The six stages of the reported Opportunities by Stage chart; the longest is 19 characters. */
const STAGES = [
  'Prospecting',
  'Qualification',
  'Needs Analysis',
  'Value Proposition',
  'Id. Decision Makers',
  'Closed Won',
];

function renderStages(width: number, measured = true) {
  containerWidth = width;
  if (measured) vi.stubGlobal('ResizeObserver', SurfaceResizeObserver);
  return render(
    <AdvancedChartImpl
      chartType="bar"
      data={STAGES.map((stage, i) => ({ stage, amount: (i + 1) * 1000 }))}
      xAxisKey="stage"
      series={[{ dataKey: 'amount', label: 'Amount' }]}
      showLegend={false}
      isAnimationActive={false}
    />,
  );
}

function xTicks(container: HTMLElement): Element[] {
  return Array.from(
    container.querySelectorAll('.recharts-xAxis-tick-labels .recharts-cartesian-axis-tick-value'),
  );
}

const labelsOf = (ticks: Element[]) => ticks.map((n) => (n.textContent || '').trim());
const isRotated = (tick: Element) => /rotate\(/.test(tick.getAttribute('transform') ?? '');

describe('an x-axis label rotates and is cut only when its band cannot hold it (objectui#13241)', () => {
  it('draws six stage names whole and horizontal on a 1044px chart', () => {
    const { container } = renderStages(1044);
    const ticks = xTicks(container);
    expect(labelsOf(ticks)).toEqual(STAGES);
    expect(ticks.some(isRotated)).toBe(false);
  });

  it('rotates and cuts the same names at the cap on a 360px chart, the full name on the tooltip', async () => {
    const { container } = renderStages(360);
    const ticks = xTicks(container);
    expect(labelsOf(ticks)).toEqual([
      'Prospecting',
      'Qualificati…',
      'Needs Analy…',
      'Value Propo…',
      'Id. Decisio…',
      'Closed Won',
    ]);
    expect(ticks.every(isRotated)).toBe(true);

    // The cut name is still reachable whole: the pointer over its bar opens
    // the tooltip, which names the category in full. recharts throttles a
    // pointer move through `requestAnimationFrame`, so the frame is flushed.
    expect(container.textContent).not.toContain('Needs Analysis');
    const bar = container.querySelectorAll('.recharts-rectangle')[2] as SVGElement;
    const x = Number(bar.getAttribute('x')) + Number(bar.getAttribute('width')) / 2;
    const y = Number(bar.getAttribute('y')) + Number(bar.getAttribute('height')) / 2;
    fireEvent.mouseMove(bar, { clientX: x, clientY: y });
    await act(async () => {
      await new Promise<void>((r) => requestAnimationFrame(() => r()));
      await new Promise<void>((r) => setTimeout(r, 0));
    });
    expect(container.querySelector('.recharts-tooltip-wrapper')?.textContent).toContain('Needs Analysis');
  });

  it('keeps the length rule until a width is measured', () => {
    const { container } = renderStages(1044, false);
    const ticks = xTicks(container);
    expect(labelsOf(ticks)[2]).toBe('Needs Analy…');
    expect(ticks.every(isRotated)).toBe(true);
  });
});
