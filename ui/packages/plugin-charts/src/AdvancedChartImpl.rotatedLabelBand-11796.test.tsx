/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * objectui#11796 — a rotated x-axis label must fit the band the axis reserves.
 *
 * A rotated label is anchored at its END and hangs its START away from the
 * plot. The axis reserved a fixed 60px, sized against the text width alone, so
 * the longest labels ran past it and the chart surface cut off their starts
 * ("acklog" for Backlog, "ogress" for In Progress, in the dashboard the card
 * reports). The band is now derived from the longest label the axis draws.
 *
 * happy-dom paints no text, so these cases read the band through the rendered
 * geometry (the plot's bottom edge against the chart's fixed height) and hold
 * it against the drop each label makes in a real browser: the label widths
 * below are what Chromium painted at the tick's 12px in DejaVu Sans, the wider
 * of the two sans fonts the container ships, measured once on objectui#11796's
 * pull request — fixtures, not a re-derivation.
 */
import React from 'react';
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, cleanup } from '@testing-library/react';

/** The chart's fixed size here: recharts' `ResponsiveContainer` measures a real box. */
const CHART_HEIGHT = 260;
/** recharts' default chart margin, bottom side. */
const CHART_MARGIN_BOTTOM = 5;

vi.mock('recharts', async () => {
  const actual = await vi.importActual<any>('recharts');
  return {
    ...actual,
    ResponsiveContainer: ({ children }: any) =>
      React.cloneElement(children, { width: 320, height: CHART_HEIGHT }),
  };
});

import AdvancedChartImpl from './AdvancedChartImpl';

afterEach(cleanup);

/**
 * How far a label of `widthPx`, rotated 35° and anchored at its end, reaches
 * below the axis line in Chromium: recharts' `tickSize` (6) + the axis's
 * `tickMargin` (10), the line box below the anchor (1em at 12px) turned by the
 * angle, and the text itself turned by it.
 */
function paintedDropPx(widthPx: number): number {
  const rad = (35 * Math.PI) / 180;
  return 6 + 10 + 12 * Math.cos(rad) + widthPx * Math.sin(rad);
}

/** Chromium-painted width at 12px DejaVu Sans, measured once (see the header). */
const PAINTED_WIDTH_PX = { 'In Progress': 66.2, 'Needs Analy…': 87.0 } as const;

function renderBar(labels: string[]) {
  return render(
    <AdvancedChartImpl
      chartType="bar"
      data={labels.map((status, i) => ({ status, count: i + 1 }))}
      xAxisKey="status"
      series={[{ dataKey: 'count', label: 'Count' }]}
      showLegend={false}
    />,
  );
}

/** Height between the plot's bottom edge and the chart's bottom margin. */
function xAxisBand(container: HTMLElement): number {
  const ys = Array.from(container.querySelectorAll('.recharts-cartesian-grid-horizontal line')).map(
    (l) => Number(l.getAttribute('y1')),
  );
  expect(ys.length).toBeGreaterThan(0);
  return CHART_HEIGHT - CHART_MARGIN_BOTTOM - Math.max(...ys);
}

function xTickLabels(container: HTMLElement): string[] {
  return Array.from(
    container.querySelectorAll('.recharts-xAxis-tick-labels .recharts-cartesian-axis-tick-value'),
  ).map((n) => (n.textContent || '').trim());
}

describe('a rotated x axis reserves a band its labels fit (objectui#11796)', () => {
  it("holds the card's status labels, whose longest is In Progress", () => {
    const { container } = renderBar(['Backlog', 'To Do', 'In Progress', 'In Review', 'Done']);
    expect(xAxisBand(container)).toBeGreaterThanOrEqual(Math.ceil(paintedDropPx(PAINTED_WIDTH_PX['In Progress'])));
  });

  it('holds the longest label the 12-character cap lets through', () => {
    const { container } = renderBar(['Needs Analysis', 'Done']);
    expect(xTickLabels(container)).toEqual(['Needs Analy…', 'Done']);
    expect(xAxisBand(container)).toBeGreaterThanOrEqual(Math.ceil(paintedDropPx(PAINTED_WIDTH_PX['Needs Analy…'])));
  });

  it('charges a CJK glyph a full em, so a Chinese label fits too', () => {
    // Seven ideographs, each set one em (12px) wide.
    const { container } = renderBar(['华东大区销售部', '华北']);
    expect(xAxisBand(container)).toBeGreaterThanOrEqual(Math.ceil(paintedDropPx(7 * 12)));
  });

  it('sizes the band from the longest label: a longer one reserves more', () => {
    const short = xAxisBand(renderBar(['Backlog', 'Done']).container);
    cleanup();
    const long = xAxisBand(renderBar(['Needs Analysis', 'Done']).container);
    expect(long).toBeGreaterThan(short);
  });

  it('ellipsises a rotated label above the five-bucket bound too, so the band stays bounded', () => {
    const capped = xAxisBand(renderBar(['Needs Analysis', 'Done']).container);
    cleanup();
    const seven = ['Needs Analysis and Scoping of the Deal', 'B', 'C', 'D', 'E', 'F', 'Done'];
    const { container } = renderBar(seven);
    expect(xTickLabels(container)[0]).toBe('Needs Analy…');
    // A 38-character name reserves exactly what its 12-character drawn form does.
    expect(xAxisBand(container)).toBe(capped);
  });

  it('control: an axis whose labels do not rotate keeps recharts’ default 30px', () => {
    const { container } = renderBar(['Low', 'High', 'Done']);
    for (const t of container.querySelectorAll('.recharts-xAxis-tick-labels text')) {
      expect(t.getAttribute('transform')).toBeNull();
    }
    expect(xAxisBand(container)).toBe(30);
  });
});
