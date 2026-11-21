// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#35932 — saving a shared view's draft keeps the list on screen.
 *
 * Every write of the runtime persistence seam announces itself on the
 * assistant bus (`emitMetadataRefresh`, so the pending-drafts surfaces
 * re-read), and every mounted `MetadataProvider` refetches its loaded types on
 * that pulse. While the refetched `/meta/view` list was on the wire, the
 * route's object scope read as unsettled, so `AppContent` dropped the route to
 * its skeleton and mounted `ObjectView` again. The new mount read the
 * PUBLISHED view: the admin's draft was gone from the screen until Publish,
 * and a second footer pick was built on the published view, so the draft it
 * wrote replaced the first pick.
 *
 * What runs: the real `AuthProvider`, `MetadataProvider`, `AppContent` and
 * `ObjectView`, and the real persistence seam. Only the network is stubbed:
 * the provider's adapter (with the refetched view list held open, as a real
 * request is), the list's data source, and the metadata client's `save`.
 * `ListView` is a stand-in that records the props it is handed and counts its
 * mounts, so a remount of the route is read as a second mount.
 *
 * Pinned:
 *  - an admin's footer pick on a shared view: no skeleton, no remount, the
 *    list keeps the picked calculation while the refresh is on the wire and
 *    after it lands;
 *  - two successive picks: the second draft carries both;
 *  - the writes are draft saves; a reader (not an admin) served the published
 *    view draws it, without the admin's calculations.
 * CONTROL: a whole-type invalidation of `view` (the provider dropping its
 * items, not refetching in place) still sends the route back to waiting.
 *
 * The same, on an app with a bundle (the showcase's path): the provider's
 * adapter has `peekAppBundle`, and the refresh pulse's `clearCache()` drops
 * the bundle, as `AppBundleStore.clear()` does, so the bundle answers
 * `pending` while its reload is on the wire (held here). The cases above read
 * an adapter without one, which is why they missed it. Pinned: the pick, two
 * picks, and Publish keep one mount and no skeleton. CONTROLS: a first entry
 * held on the wire (no bundle has answered yet) still waits, and a whole-type
 * `object` invalidation still sends the drawn route back to its skeleton.
 */

import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React, { useEffect } from 'react';
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
vi.mock('../../layout/ConsoleLayout', () => ({
  ConsoleLayout: ({ children }: { children?: React.ReactNode }) => <div data-testid="console-layout">{children}</div>,
}));
vi.mock('../../chrome/CommandPalette', () => ({ CommandPalette: () => null }));
vi.mock('../../chrome/KeyboardShortcutsDialog', () => ({ KeyboardShortcutsDialog: () => null }));
vi.mock('../../chrome/OnboardingWalkthrough', () => ({ OnboardingWalkthrough: () => null }));

vi.mock('@object-ui/permissions', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@object-ui/permissions')>();
  // Stable identities: `ListView` names `perms` in its fetch dependencies.
  const perms = {
    check: () => ({ allowed: true }),
    checkField: () => true,
    getFieldPermissions: () => [],
    getRowFilter: () => undefined,
    getObjectApiOperations: () => undefined,
    roles: [],
    isLoaded: false,
    hasCapabilities: () => true,
    can: () => true,
    cannot: () => false,
  };
  const fieldPerms = { canRead: () => true, canWrite: () => true, permissions: [] };
  return { ...actual, usePermissions: () => perms, useFieldPermissions: () => fieldPerms };
});
vi.mock('@object-ui/collaboration', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useRealtimeSubscription: () => ({ lastMessage: null }),
  useConflictResolution: () => ({ hasConflicts: false, resolveAllConflicts: () => {} }),
}));
vi.mock('sonner', () => ({
  toast: Object.assign(vi.fn(), {
    success: vi.fn(), error: vi.fn(), info: vi.fn(),
    warning: vi.fn(), loading: vi.fn(), dismiss: vi.fn(),
  }),
}));
vi.mock('../../views/MetadataInspector', () => ({
  MetadataPanel: () => null,
  useMetadataInspector: () => ({ showDebug: false, toggle: () => {} }),
}));
vi.mock('../../views/RecordDetailView', () => ({ RecordDetailView: () => null }));

/** The props the list was last handed, and how many times it mounted. */
const list = vi.hoisted(() => ({ props: null as Record<string, any> | null, mounts: 0 }));
vi.mock('@object-ui/plugin-list', async (importOriginal) => {
  const { useEffect: useMountEffect } = await import('react');
  return {
    ...(await importOriginal<typeof import('@object-ui/plugin-list')>()),
    ListView: (props: any) => {
      list.props = props;
      useMountEffect(() => {
        list.mounts++;
      }, []);
      return null;
    },
  };
});
vi.mock('../../views/studio-design/packages-io', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  fetchSessionPackages: vi.fn(async () => []),
}));

/** The metadata client's writes: the network half of the persistence seam. */
const saves = vi.hoisted(() => [] as Array<{ type: string; name: string; body: any; options: any }>);
const client = vi.hoisted(() => ({
  save: async (type: string, name: string, body: any, options: any) => {
    saves.push({ type, name, body: structuredClone(body), options });
    return {};
  },
  publish: async () => ({}),
  reset: async () => ({}),
  get: async () => null,
  layered: async () => ({}),
}));
vi.mock('../../views/metadata-admin/useMetadata', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useMetadataClient: () => client,
}));

const OBJECT = 'crm_account';
const CRM = 'app.crm';
const VIEW = `${OBJECT}.team`;
/** The shared view as the server publishes it: no calculation on any column. */
const PUBLISHED_VIEW = { name: VIEW, object: OBJECT, label: 'Team', type: 'grid', columns: ['name', 'amount', 'closed_at'] };
const OBJECTS = [{
  name: OBJECT,
  label: 'Account',
  _packageId: CRM,
  fields: {
    name: { type: 'text', label: 'Name' },
    amount: { type: 'number', label: 'Amount' },
    closed_at: { type: 'date', label: 'Closed' },
  },
}];

/** The list's data source (`useAdapter()`): the saved views are served published. */
const dataSourceStub = vi.hoisted(() => ({}) as Record<string, any>);
vi.mock('../../providers/AdapterProvider', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAdapter: () => dataSourceStub,
}));
function resetDataSource() {
  Object.assign(dataSourceStub, {
    onConnectionStateChange: () => () => {},
    getConnectionState: () => 'connected',
    find: vi.fn(async () => ({ data: [], total: 0 })),
    findOne: vi.fn(async () => null),
    create: vi.fn(async () => ({})),
    update: vi.fn(async () => ({})),
    delete: vi.fn(async () => ({})),
    getObjectSchema: vi.fn(async () => OBJECTS[0]),
    listViews: vi.fn(async () => [structuredClone(PUBLISHED_VIEW)]),
    updateView: vi.fn(async () => ({})),
    invalidateViewKeys: vi.fn(),
    // `AppContent` enters the app's bundle through the list's data source, as the console does.
    ...(appBundle.on
      ? {
          loadAppBundle: () => {
            appBundle.entered = true;
            if (!appBundle.items) askBundle();
            return appBundle.settled ?? Promise.resolve();
          },
        }
      : {}),
  });
}

const actionRunnerStub = { registerHandler: vi.fn(), getContext: () => ({}) };
vi.mock('@object-ui/react', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useActionRunner: () => ({ execute: vi.fn(), runner: actionRunnerStub }),
  useGlobalUndo: () => {},
  useMutationInvalidationBridge: () => {},
}));

// `AppContent` and `ObjectView` reach a dynamic `import('@objectstack/lint')`:
// pay its load at collection, never inside a case's clocked window
// (`check:test-source-alias`).
import '@objectstack/lint';
// The route element `AppContent` loads lazily (`routeChunk.lazy`), loaded at
// collection so its factory resolves at once.
import '../../views/ObjectView.js';
import { AppContent } from '../AppContent';
import { MetadataProvider, useMetadata } from '../../providers/MetadataProvider';
import { publishRuntimeMetadata } from '../../views/runtime-metadata-persistence.js';

interface Server {
  /** Hold every `/meta/view` list read until `releaseViews`, as a request on the wire. */
  holdViews: boolean;
  releaseViews: () => void;
}
const server: Server = { holdViews: false, releaseViews: () => {} };

type BundleItems = Map<string, Map<string, { item: unknown; envelope: Record<string, unknown> }>>;
/**
 * The adapter's app bundle, as `AppBundleStore` holds it: `items` is the
 * answer in hand (`null` before the first one and after `clearCache()`), and
 * a load while `hold` is set stays on the wire until `releaseBundle`.
 */
const appBundle = {
  /** Whether this boot's adapter has a bundle at all. */
  on: false,
  entered: false,
  hold: false,
  items: null as BundleItems | null,
  settled: null as Promise<unknown> | null,
  waiting: [] as Array<() => void>,
  loads: 0,
};
const APPS = [{ name: 'crm', label: 'CRM', _packageId: CRM, navigation: [{ id: 'n1', type: 'object', label: 'Accounts', objectName: OBJECT }] }];
function bundleItems(): BundleItems {
  const entry = (item: unknown) => ({ item: structuredClone(item), envelope: {} });
  return new Map([
    ['app', new Map([['crm', entry(APPS[0])]])],
    ['object', new Map(OBJECTS.map((o) => [o.name, entry(o)]))],
    ['view', new Map([[VIEW, entry(PUBLISHED_VIEW)]])],
  ]);
}
function askBundle() {
  if (appBundle.settled) return;
  appBundle.loads++;
  let land: () => void = () => {};
  appBundle.settled = new Promise<void>((resolve) => { land = resolve; });
  const go = () => {
    appBundle.items = bundleItems();
    appBundle.settled = null;
    land();
  };
  if (appBundle.hold) appBundle.waiting.push(go);
  else queueMicrotask(go);
}
const releaseBundle = () => appBundle.waiting.splice(0).forEach((go) => go());
function resetBundle(on: boolean) {
  Object.assign(appBundle, { on, entered: false, hold: false, items: null, settled: null, waiting: [], loads: 0 });
}

function makeAdapter() {
  const heldViews: Array<() => void> = [];
  server.releaseViews = () => heldViews.splice(0).forEach((go) => go());
  const bundleHost = appBundle.on
    ? {
        peekAppBundle: () => {
          if (!appBundle.entered) return { status: 'none' };
          if (!appBundle.items) {
            askBundle();
            return { status: 'pending', settled: appBundle.settled! };
          }
          return { status: 'ready', items: appBundle.items };
        },
      }
    : {};
  return {
    ...bundleHost,
    // `AppBundleStore.clear()`: the bundle's answer is dropped, the app stays entered.
    clearCache: vi.fn(() => {
      appBundle.items = null;
    }),
    invalidateCache: vi.fn(),
    getObjectSchema(this: { getClient(): any }, name: string) {
      return this.getClient()
        .meta.getItem('object', name)
        .then((res: any) => (res && typeof res === 'object' && 'item' in res ? res.item : res));
    },
    getClient: () => ({
      meta: {
        getItems: (type: string, options?: { packageId?: string; names?: readonly string[] }) => {
          if (options?.names) {
            const named = type === 'object' ? OBJECTS.filter((o) => options.names!.includes(o.name)) : [];
            return Promise.resolve({ type, items: structuredClone(named) });
          }
          const all: any[] = type === 'object' ? OBJECTS : type === 'app' ? APPS : type === 'view' ? [PUBLISHED_VIEW] : [];
          const items = options?.packageId ? all.filter((o: any) => o._packageId === options.packageId) : all;
          const answer = { type, items: structuredClone(items) };
          if (type === 'view' && server.holdViews) return new Promise((resolve) => heldViews.push(() => resolve(answer)));
          return Promise.resolve(answer);
        },
        getItem: (type: string, name: string) => {
          const item = (type === 'object' ? OBJECTS : []).find((o) => o.name === name);
          return item
            ? Promise.resolve({ type, name, item: structuredClone(item) })
            : Promise.reject(Object.assign(new Error('not found'), { httpStatus: 404, code: 'RESOURCE_NOT_FOUND' }));
        },
      },
    }),
  } as unknown as Parameters<typeof MetadataProvider>[0]['adapter'];
}

const ORG: AuthOrganization = { id: 'org_a', name: 'Org A', slug: 'a' };

function authClient(admin: boolean): AuthClient {
  const user = admin
    ? { id: 'u_admin', name: 'Ada', email: 'ada@test.com', role: 'admin', positions: ['admin'] }
    : { id: 'u_reader', name: 'Rey', email: 'rey@test.com', role: 'user', positions: [] };
  return {
    getSession: vi.fn(async () => ({ user, session: { token: `tok-${user.id}`, activeOrganizationId: ORG.id } })),
    signOut: vi.fn(async () => undefined),
    getConfig: vi.fn(async () => ({ features: {} })),
    listOrganizations: vi.fn(async () => [ORG]),
    getActiveOrganization: vi.fn(async () => ORG),
    setActiveOrganization: vi.fn(async () => ORG),
    getActiveMember: vi.fn(async () => ({ id: `m_${user.id}`, organizationId: ORG.id, userId: user.id, role: admin ? 'owner' : 'member' })),
  } as unknown as AuthClient;
}

const metadata: { current: ReturnType<typeof useMetadata> | null } = { current: null };
function MetadataProbe() {
  const ctx = useMetadata();
  useEffect(() => {
    metadata.current = ctx;
  });
  return null;
}

function boot(admin: boolean, options: { bundle?: boolean; holdFirstLoad?: boolean } = {}) {
  if (options.bundle) {
    resetBundle(true);
    resetDataSource();
    appBundle.hold = options.holdFirstLoad === true;
  }
  render(
    <AuthProvider authUrl="/api/auth" client={authClient(admin)}>
      <MetadataProvider adapter={makeAdapter()}>
        <MetadataProbe />
        <MemoryRouter initialEntries={[`/apps/crm/${OBJECT}/view/${encodeURIComponent(VIEW)}`]}>
          <Routes>
            <Route path="/apps/:appName/*" element={<AppContent />} />
          </Routes>
        </MemoryRouter>
      </MetadataProvider>
    </AuthProvider>,
  );
}

/** Forget what the list was handed (a function, so the read after it is not narrowed to `null`). */
function forgetList() {
  list.props = null;
}
const skeletonUp = () => screen.queryByTestId('route-metadata-skeleton') !== null;
/** The calculation the list draws under `field`, as the list's schema carries it. */
const summaryOf = (field: string) => {
  const columns = (list.props?.schema?.columns ?? []) as Array<string | { field: string; summary?: unknown }>;
  const column = columns.find((c) => (typeof c === 'string' ? c : c.field) === field);
  return column && typeof column === 'object' ? column.summary : undefined;
};
const pick = (field: string, summary: string) =>
  act(async () => {
    await list.props!.onColumnSummaryPick(field, summary);
  });
const storedSummaries = (body: any) =>
  Object.fromEntries(
    ((body?.config?.columns ?? body?.columns ?? []) as Array<string | { field: string; summary?: unknown }>)
      .filter((c): c is { field: string; summary?: unknown } => typeof c === 'object' && c.summary !== undefined)
      .map((c) => [c.field, c.summary]),
  );

beforeEach(() => {
  server.holdViews = false;
  saves.length = 0;
  forgetList();
  list.mounts = 0;
  metadata.current = null;
  resetBundle(false);
  resetDataSource();
  localStorage.clear();
  sessionStorage.clear();
  ActiveOrganizationStorage.clear();
});

afterEach(() => {
  server.releaseViews();
  appBundle.hold = false;
  releaseBundle();
  cleanup();
  ActiveOrganizationStorage.clear();
});

describe('objectstack#35932 — a shared view\'s draft save keeps the list on screen', () => {
  it('an admin\'s footer pick: no skeleton, no remount, the pick stays drawn through the refresh', async () => {
    boot(true);
    await waitFor(() => expect(typeof list.props?.onColumnSummaryPick).toBe('function'), { timeout: 5000 });
    expect(list.mounts).toBe(1);
    expect(summaryOf('amount')).toBeUndefined();

    // The refresh the save announces re-reads `/meta/view`; held, as a request on the wire.
    server.holdViews = true;
    await pick('amount', 'sum');
    expect(saves).toHaveLength(1);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    expect(skeletonUp()).toBe(false);
    expect(list.mounts).toBe(1);
    expect(summaryOf('amount')).toBe('sum');

    server.holdViews = false;
    act(() => server.releaseViews());
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    expect(list.mounts).toBe(1);
    expect(summaryOf('amount')).toBe('sum');
  });

  it('two successive picks: the second draft carries both', async () => {
    boot(true);
    await waitFor(() => expect(typeof list.props?.onColumnSummaryPick).toBe('function'), { timeout: 5000 });

    server.holdViews = true;
    await pick('amount', 'sum');
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    await pick('closed_at', 'latest');
    server.holdViews = false;
    act(() => server.releaseViews());
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });

    expect(saves.map((s) => [s.type, s.name, s.options?.mode])).toEqual([
      ['view', VIEW, 'draft'],
      ['view', VIEW, 'draft'],
    ]);
    expect(storedSummaries(saves[0].body)).toEqual({ amount: 'sum' });
    expect(storedSummaries(saves[1].body)).toEqual({ amount: 'sum', closed_at: 'latest' });
    expect(list.mounts).toBe(1);
    expect(summaryOf('amount')).toBe('sum');
    expect(summaryOf('closed_at')).toBe('latest');
  });

  it('a reader is served the published view and draws it, without the admin\'s draft', async () => {
    boot(true);
    await waitFor(() => expect(typeof list.props?.onColumnSummaryPick).toBe('function'), { timeout: 5000 });
    await pick('amount', 'sum');
    expect(saves.map((s) => s.options?.mode)).toEqual(['draft']);
    cleanup();

    forgetList();
    boot(false);
    await waitFor(() => expect(list.props?.schema?.columns).toBeDefined(), { timeout: 5000 });
    expect(summaryOf('amount')).toBeUndefined();
    // Offered to an admin only.
    expect(list.props?.onColumnSummaryPick).toBeUndefined();
  });

  it('CONTROL: a whole-type invalidation of `view` still sends the route back to waiting', async () => {
    boot(true);
    await waitFor(() => expect(typeof list.props?.onColumnSummaryPick).toBe('function'), { timeout: 5000 });
    server.holdViews = true;
    act(() => metadata.current!.invalidate('view'));
    await waitFor(() => expect(skeletonUp()).toBe(true));
    server.holdViews = false;
    act(() => server.releaseViews());
    await waitFor(() => expect(skeletonUp()).toBe(false));
  });
});

describe('objectstack#35932 — the same, on an app with a bundle', () => {
  /** Let the pulse run: the save's refresh, the bundle reload put on the wire. */
  const settle = () =>
    act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });

  it('an admin\'s footer pick: the bundle reloading keeps the list, one mount, the pick drawn', async () => {
    boot(true, { bundle: true });
    await waitFor(() => expect(typeof list.props?.onColumnSummaryPick).toBe('function'), { timeout: 5000 });
    expect(list.mounts).toBe(1);
    const loadsBefore = appBundle.loads;

    appBundle.hold = true;
    await pick('amount', 'sum');
    await settle();
    // The pulse dropped the bundle and its reload is on the wire.
    expect(appBundle.items).toBeNull();
    expect(appBundle.loads).toBe(loadsBefore + 1);
    expect(skeletonUp()).toBe(false);
    expect(list.mounts).toBe(1);
    expect(summaryOf('amount')).toBe('sum');

    appBundle.hold = false;
    act(() => releaseBundle());
    await settle();
    expect(skeletonUp()).toBe(false);
    expect(list.mounts).toBe(1);
    expect(summaryOf('amount')).toBe('sum');
  });

  it('two successive picks, then Publish: both picks in the second draft, one mount throughout', async () => {
    boot(true, { bundle: true });
    await waitFor(() => expect(typeof list.props?.onColumnSummaryPick).toBe('function'), { timeout: 5000 });

    appBundle.hold = true;
    await pick('amount', 'sum');
    await settle();
    await pick('closed_at', 'latest');
    await settle();
    expect(skeletonUp()).toBe(false);
    expect(storedSummaries(saves[0].body)).toEqual({ amount: 'sum' });
    expect(storedSummaries(saves[1].body)).toEqual({ amount: 'sum', closed_at: 'latest' });

    appBundle.hold = false;
    act(() => releaseBundle());
    await settle();

    // Publish, through the seam the draft bar calls: its pulse drops the bundle again.
    appBundle.hold = true;
    await act(async () => {
      await publishRuntimeMetadata('view', VIEW, { metadataClient: client as any, dataSource: dataSourceStub as any, objectName: OBJECT });
    });
    await settle();
    expect(appBundle.items).toBeNull();
    expect(skeletonUp()).toBe(false);
    expect(list.mounts).toBe(1);

    appBundle.hold = false;
    act(() => releaseBundle());
    await settle();
    expect(skeletonUp()).toBe(false);
    expect(list.mounts).toBe(1);
  });

  it('CONTROL: a first entry on the wire (no bundle has answered) still waits, the list not drawn', async () => {
    boot(true, { bundle: true, holdFirstLoad: true });
    await waitFor(() => expect(appBundle.waiting.length).toBeGreaterThan(0), { timeout: 5000 });
    await settle();
    expect(list.mounts).toBe(0);
    appBundle.hold = false;
    act(() => releaseBundle());
    await waitFor(() => expect(list.mounts).toBe(1), { timeout: 5000 });
  });

  it('CONTROL: a whole-type invalidation of `object` on the bundle route still shows the skeleton', async () => {
    boot(true, { bundle: true });
    await waitFor(() => expect(typeof list.props?.onColumnSummaryPick).toBe('function'), { timeout: 5000 });
    act(() => {
      metadata.current!.invalidate('object');
    });
    await waitFor(() => expect(skeletonUp()).toBe(true));
    await waitFor(() => expect(skeletonUp()).toBe(false));
  });
});
