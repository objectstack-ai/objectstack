/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#8209 — the two readonly `datetime` WIDGET faces converge onto
 * `formatDateTime`, each on the face of its REGISTER, following the
 * maintainer's ruling (batch #142 item 2, 「同意」).
 *
 * ── What the ruling decided ──────────────────────────────────────────────
 * | site                                  | register    | face              |
 * | ------------------------------------- | ----------- | ----------------- |
 * | `DateTimeField` readonly branch       | form/detail | verbose DEFAULT   |
 * | `GridField`'s `temporalText` datetime | grid cell   | `'compact'`       |
 *
 * Both stop composing a bare `toLocaleDateString` + `toLocaleTimeString` pair,
 * so objectui#7443's "`datetime` has one home" is now true for all six bare
 * sites objectui#8194 enumerated. ⛔ The year is NOT dropped: that is
 * `formatDate`'s date-only cell rule (objectui#7620) and the ruling declines
 * to extend it to `datetime`. The `hour12: true` the compact face declares is
 * that face's design (`formatDateTimeCompactParts` says so), inherited here
 * rather than re-decided — which is precisely why the READONLY FORM field does
 * not take that face.
 *
 * ── The other half of the flip ───────────────────────────────────────────
 * This file pins WHICH face each site landed on. That both sites LEFT the bare
 * pair — measured against a verbatim copy of the removed spelling, not against
 * a literal — is pinned by the `FENCE LIFTED` block in
 * `fields-date-widget-convention-8194.test.tsx`, which is the `SCOPE FENCE`
 * that card wrote, flipped. Neither half witnesses the change alone: a test
 * that only described the new faces would pass identically in a tree where the
 * second convention had never existed.
 *
 * ── Directions ───────────────────────────────────────────────────────────
 * Reverting either site to its bare pair turns its own cases here RED (the
 * face no longer equals the shared function's) and its case in the `FENCE
 * LIFTED` block RED too. Swapping the two faces over — giving the widget
 * `'compact'` or the cell the default — turns `REGISTERS` red while leaving
 * "both call the one home" green, which is the failure this file exists to
 * separate from the other one.
 *
 * ── The fixture is built from the RUNNER's zone on purpose ───────────────
 * A stored instant is formatted in local time, so an ISO literal like
 * `07:00Z` renders a different wall clock (and, far enough west, a different
 * DAY) per runner. The instant here is constructed as July 4, 07:00 LOCAL and
 * handed over as its ISO string, so the `en` literals below are exact in every
 * zone. July 4 keeps both faces clear of month- and year-boundary effects.
 */

import React from 'react';
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom';
import { formatDateTime } from '@object-ui/core';
import { I18nProvider, LocalizationProvider } from '@object-ui/i18n';
import { DateTimeField } from '../widgets/DateTimeField';
import { GridField } from '../widgets/GridField';

/** The five locales this change was measured in (objectui#8194's set). */
const LOCALES = ['en', 'de', 'zh', 'ja', 'ar'] as const;

const CURRENT_YEAR = new Date().getFullYear();
/** July 4, 07:00 in the RUNNER's zone — see the header note on why not `07:00Z`. */
const INSTANT = new Date(CURRENT_YEAR, 6, 4, 7, 0, 0).toISOString();
/** The same wall clock in a past year, for the year-token comparison. */
const PAST_INSTANT = new Date(2024, 6, 4, 7, 0, 0).toISOString();

/** The two ruled faces, asked of the one home rather than typed out. */
const verboseFace = (iso: string, locale: string) => formatDateTime(iso, { locale });
const compactFace = (iso: string, locale: string) => formatDateTime(iso, { style: 'compact', locale });

function session(language: string, node: React.ReactNode) {
  return render(
    <I18nProvider config={{ defaultLanguage: language, detectBrowserLanguage: false }} persistLanguage={false}>
      <LocalizationProvider value={{ locale: undefined }}>{node}</LocalizationProvider>
    </I18nProvider>,
  );
}

/** Site 1 — the readonly `datetime` widget (form / detail register). */
const renderWidget = (locale: string, value: unknown) =>
  session(
    locale,
    <DateTimeField value={value as string} onChange={() => {}} field={{ type: 'datetime', name: 'at' } as any} readonly />,
  ).container.textContent ?? '';

/** Site 2 — the sub-grid readonly `datetime` column (grid-cell register). */
function renderCell(locale: string, value: unknown): string {
  session(
    locale,
    <GridField
      value={[{ at: value }]}
      onChange={() => {}}
      readonly
      field={{ columns: [{ name: 'at', label: 'At', type: 'datetime' as const }] } as any}
    />,
  );
  const cells = screen.getByTestId('line-items-readonly').querySelectorAll('tbody tr td');
  // The readonly sub-grid paints a line-number `td` before the column cells, so
  // the value is the LAST one; the shape is asserted rather than assumed
  // (objectui#8194's harness note).
  expect(cells).toHaveLength(2);
  return cells[cells.length - 1].textContent ?? '';
}

afterEach(() => cleanup());

describe('FIXTURE VALIDITY — the premise the register split rests on', () => {
  /**
   * If the two faces ever agreed, every case in `REGISTERS` would pass for
   * free and the ruling's whole "per register" letter would be unobservable.
   */
  it.each(LOCALES)('%s — the two ruled faces are different strings', (locale) => {
    expect(verboseFace(INSTANT, locale)).not.toBe(compactFace(INSTANT, locale));
  });

  it('the fixture really is the current year, and the past-year one is not', () => {
    expect(new Date(INSTANT).getFullYear()).toBe(CURRENT_YEAR);
    expect(new Date(PAST_INSTANT).getFullYear()).not.toBe(CURRENT_YEAR);
  });
});

describe('REGISTERS — each site renders the face its register was ruled', () => {
  it.each(LOCALES)('%s — readonly DateTimeField renders the verbose DEFAULT face', (locale) => {
    expect(renderWidget(locale, INSTANT)).toBe(verboseFace(INSTANT, locale));
  });

  it.each(LOCALES)('%s — and it is not the compact face the cell takes', (locale) => {
    expect(renderWidget(locale, INSTANT)).not.toBe(compactFace(INSTANT, locale));
  });

  it.each(LOCALES)('%s — the sub-grid datetime cell renders the COMPACT face', (locale) => {
    expect(renderCell(locale, INSTANT)).toBe(compactFace(INSTANT, locale));
  });

  it.each(LOCALES)('%s — and it is not the verbose face the widget takes', (locale) => {
    expect(renderCell(locale, INSTANT)).not.toBe(verboseFace(INSTANT, locale));
  });
});

describe('the exact faces the ruling named, in en', () => {
  /**
   * The literals are what stops a silent redesign of either face in
   * `date-display.ts` from sliding through while the shared-function
   * comparisons above still agree with it.
   */
  it('the readonly widget renders the verbose face the ruling quoted', () => {
    expect(renderWidget('en', INSTANT)).toBe(`Jul 4, ${CURRENT_YEAR}, 07:00 AM`);
  });

  it('the sub-grid cell renders the compact face the sibling datetime cell renders', () => {
    expect(renderCell('en', INSTANT)).toBe(`7/4/${CURRENT_YEAR} 7:00 am`);
  });

  it('neither face keeps the seconds the removed bare pair showed', () => {
    expect(renderWidget('en', INSTANT)).not.toMatch(/:\d\d:\d\d/);
    cleanup();
    expect(renderCell('en', INSTANT)).not.toMatch(/:\d\d:\d\d/);
  });
});

describe('the year is NOT dropped (objectui#7620 rules formatDate, not this card)', () => {
  it.each(LOCALES)('%s — the current-year widget face still carries a four-digit year', (locale) => {
    expect(renderWidget(locale, INSTANT)).toMatch(new RegExp(String(CURRENT_YEAR)));
  });

  it.each(LOCALES)('%s — and so does the current-year cell face', (locale) => {
    expect(renderCell(locale, INSTANT)).toMatch(new RegExp(String(CURRENT_YEAR)));
  });

  it('a past-year value carries its own year at both sites, unchanged', () => {
    expect(renderWidget('en', PAST_INSTANT)).toBe('Jul 4, 2024, 07:00 AM');
    cleanup();
    expect(renderCell('en', PAST_INSTANT)).toBe('7/4/2024 7:00 am');
  });
});

describe('what an unreadable or absent value does at each site', () => {
  /**
   * The widget inherits `formatDateTime`'s empty face, exactly as the four
   * `date` widgets objectui#8194 converged inherit `formatDate`'s: it used to
   * render the literal `Invalid Date Invalid Date`, one for each half of the
   * removed pair.
   */
  it('the readonly widget shows the shared empty face rather than "Invalid Date"', () => {
    const { container } = session(
      'en',
      <DateTimeField value={'not-a-date'} onChange={() => {}} field={{ type: 'datetime', name: 'at' } as any} readonly />,
    );
    expect(container.textContent).toBe('—');
    expect(container.textContent).not.toContain('Invalid Date');
    /**
     * ⚠️ Recorded, not repaired. This dash is `formatDateTime`'s own
     * hand-rolled one, so it carries no `empty-value` slot and no accessible
     * name — unlike the absent-value branch below. That gap is the
     * objectui#8490 / objectui#8581 class (the same one the `date` widgets
     * objectui#8194 converged inherited), it predates this card at every such
     * site, and widening it here would be a second convention decision nobody
     * has ruled. Asserted so the difference is visible rather than assumed
     * away.
     */
    expect(container.querySelector('[data-slot="empty-value"]')).toBeNull();
  });

  /**
   * The sub-grid is the exception ON PURPOSE, the same way it is for `date`:
   * its `Number.isNaN` guard runs BEFORE the formatter and still answers the
   * raw stored string, because "showing the user what is actually stored beats
   * hiding it" (objectui#3569). Converging the formatter must not quietly
   * delete that.
   */
  it('the sub-grid cell still shows the raw stored value it cannot parse (objectui#3569)', () => {
    expect(renderCell('en', 'not-a-date')).toBe('not-a-date');
  });

  it('an absent value keeps the shared empty AFFORDANCE at the widget', () => {
    const { container } = session(
      'en',
      <DateTimeField value={''} onChange={() => {}} field={{ type: 'datetime', name: 'at' } as any} readonly />,
    );
    const slot = container.querySelector('[data-slot="empty-value"]');
    expect(slot).not.toBeNull();
    expect(slot).toHaveAttribute('aria-label', 'No value');
    expect(container.textContent).toBe('—');
  });
});
