// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#12980 — a page route reads the objects its page binds, never the
 * whole object registry.
 *
 * Measured on the card: every control-plane open waited on `GET
 * /api/v1/meta/object` (97 objects, 751 KB, 307 ms of server time) because a
 * `page/:pageName` route, its page view and the chrome around it read
 * `useMetadata().objects`. A page route now reads its page's objects by name
 * (`readPageObjectScope`), beside the app's package list the chrome reads
 * anyway, and an object a block asks about outside that set by name.
 *
 * The harness is the REAL `MetadataProvider` under the real `AppContent` and
 * the real `PageView`, with a client double that records each call as its URL
 * would read (the harness of `AppContent.objectScope-12811.test.tsx`). The
 * page's blocks are a stand-in that asks the page's record navigator about an
 * object the page does not bind.
 *
 * Pins: (a) a page open reads the page and only the objects its blocks bind,
 * never the whole-registry `meta/object`, and a page that binds none (the
 * control plane's pricing page) reads none, even in an app whose package holds
 * no objects; (b) CONTROL: an app route's scoped read (objectui#12811) is
 * unchanged; (c) an object a block names outside the read set is read by name
 * when the block asks, and its link appears when it lands.
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
// The page's Studio affordance asks the package catalog; this open asks for no Studio button.
vi.mock('../../hooks/useStudioDesignGate', () => ({ useStudioDesignGate: () => null }));
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
vi.mock('@object-ui/react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@object-ui/react')>();
  return {
    ...actual,
    useActionRunner: () => ({ execute: vi.fn(), runner: actionRunnerStub }),
    useGlobalUndo: () => {},
    useMutationInvalidationBridge: () => {},
    // Stands in for the page's blocks: it reads the record navigator the page
    // publishes, as a grid's lookup cell does, and asks it about `sys_user`,
    // an object the page does not bind.
    SchemaRenderer: () => {
      const navigator = actual.useRelatedRecordActions();
      const href = navigator?.recordHref?.('sys_user', 'u1') ?? '';
      return <div data-testid="page-blocks" data-lookup-href={href} />;
    },
  };
});

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

/** A page whose blocks bind `crm_case` (outside the package) and `crm_contact` (inside it). */
const BOUND_PAGE = {
  name: 'case_board',
  label: 'Case board',
  type: 'app',
  regions: [
    {
      name: 'main',
      components: [
        { type: 'object-grid', properties: { objectName: 'crm_case' } },
        { type: 'record:related_list', dataSource: { object: 'crm_contact' } },
        { type: 'element:text', dataSource: { provider: 'api', read: { url: '/api/v1/cloud/home' } } },
      ],
    },
  ],
};
/** The control plane's pricing page: every data source is `api`, so it binds no object. */
const UNBOUND_PAGE = {
  name: 'pricing',
  label: 'Pricing',
  type: 'app',
  regions: [{ name: 'main', components: [{ type: 'element:text', dataSource: { provider: 'api', read: { url: '/api/v1/cloud/home' } } }] }],
};
const PAGES = [BOUND_PAGE, UNBOUND_PAGE];
const NAVIGATION = [
  { id: 'n1', type: 'object', label: 'Accounts', objectName: 'crm_account' },
  { id: 'n2', type: 'object', label: 'Cases', objectName: 'crm_case' },
  // An entry for an object this runtime may not register (a cloud-only one).
  { id: 'n3', type: 'object', label: 'Cloud', objectName: 'cloud_only', requiresObject: 'cloud_only' },
];

interface Server {
  calls: string[];
  apps: unknown[];
  pages: unknown[];
  holdByName: boolean;
  release: () => void;
}
const server: Server = { calls: [], apps: [], pages: [], holdByName: false, release: () => {} };

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
          const all = type === 'object' ? OBJECTS : type === 'app' ? server.apps : type === 'page' ? server.pages : [];
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

const USER = 'u_12980';
const ORG: AuthOrganization = { id: 'org_a', name: 'Org A', slug: 'a' };

function authClient(): AuthClient {
  return {
    getSession: vi.fn(async () => ({
      // An admin by position: the workspace-admin verdict needs no member row.
      user: { id: USER, name: 'Ada', email: 'ada@test.com', role: 'admin', positions: ['admin'] },
      session: { token: 'tok-12980', activeOrganizationId: ORG.id },
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

beforeEach(() => {
  server.calls = [];
  server.holdByName = false;
  server.apps = [{ name: 'crm', label: 'CRM', _packageId: CRM, navigation: NAVIGATION }];
  server.pages = PAGES;
  localStorage.clear();
  sessionStorage.clear();
  ActiveOrganizationStorage.clear();
});

afterEach(() => {
  cleanup();
  ActiveOrganizationStorage.clear();
});


describe('a page route reads the objects its page binds, never the whole registry (objectui#12980)', () => {
  it('(a) asks the app package and, by name, only the bound object outside it', async () => {
    boot('/apps/crm/page/case_board');
    await waitFor(() => expect(screen.getByTestId('page-blocks')).toBeInTheDocument());
    await waitFor(() => expect(screen.getByTestId('cloud-only-entry')).toHaveTextContent('false'));

    expect(objectCalls()).not.toContain('object');
    expect(objectCalls()[0]).toBe(`object?package=${CRM}`);
    // crm_case is bound and outside the package; crm_contact is bound and inside it;
    // cloud_only is the app's `requiresObject` entry; sys_user is what the block asked (c).
    expect(objectCalls()).toContain('object/crm_case');
    expect(objectCalls()).not.toContain('object/crm_contact');
    // The chrome is handed the page's scope: the package's objects and the bound one outside it.
    expect(screen.getByTestId('console-layout').getAttribute('data-chrome-objects')).toContain('crm_case');
  });

  it('(a) a page that binds no object reads none, in an app whose package holds no objects of its own', async () => {
    server.apps = [{ name: 'crm', label: 'Control plane', _packageId: 'app.platform', navigation: [] }];
    boot('/apps/crm/page/pricing');
    await waitFor(() => expect(screen.getByTestId('page-blocks')).toBeInTheDocument());
    await waitFor(() => expect(objectCalls()).toContain('object/sys_user'));

    // The package list (28 B on the control plane) and the object the block asked about: nothing else.
    expect([...objectCalls()].sort()).toEqual(['object/sys_user', 'object?package=app.platform']);
  });

  it('(b) CONTROL: an app route keeps its scoped read (objectui#12811)', async () => {
    boot('/apps/crm/crm_account');
    await waitFor(() => expect(screen.getByTestId('object-view')).toHaveTextContent('sys_user'));
    await waitFor(() => expect(screen.getByTestId('cloud-only-entry')).toHaveTextContent('false'));

    expect([...objectCalls()].sort()).toEqual([`object?package=${CRM}`, 'object/cloud_only', 'object/sys_user'].sort());
  });

  it('(c) an object a block asks about outside the read set is read by name, and its link appears when it lands', async () => {
    server.holdByName = true;
    boot('/apps/crm/page/case_board');
    await waitFor(() => expect(server.calls).toContain('object/crm_case'));
    act(() => server.release());
    await waitFor(() => expect(screen.getByTestId('page-blocks')).toBeInTheDocument());
    await waitFor(() => expect(server.calls).toContain('object/sys_user'));
    expect(screen.getByTestId('page-blocks').getAttribute('data-lookup-href')).toBe('');

    act(() => server.release());
    await waitFor(() =>
      expect(screen.getByTestId('page-blocks').getAttribute('data-lookup-href')).toBe('/apps/crm/sys_user/record/u1'),
    );
    expect(objectCalls()).not.toContain('object');
  });
});
