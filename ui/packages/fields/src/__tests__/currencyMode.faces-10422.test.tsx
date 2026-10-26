/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#10422, the two `@object-ui/fields` faces: the list cell
 * (`CurrencyCellRenderer`) and the field widget (`CurrencyField`).
 *
 * Both hand the WHOLE field def to `resolveFieldCurrency`, whose truth table is
 * pinned in `@object-ui/i18n` beside it. These rows hold each face to it:
 * under a USD tenant, a `dynamic` field, and an empty config as the spec parses
 * it, read exactly what a field with no `currencyConfig` reads (the tenant's
 * `$`), while a `fixed` field keeps its own code.
 *
 * ── Directions on the base tree (predicted before the first run) ─────────
 *   dynamic reads the tenant currency         RED   (read `€`)
 *   parsed-empty reads the tenant currency    RED   (read `CN¥`)
 *   control: fixed JPY reads `¥`              GREEN (untouched)
 */

import { describe, it, expect, afterEach } from 'vitest';
import React from 'react';
import { render, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom';
import { CurrencyConfigSchema } from '@objectstack/spec/data';
import { LocalizationProvider } from '@object-ui/i18n';
import { CurrencyCellRenderer } from '../index';
import { CurrencyField } from '../widgets/CurrencyField';

afterEach(cleanup);

/** A USD tenant: a field that names no currency of its own reads `$`. */
const TENANT = { locale: 'en-US', currency: 'USD' };

const FIELDS: Record<string, Record<string, unknown>> = {
  fixed: { type: 'currency', currencyConfig: { currencyMode: 'fixed', defaultCurrency: 'JPY' } },
  dynamic: { type: 'currency', currencyConfig: { currencyMode: 'dynamic', defaultCurrency: 'EUR' } },
  // What the spec makes of an authored `currencyConfig: {}`: a dynamic CNY config.
  parsedEmpty: { type: 'currency', currencyConfig: CurrencyConfigSchema.parse({}) },
  // The reference: no `currencyConfig`, so the tenant currency is right.
  plain: { type: 'currency' },
};

const VALUE = 3456;

/** ICU puts U+00A0 between a currency CODE and the amount; keep rows readable. */
const text = (s: string | null) => (s ?? '').replace(/\u00a0/g, ' ');

const FACES: Array<[string, (field: Record<string, unknown>, value: number) => string]> = [
  [
    'CurrencyCellRenderer (the list cell)',
    (field, value) => {
      const { container, unmount } = render(
        <LocalizationProvider value={TENANT}>
          <CurrencyCellRenderer value={value} field={{ name: 'amount', ...field } as any} />
        </LocalizationProvider>,
      );
      const out = text(container.textContent);
      unmount();
      return out;
    },
  ],
  [
    'CurrencyField (the field widget, read-only)',
    (field, value) => {
      const { container, unmount } = render(
        <LocalizationProvider value={TENANT}>
          <CurrencyField value={value} onChange={() => {}} field={{ name: 'amount', ...field } as any} readonly />
        </LocalizationProvider>,
      );
      const out = text(container.textContent);
      unmount();
      return out;
    },
  ],
];

describe.each(FACES)('%s agrees with the resolver on currencyMode (objectui#10422)', (_face, show) => {
  it('dynamic: reads what a field with no currencyConfig reads, the tenant $', () => {
    const reference = show(FIELDS.plain, VALUE);
    expect(reference).toMatch(/^\$3,456/);
    expect(show(FIELDS.dynamic, VALUE)).toBe(reference);
  });

  it('parsed-empty: an empty config, as the spec parses it, reads the tenant $, never CN¥', () => {
    const reference = show(FIELDS.plain, VALUE);
    const shown = show(FIELDS.parsedEmpty, VALUE);
    expect(shown).not.toContain('CN¥');
    expect(shown).toBe(reference);
  });

  it('control: a fixed JPY field keeps its own ¥', () => {
    expect(show(FIELDS.fixed, 1234)).toBe('¥1,234');
  });
});
