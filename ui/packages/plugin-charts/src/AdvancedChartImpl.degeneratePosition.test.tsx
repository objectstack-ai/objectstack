/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * Scatter — rows that cannot be PLACED (objectui#7171). The fourth mechanism on
 * this surface, and the first positional one.
 *
 * ## Why this card exists at all: a control that returns zero is no control
 *
 * objectui#7147 swept eight chart families for degenerate magnitude and reached
 * a verdict for seven. Scatter's every tile drew ZERO marks — its all-positive
 * CONTROL included — because scatter takes TWO measures and that sweep's
 * fixture supplied one. With the control dead, none of scatter's zeros carried
 * information: they were indistinguishable from "the fixture never bound a
 * scatter at all". Reporting scatter as clean on that evidence would have been
 * a false green across nine datasets, so it was reported NOT MEASURED instead —
 * which is neither red nor green.
 *
 * The first test below is therefore the load-bearing one: it asserts the
 * control DRAWS. If it ever goes red, every other assertion in this file is
 * void rather than passing, and that is the point of stating it as an assertion
 * instead of an eyeballed observation.
 *
 * ## What a correct measurement found
 *
 * 33 tiles in real Chromium (`/opt/pw-browsers/chromium`) at `origin/main`
 * 899730e0a, one page load each, screenshotted, MD5'd and pixel-diffed against
 * a literally empty `div` of the same 520x360 box — above the chart's own
 * `CHART_MIN_HEIGHT` floor of 280, below which no footnote is visible at all.
 * The two-measure control drew 3 of 3 marks (245px of mark area). Then:
 *
 *   - rows whose x AND y are both unplaceable rendered BYTE-IDENTICALLY (diff
 *     0.000%) to a scatter handed NO ROWS AT ALL — the empty-result picture,
 *     for a query that returned rows;
 *   - `null` x, absent x, `'n/a'` x, `'Infinity'` x, boolean x and
 *     objectui#7147's own category-column fixture were SIX datasets sharing ONE
 *     image (`51957063d9c2`): a confident y scale, an x axis with no scale at
 *     all, and no marks;
 *   - one plottable row among three was 99.75% pixel-identical to a genuinely
 *     one-row scatter (diff 0.250%) — the same collision that decided pie.
 *
 * After the change: 15 tiles moved, 18 are byte-identical, and the two
 * collisions above are broken (0.000% to 2.651%, and 0.250% to 6.368%).
 *
 * ## Measured and DECLINED, so nothing here pins a guard for it
 *
 * ZERO VARIANCE — three rows at one coordinate. A2.3 predicted axis domain
 * collapse and there is none: Recharts pads the domain exactly as for one row
 * (x ticks `0,3,6,9,12` in both), draws all three symbols, and the tile is
 * 99.98% identical to a one-row scatter because three coincident points ARE one
 * dot. That is overplotting — a property of the form, and a TRUE picture.
 */
import React from 'react';
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, cleanup } from '@testing-library/react';

vi.mock('recharts', async () => {
  const actual = await vi.importActual<any>('recharts');
  return {
    ...actual,
    ResponsiveContainer: ({ children }: any) =>
      React.cloneElement(children, { width: 480, height: 320 }),
  };
});

import AdvancedChartImpl from './AdvancedChartImpl';

afterEach(cleanup);

type Row = Record<string, unknown>;

const SERIES = [{ dataKey: 'ym', label: 'Y' }];

/** Both axes bound to a numeric measure — the fixture objectui#7147 lacked. */
const renderScatter = (data: Row[], props: Record<string, unknown> = {}) =>
  render(
    <AdvancedChartImpl
      chartType="scatter"
      xAxisKey="xm"
      series={SERIES as any}
      data={data as any}
      isAnimationActive={false}
      {...(props as any)}
    />,
  );

const refusalOf = (c: HTMLElement) => c.querySelector('[data-chart-error="no-plottable-points"]');
const noteOf = (c: HTMLElement) => c.querySelector('[data-chart-note="unplotted-points"]');
const plotOf = (c: HTMLElement) => c.querySelector('[data-slot="chart"]');
/** Recharts paints one `path.recharts-symbols` per PLACED point. */
const marksOf = (c: HTMLElement) => c.querySelectorAll('path.recharts-symbols').length;

/** Three rows, both coordinates finite on every one of them. */
const CONTROL: Row[] = [{ xm: 10, ym: 40 }, { xm: 20, ym: 25 }, { xm: 35, ym: 60 }];

/**
 * Every shape that reaches a numeric axis carrying nothing it can place.
 *
 * `Number()` alone gets the first two WRONG in the permissive direction —
 * `Number(null) === 0` and `Number(true) === 1` are both finite — and Recharts
 * plots neither. Measured, not assumed: 0 of 2 marks each.
 */
const UNPLACEABLE: Array<[string, unknown]> = [
  ['null, which `Number()` would call a finite 0', null],
  ['a missing key', undefined],
  ['an unparseable string', 'n/a'],
  ['Infinity', 'Infinity'],
];

describe('objectui#7171 — THE CONTROL. Every other assertion in this file depends on it', () => {
  it('a TWO-measure scatter actually draws marks', () => {
    // objectui#7147's single-measure fixture drew ZERO here, which is why
    // scatter came out of that sweep NOT MEASURED. A control that returns zero
    // is no control, so this is asserted rather than observed: if it goes red,
    // every zero below is void, not green.
    const { container } = renderScatter(CONTROL);
    expect(marksOf(container), 'the all-positive control MUST draw').toBeGreaterThan(0);
    expect(marksOf(container)).toBe(3);
  });

  it('objectui#7147\'s own fixture is reproduced, and it is the fixture that was broken', () => {
    // A category column on a `type="number"` axis. Same renderer, same head —
    // the difference between this and the control is the FIXTURE, which is the
    // whole claim of the card.
    const { container } = render(
      <AdvancedChartImpl
        chartType="scatter"
        xAxisKey="stage"
        series={[{ dataKey: 'amount', label: 'Amount' }] as any}
        data={[{ stage: 'Alpha', amount: 40 }, { stage: 'Beta', amount: 25 }] as any}
        isAnimationActive={false}
      />,
    );
    expect(marksOf(container)).toBe(0);
  });
});

describe('objectui#7171 — no row can be placed: the chart says so instead of drawing an empty axis', () => {
  for (const [label, value] of UNPLACEABLE) {
    it(`x is ${label} on every row: a refusal, not a frame with no marks`, () => {
      const { container } = renderScatter([{ xm: value, ym: 40 }, { xm: value, ym: 25 }]);
      const refusal = refusalOf(container);
      expect(refusal).not.toBeNull();
      // A point needs BOTH coordinates, so the message names both keys.
      expect(refusal!.textContent).toContain('xm');
      expect(refusal!.textContent).toContain('ym');
      expect(plotOf(container)).toBeNull();
      expect(noteOf(container)).toBeNull();
    });

    it(`y is ${label} on every row: the same refusal — a point needs BOTH`, () => {
      const { container } = renderScatter([{ xm: 10, ym: value }, { xm: 20, ym: value }]);
      expect(refusalOf(container)).not.toBeNull();
    });

    it(`BOTH coordinates are ${label}: refused, not shown the empty-result picture`, () => {
      // Measured at 899730e0a: this rendered BYTE-IDENTICALLY (0.000%) to a
      // scatter handed no rows at all. That collision is the defect.
      const { container } = renderScatter([{ xm: value, ym: value }, { xm: value, ym: value }]);
      expect(refusalOf(container)).not.toBeNull();
    });
  }

  it('rows carrying neither key at all are refused', () => {
    const { container } = renderScatter([{ other: 1 }, { other: 2 }]);
    expect(refusalOf(container)).not.toBeNull();
  });

  it('the refusal names the keys it was actually given, not a hardcoded pair', () => {
    const { container } = renderScatter(
      [{ lat: null, lng: null }],
      { xAxisKey: 'lat', series: [{ dataKey: 'lng' }] },
    );
    expect(refusalOf(container)!.textContent).toContain('lat');
    expect(refusalOf(container)!.textContent).toContain('lng');
  });

  it('with no series declared the y key falls back to `value`, and the refusal says so', () => {
    // The arm binds `series[0]?.dataKey || 'value'` ONCE and hands it to both
    // the predicate and the YAxis, so the two cannot drift.
    const { container } = renderScatter(
      [{ xm: 10, value: null }, { xm: 20, value: null }],
      { series: [] },
    );
    expect(refusalOf(container)!.textContent).toContain('value');
  });
});

describe('objectui#7171 — a POSITIONAL chart legitimately plots zero and negative numbers', () => {
  // The fence this card was opened with. Pie, funnel and treemap size BY
  // magnitude, so objectui#7147's `Number.isFinite(v) && v > 0` is right there.
  // Scatter plots position: a chart of temperatures or profit deltas is
  // SUPPOSED to show these. Reusing that predicate would refuse correct charts.
  const LEGITIMATE: Array<[string, Row[], number]> = [
    ['all-negative coordinates', [{ xm: -10, ym: -40 }, { xm: -20, ym: -25 }, { xm: -35, ym: -60 }], 3],
    ['every coordinate zero', [{ xm: 0, ym: 0 }, { xm: 0, ym: 0 }], 2],
    ['mixed signs including a zero', [{ xm: 10, ym: 40 }, { xm: -25, ym: -12 }, { xm: 0, ym: 5 }], 3],
    // `''` is the mirror-image trap: it LOOKS like a null, `Number('') === 0`,
    // and Recharts DOES plot it at zero (measured, 2 of 2 marks). Rejecting it
    // would blank a chart that draws.
    ['an empty string, which Recharts places at zero', [{ xm: '', ym: 40 }, { xm: '', ym: 25 }], 2],
    ['numeric strings', [{ xm: '10', ym: 40 }, { xm: '20', ym: 25 }], 2],
  ];

  for (const [label, data, expected] of LEGITIMATE) {
    it(`${label}: draws every mark, and says nothing`, () => {
      const { container } = renderScatter(data);
      expect(marksOf(container), 'all marks drawn').toBe(expected);
      expect(refusalOf(container)).toBeNull();
      expect(noteOf(container)).toBeNull();
    });
  }

  it('zero variance is measured-and-DECLINED: three coincident points are one honest dot', () => {
    // A2.3 predicted axis domain collapse. There is none — Recharts pads the
    // domain exactly as it does for one row, and the picture is TRUE.
    const { container } = renderScatter([{ xm: 10, ym: 40 }, { xm: 10, ym: 40 }, { xm: 10, ym: 40 }]);
    expect(marksOf(container)).toBe(3);
    expect(refusalOf(container)).toBeNull();
    expect(noteOf(container)).toBeNull();
  });

  it('a BOOLEAN coordinate: the all-boolean tile is refused (objectui#7195), the mixed tile still draws', () => {
    // The trap this card was fenced against, hit in a new place. An all-boolean
    // x drew 0 of 2 marks in the browser sweep and looked exactly like a
    // sibling of `null` — and pinning it as unplaceable turned RED here, which
    // is how the mixed reading was found: Recharts needs one real number to
    // build the scale and then coerces the booleans onto it.
    //
    // The REVERSE CONTROL, kept green: a boolean beside a number DOES place, so
    // `isPlottableCoord` still accepts it and neither this card's note nor
    // objectui#7195's refusal may fire — a sentence over three visible points
    // saying they are not there is false about the picture.
    const { container: mixed } = renderScatter([
      { xm: 10, ym: 40 },
      { xm: true, ym: 25 },
      { xm: false, ym: 60 },
    ]);
    expect(marksOf(mixed), 'a boolean beside a number DOES place').toBe(3);
    expect(noteOf(mixed)).toBeNull();
    expect(refusalOf(mixed)).toBeNull();
    expect(mixed.querySelector('[data-chart-error="no-numeric-value"]')).toBeNull();
    cleanup();

    // With EVERY row boolean there is no scale to coerce onto and nothing
    // draws. objectui#7195 (ruled A) answers that on the WHOLE dataset — no
    // row carries a numeric value for `xm` — which is true here and cannot be
    // true of the mixed tile above. Its own code, not this card's: the rows
    // DO pass `isPlottableCoord`, so `no-plottable-points` stays silent.
    const { container: allBool } = renderScatter([{ xm: true, ym: 40 }, { xm: false, ym: 25 }]);
    expect(marksOf(allBool)).toBe(0);
    expect(refusalOf(allBool)).toBeNull();
    expect(noteOf(allBool)).toBeNull();
    expect(plotOf(allBool)).toBeNull();
    const refusal = allBool.querySelector('[data-chart-error="no-numeric-value"]');
    expect(refusal).not.toBeNull();
    expect(refusal!.textContent).toContain('none of the 2 rows has a numeric value for xm');
  });

  it('a constant x with a varying y still draws every mark', () => {
    const { container } = renderScatter([{ xm: 10, ym: 40 }, { xm: 10, ym: 25 }, { xm: 10, ym: 60 }]);
    expect(marksOf(container)).toBe(3);
    expect(refusalOf(container)).toBeNull();
  });
});

describe('objectui#7171 — SOME rows can be placed: it still draws, and says how many it could not', () => {
  for (const [label, value] of UNPLACEABLE) {
    it(`one placeable row beside two whose x is ${label}: draws, with a note`, () => {
      const { container } = renderScatter([
        { xm: 10, ym: 40 },
        { xm: value, ym: 25 },
        { xm: value, ym: 60 },
      ]);
      expect(plotOf(container)).not.toBeNull();
      expect(refusalOf(container)).toBeNull();
      // Measured: exactly ONE symbol for three rows — the missing points really
      // are absent from the picture, which is what lets the copy say so.
      expect(marksOf(container)).toBe(1);
      const note = noteOf(container);
      expect(note).not.toBeNull();
      expect(note!.getAttribute('role')).toBe('note');
      expect(note!.textContent).toContain('2 of 3 rows have');
      expect(note!.textContent).toContain('not drawn');
    });
  }

  it('the COUNT is the half a reader cannot recover from the picture', () => {
    // Measured at 899730e0a: this tile was 99.75% pixel-identical to a
    // genuinely one-row scatter (diff 0.250%). "Some rows" would leave those
    // two pictures identical in meaning; "2 of 3" is the bit that was missing.
    const { container } = renderScatter([
      { xm: 10, ym: 40 },
      { xm: null, ym: 25 },
      { xm: null, ym: 60 },
    ]);
    expect(noteOf(container)!.textContent).toContain('2 of 3 rows have');
  });

  it('a single unplaceable row reads in the singular', () => {
    const { container } = renderScatter([{ xm: 10, ym: 40 }, { xm: 20, ym: null }]);
    expect(noteOf(container)!.textContent).toContain('1 of 2 rows has');
    expect(noteOf(container)!.textContent).toContain('that point is');
  });

  it('a row unplaceable on y alone counts too — a point needs both', () => {
    const { container } = renderScatter([
      { xm: 10, ym: 40 },
      { xm: 20, ym: 'n/a' },
      { xm: 35, ym: 'n/a' },
    ]);
    expect(marksOf(container)).toBe(1);
    expect(noteOf(container)!.textContent).toContain('2 of 3 rows have');
  });
});

describe('objectui#7171 — the cases that must NOT have moved', () => {
  it('an all-placeable scatter gains no note, no refusal and NO WRAPPER', () => {
    const { container } = renderScatter(CONTROL);
    expect(refusalOf(container)).toBeNull();
    expect(noteOf(container)).toBeNull();
    // `ChartFootnote` with a null note returns its children untouched, so the
    // plot stays the FIRST element — no existing caller gains a wrapper.
    expect(container.firstElementChild?.getAttribute('data-slot')).toBe('chart');
  });

  it('handed NO rows at all, nothing is said', () => {
    // The empty-RESULT question (objectui#7130) is answered upstream in
    // `ObjectChart`, where the query outcome is actually known.
    const { container } = renderScatter([]);
    expect(refusalOf(container)).toBeNull();
    expect(noteOf(container)).toBeNull();
    expect(plotOf(container)).not.toBeNull();
  });

  it('a one-row scatter is untouched', () => {
    const { container } = renderScatter([{ xm: 10, ym: 40 }]);
    expect(marksOf(container)).toBe(1);
    expect(refusalOf(container)).toBeNull();
    expect(noteOf(container)).toBeNull();
  });
});

describe('objectui#7171 — the seam with the three landed answers, pinned from both sides', () => {
  it('a scatter that cannot place a row never receives a MAGNITUDE code', () => {
    const { container } = renderScatter([{ xm: null, ym: null }, { xm: null, ym: null }]);
    expect(refusalOf(container)).not.toBeNull();
    expect(container.querySelector('[data-chart-error="no-positive-magnitude"]')).toBeNull();
    expect(container.querySelector('[data-chart-error="no-positive-flow"]')).toBeNull();
    expect(container.querySelector('[data-chart-note="unsized-rows"]')).toBeNull();
    expect(container.querySelector('[data-chart-note="omitted-rows"]')).toBeNull();
  });

  it('an all-negative scatter DRAWS where an all-negative pie refuses', () => {
    // The two halves of the same fence, in one test: identical data, opposite
    // correct answers, because one chart sizes and the other places.
    const rows = [{ xm: -10, ym: -40 }, { xm: -20, ym: -25 }];
    const { container: sc } = renderScatter(rows);
    expect(marksOf(sc)).toBe(2);
    expect(refusalOf(sc)).toBeNull();
    cleanup();

    const { container: pie } = render(
      <AdvancedChartImpl
        chartType="pie"
        xAxisKey="stage"
        series={[{ dataKey: 'amount' }] as any}
        data={[{ stage: 'Alpha', amount: -10 }, { stage: 'Beta', amount: -20 }] as any}
        isAnimationActive={false}
      />,
    );
    expect(pie.querySelector('[data-chart-error="no-positive-magnitude"]')).not.toBeNull();
  });

  it('a magnitude family never receives THIS code', () => {
    for (const family of ['pie', 'donut', 'funnel', 'treemap', 'sankey', 'bar']) {
      const { container } = render(
        <AdvancedChartImpl
          chartType={family as any}
          xAxisKey="stage"
          series={[{ dataKey: 'amount' }] as any}
          data={[{ stage: 'Alpha', amount: 0 }, { stage: 'Beta', amount: 0 }] as any}
          isAnimationActive={false}
        />,
      );
      expect(refusalOf(container), `${family} must not get no-plottable-points`).toBeNull();
      expect(noteOf(container), `${family} must not get unplotted-points`).toBeNull();
      cleanup();
    }
  });

  it('scatter is still outside the category-axis and series-axis guards', () => {
    // Both are pinned elsewhere; re-asserted here because this card adds the
    // first refusal scatter has ever had, and the seam must stay three-way.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { container } = renderScatter([{ xm: 10, ym: 40 }, { xm: 20, ym: 25 }]);
    expect(container.querySelector('[data-chart-error="missing-category-key"]')).toBeNull();
    expect(container.querySelector('[data-chart-error="no-plottable-series"]')).toBeNull();
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it('neither response prints a console warning, matching all three landed answers', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    renderScatter([{ xm: null, ym: null }, { xm: null, ym: null }]);
    cleanup();
    renderScatter([{ xm: 10, ym: 40 }, { xm: null, ym: 25 }]);
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });
});
