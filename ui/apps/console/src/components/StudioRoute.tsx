// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `/studio/*` — the ENTRY gate for the Studio pillar builder.
 *
 * The policy, and why its fail direction is inverted from every other capability
 * gate in this app, live in `./studioEntry`. This file is only the mapping from
 * verdict to element, and the place the gate is MOUNTED.
 *
 * ## Mounted once, above the whole subtree — on purpose
 *
 * `App.tsx` declares the Studio routes as CHILDREN of this element rather than
 * gating each leaf, so:
 *
 *  - the permission answer is fetched once per Studio session, not once per
 *    route, and client-side transitions inside Studio keep the gate mounted;
 *  - a route added under `/studio` later cannot forget to gate itself. That is
 *    the property worth having: the previous shape had every `/studio` leaf
 *    carrying its own (auth-only) wrapper, which is exactly how an entry gate
 *    drifts leaf by leaf.
 *
 * Ordering is `ProtectedRoute` → gate: an unauthenticated visitor gets this
 * host's ONE auth-redirect contract (`/login?redirect=%2Fstudio…`, built by
 * `LoginRedirect` from the ROUTER's location), not a capability bounce — and the
 * permissions endpoint has a session to answer about by the time it is called.
 *
 * ## ⛔ The server is NOT the seam
 *
 * `createConsoleStaticPlugin` is a static-file plugin: it has no per-route
 * knowledge (one `/_console/*` catch-all, one `index.html`), it sees only HARD
 * navigations — so a server 404 would close the deep link and leave client-side
 * route transitions wide open — and it has no session, so it could only
 * blanket-block the path for EVERY principal, including the platform operators
 * Studio exists for. The gate belongs here, in this app's router.
 */

import { lazy, Suspense, useEffect, type ReactNode } from 'react';
import { Link, Navigate, Outlet, Route, useParams } from 'react-router-dom';
import { Lock } from 'lucide-react';
import { Button, Empty, EmptyTitle } from '@object-ui/components';
import {
  AppHeader,
  CommandPalette,
  CommandPaletteProvider,
  LoadingFallback,
  LoadingScreen,
  STUDIO_ORG_SCOPE_PILLAR,
  STUDIO_ORG_SCOPE_SEGMENT,
  useHomePath,
  useRecentItems,
} from '@object-ui/app-shell';
import { useObjectTranslation } from '@object-ui/i18n';

import { ProtectedRoute } from './ProtectedRoute';
import { holdsStudioAccess, useStudioEntry } from './studioEntry';

/*
 * The two builder screens load WITH THEIR ROUTE, not with the console
 * (objectui#11798). Imported statically, `StudioDesignSurface` and
 * `BuilderLanding` (and the modules only they reach, such as the pillar panels
 * and the form designer) sat in the eager closure of every console page, for
 * every user, on deployments where most principals can never enter Studio.
 *
 * Only the builder is deferred. The gate above it (`StudioRoute` →
 * `RequireStudioAccess`) stays in this eager module on purpose: it decides
 * BEFORE the builder's chunk is even requested, so a non-holder never downloads
 * the builder, and the pending / failed / denied states render exactly as they
 * did. `./studioBuilder` says why the specifier is a console-local module and
 * not the `@object-ui/app-shell` barrel.
 */
const StudioDesignSurface = lazy(() =>
  import('./studioBuilder').then((m) => ({ default: m.StudioDesignSurface })),
);
const BuilderLanding = lazy(() =>
  import('./studioBuilder').then((m) => ({ default: m.BuilderLanding })),
);

/**
 * What a principal without `studio.access` sees, at the Studio URL they opened
 * (objectui#12035): one sentence saying Studio access is needed, and the way
 * home.
 *
 * The gate used to redirect home with no word of why, so a missing capability
 * read exactly like a broken link. This is the console's existing refusal
 * screen, the shape `AppContent` renders for an app the session may not open
 * (`empty.appAccessDenied`): said in place, as the permanent decision it is, so
 * no Retry; and the URL stays, so the caller can send it to an administrator
 * and reload once access is granted. No header frames this screen, so the way
 * home is its own button, as there, and it reuses that screen's label.
 */
function StudioAccessRequired({ home }: { home: string }) {
  const { t } = useObjectTranslation();
  return (
    <div className="flex h-screen items-center justify-center p-4">
      <Empty data-testid="studio-access-required">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-muted">
          <Lock className="h-6 w-6 text-muted-foreground" />
        </div>
        <EmptyTitle>
          {t('console.studio.accessRequired', {
            defaultValue: 'You need Studio access to open Studio.',
          })}
        </EmptyTitle>
        <div className="mt-4">
          <Button asChild>
            <Link to={home}>{t('empty.appAccessDeniedHome', { defaultValue: 'Back to home' })}</Link>
          </Button>
        </div>
      </Empty>
    </div>
  );
}

/**
 * Renders `children` only for a principal whose LOADED capability set contains
 * `studio.access`; every other state renders something that is not the builder.
 *
 * Exported separately from {@link StudioRoute} so the decision can be exercised
 * against a real router without the auth/shell stack in the way.
 */
export function RequireStudioAccess({
  children,
  homeTo,
}: {
  children: ReactNode;
  /**
   * Where the refusal's way home leads. Home, not a dead end. Defaults to the
   * DECLARED landing (objectui#7373), which is the environment launcher
   * wherever no app declares one; an explicit value still wins.
   *
   * It was `redirectTo` while a non-holder was redirected there, the posture of
   * `RequireAiSurface`, which still redirects: a runtime that serves no agent
   * has nothing to refuse, and what reaches it is a stale link. A non-holder
   * here is refused a capability, and is now told so (objectui#12035).
   */
  homeTo?: string;
}) {
  const homePath = useHomePath();
  const entry = useStudioEntry();

  // Loading window. The builder must not mount for a single frame while the
  // answer is in flight — "not yet loaded" is not permission.
  if (entry.status === 'pending') return <LoadingFallback />;

  // Fetch failed outright (non-transient status, or the retries exhausted).
  // The console's error splash carries a Retry, so this is recoverable for a
  // genuine operator; what it never does is fall through to the builder.
  if (entry.status === 'failed') {
    return <LoadingScreen error={entry.error.message} onRetry={entry.retry} />;
  }

  // Refused: the builder is never mounted, so its chunk is never requested.
  if (!holdsStudioAccess(entry.systemPermissions)) {
    return <StudioAccessRequired home={homeTo ?? homePath} />;
  }

  return <>{children}</>;
}

/** Route element for the `/studio` subtree: auth, then entry capability, then children. */
export function StudioRoute() {
  return (
    <ProtectedRoute>
      <RequireStudioAccess>
        <Outlet />
      </RequireStudioAccess>
    </ProtectedRoute>
  );
}

/**
 * What a Studio builder screen shows INSIDE an already-painted frame while its
 * chunk loads (objectui#11798): the `/studio` landing under its console header,
 * and the `studio:builder` registry entry inside the app shell. One line of the
 * shared `common.loading` text, as `registerAccountComponents` shows for its own
 * lazy page. The full-screen pillar builder has no frame of its own, so it
 * falls back to `LoadingFallback`, the splash the gate's pending state already
 * shows, and the two waits read as one. `role="status"` lets assistive
 * technology announce the wait, and it is what the tests find the line by.
 */
export function StudioBuilderLoading() {
  const { t } = useObjectTranslation();
  return (
    <div role="status" className="p-6 text-sm text-muted-foreground">
      {t('common.loading', { defaultValue: 'Loading…' })}
    </div>
  );
}

/**
 * The `/studio` front door: pick or create a writable package, or open the
 * organization's package-less flows.
 *
 * Its header is the console's own (objectui#11863): `AppHeader`'s `studio`
 * variant, as `/home` mounts the `home` one, with the same account menu, inbox
 * and help, and the brand, then a fixed Studio crumb. The brand links to
 * `useHomePath()`, so the landing is never a navigation dead end, and it names
 * the same home as `StudioDesignSurface`'s Home button one route apart
 * (objectui#7256, objectui#7373).
 *
 * The frame mounts the command palette in its `studio` scope (objectui#11863):
 * no app is active here, so it lists the Studio's packages, objects and flows
 * instead of an app's entries. Under its `CommandPaletteProvider` the header
 * draws the search trigger, as it does wherever a palette is mounted
 * (objectui#11912), and `⌘K` opens it.
 */
function StudioLanding() {
  return (
    <CommandPaletteProvider>
      <div className="flex min-h-screen flex-col bg-background text-foreground">
        {/* The console top bar, 48 px like every console frame's
            (objectui#12639): `@object-ui/app-shell` spells the class as
            `CONSOLE_TOP_BAR`, and its `consoleTopBar.height-12639` test holds
            this copy equal to it. */}
        <header className="sticky top-0 z-30 flex h-12 w-full shrink-0 items-center gap-2 border-b bg-background px-2 sm:px-4">
          <AppHeader variant="studio" />
        </header>
        <CommandPalette scope="studio" />
        <div className="min-h-0 flex-1 overflow-auto">
          {/* The frame above stays painted while the landing's chunk loads. */}
          <Suspense fallback={<StudioBuilderLoading />}>
            <BuilderLanding />
          </Suspense>
        </div>
      </div>
    </CommandPaletteProvider>
  );
}

/**
 * A package's pillar builder, which records the visit as a recent `package`
 * entry (objectui#11863), so the landing can list the packages an author was
 * last in. `useTrackRouteAsRecent` reads `/apps/APP` routes only, and this
 * module owns the `/studio` subtree, so the record is made here, behind the
 * entry gate: a refused principal never mounts this element.
 *
 * The entry is the package's IDENTITY — its id, and `href` its bare route,
 * which lands on the Data pillar — and no label: the landing labels it from the
 * package list it loads (objectui#11678's shape). Keyed on the package, not the
 * pillar, so moving between pillars of one package leaves the list as it is,
 * and the provider writes nothing. The package-less scope (`~org`) is not a
 * package and records nothing.
 */
function StudioPackageBuilder() {
  const { packageId } = useParams();
  const { addRecentItem } = useRecentItems();
  useEffect(() => {
    if (!packageId || packageId === STUDIO_ORG_SCOPE_SEGMENT) return;
    addRecentItem({
      id: `package:${packageId}`,
      type: 'package',
      name: packageId,
      href: `/studio/${encodeURIComponent(packageId)}`,
    });
    // Driven by the package alone. `addRecentItem` is a `useCallback` result,
    // whose identity is not a dependency (AGENTS.md #10), as in
    // `useTrackRouteAsRecent`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [packageId]);
  return (
    <Suspense fallback={<LoadingFallback />}>
      <StudioDesignSurface />
    </Suspense>
  );
}

/**
 * The whole `/studio` subtree (ADR-0080/0084), as ONE element `App.tsx` drops
 * into its `<Routes>` — the same shape `AppContent`'s `systemRoutes` uses.
 *
 * Declared here rather than in `App.tsx` so the gate and the routes it guards
 * cannot be separated by an edit to either one, and so a test can drive the
 * REAL tree instead of a transcription of it — a transcription would be free to
 * agree with itself while `App.tsx` quietly mounted the builder ungated.
 *
 *   `/studio`                    front door (pick / create a writable package)
 *   `/studio/~org`               the package-less scope lands on its one pillar
 *   `/studio/:packageId`         a package lands on its Data pillar
 *   `/studio/:packageId/:tab`    the pillar builder (a recent-package visit)
 *
 * `~org` is the reserved segment for the organization's own, package-less
 * flows (objectui#11553; `studioScope.ts` in app-shell says why `~` can never
 * name a package). Its pillar URL is served by the generic `:packageId/:tab`
 * route — the SAME `StudioDesignSurface`, which reads the segment as "no
 * package" — so only its bare leg needs a route of its own: a static segment
 * outranks `:packageId`, and the generic leg would send it to a Data pillar the
 * scope does not have.
 */
export const studioRoutes = (
  <Route path="/studio" element={<StudioRoute />}>
    <Route index element={<StudioLanding />} />
    <Route
      path={STUDIO_ORG_SCOPE_SEGMENT}
      element={<Navigate to={STUDIO_ORG_SCOPE_PILLAR} replace />}
    />
    <Route path=":packageId" element={<Navigate to="data" replace />} />
    <Route path=":packageId/:tab" element={<StudioPackageBuilder />} />
  </Route>
);
