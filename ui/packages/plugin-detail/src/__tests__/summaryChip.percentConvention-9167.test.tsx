/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * ONE record, TWO places, ONE SPELLING (objectui#9167).
 *
 * ## What this pins, and why it is the second half of objectui#9071
 *
 * `percentDisplayValue` in `@object-ui/core` states the rule in its own doc
 * comment, and the sentence is the judgement: a third surface that needs percent
 * display takes BOTH halves from there — the scaling AND the convention — "or
 * this promise breaks again in the same place". objectui#9071 moved the
 * `summaryFields` chip onto the SCALING and deliberately stopped, because its
 * acceptance made "any value that renders correctly today would render
 * differently" a stop condition and the convention half moves several values.
 *
 * So the chip appended a bare `%` to the full JavaScript number while the list
 * cell (`formatPercent` through `PercentCellRenderer`) rounded to the field's
 * declared precision — `0` by default — and rendered through the locale's own
 * percent affix. Same stored value, same field, two readings.
 *
 * ## The evidence this card owes, run rather than reasoned
 *
 * Every case below drives BOTH surfaces in the SAME run, on the SAME field, from
 * the SAME stored value, and asserts they state the same string. A pin that only
 * checked the chip could not fail for the reason this card exists: it would go
 * green on a chip that had moved to a rounding rule of its own — the exact shape
 * objectui#9071 deleted and `percentDisplayValue`'s doc comment names as how the
 * promise breaks.
 *
 * `MOVED_ROWS` additionally pins the pre-card spelling as a NEGATIVE, so a
 * revert is red here rather than merely different: the whole point of the card is
 * that these values changed, and a table that only stated the new answers could
 * not tell a fix from a rewrite of its own expectations.
 *
 * ## Why the lit controls are a four-digit row and two non-`en` rows
 *
 * Recorded on objectui#9167 by the dispatching seat, from objectui#9268's run:
 * `0.25` and `12.3` are `en` and under four significant digits, so NEITHER
 * locale grouping NOR a percent affix can reach them — a same-locale,
 * low-magnitude pair is decoration that reads as reassurance. The rows that can
 * actually reveal whether the convention half was taken are:
 *
 *  - `1234.5` in `en` — four digits, so grouping shows: `1234.5%` → `1,235%`;
 *  - `de-DE` — the affix is a no-break space plus the sign, and the decimal and
 *    grouping marks swap;
 *  - `tr-TR` — the sign moves to the FRONT (`%25`). ⭐ This is the row no
 *    bare-append implementation can produce by accident, whatever its rounding.
 *
 * ## What did NOT move, asserted alongside
 *
 * The MAGNITUDE. This card touches the chip's TEXT only; the bar keeps reading
 * `summaryChipPercentPoints`, unrounded, exactly as the list cell's own bar
 * reads its `barValue` before formatting. `UNMOVED_ROWS` are the values whose
 * text was already identical in both places — they are green on both legs of the
 * ablation, and their moving would mean the repair reached past the convention.
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
 * the cell renderer's whole-percent name pattern (`progress` / `completion`), so
 * both surfaces are on the same fraction-inferring path. No declared
 * `scale`, so both take the cell's documented default of `0`.
 */
const FIELD: FieldMetadata = { name: 'ratio', label: 'Ratio', type: 'percent' };

/**
 * objectui#11475 — both places read the field's DECLARED storage now (the
 * spec's `percentScaleOf`: a fraction unless the field declares a `max` above
 * 1), not a storage guessed from the value's size. `FIELD` declares no `max`,
 * so it stores a fraction. The rows below whose stored value is percentage
 * POINTS (`1`, `1.5`, `12.3`, `250`, `-5`, `1234.5`) are read on this field,
 * which declares whole-point storage the way a whole-stored field does. Each
 * row's text, and the chip-against-cell agreement this file pins, are as
 * before.
 */
const WHOLE: FieldMetadata = { ...FIELD, max: 10000 } as FieldMetadata;

interface Rendered {
  /** Exactly what the surface put in the DOM, byte for byte. */
  raw: string;
  /** The same text with runs of whitespace collapsed, for readable expectations. */
  text: string;
  /** What the surface DRAWS, read off its own fill width. */
  bar: number;
}

/**
 * Both surfaces are mounted under the SAME declared session locale, because a
 * comparison drawn under two different locales would be a property of the mounts
 * rather than of the two implementations.
 */
function session(locale: string, node: React.ReactNode): React.ReactElement {
  return (
    <I18nProvider config={{ defaultLanguage: 'en', detectBrowserLanguage: false }} persistLanguage={false}>
      <LocalizationProvider value={{ locale }}>{node}</LocalizationProvider>
    </I18nProvider>
  );
}

const collapse = (s: string) => s.replace(/\s+/g, ' ').trim();

/** Place one: the `summaryFields` chip beside the record H1. */
function renderChip(stored: number, locale: string, field: FieldMetadata = FIELD): Rendered {
  const container = render(
    session(
      locale,
      <DetailView
        schema={
          {
            type: 'record:details',
            objectName: 'account',
            summaryFields: [field.name],
            fields: [{ ...field }],
            data: { id: 'A9', name: 'Acme', [field.name]: stored },
          } as unknown as DetailViewSchema
        }
      />,
    ),
  ).container;
  const chip = container.querySelector<HTMLElement>(`[data-summary-chip="${field.name}"]`);
  expect(chip, `a summary chip for "${field.name}" is beside the H1`).not.toBeNull();
  const fill = chip!.querySelector<HTMLElement>('[aria-hidden] span[style]');
  expect(fill, 'the chip draws its own bar fill').not.toBeNull();
  const raw = chip!.textContent ?? '';
  return { raw, text: collapse(raw), bar: pct(fill!.style.width) };
}

/**
 * Place two: the list cell — `PercentCellRenderer`, the surface that reaches
 * `percentDisplayValue` AND the locale's percent affix through `formatPercent`.
 */
function renderCell(stored: number, locale: string, field: FieldMetadata = FIELD): Rendered {
  const container = render(
    session(locale, <PercentCellRenderer value={stored} field={{ ...field }} />),
  ).container;
  const bar = container.querySelector<HTMLElement>('[role="progressbar"] div[style]');
  expect(bar, 'the cell draws its own bar fill').not.toBeNull();
  const value = container.querySelector<HTMLElement>('span.tabular-nums');
  expect(value, 'the cell states its own percentage').not.toBeNull();
  const raw = value!.textContent ?? '';
  return { raw, text: collapse(raw), bar: pct(bar!.style.width) };
}

function pct(width: string): number {
  expect(width, 'the fill width is a percentage').toMatch(/%$/);
  return Number(width.slice(0, -1));
}

/** Render both places for one stored value, one after the other, in one run. */
function bothPlaces(stored: number, locale: string, field: FieldMetadata = FIELD) {
  const chip = renderChip(stored, locale, field);
  cleanup();
  const cell = renderCell(stored, locale, field);
  cleanup();
  return { chip, cell };
}

interface Row {
  what: string;
  locale: string;
  stored: number;
  /**
   * The one percentage BOTH places state, whitespace-collapsed. ⚠️ Written with
   * an ASCII space: several locales separate the number from the sign with a
   * NO-BREAK space, which `collapse` folds. The raw bytes are compared surface
   * to surface in `states the locale's own affix`, which is where that
   * difference is actually pinned.
   */
  text: string;
  /** What the chip printed BEFORE this card — a bare `%` on the full number. */
  was?: string;
  /** The field the row's value is stored on; `FIELD` (a fraction) when absent. */
  field?: FieldMetadata;
}

/**
 * The values whose rendering this card MOVES, with the spelling each had before
 * it. Every `was` is the chip's old output and every `text` is the reading the
 * list cell was already giving, so each row states the move is TOWARD the
 * declared convention rather than merely away from the old one.
 */
const MOVED_ROWS: Row[] = [
  { what: 'width — a stored ratio rounds to the field default of 0', locale: 'en', stored: 0.123, text: '12%', was: '12.3%' },
  { what: 'width — already in points, still rounded', locale: 'en', stored: 12.3, text: '12%', was: '12.3%', field: WHOLE },
  { what: 'width — rounding is half-expand, as the cell has always been', locale: 'en', stored: 1.5, text: '2%', was: '1.5%', field: WHOLE },
  { what: 'width — three decimals collapse to the declared 0', locale: 'en', stored: 1.005, text: '1%', was: '1.005%', field: WHOLE },
  // ⭐ THE FOUR-DIGIT ROW. `1234.5%` is wrong in en-US as well as in German,
  // which is the reasoning objectui#4553 recorded when it made this same move
  // for the list cell.
  { what: 'grouping — four digits, the row a same-locale pair cannot reach', locale: 'en', stored: 1234.5, text: '1,235%', was: '1234.5%', field: WHOLE },
  // ⭐ THE NON-`en` ROWS. The affix and the marks are the locale's own.
  { what: 'affix — de-DE separates the sign with its own space', locale: 'de-DE', stored: 0.25, text: '25 %', was: '25%' },
  { what: 'affix + marks — de-DE swaps the grouping and decimal marks', locale: 'de-DE', stored: 1234.5, text: '1.235 %', was: '1234.5%', field: WHOLE },
  // ⭐ The row no bare-append implementation can produce, at any width.
  { what: 'affix — tr-TR puts the sign in FRONT', locale: 'tr-TR', stored: 0.25, text: '%25', was: '25%' },
];

/**
 * LIVE CONTROLS — values that render correctly today and must not move. They are
 * `en`, integral in percentage points and under four digits, which is exactly
 * why they are controls here and would have been decoration as the only rows.
 */
const UNMOVED_ROWS: Row[] = [
  { what: 'CONTROL — the band the two places already agreed on', locale: 'en', stored: 0.25, text: '25%' },
  { what: 'CONTROL — zero', locale: 'en', stored: 0, text: '0%' },
  { what: 'CONTROL — exactly 1, the fork objectui#9071 settled', locale: 'en', stored: 1, text: '1%', field: WHOLE },
  { what: 'CONTROL — a large value, above the bar track', locale: 'en', stored: 250, text: '250%', field: WHOLE },
  { what: 'CONTROL — a negative below -1, passed through by the shared scaling', locale: 'en', stored: -5, text: '-5%', field: WHOLE },
];

describe('the summary chip takes the percent CONVENTION from the declared source (objectui#9167)', () => {
  it.each(MOVED_ROWS)(
    '$what [$locale]: a stored $stored moves from $was to $text, which is what the cell already said',
    ({ locale, stored, text, was, field }) => {
      const { chip, cell } = bothPlaces(stored, locale, field ?? FIELD);

      expect(
        chip.text,
        'THE PIN: the chip and the list cell state the same percentage for the same stored value',
      ).toBe(cell.text);
      expect(chip.text, 'and it is this percentage').toBe(text);
      expect(
        chip.text,
        `the pre-objectui#9167 spelling is gone — a bare "%" on the full number (${was})`,
      ).not.toBe(was);
    },
  );

  it.each(UNMOVED_ROWS)('$what [$locale]: a stored $stored still reads $text in BOTH places', ({ locale, stored, text, field }) => {
    const { chip, cell } = bothPlaces(stored, locale, field ?? FIELD);

    expect(chip.text, 'the chip and the cell agree, as they did before this card').toBe(cell.text);
    expect(chip.text, 'and nothing about this value moved').toBe(text);
  });

  /**
   * The relation stated once over the whole table rather than row by row, so a
   * repair that fixed one row and broke another is red here even if someone
   * edited that row's expected string to match.
   */
  it('never states one percentage in the chip and another in the cell, for any row above', () => {
    const disagreements = [...MOVED_ROWS, ...UNMOVED_ROWS].filter(({ stored, locale, field }) => {
      const { chip, cell } = bothPlaces(stored, locale, field ?? FIELD);
      return chip.text !== cell.text;
    });
    expect(
      disagreements.map((r) => `${r.locale}:${r.stored}`),
      'every stored value reads the same in both places',
    ).toEqual([]);
  });

  /**
   * The whitespace-collapsed comparison above cannot tell one kind of space from
   * another, and the percent affix of several locales IS a space. This asserts
   * the UNCOLLAPSED bytes, so "the chip renders through the locale's own affix"
   * is pinned rather than approximated.
   *
   * The negative is written as a character-class test rather than as a literal,
   * because a no-break space in a source file is invisible to a reviewer.
   */
  it("states the locale's own affix, byte for byte, not an ASCII sign of its own", () => {
    const { chip, cell } = bothPlaces(0.25, 'de-DE');

    expect(chip.raw, 'the two places put the identical bytes in the DOM').toBe(cell.raw);
    expect(
      /[^\x20-\x7e]/.test(chip.raw),
      `de-DE separates its percent sign with a non-ASCII space (got ${JSON.stringify(chip.raw)})`,
    ).toBe(true);
  });

  /**
   * The field's DECLARED width, the authority this card routes the chip onto.
   * Without it the two places could agree only by both defaulting to 0, which a
   * chip that ignored the field entirely would also satisfy.
   *
   * ⭐ The MEMBER is `scale`, and it moved without this card's ruling moving
   * (objectui#9295). It was `precision` until `@objectstack/spec` was read at
   * source: `precision` is the "Total digits" of a decimal(p, s) column and
   * `scale` is its "Decimal places", so both surfaces were padding a
   * decimal(10, 2) percent field out to ten fraction digits. This card routed
   * the chip onto THE LIST CELL as the authority — its own ACCEPT turns on the
   * two being byte-equal on every row — so the member was always incidental and
   * following the cell is what KEEPS this ruling, not what bends it. The second
   * assertion below is the one that would have caught a chip left behind, and
   * it did: it is how objectui#9295 found this third surface.
   */
  it.each([
    { stored: 0.25, text: '25.00%', base: FIELD },
    { stored: 12.3, text: '12.30%', base: WHOLE },
    { stored: 1234.5, text: '1,234.50%', base: WHOLE },
    { stored: 1.005, text: '1.01%', base: WHOLE },
  ])('reads the field\'s declared width: a stored $stored at scale 2 reads $text', ({ stored, text, base }) => {
    const field = { ...base, scale: 2 } as FieldMetadata;
    const { chip, cell } = bothPlaces(stored, 'en', field);

    expect(chip.text, 'the chip honours the declared width').toBe(text);
    expect(chip.text, 'and so states what the cell states').toBe(cell.text);
  });

  /**
   * objectui#9295's own row, kept HERE because this file is where the coupling
   * lives: `precision` is the TOTAL digit count, so declaring it must not widen
   * either surface. A decimal(10, 2) field declares BOTH, and the chip has to
   * read the decimal-places one.
   */
  it.each([
    { stored: 0.25, text: '25.00%', base: FIELD },
    { stored: 12.3, text: '12.30%', base: WHOLE },
  ])('ignores `precision` beside a declared `scale`: $stored reads $text', ({ stored, text, base }) => {
    const field = { ...base, precision: 10, scale: 2 } as FieldMetadata;
    const { chip, cell } = bothPlaces(stored, 'en', field);

    expect(chip.text, 'the chip pads to `scale`, never to `precision`').toBe(text);
    expect(chip.text, 'and so states what the cell states').toBe(cell.text);
  });

  it('ignores a `precision` declared on its own, as the cell does', () => {
    const field = { ...FIELD, precision: 10 } as FieldMetadata;
    const { chip, cell } = bothPlaces(0.25, 'en', field);

    expect(chip.text, 'a bare `precision` is not a width').toBe('25%');
    expect(chip.text, 'and so states what the cell states').toBe(cell.text);
  });

  /**
   * ⚠️ WHAT THIS CARD DOES NOT TOUCH — the MAGNITUDE.
   *
   * objectui#9071 put both of the chip's halves onto `percentDisplayValue`'s
   * scaling, and the bars are how that is read: unrounded, before either side
   * formats. A repair that rounded the chip's FILL to the field's precision
   * would make it disagree with the cell's bar, which rounds nothing.
   */
  it('draws the same unrounded magnitude it always did, on both moved and unmoved rows', () => {
    for (const [stored, field] of [
      [0.123, FIELD], [12.3, WHOLE], [1.5, WHOLE], [1234.5, WHOLE],
      [0.25, FIELD], [1, WHOLE], [250, WHOLE], [-5, WHOLE],
    ] as const) {
      const { chip, cell } = bothPlaces(stored, 'en', field);
      expect(chip.bar, `the chip draws what the cell draws for ${stored}`).toBe(cell.bar);
    }
  });

  /**
   * The accessible name is built from the very string the chip shows, so the
   * convention reaches a screen reader without a second formatting path. Pinned
   * on a row that MOVED — on an unmoved row it would pass before the card too.
   */
  it('says the new percentage to a screen reader as well as on screen', () => {
    const container = render(
      session(
        'en',
        <DetailView
          schema={
            {
              type: 'record:details',
              objectName: 'account',
              summaryFields: ['ratio'],
              fields: [{ ...WHOLE }],
              data: { id: 'A9', name: 'Acme', ratio: 1234.5 },
            } as unknown as DetailViewSchema
          }
        />,
      ),
    ).container;
    const chip = container.querySelector<HTMLElement>('[data-summary-chip="ratio"]');
    expect(chip, 'a summary chip for "ratio" is beside the H1').not.toBeNull();
    const label = chip!.getAttribute('aria-label') ?? '';
    expect(label, 'the chip has an accessible name').not.toBe('');
    expect(
      label.endsWith(collapse(chip!.textContent ?? '')),
      `the accessible name ends with the percentage on screen (got "${label}")`,
    ).toBe(true);
    expect(label, 'and it is the grouped, rounded one').toContain('1,235%');
  });
});
