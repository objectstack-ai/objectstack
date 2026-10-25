/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#10866 — the published date helpers name the day a date-only value
 * stores, in every zone.
 *
 * ── What was measured ───────────────────────────────────────────────────────
 * `formatDate`, `formatDateTime` and `formatRelativeTime` (`utils/formatting`)
 * and `formatDateSpec` (`utils/spec-formatters`) parsed a string with the
 * engine's own `Date` parse, which reads a date-only `2026-09-01` as UTC
 * midnight. Every viewer west of UTC then read August 31st, and
 * `formatDateSpec` given a `timeZone` west of UTC read August 31st for every
 * viewer. The parse is now the shared step, `toDisplayDate` (`@object-ui/core`,
 * the objectui#10183 convention), which tells the two shapes apart by the
 * value: a date-only string is rebuilt at local midnight of the day it names,
 * and a value with a time part keeps its instant. `formatDateSpec` hands its
 * `timeZone` to an instant only: a date-only value names a day, and the
 * shared step's result reads back as that day only in the local zone.
 *
 * A day its month does not have (`2026-02-30`) is refused by the shared step
 * (objectui#10026), so each helper renders it as the raw string, the face all
 * four already give an unparsable value (`formatRelativeTime` used to throw
 * for one).
 *
 * ── ⚠️ The zone cases run ONLY when driven, in a FORKS child ────────────────
 * `process.env.TZ` written inside a test of the normal run does not move the
 * zone (the root config runs `pool: 'threads'`), so the zone cases are
 * skipped there and `scripts/__tests__/date-only-zone-pins-10183.test.ts`
 * runs them on the forks pool and fails unless every one ran and passed. Each
 * zone opens with a rig case, so a child whose zone did not move reds instead
 * of going quietly green. The suite-zone cases run in the normal run too.
 *
 * `Asia/Shanghai` is the control: east of UTC the UTC-midnight parse already
 * landed on the named day, and an hour-offset "repair" would break it.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { formatDate, formatDateTime, formatRelativeTime } from '../utils/formatting';
import { formatDateSpec } from '../utils/spec-formatters';

const DRIVEN = process.env.OBJECTUI_DATE_ZONE_CHILD === '1';

/** UTC-7 in September — the card's direction. */
const WEST = 'America/Los_Angeles';
/** UTC+8 — the control. */
const EAST = 'Asia/Shanghai';

const DAY = '2026-09-01';
/** A fixed instant: 20:00 on the 1st in the west, 11:00 on the 2nd in the east, 23:00 on the 1st in New York. */
const INSTANT = '2026-09-02T03:00:00.000Z';
/** 10:00 on August 30th in each zone, so the relative phrases below read alike. */
const TEN_AM: Record<string, string> = {
  [WEST]: '2026-08-30T17:00:00.000Z',
  [EAST]: '2026-08-30T02:00:00.000Z',
  UTC: '2026-08-30T10:00:00.000Z',
};

const EN = { locale: 'en-US' } as const;

/** Freeze the clock at 10:00 local, moving this forked process into `zone` first when given. */
function enter(zone?: string): void {
  if (zone) process.env.TZ = zone;
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(TEN_AM[zone ?? 'UTC']));
}

afterEach(() => {
  vi.useRealTimers();
});

describe('i18n date helpers, in the suite zone (objectui#10866)', () => {
  it('`formatDateSpec` given a `timeZone` west of UTC reads a date-only value as the day it stores', () => {
    enter();
    expect(formatDateSpec(DAY, { dateStyle: 'medium', timeZone: 'America/New_York' }, 'en-US')).toBe('Sep 1, 2026');
  });

  it('control: an instant is still read in the `timeZone` it is handed', () => {
    enter();
    expect(formatDateSpec(INSTANT, { dateStyle: 'medium', timeZone: 'America/New_York' }, 'en-US')).toBe('Sep 1, 2026');
    expect(formatDateSpec(INSTANT, { dateStyle: 'medium', timeZone: 'Asia/Tokyo' }, 'en-US')).toBe('Sep 2, 2026');
  });

  it('a day its month does not have renders as the raw string, not the rolled day', () => {
    enter();
    expect(formatDate('2026-02-30', EN)).toBe('2026-02-30');
    expect(formatDateTime('2026-02-30', EN)).toBe('2026-02-30');
    expect(formatDateSpec('2026-02-30', { dateStyle: 'medium' }, 'en-US')).toBe('2026-02-30');
    expect(formatRelativeTime('2026-02-30', 'en-US')).toBe('2026-02-30');
  });

  it('`formatRelativeTime` renders an unparsable value as its string rather than throwing', () => {
    enter();
    expect(formatRelativeTime('not a date', 'en-US')).toBe('not a date');
  });
});

describe.runIf(DRIVEN)('i18n date helpers west of UTC (objectui#10866)', () => {
  it('rig: the zone really moved', () => {
    enter(WEST);
    expect(Intl.DateTimeFormat().resolvedOptions().timeZone).toBe(WEST);
    expect(new Date(INSTANT).getHours()).toBe(20);
  });

  it('fixture validity: the engine parse of the string lands on the day before here', () => {
    enter(WEST);
    // Without this the cases below would be green for free.
    expect(new Date(DAY).getDate()).toBe(31);
  });

  it('`formatDate` reads `2026-09-01` as September 1st', () => {
    enter(WEST);
    expect(formatDate(DAY, EN)).toBe('Sep 1, 2026');
    expect(formatDate(DAY, { ...EN, style: 'full' })).toBe('Tuesday, September 1, 2026');
    expect(formatDate(DAY, { ...EN, dateStyle: 'short' })).toBe('9/1/26');
  });

  it('`formatDateTime` reads it as midnight of September 1st', () => {
    enter(WEST);
    expect(formatDateTime(DAY, EN)).toBe('Sep 1, 2026, 12:00 AM');
  });

  it('`formatRelativeTime` counts to the start of that day', () => {
    enter(WEST);
    expect(formatRelativeTime(DAY, 'en-US')).toBe('in 2 days');
    expect(formatRelativeTime('2026-08-28', 'en-US')).toBe('2 days ago');
  });

  it('`formatDateSpec` reads it as September 1st, with or without a `timeZone`', () => {
    enter(WEST);
    expect(formatDateSpec(DAY, { dateStyle: 'medium' }, 'en-US')).toBe('Sep 1, 2026');
    expect(formatDateSpec(DAY, { dateStyle: 'medium', timeZone: 'America/New_York' }, 'en-US')).toBe('Sep 1, 2026');
    expect(formatDateSpec(DAY, { dateStyle: 'medium', timeZone: 'Asia/Tokyo' }, 'en-US')).toBe('Sep 1, 2026');
  });

  it('control: an instant keeps its local day here, the 1st, and its `timeZone` day', () => {
    enter(WEST);
    expect(formatDate(INSTANT, EN)).toBe('Sep 1, 2026');
    expect(formatDateTime(INSTANT, EN)).toBe('Sep 1, 2026, 8:00 PM');
    expect(formatRelativeTime('2026-08-31T17:00:00.000Z', 'en-US')).toBe('tomorrow');
    expect(formatDateSpec(INSTANT, { dateStyle: 'medium' }, 'en-US')).toBe('Sep 1, 2026');
    expect(formatDateSpec(INSTANT, { dateStyle: 'medium', timeZone: 'Asia/Tokyo' }, 'en-US')).toBe('Sep 2, 2026');
  });
});

describe.runIf(DRIVEN)('i18n date helpers east of UTC, the control (objectui#10866)', () => {
  it('rig: the zone really moved', () => {
    enter(EAST);
    expect(Intl.DateTimeFormat().resolvedOptions().timeZone).toBe(EAST);
    expect(new Date(INSTANT).getHours()).toBe(11);
  });

  it('`formatDate` reads `2026-09-01` as September 1st, as it already did', () => {
    enter(EAST);
    expect(formatDate(DAY, EN)).toBe('Sep 1, 2026');
    expect(formatDate(DAY, { ...EN, style: 'full' })).toBe('Tuesday, September 1, 2026');
    expect(formatDate(DAY, { ...EN, dateStyle: 'short' })).toBe('9/1/26');
  });

  it('`formatDateTime` reads it as midnight of September 1st', () => {
    enter(EAST);
    expect(formatDateTime(DAY, EN)).toBe('Sep 1, 2026, 12:00 AM');
  });

  it('`formatRelativeTime` counts to the start of that day', () => {
    enter(EAST);
    expect(formatRelativeTime(DAY, 'en-US')).toBe('in 2 days');
    expect(formatRelativeTime('2026-08-28', 'en-US')).toBe('2 days ago');
  });

  it('`formatDateSpec` reads it as September 1st, with or without a `timeZone`', () => {
    enter(EAST);
    expect(formatDateSpec(DAY, { dateStyle: 'medium' }, 'en-US')).toBe('Sep 1, 2026');
    expect(formatDateSpec(DAY, { dateStyle: 'medium', timeZone: 'America/New_York' }, 'en-US')).toBe('Sep 1, 2026');
    expect(formatDateSpec(DAY, { dateStyle: 'medium', timeZone: 'Asia/Tokyo' }, 'en-US')).toBe('Sep 1, 2026');
  });

  it('control: an instant keeps its local day here, the 2nd, and its `timeZone` day', () => {
    enter(EAST);
    expect(formatDate(INSTANT, EN)).toBe('Sep 2, 2026');
    expect(formatDateTime(INSTANT, EN)).toBe('Sep 2, 2026, 11:00 AM');
    expect(formatRelativeTime('2026-08-31T17:00:00.000Z', 'en-US')).toBe('in 2 days');
    expect(formatDateSpec(INSTANT, { dateStyle: 'medium' }, 'en-US')).toBe('Sep 2, 2026');
    expect(formatDateSpec(INSTANT, { dateStyle: 'medium', timeZone: 'America/New_York' }, 'en-US')).toBe('Sep 1, 2026');
  });
});
