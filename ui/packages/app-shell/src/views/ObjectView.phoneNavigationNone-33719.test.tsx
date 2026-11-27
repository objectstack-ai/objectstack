/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#33719 (ruling A) — on a phone, an authored "no navigation" holds.
 *
 * The phone rule (objectstack#27058) decides HOW a record opens — as a page,
 * since a phone has no drawer — never WHETHER it opens. A list whose view
 * authors `navigation: { mode: 'none' }` or `navigation: { preventNavigation:
 * true }` therefore resolves to `none` on a phone as on a desktop: its phone
 * card draws no pointer and no hover wash (`rowOpensRecord`), a tap on it
 * opens nothing, and a `?recordId=` link to one of its rows opens no record
 * page (the desktop draws no pane for it).
 *
 * Driven at 375 px through the real `ObjectView`, `ListView`, grid and
 * `MePermissionsProvider`: one differential per spelling, the same object and
 * rows, only the view's `navigation` differs. CONTROL: a list with no authored
 * navigation keeps its pointer, and both its tap and its `?recordId=` link
 * open the record page.
 *
 * The record body is not what this file reads, so `RecordDetailView` is a
 * null sink.
 */

import * as React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';
import { createI18n, I18nProvider } from '@object-ui/i18n';
import { MePermissionsProvider, type MePermissionsAuthenticatedResponse } from '@object-ui/permissions';
import { SchemaRendererProvider } from '@object-ui/react';

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
import { ExpressionProvider } from '../providers/ExpressionProvider';

const OBJECT_NAME = 'demo_credential';
const VIEW_ID = 'all';
const LIST_PATH = `/apps/setup/${OBJECT_NAME}/view/${VIEW_ID}`;
const PHONE_WIDTH = 375;

const ROWS = [
  { id: 'c1', name: 'Okta staging', connection: 'okta-staging' },
  { id: 'c2', name: 'Azure prod', connection: 'azure-prod' },
];

type Navigation = { mode?: 'none'; preventNavigation?: boolean };

/** The two authored spellings of "rows open nothing". */
const NO_NAVIGATION: Array<[string, Navigation]> = [
  ['`navigation.mode: none`', { mode: 'none' }],
  ['`navigation.preventNavigation: true`', { preventNavigation: true }],
];

/** The object and its one grid view, carrying `navigation` when given. */
function objectsWith(navigation?: Navigation) {
  return [
    {
      name: OBJECT_NAME,
      label: 'Credential',
      pluralLabel: 'Credentials',
      nameField: 'name',
      fields: {
        id: { type: 'text', label: 'Id' },
        name: { type: 'text', label: 'Name' },
        connection: { type: 'text', label: 'Connection' },
      },
      listViews: {
        [VIEW_ID]: {
          name: VIEW_ID,
          label: 'All',
          type: 'grid',
          columns: ['name', 'connection'],
          ...(navigation ? { navigation } : {}),
        },
      },
    },
  ];
}

/** The caller's `/me/permissions` answer: a served object it may read. */
const ANSWER = {
  authenticated: true,
  userId: 'u1',
  tenantId: null,
  positions: [],
  hasAnyQueue: false,
  objectsUsingQueues: [],
  permissionSets: ['admin'],
  systemPermissions: [],
  objects: {
    [OBJECT_NAME]: { allowRead: true, allowCreate: true, allowEdit: true, allowDelete: true },
  },
  fields: {},
} as MePermissionsAuthenticatedResponse;

let openSpy: ReturnType<typeof vi.fn>;
const DESKTOP_WIDTH = window.innerWidth;

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
  Object.defineProperty(window, 'innerWidth', { value: PHONE_WIDTH, configurable: true, writable: true });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  Object.defineProperty(window, 'innerWidth', { value: DESKTOP_WIDTH, configurable: true, writable: true });
  window.history.replaceState(null, '', '/');
});

/** Where the console stands: its path and its query. */
function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location">{location.pathname + location.search}</div>;
}

/** Mounts the list at phone width, at `LIST_PATH` plus `search`. */
function mountList(navigation: Navigation | undefined, search = '') {
  const objects = objectsWith(navigation);
  const dataSource = {
    find: vi.fn(async () => ({ data: ROWS, total: ROWS.length })),
    findOne: vi.fn(async () => null),
    create: vi.fn(async () => ({})),
    update: vi.fn(async () => ({})),
    delete: vi.fn(async () => ({})),
    getObjectSchema: vi.fn(async (name: string) => objects.find((o) => o.name === name) ?? null),
  } as never;
  window.history.replaceState(null, '', LIST_PATH + search);
  render(
    <SchemaRendererProvider dataSource={dataSource}>
    <MePermissionsProvider initialPermissions={ANSWER}>
      <I18nProvider instance={createI18n({ defaultLanguage: 'en', detectBrowserLanguage: false })}>
        <ExpressionProvider user={{ id: 'u1', name: 'Ada', profile: 'admin' }}>
          <MemoryRouter initialEntries={[LIST_PATH + search]}>
            <Routes>
              <Route
                path="/apps/:appName/:objectName/view/:viewId"
                element={
                  <>
                    <ObjectView dataSource={dataSource} objects={objects} onEdit={() => {}} />
                    <LocationProbe />
                  </>
                }
              />
              <Route path="*" element={<LocationProbe />} />
            </Routes>
          </MemoryRouter>
        </ExpressionProvider>
      </I18nProvider>
    </MePermissionsProvider>
    </SchemaRendererProvider>,
  );
}

const location = () => screen.getByTestId('location').textContent;

/** The phone card showing `title`. */
async function phoneCard(title: string): Promise<HTMLElement> {
  const cards = await screen.findAllByTestId('grid-mobile-card', undefined, { timeout: 5000 });
  const card = cards.find((c) => (c.textContent ?? '').includes(title));
  expect(card).toBeTruthy();
  return card as HTMLElement;
}

/** Whether `el` wears a clickable face: the pointer, or a hover wash. */
function looksClickable(el: HTMLElement): boolean {
  return /(^|\s)(cursor-pointer|hover:bg-accent\/50)(\s|$)/.test(el.className);
}

describe('objectstack#33719 — on a phone, a list authored to open nothing opens nothing', () => {
  it.each(NO_NAVIGATION)('%s: the card is not drawn tappable and a tap opens nothing', async (_name, navigation) => {
    mountList(navigation);
    const card = await phoneCard('Okta staging');
    expect(looksClickable(card)).toBe(false);
    const before = location();
    fireEvent.click(card);
    expect(location()).toBe(before);
    expect(location()).not.toContain('/record/');
    expect(openSpy).not.toHaveBeenCalled();
  });

  it.each(NO_NAVIGATION)('%s: a `?recordId=` link opens no record page, as it opens no pane on a desktop', async (_name, navigation) => {
    mountList(navigation, '?recordId=c1');
    // The list is drawn: the URL-sync effect has run by now.
    await phoneCard('Okta staging');
    expect(location()).toBe(`${LIST_PATH}?recordId=c1`);
    expect(screen.queryByTestId('record-drawer-crumb')).toBeNull();
  });

  it('CONTROL — a list with no authored navigation: the card wears the pointer and a tap opens the record page', async () => {
    mountList(undefined);
    const card = await phoneCard('Okta staging');
    expect(card.className).toMatch(/(^|\s)cursor-pointer(\s|$)/);
    fireEvent.click(card);
    await waitFor(() => expect(location()).toContain('/record/c1'));
  });

  it('CONTROL — a list with no authored navigation: a `?recordId=` link opens the record page', async () => {
    mountList(undefined, '?recordId=c1');
    await waitFor(() => expect(location()).toContain('/record/c1'), { timeout: 5000 });
  });
});
