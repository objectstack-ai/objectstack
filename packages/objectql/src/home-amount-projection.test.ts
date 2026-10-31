// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [ADR-0144 D5, D7 parameters 3 and 4, Open items 2, 3, 4 and 6] The home
// projection's own arithmetic and verdicts, with no engine: the exact decimal
// division, the one half-away-from-zero rounding to the home currency's minor
// units, the document-date reading, and what one projection writes or
// refuses over a served home currency and rate. The engine's three write
// seams are `engine-home-amount-projection.test.ts`; the same pins on SQLite
// and Postgres are packages/qa/dogfood's `test/home-amount-projection.test.ts`.

import { describe, it, expect } from 'vitest';
import {
  documentDateOf,
  divideToPlaces,
  formatScaledDecimal,
  homeAmountsTouched,
  memoizeHomeAmountServing,
  planHomeAmounts,
  projectHomeAmounts,
  settleBulkHomeAmounts,
  toScaledDecimal,
  ExchangeRateMissingError,
  HomeCurrencyUnsetError,
  type HomeAmountServing,
} from './home-amount-projection.js';
import { ValidationError } from './validation/record-validator.js';

const HOME_AMOUNT = { field: 'amount_home', rateDate: 'invoice_date', rateField: 'amount_rate' };
const SCHEMA = {
  fields: {
    currency_code: { type: 'text', valueDomain: 'iso_4217_currency' },
    invoice_date: { type: 'date' },
    amount: { type: 'currency', currencyConfig: { currencyMode: 'record', currencyField: 'currency_code', homeAmount: HOME_AMOUNT } },
    amount_home: { type: 'currency', readonly: true },
    amount_rate: { type: 'number', readonly: true },
    plain: { type: 'currency', currencyConfig: { currencyMode: 'record', currencyField: 'currency_code' } },
  },
};
const PLAN = planHomeAmounts(SCHEMA);

/** A served rate table: `rates[currency]` is a list of `[effective_date, rate]`; reads are counted. */
function serving(home: string | undefined, rates: Record<string, Array<[string, unknown]>> = {}) {
  const reads = { home: 0, rate: 0 };
  const s: HomeAmountServing = {
    async homeCurrency() {
      reads.home += 1;
      return home;
    },
    async rateOn(_org, currency, onOrBefore) {
      reads.rate += 1;
      const hit = (rates[currency] ?? [])
        .filter(([d]) => d <= onOrBefore)
        .sort(([a], [b]) => (a < b ? 1 : -1))[0];
      return hit ? { rate: hit[1], effectiveDate: hit[0] } : undefined;
    },
  };
  return { s, reads };
}

const write = { object: 'fx_invoice', operation: 'insert' as const, organizationId: 'org_a' };

describe('the exact decimal arithmetic', () => {
  it('reads a number by its shortest spelling and a string as written, exponents included', () => {
    expect(toScaledDecimal(0.1389)).toEqual({ digits: 1389n, scale: 4 });
    expect(toScaledDecimal('7.123456789012')).toEqual({ digits: 7123456789012n, scale: 12 });
    expect(toScaledDecimal(-12.5)).toEqual({ digits: -125n, scale: 1 });
    expect(toScaledDecimal(1e21)).toEqual({ digits: 10n ** 21n, scale: 0 });
    expect(toScaledDecimal(1e-7)).toEqual({ digits: 1n, scale: 7 });
    expect(toScaledDecimal('.5')).toEqual({ digits: 5n, scale: 1 });
    for (const bad of ['', '.', 'abc', '1,000', NaN, Infinity, null, undefined, {}]) {
      expect(toScaledDecimal(bad), String(bad)).toBeUndefined();
    }
  });

  it('divides by the rate (parameter 3) and rounds once, half away from zero', () => {
    const div = (a: number | string, r: number | string, places: number) =>
      formatScaledDecimal(divideToPlaces(toScaledDecimal(a)!, toScaledDecimal(r)!, places));
    // The card's two-minute check: USD 10,000 at 0.1389 is ¥71,994.24 (71994.2404…).
    expect(div(10000, 0.1389, 2)).toBe('71994.24');
    // Exactly half rounds away from zero, on both signs.
    expect(div('0.125', 1, 2)).toBe('0.13');
    expect(div('-0.125', 1, 2)).toBe('-0.13');
    expect(div('0.124999', 1, 2)).toBe('0.12');
    // A float division would answer 0.30000000000000004 for 0.1 + 0.2 style inputs; exact here.
    expect(div('0.3', '0.1', 2)).toBe('3.00');
    // Three minor-unit classes: JPY 0, USD 2, KWD 3.
    expect(div(100, 0.0065, 0)).toBe('15385'); // 15384.615…
    expect(div(100, 1.0857, 2)).toBe('92.11'); // 92.106…
    expect(div(100, 3.2468, 3)).toBe('30.800'); // 30.79955…
  });
});

describe('the document date', () => {
  it('a date is its own day; a datetime instant is its UTC day', () => {
    expect(documentDateOf('2026-03-15')).toBe('2026-03-15');
    expect(documentDateOf('2026-03-31T23:30:00-05:00')).toBe('2026-04-01');
    expect(documentDateOf('2026-03-31T23:30:00Z')).toBe('2026-03-31');
    expect(documentDateOf(new Date('2026-03-15T08:00:00Z'))).toBe('2026-03-15');
    expect(documentDateOf('not a date')).toBeUndefined();
    expect(documentDateOf(20260315)).toBeUndefined();
  });
});

describe('the plan', () => {
  it('reads only a record-mode amount declaring homeAmount', () => {
    expect(PLAN).toEqual([{
      amountField: 'amount', codeField: 'currency_code', homeField: 'amount_home', rateDateField: 'invoice_date', rateField: 'amount_rate',
    }]);
    expect(planHomeAmounts({ fields: { a: { type: 'currency' } } })).toEqual([]);
    expect(planHomeAmounts(undefined)).toEqual([]);
  });

  it('an update projects only when it carries an input or a projected field', () => {
    for (const key of ['amount', 'currency_code', 'invoice_date', 'amount_home', 'amount_rate']) {
      expect(homeAmountsTouched(PLAN, { [key]: 1 }), key).toEqual(PLAN);
    }
    expect(homeAmountsTouched(PLAN, { plain: 1, name: 'x' })).toEqual([]);
  });
});

describe('one projection', () => {
  it('a foreign amount is divided by the rate in force on the document date, and the rate is stored as read', async () => {
    const { s } = serving('CNY', { USD: [['2026-01-01', 0.1389]] });
    const out = await projectHomeAmounts(PLAN, { amount: 10000, currency_code: 'USD', invoice_date: '2026-03-15' }, s, write);
    expect(out).toEqual({ amount_home: 71994.24, amount_rate: 0.1389 });
  });

  it('the rate row is the latest one on or before the document date — never a later one', async () => {
    const { s } = serving('USD', { EUR: [['2026-01-01', 0.8], ['2026-03-15', 0.9], ['2026-03-16', 0.5]] });
    const at = (invoice_date: string) => projectHomeAmounts(PLAN, { amount: 90, currency_code: 'EUR', invoice_date }, s, write);
    expect(await at('2026-03-15')).toEqual({ amount_home: 100, amount_rate: 0.9 }); // on the date
    expect(await at('2026-03-14')).toEqual({ amount_home: 112.5, amount_rate: 0.8 }); // the earlier row
    expect(await at('2026-03-16')).toEqual({ amount_home: 180, amount_rate: 0.5 });
  });

  it('a date before every rate row refuses ERR_EXCHANGE_RATE_MISSING, naming the currency and the date', async () => {
    const { s } = serving('USD', { EUR: [['2026-03-16', 0.9]] });
    const err = await projectHomeAmounts(PLAN, { amount: 90, currency_code: 'EUR', invoice_date: '2026-03-15' }, s, write)
      .then(() => null, (e) => e);
    expect(err).toBeInstanceOf(ExchangeRateMissingError);
    expect({ code: err.code, status: err.status, field: err.field, currency: err.currency, date: err.date, homeCurrency: err.homeCurrency })
      .toEqual({ code: 'ERR_EXCHANGE_RATE_MISSING', status: 400, field: 'amount', currency: 'EUR', date: '2026-03-15', homeCurrency: 'USD' });
    expect(err.message).toContain('no exchange rate for EUR has an effective date on or before 2026-03-15');
    expect(err.message).not.toMatch(/#\d/);
  });

  it('a stored rate that is not a positive number counts as missing', async () => {
    for (const rate of [0, -1, null, 'abc']) {
      const { s } = serving('USD', { EUR: [['2026-01-01', rate]] });
      await expect(projectHomeAmounts(PLAN, { amount: 1, currency_code: 'EUR', invoice_date: '2026-03-15' }, s, write), String(rate))
        .rejects.toBeInstanceOf(ExchangeRateMissingError);
    }
  });

  it('the same currency as home converts at 1, with no rate read, rounded to the home minor units', async () => {
    const { s, reads } = serving('USD');
    expect(await projectHomeAmounts(PLAN, { amount: 10.005, currency_code: 'USD' }, s, write))
      .toEqual({ amount_home: 10.01, amount_rate: 1 });
    expect(reads.rate).toBe(0);
  });

  it('three minor-unit classes: JPY 0, CNY 2, KWD 3', async () => {
    const rates = { EUR: [['2026-01-01', 0.0065], ['2026-01-02', 0.1289], ['2026-01-03', 3.0103]] as Array<[string, unknown]> };
    const at = async (home: string, date: string) =>
      projectHomeAmounts(PLAN, { amount: 100, currency_code: 'EUR', invoice_date: date }, serving(home, rates).s, write);
    expect(await at('JPY', '2026-01-01')).toEqual({ amount_home: 15385, amount_rate: 0.0065 }); // 15384.615…
    expect(await at('CNY', '2026-01-02')).toEqual({ amount_home: 775.8, amount_rate: 0.1289 }); // 775.79519…
    expect(await at('KWD', '2026-01-03')).toEqual({ amount_home: 33.219, amount_rate: 3.0103 }); // 33.2192…
  });

  it('a blank amount stores a blank home amount and rate, and reads nothing', async () => {
    const { s, reads } = serving(undefined);
    expect(await projectHomeAmounts(PLAN, { amount: null, currency_code: 'EUR' }, s, write))
      .toEqual({ amount_home: null, amount_rate: null });
    expect(reads).toEqual({ home: 0, rate: 0 });
  });

  it('no home currency refuses ERR_HOME_CURRENCY_UNSET, naming the setting — never a default', async () => {
    for (const home of [undefined, '', 'XX']) {
      const err = await projectHomeAmounts(PLAN, { amount: 1, currency_code: 'EUR', invoice_date: '2026-01-01' }, serving(home).s, write)
        .then(() => null, (e) => e);
      expect(err, String(home)).toBeInstanceOf(HomeCurrencyUnsetError);
      expect({ code: err.code, status: err.status, field: err.field, setting: err.setting })
        .toEqual({ code: 'ERR_HOME_CURRENCY_UNSET', status: 400, field: 'amount', setting: 'localization.currency' });
      expect(err.message).toContain('localization.currency');
    }
  });

  it('a foreign amount with a blank document date is a required-field refusal on the date', async () => {
    const err = await projectHomeAmounts(PLAN, { amount: 1, currency_code: 'EUR' }, serving('USD').s, write).then(() => null, (e) => e);
    expect(err).toBeInstanceOf(ValidationError);
    expect(err.fields.map((f: { field: string; code: string }) => ({ field: f.field, code: f.code })))
      .toEqual([{ field: 'invoice_date', code: 'required' }]);
  });

  it('leaves the entry to the check that refuses its input: blank or non-ISO code, unparsable amount or date', async () => {
    const { s, reads } = serving('USD');
    for (const image of [
      { amount: 1, currency_code: '' },
      { amount: 1, currency_code: 'usd' },
      { amount: 1, currency_code: 'ZZZ' },
      { amount: 'lots', currency_code: 'EUR', invoice_date: '2026-01-01' },
      { amount: 1, currency_code: 'EUR', invoice_date: 'someday' },
    ]) {
      expect(await projectHomeAmounts(PLAN, image, s, write), JSON.stringify(image)).toEqual({});
    }
    expect(reads.rate).toBe(0);
  });

  it('a memoized serving reads each home currency and each (currency, date) rate once', async () => {
    const { s, reads } = serving('USD', { EUR: [['2026-01-01', 0.9]] });
    const m = memoizeHomeAmountServing(s);
    for (let i = 0; i < 5; i++) {
      await projectHomeAmounts(PLAN, { amount: i + 1, currency_code: 'EUR', invoice_date: '2026-02-01' }, m, write);
    }
    expect(reads).toEqual({ home: 1, rate: 1 });
  });
});

describe('the predicate update settlement', () => {
  it('keeps a projected value that is the same on every matched row, and drops a caller value either way', () => {
    expect(settleBulkHomeAmounts(PLAN, { currency_code: 'USD', amount_home: 5 }, [
      { amount_home: 10, amount_rate: 1 }, { amount_home: 10, amount_rate: 1 },
    ], 'fx_invoice')).toEqual({ currency_code: 'USD', amount_home: 10, amount_rate: 1 });
    expect(settleBulkHomeAmounts(PLAN, { amount_home: 5 }, [], 'fx_invoice')).toEqual({});
  });

  it('refuses a patch that converts to different values on different rows', () => {
    const err = (() => {
      try {
        settleBulkHomeAmounts(PLAN, { currency_code: 'USD' }, [
          { amount_home: 10, amount_rate: 1 }, { amount_home: 20, amount_rate: 1 },
        ], 'fx_invoice');
      } catch (e) {
        return e as ValidationError;
      }
      return null;
    })();
    expect(err).toBeInstanceOf(ValidationError);
    expect(err!.fields.map((f) => ({ field: f.field, code: f.code }))).toEqual([{ field: 'amount_home', code: 'invalid_value' }]);
    expect(err!.message).toContain('update those rows by id');
  });
});
