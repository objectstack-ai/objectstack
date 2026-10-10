// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #22727 — `inferFormulaReturn`, the declaration authoring stamps onto a
 * formula field. The card's two pins are the first two describes:
 *
 *  - a formula over a currency field declares the currency result;
 *  - CONTROL: a numeric formula stays `number`.
 *
 * Everything this function cannot prove to be money must answer exactly what
 * `inferExpressionType` answered before it existed, so the control is asserted
 * against that function directly rather than against remembered literals.
 */

import { describe, it, expect } from 'vitest';
import { FieldSchema } from '@objectstack/spec/data';

import { inferFormulaReturn, type FormulaSourceField } from './formula-return';
import { inferExpressionType } from './validate';

const USD = { currencyMode: 'fixed', defaultCurrency: 'USD' } as const;
const EUR = { currencyMode: 'fixed', defaultCurrency: 'EUR' } as const;

/** A host object's declared field map, as `ObjectSchema.fields` carries it. */
const FIELDS: Readonly<Record<string, FormulaSourceField>> = {
  amount: { type: 'currency', currencyConfig: USD },
  tax: { type: 'currency', currencyConfig: USD },
  fee_eur: { type: 'currency', currencyConfig: EUR },
  budget: { type: 'currency' },
  spent: { type: 'currency', currencyConfig: { currencyMode: 'dynamic' } },
  probability: { type: 'percent' },
  quantity: { type: 'number' },
  discount_rate: { type: 'number' },
  flag: { type: 'boolean' },
  name: { type: 'text' },
  start_date: { type: 'date' },
  rollup: { type: 'summary' },
  weighted: { type: 'formula', returnType: 'currency', currencyConfig: USD },
  count_formula: { type: 'formula', returnType: 'number' },
  broken: { type: 'currency', currencyConfig: { currencyMode: 'fixed', defaultCurrency: 'US' } },
};

const NAMES = Object.keys(FIELDS);

/** The declaration as `inferExpressionType` alone would stamp it. */
function plainStamp(source: string): { returnType?: string } {
  const t = inferExpressionType(source, { fields: NAMES });
  return t === 'unknown' ? {} : { returnType: t };
}

describe('a formula over a currency field declares the currency result', () => {
  it('stamps `currency` and copies a fixed source currency', () => {
    expect(inferFormulaReturn('record.amount * 0.1', FIELDS))
      .toEqual({ returnType: 'currency', currencyConfig: { currencyMode: 'fixed', defaultCurrency: 'USD' } });
  });

  it('a dynamic source declares no currencyConfig — absent IS dynamic, as on a currency field', () => {
    expect(inferFormulaReturn('record.budget * 2', FIELDS)).toEqual({ returnType: 'currency' });
    // An explicit `dynamic` config reads the same as none.
    expect(inferFormulaReturn('record.budget - record.spent', FIELDS)).toEqual({ returnType: 'currency' });
  });

  it('the two money formulas the example apps ship are proven', () => {
    // examples/app-crm `opportunity.expected_revenue` (amount: currency, probability: percent).
    expect(inferFormulaReturn(
      '(record.amount == null ? 0 : record.amount) * (record.probability == null ? 0 : record.probability) / 100',
      FIELDS,
    )).toEqual({ returnType: 'currency', currencyConfig: USD });
    // examples/app-showcase `project.budget_remaining` (budget, spent: both currency, dynamic).
    expect(inferFormulaReturn(
      '(record.budget == null ? 0 : record.budget) - (record.spent == null ? 0 : record.spent)',
      FIELDS,
    )).toEqual({ returnType: 'currency' });
  });

  it('keeps the unit through the unit-preserving shapes', () => {
    const money = { returnType: 'currency', currencyConfig: USD };
    for (const source of [
      'record.amount + record.tax',
      'record.amount - record.tax',
      'record.amount + 10',
      '-record.amount',
      'record.amount / record.quantity',
      'record.amount * (1 - record.discount_rate)',
      'record.amount * record.probability / 100',
      'round(record.amount)',
      'abs(record.amount - record.tax)',
      'max(record.amount - record.tax, 0)',
      'coalesce(record.amount, 0)',
      'record.flag ? record.amount : null',
      'record.flag ? record.amount * 2 : null',
      'record.flag ? record.amount : record.tax',
      'record.weighted * 2',
    ]) {
      expect(inferFormulaReturn(source, FIELDS), source).toEqual(money);
    }
  });

  it('every stamped declaration is a legal formula field', () => {
    for (const source of ['record.amount * 0.1', 'record.budget * 2']) {
      const decl = inferFormulaReturn(source, FIELDS);
      const r = FieldSchema.safeParse({ name: 'f', label: 'F', type: 'formula', expression: source, ...decl });
      expect(r.success, `${source}: ${r.success ? '' : JSON.stringify(r.error.issues)}`).toBe(true);
    }
  });
});

describe('CONTROL — a numeric formula stays `number`', () => {
  it('a formula over plain quantities stamps `number`, with no currency', () => {
    expect(inferFormulaReturn('record.quantity * 2', FIELDS)).toEqual({ returnType: 'number' });
    expect(inferFormulaReturn('record.count_formula + 1', FIELDS)).toEqual({ returnType: 'number' });
  });

  it('nothing it cannot prove is money: each answer is exactly the plain inference', () => {
    for (const source of [
      'record.quantity * 2',
      // Two amounts multiplied, or a quantity divided by one, is not an amount.
      'record.amount * record.tax',
      'record.quantity / record.amount',
      // A ratio of two amounts is a plain number.
      'record.amount / record.tax',
      // An amount plus a quantity adds two units.
      'record.amount + record.quantity',
      // Two currencies — fixed USD with fixed EUR, fixed USD with dynamic — are not one amount.
      'record.amount + record.fee_eur',
      'record.amount + record.budget',
      'record.flag ? record.amount : record.fee_eur',
      // A source whose currency does not parse names no currency.
      'record.broken * 2',
      // A roll-up's unit is its child field's, not readable here.
      'record.rollup * 2',
      'record.amount % 3',
      'record.amount > 100',
      'upper(record.name)',
      'today()',
      'record.amount + record.name',
      'record.unknown_field * 2',
      'size(record.name)',
    ]) {
      expect(inferFormulaReturn(source, FIELDS), source).toEqual(plainStamp(source));
      expect(inferFormulaReturn(source, FIELDS).returnType, source).not.toBe('currency');
    }
  });

  it('without the host\'s fields it never claims money — the plain inference, unchanged', () => {
    expect(inferFormulaReturn('record.amount * 0.1')).toEqual({ returnType: 'number' });
    expect(inferFormulaReturn('record.amount * 0.1').returnType).toBe(inferExpressionType('record.amount * 0.1'));
    expect(inferFormulaReturn('record.budget - record.spent')).toEqual({});
  });

  it('an empty, missing or non-string source declares nothing', () => {
    expect(inferFormulaReturn('', FIELDS)).toEqual({});
    expect(inferFormulaReturn('   ', FIELDS)).toEqual({});
    expect(inferFormulaReturn(null, FIELDS)).toEqual({});
    expect(inferFormulaReturn(undefined, FIELDS)).toEqual({});
    expect(inferFormulaReturn({ source: 1 } as never, FIELDS)).toEqual({});
  });

  it('reads an expression envelope the way it reads a string', () => {
    expect(inferFormulaReturn({ dialect: 'cel', source: 'record.amount * 0.1' }, FIELDS))
      .toEqual(inferFormulaReturn('record.amount * 0.1', FIELDS));
  });

  it('an expression that does not type-check is never money', () => {
    expect(inferFormulaReturn('record.amount *', FIELDS)).toEqual({});
  });
});
