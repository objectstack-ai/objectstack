// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#12980 (item 2, re-scoped by measurement) — the route's lazy element
 * does not hold the boot splash after the route's data is ready.
 *
 * Measured in Chromium on a production build: the route's `React.lazy` element
 * first rendered when the console chrome committed, suspended there even with
 * its chunk cached, and its Suspense fallback is the boot splash
 * (`LoadingScreen`, `data-boot-splash`). react-dom holds a fallback it has just
 * shown for its reveal throttle, so the splash stayed about 0.28 s after the
 * route's metadata was in, on every open.
 *
 * Now the chunk import starts as soon as `AppContent` knows the route, beside
 * the route's metadata reads. The harness holds the route's metadata until the
 * test settles it and lets the mocked view modules answer only when the test
 * says so, so each step is an observation:
 *
 *   (a) the page route's chunk is requested while the splash is still up and
 *       before the route's metadata lands; once both are in, the page renders
 *       with the chrome and no splash is ever drawn inside the chrome.
 *   (b) CONTROL: a route whose chunk is still in flight when its metadata
 *       lands keeps a splash in the route slot (never a blank), then renders.
 */

import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { AuthProvider, ActiveOrganizationStorage } from '@object-ui/auth';
import type { AuthClient, AuthOrganization } from '@object-ui/auth';

/** The view chunks: each mocked module answers only when the test releases it. */
const chunks = vi.hoisted(() => {
  const gate = () => {
    let release!: () => void;
    const ready = new Promise<void>((r) => { release = r; });
    return { requested: false, splashUpWhenRequested: null as boolean | null, ready, release };
  };
  return { page: gate(), dashboard: gate() };
});

const splashUp = () => document.querySelector('[data-boot-splash]') !== null;

vi.mock('../../views/PageView', async () => {
  chunks.page.requested = true;
  chunks.page.splashUpWhenRequested = document.querySelector('[data-boot-splash]') !== null;
  await chunks.page.ready;
  return { PageView: () => <div data-testid="page-view" /> };
});
vi.mock('../../views/DashboardView', async () => {
  chunks.dashboard.requested = true;
  chunks.dashboard.splashUpWhenRequested = document.querySelector('[data-boot-splash]') !== null;
  await chunks.dashboard.ready;
  return { DashboardView: () => <div data-testid="dashboard-view" /> };
});

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
vi.mock('../../hooks/useNavigationSync', () => ({ NavigationSyncEffect: () => null }));
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
 * A metadata cache whose lazy buckets answer only when the test says so, with
 * `MetadataProvider`'s status words. The app has no `_packageId`, so a page
 * route reads its buckets the way the whole-registry path does.
 */
const meta = vi.hoisted(() => ({
  status: {} as Record<string, string>,
  items: {} as Record<string, unknown[]>,
  version: 0,
  listeners: new Set<() => void>(),
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
      const read = (type: string) => (meta.status[type] === 'ready' ? meta.items[type] ?? [] : []);
      return {
        apps: [{ name: 'crm', label: 'CRM', navigation: [] }],
        get objects() { return read('object'); },
        get dashboards() { return read('dashboard'); },
        get reports() { return read('report'); },
        get pages() { return read('page'); },
        loading: false,
        error: null,
        ensureType: (type: string) => {
          if ((meta.status[type] ?? 'idle') === 'idle') meta.status[type] = 'loading';
          return Promise.resolve(meta.items[type] ?? []);
        },
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

const USER = 'u_12980';
const ORG: AuthOrganization = { id: 'org_a', name: 'Org A', slug: 'a' };

function createClient() {
  const client = {
    getSession: vi.fn(async () => ({
      user: { id: USER, name: 'Ada', email: 'ada@test.com', role: 'user' },
      session: { token: 'tok-12980', activeOrganizationId: ORG.id },
    })),
    signOut: vi.fn(async () => undefined),
    getConfig: vi.fn(async () => ({ features: {} })),
    listOrganizations: vi.fn(async () => [ORG]),
    getActiveOrganization: vi.fn(() => new Promise(() => {})),
    setActiveOrganization: vi.fn(async () => ORG),
    getActiveMember: vi.fn(async () => ({ id: 'm1', organizationId: ORG.id, userId: USER, role: 'member' })),
  };
  return client as unknown as AuthClient;
}

const settle = (types: string[], items: Record<string, unknown[]>) => act(async () => {
  for (const type of types) {
    meta.items[type] = items[type] ?? [];
    meta.status[type] = 'ready';
  }
  bump();
});

/** Every element carrying the splash marker that was ever attached INSIDE the chrome. */
function watchSplashInsideChrome() {
  const seen = { count: 0 };
  const observer = new MutationObserver((records) => {
    for (const record of records) {
      record.addedNodes.forEach((node) => {
        if (!(node instanceof Element)) return;
        const splashes = node.matches('[data-boot-splash]') ? [node] : [...node.querySelectorAll('[data-boot-splash]')];
        for (const splash of splashes) {
          if (splash.closest('[data-testid="console-layout"]')) seen.count += 1;
        }
      });
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });
  return { seen, stop: () => observer.disconnect() };
}

function boot(url: string) {
  render(
    <AuthProvider authUrl="/api/auth" client={createClient()}>
      <MemoryRouter initialEntries={[url]}>
        <Routes>
          <Route path="/apps/:appName/*" element={<AppContent />} />
        </Routes>
      </MemoryRouter>
    </AuthProvider>,
  );
}

beforeEach(() => {
  meta.status = {};
  meta.items = {};
  meta.version = 0;
  localStorage.clear();
  ActiveOrganizationStorage.clear();
});

afterEach(() => {
  cleanup();
  ActiveOrganizationStorage.clear();
});

describe('the route element chunk loads beside the route reads (objectui#12980)', () => {
  it('(a) a page route requests its chunk under the splash; the page renders with the chrome, no splash inside it', async () => {
    const watch = watchSplashInsideChrome();
    boot('/apps/crm/page/welcome');

    // The route is known and its reads are out: the chunk is requested now,
    // under the splash, not when the chrome commits.
    await waitFor(() => expect(chunks.page.requested).toBe(true));
    expect(chunks.page.splashUpWhenRequested).toBe(true);
    expect(splashUp()).toBe(true);
    expect(screen.queryByTestId('console-layout')).not.toBeInTheDocument();
    expect(meta.status.page).toBe('loading');

    // The chunk answers while the reads are still in flight; then the reads.
    await act(async () => { chunks.page.release(); });
    await settle(['page', 'object'], { page: [{ name: 'welcome', label: 'Welcome' }] });

    expect(screen.getByTestId('console-layout')).toBeInTheDocument();
    expect(screen.getByTestId('page-view')).toBeInTheDocument();
    expect(splashUp()).toBe(false);
    watch.stop();
    expect(watch.seen.count).toBe(0);
  });

  it('(b) CONTROL: a route whose chunk is still in flight keeps a splash in the route slot, then renders', async () => {
    const watch = watchSplashInsideChrome();
    boot('/apps/crm/dashboard/sales');

    // The metadata lands first; the chunk has not answered. (This half holds
    // with or without the preload: it pins the fallback, not the timing.)
    await settle(['dashboard', 'object'], { dashboard: [{ name: 'sales', label: 'Sales' }] });
    await waitFor(() => expect(chunks.dashboard.requested).toBe(true));
    expect(screen.getByTestId('console-layout')).toBeInTheDocument();
    expect(screen.queryByTestId('dashboard-view')).not.toBeInTheDocument();
    // Never a blank: the route slot draws the splash while its chunk loads.
    expect(splashUp()).toBe(true);
    expect(watch.seen.count).toBeGreaterThan(0);

    await act(async () => { chunks.dashboard.release(); });
    await waitFor(() => expect(screen.getByTestId('dashboard-view')).toBeInTheDocument());
    expect(splashUp()).toBe(false);
    watch.stop();
  });
});
