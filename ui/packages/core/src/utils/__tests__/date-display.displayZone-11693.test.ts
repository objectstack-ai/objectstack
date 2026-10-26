/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#11693 — an instant renders in the display zone the host declared,
 * and in the viewer's zone when none is declared; a date-only value names its
 * day in every case.
 *
 * The console's localization fetch dropped the `timezone` the server answers,
 * so every face rendered in the viewer's zone whatever the workspace
 * configured. The zone now enters through `setDisplayTimeZone`, the one input
 * every face in this module reads, and nowhere else.
 *
 * ── How "the viewer's zone" is driven ──────────────────────────────────────
 * It is not driven: the suite runs in UTC (`vitest.config.mts`,
 * objectui#8366), so the viewer's zone here IS UTC, and the rig case below
 * reds if that ever stops being true. The display zone is the explicit
 * per-case input that config's header asks non-UTC coverage to use.
 * `America/Los_Angeles` (UTC-7 in September) is the discriminating direction
 * for the date-only pins: a date-only value is built at UTC midnight here,
 * which is the evening BEFORE in Los Angeles, so a zone that wrongly reached
 * it would name August 31st. Each of those pins carries that control.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  formatDate,
  formatDateTime,
  formatDateTimeCompactParts,
  formatRelativeDate,
  getDisplayTimeZone,
  setDisplayTimeZone,
  subscribeDisplayTimeZone,
  toDisplayDate,
  toDisplayEndDate,
  toInclusiveEndDay,
} from '../date-display';

const WEST = 'America/Los_Angeles';
const EAST = 'Asia/Shanghai';
const L = 'en-US';
/** 03:00 on Sep 2nd in UTC, 20:00 on Sep 1st in Los Angeles, 11:00 on Sep 2nd in Shanghai. */
const INSTANT = '2026-09-02T03:00:00.000Z';
const DAY = '2026-09-01';

afterEach(() => {
  setDisplayTimeZone(undefined);
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('rig (objectui#11693)', () => {
  it('the viewer zone this suite renders in is UTC, unlike both display zones used below', () => {
    expect(new Intl.DateTimeFormat().resolvedOptions().timeZone).toBe('UTC');
  });
});

describe('an instant renders in the display zone when one is set, else in the viewer zone (objectui#11693)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(INSTANT));
  });

  it('formatDateTime default face', () => {
    expect(formatDateTime(INSTANT, { locale: L })).toBe('Sep 2, 2026, 03:00 AM');
    setDisplayTimeZone(WEST);
    expect(formatDateTime(INSTANT, { locale: L })).toBe('Sep 1, 2026, 08:00 PM');
    setDisplayTimeZone(EAST);
    expect(formatDateTime(INSTANT, { locale: L })).toBe('Sep 2, 2026, 11:00 AM');
  });

  it('the compact face and its two halves take ONE zone', () => {
    expect(formatDateTimeCompactParts(INSTANT, { locale: L })).toEqual({ date: '9/2/2026', time: '3:00 am' });
    expect(formatDateTime(INSTANT, { locale: L, style: 'compact' })).toBe('9/2/2026 3:00 am');
    setDisplayTimeZone(WEST);
    expect(formatDateTimeCompactParts(INSTANT, { locale: L })).toEqual({ date: '9/1/2026', time: '8:00 pm' });
    expect(formatDateTime(INSTANT, { locale: L, style: 'compact' })).toBe('9/1/2026 8:00 pm');
  });

  it('a Date instant takes the zone too, as the datetime cell hands one', () => {
    setDisplayTimeZone(WEST);
    expect(formatDateTime(new Date(INSTANT), { locale: L })).toBe('Sep 1, 2026, 08:00 PM');
  });

  it('formatDate names the day the instant falls on in the zone, on the default and the short face', () => {
    expect(formatDate(INSTANT, undefined, { locale: L })).toBe('Sep 2');
    expect(formatDate(INSTANT, 'short', { locale: L })).toBe("Sep 2, '26");
    setDisplayTimeZone(WEST);
    expect(formatDate(INSTANT, undefined, { locale: L })).toBe('Sep 1');
    expect(formatDate(INSTANT, 'short', { locale: L })).toBe("Sep 1, '26");
  });

  it('the current year is the zone\'s current year', () => {
    // 03:00 on Jan 1st 2027 in UTC is still Dec 31st 2026 in Los Angeles.
    vi.setSystemTime(new Date('2027-01-01T03:00:00.000Z'));
    const lastEvening = '2026-12-31T20:00:00.000Z';
    expect(formatDate(lastEvening, undefined, { locale: L })).toBe('Dec 31, 2026');
    setDisplayTimeZone(WEST);
    expect(formatDate(lastEvening, undefined, { locale: L })).toBe('Dec 31');
  });

  it('formatRelativeDate counts days from the zone\'s today, to the day the instant falls on there', () => {
    // 23:00 on Sep 1st in UTC: yesterday from UTC's Sep 2nd, today in Los Angeles.
    expect(formatRelativeDate('2026-09-01T23:00:00.000Z', { locale: L })).toBe('Yesterday');
    // 20:00 on Sep 2nd in UTC: today in UTC, 04:00 on Sep 3rd in Shanghai.
    expect(formatRelativeDate('2026-09-02T20:00:00.000Z', { locale: L })).toBe('Today');
    setDisplayTimeZone(WEST);
    expect(formatRelativeDate('2026-09-01T23:00:00.000Z', { locale: L })).toBe('Today');
    setDisplayTimeZone(EAST);
    expect(formatRelativeDate('2026-09-02T20:00:00.000Z', { locale: L })).toBe('Tomorrow');
  });
});

describe('a date-only value names its day whatever the display zone (objectui#11693)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(INSTANT));
    setDisplayTimeZone(WEST);
  });

  it('control: the same instant, as a plain Date, names August 31st in the zone', () => {
    // What every pin below would read if the zone reached a calendar day.
    const sameInstant = new Date(toDisplayDate(DAY).getTime());
    expect(formatDate(sameInstant, undefined, { locale: L })).toBe('Aug 31');
  });

  it('the string, on every face', () => {
    expect(formatDate(DAY, undefined, { locale: L })).toBe('Sep 1');
    expect(formatDate(DAY, 'short', { locale: L })).toBe("Sep 1, '26");
    expect(formatDateTime(DAY, { locale: L })).toBe('Sep 1, 2026, 12:00 AM');
    expect(formatDateTimeCompactParts(DAY, { locale: L })).toEqual({ date: '9/1/2026', time: '12:00 am' });
  });

  it('the Date toDisplayDate built for it, as the sub-grid date cell hands one on', () => {
    expect(formatDate(toDisplayDate(DAY), undefined, { locale: L })).toBe('Sep 1');
  });

  it('the day toInclusiveEndDay names for a date-only end', () => {
    expect(formatDate(toInclusiveEndDay(toDisplayEndDate(DAY)), undefined, { locale: L })).toBe('Sep 1');
  });

  it('the relative face counts it from the zone\'s today without moving the day', () => {
    // Today is Sep 1st in Los Angeles, Sep 2nd in UTC.
    expect(formatRelativeDate(DAY, { locale: L })).toBe('Today');
    expect(formatDate(DAY, 'relative', { locale: L })).toBe('Today');
    setDisplayTimeZone(undefined);
    expect(formatRelativeDate(DAY, { locale: L })).toBe('Yesterday');
  });

  it('beyond the relative window, the absolute fallback still names the day', () => {
    vi.setSystemTime(new Date('2026-09-30T03:00:00.000Z'));
    expect(formatRelativeDate(DAY, { locale: L })).toBe('Sep 1');
  });
});

describe('setDisplayTimeZone (objectui#11693)', () => {
  it('reads back what it was given, and clears on undefined or an empty string', () => {
    expect(getDisplayTimeZone()).toBeUndefined();
    setDisplayTimeZone(WEST);
    expect(getDisplayTimeZone()).toBe(WEST);
    setDisplayTimeZone('');
    expect(getDisplayTimeZone()).toBeUndefined();
    setDisplayTimeZone(EAST);
    setDisplayTimeZone(undefined);
    expect(getDisplayTimeZone()).toBeUndefined();
  });

  it('a name this runtime does not know clears the zone with a warning, so no face throws', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    setDisplayTimeZone(WEST);
    setDisplayTimeZone('Middle/Earth');
    expect(getDisplayTimeZone()).toBeUndefined();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toContain('Middle/Earth');
    expect(formatDateTime(INSTANT, { locale: L })).toBe('Sep 2, 2026, 03:00 AM');
  });

  it('tells a subscriber about a change, once, and not about a repeat', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeDisplayTimeZone(listener);
    setDisplayTimeZone(WEST);
    setDisplayTimeZone(WEST);
    expect(listener).toHaveBeenCalledTimes(1);
    setDisplayTimeZone(undefined);
    expect(listener).toHaveBeenCalledTimes(2);
    unsubscribe();
    setDisplayTimeZone(EAST);
    expect(listener).toHaveBeenCalledTimes(2);
  });
});
