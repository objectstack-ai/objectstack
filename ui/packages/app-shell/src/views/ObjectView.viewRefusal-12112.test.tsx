/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#12112 — a list view the server refuses this caller, opened by name,
 * says it was refused.
 *
 * Since objectstack#22731 `GET /api/v1/meta/view` lists only the views the
 * caller may open, so the object's switcher never carries a view gated by
 * `requiredPermissions` the caller does not hold. A URL can still name one
 * (`/view/OBJECT.KEY`, a bookmark, a shared link). The page used to miss it,
 * warn in the browser console and draw the DEFAULT view in its place, so the
 * caller read a different view than the one they asked for and nothing said
 * why. The by-name read answers `403 PERMISSION_DENIED`, with the sentence
 * `You do not have permission to open the 'NAME' view.`
 *
 * The last case is the ADR-0106 D4 reading the triage asked for: an object's
 * OWN `listViews` entry is served whole inside `/meta/object` to a caller who
 * may edit the object, so the switcher lists it and it opens. Nothing refuses
 * it on open: the server has no by-name `/meta/view` item for an object's own
 * list view to refuse, and the console adds no client rule of its own.
 *
 * Harness: `ObjectView.listActionsReadGate-12109.test.tsx`'s, with the plugin
 * view and the tab bar stubbed to report the view they were handed.
 */

import * as React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { MePermissionsProvider, type MePermissionsResponse } from '@object-ui/permissions';
import { AdapterCtx } from '@object-ui/react';
import { createI18n, en, I18nProvider } from '@object-ui/i18n';

vi.mock('@object-ui/auth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAuth: () => ({ user: { id: 'u_author', name: 'Author' }, activeOrganization: null }),
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

// objectui#12440 — the page hands its tab strip to the list as the
// `toolbarLeading` host prop, so the list stand-in draws that node and the
// plugin view stand-in calls the page's `renderListView`, as the real one does.
vi.mock('@object-ui/plugin-list', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@object-ui/plugin-list')>()),
  ListView: (props: { toolbarLeading?: React.ReactNode }) => <>{props.toolbarLeading ?? null}</>,
}));
// The list area and the switcher, reduced to the view each was handed.
vi.mock('@object-ui/plugin-view', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  ObjectView: (props: {
    activeViewId?: string;
    renderListView?: (args: { schema: Record<string, unknown> }) => React.ReactNode;
  }) => (
    <div data-testid="plugin-object-view" data-active-view={props.activeViewId}>
      {props.renderListView?.({ schema: { type: 'list-view' } })}
    </div>
  ),
  ViewTabBar: (props: { activeViewId: string; views: Array<{ id: string }> }) => (
    <div data-testid="view-tab-bar" data-active-view={props.activeViewId}>
      {props.views.map((view) => (
        <span key={view.id} data-testid={`view-tab:${view.id}`} />
      ))}
    </div>
  ),
  ManageViewsDialog: () => null,
}));
vi.mock('./MetadataInspector', () => ({
  MetadataPanel: () => null,
  useMetadataInspector: () => ({ showDebug: false, toggle: () => {} }),
}));
vi.mock('./RecordDetailView', () => ({ RecordDetailView: () => null }));

import { ObjectView } from './ObjectView';
import { ExpressionProvider } from '../providers/ExpressionProvider';

const OBJECT_NAME = 'clm_contract';
const LEGAL_CAP = 'clm_legal_workbench.view';
const REFUSAL = "You do not have permission to open the 'clm_contract.legal_review' view.";

/**
 * The object as the console composes it: `/meta/view` items under their
 * `OBJECT.KEY` names (the gated `legal_review` already left out by the server),
 * and one list view of the object's OWN, `legal_desk`, gated on a capability
 * this caller does not hold — served because the caller may edit the object.
 */
const OBJECTS = [
  {
    name: OBJECT_NAME,
    label: 'Contract',
    pluralLabel: 'Contracts',
    fields: { name: { type: 'text', label: 'Name' } },
    listViews: {
      'clm_contract.default': { name: 'clm_contract.default', label: 'All contracts', type: 'grid', columns: ['name'], isDefault: true },
      'clm_contract.mine': { name: 'clm_contract.mine', label: 'My contracts', type: 'grid', columns: ['name'] },
      legal_desk: { label: 'Legal desk', type: 'grid', columns: ['name'], requiredPermissions: [LEGAL_CAP] },
    },
  },
];

const PERMISSIONS: MePermissionsResponse = {
  authenticated: true,
  userId: 'u_author',
  tenantId: null,
  roles: [],
  permissionSets: ['studio_user'],
  systemPermissions: ['studio.access'],
  objects: { [OBJECT_NAME]: { allowRead: true, allowEdit: true } },
  fields: {},
};

function makeDataSource() {
  return {
    find: vi.fn(async () => ({ data: [], total: 0 })),
    findOne: vi.fn(async () => null),
    create: vi.fn(async () => ({})),
    update: vi.fn(async () => ({})),
    delete: vi.fn(async () => ({})),
  } as never;
}

/**
 * The same object, opened in split navigation with a record open: the list
 * sits in the overlay's left pane, the page's other place the list is drawn.
 */
const SPLIT_OBJECTS = [{ ...OBJECTS[0], navigation: { mode: 'split' } }];

function openView(viewId: string, access: Record<string, unknown>, opts: { split?: boolean } = {}) {
  const probeMetaItemAccess = vi.fn(async () => access);
  const objects = opts.split ? SPLIT_OBJECTS : OBJECTS;
  render(
    <I18nProvider instance={createI18n({ defaultLanguage: 'en', detectBrowserLanguage: false })}>
      <AdapterCtx.Provider value={{ probeMetaItemAccess } as never}>
        <MePermissionsProvider initialPermissions={PERMISSIONS}>
          <ExpressionProvider user={{ id: 'u_author', name: 'Author' }}>
            <MemoryRouter initialEntries={[`/apps/clm/${OBJECT_NAME}/view/${viewId}${opts.split ? '?recordId=r1' : ''}`]}>
              <Routes>
                <Route
                  path="/apps/:appName/:objectName/view/:viewId"
                  element={<ObjectView dataSource={makeDataSource()} objects={objects} onEdit={() => {}} />}
                />
              </Routes>
            </MemoryRouter>
          </ExpressionProvider>
        </MePermissionsProvider>
      </AdapterCtx.Provider>
    </I18nProvider>,
  );
  return probeMetaItemAccess;
}

/** A face is only absent once the render has had a chance to settle. */
async function settle() {
  await new Promise((resolve) => setTimeout(resolve, 80));
}

describe('objectui#12112 — a refused list view, opened by name, says it was refused', () => {
  afterEach(() => cleanup());

  it('a view the server refuses: a permission refusal in the server\'s words, not the default view', async () => {
    const probe = openView('clm_contract.legal_review', { verdict: 'denied', message: REFUSAL });

    const refusal = await screen.findByTestId('view-access-denied');
    expect(probe).toHaveBeenCalledWith('view', 'clm_contract.legal_review');
    expect(refusal.textContent).toContain(en.list.loadErrorForbiddenTitle);
    expect(refusal.textContent).toContain(REFUSAL);
    // Not the silent fall-back: no view is drawn, and no tab claims the page.
    expect(screen.queryByTestId('plugin-object-view')).toBeNull();
    expect(screen.getByTestId('view-tab-bar').getAttribute('data-active-view')).toBe('');
  });

  it('the same refusal in split navigation, where the list sits beside an open record', async () => {
    openView('clm_contract.legal_review', { verdict: 'denied', message: REFUSAL }, { split: true });

    const refusal = await screen.findByTestId('view-access-denied');
    expect(refusal.textContent).toContain(REFUSAL);
    expect(screen.queryByTestId('plugin-object-view')).toBeNull();
  });

  it('a short name is asked by the canonical `OBJECT.KEY` name the by-name route addresses', async () => {
    const probe = openView('legal_review', { verdict: 'denied', message: REFUSAL });

    await screen.findByTestId('view-access-denied');
    expect(probe).toHaveBeenCalledWith('view', 'clm_contract.legal_review');
  });

  it('CONTROL: a held view opens by name as today, and nothing is asked by name', async () => {
    const probe = openView('clm_contract.mine', { verdict: 'denied', message: REFUSAL });

    const list = await screen.findByTestId('plugin-object-view');
    expect(list.getAttribute('data-active-view')).toBe('clm_contract.mine');
    await settle();
    expect(probe).not.toHaveBeenCalled();
    expect(screen.queryByTestId('view-access-denied')).toBeNull();
  });

  it('CONTROL: a view that does not exist falls back to the default view, as today', async () => {
    const probe = openView('clm_contract.no_such_view', { verdict: 'not_found' });

    const list = await screen.findByTestId('plugin-object-view');
    expect(probe).toHaveBeenCalledWith('view', 'clm_contract.no_such_view');
    expect(list.getAttribute('data-active-view')).toBe('clm_contract.default');
    expect(screen.queryByTestId('view-access-denied')).toBeNull();
  });

  it('D4 (measured): an object\'s own list view served to its editor is listed and opens — no client rule hides or refuses it', async () => {
    const probe = openView('legal_desk', { verdict: 'denied', message: REFUSAL });

    const list = await screen.findByTestId('plugin-object-view');
    expect(screen.getByTestId('view-tab:legal_desk')).toBeTruthy();
    expect(list.getAttribute('data-active-view')).toBe('legal_desk');
    await settle();
    expect(probe).not.toHaveBeenCalled();
    expect(screen.queryByTestId('view-access-denied')).toBeNull();
  });
});
