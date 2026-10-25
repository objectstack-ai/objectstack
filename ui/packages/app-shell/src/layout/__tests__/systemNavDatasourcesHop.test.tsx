// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The `sys-datasources` entry `UnifiedSidebar` carries arrives at the canonical
 * metadata-admin route with ZERO redirects (objectui#3660).
 *
 * ## What was wrong
 *
 * `AppSidebar.systemFallbackNavigation` and `UnifiedSidebar.homeNavigation`
 * each held their own literal for this entry, and both spelled it
 * `/apps/setup/component/metadata/resource?type=datasource`. app-shell declares
 * that spelling as a legacy *alias*, not a page: in both `AppContent` branches
 * its route element is `LegacyMetadataRedirect`, which immediately `<Navigate>`s
 * onto `/apps/setup/metadata/datasource`. Every click therefore paid a hop plus
 * a re-render to reach a URL the nav item could name itself. (`AppSidebar` and
 * its copy were removed later, by objectui#5817.)
 *
 * These are two of the six producers enumerated while fixing objectui#3639.
 * That issue's PR corrected the console host's two redirects; the System hub's
 * two metadata cards were the other pair (re-pointed by objectui#3660, then
 * deleted with the whole card wall and their test by objectui#3743).
 *
 * ## What this file measures, and how it differs from the sibling pin
 *
 * `systemNavSettingsTarget.test.tsx` asserts the URL each entry CARRIES — a
 * string equality on an `href`. This file asks the next question: what that URL
 * costs to resolve. `ChainRecorder` records every distinct location the router
 * settles on, so a direct arrival is a one-entry chain and an alias arrival is
 * two. Endpoint-only assertions cannot tell those apart — both finish at
 * `/apps/setup/metadata/datasource`, which is exactly why the detour survived.
 *
 * The href is READ OUT of a real `UnifiedSidebar` render rather than typed in
 * here, so the producer under test is the component's own literal.
 *
 * ## The alias mirror below, and what rests on its fidelity
 *
 * `AliasResourceRedirect` mirrors `LegacyMetadataRedirect`'s resource arm from
 * `console/AppContent.tsx`. Nothing this file ASSERTS depends on that mirror
 * being faithful: the green expectation is `chain` equals `[canonical URL]`,
 * which holds iff the sidebar's URL matches a canonical route directly. The
 * mirror only shapes what the FAILURE looks like — with it, restoring the old
 * literal produces a two-entry chain whose first entry is the alias, i.e. the
 * extra hop printed literally in the diff rather than merely implied. The real
 * alias route's own behaviour is pinned separately, against the real route
 * table, in `console/__tests__/AppContent.noAppComponentRoutes.test.tsx`.
 *
 * ## Scope
 *
 * Where the sidebar AIMS. The alias routes are untouched and stay reachable for
 * bookmarks and external links; nothing here asks for their removal.
 */

import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route, Navigate, useLocation, useParams } from 'react-router-dom';

// ---------------------------------------------------------------------------
// Mocks — providers and console-only chrome, matching the sibling sidebar
// suites (`systemNavSettingsTarget.test.tsx`, `systemNavObjectsHop.test.tsx`).
// `react-router-dom` stays REAL: the chain measurement below IS the router.
// ---------------------------------------------------------------------------

vi.mock('@object-ui/i18n', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useObjectTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => String(options?.defaultValue ?? key),
  }),
  useObjectLabel: () => ({
    objectLabel: ({ label }: { label?: string }) => label,
    viewLabel: (_o: string, _v: string, fallback?: string) => fallback,
    dashboardLabel: ({ label }: { label?: string }) => label,
  }),
}));

vi.mock('@object-ui/auth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAuth: () => ({ user: null, signOut: vi.fn(), isAuthEnabled: false, activeOrganization: null }),
  useWorkspaceAdminStatus: () => ({ isAdmin: true, isResolved: true }),
  getUserInitials: () => 'U',
}));

vi.mock('@object-ui/permissions', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@object-ui/permissions')>();
  return {
    ...actual,
    usePermissions: () => ({ can: () => true, hasCapabilities: () => true }),
  };
});

/** Zero apps. The `/home` context below renders `homeNavigation` whatever this list holds. */
vi.mock('../../providers/MetadataProvider', () => ({
  useMetadata: () => ({ apps: [], objects: [] }),
}));

vi.mock('../../providers/ExpressionProvider', () => ({
  useExpressionContext: () => ({ evaluator: null }),
  evaluateVisibility: (expr: unknown) => expr !== false && expr !== 'false',
  evaluateNavigationVisibility: (expr: unknown) => expr !== false && expr !== 'false',
}));

vi.mock('../../utils', () => ({
  resolveKeyedI18nLabel: (label: unknown) => (typeof label === 'string' ? label : ''),
  matchAppBySegment: (apps: Array<{ name?: string }>, segment?: string) =>
    apps.find((a) => a?.name === segment),
  appRouteSegment: (app: { name?: string }) => app?.name,
}));

vi.mock('../../utils/getIcon', () => ({ getIcon: () => () => null }));
vi.mock('@object-ui/components', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getLazyIcon: () => () => null,
}));

vi.mock('../../hooks/useRecentItems', () => ({ useRecentItems: () => ({ recentItems: [] }) }));
vi.mock('../../hooks/useFavorites', () => ({
  useFavorites: () => ({ favorites: [], removeFavorite: vi.fn() }),
}));
vi.mock('../../hooks/useNavPins', () => ({
  useNavPins: () => ({ togglePin: vi.fn(), applyPins: (items: unknown) => items }),
}));
vi.mock('../../hooks/useNavActionDispatch', () => ({
  useNavActionDispatch: () => vi.fn(),
}));
vi.mock('../../context/NavigationContext', () => ({
  useNavigationContext: () => ({ context: 'home', currentAppName: undefined }),
}));
vi.mock('../ContextSelectors', () => ({
  useAppContextSelectors: () => ({ contextValues: {}, element: null }),
  contextSelectorQueryKey: (id: string) => (id === 'active_package' ? 'package' : id),
  STUDIO_PACKAGE_SELECTOR_ID: 'active_package',
}));
vi.mock('../LocalizedSidebarTrigger', () => ({
  LocalizedSidebarTrigger: () => null,
}));

import { SidebarProvider } from '@object-ui/components';
import { UnifiedSidebar } from '../UnifiedSidebar';

/** Where the metadata-admin engine really serves the datasource list. */
const CANONICAL = '/apps/setup/metadata/datasource';

/**
 * Records every distinct location the router settles on: one entry means the
 * URL matched a real route on arrival, two means it was forwarded once.
 */
function ChainRecorder({ sink }: { sink: string[] }) {
  const location = useLocation();
  const here = `${location.pathname}${location.search}`;
  if (sink[sink.length - 1] !== here) sink.push(here);
  return null;
}

/** Terminal probe: reports which route matched and with which params. */
function Probe({ id }: { id: string }) {
  const params = useParams();
  return <div data-testid={id}>{JSON.stringify(params)}</div>;
}

/**
 * Mirror of `LegacyMetadataRedirect`'s resource arm (`console/AppContent.tsx`).
 * Present so a restored alias literal shows up as a real extra hop rather than
 * as a dead end — see the note in this file's header on what does and does not
 * rest on its fidelity.
 */
function AliasResourceRedirect() {
  const location = useLocation();
  const appBase = location.pathname.replace(/\/component\/metadata\/.*$/, '');
  const type = new URLSearchParams(location.search).get('type') ?? '';
  const tail = location.pathname.match(/\/component\/metadata\/resource(\/.*)?$/)?.[1] ?? '';
  return (
    <Navigate
      to={
        type
          ? `${appBase}/metadata/${encodeURIComponent(type)}${tail}${location.hash}`
          : `${appBase}/metadata${location.hash}`
      }
      replace
    />
  );
}

/** Renders a sidebar, reads the entry's href, then unmounts it. */
function datasourcesHrefFrom(ui: React.ReactElement, at: string): string {
  const view = render(
    <MemoryRouter initialEntries={[at]}>
      <SidebarProvider>{ui}</SidebarProvider>
    </MemoryRouter>,
  );
  const href = screen.getByRole('link', { name: 'Datasources' }).getAttribute('href');
  view.unmount();
  expect(href).toBeTruthy();
  return href as string;
}

/** Drops the emitted URL into a router that knows both spellings. */
function chainFor(url: string): string[] {
  const chain: string[] = [];
  render(
    <MemoryRouter initialEntries={[url]}>
      <ChainRecorder sink={chain} />
      <Routes>
        <Route path="/apps/:appName">
          <Route path="metadata" element={<Probe id="canonical-directory" />} />
          <Route path="metadata/:type" element={<Probe id="canonical-list" />} />
          <Route path="component/metadata/directory" element={<Navigate to="/apps/setup/metadata" replace />} />
          <Route path="component/metadata/resource" element={<AliasResourceRedirect />} />
          <Route path="component/metadata/resource/*" element={<AliasResourceRedirect />} />
        </Route>
        <Route path="*" element={<Probe id="unmatched" />} />
      </Routes>
    </MemoryRouter>,
  );
  return chain;
}

beforeEach(() => {
  localStorage.clear();
});

describe('sidebar sys-datasources reaches the canonical route directly (objectui#3660)', () => {
  it('UnifiedSidebar: the /home Administration cluster arrives with NO redirect', () => {
    const href = datasourcesHrefFrom(<UnifiedSidebar activeAppName="" />, '/home');

    expect(href).toBe(CANONICAL);

    const chain = chainFor(href);

    expect(chain).toEqual([CANONICAL]);
    expect(screen.getByTestId('canonical-list')).toHaveTextContent('"type":"datasource"');
    expect(chain.some((entry) => entry.includes('component/metadata'))).toBe(false);
  });

  it('CONTROL: the alias still resolves, and doing so costs the hop the entries used to pay', () => {
    // The alias is deliberately KEPT (bookmarks, external links), so its
    // continued reachability is part of the contract, not collateral. This also
    // proves the assertions above are not vacuous: the probe table really
    // does forward this spelling, so a sidebar that still emitted it would be
    // measured at two entries rather than silently falling to `unmatched`.
    const chain = chainFor('/apps/setup/component/metadata/resource?type=datasource');

    expect(chain).toEqual(['/apps/setup/component/metadata/resource?type=datasource', CANONICAL]);
    expect(screen.getByTestId('canonical-list')).toHaveTextContent('"type":"datasource"');
  });
});
