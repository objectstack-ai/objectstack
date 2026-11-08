// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [ADR-0144 D5, D7 parameter 3, Open items 2 and 3] The home-amount
// conversion arithmetic, pinned at its published home on the engine's own
// samples. The write-time projection (`@objectstack/objectql`) and the form's
// live "≈ home amount" preview both read these four exports, so the number a
// form shows before save is the number the engine stores. The projection's
// verdicts over a served rate stay pinned in objectql's
// `home-amount-projection.test.ts`.

import { describe, it, expect } from 'vitest';
import { CURRENCY_FRACTION_DIGITS } from '@objectstack/spec/data';
import { documentDateOf, divideToPlaces, formatScaledDecimal, toScaledDecimal } from './index';

/** `amount ÷ rate` to the home currency's CLDR fraction digits, as the projection spells it. */
const homeAmount = (amount: number | string, rate: number | string, home: string): string =>
  formatScaledDecimal(divideToPlaces(toScaledDecimal(amount)!, toScaledDecimal(rate)!, CURRENCY_FRACTION_DIGITS[home]!));

describe('the home-amount arithmetic exported from @objectstack/formula', () => {
  it('reads an exact decimal from a number, a string and a bigint; spells none for a non-number', () => {
    expect(toScaledDecimal(0.1389)).toEqual({ digits: 1389n, scale: 4 });
    expect(toScaledDecimal('7.123456789012')).toEqual({ digits: 7123456789012n, scale: 12 });
    expect(toScaledDecimal(12n)).toEqual({ digits: 12n, scale: 0 });
    expect(toScaledDecimal(1e21)).toEqual({ digits: 10n ** 21n, scale: 0 });
    for (const bad of ['', 'abc', '1,000', NaN, Infinity, null, undefined, {}]) {
      expect(toScaledDecimal(bad), String(bad)).toBeUndefined();
    }
  });

  it('rounds to each home currency\'s CLDR digits: JPY 0, USD 2, KWD 3', () => {
    expect(homeAmount(100, 0.0065, 'JPY')).toBe('15385'); // 15384.615…
    expect(homeAmount(100, 1.0857, 'USD')).toBe('92.11'); // 92.106…
    expect(homeAmount(100, 3.2468, 'KWD')).toBe('30.800'); // 30.79955…
    // The #27196 preview sample: USD 10,000 at 0.1389 is ¥71,994.24 in a CNY home.
    expect(homeAmount(10000, 0.1389, 'CNY')).toBe('71994.24');
  });

  it('rounds a tie half away from zero, on both signs, with no float in the way', () => {
    expect(homeAmount('0.125', 1, 'USD')).toBe('0.13');
    expect(homeAmount('-0.125', 1, 'USD')).toBe('-0.13');
    expect(homeAmount('0.5', 1, 'JPY')).toBe('1');
    expect(homeAmount('-0.0005', 1, 'KWD')).toBe('-0.001');
    // 1.005 has no exact binary double, so a float `toFixed(2)` answers 1.00; the decimal is 1.01.
    expect(homeAmount(1.005, 1, 'USD')).toBe('1.01');
  });

  it('takes a datetime as its calendar day in a non-UTC timezone', () => {
    // 2026-03-15T17:00Z is 01:00 on the 16th in Shanghai and 13:00 on the 15th in New York.
    expect(documentDateOf('2026-03-15T17:00:00Z', 'Asia/Shanghai')).toBe('2026-03-16');
    expect(documentDateOf(new Date('2026-03-15T17:00:00Z'), 'Asia/Shanghai')).toBe('2026-03-16');
    expect(documentDateOf('2026-03-16T02:00:00Z', 'America/New_York')).toBe('2026-03-15');
    // A calendar date is its own day whatever the zone.
    expect(documentDateOf('2026-03-15', 'Asia/Shanghai')).toBe('2026-03-15');
  });

  it('takes the UTC day when the timezone is unset, UTC or unknown', () => {
    expect(documentDateOf('2026-03-15T17:00:00Z')).toBe('2026-03-15');
    expect(documentDateOf('2026-03-31T23:30:00-05:00')).toBe('2026-04-01');
    expect(documentDateOf('2026-03-15T17:00:00Z', 'UTC')).toBe('2026-03-15');
    expect(documentDateOf('2026-03-15T17:00:00Z', 'Mars/Olympus')).toBe('2026-03-15');
    expect(documentDateOf('not a date')).toBeUndefined();
    expect(documentDateOf(20260315)).toBeUndefined();
  });
});
