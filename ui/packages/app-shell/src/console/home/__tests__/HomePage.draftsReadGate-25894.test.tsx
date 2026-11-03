// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack-ai/objectstack#25894 — Home reads the pending-drafts ledger only
 * for a session the ledger admits.
 *
 * Measured on the 2026-10-25 browser pass: signed in as a member with no
 * metadata capability, the console sent `GET /api/v1/meta/_drafts` and logged
 * its 403 as a resource error. Home is every member's landing (the approvals
 * inbox lives here), and its drafts row read the env-wide ledger for whoever
 * opened it. The door admits `studio.access`, `setup.access` or
 * `manage_metadata` (`mayReadPendingDrafts`); a session holding none of them
 * is now sent no read.
 *
 * Drives the REAL `MePermissionsProvider` over a `/me/permissions` payload, as
 * `HomePage.authoringCapabilityGate.test.tsx` does, so the gate consumes the
 * server's answer through `hasCapabilities`.
 *
 * Pinned:
 *  - a reported set holding none of the three: no `_drafts` read, no row;
 *  - CONTROL: each of the three alone reads the ledger and renders the row;
 *  - CONTROL: an unreported set (no `systemPermissions`) fails OPEN and reads.
 */

import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { act, render, screen, cleanup } from '@testing-library/react';
import { MePermissionsProvider, type MePermissionsResponse, type MePermissionsAuthenticatedResponse } from '@object-ui/permissions';

vi.mock('react-router-dom', async () => {
  const { createElement } = await import('react');
  return {
    useNavigate: () => vi.fn(),
    Link: ({ to, ...rest }: { to: string } & Record<string, unknown>) => createElement('a', { ...rest, href: to }),
  };
});

vi.mock('@object-ui/i18n', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useObjectTranslation: () => ({ t: (key: string) => `«${key}»`, language: 'en' }),
  useObjectLabel: () => ({ appLabel: (app: any) => String(app?.label ?? app?.name ?? '') }),
}));

vi.mock('@object-ui/auth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAuth: () => ({ user: { id: 'u1', name: 'Sales Manager', email: 'sales.manager@example.com' } }),
  useWorkspaceAdminStatus: () => ({ isAdmin: false, isResolved: true }),
}));

vi.mock('@object-ui/plugin-chatbot/core', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@object-ui/plugin-chatbot/core')>()),
  useAgents: () => ({ agents: [] }),
  isAskAgent: () => false,
  agentHasCapability: () => false,
}));

vi.mock('../../../providers/MetadataProvider', () => ({
  useMetadata: () => ({ apps: [{ name: 'crm', label: 'CRM' }], loading: false }),
}));
vi.mock('../../../context/NavigationContext', () => ({
  useNavigationContext: () => ({ currentAppName: 'crm' }),
}));
vi.mock('../../../hooks/useRecentItems', () => ({ useRecentItems: () => ({ recentItems: [] }) }));
vi.mock('../../../hooks/useFavorites', () => ({ useFavorites: () => ({ favorites: [] }) }));
vi.mock('../../../hooks/useHomeInbox', () => ({
  useHomeInbox: () => ({
    pendingApprovalsCount: 0,
    pendingApprovals: [],
    pendingApprovalsStatus: 'ready',
    pendingApprovalsReadable: true,
    notifications: [],
    unreadTopicCount: 0,
    notificationsStatus: 'ready',
    notificationsReadable: true,
    activity: { value: [], status: 'ready', readable: true },
  }),
}));
vi.mock('../../../hooks/useAiSurface', () => ({ resolveAiApiBase: () => '' }));
vi.mock('../../../preview/usePublishAllDrafts', () => ({
  usePublishAllDrafts: () => ({ publishAll: async () => ({ ok: true }), publishing: false }),
}));
vi.mock('../../../runtime-config', () => ({
  getRuntimeConfig: () => ({ branding: { productName: 'ObjectStack' } }),
  isMarketplaceEnabled: () => true,
  isAiStudioEnabled: () => true,
}));

// Home marks an opened notification read through the bell's own write
// (`useInboxBell`); this harness serves no inbox feed, so the write is stubbed.
vi.mock('../../../hooks/useInboxBell', () => ({ useInboxBell: () => ({ markRead: vi.fn() }) }));

import { HomePage } from '../HomePage';

const DRAFTS_ROUTE = '/api/v1/meta/_drafts';
const routeOf = (url: string) => url.split('?')[0];

/** Two drafts in two packages: the row names no package, so no package list is read. */
const DRAFTS = [
  { type: 'object', name: 'visit', label: 'Visit', packageId: 'com.a' },
  { type: 'object', name: 'invoice', label: 'Invoice', packageId: 'com.b' },
];

let fetchCalls: string[] = [];

beforeEach(() => {
  fetchCalls = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: unknown) => {
      const url = String(input);
      fetchCalls.push(url);
      if (routeOf(url) === DRAFTS_ROUTE) return { ok: true, status: 200, json: async () => ({ drafts: DRAFTS }) };
      return { ok: false, status: 404, json: async () => ({}) };
    }),
  );
});

afterEach(() => {
  expect(fetchCalls.filter((url) => routeOf(url) !== DRAFTS_ROUTE)).toEqual([]);
  // Unmount before restoring the real `fetch` (objectui#7439).
  cleanup();
  vi.unstubAllGlobals();
});

const payload = (systemPermissions?: string[]): MePermissionsAuthenticatedResponse =>
  ({
    authenticated: true,
    userId: 'u1',
    tenantId: 'acme',
    positions: ['everyone'],
    hasAnyQueue: false,
    permissionSets: ['member_default'],
    ...(systemPermissions ? { systemPermissions } : {}),
    objects: {},
    fields: {},
  }) as MePermissionsAuthenticatedResponse;

async function renderHome(permissions: MePermissionsResponse) {
  render(
    <MePermissionsProvider initialPermissions={permissions}>
      <HomePage />
    </MePermissionsProvider>,
  );
  await act(async () => {
    for (let i = 0; i < 20; i++) await new Promise((r) => setTimeout(r, 0));
  });
}

const draftsReads = () => fetchCalls.filter((url) => routeOf(url) === DRAFTS_ROUTE);

describe('Home reads the drafts ledger only for a session it admits (objectstack-ai/objectstack#25894)', () => {
  it('a member holding none of the ledger capabilities: no `_drafts` read and no row', async () => {
    await renderHome(payload(['export_reports']));

    expect(screen.getByRole('heading', { level: 1 }), 'Home never rendered: the harness is dead').toBeInTheDocument();
    expect(draftsReads()).toEqual([]);
    expect(screen.queryByTestId('home-pending-drafts')).toBeNull();
  });

  it('a REPORTED empty set holds none of them either: no read', async () => {
    await renderHome(payload([]));

    expect(draftsReads()).toEqual([]);
  });

  it.each(['setup.access', 'studio.access', 'manage_metadata'])(
    'CONTROL: `%s` alone reads the ledger and shows the row',
    async (capability) => {
      await renderHome(payload([capability]));

      expect(draftsReads()).toEqual([DRAFTS_ROUTE]);
      expect(await screen.findByTestId('home-pending-drafts')).toBeInTheDocument();
    },
  );

  it('CONTROL: an unreported capability set fails OPEN and reads', async () => {
    await renderHome(payload(undefined));

    expect(draftsReads()).toEqual([DRAFTS_ROUTE]);
    expect(await screen.findByTestId('home-pending-drafts')).toBeInTheDocument();
  });
});
