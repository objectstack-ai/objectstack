/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `RecordDetailView`'s audit history formats a `dynamic`-mode currency diff in
 * the tenant's default currency (ADR-0053), the code the record page's cells
 * show for the same field (objectstack#27640).
 *
 * `formatAuditValue` resolves a currency code through `resolveFieldCurrency`,
 * whose last step is `AuditValueFormatContext.tenantCurrency`. The History
 * effect built `fmtCtx = { t, locale: displayLocale, lookupLabels }` with no
 * tenant currency, so a `dynamic` change read as a plain grouped number beside
 * the record's own currency face. The view now reads
 * `useLocalization().currency` into `fmtCtx.tenantCurrency`.
 *
 * The tenant currency is declared through `LocalizationProvider`, the channel
 * the record page's cells read. A `record`-mode field keeps its code in a
 * sibling field of the row, which the per-value call is not handed, so it
 * stays a plain number with the tenant currency set: the tenant default is
 * never its fallback. The page is the synthesized one, opened on its 动态 tab
 * through the `related` URL param; the diff line is read off the rendered
 * stream, the way a user sees it.
 */

import * as React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { MetadataCtx } from '@object-ui/react';
import { I18nProvider, LocalizationProvider } from '@object-ui/i18n';

vi.mock('@object-ui/auth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAuth: () => ({ user: { id: 'u1', name: 'Ada', image: null }, activeOrganization: null }),
  createAuthenticatedFetch: () => vi.fn(),
}));

vi.mock('@object-ui/collaboration', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useRecordPresence: () => [],
  PresenceAvatars: () => null,
}));

vi.mock('sonner', () => ({
  toast: Object.assign(vi.fn(), {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
    loading: vi.fn(),
    dismiss: vi.fn(),
  }),
}));

// The dialogs / flow runner are orthogonal chrome; stubbing them keeps this
// file about the history diff (same posture as the display-locale history pin).
vi.mock('./ActionConfirmDialog', () => ({ ActionConfirmDialog: () => null }));
vi.mock('./ActionParamDialog', () => ({ ActionParamDialog: () => null }));
vi.mock('./ActionResultDialog', () => ({ ActionResultDialog: () => null }));
vi.mock('./FlowRunner', () => ({ FlowRunner: () => null }));
vi.mock('./MetadataInspector', () => ({
  MetadataPanel: () => null,
  useMetadataInspector: () => ({ showDebug: false, toggle: () => {} }),
}));

import { RecordDetailView } from './RecordDetailView';

const OBJECT_NAME = 'crm_deal';
const RECORD_ID = 'rec-deal';

const OBJECTS = [
  {
    name: OBJECT_NAME,
    label: 'Deal',
    managedBy: 'platform',
    // The History tab is opt-in per object; this and the registered audit
    // object below are what switch it on.
    enable: { trackHistory: true },
    fields: {
      id: { type: 'text', label: 'Id' },
      name: { type: 'text', label: 'Name' },
      amount: { type: 'currency', label: 'Amount', currencyConfig: { currencyMode: 'dynamic' } },
      list_price: {
        type: 'currency',
        label: 'List price',
        currencyConfig: { currencyMode: 'record', currencyField: 'currency_code' },
      },
      currency_code: { type: 'text', label: 'Currency code' },
    },
  },
  { name: 'sys_audit_log', label: 'Audit log', fields: { id: { type: 'text' } } },
];

function makeDataSource() {
  const find = vi.fn((objectName: string) => {
    if (objectName === 'sys_audit_log') {
      return Promise.resolve({
        data: [
          {
            id: 'a-1',
            created_at: '2020-03-05T12:00:00.000Z',
            action: 'update',
            old_value: JSON.stringify({ amount: 1500, list_price: 1500 }),
            new_value: JSON.stringify({ amount: 2500, list_price: 2500 }),
          },
        ],
      });
    }
    return Promise.resolve({ data: [] });
  });
  return {
    find,
    findOne: vi.fn(async () => ({
      id: RECORD_ID,
      name: 'Alpha',
      amount: 2500,
      list_price: 2500,
      currency_code: 'JPY',
    })),
    create: vi.fn(async () => ({})),
    update: vi.fn(async () => ({})),
    delete: vi.fn(async () => ({})),
  } as any;
}

function makeMetadata() {
  return {
    objects: OBJECTS,
    pages: [],
    loading: false,
    error: null,
    refresh: async () => {},
    invalidate: () => {},
    ensureType: async () => [],
    getItem: async () => null,
    getItemsByType: () => [],
  } as any;
}

/**
 * The rendered diff parts, keyed by field label, with `currency` as the
 * tenant default (none when undefined) and `en-US` as the display locale.
 */
async function diffLines(currency: string | undefined): Promise<Record<string, string>> {
  render(
    <I18nProvider config={{ defaultLanguage: 'en', detectBrowserLanguage: false }} persistLanguage={false}>
      <LocalizationProvider value={{ locale: 'en-US', currency }}>
        <MemoryRouter initialEntries={[`/app/demo/${OBJECT_NAME}/${RECORD_ID}?related=timeline`]}>
          <MetadataCtx.Provider value={makeMetadata()}>
            <RecordDetailView
              dataSource={makeDataSource()}
              objects={OBJECTS}
              onEdit={() => {}}
              objectNameOverride={OBJECT_NAME}
              recordIdOverride={RECORD_ID}
              embedded
            />
          </MetadataCtx.Provider>
        </MemoryRouter>
      </LocalizationProvider>
    </I18nProvider>,
  );
  // One audit entry draws its changes as one compact line (`data-stream-change`),
  // joined with `; `, so each field's part is split out and keyed by label.
  const lines: Record<string, string> = {};
  await waitFor(() => {
    const line = Array.from(document.querySelectorAll('[data-stream-change]')).find((el) =>
      (el.textContent ?? '').includes('Amount'),
    );
    expect(line, 'no History diff line').toBeTruthy();
    const parts = (line!.textContent ?? '').replace(/\s+/g, ' ').trim().split('; ');
    for (const label of ['Amount', 'List price']) {
      const part = parts.find((p) => p.startsWith(`${label} `));
      expect(part, `no change for ${label} in: ${parts.join(' | ')}`).toBeTruthy();
      lines[label] = part!;
    }
  });
  cleanup();
  return lines;
}

beforeEach(() => {
  // Unrelated chrome on this view reaches for the platform API; answering it
  // locally keeps the only asynchrony here the reads this file stubs.
  vi.stubGlobal(
    'fetch',
    vi.fn(async () =>
      new Response(JSON.stringify({ data: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    ),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('RecordDetailView — a dynamic currency diff reads in the tenant currency (objectstack#27640)', () => {
  it('formats a dynamic-mode change from 1500 to 2500 with the EUR face under an EUR tenant', async () => {
    const lines = await diffLines('EUR');
    expect(lines['Amount'], `got: ${lines['Amount']}`).toBe('Amount €1,500.00 → €2,500.00');
  });

  it('keeps a record-mode change a plain number: the tenant currency is not its fallback', async () => {
    const lines = await diffLines('EUR');
    expect(lines['List price'], `got: ${lines['List price']}`).toBe('List price 1,500.00 → 2,500.00');
  });

  it('control: with no tenant currency, the dynamic change reads as a plain number', async () => {
    const lines = await diffLines(undefined);
    expect(lines['Amount'], `got: ${lines['Amount']}`).toBe('Amount 1,500.00 → 2,500.00');
  });
});
