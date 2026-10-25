/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * Sankey — SOME rows survive the positive filter and the rest are dropped
 * silently (objectui#7148). The branch next door to objectui#7140's refusal,
 * and the more dangerous of the two.
 *
 * The sankey arm keeps only strictly positive measures
 * (`data.filter((r) => (Number(r?.[dataKey]) || 0) > 0)`). When that filter
 * keeps NOTHING, objectui#7146 now says so. When it keeps SOME, the chart drew
 * a normal, healthy, confident sankey of a fraction of its dataset and nothing
 * anywhere recorded that the other rows existed.
 *
 * ## The measurement that decided fix-over-decline
 *
 * 27 tiles in real Chromium (`/opt/pw-browsers/chromium`) at `origin/main`
 * fd11e1644, each tile screenshotted and SHA-256'd. The card's own dataset
 * (`New business 40 / Refunds -25 / Chargebacks -12`) rendered `svg: 1`,
 * `path: 3`, 18 descendants, no `role`, no text — and, against a live console
 * control that DID fire on the same instrument (`missing-category-key`), zero
 * console output. Its screenshot hashed `13237e6e19a7072a`, byte-identical to
 * FIVE other tiles including a genuinely one-row dataset
 * `[{ stage: 'New business', amount: 40 }]`. Six datasets, one image: the
 * reader had no bit of information separating a complete flow from a third of
 * one. That is why "discarding is all a flow CAN do" does not settle the card —
 * the drop is fine, the silence is not.
 *
 * ## Why a note and not a refusal
 *
 * objectui#7146 pins "one positive row among zeros still draws". That fixture
 * (`0 / 7 / 0`) is itself a THINNED dataset — it lands in this branch and
 * hashed identical to the mixed-sign tile — so a refusal here would blank a
 * chart that pin requires drawn. The two cards meet exactly at
 * `rows.length === 0`: none survive → refusal (objectui#7146); some survive and
 * some do not → this note; all survive → untouched.
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

const renderSankey = (data: Array<Record<string, unknown>>) =>
  render(
    <AdvancedChartImpl
      chartType="sankey"
      xAxisKey="stage"
      series={SERIES as any}
      data={data as any}
    />,
  );

const noteOf = (container: HTMLElement) =>
  container.querySelector('[data-chart-note="omitted-rows"]');
const refusalOf = (container: HTMLElement) =>
  container.querySelector('[data-chart-error="no-positive-flow"]');

/**
 * Every shape `Number(…) || 0` folds to zero, each one BESIDE a survivor.
 *
 * They are not the same situation and the copy deliberately names none of them:
 * a message that said "negative" would be false of the null row, and the card
 * itself notes that `null` and unparseable measures vanish through the very
 * same filter. All five were measured reaching this branch in Chromium.
 */
const THINNED: Array<[string, Array<Record<string, unknown>>, number, number]> = [
  ['negative rows (the card\'s own dataset)', [
    { stage: 'New business', amount: 40 },
    { stage: 'Refunds', amount: -25 },
    { stage: 'Chargebacks', amount: -12 },
  ], 1, 3],
  ['zero rows (objectui#7146\'s pinned boundary)', [
    { stage: 'Prospecting', amount: 0 },
    { stage: 'Proposal', amount: 7 },
    { stage: 'Won', amount: 0 },
  ], 1, 3],
  ['null measures', [
    { stage: 'New business', amount: 40 },
    { stage: 'Refunds', amount: null },
    { stage: 'Credits', amount: null },
  ], 1, 3],
  ['unparseable measures', [
    { stage: 'New business', amount: 40 },
    { stage: 'Refunds', amount: 'n/a' },
  ], 1, 2],
  ['a row missing the measure key entirely', [
    { stage: 'New business', amount: 40 },
    { stage: 'Refunds' },
  ], 1, 2],
  ['a mix that keeps more than one row', [
    { stage: 'New business', amount: 40 },
    { stage: 'Expansion', amount: 25 },
    { stage: 'Chargebacks', amount: -12 },
  ], 2, 3],
];

describe('AdvancedChartImpl — sankey that drew only SOME of its rows (objectui#7148)', () => {
  it.each(THINNED)('says how many rows it drew when handed %s', (_label, rows, kept, total) => {
    const { container } = renderSankey(rows);

    const note = noteOf(container);
    expect(note, 'a partial flow states that it is partial').not.toBeNull();

    // BOTH halves of the count. "Some rows were dropped" would still leave a
    // thinned flow indistinguishable from a complete one; the ratio is the bit
    // the picture cannot carry.
    expect(note?.textContent).toContain(`Showing ${kept} of ${total} rows`);
    // Names the measure it tested and the exact test it failed, so the author
    // knows WHICH column decided it — the same diagnosis the refusal gives.
    expect(note?.textContent).toContain('amount');
    expect(note?.textContent).toContain('above zero');
    // A note annotates; it is not a state change and not an alert.
    expect(note?.getAttribute('role')).toBe('note');

    // ⛔ The chart is still DRAWN. The drop is not the defect — a flow has no
    // negative width — so nothing here may replace a drawable sankey with
    // prose. This is objectui#7146's boundary restated from the other side.
    expect(container.querySelector('svg'), 'a drawable sankey still draws').not.toBeNull();
    expect(refusalOf(container), 'a drawn chart is never also a refusal').toBeNull();
  });

  it('agrees with itself in the singular', () => {
    const { container } = renderSankey([
      { stage: 'New business', amount: 40 },
      { stage: 'Refunds', amount: -25 },
    ]);
    expect(noteOf(container)?.textContent).toContain('1 row has no');
  });

  it('agrees with itself in the plural', () => {
    const { container } = renderSankey([
      { stage: 'New business', amount: 40 },
      { stage: 'Refunds', amount: -25 },
      { stage: 'Chargebacks', amount: -12 },
    ]);
    expect(noteOf(container)?.textContent).toContain('2 rows have no');
  });

  it('CONTROL — an all-positive sankey carries no note, and gains no wrapper', () => {
    const { container } = renderSankey([
      { stage: 'New business', amount: 40 },
      { stage: 'Expansion', amount: 25 },
      { stage: 'Renewal', amount: 12 },
    ]);

    expect(noteOf(container), 'nothing was omitted, so nothing is claimed').toBeNull();
    expect(container.querySelector('svg')).not.toBeNull();
    // The complete-flow path returns the container it always returned. The
    // footnote's flex wrapper would take over the height chain (see
    // `ChartFootnote`), so a chart with nothing to say must not get one.
    expect(
      container.firstElementChild?.getAttribute('data-slot'),
      'the chart container is still the root element',
    ).toBe('chart');
  });

  // ---- the seam with objectui#7146 -------------------------------------
  //
  // `rows.length` is the whole boundary: 0 survivors is that card, 1-or-more
  // survivors alongside a casualty is this one, and no casualties at all is
  // neither. Pinned from both sides so neither answer can drift into the
  // other's branch.

  it('SEAM — no row survives: objectui#7146 refuses, and this note stays out of it', () => {
    const { container } = renderSankey([
      { stage: 'A', amount: 0 },
      { stage: 'B', amount: 0 },
      { stage: 'C', amount: -5 },
    ]);

    expect(refusalOf(container), 'all-non-positive is still the refusal branch').not.toBeNull();
    expect(noteOf(container), 'a chart that drew nothing has no partial draw to annotate').toBeNull();
    expect(container.querySelector('svg')).toBeNull();
  });

  it('SEAM — no rows at all: still the bare div, untouched by both cards', () => {
    const { container } = renderSankey([]);

    expect(refusalOf(container)).toBeNull();
    expect(noteOf(container)).toBeNull();
    // The empty-RESULT question (objectui#7130), answered upstream in
    // ObjectChart where the query outcome is known.
    expect(container.textContent).toBe('');
  });

  it('does not reach other chart families handed the same mixed-sign rows', () => {
    // The note reads the sankey filter's own result and no other family has
    // such a filter — measured in Chromium, bar/pie/donut/funnel/treemap all
    // keep every row of this dataset in their data array. Pinned because
    // hoisting the count out of this arm is the obvious refactor and would
    // annotate four charts that omitted nothing.
    for (const chartType of ['bar', 'pie', 'donut', 'funnel', 'treemap'] as const) {
      const { container } = render(
        <AdvancedChartImpl
          chartType={chartType}
          xAxisKey="stage"
          series={SERIES as any}
          data={[
            { stage: 'New business', amount: 40 },
            { stage: 'Refunds', amount: -25 },
          ] as any}
        />,
      );
      expect(noteOf(container), `${chartType} omitted nothing and must say nothing`).toBeNull();
      cleanup();
    }
  });
});
