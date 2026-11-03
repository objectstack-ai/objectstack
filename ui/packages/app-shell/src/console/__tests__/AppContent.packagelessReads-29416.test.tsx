// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#29416 — the routes of an app created in the console (its served
 * item names no package), and a page the app bundle does not hold, read the
 * items they name by name, never a whole `/meta/object`, `/meta/view` or
 * `/meta/page` list.
 *
 * The harness is the REAL `MetadataProvider` under the real `AppContent`, the
 * real `PageView` and the sidebar's real capability gate (`useNavMemberGates`),
 * with a client double that records each call as its URL would read and an app
 * bundle that is already in hand (`peekAppBundle`, as the adapter answers it
 * once the app was entered). The bundle holds what the app's navigation
 * reaches: the `note` object, its view and the `notes_home` page.
 *
 * Pins:
 *   (a) a package-less app's object route reads its object by name, composes
 *       it with the bundle's views, and asks no list: not the registry, not
 *       the `/meta/view` list (the gate's union names another app's object,
 *       outside this bundle), not the page list;
 *   (b) a page the bundle does not hold is read by name, and no list is asked;
 *   (c) CONTROL: with the lists already loaded, both routes ask nothing by name;
 *   (d) prefer-local (ADR-0048): in a packaged app, a by-name answer owned by
 *       another package cannot be the pick, so the `/meta/page` list is read
 *       and the app's own page is drawn; the app's own answer is taken as is;
 *       in a package-less app the by-name answer is the first match, as the
 *       list's pick is.
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
// The chrome: the sidebar's capability gate, over the app list's union.
vi.mock('../../layout/ConsoleLayout', async () => {
  const { useNavMemberGates } = await import('../../hooks/useNavMemberGates');
  return {
    ConsoleLayout: ({ children }: { children?: React.ReactNode }) => {
      const gates = useNavMemberGates();
      return (
        <div data-testid="console-layout">
          <span data-testid="gone-entry">{String(gates.checkCapability('object', 'gone_obj'))}</span>
          {children}
        </div>
      );
    },
  };
});
vi.mock('../../chrome/CommandPalette', () => ({ CommandPalette: () => null }));
vi.mock('../../hooks/useStudioDesignGate', () => ({ useStudioDesignGate: () => null }));
vi.mock('../../chrome/KeyboardShortcutsDialog', () => ({ KeyboardShortcutsDialog: () => null }));
vi.mock('../../chrome/OnboardingWalkthrough', () => ({ OnboardingWalkthrough: () => null }));
// The object list: the object documents it is handed, and the route object's view keys.
vi.mock('../../views/ObjectView', () => ({
  ObjectView: ({ objects }: { objects: Array<{ name: string; listViews?: Record<string, unknown> }> }) => (
    <div
      data-testid="object-view"
      data-views={Object.keys(objects.find((o) => o.name === 'note')?.listViews ?? {}).join(',')}
    >
      {objects.map((o) => o.name).join(',')}
    </div>
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
    // Stands in for the page's blocks: it names the page it was handed.
    SchemaRenderer: ({ schema }: { schema: { label?: string } }) => <div data-testid="page-blocks">{schema.label}</div>,
  };
});

import { AppContent } from '../AppContent';
import { MetadataProvider, useMetadata } from '../../providers/MetadataProvider';

type Doc = { name: string; [key: string]: unknown };

const OBJECTS: Doc[] = [
  { name: 'note', label: 'Note', fields: { owner: { type: 'lookup', reference: 'sys_user' } } },
  { name: 'crm_account', _packageId: 'app.crm', label: 'Account', fields: {} },
  { name: 'sys_user', _packageId: 'plugin.auth', label: 'User', fields: {} },
];
const VIEWS: Doc[] = [
  { name: 'note.all', object: 'note', viewKind: 'list', label: 'All notes', isDefault: true, config: { type: 'grid', columns: [] } },
  { name: 'crm_account.all', object: 'crm_account', viewKind: 'list', label: 'All accounts', isDefault: true, config: { type: 'grid', columns: [] } },
];
const PAGES: Doc[] = [
  { name: 'notes_home', label: 'Notes home', type: 'app', regions: [] },
  { name: 'outside_page', label: 'Outside page', type: 'app', regions: [] },
  // Two packages ship `home`; the server's by-name read answers the first.
  { name: 'home', _packageId: 'app.other', label: 'Other home', type: 'app', regions: [] },
  { name: 'home', _packageId: 'app.crm', label: 'CRM home', type: 'app', regions: [] },
  { name: 'crm_only', _packageId: 'app.crm', label: 'CRM only', type: 'app', regions: [] },
];

const objectEntry = (name: string, requires?: string) => ({
  id: `nav_${name}`, type: 'object', label: name, objectName: name, ...(requires ? { requiresObject: requires } : {}),
});

/** The console-created app: no `_packageId`. */
const NOTES_APP = {
  name: 'notes',
  label: 'Notes',
  navigation: [objectEntry('note'), { id: 'nav_home', type: 'page', label: 'Home', pageName: 'notes_home' }, objectEntry('gone_obj', 'gone_obj')],
};
/** Another app the list carries: it requires an object outside the notes bundle. */
const CRM_APP = { name: 'crm', label: 'CRM', _packageId: 'app.crm', navigation: [objectEntry('crm_account', 'crm_account')] };

/** The notes app's bundle, keyed as the adapter's `AppBundleItems` keys it. */
function bundleItems() {
  const items = new Map<string, Map<string, { item: unknown; envelope: Record<string, unknown> }>>();
  const put = (type: string, docs: Doc[]) => {
    const byName = new Map();
    for (const doc of docs) byName.set(doc.name, { item: structuredClone(doc), envelope: { type, name: doc.name, item: doc } });
    items.set(type, byName);
  };
  put('object', [OBJECTS[0]]);
  put('view', [VIEWS[0]]);
  put('page', [PAGES[0]]);
  put('dashboard', []);
  return items;
}

const server = { calls: [] as string[] };

const notFound = () => Promise.reject(Object.assign(new Error('not found'), { httpStatus: 404, code: 'RESOURCE_NOT_FOUND' }));

function makeAdapter() {
  const bundle = { status: 'ready', items: bundleItems() };
  return {
    clearCache: vi.fn(),
    invalidateCache: vi.fn(),
    peekAppBundle: () => bundle,
    getObjectSchema(this: { getClient(): any }, name: string) {
      return this.getClient()
        .meta.getItem('object', name)
        .then((res: any) => (res && typeof res === 'object' && 'item' in res ? res.item : res));
    },
    getClient: () => ({
      meta: {
        getItems: (type: string, options?: { packageId?: string }) => {
          server.calls.push(options?.packageId ? `${type}?package=${options.packageId}` : type);
          const all: Doc[] =
            type === 'object' ? OBJECTS : type === 'view' ? VIEWS : type === 'page' ? PAGES : type === 'app' ? [NOTES_APP, CRM_APP] : [];
          const items = options?.packageId ? all.filter((o) => o._packageId === options.packageId) : all;
          return Promise.resolve({ type, items: structuredClone(items) });
        },
        getItem: (type: string, name: string) => {
          server.calls.push(`${type}/${name}`);
          const all = type === 'object' ? OBJECTS : type === 'page' ? PAGES : [];
          // ADR-0048 §3.3: a context-free by-name read answers the first match.
          const item = all.find((o) => o.name === name);
          return item ? Promise.resolve({ type, name, item: structuredClone(item) }) : notFound();
        },
      },
    }),
  } as unknown as Parameters<typeof MetadataProvider>[0]['adapter'];
}

const USER = 'u_29416';
const ORG: AuthOrganization = { id: 'org_a', name: 'Org A', slug: 'a' };

function authClient(): AuthClient {
  return {
    getSession: vi.fn(async () => ({
      user: { id: USER, name: 'Ada', email: 'ada@test.com', role: 'admin', positions: ['admin'] },
      session: { token: 'tok-29416', activeOrganizationId: ORG.id },
    })),
    signOut: vi.fn(async () => undefined),
    getConfig: vi.fn(async () => ({ features: {} })),
    listOrganizations: vi.fn(async () => [ORG]),
    getActiveOrganization: vi.fn(async () => ORG),
    setActiveOrganization: vi.fn(async () => ORG),
    getActiveMember: vi.fn(async () => ({ id: 'm1', organizationId: ORG.id, userId: USER, role: 'owner' })),
  } as unknown as AuthClient;
}

/** Reads the whole object, view and page lists at mount, as Studio would have. */
function LoadLists() {
  const metadata = useMetadata();
  void metadata.objects;
  void metadata.pages;
  return null;
}

function boot(url: string, options: { listsLoaded?: boolean } = {}) {
  render(
    <AuthProvider authUrl="/api/auth" client={authClient()}>
      <MetadataProvider adapter={makeAdapter()}>
        {options.listsLoaded ? <LoadLists /> : null}
        <MemoryRouter initialEntries={[url]}>
          <Routes>
            <Route path="/apps/:appName/*" element={<AppContent />} />
          </Routes>
        </MemoryRouter>
      </MetadataProvider>
    </AuthProvider>,
  );
}

/** The calls that read a whole list of one of the three types. */
const listCalls = () => server.calls.filter((c) => c === 'object' || c === 'view' || c === 'page');
const byNameCalls = () => server.calls.filter((c) => c.startsWith('object/') || c.startsWith('page/'));

beforeEach(() => {
  server.calls = [];
  localStorage.clear();
  sessionStorage.clear();
  ActiveOrganizationStorage.clear();
});

afterEach(() => {
  cleanup();
  ActiveOrganizationStorage.clear();
});

describe('a package-less app reads what its routes name, by name (objectstack#29416)', () => {
  it('(a) its object route reads the object and its lookup target by name, with the bundle’s views, and no list', async () => {
    boot('/apps/notes/note');
    await waitFor(() => expect(screen.getByTestId('object-view')).toHaveTextContent('sys_user'));
    await waitFor(() => expect(screen.getByTestId('gone-entry')).toHaveTextContent('false'));

    expect(screen.getByTestId('object-view')).toHaveTextContent('note');
    expect(screen.getByTestId('object-view').getAttribute('data-views')).toContain('note.all');
    expect(byNameCalls()).toEqual(expect.arrayContaining(['object/note', 'object/sys_user', 'object/crm_account', 'object/gone_obj']));
    expect(listCalls()).toEqual([]);
  });

  it('(b) a page the bundle does not hold is read by name, and no list is asked', async () => {
    boot('/apps/notes/page/outside_page');
    await waitFor(() => expect(screen.getByTestId('page-blocks')).toHaveTextContent('Outside page'));
    await waitFor(() => expect(screen.getByTestId('gone-entry')).toHaveTextContent('false'));

    expect(byNameCalls()).toContain('page/outside_page');
    expect(listCalls()).toEqual([]);
  });

  it('(b) a page the bundle holds is read from it: nothing is asked for it', async () => {
    boot('/apps/notes/page/notes_home');
    await waitFor(() => expect(screen.getByTestId('page-blocks')).toHaveTextContent('Notes home'));

    expect(byNameCalls()).not.toContain('page/notes_home');
    expect(listCalls()).toEqual([]);
  });

  it('(c) CONTROL: with the lists already loaded, the object route and the page route ask nothing by name', async () => {
    boot('/apps/notes/note', { listsLoaded: true });
    await waitFor(() => expect(screen.getByTestId('object-view')).toHaveTextContent('note'));
    await waitFor(() => expect(screen.getByTestId('gone-entry')).toHaveTextContent('false'));
    expect(byNameCalls()).toEqual([]);
    cleanup();

    server.calls = [];
    boot('/apps/notes/page/outside_page', { listsLoaded: true });
    await waitFor(() => expect(screen.getByTestId('page-blocks')).toHaveTextContent('Outside page'));
    expect(byNameCalls()).toEqual([]);
    expect(listCalls()).toContain('page');
  });
});

describe('prefer-local holds for a page read by name (ADR-0048, objectstack#29416)', () => {
  it('(d) a packaged app whose by-name answer is another package’s reads the list, and draws its own page', async () => {
    boot('/apps/app.crm/page/home');
    await waitFor(() => expect(screen.getByTestId('page-blocks')).toHaveTextContent('CRM home'));

    expect(byNameCalls()).toContain('page/home');
    expect(listCalls()).toContain('page');
  });

  it('(d) a packaged app whose by-name answer is its own page takes it, and reads no list', async () => {
    boot('/apps/app.crm/page/crm_only');
    await waitFor(() => expect(screen.getByTestId('page-blocks')).toHaveTextContent('CRM only'));

    expect(byNameCalls()).toContain('page/crm_only');
    expect(listCalls()).not.toContain('page');
  });

  it('(d) a package-less app takes the by-name answer, the first match, as the list’s pick is', async () => {
    boot('/apps/notes/page/home');
    await waitFor(() => expect(screen.getByTestId('page-blocks')).toHaveTextContent('Other home'));

    expect(listCalls()).not.toContain('page');
  });
});
