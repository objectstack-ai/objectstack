// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#12980 — a page that binds an object only through one of the arms
 * part 1's derivation missed has it in the page route's scope read, so the
 * page draws with it known: no on-demand by-name read once a block asks.
 *
 * The arms (`pageObjectNames`): `data.object` on the `ViewDataSchema` object
 * arm, `element:metadata_viewer`'s `object` (state-machine view),
 * `record:line_items`' `childObject` / `parentObject`, and
 * `record:related_list`'s `parentDataSource.object`. Each binds an object of
 * another package, so the route reads it by name beside the app's package list.
 *
 * The harness is `AppContent.pageRouteObjects-12980.test.tsx`'s: the REAL
 * `MetadataProvider` under the real `AppContent` and the real `PageView`, with
 * a client double that records each call as its URL would read. The page's
 * blocks are a stand-in that asks the page's record navigator, on its FIRST
 * render, for a record link of each arm's object, as a lookup cell does: an
 * object in the route's scope answers at once; one outside it answers `''`
 * and is read by name on demand.
 *
 * The CONTROL (the #12811 app-route call set, a page that binds none) stays
 * in `AppContent.pageRouteObjects-12980.test.tsx`.
 */

import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React, { useEffect } from 'react';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
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
const probe = vi.hoisted(() => ({
  armObjects: ['svc_case', 'svc_ticket', 'svc_line', 'svc_order', 'svc_account'],
  first: null as Record<string, string> | null,
}));
vi.mock('@object-ui/react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@object-ui/react')>();
  return {
    ...actual,
    useActionRunner: () => ({ execute: vi.fn(), runner: actionRunnerStub }),
    useGlobalUndo: () => {},
    useMutationInvalidationBridge: () => {},
    // Stands in for the page's blocks: on its first render it asks the record
    // navigator the page publishes for a link to a record of each arm's object.
    SchemaRenderer: () => {
      const navigator = actual.useRelatedRecordActions();
      if (!probe.first) {
        probe.first = Object.fromEntries(
          probe.armObjects.map((name) => [name, navigator?.recordHref?.(name, 'r1') ?? '']),
        );
      }
      return <div data-testid="page-blocks" />;
    },
  };
});

import { AppContent } from '../AppContent';
import { MetadataProvider } from '../../providers/MetadataProvider';
import { useActionModal } from '../../hooks/useActionModal';

const CRM = 'app.crm';
const SERVICE = 'app.service';
const OBJECTS = [
  { name: 'crm_account', _packageId: CRM, fields: {} },
  { name: 'svc_case', _packageId: SERVICE, fields: {} },
  { name: 'svc_ticket', _packageId: SERVICE, fields: {} },
  { name: 'svc_line', _packageId: SERVICE, fields: {} },
  { name: 'svc_order', _packageId: SERVICE, fields: {} },
  { name: 'svc_account', _packageId: SERVICE, fields: {} },
];

/** A page whose blocks bind objects only through the arms part 1's derivation missed. */
const ARMS_PAGE = {
  name: 'service_board',
  label: 'Service board',
  type: 'app',
  regions: [
    {
      name: 'main',
      components: [
        { type: 'object-grid', properties: { data: { provider: 'object', object: 'svc_case' } } },
        { type: 'element:metadata_viewer', properties: { type: 'state_machine', name: 'lifecycle', object: 'svc_ticket' } },
        { type: 'record:line_items', properties: { childObject: 'svc_line', parentObject: 'svc_order' } },
        {
          type: 'record:related_list',
          properties: { objectName: 'crm_account', relationshipField: 'account', parentDataSource: { object: 'svc_account' } },
        },
      ],
    },
  ],
};
const PAGES = [ARMS_PAGE];
const NAVIGATION = [{ id: 'n1', type: 'object', label: 'Accounts', objectName: 'crm_account' }];

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
            item ? Promise.resolve({ type, name, item: structuredClone(item) }) : Promise.reject(new Error('404'));
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
  probe.first = null;
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


describe('a page bound through the missed object arms reads them in the route scope (objectui#12980)', () => {
  it('(a) every arm object is known on the page\'s first render, read by name beside the package list, never the whole registry', async () => {
    boot('/apps/crm/page/service_board');
    await waitFor(() => expect(screen.getByTestId('page-blocks')).toBeInTheDocument());

    // Known on the first render: the route held the page until they answered,
    // so no block's ask had to start an on-demand read.
    expect(probe.first).toEqual(
      Object.fromEntries(probe.armObjects.map((name) => [name, `/apps/crm/${name}/record/r1`])),
    );
    expect(objectCalls()).not.toContain('object');
    expect(objectCalls()[0]).toBe(`object?package=${CRM}`);
    for (const name of probe.armObjects) expect(objectCalls()).toContain(`object/${name}`);
    // Each asked once: the scope's read is the only one.
    expect(objectCalls().filter((c) => c.startsWith('object/')).length).toBe(probe.armObjects.length);
  });
});
