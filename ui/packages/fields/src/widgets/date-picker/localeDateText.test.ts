/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#12622 — the text the record form's date picker shows and reads.
 *
 * The format is the DISPLAY locale's (an `en` and a `zh` rendering pinned
 * below), and every reading lands on the native control's value shape, so the
 * value the form writes is unchanged.
 */

import { describe, expect, it } from 'vitest';
import { formatLocaleDateText, localeDatePattern, parseLocaleDateText } from './localeDateText';

describe('formatLocaleDateText — the display locale spells the day (objectui#12622)', () => {
  it('en: month / day / year', () => {
    expect(formatLocaleDateText('2026-10-16', 'en', false)).toBe('10/16/2026');
    expect(localeDatePattern('en', false)).toBe('MM/DD/YYYY');
  });

  it('zh: year / month / day', () => {
    expect(formatLocaleDateText('2026-10-16', 'zh', false)).toBe('2026/10/16');
    expect(localeDatePattern('zh', false)).toBe('YYYY/MM/DD');
  });

  it('datetime: the wall clock as given, in the locale clock', () => {
    expect(formatLocaleDateText('2026-10-16T14:30', 'en', true)).toBe('10/16/2026, 02:30 PM');
    expect(formatLocaleDateText('2026-10-16T14:30', 'zh', true)).toBe('2026/10/16 14:30');
  });

  it('an empty or unreadable value is blank', () => {
    expect(formatLocaleDateText('', 'en', false)).toBe('');
    expect(formatLocaleDateText('not a date', 'en', false)).toBe('');
  });
});

describe('parseLocaleDateText — typed text lands on the native value shape (objectui#12622)', () => {
  it('date: the locale order, round-tripping its own text', () => {
    expect(parseLocaleDateText('10/16/2026', 'en', false)).toBe('2026-10-16');
    expect(parseLocaleDateText('2026/10/16', 'zh', false)).toBe('2026-10-16');
    expect(parseLocaleDateText('16.10.2026', 'de', false)).toBe('2026-10-16');
    expect(parseLocaleDateText('1/2/26', 'en', false)).toBe('2026-01-02');
  });

  it('date: an ISO day is read in every locale', () => {
    expect(parseLocaleDateText('2026-10-16', 'en', false)).toBe('2026-10-16');
    expect(parseLocaleDateText('2026-10-16', 'de', false)).toBe('2026-10-16');
  });

  it('blank text clears; text naming no real day is refused', () => {
    expect(parseLocaleDateText('  ', 'en', false)).toBe('');
    expect(parseLocaleDateText('02/30/2026', 'en', false)).toBeNull();
    expect(parseLocaleDateText('13/01/2026', 'en', false)).toBeNull();
    expect(parseLocaleDateText('tomorrow', 'en', false)).toBeNull();
    expect(parseLocaleDateText('10/16/2026 10:00', 'en', false)).toBeNull();
  });

  it('datetime: 24-hour, 12-hour with a marker, and the date alone', () => {
    expect(parseLocaleDateText('10/16/2026, 02:30 PM', 'en', true)).toBe('2026-10-16T14:30');
    expect(parseLocaleDateText('10/16/2026 12:05 am', 'en', true)).toBe('2026-10-16T00:05');
    expect(parseLocaleDateText('2026/10/16 14:30', 'zh', true)).toBe('2026-10-16T14:30');
    expect(parseLocaleDateText('2026/10/16 下午 2:30', 'zh', true)).toBe('2026-10-16T14:30');
    expect(parseLocaleDateText('10/16/2026', 'en', true)).toBe('2026-10-16T00:00');
    expect(parseLocaleDateText('10/16/2026 25:00', 'en', true)).toBeNull();
  });

  it('every locale reads back the text it formats', () => {
    for (const locale of ['en', 'zh', 'ja', 'ko', 'de', 'fr', 'es', 'pt', 'ru', 'ar']) {
      expect(parseLocaleDateText(formatLocaleDateText('2026-10-16', locale, false), locale, false), locale).toBe('2026-10-16');
      expect(parseLocaleDateText(formatLocaleDateText('2026-10-16T14:30', locale, true), locale, true), locale).toBe('2026-10-16T14:30');
    }
  });
});
