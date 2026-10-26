/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#26307 — a bulk `confirmText` formats its numbers and dates in
 * the viewer's display locale, the one `useDisplayLocale()` resolves, the way
 * the same action's single-record confirm does since objectstack#26232. It
 * used to format them in `en-US` for every viewer.
 *
 * Two halves:
 *   - the helper `bulkConfirmText`: its `locale` argument reaches the
 *     formatters, and an absent one keeps `en-US`;
 *   - the real `BulkActionDialog` under a real `I18nProvider` and
 *     `LocalizationProvider`: the confirm sentence formats in the tenant's
 *     display locale.
 *
 * Expected strings come from `Intl` itself, so a newer ICU cannot drift them.
 */
import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest';
import React from 'react';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import { I18nProvider, LocalizationProvider } from '@object-ui/i18n';
import type { BulkActionDef, BulkActionParam } from '@object-ui/types';

import { BulkActionDialog } from '../components/BulkActionDialog';
import { bulkConfirmText } from '../components/bulkConfirmText';

beforeAll(() => {
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = vi.fn() as any;
  }
});

afterEach(() => cleanup());

const AMOUNT_VALUE = 1234567.5;
const DUE_VALUE = '2026-10-26';
const money = (tag: string) => new Intl.NumberFormat(tag, { style: 'currency', currency: 'EUR' }).format(AMOUNT_VALUE);
const fixed2 = (tag: string) =>
  new Intl.NumberFormat(tag, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(AMOUNT_VALUE);
const longDate = (tag: string) => new Intl.DateTimeFormat(tag, { dateStyle: 'long' }).format(new Date(DUE_VALUE));

const AMOUNT: BulkActionParam = { name: 'amount', label: 'Amount', type: 'number' };
const DUE: BulkActionParam = { name: 'due', label: 'Due', type: 'date' };

function fill(source: string, locale?: string) {
  return bulkConfirmText(source, { count: 2, params: [AMOUNT, DUE], values: { amount: AMOUNT_VALUE, due: DUE_VALUE } }, locale);
}

describe('bulkConfirmText formats in the locale it is handed (objectstack#26307)', () => {
  it('formats a currency, a number and a date hole in a German display locale', () => {
    expect(money('de-DE')).not.toBe(money('en-US'));
    expect(fill('Set {{ amount | currency:EUR }} on {{ count }} records?', 'de-DE')).toBe(`Set ${money('de-DE')} on 2 records?`);
    expect(fill('Set {{ amount | number:2 }}?', 'de-DE')).toBe(`Set ${fixed2('de-DE')}?`);
    expect(fill('Due {{ due | date:long }}?', 'de-DE')).toBe(`Due ${longDate('de-DE')}?`);
  });

  it('formats a date hole in a Chinese display locale', () => {
    expect(longDate('zh-CN')).not.toBe(longDate('en-US'));
    expect(fill('Due {{ due | date:long }}?', 'zh-CN')).toBe(`Due ${longDate('zh-CN')}?`);
  });

  it('keeps en-US when no locale is handed', () => {
    expect(fill('Set {{ amount | currency:EUR }}, due {{ due | date:long }}?')).toBe(
      `Set ${money('en-US')}, due ${longDate('en-US')}?`,
    );
  });
});

const ROWS = [{ id: 'r1', name: 'Acme' }, { id: 'r2', name: 'Globex' }];

const REPRICE: BulkActionDef = {
  name: 'reprice',
  label: 'Reprice',
  operation: 'update',
  params: [{ ...AMOUNT, default: AMOUNT_VALUE }],
  confirmText: { dialect: 'template', source: 'Set the amount to {{ amount | currency:EUR }} on {{ count }} records?' },
};

function openDialog(tenantLocale: string | undefined) {
  render(
    <I18nProvider config={{ defaultLanguage: 'en', detectBrowserLanguage: false }} persistLanguage={false}>
      <LocalizationProvider value={{ locale: tenantLocale }}>
        <BulkActionDialog
          def={REPRICE}
          rows={ROWS}
          resource="account"
          dataSource={{ update: vi.fn(async () => ({})), delete: vi.fn(async () => ({})) } as any}
          open
          onClose={() => {}}
        />
      </LocalizationProvider>
    </I18nProvider>,
  );
}

describe('BulkActionDialog formats its confirm sentence in the display locale (objectstack#26307)', () => {
  it('formats a currency hole in the tenant display locale', async () => {
    openDialog('de-DE');
    fireEvent.click(await screen.findByRole('button', { name: 'Next' }));
    expect(await screen.findByText(`Set the amount to ${money('de-DE')} on 2 records?`)).toBeInTheDocument();
  });

  it('formats in the UI language when no tenant locale is set', async () => {
    openDialog(undefined);
    fireEvent.click(await screen.findByRole('button', { name: 'Next' }));
    expect(await screen.findByText(`Set the amount to ${money('en')} on 2 records?`)).toBeInTheDocument();
  });
});
