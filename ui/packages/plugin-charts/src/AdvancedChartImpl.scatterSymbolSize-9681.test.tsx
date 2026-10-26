/**
 * objectui#9681 — what size the scatter paints its marks, stated as a MEASURED
 * fact rather than as a declaration.
 *
 * ## Why this file exists at all
 *
 * The scatter branch used to carry `<ZAxis type="number" range={[60, 400]} />`.
 * It was INERT: recharts' `selectZAxisWithScale` drops a z axis carrying no
 * `dataKey` before it reaches a mark, so the declared envelope never applied
 * and every mark was painted at recharts' own implicit default area. The
 * declaration's only effect was on readers — and it did mislead one, in
 * writing, on this repository: the triage comment on objectui#7396 read it and
 * derived "the symbol radius is not constant … bubble size is variable (area
 * 60..400 ⇒ radius about 4.4..11.3px)", every clause of which was false at that
 * head.
 *
 * ⭐ The lesson that card left behind: **a declaration is not a reading.** An
 * inert declaration and a live one look identical in the source, so the only
 * defensible answer to "how big are the marks?" is one taken off a render. That
 * is what this file is. Deleting the dead prop removed the wrong answer; this
 * file supplies a right one that cannot go stale unnoticed.
 *
 * ## What would turn these red, and why each red is worth having
 *
 * - Mark area becomes variable (a `ZAxis` gains a `dataKey`, or a symbol size
 *   is bound to data another way). That is a NEW capability, not a repair, and
 *   whoever adds it must come here, restate the size, and re-check
 *   `SCATTER_SYMBOL_MAX_AREA` — the edge margin objectui#7396 reserved is sized
 *   to that budget precisely so it survives that day.
 * - Recharts changes the implicit default area under a version bump. The margin
 *   prose in `AdvancedChartImpl.tsx` says the painted size is a third-party
 *   default; if that default moves, a reader should be told rather than left
 *   with prose that quietly stopped being true.
 *
 * ## Why this is measurable in this environment
 *
 * Same mechanism the objectui#7396 edge-clipping suite documents: given an
 * explicit width/height in place of `ResponsiveContainer`, recharts computes
 * the plot rect and every symbol's geometry arithmetically, with no DOM
 * measurement in the path. Nothing here pins an absolute coordinate — only the
 * symbol's own width, which is not a function of text metrics.
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

/**
 * Recharts' OWN implicit symbol area, in px² — its `implicitZAxis.range` is
 * `[64, 64]` and a scatter point with no z value is painted at that range's
 * lower bound, as a circle of `sqrt(area / PI)`.
 *
 * ⚠️ A THIRD-PARTY figure this repo does not choose and cannot set from the
 * outside today. It is spelled out here, rather than left implicit, so that the
 * day it moves this file says so instead of the margin prose in
 * `AdvancedChartImpl.tsx` going quietly wrong.
 */
const RECHARTS_IMPLICIT_SYMBOL_AREA = 64;

/** The six aggregate rows the Chart Gallery scatter plots — the same fixture
 *  the objectui#7396 suite uses, and the one the false bubble-size prediction
 *  was written about. Its y values span 12..60, a 5x spread. */
const GALLERY: Row[] = [
  { progress: 0, avg_estimate: 16.5 },
  { progress: 45, avg_estimate: 40 },
  { progress: 55, avg_estimate: 60 },
  { progress: 80, avg_estimate: 24 },
  { progress: 90, avg_estimate: 30 },
  { progress: 100, avg_estimate: 12 },
];

/** Deliberately a different order of magnitude from GALLERY, and a far wider
 *  spread inside itself: if anything sized a mark from the data, these two
 *  fixtures could not come out identical. */
const WIDE_SPREAD: Row[] = [
  { progress: 1, avg_estimate: 1 },
  { progress: 50, avg_estimate: 5000 },
  { progress: 99, avg_estimate: 250000 },
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

/** Every mark's painted radius, straight off the symbol path: recharts writes
 *  the symbol's bounding box onto it, so `width / 2` IS the drawn radius. */
const radiiOf = (c: HTMLElement) => {
  const marks = [...c.querySelectorAll('path.recharts-symbols')];
  expect(marks.length, 'no marks were drawn, so this measures nothing').toBeGreaterThan(0);
  return marks.map((p) => {
    const r = Number(p.getAttribute('width')) / 2;
    expect(Number.isFinite(r), 'symbol carries no width, so this measures nothing').toBe(true);
    expect(r, 'symbol has no radius, so this measures nothing').toBeGreaterThan(0);
    return r;
  });
};

describe('objectui#9681 — the scatter paints ONE mark size, and it is measured here', () => {
  it('paints every mark of a chart at the same size', () => {
    // The clause the objectui#7396 triage comment got wrong, stated as an
    // assertion: across a 5x spread of values, the marks are one size.
    const radii = radiiOf(renderScatter(GALLERY).container);
    expect(radii.length, 'the gallery fixture lost rows').toBe(GALLERY.length);
    expect(
      new Set(radii.map((r) => r.toFixed(6))).size,
      `mark size is NOT constant — radii ${JSON.stringify(radii)}. If that is intended, ` +
        'variable-area marks have arrived and SCATTER_SYMBOL_MAX_AREA needs re-checking.',
    ).toBe(1);
  });

  it('paints the same size for a completely different dataset', () => {
    // Uniformity within one chart could also come from rows that happen to
    // agree. This is the stronger statement: the size is a property of the
    // renderer, not of the data — two fixtures four orders of magnitude apart
    // come out identical.
    const [gallery] = radiiOf(renderScatter(GALLERY).container);
    cleanup();
    const [wide] = radiiOf(renderScatter(WIDE_SPREAD).container);
    expect(wide, 'mark size moved with the data').toBeCloseTo(gallery, 6);
  });

  it("draws marks at recharts' implicit default area — nothing in this tree sets it", () => {
    // The reading itself, computed on the line below rather than written out.
    // A red here means
    // either recharts moved its default or this branch started declaring a
    // symbol size again — both are things a reader must be told about, because
    // the edge margin's justification names this as a third-party default.
    const expected = Math.sqrt(RECHARTS_IMPLICIT_SYMBOL_AREA / Math.PI);
    for (const r of radiiOf(renderScatter(GALLERY).container)) {
      expect(r, 'the painted symbol area is no longer recharts’ implicit default').toBeCloseTo(
        expected,
        6,
      );
    }
  });
});
