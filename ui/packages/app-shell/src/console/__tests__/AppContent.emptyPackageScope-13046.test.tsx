// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#13046 — the object requests an open of an object's list, or of a
 * record, issues when the app's package does not scope them.
 *
 * Measured on cloud's control plane: the `cloud_control` app's package holds
 * none of the objects it shows (they live in service packages), so its
 * `meta/object?package=` read answered 0 objects and the route fell back to
 * the whole registry (751,603 bytes, 110 objects) before the first paint, on
 * the 环境 list and on every record page. Now:
 *
 *  (a) an object's route in such an app reads, by name, its object, its lookup
 *      targets and the app's `requiresObject` entries, and never the whole
 *      registry;
 *  (b) a record route whose record page is declared (a full page) reads the
 *      objects that page binds, by name, and never the whole registry.
 *
 * CONTROLs, counted request by request: Setup's open (the root of an app whose
 * package holds no objects of its own) asks the same as before, the package
 * list and then the whole registry; an app whose package holds its objects
 * asks the same as before; a record route with no declared record page, or a
 * slotted one, reads the whole registry, as before.
 *
 * The harness is the REAL `MetadataProvider` under the real `AppContent`, with
 * a client double that records each call as its URL would read (the pattern of
 * `AppContent.objectScope-12811.test.tsx`).
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
// The chrome: what the sidebar's capability gate asks, as `ConsoleLayout` does.
vi.mock('../../layout/ConsoleLayout', async () => {
  const { useNavMemberGates } = await import('../../hooks/useNavMemberGates');
  return {
    ConsoleLayout: ({ children }: { children?: React.ReactNode }) => {
      const gates = useNavMemberGates();
      return (
        <div data-testid="console-layout">
          <span data-testid="members-entry">{String(gates.checkCapability('object', 'sys_member'))}</span>
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
vi.mock('../../views/RecordDetailView', () => ({
  RecordDetailView: ({ objects }: { objects: Array<{ name: string }> }) => (
    <div data-testid="record-view">{objects.map((o) => o.name).join(',')}</div>
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

const CLOUD = 'com.example.cloud';
const SETUP = 'com.objectstack.setup';
const CRM = 'app.crm';
const OBJECTS = [
  { name: 'sys_environment', _packageId: 'svc.tenant', fields: { organization: { type: 'lookup', reference: 'sys_organization' }, owner: { type: 'lookup', reference: 'sys_user' } } },
  { name: 'sys_environment_member', _packageId: 'svc.tenant', fields: { environment: { type: 'master_detail', reference: 'sys_environment' } } },
  { name: 'sys_organization', _packageId: 'plugin.auth', fields: {} },
  { name: 'sys_member', _packageId: 'plugin.auth', fields: { organization: { type: 'lookup', reference: 'sys_organization' } } },
  { name: 'sys_user', _packageId: 'plugin.auth', fields: {} },
  { name: 'crm_account', _packageId: CRM, fields: { owner: { type: 'lookup', reference: 'sys_user' } } },
  { name: 'crm_opportunity', _packageId: CRM, fields: { account: { type: 'lookup', reference: 'crm_account' } } },
  { name: 'crm_quote', _packageId: 'app.sales', fields: { opportunity: { type: 'master_detail', reference: 'crm_opportunity' } } },
];
const CLOUD_NAVIGATION = [
  { id: 'n1', type: 'object', label: 'Environments', objectName: 'sys_environment' },
  { id: 'n2', type: 'object', label: 'Members', objectName: 'sys_member', requiresObject: 'sys_member' },
];
const CRM_NAVIGATION = [{ id: 'c1', type: 'object', label: 'Accounts', objectName: 'crm_account' }];
const OPPORTUNITY_PAGE = {
  name: 'opportunity_detail',
  type: 'record',
  object: 'crm_opportunity',
  kind: 'full',
  regions: [{ name: 'main', components: [{ type: 'record:related_list', properties: { objectName: 'crm_quote' } }] }],
};
const ENVIRONMENT_PAGE = {
  name: 'environment_detail',
  type: 'record',
  object: 'sys_environment',
  kind: 'full',
  regions: [{ name: 'main', components: [{ type: 'record:related_list', properties: { objectName: 'sys_environment_member' } }] }],
};

const server = { calls: [] as string[], apps: [] as unknown[], pages: [] as unknown[] };

function makeAdapter() {
  return {
    clearCache: vi.fn(),
    invalidateCache: vi.fn(),
    // objectui#13044 — the provider's by-name OBJECT read goes through the
    // adapter's `getObjectSchema`; this double answers it from the same door.
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
          return item
            ? Promise.resolve({ type, name, item: structuredClone(item) })
            : Promise.reject(Object.assign(new Error('not found'), { httpStatus: 404, code: 'RESOURCE_NOT_FOUND' }));
        },
      },
    }),
  } as unknown as Parameters<typeof MetadataProvider>[0]['adapter'];
}

const USER = 'u_13046';
const ORG: AuthOrganization = { id: 'org_a', name: 'Org A', slug: 'a' };

function authClient(): AuthClient {
  return {
    getSession: vi.fn(async () => ({
      user: { id: USER, name: 'Ada', email: 'ada@test.com', role: 'admin', positions: ['admin'] },
      session: { token: 'tok-13046', activeOrganizationId: ORG.id },
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
const sorted = (list: string[]) => [...list].sort();
const settle = () => new Promise((resolve) => setTimeout(resolve, 50));

beforeEach(() => {
  server.calls = [];
  server.pages = [];
  server.apps = [
    { name: 'cloud', label: 'Cloud', _packageId: CLOUD, navigation: CLOUD_NAVIGATION },
    { name: 'setup', label: 'Setup', _packageId: SETUP, navigation: CLOUD_NAVIGATION },
    { name: 'crm', label: 'CRM', _packageId: CRM, navigation: CRM_NAVIGATION },
  ];
  localStorage.clear();
  sessionStorage.clear();
  ActiveOrganizationStorage.clear();
});

afterEach(() => {
  cleanup();
  ActiveOrganizationStorage.clear();
});

describe('an object route in an app whose package holds none of its objects reads them by name (objectui#13046)', () => {
  it('(a) asks the empty package list, then by name the route object, its lookup targets and the requiresObject entries; never the whole registry', async () => {
    boot('/apps/cloud/sys_environment');
    await waitFor(() => expect(screen.getByTestId('object-view')).toHaveTextContent('sys_environment'));
    // Before the first paint: the route rendered on by-name reads only.
    expect(objectCalls()).not.toContain('object');
    await waitFor(() => expect(screen.getByTestId('object-view')).toHaveTextContent('sys_user'));
    await settle();

    expect(objectCalls()[0]).toBe(`object?package=${CLOUD}`);
    expect(sorted(objectCalls())).toEqual(
      sorted([`object?package=${CLOUD}`, 'object/sys_environment', 'object/sys_organization', 'object/sys_user', 'object/sys_member']),
    );
    // The sidebar's capability gate answers from the same scope.
    expect(screen.getByTestId('members-entry')).toHaveTextContent('true');
  });
});

describe('a record route reads the objects its declared record page binds (objectui#13046)', () => {
  it('(b) in an app whose package holds its objects: the package list and, by name, the bound objects outside it', async () => {
    server.pages = [OPPORTUNITY_PAGE];
    boot('/apps/crm/crm_opportunity/record/r1');
    await waitFor(() => expect(screen.getByTestId('record-view')).toHaveTextContent('crm_quote'));
    await settle();

    expect(objectCalls()).not.toContain('object');
    expect(sorted(objectCalls())).toEqual(sorted([`object?package=${CRM}`, 'object/crm_quote']));
    expect(screen.getByTestId('record-view')).toHaveTextContent('crm_opportunity');
  });

  it('(b) in an app whose package holds none of its objects: the record object, its page\'s objects and their lookup targets, by name', async () => {
    server.pages = [ENVIRONMENT_PAGE];
    boot('/apps/cloud/sys_environment/record/env1');
    await waitFor(() => expect(screen.getByTestId('record-view')).toHaveTextContent('sys_environment_member'));
    expect(objectCalls()).not.toContain('object');
    await settle();

    expect(objectCalls()).not.toContain('object');
    expect(sorted(objectCalls())).toEqual(
      sorted([
        `object?package=${CLOUD}`,
        'object/sys_environment',
        'object/sys_environment_member',
        'object/sys_organization',
        'object/sys_user',
        'object/sys_member',
      ]),
    );
  });

  it('(b) the named record page route reads the objects of the page it names', async () => {
    server.pages = [OPPORTUNITY_PAGE];
    boot('/apps/crm/crm_opportunity/record/r1/page/opportunity_detail');
    await waitFor(() => expect(screen.getByTestId('record-view')).toHaveTextContent('crm_quote'));
    await settle();

    expect(objectCalls()).not.toContain('object');
  });
});

describe('CONTROLs: the shapes this card does not change ask what they asked before (objectui#13046)', () => {
  it("Setup's open (the root of an app whose package holds no objects of its own): the package list, then the whole registry", async () => {
    boot('/apps/setup');
    await waitFor(() => expect(objectCalls()).toContain('object'));
    await settle();

    expect(objectCalls()).toEqual([`object?package=${SETUP}`, 'object']);
  });

  it('an app whose package holds its objects: the package list and the lookup target outside it', async () => {
    boot('/apps/crm/crm_account');
    await waitFor(() => expect(screen.getByTestId('object-view')).toHaveTextContent('sys_user'));
    await settle();

    expect(objectCalls()).toEqual([`object?package=${CRM}`, 'object/sys_user']);
  });

  it('a record route with no declared record page reads the whole registry, and nothing by name', async () => {
    boot('/apps/crm/crm_opportunity/record/r1');
    await waitFor(() => expect(screen.getByTestId('record-view')).toHaveTextContent('crm_quote'));
    await settle();

    expect(objectCalls()).toEqual(['object']);
  });

  it('a record route whose record page is slotted reads the whole registry: its related lists are derived from every object', async () => {
    server.pages = [{ ...OPPORTUNITY_PAGE, kind: 'slotted', slots: {} }];
    boot('/apps/crm/crm_opportunity/record/r1');
    await waitFor(() => expect(screen.getByTestId('record-view')).toHaveTextContent('crm_quote'));
    await settle();

    expect(objectCalls()).toEqual(['object']);
  });
});
