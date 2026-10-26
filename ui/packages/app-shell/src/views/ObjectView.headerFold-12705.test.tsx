/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#12705 — the object list's header folds its actions before it cuts
 * the description. The list declares the folded face it hands the header:
 *
 * - the primary action stays labelled: the page's New when it draws one, else
 *   the toolbar action authored `variant: 'primary'` (`sys_user`'s Invite
 *   User) — declared, never the first in the row;
 * - every other action goes into ONE `⋯` menu, above the page's own entries:
 *   Import, the other toolbar actions, then Add to favorites.
 *
 * Labels read as their i18n keys: this harness mounts no translation bundle.
 *
 * happy-dom lays nothing out, so `installLayout` models the header as in
 * `layout/__tests__/PageHeader.actionsFold-12705.test.tsx`: a labelled button
 * is 100 px, an icon button 32 px, 8 px between them; a title character 10 px,
 * a description character 7 px; the row's padding and gap 60 px.
 */

import * as React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, screen, within, fireEvent } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

/** Controllable principal verdict, keyed by action (`can()` is permissive by default). */
let principal: Record<string, boolean> = {};

vi.mock('@object-ui/permissions', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@object-ui/permissions')>();
  return {
    ...actual,
    usePermissions: () => ({
      check: () => ({ allowed: true }),
      checkField: () => true,
      getFieldPermissions: () => [],
      getRowFilter: () => undefined,
      getObjectApiOperations: () => undefined,
      roles: [],
      isLoaded: false,
      hasCapabilities: () => true,
      can: (_object: string, action: string) => principal[action] ?? true,
      cannot: (_object: string, action: string) => !(principal[action] ?? true),
    }),
    useFieldPermissions: () => ({ canRead: () => true, canWrite: () => true, permissions: [] }),
  };
});

vi.mock('@object-ui/auth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAuth: () => ({ user: { id: 'u1', name: 'Ada' }, activeOrganization: null }),
  useWorkspaceAdminStatus: () => ({ isAdmin: false, isResolved: true }),
  createAuthenticatedFetch: () => vi.fn(),
}));

vi.mock('@object-ui/collaboration', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useRealtimeSubscription: () => ({ lastMessage: null }),
  useConflictResolution: () => ({ hasConflicts: false, resolveAllConflicts: () => {} }),
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

// Heavy children: orthogonal to the toolbar gate under test, and each drags in
// a plugin bundle. Same posture as the sibling RecordDetailView render tests.
vi.mock('@object-ui/plugin-list', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@object-ui/plugin-list')>()),
  ListView: () => null,
}));
vi.mock('@object-ui/plugin-view', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  ObjectView: () => null,
  ViewTabBar: () => null,
  ManageViewsDialog: () => null,
}));
vi.mock('./MetadataInspector', () => ({
  MetadataPanel: () => null,
  useMetadataInspector: () => ({ showDebug: false, toggle: () => {} }),
}));
vi.mock('./RecordDetailView', () => ({ RecordDetailView: () => null }));
// The import wizard is a lazy plugin bundle; a stand-in shows it opened.
vi.mock('@object-ui/plugin-grid', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  ImportWizard: ({ open }: { open: boolean }) => (open ? <div data-testid="import-wizard" /> : null),
}));

import { ObjectView, declaredPrimaryToolbarAction } from './ObjectView';
import { ExpressionProvider } from '../providers/ExpressionProvider';

const USER = { id: 'u1', name: 'Ada', profile: 'admin' };

const UPDATE_STAGE = { name: 'update_stage', label: 'Update Stage', type: 'script', locations: ['list_toolbar'] };
const INVITE = { name: 'invite_user', label: 'Invite User', type: 'script', variant: 'primary', locations: ['list_toolbar'] };
const CREATE_USER = { name: 'create_user', label: 'Create User', type: 'script', locations: ['list_toolbar'] };

/** An opportunity-like list: New, Import, one toolbar action. */
const OPPORTUNITY = {
  name: 'demo_opportunity',
  label: 'Opportunity',
  pluralLabel: 'Opportunities',
  description: 'Sales opportunities and deals in the pipeline',
  fields: { id: { type: 'text', label: 'Id' }, name: { type: 'text', label: 'Name' } },
  actions: [UPDATE_STAGE],
};

/** A `sys_user`-like list: no New; Import; a primary-variant toolbar action and another. */
const USERS = {
  name: 'demo_user',
  label: 'User',
  pluralLabel: 'Users',
  description: 'User accounts for authentication',
  fields: { id: { type: 'text', label: 'Id' }, name: { type: 'text', label: 'Name' } },
  userActions: { create: false },
  actions: [CREATE_USER, INVITE],
};

let headerWidth = 600;
const restores: Array<() => void> = [];

function installLayout() {
  const clusterWidth = (cluster: Element) => {
    const buttons = Array.from(cluster.querySelectorAll('button'));
    return (
      buttons.reduce((sum, b) => sum + ((b.textContent ?? '').trim() ? 100 : 32), 0) +
      8 * Math.max(0, buttons.length - 1)
    );
  };
  const rect = vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    let width = 0;
    if (this.matches('[data-testid="page-header-actions"]')) width = clusterWidth(this);
    else if (this.closest('[data-testid="page-header"]')) {
      if (this.tagName === 'H1') width = (this.textContent ?? '').length * 10;
      else if (this.matches('span[aria-hidden="true"]')) width = 1;
    }
    return { width, height: 0, top: 0, left: 0, right: width, bottom: 0, x: 0, y: 0, toJSON: () => ({}) } as DOMRect;
  });
  const range = vi.spyOn(Range.prototype, 'getBoundingClientRect').mockImplementation(function (this: Range) {
    const width = (this.startContainer.textContent ?? '').length * 7;
    return { width, height: 0, top: 0, left: 0, right: width, bottom: 0, x: 0, y: 0, toJSON: () => ({}) } as DOMRect;
  });
  const own = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth');
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
    configurable: true,
    get(this: HTMLElement) {
      const header = this.closest('[data-testid="page-header"]');
      if (!header || this !== header.querySelector('h1')?.parentElement) return 0;
      const cluster = header.querySelector('[data-testid="page-header-actions"]');
      return headerWidth - 60 - (cluster ? clusterWidth(cluster) : 0);
    },
  });
  restores.push(() => {
    rect.mockRestore();
    range.mockRestore();
    if (own) Object.defineProperty(HTMLElement.prototype, 'clientWidth', own);
    else delete (HTMLElement.prototype as unknown as Record<string, unknown>).clientWidth;
  });
}

function renderList(object: any, search = '') {
  installLayout();
  // The deep link is read off `window.location`, not the router.
  window.history.replaceState(null, '', `/apps/demo/${object.name}${search}`);
  render(
    <ExpressionProvider user={USER}>
      <MemoryRouter initialEntries={[`/apps/demo/${object.name}${search}`]}>
        <Routes>
          <Route
            path="/apps/:appName/:objectName"
            element={<ObjectView dataSource={makeDataSource()} objects={[object]} onEdit={() => {}} />}
          />
        </Routes>
      </MemoryRouter>
    </ExpressionProvider>,
  );
  const cluster = within(screen.getByTestId('page-header')).getByTestId('page-header-actions');
  const labelled = () =>
    within(cluster)
      .getAllByRole('button')
      .map((b) => (b.textContent ?? '').trim())
      .filter(Boolean);
  const openMenu = () => {
    const triggers = within(cluster).getAllByRole('button').filter((b) => b.getAttribute('aria-haspopup') === 'menu');
    expect(triggers).toHaveLength(1);
    fireEvent.pointerDown(triggers[0], { button: 0, pointerType: 'mouse' });
    return screen.getAllByRole('menuitem').map((item) => (item.textContent ?? '').trim());
  };
  return { cluster, labelled, openMenu };
}

function makeDataSource() {
  return {
    find: vi.fn(async () => ({ data: [], total: 0 })),
    findOne: vi.fn(async () => null),
    create: vi.fn(async () => ({})),
    update: vi.fn(async () => ({})),
    delete: vi.fn(async () => ({})),
  } as any;
}

beforeEach(() => {
  principal = {};
  cleanup();
  headerWidth = 600;
  vi.stubGlobal(
    'fetch',
    vi.fn(async () =>
      new Response(JSON.stringify({ data: [] }), { status: 200, headers: { 'content-type': 'application/json' } }),
    ),
  );
});

afterEach(() => {
  cleanup();
  while (restores.length) restores.pop()!();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('the object list’s header folds its actions (objectui#12705)', () => {
  it('at a 600 px header New stays labelled and Import and the toolbar action go into the one ⋯, above favorites', () => {
    const { cluster, labelled, openMenu } = renderList(OPPORTUNITY);
    expect(cluster.getAttribute('data-folded')).toBe('true');
    expect(labelled()).toEqual(['console.objectView.new']);
    expect(within(cluster).getByTestId('object-view-new-button')).toBeTruthy();
    expect(within(screen.getByTestId('page-header')).getByText(OPPORTUNITY.description).textContent)
      .toBe(OPPORTUNITY.description);
    expect(openMenu()).toEqual(['console.objectView.import', 'Update Stage', 'Add to favorites']);
  });

  it('Import in the ⋯ runs its handler: the import wizard opens', async () => {
    const { openMenu } = renderList(OPPORTUNITY);
    openMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: 'console.objectView.import' }));
    expect(await screen.findByTestId('import-wizard')).toBeTruthy();
  });

  it('with no New, the toolbar action authored primary stays labelled — not the first in the row', () => {
    const { labelled, openMenu } = renderList(USERS);
    expect(labelled()).toEqual(['Invite User']);
    expect(openMenu()).toEqual(['console.objectView.import', 'Create User', 'Add to favorites']);
  });

  it('at a 1280 px header every action stays labelled, with the page’s own ⋯', () => {
    headerWidth = 1280;
    const { cluster, labelled } = renderList(OPPORTUNITY);
    expect(cluster.getAttribute('data-folded')).toBe('false');
    expect(labelled()).toEqual(['console.objectView.new', 'console.objectView.import', 'Update Stage']);
    expect(within(cluster).getByTestId('object-view-more-actions')).toBeTruthy();
  });

  it('a `?runAction=` deep link to a toolbar action runs it exactly once, though the header folds after arrival', async () => {
    const open = vi.fn(() => null);
    vi.stubGlobal('open', open);
    const OPEN_REPORT = {
      name: 'open_report',
      label: 'Open Report',
      type: 'url',
      target: 'https://example.test/report',
      openIn: 'new-tab',
      locations: ['list_toolbar'],
    };
    const { cluster } = renderList({ ...OPPORTUNITY, actions: [UPDATE_STAGE, OPEN_REPORT] }, '?runAction=open_report');
    await new Promise((resolve) => setTimeout(resolve, 50));
    // The header is folded by now, and the action ran once, on arrival.
    expect(cluster.getAttribute('data-folded')).toBe('true');
    expect(open).toHaveBeenCalledTimes(1);
  });
});

describe('declaredPrimaryToolbarAction (objectui#12705)', () => {
  it('is the `variant: primary` list-toolbar action with the lowest order, never the first by position', () => {
    const late = { ...INVITE, name: 'late', order: 5 };
    const early = { ...INVITE, name: 'early', order: -1 };
    expect(declaredPrimaryToolbarAction([CREATE_USER, INVITE] as any)?.name).toBe('invite_user');
    expect(declaredPrimaryToolbarAction([CREATE_USER, late, early] as any)?.name).toBe('early');
    expect(declaredPrimaryToolbarAction([CREATE_USER, UPDATE_STAGE] as any)).toBeUndefined();
    expect(declaredPrimaryToolbarAction([{ ...INVITE, locations: ['record_header'] }] as any)).toBeUndefined();
  });
});
