/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#7620 — the DATE-only half of `formatCellValue` converges too.
 *
 * ── What was measured ────────────────────────────────────────────────────
 * objectui#7443 routed the datetime half of `data-table`'s `formatCellValue`
 * through `formatDateTime` and left the date-only branch building its own
 * `Intl.DateTimeFormat` bag, because routing it through `formatDate` WOULD
 * move a pixel and #7443's ruling forbade that. This is that deferred
 * question, ruled A by the maintainer: one home, the table included.
 *
 * The two faces, `en-US`, for the SAME ISO date-only value:
 *
 * | path                                          | current year | past year     |
 * | --------------------------------------------- | ------------ | ------------- |
 * | `date` field cell (-> `formatDate` default)   | `Jul 4`      | `Jul 4, 2024` |
 * | `data-table` date-only cell, BEFORE (own bag) | `Jul 4, 2026`| `Jul 4, 2024` |
 * | `data-table` date-only cell, AFTER (this PR)  | `Jul 4`      | `Jul 4, 2024` |
 *
 * ⭐ The fork was CURRENT-YEAR ONLY — `formatDate`'s default face drops the
 * year inside the current year on purpose (Salesforce / HubSpot / Linear all
 * do; the year crowds in-progress records), and the table's own bag always
 * asked for `year: 'numeric'`. Past years already agreed, which is why the
 * split went unnoticed, and why a fixture with a hard-coded past year cannot
 * measure this change at all.
 *
 * ── The property these pins exist to prove ───────────────────────────────
 * Two claims, and neither can be made with one fixture:
 *
 *   1. the current-year cell MOVED, onto exactly what `formatDate` renders —
 *      asserted against the shared function AND against `FORMER_DATE_BAG`,
 *      the bag copied verbatim from `origin/main`, which it must now differ
 *      from;
 *   2. the past-year cell did NOT move — asserted equal to that same former
 *      bag, byte for byte.
 *
 * `FIXTURE VALIDITY` below asserts the premise both rest on (the two
 * formatters disagree on the current-year value and agree on the past-year
 * one), so a fixture that silently stopped exercising the fork — the way a
 * hard-coded `2024-07-04` would — fails loudly instead of passing for free.
 *
 * ── Directions ───────────────────────────────────────────────────────────
 * Reverting `formatCellValue`'s date-only branch to its own bag turns every
 * CURRENT-YEAR case RED (the cell would carry a year the shared function
 * drops) and leaves every PAST-YEAR case GREEN — that asymmetry IS the
 * defect, so both halves are pinned. Changing `formatDate`'s default face
 * moves the shared-function expectations and the `en` literal together, and
 * the literal is what stops a silent redesign from passing.
 */
import { describe, it, expect, afterEach } from 'vitest';
import React from 'react';
import { render, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom';
import { ComponentRegistry, formatDate } from '@object-ui/core';
import { I18nProvider, useObjectTranslation } from '@object-ui/i18n';
// Registers the renderers at module scope, NOT inside a `beforeAll` — there the
// cold transform is billed to `hookTimeout` (objectui#3010/#3021).
import '../renderers';

/**
 * A current-year date, read from the clock the same way `formatDate` reads it.
 * July 4 is deliberate: `Date.parse` reads a date-only ISO string as UTC
 * midnight and {@link former} formats it in the runner's zone, so a January 1
 * or December 31 fixture would fall into the neighbouring year under a
 * negative or positive offset and stop being a current-year date at all. (The
 * cell itself no longer pre-parses — objectui#10183.)
 */
const CURRENT_YEAR_DATE = `${new Date().getFullYear()}-07-04`;
/** The card's past-year value — the row that must not move. */
const PAST_YEAR_DATE = '2024-07-04';

/**
 * The bag `formatCellValue`'s date-only branch inlined before this change,
 * copied verbatim from `origin/main`. Every claim below is measured against
 * THIS, not against a literal typed by hand.
 */
const FORMER_DATE_BAG: Intl.DateTimeFormatOptions = {
  year: 'numeric',
  month: 'short',
  day: 'numeric',
};

const former = (iso: string, locale: string) =>
  new Intl.DateTimeFormat(locale, FORMER_DATE_BAG).format(new Date(Date.parse(iso)));

/** What the cell now calls: the STRING, into the shared parse step (objectui#10183). */
const shared = (iso: string, locale: string) =>
  formatDate(iso, undefined, { locale });

/**
 * Reports the tag the table itself resolves. `formatCellValue` localizes from
 * `useTableTranslation().language`, so expectations are built from THE SAME
 * tag the component read rather than from the one this file asked for —
 * hard-coding a tag the harness may not resolve would measure the harness.
 */
function LanguageProbe({ report }: { report: (language: string) => void }) {
  report(useObjectTranslation().language);
  return null;
}

function renderTable(language: string, value: string) {
  const Component = ComponentRegistry.get('data-table')!;
  const schema = {
    type: 'data-table',
    columns: [{ header: 'When', accessorKey: 'when' }],
    data: [{ id: 'r1', when: value }],
  } as any;
  let resolved = '';
  const result = render(
    <I18nProvider config={{ defaultLanguage: language, detectBrowserLanguage: false }} persistLanguage={false}>
      <LanguageProbe report={(l) => { resolved = l; }} />
      <Component schema={schema} />
    </I18nProvider>,
  );
  return { ...result, language: () => resolved };
}

const cellText = (container: HTMLElement) =>
  container.querySelector('tbody tr td')?.textContent ?? '';

afterEach(() => cleanup());

describe('FIXTURE VALIDITY — the premise the two halves rest on', () => {
  it.each(['en', 'de', 'zh'])('%s — the former bag and formatDate disagree on a CURRENT-year date', (locale) => {
    expect(shared(CURRENT_YEAR_DATE, locale)).not.toBe(former(CURRENT_YEAR_DATE, locale));
  });

  it.each(['en', 'de', 'zh'])('%s — and agree on a PAST-year date', (locale) => {
    expect(shared(PAST_YEAR_DATE, locale)).toBe(former(PAST_YEAR_DATE, locale));
  });

  it('the fixture really is the current year', () => {
    expect(new Date(Date.parse(CURRENT_YEAR_DATE)).getFullYear()).toBe(new Date().getFullYear());
    expect(new Date(Date.parse(PAST_YEAR_DATE)).getFullYear()).not.toBe(new Date().getFullYear());
  });
});

describe('the current-year date-only cell converges onto formatDate', () => {
  it.each(['en', 'de', 'zh'])('%s — the rendered cell equals the shared function', (language) => {
    const { container, language: resolved } = renderTable(language, CURRENT_YEAR_DATE);
    expect(cellText(container)).toBe(shared(CURRENT_YEAR_DATE, resolved()));
  });

  it.each(['en', 'de', 'zh'])('%s — and no longer equals the former bag', (language) => {
    const { container, language: resolved } = renderTable(language, CURRENT_YEAR_DATE);
    expect(cellText(container)).not.toBe(former(CURRENT_YEAR_DATE, resolved()));
  });

  it('en renders the exact face the ruling named, with no year token', () => {
    const { container } = renderTable('en', CURRENT_YEAR_DATE);
    expect(cellText(container)).toBe('Jul 4');
    expect(cellText(container)).not.toMatch(/\d{4}/);
  });
});

describe('the past-year date-only cell does NOT move', () => {
  it.each(['en', 'de', 'zh'])('%s — still byte-identical to the former bag', (language) => {
    const { container, language: resolved } = renderTable(language, PAST_YEAR_DATE);
    expect(cellText(container)).toBe(former(PAST_YEAR_DATE, resolved()));
  });

  it('en still carries the year the card recorded for this row', () => {
    const { container } = renderTable('en', PAST_YEAR_DATE);
    expect(cellText(container)).toBe('Jul 4, 2024');
  });

  it('neither row grows a time — this branch has no time to render', () => {
    for (const iso of [CURRENT_YEAR_DATE, PAST_YEAR_DATE]) {
      const { container } = renderTable('en', iso);
      expect(cellText(container)).not.toMatch(/\d\d:\d\d/);
      cleanup();
    }
  });
});
