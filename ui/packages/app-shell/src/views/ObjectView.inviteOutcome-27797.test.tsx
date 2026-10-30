/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#27797 — Setup → Invitations on a deployment with no mail
 * transport, through the real list page.
 *
 * The fix is the server's (objectstack#27843, ruling E on objectstack#27797):
 * invite-member answers a top-level `outcome` (`sent` | `link_only`), the
 * invite actions declare `outcomeMessages` for both, and a `type: 'script'`
 * action, `copy_invitation_link`, answers `{ acceptUrl }` into a
 * `resultDialog` with `format: 'text'`. The renderer learns nothing about
 * invitations; what is pinned here is that the generic chain carries those
 * declarations to the administrator: the real `ObjectView`, the real
 * `action:bar` / grid row menu → `ActionRunner` chain, the real console
 * action runtime, the real `ActionParamDialog`, `ActionResultDialog` and
 * `ConsoleToaster` (sonner is NOT mocked), in a real i18next instance in `en`.
 *
 *   - **The toast follows the outcome.** A `link_only` answer toasts the
 *     declared "created … no email went out" copy and never "sent"; a `sent`
 *     answer keeps "Invitation sent to …". Same action, same row, only the
 *     answer's `outcome` differs.
 *   - **The link reaches the clipboard.** The row menu offers Copy Invite
 *     Link on a pending invitation; its click posts to the platform action
 *     door with the row's id, and the result dialog shows the answer's
 *     `acceptUrl` as text whose copy button writes exactly that URL. Control:
 *     an accepted invitation's menu has no Copy Invite Link.
 *
 * The fixture is `sys_invitation` as the server serves it
 * (`GET /api/v1/meta/object/sys_invitation` on a stock `app-showcase` boot),
 * abridged to the keys this page reads: `requiresFeature` and
 * `requiresMembershipReach` arrive already lowered into each action's
 * `visible`. The answers are the action door's, as measured on that boot.
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
  // The handlers' authenticated fetch, routed to the stubbed global.
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

// ── The served object (abridged to the keys this page reads) ───────────────

/** `requiresMembershipReach: 'invite_member'`, lowered. */
const INVITE_REACH =
  "'org_owner' in current_user.positions || 'org_admin' in current_user.positions || "
  + "'delegated_admin' in current_user.positions";

const ROLE_OPTIONS = [
  { label: 'Admin', value: 'admin' },
  { label: 'Member', value: 'member' },
];

const LINK_ONLY_TAIL = 'Mail is not configured on this server, so no email went out. '
  + 'Use Copy Invite Link on the invitation to share it.';

const SYS_INVITATION = {
  name: 'sys_invitation',
  label: 'Invitation',
  pluralLabel: 'Invitations',
  managedBy: 'better-auth',
  fields: {
    id: { type: 'text', label: 'Invitation ID' },
    email: { type: 'email', label: 'Email' },
    role: { type: 'select', label: 'Role', options: ROLE_OPTIONS, defaultValue: 'member' },
    status: {
      type: 'select',
      label: 'Status',
      defaultValue: 'pending',
      options: ['pending', 'accepted', 'rejected', 'expired', 'canceled'].map((v) => ({ label: v, value: v })),
    },
  },
  actions: [
    {
      name: 'invite_user',
      label: 'Invite User',
      locations: ['list_toolbar'],
      type: 'api',
      target: '/api/v1/auth/organization/invite-member',
      params: [
        { field: 'email', required: true },
        { field: 'role', required: true, options: ROLE_OPTIONS },
      ],
      variant: 'primary',
      successMessage: 'Invitation sent to {{ result.email }}',
      outcomeMessages: {
        sent: 'Invitation sent to ${result.email}',
        link_only: `Invitation created for \${result.email}. ${LINK_ONLY_TAIL}`,
      },
      refreshAfter: true,
      visible: {
        dialect: 'cel',
        source: `((features.cloudManaged != true) && (${INVITE_REACH})) && features.organization != false`,
      },
    },
    {
      name: 'resend_invitation',
      label: 'Resend Invitation',
      locations: ['list_item'],
      type: 'api',
      target: '/api/v1/auth/organization/invite-member',
      params: [
        { field: 'email', required: true, defaultFromRow: true },
        { field: 'role', required: true, defaultFromRow: true },
      ],
      variant: 'secondary',
      successMessage: 'Invitation resent',
      outcomeMessages: {
        sent: 'Invitation resent to ${result.email}',
        link_only: `Invitation renewed for \${result.email}. ${LINK_ONLY_TAIL}`,
      },
      refreshAfter: true,
      visible: { dialect: 'cel', source: `(${INVITE_REACH}) && features.organization != false` },
      bodyExtra: { resend: true },
    },
    {
      name: 'copy_invitation_link',
      label: 'Copy Invite Link',
      locations: ['list_item', 'record_header'],
      type: 'script',
      target: 'copy_invitation_link',
      variant: 'secondary',
      refreshAfter: false,
      resultDialog: {
        title: 'Invite link',
        description:
          'Anyone who opens this link can accept the invitation, so share it only with the person you invited. '
          + 'It stops working once the invitation is accepted, declined, canceled or expires.',
        acknowledge: 'Done',
        format: 'text',
        fields: [{ path: 'acceptUrl', label: 'Invite link' }],
      },
      visible: {
        dialect: 'cel',
        source: "((features.cloudManaged != true && has(record.status) && record.status == 'pending') "
          + `&& (${INVITE_REACH})) && features.organization != false`,
      },
    },
  ],
  listViews: {
    pending: { name: 'pending', label: 'Pending', type: 'grid', columns: ['email', 'role', 'status'] },
  },
};

/** The seeded admin: an org owner, inside every invite reach. */
const ADMIN = { id: 'u1', name: 'Dev Admin', positions: ['org_owner'] };

/**
 * The auth features a stock boot serves (`GET /api/v1/auth/config`), the keys
 * these predicates read. `cloudManaged` is served `false`, not left out: an
 * absent key fails the predicate closed.
 */
const FEATURES = { organization: true, cloudManaged: false };

const PENDING_ROW = { id: 'inv1', email: 'ada@example.com', role: 'member', status: 'pending' };
const ACCEPTED_ROW = { id: 'inv2', email: 'grace@example.com', role: 'member', status: 'accepted' };

/** The accept page under the console mount, as `copy_invitation_link` answers it. */
const ACCEPT_URL = 'https://acme.example.com/_console/accept-invitation/inv1';

const INVITE_DOOR = '/api/v1/actions/sys_invitation/invite_user';
const COPY_DOOR = '/api/v1/actions/sys_invitation/copy_invitation_link';

type Answer = { status: number; body: unknown };
let answers: Record<string, Answer>;
let fetchSpy: ReturnType<typeof vi.fn>;
let writeText: ReturnType<typeof vi.fn>;

/** invite-member's answer through the action door, with the delivery outcome. */
function inviteAnswer(outcome: 'sent' | 'link_only'): Answer {
  return {
    status: 200,
    body: { success: true, data: { ...PENDING_ROW, organizationId: 'org1', outcome } },
  };
}

beforeEach(() => {
  answers = {
    [INVITE_DOOR]: inviteAnswer('link_only'),
    [COPY_DOOR]: { status: 200, body: { success: true, data: { acceptUrl: ACCEPT_URL } } },
  };
  fetchSpy = vi.fn(async (url: unknown) => {
    const door = Object.keys(answers).find((d) => String(url).includes(d));
    const answer = door ? answers[door] : { status: 200, body: { data: [] } };
    return new Response(JSON.stringify(answer.body), {
      status: answer.status,
      headers: { 'content-type': 'application/json' },
    });
  });
  vi.stubGlobal('fetch', fetchSpy);
  writeText = vi.fn(async () => {});
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
});

afterEach(() => {
  act(() => { toast.dismiss(); });
  cleanup();
  vi.unstubAllGlobals();
});

function mountInvitations(rows: Array<Record<string, unknown>> = []) {
  const i18n = createI18n({ defaultLanguage: 'en', detectBrowserLanguage: false });
  const dataSource = {
    find: vi.fn(async () => ({ data: rows, total: rows.length })),
    findOne: vi.fn(async () => null),
    getObjectSchema: vi.fn(async (name: string) => (name === 'sys_invitation' ? SYS_INVITATION : null)),
    create: vi.fn(async () => ({})),
    update: vi.fn(async () => ({})),
    delete: vi.fn(async () => ({})),
  } as never;
  return render(
    <I18nProvider instance={i18n}>
      <ConsoleToaster />
      <ExpressionProvider user={ADMIN} features={FEATURES}>
        <MemoryRouter initialEntries={['/apps/setup/sys_invitation/view/pending']}>
          <Routes>
            <Route
              path="/apps/:appName/:objectName/view/:viewId"
              element={<ObjectView dataSource={dataSource} objects={[SYS_INVITATION]} onEdit={() => {}} />}
            />
          </Routes>
        </MemoryRouter>
      </ExpressionProvider>
    </I18nProvider>,
  );
}

function doorCalls(door: string) {
  return fetchSpy.mock.calls.filter(([u]) => String(u).includes(door));
}

/** Invite ada@example.com through the toolbar dialog and wait for the request. */
async function inviteAda(): Promise<void> {
  fireEvent.click(await screen.findByRole('button', { name: /Invite User/ }, { timeout: 5000 }));
  const dialog = await screen.findByRole('dialog', undefined, { timeout: 5000 });
  await waitFor(() => expect(dialog.querySelector('input')).not.toBeNull(), { timeout: 5000 });
  fireEvent.change(within(dialog).getByRole('textbox'), { target: { value: 'ada@example.com' } });
  await act(async () => { fireEvent.click(within(dialog).getByRole('button', { name: 'Confirm' })); });
  await waitFor(() => expect(doorCalls(INVITE_DOOR)).toHaveLength(1), { timeout: 5000 });
}

/** Open the row menu of the row showing `email`; answers the menu's item labels. */
async function openRowMenu(email: string): Promise<string[]> {
  const cell = await screen.findByText(email, undefined, { timeout: 5000 });
  const row = cell.closest('tr')!;
  const trigger = await waitFor(() => {
    const t = within(row).getAllByRole('button').find((b) => b.getAttribute('aria-haspopup') === 'menu');
    expect(t).toBeDefined();
    return t!;
  }, { timeout: 5000 });
  fireEvent.pointerDown(trigger, { button: 0, pointerType: 'mouse' });
  const items = await screen.findAllByRole('menuitem', undefined, { timeout: 5000 });
  return items.map((item) => (item.textContent ?? '').trim());
}

describe('objectstack#27797 — the invite toast follows the delivery outcome', () => {
  it('a `link_only` answer toasts the created/no-mail copy, never "sent"', async () => {
    mountInvitations();
    await inviteAda();

    expect(
      await screen.findByText(`Invitation created for ada@example.com. ${LINK_ONLY_TAIL}`, undefined, { timeout: 5000 }),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Invitation sent/)).toBeNull();
  });

  it('control: a `sent` answer keeps "Invitation sent to …"', async () => {
    answers[INVITE_DOOR] = inviteAnswer('sent');
    mountInvitations();
    await inviteAda();

    expect(await screen.findByText('Invitation sent to ada@example.com', undefined, { timeout: 5000 })).toBeInTheDocument();
    expect(screen.queryByText(/no email went out/)).toBeNull();
  });
});

describe('objectstack#27797 — Copy Invite Link hands the accept URL to the clipboard', () => {
  it('the pending row\'s menu runs the server action and the result dialog copies its `acceptUrl`', async () => {
    mountInvitations([PENDING_ROW]);
    expect(await openRowMenu(PENDING_ROW.email)).toContain('Copy Invite Link');

    await act(async () => { fireEvent.click(screen.getByRole('menuitem', { name: /Copy Invite Link/ })); });
    await waitFor(() => expect(doorCalls(COPY_DOOR)).toHaveLength(1), { timeout: 5000 });
    const [, init] = doorCalls(COPY_DOOR)[0];
    expect(JSON.stringify(JSON.parse(String((init as RequestInit).body)))).toContain('"inv1"');

    const dialog = await screen.findByRole('dialog', { name: 'Invite link' }, { timeout: 5000 });
    const value = within(dialog).getByText(ACCEPT_URL);
    expect(value.tagName).toBe('CODE');
    await act(async () => { fireEvent.click(within(value.parentElement!).getByRole('button')); });

    expect(writeText).toHaveBeenCalledTimes(1);
    expect(writeText).toHaveBeenCalledWith(ACCEPT_URL);
  });

  it('control: an accepted invitation\'s menu offers no Copy Invite Link', async () => {
    mountInvitations([ACCEPTED_ROW]);
    const items = await openRowMenu(ACCEPTED_ROW.email);

    expect(items).toContain('Resend Invitation');
    expect(items).not.toContain('Copy Invite Link');
  });
});
