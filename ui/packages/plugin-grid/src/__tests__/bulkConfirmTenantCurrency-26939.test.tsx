/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#26939 — a bulk `confirmText` hole `{{ amount | currency }}` with
 * no argument formats in the tenant default currency (`localization.currency`,
 * the code `useLocalization()` holds), the one every currency field reads.
 * With none, the sentence is shown as written: never in USD.
 *
 * Two halves: the helper's `currency` argument, and the real
 * `BulkActionDialog` under a real `LocalizationProvider`.
 *
 * Expected strings come from `Intl` itself, so a newer ICU cannot drift them.
 */
import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest';
import React from 'react';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
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

const AMOUNT_VALUE = 1234.5;
const money = (tag: string, currency: string) =>
  new Intl.NumberFormat(tag, { style: 'currency', currency }).format(AMOUNT_VALUE);
const AMOUNT: BulkActionParam = { name: 'amount', label: 'Amount', type: 'number' };
const SOURCE = 'Set the amount to {{ amount | currency }} on {{ count }} records?';

describe('bulkConfirmText formats a no-argument currency hole in the tenant default it is handed', () => {
  const fill = (currency?: string) =>
    bulkConfirmText(SOURCE, { count: 2, params: [AMOUNT], values: { amount: AMOUNT_VALUE } }, 'en-US', currency);

  it('formats in the tenant default', () => {
    expect(fill('CNY')).toBe(`Set the amount to ${money('en-US', 'CNY')} on 2 records?`);
  });

  it('with none, the sentence is shown as written', () => {
    expect(fill()).toBe(SOURCE);
  });
});

const REPRICE: BulkActionDef = {
  name: 'reprice',
  label: 'Reprice',
  operation: 'update',
  params: [{ ...AMOUNT, default: AMOUNT_VALUE }],
  confirmText: { dialect: 'template', source: SOURCE },
};

function openDialog(tenantCurrency: string | undefined) {
  render(
    <I18nProvider config={{ defaultLanguage: 'en', detectBrowserLanguage: false }} persistLanguage={false}>
      <LocalizationProvider value={{ locale: 'en-US', currency: tenantCurrency }}>
        <BulkActionDialog
          def={REPRICE}
          rows={[{ id: 'r1', name: 'Acme' }, { id: 'r2', name: 'Globex' }]}
          resource="account"
          dataSource={{ update: vi.fn(async () => ({})), delete: vi.fn(async () => ({})) } as any}
          open
          onClose={() => {}}
        />
      </LocalizationProvider>
    </I18nProvider>,
  );
}

/** The confirm step's sentence, read as the dialog's description `textContent`. */
async function confirmSentence(): Promise<string | null> {
  fireEvent.click(await screen.findByRole('button', { name: 'Next' }));
  const dialog = await screen.findByRole('dialog');
  const description = await waitFor(() => {
    const el = document.getElementById(dialog.getAttribute('aria-describedby') ?? '');
    expect(el?.textContent).toMatch(/^Set the amount to /);
    return el;
  });
  return description?.textContent ?? null;
}

describe('BulkActionDialog formats its confirm sentence in the tenant default currency', () => {
  it('formats a no-argument currency hole in the tenant default', async () => {
    openDialog('JPY');
    expect(await confirmSentence()).toBe(`Set the amount to ${money('en-US', 'JPY')} on 2 records?`);
  });

  it('shows the sentence as written when the tenant has no default', async () => {
    openDialog(undefined);
    expect(await confirmSentence()).toBe(SOURCE);
  });
});
