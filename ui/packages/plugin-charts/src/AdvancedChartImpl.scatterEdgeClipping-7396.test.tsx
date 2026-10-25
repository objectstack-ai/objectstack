/**
 * objectui#7396 — a scatter's extreme marks were half-clipped by the plot edge.
 *
 * ## The defect
 *
 * Both scatter axes are numeric and carry no explicit domain, so recharts fits
 * the domain to `[dataMin, dataMax]` and maps it across the WHOLE plot box. A
 * row at either extreme is therefore CENTRED on the boundary, and since a mark
 * has a radius, about half of it paints outside the plot area.
 *
 * Measured on the Chart Gallery scatter ("Estimate vs Progress") in real
 * Chromium — viewport 1440, widget svg 510x350, plot area x 53..505 / y 5..296:
 *
 *   before: cx 53, 256.4, 301.6, 414.6, 459.8, 505 and the y-max row at cy 5,
 *           r 4.514 — first and last ON the x boundary, y-max ON the top one,
 *           each overhanging its edge by 4.514px.
 *   after:  cx 65, 257.6, 300.4, 407.4, 450.2, 493, y-max at cy 17 — worst
 *           clearance 7.486px INSIDE the plot area, on both axes.
 *
 * The card reported the x axis only; the y axis clips the same way and is
 * covered here too.
 *
 * ## Why this is measurable in this environment, when chart geometry usually is not
 *
 * The usual objection holds — happy-dom reports `clientWidth` 0, so a
 * container-size effect never fires and `ResponsiveContainer` would measure
 * nothing. That is exactly what the mock below removes: given an explicit
 * width/height, recharts computes the plot rect, every `cx`/`cy` and the symbol
 * radius ARITHMETICALLY, with no DOM measurement in the path. Verified against
 * the real-Chromium run above: the x coordinates agree to the digit.
 *
 * What is NOT portable is any ABSOLUTE coordinate that depends on text metrics
 * — the legend is shorter here, so the plot rect is taller than Chromium's. So
 * nothing below pins a coordinate: every assertion compares a mark against the
 * plot rect READ FROM THE SAME RENDER.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import React from 'react';
import { render, cleanup } from '@testing-library/react';

vi.mock('recharts', async () => {
  const actual = await vi.importActual<any>('recharts');
  return {
    ...actual,
    // The widget's real box on the showcase Chart Gallery.
    ResponsiveContainer: ({ children }: any) =>
      React.cloneElement(children, { width: 510, height: 350 }),
  };
});

import AdvancedChartImpl from './AdvancedChartImpl';

afterEach(cleanup);

type Row = Record<string, unknown>;

/** The six aggregate rows the Chart Gallery scatter plots: progress buckets x
 *  avg estimate_hours. Its x extremes (0 and 100) are the clipped pair. */
const GALLERY: Row[] = [
  { progress: 0, avg_estimate: 16.5 },
  { progress: 45, avg_estimate: 40 },
  { progress: 55, avg_estimate: 60 },
  { progress: 80, avg_estimate: 24 },
  { progress: 90, avg_estimate: 30 },
  { progress: 100, avg_estimate: 12 },
];

/** Puts a row on each of the four edges at once: x min/max and y min/max. The
 *  y floor needs a zero because recharts anchors an all-positive y domain at 0,
 *  so the lowest POSITIVE row never reaches the bottom. */
const FOUR_EDGES: Row[] = [
  { progress: 0, avg_estimate: 0 },
  { progress: 50, avg_estimate: 30 },
  { progress: 100, avg_estimate: 60 },
];

const CONFIG = { progress: { label: 'Progress' }, avg_estimate: { label: 'Avg Estimate' } };

const renderScatter = (data: Row[]) =>
  render(
    <AdvancedChartImpl
      chartType="scatter"
      xAxisKey="progress"
      series={[{ dataKey: 'avg_estimate', label: 'Avg Estimate' }] as any}
      config={CONFIG as any}
      data={data as any}
      isAnimationActive={false}
    />,
  );

/** The plot area, exactly: recharts emits the chart offset rect as the clip path
 *  every cartesian layer is drawn through. */
const plotAreaOf = (c: HTMLElement) => {
  const rect = c.querySelector('defs clipPath rect');
  expect(rect, 'recharts drew no plot-area clip rect').not.toBeNull();
  const num = (a: string) => Number(rect!.getAttribute(a));
  const x = num('x');
  const y = num('y');
  const w = num('width');
  const h = num('height');
  expect([x, y, w, h].every(Number.isFinite), 'plot rect is not numeric').toBe(true);
  expect(w, 'plot area has no width').toBeGreaterThan(0);
  expect(h, 'plot area has no height').toBeGreaterThan(0);
  return { left: x, right: x + w, top: y, bottom: y + h };
};

/** Each mark's painted centre and radius, straight off the symbol path: recharts
 *  writes the symbol's bounding box onto it, so `width / 2` IS the drawn radius
 *  rather than a value assumed from a declaration (objectui#9681 — the scatter
 *  branch's `ZAxis range` was such a declaration, and it was inert). */
const marksOf = (c: HTMLElement) =>
  [...c.querySelectorAll('path.recharts-symbols')].map((p) => {
    const cx = Number(p.getAttribute('cx'));
    const cy = Number(p.getAttribute('cy'));
    const r = Number(p.getAttribute('width')) / 2;
    expect([cx, cy, r].every(Number.isFinite), 'symbol carries no geometry').toBe(true);
    expect(r, 'symbol has no radius, so this measures nothing').toBeGreaterThan(0);
    return { cx, cy, r };
  });

/** Per mark, how far `centre ± r` pokes PAST each plot edge. Negative is inside;
 *  zero is the defect (centred on the boundary, half outside). */
const overhangs = (c: HTMLElement) => {
  const plot = plotAreaOf(c);
  const marks = marksOf(c);
  expect(marks.length, 'no marks were drawn').toBeGreaterThan(0);
  return marks.map((m) => ({
    mark: m,
    left: plot.left - (m.cx - m.r),
    right: m.cx + m.r - plot.right,
    top: plot.top - (m.cy - m.r),
    bottom: m.cy + m.r - plot.bottom,
  }));
};

const worstOverhang = (c: HTMLElement) =>
  Math.max(...overhangs(c).flatMap((o) => [o.left, o.right, o.top, o.bottom]));

describe('objectui#7396 — every scatter mark is drawn wholly inside the plot area', () => {
  it('keeps the gallery scatter clear of both x edges', () => {
    // The card's own fixture. Its x extremes sat exactly ON the boundary, so
    // every overhang here was +r before the margin was reserved.
    const { container } = renderScatter(GALLERY);
    for (const o of overhangs(container)) {
      expect(o.left, `mark at cx ${o.mark.cx} pokes past the left edge`).toBeLessThan(0);
      expect(o.right, `mark at cx ${o.mark.cx} pokes past the right edge`).toBeLessThan(0);
    }
  });

  it('keeps the gallery scatter clear of the y edges too', () => {
    // Not in the card, found while reproducing it: the y-max row was centred on
    // the plot's top edge in the same real-Chromium run.
    const { container } = renderScatter(GALLERY);
    for (const o of overhangs(container)) {
      expect(o.top, `mark at cy ${o.mark.cy} pokes past the top edge`).toBeLessThan(0);
      expect(o.bottom, `mark at cy ${o.mark.cy} pokes past the bottom edge`).toBeLessThan(0);
    }
  });

  it('holds when one row sits on each of the four edges at once', () => {
    // The invariant, not the instance: x min, x max, y min and y max all
    // occupied. The margin has to be reserved on both ends of both axes.
    const { container } = renderScatter(FOUR_EDGES);
    expect(worstOverhang(container), 'a mark is painted outside the plot area').toBeLessThan(0);
  });

  it('reserves at least a full mark radius, so the WHOLE symbol clears the edge', () => {
    // Stated as the reader sees it — "half a dot is showing" is the complaint,
    // and clearing the edge by a hair would still leave it half-clipped once a
    // symbol grows. The margin is sized to `SCATTER_SYMBOL_MAX_AREA`, the
    // headroom budget rather than the size painted today (objectui#9681), so
    // every clearance is a full radius or better.
    const { container } = renderScatter(FOUR_EDGES);
    for (const o of overhangs(container)) {
      for (const [edge, value] of Object.entries({ left: o.left, right: o.right, top: o.top, bottom: o.bottom })) {
        expect(value, `clearance at the ${edge} edge is under one mark radius`).toBeLessThanOrEqual(-o.mark.r);
      }
    }
  });

  it('reserves the margin WITHOUT moving the domain — the tick values are untouched', () => {
    // Why this is one assertion with the containment above rather than its own
    // pin: on its own it passes on the defect too, so it would measure nothing.
    // Together they state the whole fix — the marks came inside AND the domain
    // did not move to bring them there. Moving the domain instead would invent
    // unround tick endpoints and would spend the very prop the scatter's
    // spec-axis derivation needs (objectui#9675, since landed: it writes
    // `domain` on both scatter axes, and the two props compose because this
    // one is `padding`). These rows declare no spec axis, so the derivation
    // contributes nothing here and the endpoints below are still the data's.
    const { container } = renderScatter(GALLERY);
    expect(worstOverhang(container), 'a mark is painted outside the plot area').toBeLessThan(0);
    const ticks = (orientation: string) =>
      [...container.querySelectorAll(`text.recharts-cartesian-axis-tick-value[orientation="${orientation}"]`)]
        .map((t) => (t.textContent ?? '').trim());
    // Round endpoints on both axes: the domains are still the data's own
    // `[0, 100]` and `[0, 60]`, laid over a plot box that is merely inset.
    expect(ticks('bottom'), 'the x domain moved').toEqual(['0', '25', '50', '75', '100']);
    expect(ticks('left'), 'the y domain moved').toEqual(['0', '15', '30', '45', '60']);
  });
});
