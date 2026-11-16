/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#34228 — `formatDate`'s `'short'` face follows the locale's own
 * date order.
 *
 * The face was a fixed English layout with only the month token localized,
 * so a `zh-CN` record page, and the document `service-print` printed from it,
 * read `11月 15, '26`. The compact layout is kept where it IS the locale's
 * order (month → day → year); every other locale gets its own face with the
 * year, the default face's with the year shown.
 */
import { describe, it, expect } from 'vitest';
import { formatDate } from '../date-display';

/** A date-only value: its day is the same in every zone. */
const DAY = '2026-11-15';

describe("formatDate 'short' — the locale's date order (objectstack#34228)", () => {
  it.each([
    ['zh-CN', '2026年11月15日'],
    ['zh', '2026年11月15日'],
    ['ja-JP', '2026年11月15日'],
    ['ko-KR', '2026년 11월 15일'],
    ['de-DE', '15. Nov. 2026'],
    ['en-GB', '15 Nov 2026'],
  ])('%s writes the date in its own order, with the year', (locale, face) => {
    expect(formatDate(DAY, 'short', { locale })).toBe(face);
  });

  it.each([
    ['en', "Nov 15, '26"],
    ['en-US', "Nov 15, '26"],
  ])('CONTROL — %s, a month-first locale, keeps the compact face', (locale, face) => {
    expect(formatDate(DAY, 'short', { locale })).toBe(face);
  });

  it('the face is the default face with the year shown, so the two never drift apart', () => {
    expect(formatDate(DAY, 'short', { locale: 'zh-CN' })).toBe(formatDate(DAY, undefined, { locale: 'zh-CN', alwaysShowYear: true }));
  });
});
