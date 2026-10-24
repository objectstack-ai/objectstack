/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#11817 — Invite User, end to end through the real list page.
 *
 * Filed from a browser pass of Setup: Invite User gave no success message,
 * the Invitations grid nested an anchor inside an anchor, and the parameter
 * dialogs all wore one generic subtitle. Each claim is measured here through
 * the real `ObjectView`, the real `action:bar` → `action:button` →
 * `ActionRunner` chain, the real console action runtime, the real
 * `ActionParamDialog` and the real `ConsoleToaster` (sonner is NOT mocked:
 * what is asserted is the toast in the DOM), in a real i18next instance in
 * `en`.
 *
 * What the measurement found, and what each block pins:
 *
 *   - **The toast.** The declared `successMessage` reaches the toaster after
 *     the dialog's Confirm — no objectui code drops it. Pinned with its
 *     control (a refused invite raises the server's message and no success
 *     toast), and with the copy that NAMES the invitee: the runner fills
 *     `${result.*}` from the answer (objectui#11344), so an action whose
 *     `successMessage` reads `${result.email}` gets the invitee's address.
 *     Whether `invite_user` declares such copy is the action's metadata.
 *   - **The subtitle.** An action that declares `description` gets it as the
 *     dialog's subtitle; one that declares none gets the generic line. Both
 *     halves pinned, from served-action shapes (`ban_user` declares one,
 *     `invite_user` does not).
 *   - **The anchor.** The Invitations grid's first column is `email`; its
 *     record link held the `mailto:` anchor. Fixed in `@object-ui/plugin-grid`
 *     (`linkCellRenderer`), pinned here on the real page with the Users list
 *     as the control: its email column keeps its `mailto:` anchor.
 *
 * The fixtures carry each object as the server serves it, `requiresFeature`
 * and `requiresMembershipReach` already lowered into the action's `visible`.
 */

import * as React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, screen, fireEvent, waitFor, act, within } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { toast } from 'sonner';
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
  useAuth: () => ({ user: { id: 'u1', name: 'Ada' }, activeOrganization: { id: 'org1', name: 'Acme' } }),
  useWorkspaceAdminStatus: () => ({ isAdmin: true, isResolved: true }),
  // The api handler's authenticated fetch, routed to the stubbed global.
  createAuthenticatedFetch: () => (url: string, init?: RequestInit) => fetch(url, init),
}));

vi.mock('@object-ui/collaboration', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useRealtimeSubscription: () => ({ lastMessage: null }),
  useConflictResolution: () => ({ hasConflicts: false, resolveAllConflicts: () => {} }),
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
import { ConsoleToaster } from '../chrome/ConsoleToaster';

// ── The served objects (abridged to the keys these pages read) ─────────────

/** `requiresMembershipReach: 'invite_member'` then `requiresFeature: 'organization'`, lowered. */
const INVITE_MEMBER_GATE =
  "('org_owner' in current_user.positions || 'org_admin' in current_user.positions || " +
  "'delegated_admin' in current_user.positions) && features.organization != false";

const ROLE_OPTIONS = [
  { value: 'member', label: 'Member' },
  { value: 'admin', label: 'Admin' },
];

const SYS_MEMBER = {
  name: 'sys_member',
  label: 'Member',
  fields: { role: { type: 'select', label: 'Role', options: ROLE_OPTIONS, defaultValue: 'member' } },
};

function inviteUser(successMessage: string) {
  return {
    name: 'invite_user',
    label: 'Invite User',
    variant: 'primary',
    locations: ['list_toolbar'],
    type: 'api',
    target: '/api/v1/auth/organization/invite-member',
    visible: { dialect: 'cel', source: INVITE_MEMBER_GATE },
    successMessage,
    refreshAfter: true,
    params: [
      { field: 'email', required: true },
      { field: 'role', objectOverride: 'sys_member', required: true },
    ],
  };
}

/** `sys_user` — Invite User declares no `description`; Ban User declares one. */
function sysUser(inviteCopy = 'Invitation sent') {
  return {
    name: 'sys_user',
    label: 'User',
    pluralLabel: 'Users',
    managedBy: 'better-auth',
    fields: {
      id: { type: 'text', label: 'Id' },
      name: { type: 'text', label: 'Name' },
      email: { type: 'email', label: 'Email' },
    },
    actions: [
      inviteUser(inviteCopy),
      {
        name: 'ban_user',
        label: 'Ban User',
        locations: ['list_toolbar'],
        type: 'api',
        target: '/api/v1/auth/admin/ban-user',
        description: 'Ban this user? They will be signed out and unable to sign in until unbanned.',
        successMessage: 'User banned',
        params: [{ name: 'banReason', type: 'text', label: 'Ban Reason' }],
      },
    ],
    listViews: {
      all_users: { name: 'all_users', label: 'All', type: 'grid', columns: ['name', 'email'] },
    },
  };
}

const SYS_INVITATION = {
  name: 'sys_invitation',
  label: 'Invitation',
  pluralLabel: 'Invitations',
  managedBy: 'better-auth',
  fields: {
    id: { type: 'text', label: 'Invitation ID' },
    email: { type: 'email', label: 'Email' },
    role: { type: 'select', label: 'Role', options: ROLE_OPTIONS },
    status: { type: 'text', label: 'Status' },
  },
  actions: [inviteUser('Invitation sent')],
  listViews: {
    pending: { name: 'pending', label: 'Pending', type: 'grid', columns: ['email', 'role', 'status'] },
  },
};

/** The seeded admin: an org admin, so the membership-reach half of Invite User holds. */
const ADMIN = { id: 'u1', name: 'Dev Admin', positions: ['org_admin'] };

const GENERIC_SUBTITLE = 'Please provide the required information to continue.';

type InviteAnswer = { status: number; body: unknown };
let inviteAnswer: InviteAnswer;
let fetchSpy: ReturnType<typeof vi.fn>;

beforeEach(() => {
  inviteAnswer = {
    status: 200,
    body: { id: 'inv1', email: 'ada@example.com', role: 'member', status: 'pending' },
  };
  fetchSpy = vi.fn(async (url: unknown) => {
    const answer = String(url).includes('/organization/invite-member')
      ? inviteAnswer
      : { status: 200, body: { data: [] } };
    return new Response(JSON.stringify(answer.body), {
      status: answer.status,
      headers: { 'content-type': 'application/json' },
    });
  });
  vi.stubGlobal('fetch', fetchSpy);
});

afterEach(() => {
  act(() => { toast.dismiss(); });
  cleanup();
  vi.unstubAllGlobals();
});

function mountList(
  objectName: string,
  viewId: string,
  objects: Array<{ name: string }>,
  rows: Array<Record<string, unknown>> = [],
) {
  const i18n = createI18n({ defaultLanguage: 'en', detectBrowserLanguage: false });
  const dataSource = {
    find: vi.fn(async () => ({ data: rows, total: rows.length })),
    findOne: vi.fn(async () => null),
    getObjectSchema: vi.fn(async (name: string) => objects.find((o) => o.name === name) ?? null),
    create: vi.fn(async () => ({})),
    update: vi.fn(async () => ({})),
    delete: vi.fn(async () => ({})),
  } as never;
  return render(
    <I18nProvider instance={i18n}>
      <ConsoleToaster />
      <ExpressionProvider user={ADMIN} features={{ organization: true }}>
        <MemoryRouter initialEntries={[`/apps/setup/${objectName}/view/${viewId}`]}>
          <Routes>
            <Route
              path="/apps/:appName/:objectName/view/:viewId"
              element={<ObjectView dataSource={dataSource} objects={objects} onEdit={() => {}} />}
            />
          </Routes>
        </MemoryRouter>
      </ExpressionProvider>
    </I18nProvider>,
  );
}

/** Open a toolbar action's parameter dialog and wait for its widgets. */
async function openDialog(actionLabel: RegExp): Promise<HTMLElement> {
  fireEvent.click(await screen.findByRole('button', { name: actionLabel }, { timeout: 5000 }));
  const dialog = await screen.findByRole('dialog', undefined, { timeout: 5000 });
  await waitFor(() => expect(dialog.querySelector('input')).not.toBeNull(), { timeout: 5000 });
  return dialog;
}

/** Invite ada@example.com through the dialog and wait for the request. */
async function inviteAda(): Promise<void> {
  const dialog = await openDialog(/Invite User/);
  fireEvent.change(within(dialog).getByRole('textbox'), { target: { value: 'ada@example.com' } });
  await act(async () => { fireEvent.click(within(dialog).getByRole('button', { name: 'Confirm' })); });
  await waitFor(
    () => expect(fetchSpy.mock.calls.some(([u]) => String(u).includes('/organization/invite-member'))).toBe(true),
    { timeout: 5000 },
  );
}

const MEMBERS = [SYS_MEMBER];

describe('objectui#11817 — Invite User says it worked', () => {
  it('after Confirm, the toaster shows the action\'s declared successMessage', async () => {
    mountList('sys_user', 'all_users', [sysUser(), ...MEMBERS]);
    await inviteAda();

    expect(await screen.findByText('Invitation sent', undefined, { timeout: 5000 })).toBeInTheDocument();
    const [, init] = fetchSpy.mock.calls.find(([u]) => String(u).includes('/organization/invite-member'))!;
    expect(JSON.parse(String((init as RequestInit).body))).toMatchObject({ email: 'ada@example.com', role: 'member' });
  });

  it('control: a refused invite raises the server\'s message and no success toast', async () => {
    inviteAnswer = { status: 400, body: { error: { message: 'User is already a member of this organization' } } };
    mountList('sys_user', 'all_users', [sysUser(), ...MEMBERS]);
    await inviteAda();

    expect(
      await screen.findByText('User is already a member of this organization', undefined, { timeout: 5000 }),
    ).toBeInTheDocument();
    expect(screen.queryByText('Invitation sent')).toBeNull();
  });

  it('copy that reads the answer\'s `result.email` names the invitee', async () => {
    mountList('sys_user', 'all_users', [sysUser(`Invitation sent to \${result.email}`), ...MEMBERS]);
    await inviteAda();

    expect(await screen.findByText('Invitation sent to ada@example.com', undefined, { timeout: 5000 })).toBeInTheDocument();
  });
});

describe('objectui#11817 — the parameter dialog subtitle is the action\'s own description', () => {
  it('an action that declares `description` is subtitled with it', async () => {
    mountList('sys_user', 'all_users', [sysUser(), ...MEMBERS]);
    const dialog = await openDialog(/Ban User/);

    expect(within(dialog).getByText(
      'Ban this user? They will be signed out and unable to sign in until unbanned.',
    )).toBeInTheDocument();
    expect(within(dialog).queryByText(GENERIC_SUBTITLE)).toBeNull();
  });

  it('control: an action that declares none (Invite User) keeps the generic line', async () => {
    mountList('sys_user', 'all_users', [sysUser(), ...MEMBERS]);
    const dialog = await openDialog(/Invite User/);

    expect(within(dialog).getByText(GENERIC_SUBTITLE)).toBeInTheDocument();
  });
});

describe('objectui#11817 — the Invitations grid draws one anchor per click target', () => {
  it('the email first column is the record link, holding the address as text', async () => {
    const { container } = mountList('sys_invitation', 'pending', [SYS_INVITATION, ...MEMBERS], [
      { id: 'inv1', email: 'ada@example.com', role: 'member', status: 'pending' },
    ]);
    const link = await waitFor(() => {
      const el = container.querySelector('[data-testid="primary-field-link"]');
      expect(el).toHaveTextContent('ada@example.com');
      return el!;
    }, { timeout: 5000 });

    expect(link.tagName).toBe('A');
    expect(link.getAttribute('href')).toMatch(/\/record\/inv1$/);
    expect(container.querySelectorAll('a a')).toHaveLength(0);
    expect(container.querySelector('a[href^="mailto:"]')).toBeNull();
  });

  it('control: on the Users list the email column is not the link, and keeps its mailto anchor', async () => {
    const { container } = mountList('sys_user', 'all_users', [sysUser(), ...MEMBERS], [
      { id: 'u2', name: 'Grace', email: 'grace@example.com' },
    ]);
    await waitFor(
      () => expect(container.querySelector('a[href="mailto:grace@example.com"]')).not.toBeNull(),
      { timeout: 5000 },
    );

    expect(container.querySelector('[data-testid="primary-field-link"]')).toHaveTextContent('Grace');
    expect(container.querySelectorAll('a a')).toHaveLength(0);
  });
});
