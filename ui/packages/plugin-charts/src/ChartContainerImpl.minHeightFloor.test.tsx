/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#5451 — the min-height floor has to be on the element Recharts
 * MEASURES, not only on the wrapper around it.
 *
 * The sibling `ChartContainerImpl.styleMerge.test.tsx` pins that the fallback
 * survives a consumer `style` (objectstack#7026). That is necessary and was not
 * sufficient: it asserts the WRAPPER's inline style, and the wrapper is not what
 * Recharts reads. `SizeDetectorContainer` renders its own
 * `<div class="recharts-responsive-container" style="width:100%;height:100%">`,
 * observes THAT element, and renders no children at all while the box it reads
 * is non-positive. A percentage height resolves against the containing block's
 * `height`, and `min-height` never makes that height definite (CSS 2.1 §10.5),
 * so the wrapper's floor cannot reach it.
 *
 * Measured in Chromium 141 on the real dashboard chart path, with the wrapper's
 * `h-[350px]` neutralised so the fallback is the only thing holding the box up:
 *
 *   BEFORE   wrapper 638x280 (floor applied) · measured div 638x0
 *            → 0 `.recharts-surface`, 0 marks, no refusal, no empty state
 *   AFTER    wrapper 638x280                 · measured div 638x280
 *            → 2 surfaces, 3 pie sectors + 3 bars
 *
 * happy-dom performs no layout, so those pixels cannot be re-measured here.
 * What IS mechanically checkable here — and is the whole invariant — is that the
 * floor reaches the measured element's own inline style, under exactly the same
 * `hasDeclaredHeight` condition that governs the wrapper. Hence: no `recharts`
 * mock in this file. The sibling mocks `ResponsiveContainer` away precisely
 * because it is asserting the wrapper; this file needs the real one, because the
 * real one is the subject.
 */

import React from 'react';
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { BarChart } from 'recharts';

import { ChartContainer } from './ChartContainerImpl';

afterEach(cleanup);

/** The element Recharts observes — the one whose measured box gates every mark. */
function measuredElement(container: HTMLElement): HTMLElement {
  const el = container.querySelector<HTMLElement>('.recharts-responsive-container');
  if (!el) throw new Error('ResponsiveContainer did not render its size-detector div');
  return el;
}

function renderChart(style?: React.CSSProperties) {
  const { container } = render(
    <ChartContainer config={{}} {...(style ? { style } : {})}>
      <BarChart data={[{ name: 'a', v: 1 }]} />
    </ChartContainer>,
  );
  return container;
}

describe('ChartContainer — the min-height floor reaches the measured element (objectui#5451)', () => {
  it('floors the ResponsiveContainer when the consumer declares no height', () => {
    // The failing assertion before the fix: the wrapper grew to 280 while the
    // div Recharts measures kept `height: 100%` against an `auto` containing
    // block — a permanent zero, healed by no resize because nothing ever moves.
    expect(measuredElement(renderChart()).style.minHeight).toBe('280px');
  });

  it('applies the SAME floor the wrapper applies, so the two cannot drift', () => {
    const container = renderChart();
    const wrapper = container.querySelector<HTMLElement>('[data-slot="chart"]')!;
    expect(measuredElement(container).style.minHeight).toBe(wrapper.style.minHeight);
  });

  it("does not floor a height the author declared — an explicit `height` wins", () => {
    // Mirrors the wrapper's own precedence rule: injecting 280 next to an
    // authored `height: 100` would floor that 100, which is the failure mode the
    // objectstack#7026 tests guard on the wrapper. It must not be reintroduced
    // one element lower.
    const container = renderChart({ height: 100 });
    expect(measuredElement(container).style.minHeight).toBe('');
    expect(container.querySelector<HTMLElement>('[data-slot="chart"]')!.style.minHeight).toBe('');
  });

  it("does not floor a `minHeight` the author declared either", () => {
    const container = renderChart({ minHeight: 120 });
    expect(measuredElement(container).style.minHeight).toBe('');
    expect(container.querySelector<HTMLElement>('[data-slot="chart"]')!.style.minHeight).toBe('120px');
  });
});
