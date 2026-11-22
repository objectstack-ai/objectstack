/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#35875 — the bare data page (`ObjectDataPage`,
 * `/apps/:app/:object/data`) opens a record by the list's one rule
 * (objectstack#35854), as the object list does:
 *
 *   - the record's name opens the full page, which carries the data page as
 *     its origin: its URL with its conditions, its name, the rows it shows and
 *     the count it matched;
 *   - the name cell's 「在侧边打开」 icon opens the side drawer over the list,
 *     through `?recordId=`, and the list stays;
 *   - a click on any other cell opens nothing;
 *   - the page's way back (`useRecordPageReturn().toList`, the top bar's ✕)
 *     lands on the data page with its conditions;
 *   - a list-only object draws no icon.
 *
 * Driven through the real `ObjectDataPage`, the real `ListView` grid and the
 * real `MePermissionsProvider`. The record body is not what this file reads,
 * so `RecordDetailView` is a null sink; the record route mounts a probe that
 * reads the page's origin with the hook the record page's top bar uses.
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

// The record body: not what this file reads.
vi.mock('./RecordDetailView', () => ({ RecordDetailView: () => null }));

vi.mock('./metadata-admin/useMetadata', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useMetadataClient: () => ({ save: vi.fn(async () => ({})), get: vi.fn(async () => null) }),
}));

// The page reaches a dynamic `import('@objectstack/lint')`: pay its load at
// collection, never inside a case's clocked window (`check:test-source-alias`).
import '@objectstack/lint';
import { ObjectDataPage } from './ObjectDataPage';
import { useRecordPageReturn } from './recordDrawerStack';
import { ExpressionProvider } from '../providers/ExpressionProvider';

const OBJECT_NAME = 'demo_account';
const DATA_PATH = `/apps/sales/${OBJECT_NAME}/data`;
/** The data page's own condition: its address is the list. */
const DATA_SEARCH = '?filter[status]=active';

/** The served operations of a list-only object: `list` and what derives from it, no `get`. */
const LIST_ONLY_OPERATIONS = ['list', 'aggregate', 'export', 'search'];

const ROWS = [
  { id: 'a1', name: 'Acme', status: 'active', city: 'Lyon' },
  { id: 'a2', name: 'Globex', status: 'active', city: 'Oslo' },
];
const MATCHED = 7;

const OBJECTS = [
  {
    name: OBJECT_NAME,
    label: 'Account',
    pluralLabel: 'Accounts',
    fields: {
      name: { type: 'text', label: 'Name' },
      status: { type: 'text', label: 'Status' },
      city: { type: 'text', label: 'City' },
    },
  },
];

function answer(apiOperations?: string[]): MePermissionsAuthenticatedResponse {
  return {
    authenticated: true,
    userId: 'u1',
    tenantId: null,
    positions: [],
    hasAnyQueue: false,
    objectsUsingQueues: [],
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

/** The record route: the page's origin as the history state carries it, and its ✕. */
function RecordPageProbe() {
  const location = useLocation();
  const recordId = location.pathname.split('/').pop();
  const pageReturn = useRecordPageReturn(recordId);
  const from = (location.state as { from?: unknown } | null)?.from;
  const position = pageReturn.stepper?.position;
  return (
    <div data-testid="record-page">
      <output data-testid="record-from">{JSON.stringify(from ?? null)}</output>
      <output data-testid="record-position">
        {position ? `${position.index + 1}/${position.total}` : ''}
      </output>
      {pageReturn.toList && (
        <button type="button" data-testid="record-close" onClick={pageReturn.toList}>close</button>
      )}
    </div>
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

async function mountDataPage(apiOperations?: string[]) {
  findOne = vi.fn(async () => null);
  const dataSource = {
    find: vi.fn(async () => ({ data: ROWS, total: MATCHED })),
    findOne,
    create: vi.fn(async () => ({})),
    update: vi.fn(async () => ({})),
    delete: vi.fn(async () => ({})),
    getObjectSchema: vi.fn(async (name: string) => OBJECTS.find((o) => o.name === name) ?? null),
  } as never;
  window.history.replaceState(null, '', DATA_PATH);
  render(
    <MePermissionsProvider initialPermissions={answer(apiOperations)}>
      <I18nProvider instance={createI18n({ defaultLanguage: 'en', detectBrowserLanguage: false })}>
        <ExpressionProvider user={{ id: 'u1', name: 'Ada', profile: 'admin' }}>
          <MemoryRouter initialEntries={[`${DATA_PATH}${DATA_SEARCH}`]}>
            <Routes>
              <Route path="/apps/:appName/:objectName/data" element={<ObjectDataPage dataSource={dataSource} objects={OBJECTS} />} />
              <Route path="/apps/:appName/:objectName/record/:recordId" element={<RecordPageProbe />} />
            </Routes>
            <LocationProbe />
          </MemoryRouter>
        </ExpressionProvider>
      </I18nProvider>
    </MePermissionsProvider>,
  );
  await screen.findByText('Globex', undefined, { timeout: 5000 });
}

/** Absence is only meaningful after the page has had a chance to react. */
async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 80));
  });
}

const pathname = () => screen.getByTestId('location-pathname').textContent;
const search = () => screen.getByTestId('location-search').textContent;
const rowOf = (text: string) => screen.getByText(text).closest('tr') as HTMLElement;

/** A plain click on the record's name, the record link the name cell draws. */
function clickName(text: string): void {
  const row = rowOf(text);
  const link = within(row).getByText(text).closest('a, [role="link"]') as HTMLElement;
  expect(link).not.toBeNull();
  fireEvent.click(link);
}

describe('objectstack#35875 — the bare data page opens a record by the list\'s one rule', () => {
  it('the name opens the full page, which carries the data page as its origin', async () => {
    await mountDataPage();
    clickName('Acme');
    await screen.findByTestId('record-page', undefined, { timeout: 5000 });
    expect(pathname()).toBe(`/apps/sales/${OBJECT_NAME}/record/a1`);
    const from = JSON.parse(screen.getByTestId('record-from').textContent ?? 'null');
    expect(from).toEqual({
      pathname: `${DATA_PATH}?${new URLSearchParams(DATA_SEARCH).toString()}`,
      label: 'Accounts',
      siblings: ['a1', 'a2'],
      total: MATCHED,
    });
    // The page's top bar counts the record among the data page's matched rows.
    expect(screen.getByTestId('record-position').textContent).toBe(`1/${MATCHED}`);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('the name cell\'s hover icon opens the side drawer over the list, which stays', async () => {
    await mountDataPage();
    const icon = within(rowOf('Acme')).getByTestId('record-open-in-panel');
    expect(icon.getAttribute('aria-label')).toBe('Open in side panel');
    fireEvent.click(icon);
    await waitFor(() => expect(new URLSearchParams(search() ?? '').get('recordId')).toBe('a1'));
    expect(pathname()).toBe(DATA_PATH);
    expect(await screen.findByRole('dialog', undefined, { timeout: 5000 })).toBeTruthy();
    expect(screen.queryByTestId('record-page')).toBeNull();
  });

  it('a click on any other cell of the row opens nothing', async () => {
    await mountDataPage();
    fireEvent.click(within(rowOf('Acme')).getByText('Lyon'));
    await settle();
    expect(pathname()).toBe(DATA_PATH);
    expect(new URLSearchParams(search() ?? '').get('recordId')).toBeNull();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.queryByTestId('record-page')).toBeNull();
    expect(openSpy).not.toHaveBeenCalled();
  });

  it('the full page\'s ✕ returns to the data page with its conditions', async () => {
    await mountDataPage();
    clickName('Globex');
    fireEvent.click(await screen.findByTestId('record-close', undefined, { timeout: 5000 }));
    await screen.findByText('Globex', undefined, { timeout: 5000 });
    expect(pathname()).toBe(DATA_PATH);
    expect(new URLSearchParams(search() ?? '').get('filter[status]')).toBe('active');
    expect(screen.getByTestId('object-data-page')).toBeTruthy();
  });

  it('a list-only object draws no 「Open in side panel」, and its name opens no page', async () => {
    await mountDataPage(LIST_ONLY_OPERATIONS);
    await settle();
    expect(screen.queryByTestId('record-open-in-panel')).toBeNull();
    fireEvent.click(screen.getByText('Acme'));
    await settle();
    expect(pathname()).toBe(DATA_PATH);
    expect(screen.queryByTestId('record-page')).toBeNull();
  });
});
