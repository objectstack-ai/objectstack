/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#33219 — a list-only object's rows open no record page.
 *
 * An object whose data API leaves `get` out (`enable.apiMethods: ['list']`,
 * the SCIM connection credential's shape) is served to the console without
 * `get` in its `/me/permissions` `apiOperations`. Its record page and drawer
 * read with `get`, so they could only ever answer
 * `OBJECT_API_METHOD_NOT_ALLOWED`. Driven through the real `ObjectView`, the
 * real `ListView` grid and the real `MePermissionsProvider` holding that
 * answer, one differential per case — the same object, the same rows, only
 * the served operation set differs:
 *
 *   - a row click opens nothing: no `?recordId=`, no drawer, no route change;
 *   - a ⌘-click opens no tab, and the name is no anchor a new tab follows;
 *   - the name cell draws no 「Open as full page」 ↗;
 *   - a `?recordId=` link opens no drawer and reads no record;
 *   - the row menu still offers the object's `list_item` action (Revoke);
 *   - CONTROL: the same object served with no restriction — the row click
 *     opens the drawer, as every object's does.
 *
 * The bare data page (`ObjectDataPage`, `/:objectName/data`) routes its own
 * row clicks, so the row click and the `?recordId=` link are pinned there too.
 *
 * The record body is not what this file reads, so `RecordDetailView` is a
 * null sink.
 */

import * as React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, screen, fireEvent, waitFor, within, act } from '@testing-library/react';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';
import { createI18n, I18nProvider } from '@object-ui/i18n';
import { MePermissionsProvider, type MePermissionsAuthenticatedResponse } from '@object-ui/permissions';

vi.mock('@object-ui/auth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAuth: () => ({ user: { id: 'u1', name: 'Ada' }, activeOrganization: null }),
  useWorkspaceAdminStatus: () => ({ isAdmin: true, isResolved: true }),
  createAuthenticatedFetch: () => vi.fn(),
}));

vi.mock('@object-ui/collaboration', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useRealtimeSubscription: () => ({ lastMessage: null }),
  useConflictResolution: () => ({ hasConflicts: false, resolveAllConflicts: () => {} }),
}));

vi.mock('sonner', () => ({
  toast: Object.assign(vi.fn(), {
    success: vi.fn(), error: vi.fn(), info: vi.fn(),
    warning: vi.fn(), loading: vi.fn(), dismiss: vi.fn(),
  }),
}));

vi.mock('./MetadataInspector', () => ({
  MetadataPanel: () => null,
  useMetadataInspector: () => ({ showDebug: false, toggle: () => {} }),
}));
// The record body: not what this file reads.
vi.mock('./RecordDetailView', () => ({ RecordDetailView: () => null }));

vi.mock('./metadata-admin/useMetadata', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useMetadataClient: () => ({ save: vi.fn(async () => ({})), get: vi.fn(async () => null) }),
}));

// `ObjectView` reaches a dynamic `import('@objectstack/lint')`: pay its load at
// collection, never inside a case's clocked window (`check:test-source-alias`).
import '@objectstack/lint';
import { ObjectView } from './ObjectView';
import { ObjectDataPage } from './ObjectDataPage';
import { ExpressionProvider } from '../providers/ExpressionProvider';

const OBJECT_NAME = 'demo_credential';
const VIEW_ID = 'all';

/** The served operations of a list-only object: `list` and what derives from it, no `get`. */
const LIST_ONLY_OPERATIONS = ['list', 'aggregate', 'export', 'search'];

const ROWS = [
  { id: 'c1', connection: 'okta-staging', token_prefix: 'scim_ab12' },
  { id: 'c2', connection: 'azure-prod', token_prefix: 'scim_cd34' },
];

const OBJECTS = [
  {
    name: OBJECT_NAME,
    label: 'Credential',
    pluralLabel: 'Credentials',
    fields: {
      id: { type: 'text', label: 'Id' },
      connection: { type: 'text', label: 'Connection' },
      token_prefix: { type: 'text', label: 'Token prefix' },
    },
    actions: [
      {
        name: 'revoke_credential',
        label: 'Revoke',
        objectName: OBJECT_NAME,
        type: 'script',
        target: 'revoke_credential',
        locations: ['list_item', 'record_header'],
      },
    ],
    listViews: {
      [VIEW_ID]: { name: VIEW_ID, label: 'All', type: 'grid', columns: ['connection', 'token_prefix'] },
    },
  },
];

/** The caller's `/me/permissions` answer; `apiOperations` is the one variable. */
function answer(apiOperations?: string[]): MePermissionsAuthenticatedResponse {
  return {
    authenticated: true,
    userId: 'u1',
    tenantId: null,
    positions: [],
    hasAnyQueue: false,
    permissionSets: ['admin'],
    systemPermissions: [],
    objects: {
      [OBJECT_NAME]: {
        allowRead: true,
        allowCreate: true,
        allowEdit: true,
        allowDelete: true,
        ...(apiOperations ? { apiOperations } : {}),
      },
    },
    fields: {},
  } as MePermissionsAuthenticatedResponse;
}

function LocationProbe() {
  const location = useLocation();
  return (
    <>
      <output data-testid="location-pathname">{location.pathname}</output>
      <output data-testid="location-search">{location.search}</output>
    </>
  );
}

let openSpy: ReturnType<typeof vi.fn>;
let findOne: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.spyOn(HTMLElement.prototype, 'scrollIntoView').mockImplementation(() => {});
  vi.stubGlobal(
    'fetch',
    vi.fn(async () =>
      new Response(JSON.stringify({ data: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    ),
  );
  openSpy = vi.fn(() => null);
  vi.stubGlobal('open', openSpy);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  window.history.replaceState(null, '', '/');
});

const LIST_PATH = `/apps/setup/${OBJECT_NAME}/view/${VIEW_ID}`;

async function mountList(apiOperations: string[] | undefined, search = '') {
  findOne = vi.fn(async () => null);
  const dataSource = {
    find: vi.fn(async () => ({ data: ROWS, total: ROWS.length })),
    findOne,
    create: vi.fn(async () => ({})),
    update: vi.fn(async () => ({})),
    delete: vi.fn(async () => ({})),
    getObjectSchema: vi.fn(async (name: string) => OBJECTS.find((o) => o.name === name) ?? null),
  } as never;
  window.history.replaceState(null, '', LIST_PATH);
  render(
    <MePermissionsProvider initialPermissions={answer(apiOperations)}>
      <I18nProvider instance={createI18n({ defaultLanguage: 'en', detectBrowserLanguage: false })}>
        <ExpressionProvider user={{ id: 'u1', name: 'Ada', profile: 'admin' }}>
          <MemoryRouter initialEntries={[`${LIST_PATH}${search}`]}>
            <Routes>
              <Route
                path="/apps/:appName/:objectName/view/:viewId"
                element={<ObjectView dataSource={dataSource} objects={OBJECTS} onEdit={() => {}} />}
              />
              <Route path="*" element={<div data-testid="left-the-list" />} />
            </Routes>
            <LocationProbe />
          </MemoryRouter>
        </ExpressionProvider>
      </I18nProvider>
    </MePermissionsProvider>,
  );
  await screen.findByText('azure-prod', undefined, { timeout: 5000 });
}

/** Absence is only meaningful after the page has had a chance to react. */
async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 80));
  });
}

const pathname = () => screen.getByTestId('location-pathname').textContent;
const search = () => screen.getByTestId('location-search').textContent;

/** Open the row menu of the row showing `text`; answers the menu's item labels. */
async function rowMenuItems(text: string): Promise<string[]> {
  const row = screen.getByText(text).closest('tr')!;
  const trigger = await waitFor(() => {
    const t = within(row).getAllByRole('button').find((b) => b.getAttribute('aria-haspopup') === 'menu');
    expect(t).toBeDefined();
    return t!;
  }, { timeout: 5000 });
  fireEvent.pointerDown(trigger, { button: 0, pointerType: 'mouse' });
  const items = await screen.findAllByRole('menuitem', undefined, { timeout: 5000 });
  return items.map((item) => (item.textContent ?? '').trim());
}

describe('objectstack#33219 — a list-only object\'s rows open no record page', () => {
  it('a row click opens nothing: no `?recordId=`, no drawer, the list stays', async () => {
    await mountList(LIST_ONLY_OPERATIONS);
    fireEvent.click(screen.getByText('okta-staging'));
    await settle();
    expect(search()).toBe('');
    expect(pathname()).toBe(LIST_PATH);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.queryByTestId('left-the-list')).toBeNull();
    expect(findOne).not.toHaveBeenCalled();
  });

  it('a ⌘-click on the row opens no tab, and its name is no anchor a new tab could follow', async () => {
    await mountList(LIST_ONLY_OPERATIONS);
    // A cell outside the name link: the row's own click, with the modifier.
    fireEvent.click(screen.getByText('scim_ab12'), { metaKey: true });
    await settle();
    expect(openSpy).not.toHaveBeenCalled();
    expect(search()).toBe('');
    const row = screen.getByText('okta-staging').closest('tr')!;
    expect(row.querySelector('a[href]')).toBeNull();
  });

  it('the row draws no 「Open as full page」', async () => {
    await mountList(LIST_ONLY_OPERATIONS);
    await settle();
    expect(screen.queryByTestId('record-open-as-page')).toBeNull();
  });

  it('a `?recordId=` link opens no drawer and reads no record', async () => {
    await mountList(LIST_ONLY_OPERATIONS, '?recordId=c1');
    await settle();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(findOne).not.toHaveBeenCalled();
  });

  it('the row menu still offers the object\'s `list_item` action', async () => {
    await mountList(LIST_ONLY_OPERATIONS);
    expect(await rowMenuItems('okta-staging')).toContain('Revoke');
  });

  it('CONTROL — the same object served with no restriction: the row click opens the drawer', async () => {
    await mountList(undefined);
    expect(screen.getAllByTestId('record-open-as-page').length).toBeGreaterThan(0);
    expect(screen.getByText('okta-staging').closest('tr')!.querySelector('a[href]')).not.toBeNull();
    fireEvent.click(screen.getByText('scim_ab12'), { metaKey: true });
    expect(openSpy).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByText('okta-staging'));
    await waitFor(() => expect(search()).toBe('?recordId=c1'));
    expect(await screen.findByRole('dialog', undefined, { timeout: 5000 })).toBeTruthy();
  });
});

async function mountDataPage(apiOperations: string[] | undefined, search = '') {
  findOne = vi.fn(async () => null);
  const dataSource = {
    find: vi.fn(async () => ({ data: ROWS, total: ROWS.length })),
    findOne,
    create: vi.fn(async () => ({})),
    update: vi.fn(async () => ({})),
    delete: vi.fn(async () => ({})),
    getObjectSchema: vi.fn(async (name: string) => OBJECTS.find((o) => o.name === name) ?? null),
  } as never;
  const dataPath = `/apps/setup/${OBJECT_NAME}/data`;
  window.history.replaceState(null, '', dataPath);
  render(
    <MePermissionsProvider initialPermissions={answer(apiOperations)}>
      <I18nProvider instance={createI18n({ defaultLanguage: 'en', detectBrowserLanguage: false })}>
        <ExpressionProvider user={{ id: 'u1', name: 'Ada', profile: 'admin' }}>
          <MemoryRouter initialEntries={[`${dataPath}${search}`]}>
            <Routes>
              <Route path="/apps/:appName/:objectName/data" element={<ObjectDataPage dataSource={dataSource} objects={OBJECTS} />} />
              <Route path="*" element={<div data-testid="left-the-list" />} />
            </Routes>
            <LocationProbe />
          </MemoryRouter>
        </ExpressionProvider>
      </I18nProvider>
    </MePermissionsProvider>,
  );
  await screen.findByText('azure-prod', undefined, { timeout: 5000 });
}

describe('objectstack#33219 — the bare data page opens no record of a list-only object', () => {
  it('a row click and a ⌘-click open nothing', async () => {
    await mountDataPage(LIST_ONLY_OPERATIONS);
    fireEvent.click(screen.getByText('scim_ab12'));
    fireEvent.click(screen.getByText('scim_ab12'), { metaKey: true });
    await settle();
    expect(search()).toBe('');
    expect(openSpy).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.queryByTestId('left-the-list')).toBeNull();
  });

  it('a `?recordId=` link opens no drawer and reads no record', async () => {
    await mountDataPage(LIST_ONLY_OPERATIONS, '?recordId=c1');
    await settle();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(findOne).not.toHaveBeenCalled();
  });

  it('CONTROL — the same object served with no restriction: the row click opens the drawer', async () => {
    await mountDataPage(undefined);
    fireEvent.click(screen.getByText('scim_ab12'));
    await waitFor(() => expect(search()).toBe('?recordId=c1'));
    expect(await screen.findByRole('dialog', undefined, { timeout: 5000 })).toBeTruthy();
  });
});
