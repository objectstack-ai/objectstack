/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#7443 — the THIRD spelling of the datetime convention converges.
 *
 * `formatCellValue` sniffed ISO strings and built its own
 * `Intl.DateTimeFormat` with `{ year:'numeric', month:'short', day:'numeric',
 * hour:'2-digit', minute:'2-digit' }` — close to `formatDateTime` but
 * independently authored, so nothing kept the two in step. It now calls
 * `formatDateTime` (default style).
 *
 * ── The stop-condition this file answers ─────────────────────────────────
 * The ruling required `data-table`'s output measured BEFORE and AFTER, and a
 * separate line in the PR if a pixel changed. It did not: the bag it used to
 * build is the same bag `formatDateTime`'s default branch builds. These pins
 * are the measurement — `FORMER_DATETIME_BAG` below is the bag copied verbatim
 * from `origin/main`, and the rendered cell is asserted equal to it, so the
 * two can never silently diverge again either.
 *
 * ── The date-only half converged later, in objectui#7620 ─────────────────
 * It was left alone HERE on purpose: routing it through `formatDate` moves a
 * pixel (the default face drops the year inside the current year) and #7443's
 * ruling forbade that, so the question went to its own card. The maintainer
 * ruled A on #7620 and the branch now calls `formatDate` too.
 *
 * That does not retire the pin below, it narrows what it says: `DATE_ONLY` is
 * a PAST-year value, and past years are exactly where the two faces already
 * agreed, so this row is byte-identical before #7620, after #7620, and after
 * any future move of the date-only branch that keeps the shared function's
 * past-year face. The CURRENT-year row — the one that did move — is pinned in
 * `data-table-date-convention-7620.test.tsx`, which is also where the
 * fixture-validity assertions live.
 */
import { describe, it, expect, afterEach } from 'vitest';
import React from 'react';
import { render, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom';
import { ComponentRegistry } from '@object-ui/core';
import { I18nProvider, useObjectTranslation } from '@object-ui/i18n';
// Registers the renderers at module scope, NOT inside a `beforeAll` — there the
// cold transform is billed to `hookTimeout` (objectui#3010/#3021).
import '../renderers';

const INSTANT = '2024-07-04T07:00:00.000Z';
const DATE_ONLY = '2024-07-04';

/** The bags `formatCellValue` inlined before this change, copied verbatim. */
const FORMER_DATETIME_BAG: Intl.DateTimeFormatOptions = {
  year: 'numeric',
  month: 'short',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
};
const FORMER_DATE_BAG: Intl.DateTimeFormatOptions = {
  year: 'numeric',
  month: 'short',
  day: 'numeric',
};

const former = (iso: string, locale: string, bag: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat(locale, bag).format(new Date(Date.parse(iso)));

/**
 * Reports the tag the table itself resolves. `formatCellValue` localizes from
 * `useTableTranslation().language`, so the expectation is built from THE SAME
 * tag the component read rather than from the one this file asked for — the
 * property under test is "identical to the former bag", and hard-coding a tag
 * the harness may not actually resolve would measure the harness instead.
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

describe('the datetime cell is byte-identical before and after the convergence', () => {
  it.each(['en', 'de'])('%s — the rendered cell equals the former bag', (language) => {
    const { container, language: resolved } = renderTable(language, INSTANT);
    expect(cellText(container)).toBe(former(INSTANT, resolved(), FORMER_DATETIME_BAG));
  });

  it('en renders the exact string the card recorded for this path', () => {
    const { container } = renderTable('en', INSTANT);
    expect(cellText(container)).toBe('Jul 4, 2024, 07:00 AM');
  });

  it('the shared function and the former bag agree — that is why nothing moved', () => {
    for (const language of ['en', 'de', 'zh']) {
      const shared = new Date(INSTANT).toLocaleDateString(language, FORMER_DATETIME_BAG);
      expect(shared).toBe(former(INSTANT, language, FORMER_DATETIME_BAG));
    }
  });
});

// A PAST-year value, so this describes the half of the date-only branch that
// objectui#7620 did NOT move; the current-year half it did move is pinned in
// `data-table-date-convention-7620.test.tsx`.
describe('the date-only cell is untouched for a past-year date', () => {
  it.each(['en', 'de'])('%s — still the former date-only bag, with no time appended', (language) => {
    const { container, language: resolved } = renderTable(language, DATE_ONLY);
    expect(cellText(container)).toBe(former(DATE_ONLY, resolved(), FORMER_DATE_BAG));
    expect(cellText(container)).not.toMatch(/\d\d:\d\d/);
  });
});

describe('non-date values are still returned untouched', () => {
  it('a plain string is not sniffed into a date', () => {
    const { container } = renderTable('en', 'not-a-date-at-all');
    expect(cellText(container)).toBe('not-a-date-at-all');
  });
});
