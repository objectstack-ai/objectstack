/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The calendar date macros resolve on the WORKSPACE zone's day: the display
 * zone `setDisplayTimeZone` declared, which is the zone the server resolves
 * an unresolved `{today}` in. Without one, the viewer's clock decides.
 *
 * The test process clock is UTC (`ui/vitest.config.mts` pins `TZ`), so UTC
 * plays the viewer's browser here, and every instant below is one where the
 * declared zone and UTC are on different days.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resolveDateMacros } from '../date-macros';
import { setDisplayTimeZone } from '../date-display';
import { resolveFilterPlaceholders } from '../filter-tokens';

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  setDisplayTimeZone(undefined);
  vi.useRealTimers();
});

describe('a workspace zone ahead of the viewer (Pacific/Auckland vs UTC)', () => {
  // 12:00 UTC on Mon 2 Nov 2026 is 01:00 on Tue 3 Nov in Auckland (NZDT, +13).
  const INSTANT = new Date('2026-11-02T12:00:00Z');

  it('{today} and its neighbours are the workspace day, not the viewer day', () => {
    vi.setSystemTime(INSTANT);
    expect(resolveDateMacros('{today}')).toBe('2026-11-02');

    setDisplayTimeZone('Pacific/Auckland');
    expect(resolveDateMacros('{today}')).toBe('2026-11-03');
    expect(resolveDateMacros('{yesterday}')).toBe('2026-11-02');
    expect(resolveDateMacros('{tomorrow}')).toBe('2026-11-04');
    expect(resolveDateMacros('{7_days_ago}')).toBe('2026-10-27');
    expect(resolveDateMacros('{2_weeks_from_now}')).toBe('2026-11-17');
    expect(resolveDateMacros('{1_months_ago}')).toBe('2026-10-03');
    expect(resolveDateMacros('{1_years_from_now}')).toBe('2027-11-03');
  });

  it('a list filter resolved through resolveFilterPlaceholders names the workspace day', () => {
    vi.setSystemTime(INSTANT);
    setDisplayTimeZone('Pacific/Auckland');
    const rules = [{ field: 'close_date', operator: 'between', value: ['{today}', '{today}'] }];
    expect(resolveFilterPlaceholders(rules, { onUnresolved: null })).toEqual([
      { field: 'close_date', operator: 'between', value: ['2026-11-03', '2026-11-03'] },
    ]);
  });

  it('every period bound moves with the day at a year boundary', () => {
    // 12:00 UTC on Thu 31 Dec 2026 is 01:00 on Fri 1 Jan 2027 in Auckland.
    vi.setSystemTime(new Date('2026-12-31T12:00:00Z'));
    setDisplayTimeZone('Pacific/Auckland');
    expect(resolveDateMacros('{today}')).toBe('2027-01-01');
    expect(resolveDateMacros('{month_start}')).toBe('2027-01-01');
    expect(resolveDateMacros('{month_end}')).toBe('2027-01-31');
    expect(resolveDateMacros('{quarter_start}')).toBe('2027-01-01');
    expect(resolveDateMacros('{quarter_end}')).toBe('2027-03-31');
    expect(resolveDateMacros('{year_start}')).toBe('2027-01-01');
    expect(resolveDateMacros('{year_end}')).toBe('2027-12-31');
    expect(resolveDateMacros('{last_month_start}')).toBe('2026-12-01');
    expect(resolveDateMacros('{last_month_end}')).toBe('2026-12-31');
    expect(resolveDateMacros('{last_quarter_start}')).toBe('2026-10-01');
    expect(resolveDateMacros('{last_year_end}')).toBe('2026-12-31');
    expect(resolveDateMacros('{next_month_start}')).toBe('2027-02-01');
  });

  it('the week bounds move at a Sunday-to-Monday boundary', () => {
    // 12:00 UTC on Sun 3 Jan 2027 is 01:00 on Mon 4 Jan in Auckland.
    vi.setSystemTime(new Date('2027-01-03T12:00:00Z'));
    expect(resolveDateMacros('{week_start}')).toBe('2026-12-28');

    setDisplayTimeZone('Pacific/Auckland');
    expect(resolveDateMacros('{week_start}')).toBe('2027-01-04');
    expect(resolveDateMacros('{week_end}')).toBe('2027-01-10');
    expect(resolveDateMacros('{last_week_start}')).toBe('2026-12-28');
    expect(resolveDateMacros('{last_week_end}')).toBe('2027-01-03');
    expect(resolveDateMacros('{next_week_start}')).toBe('2027-01-11');
  });
});

describe('a workspace zone behind the viewer (America/New_York vs UTC)', () => {
  // 02:00 UTC on Fri 1 Jan 2027 is 21:00 on Thu 31 Dec 2026 in New York (EST, -5).
  const INSTANT = new Date('2027-01-01T02:00:00Z');

  it('{today} and every period bound are the workspace day', () => {
    vi.setSystemTime(INSTANT);
    expect(resolveDateMacros('{today}')).toBe('2027-01-01');
    expect(resolveDateMacros('{year_start}')).toBe('2027-01-01');

    setDisplayTimeZone('America/New_York');
    expect(resolveDateMacros('{today}')).toBe('2026-12-31');
    expect(resolveDateMacros('{tomorrow}')).toBe('2027-01-01');
    expect(resolveDateMacros('{week_start}')).toBe('2026-12-28');
    expect(resolveDateMacros('{month_start}')).toBe('2026-12-01');
    expect(resolveDateMacros('{month_end}')).toBe('2026-12-31');
    expect(resolveDateMacros('{quarter_start}')).toBe('2026-10-01');
    expect(resolveDateMacros('{quarter_end}')).toBe('2026-12-31');
    expect(resolveDateMacros('{year_start}')).toBe('2026-01-01');
    expect(resolveDateMacros('{year_end}')).toBe('2026-12-31');
    expect(resolveDateMacros('{next_year_start}')).toBe('2027-01-01');
    expect(resolveDateMacros('{30_days_ago}')).toBe('2026-12-01');
  });
});

describe('instant tokens stay on the real instant in every zone', () => {
  it('{now}, {N_minutes_ago} and {N_hours_from_now} ignore the display zone', () => {
    const at = new Date('2026-11-02T12:00:00Z');
    vi.setSystemTime(at);
    const bare = {
      now: resolveDateMacros('{now}'),
      minutes: resolveDateMacros('{15_minutes_ago}'),
      hours: resolveDateMacros('{2_hours_from_now}'),
    };
    setDisplayTimeZone('Pacific/Auckland');
    expect(resolveDateMacros('{now}')).toBe(bare.now);
    expect(resolveDateMacros('{15_minutes_ago}')).toBe(bare.minutes);
    expect(resolveDateMacros('{2_hours_from_now}')).toBe(bare.hours);
    expect(bare.now).toBe('2026-11-02T12:00:00.000Z');
    expect(bare.hours).toBe('2026-11-02T14:00:00.000Z');
  });
});

describe('no workspace zone declared: the viewer clock decides, as before', () => {
  it('resolves on the process clock with no zone, and again once the zone is cleared', () => {
    vi.setSystemTime(new Date('2026-11-02T12:00:00Z'));
    expect(resolveDateMacros('{today}')).toBe('2026-11-02');
    expect(resolveDateMacros('{week_start}')).toBe('2026-11-02');

    setDisplayTimeZone('Pacific/Auckland');
    expect(resolveDateMacros('{today}')).toBe('2026-11-03');

    setDisplayTimeZone(undefined);
    expect(resolveDateMacros('{today}')).toBe('2026-11-02');
  });

  it('an explicit `now` still anchors the day, read in the declared zone', () => {
    setDisplayTimeZone('America/New_York');
    expect(resolveDateMacros('{today}', new Date('2026-11-03T02:00:00Z'))).toBe('2026-11-02');
  });
});
