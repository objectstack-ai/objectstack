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

describe('decimal text is judged against the number range before it is scaled', () => {
  const ZERO = { digits: 0n, scale: 0 };

  it('beyond the largest number it spells none, as a non-finite number does', () => {
    for (const text of ['1e400', '-1e400', '1.8e308', '+.5E+400', `1${'0'.repeat(400)}`]) {
      expect(toScaledDecimal(text), text).toBeUndefined();
      expect(Number.isFinite(Number(text)), text).toBe(false);
    }
    expect(toScaledDecimal(Number('1e400'))).toBeUndefined();
  });

  it('below the smallest number it is zero, as that number is', () => {
    for (const text of ['1e-400', '-1e-400', '2e-324', '+.5e-400', `0.${'0'.repeat(400)}1`]) {
      expect(toScaledDecimal(text), text).toEqual(ZERO);
      expect(Number(text) === 0, text).toBe(true);
    }
    expect(toScaledDecimal(Number('1e-400'))).toEqual(ZERO);
    expect(formatScaledDecimal(divideToPlaces(toScaledDecimal('1e-400')!, { digits: 1n, scale: 0 }, 2))).toBe('0.00');
  });

  it('keeps every digit inside the range, at both ends', () => {
    const largest = { digits: 17976931348623157n * 10n ** 292n, scale: 0 };
    expect(toScaledDecimal('1.7976931348623157e308')).toEqual(largest);
    expect(toScaledDecimal(Number.MAX_VALUE)).toEqual(largest);
    expect(toScaledDecimal('5e-324')).toEqual({ digits: 5n, scale: 324 });
    expect(toScaledDecimal(Number.MIN_VALUE)).toEqual({ digits: 5n, scale: 324 });
    expect(toScaledDecimal('1e300')).toEqual({ digits: 10n ** 300n, scale: 0 });
    expect(toScaledDecimal('-1.5e-300')).toEqual({ digits: -15n, scale: 301 });
    // A bigint is its own digits, however many.
    expect(toScaledDecimal(10n ** 400n)).toEqual({ digits: 10n ** 400n, scale: 0 });
  });

  it('never scales a zero by its exponent', () => {
    expect(toScaledDecimal('0.00')).toEqual({ digits: 0n, scale: 2 });
    expect(toScaledDecimal('0e-5')).toEqual({ digits: 0n, scale: 5 });
    expect(toScaledDecimal('0e-324')).toEqual({ digits: 0n, scale: 324 });
    expect(toScaledDecimal('0e-325')).toEqual(ZERO);
    expect(toScaledDecimal('-0e5')).toEqual(ZERO);
  });

  it('reads and converts in time bounded by the text, whatever its exponent says', () => {
    const texts = [
      '1e30000000', '-1e30000000', '+.5E+30000000', '0e30000000',
      '1e-30000000', '+1e-30000000', '0e-30000000',
      `1e-${'9'.repeat(400)}`, `1e${'9'.repeat(400)}`,
    ];
    const heapBefore = process.memoryUsage().heapUsed;
    const started = performance.now();
    const read = texts.map((text) => toScaledDecimal(text));
    const converted = read.map((value) => value && formatScaledDecimal(divideToPlaces(value, { digits: 1n, scale: 0 }, 2)));
    const elapsed = performance.now() - started;
    const allocated = process.memoryUsage().heapUsed - heapBefore;
    expect(read).toEqual([undefined, undefined, undefined, ZERO, ZERO, ZERO, ZERO, ZERO, undefined]);
    expect(converted).toEqual([undefined, undefined, undefined, '0.00', '0.00', '0.00', '0.00', '0.00', undefined]);
    expect(elapsed).toBeLessThan(200);
    expect(allocated).toBeLessThan(64 * 2 ** 20);
  });
});
