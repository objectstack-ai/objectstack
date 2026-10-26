/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#4272 — the two FORMATTER-level en-US channels the #4468 fix
 * (PR #4512) deliberately left behind.
 *
 * PR #4512 pointed every date *renderer* at `useDisplayLocale()`. It could not
 * reach these two, because both are properties of the formatter's signature
 * rather than of any renderer:
 *
 *   1. `formatDate`'s `'short'` branch hardcoded the tag —
 *      `date.toLocaleDateString('en-US', { month: 'short' })` — so it rendered
 *      an English month name even when a caller DID thread `options.locale`
 *      into the very same call. The sibling default branch two lines below
 *      already honored `options?.locale`; `'short'` was the outlier.
 *   2. `formatDateTime` took no options parameter at all, so no caller could
 *      localize it however hard it tried; it passed `undefined` to `Intl`,
 *      which means "the MACHINE's locale" — neither of the repo's two locale
 *      channels.
 *
 * ── Why these cases live in a file with NO provider ──────────────────────
 * objectui#4514: `useObjectTranslation()` outside a provider reports
 * react-i18next's GLOBAL language, which any `I18nProvider` mounted earlier in
 * the same file leaves behind. These are pure-function cases that touch no
 * hook at all, so they are immune — but they are kept apart from the
 * provider-mounting cases regardless, so the split stays structural rather
 * than something a later edit can quietly erode. The provider-mounted halves
 * of this card live in `RecordPickerDialog.dateLocale.test.tsx`,
 * `plugin-grid/.../mobileCardDateLocale.test.tsx` and
 * `plugin-gantt/.../ObjectGantt.dateLocale.test.tsx`.
 *
 * ── Directions (measured, not presumed) ──────────────────────────────────
 * Runner: node v22.22.2 / ICU 78.2 / TZ=UTC / machine locale en-US.
 * `en` and `en-US` produce an IDENTICAL `{month:'short'}` for all 12 months,
 * so every `en` case below is GREEN ON BOTH SIDES — it is the byte-identical
 * must-not-change pin, NOT red evidence. The `zh` and `de` cases are the ones
 * that actually go red against unfixed code.
 */

import { describe, it, expect } from 'vitest';
import { formatDate, formatDateTime } from '../index';

/** Local-parts dates: the rendered day is then the same in every timezone. */
const AUG = new Date(2026, 7, 15, 12, 0, 0);
const OCT = new Date(2026, 9, 15, 12, 0, 0);
/** A non-current year, so the year-dropping default branch is not in play. */
const INSTANT = new Date(2024, 0, 5, 8, 30, 0);

describe("formatDate 'short' honors the threaded locale (objectui#4272)", () => {
  it('zh renders the Chinese month, not the hardcoded English one', () => {
    expect(formatDate(AUG, 'short', { locale: 'zh' })).toBe("8月 15, '26");
  });

  /**
   * A non-CJK second locale, on a month whose English and German short forms
   * differ (`Oct` / `Okt`). August would NOT discriminate — German also
   * abbreviates it `Aug` — so this case is deliberately October.
   */
  it('de renders the German month abbreviation', () => {
    expect(formatDate(OCT, 'short', { locale: 'de' })).toBe("Okt 15, '26");
  });

  /**
   * PIN, green on both sides: `en` and the runner's `en-US` agree on every
   * month name, so this asserts the English output is byte-identical after
   * the change. It is not evidence that the fix works.
   */
  it('en output is byte-identical (must-not-change)', () => {
    expect(formatDate(AUG, 'short', { locale: 'en' })).toBe("Aug 15, '26");
  });

  it('the composite shape around the month is unchanged', () => {
    // Day and 2-digit year, apostrophe and comma placement: the `'short'`
    // contract is "Jan 15, '24" and only the month token was localized.
    expect(formatDate(AUG, 'short', { locale: 'en' })).toMatch(/^Aug 15, '26$/);
  });
});

describe('formatDateTime accepts a locale at all (objectui#4272)', () => {
  it('zh renders the Chinese datetime form', () => {
    expect(formatDateTime(INSTANT, { locale: 'zh' })).toBe('2024年1月5日 08:30');
  });

  /** PIN, green on both sides — see the `en` note above. */
  it('en output is byte-identical (must-not-change)', () => {
    expect(formatDateTime(INSTANT, { locale: 'en' })).toBe('Jan 5, 2024, 08:30 AM');
  });

  /**
   * Backward compatibility: the parameter is optional and an existing caller
   * that passes nothing keeps the exact behavior it had.
   *
   * This is the ONE case where building the expectation from the runner is
   * the correct move rather than the objectui#4513 trap: the contract under
   * test IS "still the runtime default", so both sides of the comparison are
   * meant to be the machine's locale. Every other case in this file spells
   * its tag explicitly.
   */
  it('no options — still the runtime default, unchanged', () => {
    const runtimeDefault = INSTANT.toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
    expect(formatDateTime(INSTANT)).toBe(runtimeDefault);
  });

  it('the empty / invalid guards are untouched', () => {
    expect(formatDateTime('', { locale: 'zh' })).toBe('—');
    expect(formatDateTime('not-a-date', { locale: 'zh' })).toBe('—');
  });
});
