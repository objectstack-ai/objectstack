/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { describe, it, expect } from 'vitest';
import { resolveDateMacros } from '../date-macros';

describe('resolveDateMacros', () => {
  // A fixed "now" — Monday 2026-05-25 (Q2 2026) — keeps assertions deterministic.
  const now = new Date(2026, 4, 25, 12, 30, 0); // local time

  it('expands period start/end tokens', () => {
    expect(resolveDateMacros('{today}', now)).toBe('2026-05-25');
    expect(resolveDateMacros('{yesterday}', now)).toBe('2026-05-24');
    expect(resolveDateMacros('{tomorrow}', now)).toBe('2026-05-26');

    expect(resolveDateMacros('{current_week_start}', now)).toBe('2026-05-25');
    expect(resolveDateMacros('{current_week_end}', now)).toBe('2026-05-31');
    expect(resolveDateMacros('{current_month_start}', now)).toBe('2026-05-01');
    expect(resolveDateMacros('{current_month_end}', now)).toBe('2026-05-31');
    expect(resolveDateMacros('{current_quarter_start}', now)).toBe('2026-04-01');
    expect(resolveDateMacros('{current_quarter_end}', now)).toBe('2026-06-30');
    expect(resolveDateMacros('{current_year_start}', now)).toBe('2026-01-01');
    expect(resolveDateMacros('{current_year_end}', now)).toBe('2026-12-31');
  });

  it('supports bare aliases (week_start, month_end, …)', () => {
    expect(resolveDateMacros('{week_start}', now)).toBe('2026-05-25');
    expect(resolveDateMacros('{week_end}', now)).toBe('2026-05-31');
    expect(resolveDateMacros('{month_end}', now)).toBe('2026-05-31');
    expect(resolveDateMacros('{quarter_end}', now)).toBe('2026-06-30');
    expect(resolveDateMacros('{year_end}', now)).toBe('2026-12-31');
  });

  it('expands last_* and next_* tokens', () => {
    expect(resolveDateMacros('{last_week_start}', now)).toBe('2026-05-18');
    expect(resolveDateMacros('{last_week_end}', now)).toBe('2026-05-24');
    expect(resolveDateMacros('{last_month_start}', now)).toBe('2026-04-01');
    expect(resolveDateMacros('{last_month_end}', now)).toBe('2026-04-30');
    expect(resolveDateMacros('{last_quarter_start}', now)).toBe('2026-01-01');
    expect(resolveDateMacros('{last_quarter_end}', now)).toBe('2026-03-31');
    expect(resolveDateMacros('{last_year_start}', now)).toBe('2025-01-01');
    expect(resolveDateMacros('{last_year_end}', now)).toBe('2025-12-31');

    expect(resolveDateMacros('{next_week_start}', now)).toBe('2026-06-01');
    expect(resolveDateMacros('{next_month_start}', now)).toBe('2026-06-01');
    expect(resolveDateMacros('{next_quarter_start}', now)).toBe('2026-07-01');
    expect(resolveDateMacros('{next_year_start}', now)).toBe('2027-01-01');
  });

  it('expands parameterised tokens with any positive integer', () => {
    expect(resolveDateMacros('{7_days_ago}', now)).toBe('2026-05-18');
    expect(resolveDateMacros('{30_days_ago}', now)).toBe('2026-04-25');
    expect(resolveDateMacros('{90_days_ago}', now)).toBe('2026-02-24');
    expect(resolveDateMacros('{1_day_ago}', now)).toBe('2026-05-24');

    expect(resolveDateMacros('{7_days_from_now}', now)).toBe('2026-06-01');
    expect(resolveDateMacros('{60_days_from_now}', now)).toBe('2026-07-24');

    expect(resolveDateMacros('{2_weeks_ago}', now)).toBe('2026-05-11');
    expect(resolveDateMacros('{3_months_ago}', now)).toBe('2026-02-25');
    expect(resolveDateMacros('{1_year_from_now}', now)).toBe('2027-05-25');
  });

  it('walks nested objects and arrays in filters', () => {
    const filter = {
      $and: [
        { published_at: { $gte: '{last_quarter_start}', $lte: '{today}' } },
        { tags: { $in: ['{30_days_ago}', 'literal'] } },
      ],
    };
    const out = resolveDateMacros(filter, now);
    expect(out).toEqual({
      $and: [
        { published_at: { $gte: '2026-01-01', $lte: '2026-05-25' } },
        { tags: { $in: ['2026-04-25', 'literal'] } },
      ],
    });
  });

  it('leaves unknown tokens untouched and ignores non-strings', () => {
    expect(resolveDateMacros('{not_a_macro}', now)).toBe('{not_a_macro}');
    expect(resolveDateMacros('hello {today} world', now)).toBe('hello 2026-05-25 world');
    expect(resolveDateMacros(42 as any, now)).toBe(42);
    expect(resolveDateMacros(null as any, now)).toBe(null);
  });

  it('accepts both {token} and ${token} forms', () => {
    expect(resolveDateMacros('${today}', now)).toBe('2026-05-25');
    expect(resolveDateMacros('range: ${last_week_start}..${today}', now)).toBe(
      'range: 2026-05-18..2026-05-25',
    );
  });

  it('expands minute/hour parameterised tokens as full ISO timestamps', () => {
    // now = 2026-05-25 12:30:00 local
    const minus15m = new Date(now.getTime() - 15 * 60 * 1000).toISOString();
    const plus2h = new Date(now.getTime() + 2 * 60 * 60 * 1000).toISOString();
    expect(resolveDateMacros('{15_minutes_ago}', now)).toBe(minus15m);
    expect(resolveDateMacros('{2_hours_from_now}', now)).toBe(plus2h);
    // singular forms
    expect(resolveDateMacros('{1_minute_ago}', now)).toBe(
      new Date(now.getTime() - 60 * 1000).toISOString(),
    );
    expect(resolveDateMacros('{1_hour_from_now}', now)).toBe(
      new Date(now.getTime() + 60 * 60 * 1000).toISOString(),
    );
  });
});
