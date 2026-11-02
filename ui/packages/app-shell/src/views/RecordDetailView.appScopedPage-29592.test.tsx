/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The record view opens the record page scoped to the app it is opened in
 * (`PageSchema.apps`, maintainer ruling A on objectstack#28979).
 *
 * The route's `:appName` segment is NOT the app's name: `/apps/SEGMENT` carries
 * `appRouteSegment(app)`, the app's package id when it has one. So the view
 * resolves the segment to its app (`matchAppBySegment`, package id first, then
 * name) and hands the app's NAME to the assignment. Pins:
 *
 *   - the ruling's own: inside the Duly app, a user record opens `duly_member`
 *     (`apps: ['duly']`), under its package-id segment and under its name
 *     segment; under Setup (`/apps/com.objectstack.setup/...`) the platform's
 *     `sys_user_detail` still opens;
 *   - two apps in one package share the package-id segment, which resolves to
 *     the first app, so the second app's scoped page opens under its name
 *     segment only;
 *   - the record drawer inside an app list reads the host route's app;
 *   - CONTROL: with no `apps` on any page, every app opens the default page.
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
// Orthogonal chrome — this file observes which record page is drawn only.
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

const OBJECT = 'sys_user';
const REC = 'u1';

const objectDef = {
  name: OBJECT,
  label: 'User',
  fields: { id: { label: 'Id', type: 'text' }, name: { label: 'Name', type: 'text' } },
};

function makeDataSource() {
  return {
    find: vi.fn(async () => ({ data: [], total: 0, hasMore: false, pageSize: 50 })),
    findOne: vi.fn(async () => ({ id: REC, name: 'Ada' })),
    create: vi.fn(async (_o: string, row: unknown) => row),
    update: vi.fn(async () => ({})),
    delete: vi.fn(async () => ({})),
    getObjectSchema: async () => objectDef,
  };
}

/**
 * A full record page of the user object. Its accessible name (`aria.ariaLabel`,
 * stamped on the page root) names the page, so the drawn page is readable.
 */
function userPage(name: string, extra: Record<string, unknown> = {}) {
  return {
    name,
    label: name,
    type: 'record',
    object: OBJECT,
    aria: { ariaLabel: name },
    ...extra,
    regions: [{ name: 'main', components: [] }],
  };
}

const SYS_USER_DETAIL = userPage('sys_user_detail', { isDefault: true });
const DULY_MEMBER = userPage('duly_member', { apps: ['duly'] });

const SETUP_APP = { name: 'setup', label: 'Setup', _packageId: 'com.objectstack.setup' };
const DULY_APP = { name: 'duly', label: 'Duly', _packageId: 'com.duly' };
// One package, two apps: the package id resolves to the first.
const ACME_SALES = { name: 'acme_sales', label: 'Sales', _packageId: 'com.acme' };
const ACME_SERVICE = { name: 'acme_service', label: 'Service', _packageId: 'com.acme' };
const APPS = [SETUP_APP, DULY_APP, ACME_SALES, ACME_SERVICE];

function makeMetadata(pages: unknown[]) {
  return {
    apps: APPS, objects: [], pages, loading: false, error: null,
    refresh: async () => {}, invalidate: () => {},
    ensureType: async () => pages, getItem: async () => null,
    getItemsByType: () => pages,
  } as never;
}

/** Mount the record route `url` (or, with `drawer`, the list route with the record drawer) and read the page drawn. */
async function drawnPage(url: string, pages: unknown[], drawer = false): Promise<string | undefined> {
  const ds = makeDataSource();
  const view = drawer ? (
    <RecordDetailView dataSource={ds as never} objects={[objectDef] as never} onEdit={() => {}}
      objectNameOverride={OBJECT} recordIdOverride={REC} embedded />
  ) : (
    <RecordDetailView dataSource={ds as never} objects={[objectDef] as never} onEdit={() => {}} />
  );
  const utils = render(
    <MemoryRouter initialEntries={[url]}>
      <MetadataCtx.Provider value={makeMetadata(pages)}>
        <NavigationProvider>
          <Routes>
            <Route path={drawer ? '/apps/:appName/:objectName' : '/apps/:appName/:objectName/record/:recordId'} element={view} />
          </Routes>
        </NavigationProvider>
      </MetadataCtx.Provider>
    </MemoryRouter>,
  );
  await waitFor(() => expect(ds.findOne).toHaveBeenCalled());
  await waitFor(() => expect(utils.container.querySelector('[data-page-type="record"][aria-label]')).not.toBeNull());
  const drawn = utils.container.querySelector('[data-page-type="record"][aria-label]')?.getAttribute('aria-label') ?? undefined;
  cleanup();
  return drawn;
}

const recordUrl = (segment: string) => `/apps/${segment}/${OBJECT}/record/${REC}`;

beforeAll(() => {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1280 });
});

beforeEach(() => {
  // Unrelated chrome reaches for the platform API; serve it from a double so
  // happy-dom never opens a socket (objectui#6640).
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

describe('RecordDetailView — the record page scoped to the route\'s app opens (ruling A on objectstack#28979)', () => {
  it('inside the Duly app, under its package-id segment, a user record opens duly_member', async () => {
    expect(await drawnPage(recordUrl('com.duly'), [SYS_USER_DETAIL, DULY_MEMBER])).toBe('duly_member');
  });

  it('inside the Duly app, under its name segment, a user record opens duly_member', async () => {
    expect(await drawnPage(recordUrl('duly'), [SYS_USER_DETAIL, DULY_MEMBER])).toBe('duly_member');
  });

  it('Setup → Users under /apps/com.objectstack.setup still opens sys_user_detail', async () => {
    expect(await drawnPage(recordUrl('com.objectstack.setup'), [DULY_MEMBER, SYS_USER_DETAIL])).toBe('sys_user_detail');
  });

  it('two apps in one package: the package-id segment opens the first app, so the second app\'s page opens under its name only', async () => {
    const servicePage = userPage('acme_service_user', { apps: ['acme_service'] });
    const pages = [SYS_USER_DETAIL, servicePage];
    expect(await drawnPage(recordUrl('com.acme'), pages)).toBe('sys_user_detail');
    expect(await drawnPage(recordUrl('acme_service'), pages)).toBe('acme_service_user');
    // The first app's own scoped page is the one its package-id segment opens.
    const salesPage = userPage('acme_sales_user', { apps: ['acme_sales'] });
    expect(await drawnPage(recordUrl('com.acme'), [SYS_USER_DETAIL, salesPage, servicePage])).toBe('acme_sales_user');
  });

  it('the record drawer inside the Duly app\'s list opens duly_member; inside Setup\'s, sys_user_detail', async () => {
    expect(await drawnPage(`/apps/com.duly/${OBJECT}`, [SYS_USER_DETAIL, DULY_MEMBER], true)).toBe('duly_member');
    expect(await drawnPage(`/apps/com.objectstack.setup/${OBJECT}`, [SYS_USER_DETAIL, DULY_MEMBER], true)).toBe('sys_user_detail');
  });

  it('CONTROL: with no `apps` on any page, every app opens the default record page', async () => {
    const pages = [userPage('first_authored'), SYS_USER_DETAIL];
    for (const segment of ['com.duly', 'duly', 'com.objectstack.setup', 'com.acme', 'acme_service']) {
      expect(await drawnPage(recordUrl(segment), pages)).toBe('sys_user_detail');
    }
  });
});
