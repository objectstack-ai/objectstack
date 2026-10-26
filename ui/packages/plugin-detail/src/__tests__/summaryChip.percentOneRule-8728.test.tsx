/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The `summaryFields` chip beside the record H1 states ONE percentage
 * (objectui#8728).
 *
 * ## The defect, reproduced two-sided
 *
 * The chip draws a `percent` twice — as text and as a bar — and the two halves
 * scaled the same stored number by two different rules:
 *
 *     display = `${num}%`;                            // the text: no scaling
 *     const normalized = num <= 1 ? num * 100 : num;  // the bar: ratio, scaled
 *
 * Measured on `7f27bc543`, before the fix, with `fields: [{ name: 'ratio',
 * type: 'percent' }]`:
 *
 * | stored  | chip text | bar fill  | agree? |
 * |---------|-----------|-----------|--------|
 * | `0.123` | `0.123%`  | `12.3%`   | NO     |
 * | `12.3`  | `12.3%`   | `12.3%`   | yes    |
 *
 * Two-sided is the point: a one-sided reproduction cannot tell "this chip
 * contradicts itself" apart from "percent formatting is odd here". The second
 * row is also the CONTROL — it must read exactly as it does today, before and
 * after, and on both legs of the ablation.
 *
 * ## What is asserted, and why it is a RELATION
 *
 * Every row asserts that the bar draws the number the text states, clamped to
 * the track — not that a particular string appeared. A per-half assertion
 * ("text is `12.3%`", "bar is 12.3%") would go green on a repair that made both
 * halves wrong in a new matching way, which is precisely the failure this card
 * is about. The expected strings are pinned as well, because a relation alone
 * would go green on a chip that printed `0%` beside an empty bar for
 * everything.
 *
 * ## The boundary rows
 *
 * `EXACTLY 1` is the fork triage named: is a stored `1` one percent or one
 * hundred? This chip used to answer 100%, because that is what its bar already
 * drew and the ruling here was that the text follows the bar — an answer that
 * was this chip's alone, while `percentDisplayValue` in `@object-ui/core`, and
 * so the list cell, the dashboard measure and the grid column summary, all
 * rendered a stored `1` as `1%`.
 *
 * ⭐ objectui#9071 MOVED IT, and this is the row that recorded which way. That
 * card took the census this one asked for, found the local predicate to be the
 * only spelling of its kind on this side of the tree, and deleted it in favour
 * of the declared source. A stored `1` now reads `1%` here as it always did
 * everywhere else, and a stored `-5` reads `-5%` rather than `-500%`. The rows
 * below carry the new answers; what did NOT move — every value inside the band
 * the two rules always agreed on, the control among them — is the rest of this
 * table, unchanged. The two-places pin is
 * `summaryChip.percentSource-9071.test.tsx`; this file keeps stating the
 * relation objectui#8728 is about, that the chip's two halves never disagree
 * with EACH OTHER.
 *
 * ## ⭐ objectui#9167 moved three of these rows' TEXT, and nothing else
 *
 * objectui#9071 took the SCALING half of `percentDisplayValue`'s contract and
 * stopped; objectui#9167 took the CONVENTION half, so the chip's text is now
 * `formatPercent(stored, precision, locale)` — the list cell's own call. Three
 * rows moved, each onto the reading the cell was already giving:
 *
 * | stored  | before #9167 | after #9167 | why                                  |
 * |---------|--------------|-------------|--------------------------------------|
 * | `0.123` | `12.3%`      | `12%`       | the field's declared precision, 0     |
 * | `12.3`  | `12.3%`      | `12%`       | same                                  |
 * | `1.5`   | `1.5%`       | `2%`        | same, rounding half-expand            |
 *
 * ⚠️ The `12.3` row is this file's CONTROL, and it moved. Its argument was
 * "already in percentage points, so the SCALING leaves it alone" — and that is
 * still true and still asserted: its bar is 12.3 before and after. What moved is
 * the SPELLING, which is the whole of objectui#9167. The control against a
 * runaway repair is now the bar column, pinned per row below.
 *
 * ⚠️ And the relation itself had to be RESTATED, not just re-expected. "The bar
 * draws the number the text states" was an exact equality only while the text
 * was the unrounded number; once the text rounds to the field's precision, the
 * bar and the text differ by up to half a unit in the last declared place BY
 * DESIGN — the cell's bar is unrounded for the same reason. So the relation is
 * now stated modulo that rounding, and it still fails for the defect this file
 * exists for: the original `0.123%` beside a bar at 12.3% is off by 12.177,
 * twenty-four times the slack.
 *
 * ## Instruments
 *
 * - The chip is navigated by `[data-summary-chip="ratio"]`, never by
 *   `queryByText`: every summary value also renders in the body grid, and
 *   `queryByText` throws on multiple matches as well as on none.
 * - The bar's fill is read from the inline `width` — the one place the drawn
 *   percentage exists in the DOM. It is an author-declared, data-driven length,
 *   the carve-out the styling rule already grants this bar.
 * - The chip is mounted with NO i18n provider, exactly as objectui#8728 wrote
 *   it. That is deliberate and still deterministic after objectui#9167: with no
 *   tenant locale and no active UI language, `useDisplayLocale` returns its
 *   documented floor `'en'` rather than the machine's locale, so the expected
 *   strings below are the `en` convention and do not vary with the runner. The
 *   NON-`en` legs are objectui#9167's own pin
 *   (`summaryChip.percentConvention-9167.test.tsx`), which mounts an explicit
 *   session for each locale it names.
 * - The accessible name is asserted only for its PERCENTAGE — that it ends with
 *   the same text the chip shows. How the chip NAMES the field is objectui#8729,
 *   the serial card on this same render, and pinning that here would hand it a
 *   pin to fight for no reason.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import * as React from 'react';
import { DetailView } from '../DetailView';
import type { DetailViewSchema } from '@object-ui/types';

/**
 * `useRecordEditable` falls back to the GLOBAL fetch with no
 * `SchemaRendererProvider` in the tree; under happy-dom that is a real request.
 * Served from a double so no case here depends on the network.
 */
beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok: true, json: async () => ({ record: { visible: true } }) })),
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
  cleanup();
});

/**
 * objectui#11475 — the chip reads the field's DECLARED storage (the spec's
 * `percentScaleOf`: a fraction unless the field declares a `max` above 1), not
 * a storage guessed from the value's size. A row whose stored value is
 * percentage POINTS is rendered on a field declaring whole-point storage
 * (`whole`), the way a whole-stored field does; every row's text and bar, and
 * the text-against-bar pin, are as before.
 */
const renderChip = (stored: unknown, whole = false) =>
  render(
    <DetailView
      schema={
        {
          type: 'record:details',
          objectName: 'account',
          summaryFields: ['ratio'],
          fields: [{ name: 'ratio', label: 'Ratio', type: 'percent', ...(whole ? { max: 1000 } : {}) }],
          data: { id: 'A9', name: 'Acme', ratio: stored },
        } as unknown as DetailViewSchema
      }
    />,
  ).container;

const requireChip = (c: HTMLElement): HTMLElement => {
  const chip = c.querySelector<HTMLElement>('[data-summary-chip="ratio"]');
  expect(chip, 'a summary chip for "ratio" is beside the H1').not.toBeNull();
  return chip!;
};

const textOf = (el: HTMLElement) => (el.textContent ?? '').replace(/\s+/g, ' ').trim();

/**
 * The percentage the chip SAYS, read back out of its own text.
 *
 * The shape is the `en` convention — the locale these rows are mounted in — and
 * it admits the GROUPING separator objectui#9167 brought with it, so a repair
 * that started grouping is read rather than rejected as malformed. The sign is
 * a suffix in `en`; locales that put it in front are pinned in objectui#9167's
 * own file, which does not parse the text back at all.
 */
const spokenPercent = (chip: HTMLElement): number => {
  const text = textOf(chip);
  expect(text, 'the chip states a percentage in the en convention').toMatch(
    /^-?\d{1,3}(,\d{3})*(\.\d+)?%$/,
  );
  return Number(text.slice(0, -1).replace(/,/g, ''));
};

/** The percentage the chip DRAWS, read off the bar fill's own width. */
const drawnPercent = (chip: HTMLElement): number => {
  const track = chip.querySelector<HTMLElement>('[aria-hidden]');
  expect(track, 'the chip draws its own bar track').not.toBeNull();
  const fill = track!.querySelector<HTMLElement>('span[style]');
  expect(fill, 'the track carries a fill span with a width').not.toBeNull();
  const width = fill!.style.width;
  expect(width, 'the fill width is a percentage').toMatch(/%$/);
  return Number(width.slice(0, -1));
};

/** The bar cannot draw outside its track, so agreement is stated modulo this. */
const onTrack = (p: number) => Math.max(0, Math.min(100, p));

/**
 * The field below declares no `precision`, so both places take the list cell's
 * documented default. The chip's text rounds to it (objectui#9167); the bar does
 * not, and must not — the cell's own bar is unrounded too.
 */
const DECLARED_PRECISION = 0;

/**
 * How far the drawn magnitude may sit from the stated one: half a unit in the
 * last declared place, which is exactly what rounding to `DECLARED_PRECISION`
 * can move. ⛔ Not a tolerance for "close enough" — the defect this file exists
 * for misses by 12.177 at `0.123`, twenty-four times this slack, and a repair
 * that re-desynchronised the two halves by any factor is still red.
 */
const ROUNDING_SLACK = 0.5 * 10 ** -DECLARED_PRECISION;

interface Row {
  what: string;
  stored: number;
  /** What the chip STATES, in the `en` convention objectui#9167 routed it onto. */
  text: string;
  /** What the chip DRAWS, clamped to its track — unrounded, and unmoved by #9167. */
  bar: number;
  /** The value is percentage points, stored on a whole-point field (objectui#11475). */
  whole?: boolean;
}

const ROWS: Row[] = [
  // The card's own reproduction. Before the fix: text `0.123%`, bar 12.3%.
  // objectui#9167 then rounded the TEXT to the field's declared width; the
  // bar is the same 12.3 it has drawn since objectui#8728.
  { what: 'a stored ratio — the card\'s reproduction', stored: 0.123, text: '12%', bar: 12.3 },
  // CONTROL for the SCALING — already percentage points, so the magnitude may
  // not move, and it does not: the bar is 12.3 before and after objectui#9167.
  // Its TEXT moved with the convention half; see the header.
  { what: 'CONTROL — a value already in points keeps its magnitude', stored: 12.3, text: '12%', bar: 12.3, whole: true },
  { what: 'zero', stored: 0, text: '0%', bar: 0 },
  // THE FORK, after objectui#9071 moved it. See the header: one percentage
  // point, the answer every other band already gave.
  { what: 'EXACTLY 1 — one percentage point, as everywhere else', stored: 1, text: '1%', bar: 1, whole: true },
  // The row where rounding moves the text by the FULL slack: half-expand takes
  // 1.5 to 2 while the bar keeps 1.5.
  { what: 'just above 1 — the other side of the same boundary', stored: 1.5, text: '2%', bar: 1.5, whole: true },
  // Agreement has to survive the clamp: the text keeps the real number, the
  // bar saturates. A row that only ever tested unclamped values would let a
  // repair that clamped the TEXT too pass.
  { what: 'a large value — the bar saturates, the text does not', stored: 250, text: '250%', bar: 100, whole: true },
  // The residue row. `0.07 * 100` is `7.000000000000001` in binary floating
  // point — invisible as a CSS width, unreadable as a label.
  { what: 'a ratio whose scaling carries float residue', stored: 0.07, text: '7%', bar: 7 },
  // The other end of the same boundary. objectui#8728 moved this text to
  // `-500%` because the bar's rule scaled it and the ruling was that the text
  // follows the bar; objectui#9071 then replaced that rule with the declared
  // source, which passes a value at or below -1 straight through. The bar is
  // unchanged across both cards — any negative clamps to an empty track — so
  // this row only ever moved on the half that reads the number.
  { what: 'a negative at or below -1 — passed through by the shared rule', stored: -5, text: '-5%', bar: 0, whole: true },
];

/**
 * By how much this chip's two halves disagree, in percentage points: what the
 * bar draws, against what the text states once the track has clamped it.
 * Zero before objectui#9167 rounded the text; at most {@link ROUNDING_SLACK}
 * after, and 12.177 on the defect this file reproduces.
 */
const halvesDisagreeBy = (chip: HTMLElement): number =>
  Math.abs(drawnPercent(chip) - onTrack(spokenPercent(chip)));

describe('summary chip percent — one stored number, one percentage (objectui#8728)', () => {
  it.each(ROWS)('$what: a stored $stored states $text beside a bar at $bar', ({ stored, text, bar, whole }) => {
    const chip = requireChip(renderChip(stored, whole));

    expect(textOf(chip), 'the chip states this percentage').toBe(text);
    expect(drawnPercent(chip), 'and draws this magnitude, unrounded and clamped').toBe(bar);
    expect(
      halvesDisagreeBy(chip),
      'THE PIN: the bar draws the number the text states, clamped to its track and modulo the declared rounding',
    ).toBeLessThanOrEqual(ROUNDING_SLACK);
  });

  /**
   * The same relation, stated once over the whole table rather than row by
   * row — a repair that fixed one row and broke another is red here even if
   * someone edited that row's expected string to match.
   */
  it('never states one percentage and draws another, for any row above', () => {
    const disagreements = ROWS.filter(({ stored, whole }) => {
      const chip = requireChip(renderChip(stored, whole));
      const disagrees = halvesDisagreeBy(chip) > ROUNDING_SLACK;
      cleanup();
      return disagrees;
    });
    expect(disagreements.map((r) => r.stored), 'every row agrees with itself').toEqual([]);
  });

  /**
   * The accessible name carries no percent formatting of its own — it is built
   * from the very string the chip shows — so the repair reaches it without
   * touching it. Asserted as a suffix on purpose: WHICH name the chip gives the
   * field is objectui#8729's subject, not this card's.
   */
  it('says the same percentage to a screen reader as it shows on screen', () => {
    const chip = requireChip(renderChip(0.123));
    const label = chip.getAttribute('aria-label') ?? '';
    expect(label, 'the chip has an accessible name').not.toBe('');
    expect(
      label.endsWith(textOf(chip)),
      `the accessible name ends with the percentage on screen (got "${label}")`,
    ).toBe(true);
  });

  /**
   * A value the branch cannot read as a number never reaches the bar at all —
   * it falls through to the plain string chip. Pinned because the repair moved
   * the text onto the scaled number, and a coercion that started admitting
   * these would put a `NaN%` beside the H1.
   */
  it('leaves a non-numeric percent value on the plain string path', () => {
    const chip = requireChip(renderChip('n/a' as unknown as number));
    expect(textOf(chip), 'the raw string, not a scaled number').toBe('n/a');
    expect(chip.querySelector('[aria-hidden]'), 'and no bar to disagree with').toBeNull();
  });
});
