/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#8194 — the four readonly `date` WIDGET faces converge onto
 * `formatDate`, following the maintainer's ruling A on objectui#7620.
 *
 * ── What was enumerated ──────────────────────────────────────────────────
 * The card's population is defined by OMISSION — sites that render a date
 * WITHOUT an options bag — so it was re-enumerated by mechanism rather than by
 * spelling before anything was edited. Across the 78 non-test source files of
 * `@object-ui/fields` the complete set of "a Date becomes user-visible text"
 * mechanisms is: `toLocaleDateString` (7), `toLocaleTimeString` (2), the
 * shared `formatDate` / `formatDateTime` family, and nothing else — no
 * `Intl.DateTimeFormat`, no `toDateString`/`toUTCString`, no `date-fns` /
 * `dayjs` / `luxon` / `moment`. `toLocaleString` (4) is number formatting.
 *
 * That yields SIX bare no-bag sites, two more than the card's four:
 *
 *   1. `widgets/DateField.tsx`          readonly `date` widget        ← fixed
 *   2. `widgets/GridField.tsx`          sub-grid `date` column        ← fixed
 *   3. `widgets/FormulaField.tsx`       `returnType: 'date'`          ← fixed
 *   4. `widgets/lookupColumnDisplay.tsx` the `$date` fallback         ← fixed
 *   5. `widgets/DateField`'s sibling `DateTimeField.tsx` readonly     ← NOT
 *   6. `widgets/GridField.tsx`'s `datetime`/`time` branch             ← NOT
 *
 * 5 and 6 are DATETIME faces. Their one home is `formatDateTime`, which has
 * its own face vocabulary (`'compact'` from objectui#7443 versus the verbose
 * default) — picking one of those is a display-convention decision the #7620
 * ruling does not reach, so THIS card recorded them separately and left them
 * alone.
 *
 * ⚠️ That fence has since been LIFTED by a ruling of its own (objectui#8209:
 * per register, both sites through `formatDateTime`). The last describe block
 * below is what the fence became — the same verbatim copy of the former bare
 * pair, now asserting both sites have LEFT it. The face each one arrived at is
 * pinned in `datetime-widget-faces-8209.test.tsx`; the two halves together are
 * the flip, which is why neither is a witness on its own.
 *
 * ── What moved, measured in five locales ─────────────────────────────────
 * `en-US`, for the SAME ISO date-only value:
 *
 * | path                                   | current year | past year     |
 * | -------------------------------------- | ------------ | ------------- |
 * | `date` field CELL (-> `formatDate`)    | `Jul 4`      | `Jul 4, 2024` |
 * | the four widgets, BEFORE (no bag)      | `7/4/2026`   | `7/4/2024`    |
 * | the four widgets, AFTER (this PR)      | `Jul 4`      | `Jul 4, 2024` |
 *
 * ⚠️ This is a BIGGER move than objectui#7620's, and the difference is the one
 * thing about this card a reviewer should look at twice. #7620's former face
 * already asked for `{ year, month: 'short', day }`, so only the YEAR token
 * moved and its past-year row was byte-identical. These four passed NO bag at
 * all, i.e. `Intl`'s numeric default, so the WHOLE face changes and BOTH rows
 * move, in every locale — `4.7.2026` becomes `4. Juli`, `2026/7/4` becomes
 * `7月4日`, and the `ar` numeric form becomes `4 يوليو`. There is no
 * must-not-change row here, which is why `FIXTURE VALIDITY` below asserts the
 * disagreement in BOTH years rather than agreement in one.
 *
 * ── Directions ───────────────────────────────────────────────────────────
 * Reverting any of the four sites to its bare `toLocaleDateString(locale)`
 * turns EVERY case in the first three describe blocks RED — both years, all
 * five locales — because `FORMER_FACE` below is that removed spelling copied
 * verbatim and every case asserts the render differs from it and equals the
 * shared function. `FIXTURE VALIDITY` is green on both sides by construction:
 * it measures the two formatters against each other, never the widgets, and
 * exists so a fixture that silently stopped exercising the fork fails loudly
 * instead of passing for free. The `en` literals are what stops a silent
 * redesign of `formatDate`'s default face from sliding through with the
 * shared-function comparisons still agreeing.
 */

import React from 'react';
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom';
import { formatDate } from '@object-ui/core';
import { I18nProvider, LocalizationProvider } from '@object-ui/i18n';
import { DateField } from '../widgets/DateField';
import { DateTimeField } from '../widgets/DateTimeField';
import { FormulaField } from '../widgets/FormulaField';
import { GridField } from '../widgets/GridField';
import { renderLookupColumnValue } from '../widgets/lookupColumnDisplay';

/** The five locales this change was measured in. */
const LOCALES = ['en', 'de', 'zh', 'ja', 'ar'] as const;

/**
 * A current-year date, read from the clock the same way `formatDate` reads it.
 * July 4 is deliberate: a date-only ISO string parses as UTC midnight and the
 * widgets format it in the runner's zone, so a January 1 or December 31
 * fixture would fall into the neighbouring year under a negative or positive
 * offset and stop being a current-year date at all.
 */
const CURRENT_YEAR_DATE = `${new Date().getFullYear()}-07-04`;
/** The card's past-year value. */
const PAST_YEAR_DATE = '2024-07-04';
/** The `$date` wrapper carries an instant; 07:00Z keeps it on July 4 either way. */
const asDollarDate = (iso: string) => ({ $date: `${iso}T07:00:00.000Z` });

/**
 * The spelling REMOVED from all four sites, copied verbatim: a bare
 * `toLocaleDateString(locale)` with no options bag. Every claim below is
 * measured against THIS, not against a literal typed by hand.
 */
const FORMER_FACE = (iso: string, locale: string) => new Date(iso).toLocaleDateString(locale);

/**
 * `GridField`'s `date` branch never parsed the stored string — it split the
 * `YYYY-MM-DD` into LOCAL calendar parts first, because `new Date('2026-06-17')`
 * is UTC midnight and reading local components back out of it moves the day
 * west of Greenwich (objectui#3569). Its former face is therefore that
 * construction, not `FORMER_FACE`, and the two differ in exactly the zones
 * that hazard is about.
 */
const FORMER_GRID_FACE = (iso: string, locale: string) => {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(locale);
};

/** The shared one home, default style — what every site should now render. */
const shared = (iso: string, locale: string) => formatDate(iso, undefined, { locale });

function session(language: string, node: React.ReactNode) {
  return render(
    <I18nProvider config={{ defaultLanguage: language, detectBrowserLanguage: false }} persistLanguage={false}>
      <LocalizationProvider value={{ locale: undefined }}>{node}</LocalizationProvider>
    </I18nProvider>,
  );
}

/** Site 1 — the readonly `date` widget. */
const renderDateField = (locale: string, value: string) =>
  session(locale, <DateField value={value} onChange={() => {}} field={{ type: 'date', name: 'when' } as any} readonly />)
    .container.textContent ?? '';

/** Site 2 — the sub-grid readonly `date` column. */
function renderGridCell(locale: string, value: string): string {
  session(
    locale,
    <GridField
      value={[{ when: value }]}
      onChange={() => {}}
      readonly
      field={{ columns: [{ name: 'when', label: 'When', type: 'date' as const }] } as any}
    />,
  );
  return gridCellText();
}

/**
 * The readonly sub-grid paints an optional line-number `td` BEFORE the column
 * cells, so `tbody td` picks up the row ordinal (`'1'`) rather than the value.
 * The cell wanted is the last one — and the shape that makes that true is
 * asserted here rather than assumed, so a future column added to this harness
 * fails loudly instead of silently measuring the wrong `td`.
 */
function gridCellText(): string {
  const cells = screen.getByTestId('line-items-readonly').querySelectorAll('tbody tr td');
  expect(cells).toHaveLength(2);
  return cells[cells.length - 1].textContent ?? '';
}

/** Site 3 — a formula field declaring `returnType: 'date'`. */
const renderFormula = (locale: string, value: unknown) =>
  session(
    locale,
    <FormulaField value={value as any} onChange={() => {}} field={{ type: 'formula', name: 'c', returnType: 'date' }} />,
  ).container.textContent ?? '';

/**
 * Site 4 — the lookup column plain-text fallback. Called directly: it is a
 * pure function, and `descriptors: {}` is exactly the "no field descriptor"
 * shape that drives a column into this branch.
 */
const renderLookupDollarDate = (locale: string, value: unknown) =>
  String(renderLookupColumnValue({ f: value }, { field: 'f' } as any, { descriptors: {}, displayLocale: locale }));

const SITES: Array<[string, (locale: string, iso: string) => string, (iso: string, locale: string) => string]> = [
  ['DateField (readonly)', renderDateField, FORMER_FACE],
  ['GridField (sub-grid date cell)', renderGridCell, FORMER_GRID_FACE],
  ['FormulaField (returnType: date)', renderFormula, FORMER_FACE],
  ['lookupColumnDisplay ($date fallback)', (l, iso) => renderLookupDollarDate(l, asDollarDate(iso)), FORMER_FACE],
];

afterEach(() => cleanup());

describe('FIXTURE VALIDITY — the premise every case below rests on', () => {
  it.each(LOCALES)('%s — the removed bare spelling and formatDate disagree on a CURRENT-year date', (locale) => {
    expect(shared(CURRENT_YEAR_DATE, locale)).not.toBe(FORMER_FACE(CURRENT_YEAR_DATE, locale));
  });

  /**
   * ⚠️ The line that differs from objectui#7620. There the past-year row was
   * the must-not-change half; here the former face carried no `month: 'short'`
   * either, so it moves too. Asserting the disagreement makes that explicit
   * rather than leaving it as an unremarked consequence.
   */
  it.each(LOCALES)('%s — and disagree on a PAST-year date as well (unlike objectui#7620)', (locale) => {
    expect(shared(PAST_YEAR_DATE, locale)).not.toBe(FORMER_FACE(PAST_YEAR_DATE, locale));
  });

  it('the current-year fixture really is the current year, and the past-year one is not', () => {
    expect(new Date(CURRENT_YEAR_DATE).getFullYear()).toBe(new Date().getFullYear());
    expect(new Date(PAST_YEAR_DATE).getFullYear()).not.toBe(new Date().getFullYear());
  });

  it('the year-dropping decision is what separates the two rows', () => {
    expect(shared(CURRENT_YEAR_DATE, 'en')).not.toMatch(/\d{4}/);
    expect(shared(PAST_YEAR_DATE, 'en')).toMatch(/\d{4}/);
  });
});

describe.each(SITES)('%s converges onto formatDate', (_name, renderSite, former) => {
  it.each(LOCALES)('%s — the current-year render equals the shared function', (locale) => {
    expect(renderSite(locale, CURRENT_YEAR_DATE)).toBe(shared(CURRENT_YEAR_DATE, locale));
  });

  it.each(LOCALES)('%s — and no longer equals the removed bare spelling', (locale) => {
    expect(renderSite(locale, CURRENT_YEAR_DATE)).not.toBe(former(CURRENT_YEAR_DATE, locale));
  });

  it.each(LOCALES)('%s — the past-year render equals the shared function too', (locale) => {
    expect(renderSite(locale, PAST_YEAR_DATE)).toBe(shared(PAST_YEAR_DATE, locale));
  });

  it.each(LOCALES)('%s — and it too has left the removed bare spelling', (locale) => {
    expect(renderSite(locale, PAST_YEAR_DATE)).not.toBe(former(PAST_YEAR_DATE, locale));
  });
});

describe.each(SITES)('%s renders the exact face the #7620 ruling named, in en', (_name, renderSite) => {
  /**
   * ⚠️ One render per assertion group, held in a local. The sub-grid harness
   * finds its table by `data-testid`, and a second `render()` in the same case
   * leaves TWO of them mounted — `getByTestId` then throws "Found multiple"
   * rather than measuring anything. `cleanup()` runs in `afterEach`, i.e.
   * BETWEEN cases, not between renders inside one.
   */
  it('a current-year date carries no year token', () => {
    const text = renderSite('en', CURRENT_YEAR_DATE);
    expect(text).toBe('Jul 4');
    expect(text).not.toMatch(/\d{4}/);
  });

  it('a past-year date still carries its year', () => {
    expect(renderSite('en', PAST_YEAR_DATE)).toBe('Jul 4, 2024');
  });

  it('neither row grows a time — these are date-only faces', () => {
    expect(renderSite('en', CURRENT_YEAR_DATE)).not.toMatch(/\d\d:\d\d/);
    cleanup();
    expect(renderSite('en', PAST_YEAR_DATE)).not.toMatch(/\d\d:\d\d/);
  });
});

describe('what an unreadable value does at each site', () => {
  /**
   * Three of the four sites inherit `formatDate`'s empty face for a value it
   * cannot parse. That is a CONSEQUENCE of using the one home, not a second
   * convention: they used to render the literal `Invalid Date`.
   */
  it('DateField shows the shared empty face rather than "Invalid Date"', () => {
    const text = renderDateField('en', 'not-a-date');
    expect(text).toBe('—');
    expect(text).not.toContain('Invalid Date');
  });

  it('FormulaField shows the shared empty face rather than "Invalid Date"', () => {
    expect(renderFormula('en', 'not-a-date')).toBe('—');
  });

  it('the $date fallback shows the shared empty face rather than "Invalid Date"', () => {
    expect(renderLookupDollarDate('en', { $date: 'not-a-date' })).toBe('—');
  });

  /**
   * GridField is the exception ON PURPOSE. Its `!ymd` guard runs BEFORE
   * `formatDate` and still answers the raw stored string, because "showing the
   * user what is actually stored beats hiding it" (objectui#3569). Converging
   * the formatter must not quietly delete that.
   */
  it('GridField still shows the raw stored value it cannot parse (objectui#3569)', () => {
    expect(renderGridCell('en', 'not-a-date')).toBe('not-a-date');
  });
});

describe('FENCE LIFTED (objectui#8209) — the two datetime sites have left the bare pair', () => {
  /**
   * What the `SCOPE FENCE` block became. It pinned, verbatim, the string these
   * two sites rendered while objectui#8194 deliberately left them alone; the
   * maintainer's ruling on objectui#8209 then converged them, per register,
   * onto the one home `formatDateTime`. The pinned spelling is kept EXACTLY as
   * it was and the assertion is flipped — that is what makes this pair a
   * witness to the move rather than a fresh description of wherever the code
   * happens to be. A test written only against the new faces would pass
   * identically if the sites had never carried a second convention at all.
   *
   * ⛔ Deliberately negative-only. WHICH face each site landed on is a
   * different claim with a different failure mode, and it is pinned — with the
   * `en` literals the ruling names, in five locales — in
   * `datetime-widget-faces-8209.test.tsx`. Asserting it twice would leave two
   * copies of one convention to drift, which is the objectui#4576 shape this
   * whole family of cards exists to close.
   */
  const DT = `${new Date().getFullYear()}-07-04T07:00:00.000Z`;
  /**
   * The spelling REMOVED from both sites, copied verbatim: `toLocaleDateString`
   * and `toLocaleTimeString`, neither carrying an options bag, joined by a
   * space. ⛔ Never replace this with a literal — it is locale- and
   * runner-dependent, and the point is to compare against what the code USED
   * to compute, not against what someone once observed it computing.
   */
  const formerDateTimePair = (locale: string) => {
    const d = new Date(DT);
    return `${d.toLocaleDateString(locale)} ${d.toLocaleTimeString(locale)}`;
  };

  /**
   * FIXTURE VALIDITY, the same discipline the top of this file applies to the
   * `date` sites: if the former spelling ever stopped differing from the face
   * the site now renders, every case below would pass for free. The `en` seconds
   * are the concrete half of it — both new faces dropped them.
   */
  it.each(LOCALES)('%s — the removed bare pair is still a distinct string', (locale) => {
    expect(formerDateTimePair(locale)).toMatch(/\d/);
  });

  it('the removed bare pair still carries the seconds neither new face shows', () => {
    expect(formerDateTimePair('en')).toContain(':00:00');
  });

  it.each(LOCALES)('%s — readonly DateTimeField no longer renders the bare pair', (locale) => {
    const { container } = session(
      locale,
      <DateTimeField value={DT} onChange={() => {}} field={{ type: 'datetime', name: 'at' } as any} readonly />,
    );
    expect(container.textContent).not.toBe(formerDateTimePair(locale));
  });

  it.each(LOCALES)('%s — the sub-grid datetime cell no longer renders the bare pair', (locale) => {
    session(
      locale,
      <GridField
        value={[{ at: DT }]}
        onChange={() => {}}
        readonly
        field={{ columns: [{ name: 'at', label: 'At', type: 'datetime' as const }] } as any}
      />,
    );
    expect(gridCellText()).not.toBe(formerDateTimePair(locale));
  });
});
