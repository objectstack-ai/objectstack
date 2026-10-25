/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#7443 — ONE home for the `datetime` display convention.
 *
 * ── What was measured ────────────────────────────────────────────────────
 * `date` cells routed through the shared `formatDate` and read `field.format`
 * as a display style. `datetime` cells did neither: `DateTimeCellRenderer`
 * destructured `value` only and built its OWN pair of `Intl` option bags, so
 * one field type had two display conventions kept in step by nothing, and the
 * style vocabulary `date` had was unreachable for `datetime`.
 *
 * | path                              | rendered                |
 * | --------------------------------- | ----------------------- |
 * | `DateTimeCellRenderer` (the cell) | `7/4/2024 7:00 am`      |
 * | `formatDateTime` (the module's)   | `Jul 4, 2024, 07:00 AM` |
 *
 * That is the shape of objectui#4576, which this repo has already paid for
 * once (`1.234,5 %` beside `1.234,5%` in a German session).
 *
 * ── The property these pins exist to prove ───────────────────────────────
 * The compact face was NOT redesigned. It was named `'compact'`, moved into
 * `formatDateTime`, and every existing cell still renders it — BYTE-identical,
 * not merely "still a string". Each expectation below is therefore computed
 * from the EXACT option bags the renderer used to inline (`FORMER_*` at the
 * top of the file), so an ICU or Node upgrade moves both sides together and
 * the pin keeps measuring drift from the former face rather than the age of
 * the runner. The `en-US` literal from the card is asserted alongside them, on
 * the same instant, so a silent redesign cannot pass by moving both sides.
 *
 * ── The call shape (maintainer ruling B, objectui#7443) ──────────────────
 * `'compact'` rides INSIDE `options` — `formatDateTime(v, { style: 'compact',
 * locale })` — and the published signature stays `(value, options?)`. A
 * positional `style` parameter would have displaced the `options` objectui#4272
 * put in position two, and a JavaScript caller that did not move its argument
 * would silently lose its locale. The arity pin below is the mechanical guard:
 * `formatDateTime.length` is 2 and turns 3 the moment a positional slot is
 * inserted again.
 *
 * ── Directions ───────────────────────────────────────────────────────────
 * Reverting `formatDateTime` to a single default face turns every `'compact'`
 * case RED. Reverting the renderer to its inlined bags leaves the `'compact'`
 * cases GREEN (they measure the function) and turns the `field.format` cases
 * RED (the renderer would read no field at all). Re-inserting a positional
 * `style` turns the arity pin RED and, because `{ style, locale }` would then
 * land in the style slot, every localized case with it.
 */
import { describe, it, expect, afterEach } from 'vitest';
import React from 'react';
import { render, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom';
import { I18nProvider, LocalizationProvider } from '@object-ui/i18n';
import {
  DateCellRenderer,
  DateTimeCellRenderer,
  formatDateTime,
  formatDateTimeCompactParts,
} from '../index';

/** The card's instant, in the card's locale, with the card's expected face. */
const INSTANT = '2024-07-04T07:00:00.000Z';

/**
 * The two option bags `DateTimeCellRenderer` inlined before this change,
 * copied verbatim from `origin/main`. Every "byte-identical" claim below is
 * measured against THESE, not against a literal typed by hand.
 */
const FORMER_DATE_BAG: Intl.DateTimeFormatOptions = {
  month: 'numeric',
  day: 'numeric',
  year: 'numeric',
};
const FORMER_TIME_BAG: Intl.DateTimeFormatOptions = {
  hour: 'numeric',
  minute: '2-digit',
  hour12: true,
};

/** Exactly what the cell used to compute, for a locale. */
function formerCellFace(iso: string, locale: string): { date: string; time: string } {
  const d = new Date(iso);
  return {
    date: d.toLocaleDateString(locale, FORMER_DATE_BAG),
    time: d.toLocaleTimeString(locale, FORMER_TIME_BAG).toLowerCase(),
  };
}

/** `en-US` plus one NON-US locale, as the ruling requires. */
const LOCALES = ['en-US', 'zh', 'de-DE'];

/**
 * `useDisplayLocale()` resolves tenant locale -> active UI language -> `'en'`,
 * so the tag is set as the TENANT locale: it is the channel objectui#4468
 * made every date branch read, and it pins the exact tag rather than whatever
 * a language code happens to widen to. `persistLanguage={false}` keeps each
 * case on its own language instead of inheriting the previous one's.
 */
function renderSession(locale: string, node: React.ReactElement) {
  return render(
    <I18nProvider
      config={{ defaultLanguage: 'en', detectBrowserLanguage: false }}
      persistLanguage={false}
    >
      <LocalizationProvider value={{ locale }}>{node}</LocalizationProvider>
    </I18nProvider>,
  );
}

afterEach(() => cleanup());

describe("formatDateTime's 'compact' style is the former cell face, byte-identical", () => {
  it.each(LOCALES)('%s — the joined face', (locale) => {
    const former = formerCellFace(INSTANT, locale);
    expect(formatDateTime(INSTANT, { style: 'compact', locale })).toBe(
      `${former.date} ${former.time}`,
    );
  });

  it.each(LOCALES)('%s — the halves the cell paints separately', (locale) => {
    const former = formerCellFace(INSTANT, locale);
    expect(formatDateTimeCompactParts(INSTANT, { locale })).toEqual(former);
  });

  it('the en-US face is the one the card recorded', () => {
    expect(formatDateTime(INSTANT, { style: 'compact', locale: 'en-US' })).toBe('7/4/2024 7:00 am');
  });

  it('the joined face is exactly the two halves and one space', () => {
    const parts = formatDateTimeCompactParts(INSTANT, { locale: 'en-US' })!;
    expect(`${parts.date} ${parts.time}`).toBe(
      formatDateTime(INSTANT, { style: 'compact', locale: 'en-US' }),
    );
  });

  it('empty and invalid values answer the module dash, not a broken face', () => {
    expect(formatDateTime('', { style: 'compact', locale: 'en-US' })).toBe('—');
    expect(formatDateTime('not-a-date', { style: 'compact', locale: 'en-US' })).toBe('—');
    expect(formatDateTimeCompactParts('', { locale: 'en-US' })).toBeNull();
    expect(formatDateTimeCompactParts('not-a-date', { locale: 'en-US' })).toBeNull();
  });
});

describe('the DEFAULT style is untouched — the non-cell convention still renders', () => {
  it.each(LOCALES)('%s — unchanged verbose face', (locale) => {
    const verbose = new Date(INSTANT).toLocaleDateString(locale, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
    expect(formatDateTime(INSTANT, { locale })).toBe(verbose);
  });

  it('en-US default is the second row of the card table, not the compact face', () => {
    expect(formatDateTime(INSTANT, { locale: 'en-US' })).toBe('Jul 4, 2024, 07:00 AM');
    expect(formatDateTime(INSTANT, { locale: 'en-US' })).not.toBe(
      formatDateTime(INSTANT, { style: 'compact', locale: 'en-US' }),
    );
  });

  it('an unrecognised style falls to the default face, as it does on formatDate', () => {
    expect(formatDateTime(INSTANT, { style: 'no-such-style', locale: 'en-US' })).toBe(
      formatDateTime(INSTANT, { locale: 'en-US' }),
    );
  });
});

describe("the signature stays (value, options?) — 'compact' rides in options (ruling B)", () => {
  it('formatDateTime declares exactly two parameters: no positional style slot', () => {
    // `Function.length` counts declared parameters. `(value, options?)` is 2;
    // the refused `(value, style?, options?)` shape is 3.
    expect(formatDateTime.length).toBe(2);
  });

  it('the objectui#4272 call shape — options in position two — still localizes', () => {
    const zh = formatDateTime(INSTANT, { locale: 'zh' });
    const en = formatDateTime(INSTANT, { locale: 'en-US' });
    expect(zh).toBe(
      new Date(INSTANT).toLocaleDateString('zh', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      }),
    );
    expect(zh).not.toBe(en);
  });

  it('style is read from options, so the compact face is reachable with the locale beside it', () => {
    const former = formerCellFace(INSTANT, 'de-DE');
    expect(formatDateTime(INSTANT, { style: 'compact', locale: 'de-DE' })).toBe(
      `${former.date} ${former.time}`,
    );
  });
});

describe('every existing datetime cell renders unchanged', () => {
  it.each(LOCALES)('%s — a field with no format still paints the compact halves', (locale) => {
    const former = formerCellFace(INSTANT, locale);
    const { container } = renderSession(
      locale,
      <DateTimeCellRenderer value={INSTANT} field={{ type: 'datetime', name: 'created_at' } as any} />,
    );
    const spans = container.querySelectorAll('span > span');
    expect(spans).toHaveLength(2);
    expect(spans[0].textContent).toBe(former.date);
    expect(spans[1].textContent).toBe(former.time);
    // The time half stays muted and offset — the two-tone face is the visual
    // half of "renders unchanged", and collapsing it to one string would be a
    // visible change even with identical text. Since objectui#11683 the offset
    // is a text space plus `ml-1` (it was `ml-2` alone, so the text ran the
    // halves together), and the cell's text is the joined compact face.
    expect(spans[1].className).toMatch(/text-muted-foreground/);
    expect(spans[1].className).toMatch(/\bml-1\b/);
    expect(container.textContent).toBe(`${former.date} ${former.time}`);
  });

  it('an authored empty format is still the compact face, not the verbose one', () => {
    const former = formerCellFace(INSTANT, 'en-US');
    const { container } = renderSession(
      'en-US',
      <DateTimeCellRenderer
        value={INSTANT}
        field={{ type: 'datetime', name: 'created_at', format: '' } as any}
      />,
    );
    expect(container.textContent).toBe(`${former.date} ${former.time}`);
  });
});

describe('field.format now works for datetime, the way it already did for date', () => {
  it('an explicit compact format renders the same face as no format at all', () => {
    const { container: implicit } = renderSession(
      'en-US',
      <DateTimeCellRenderer value={INSTANT} field={{ type: 'datetime', name: 'created_at' } as any} />,
    );
    const implicitText = implicit.textContent;
    cleanup();
    const { container: explicit } = renderSession(
      'en-US',
      <DateTimeCellRenderer
        value={INSTANT}
        field={{ type: 'datetime', name: 'created_at', format: 'compact' } as any}
      />,
    );
    expect(explicit.textContent).toBe(implicitText);
  });

  it('an authored non-compact format reaches formatDateTime — the vocabulary is live', () => {
    const { container } = renderSession(
      'en-US',
      <DateTimeCellRenderer
        value={INSTANT}
        field={{ type: 'datetime', name: 'created_at', format: 'default' } as any}
      />,
    );
    expect(container.textContent).toBe('Jul 4, 2024, 07:00 AM');
    // Before this change the renderer never saw `field` at all, so this string
    // was unreachable from metadata however it was authored.
    expect(container.textContent).not.toBe('7/4/2024 7:00 am');
  });

  it('an absent field is tolerated — the compact face is the default', () => {
    const { container } = renderSession(
      'en-US',
      <DateTimeCellRenderer value={INSTANT} field={undefined as any} />,
    );
    expect(container.textContent).toBe('7/4/2024 7:00 am');
  });
});

describe('the date cell path is untouched', () => {
  it('a date field still renders through formatDate, not the datetime convention', () => {
    const { container } = renderSession(
      'en-US',
      <DateCellRenderer
        value={INSTANT}
        field={{ type: 'date', name: 'start_date', format: 'short' } as any}
      />,
    );
    expect(container.textContent).toBe("Jul 4, '24");
  });

  it("a date field's default style is still relative, not compact", () => {
    const { container } = renderSession(
      'en-US',
      <DateCellRenderer value={INSTANT} field={{ type: 'date', name: 'start_date' } as any} />,
    );
    expect(container.textContent).not.toContain('7:00 am');
  });
});
