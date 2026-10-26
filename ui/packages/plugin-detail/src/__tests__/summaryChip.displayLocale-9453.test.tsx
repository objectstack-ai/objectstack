/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The summary chip's CURRENCY and DATE branches read the declared session
 * locale, not the machine's (objectui#9453).
 *
 * ## The contract, and the one sentence it is being held to
 *
 * `useDisplayLocale` states the rule in its own doc comment: the one thing a
 * caller must not do is reach past the hook and hand `Intl` the `undefined` it
 * gets on an unconfigured workspace, because `undefined` means "the MACHINE's
 * locale, which is neither channel". The chip's percent branch was already on
 * the hook (objectui#9167, and `formatPercent(num, scale, displayLocale)` in
 * the same switch is the working model); its currency, number-fallback,
 * date and datetime branches each passed the literal `undefined`.
 *
 * ## Why every assertion names its locale, and why the table is not the pin
 *
 * An expectation computed from the machine's own locale measures the machine
 * and not the code: on a `de-DE` runner a broken chip and a fixed one print the
 * same bytes. Both legs here therefore DECLARE the session locale — the mount
 * through `LocalizationProvider`, the expectation as a literal string.
 *
 * The literals alone are still a machine-dependent pin: they are red before
 * this card only because this runner happens to resolve to `en-US`. So the
 * assertion that actually carries the card is `a reading of the session
 * locale, not of the machine` below — for each family it renders the SAME
 * stored value under two locales and requires the two readings to differ.
 * Before this card both readings came from the machine, whatever it was, so
 * they were byte-identical and that assertion is red on EVERY runner,
 * including a German one.
 *
 * ## ⛔ What this card does NOT decide — the `en` rows are the control
 *
 * The card carries an open question and leaves it open: whether a KPI chip
 * beside an H1 should keep its deliberately compact face (`maximumFractionDigits: 0`,
 * `dateStyle: 'medium'`) or read exactly like its list cell. Only the locale
 * moves here; every other option in those four bags stays byte-identical.
 *
 * `EN_CONTROL_ROWS` is how that is enforced rather than promised: those rows
 * pass on the pre-card tree AND after it, so a repair that also rounded
 * differently, or swapped the date style, is red here even though it would
 * satisfy every `de-DE` row. They are NOT findings — the chip differing from
 * its list cell in `en` is this chip's declared choice, and this card is not
 * about it.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import * as React from 'react';
import { I18nProvider, LocalizationProvider } from '@object-ui/i18n';
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
 * The session locale is DECLARED, never inherited from the runner. This is the
 * same mount the percent half of this switch is pinned through
 * (objectui#9167), so the two halves are measured the same way.
 */
function session(locale: string, node: React.ReactNode): React.ReactElement {
  return (
    <I18nProvider config={{ defaultLanguage: 'en', detectBrowserLanguage: false }} persistLanguage={false}>
      <LocalizationProvider value={{ locale }}>{node}</LocalizationProvider>
    </I18nProvider>
  );
}

/**
 * Runs of whitespace collapse to one ASCII space so the expectations below stay
 * readable: several locales separate a currency amount from its sign with a
 * NO-BREAK space, and a no-break space in a source file is invisible to a
 * reviewer. The uncollapsed bytes are asserted separately, in
 * `states the locale's own separator, byte for byte`.
 */
const collapse = (s: string) => s.replace(/\s+/g, ' ').trim();

interface Rendered {
  /** Exactly what the chip put in the DOM, byte for byte. */
  raw: string;
  /** The same text with runs of whitespace collapsed. */
  text: string;
  /** The chip's accessible name, which is built from the same string. */
  label: string;
}

/** The `summaryFields` chip beside the record H1, under a declared locale. */
function renderChip(field: FieldMetadata, stored: unknown, locale: string): Rendered {
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
  const raw = chip!.textContent ?? '';
  return { raw, text: collapse(raw), label: chip!.getAttribute('aria-label') ?? '' };
}

/** Render one field under one locale and drop the tree again. */
function chipUnder(field: FieldMetadata, stored: unknown, locale: string): Rendered {
  const out = renderChip(field, stored, locale);
  cleanup();
  return out;
}

/**
 * The four families this card names, one per `Intl` call site in the chip's
 * format switch. The stored values are the card's own: a currency amount whose
 * grouping mark moves between the two locales, and a date whose whole shape
 * does.
 */
const CURRENCY: FieldMetadata = {
  name: 'amount',
  label: 'Amount',
  type: 'currency',
  // The spec's fixed currency; a field-level `currency` is retired (objectui#12242).
  currencyConfig: { currencyMode: 'fixed', defaultCurrency: 'EUR' },
} as FieldMetadata;
/** No `currency` anywhere and no tenant default ⇒ the chip's number fallback. */
const PLAIN_NUMBER: FieldMetadata = { name: 'score', label: 'Score', type: 'currency' } as FieldMetadata;
const DATE: FieldMetadata = { name: 'closed_on', label: 'Closed on', type: 'date' } as FieldMetadata;
const DATETIME: FieldMetadata = { name: 'closed_at', label: 'Closed at', type: 'datetime' } as FieldMetadata;

interface Row {
  what: string;
  field: FieldMetadata;
  stored: unknown;
  locale: string;
  text: string;
}

/**
 * THE DEFECT ROWS. Every one is red before this card, where the chip answered
 * with the runner's machine locale for all of them.
 *
 * ⚠️ The currency rows are written with an ASCII space; de-DE separates the
 * amount from its sign with a no-break space, which `collapse` folds.
 */
const DE_ROWS: Row[] = [
  { what: 'currency — the grouping and decimal marks are the session locale\'s', field: CURRENCY, stored: 1234.5, locale: 'de-DE', text: '1.235 €' },
  { what: 'number fallback — an unresolved currency is still a localized number', field: PLAIN_NUMBER, stored: 1234.5, locale: 'de-DE', text: '1.235' },
  { what: 'date — a medium date has a different SHAPE, not just marks', field: DATE, stored: '2026-03-04', locale: 'de-DE', text: '04.03.2026' },
  { what: 'datetime — date and time both follow the session locale', field: DATETIME, stored: '2026-03-04T15:30:00Z', locale: 'de-DE', text: '04.03.2026, 15:30' },
];

/**
 * ⭐ THE CONTROL. These pass BEFORE this card and after it. They are the
 * assertion that catches a repair which drifted into the card's open question:
 * change `maximumFractionDigits: 0` or `dateStyle: 'medium'` and they go red
 * while every `de-DE` row above stays green.
 */
const EN_CONTROL_ROWS: Row[] = [
  { what: 'CONTROL — the chip keeps its own rounded currency face', field: CURRENCY, stored: 1234.5, locale: 'en', text: '€1,235' },
  { what: 'CONTROL — and its own rounded plain number', field: PLAIN_NUMBER, stored: 1234.5, locale: 'en', text: '1,235' },
  { what: 'CONTROL — and its own medium date style', field: DATE, stored: '2026-03-04', locale: 'en', text: 'Mar 4, 2026' },
  { what: 'CONTROL — and its own medium date with a short time', field: DATETIME, stored: '2026-03-04T15:30:00Z', locale: 'en', text: 'Mar 4, 2026, 3:30 PM' },
];

describe('the summary chip formats currency and dates in the DECLARED locale (objectui#9453)', () => {
  it.each(DE_ROWS)('$what: a stored $stored reads $text under de-DE', ({ field, stored, locale, text }) => {
    expect(chipUnder(field, stored, locale).text).toBe(text);
  });

  it.each(EN_CONTROL_ROWS)('$what: a stored $stored still reads $text under en', ({ field, stored, locale, text }) => {
    expect(chipUnder(field, stored, locale).text).toBe(text);
  });

  /**
   * ⭐ THE PIN, stated so that it cannot be satisfied by the runner's own
   * locale. Before this card both readings came from the machine and were
   * byte-identical for every family; a machine that resolves to `de-DE` makes
   * the literal tables above green on the broken chip, and makes no difference
   * at all to this one.
   */
  it('is a reading of the session locale, not of the machine', () => {
    const frozen = [CURRENCY, PLAIN_NUMBER, DATE, DATETIME]
      .map((field) => {
        const stored =
          field === DATE ? '2026-03-04' : field === DATETIME ? '2026-03-04T15:30:00Z' : 1234.5;
        return {
          field: field.name,
          en: chipUnder(field, stored, 'en').text,
          de: chipUnder(field, stored, 'de-DE').text,
        };
      })
      .filter((r) => r.en === r.de);

    expect(
      frozen,
      'the same stored value states a different string under en and under de-DE',
    ).toEqual([]);
  });

  /**
   * The card's own negative, kept as a literal because it is the string a
   * German tenant actually read beside the H1 while its list cell said
   * `4. März` for the same stored date.
   */
  it('never states the en spelling of a date to a de-DE session', () => {
    expect(chipUnder(DATE, '2026-03-04', 'de-DE').text).not.toBe('Mar 4, 2026');
  });

  /**
   * The collapsed comparison above cannot tell one kind of space from another,
   * and de-DE's currency separator IS a space. Asserted as a character class
   * rather than as a literal, because a no-break space in a source file is
   * invisible to a reviewer.
   *
   * ⚠️ The class is "whitespace that is not an ASCII space", NOT "any non-ASCII
   * byte": the en spelling carries a non-ASCII currency SIGN, so the wider
   * class is green on the pre-card chip and pins nothing.
   */
  it("states the locale's own separator, byte for byte", () => {
    const de = chipUnder(CURRENCY, 1234.5, 'de-DE');
    expect(
      /[^\S ]/.test(de.raw),
      `de-DE separates the amount from its sign with a no-break space (got ${JSON.stringify(de.raw)})`,
    ).toBe(true);
  });

  /**
   * The accessible name is composed from the very string the chip shows, so the
   * locale reaches a screen reader without a second formatting path. Pinned on
   * a row that MOVES — on a control row it would pass before this card too.
   */
  it('says the localized date to a screen reader as well as on screen', () => {
    const de = chipUnder(DATE, '2026-03-04', 'de-DE');
    expect(de.label, 'the chip has an accessible name').not.toBe('');
    expect(de.label.endsWith(de.text), `the accessible name ends with what is on screen (got "${de.label}")`).toBe(true);
    expect(de.label, 'and it is the de-DE spelling').toContain('04.03.2026');
  });
});
