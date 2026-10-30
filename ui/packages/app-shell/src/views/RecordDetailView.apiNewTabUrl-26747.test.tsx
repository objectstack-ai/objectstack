/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#26747 — a `type: 'api'` action declaring `opensInNewTab` +
 * `newTabUrl` takes the spec's zero-roundtrip path on the record page: the
 * pre-opened tab goes to `newTabUrl` with `{recordId}` substituted, and no
 * request is sent — from the header row and from its `⋯` more-menu alike.
 *
 * Before the fix the record page's registered `api` handler never read the
 * pair: it sent its usual request to `target`, and no tab opened.
 *
 * CONTROL: the same api action without `newTabUrl` still sends its request
 * to `target`.
 *
 * Harness: the `RecordDetailView.headerMenuIcons-12529` mount (the real
 * record page under a real `I18nProvider`, a metadata context and the real
 * `FavoritesProvider`), clicked through the real header and menu, so the
 * dispatch runs through the page's own `ActionProvider` and handler set.
 */

import * as React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent, cleanup, act } from '@testing-library/react';
import '@testing-library/jest-dom';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

const authFetchSpy = vi.fn();
vi.mock('@object-ui/auth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAuth: () => ({ user: null, activeOrganization: null }),
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

const OBJECT_NAME = 'gapdata_item';
const RECORD_ID = 'rec item 1';
const RECORD_PATH = `/apps/gap/${OBJECT_NAME}/record/${encodeURIComponent(RECORD_ID)}`;
const TARGET = '/api/v1/export/gapdata_item';
/** The `{recordId}` substitution the fast path performs (URL-encoded). */
const EXPECTED_TAB_URL = `${window.location.origin}/export/${encodeURIComponent(RECORD_ID)}`;

const newTabAction = (name: string, label: string) => ({
  name,
  label,
  type: 'api',
  target: TARGET,
  opensInNewTab: true,
  newTabUrl: '/export/{recordId}',
  locations: ['record_header'],
});

const urlAction = (name: string, label: string) => ({
  name,
  label,
  type: 'url',
  target: `https://example.com/${name}`,
  locations: ['record_header'],
});

async function mountRecordPage(actions: unknown[]) {
  const objects = [
    {
      name: OBJECT_NAME,
      label: 'Gap Item',
      managedBy: 'platform',
      fields: {
        id: { type: 'text', label: 'Id' },
        name: { type: 'text', label: 'Name' },
      },
      actions,
    },
  ];
  const metadata = {
    objects,
    pages: [],
    loading: false,
    error: null,
    refresh: async () => {},
    invalidate: () => {},
    ensureType: async () => [],
    getItem: async () => null,
    getItemsByType: () => [],
  } as any;
  const dataSource = {
    find: vi.fn(async () => ({ data: [] })),
    findOne: vi.fn(async () => ({ id: RECORD_ID, name: 'Item One' })),
    create: vi.fn(async () => ({})),
    update: vi.fn(async () => ({})),
    delete: vi.fn(async () => ({})),
  } as any;
  render(
    <I18nProvider config={{ defaultLanguage: 'en', detectBrowserLanguage: false }} persistLanguage={false}>
      <MetadataCtx.Provider value={metadata}>
        <FavoritesProvider>
          <MemoryRouter initialEntries={[RECORD_PATH]}>
            <Routes>
              <Route
                path="/apps/:appName/:objectName/record/:recordId"
                element={<RecordDetailView dataSource={dataSource} objects={objects} onEdit={() => {}} />}
              />
            </Routes>
          </MemoryRouter>
        </FavoritesProvider>
      </MetadataCtx.Provider>
    </I18nProvider>,
  );
  await waitFor(() => expect(dataSource.findOne).toHaveBeenCalled());
  await waitFor(() => expect(document.querySelector('[role="toolbar"]')).toBeTruthy());
  // Whatever the mount itself fetched is not the dispatch under test.
  authFetchSpy.mockClear();
  (globalThis.fetch as any).mockClear();
}

/** A stand-in for the tab `window.open('about:blank')` hands back. */
function stubWindowOpen() {
  const tab = {
    document: { write: vi.fn(), close: vi.fn() },
    location: { href: 'about:blank' },
    close: vi.fn(),
  };
  const open = vi.spyOn(window, 'open').mockImplementation(() => tab as unknown as Window);
  return { tab, open };
}

/** Every request the click sent, through either fetch. */
function requestUrls(): string[] {
  return [...authFetchSpy.mock.calls, ...(globalThis.fetch as any).mock.calls].map((c) => String(c[0]));
}

async function openOverflow(): Promise<HTMLElement> {
  const trigger = screen.getByRole('button', { name: 'More actions' });
  fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: 'mouse' });
  await waitFor(() => expect(screen.getByRole('menu')).toBeInTheDocument());
  return screen.getByRole('menu');
}

beforeEach(() => {
  cleanup();
  localStorage.clear();
  authFetchSpy.mockReset();
  authFetchSpy.mockImplementation(async () =>
    new Response(JSON.stringify({ success: true, data: {} }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }),
  );
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
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('objectstack#26747 — record page: an api action with opensInNewTab + newTabUrl opens the tab and sends nothing', () => {
  it('from the header row: the pre-opened tab goes to the interpolated newTabUrl, and no request reaches the target', async () => {
    await mountRecordPage([newTabAction('export_tab', 'Export')]);
    const { tab, open } = stubWindowOpen();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Export' }));
    });

    await waitFor(() => expect(tab.location.href).toBe(EXPECTED_TAB_URL));
    expect(open).toHaveBeenCalledTimes(1);
    expect(open).toHaveBeenCalledWith('about:blank', '_blank');
    expect(requestUrls().filter((u) => u.includes(TARGET) || u.includes('/export/'))).toEqual([]);
    expect(authFetchSpy).not.toHaveBeenCalled();
  });

  it('from the ⋯ more-menu: the same click opens the same tab, and no request reaches the target', async () => {
    // Three actions fill the header's inline slots; the fourth folds into the ⋯.
    await mountRecordPage([
      urlAction('convert_lead', 'Convert Lead'),
      urlAction('schedule_follow_up', 'Schedule Follow-up'),
      urlAction('log_call', 'Log a Call'),
      newTabAction('export_tab', 'Export'),
    ]);
    expect(screen.queryByRole('button', { name: 'Export' })).toBeNull();
    const { tab, open } = stubWindowOpen();

    const menu = await openOverflow();
    const item = Array.from(menu.querySelectorAll('[role="menuitem"]'))
      .find((el) => (el.textContent ?? '').trim() === 'Export');
    expect(item).toBeTruthy();
    await act(async () => {
      fireEvent.click(item!);
    });

    await waitFor(() => expect(tab.location.href).toBe(EXPECTED_TAB_URL));
    expect(open).toHaveBeenCalledTimes(1);
    expect(open).toHaveBeenCalledWith('about:blank', '_blank');
    expect(requestUrls().filter((u) => u.includes(TARGET) || u.includes('/export/'))).toEqual([]);
    expect(authFetchSpy).not.toHaveBeenCalled();
  });

  it('CONTROL: the same api action without newTabUrl still sends its request, through the action door', async () => {
    const { newTabUrl: _dropped, ...withoutNewTabUrl } = newTabAction('export_tab', 'Export');
    await mountRecordPage([withoutNewTabUrl]);
    const { open } = stubWindowOpen();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Export' }));
    });

    await waitFor(() => expect(authFetchSpy).toHaveBeenCalledTimes(1));
    const [url, init] = authFetchSpy.mock.calls[0] as unknown as [string, RequestInit];
    // A declared same-origin api action reaches its target through the door
    // (objectstack#27611).
    expect(url.endsWith(`/api/v1/actions/${OBJECT_NAME}/export_tab`)).toBe(true);
    expect(init.method).toBe('POST');
    expect(open).not.toHaveBeenCalledWith('about:blank', '_blank');
  });
});
