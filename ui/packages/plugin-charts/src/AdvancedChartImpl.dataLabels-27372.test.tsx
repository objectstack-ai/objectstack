/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * objectstack#27372 — a chart's data labels (`showDataLabels`) read in the
 * units of their value axis, and the tallest mark keeps its label on the
 * chart surface.
 *
 * Two defects, one label:
 *   - The value axis falls back to the compact formatter (`400K`) when no
 *     `yAxis.format` is authored; the data label had no fallback and printed
 *     the raw number (`174000` beside a `400K` tick).
 *   - The label sits above its mark. With recharts' default 5px top margin, a
 *     mark on the plot's top edge (the domain's nice max) had its label drawn
 *     wholly above the chart surface.
 *
 * happy-dom paints no text, but given a fixed box recharts computes every mark
 * and label position arithmetically (the same property
 * `AdvancedChartImpl.pointAxisEdgeLabels-13390.test.tsx` relies on), so these
 * pins read the label's text and its `y` from the DOM.
 */
import React from 'react';
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, cleanup } from '@testing-library/react';

const WIDTH = 520;
const HEIGHT = 300;

vi.mock('recharts', async () => {
  const actual = await vi.importActual<typeof import('recharts')>('recharts');
  return {
    ...actual,
    ResponsiveContainer: ({ children }: { children: React.ReactElement<{ width: number; height: number }> }) =>
      React.cloneElement(children, { width: WIDTH, height: HEIGHT }),
  };
});

import AdvancedChartImpl from './AdvancedChartImpl';

afterEach(cleanup);

/** The card's shape: the tallest value lands on a nice top tick (400K). */
const PIPELINE = [
  { stage: 'Prospecting', amount: 174000, won: 12 },
  { stage: 'Qualification', amount: 400000, won: 30 },
  { stage: 'Proposal', amount: 251000, won: 18 },
  { stage: 'Negotiation', amount: 92500, won: 7 },
];

/** The font size the chart prints data labels in. */
const LABEL_FONT_PX = 11;

type Family = NonNullable<React.ComponentProps<typeof AdvancedChartImpl>['chartType']>;

function draw(chartType: Family, extra: Record<string, unknown> = {}) {
  const { container } = render(
    <AdvancedChartImpl
      chartType={chartType}
      data={PIPELINE}
      xAxisKey="stage"
      series={[{ dataKey: 'amount', label: 'Amount' }]}
      showLegend={false}
      showDataLabels
      isAnimationActive={false}
      {...extra}
    />,
  );
  return container;
}

/** Each data label: its text and the `y` its baseline is drawn at. */
function labelsOf(container: HTMLElement) {
  const texts = [...container.querySelectorAll('.recharts-label-list text')];
  expect(texts.length, 'the chart drew no data labels, so this measures nothing').toBeGreaterThan(0);
  return texts.map((t) => ({ text: (t.textContent ?? '').trim(), y: Number(t.getAttribute('y')) }));
}

/** The y-axis tick texts, so a label can be read against its own axis. */
function yTicksOf(container: HTMLElement, axis = '.recharts-yAxis-tick-labels') {
  return [...container.querySelectorAll(`${axis} .recharts-cartesian-axis-tick-value`)].map((t) =>
    (t.textContent ?? '').trim(),
  );
}

describe('objectstack#27372 — a data label reads in its value axis’s units', () => {
  for (const chartType of ['bar', 'line', 'area'] as const) {
    it(`prints the compact default beside a compact ${chartType} axis when no format is authored`, () => {
      const container = draw(chartType);
      // The axis is the reference: it must itself be compact, or the label
      // matching it would prove nothing about units.
      expect(yTicksOf(container)).toContain('400K');
      expect(labelsOf(container).map((l) => l.text)).toEqual(['174K', '400K', '251K', '92.5K']);
    });
  }

  it('lets an authored axis format win over the compact default', () => {
    const container = draw('bar', { yAxes: [{ field: 'amount', format: '$0,0' }] });
    expect(labelsOf(container).map((l) => l.text)).toEqual(['$174,000', '$400,000', '$251,000', '$92,500']);
  });

  it('prints each series in the units of the axis it is bound to on a dual-axis chart', () => {
    const container = draw('bar', {
      series: [
        { dataKey: 'amount', label: 'Amount' },
        { dataKey: 'won', label: 'Won', yAxis: 'right' },
      ],
      yAxes: [{ field: 'amount' }, { field: 'won', position: 'right', format: '0.0' }],
    });
    expect(labelsOf(container).map((l) => l.text)).toEqual([
      '174K', '400K', '251K', '92.5K',
      '12.0', '30.0', '18.0', '7.0',
    ]);
  });

  it('prints a combo series in the units of the axis it is drawn against', () => {
    const container = draw('combo', {
      series: [
        { dataKey: 'amount', label: 'Amount', chartType: 'bar' },
        { dataKey: 'won', label: 'Won', chartType: 'line', yAxis: 'right' },
      ],
      yAxes: [{ field: 'amount' }, { field: 'won', position: 'right', format: '0.0' }],
    });
    expect(labelsOf(container).map((l) => l.text)).toEqual([
      '174K', '400K', '251K', '92.5K',
      '12.0', '30.0', '18.0', '7.0',
    ]);
  });
});

describe('objectstack#27372 — the tallest mark keeps its data label on the chart surface', () => {
  for (const chartType of ['bar', 'line', 'area', 'combo'] as const) {
    it(`draws the top label of a ${chartType} chart inside the surface`, () => {
      const container = draw(chartType);
      const labels = labelsOf(container);
      const top = labels.reduce((a, b) => (b.y < a.y ? b : a));
      expect(top.text).toBe('400K');
      // The label's baseline is at `y`; its glyphs rise at most one font size
      // above it. Below that, the label is (partly) off the top of the svg.
      expect(top.y - LABEL_FONT_PX, `"${top.text}" is drawn above the chart surface`).toBeGreaterThanOrEqual(0);
    });
  }

  it('keeps recharts’ default top margin when data labels are off', () => {
    const { container } = render(
      <AdvancedChartImpl
        chartType="bar"
        data={PIPELINE}
        xAxisKey="stage"
        series={[{ dataKey: 'amount', label: 'Amount' }]}
        showLegend={false}
        isAnimationActive={false}
      />,
    );
    const plotTop = Number(container.querySelector('defs clipPath rect')?.getAttribute('y'));
    expect(plotTop).toBe(5);
  });
});
