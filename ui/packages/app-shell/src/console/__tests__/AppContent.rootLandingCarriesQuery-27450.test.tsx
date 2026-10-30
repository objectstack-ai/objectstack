/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack-ai/objectstack#27450 — an app-root deep link keeps its query.
 *
 * The URL overlays (`?palette=1`, `?recordId=`, `?form=`) live in the query.
 * The app root (`/apps/:appName`) redirects to the app's landing, and that
 * redirect built its target from the landing alone, so
 * `/apps/showcase_app?palette=1` settled on the landing page with no query and
 * the command palette never opened. The redirect now carries search and hash
 * across, merging with a landing that has a query of its own.
 *
 * Measured from a real `AppContent` mount (the `AppContent.nameAliasRedirect
 * -26183` harness); the router's location is the observation point, and the
 * real `CommandPaletteProvider` (which `ConsoleLayout` mounts in the shipped
 * shell) reads the landed URL, so "the palette is open" is the provider's own
 * answer.
 *
 * Direction, written before the run: on the pre-fix wiring every case that
 * arrives with a query is RED (the landing has none); the bare-root control
 * is GREEN on both sides.
 */

import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, afterEach } from 'vitest';
import React, { useEffect } from 'react';
import { render, cleanup, waitFor, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route, useLocation, useNavigationType } from 'react-router-dom';
import { createI18n, I18nProvider } from '@object-ui/i18n';

// The route's recent-items tracker runs; this file does not observe it.
vi.mock('../../context/RecentItemsProvider', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useRecentItems: () => ({ recentItems: [], addRecentItem: () => {}, clearRecentItems: () => {} }),
}));

vi.mock('@object-ui/plugin-form', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  ModalForm: () => null,
}));

vi.mock('@object-ui/plugin-designer', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@object-ui/plugin-designer')>()),
  CreateAppPage: () => <div data-testid="create-app-page" />,
  EditAppPage: () => <div data-testid="edit-app-page" />,
  DashboardDesignPage: () => <div data-testid="dashboard-design-page" />,
}));

// The shipped `ConsoleLayout` mounts the real `CommandPaletteProvider` around
// the route slot; this stand-in keeps that provider and drops the chrome.
vi.mock('../../layout/ConsoleLayout', async () => {
  const { CommandPaletteProvider, useCommandPalette } = await import('../../context/CommandPaletteProvider');
  function PaletteProbe() {
    const { open } = useCommandPalette();
    return open ? <div data-testid="palette-open" /> : null;
  }
  return {
    ConsoleLayout: ({ children }: { children?: React.ReactNode }) => (
      <CommandPaletteProvider>
        <PaletteProbe />
        <div data-testid="console-layout">{children}</div>
      </CommandPaletteProvider>
    ),
  };
});
vi.mock('../../chrome/CommandPalette', () => ({ CommandPalette: () => null }));
vi.mock('../../chrome/KeyboardShortcutsDialog', () => ({ KeyboardShortcutsDialog: () => null }));
vi.mock('../../chrome/OnboardingWalkthrough', () => ({ OnboardingWalkthrough: () => null }));
vi.mock('../../views/ObjectView', () => ({ ObjectView: () => <div data-testid="object-view" /> }));
vi.mock('../../views/RecordDetailView', () => ({ RecordDetailView: () => null }));

vi.mock('@object-ui/auth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAuth: () => ({
    user: { id: 'u1', name: 'Ada', email: 'ada@example.com', role: 'user' },
    getAuthConfig: async () => ({ features: {} }),
    activeOrganization: null,
  }),
  useWorkspaceAdminStatus: () => ({ isAdmin: true, isResolved: true }),
}));

const dataSourceStub = {
  onConnectionStateChange: () => () => {},
  getConnectionState: () => 'connected',
};
vi.mock('../../providers/AdapterProvider', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAdapter: () => dataSourceStub,
}));

/** The showcase app as the catalog serves it: a name AND a package id. */
const SHOWCASE = {
  name: 'showcase_app',
  label: 'Showcase',
  _packageId: 'com.example.showcase',
  isDefault: true,
  navigation: [{ id: 'tasks', type: 'object', objectName: 'showcase_task', label: 'Tasks' }],
};

/** The same app whose landing entry carries a query of its own (`?runAction=`). */
const SHOWCASE_LANDING_WITH_QUERY = {
  ...SHOWCASE,
  navigation: [
    { id: 'tasks', type: 'object', objectName: 'showcase_task', viewName: 'all', runAction: 'import', label: 'Tasks' },
  ],
};

const OBJECTS = [{ name: 'showcase_task', label: 'Task', pluralLabel: 'Tasks', fields: { title: { type: 'text' } } }];

/** The catalog a test serves. One value per test: the route's effects key on its members. */
const { metadataRef } = vi.hoisted(() => ({ metadataRef: { current: null as unknown } }));
function serve(apps: unknown[]): void {
  metadataRef.current = {
    apps,
    objects: OBJECTS,
    loading: false,
    ensureType: undefined,
    error: null,
    refresh: async () => {},
  };
}
vi.mock('../../providers/MetadataProvider', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useMetadata: () => metadataRef.current,
}));

const ACTION_RUNNER = { execute: () => {}, runner: { registerHandler: () => {}, getContext: () => ({}) } };
vi.mock('@object-ui/react', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useActionRunner: () => ACTION_RUNNER,
  useGlobalUndo: () => {},
  useMutationInvalidationBridge: () => {},
}));

import { AppContent } from '../AppContent';
import { COMMAND_PALETTE_PARAM, RECORD_DRAWER_PARAM } from '../../urlParams';

/** The router's location as the last render saw it. */
const seen: { pathname?: string; search?: string; hash?: string; type?: string } = {};
function LocationProbe() {
  const location = useLocation();
  const type = useNavigationType();
  useEffect(() => {
    Object.assign(seen, { pathname: location.pathname, search: location.search, hash: location.hash, type });
  }, [location, type]);
  return null;
}

afterEach(cleanup);

/** Mount the console's app router at `entry`; the landing's object list renders. */
async function visit(entry: string): Promise<void> {
  const i18n = createI18n({ defaultLanguage: 'en', detectBrowserLanguage: false });
  render(
    <I18nProvider instance={i18n}>
      <MemoryRouter initialEntries={[entry]}>
        <Routes>
          <Route path="/apps/:appName/*" element={<AppContent />} />
        </Routes>
        <LocationProbe />
      </MemoryRouter>
    </I18nProvider>,
  );
  await screen.findByTestId('object-view', undefined, { timeout: 5000 });
}

describe('the app-root redirect carries the deep link\'s query (objectstack-ai/objectstack#27450)', () => {
  it('THE CARD: `/apps/showcase_app?palette=1` lands on the default page with `?palette=1` kept and the palette open', async () => {
    serve([SHOWCASE]);
    await visit(`/apps/showcase_app?${COMMAND_PALETTE_PARAM}=1`);
    await waitFor(() => expect(seen.pathname).toBe('/apps/com.example.showcase/showcase_task'));
    expect(seen.search).toBe(`?${COMMAND_PALETTE_PARAM}=1`);
    expect(seen.type).toBe('REPLACE');
    expect(await screen.findByTestId('palette-open')).toBeInTheDocument();
  });

  it('carries any overlay param and the hash, not the palette alone', async () => {
    serve([SHOWCASE]);
    await visit(`/apps/com.example.showcase?${RECORD_DRAWER_PARAM}=rec_123456#notes`);
    await waitFor(() => expect(seen.pathname).toBe('/apps/com.example.showcase/showcase_task'));
    expect(seen.search).toBe(`?${RECORD_DRAWER_PARAM}=rec_123456`);
    expect(seen.hash).toBe('#notes');
  });

  it('merges with a landing that has a query of its own', async () => {
    serve([SHOWCASE_LANDING_WITH_QUERY]);
    await visit(`/apps/com.example.showcase?${COMMAND_PALETTE_PARAM}=1`);
    await waitFor(() => expect(seen.pathname).toBe('/apps/com.example.showcase/showcase_task/view/all'));
    const params = new URLSearchParams(seen.search);
    expect(params.getAll('runAction')).toEqual(['import']);
    expect(params.getAll(COMMAND_PALETTE_PARAM)).toEqual(['1']);
    expect(await screen.findByTestId('palette-open')).toBeInTheDocument();
  });

  it('a key both name is the link\'s value once, never doubled', async () => {
    serve([SHOWCASE_LANDING_WITH_QUERY]);
    await visit(`/apps/com.example.showcase?runAction=export&${COMMAND_PALETTE_PARAM}=1`);
    await waitFor(() => expect(seen.pathname).toBe('/apps/com.example.showcase/showcase_task/view/all'));
    const params = new URLSearchParams(seen.search);
    expect(params.getAll('runAction')).toEqual(['export']);
    expect(params.getAll(COMMAND_PALETTE_PARAM)).toEqual(['1']);
  });

  it('CONTROL: a bare app root lands on the bare landing, palette closed', async () => {
    serve([SHOWCASE]);
    await visit('/apps/com.example.showcase');
    await waitFor(() => expect(seen.pathname).toBe('/apps/com.example.showcase/showcase_task'));
    expect(seen.search).toBe('');
    expect(seen.hash).toBe('');
    expect(screen.queryByTestId('palette-open')).toBeNull();
  });
});
