// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#28784 — a dashboard route reads its dashboard from the app
 * bundle, and the objects its widgets require by name, never the
 * `/meta/dashboard` list or the whole object registry.
 *
 * Measured on the card: every open of `/apps/APP/dashboard/NAME` read
 * `GET /api/v1/meta/dashboard`, the whole `GET /api/v1/meta/object` and
 * `GET /api/v1/meta/view`, and the widgets' dataset queries waited for all
 * three, though the app bundle already held the dashboard.
 *
 * The harness is the REAL `MetadataProvider` under the real `AppContent` and
 * the real `DashboardView`, with a client double that records each read as its
 * URL would read and an app bundle the test controls (`peekAppBundle`, entered
 * through `loadAppBundle` as the real adapter is). `DashboardRenderer` is a
 * stand-in that lists the widgets it was handed.
 *
 * Pins: (a) a bundled dashboard opens with no `dashboard` list, no whole
 * `object` list and no `view` list; (b) the objects its widgets require are
 * asked by name, and a widget whose object the server answered absent is left
 * out; (c) CONTROL: a dashboard the bundle does not hold is read from the
 * `dashboard` list, prefer-local, still without the whole object list.
 */

import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { AuthProvider, ActiveOrganizationStorage } from '@object-ui/auth';
import type { AuthClient, AuthOrganization } from '@object-ui/auth';

vi.mock('@object-ui/plugin-designer', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@object-ui/plugin-designer')>()),
  CreateAppPage: () => null,
  EditAppPage: () => null,
  DashboardDesignPage: () => null,
}));
// The widgets the view hands the renderer, by id.
vi.mock('@object-ui/plugin-dashboard', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  DashboardRenderer: ({ schema }: { schema: { name: string; widgets?: Array<{ id: string }> } }) => (
    <div data-testid="dashboard-widgets" data-dashboard={schema.name}>
      {(schema.widgets ?? []).map((w) => w.id).join(',')}
    </div>
  ),
}));
vi.mock('../../layout/ConsoleLayout', () => ({
  ConsoleLayout: ({ children }: { children?: React.ReactNode }) => <div data-testid="console-layout">{children}</div>,
}));
vi.mock('../../chrome/CommandPalette', () => ({ CommandPalette: () => null }));
vi.mock('../../hooks/useStudioDesignGate', () => ({ useStudioDesignGate: () => null }));
vi.mock('../../chrome/KeyboardShortcutsDialog', () => ({ KeyboardShortcutsDialog: () => null }));
vi.mock('../../chrome/OnboardingWalkthrough', () => ({ OnboardingWalkthrough: () => null }));
vi.mock('@object-ui/i18n', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useObjectTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => String(options?.defaultValue ?? key),
  }),
  useObjectLabel: () => ({ objectLabel: ({ label }: { label?: string }) => label, objectPluralLabel: () => '' }),
}));

type Items = Map<string, Map<string, { item: unknown; envelope: Record<string, unknown> }>>;
interface Bundle {
  state: { status: 'none' } | { status: 'pending'; settled: Promise<unknown> } | { status: 'ready'; items: Items };
}
const bundle: Bundle = { state: { status: 'none' } };

// `AppContent` enters the app's bundle through the console's adapter; the
// provider reads it through its own (`peekAppBundle`), as the real adapter is one.
const dataSourceStub = {
  onConnectionStateChange: () => () => {},
  getConnectionState: () => 'connected',
  loadAppBundle: () => {
    if (bundle.state.status !== 'none') return;
    let land: () => void = () => {};
    bundle.state = { status: 'pending', settled: new Promise<void>((r) => { land = r; }) };
    queueMicrotask(() => {
      bundle.state = { status: 'ready', items: server.bundleItems() };
      land();
    });
  },
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
  };
});

import { AppContent } from '../AppContent';
// The route's lazy element, loaded at import so the first open does not race its chunk.
import '../../views/DashboardView';
import { MetadataProvider } from '../../providers/MetadataProvider';

const CRM = 'app.crm';
const OBJECTS = [
  { name: 'crm_account', _packageId: CRM, fields: {} },
  { name: 'crm_case', _packageId: 'app.service', fields: {} },
];

/** Widgets bound to datasets only: they name no object. */
const SALES = {
  name: 'sales',
  label: 'Sales',
  _packageId: CRM,
  widgets: [
    { id: 'pipeline', type: 'bar', dataset: 'pipeline_by_stage' },
    { id: 'won', type: 'metric', dataset: 'won_this_month' },
  ],
};
/** A widget gated on an object outside the package, and one on an object this runtime lacks. */
const SERVICE = {
  name: 'service',
  label: 'Service',
  _packageId: CRM,
  widgets: [
    { id: 'cases', type: 'bar', dataset: 'cases_by_status', requiresObject: 'crm_case' },
    { id: 'cloud', type: 'metric', dataset: 'cloud_usage', requiresObject: 'cloud_only' },
    { id: 'plain', type: 'metric', dataset: 'won_this_month' },
  ],
};
/** Not in the bundle; two packages ship it, and the app's own wins. */
const SHARED = [
  { name: 'shared', label: 'Theirs', _packageId: 'app.other', widgets: [{ id: 'theirs', type: 'metric', dataset: 'x' }] },
  { name: 'shared', label: 'Ours', _packageId: CRM, widgets: [{ id: 'ours', type: 'metric', dataset: 'x' }] },
];

interface Server {
  calls: string[];
  apps: unknown[];
  bundleItems: () => Items;
}
const server: Server = { calls: [], apps: [], bundleItems: () => new Map() };

function itemsOf(byType: Record<string, unknown[]>): Items {
  const items: Items = new Map();
  for (const [type, docs] of Object.entries(byType)) {
    const byName = new Map();
    for (const doc of docs as Array<{ name: string }>) {
      byName.set(doc.name, { item: structuredClone(doc), envelope: { type, name: doc.name, item: doc } });
    }
    items.set(type, byName);
  }
  return items;
}

function makeAdapter() {
  return {
    clearCache: vi.fn(),
    invalidateCache: vi.fn(),
    peekAppBundle: () => bundle.state,
    getObjectSchema(this: { getClient(): any }, name: string) {
      return this.getClient()
        .meta.getItem('object', name)
        .then((res: any) => (res && typeof res === 'object' && 'item' in res ? res.item : res));
    },
    getClient: () => ({
      meta: {
        getItems: (type: string, options?: { packageId?: string }) => {
          server.calls.push(options?.packageId ? `${type}?package=${options.packageId}` : type);
          const all = type === 'object' ? OBJECTS : type === 'app' ? server.apps : type === 'dashboard' ? [SALES, SERVICE, ...SHARED] : [];
          const items = options?.packageId ? all.filter((o: any) => o._packageId === options.packageId) : all;
          return Promise.resolve({ type, items: structuredClone(items) });
        },
        getItem: (type: string, name: string) => {
          server.calls.push(`${type}/${name}`);
          const item = (type === 'object' ? OBJECTS : []).find((o) => o.name === name);
          return item
            ? Promise.resolve({ type, name, item: structuredClone(item) })
            : Promise.reject(Object.assign(new Error('not found'), { httpStatus: 404, code: 'RESOURCE_NOT_FOUND' }));
        },
      },
    }),
  } as unknown as Parameters<typeof MetadataProvider>[0]['adapter'];
}

const USER = 'u_28784';
const ORG: AuthOrganization = { id: 'org_a', name: 'Org A', slug: 'a' };

function authClient(): AuthClient {
  return {
    getSession: vi.fn(async () => ({
      user: { id: USER, name: 'Ada', email: 'ada@test.com', role: 'admin', positions: ['admin'] },
      session: { token: 'tok-28784', activeOrganizationId: ORG.id },
    })),
    signOut: vi.fn(async () => undefined),
    getConfig: vi.fn(async () => ({ features: {} })),
    listOrganizations: vi.fn(async () => [ORG]),
    getActiveOrganization: vi.fn(async () => ORG),
    setActiveOrganization: vi.fn(async () => ORG),
    getActiveMember: vi.fn(async () => ({ id: 'm1', organizationId: ORG.id, userId: USER, role: 'owner' })),
  } as unknown as AuthClient;
}

function boot(url: string) {
  render(
    <AuthProvider authUrl="/api/auth" client={authClient()}>
      <MetadataProvider adapter={makeAdapter()}>
        <MemoryRouter initialEntries={[url]}>
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
  server.apps = [
    {
      name: 'crm',
      label: 'CRM',
      _packageId: CRM,
      navigation: [
        { id: 'n1', type: 'object', label: 'Accounts', objectName: 'crm_account' },
        { id: 'n2', type: 'dashboard', label: 'Sales', dashboardName: 'sales' },
        { id: 'n3', type: 'dashboard', label: 'Service', dashboardName: 'service' },
      ],
    },
  ];
  server.bundleItems = () => itemsOf({ object: [OBJECTS[0]], dashboard: [SALES, SERVICE] });
  bundle.state = { status: 'none' };
  localStorage.clear();
  sessionStorage.clear();
  ActiveOrganizationStorage.clear();
});

afterEach(() => {
  cleanup();
  ActiveOrganizationStorage.clear();
});

describe('a dashboard route reads from the app bundle and asks its widgets\' objects by name (objectstack#28784)', () => {
  it('(a) a bundled dashboard opens with no dashboard list, no whole object list and no view list', async () => {
    boot(`/apps/${CRM}/dashboard/sales`);
    await waitFor(() => expect(screen.getByTestId('dashboard-widgets')).toHaveTextContent('pipeline,won'));

    expect(server.calls).not.toContain('dashboard');
    expect(server.calls).not.toContain('view');
    expect(objectCalls()).not.toContain('object');
    // Its widgets name no object: nothing is asked by name.
    expect(objectCalls().filter((c) => c.startsWith('object/'))).toEqual([]);
  });

  it('(b) asks the widgets\' objects by name and leaves out a widget whose object is absent', async () => {
    boot(`/apps/${CRM}/dashboard/service`);
    await waitFor(() => expect(screen.getByTestId('dashboard-widgets')).toHaveTextContent('cases,plain'));

    expect(screen.getByTestId('dashboard-widgets')).not.toHaveTextContent('cloud');
    expect(objectCalls()).toContain('object/crm_case');
    expect(objectCalls()).toContain('object/cloud_only');
    expect(objectCalls()).not.toContain('object');
    expect(server.calls).not.toContain('dashboard');
  });

  it('(c) CONTROL: a dashboard the bundle does not hold is read from the list, prefer-local, still without the whole object list', async () => {
    boot(`/apps/${CRM}/dashboard/shared`);
    await waitFor(() => expect(screen.getByTestId('dashboard-widgets')).toHaveTextContent('ours'));

    expect(server.calls).toContain('dashboard');
    expect(objectCalls()).not.toContain('object');
  });
});
