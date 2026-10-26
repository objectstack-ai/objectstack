/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#13331 — `DateDisplayOptions.alwaysShowYear` keeps the year on
 * `formatDate`'s default face for a current-year date.
 *
 * The sighting: a contract record's header highlights read
 * "Start Date Sep 15, 2025 | End Date Sep 15". The default face drops the
 * year when it is the current one, so the contract that ended this September
 * read as ending next month. The highlights strip now asks for the year; the
 * default face, which cards and grid cells share, still drops it.
 *
 * The clock is pinned to the card's day, so "the current year" is 2026 and
 * Sep 15 of it is outside the ±7-day relative window.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { formatDate, formatRelativeDate } from '../date-display';

const CLOCK = '2026-10-23T12:00:00.000Z';
const CURRENT_YEAR = '2026-09-15';
const PAST_YEAR = '2025-09-15';
const L = 'en-US';

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(CLOCK));
});

afterEach(() => {
  vi.useRealTimers();
});

describe('formatDate alwaysShowYear (objectui#13331)', () => {
  it('writes the year on a current-year date and a past-year date alike', () => {
    const opts = { locale: L, alwaysShowYear: true };
    expect(formatDate(CURRENT_YEAR, undefined, opts)).toBe('Sep 15, 2026');
    expect(formatDate(PAST_YEAR, undefined, opts)).toBe('Sep 15, 2025');
  });

  it('reaches the default face through the relative fallback too', () => {
    // The `date` cell's own default style is `'relative'`, and Sep 15 is out
    // of its window, so this is the path the highlights chip takes.
    const opts = { locale: L, alwaysShowYear: true };
    expect(formatDate(CURRENT_YEAR, 'relative', opts)).toBe('Sep 15, 2026');
    expect(formatRelativeDate(CURRENT_YEAR, opts)).toBe('Sep 15, 2026');
  });

  it('leaves the relative phrase inside the window alone', () => {
    expect(formatDate('2026-10-25', 'relative', { locale: L, alwaysShowYear: true })).toBe('In 2 days');
  });

  it('keeps the shared default face, which drops the current year, for every caller that does not ask', () => {
    expect(formatDate(CURRENT_YEAR, undefined, { locale: L })).toBe('Sep 15');
    expect(formatDate(CURRENT_YEAR, undefined, { locale: L, alwaysShowYear: false })).toBe('Sep 15');
    expect(formatDate(PAST_YEAR, undefined, { locale: L })).toBe('Sep 15, 2025');
    expect(formatRelativeDate(CURRENT_YEAR, { locale: L })).toBe('Sep 15');
  });
});
