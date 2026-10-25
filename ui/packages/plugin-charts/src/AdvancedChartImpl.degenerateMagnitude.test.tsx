/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * Pie / donut / funnel / treemap — rows that are NEVER filtered and are given
 * no area anyway (objectui#7147). The third mechanism on this surface, and the
 * one neither landed answer reaches.
 *
 * ## Three mechanisms, one reader-facing symptom
 *
 *   - objectui#7140 / objectui#7146 — an early return emitting a bare `div`
 *   - objectui#7148 — a silent row DROP before the plot
 *   - objectui#7147 — DEGENERATE GEOMETRY, pinned here
 *
 * objectui#7148's footnote counts dropped rows (`data.length - rows.length`).
 * Against these four families that count is exactly ZERO — the sankey arm holds
 * the only row-dropping filter in the file — so hoisting it here would have
 * rendered nothing at all while looking like coverage. The rows stay in `data`
 * and the LAYOUT gives them no area. Zero area is not zero elements, and
 * neither is a dropped row.
 *
 * ## The measurement that decided fix-over-decline, per family
 *
 * 74 tiles in real Chromium (`/opt/pw-browsers/chromium`) at `origin/main`
 * 40c4711d6, each screenshotted, MD5'd and pixel-diffed against a literally
 * empty `div` of the same box. `measured-and-declined` was on the table for
 * every family, as the card says, and survived for none of the four:
 *
 *   - pie / donut all-zero, all-null, all-negative: ZERO non-white pixels out
 *     of 124,800 — byte-identical to the empty div, with 31 descendants and a
 *     real `svg` in the DOM.
 *   - pie / donut `40` beside a `null`: a FULL circle in the first category's
 *     colour, 99.35% pixel-identical to a legitimately one-row dataset (the
 *     0.654% residue is the `paddingAngle` hairline, not information).
 *   - funnel `40` beside a `null`: 178 ink pixels — ZERO segments, ONE label,
 *     and the label reads "Beta", the row with NO value. The row carrying 40
 *     drew nothing at all.
 *   - funnel all-negative: a confident two-band funnel whose mark area
 *     (220,320) EXCEEDS the all-positive control's (111,881).
 *   - treemap `40 / null`, `40 / 0` and `40 / -25 / -12`: all three
 *     BYTE-IDENTICAL (diff 0.000%) to a genuinely one-row treemap. Four
 *     datasets, one image.
 *   - treemap all-zero: ONE full-bleed leaf labelled with the LAST category.
 *
 * The controls are what make those zeros mean anything: an all-zero BAR drew
 * 5,128 ink pixels of axes and ticks on the same instrument — which is why bar
 * is deliberately untouched and pinned that way below — a two-row pie differed
 * from a one-row pie by 9.683% of its pixels, and a two-row treemap from a
 * one-row treemap by 38.301%.
 *
 * ## What this file pins, and why the passing cases are the discriminating half
 *
 * The refusal and the note are only half the pin. The other half is everything
 * that must NOT have moved: the all-positive control of every family keeps its
 * exact DOM (no wrapper element), the no-rows case stays byte-for-byte as it
 * was (that is the empty-RESULT question, objectui#7130, answered upstream in
 * `ObjectChart`), bar keeps its axes, and BOTH landed sankey answers keep
 * firing on their own datasets under their own codes. Measured across the same
 * 74 tiles: every sankey tile and every bar tile hashed IDENTICALLY before and
 * after this change.
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

const SERIES = [{ dataKey: 'amount', label: 'Amount' }];

type Row = Record<string, unknown>;

const renderChart = (chartType: string, data: Row[]) =>
  render(
    <AdvancedChartImpl
      chartType={chartType as any}
      xAxisKey="stage"
      series={SERIES as any}
      data={data as any}
    />,
  );

const refusalOf = (c: HTMLElement) => c.querySelector('[data-chart-error="no-positive-magnitude"]');
const noteOf = (c: HTMLElement) => c.querySelector('[data-chart-note="unsized-rows"]');
const plotOf = (c: HTMLElement) => c.querySelector('[data-slot="chart"]');

/** The four families whose layout sizes a mark BY its measure. */
const MAGNITUDE_FAMILIES = ['pie', 'donut', 'funnel', 'treemap'] as const;

/**
 * Every shape that reaches the layout carrying no positive magnitude.
 *
 * The copy deliberately names NONE of them, for the reason `no-positive-flow`'s
 * docstring gives: a message saying "negative" is false of the `null` row, one
 * saying "zero" is false of the unparseable string, and one naming a missing key
 * is false of all four others. The predicate is true of every one of them, so
 * the predicate is what the sentence names.
 */
const UNSIZABLE: Array<[string, unknown]> = [
  ['a genuine zero', 0],
  ['a negative', -25],
  ['null', null],
  ['undefined', undefined],
  ['an unparseable string', 'n/a'],
  ['Infinity, which `Number(x) || 0` would let through', 'Infinity'],
];

describe('objectui#7147 — no row can be sized: the chart refuses instead of drawing nothing', () => {
  for (const family of MAGNITUDE_FAMILIES) {
    for (const [label, value] of UNSIZABLE) {
      it(`${family}: every row carrying ${label} gets a refusal, not a blank tile`, () => {
        const { container } = renderChart(family, [
          { stage: 'Alpha', amount: value },
          { stage: 'Beta', amount: value },
        ]);
        const refusal = refusalOf(container);
        expect(refusal).not.toBeNull();
        // The message names the KEY and the exact test it failed — the same
        // diagnostic pair `no-positive-flow` carries, which is why neither
        // needs a console warning.
        expect(refusal!.textContent).toContain('amount');
        expect(refusal!.textContent).toContain('above zero');
        // A refusal REPLACES the plot; it does not sit beside one.
        expect(plotOf(container)).toBeNull();
        expect(noteOf(container)).toBeNull();
      });
    }
  }

  it('a missing measure key on every row refuses too', () => {
    const { container } = renderChart('pie', [{ stage: 'Alpha' }, { stage: 'Beta' }]);
    expect(refusalOf(container)).not.toBeNull();
  });

  it('the refusal uses its OWN code, never the sankey arm\'s', () => {
    const { container } = renderChart('funnel', [
      { stage: 'Alpha', amount: 0 },
      { stage: 'Beta', amount: 0 },
    ]);
    expect(refusalOf(container)).not.toBeNull();
    expect(container.querySelector('[data-chart-error="no-positive-flow"]')).toBeNull();
  });
});

describe('objectui#7147 — SOME rows can be sized: the chart still draws, and says how many it could not', () => {
  for (const family of MAGNITUDE_FAMILIES) {
    for (const [label, value] of UNSIZABLE) {
      it(`${family}: one good row beside ${label} still DRAWS, with a note`, () => {
        const { container } = renderChart(family, [
          { stage: 'Alpha', amount: 40 },
          { stage: 'Beta', amount: value },
        ]);
        // The plot is not blanked — objectui#7146 pins the analogous "one
        // positive row among zeros still draws" for the sankey arm, and the
        // same must hold here or a fix becomes a regression.
        expect(plotOf(container)).not.toBeNull();
        expect(refusalOf(container)).toBeNull();
        const note = noteOf(container);
        expect(note).not.toBeNull();
        expect(note!.getAttribute('role')).toBe('note');
        expect(note!.textContent).toContain('1 of 2 rows has');
        expect(note!.textContent).toContain('amount');
      });
    }
  }

  it('the COUNT is the half a reader cannot recover from the picture', () => {
    const { container } = renderChart('treemap', [
      { stage: 'Alpha', amount: 40 },
      { stage: 'Beta', amount: -25 },
      { stage: 'Gamma', amount: -12 },
    ]);
    // Measured: this dataset rendered ONE full-bleed leaf, byte-identical to a
    // genuinely one-row treemap. "Some rows" would leave those two images
    // identical in meaning; "2 of 3" is the bit that was missing.
    expect(noteOf(container)!.textContent).toContain('2 of 3 rows have');
  });

  it('the note uses its OWN attribute, never objectui#7148\'s', () => {
    const { container } = renderChart('pie', [
      { stage: 'Alpha', amount: 40 },
      { stage: 'Beta', amount: 0 },
    ]);
    expect(noteOf(container)).not.toBeNull();
    expect(container.querySelector('[data-chart-note="omitted-rows"]')).toBeNull();
  });
});

describe('objectui#7147 — the cases that must NOT have moved', () => {
  for (const family of MAGNITUDE_FAMILIES) {
    it(`${family}: an all-positive chart gains no note, no refusal and NO WRAPPER`, () => {
      const { container } = renderChart(family, [
        { stage: 'Alpha', amount: 40 },
        { stage: 'Beta', amount: 25 },
      ]);
      expect(refusalOf(container)).toBeNull();
      expect(noteOf(container)).toBeNull();
      // `ChartFootnote` with a null note returns its children untouched, so the
      // plot stays the FIRST element — no existing caller gains a wrapper.
      expect(container.firstElementChild?.getAttribute('data-slot')).toBe('chart');
    });

    it(`${family}: handed NO rows at all, nothing is said`, () => {
      // The empty-RESULT question (objectui#7130) is answered upstream in
      // `ObjectChart`, where the query outcome is actually known. "No row's
      // measure is above zero" would be a sentence about rows that do not
      // exist.
      const { container } = renderChart(family, []);
      expect(refusalOf(container)).toBeNull();
      expect(noteOf(container)).toBeNull();
    });
  }

  it('bar is untouched: an all-zero bar chart still draws its axes and says nothing', () => {
    // Deliberate, and measured: an all-zero bar drew 5,128 ink pixels of axes
    // and ticks against a blank tile's 0. Its reader can already tell a zero
    // dataset from a broken widget, so bar is outside this card.
    const { container } = renderChart('bar', [
      { stage: 'Alpha', amount: 0 },
      { stage: 'Beta', amount: 0 },
    ]);
    expect(refusalOf(container)).toBeNull();
    expect(noteOf(container)).toBeNull();
    expect(plotOf(container)).not.toBeNull();
  });
});

describe('objectui#7147 — the seam with the two landed sankey answers, pinned from both sides', () => {
  it('an all-zero SANKEY keeps objectui#7146\'s refusal and never gets this one', () => {
    const { container } = renderChart('sankey', [
      { stage: 'Alpha', amount: 0 },
      { stage: 'Beta', amount: 0 },
    ]);
    expect(container.querySelector('[data-chart-error="no-positive-flow"]')).not.toBeNull();
    expect(refusalOf(container)).toBeNull();
  });

  it('a thinned SANKEY keeps objectui#7148\'s footnote and never gets this note', () => {
    const { container } = renderChart('sankey', [
      { stage: 'Alpha', amount: 40 },
      { stage: 'Beta', amount: -25 },
    ]);
    expect(container.querySelector('[data-chart-note="omitted-rows"]')).not.toBeNull();
    expect(noteOf(container)).toBeNull();
  });

  it('the codes are mutually exclusive on every dataset in the sweep', () => {
    // Extended by objectui#7171 rather than duplicated beside: scatter and its
    // two codes join the SAME exclusivity assertion, so a sixth answer cannot
    // be added later without this test having an opinion about it.
    const datasets: Row[][] = [
      [{ stage: 'Alpha', amount: 0 }, { stage: 'Beta', amount: 0 }],
      [{ stage: 'Alpha', amount: 40 }, { stage: 'Beta', amount: null }],
      [{ stage: 'Alpha', amount: 40 }, { stage: 'Beta', amount: 25 }],
      [],
    ];
    // Scatter reads TWO measures, so the sweep's single-measure rows are also
    // the dataset that leaves it unplaceable — which is exactly the pair this
    // assertion has to keep apart.
    const scatterDatasets: Row[][] = [
      ...datasets,
      [{ stage: 1, amount: 40 }, { stage: 2, amount: 25 }],
      [{ stage: 1, amount: 40 }, { stage: 2, amount: null }],
    ];
    for (const family of [...MAGNITUDE_FAMILIES, 'sankey', 'bar', 'scatter']) {
      for (const data of family === 'scatter' ? scatterDatasets : datasets) {
        const { container } = renderChart(family, data);
        const codes = [
          container.querySelector('[data-chart-error="no-positive-flow"]'),
          container.querySelector('[data-chart-error="no-positive-magnitude"]'),
          container.querySelector('[data-chart-error="no-plottable-points"]'),
          container.querySelector('[data-chart-note="omitted-rows"]'),
          container.querySelector('[data-chart-note="unsized-rows"]'),
          container.querySelector('[data-chart-note="unplotted-points"]'),
        ].filter(Boolean).length;
        expect(codes, `${family} / ${JSON.stringify(data)}`).toBeLessThanOrEqual(1);
        cleanup();
      }
    }
  });

  it('scatter never receives a MAGNITUDE code, and a magnitude family never receives scatter\'s', () => {
    // objectui#7171. Same fence as the sankey pair above: pie sizes by
    // magnitude and scatter plots by position, so an all-negative dataset is a
    // refusal for one and perfectly ordinary data for the other.
    const negatives: Row[] = [{ stage: -10, amount: -40 }, { stage: -20, amount: -25 }];
    const { container: scatter } = renderChart('scatter', negatives);
    expect(scatter.querySelector('[data-chart-error="no-plottable-points"]')).toBeNull();
    expect(refusalOf(scatter)).toBeNull();
    expect(noteOf(scatter)).toBeNull();
    cleanup();

    const { container: pie } = renderChart('pie', negatives);
    expect(refusalOf(pie)).not.toBeNull();
    expect(pie.querySelector('[data-chart-error="no-plottable-points"]')).toBeNull();
  });
});
