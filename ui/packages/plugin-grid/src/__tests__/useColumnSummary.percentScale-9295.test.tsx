/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#9295 — the grid column-summary footer's percent arm read
 * `precision` as a FRACTION-digit count, four lines below a currency arm that
 * already read `scale` and carried the objectui#2131 note saying why.
 *
 * `@objectstack/spec` declares the pair on the COLUMN face in its own words:
 * `precision` is "Total digits (non-negative integer; for number/currency)" —
 * percent is not in that list at all — and `scale` is "Decimal places
 * (non-negative integer)". So the footer padded a decimal(10, 2) percent
 * column out to ten fraction digits.
 *
 * ── The claim that actually matters is AGREEMENT ────────────────────────
 * This footer sits directly beneath the list cell, and both read the same
 * member for the same reason. A fix to one alone makes them disagree on
 * screen, so the agreement rows below compare this hook's own label against
 * `formatPercent` — the list cell's declared source — computed in the same
 * run, rather than against a hand-written string that could only restate one
 * side.
 *
 * ⭐ A two-surface comparison is blind to a JOINT move, which is what the
 * absolute-byte rows are for: they name the pre-repair output and refuse it.
 */
import { describe, it, expect } from 'vitest';
import * as React from 'react';
import { renderHook } from '@testing-library/react';
import { I18nProvider, LocalizationProvider } from '@object-ui/i18n';
import { formatPercent } from '@object-ui/fields';
import { useColumnSummary } from '../useColumnSummary';

/**
 * The UI language is held at `en` while the TENANT locale moves — the real
 * precedence `useDisplayLocale` implements, and the convention
 * `useColumnSummary.percentConvergence-9269` established in this directory.
 * Holding the language keeps the footer's PREFIX in English, so the rows below
 * can name a whole label instead of fishing a substring out of it. Passing the
 * locale as the LANGUAGE instead translates the prefix (`Summe:`) and the
 * failure then reads as a percent defect that is not there.
 */
function wrapper(locale: string) {
  return ({ children }: { children: React.ReactNode }) => (
    <I18nProvider config={{ defaultLanguage: 'en', detectBrowserLanguage: false }}>
      <LocalizationProvider value={{ locale }}>{children}</LocalizationProvider>
    </I18nProvider>
  );
}

/**
 * `fieldHints` (`precision`, `scale`) sit on the FIELD, handed to the hook as
 * `fieldMetadata`: objectui#11588 retired the column-level read of both.
 */
function summaryLabel(stored: number, locale: string, fieldHints: Record<string, unknown> = {}): string {
  const cols: any[] = [{ field: 'rate', summary: 'sum', type: 'percent' }];
  const meta = { rate: { type: 'percent', ...fieldHints } };
  const { result } = renderHook(() => useColumnSummary(cols, [{ rate: stored }], meta as never), {
    wrapper: wrapper(locale),
  });
  return result.current.summaries.get('rate')?.label ?? '';
}

/**
 * MEASURED, not assumed: a bundle change to `grid.summary.sum` /
 * `grid.summary.pattern` would otherwise arrive here as a percent failure.
 * The first case below reads it off a column with no percent type at all, so
 * if that case is the red one the prefix moved and this card is not implicated.
 */
const PREFIX = 'Sum: ';

describe('useColumnSummary percent arm reads `scale`, not `precision` (objectui#9295)', () => {
  it('the label prefix this file builds on is the one the bundle produces', () => {
    const cols: any[] = [{ field: 'n', summary: 'sum' }];
    const { result } = renderHook(() => useColumnSummary(cols, [{ n: 1 }]), {
      wrapper: wrapper('en'),
    });
    expect(result.current.summaries.get('n')?.label).toBe(`${PREFIX}1`);
  });

  it('does not pad a decimal(10, 2) percent column out to ten fraction digits', () => {
    // The row that fails before the repair: `Sum: 25.0000000000%`.
    expect(summaryLabel(0.25, 'en', { precision: 10, scale: 2 })).toBe(`${PREFIX}25.00%`);
  });

  it('ignores `precision` entirely when no `scale` is declared', () => {
    expect(summaryLabel(0.25, 'en', { precision: 10 })).toBe(`${PREFIX}25%`);
  });

  it('honours a declared `scale` on its own', () => {
    expect(summaryLabel(0.25, 'en', { scale: 3 })).toBe(`${PREFIX}25.000%`);
  });

  it('leaves a column declaring neither member exactly where it was', () => {
    // MUST-NOT-CHANGE control.
    expect(summaryLabel(0.12345, 'en')).toBe(`${PREFIX}12%`);
  });
});

describe('the footer and the list cell above it move together (objectui#9295)', () => {
  /**
   * Both percent surfaces resolve their width from the same member, so the
   * footer's label is the cell's rendering under the same declaration. Fixing
   * only one surface fails these rows in whichever direction was left behind.
   */
  it.each([
    [0.25, { precision: 10, scale: 2 }, 2],
    [0.25, { precision: 10 }, 0],
    [0.12345, { scale: 4 }, 4],
    [0.12345, {}, 0],
  ])('agrees with formatPercent for %p declaring %p', (stored, hints, width) => {
    expect(summaryLabel(stored as number, 'en', hints as Record<string, unknown>)).toBe(
      // Every row's field declares no `max`: a fraction (objectui#11475).
      `${PREFIX}${formatPercent(stored as number, 'fraction', width as number, 'en')}`,
    );
  });

  it('agrees in a locale whose percent convention differs from English', () => {
    // de-DE writes a no-break space before the sign; tr-TR puts the sign in
    // front. The width and the convention have to survive together.
    expect(summaryLabel(0.25, 'de-DE', { precision: 10, scale: 2 })).toBe(
      `${PREFIX}${formatPercent(0.25, 'fraction', 2, 'de-DE')}`,
    );
    expect(summaryLabel(0.25, 'tr-TR', { precision: 10, scale: 2 })).toBe(
      `${PREFIX}${formatPercent(0.25, 'fraction', 2, 'tr-TR')}`,
    );
  });

  it('refuses the pre-repair bytes outright', () => {
    // The absolute-byte control a two-surface comparison cannot provide.
    const retired = `${PREFIX}25.0000000000%`;
    expect(summaryLabel(0.25, 'en', { precision: 10, scale: 2 })).not.toBe(retired);
  });
});
