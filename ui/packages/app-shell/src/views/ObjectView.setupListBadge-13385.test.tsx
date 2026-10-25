/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#13385 — CONTROL: the list header keeps its lifecycle badge inside
 * Setup.
 *
 * The maintainer's ruling on objectui#13385 (option B) moves the badge's note
 * onto the header chip for Setup RECORD pages only; the list header
 * (`ObjectView`) keeps `ManagedByBadge` exactly as objectui#12194 left it, under
 * its `useCanAuthorMetadata` gate. This file pins that the Setup carve-out did
 * not reach the list: an author on a Setup list of a `better-auth` object sees
 * the badge, as on any other app's list.
 *
 * Direction, written before the run: GREEN before and after objectui#13385 —
 * it is a control; it goes RED only if the Setup condition is applied to the
 * list header too.
 */

import * as React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { createI18n, I18nProvider } from '@object-ui/i18n';
import { MePermissionsProvider, type MePermissionsResponse } from '@object-ui/permissions';

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
    success: vi.fn(), error: vi.fn(), info: vi.fn(),
    warning: vi.fn(), loading: vi.fn(), dismiss: vi.fn(),
  }),
}));

// The list body: the badge is drawn in the title, outside it.
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

const FIELDS = {
  id: { type: 'text', label: 'Id' },
  name: { type: 'text', label: 'Name' },
};

const OBJECTS = [
  { name: 'auth_user_12194', label: 'User', pluralLabel: 'Users', managedBy: 'better-auth', fields: FIELDS },
  { name: 'plain_note_12194', label: 'Note', pluralLabel: 'Notes', fields: FIELDS },
];

/** A `/me/permissions` answer holding exactly `held`. */
function answer(held: string[]): MePermissionsResponse {
  return {
    authenticated: true,
    userId: 'u1',
    tenantId: null,
    roles: [],
    permissionSets: [],
    systemPermissions: held,
    objects: { '*': { allowRead: true, allowCreate: true, allowEdit: true, allowDelete: true } },
    fields: {},
  };
}

/** An authoring caller. */
const AUTHOR = answer(['manage_metadata']);

beforeEach(() => {
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
  cleanup();
  vi.unstubAllGlobals();
});

/**
 * Mount the list page for `objectName` under `perms`, wait for its H1 to read
 * `title`, and return the bucket of every badge on the page.
 */
async function badgeBuckets(app: string, objectName: string, title: string, perms: MePermissionsResponse) {
  const i18n = createI18n({ defaultLanguage: 'en', detectBrowserLanguage: false });
  const dataSource = {
    find: vi.fn(async () => ({ data: [], total: 0 })),
    findOne: vi.fn(async () => null),
    create: vi.fn(async () => ({})),
    update: vi.fn(async () => ({})),
    delete: vi.fn(async () => ({})),
  } as never;
  render(
    <I18nProvider instance={i18n}>
      <MePermissionsProvider initialPermissions={perms}>
        <ExpressionProvider user={{ id: 'u1', name: 'Ada', profile: 'user' }}>
          <MemoryRouter initialEntries={[`/apps/${app}/${objectName}`]}>
            <Routes>
              <Route
                path="/apps/:appName/:objectName"
                element={<ObjectView dataSource={dataSource} objects={OBJECTS} onEdit={() => {}} />}
              />
            </Routes>
          </MemoryRouter>
        </ExpressionProvider>
      </MePermissionsProvider>
    </I18nProvider>,
  );
  const heading = await screen.findByRole('heading', { level: 1 }, { timeout: 5000 });
  expect(heading.textContent).toContain(title);
  return Array.from(document.querySelectorAll('[data-testid="managed-by-badge"]')).map((b) =>
    b.getAttribute('data-bucket'),
  );
}

describe('ObjectView — the list header keeps the badge inside Setup (objectui#13385 control)', () => {
  it('an author on a Setup list of a better-auth object sees the badge', async () => {
    expect(await badgeBuckets('com.objectstack.setup', 'auth_user_12194', 'Users', AUTHOR)).toEqual(['better-auth']);
  });

  it('the same list in a business app draws it the same way', async () => {
    expect(await badgeBuckets('crm', 'auth_user_12194', 'Users', AUTHOR)).toEqual(['better-auth']);
  });
});
