/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * ONE record, TWO places, ONE number (objectui#9071).
 *
 * ## What this pins, and why it is not "the chip's new number is right"
 *
 * The chip beside the record H1 scaled a stored `percent` by a rule of its
 * own — a pass-through above 1, a scale-by-100 at or below it — while the
 * declared single source of truth (`percentDisplayValue` in
 * `@object-ui/core`, which the list cell reaches through `formatPercent`)
 * uses the symmetric `value > -1 && value < 1`. The two rules disagree at
 * EXACTLY 1 and at every value at or below -1.
 *
 * Triage's judgement is the acceptance, and it is about DISAGREEMENT, not
 * about the chip:
 *
 *   "a stored `1` renders `100%` in the chip and `1%` everywhere else" — the
 *   same record showing two different numbers in two places is the kind of
 *   disagreement a user reports as a data bug rather than a formatting one.
 *
 * So every case here renders BOTH surfaces from the SAME stored value and the
 * SAME field, and asserts they agree. A pin that only checked the chip could
 * not fail for the reason this card exists: it would go green on a chip that
 * had simply moved to a fourth rule of its own.
 *
 * ## Two instruments, because neither alone covers the disagreement set
 *
 * - **The stated text.** The only instrument that reaches a value at or below
 *   -1: both bars clamp a negative to an empty track, so the bar cannot tell
 *   `-5%` from `-500%`. ⚠️ When this file was written that instrument was valid
 *   only where the two surfaces' CONVENTIONS coincided — the chip appended a
 *   bare `%` to the full number while the cell rendered through the locale's
 *   percent affix at the field's precision (0 by default) — so every row below
 *   was chosen to scale to an integral count of percentage points under four
 *   digits, where the two spellings are byte-identical. ⭐ objectui#9167 removed
 *   that caveat by taking the convention half as well; the rows are unchanged,
 *   and the last case in this file now records the CLOSURE where it used to
 *   record the gap.
 * - **The drawn bar.** Read off each surface's own fill width, before any
 *   rounding, so it states agreement on the scaled MAGNITUDE independently of
 *   how either side spells it.
 *
 * ## The live control
 *
 * `0.25` is inside the band where the two rules already agreed before this
 * change. It renders identically in both places on both legs of the ablation —
 * if it ever moves, the repair reached further than the boundary.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import * as React from 'react';
import { I18nProvider, LocalizationProvider } from '@object-ui/i18n';
import { PercentCellRenderer } from '@object-ui/fields';
import { DetailView } from '../DetailView';
import type { DetailViewSchema, FieldMetadata } from '@object-ui/types';

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
 * The field both surfaces are handed. `ratio` is deliberate: it does NOT match
 * the cell renderer's whole-percent name pattern (`progress` / `completion`),
 * so both surfaces are on the fraction-inferring path this card is about.
 */
const FIELD: FieldMetadata = { name: 'ratio', label: 'Ratio', type: 'percent' };

/**
 * objectui#11475 — both places read the field's DECLARED storage now (the
 * spec's `percentScaleOf`: a fraction unless the field declares a `max` above
 * 1), not a storage guessed from the value's size. `FIELD` stores a fraction;
 * a row whose stored value is percentage POINTS reads on `WHOLE`, which
 * declares whole-point storage the way a whole-stored field does. Each row's
 * reading, and the chip-against-cell pin, are as before.
 */
const WHOLE: FieldMetadata = { ...FIELD, max: 100 } as FieldMetadata;

interface Rendered {
  /** What the surface SAYS, whitespace-collapsed. */
  text: string;
  /** What the surface DRAWS, read off its own fill width. */
  bar: number;
}

/** Place one: the `summaryFields` chip beside the record H1. */
function renderChip(stored: number, field: FieldMetadata = FIELD): Rendered {
  const container = render(
    <DetailView
      schema={
        {
          type: 'record:details',
          objectName: 'account',
          summaryFields: ['ratio'],
          fields: [{ ...field }],
          data: { id: 'A9', name: 'Acme', ratio: stored },
        } as unknown as DetailViewSchema
      }
    />,
  ).container;
  const chip = container.querySelector<HTMLElement>('[data-summary-chip="ratio"]');
  expect(chip, 'a summary chip for "ratio" is beside the H1').not.toBeNull();
  const fill = chip!.querySelector<HTMLElement>('[aria-hidden] span[style]');
  expect(fill, 'the chip draws its own bar fill').not.toBeNull();
  return { text: (chip!.textContent ?? '').replace(/\s+/g, ' ').trim(), bar: pct(fill!.style.width) };
}

/**
 * Place two: the list cell — `PercentCellRenderer`, the surface that reaches
 * `percentDisplayValue` through `formatPercent`. Mounted under an explicit
 * `en` session so the comparison is a property of the SCALING and not of
 * whatever locale the runner happens to carry.
 */
function renderCell(stored: number, field: FieldMetadata = FIELD): Rendered {
  const container = render(
    <I18nProvider config={{ defaultLanguage: 'en', detectBrowserLanguage: false }} persistLanguage={false}>
      <LocalizationProvider value={{ locale: 'en' }}>
        <PercentCellRenderer value={stored} field={{ ...field }} />
      </LocalizationProvider>
    </I18nProvider>,
  ).container;
  const bar = container.querySelector<HTMLElement>('[role="progressbar"] div[style]');
  expect(bar, 'the cell draws its own bar fill').not.toBeNull();
  const value = container.querySelector<HTMLElement>('span.tabular-nums');
  expect(value, 'the cell states its own percentage').not.toBeNull();
  return { text: (value!.textContent ?? '').replace(/\s+/g, ' ').trim(), bar: pct(bar!.style.width) };
}

function pct(width: string): number {
  expect(width, 'the fill width is a percentage').toMatch(/%$/);
  return Number(width.slice(0, -1));
}

interface Row {
  what: string;
  stored: number;
  /** The one percentage BOTH surfaces state. */
  text: string;
  /** The one magnitude BOTH surfaces draw, after each clamps to its track. */
  bar: number;
  /** The field the value is stored on; `FIELD` (a fraction) when absent. */
  field?: FieldMetadata;
}

const ROWS: Row[] = [
  // LIVE CONTROL — inside the band where the two rules already agreed. Green
  // before this change and green after; it is the row that says the repair did
  // not reach past the boundary.
  { what: 'CONTROL — inside the band both rules already agreed on', stored: 0.25, text: '25%', bar: 25 },
  // THE FORK objectui#8728 pinned and handed here. The chip read a stored 1 as
  // a ratio and said `100%` beside a full bar; every other band reads it as one
  // percentage point.
  { what: 'EXACTLY 1 — one percentage point, not one hundred', stored: 1, text: '1%', bar: 1, field: WHOLE },
  // The far edge of the same boundary. `percentDisplayValue` passes -1 through;
  // the chip's rule scaled it to -100.
  { what: 'EXACTLY -1 — the symmetric edge the chip did not have', stored: -1, text: '-1%', bar: 0, field: WHOLE },
  // Below -1. Bars are useless here (both clamp to an empty track), which is
  // why the text instrument exists.
  { what: 'below -1 — the half the bar cannot see', stored: -5, text: '-5%', bar: 0, field: WHOLE },
];

describe('the summary chip reads the declared percent source (objectui#9071)', () => {
  it.each(ROWS)('$what: a stored $stored reads $text in BOTH places', ({ stored, text, bar, field }) => {
    const chip = renderChip(stored, field);
    cleanup();
    const cell = renderCell(stored, field);

    expect(
      chip.text,
      'THE PIN: the chip and the list cell state the same percentage for the same stored value',
    ).toBe(cell.text);
    expect(chip.text, 'and it is this percentage').toBe(text);
    expect(chip.bar, 'the chip draws what the cell draws').toBe(cell.bar);
    expect(chip.bar, 'and it is this magnitude').toBe(bar);
  });

  /**
   * The relation stated once over the whole table rather than row by row, so a
   * repair that fixed one row and broke another is red here even if someone
   * edited that row's expected string to match.
   */
  it('never states one percentage in the chip and another in the cell', () => {
    const disagreements = ROWS.filter(({ stored, field }) => {
      const chip = renderChip(stored, field);
      cleanup();
      const cell = renderCell(stored, field);
      cleanup();
      return chip.text !== cell.text || chip.bar !== cell.bar;
    });
    expect(disagreements.map((r) => r.stored), 'every stored value reads the same in both places').toEqual([]);
  });

  /**
   * ⭐ THE HALF THIS CARD DID NOT FIX — and what closed it.
   *
   * `percentDisplayValue`'s doc comment requires a third surface to take BOTH
   * halves — the scaling AND the convention. objectui#9071 moved the SCALING
   * only, because taking the convention half changes what the chip prints for
   * values it renders correctly today, which its acceptance forbade: the cell
   * rounds to the field's precision (0 by default) and groups through `Intl`,
   * while the chip stated the full number with a bare `%`. A stored `12.3` read
   * `12.3%` on the chip and `12%` in the cell — different spellings of the same
   * magnitude, which the bars proved by agreeing exactly. This case pinned that
   * divergence so the residue could not go quiet.
   *
   * objectui#9167 took the convention half, value by value, and `12.3` is one of
   * the values it moved: the chip now states `12%` as well. The case is kept
   * rather than deleted, because the assertion it was written to make — THE
   * MAGNITUDE IS ONE, whatever either side does with it — is still this card's,
   * and it is the assertion a future convention change must not break. The
   * spelling half is asserted here as a one-line closure and pinned in full,
   * across four locales and both precisions, in
   * `summaryChip.percentConvention-9167.test.tsx`.
   */
  it('agrees on the magnitude, and since objectui#9167 on the spelling too', () => {
    const chip = renderChip(12.3, WHOLE);
    cleanup();
    const cell = renderCell(12.3, WHOLE);

    expect(chip.bar, 'the scaling agrees — this is what objectui#9071 repaired').toBe(cell.bar);
    expect(chip.bar, 'both draw 12.3 points').toBe(12.3);
    expect(
      chip.text,
      "the convention agrees too — the chip rounds to the field's declared width and renders the locale's affix (objectui#9167)",
    ).toBe(cell.text);
    expect(chip.text, 'and it is the reading the cell was already giving').toBe('12%');
  });
});
