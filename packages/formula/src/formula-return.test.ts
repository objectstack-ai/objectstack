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
  // `fixed` with no code: the spec refuses it rather than filling in CNY (#27157).
  fixed_no_code: { type: 'currency', currencyConfig: { currencyMode: 'fixed' } },
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

  it('nothing it cannot prove is money: an expression that reads no amount gets exactly the plain inference', () => {
    for (const source of [
      'record.quantity * 2',
      // A ratio of two amounts in one currency is proven a plain number.
      'record.amount / record.tax',
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

  it('CONTROL — a `count` roll-up is a plain number: no amount is read', () => {
    const withCount = { ...FIELDS, line_count: { type: 'summary', summaryOperations: { object: 'line', function: 'count' } } };
    expect(inferFormulaReturn('record.line_count * 2', withCount)).toEqual({ returnType: 'number' });
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

describe('#35631 — an amount the proof cannot follow is unproven, never `number`', () => {
  // A `number` answer is read by a stamp as "proved not money", so it may
  // withdraw a declared `currency`; each shape below reads an amount (or a
  // roll-up that may sum one) and fails the proof, so it answers `{}`.
  const UNPROVEN_OVER_MONEY = [
    // Shapes that answered `number` before #35631 — each pinned as `{}` now.
    'record.amount * 1.0 + record.fee_eur * 1.0', // two currencies meeting
    '100 / record.amount', // anything divided by an amount
    'record.rollup * 0.9', // a roll-up operand
    'record.amount % 3', // a remainder of an amount
    'record.broken * 2', // a source whose currency does not parse
    'record.fixed_no_code * 2', // a fixed source with no code (#27157)
    'double(record.amount) * double(record.tax)', // an amount times an amount
    // Shapes that already answered `{}` (the CEL type is `dyn`): unchanged.
    'record.amount * record.tax',
    'record.quantity / record.amount',
    'record.amount + record.quantity',
    'record.amount + record.fee_eur',
    'record.amount + record.budget',
    'record.flag ? record.amount : record.fee_eur',
    'max(record.amount, record.quantity)',
    'sqrt(record.amount)', // a function the proof does not name
    'record.weighted * record.weighted',
  ];

  it('each answers `{}`', () => {
    for (const source of UNPROVEN_OVER_MONEY) {
      expect(inferFormulaReturn(source, FIELDS), source).toEqual({});
    }
  });

  it('CONTROL — proven money still stamps `currency` with its config, and quantities still stamp `number`', () => {
    expect(inferFormulaReturn('record.amount * 0.1', FIELDS))
      .toEqual({ returnType: 'currency', currencyConfig: { currencyMode: 'fixed', defaultCurrency: 'USD' } });
    expect(inferFormulaReturn('record.quantity * 2', FIELDS)).toEqual({ returnType: 'number' });
  });
});

describe('a formula over a record-mode amount carries the record currency (ADR-0144 D2)', () => {
  const RECORD = { currencyMode: 'record', currencyField: 'currency_code' } as const;
  const RECORD_FIELDS: Readonly<Record<string, FormulaSourceField>> = {
    currency_code: { type: 'text' },
    other_code: { type: 'text' },
    amount: { type: 'currency', currencyConfig: RECORD },
    tax: { type: 'currency', currencyConfig: RECORD },
    fee: { type: 'currency', currencyConfig: { currencyMode: 'record', currencyField: 'other_code' } },
    budget: { type: 'currency' },
    usd: { type: 'currency', currencyConfig: USD },
    quantity: { type: 'number' },
  };

  it('stamps `record` mode with the source amount\'s code field, never the tenant default', () => {
    expect(inferFormulaReturn('record.amount * 0.1', RECORD_FIELDS))
      .toEqual({ returnType: 'currency', currencyConfig: RECORD });
    expect(inferFormulaReturn('record.amount + record.tax', RECORD_FIELDS))
      .toEqual({ returnType: 'currency', currencyConfig: RECORD });
    expect(inferFormulaReturn('round(record.amount * record.quantity)', RECORD_FIELDS))
      .toEqual({ returnType: 'currency', currencyConfig: RECORD });
  });

  it('an amount over its own currency is a plain ratio', () => {
    expect(inferFormulaReturn('record.tax / record.amount', RECORD_FIELDS).returnType).not.toBe('currency');
  });

  it('two different currencies meeting are not one amount', () => {
    for (const source of [
      'record.amount + record.fee', // two code fields
      'record.amount + record.budget', // record + the tenant default
      'record.amount + record.usd', // record + fixed USD
    ]) {
      expect(inferFormulaReturn(source, RECORD_FIELDS).returnType, source).not.toBe('currency');
    }
  });
});
