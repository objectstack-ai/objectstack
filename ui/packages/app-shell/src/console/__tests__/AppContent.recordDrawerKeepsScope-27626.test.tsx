// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#27626 — opening a record from a scoped list keeps the list.
 *
 * Measured in the console (app-crm): the first record opened from a list
 * replaced the list with the route skeleton, then mounted it again, and the
 * remounted list read its rows again. The drawer (`?recordId=`) made the route
 * read the whole registry INSTEAD of the app's object scope (a record's related
 * lists come from every object that points at it), and the route slot waited
 * for that registry. Every later open and close also handed the list a
 * different document for its object (the registry's, then the scope's).
 *
 * Pinned through the REAL `MetadataProvider` and the real `AppContent`, with
 * the `AppContent.objectScope-12811` harness and a whole-registry read the test
 * holds open:
 *  - the route keeps its scope under the drawer and never waits for the
 *    registry: no skeleton, the route element is never remounted;
 *  - the drawer still reads the whole registry, and it joins the scope once it
 *    lands (the record's related lists see every object);
 *  - the list's object keeps ONE document before, during and after the
 *    drawer, cold and warm;
 *  - a deep link to a drawer draws the list on its scope before the registry
 *    has landed.
 * CONTROL: the record form overlay (`?form=`) still reads the whole registry
 * instead of the scope.
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
const routeElement = vi.hoisted(() => ({ mounts: 0, docs: [] as unknown[] }));
vi.mock('../../views/ObjectView', async () => {
  const { useEffect: useMountEffect } = await import('react');
  return {
    ObjectView: ({ objects }: { objects: Array<{ name: string }> }) => {
      useMountEffect(() => {
        routeElement.mounts++;
      }, []);
      const doc = objects.find((o) => o.name === 'crm_account');
      if (doc && routeElement.docs[routeElement.docs.length - 1] !== doc) routeElement.docs.push(doc);
      return <div data-testid="object-view">{objects.map((o) => o.name).join(',')}</div>;
    },
  };
});
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
  /** Hold the whole-registry read (`meta/object` with no package) until `releaseRegistry`. */
  holdRegistry: boolean;
  releaseRegistry: () => void;
}
const server: Server = {
  calls: [], apps: [], holdByName: false, release: () => {}, holdRegistry: false, releaseRegistry: () => {},
};

function makeAdapter() {
  const held: Array<() => void> = [];
  server.release = () => held.splice(0).forEach((go) => go());
  const heldRegistry: Array<() => void> = [];
  server.releaseRegistry = () => heldRegistry.splice(0).forEach((go) => go());
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
          const answer = { type, items: structuredClone(items) };
          if (type === 'object' && !options?.packageId && server.holdRegistry) {
            return new Promise((resolve) => heldRegistry.push(() => resolve(answer)));
          }
          return Promise.resolve(answer);
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
  server.holdRegistry = false;
  routeElement.mounts = 0;
  routeElement.docs = [];
  server.apps = [{ name: 'crm', label: 'CRM', _packageId: CRM, navigation: NAVIGATION }];
  localStorage.clear();
  sessionStorage.clear();
  ActiveOrganizationStorage.clear();
});

afterEach(() => {
  cleanup();
  ActiveOrganizationStorage.clear();
});

const skeletonUp = () => screen.queryByTestId('route-metadata-skeleton') !== null;
const registryReads = () => server.calls.filter((c) => c === 'object').length;
const go = (to: string) => act(async () => { nav.current!(to); });
const SCOPE = 'crm_account,crm_contact,sys_user';

describe('objectstack#27626 — a record drawer reads the registry beside the scope, never instead of it', () => {
  it('cold: the list keeps its scope, is never remounted, and the registry joins it once it lands', async () => {
    boot('/apps/crm/crm_account');
    await waitFor(() => expect(screen.getByTestId('object-view')).toHaveTextContent(SCOPE));
    expect(registryReads()).toBe(0);
    expect(routeElement.mounts).toBe(1);

    server.holdRegistry = true;
    await go('/apps/crm/crm_account?recordId=r1');
    await waitFor(() => expect(registryReads()).toBe(1));
    // The registry is out: the route draws on its scope meanwhile.
    expect(skeletonUp()).toBe(false);
    expect(screen.getByTestId('object-view')).toHaveTextContent(SCOPE);

    act(() => server.releaseRegistry());
    await waitFor(() => expect(screen.getByTestId('object-view')).toHaveTextContent('crm_case'));
    expect(screen.getByTestId('object-view')).toHaveTextContent(`${SCOPE},crm_case`);

    await go('/apps/crm/crm_account');
    await waitFor(() => expect(screen.getByTestId('object-view')).not.toHaveTextContent('crm_case'));

    expect(routeElement.mounts).toBe(1);
    expect(routeElement.docs).toHaveLength(1);
  });

  it('warm: a later open joins the registry at once, asks it no more, and keeps the same document', async () => {
    boot('/apps/crm/crm_account');
    await waitFor(() => expect(screen.getByTestId('object-view')).toHaveTextContent(SCOPE));
    await go('/apps/crm/crm_account?recordId=r1');
    await waitFor(() => expect(screen.getByTestId('object-view')).toHaveTextContent('crm_case'));
    await go('/apps/crm/crm_account');
    await waitFor(() => expect(screen.getByTestId('object-view')).not.toHaveTextContent('crm_case'));

    await go('/apps/crm/crm_account?recordId=r2');
    expect(screen.getByTestId('object-view')).toHaveTextContent('crm_case');
    expect(skeletonUp()).toBe(false);
    await go('/apps/crm/crm_account');

    expect(registryReads()).toBe(1);
    expect(routeElement.mounts).toBe(1);
    expect(routeElement.docs).toHaveLength(1);
  });

  it('a deep link to a drawer draws the list on its scope before the registry has landed', async () => {
    server.holdRegistry = true;
    boot('/apps/crm/crm_account?recordId=r1');
    await waitFor(() => expect(screen.getByTestId('object-view')).toHaveTextContent(SCOPE));
    expect(registryReads()).toBe(1);
    expect(screen.getByTestId('object-view')).not.toHaveTextContent('crm_case');

    act(() => server.releaseRegistry());
    await waitFor(() => expect(screen.getByTestId('object-view')).toHaveTextContent(`${SCOPE},crm_case`));
    expect(routeElement.mounts).toBe(1);
    expect(routeElement.docs).toHaveLength(1);
  });

  it('CONTROL: the record form overlay still reads the whole registry instead of the scope', async () => {
    boot('/apps/crm/crm_account?form=new');
    await waitFor(() => expect(registryReads()).toBe(1));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(objectCalls().some((c) => c.startsWith('object?'))).toBe(false);
  });
});
