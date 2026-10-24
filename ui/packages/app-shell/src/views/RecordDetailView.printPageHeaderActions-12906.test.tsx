/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#12906 — a record whose bound record page declares `print` shows its
 * header actions in the print page's screen-only chrome, beside Print.
 *
 * A page that declares `print` may hold only the printable component types,
 * and `page:header` (the one block that draws a record's `record_header` /
 * `record_more` actions and the system Edit / Share / Delete) is not one of
 * them. So the record view draws the same row, through `PageHeaderActions`
 * (the resolver `page:header` itself draws with), in the chrome row that holds
 * the Print button, outside the print page's root, where the print stylesheet
 * hides it on paper exactly as it hides Print (objectui#11958).
 *
 * Pins:
 *  (a) on a print page, the declared action and the system set are drawn in
 *      the chrome beside Print;
 *  (b) that chrome is outside the print page's root, the condition the print
 *      stylesheet's hide rule reads, as Print is;
 *  (c) clicking the declared action reaches the record page's own action
 *      runtime, with the same request a non-print record page sends;
 *  (d) CONTROL: a record page without `print` draws no print chrome, and its
 *      `page:header` draws the same actions once.
 *
 * Harness: the `RecordDetailView.headerMenuIcons-12529` mount (the real record
 * page under a real `I18nProvider` and `FavoritesProvider`), with the bound
 * page served the way `RecordDetailView.printAction-11958` serves it.
 */

import * as React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent, cleanup, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

const authFetchSpy = vi.fn(async () =>
  new Response(JSON.stringify({ data: [] }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  }),
);
vi.mock('@object-ui/auth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAuth: () => ({ user: { id: 'u1', name: 'Ada', image: null }, activeOrganization: null }),
  createAuthenticatedFetch: () => authFetchSpy,
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

// Orthogonal chrome: this file observes the header actions, Print and the page root.
vi.mock('./ActionConfirmDialog', () => ({ ActionConfirmDialog: () => null }));
vi.mock('./ActionParamDialog', () => ({ ActionParamDialog: () => null }));
vi.mock('./ActionResultDialog', () => ({ ActionResultDialog: () => null }));
vi.mock('./FlowRunner', () => ({ FlowRunner: () => null }));
vi.mock('./MetadataInspector', () => ({
  MetadataPanel: () => null,
  useMetadataInspector: () => ({ showDebug: false, toggle: () => {} }),
}));

import { I18nProvider } from '@object-ui/i18n';
import { MetadataCtx } from '@object-ui/react';
import { RecordDetailView } from './RecordDetailView';
import { FavoritesProvider } from '../context/FavoritesProvider';

const OBJECT_NAME = 'invoice_12906';
const RECORD_ID = 'INV-1';
const RECORD_PATH = `/apps/billing/${OBJECT_NAME}/record/${RECORD_ID}`;
const SUBMIT_TARGET = `/api/v1/data/${OBJECT_NAME}/{id}/submit`;

const OBJECTS = [
  {
    name: OBJECT_NAME,
    label: 'Invoice',
    // The permissive bucket: edit + delete both default open.
    managedBy: 'platform',
    fields: {
      id: { type: 'text', label: 'Id' },
      name: { type: 'text', label: 'Number' },
    },
    actions: [
      {
        name: 'submit_signoff',
        label: 'Submit for Sign-off',
        type: 'api',
        method: 'POST',
        target: SUBMIT_TARGET,
        locations: ['record_header'],
      },
    ],
  },
];

/** The invoice's default record page: a print page, as the showcase invoice's is. */
const PRINT_PAGE = {
  name: 'invoice_document',
  label: 'Invoice',
  type: 'record',
  object: OBJECT_NAME,
  print: { paperSize: 'A4' },
  regions: [
    { name: 'header', components: [{ type: 'text', value: 'ACME Ltd' }] },
    { name: 'main', components: [{ type: 'text', value: 'Invoice body' }] },
  ],
};

async function mountRecordPage(pages: unknown[]) {
  const metadata = {
    objects: OBJECTS,
    pages,
    loading: false,
    error: null,
    refresh: async () => {},
    invalidate: () => {},
    ensureType: async () => pages,
    getItem: async () => null,
    getItemsByType: () => pages,
  } as any;
  const dataSource = {
    find: vi.fn(async () => ({ data: [] })),
    findOne: vi.fn(async () => ({ id: RECORD_ID, name: 'INV-0001' })),
    create: vi.fn(async () => ({})),
    update: vi.fn(async () => ({})),
    delete: vi.fn(async () => ({})),
    getObjectSchema: async () => OBJECTS[0],
  } as any;
  const onEdit = vi.fn();
  render(
    <I18nProvider config={{ defaultLanguage: 'en', detectBrowserLanguage: false }} persistLanguage={false}>
      <MetadataCtx.Provider value={metadata}>
        <FavoritesProvider>
          <MemoryRouter initialEntries={[RECORD_PATH]}>
            <Routes>
              <Route
                path="/apps/:appName/:objectName/record/:recordId"
                element={<RecordDetailView dataSource={dataSource} objects={OBJECTS as any} onEdit={onEdit} />}
              />
            </Routes>
          </MemoryRouter>
        </FavoritesProvider>
      </MetadataCtx.Provider>
    </I18nProvider>,
  );
  await waitFor(() => expect(dataSource.findOne).toHaveBeenCalled());
  await waitFor(() => expect(document.querySelector('[data-page-type]')).not.toBeNull());
  await waitFor(() => expect(screen.queryByRole('button', { name: 'Submit for Sign-off' })).not.toBeNull());
  return { onEdit };
}

/** The one action toolbar the record page draws; there must be exactly one. */
function theToolbar(): HTMLElement {
  const toolbars = document.querySelectorAll('[role="toolbar"]');
  expect(toolbars).toHaveLength(1);
  return toolbars[0] as HTMLElement;
}

async function openOverflow(scope: HTMLElement): Promise<string[]> {
  const trigger = within(scope).getByRole('button', { name: 'More actions' });
  fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: 'mouse' });
  await waitFor(() => expect(screen.getByRole('menu')).toBeInTheDocument());
  return Array.from(screen.getByRole('menu').querySelectorAll('[role="menuitem"]')).map((el) =>
    (el.textContent ?? '').trim(),
  );
}

/** Click the declared action and hand back the one request it sent. */
async function clickSubmit(scope: HTMLElement): Promise<{ url: string; method: string | undefined }> {
  authFetchSpy.mockClear();
  fireEvent.click(within(scope).getByRole('button', { name: 'Submit for Sign-off' }));
  await waitFor(() =>
    expect(authFetchSpy.mock.calls.some((c) => String((c as unknown[])[0]).includes('/submit'))).toBe(true),
  );
  const call = authFetchSpy.mock.calls.find((c) => String((c as unknown[])[0]).includes('/submit')) as unknown as [
    string,
    RequestInit,
  ];
  return { url: call[0], method: call[1]?.method };
}

beforeEach(() => {
  cleanup();
  localStorage.clear();
  authFetchSpy.mockClear();
  // Unrelated chrome reaches for the platform API; serve it from a double so
  // happy-dom never opens a socket (objectui#6640).
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

describe('RecordDetailView — a print page draws the record’s header actions in its screen-only chrome beside Print (objectui#12906)', () => {
  it('(a) the declared record_header action and Edit / Share / Delete are drawn in the chrome beside Print', async () => {
    const { onEdit } = await mountRecordPage([PRINT_PAGE]);
    const chrome = document.querySelector('[data-record-print-chrome]') as HTMLElement;
    expect(chrome).not.toBeNull();
    // Print and the action row are one chrome row.
    expect(within(chrome).getByTestId('record-print-button')).toBeInTheDocument();
    const toolbar = theToolbar();
    expect(chrome.contains(toolbar)).toBe(true);
    const rowNames = within(toolbar)
      .getAllByRole('button')
      .map((b) => b.getAttribute('aria-label') ?? (b.textContent ?? '').trim());
    expect(rowNames).toEqual(['Submit for Sign-off', 'Edit', 'More actions']);
    // Edit is the system set's own handler, as on any record page.
    fireEvent.click(within(toolbar).getByRole('button', { name: 'Edit' }));
    expect(onEdit).toHaveBeenCalledWith({ id: RECORD_ID });
    expect(await openOverflow(toolbar)).toEqual(['Add to favorites', 'Share', 'Delete']);
  });

  it('(b) the chrome sits outside the print page root, the condition the print stylesheet hides by, as Print does', async () => {
    await mountRecordPage([PRINT_PAGE]);
    const pageRoot = document.querySelector('[data-print-page]') as HTMLElement;
    expect(pageRoot).not.toBeNull();
    const sheet = document.querySelector('style[data-print-stylesheet]')?.textContent ?? '';
    // The hide rule: everything that is not the print page, holds it, or sits in it.
    expect(sheet).toContain('body :not(:has([data-print-page])):not([data-print-page]):not([data-print-page] *) { display: none !important; }');
    const print = screen.getByTestId('record-print-button');
    const toolbar = theToolbar();
    const chrome = document.querySelector('[data-record-print-chrome]') as HTMLElement;
    for (const el of [print, toolbar, chrome]) {
      // Neither inside the page nor holding it: the hide rule matches it on paper.
      expect(pageRoot.contains(el)).toBe(false);
      expect(el.contains(pageRoot)).toBe(false);
    }
    // One mechanism: the actions share Print's own container.
    expect(print.closest('[data-record-print-chrome]')).toBe(chrome);
    expect(toolbar.closest('[data-record-print-chrome]')).toBe(chrome);
  });

  it('(c) clicking the declared action reaches the record page’s action runtime with the request a non-print record page sends', async () => {
    await mountRecordPage([PRINT_PAGE]);
    const onPrintPage = await clickSubmit(theToolbar());
    expect(onPrintPage.url.endsWith(`/api/v1/data/${OBJECT_NAME}/${RECORD_ID}/submit`)).toBe(true);
    expect(onPrintPage.method).toBe('POST');

    cleanup();
    await mountRecordPage([]);
    const onDefaultPage = await clickSubmit(theToolbar());
    expect(onDefaultPage).toEqual(onPrintPage);
  });

  it('(d) CONTROL — a record page without `print` draws no print chrome; its page:header draws the actions once', async () => {
    await mountRecordPage([]);
    expect(document.querySelector('[data-print-page]')).toBeNull();
    expect(document.querySelector('[data-record-print-chrome]')).toBeNull();
    expect(screen.queryByTestId('record-print-button')).toBeNull();
    const toolbar = theToolbar();
    expect(toolbar.closest('header')).not.toBeNull();
    expect(screen.getAllByRole('button', { name: 'Submit for Sign-off' })).toHaveLength(1);
    expect(screen.getAllByRole('button', { name: 'Edit' })).toHaveLength(1);
  });
});
