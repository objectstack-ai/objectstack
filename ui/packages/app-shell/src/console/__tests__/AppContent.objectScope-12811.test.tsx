// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#12811 — the object requests one console open issues.
 *
 * Measured before this card: opening `/apps/crm_enterprise/crm_account` asked
 * `GET /api/v1/meta/object` for the whole registry (97 objects, 745 KB),
 * because three readers on the open path read `useMetadata().objects`:
 * `AppContent` (for the route, the chrome and the recent-items tracker),
 * `useActionModal` (mounted at the console root) and `useNavMemberGates` (the
 * sidebar's capability prune). The open path now reads the app's object scope:
 * `?package=` with the app's package id, and by name the route's object and
 * its lookup targets when the package does not hold them.
 *
 * The harness is the REAL `MetadataProvider`, with a client double that records
 * each call as its URL would read, under the real `AppContent`. The chrome is a
 * stand-in that does what the sidebar's capability gate does for the app's
 * one `requiresObject` entry, and `useActionModal` is mounted beside it, as
 * `ConsoleShell` mounts it.
 *
 * CONTROLs: an app item with no package id asks the whole registry, as before,
 * and so does the root of an app whose package holds no objects of its own (a
 * platform app such as Setup; its object routes read by name, objectui#13046);
 * a record overlay (`?recordId=`) reads the whole registry, because a record's
 * related lists come from every object that points at it.
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
// The chrome: what the sidebar's capability gate asks, and the list it is handed.
vi.mock('../../layout/ConsoleLayout', async () => {
  const { useNavMemberGates } = await import('../../hooks/useNavMemberGates');
  return {
    ConsoleLayout: ({ children, objects }: { children?: React.ReactNode; objects: Array<{ name: string }> }) => {
      const gates = useNavMemberGates();
      return (
        <div data-testid="console-layout" data-chrome-objects={objects.map((o) => o.name).join(',')}>
          <span data-testid="cloud-only-entry">{String(gates.checkCapability('object', 'cloud_only'))}</span>
          {children}
        </div>
      );
    },
  };
});
vi.mock('../../chrome/CommandPalette', () => ({ CommandPalette: () => null }));
vi.mock('../../chrome/KeyboardShortcutsDialog', () => ({ KeyboardShortcutsDialog: () => null }));
vi.mock('../../chrome/OnboardingWalkthrough', () => ({ OnboardingWalkthrough: () => null }));
vi.mock('../../views/ObjectView', () => ({
  ObjectView: ({ objects }: { objects: Array<{ name: string }> }) => (
    <div data-testid="object-view">{objects.map((o) => o.name).join(',')}</div>
  ),
}));
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

const actionRunnerStub = { registerHandler: vi.fn(), getContext: () => ({}) };
vi.mock('@object-ui/react', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useActionRunner: () => ({ execute: vi.fn(), runner: actionRunnerStub }),
  useGlobalUndo: () => {},
  useMutationInvalidationBridge: () => {},
}));

import { AppContent } from '../AppContent';
import { MetadataProvider } from '../../providers/MetadataProvider';
import { useActionModal } from '../../hooks/useActionModal';

const CRM = 'app.crm';
const OBJECTS = [
  { name: 'crm_account', _packageId: CRM, fields: { owner: { type: 'lookup', reference: 'sys_user' }, parent: { type: 'lookup', reference: 'crm_account' } } },
  { name: 'crm_contact', _packageId: CRM, fields: { account: { type: 'lookup', reference: 'crm_account' } } },
  { name: 'crm_case', _packageId: 'app.service', fields: { account: { type: 'lookup', reference: 'crm_account' } } },
  { name: 'sys_user', _packageId: 'plugin.auth', fields: {} },
];
const NAVIGATION = [
  { id: 'n1', type: 'object', label: 'Accounts', objectName: 'crm_account' },
  { id: 'n2', type: 'object', label: 'Cases', objectName: 'crm_case' },
  // An entry for an object this runtime may not register (a cloud-only one).
  { id: 'n3', type: 'object', label: 'Cloud', objectName: 'cloud_only', requiresObject: 'cloud_only' },
];

interface Server {
  calls: string[];
  apps: unknown[];
  holdByName: boolean;
  release: () => void;
}
const server: Server = { calls: [], apps: [], holdByName: false, release: () => {} };

function makeAdapter() {
  const held: Array<() => void> = [];
  server.release = () => held.splice(0).forEach((go) => go());
  return {
    clearCache: vi.fn(),
    invalidateCache: vi.fn(),
    // objectui#13044 — the provider's by-name OBJECT read goes through the
    // adapter's `getObjectSchema`. This double answers it from the same
    // by-name door, unwrapped the way the adapter unwraps it.
    getObjectSchema(this: { getClient(): any }, name: string) {
      return this.getClient()
        .meta.getItem('object', name)
        .then((res: any) => (res && typeof res === 'object' && 'item' in res ? res.item : res));
    },
    getClient: () => ({
      meta: {
        getItems: (type: string, options?: { packageId?: string }) => {
          server.calls.push(options?.packageId ? `${type}?package=${options.packageId}` : type);
          const all = type === 'object' ? OBJECTS : type === 'app' ? server.apps : [];
          const items = options?.packageId ? all.filter((o: any) => o._packageId === options.packageId) : all;
          return Promise.resolve({ type, items: structuredClone(items) });
        },
        getItem: (type: string, name: string) => {
          server.calls.push(`${type}/${name}`);
          const item = (type === 'object' ? OBJECTS : []).find((o) => o.name === name);
          const answer = () =>
            item ? Promise.resolve({ type, name, item: structuredClone(item) }) : Promise.reject(Object.assign(new Error('not found'), { httpStatus: 404, code: 'RESOURCE_NOT_FOUND' }));
          if (!server.holdByName) return answer();
          return new Promise((resolve, reject) => held.push(() => answer().then(resolve, reject)));
        },
      },
    }),
  } as unknown as Parameters<typeof MetadataProvider>[0]['adapter'];
}

const USER = 'u_12811';
const ORG: AuthOrganization = { id: 'org_a', name: 'Org A', slug: 'a' };

function authClient(): AuthClient {
  return {
    getSession: vi.fn(async () => ({
      // An admin by position: the workspace-admin verdict needs no member row.
      user: { id: USER, name: 'Ada', email: 'ada@test.com', role: 'admin', positions: ['admin'] },
      session: { token: 'tok-12811', activeOrganizationId: ORG.id },
    })),
    signOut: vi.fn(async () => undefined),
    getConfig: vi.fn(async () => ({ features: {} })),
    listOrganizations: vi.fn(async () => [ORG]),
    getActiveOrganization: vi.fn(async () => ORG),
    setActiveOrganization: vi.fn(async () => ORG),
    getActiveMember: vi.fn(async () => ({ id: 'm1', organizationId: ORG.id, userId: USER, role: 'owner' })),
  } as unknown as AuthClient;
}

/** `ConsoleShell` mounts `useActionModal` at the console root. */
function ActionModalHost() {
  const { modalElement } = useActionModal(dataSourceStub);
  return <>{modalElement}</>;
}

const nav: { current: NavigateFunction | null } = { current: null };
function NavProbe() {
  const navigate = useNavigate();
  useEffect(() => { nav.current = navigate; });
  return null;
}

function boot(url: string) {
  render(
    <AuthProvider authUrl="/api/auth" client={authClient()}>
      <MetadataProvider adapter={makeAdapter()}>
        <MemoryRouter initialEntries={[url]}>
          <NavProbe />
          <ActionModalHost />
          <Routes>
            <Route path="/apps/:appName/*" element={<AppContent />} />
          </Routes>
        </MemoryRouter>
      </MetadataProvider>
    </AuthProvider>,
  );
}

const objectCalls = () => server.calls.filter((c) => c === 'object' || c.startsWith('object?') || c.startsWith('object/'));
const splashUp = () => document.querySelector('[data-boot-splash]') !== null;

beforeEach(() => {
  server.calls = [];
  server.holdByName = false;
  server.apps = [{ name: 'crm', label: 'CRM', _packageId: CRM, navigation: NAVIGATION }];
  localStorage.clear();
  sessionStorage.clear();
  ActiveOrganizationStorage.clear();
});

afterEach(() => {
  cleanup();
  ActiveOrganizationStorage.clear();
});

describe('one console open asks for the app\'s objects, not the whole registry (objectui#12811)', () => {
  it('asks `meta/object` with the app\'s package, and by name only the objects outside it the open reads', async () => {
    boot('/apps/crm/crm_account');
    await waitFor(() => expect(screen.getByTestId('object-view')).toBeInTheDocument());
    await waitFor(() => expect(screen.getByTestId('cloud-only-entry')).toHaveTextContent('false'));
    await waitFor(() => expect(screen.getByTestId('object-view')).toHaveTextContent('sys_user'));

    expect(objectCalls()).not.toContain('object');
    expect(objectCalls()[0]).toBe(`object?package=${CRM}`);
    // The route's lookup target outside the package, and the object the app's `requiresObject` entry names.
    expect([...objectCalls()].sort()).toEqual([`object?package=${CRM}`, 'object/cloud_only', 'object/sys_user'].sort());
    // The route element and the chrome are handed the scope.
    expect(screen.getByTestId('object-view')).toHaveTextContent('crm_account,crm_contact,sys_user');
    expect(screen.getByTestId('console-layout').getAttribute('data-chrome-objects')).toBe('crm_account,crm_contact,sys_user');
  });

  it('CONTROL: an app item with no package id asks the whole registry, as before', async () => {
    server.apps = [{ name: 'crm', label: 'CRM', navigation: NAVIGATION }];
    boot('/apps/crm/crm_account');
    await waitFor(() => expect(screen.getByTestId('object-view')).toBeInTheDocument());

    expect(objectCalls()).toContain('object');
    expect(objectCalls().some((c) => c.startsWith('object?'))).toBe(false);
    expect(screen.getByTestId('object-view')).toHaveTextContent('crm_account,crm_contact,crm_case,sys_user');
  });

  it("CONTROL: the root of an app whose package holds no objects of its own reads the whole registry, and asks none by name", async () => {
    // objectui#13046 moved this control from an object's route to the app's
    // root: an object's route in such an app now reads by name
    // (`AppContent.emptyPackageScope-13046.test.tsx`), its landing does not.
    server.apps = [{ name: 'crm', label: 'Setup-like', _packageId: 'app.platform', navigation: NAVIGATION }];
    boot('/apps/crm');
    await waitFor(() => expect(objectCalls()).toContain('object'));
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(objectCalls()).toEqual(['object?package=app.platform', 'object']);
  });

  it('CONTROL: a record overlay reads the whole registry (a record\'s related lists come from every object)', async () => {
    boot('/apps/crm/crm_account?recordId=r1');
    await waitFor(() => expect(screen.getByTestId('object-view')).toBeInTheDocument());

    expect(objectCalls()).toContain('object');
    expect(screen.getByTestId('object-view')).toHaveTextContent('crm_case');
  });
});

describe('an object outside the package is read by name, behind the skeleton (objectui#12811)', () => {
  it('holds the splash for a route object outside the package until its by-name answer lands', async () => {
    server.holdByName = true;
    boot('/apps/crm/crm_case');
    await waitFor(() => expect(server.calls).toContain('object/crm_case'));
    expect(splashUp()).toBe(true);
    expect(screen.queryByTestId('object-view')).not.toBeInTheDocument();

    act(() => server.release());
    await waitFor(() => expect(screen.getByTestId('object-view')).toHaveTextContent('crm_case'));
    expect(objectCalls()).not.toContain('object');
  });

  it('does not hold the route for its lookup targets: they are asked beside it, and the list renders meanwhile', async () => {
    server.holdByName = true;
    boot('/apps/crm/crm_account');
    await waitFor(() => expect(screen.getByTestId('object-view')).toHaveTextContent('crm_account,crm_contact'));
    expect(server.calls).toContain('object/sys_user');
    expect(screen.getByTestId('object-view')).not.toHaveTextContent('sys_user');

    act(() => server.release());
    await waitFor(() => expect(screen.getByTestId('object-view')).toHaveTextContent('sys_user'));
  });

  it('after the first paint, shows the route skeleton inside the chrome, never an empty route, until it lands', async () => {
    boot('/apps/crm/crm_contact');
    await waitFor(() => expect(screen.getByTestId('object-view')).toBeInTheDocument());

    server.holdByName = true;
    await act(async () => { nav.current!('/apps/crm/crm_case'); });
    await waitFor(() => expect(server.calls).toContain('object/crm_case'));

    expect(screen.getByTestId('console-layout')).toBeInTheDocument();
    expect(screen.getByTestId('route-metadata-skeleton')).toBeInTheDocument();
    expect(screen.queryByTestId('object-view')).not.toBeInTheDocument();
    expect(splashUp()).toBe(false);

    act(() => server.release());
    await waitFor(() => expect(screen.getByTestId('object-view')).toHaveTextContent('crm_case'));
    expect(screen.queryByTestId('route-metadata-skeleton')).not.toBeInTheDocument();
    expect(objectCalls()).not.toContain('object');
  });
});
