/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#10422, the detail face: the `summaryFields` chip beside the record
 * H1 in `DetailView` hands the field's def (object field and section field,
 * merged) to `resolveFieldCurrency`, whose truth table is pinned in
 * `@object-ui/i18n` beside it.
 *
 * Under a USD tenant, a `dynamic` field, and an empty config as the spec parses
 * it, read exactly what a currency field with no `currencyConfig` reads (the
 * tenant's `$`); a `fixed` field keeps its own code. The chip's own compact
 * face (`maximumFractionDigits: 0`) is objectui#9453's and is not under test.
 *
 * ── Directions on the base tree (predicted before the first run) ─────────
 *   dynamic reads the tenant currency         RED   (read `€`)
 *   parsed-empty reads the tenant currency    RED   (read `CN¥`)
 *   control: fixed JPY reads `¥`              GREEN (untouched)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import * as React from 'react';
import { CurrencyConfigSchema } from '@objectstack/spec/data';
import { I18nProvider, LocalizationProvider } from '@object-ui/i18n';
import { DetailView } from '../DetailView';
import type { DetailViewSchema, FieldMetadata } from '@object-ui/types';

/**
 * `useRecordEditable` falls back to the GLOBAL fetch with no
 * `SchemaRendererProvider` in the tree; served from a double so no case here
 * depends on the network (the same stub `summaryChip.displayLocale-9453` uses).
 */
beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok: true, json: async () => ({ record: { visible: true } }) })),
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
  cleanup();
});

/** The summary chip's text for `field` holding `stored`, under a USD tenant. */
function chipText(field: Record<string, unknown>, stored: number): string {
  const { container } = render(
    <I18nProvider config={{ defaultLanguage: 'en', detectBrowserLanguage: false }} persistLanguage={false}>
      <LocalizationProvider value={{ locale: 'en', currency: 'USD' }}>
        <DetailView
          schema={
            {
              type: 'record:details',
              objectName: 'account',
              summaryFields: ['amount'],
              fields: [{ name: 'amount', label: 'Amount', type: 'currency', ...field } as FieldMetadata],
              data: { id: 'A9', name: 'Acme', amount: stored },
            } as unknown as DetailViewSchema
          }
        />
      </LocalizationProvider>
    </I18nProvider>,
  );
  const chip = container.querySelector<HTMLElement>('[data-summary-chip="amount"]');
  expect(chip, 'a summary chip for "amount" is beside the H1').not.toBeNull();
  const text = (chip!.textContent ?? '').replace(/\s+/g, ' ').trim();
  cleanup();
  return text;
}

describe('the detail summary chip agrees with the resolver on currencyMode (objectui#10422)', () => {
  it('dynamic: reads what a field with no currencyConfig reads, the tenant $', () => {
    const reference = chipText({}, 3456);
    expect(reference).toBe('$3,456');
    expect(chipText({ currencyConfig: { currencyMode: 'dynamic', defaultCurrency: 'EUR' } }, 3456)).toBe(reference);
  });

  it('parsed-empty: an empty config, as the spec parses it, reads the tenant $, never CN¥', () => {
    const reference = chipText({}, 3456);
    const shown = chipText({ currencyConfig: CurrencyConfigSchema.parse({}) }, 3456);
    expect(shown).not.toContain('CN¥');
    expect(shown).toBe(reference);
  });

  it('control: a fixed JPY field keeps its own ¥', () => {
    expect(chipText({ currencyConfig: { currencyMode: 'fixed', defaultCurrency: 'JPY' } }, 1234)).toBe('¥1,234');
  });
});
