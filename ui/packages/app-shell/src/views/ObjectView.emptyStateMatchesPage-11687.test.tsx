/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#11687 — an empty list's copy must not contradict the page it sits on.
 *
 * Two defects, measured on the console (objectui#11672, item 15):
 *
 *   1. Invitations and OAuth Applications said "These records are created by
 *      the authentication provider … not added by hand here." beside an
 *      "Invite User" / "Register OAuth Application" button. The `better-auth`
 *      empty state did not ask whether the page offers a way to add a row.
 *   2. Webhooks' Active view, zero rows, said "No records match your current
 *      filters or search." with no filter or search applied: the view's own
 *      declared filter was read as the user's.
 *
 * Each case below is one of the four measured pages, mounted through the real
 * `ObjectView` and the real `ListView`, in a real i18next instance booted in
 * `en` — the strings asserted are the pack's, not a mock's. The fixtures carry
 * each object as the server serves it: `requiresFeature` /
 * `requiresMembershipReach` already lowered into the action's `visible`, the
 * spec's `lowerRequiresFeature` / `lowerRequiresMembershipReach` order.
 *
 * API Keys is the page that offers NO create action — `sys_api_key` declares
 * no `list_toolbar` action and leaves `create` at the bucket default (off);
 * keys are minted elsewhere. So it keeps the identity copy, and it is the
 * negative control for the first defect. The single-org Invitations case is
 * the other control: the same object, its Invite User hidden by its own gate,
 * keeps the identity copy too — the copy follows the button, not the object.
 */

import * as React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { createI18n, I18nProvider } from '@object-ui/i18n';

vi.mock('@object-ui/permissions', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@object-ui/permissions')>();
  // Stable identities — `ListView` names `perms` in its fetch dependencies.
  const perms = {
    check: () => ({ allowed: true }),
    checkField: () => true,
    getFieldPermissions: () => [],
    getRowFilter: () => undefined,
    getObjectApiOperations: () => undefined,
    roles: [],
    isLoaded: false,
    hasCapabilities: () => true,
    can: () => true,
    cannot: () => false,
  };
  const fieldPerms = { canRead: () => true, canWrite: () => true, permissions: [] };
  return { ...actual, usePermissions: () => perms, useFieldPermissions: () => fieldPerms };
});

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
vi.mock('./RecordDetailView', () => ({ RecordDetailView: () => null }));

vi.mock('./metadata-admin/useMetadata', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useMetadataClient: () => ({ save: vi.fn(async () => ({})), get: vi.fn(async () => null) }),
}));

import { ObjectView } from './ObjectView';
import { ExpressionProvider } from '../providers/ExpressionProvider';

// ── The served objects (abridged to the keys this page reads) ──────────────

/** `requiresMembershipReach: 'invite_member'` then `requiresFeature: 'organization'`, lowered. */
const INVITE_MEMBER_GATE =
  "('org_owner' in current_user.positions || 'org_admin' in current_user.positions || " +
  "'delegated_admin' in current_user.positions) && features.organization != false";

const SYS_INVITATION = {
  name: 'sys_invitation',
  label: 'Invitation',
  pluralLabel: 'Invitations',
  managedBy: 'better-auth',
  fields: {
    id: { type: 'text', label: 'Id' },
    email: { type: 'email', label: 'Email' },
    status: { type: 'text', label: 'Status' },
  },
  actions: [
    {
      name: 'invite_user',
      label: 'Invite User',
      variant: 'primary',
      locations: ['list_toolbar'],
      type: 'api',
      target: '/api/v1/auth/organization/invite-member',
      visible: { dialect: 'cel', source: INVITE_MEMBER_GATE },
    },
    {
      name: 'cancel_invitation',
      label: 'Cancel Invitation',
      mode: 'delete',
      locations: ['list_item'],
      type: 'api',
      target: '/api/v1/auth/organization/cancel-invitation',
    },
  ],
  listViews: {
    pending: {
      name: 'pending',
      label: 'Pending',
      type: 'grid',
      columns: ['email', 'status'],
      filter: [{ field: 'status', operator: 'equals', value: 'pending' }],
    },
  },
};

const SYS_API_KEY = {
  name: 'sys_api_key',
  label: 'API Key',
  pluralLabel: 'API Keys',
  managedBy: 'better-auth',
  userActions: { edit: true },
  fields: {
    id: { type: 'text', label: 'Id' },
    name: { type: 'text', label: 'Name' },
    revoked: { type: 'boolean', label: 'Revoked' },
  },
  actions: [
    {
      name: 'revoke_api_key',
      label: 'Revoke API Key',
      mode: 'custom',
      locations: ['list_item'],
      type: 'api',
      method: 'PATCH',
      target: '/api/v1/data/sys_api_key/{id}',
    },
  ],
  listViews: {
    all_keys: { name: 'all_keys', label: 'All', type: 'grid', columns: ['name', 'revoked'] },
  },
};

const SYS_OAUTH_APPLICATION = {
  name: 'sys_oauth_application',
  label: 'OAuth Application',
  pluralLabel: 'OAuth Applications',
  managedBy: 'better-auth',
  fields: {
    id: { type: 'text', label: 'Id' },
    name: { type: 'text', label: 'Name' },
    disabled: { type: 'boolean', label: 'Disabled' },
  },
  actions: [
    {
      name: 'create_oauth_application',
      label: 'Register OAuth Application',
      mode: 'create',
      locations: ['list_toolbar'],
      type: 'api',
      target: '/api/v1/auth/oauth2/create-client',
      // `requiresFeature: 'oidcProvider'`, lowered (a default-on flag).
      visible: { dialect: 'cel', source: 'features.oidcProvider != false' },
    },
  ],
  listViews: {
    all_apps: { name: 'all_apps', label: 'All', type: 'grid', columns: ['name', 'disabled'] },
  },
};

const SYS_WEBHOOK = {
  name: 'sys_webhook',
  label: 'Webhook',
  pluralLabel: 'Webhooks',
  managedBy: 'config',
  userActions: { create: true, edit: true, delete: true, import: false },
  fields: {
    id: { type: 'text', label: 'Id' },
    name: { type: 'text', label: 'Name' },
    active: { type: 'boolean', label: 'Active' },
  },
  listViews: {
    active: {
      name: 'active',
      label: 'Active',
      type: 'grid',
      columns: ['name', 'active'],
      filter: [{ field: 'active', operator: 'equals', value: true }],
    },
  },
};

const OBJECTS = [SYS_INVITATION, SYS_API_KEY, SYS_OAUTH_APPLICATION, SYS_WEBHOOK];

/** The seeded admin: an org admin, so the membership-reach half of Invite User holds. */
const ADMIN = { id: 'u1', name: 'Dev Admin', positions: ['org_admin'] };

/** A multi-org deployment with the OIDC provider on — the dogfooded showcase. */
const MULTI_ORG = { organization: true, oidcProvider: true };

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

/** Mount one page with zero rows and read its empty state's text. */
async function emptyPage(
  objectName: string,
  viewId: string,
  features: Record<string, boolean> = MULTI_ORG,
): Promise<string> {
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
      <ExpressionProvider user={ADMIN} features={features}>
        <MemoryRouter initialEntries={[`/apps/setup/${objectName}/view/${viewId}`]}>
          <Routes>
            <Route
              path="/apps/:appName/:objectName/view/:viewId"
              element={<ObjectView dataSource={dataSource} objects={OBJECTS} onEdit={() => {}} />}
            />
          </Routes>
        </MemoryRouter>
      </ExpressionProvider>
    </I18nProvider>,
  );
  const node = await screen.findByTestId('empty-state', undefined, { timeout: 5000 });
  return node.textContent ?? '';
}

const IDENTITY_COPY = 'not added by hand here';
const USER_QUERY_COPY = 'your current filters or search';
const VIEW_FILTER_COPY = 'No records match this view’s filter.';

describe('objectui#11687 — list empty states match the page they sit on', () => {
  it('Invitations: beside Invite User, the default Pending view names its own filter', async () => {
    const text = await emptyPage('sys_invitation', 'pending');

    expect(screen.getByRole('button', { name: /Invite User/ })).toBeTruthy();
    expect(text).not.toContain(IDENTITY_COPY);
    expect(text).toContain(VIEW_FILTER_COPY);
    expect(text).not.toContain(USER_QUERY_COPY);
  });

  it('Invitations, single-org (control): Invite User is hidden by its gate, so the identity copy stays', async () => {
    const text = await emptyPage('sys_invitation', 'pending', { organization: false, oidcProvider: true });

    expect(screen.queryByRole('button', { name: /Invite User/ })).toBeNull();
    expect(text).toContain('No identity records');
    expect(text).toContain(IDENTITY_COPY);
  });

  it('API Keys: the page offers no create action, so the identity copy stays', async () => {
    const text = await emptyPage('sys_api_key', 'all_keys');

    expect(screen.queryByRole('button', { name: /New|Create|Register|Invite/ })).toBeNull();
    expect(text).toContain('No identity records');
    expect(text).toContain(IDENTITY_COPY);
  });

  it('OAuth Applications: beside Register OAuth Application, the unfiltered list gets first-run copy', async () => {
    const text = await emptyPage('sys_oauth_application', 'all_apps');

    expect(screen.getByRole('button', { name: /Register OAuth Application/ })).toBeTruthy();
    expect(text).not.toContain(IDENTITY_COPY);
    expect(text).toContain('Nothing here yet');
  });

  it('Webhooks, Active view: zero rows and nothing applied names the view\'s filter, not the user\'s', async () => {
    const text = await emptyPage('sys_webhook', 'active');

    expect(text).toContain('No matching records');
    expect(text).toContain(VIEW_FILTER_COPY);
    expect(text).not.toContain(USER_QUERY_COPY);
  });
});
