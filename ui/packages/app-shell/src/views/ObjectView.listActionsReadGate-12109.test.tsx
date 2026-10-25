/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#12109 — an object's list actions are not drawn for a caller who may
 * not read the object.
 *
 * Measured on HotCRM (objectstack-ai/hotcrm#2058, 17.7.0): a service agent with
 * no read on `crm_opportunity` was shown "Update Stage" over the opportunity
 * list's "You don't have access". That entry is not a navigation item: it is
 * HotCRM's `MassUpdateStageAction` (`objectName: 'crm_opportunity'`,
 * `locations: ['list_toolbar']`), drawn by THIS page's schema-driven toolbar.
 * The fixture carries the keys of that declaration this toolbar reads.
 *
 * The verdict is the REAL `MePermissionsProvider`'s, holding the caller's
 * `/me/permissions` answer, and it is the one the sidebar prunes the object's
 * navigation entry on (`mayReadObject`), so an entry and its list actions go
 * together. Every case is one differential: the same object, the same action,
 * only the caller's `allowRead` differs.
 *
 * Harness: `ObjectView.objectBoundActions-7234.test.tsx`'s, except that
 * `@object-ui/permissions` is NOT mocked.
 */

import * as React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { MePermissionsProvider, type MePermissionsResponse } from '@object-ui/permissions';

vi.mock('@object-ui/auth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAuth: () => ({ user: { id: 'u_agent', name: 'Agent' }, activeOrganization: null }),
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

// Heavy children: orthogonal to the toolbar under test, as in the 7234 suite.
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

import { ObjectView } from './ObjectView';
import { ExpressionProvider } from '../providers/ExpressionProvider';

const OBJECT_NAME = 'crm_opportunity';

/** HotCRM's `MassUpdateStageAction`, abridged to the keys this toolbar reads. */
const UPDATE_STAGE = {
  name: 'mass_update_stage',
  label: 'Update Stage',
  objectName: OBJECT_NAME,
  type: 'script',
  locations: ['list_toolbar'],
};

const OBJECTS = [
  {
    name: OBJECT_NAME,
    label: 'Opportunity',
    pluralLabel: 'Opportunities',
    fields: {
      id: { type: 'text', label: 'Id' },
      name: { type: 'text', label: 'Name' },
    },
    actions: [UPDATE_STAGE],
  },
];

function answerFor(opportunityRead: boolean): MePermissionsResponse {
  return {
    authenticated: true,
    userId: 'u_agent',
    tenantId: null,
    roles: [],
    permissionSets: ['service_agent'],
    systemPermissions: [],
    objects: { [OBJECT_NAME]: { allowRead: opportunityRead, allowEdit: true } },
    fields: {},
  };
}

function makeDataSource() {
  return {
    find: vi.fn(async () => ({ data: [], total: 0 })),
    findOne: vi.fn(async () => null),
    create: vi.fn(async () => ({})),
    update: vi.fn(async () => ({})),
    delete: vi.fn(async () => ({})),
  } as never;
}

const USER = { id: 'u_agent', name: 'Agent' };

function renderList(answer: MePermissionsResponse) {
  return render(
    <MePermissionsProvider initialPermissions={answer}>
      <ExpressionProvider user={USER}>
        <MemoryRouter initialEntries={[`/apps/crm/${OBJECT_NAME}`]}>
          <Routes>
            <Route
              path="/apps/:appName/:objectName"
              element={<ObjectView dataSource={makeDataSource()} objects={OBJECTS} onEdit={() => {}} />}
            />
          </Routes>
        </MemoryRouter>
      </ExpressionProvider>
    </MePermissionsProvider>,
  );
}

const updateStage = () => screen.queryByRole('button', { name: /Update Stage/ });

/** Absence is only meaningful after the render has had a chance to settle. */
async function settle() {
  await new Promise((resolve) => setTimeout(resolve, 80));
}

describe('objectui#12109 — an object\'s list actions follow the caller\'s read on the object', () => {
  afterEach(() => cleanup());

  it('a caller who may read the object: "Update Stage" is drawn on the list toolbar', async () => {
    renderList(answerFor(true));
    await waitFor(() => expect(updateStage()).toBeTruthy());
  });

  it('the service agent, without read: the SAME action on the SAME page is not drawn', async () => {
    renderList(answerFor(false));
    await settle();
    // Paired positive: the page itself rendered, so the absence below is the
    // gate's and not an empty tree's.
    expect(screen.getAllByText('Opportunities').length).toBeGreaterThan(0);
    expect(updateStage()).toBeNull();
  });
});
