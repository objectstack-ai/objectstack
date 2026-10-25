// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The system-navigation entries under `/apps/:app/system/…` reach the
 * framework-owned system objects instead of failing (objectui#3655), and the
 * bare `/apps/:app/system` lands on the navigation-declared settings hub
 * (objectui#3743).
 *
 * ## What was wrong
 *
 * Both sidebars' `sys-*` cluster and the system hub's card wall (retired since,
 * by objectui#3743) emitted five
 * `/apps/setup/system/{users,organizations,roles,positions,permissions}` URLs.
 * They were real routes until `apps/console` was slimmed for third-party
 * customisation (cccdf84d7), which deleted the bespoke wrapper pages on the
 * grounds that "these objects are now contributed by framework plugins … and
 * resolved via the generic /apps/setup/<object_name> route". The producers were
 * never retargeted and nothing redeclared the URLs, so all five fell through to
 * app-shell's tail — where the failure they got depended on how long the word
 * was, because `ShorthandRecordRedirect`'s `looksLikeRecordId` treats any
 * URL-safe segment of 6+ chars as a record id:
 *
 *   users (5), roles (5)                       -> RouteNotFound, "Page not found"
 *   organizations (13), positions (9),         -> rewritten to
 *   permissions (11)                              `…/system/record/<word>` and
 *                                                 rendered as a record of an
 *                                                 object literally named `system`
 *
 * Same cluster, same click, two unrelated failure screens — and the second is
 * the worse one, because a record page for a nonexistent object reads as a
 * backend/data problem rather than a dead link.
 *
 * ## What this file measures
 *
 * It renders app-shell's REAL `AppContent` (`DefaultAppContent`) with this
 * host's REAL `systemRoutes` fragment, so the tail routes under test —
 * `:objectName`, `:objectName/record/:recordId`, `ShorthandRecordRedirect`,
 * `RouteNotFound` — are the shipped ones, not a transcription. That matters
 * here more than usual: the defect IS the interaction between this fragment and
 * that tail, and a hand-copied tail would be free to agree with whatever the
 * fragment does.
 *
 * `ChainRecorder` records every location the router settles on, so "one hop" is
 * an assertion rather than an inference; the pre-fix landings above are
 * reachable by deleting the five `system/*` routes from `systemRoutes` (the
 * `object-view` probes go red and the chain returns to `Page not found` /
 * `…/system/record/<word>`).
 *
 * ## Two branches
 *
 * `AppContent` has two route tables and this host passes the same fragment to
 * both. With an active app the redirect target resolves (`:objectName` renders
 * `ObjectView`); on a zero-app deployment there is no `:objectName` route at
 * all, so the target lands on the "No Apps Configured" empty state — measured
 * and pinned below rather than asserted away, because a deployment with no apps
 * in its metadata also has no `sys_user` to show.
 *
 * ## The `permissions` leg, closed
 *
 * Four of the five landed in PR #3673. `system/permissions` was held back and
 * its broken landing PINNED, because the framework splits this console's
 * "Permissions" into two Setup entries (`sys_capability`, ADR-0066 layer 1 —
 * the definition registry; `sys_permission_set`, layer 2 — the grant container
 * the permissions docs call "the only capability container") and guessing would
 * have bound every click and bookmark to a surface nobody chose. objectui#3655
 * decided it as `sys_permission_set`: the card that emitted this URL said
 * "Manage permission rules and assignments", which is layer 2. Those pins are therefore
 * REPLACED here, not merely kept passing — that was their stated purpose.
 *
 * What the pins measured beyond the gap itself — that an undeclared segment
 * fails in two different ways depending on its LENGTH — is still true and still
 * measured, now on a hypothetical pair that is undeclared in both branches
 * (`system/teams`, 5 chars, and `system/workgroups`, 10). Re-pointing them was
 * the alternative to letting the length asymmetry lose its only coverage the
 * moment its last real specimen got a route.
 *
 * ## The bare `system` landing (objectui#3743)
 *
 * `/apps/:app/system` used to render `SystemHubPage`, a hand-written card wall.
 * objectui#3743 retired it; the host now declares `system` as
 * `SystemLandingRedirect`, which forwards onto `system/settings`, the settings
 * hub that every system navigation declares (the reasoning is on that
 * component). The URL itself is still the target of every "System Settings"
 * sender in app-shell, so its landing is pinned here, once per branch, against
 * the REAL host fragment and the REAL `DefaultAppContent`: that is the property
 * of the URL, measured once, while each sender's href stays pinned beside the
 * sender. The zero-app empty state's button is also driven end to end here,
 * because it is the one sender whose click has to leave a dead end.
 */

import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter, Routes, Route, Navigate, useLocation, useParams } from 'react-router-dom';

// AGENTS.md §测试纪律 — the lazily-imported page modules are stubbed so no
// unbounded `import()` races a bounded assertion window. The paths are
// relative to app-shell's OWN source tree (`@object-ui/app-shell` is aliased to
// `packages/app-shell/src` by `apps/console/vite.config.ts`), which is what
// makes these resolve to the same module ids app-shell imports internally.
vi.mock('../../../../packages/app-shell/src/views/metadata-admin', () => ({
  MetadataDirectoryPage: () => <div data-testid="metadata-directory-page">directory</div>,
  MetadataResourceListPage: () => {
    const { type } = useParams<{ type?: string }>();
    return <div data-testid="metadata-resource-list-page">{type}</div>;
  },
  MetadataResourceEditPage: () => <div data-testid="metadata-resource-edit-page" />,
  MetadataResourceHistoryPage: () => <div data-testid="metadata-resource-history-page" />,
  MetadataDiagnosticsPage: () => <div data-testid="metadata-diagnostics-page" />,
  MetadataResourceRouter: () => <div data-testid="metadata-resource-router" />,
  registerMetadataResource: () => {},
}));

vi.mock('../../../../packages/app-shell/src/console/marketplace/MarketplacePage', () => ({
  MarketplacePage: () => <div data-testid="marketplace-page">marketplace</div>,
}));
vi.mock('../../../../packages/app-shell/src/console/marketplace/MarketplacePackagePage', () => ({
  MarketplacePackagePage: () => <div data-testid="marketplace-package-page" />,
}));

vi.mock('@object-ui/plugin-designer', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@object-ui/plugin-designer')>()),
  CreateAppPage: () => <div data-testid="create-app-page">create app</div>,
  EditAppPage: () => <div data-testid="edit-app-page" />,
  DashboardDesignPage: () => <div data-testid="dashboard-design-page" />,
}));

vi.mock('../../../../packages/app-shell/src/layout/ConsoleLayout', () => ({
  ConsoleLayout: ({ activeAppName, children }: { activeAppName?: string; children?: React.ReactNode }) => (
    <div data-testid="console-layout" data-active-app={activeAppName}>
      {children}
    </div>
  ),
}));
vi.mock('../../../../packages/app-shell/src/chrome/CommandPalette', () => ({ CommandPalette: () => null }));
vi.mock('../../../../packages/app-shell/src/chrome/KeyboardShortcutsDialog', () => ({ KeyboardShortcutsDialog: () => null }));
vi.mock('../../../../packages/app-shell/src/chrome/OnboardingWalkthrough', () => ({ OnboardingWalkthrough: () => null }));

/**
 * The settings hub — the landing the bare `system` route forwards onto
 * (objectui#3743). Stubbed for the same reason as the app-shell pages above: it
 * sits behind `React.lazy`, and its real body fetches the settings registry.
 */
vi.mock('../pages/settings/SettingsHub', () => ({
  SettingsHub: () => <div data-testid="settings-hub-page">settings hub</div>,
}));

/**
 * One of the retired Developer Hub's destinations (objectui#10520), stubbed
 * for the same reason: it sits behind `React.lazy`, and its real body fetches
 * the object list.
 */
vi.mock('../pages/developer/IntegrationsPage', () => ({
  IntegrationsPage: () => <div data-testid="integrations-page">integrations</div>,
}));

/** Echoes `:objectName` — this is the probe the whole fix is measured against. */
vi.mock('../../../../packages/app-shell/src/views/ObjectView', () => ({
  ObjectView: () => {
    const { objectName } = useParams<{ objectName?: string }>();
    return <div data-testid="object-view">{objectName}</div>;
  },
}));

/** Echoes every param, so "a record page for the object `system`" is a fact. */
vi.mock('../../../../packages/app-shell/src/views/RecordDetailView', () => ({
  RecordDetailView: () => {
    const params = useParams();
    return <div data-testid="record-detail-view">{JSON.stringify(params)}</div>;
  },
}));

vi.mock('@object-ui/i18n', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useObjectTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => String(options?.defaultValue ?? key),
  }),
  useObjectLabel: () => ({
    objectLabel: ({ label }: { label?: string }) => label,
  }),
}));

// A workspace admin: the zero-app branch below is measured through the "no apps
// configured" empty state, which since objectui#4473 renders for admins only —
// any other viewer is bounced to `/home` with the shell chrome rather than left
// on that chrome-less screen (pinned in
// `packages/app-shell/src/console/__tests__/AppContent.inaccessibleAppStrand.test.tsx`).
// The legacy `/system/*` redirect targets this file measures are unchanged.
vi.mock('@object-ui/auth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAuth: () => ({
    user: null,
    getAuthConfig: async () => ({ features: {} }),
    activeOrganization: null,
  }),
  useWorkspaceAdminStatus: () => ({ isAdmin: true, isResolved: true }),
}));

const dataSourceStub = {
  onConnectionStateChange: () => () => {},
  getConnectionState: () => 'connected',
};
vi.mock('../../../../packages/app-shell/src/providers/AdapterProvider', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAdapter: () => dataSourceStub,
}));

/**
 * `setup` is a real app in any framework deployment (it ships in
 * `@objectstack/platform-objects`), which is why the with-app branch is the one
 * a user normally reaches these URLs in.
 */
const APPS = [{ name: 'setup', label: 'Setup', isDefault: true, navigation: [] }];
let metadataApps: unknown[] = APPS;
vi.mock('../../../../packages/app-shell/src/providers/MetadataProvider', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useMetadata: () => ({
    apps: metadataApps,
    objects: [],
    loading: false,
    ensureType: undefined,
    error: null,
    refresh: vi.fn(async () => {}),
  }),
}));

import { DefaultAppContent } from '@object-ui/app-shell';
import { systemRoutes } from '../AppContent';

/**
 * Records every distinct location the router settles on. `<Navigate replace>`
 * re-renders once per hop, so a one-hop rewrite shows up as exactly two
 * entries.
 */
const chain: string[] = [];
function ChainRecorder() {
  const location = useLocation();
  // The query string rides along: the Setup catalog's scope is a query
  // parameter (objectui#7611), and every other landing here carries none.
  const here = location.pathname + location.search;
  if (chain[chain.length - 1] !== here) chain.push(here);
  return null;
}

function renderConsoleAt(initialUrl: string) {
  return render(
    <MemoryRouter initialEntries={[initialUrl]}>
      <ChainRecorder />
      <Routes>
        <Route
          path="/apps/:appName/*"
          element={<DefaultAppContent extraRoutes={systemRoutes} extraRoutesNoApp={systemRoutes} />}
        />
        <Route path="/" element={<div data-testid="root-landing">landing</div>} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  metadataApps = APPS;
  chain.length = 0;
});

describe('system-hub entries reach the framework system objects (objectui#3655)', () => {
  /**
   * The two that still name an OBJECT. The other three name the security
   * catalog and are measured in the next describe (objectui#7611).
   */
  it.each([
    ['/apps/setup/system/users', '/apps/setup/sys_user', 'sys_user'],
    ['/apps/setup/system/organizations', '/apps/setup/sys_organization', 'sys_organization'],
  ])('%s reaches %s in ONE hop', async (url, target, objectName) => {
    renderConsoleAt(url);

    expect(await screen.findByTestId('object-view')).toHaveTextContent(objectName);
    // Two entries = a single `<Navigate>`. Before the fix `users` never left
    // its own URL (it rendered `RouteNotFound` in place) and `organizations` /
    // `positions` moved to `…/system/record/<word>` instead.
    expect(chain).toEqual([url, target]);
    expect(screen.queryByTestId('record-detail-view')).not.toBeInTheDocument();
    expect(screen.queryByText('Page not found')).not.toBeInTheDocument();
  });

  it('preserves the app prefix rather than stripping to the root', () => {
    // `prefix` is cut with a regex off `location.pathname`; every case above
    // uses the same two-segment prefix, so a mistake there is invisible in them.
    renderConsoleAt('/apps/my-app/system/users');

    expect(chain).toEqual(['/apps/my-app/system/users', '/apps/my-app/sys_user']);
  });

  it('an app segment spelled `system` survives the rewrite', () => {
    // The regex is end-anchored precisely so the LAST `/system/<seg>` is the
    // one removed. An unanchored cut would leave `/apps` here.
    renderConsoleAt('/apps/system/system/users');

    expect(chain).toEqual(['/apps/system/system/users', '/apps/system/sys_user']);
  });

  /**
   * MEASUREMENT — the length-dependent split this issue is really about, kept
   * alive now that its last real specimen has a route. `permissions` used to
   * stand here: 11 chars, judged a record id, rewritten to
   * `…/system/record/permissions` and rendered as a record of an object
   * literally named `system`. That pin was written to be REPLACED once the
   * mapping was decided (objectui#3655 → `sys_permission_set`), and the one-hop
   * case above is its replacement.
   *
   * The asymmetry itself outlives it, so it is re-pinned on a hypothetical pair
   * that is undeclared in both route tables: `workgroups` (10 chars) here and
   * `teams` (5) below — the same concept spelled two lengths, producing two
   * unrelated failure screens. Nothing here asks for `looksLikeRecordId` to
   * change; that is a separate question. The point is that the next reader
   * still finds it measured against the shipped routes rather than described.
   */
  it('MEASUREMENT: an undeclared LONG system segment lands on a record of the object `system`', async () => {
    renderConsoleAt('/apps/setup/system/workgroups');

    const probe = await screen.findByTestId('record-detail-view');
    expect(probe).toHaveTextContent('"objectName":"system"');
    expect(probe).toHaveTextContent('"recordId":"workgroups"');
    expect(chain).toEqual([
      '/apps/setup/system/workgroups',
      '/apps/setup/system/record/workgroups',
    ]);
  });

  /** MEASUREMENT — the short half of the pair described just above. */
  it('MEASUREMENT: an undeclared SHORT system segment still reaches Page not found', async () => {
    renderConsoleAt('/apps/setup/system/teams');

    expect(await screen.findByText('Page not found')).toBeInTheDocument();
    expect(chain).toEqual(['/apps/setup/system/teams']);
  });
});

describe('the catalog entries reach the Setup catalog (objectui#7611)', () => {
  /**
   * `roles`, `positions` and `permissions` name the security CATALOG, which
   * ADR-0131 D3 moves into the environment registry, so they land on the
   * metadata-admin list of the registry type in its environment scope. `roles`
   * and `positions` still converge on ONE surface (ADR-0090 D3 renamed
   * `sys_role` -> `sys_position`), and `permissions` still means the
   * permission-set surface (objectui#3655 decision A).
   */
  it.each([
    ['/apps/setup/system/roles', '/apps/setup/metadata/position?scope=environment', 'position'],
    ['/apps/setup/system/positions', '/apps/setup/metadata/position?scope=environment', 'position'],
    ['/apps/setup/system/permissions', '/apps/setup/metadata/permission?scope=environment', 'permission'],
  ])('%s reaches %s in ONE hop', async (url, target, type) => {
    renderConsoleAt(url);

    expect(await screen.findByTestId('metadata-resource-list-page')).toHaveTextContent(type);
    expect(chain).toEqual([url, target]);
    // Never the row page the URL used to land on.
    expect(screen.queryByTestId('object-view')).not.toBeInTheDocument();
  });

  it('preserves the app prefix', () => {
    renderConsoleAt('/apps/my-app/system/permissions');

    expect(chain).toEqual([
      '/apps/my-app/system/permissions',
      '/apps/my-app/metadata/permission?scope=environment',
    ]);
  });

  /**
   * The zero-app branch declares the metadata routes too, so the catalog is
   * reachable on a deployment with no app — unlike the object pages the three
   * URLs used to land on, which end at the "No Apps Configured" guard there.
   */
  it.each([
    ['/apps/setup/system/positions', '/apps/setup/metadata/position?scope=environment'],
    ['/apps/setup/system/permissions', '/apps/setup/metadata/permission?scope=environment'],
  ])('with no apps, %s still reaches the catalog', async (url, target) => {
    metadataApps = [];
    renderConsoleAt(url);

    expect(await screen.findByTestId('metadata-resource-list-page')).toBeInTheDocument();
    expect(chain).toEqual([url, target]);
  });
});

describe('zero-app branch — measured, not asserted away (objectui#3655)', () => {
  /**
   * On a zero-app deployment this is the branch the sidebar's Users /
   * Organizations / Roles entries are clicked into: `UnifiedSidebar`'s `/home`
   * Administration cluster carries all three, and `/apps/setup` has no active
   * app there. (The since-removed `AppSidebar` rendered its own `sys-*` cluster
   * ONLY in that state; objectui#5817.) `AppContent`'s no-active-app route
   * table declares no `:objectName` route, so the redirect target leaves the
   * pseudo-route family
   * (`isSystemRoute` keys on a `system` path segment) and falls into the "No
   * Apps Configured" guard.
   *
   * That is the honest end state, not a regression hidden by a stub: a
   * deployment whose metadata carries zero apps also carries no `sys_user` to
   * render. What changes is only WHICH dead end is reached — previously all
   * five landed on `RouteNotFound` here, because `ShorthandRecordRedirect` is
   * not declared in this branch either (i.e. the length-dependent split above
   * does NOT exist on a zero-app deployment).
   */
  it.each([
    ['/apps/setup/system/users', '/apps/setup/sys_user'],
    ['/apps/setup/system/organizations', '/apps/setup/sys_organization'],
  ])('%s still redirects, and the target is the no-apps empty state', async (url, target) => {
    metadataApps = [];
    renderConsoleAt(url);

    expect(await screen.findByTestId('create-first-app-btn')).toBeInTheDocument();
    expect(chain).toEqual([url, target]);
    expect(screen.queryByTestId('object-view')).not.toBeInTheDocument();
  });

  /**
   * MEASUREMENT — same re-pointing as the with-app half. This case used to run
   * on `system/permissions`, which is now declared and so redirects here too
   * (the row added above). Its subject was never that URL, though: it is that
   * on a zero-app deployment even a LONG undeclared word reaches
   * `RouteNotFound` and never a record page, because `ShorthandRecordRedirect`
   * is not declared in this branch at all — i.e. the length split measured in
   * the with-app describe does not exist here. `workgroups` (10 chars) keeps
   * that fact pinned on a segment that is still undeclared.
   */
  it('MEASUREMENT: with no apps, an undeclared system URL reaches Page not found, never a record page', async () => {
    metadataApps = [];
    renderConsoleAt('/apps/setup/system/workgroups');

    expect(await screen.findByText('Page not found')).toBeInTheDocument();
    expect(screen.queryByTestId('record-detail-view')).not.toBeInTheDocument();
    expect(chain).toEqual(['/apps/setup/system/workgroups']);
  });
});

describe('the bare system landing forwards onto the settings hub (objectui#3743)', () => {
  /**
   * With an active app: the branch a framework deployment reaches, because the
   * Setup app ships in `@objectstack/platform-objects`. One hop, and the page
   * that renders is the settings hub, inside the app's own shell.
   */
  it('with an active app, /apps/setup/system reaches system/settings in ONE hop', async () => {
    renderConsoleAt('/apps/setup/system');

    expect(await screen.findByTestId('settings-hub-page')).toBeInTheDocument();
    expect(chain).toEqual(['/apps/setup/system', '/apps/setup/system/settings']);
    expect(screen.getByTestId('console-layout')).toHaveAttribute('data-active-app', 'setup');
    expect(screen.queryByText('Page not found')).not.toBeInTheDocument();
  });

  it('keeps the app prefix it was entered under', async () => {
    // The target is resolved against the route's own match, not built from a
    // hard-coded `/apps/setup`, so an app-scoped entry stays app-scoped.
    renderConsoleAt('/apps/my-app/system');

    expect(await screen.findByTestId('settings-hub-page')).toBeInTheDocument();
    expect(chain).toEqual(['/apps/my-app/system', '/apps/my-app/system/settings']);
  });

  it('with zero apps, /apps/setup/system still reaches system/settings in ONE hop', async () => {
    // The branch the "No Apps Configured" empty state lives in. Landing on the
    // app root here instead would be `/apps/setup`, i.e. that empty state
    // again: the loop objectui#3590 closed.
    metadataApps = [];
    renderConsoleAt('/apps/setup/system');

    expect(await screen.findByTestId('settings-hub-page')).toBeInTheDocument();
    expect(chain).toEqual(['/apps/setup/system', '/apps/setup/system/settings']);
    expect(screen.queryByTestId('create-first-app-btn')).not.toBeInTheDocument();
    expect(screen.queryByText('Page not found')).not.toBeInTheDocument();
  });

  it('the zero-app empty state\'s "System Settings" button lands on the settings hub, not back on itself', async () => {
    // End to end with the real host fragment: the button targets
    // `/apps/setup/system` (pinned app-side in `AppContent.noAppsCta.test.tsx`),
    // and the host forwards that onto its settings hub.
    metadataApps = [];
    renderConsoleAt('/apps/setup');
    fireEvent.click(await screen.findByTestId('go-to-settings-btn'));

    expect(await screen.findByTestId('settings-hub-page')).toBeInTheDocument();
    expect(chain).toEqual(['/apps/setup', '/apps/setup/system', '/apps/setup/system/settings']);
    expect(screen.queryByTestId('create-first-app-btn')).not.toBeInTheDocument();
  });
});

describe('the retired Developer Hub URL (objectui#10520)', () => {
  /**
   * `/apps/:app/developer` rendered `DeveloperHubPage`, a card wall of four
   * links whose only in-app link was a card on the System Hub. objectui#10520
   * retired it once all four destinations were `developer:*` registry keys, and
   * deliberately added no redirect in its place: the URL was never blank
   * without it. With the host's `developer` route gone, the segment falls
   * through to app-shell's generic `:objectName` route, i.e. the URL now means
   * what `/apps/:app/<name>` means everywhere else. The `ObjectView` probe
   * above echoes the name it was handed; the real `ObjectView` answers a name
   * that is not an object with its own "object not found" empty state.
   *
   * Put the `developer` route (and its page) back and this pin goes red: the
   * hub renders, and the `ObjectView` probe never does.
   */
  it('with an active app, a /developer bookmark lands on the generic object route in place, never a blank screen', async () => {
    renderConsoleAt('/apps/setup/developer');

    expect(await screen.findByTestId('object-view')).toHaveTextContent('developer');
    expect(chain).toEqual(['/apps/setup/developer']);
    expect(screen.getByTestId('console-layout')).toHaveAttribute('data-active-app', 'setup');
    expect(screen.queryByText('Page not found')).not.toBeInTheDocument();
  });

  it('MEASUREMENT: with zero apps, the bookmark reaches the no-apps empty state, as it did before the retirement', async () => {
    // Not a consequence of this change: `isSystemRoute` keys on a `system`
    // segment, so on a zero-app deployment `/developer` never reached the host
    // fragment, and the hub route was unreachable there all along.
    metadataApps = [];
    renderConsoleAt('/apps/setup/developer');

    expect(await screen.findByTestId('create-first-app-btn')).toBeInTheDocument();
    expect(chain).toEqual(['/apps/setup/developer']);
  });

  it('the sub-page routes it linked to still resolve (bookmarks and deep links carry them)', async () => {
    // One of the four, driven end to end: the rest share the same fragment and
    // the same shape. It must NOT fall through to the object route the bare
    // segment now reaches.
    renderConsoleAt('/apps/setup/developer/integrations');

    expect(await screen.findByTestId('integrations-page')).toBeInTheDocument();
    expect(screen.queryByTestId('object-view')).not.toBeInTheDocument();
    expect(screen.queryByTestId('record-detail-view')).not.toBeInTheDocument();
  });
});
