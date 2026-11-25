// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `/studio/*` — the ENTRY gate for the Studio builder.
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
  LoadingFallback,
  LoadingScreen,
  STUDIO_ALL_PACKAGES_SEGMENT,
  STUDIO_METADATA_AREA,
  STUDIO_ORG_SCOPE_SEGMENT,
  StudioEntryPermissionsProvider,
  studioMetadataAreaPath,
  studioOrgScopePath,
  studioPackagePath,
  useHomePath,
  usePhoneViewport,
  useRecentItems,
  useStudioEntryPermissions,
} from '@object-ui/app-shell';
import { useObjectTranslation } from '@object-ui/i18n';

import { ProtectedRoute } from './ProtectedRoute';
import { holdsStudioAccess, useStudioEntry } from './studioEntry';

/*
 * The builder screens load WITH THEIR ROUTE, not with the console
 * (objectui#11798). Imported statically, `StudioDesignSurface` (and the modules
 * only it reaches, such as the designers and the form designer) sat in the
 * eager closure of every console page, for every user, on deployments where
 * most principals can never enter Studio. Studio's entry
 * (`StudioEntryRedirect`) and the retired pillar addresses' redirect
 * (`StudioPillarRedirect`) ride in the same chunk.
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
const StudioEntryRedirect = lazy(() =>
  import('./studioBuilder').then((m) => ({ default: m.StudioEntryRedirect })),
);
const StudioPillarRedirect = lazy(() =>
  import('./studioBuilder').then((m) => ({ default: m.StudioPillarRedirect })),
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
 * home is its own button, as there, and it reuses that screen's labels.
 */
function StudioAccessRequired({ home }: { home: string }) {
  const { t } = useObjectTranslation();
  // A phone's Home is its app list; from 768 px up `home` opens an app's start
  // page, so the button says so, as the shell's other way-home buttons do.
  const phone = usePhoneViewport();
  return (
    <div className="flex h-screen items-center justify-center p-4">
      <Empty data-testid="studio-access-required">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-muted">
          <Lock className="h-6 w-6 text-muted-foreground" />
        </div>
        <EmptyTitle>
          {t('console.studio.accessRequired', {
            defaultValue: 'You need Studio access to open Studio. An administrator can grant it with a permission set in Setup → Permission Set Assignment.',
          })}
        </EmptyTitle>
        <div className="mt-4">
          <Button asChild>
            <Link to={home}>
              {phone
                ? t('empty.appAccessDeniedHome', { defaultValue: 'Back to home' })
                : t('layout.appSwitcher.backToHome', { defaultValue: 'Back to app start page' })}
            </Link>
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
   * It was `redirectTo` while a non-holder was redirected there. A non-holder
   * here is refused a capability, and is now told so (objectui#12035);
   * `RequireAiSurface` later took the same posture for a runtime that serves
   * no agent (objectstack#26614).
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

  return (
    // The capability set this gate read, for the Studio screens below it that
    // choose a destination by it: Studio's entry and the package-not-found
    // state's way out (objectstack#36908). Provided only around a holder.
    <StudioEntryPermissionsProvider value={entry.systemPermissions}>{children}</StudioEntryPermissionsProvider>
  );
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
 * Bare `/studio` (objectstack#36908, epic #36890 decision 9): Studio's entry,
 * which draws no page. It opens the package the author was last in, else the
 * package list: Setup → Packages for a principal who may open it, the "All
 * metadata" area across packages otherwise (`StudioEntryRedirect` in
 * app-shell). The package-card home it used to draw was removed; Studio is
 * entered from an app or from Setup → Packages.
 */
function StudioEntry() {
  const systemPermissions = useStudioEntryPermissions();
  return (
    <Suspense fallback={<LoadingFallback />}>
      <StudioEntryRedirect systemPermissions={systemPermissions} pending={<LoadingFallback />} />
    </Suspense>
  );
}

/**
 * A package's builder, which records the visit as a recent `package`
 * entry (objectui#11863), so Studio's entry (bare `/studio`, objectstack#36908)
 * can open the package an author was last in. `useTrackRouteAsRecent` reads `/apps/APP` routes only, and this
 * module owns the `/studio` subtree, so the record is made here, behind the
 * entry gate: a refused principal never mounts this element.
 *
 * The entry is the package's IDENTITY — its id, and `href` its bare route,
 * which lands on its object list — and no label: a reader labels it from the
 * package list it loads (objectui#11678's shape). Keyed on the package, not the
 * page, so moving between pages of one package leaves the list as it is,
 * and the provider writes nothing. The package-less scope (`~org`) and the
 * cross-package leg (`~all`) are not packages and record nothing.
 */
function StudioPackageBuilder({ area }: { area?: typeof STUDIO_METADATA_AREA }) {
  const { packageId } = useParams();
  const { addRecentItem } = useRecentItems();
  useEffect(() => {
    if (!packageId || packageId === STUDIO_ORG_SCOPE_SEGMENT || packageId === STUDIO_ALL_PACKAGES_SEGMENT) return;
    addRecentItem({
      id: `package:${packageId}`,
      type: 'package',
      name: packageId,
      href: studioPackagePath(packageId),
    });
    // Driven by the package alone. `addRecentItem` is a `useCallback` result,
    // whose identity is not a dependency (AGENTS.md #10), as in
    // `useTrackRouteAsRecent`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [packageId]);
  return (
    <Suspense fallback={<LoadingFallback />}>
      <StudioDesignSurface area={area} />
    </Suspense>
  );
}

/**
 * objectstack#36909 — a retired pillar address (the bare package address
 * included) redirects to the page that replaced it in one hop; any other
 * segment renders `children`. The redirect rides in the builder's chunk.
 */
function StudioPillarAddress({ children }: { children?: ReactNode }) {
  return (
    <Suspense fallback={<LoadingFallback />}>
      <StudioPillarRedirect>{children}</StudioPillarRedirect>
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
 *   `/studio`                         Studio's entry: the last package, else the package list
 *   `/studio/~org`                    the package-less scope lands on its flow list
 *   `/studio/~all/*`                  lands on the "All metadata" area across packages
 *   `/studio/:packageId`              a package lands on its object list
 *   `/studio/:packageId/metadata/*`   a package's "All metadata" area, in the builder
 *   `/studio/:packageId/:tab`         a retired pillar redirects; any other segment is
 *                                     the builder (the sharing overview, `owd`, or
 *                                     the not-found state)
 *
 * `~org` is the reserved segment for the organization's own, package-less
 * flows (objectui#11553; `studioScope.ts` in app-shell says why `~` can never
 * name a package). A static segment outranks `:packageId`, so its bare leg
 * needs a route of its own; its other addresses reach `:packageId/:tab` and
 * redirect to its flow list (objectstack#36903).
 *
 * objectstack#28561 — the "All metadata" area (ADR-0146 D1) has routes of its
 * own because its pages nest below it (`StudioMetadataArea` declares them), and
 * `:packageId/:tab` matches one segment: an area URL such as
 * `/studio/crm/metadata/flow` would match no route at all. The static
 * `metadata` segment outranks `:tab`. `~all` is the area's reserved
 * cross-package segment (`metadataArea.ts` in app-shell says why it is not
 * `~org`); every `~all` URL outside the area lands on it, so none reaches the
 * builder as a package id.
 *
 * objectstack#36899 — the cross-package leg (`/studio/~all/metadata/*`) is
 * served by the generic area route: the SAME `StudioDesignSurface`, which
 * reads `~all` as "no package" and draws the area alone, under the left menu
 * every Studio page draws. The more specific `:packageId/metadata/*` outranks
 * `~all/*` for an area URL; every other `~all` URL still lands on the area.
 *
 * objectstack#36909 — no pillar draws a page any more. Each retired pillar
 * address (`data`, `automations`, `access`, `interfaces`, and the bare package
 * address, which used to land on `data`) reaches the page that replaced it in
 * ONE redirect (`StudioPillarRedirect`; its table is `studioPillarRedirect.ts`
 * in app-shell), where it used to pass through the builder and the area's own
 * `?package=` redirect first.
 */
export const studioRoutes = (
  <Route path="/studio" element={<StudioRoute />}>
    <Route index element={<StudioEntry />} />
    <Route path={STUDIO_ORG_SCOPE_SEGMENT} element={<Navigate to={studioOrgScopePath()} replace />} />
    <Route
      path={`${STUDIO_ALL_PACKAGES_SEGMENT}/*`}
      element={<Navigate to={studioMetadataAreaPath(STUDIO_ALL_PACKAGES_SEGMENT)} replace />}
    />
    <Route path=":packageId" element={<StudioPillarAddress />} />
    <Route
      path={`:packageId/${STUDIO_METADATA_AREA}/*`}
      element={<StudioPackageBuilder area={STUDIO_METADATA_AREA} />}
    />
    <Route
      path=":packageId/:tab"
      element={
        <StudioPillarAddress>
          <StudioPackageBuilder />
        </StudioPillarAddress>
      }
    />
  </Route>
);
