/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#35798: the `summaryFields` chip beside the record H1 reads a
 * `formula` by its declared `returnType` where the header reads that return
 * type as a field type. A `percent` formula reads at its own `scale` and `max`,
 * a `currency` formula in its own `currencyConfig` currency, a `date` formula
 * as a localized date: each byte-equal to the chip of a field of that type
 * holding the same stored value. A `number` or `text` formula keeps the face
 * it had (CONTROL).
 *
 * ── Directions on the base tree (predicted before the first run) ─────────
 *   percent formula reads as a percent field   RED   (read `0.25`)
 *   currency formula reads as a currency field RED   (read `1234`)
 *   date formula reads as a date field         RED   (read the ISO text)
 *   control: number / text formula unchanged   GREEN (untouched)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import * as React from 'react';
import { I18nProvider, LocalizationProvider } from '@object-ui/i18n';
import { DetailView } from '../DetailView';
import type { DetailViewSchema, FieldMetadata } from '@object-ui/types';

/**
 * `useRecordEditable` falls back to the GLOBAL fetch with no
 * `SchemaRendererProvider` in the tree; served from a double so no case here
 * depends on the network (the stub `summaryChip.currencyMode-10422` uses).
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
function chipText(field: Record<string, unknown>, stored: unknown): string {
  const { container } = render(
    <I18nProvider config={{ defaultLanguage: 'en', detectBrowserLanguage: false }} persistLanguage={false}>
      <LocalizationProvider value={{ locale: 'en', currency: 'USD' }}>
        <DetailView
          schema={
            {
              type: 'record:details',
              objectName: 'account',
              summaryFields: ['kpi'],
              fields: [{ name: 'kpi', label: 'KPI', ...field } as FieldMetadata],
              data: { id: 'A9', name: 'Acme', kpi: stored },
            } as unknown as DetailViewSchema
          }
        />
      </LocalizationProvider>
    </I18nProvider>,
  );
  const chip = container.querySelector<HTMLElement>('[data-summary-chip="kpi"]');
  expect(chip, 'a summary chip for "kpi" is beside the H1').not.toBeNull();
  const text = (chip!.textContent ?? '').replace(/\s+/g, ' ').trim();
  cleanup();
  return text;
}

const formula = (returnType: string, extra: Record<string, unknown> = {}) => ({
  type: 'formula',
  returnType,
  expression: 'record.a',
  ...extra,
});

describe('the summary chip reads a formula by its declared returnType (objectstack#35798)', () => {
  it('percent: a fraction-stored formula reads as a percent field does', () => {
    const reference = chipText({ type: 'percent' }, 0.25);
    expect(reference).toBe('25%');
    expect(chipText(formula('percent'), 0.25)).toBe(reference);
  });

  it('percent: at the formula\'s own declared scale and max', () => {
    const declared = { scale: 1, max: 100 };
    const reference = chipText({ type: 'percent', ...declared }, 42.25);
    expect(reference).toBe('42.3%');
    expect(chipText(formula('percent', declared), 42.25)).toBe(reference);
  });

  it('currency: in the formula\'s own currencyConfig currency', () => {
    const config = { currencyConfig: { currencyMode: 'fixed', defaultCurrency: 'JPY' } };
    const reference = chipText({ type: 'currency', ...config }, 1234);
    expect(reference).toBe('¥1,234');
    expect(chipText(formula('currency', config), 1234)).toBe(reference);
  });

  it('currency: with no currencyConfig, the tenant currency, as a currency field', () => {
    const reference = chipText({ type: 'currency' }, 1250);
    expect(reference).toBe('$1,250');
    expect(chipText(formula('currency'), 1250)).toBe(reference);
  });

  it('date: a localized date, as a date field', () => {
    const reference = chipText({ type: 'date' }, '2026-03-04');
    expect(reference).toBe('Mar 4, 2026');
    expect(chipText(formula('date'), '2026-03-04')).toBe(reference);
  });

  it('CONTROL: a number formula keeps the face it had', () => {
    expect(chipText(formula('number'), 1250)).toBe('1250');
  });

  it('CONTROL: a text formula keeps the face it had', () => {
    expect(chipText(formula('text'), 'Gold tier')).toBe('Gold tier');
  });
});
