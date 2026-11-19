/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { afterEach, describe, it, expect } from 'vitest';
import { resolveDateMacros, resolvePeriodKeyTokens } from '../date-macros';
import { setDisplayTimeZone } from '../date-display';
import { resolveFilterPlaceholders } from '../filter-tokens';

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

/**
 * `{current_iso_week}` — the period key (`PERIOD_KEY_TOKENS` in
 * `@objectstack/spec/data`). The week rule is written twice, here and in
 * `@objectstack/core`'s `bucketDateKey(value, 'week', timezone)`, which this
 * package cannot import. The table below is the parity pin: the same rows,
 * instant and zone in, key out, are asserted against the server resolver in
 * the period-key block of `packages/core/src/utils/filter-tokens.test.ts`.
 * Change a row in one file and change it in the other.
 *
 * The test process clock is UTC (`ui/vitest.config.mts` pins `TZ`), so a row
 * with no zone is the UTC day on both sides.
 */
describe('resolvePeriodKeyTokens — {current_iso_week} (objectstack#34938)', () => {
  afterEach(() => setDisplayTimeZone(undefined));

  /** instant · workspace zone (none = UTC) · ISO week key */
  const PARITY_TABLE: ReadonlyArray<readonly [string, string | undefined, string]> = [
    ['2026-11-19T12:00:00Z', undefined, '2026-W47'],
    // Year edges: the ISO week-numbering year is the year of the week's Thursday.
    ['2026-12-31T12:00:00Z', undefined, '2026-W53'],
    ['2027-01-01T12:00:00Z', undefined, '2026-W53'],
    ['2027-01-03T12:00:00Z', undefined, '2026-W53'],
    ['2027-01-04T12:00:00Z', undefined, '2027-W01'],
    ['2020-12-31T12:00:00Z', undefined, '2020-W53'],
    ['2021-01-03T12:00:00Z', undefined, '2020-W53'],
    ['2021-01-04T12:00:00Z', undefined, '2021-W01'],
    ['2025-12-29T12:00:00Z', undefined, '2026-W01'],
    ['2024-12-30T12:00:00Z', undefined, '2025-W01'],
    // The workspace zone decides the day, and so the week.
    ['2026-11-22T20:00:00Z', 'Asia/Tokyo', '2026-W48'],
    ['2026-11-22T20:00:00Z', 'America/New_York', '2026-W47'],
    ['2026-11-23T03:00:00Z', 'America/Los_Angeles', '2026-W47'],
    ['2026-11-23T03:00:00Z', undefined, '2026-W48'],
    ['2027-01-03T23:30:00Z', 'Asia/Shanghai', '2027-W01'],
    ['2027-01-03T23:30:00Z', undefined, '2026-W53'],
  ];

  it.each(PARITY_TABLE)('%s in %s is %s', (instant, zone, key) => {
    setDisplayTimeZone(zone);
    expect(resolvePeriodKeyTokens('{current_iso_week}', new Date(instant))).toBe(key);
    expect(resolvePeriodKeyTokens('${current_iso_week}', new Date(instant))).toBe(key);
  });

  it('resolves a whole-string placeholder anywhere in a filter tree, and nothing else', () => {
    const now = new Date('2026-11-19T12:00:00Z');
    const filter = {
      $and: [
        { cost_week: '{current_iso_week}' },
        { supply_week: { $in: ['{current_iso_week}', '2026-W46'] } },
        { note: 'plan {current_iso_week}' },
        { created_at: { $gte: '{today}' } },
        { owner: '{current_user_id}' },
      ],
    };
    expect(resolvePeriodKeyTokens(filter, now)).toEqual({
      $and: [
        { cost_week: '2026-W47' },
        { supply_week: { $in: ['2026-W47', '2026-W46'] } },
        // An embedded placeholder is left as written, as on the server.
        { note: 'plan {current_iso_week}' },
        // The other vocabularies are not this function's.
        { created_at: { $gte: '{today}' } },
        { owner: '{current_user_id}' },
      ],
    });
  });

  it('is not a date macro: resolveDateMacros leaves it as written', () => {
    const now = new Date('2026-11-19T12:00:00Z');
    expect(resolveDateMacros('{current_iso_week}', now)).toBe('{current_iso_week}');
    // Lit control: the same call resolves a date macro.
    expect(resolveDateMacros('{current_week_start}', now)).toBe('2026-11-16');
  });

  it('resolveFilterPlaceholders resolves it beside the other vocabularies, on one instant', () => {
    const now = new Date('2026-11-19T12:00:00Z');
    expect(resolveFilterPlaceholders(
      { cost_week: '{current_iso_week}', day: { $gte: '{current_week_start}' }, owner: '{current_user_id}' },
      { currentUserId: 'usr_1', onUnresolved: null },
      now,
    )).toEqual({ cost_week: '2026-W47', day: { $gte: '2026-11-16' }, owner: 'usr_1' });
  });
});
