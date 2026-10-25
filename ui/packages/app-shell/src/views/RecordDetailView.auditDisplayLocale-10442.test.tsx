/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `RecordDetailView`'s audit history formats its date diffs in the DISPLAY
 * locale, never the UI language (objectui#10442).
 *
 * The History effect built `fmtCtx = { t, locale: language, lookupLabels }`,
 * and `formatAuditValue` spends `locale` on `toLocaleDateString` /
 * `toLocaleString`. So a regional display locale (`de-CH` under an English UI)
 * never reached a `date` or `datetime` diff. The view now reads
 * `useDisplayLocale()` into `fmtCtx.locale`.
 *
 * The real `I18nProvider` runs with an ENGLISH UI in every case, and the
 * display locale is declared through `LocalizationProvider`, so the display
 * locale is the only thing that differs between the `de-CH` pin and the
 * `en-US` control. The page is the synthesized one, opened on its History tab
 * through the `tab` URL param; the diff line is read off the rendered
 * timeline, the way a user sees it.
 */

import * as React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
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
// file about the history diff (same posture as RecordDetailView.feedLoading).
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

/** Date-only values, read back in the viewer's zone (the suite pins `TZ=UTC`). */
const FROM_DATE = '2020-03-03';
const TO_DATE = '2020-03-04';

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
      close_date: { type: 'date', label: 'Close date' },
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
            old_value: JSON.stringify({ close_date: FROM_DATE }),
            new_value: JSON.stringify({ close_date: TO_DATE }),
          },
        ],
      });
    }
    return Promise.resolve({ data: [] });
  });
  return {
    find,
    findOne: vi.fn(async () => ({ id: RECORD_ID, name: 'Alpha', close_date: TO_DATE })),
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

function renderHistory(locale: string) {
  return render(
    <I18nProvider config={{ defaultLanguage: 'en', detectBrowserLanguage: false }} persistLanguage={false}>
      <LocalizationProvider value={{ locale }}>
        <MemoryRouter initialEntries={[`/app/demo/${OBJECT_NAME}/${RECORD_ID}?tab=history`]}>
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
}

/** The rendered diff line for `close_date`, under an ENGLISH UI with `locale` as the display locale. */
async function diffLine(locale: string): Promise<string> {
  renderHistory(locale);
  const label = await screen.findByText('Close date', { selector: 'li > span' });
  const text = (label.closest('li')?.textContent ?? '').replace(/\s+/g, ' ').trim();
  cleanup();
  return text;
}

const expected = (locale: string) =>
  `Close date: ${new Date(`${FROM_DATE}T00:00:00Z`).toLocaleDateString(locale)} → ${new Date(`${TO_DATE}T00:00:00Z`).toLocaleDateString(locale)}`;

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

describe('RecordDetailView — the audit history dates follow the display locale (objectui#10442)', () => {
  it('formats the date diff as de-CH under an English UI with a de-CH display locale', async () => {
    const text = await diffLine('de-CH');
    expect(text, `got: ${text}`).toBe('Close date: 3.3.2020 → 4.3.2020');
    expect(text).toBe(expected('de-CH'));
  });

  it('control: formats the date diff as en-US under an en-US display locale', async () => {
    const text = await diffLine('en-US');
    expect(text, `got: ${text}`).toBe('Close date: 3/3/2020 → 3/4/2020');
    expect(text).toBe(expected('en-US'));
  });

  /** ⭐ THE PIN: no runner locale can make both readings equal. */
  it('is a reading of the session, not of the machine', async () => {
    expect(await diffLine('de-CH')).not.toBe(await diffLine('en-US'));
  });
});
