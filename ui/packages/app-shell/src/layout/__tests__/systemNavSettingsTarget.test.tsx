// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Sidebar "System Settings" entry — must target `/apps/setup/system`, the host's
 * system landing (objectui#3590).
 *
 * ## The defect, and why both sidebars carried it
 *
 * `AppContent` decides which branch renders by string-matching the pathname:
 * `isSystemRoute = location.pathname.includes('/system')`. Only that flag mounts
 * the host's `extraRoutesNoApp` fragment, where `apps/console/src/AppContent.tsx`
 * declares `<Route path="system" />` (a card-wall hub when this was written; since
 * objectui#3743 a redirect onto the settings hub). A **bare** `/apps/setup`
 * therefore matches no pseudo-route except `isSetupRoute`, falls into the
 * `!activeApp && !isCreateAppRoute && !isSystemRoute && !isMetadataRoute` guard
 * and re-renders the "No Apps Configured" empty state. On a zero-app deployment
 * `/apps/setup` IS that empty state's own URL.
 *
 * Both sidebars pointed their `sys-settings` entry at that bare URL, in clusters
 * whose every OTHER entry already spells `/apps/setup/system/...`:
 *
 * - `AppSidebar.systemFallbackNavigation` rendered ONLY when `activeApp` was
 *   falsy, and `activeApp` there was `matched || activeApps[0]` — falsy exactly
 *   when the deployment had zero active+visible apps. So its head entry was dead
 *   in the one situation the cluster existed for. Its test left this file with
 *   the component (objectui#5817).
 * - `UnifiedSidebar.homeNavigation`'s Administration cluster is the `/home`
 *   admin nav added so a fresh env (no apps yet) still has a real menu —
 *   `resolveLandingPath([])` sends exactly that user to `/home`. Same head entry,
 *   same bare URL.
 *
 * These assert the URL the entry CARRIES, not a navigation: what the URL then
 * resolves to is `AppContent`'s question, and is pinned end-to-end (click →
 * mounted host landing) in `console/__tests__/AppContent.noAppsCta.test.tsx`, and
 * with the console host's real routes in `apps/console`'s
 * `src/__tests__/AppContent.systemHubRoutes.test.tsx`.
 *
 * ## The measurement this file used to carry, and what replaced it (objectui#3609)
 *
 * When #3590 corrected `UnifiedSidebar`'s entry, that entry was not reachable:
 * the home arm hand-rolled `homeNavigation.map(item => <Link to={item.url ||
 * '/home'}>)` with no recursion, so the whole `type: 'group'` cluster collapsed
 * into one row pointing at `/home` and no child reached the DOM. Rather than
 * assert an href that never rendered, #3590 left a MEASUREMENT pin asserting the
 * broken shape — `Administration` carrying `href="/home"`, `System Settings`
 * absent — designed to go red the moment the group rendered its children.
 *
 * #3609 made it red by routing the home arm through the same
 * `NavigationRenderer` the app arm uses. The pin is therefore GONE, not
 * duplicated: it is replaced below by the real assertions it was standing in
 * for, so the repo pins the fix instead of pinning both the bug and the fix.
 *
 * ## The `Datasources` entry (objectui#3660)
 *
 * `ADMINISTRATION_ENTRIES` used to spell that entry
 * `/apps/setup/component/metadata/resource?type=datasource` — a legacy *alias*,
 * not a page, whose route element `<Navigate>`s straight on to
 * `/apps/setup/metadata/datasource`. Both sidebars were re-pointed at that
 * destination, and this file's expectation is REWRITTEN to match (same
 * discipline as above: replace the old shape, do not keep it alongside). The
 * `AppSidebar` test this file carried then gained the matching assertion at the
 * same time; that test left with the component (objectui#5817).
 *
 * ## The `Object Manager` entry (objectui#3739)
 *
 * #3660 re-pointed `sys-datasources` and stopped there; `sys-objects`, the entry
 * declared on the line immediately ABOVE it in both sidebars, kept spelling
 * `/apps/setup/system/metadata/object`. That is a legacy alias too — served by
 * `apps/console`'s `MetadataRedirect`, which `<Navigate>`s onto
 * `/apps/setup/metadata/object` — so the same redundant hop survived on the
 * neighbouring click target. Both literals were re-pointed at the destination,
 * and the expectation here is REWRITTEN rather than kept alongside, exactly as the
 * `Datasources` note above describes.
 *
 * Note what this file does NOT claim: that the URL resolves in one hop. That is
 * a property of the URL, not of the producer, and is measured once per family in
 * `systemNavDatasourcesHop.test.tsx` / `systemNavObjectsHop.test.tsx`. Here the
 * assertion is string equality on the href `UnifiedSidebar` emits — which is the
 * half that can drift, since the component holds its own literal.
 */

import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

// ---------------------------------------------------------------------------
// Mocks — providers and console-only chrome, matching the sibling sidebar
// suites. @object-ui/components and @object-ui/layout stay REAL so the hrefs
// asserted below are the ones the sidebar's own render path actually emits.
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

// The cluster below is an admin surface — UnifiedSidebar's Administration group
// is gated on `useWorkspaceAdminStatus`. Mutable so the gate can be exercised in
// BOTH directions (see the non-admin test): the cluster is built behind an
// `if (isWorkspaceAdmin)` at construction, and reusing NavigationRenderer must
// not have introduced a path that renders it for anyone else.
let isWorkspaceAdmin = true;
vi.mock('@object-ui/auth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAuth: () => ({ user: null, signOut: vi.fn(), isAuthEnabled: false, activeOrganization: null }),
  useWorkspaceAdminStatus: () => ({ isAdmin: isWorkspaceAdmin, isResolved: true }),
  getUserInitials: () => 'U',
}));

vi.mock('@object-ui/permissions', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@object-ui/permissions')>();
  return {
    ...actual,
    usePermissions: () => ({ can: () => true, hasCapabilities: () => true }),
  };
});

/** The zero-app deployment this whole screen exists for. */
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

// Lazy lucide DynamicIcon fires an async `import()` from a `useEffect` and then
// setStates; a null icon keeps each link's accessible name equal to its label
// text and keeps the render synchronous. App-shell's own `getIcon` (which
// `UnifiedSidebar` imports for its area switcher) and `NavigationRenderer`'s
// `getLazyIcon` from `@object-ui/components` (the home arm's renderer) are both
// stubbed, and the components package must otherwise stay REAL because the
// Sidebar primitives come from it.
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
// The `/home` shell — the context whose navigation carries the admin cluster.
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

/** The host's system landing — the reachable target, and what every sibling entry prefixes. */
const SYSTEM_HUB = '/apps/setup/system';

/**
 * `Datasources` names the metadata-admin engine's canonical route
 * (objectui#3660). This entry used to read
 * `/apps/setup/component/metadata/resource?type=datasource` — the legacy alias,
 * whose route element is `LegacyMetadataRedirect`, a bare `<Navigate>` onto the
 * URL below. That old spelling is REPLACED here, not kept alongside: the repo
 * pins the fix, never both the bug and the fix (the #3609 discipline this file
 * already applied once, when the #3590 measurement pin was deleted rather than
 * duplicated). Whether this URL then resolves in one hop is a different
 * question, measured in `systemNavDatasourcesHop.test.tsx`.
 */
const DATASOURCES_TARGET = '/apps/setup/metadata/datasource';

/**
 * `Object Manager` names the same engine's canonical route (objectui#3739). This
 * entry used to read `${SYSTEM_HUB}/metadata/object` — an alias served by
 * `apps/console`'s `MetadataRedirect`, a bare `<Navigate>` onto the URL below.
 * Replaced here rather than kept alongside, for the reason spelled out in this
 * file's header: the repo pins the fix, not both the bug and the fix.
 */
const OBJECTS_TARGET = '/apps/setup/metadata/object';

/**
 * Every entry of the `/home` Administration cluster, in declaration order.
 * Asserted whole rather than by sample: the defect was that the group's
 * children were never visited at all, so "some of them render" is not the
 * property worth pinning — "all nine, at the URLs they declare" is.
 */
const ADMINISTRATION_ENTRIES: ReadonlyArray<readonly [string, string]> = [
  ['System Settings', SYSTEM_HUB],
  ['Applications', `${SYSTEM_HUB}/apps`],
  ['App Marketplace', `${SYSTEM_HUB}/marketplace`],
  ['Object Manager', OBJECTS_TARGET],
  ['Datasources', DATASOURCES_TARGET],
  ['Users', `${SYSTEM_HUB}/users`],
  ['Organizations', `${SYSTEM_HUB}/organizations`],
  ['Roles', `${SYSTEM_HUB}/roles`],
  ['Configuration', `${SYSTEM_HUB}/settings`],
];

function renderHomeSidebar() {
  return render(
    <MemoryRouter initialEntries={['/home']}>
      <SidebarProvider>
        <UnifiedSidebar activeAppName="" />
      </SidebarProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  localStorage.clear();
  isWorkspaceAdmin = true;
});

describe('sidebar system-settings target (objectui#3590)', () => {
  it('UnifiedSidebar: /home renders the Administration cluster as a GROUP, with all nine entries reachable (objectui#3609)', () => {
    // Replaces the #3590 MEASUREMENT pin. Its two halves invert exactly:
    //   before → `Administration` IS a link, href `/home`; children absent.
    //   after  → `Administration` is a disclosure, not a link; children present.
    renderHomeSidebar();

    // The group is a Collapsible trigger now, not a leaf link. The old shape is
    // asserted gone by name, not merely "different href": a group carries no
    // `url` of its own, so any future arm that renders it as a link can only
    // reach the `|| '/home'` fallback and re-create the dead link.
    expect(screen.queryByRole('link', { name: 'Administration' })).not.toBeInTheDocument();
    const trigger = screen.getByRole('button', { name: 'Administration' });
    // Opened by default. This cluster IS the admin's `/home` navigation, so
    // `expanded: true` is stated on it (an undeclared group opens too since
    // objectui#13336). Closed, Radix would unmount `CollapsibleContent` and the
    // entries would be back out of the DOM — a different spelling of the bug.
    expect(trigger).toHaveAttribute('aria-expanded', 'true');

    for (const [label, href] of ADMINISTRATION_ENTRIES) {
      expect(screen.getByRole('link', { name: label })).toHaveAttribute('href', href);
    }

    // The head entry, called out because #3590 is what corrected it: it must
    // not have regressed to the bare setup URL that re-renders the empty state.
    expect(screen.getByRole('link', { name: 'System Settings' })).not.toHaveAttribute(
      'href',
      '/apps/setup',
    );

    // The flat part of the home nav is unchanged — the two ungrouped entries
    // still render, with the same hrefs, above the group.
    expect(screen.getByRole('link', { name: 'Home' })).toHaveAttribute('href', '/home');
    expect(screen.getByRole('link', { name: 'Documentation' })).toHaveAttribute('href', '/docs');
  });

  it('UnifiedSidebar: a non-admin on /home gets none of the Administration cluster', () => {
    // The gate is `if (isWorkspaceAdmin)` where `homeNavigation` is built, so
    // the cluster is absent from the item tree rather than hidden by the
    // renderer. Pinned in the negative direction because the fix above changed
    // WHO renders these items: had the reuse accidentally sourced them from
    // somewhere ungated, only this assertion would notice.
    isWorkspaceAdmin = false;
    renderHomeSidebar();

    expect(screen.queryByRole('button', { name: 'Administration' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Administration' })).not.toBeInTheDocument();
    for (const [label] of ADMINISTRATION_ENTRIES) {
      expect(screen.queryByRole('link', { name: label })).not.toBeInTheDocument();
    }

    // …while the entries every user gets are still there — otherwise this test
    // would pass on a sidebar that rendered nothing at all.
    expect(screen.getByRole('link', { name: 'Home' })).toHaveAttribute('href', '/home');
    expect(screen.getByRole('link', { name: 'Documentation' })).toHaveAttribute('href', '/docs');
  });
});
