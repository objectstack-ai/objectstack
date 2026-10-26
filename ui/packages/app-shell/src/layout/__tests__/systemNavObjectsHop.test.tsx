// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The `sys-objects` entry `UnifiedSidebar` carries arrives at the canonical
 * metadata-admin route with ZERO redirects (objectui#3739).
 *
 * ## What was wrong
 *
 * `AppSidebar.systemFallbackNavigation` and `UnifiedSidebar.homeNavigation` each
 * held their own literal for this entry, and both spelled it
 * `/apps/setup/system/metadata/object`. That is not a page: `apps/console`'s host
 * fragment declares `system/metadata/:metadataType` with `MetadataRedirect` as
 * its element, which immediately `<Navigate>`s onto
 * `/apps/setup/metadata/object`. Every click therefore paid a redundant hop plus
 * a re-render to reach a URL the nav item could name itself. (`AppSidebar` and
 * its copy were removed later, by objectui#5817.)
 *
 * This is the same defect objectui#3660 fixed for `sys-datasources` — declared on
 * the line immediately BELOW this entry in both arrays — and it was missed there,
 * because the two entries reach their aliases through different route tables:
 * `sys-datasources` went through app-shell's own `component/metadata/resource`
 * alias, `sys-objects` through the host's `system/metadata/:type` rewrite. Same
 * cost, different producer of the hop, so the grep that found one did not find
 * the other. The third producer of this URL, `console/home/QuickActions`, is
 * pinned in `console/home/__tests__/QuickActions.settingsTarget.test.tsx`.
 *
 * ## What this file measures, and how it differs from the sibling pins
 *
 * `systemNavSettingsTarget.test.tsx` asserts the URL each entry CARRIES — a
 * string equality on an `href`. This file asks the next question: what that URL
 * costs to resolve. `ChainRecorder` records every distinct location the router
 * settles on, so a direct arrival is a one-entry chain and an alias arrival is
 * two. Endpoint-only assertions cannot tell those apart — both finish at
 * `/apps/setup/metadata/object`, which is exactly why the detour survived #3660
 * and #3611 (the latter even pinned the alias spelling as its consistency
 * anchor). `systemNavDatasourcesHop.test.tsx` is this file's twin for the entry
 * one line below; the two are kept separate because the alias route being
 * mirrored, and the file it is transcribed from, differ.
 *
 * The href is READ OUT of a real `UnifiedSidebar` render rather than typed in
 * here, so the producer under test is the component's own literal.
 *
 * ## The alias mirror below, and what rests on its fidelity
 *
 * `AliasMetadataRedirect` mirrors `MetadataRedirect` from
 * `apps/console/src/AppContent.tsx` — transcribed, not imported, because
 * `apps/console` is a different Vitest project (the same reason, and the same
 * transcription, as `console/__tests__/AppContent.noAppComponentRoutes.test.tsx`
 * and `AppContent.pseudoRouteSegments.test.tsx`; keep the regex and the target
 * construction identical to the original).
 *
 * Nothing this file ASSERTS depends on that mirror being faithful: the green
 * expectation is `chain` equals `[canonical URL]`, which holds iff the sidebar's
 * URL matches a canonical route directly. The mirror only shapes what the FAILURE
 * looks like — with it, restoring the old literal produces a two-entry chain whose
 * first entry is the alias, i.e. the extra hop printed literally in the diff
 * rather than merely implied. The real host route's own behaviour is pinned
 * against the real route table in `apps/console`'s
 * `__tests__/AppContent.legacyRedirects.test.tsx`, and end-to-end through
 * app-shell's route tree in `console/__tests__/AppContent.noAppComponentRoutes.test.tsx`.
 *
 * ## Scope
 *
 * Where the sidebar AIMS. The alias routes are untouched and stay reachable for
 * bookmarks and external links; nothing here asks for their removal, and the
 * CONTROL case below pins that they still work.
 */

import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route, Navigate, useLocation, useParams } from 'react-router-dom';

// ---------------------------------------------------------------------------
// Mocks — providers and console-only chrome, matching the sibling sidebar
// suites (`systemNavDatasourcesHop.test.tsx`, `systemNavSettingsTarget.test.tsx`).
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

/** Where the metadata-admin engine really serves the object list. */
const CANONICAL = '/apps/setup/metadata/object';

/** The legacy spelling both entries used to carry — an alias, not a page. */
const ALIAS = '/apps/setup/system/metadata/object';

/**
 * Records every distinct location the router settles on: one entry means the URL
 * matched a real route on arrival, two means it was forwarded once.
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
 * Mirror of `MetadataRedirect` from `apps/console/src/AppContent.tsx` — the
 * `system/metadata/*` legs of its `systemRoutes` fragment. Present so a restored
 * alias literal shows up as a real extra hop rather than as a dead end; see this
 * file's header on what does and does not rest on its fidelity.
 */
function AliasMetadataRedirect() {
  const { metadataType, itemName } = useParams<{ metadataType?: string; itemName?: string }>();
  const location = useLocation();
  const prefix = location.pathname.replace(/\/(system\/)?metadata(\/.*)?$/, '');
  const base = `${prefix}/metadata`;
  const target = !metadataType
    ? base
    : itemName
      ? `${base}/${encodeURIComponent(metadataType)}/${itemName}`
      : `${base}/${encodeURIComponent(metadataType)}`;
  return <Navigate to={target} replace />;
}

/** Renders a sidebar, reads the entry's href, then unmounts it. */
function objectsHrefFrom(ui: React.ReactElement, at: string): string {
  const view = render(
    <MemoryRouter initialEntries={[at]}>
      <SidebarProvider>{ui}</SidebarProvider>
    </MemoryRouter>,
  );
  const href = screen.getByRole('link', { name: 'Object Manager' }).getAttribute('href');
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
          <Route path="system/metadata" element={<AliasMetadataRedirect />} />
          <Route path="system/metadata/:metadataType" element={<AliasMetadataRedirect />} />
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

describe('sidebar sys-objects reaches the canonical route directly (objectui#3739)', () => {
  it('UnifiedSidebar: the /home Administration cluster arrives with NO redirect', () => {
    const href = objectsHrefFrom(<UnifiedSidebar activeAppName="" />, '/home');

    expect(href).toBe(CANONICAL);

    const chain = chainFor(href);

    expect(chain).toEqual([CANONICAL]);
    expect(screen.getByTestId('canonical-list')).toHaveTextContent('"type":"object"');
    expect(chain.some((entry) => entry.includes('system/metadata'))).toBe(false);
  });

  it('CONTROL: the alias still resolves, and doing so costs the hop the entries used to pay', () => {
    // The alias is deliberately KEPT (bookmarks, external links), so its
    // continued reachability is part of the contract, not collateral. This also
    // proves the assertions above are not vacuous: the probe table really
    // does forward this spelling, so a sidebar that still emitted it would be
    // measured at two entries rather than silently falling to `unmatched`.
    const chain = chainFor(ALIAS);

    expect(chain).toEqual([ALIAS, CANONICAL]);
    expect(screen.getByTestId('canonical-list')).toHaveTextContent('"type":"object"');
  });
});
