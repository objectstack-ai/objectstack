// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0144 D2] `currencyMode: 'record'` + `currencyField` — a record-mode
 * amount points at a sibling ISO 4217 code field on the same object.
 *
 * Two doors, one per half: `CurrencyConfigSchema` refuses the half one config
 * can see (`record` without a pointer, a pointer under another mode), and the
 * object's `superRefine` refuses what the pointer names (nothing, a non-text
 * field, a text field with no ISO 4217 value domain). A `formula` declaring
 * `returnType: 'currency'` carries the same config, so it meets both doors.
 * `dynamic` and `fixed` parse exactly as they did before `record` existed.
 */

import { describe, it, expect } from 'vitest';

import { CurrencyConfigSchema, FieldSchema } from './field.zod';
import { ObjectSchema } from './object.zod';

const CODE_FIELD = { type: 'text', label: 'Currency', valueDomain: 'iso_4217_currency' } as const;
const RECORD = { currencyMode: 'record', currencyField: 'currency_code' } as const;

function invoice(fields: Record<string, unknown>): Record<string, unknown> {
  return { name: 'invoice', label: 'Invoice', fields };
}

/** The issues of a refused object parse, reduced to what an author is shown. */
function objectIssues(input: unknown): Array<{ code: string; path: PropertyKey[]; message: string }> {
  const r = ObjectSchema.safeParse(input);
  if (r.success) return [];
  return r.error.issues.map((i) => ({ code: i.code, path: i.path, message: i.message }));
}

describe('`CurrencyConfigSchema`: `record` ⇔ `currencyField`', () => {
  it('a `record` config with a pointer parses, keeping the mode and the pointer', () => {
    const r = CurrencyConfigSchema.safeParse(RECORD);
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.data.currencyMode).toBe('record');
    expect(r.data.currencyField).toBe('currency_code');
  });

  it('refuses `record` without `currencyField`, at the key, with the prescription', () => {
    const r = CurrencyConfigSchema.safeParse({ currencyMode: 'record' });
    expect(r.success).toBe(false);
    if (r.success) return;
    expect(r.error.issues).toHaveLength(1);
    expect(r.error.issues[0]!.code).toBe('custom');
    expect(r.error.issues[0]!.path).toEqual(['currencyField']);
    expect(r.error.issues[0]!.message).toMatch(/^`currencyMode: 'record'` needs `currencyField`/);
  });

  it.each(['dynamic', 'fixed'] as const)('refuses `currencyField` under `%s`, at the key', (mode) => {
    const r = CurrencyConfigSchema.safeParse({ currencyMode: mode, defaultCurrency: 'USD', currencyField: 'currency_code' });
    expect(r.success).toBe(false);
    if (r.success) return;
    expect(r.error.issues).toHaveLength(1);
    expect(r.error.issues[0]!.path).toEqual(['currencyField']);
    expect(r.error.issues[0]!.message).toMatch(/^`currencyField` is read only under `currencyMode: 'record'`/);
  });

  it('refuses `currencyField` under the defaulted mode (no `currencyMode` written ⇒ dynamic)', () => {
    expect(CurrencyConfigSchema.safeParse({ currencyField: 'currency_code' }).success).toBe(false);
  });

  it('`dynamic` and `fixed` outputs are byte-identical to before `record` existed', () => {
    const cases: Array<[unknown, string]> = [
      [{}, '{"currencyMode":"dynamic"}'],
      [{ currencyMode: 'dynamic' }, '{"currencyMode":"dynamic"}'],
      [{ currencyMode: 'dynamic', defaultCurrency: 'EUR' }, '{"currencyMode":"dynamic","defaultCurrency":"EUR"}'],
      [{ currencyMode: 'fixed', defaultCurrency: 'USD' }, '{"currencyMode":"fixed","defaultCurrency":"USD"}'],
    ];
    for (const [input, before] of cases) {
      expect(JSON.stringify(CurrencyConfigSchema.parse(input))).toBe(before);
    }
  });

  it('parse is idempotent: `parse(parse(x))` equals `parse(x)` in every mode', () => {
    for (const input of [{}, { currencyMode: 'fixed', defaultCurrency: 'USD' }, RECORD]) {
      const once = CurrencyConfigSchema.parse(input);
      expect(CurrencyConfigSchema.parse(once)).toEqual(once);
    }
    const object = invoice({ currency_code: CODE_FIELD, amount: { type: 'currency', label: 'Amount', currencyConfig: RECORD } });
    const once = ObjectSchema.parse(object);
    expect(ObjectSchema.parse(once)).toEqual(once);
  });
});

describe('the object judges what `currencyField` names', () => {
  it('accepts a pointer at a declared `text` field with `valueDomain: iso_4217_currency`', () => {
    const object = invoice({ currency_code: CODE_FIELD, amount: { type: 'currency', label: 'Amount', currencyConfig: RECORD } });
    expect(objectIssues(object)).toEqual([]);
  });

  it('refuses a pointer into nothing, naming the candidates', () => {
    const issues = objectIssues(invoice({
      doc_currency: CODE_FIELD,
      amount: { type: 'currency', label: 'Amount', currencyConfig: RECORD },
    }));
    expect(issues).toHaveLength(1);
    expect(issues[0]!.code).toBe('custom');
    expect(issues[0]!.path).toEqual(['fields', 'amount', 'currencyConfig', 'currencyField']);
    expect(issues[0]!.message).toMatch(/^`amount\.currencyConfig\.currencyField` names `currency_code`, but object `invoice` declares no other field/);
    expect(issues[0]!.message).toContain('candidates: `doc_currency`');
  });

  it('refuses a pointer at the amount itself', () => {
    const issues = objectIssues(invoice({
      currency_code: { type: 'currency', label: 'Amount', currencyConfig: RECORD },
    }));
    expect(issues.map((i) => i.path)).toEqual([['fields', 'currency_code', 'currencyConfig', 'currencyField']]);
    expect(issues[0]!.message).toContain('the object has none; declare one');
  });

  it('refuses a pointer at a field that is not `text`', () => {
    const issues = objectIssues(invoice({
      currency_code: { type: 'number', label: 'Currency' },
      amount: { type: 'currency', label: 'Amount', currencyConfig: RECORD },
    }));
    expect(issues).toHaveLength(1);
    expect(issues[0]!.path).toEqual(['fields', 'amount', 'currencyConfig', 'currencyField']);
    expect(issues[0]!.message).toMatch(/^`amount\.currencyConfig\.currencyField` names `currency_code`, a `number` field/);
  });

  it('refuses a pointer at a `text` field without the ISO 4217 value domain', () => {
    const issues = objectIssues(invoice({
      currency_code: { type: 'text', label: 'Currency' },
      amount: { type: 'currency', label: 'Amount', currencyConfig: RECORD },
    }));
    expect(issues).toHaveLength(1);
    expect(issues[0]!.path).toEqual(['fields', 'amount', 'currencyConfig', 'currencyField']);
    expect(issues[0]!.message).toMatch(/^`amount\.currencyConfig\.currencyField` names `currency_code`, a `text` field .* does not declare `valueDomain: 'iso_4217_currency'`/);
  });

  it('a `formula` with `returnType: currency` meets the same doors in the same shape', () => {
    const formula = (currencyConfig: unknown) => ({
      type: 'formula', label: 'Net', expression: 'record.amount * 0.9', returnType: 'currency', currencyConfig,
    });
    expect(FieldSchema.safeParse({ name: 'net', ...formula(RECORD) }).success).toBe(true);
    expect(FieldSchema.safeParse({ name: 'net', ...formula({ currencyMode: 'record' }) }).success).toBe(false);
    const ok = invoice({ currency_code: CODE_FIELD, net: formula(RECORD) });
    expect(objectIssues(ok)).toEqual([]);
    const bad = invoice({ currency_code: { type: 'text', label: 'Currency' }, net: formula(RECORD) });
    expect(objectIssues(bad).map((i) => i.path)).toEqual([['fields', 'net', 'currencyConfig', 'currencyField']]);
  });
});
