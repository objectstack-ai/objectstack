/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * auditHistoryDisplay — the History tab's Changes entry formats a currency,
 * number or percent value the way the record page formats that field.
 *
 * The record page's cells (`CurrencyCellRenderer`, `NumberCellRenderer`,
 * `PercentCellRenderer`) format through `formatCurrency`,
 * `formatNumberFieldValue` and `formatPercent` in `@object-ui/fields`; the
 * History tab printed the raw stored number instead (`4321000` where the
 * record header read `$4,321,000.00`). Each case below states the record
 * page's text as a literal and checks the shared formatter agrees with it, so
 * the literal is the cell's answer and not this helper's own.
 */
import { describe, it, expect } from 'vitest';
import {
  formatCurrency,
  formatNumberFieldValue,
  formatPercent,
} from '@object-ui/fields';
import { formatAuditValue, type AuditFieldDef } from '../auditHistoryDisplay';

const annualRevenue: AuditFieldDef = {
  type: 'currency',
  label: 'Annual Revenue',
  currencyConfig: { currencyMode: 'fixed', defaultCurrency: 'USD' },
};

describe('formatAuditValue — currency', () => {
  it('formats a fixed-currency amount as the record page does', () => {
    const out = formatAuditValue(annualRevenue, 4321000, { locale: 'en-US' });
    expect(out).toBe('$4,321,000.00');
    expect(out).toBe(formatCurrency(4321000, 'USD', 'en-US'));
    // Both sides of the change, the old value included.
    expect(formatAuditValue(annualRevenue, 8000000, { locale: 'en-US' })).toBe('$8,000,000.00');
  });

  it("reads the currency's own minor-unit width and the viewer's locale", () => {
    const yen: AuditFieldDef = { type: 'currency', currencyConfig: { currencyMode: 'fixed', defaultCurrency: 'JPY' } };
    expect(formatAuditValue(yen, 4321000, { locale: 'en-US' })).toBe(formatCurrency(4321000, 'JPY', 'en-US'));
    expect(formatAuditValue(yen, 4321000, { locale: 'en-US' })).not.toContain('.');
    const de = formatAuditValue(annualRevenue, 1234.5, { locale: 'de-DE' });
    expect(de).toBe(formatCurrency(1234.5, 'USD', 'de-DE'));
    expect(de).toContain('1.234,50');
  });

  it('reads a decimal column stored as its numeric string', () => {
    expect(formatAuditValue(annualRevenue, '4321000.5', { locale: 'en-US' })).toBe('$4,321,000.50');
  });

  it('shows a dynamic-mode amount in the tenant default, and a plain number without one', () => {
    const dynamic: AuditFieldDef = { type: 'currency', currencyConfig: { currencyMode: 'dynamic' } };
    expect(formatAuditValue(dynamic, 1500, { locale: 'en-US', tenantCurrency: 'EUR' })).toBe(
      formatCurrency(1500, 'EUR', 'en-US'),
    );
    // No code known: the formatter's own no-code face, never a guessed symbol.
    expect(formatAuditValue(dynamic, 1500, { locale: 'en-US' })).toBe('1,500.00');
  });

  it('shows a record-mode amount as a plain number: its code lives on the row, not in this call', () => {
    const recordMode: AuditFieldDef = {
      type: 'currency',
      currencyConfig: { currencyMode: 'record', currencyField: 'currency_code' },
    };
    // The tenant default is NOT a fallback for a record-mode amount.
    expect(formatAuditValue(recordMode, 1500, { locale: 'en-US', tenantCurrency: 'EUR' })).toBe(
      formatCurrency(1500, undefined, 'en-US'),
    );
    expect(formatAuditValue(recordMode, 1500, { locale: 'en-US', tenantCurrency: 'EUR' })).toBe('1,500.00');
  });
});

describe('formatAuditValue — number', () => {
  it('pads to the declared scale and groups', () => {
    const amount: AuditFieldDef = { type: 'number', scale: 2 };
    const out = formatAuditValue(amount, 1234.5, { locale: 'en-US' });
    expect(out).toBe('1,234.50');
    expect(out).toBe(formatNumberFieldValue(1234.5, { name: 'amount', type: 'number', scale: 2 }, 'en-US'));
  });

  it('keeps a scale-0 number ungrouped, as the cell does for a year', () => {
    const year: AuditFieldDef = { type: 'number', scale: 0 };
    expect(formatAuditValue(year, 2026, { locale: 'en-US' })).toBe('2026');
  });

  it("follows the viewer's locale", () => {
    const amount: AuditFieldDef = { type: 'number', scale: 2 };
    expect(formatAuditValue(amount, 1234.5, { locale: 'de-DE' })).toBe('1.234,50');
  });

  it('keeps a value that is not a number as it was stored', () => {
    expect(formatAuditValue({ type: 'number' }, 'n/a', { locale: 'en-US' })).toBe('n/a');
  });
});

describe('formatAuditValue — percent', () => {
  it('reads a fraction-stored percent at its declared scale', () => {
    const rate: AuditFieldDef = { type: 'percent', scale: 1 };
    const out = formatAuditValue(rate, 0.25, { locale: 'en-US' });
    expect(out).toBe('25.0%');
    expect(out).toBe(formatPercent(0.25, 'fraction', 1, 'en-US'));
  });

  it('reads a whole-stored percent when the field declares max above 1', () => {
    const points: AuditFieldDef = { type: 'percent', scale: 0, max: 100 };
    expect(formatAuditValue(points, 25, { locale: 'en-US' })).toBe('25%');
  });

  it("follows the viewer's locale percent convention", () => {
    const rate: AuditFieldDef = { type: 'percent', scale: 1 };
    expect(formatAuditValue(rate, 0.25, { locale: 'de-DE' })).toBe(formatPercent(0.25, 'fraction', 1, 'de-DE'));
  });
});
