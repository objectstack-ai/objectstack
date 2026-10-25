/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#4553 phase 2 — the percent CELL, the fields-internal consumer of
 * `formatPercent`.
 *
 * `PercentCellRenderer` had two rendering paths and BOTH were outside the
 * display-locale channel:
 *
 *     const formatted = isWholePercentField
 *       ? `${numValue.toFixed(precision)}%`   // a second bare toFixed path
 *       : formatPercent(numValue, precision); // no locale to pass
 *
 * The branch was believed to exist for a real reason — a field named
 * `progress` / `completion` was taken to store 0-100, so it must NOT go
 * through `percentDisplayValue`'s fraction scaling — but it had quietly become
 * a second place where a percent was formatted, and it was the more primitive
 * of the two. Threading only the `formatPercent` half would have made ONE grid
 * internally inconsistent: a `progress` column ungrouped and unlocalized
 * beside a `rate` column that was neither. So both branches rendered through
 * the same locale-aware body and differed only in the scaling policy.
 *
 * ⚠️ That scaling policy is GONE (objectui#9452): the name never was evidence
 * about the value, and the census in
 * `PercentCellRenderer.nameKeyedScaling-9452.test.tsx` found no first-party
 * producer it served. What this file still measures — the locale and the
 * convention on every path — is unchanged, and so is every assertion below
 * except the one marked as inverted.
 *
 * ── Directions, predicted in writing BEFORE the run ──────────────────────
 * Runner machine locale en-US.
 *
 *   de, ordinary percent 1234.5   `1235%` → `1.235 %`   RED
 *   de, `progress` 1234.5         `1235%` → `1.235 %`   RED (the second path)
 *   en, ordinary percent 1234.5   `1235%` → `1,235%`    RED (grouping move)
 *   en, `progress` 1234.5         `1235%` → `1,235%`    RED (grouping move)
 *   the fraction/whole SPLIT itself                     PIN, green both sides
 *   small-value en output                               PIN, green both sides
 *
 * Provider-mounted by construction (objectui#4514) — the pure-function cases
 * live in `percent-formatter-locale-4553.test.ts`.
 */

import React from 'react';
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom';
import { I18nProvider, LocalizationProvider } from '@object-ui/i18n';
import { PercentCellRenderer } from '../index';

/** German writes a NO-BREAK SPACE (U+00A0) before the percent sign. */
const NBSP = '\u00a0';

/**
 * A session: the UI language the user picked plus the tenant's regional
 * default. `useDisplayLocale()` resolves tenant regional default → active UI
 * language → 'en'.
 */
function renderCell(
  value: unknown,
  field: Record<string, unknown>,
  language: string,
  tenantLocale?: string,
) {
  return render(
    <I18nProvider
      config={{ defaultLanguage: language, detectBrowserLanguage: false }}
      persistLanguage={false}
    >
      <LocalizationProvider value={{ locale: tenantLocale }}>
        <PercentCellRenderer
          value={value as any}
          field={{ type: 'percent', ...field } as any}
        />
      </LocalizationProvider>
    </I18nProvider>,
  );
}

/** The cell's text, read off the value span beside the decorative bar. */
function cellText(): string {
  return document.body.textContent ?? '';
}

afterEach(() => cleanup());

/*
 * objectui#11475 — the cell reads the field's DECLARED storage (the spec's
 * `percentScaleOf`: a fraction unless the field declares a `max` above 1). The
 * whole-point values below (`1234.5`, `33.33`) therefore declare a `max` above
 * 1, which is what a whole-stored field does; the magnitude used to be guessed
 * from their size. Nothing this file measures (the locale, the convention, the
 * width) moved.
 */
describe('PercentCellRenderer follows the display locale (objectui#4553)', () => {
  it('de renders the German percent form', () => {
    renderCell(1234.5, { name: 'win_rate', max: 10000 }, 'de');
    expect(cellText()).toContain(`1.235${NBSP}%`);
  });

  /**
   * The SECOND path — `progress` matches WHOLE_PERCENT_FIELD_PATTERN, so this
   * value skips fraction scaling and used to skip `formatPercent` entirely.
   */
  it('de renders the German form on the whole-percent path too', () => {
    renderCell(1234.5, { name: 'progress', max: 10000 }, 'de');
    expect(cellText()).toContain(`1.235${NBSP}%`);
  });

  it('en groups at four digits on both paths — the deliberate output move', () => {
    const { unmount } = renderCell(1234.5, { name: 'win_rate', max: 10000 }, 'en');
    expect(cellText()).toContain('1,235%');
    unmount();

    renderCell(1234.5, { name: 'progress', max: 10000 }, 'en');
    expect(cellText()).toContain('1,235%');
  });

  it('an explicit tenant locale outranks the active UI language', () => {
    renderCell(1234.5, { name: 'win_rate', max: 10000 }, 'en', 'de');
    expect(cellText()).toContain(`1.235${NBSP}%`);
    expect(cellText()).not.toContain('1,235%');
  });
});

describe('PercentCellRenderer keeps its scaling contract (objectui#4553 must-not-change)', () => {
  /**
   * ⚠️ INVERTED by objectui#9452, deliberately — this assertion used to read
   * `progress` + `0.5` as `1%` and was labelled must-not-change.
   *
   * Read what it was guarding before treating the inversion as a broken
   * promise: objectui#4553's subject was the display LOCALE, and this block is
   * that card's blast-radius guard — it pinned the magnitudes so a locale
   * change could not move them silently. It was never a product ruling on
   * which magnitude is right. objectui#9452 is the card that asked that
   * question, and its census found the name test had no first-party producer
   * that needed it and two that it misread. The magnitude now comes from
   * `percentDisplayValue` on every name, so the two columns below agree.
   *
   * The guard itself survives intact and is still worth its place: a locale
   * change must still not move a magnitude. The full before/after table and
   * the census live in `PercentCellRenderer.nameKeyedScaling-9452.test.tsx`.
   */
  it('an ordinary percent and a progress field scale a fraction identically', () => {
    const { unmount } = renderCell(0.5, { name: 'win_rate' }, 'en');
    // Fraction-stored: 0.5 → 50%.
    expect(cellText()).toContain('50%');
    unmount();

    renderCell(0.5, { name: 'progress' }, 'en');
    // The column's NAME no longer reaches the scaling decision.
    expect(cellText()).toContain('50%');
  });

  /**
   * PIN: small-value English output is byte-identical across the change.
   *
   * The two-decimal width is declared with `scale`, ⛔ not `precision`
   * (objectui#9295) — `precision` is the column's TOTAL digit count and this
   * renderer no longer reads it.
   */
  it('en small-value output is unchanged (must-not-change)', () => {
    renderCell(33.33, { name: 'win_rate', scale: 2, max: 100 }, 'en');
    expect(cellText()).toContain('33.33%');
  });

  /** PIN: the decorative bar still reports the un-formatted magnitude. */
  it('the progressbar still carries the numeric value', () => {
    renderCell(33.33, { name: 'win_rate', max: 100 }, 'en');
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '33.33');
  });

  /** PIN: the null path is untouched — and the hook runs before it. */
  it('renders the empty value for null without crashing on the hook', () => {
    expect(() => renderCell(null, { name: 'win_rate' }, 'de')).not.toThrow();
  });
});
