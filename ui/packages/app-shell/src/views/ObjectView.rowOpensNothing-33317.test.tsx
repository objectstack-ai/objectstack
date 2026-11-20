/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#33317 — a grid row that opens nothing does not look clickable.
 *
 * A row's record navigation resolves to `none` in two ways on the console's
 * object list: the view authors `navigation: { mode: 'none' }`, or the object
 * is list-only (its served operations leave `get` out, `servesRecordRead`,
 * objectstack#33219). Either way a click on the row opens nothing, so the grid
 * draws its record-link column as plain text — no anchor, no `role="link"` —
 * and the row's right-click menu offers no Open / Open in new tab; the row's
 * own `list_item` action (Revoke) stays.
 *
 * Driven through the real `ObjectView`, the real `ListView` grid and the real
 * `MePermissionsProvider`, one differential per case: the same object and
 * rows, only the view's `navigation` or the served operation set differs.
 * CONTROL: a row that opens (the default drawer, an authored `page`) keeps
 * its link and its Open item. objectstack#33548: an authored `none` row opens
 * nothing on a ⌘, Ctrl or middle click either; a row that opens still does. The bare data page (`ObjectDataPage`) routes
 * its own row clicks, so its list-only face is pinned too. objectstack#33549:
 * a view authored `navigation.preventNavigation: true` resolves the same way
 * whatever its mode, with the same `drawer` view minus the flag as CONTROL.
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

/** A list view's authored `navigation` block, as these cases write it. */
type AuthoredNavigation = { mode?: string; preventNavigation?: boolean };

/** The object, its one list view carrying `navigation` when given. */
function objectsWith(navigation?: AuthoredNavigation) {
  return [
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
        [VIEW_ID]: {
          name: VIEW_ID,
          label: 'All',
          type: 'grid',
          columns: ['connection', 'token_prefix'],
          ...(navigation ? { navigation } : {}),
        },
      },
    },
  ];
}

/** The caller's `/me/permissions` answer; `apiOperations` is the one variable. */
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

let openSpy: ReturnType<typeof vi.fn>;

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

function dataSourceFor(objects: ReturnType<typeof objectsWith>) {
  return {
    find: vi.fn(async () => ({ data: ROWS, total: ROWS.length })),
    findOne: vi.fn(async () => null),
    create: vi.fn(async () => ({})),
    update: vi.fn(async () => ({})),
    delete: vi.fn(async () => ({})),
    getObjectSchema: vi.fn(async (name: string) => objects.find((o) => o.name === name) ?? null),
  } as never;
}

function withProviders(apiOperations: string[] | undefined, children: React.ReactNode) {
  return (
    <MePermissionsProvider initialPermissions={answer(apiOperations)}>
      <I18nProvider instance={createI18n({ defaultLanguage: 'en', detectBrowserLanguage: false })}>
        <ExpressionProvider user={{ id: 'u1', name: 'Ada', profile: 'admin' }}>{children}</ExpressionProvider>
      </I18nProvider>
    </MePermissionsProvider>
  );
}

/** The list route's query string, drawn where a case can read it: the drawer's `?recordId=` lands here. */
function LocationProbe() {
  const { search } = useLocation();
  return <output data-testid="list-search">{search}</output>;
}

/** The record the drawer's `?recordId=` names on the list route, or `null`. */
function drawerRecordId(): string | null {
  return new URLSearchParams(screen.getByTestId('list-search').textContent ?? '').get('recordId');
}

async function mountList(opts: { apiOperations?: string[]; navigation?: AuthoredNavigation }) {
  const objects = objectsWith(opts.navigation);
  window.history.replaceState(null, '', LIST_PATH);
  render(
    withProviders(
      opts.apiOperations,
      <MemoryRouter initialEntries={[LIST_PATH]}>
        <Routes>
          <Route
            path="/apps/:appName/:objectName/view/:viewId"
            element={(
              <>
                <ObjectView dataSource={dataSourceFor(objects)} objects={objects} onEdit={() => {}} />
                <LocationProbe />
              </>
            )}
          />
          <Route path="*" element={<div data-testid="left-the-list" />} />
        </Routes>
      </MemoryRouter>,
    ),
  );
  await screen.findByText('azure-prod', undefined, { timeout: 5000 });
  // The row actions land with the object schema; read nothing before them.
  await waitFor(
    () => expect(screen.getAllByRole('button').some((b) => b.getAttribute('aria-haspopup') === 'menu')).toBe(true),
    { timeout: 5000 },
  );
}

async function mountDataPage(apiOperations: string[] | undefined) {
  const objects = objectsWith();
  const dataPath = `/apps/setup/${OBJECT_NAME}/data`;
  window.history.replaceState(null, '', dataPath);
  render(
    withProviders(
      apiOperations,
      <MemoryRouter initialEntries={[dataPath]}>
        <Routes>
          <Route
            path="/apps/:appName/:objectName/data"
            element={<ObjectDataPage dataSource={dataSourceFor(objects)} objects={objects} />}
          />
        </Routes>
      </MemoryRouter>,
    ),
  );
  await screen.findByText('azure-prod', undefined, { timeout: 5000 });
}

/** The cell the row's record-link column draws for the row showing `text`. */
function nameCell(text: string): HTMLElement {
  return screen.getByText(text).closest('td') as HTMLElement;
}

/** Whether that cell wears the link face: an anchor, or a `role="link"` span. */
function looksLikeALink(text: string): boolean {
  const cell = nameCell(text);
  return cell.querySelector('a[href], [role="link"]') !== null;
}

/** Right-click the row's plain cell; answers the context menu's item test ids and labels. */
async function contextMenuOf(plainText: string): Promise<{ ids: (string | null)[]; labels: string[] }> {
  const cell = screen.getByText(plainText).closest('td') as HTMLElement;
  act(() => {
    fireEvent.contextMenu(cell, { button: 2, clientX: 40, clientY: 60 });
  });
  const menu = await screen.findByTestId('row-context-menu', undefined, { timeout: 5000 });
  const items = within(menu).queryAllByRole('menuitem');
  return {
    ids: items.map((el) => el.getAttribute('data-testid')),
    labels: items.map((el) => (el.textContent ?? '').trim()),
  };
}

const OPEN_ITEMS = ['row-context-open', 'row-context-open-new-tab'];

/**
 * objectstack#35684 — the list's other way to open a row: a click on a data
 * cell selects it (and opens nothing), and Space on the selected cell opens
 * its record, as the row's click used to.
 */
function openWithSpace(text: string): void {
  fireEvent.click(screen.getByText(text).closest('td') as HTMLElement);
  fireEvent.keyDown(document.activeElement as HTMLElement, { key: ' ' });
}

describe('objectstack#33317 — the console object list: a row that opens nothing does not look clickable', () => {
  it('authored `navigation.mode: none`: the name cell is plain text, and the right-click menu has no Open but keeps Revoke', async () => {
    await mountList({ navigation: { mode: 'none' } });
    expect(looksLikeALink('okta-staging')).toBe(false);
    expect(screen.queryAllByTestId('primary-field-link')).toHaveLength(0);
    const menu = await contextMenuOf('scim_ab12');
    expect(menu.ids.filter((id) => OPEN_ITEMS.includes(id ?? ''))).toEqual([]);
    expect(menu.labels).toContain('Revoke');
  });

  it('authored `none` opens no record by any click: a ⌘, Ctrl or middle click on the row opens no new tab (objectstack#33548)', async () => {
    await mountList({ navigation: { mode: 'none' } });
    // A cell outside the record link: the row's own click, with each modifier.
    fireEvent.click(screen.getByText('scim_ab12'), { metaKey: true });
    fireEvent.click(screen.getByText('scim_ab12'), { ctrlKey: true });
    fireEvent.click(screen.getByText('scim_ab12'), { button: 1 });
    // The name cell, no longer a link of its own, hands its click to the row too.
    fireEvent.click(screen.getByText('okta-staging'), { metaKey: true });
    openWithSpace('scim_ab12');
    expect(openSpy).not.toHaveBeenCalled();
    expect(screen.queryByTestId('left-the-list')).toBeNull();
  });

  it('a list-only object opens no new tab on a ⌘ or middle click either', async () => {
    await mountList({ apiOperations: LIST_ONLY_OPERATIONS });
    fireEvent.click(screen.getByText('scim_ab12'), { metaKey: true });
    fireEvent.click(screen.getByText('scim_ab12'), { button: 1 });
    expect(openSpy).not.toHaveBeenCalled();
  });

  it('CONTROL — the default drawer: a ⌘, Ctrl or middle click on the record link is the browser\'s new tab, and on a data cell opens nothing (objectstack#35684)', async () => {
    await mountList({});
    const link = within(nameCell('okta-staging')).getByTestId('primary-field-link');
    expect(link.getAttribute('href')).toContain('c1');
    // `fireEvent` answers false when the default was prevented: these keep the browser's.
    expect(fireEvent.click(link, { metaKey: true })).toBe(true);
    expect(fireEvent.click(link, { ctrlKey: true })).toBe(true);
    expect(fireEvent.click(link, { button: 1 })).toBe(true);
    fireEvent.click(screen.getByText('scim_ab12'), { metaKey: true });
    expect(openSpy).not.toHaveBeenCalled();
    expect(drawerRecordId()).toBeNull();
  });

  it('a list-only object: the name cell is plain text, and the right-click menu has no Open but keeps Revoke', async () => {
    await mountList({ apiOperations: LIST_ONLY_OPERATIONS });
    expect(looksLikeALink('okta-staging')).toBe(false);
    expect(screen.queryAllByTestId('primary-field-link')).toHaveLength(0);
    const menu = await contextMenuOf('scim_ab12');
    expect(menu.ids.filter((id) => OPEN_ITEMS.includes(id ?? ''))).toEqual([]);
    expect(menu.labels).toContain('Revoke');
  });

  it('CONTROL — the default drawer: the name cell is the record link, and the right-click menu offers Open', async () => {
    await mountList({});
    expect(looksLikeALink('okta-staging')).toBe(true);
    expect(within(nameCell('okta-staging')).getByTestId('primary-field-link')).toBeTruthy();
    const menu = await contextMenuOf('scim_ab12');
    expect(menu.ids).toContain('row-context-open');
    expect(menu.ids).toContain('row-context-open-new-tab');
    expect(menu.labels).toContain('Revoke');
  });

  it('CONTROL — an authored `page`: the name cell is the record link, and the right-click menu offers Open', async () => {
    await mountList({ navigation: { mode: 'page' } });
    expect(looksLikeALink('okta-staging')).toBe(true);
    const menu = await contextMenuOf('scim_ab12');
    expect(menu.ids).toContain('row-context-open');
  });
});

describe('objectstack#33317 — the bare data page: a list-only object\'s rows do not look clickable', () => {
  it('a list-only object: the name cell is plain text', async () => {
    await mountDataPage(LIST_ONLY_OPERATIONS);
    expect(looksLikeALink('okta-staging')).toBe(false);
    expect(screen.queryAllByTestId('primary-field-link')).toHaveLength(0);
  });

  it('CONTROL — the same object served with no restriction: the name cell is the record link', async () => {
    await mountDataPage(undefined);
    expect(looksLikeALink('okta-staging')).toBe(true);
  });
});

describe('objectstack#33549 — the console object list: `navigation.preventNavigation: true` opens no record, whatever the mode', () => {
  const PREVENTED_DRAWER = { mode: 'drawer', preventNavigation: true };

  it('a `drawer` view with `preventNavigation: true`: a row click writes no `?recordId=` and stays on the list', async () => {
    await mountList({ navigation: PREVENTED_DRAWER });
    fireEvent.click(screen.getByText('scim_ab12'));
    fireEvent.click(screen.getByText('okta-staging'));
    openWithSpace('scim_ab12');
    expect(drawerRecordId()).toBeNull();
    expect(screen.queryByTestId('left-the-list')).toBeNull();
    expect(openSpy).not.toHaveBeenCalled();
  });

  it('…nor does a ⌘, Ctrl or middle click open a new tab', async () => {
    await mountList({ navigation: PREVENTED_DRAWER });
    fireEvent.click(screen.getByText('scim_ab12'), { metaKey: true });
    fireEvent.click(screen.getByText('scim_ab12'), { ctrlKey: true });
    fireEvent.click(screen.getByText('scim_ab12'), { button: 1 });
    expect(openSpy).not.toHaveBeenCalled();
    expect(drawerRecordId()).toBeNull();
  });

  it('…and the row draws no link face: the name cell is plain text, and the right-click menu has no Open but keeps Revoke', async () => {
    await mountList({ navigation: PREVENTED_DRAWER });
    expect(looksLikeALink('okta-staging')).toBe(false);
    expect(screen.queryAllByTestId('primary-field-link')).toHaveLength(0);
    const menu = await contextMenuOf('scim_ab12');
    expect(menu.ids.filter((id) => OPEN_ITEMS.includes(id ?? ''))).toEqual([]);
    expect(menu.labels).toContain('Revoke');
  });

  it('a `page` view with `preventNavigation: true` draws no link face either', async () => {
    await mountList({ navigation: { mode: 'page', preventNavigation: true } });
    expect(looksLikeALink('okta-staging')).toBe(false);
    openWithSpace('scim_ab12');
    expect(screen.queryByTestId('left-the-list')).toBeNull();
  });

  it('CONTROL — the same `drawer` view with `preventNavigation: false`: Space on a selected cell writes `?recordId=`, and the name cell is the record link', async () => {
    await mountList({ navigation: { mode: 'drawer', preventNavigation: false } });
    expect(looksLikeALink('okta-staging')).toBe(true);
    openWithSpace('scim_ab12');
    await waitFor(() => expect(drawerRecordId()).toBe('c1'));
  });

  it('CONTROL — the same `drawer` view with the flag absent: the record link writes `?recordId=`', async () => {
    await mountList({ navigation: { mode: 'drawer' } });
    fireEvent.click(within(nameCell('okta-staging')).getByTestId('primary-field-link'));
    await waitFor(() => expect(drawerRecordId()).toBe('c1'));
  });
});
