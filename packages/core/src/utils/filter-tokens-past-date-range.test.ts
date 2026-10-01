// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#21068] A date macro whose offset lands past every instant a JavaScript
// `Date` can hold names no day and no time. Measured on the base
// (`fed0db8f6`), off 2026-09-30T12:00Z: `{300000_years_ago}` resolved to the
// text `Invalid Date`, and `{99999999999999999999_minutes_ago}` threw an
// uncoded `RangeError: Invalid time value` from `toISOString`. Both are
// refused now, `INVALID_FILTER` / 400, naming the placeholder.
//
// Pins: every unit of the parameterised grammar in both directions, through
// `resolveFilterToken` and through `resolveFilterTokens` on a filter tree;
// the `Date`'s own edges on both sides, resolved (the year is then the
// engine's to judge); and in-range controls for a day and an instant.

import { describe, it, expect } from 'vitest';
import { resolveFilterToken, resolveFilterTokens } from './filter-tokens.js';

// Wed 2026-09-30 12:00 UTC: every value below is read off this instant.
const NOW = new Date('2026-09-30T12:00:00.000Z');

const refusalOf = (run: () => unknown) => {
  try {
    run();
  } catch (e) {
    return e as Error & { code?: unknown; status?: unknown; token?: unknown };
  }
  return null;
};

/** Every unit, both directions: each offset lands past the instants a `Date` holds. */
const PAST_THE_DATE_RANGE: readonly string[] = [
  '300000_years_ago',
  '99999999999999999999_minutes_ago',
  '300000_years_from_now',
  '9999999_months_ago',
  '99999999_weeks_from_now',
  '100020727_days_ago',
  '99999999999_hours_from_now',
  '144029846161_minutes_ago',
];

describe('[#21068] a date macro past the instants a Date holds is refused, naming the placeholder', () => {
  it.each(PAST_THE_DATE_RANGE)('{%s}: INVALID_FILTER / 400, the token named, never the text "Invalid Date"', (token) => {
    const refusal = refusalOf(() => resolveFilterToken(token, { now: NOW }));
    expect(refusal, `{${token}} resolved instead of refusing`).not.toBeNull();
    expect(refusal!.code).toBe('INVALID_FILTER');
    expect(refusal!.status).toBe(400);
    expect(refusal!.token).toBe(token);
    expect(refusal!.message).toContain(`"{${token}}"`);
    expect(refusal!.message).toContain('past every instant a JavaScript Date can hold');
    expect(refusal!.message).toContain('a datetime value a year from 1000 to 9999');
    expect(refusal!.message).not.toContain('Invalid Date');
    expect(refusal!.message).not.toContain('Invalid time value');
  });

  it('resolveFilterTokens refuses the same in a filter tree, in the timezone path too, and leaves the tree unmutated', () => {
    for (const token of ['300000_years_ago', '99999999999999999999_minutes_ago']) {
      for (const timezone of [undefined, 'Asia/Shanghai']) {
        const filter = { $and: [{ opened_at: { $lt: `{${token}}` } }, { note: 'x' }] };
        const refusal = refusalOf(() => resolveFilterTokens(filter, { now: NOW, timezone }));
        expect(refusal?.code, `{${token}} in ${timezone ?? 'UTC'}`).toBe('INVALID_FILTER');
        expect(refusal?.status).toBe(400);
        expect(refusal?.message).toContain(`"{${token}}"`);
        expect(filter.$and[0]).toEqual({ opened_at: { $lt: `{${token}}` } });
      }
    }
  });

  it('the Date\'s own edges resolve: the last day and the last minute it holds, on both sides', () => {
    // The refusal is the `Date`'s validity, not a copy of its range: one step
    // inside the edge resolves, spelled as the day or instant it names, and its
    // year is the engine's to judge against its column.
    expect(resolveFilterToken('273847_years_ago', { now: NOW })).toBe('-271821-09-30');
    expect(refusalOf(() => resolveFilterToken('273848_years_ago', { now: NOW }))?.code).toBe('INVALID_FILTER');
    expect(resolveFilterToken('273733_years_from_now', { now: NOW })).toBe('+275759-09-30');
    expect(refusalOf(() => resolveFilterToken('273734_years_from_now', { now: NOW }))?.code).toBe('INVALID_FILTER');
    // 144029846160 minutes before NOW is exactly -8.64e15 ms, the first instant a Date holds.
    expect(resolveFilterToken('144029846160_minutes_ago', { now: NOW })).toBe(new Date(-8.64e15).toISOString());
    expect(refusalOf(() => resolveFilterToken('144029846161_minutes_ago', { now: NOW }))?.code).toBe('INVALID_FILTER');
  });

  it('the controls: a day and an instant inside the range resolve as before', () => {
    expect(resolveFilterToken('100_years_ago', { now: NOW })).toBe('1926-09-30');
    expect(resolveFilterToken('1_hour_ago', { now: NOW })).toBe('2026-09-30T11:00:00.000Z');
    expect(resolveFilterToken('now', { now: NOW })).toBe(NOW.toISOString());
    expect(resolveFilterTokens({ opened_at: { $lt: '{100_years_ago}' } }, { now: NOW })).toEqual({
      opened_at: { $lt: '1926-09-30' },
    });
  });
});
