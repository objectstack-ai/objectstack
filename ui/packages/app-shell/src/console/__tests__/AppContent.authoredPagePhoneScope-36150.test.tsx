// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#36150 — the record ROUTE's object scope follows the page the
 * record view draws. An authored full record page is drawn on the desktop
 * full page only; on a phone the view draws the standard page, whose child
 * tabs are derived from every object that points at the record's object. So
 * on a phone the route must not read only the objects the authored page binds
 * (L2 M1 on #36174): it takes the synthesized page's arm, as the view does.
 *
 * Through the real `AppContent` and `MetadataProvider` (the harness of
 * `AppContent.emptyPackageScope-13046.test.tsx`), the view a double that
 * prints the object list it is handed:
 *
 *   - desktop: the authored page's objects, as before (CONTROL); a child the
 *     page does not bind is not in the list.
 *   - phone: the whole registry, the unbound child included.
 *   - the width crossing 768 on an open record moves the scope with it.
 *   - a media-query change that leaves the window wide (what printing fires)
 *     keeps the authored page's scope (N4).
 *   - the host's exceptions on a phone: a page named in the URL, and the
 *     platform user page, still read their page's objects.
 */

import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
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

// `AppContent` reaches a dynamic `import('@objectstack/lint')` (through
// `ConsoleLayout` → `DraftPreviewBar`, statically): pay its load at collection,
// never inside a case's clocked window (`check:test-source-alias`).
import '@objectstack/lint';
import { AppContent } from '../AppContent';
import { MetadataProvider } from '../../providers/MetadataProvider';

const CLOUD = 'com.example.cloud';
const CRM = 'app.crm';
const OBJECTS = [
  { name: 'sys_member', _packageId: 'plugin.auth', fields: { user: { type: 'lookup', reference: 'sys_user' } } },
  { name: 'sys_user', _packageId: 'plugin.auth', fields: {} },
  { name: 'crm_account', _packageId: CRM, fields: {} },
  { name: 'crm_opportunity', _packageId: CRM, fields: { account: { type: 'lookup', reference: 'crm_account' } } },
  { name: 'crm_quote', _packageId: 'app.sales', fields: { opportunity: { type: 'master_detail', reference: 'crm_opportunity' } } },
  // A child of the opportunity the authored page does not bind.
  { name: 'crm_task', _packageId: 'app.service', fields: { opportunity: { type: 'lookup', reference: 'crm_opportunity' } } },
];
const CLOUD_NAVIGATION = [{ id: 'n1', type: 'object', label: 'Members', objectName: 'sys_member' }];
const CRM_NAVIGATION = [{ id: 'c1', type: 'object', label: 'Accounts', objectName: 'crm_account' }];
const OPPORTUNITY_PAGE = {
  name: 'opportunity_detail',
  type: 'record',
  object: 'crm_opportunity',
  kind: 'full',
  isDefault: true,
  regions: [{ name: 'main', components: [{ type: 'record:related_list', properties: { objectName: 'crm_quote' } }] }],
};
const USER_PAGE = {
  name: 'user_detail',
  type: 'record',
  object: 'sys_user',
  kind: 'full',
  isDefault: true,
  regions: [{ name: 'main', components: [{ type: 'record:related_list', properties: { objectName: 'sys_member' } }] }],
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
        getItems: (type: string, options?: { packageId?: string; names?: readonly string[] }) => {
          // objectstack#34244 — the `?names=` presence read answers the asked names it holds and leaves an absent one out, as the list door does.
          if (options?.names) {
            server.calls.push(`${type}?names=${options.names.join(',')}`);
            const named: any[] = type === 'object' ? (OBJECTS as any[]).filter((o: any) => options.names!.includes(o.name)) : [];
            return Promise.resolve({ type, items: structuredClone(named) });
          }
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

const USER = 'u_36150';
const ORG: AuthOrganization = { id: 'org_a', name: 'Org A', slug: 'a' };

function authClient(): AuthClient {
  return {
    getSession: vi.fn(async () => ({
      user: { id: USER, name: 'Ada', email: 'ada@test.com', role: 'admin', positions: ['admin'] },
      session: { token: 'tok-36150', activeOrganizationId: ORG.id },
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
const settle = () => new Promise((resolve) => setTimeout(resolve, 50));
const listed = () => (screen.getByTestId('record-view').textContent ?? '').split(',');

// The viewport: `usePhoneViewport` reads `innerWidth` and listens to the
// media query; this double lets a case move the width and fire the query.
const mediaListeners = new Set<() => void>();
function setWidth(width: number) {
  Object.defineProperty(window, 'innerWidth', { value: width, configurable: true, writable: true });
}
function fireMediaChange() {
  act(() => {
    for (const listener of [...mediaListeners]) listener();
  });
}
const originalWidth = window.innerWidth;
const originalMatchMedia = window.matchMedia;

beforeEach(() => {
  server.calls = [];
  server.pages = [OPPORTUNITY_PAGE, USER_PAGE];
  server.apps = [
    { name: 'cloud', label: 'Cloud', _packageId: CLOUD, navigation: CLOUD_NAVIGATION },
    { name: 'crm', label: 'CRM', _packageId: CRM, navigation: CRM_NAVIGATION },
  ];
  localStorage.clear();
  sessionStorage.clear();
  ActiveOrganizationStorage.clear();
  mediaListeners.clear();
  setWidth(1280);
  window.matchMedia = ((query: string) => {
    const max = Number(/max-width:\s*(\d+)px/.exec(query)?.[1] ?? Infinity);
    return {
      media: query,
      get matches() {
        return window.innerWidth <= max;
      },
      onchange: null,
      addEventListener: (_type: string, listener: () => void) => mediaListeners.add(listener),
      removeEventListener: (_type: string, listener: () => void) => mediaListeners.delete(listener),
      addListener: (listener: () => void) => mediaListeners.add(listener),
      removeListener: (listener: () => void) => mediaListeners.delete(listener),
      dispatchEvent: () => false,
    };
  }) as unknown as typeof window.matchMedia;
});

afterEach(() => {
  cleanup();
  ActiveOrganizationStorage.clear();
  setWidth(originalWidth);
  window.matchMedia = originalMatchMedia;
});

describe('the record route reads the objects of the page the view draws (objectstack#36150)', () => {
  it('CONTROL — desktop: the authored page\'s objects, by name; the child it does not bind is not read', async () => {
    boot('/apps/crm/crm_opportunity/record/r1');
    await waitFor(() => expect(screen.getByTestId('record-view')).toHaveTextContent('crm_quote'));
    await settle();
    expect(objectCalls()).not.toContain('object');
    expect(listed()).not.toContain('crm_task');
  });

  it('phone: the standard page\'s scope, every object pointing at the record\'s, the unbound child included', async () => {
    setWidth(375);
    boot('/apps/crm/crm_opportunity/record/r1');
    await waitFor(() => expect(listed()).toContain('crm_task'));
    expect(listed()).toContain('crm_quote');
    expect(objectCalls()).toContain('object');
  });

  it('the width crossing 768 on an open record moves the scope with it', async () => {
    boot('/apps/crm/crm_opportunity/record/r1');
    await waitFor(() => expect(screen.getByTestId('record-view')).toHaveTextContent('crm_quote'));
    await settle();
    expect(listed()).not.toContain('crm_task');
    setWidth(600);
    fireMediaChange();
    await waitFor(() => expect(listed()).toContain('crm_task'));
  });

  it('N4 — a media-query change that leaves the window wide (printing fires one) keeps the authored page\'s scope', async () => {
    boot('/apps/crm/crm_opportunity/record/r1');
    await waitFor(() => expect(screen.getByTestId('record-view')).toHaveTextContent('crm_quote'));
    await settle();
    act(() => {
      window.dispatchEvent(new Event('beforeprint'));
    });
    fireMediaChange();
    await settle();
    expect(objectCalls()).not.toContain('object');
    expect(listed()).not.toContain('crm_task');
  });

  it('phone: a page named in the URL still reads its own objects, never the whole registry', async () => {
    setWidth(375);
    boot('/apps/crm/crm_opportunity/record/r1/page/opportunity_detail');
    await waitFor(() => expect(screen.getByTestId('record-view')).toHaveTextContent('crm_quote'));
    await settle();
    expect(objectCalls()).not.toContain('object');
    expect(listed()).not.toContain('crm_task');
  });

  it('phone: the platform user page keeps its own page, so its route reads that page\'s objects', async () => {
    setWidth(375);
    boot('/apps/cloud/sys_user/record/u1');
    await waitFor(() => expect(screen.getByTestId('record-view')).toHaveTextContent('sys_member'));
    await settle();
    expect(objectCalls()).not.toContain('object');
  });
});
