// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0144 D5] `currencyConfig.homeAmount: { field, rateDate, rateField }` —
 * a `record`-mode amount declares, by pointer, where the engine stores it
 * converted into the home currency, which date picks the rate, and where the
 * rate used is stored.
 *
 * Two doors, as for `currencyField`: `CurrencyConfigSchema` refuses what one
 * config can see (`homeAmount` outside `record`, a missing, empty or unknown
 * pointer), and the object's `superRefine` refuses what the pointers name.
 * The home and rate fields are platform-written, marked with the existing
 * `readonly: true`.
 */

import { describe, it, expect } from 'vitest';

import { CurrencyConfigSchema } from './field.zod';
import { ObjectSchema } from './object.zod';

const HOME = { field: 'amount_home', rateDate: 'invoice_date', rateField: 'amount_rate' } as const;
const RECORD = { currencyMode: 'record', currencyField: 'currency_code', homeAmount: HOME } as const;

/** The fields every accepted invoice carries; a case overrides one of them. */
const BASE_FIELDS = {
  currency_code: { type: 'text', label: 'Currency', valueDomain: 'iso_4217_currency' },
  invoice_date: { type: 'date', label: 'Invoice date' },
  amount: { type: 'currency', label: 'Amount', currencyConfig: RECORD },
  amount_home: { type: 'currency', label: 'Amount (home)', readonly: true },
  amount_rate: { type: 'number', label: 'Rate used', readonly: true },
} as const;

function invoice(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const fields: Record<string, unknown> = { ...BASE_FIELDS, ...overrides };
  for (const [k, v] of Object.entries(fields)) if (v === undefined) delete fields[k];
  return { name: 'invoice', label: 'Invoice', fields };
}

/** The issues of a refused object parse, reduced to what an author is shown. */
function objectIssues(input: unknown): Array<{ code: string; path: string; message: string }> {
  const r = ObjectSchema.safeParse(input);
  if (r.success) return [];
  return r.error.issues.map((i) => ({ code: i.code, path: i.path.join('.'), message: i.message }));
}

const AT = 'fields.amount.currencyConfig.homeAmount';

describe('`CurrencyConfigSchema`: `homeAmount` under `record` only, three required pointers', () => {
  it('accepts a `record` config with all three pointers, keeping them in the parse output', () => {
    const r = CurrencyConfigSchema.safeParse(RECORD);
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.data.homeAmount).toEqual(HOME);
    expect(CurrencyConfigSchema.parse(r.data)).toEqual(r.data);
  });

  it('a `record` config without `homeAmount` parses as before, with no key added', () => {
    const r = CurrencyConfigSchema.parse({ currencyMode: 'record', currencyField: 'currency_code' });
    expect(JSON.stringify(r)).toBe('{"currencyMode":"record","currencyField":"currency_code"}');
  });

  it.each([
    ['fixed', { currencyMode: 'fixed', defaultCurrency: 'USD' }],
    ['dynamic', { currencyMode: 'dynamic' }],
    ['dynamic (defaulted)', {}],
  ] as const)('refuses `homeAmount` under `%s`, at the key, with the remedy', (_mode, config) => {
    const r = CurrencyConfigSchema.safeParse({ ...config, homeAmount: HOME });
    expect(r.success).toBe(false);
    if (r.success) return;
    expect(r.error.issues).toHaveLength(1);
    expect(r.error.issues[0]!.code).toBe('custom');
    expect(r.error.issues[0]!.path).toEqual(['homeAmount']);
    expect(r.error.issues[0]!.message).toMatch(/^`homeAmount` is read only under `currencyMode: 'record'`/);
  });

  it.each(['field', 'rateDate', 'rateField'] as const)('refuses a `homeAmount` without `%s` (every pointer is required)', (key) => {
    const { [key]: _dropped, ...rest } = HOME;
    const r = CurrencyConfigSchema.safeParse({ ...RECORD, homeAmount: rest });
    expect(r.success).toBe(false);
    if (r.success) return;
    expect(r.error.issues.map((i) => i.path.join('.'))).toEqual([`homeAmount.${key}`]);
    expect(r.error.issues[0]!.code).toBe('invalid_type');
    expect(r.error.issues[0]!.message).toMatch(new RegExp(`^\`homeAmount\` needs \`${key}\`, the name of `));
  });

  it.each(['field', 'rateDate', 'rateField'] as const)('refuses an empty `homeAmount.%s`, at the pointer', (key) => {
    const r = CurrencyConfigSchema.safeParse({ ...RECORD, homeAmount: { ...HOME, [key]: '' } });
    expect(r.success).toBe(false);
    if (r.success) return;
    expect(r.error.issues.map((i) => i.path.join('.'))).toEqual([`homeAmount.${key}`]);
    expect(r.error.issues[0]!.message).toMatch(new RegExp(`^\`homeAmount\\.${key}\` names a field: an empty name points at nothing`));
  });

  it('refuses an unknown key inside `homeAmount`, steering a near-miss to the declared pointer', () => {
    const r = CurrencyConfigSchema.safeParse({ ...RECORD, homeAmount: { field: 'amount_home', rateDate: 'invoice_date', rate: 'amount_rate' } });
    expect(r.success).toBe(false);
    if (r.success) return;
    const paths = r.error.issues.map((i) => i.path.join('.'));
    expect(paths).toContain('homeAmount.rateField');
    const unknown = r.error.issues.find((i) => i.code === 'unrecognized_keys');
    expect(unknown?.message).toContain('rateField');
  });
});

describe('the object judges what `homeAmount` names', () => {
  it('accepts the honest shape: a readonly `dynamic` home field, a date, a readonly number rate field', () => {
    expect(objectIssues(invoice())).toEqual([]);
    // A `datetime` document date and a home field with an explicit `dynamic` config are honest too.
    expect(objectIssues(invoice({
      invoice_date: { type: 'datetime', label: 'Issued at' },
      amount_home: { type: 'currency', label: 'Amount (home)', readonly: true, currencyConfig: { currencyMode: 'dynamic' } },
    }))).toEqual([]);
    const once = ObjectSchema.parse(invoice());
    expect(ObjectSchema.parse(once)).toEqual(once);
  });

  it('two amounts with the same code field and document date may share one rate field', () => {
    expect(objectIssues(invoice({
      tax: { type: 'currency', label: 'Tax', currencyConfig: { ...RECORD, homeAmount: { ...HOME, field: 'tax_home' } } },
      tax_home: { type: 'currency', label: 'Tax (home)', readonly: true },
    }))).toEqual([]);
  });

  describe('`homeAmount.field`', () => {
    it('refuses a pointer into nothing, naming the candidates', () => {
      const issues = objectIssues(invoice({
        amount: { type: 'currency', label: 'Amount', currencyConfig: { ...RECORD, homeAmount: { ...HOME, field: 'home' } } },
      }));
      expect(issues).toHaveLength(1);
      expect(issues[0]!.code).toBe('custom');
      expect(issues[0]!.path).toBe(`${AT}.field`);
      expect(issues[0]!.message).toMatch(/^`amount\.currencyConfig\.homeAmount\.field` names `home`, but object `invoice` declares no other field `home`/);
      expect(issues[0]!.message).toContain('candidates: `amount_home`');
    });

    it('refuses a pointer at the amount itself', () => {
      const issues = objectIssues(invoice({
        amount: { type: 'currency', label: 'Amount', currencyConfig: { ...RECORD, homeAmount: { ...HOME, field: 'amount' } } },
      }));
      expect(issues.map((i) => i.path)).toEqual([`${AT}.field`]);
      expect(issues[0]!.message).toContain('declares no other field `amount`');
    });

    it('refuses a pointer at a field that is not `currency` (a `number`, a currency `formula`)', () => {
      for (const home of [
        { type: 'number', label: 'Amount (home)', readonly: true },
        { type: 'formula', label: 'Amount (home)', expression: 'record.amount', returnType: 'currency' },
      ]) {
        const issues = objectIssues(invoice({ amount_home: home }));
        expect(issues.map((i) => i.path), home.type).toEqual([`${AT}.field`]);
        expect(issues[0]!.message).toMatch(new RegExp(`^\`amount\\.currencyConfig\\.homeAmount\\.field\` names \`amount_home\`, a \`${home.type}\` field`));
      }
    });

    it.each([
      ['fixed', { currencyMode: 'fixed', defaultCurrency: 'CNY' }],
      ['record', { currencyMode: 'record', currencyField: 'currency_code' }],
    ] as const)('refuses a `%s`-mode home field: metadata never names the home currency', (mode, currencyConfig) => {
      const issues = objectIssues(invoice({ amount_home: { type: 'currency', label: 'Amount (home)', readonly: true, currencyConfig } }));
      expect(issues.map((i) => i.path)).toEqual([`${AT}.field`]);
      expect(issues[0]!.message).toMatch(new RegExp(`^\`amount\\.currencyConfig\\.homeAmount\\.field\` names \`amount_home\`, a \`${mode}\`-mode currency field`));
    });

    it('refuses a home field another amount already stores into', () => {
      const issues = objectIssues(invoice({
        tax: { type: 'currency', label: 'Tax', currencyConfig: RECORD },
      }));
      expect(issues.map((i) => i.path)).toEqual(['fields.tax.currencyConfig.homeAmount.field']);
      expect(issues[0]!.message).toContain('already the home field of `amount`');
    });
  });

  describe('`homeAmount.rateDate`', () => {
    it('refuses a pointer into nothing, naming the date candidates', () => {
      const issues = objectIssues(invoice({
        amount: { type: 'currency', label: 'Amount', currencyConfig: { ...RECORD, homeAmount: { ...HOME, rateDate: 'doc_date' } } },
      }));
      expect(issues).toHaveLength(1);
      expect(issues[0]!.code).toBe('custom');
      expect(issues[0]!.path).toBe(`${AT}.rateDate`);
      expect(issues[0]!.message).toMatch(/^`amount\.currencyConfig\.homeAmount\.rateDate` names `doc_date`, but object `invoice` declares no field `doc_date`/);
      expect(issues[0]!.message).toContain('candidates: `invoice_date`');
    });

    it('refuses a pointer at a field that is not `date` / `datetime`, and says nothing defaults to `created_at`', () => {
      const issues = objectIssues(invoice({ invoice_date: { type: 'text', label: 'Invoice date' } }));
      expect(issues.map((i) => i.path)).toEqual([`${AT}.rateDate`]);
      expect(issues[0]!.message).toMatch(/^`amount\.currencyConfig\.homeAmount\.rateDate` names `invoice_date`, a `text` field/);
      expect(issues[0]!.message).toContain('nothing defaults to `created_at`');
    });
  });

  describe('`homeAmount.rateField`', () => {
    it('refuses a pointer into nothing', () => {
      const issues = objectIssues(invoice({ amount_rate: undefined }));
      expect(issues).toHaveLength(1);
      expect(issues[0]!.code).toBe('custom');
      expect(issues[0]!.path).toBe(`${AT}.rateField`);
      expect(issues[0]!.message).toMatch(/^`amount\.currencyConfig\.homeAmount\.rateField` names `amount_rate`, but object `invoice` declares no field `amount_rate`/);
      expect(issues[0]!.message).toContain('the object has none');
    });

    it('refuses a pointer at a field that is not `number`', () => {
      const issues = objectIssues(invoice({ amount_rate: { type: 'currency', label: 'Rate used', readonly: true } }));
      expect(issues.map((i) => i.path)).toEqual([`${AT}.rateField`]);
      expect(issues[0]!.message).toMatch(/^`amount\.currencyConfig\.homeAmount\.rateField` names `amount_rate`, a `currency` field/);
    });

    it('refuses a rate field shared with an amount that names another document date', () => {
      const issues = objectIssues(invoice({
        due_date: { type: 'date', label: 'Due date' },
        tax: { type: 'currency', label: 'Tax', currencyConfig: { ...RECORD, homeAmount: { ...HOME, field: 'tax_home', rateDate: 'due_date' } } },
        tax_home: { type: 'currency', label: 'Tax (home)', readonly: true },
      }));
      expect(issues.map((i) => i.path)).toEqual(['fields.tax.currencyConfig.homeAmount.rateField']);
      expect(issues[0]!.message).toContain('already stores the rate of `amount`');
    });
  });

  describe('the home and rate fields are platform-written (`readonly: true`, no `expression`)', () => {
    it.each(['amount_home', 'amount_rate'] as const)('refuses `%s` without `readonly: true`', (name) => {
      const issues = objectIssues(invoice({ [name]: { ...BASE_FIELDS[name], readonly: false } }));
      const key = name === 'amount_home' ? 'field' : 'rateField';
      expect(issues.map((i) => i.path)).toEqual([`${AT}.${key}`]);
      expect(issues[0]!.code).toBe('custom');
      expect(issues[0]!.message).toContain('does not declare `readonly: true`');
      expect(issues[0]!.message).toContain(`Add \`readonly: true\` to \`${name}\``);
    });

    it.each(['amount_home', 'amount_rate'] as const)('refuses `%s` declaring an `expression`', (name) => {
      const issues = objectIssues(invoice({ [name]: { ...BASE_FIELDS[name], expression: 'record.amount' } }));
      const key = name === 'amount_home' ? 'field' : 'rateField';
      expect(issues.map((i) => i.path)).toEqual([`${AT}.${key}`]);
      expect(issues[0]!.message).toContain('declares an `expression`');
    });
  });

  it('refuses `homeAmount` on a `formula` amount, at `homeAmount`, judging no pointer', () => {
    const issues = objectIssues(invoice({
      amount: { type: 'formula', label: 'Net', expression: 'record.gross * 0.9', returnType: 'currency', currencyConfig: RECORD },
      gross: { type: 'currency', label: 'Gross' },
      amount_rate: undefined,
    }));
    expect(issues.map((i) => i.path)).toEqual([AT]);
    expect(issues[0]!.code).toBe('custom');
    expect(issues[0]!.message).toMatch(/^`amount\.currencyConfig\.homeAmount` is declared on a `formula` field of object `invoice`, which computes its value on read/);
  });
});
