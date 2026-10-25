/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#12427: the record page's favorites entry is in the header's `⋯`
 * overflow, ahead of Share.
 *
 * A record is never a navigation entry, so the entry toggles the `record:`
 * favorite, which the sidebar draws in its Favorites section at the top. It
 * reads "Add to favorites", then "Remove from favorites" once the record is
 * one.
 *
 * It is the page's ONE favorites control: the record header draws no star.
 * This page no longer hands the record context an `onToggleFavorite`, and the
 * `page:header` chrome draws its star only for a host that does (the
 * components pin `page-header-star-host-toggle-12427`). Updated deliberately
 * by the record-star remainder of objectui#12427: the header star that sat
 * beside this entry is gone, in both favorite states.
 *
 * Harness: the `RecordDetailView.deleteConfirmDialog-11001` mount (the real
 * record page under a real `I18nProvider` and a metadata context), plus the
 * real `FavoritesProvider`, on the record route so the page knows its app.
 */

import * as React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

vi.mock('@object-ui/auth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAuth: () => ({ user: null, activeOrganization: null }),
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
import { FavoritesProvider, type FavoriteItem } from '../context/FavoritesProvider';

const OBJECT_NAME = 'crm_call';
const RECORD_ID = 'rec-call-1';
const RECORD_PATH = `/apps/crm/${OBJECT_NAME}/record/${RECORD_ID}`;

const OBJECTS = [
  {
    name: OBJECT_NAME,
    label: 'Call',
    managedBy: 'platform',
    fields: {
      id: { type: 'text', label: 'Id' },
      name: { type: 'text', label: 'Name' },
    },
  },
];

const METADATA = {
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

/** The provider's local key for a signed-out session. */
const STORE_KEY = 'objectui-favorites';
const stored = (): FavoriteItem[] => JSON.parse(localStorage.getItem(STORE_KEY) ?? '[]');

async function mountRecordPage() {
  const dataSource = {
    find: vi.fn(async () => ({ data: [] })),
    findOne: vi.fn(async () => ({ id: RECORD_ID, name: 'Intro call' })),
    create: vi.fn(async () => ({})),
    update: vi.fn(async () => ({})),
    delete: vi.fn(async () => ({})),
  } as any;
  render(
    <I18nProvider config={{ defaultLanguage: 'en', detectBrowserLanguage: false }} persistLanguage={false}>
      <MetadataCtx.Provider value={METADATA}>
        <FavoritesProvider>
          <MemoryRouter initialEntries={[RECORD_PATH]}>
            <Routes>
              <Route
                path="/apps/:appName/:objectName/record/:recordId"
                element={<RecordDetailView dataSource={dataSource} objects={OBJECTS} onEdit={() => {}} />}
              />
            </Routes>
          </MemoryRouter>
        </FavoritesProvider>
      </MetadataCtx.Provider>
    </I18nProvider>,
  );
  await waitFor(() => expect(dataSource.findOne).toHaveBeenCalled());
  await waitFor(() => expect(document.querySelector('[role="toolbar"]')).toBeTruthy());
}

/** The record header's favorite star, by either of its two names. */
function headerStars(): HTMLElement[] {
  return [
    ...screen.queryAllByRole('button', { name: 'Add to favorites' }),
    ...screen.queryAllByRole('button', { name: 'Remove from favorites' }),
  ];
}

/** Opens the header's overflow and returns its entries' text. */
async function openOverflow(): Promise<string[]> {
  const trigger = screen.getByRole('button', { name: 'More actions' });
  fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: 'mouse' });
  await waitFor(() => expect(screen.getByRole('menu')).toBeInTheDocument());
  return screen.getAllByRole('menuitem').map((el) => (el.textContent ?? '').trim());
}

beforeEach(() => {
  cleanup();
  localStorage.clear();
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
  vi.clearAllMocks();
});

describe('record page: the favorites entry is in the overflow, ahead of Share (objectui#12427)', () => {
  it('the overflow leads with Add to favorites, then Share', async () => {
    await mountRecordPage();
    const items = await openOverflow();
    expect(items.indexOf('Add to favorites')).toBe(0);
    expect(items.indexOf('Share')).toBe(1);
  });

  it('the record header draws no star, so the overflow entry is the one favorites control', async () => {
    await mountRecordPage();
    // The record chip is drawn (its copy-id button sits in the star's row),
    // so "no star" cannot pass on a header that drew no chip at all.
    await waitFor(() => expect(screen.getByRole('button', { name: 'Copy record ID' })).toBeInTheDocument());
    expect(headerStars()).toHaveLength(0);

    const items = await openOverflow();
    expect(items.filter((text) => /favorites$/.test(text))).toEqual(['Add to favorites']);

    // Still none once the record is a favorite.
    fireEvent.click(screen.getByRole('menuitem', { name: 'Add to favorites' }));
    await waitFor(() => expect(stored()).toHaveLength(1));
    expect(headerStars()).toHaveLength(0);
  });

  it('choosing it writes the record favorite, and the entry then reads Remove from favorites', async () => {
    await mountRecordPage();
    await openOverflow();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Add to favorites' }));

    await waitFor(() => expect(stored()).toHaveLength(1));
    const [favorite] = stored();
    expect([favorite.id, favorite.type, favorite.href]).toEqual([
      `record:${OBJECT_NAME}:${RECORD_ID}`,
      'record',
      RECORD_PATH,
    ]);

    // The header re-derives its system actions on the next render, so the
    // overflow's first entry now offers the way back.
    await waitFor(() =>
      expect((screen.getAllByRole('menuitem')[0].textContent ?? '').trim()).toBe('Remove from favorites'),
    );
  });
});
