/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#12194 — the object list page's header draws the lifecycle badge
 * (`ManagedByBadge`) for an authoring caller only.
 *
 * Triage ruled the badge an authoring aid (option a). The gate lives in the
 * badge, so the list header follows the same rule as the record page
 * (`RecordDetailView.managedByBadgeAuthoring-12194`). What an end user needs on
 * a managed list stays with every caller: the toolbar's hidden affordances and
 * the empty state `resolveManagedByEmptyState` draws; neither reads the badge.
 *
 * Measured from a real `ObjectView` mount (the `ObjectView.listTitlePlural-11696`
 * harness, list body stubbed: the badge sits in the title, outside it) under
 * the real `MePermissionsProvider`, fed the `/me/permissions` answer the case
 * names. Every absence is read after the H1 has painted with the object's
 * label, and the authoring case draws the badge in the same harness.
 *
 * Direction, written before the run: with the gate taken out of
 * `ManagedByBadge`, the end-user case goes RED and the others stay GREEN.
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

/** An end user: the server reported the set, and it lacks `manage_metadata`. */
const END_USER = answer(['setup.access']);
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
async function badgeBuckets(objectName: string, title: string, perms: MePermissionsResponse) {
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
          <MemoryRouter initialEntries={[`/apps/demo/${objectName}`]}>
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

describe('ObjectView — the list header’s lifecycle badge is an authoring aid (objectui#12194)', () => {
  it('an end user on a better-auth list sees no badge', async () => {
    expect(await badgeBuckets('auth_user_12194', 'Users', END_USER)).toEqual([]);
  });

  it('an authoring caller on the same list sees the badge, naming its bucket', async () => {
    expect(await badgeBuckets('auth_user_12194', 'Users', AUTHOR)).toEqual(['better-auth']);
  });

  it('CONTROL — an object with no managedBy draws no badge, for an authoring caller or an end user', async () => {
    expect(await badgeBuckets('plain_note_12194', 'Notes', AUTHOR)).toEqual([]);
    cleanup();
    expect(await badgeBuckets('plain_note_12194', 'Notes', END_USER)).toEqual([]);
  });
});
