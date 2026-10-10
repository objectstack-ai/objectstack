// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #22727 — a formula field declares a currency result.
 *
 * `FieldSchema.returnType` gains `currency`. The currency is the formula's OWN
 * `currencyConfig`: the same `CurrencyConfigSchema` a `currency` field carries,
 * with the same defaults (absent ⇒ `dynamic`, the tenant default currency) and
 * the same refusals. One shape, never a second one — so the assertions below
 * compare a currency formula against a currency field rather than restating
 * what the config accepts.
 *
 * "Taken from the source field" is an AUTHORING act, not a read-time fallback:
 * `@objectstack/formula`'s `inferFormulaReturn` proves a result is money and
 * answers the source field's currency for the stamp to copy. That producer's
 * pins live in its own package; this file pins the declaration it writes.
 */

import { describe, it, expect } from 'vitest';

import { FieldSchema } from './field.zod';
import { ObjectSchema } from './object.zod';

const FIXED_USD = { currencyMode: 'fixed', defaultCurrency: 'USD' } as const;

function currencyFormula(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    name: 'weighted_amount',
    label: 'Weighted Amount',
    type: 'formula',
    expression: 'record.amount * record.probability / 100',
    returnType: 'currency',
    ...extra,
  };
}

function currencyField(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { name: 'amount', label: 'Amount', type: 'currency', ...extra };
}

/** The issues of a refused parse, reduced to what an author is shown. */
function issuesOf(input: unknown): Array<{ code: string; path: PropertyKey[]; message: string }> {
  const r = FieldSchema.safeParse(input);
  if (r.success) return [];
  return r.error.issues.map((i) => ({ code: i.code, path: i.path, message: i.message }));
}

describe('a formula declares a currency result', () => {
  it('`returnType: currency` parses, and without a `currencyConfig` it declares none (dynamic)', () => {
    const r = FieldSchema.safeParse(currencyFormula());
    expect(r.success, JSON.stringify(issuesOf(currencyFormula()))).toBe(true);
    if (!r.success) return;
    expect(r.data.returnType).toBe('currency');
    // Absent stays absent — exactly as on a currency field with no config.
    expect(r.data.currencyConfig).toBeUndefined();
    expect(FieldSchema.parse(currencyField()).currencyConfig).toBeUndefined();
  });

  it('carries its currency in its own `currencyConfig`, parsed exactly as a currency field\'s', () => {
    for (const config of [FIXED_USD, { currencyMode: 'dynamic' }, { currencyMode: 'fixed' }, {}]) {
      const asFormula = FieldSchema.parse(currencyFormula({ currencyConfig: config }));
      const asField = FieldSchema.parse(currencyField({ currencyConfig: config }));
      expect(asFormula.currencyConfig, JSON.stringify(config)).toEqual(asField.currencyConfig);
    }
    expect(FieldSchema.parse(currencyFormula({ currencyConfig: FIXED_USD })).currencyConfig)
      .toEqual({ currencyMode: 'fixed', defaultCurrency: 'USD' });
  });

  it('refuses a malformed currency the way a currency field refuses it — same code, path and words', () => {
    const malformed = [
      { currencyMode: 'fixed', defaultCurrency: 'US' },
      { currencyMode: 'per_record' },
      // The removed decimal-places key keeps its tombstone answer on a formula too.
      { ...FIXED_USD, precision: 2 },
    ];
    for (const config of malformed) {
      const onFormula = issuesOf(currencyFormula({ currencyConfig: config }));
      const onField = issuesOf(currencyField({ currencyConfig: config }));
      expect(onFormula.length, JSON.stringify(config)).toBeGreaterThan(0);
      expect(onFormula, JSON.stringify(config)).toEqual(onField);
    }
  });

  it('a formula over a currency field declares the currency result inside a legal object', () => {
    const r = ObjectSchema.safeParse({
      name: 'opportunity',
      label: 'Opportunity',
      fields: {
        amount: currencyField({ currencyConfig: FIXED_USD }),
        probability: { name: 'probability', label: 'Probability', type: 'percent' },
        weighted_amount: currencyFormula({ currencyConfig: FIXED_USD }),
      },
    });
    expect(r.success, r.success ? '' : JSON.stringify(r.error.issues)).toBe(true);
  });
});

describe('CONTROL — a numeric formula stays `number`', () => {
  it('`returnType: number` parses unchanged, and carries no currency', () => {
    const input = { ...currencyFormula(), name: 'gross_margin', returnType: 'number', expression: 'record.margin * 100' };
    const r = FieldSchema.safeParse(input);
    expect(r.success, JSON.stringify(issuesOf(input))).toBe(true);
    if (!r.success) return;
    expect(r.data.returnType).toBe('number');
    expect(r.data.currencyConfig).toBeUndefined();
  });

  it('the widening adds exactly `currency` — the four earlier members are still declared', () => {
    const members = (FieldSchema.shape.returnType.unwrap().options as readonly string[]).slice().sort();
    expect(members).toEqual(['boolean', 'currency', 'date', 'number', 'text']);
  });
});
