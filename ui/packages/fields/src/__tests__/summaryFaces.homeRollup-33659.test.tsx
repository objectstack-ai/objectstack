/**
 * objectstack#33659 — a roll-up of a stored home amount is money in the
 * organization's home currency.
 *
 * ADR-0144 D6 has consolidated totals read the stored home field, a `dynamic`
 * currency field in `localization.currency` (D8 rule 5). The spec admits
 * `currencyConfig: { currencyMode: 'dynamic' }` on a `summary` over such a
 * field, and nowhere else. Both roll-up faces (the record page's
 * `SummaryField` and the list cell `FormulaCellRenderer`) then draw the total
 * in the tenant default currency, the code a metric tile over the same home
 * field resolves (`ObjectMetricWidget`: `resolveFieldCurrency(valueFieldDef,
 * tenantCurrency)`), so one figure reads one currency on the record and on the
 * tile.
 *
 * The figures are HotCRM's PSA probe (hotcrm#2316): three expenses, EUR 90,
 * CNY 720 and USD 50, converted at write to 100 + 100 + 50 home dollars.
 */
import { describe, it, expect, afterEach } from 'vitest';
import React from 'react';
import { render, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom';
import { LocalizationProvider } from '@object-ui/i18n';
import { FormulaCellRenderer } from '../index';
import { resolveFieldCurrency, summaryDeclaresCurrency } from '../currency';
import { SummaryField } from '../widgets/SummaryField';
import { formatCurrency } from '../widgets/number-format';

afterEach(cleanup);

const text = (s: string | null | undefined) => (s ?? '').replace(/\u00a0/g, ' ');

/** The child's stored home field, as the spec ships it: a currency field in `dynamic` mode. */
const HOME_FIELD = { name: 'amount_home', type: 'currency', currencyConfig: { currencyMode: 'dynamic' } } as any;

/** The project's roll-up of that home field. */
const HOME_ROLLUP = {
  name: 'home_expense_total',
  type: 'summary',
  summaryOperations: { object: 'crm_probe_expense', field: 'amount_home', function: 'sum', relationshipField: 'project' },
  currencyConfig: { currencyMode: 'dynamic' },
} as any;

const PROJECT = { id: 'p1', title: 'Probe' };

/** Both roll-up faces, under one tenant: [cell text, form text]. */
function faces(field: any, tenant: { locale: string; currency?: string }, value = 250): [string, string] {
  const cell = render(
    <LocalizationProvider value={tenant}>
      <FormulaCellRenderer value={value} field={field} dependentValues={PROJECT as any} />
    </LocalizationProvider>,
  );
  const cellText = text(cell.container.textContent);
  cell.unmount();
  const form = render(
    <LocalizationProvider value={tenant}>
      <SummaryField value={value} onChange={() => {}} field={field} dependentValues={PROJECT as any} />
    </LocalizationProvider>,
  );
  const formText = text(form.container.textContent);
  form.unmount();
  return [cellText, formText];
}

describe('a `dynamic` roll-up of a home amount draws in the home currency', () => {
  it('home USD: $250.00 on the list cell and the record page', () => {
    expect(faces(HOME_ROLLUP, { locale: 'en-US', currency: 'USD' })).toEqual(['$250.00', '$250.00']);
  });

  it('the same rows under home CNY: the yuan symbol, never a dollar', () => {
    const [cell, form] = faces(HOME_ROLLUP, { locale: 'en-US', currency: 'CNY' }, 1800);
    for (const face of [cell, form]) {
      expect(face).toContain('¥');
      expect(face).toContain('1,800.00');
      expect(face).not.toContain('$');
    }
    expect(cell).toBe(form);
  });

  it('a config naming no `currencyMode` is `dynamic`, as the spec parses it', () => {
    expect(summaryDeclaresCurrency({ ...HOME_ROLLUP, currencyConfig: {} })).toBe(true);
    expect(faces({ ...HOME_ROLLUP, currencyConfig: {} }, { locale: 'en-US', currency: 'USD' })).toEqual(['$250.00', '$250.00']);
  });

  it('with no home currency set, a plain amount and no symbol', () => {
    for (const face of faces(HOME_ROLLUP, { locale: 'en-US' })) {
      expect(face).not.toMatch(/[$€¥]/);
      expect(face).toBe('250.00');
    }
  });

  it('a roll-up that declares no currency still reads as a number', () => {
    expect(summaryDeclaresCurrency({ ...HOME_ROLLUP, currencyConfig: undefined })).toBe(false);
    expect(faces({ ...HOME_ROLLUP, currencyConfig: undefined }, { locale: 'en-US', currency: 'USD' })).toEqual(['250', '250']);
  });
});

describe('the summary face and the metric tile give one home field one currency (acceptance 3)', () => {
  // The metric tile's own resolution over the home field it aggregates:
  // `ObjectMetricWidget`'s `inferredCurrency` is
  // `resolveFieldCurrency(valueFieldDef, tenantCurrency)`, formatted through
  // `formatCurrency` under the display locale.
  const tile = (tenant: { locale: string; currency?: string }, value: number) =>
    formatCurrency(value, resolveFieldCurrency(HOME_FIELD, tenant.currency), tenant.locale);

  it.each([
    [{ locale: 'en-US', currency: 'USD' }],
    [{ locale: 'en-US', currency: 'CNY' }],
    [{ locale: 'de-DE', currency: 'EUR' }],
    [{ locale: 'ja-JP', currency: 'JPY' }],
  ])('under %j, the record page, the list cell and the tile read the same text', (tenant) => {
    const [cell, form] = faces(HOME_ROLLUP, tenant, 1250.5);
    const tileText = text(tile(tenant, 1250.5));
    expect(form).toBe(tileText);
    expect(cell).toBe(tileText);
    // And the code both resolve is the tenant's, never one the metadata names.
    expect(resolveFieldCurrency(HOME_ROLLUP, tenant.currency, PROJECT)).toBe(resolveFieldCurrency(HOME_FIELD, tenant.currency));
  });
});
