/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#12604 — opening a record page records the visit in the recent-items
 * store Home's "Recently accessed" and the sidebar read: the record, under the
 * title it was opened with, at the address it was opened at — which names the
 * app it was opened in and its object, the two the Home row's trail prints
 * ("Invoice · HotCRM · 10 minutes ago"; that rendering is pinned in
 * `HomePage.recentlyAccessed-12604.test.tsx`).
 *
 * Harness: `RecordDetailView.printAction-11958.test.tsx`'s, on a real
 * `RecentItemsProvider` and an `/apps/APP/OBJECT/record/ID` route.
 */

import * as React from 'react';
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { render, waitFor, cleanup } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { MetadataCtx } from '@object-ui/react';

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
    success: vi.fn(), error: vi.fn(), info: vi.fn(),
    warning: vi.fn(), loading: vi.fn(), dismiss: vi.fn(),
  }),
}));
// Orthogonal chrome — this file observes the visit the page records only.
vi.mock('./ActionConfirmDialog', () => ({ ActionConfirmDialog: () => null }));
vi.mock('./ActionParamDialog', () => ({ ActionParamDialog: () => null }));
vi.mock('./ActionResultDialog', () => ({ ActionResultDialog: () => null }));
vi.mock('./FlowRunner', () => ({ FlowRunner: () => null }));
vi.mock('./MetadataInspector', () => ({
  MetadataPanel: () => null,
  useMetadataInspector: () => ({ showDebug: false, toggle: () => {} }),
}));

import { RecordDetailView } from './RecordDetailView';
import { NavigationProvider } from '../context/NavigationContext';
import { RecentItemsProvider, useRecentItems, type RecentItem } from '../context/RecentItemsProvider';
import { recentItemObject } from '../console/home/recentItemTypeLabel';
import { appSegmentOf } from '../console/home/appLastOpened';

const APP = 'com.acme.crm';
const OBJECT = 'invoice_12604';
const REC = 'INV-1';

const objectDef = {
  name: OBJECT,
  label: 'Invoice',
  fields: { id: { label: 'Id', type: 'text' }, name: { label: 'Number', type: 'text' } },
};

function makeDataSource() {
  return {
    find: vi.fn(async () => ({ data: [], total: 0, hasMore: false, pageSize: 50 })),
    findOne: vi.fn(async () => ({ id: REC, name: 'INV-0001' })),
    create: vi.fn(async (_o: string, row: unknown) => row),
    update: vi.fn(async () => ({})),
    delete: vi.fn(async () => ({})),
    getObjectSchema: async () => objectDef,
  };
}

const metadata = {
  objects: [], pages: [], loading: false, error: null,
  refresh: async () => {}, invalidate: () => {},
  ensureType: async () => [], getItem: async () => null,
  getItemsByType: () => [],
} as never;

/** What the store holds, read from inside the provider after each commit. */
const held: { items: RecentItem[] } = { items: [] };
function StoreProbe() {
  const { recentItems } = useRecentItems();
  React.useEffect(() => {
    held.items = recentItems;
  }, [recentItems]);
  return null;
}

beforeAll(() => {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1280 });
});

beforeEach(() => {
  localStorage.clear();
  held.items = [];
  vi.stubGlobal('fetch', vi.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => ({ allowed: true, data: [] }),
    text: async () => '{}',
  })) as never);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('RecordDetailView — opening a record page records the visit (objectui#12604)', () => {
  it('records the record with its title, its object and the app it was opened in', async () => {
    const ds = makeDataSource();
    render(
      <MemoryRouter initialEntries={[`/apps/${APP}/${OBJECT}/record/${REC}`]}>
        <MetadataCtx.Provider value={metadata}>
          <NavigationProvider>
            <RecentItemsProvider>
              <StoreProbe />
              <Routes>
                <Route
                  path="/apps/:appName/:objectName/record/:recordId"
                  element={<RecordDetailView dataSource={ds as never} objects={[objectDef] as never} onEdit={() => {}} />}
                />
              </Routes>
            </RecentItemsProvider>
          </NavigationProvider>
        </MetadataCtx.Provider>
      </MemoryRouter>,
    );

    await waitFor(() => expect(held.items).toHaveLength(1));
    const [entry] = held.items;
    expect(entry).toMatchObject({
      id: `record:${OBJECT}:${REC}`,
      type: 'record',
      label: 'INV-0001',
      href: `/apps/${APP}/${OBJECT}/record/${REC}`,
    });
    // The two the Home trail prints, read back off the entry as Home reads them.
    expect(recentItemObject(entry)).toBe(OBJECT);
    expect(appSegmentOf(entry.href)).toBe(APP);
  });
});
