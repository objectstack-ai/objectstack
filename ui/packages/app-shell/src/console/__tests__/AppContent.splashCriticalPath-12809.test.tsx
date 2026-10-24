// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#12809 — what the console splash (`data-boot-splash`) waits for.
 *
 * The critical path is the session, the membership answer the admin verdict
 * needs, and the metadata the CURRENT route reads. Measured before this card:
 * `organization/list` → `get-full-organization` → `get-active-member` ran one
 * after another, and `AppContent` held the splash until the `object`,
 * `dashboard`, `report` and `page` buckets had all loaded, whatever the route.
 *
 * The harness is the real `AuthProvider` (with a server double) and the real
 * `useWorkspaceAdminStatus` under the real `AppContent`. The server double's
 * `getActiveOrganization` (`get-full-organization`) never answers, and every
 * metadata bucket answers only when the test settles it. So each step below is
 * an observation of what the splash waited for, not an inference.
 *
 * `me/permissions` is the console host's (`ConsolePermissionsScope` in
 * `apps/console`), mounted above `AppContent`; it stays on the critical path
 * and is outside this harness.
 *
 * CONTROL: after the first paint, a route whose buckets have not landed draws
 * its skeleton inside the console chrome, then its content; and a bucket that
 * refetches keeps the route mounted.
 */

import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React, { useEffect } from 'react';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route, useNavigate, type NavigateFunction } from 'react-router-dom';
import { AuthProvider, ActiveOrganizationStorage } from '@object-ui/auth';
import type { AuthClient, AuthOrganization } from '@object-ui/auth';

vi.mock('@object-ui/plugin-designer', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@object-ui/plugin-designer')>()),
  CreateAppPage: () => null,
  EditAppPage: () => null,
  DashboardDesignPage: () => null,
}));
vi.mock('../../layout/ConsoleLayout', () => ({
  ConsoleLayout: ({ children }: { children?: React.ReactNode }) => (
    <div data-testid="console-layout">{children}</div>
  ),
}));
vi.mock('../../chrome/CommandPalette', () => ({ CommandPalette: () => null }));
vi.mock('../../chrome/KeyboardShortcutsDialog', () => ({ KeyboardShortcutsDialog: () => null }));
vi.mock('../../chrome/OnboardingWalkthrough', () => ({ OnboardingWalkthrough: () => null }));
vi.mock('../../views/ObjectView', () => ({
  ObjectView: ({ objects }: { objects: Array<{ name: string }> }) => (
    <div data-testid="object-view">{objects.map((o) => o.name).join(',')}</div>
  ),
}));
vi.mock('../../views/ReportView', () => ({ ReportView: () => <div data-testid="report-view" /> }));
vi.mock('@object-ui/i18n', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useObjectTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => String(options?.defaultValue ?? key),
  }),
  useObjectLabel: () => ({ objectLabel: ({ label }: { label?: string }) => label, objectPluralLabel: () => '' }),
}));

const dataSourceStub = {
  onConnectionStateChange: () => () => {},
  getConnectionState: () => 'connected',
};
vi.mock('../../providers/AdapterProvider', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAdapter: () => dataSourceStub,
}));

/**
 * A metadata cache whose lazy buckets answer only when the test says so. Same
 * status words and read semantics as `MetadataProvider`: `idle` until asked,
 * `loading` while in flight, items `[]` until `ready`.
 */
const meta = vi.hoisted(() => ({
  status: {} as Record<string, string>,
  items: {} as Record<string, unknown[]>,
  version: 0,
  listeners: new Set<() => void>(),
  ensureType: null as unknown as ReturnType<typeof vi.fn>,
}));
function bump() {
  meta.version += 1;
  meta.listeners.forEach((l) => l());
}
vi.mock('../../providers/MetadataProvider', async (importOriginal) => {
  const react = await import('react');
  return {
    ...(await importOriginal<Record<string, unknown>>()),
    useMetadata: () => {
      react.useSyncExternalStore(
        (l: () => void) => { meta.listeners.add(l); return () => meta.listeners.delete(l); },
        () => meta.version,
      );
      const read = (type: string) => (meta.status[type] === 'ready' || meta.status[type] === 'loading' ? meta.items[type] ?? [] : []);
      return {
        apps: [{ name: 'crm', label: 'CRM', navigation: [] }],
        get objects() { return read('object'); },
        get dashboards() { return read('dashboard'); },
        get reports() { return read('report'); },
        get pages() { return read('page'); },
        loading: false,
        error: null,
        ensureType: meta.ensureType,
        getTypeStatus: (type: string) => meta.status[type] ?? 'idle',
        refresh: vi.fn(async () => {}),
      };
    },
  };
});

const actionRunnerStub = { registerHandler: vi.fn(), getContext: () => ({}) };
vi.mock('@object-ui/react', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useActionRunner: () => ({ execute: vi.fn(), runner: actionRunnerStub }),
  useGlobalUndo: () => {},
  useMutationInvalidationBridge: () => {},
}));

import { AppContent } from '../AppContent';

const USER = 'u_12809';
const ORG: AuthOrganization = { id: 'org_a', name: 'Org A', slug: 'a' };

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}

function createServer() {
  const list = deferred<AuthOrganization[]>();
  const member = deferred<unknown>();
  const client = {
    getSession: vi.fn(async () => ({
      // `role: 'user'`, no positions: the verdict needs the member row.
      user: { id: USER, name: 'Ada', email: 'ada@test.com', role: 'user' },
      session: { token: 'tok-12809', activeOrganizationId: ORG.id },
    })),
    signOut: vi.fn(async () => undefined),
    getConfig: vi.fn(async () => ({ features: {} })),
    listOrganizations: vi.fn(() => list.promise),
    // `get-full-organization`: never answers. The splash must not wait on it.
    getActiveOrganization: vi.fn(() => new Promise(() => {})),
    setActiveOrganization: vi.fn(async () => ORG),
    getActiveMember: vi.fn(() => member.promise),
  };
  return {
    client: client as unknown as AuthClient & typeof client,
    answerList: () => act(async () => { list.resolve([ORG]); }),
    answerMember: () => act(async () => {
      member.resolve({ id: 'm1', organizationId: ORG.id, userId: USER, role: 'member' });
    }),
  };
}

const settle = (type: string, items: unknown[] = []) => act(async () => {
  meta.items[type] = items;
  meta.status[type] = 'ready';
  bump();
});

const nav: { current: NavigateFunction | null } = { current: null };
function NavProbe() {
  const navigate = useNavigate();
  useEffect(() => { nav.current = navigate; });
  return null;
}

function boot(client: AuthClient, url: string) {
  render(
    <AuthProvider authUrl="/api/auth" client={client}>
      <MemoryRouter initialEntries={[url]}>
        <NavProbe />
        <Routes>
          <Route path="/apps/:appName/*" element={<AppContent />} />
        </Routes>
      </MemoryRouter>
    </AuthProvider>,
  );
}

const splashUp = () => document.querySelector('[data-boot-splash]') !== null;
const askedTypes = () => new Set(meta.ensureType.mock.calls.map((c) => c[0] as string));

beforeEach(() => {
  meta.status = {};
  meta.items = {};
  meta.version = 0;
  meta.ensureType = vi.fn((type: string) => {
    if ((meta.status[type] ?? 'idle') === 'idle') meta.status[type] = 'loading';
    return Promise.resolve(meta.items[type] ?? []);
  });
  localStorage.clear();
  ActiveOrganizationStorage.clear();
});

afterEach(() => {
  cleanup();
  ActiveOrganizationStorage.clear();
});

describe('the console splash waits for the critical path only (objectui#12809)', () => {
  it('leaves after the session, the member row and the route\'s own bucket — not get-full-organization or the other buckets', async () => {
    const { client, answerList, answerMember } = createServer();
    boot(client, '/apps/crm/account');

    await waitFor(() => expect(client.listOrganizations).toHaveBeenCalledTimes(1));
    // The member row is asked for beside the list, not after it.
    expect(client.getActiveMember).toHaveBeenCalledTimes(1);
    expect(splashUp()).toBe(true);

    await answerList();
    expect(splashUp()).toBe(true); // the member row has not answered
    await answerMember();
    expect(splashUp()).toBe(true); // the route's `object` bucket has not answered

    await settle('object', [{ name: 'account' }]);
    await waitFor(() => expect(screen.getByTestId('object-view')).toHaveTextContent('account'));
    expect(splashUp()).toBe(false);

    // What the splash did NOT wait for.
    expect(client.getActiveOrganization).not.toHaveBeenCalled();
    expect(askedTypes()).toEqual(new Set(['object']));
    for (const type of ['dashboard', 'report', 'page']) expect(meta.status[type]).toBeUndefined();
  });

  it('CONTROL: a later route whose bucket has not landed shows its skeleton inside the chrome, then its content', async () => {
    const { client, answerList, answerMember } = createServer();
    boot(client, '/apps/crm/account');
    await answerList();
    await answerMember();
    await settle('object', [{ name: 'account' }]);
    await waitFor(() => expect(screen.getByTestId('object-view')).toBeInTheDocument());

    await act(async () => { nav.current!('/apps/crm/report/pipeline'); });

    expect(screen.getByTestId('console-layout')).toBeInTheDocument();
    expect(screen.getByTestId('route-metadata-skeleton')).toBeInTheDocument();
    expect(screen.queryByTestId('report-view')).not.toBeInTheDocument();
    expect(splashUp()).toBe(false);
    expect(askedTypes().has('report')).toBe(true);

    await settle('report', [{ name: 'pipeline' }]);
    await waitFor(() => expect(screen.getByTestId('report-view')).toBeInTheDocument());
    expect(screen.queryByTestId('route-metadata-skeleton')).not.toBeInTheDocument();
  });

  it('CONTROL: a bucket that refetches keeps the route mounted; one dropped back to idle waits again', async () => {
    const { client, answerList, answerMember } = createServer();
    boot(client, '/apps/crm/account');
    await answerList();
    await answerMember();
    await settle('object', [{ name: 'account' }]);
    await waitFor(() => expect(screen.getByTestId('object-view')).toBeInTheDocument());

    await act(async () => { meta.status.object = 'loading'; bump(); });
    expect(screen.getByTestId('object-view')).toBeInTheDocument();

    await act(async () => { meta.status.object = 'idle'; meta.items.object = []; bump(); });
    expect(screen.getByTestId('route-metadata-skeleton')).toBeInTheDocument();
    expect(screen.queryByTestId('object-view')).not.toBeInTheDocument();
  });
});
