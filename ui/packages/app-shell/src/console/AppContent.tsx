/**
 * AppContent — inner SPA rendered under /apps/:appName/*.
 *
 * Owns the per-app shell: ConsoleLayout, CommandPalette, KeyboardShortcutsDialog,
 * route table for object/dashboard/report/page views, and the global ModalForm
 * used by ObjectView edit actions. The outer routing skeleton (BrowserRouter,
 * AuthGuard, AdapterProvider, MetadataProvider, theme/toaster, /home, /login,
 * /organizations) is provided by `createConsole` from @object-ui/app-shell.
 */

import { Routes, Route, Navigate, matchRoutes, useNavigate, useLocation, useParams, useSearchParams } from 'react-router-dom';
import { useState, useEffect, useCallback, useRef, lazy, Suspense, useMemo, createElement, type ComponentType, type ReactNode } from 'react';
import { useAssistant } from '../assistant/assistantBus.js';
import { ModalForm } from '@object-ui/plugin-form';
import { Empty, EmptyTitle, EmptyDescription, Button } from '@object-ui/components';
import { toast } from 'sonner';
import { useActionRunner, useGlobalUndo, useMutationInvalidationBridge, notifyDataChanged, FilterScopeProvider } from '@object-ui/react';
import { useObjectTranslation, useObjectLabel } from '@object-ui/i18n';
import type { AppAccessVerdict, ConnectionState } from '@object-ui/data-objectstack';
import { useAuth, useWorkspaceAdminStatus } from '@object-ui/auth';
import { useMetadata } from '../providers/MetadataProvider.js';
import { useAdapter } from '../providers/AdapterProvider.js';
import { usePreviewDrafts } from '../preview/PreviewModeContext.js';
import { PreviewDraftEmptyState } from '../preview/PreviewDraftEmptyState.js';
import {
  ExpressionProvider,
  createExpressionEvaluator,
  isObjectFieldVisible,
  useExpressionPermissions,
  useExpressionSystemPermissions,
} from '../providers/ExpressionProvider.js';
import { buildExpressionUser } from '../providers/expressionUser.js';
import { useTrackRouteAsRecent } from '../hooks/useTrackRouteAsRecent.js';
import { useHomePath } from '../hooks/useHomePath.js';
import { useSignedInUserLocale } from '../hooks/useUserLocale.js';
import { resolveRecordFormTarget, resolveRecordFormModalLayout, resolveNavigateCreateUrl, resolveNavigateEditUrl, resolvePostCreateTarget, recordFormCreateValues, readRecordFormCreateValues, RECORD_FORM_CREATE_VALUES_STATE } from '../utils/recordFormNavigation.js';
import { deriveRecordSurface, deriveRecordFlowSurface } from '@object-ui/plugin-view';
import { RECORD_FORM_PARAM, RECORD_FORM_OBJECT_PARAM, RECORD_FORM_LINK_PARAM } from '../urlParams.js';
import { appRouteSegment, matchAppBySegment } from '../utils/appRoute.js';
import { resolveHref, type NavTemplateContext } from '@object-ui/layout';
import type { NavigationItem } from '@object-ui/types';

// Components (eagerly loaded — always needed)
import { ConsoleLayout } from '../layout/ConsoleLayout.js';
import { CommandPalette } from '../chrome/CommandPalette.js';
import { ErrorBoundary } from '../chrome/ErrorBoundary.js';
import { LoadingScreen } from '../chrome/LoadingScreen.js';
import { RedirectWithSplash } from '../chrome/RedirectWithSplash.js';
import { ObjectView } from '../views/ObjectView.js';
// objectui#13052 — on its own line: the line above is the eager-walk control
// `scripts/__tests__/vite-declared-lazy-views.test.ts` reads verbatim.
import { ObjectNotFoundState } from '../views/ObjectView.js';
import { KeyboardShortcutsDialog } from '../chrome/KeyboardShortcutsDialog.js';
import { OnboardingWalkthrough } from '../chrome/OnboardingWalkthrough.js';
import { RouteFader } from '../chrome/RouteFader.js';
import { NavigationSyncEffect } from '../hooks/useNavigationSync.js';
import { AppNoAccessEmptyState } from './AppNoAccessEmptyState.js';
import { appNamesOnlyUnreadableObjects, appServesNoNavigation } from './appServesNoNavigation.js';
import {
  useNavMemberGates,
  navEntriesShownToMember,
  navEntriesShownOncePendingReadsShow,
} from '../hooks/useNavMemberGates.js';
import { resolveSetupAppPath } from './ConsoleShell.js';
import { APP_ROUTE_METADATA_READS, collectRoutePaths, metadataReadsForAppRoute, type LazyMetadataType } from './appRouteMetadataReads.js';
import { readAppObjectScope } from './appObjectScope.js';
import { preferLocal } from '../utils/preferLocal.js';
import { SkeletonDashboard, SkeletonDetail, SkeletonGrid } from '../skeletons/index.js';

// Route-based code splitting — lazy-load less-frequently-used routes.
//
// objectui#12980 — every route element below is a `preloadableLazy`: its chunk
// import starts as soon as `AppContent` knows the route (`preloadAppRouteChunk`,
// in parallel with the route's metadata reads), not when the route element
// first renders. A plain `React.lazy` element first renders when the console
// chrome commits, so it suspends there even with the chunk cached, and its
// fallback is the boot splash: react-dom then holds that fallback for its
// reveal throttle (`FALLBACK_THROTTLE_MS`, 300 ms in react-dom 19.2) after the
// route's data was already in, about 0.28 s of splash on every console open,
// measured. A route element whose chunk has resolved by its first render
// renders the component itself and never suspends; one still in flight falls
// back to the lazy wrapper and its Suspense fallback, as before.
type RouteElementModule<P> = { default: ComponentType<P> };

interface PreloadableRouteElement<P> {
  (props: P): ReactNode;
  /** Starts the chunk import (once); a failed import may be started again. */
  preload: () => Promise<RouteElementModule<P>>;
}

function preloadableLazy<P extends object>(load: () => Promise<ComponentType<P>>): PreloadableRouteElement<P> {
  let resolved: ComponentType<P> | null = null;
  let pending: Promise<RouteElementModule<P>> | null = null;
  const preload = () => {
    if (!pending) {
      pending = load().then(
        (component) => {
          resolved = component;
          return { default: component };
        },
        (err: unknown) => {
          pending = null;
          throw err;
        },
      );
    }
    return pending;
  };
  const Lazy = lazy(preload);
  function RouteElement(props: P): ReactNode {
    // Chosen once per mount: switching an instance from the lazy wrapper to
    // the component would remount the route's whole subtree.
    const [Component] = useState<ComponentType<P>>(() => resolved ?? Lazy);
    return createElement(Component, props);
  }
  return Object.assign(RouteElement, { preload });
}

// Spelled `routeChunk.lazy(() => import('…'))` at every declaration below:
// `scripts/vite-declared-lazy-views.ts` reads AppContent's lazy route views by
// that text, and these are still exactly that (a dynamic import per view).
const routeChunk = { lazy: preloadableLazy };

const RecordDetailView = routeChunk.lazy(() => import('../views/RecordDetailView.js').then(m => m.RecordDetailView));
const DashboardView = routeChunk.lazy(() => import('../views/DashboardView.js').then(m => m.DashboardView));
const PageView = routeChunk.lazy(() => import('../views/PageView.js').then(m => m.PageView));
const ReportView = routeChunk.lazy(() => import('../views/ReportView.js').then(m => m.ReportView));
const AppReportIndexView = routeChunk.lazy(() => import('../views/AppReportIndexView.js').then(m => m.AppReportIndexView));
const SearchResultsPage = routeChunk.lazy(() => import('../views/SearchResultsPage.js').then(m => m.SearchResultsPage));
const RecordFormPage = routeChunk.lazy(() => import('../views/RecordFormPage.js').then(m => m.RecordFormPage));
const ComponentNavView = routeChunk.lazy(() => import('../views/ComponentNavView.js').then(m => m.ComponentNavView));
const ObjectDataPage = routeChunk.lazy(() => import('../views/ObjectDataPage.js').then(m => m.ObjectDataPage));

// Metadata admin — mounted under /apps/:app/metadata. Lives at the top
// level so URLs read like a normal nested resource (RFC-style) instead of
// piggy-backing on the legacy ComponentRegistry fan-out.
const MetadataDirectoryPage = routeChunk.lazy(() => import('../views/metadata-admin/index.js').then(m => m.MetadataDirectoryPage));
const MetadataResourceListPage = routeChunk.lazy(() => import('../views/metadata-admin/index.js').then(m => m.MetadataResourceListPage));
const MetadataResourceEditPage = routeChunk.lazy(() => import('../views/metadata-admin/index.js').then(m => m.MetadataResourceEditPage));
const MetadataResourceHistoryPage = routeChunk.lazy(() => import('../views/metadata-admin/index.js').then(m => m.MetadataResourceHistoryPage));
const MetadataDiagnosticsPage = routeChunk.lazy(() => import('../views/metadata-admin/index.js').then(m => m.MetadataDiagnosticsPage));

// App authoring + dashboard editor pages — sourced from
// @object-ui/plugin-designer so third-party hosts can opt out by not
// registering these routes.
const CreateAppPage = routeChunk.lazy(() => import('@object-ui/plugin-designer').then(m => m.CreateAppPage));
const EditAppPage = routeChunk.lazy(() => import('@object-ui/plugin-designer').then(m => m.EditAppPage));
const DashboardDesignPage = routeChunk.lazy(() => import('@object-ui/plugin-designer').then(m => m.DashboardDesignPage));

// Marketplace pages — first-class platform feature; mounted at `system/marketplace`
// under any active app so admins can browse + install from inside the runtime.
const MarketplacePage = routeChunk.lazy(() => import('./marketplace/MarketplacePage.js').then(m => m.MarketplacePage));
const MarketplacePackagePage = routeChunk.lazy(() => import('./marketplace/MarketplacePackagePage.js').then(m => m.MarketplacePackagePage));

/**
 * objectui#12980 — the lazy element each `AppContent` route path renders
 * (paths relative to `/apps/:appName`, as `appRouteMetadataReads.ts` spells
 * them). A path not listed renders an eagerly bundled element.
 */
const APP_ROUTE_CHUNKS: ReadonlyArray<{ path: string; chunk: { preload: () => Promise<unknown> } }> = [
  { path: 'metadata', chunk: MetadataDirectoryPage },
  { path: 'metadata/_diagnostics', chunk: MetadataDiagnosticsPage },
  { path: 'metadata/:type', chunk: MetadataResourceListPage },
  { path: 'metadata/:type/new', chunk: MetadataResourceEditPage },
  { path: 'metadata/:type/:name', chunk: MetadataResourceEditPage },
  { path: 'metadata/:type/:name/history', chunk: MetadataResourceHistoryPage },
  { path: ':objectName/new', chunk: RecordFormPage },
  { path: ':objectName/data', chunk: ObjectDataPage },
  { path: ':objectName/record/:recordId', chunk: RecordDetailView },
  { path: ':objectName/record/:recordId/edit', chunk: RecordFormPage },
  { path: ':objectName/record/:recordId/page/:pageName', chunk: RecordDetailView },
  { path: 'dashboard/:dashboardName', chunk: DashboardView },
  { path: 'report/:reportName', chunk: ReportView },
  { path: 'reports', chunk: AppReportIndexView },
  { path: 'page/:pageName', chunk: PageView },
  { path: 'component/:ns/:name/*', chunk: ComponentNavView },
  { path: 'design/dashboard/:dashboardName', chunk: DashboardDesignPage },
  { path: 'search', chunk: SearchResultsPage },
  { path: 'create-app', chunk: CreateAppPage },
  { path: 'edit-app/:editAppName', chunk: EditAppPage },
  { path: 'system/marketplace', chunk: MarketplacePage },
  { path: 'system/marketplace/:packageId', chunk: MarketplacePackagePage },
];

/**
 * Starts the chunk import of the lazy element the route at `subPath` renders.
 * Matched the way `<Routes>` ranks paths, beside every eagerly rendered path
 * `AppContent` and the host declare, so a path that resolves to an eager
 * element (or to a host route) starts nothing.
 */
function preloadAppRouteChunk(subPath: string, hostPaths: readonly string[] = []): void {
  const routes = [
    ...APP_ROUTE_METADATA_READS.map(({ path }) => ({
      path,
      chunk: APP_ROUTE_CHUNKS.find((row) => row.path === path)?.chunk,
    })),
    ...hostPaths.map((path) => ({ path, chunk: undefined })),
  ];
  const matches = matchRoutes(routes, `/${subPath.replace(/^\/+/, '')}`);
  const chunk = matches?.[matches.length - 1].route.chunk;
  // A failed import rejects here as well as in the route's own render; the
  // render's error boundary is the one that reports it.
  if (chunk) void chunk.preload().catch(() => {});
}

interface AppContentProps {
  /**
   * Extra <Route> elements appended to the inner /apps/:appName/* router.
   * Hosts can use this to mount console-specific routes (e.g. /system, legacy
   * metadata editor) without forking AppContent.
   */
  extraRoutes?: ReactNode;
  /**
   * Extra <Route> elements rendered when there is no active app but the URL
   * matches a special path (create-app, system). Mirrors `extraRoutes` for
   * the no-app branch.
   */
  extraRoutesNoApp?: ReactNode;
}

/**
 * Bridges the global chat's "Review N change(s)" affordance (ADR-0033 Phase B)
 * to the metadata designer. The chat publishes a review target on `assistantBus`;
 * this navigator — which lives inside the app router and knows the app base —
 * routes to `/apps/:appName/metadata/:type/:name?review=1`, where the designer
 * reloads the pending draft and opens its review/diff.
 */
function DraftReviewNavigator({ appName }: { appName: string | undefined }) {
  const { reviewSeq, reviewTarget } = useAssistant();
  const navigate = useNavigate();
  const lastSeq = useRef(reviewSeq);
  useEffect(() => {
    if (reviewSeq === lastSeq.current || !reviewTarget || !appName) return;
    lastSeq.current = reviewSeq;
    const { type, name } = reviewTarget;
    navigate(
      `/apps/${appName}/metadata/${encodeURIComponent(type)}/${encodeURIComponent(name)}?review=1`,
    );
  }, [reviewSeq, reviewTarget, appName, navigate]);
  return null;
}

/**
 * The predicate-evaluation identity `ExpressionProvider` binds as
 * `current_user` / `ctx.user` / `os.user`.
 *
 * MOVED to `../providers/expressionUser.js` in objectui#6515 and re-exported
 * here so the published name is unchanged. It moved because `AppContent`
 * `lazy()`-loads `views/RecordFormPage.tsx`, which mounts an
 * `ExpressionProvider` of its own: importing the normaliser from THIS module
 * would put a static edge from that split chunk back into the module it was
 * split out of — the edge `scripts/check-eager-closure-budget.mjs` weighs — so
 * the view hand-rolled a narrower descriptor instead, and the `id` /
 * `isPlatformAdmin` it dropped made every predicate naming them FAULT and fail
 * OPEN. The new home is a leaf module beside the provider it feeds, which every
 * mount site can import without dragging a chunk along.
 *
 * This re-export is the back-compat half of that move; the doc comment that
 * explains the SHAPE lives with the function.
 */
export { buildExpressionUser };

/**
 * The console URL that renders a record on a NAMED record page
 * (objectui#12715): `/apps/APP/OBJECT/record/ID/page/PAGE`.
 *
 * The record route `:objectName/record/:recordId` shows a record on the page
 * its object's page assignment picks (the object's default record page). This
 * sibling names the page in the path instead, so a document that is not the
 * default (a print page, a delivery note) renders for the same record at a URL
 * a browser can load. It is a path segment, the way the record route already
 * spells its `/edit` sub-route, never a query: an optional query would let a
 * stray parameter change which document the default route draws, and `page` is
 * a page-scoped list parameter elsewhere. `RecordDetailView` renders the named
 * page only when it is a record page of OBJECT, and shows a not-found state for
 * any other name; it never falls back to the default page. The server's print
 * service binds to this spelling, so it is exported for the route test to pin.
 */
export const RECORD_NAMED_PAGE_ROUTE = ':objectName/record/:recordId/page/:pageName';

export function AppContent({ extraRoutes, extraRoutesNoApp }: AppContentProps = {}) {
  const [connectionState, setConnectionState] = useState<ConnectionState>('disconnected');
  const { user, getAuthConfig, activeOrganization } = useAuth();
  // objectui#4473 — read at the top (hooks are unconditional); consumed by the
  // no-app guard far below, where the comment explains what it decides.
  const { isAdmin: isWorkspaceAdmin, isResolved: isWorkspaceAdminResolved } = useWorkspaceAdminStatus();
  const dataSource = useAdapter();

  // Deployment-level feature flags from `/api/v1/auth/config`. Used by
  // CEL predicates on metadata actions (e.g. `sys_organization`'s
  // create button is hidden when `multiOrgEnabled === false`). We keep
  // it empty until the fetch resolves so predicates default to "visible"
  // and we don't briefly hide UI on slow networks.
  const [features, setFeatures] = useState<Record<string, any>>({});
  useEffect(() => {
    let cancelled = false;
    getAuthConfig()
      .then((cfg) => {
        if (cancelled) return;
        setFeatures((cfg?.features as Record<string, any>) ?? {});
      })
      .catch(() => {
        /* leave empty — predicates default to visible */
      });
    return () => {
      cancelled = true;
    };
  }, [getAuthConfig]);

  const navigate = useNavigate();
  const location = useLocation();
  const { appName } = useParams();
  // ⛔ `objects` is not destructured here: reading it loads the whole registry
  // (objectui#12811). It is read below only on a route that needs all of it.
  const metadata = useMetadata();
  const { apps, loading: metadataLoading, ensureType, getTypeStatus, error: metadataError, refresh: refreshMetadata, readObjectScope } = metadata;
  // objectui#7373 — where this file's two "you cannot be here" exits land. Both
  // sit BELOW the readiness gate further down (`metadataLoading` &c), so the
  // list they resolve against has settled; an app list that failed to load is
  // `[]`, which resolves to the launcher — the unchanged status quo, never a
  // worse answer than the literal it replaced.
  const homePath = useHomePath();
  const previewDrafts = usePreviewDrafts();
  const { t } = useObjectTranslation();
  const { objectLabel, objectPluralLabel } = useObjectLabel();


  // Hidden apps (`App.hidden`) are excluded from app-listing surfaces
  // (sidebar switcher, home grid, app switcher). The active app for the
  // current route is still looked up across ALL apps so /apps/account
  // resolves correctly; only the fallback (no appName → first app)
  // skips hidden apps to avoid landing the user on a personal-settings
  // app by default.
  //
  // ⛔ `hidden` only — never `_unpublished` (objectstack#6955 / objectstack-ai/objectstack#4829 A1). The
  // publish gate is enforced server-side; duplicating it here would strand a
  // builder on their own unpublished app.
  const activeApps = apps.filter((a: any) => a.active !== false);
  const launcherApps = activeApps.filter((a: any) => a.hidden !== true);
  // ADR-0048 (A) — the route segment is the package id; resolve by it,
  // falling back to the app name (legacy/alias URL).
  // Built-in pseudo-routes under /apps/* that are NOT metadata apps (create-app,
  // system/*, metadata/*, setup). They must keep working — and may fall back to
  // a default app — regardless of whether the segment resolves to an app.
  // #3638 — `system` / `metadata` are matched as whole path SEGMENTS, not as
  // substrings. `pathname.includes('/system')` was also true for any segment
  // that merely STARTS with `system` (`system_log`, `system_setting`,
  // `systems`), and likewise for `metadata` (`metadata_import`, …). That made
  // `isSpecialRoute` true for an ordinary `/apps/:app/:objectName` URL whose
  // object name happened to start that way — which suppressed
  // `requestedAppMissing` below and let a MISTYPED app name silently render a
  // DIFFERENT app (the exact failure the comment on the fallback describes).
  // Every real pseudo-route spells them as full segments — `system/marketplace`,
  // `system/metadata/:type`, `metadata/:type`, `component/metadata/resource` —
  // so the segment test keeps all of them true (pinned in
  // `__tests__/AppContent.pseudoRouteSegments.test.tsx`).
  const pathSegments = location.pathname.split('/');
  const isCreateAppRoute = location.pathname.endsWith('/create-app');
  const isSystemRoute = pathSegments.includes('system');
  const isMetadataRoute = pathSegments.includes('metadata');
  const isSetupRoute =
    location.pathname === '/apps/setup' || location.pathname.startsWith('/apps/setup/');
  const isSpecialRoute = isCreateAppRoute || isSystemRoute || isMetadataRoute || isSetupRoute;

  const matchedApp = matchAppBySegment(apps, appName);
  const activeApp =
    matchedApp ||
    // Fall back to a default/first app only when NO specific app was requested
    // (bare /apps, the default redirect) OR for a built-in pseudo-route above.
    // A normal unmatched appName must NOT silently render a DIFFERENT app — the
    // readiness guard below shows loading / not-available instead. (Fixes "the
    // preview / nav renders the WRONG app right after building a new one".)
    ((!appName || isSpecialRoute)
      ? (launcherApps.find((a: any) => a.isDefault === true) || launcherApps[0])
      : undefined);

  // ADR-0048 (A) — the segment every `/apps/…` path this component builds is
  // keyed on: the URL's own (`appName` — the package id, or the name alias the
  // user followed), else the resolved app's route segment. Never `activeApp.name`
  // raw: on a package-id route that is a second address for the same app, and
  // the recent-items tracker below matches it against the URL (objectui#11818).
  const appSegment = appName ?? appRouteSegment(activeApp);

  // objectui#12809 — the lazy metadata buckets the CURRENT route reads at
  // render (`appRouteMetadataReads.ts` declares them per route). This used to
  // be a preload of all four (`object`, `dashboard`, `report`, `page`) that held
  // the splash on every route; now the splash holds only for the current
  // route's, and a later navigation onto a route whose buckets have not landed
  // shows a skeleton in the route slot (below) instead of an empty list or a
  // "not found". The record-form overlay (`?form=`) edits a record of an object,
  // so it reads `object` on any route.
  const hostRoutePaths = useMemo(
    () => [...collectRoutePaths(extraRoutes), ...collectRoutePaths(extraRoutesNoApp)],
    [extraRoutes, extraRoutesNoApp],
  );
  const appSubPath = location.pathname.split('/').filter(Boolean).slice(2).join('/');
  const routeReads = metadataReadsForAppRoute(appSubPath, hostRoutePaths);
  // objectui#12980 — the route's element chunk loads beside its metadata reads,
  // so it is in hand when the splash gate below passes (see `preloadableLazy`).
  useEffect(() => {
    preloadAppRouteChunk(appSubPath, hostRoutePaths);
  }, [appSubPath, hostRoutePaths]);

  // objectui#12811 — which objects this route and the chrome around it read:
  // the app's object scope on the routes `appObjectScope.ts` names, inside an
  // app whose served item carries its package; the whole registry everywhere
  // else, as before (that module says why). A page route reads the objects
  // its page binds (objectui#12980), resolved as `PageView` resolves the page,
  // and a record route those of its declared record page (objectui#13046).
  const {
    candidate: scopeCandidate,
    scope: objectScope,
    ready: objectScopeReady,
    failedNames: routeObjectReadsFailed,
    routeObjectRefusal,
  } = readAppObjectScope(
    readObjectScope,
    activeApp,
    appSubPath,
    location.search,
    hostRoutePaths,
    (pageName) => {
      const status = getTypeStatus?.('page');
      return {
        page: preferLocal(metadata.pages as any[], pageName, (activeApp as any)?._packageId),
        settled: status === undefined || status === 'ready' || status === 'error',
      };
    },
    // objectui#13046 — a record route reads the objects its declared record
    // page binds, picked from the page list as `RecordDetailView` picks it.
    () => {
      const status = getTypeStatus?.('page');
      return {
        pages: Array.isArray(metadata.pages) ? (metadata.pages as unknown[]) : [],
        settled: status === undefined || status === 'ready' || status === 'error',
      };
    },
  );
  // Until the app list has loaded, a scope candidate does not know its package
  // yet, and reads nothing (the splash is up).
  const readsWholeRegistry = !scopeCandidate || (!metadataLoading && !objectScope);
  const allObjects: any[] = objectScope
    ? objectScope.objects
    : readsWholeRegistry ? metadata.objects : NO_OBJECTS;
  const routeReadsKey = [
    ...routeReads.filter((type) => type !== 'object' || readsWholeRegistry),
    ...(searchParamsHasRecordForm(location.search) && !routeReads.includes('object') ? ['object'] : []),
  ].join(',');
  const bucketsSettled = useLazyMetadataSettled(routeReadsKey, ensureType, getTypeStatus);
  const routeReadsSettled = bucketsSettled && (!objectScope || objectScopeReady);
  // Set once the first frame past the splash has rendered. After it, a route
  // waiting on its buckets draws its skeleton inside the console chrome rather
  // than taking the whole console back to the splash.
  const firstPaintDone = useRef(false);

  // A normal app was requested but isn't present in the loaded metadata — the
  // post-publish readiness lag, or a genuinely-missing app. Applies in BOTH
  // preview and published mode (preview already guarded this; published used to
  // fall through to the wrong-app fallback above — the bug). Pseudo-routes are
  // excluded so they keep their default-app fallback.
  const requestedAppMissing = !!appName && !matchedApp && !isSpecialRoute;

  // objectui#12706 — the pseudo-routes above skip `requestedAppMissing`, so
  // until this the access verdict was never asked for them: a session the Setup
  // app refuses (no `setup.access`; the server leaves Setup out of its list)
  // opened `/apps/setup` and got the DEFAULT app's landing under that app's
  // chrome, and `/apps/setup/metadata/...` drew Setup's item pages (the
  // permission-set and position editors) the same way.
  //
  // Two of them now wait on the verdict for the app the URL names (the same
  // probe as `requestedAppMissing` below) and draw the access-denied screen on
  // `denied`: the metadata-admin routes (`metadata/...`, with the legacy
  // spellings that redirect onto them) and Setup's root, the app's own landing.
  // Every other verdict keeps the pseudo-route rendering above, so an app that
  // does not exist, a server that does not answer and an adapter without the
  // probe change nothing.
  //
  // ⛔ Not the rest of the Setup subtree. `/system/*` links forward onto
  // `/apps/setup/system/*` (`SystemRedirect`, `ConsoleShell.tsx`), the server's
  // approval links (`/system/approvals?request=`) among them, and that inbox
  // opens records at `/apps/setup/OBJECT/record/ID` (`ApprovalsInboxPage`'s
  // `recordHref`). A member reaches both under the Setup segment, so whether
  // they wait on Setup's verdict is a product decision, left open on
  // objectui#12706.
  const isSetupRootRoute = location.pathname === '/apps/setup' || location.pathname === '/apps/setup/';
  const appSurfaceAwaitsVerdict = !!appName && !matchedApp && (isMetadataRoute || isSetupRootRoute);

  // Post-publish readiness: when a requested app isn't in the loaded metadata,
  // re-check ONCE (the registry can lag a beat behind a publish) before
  // concluding it's absent — so a just-built app resolves on its own instead
  // of flashing "not available", while we still never render a foreign app.
  //
  // objectui#4522 — the run is stored WITH the app it ran for and read back
  // only for that app. Held loose from a name, it was a flag for "a re-check
  // HAS run", reset on exactly one condition: `requestedAppMissing` going
  // false. Two missing apps in a row never satisfy that — `requestedAppMissing`
  // is true before the transition and true after it — so the state rode across
  // as 'done' and the SECOND app got no re-check at all. An app reached second
  // in one mount (launcher, then a typo'd URL, then the real freshly-published
  // app; or two attempts while a build lands) was shown "not available" with no
  // refresh behind it. Same keying as `accessProbe` below, deliberately: one
  // pattern in this file, not two.
  const [missingRecheckRun, setMissingRecheckRun] =
    useState<{ app: string; phase: 'checking' | 'done' } | null>(null);
  const missingRecheck: 'idle' | 'checking' | 'done' =
    missingRecheckRun && missingRecheckRun.app === appName ? missingRecheckRun.phase : 'idle';
  useEffect(() => {
    if (!requestedAppMissing) {
      // ⛔ The `if` is load-bearing — do not "simplify" it into an
      // unconditional `setMissingRecheckRun(null)` (or the functional form
      // `run => run === null ? run : null`, which reads as if React's bailout
      // covers it). `refreshMetadata` is a dep of this effect and its identity
      // comes from the HOST's metadata context: the shipped `MetadataProvider`
      // memoizes it, but a host — or a test — that hands back a fresh function
      // each render makes this effect run after every render. With no state
      // update in the body that is a no-op; with one, it is an infinite render
      // loop, and the surface it starves is the LAZY route inside
      // `ConsoleLayout`, which then never mounts. Measured while landing
      // objectui#4522: 4250 un-acted updates in one second and a permanently
      // empty content area on `/apps/setup/system/record/workgroups`, pinned
      // now by `apps/console/src/__tests__/AppContent.systemHubRoutes.test.tsx`
      // and by the resolved-app case in this state's own test file.
      if (missingRecheckRun !== null) setMissingRecheckRun(null);
      return;
    }
    if (missingRecheck === 'idle' && !metadataLoading && !previewDrafts && appName) {
      const rechecked = appName;
      setMissingRecheckRun({ app: rechecked, phase: 'checking' });
      // Settled BY NAME rather than by the `cancelled` flag the probe below
      // uses: this effect re-runs on its own state change, so a cleanup-based
      // cancel would fire on the way out of 'checking' and strand the check
      // there forever. A refresh landing late for a previous app leaves the
      // current app's run untouched.
      Promise.resolve(refreshMetadata()).finally(() =>
        setMissingRecheckRun(run => (run?.app === rechecked ? { app: rechecked, phase: 'done' } : run)),
      );
    }
  }, [requestedAppMissing, metadataLoading, previewDrafts, missingRecheck, missingRecheckRun, appName, refreshMetadata]);

  // objectui#4252 — WHY the app is missing, once the re-check above has settled
  // and it still is. The list this reads is the generic metadata list route
  // `GET /api/v1/meta/:type`, requested with the SINGULAR type segment `app`
  // (`MetadataProvider` → `client.meta.getItems('app')`), and the server filters
  // it per session (`filterAppForUser`, `packages/rest/src/rest-server.ts`), so
  // a withheld app and a nonexistent one are byte-identical in the list: both
  // absent. Everything this component can read
  // from the list has therefore already been read, and the remaining question
  // has to be asked of the BY-NAME route, which answers it explicitly since
  // objectstack#8013 (403 `PERMISSION_DENIED` for exists-but-unauthorized; 404
  // for every kind of absence). The maintainer ruling put the answer there
  // rather than as a flag in the list, so nothing below re-reads the list.
  //
  // Every verdict here is a MEASURED one, and the screen says only what was
  // measured — never what it guesses. objectui#4252 applied that rule to
  // `denied`; objectui#9262 applied the same rule to the rest of this screen's
  // population, which was seven further causes wearing one sentence about
  // publishing. `not_found` and `unreachable` are separate answers the
  // transport had always given and the probe used to fold into one `unknown`
  // (see `AppAccessVerdict`), so the branches below un-fold a collapse rather
  // than ask anything new — the enumeration surface the 2026-08-12 ruling
  // guarded is untouched, and the control plane still answers the same way for
  // every app the caller may not see.
  //
  // `unknown` now means only "nothing was asked": a host injected a DataSource
  // that cannot answer this (AGENTS #1). Guessing a cause for it would be the
  // same defect mirrored, so it keeps the screen that asserts nothing.
  // The verdict is stored WITH the app it describes, and read back only for
  // that app. Two missing apps in a row keep `requestedAppMissing` true the
  // whole way across, so nothing in this branch is reset by the transition — a
  // verdict held loose from its name would ride into the next URL and answer
  // for an app it never probed, telling a user their typo is a permission
  // problem. (`missingRecheck` above had the same shape and the same defect —
  // costing one skipped refresh rather than a wrong screen, which is why it was
  // filed separately; objectui#4522 keyed it the same way.)
  const [accessProbe, setAccessProbe] = useState<{ app: string; verdict: AppAccessVerdict } | null>(null);
  // A missing app is asked once its re-check has settled; an app surface under
  // a pseudo-route (objectui#12706, above) once the list has loaded, since a
  // list still loading has matched nothing yet.
  const verdictWanted =
    (requestedAppMissing && missingRecheck === 'done') || (appSurfaceAwaitsVerdict && !metadataLoading);
  useEffect(() => {
    if (!verdictWanted || previewDrafts || !appName) {
      // Cleared on the way out too, so the Retry button below (which returns
      // `missingRecheck` to 'idle') re-asks instead of replaying an answer.
      setAccessProbe(p => (p === null ? p : null));
      return;
    }
    if (accessProbe?.app === appName) return;
    const probe = dataSource?.probeAppAccess;
    if (typeof probe !== 'function') {
      // AGENTS #1 — the console is protocol-agnostic: a host may inject a
      // DataSource that cannot answer this. `unknown` is exactly that: the
      // question was never put, so the screen asserts nothing (objectui#9262).
      setAccessProbe({ app: appName, verdict: 'unknown' });
      return;
    }
    let cancelled = false;
    const probed = appName;
    void Promise.resolve(probe.call(dataSource, probed))
      .then(verdict => { if (!cancelled) setAccessProbe({ app: probed, verdict }); })
      // A probe that REJECTS has failed — `probeAppAccess` itself never throws,
      // so reaching here means a host implementation did. That is the absence
      // of an answer, not the absence of an app: `unreachable`, never `unknown`
      // (which now means nothing was asked at all) — objectui#9262.
      .catch(() => { if (!cancelled) setAccessProbe({ app: probed, verdict: 'unreachable' }); });
    return () => { cancelled = true; };
  }, [verdictWanted, previewDrafts, appName, accessProbe, dataSource]);
  // Never the previous app's answer: while a probe for a newly-requested app is
  // in flight, this is null and the branch below waits rather than rendering the
  // one it already has.
  const accessVerdict: AppAccessVerdict | null =
    accessProbe && accessProbe.app === appName ? accessProbe.verdict : null;

  useEffect(() => {
    if (!activeApp?.name) return;
    // ADR-0048 — build against the URL's own segment (`appSegment`, which may be
    // the package id) so the match works and the redirect keeps the same segment;
    // `activeApp.name` would flip a `/apps/<packageId>/…` URL to the name form.
    const packageMetadataPath = `/apps/${appSegment}/metadata/package`;
    if (
      location.pathname === packageMetadataPath ||
      location.pathname.startsWith(`${packageMetadataPath}/`)
    ) {
      navigate(`/apps/${appSegment}/component/developer/packages`, { replace: true });
    }
  }, [activeApp?.name, appSegment, location.pathname, navigate]);

  // objectstack-ai/objectstack#2604 — the create/edit overlay is URL-driven (`?form=new` / `?form=<id>`),
  // not component state: the record form is a TASK overlay over the origin
  // route, and putting its open-state in the URL makes browser Back close the
  // overlay (returning to the intact origin) instead of abandoning the route
  // with the overlay marooned on top. Same pattern as the detail drawer's
  // `?recordId=…` (useUrlOverlay / ADR-0054 C3). Open pushes a history entry;
  // every close strips the param with `replace` so no stale reopen-entry stays
  // ahead in history.
  const [searchParams, setSearchParams] = useSearchParams();
  const recordFormParam = searchParams.get(RECORD_FORM_PARAM);
  // objectstack-ai/objectstack#2604 D3 — child-task extension of the record-form URL contract:
  // `formObject` names the object the form edits when it is NOT the route's
  // object (a subtable child opened over its parent's detail); `formLink`
  // ("field:id") pre-links the parent on create. Keeping the whole task in
  // the URL means Back closes the overlay and a refresh reopens it still
  // correctly parent-linked — no transient component state to lose.
  const formObjectParam = searchParams.get(RECORD_FORM_OBJECT_PARAM);
  const formLinkParam = searchParams.get(RECORD_FORM_LINK_PARAM);
  const editingRecord = useMemo(
    () => (recordFormParam && recordFormParam !== 'new' ? { id: recordFormParam } : null),
    [recordFormParam],
  );
  const formLinkValues = useMemo(() => {
    if (!formLinkParam) return undefined;
    const i = formLinkParam.indexOf(':');
    if (i <= 0) return undefined;
    return { [formLinkParam.slice(0, i)]: formLinkParam.slice(i + 1) };
  }, [formLinkParam]);
  const [refreshKey, setRefreshKey] = useState(0);

  const isDialogOpen = !!recordFormParam;
  // objectui#12291 — a seeded create's values, carried by the history entry
  // that opened the overlay (`handleEdit` below). The object the router keeps
  // for that entry, so its identity holds until the entry changes.
  const overlayCreateValues = editingRecord ? undefined : readRecordFormCreateValues(location.state);

  // Close the record-form overlay by stripping `?form` in place. Reads the
  // LIVE location (not the hook's render-time snapshot) so it stays a no-op
  // when a success handler already navigated away in the same tick (the
  // post-create redirect below).
  const closeRecordForm = useCallback(() => {
    const sp = new URLSearchParams(window.location.search);
    if (!sp.has(RECORD_FORM_PARAM) && !sp.has(RECORD_FORM_OBJECT_PARAM) && !sp.has(RECORD_FORM_LINK_PARAM)) return;
    sp.delete(RECORD_FORM_PARAM);
    sp.delete(RECORD_FORM_OBJECT_PARAM);
    sp.delete(RECORD_FORM_LINK_PARAM);
    setSearchParams(sp, { replace: true });
  }, [setSearchParams]);

  const { execute: executeAction, runner } = useActionRunner();

  // objectui#2269 — bridge every dataSource write (create/update/delete →
  // MutationEvent) onto the invalidation bus, ONCE for the whole console.
  // Readers (record detail, related lists, count badges) refetch in place;
  // nothing is remounted for a data refresh.
  useMutationInvalidationBridge(dataSource);

  // objectui#10059 — the signed-in user's language has ONE source of truth,
  // `sys_user.locale`. Mounted here, beside the bridge above, because it reads
  // the column back off that bus: the profile page's language card writes the
  // same column through the same adapter, so its save reaches this reader and
  // the UI follows without a reload. See `hooks/useUserLocale.ts` for why the
  // device-local value is a cache from here on rather than a second setting.
  useSignedInUserLocale();

  // objectui#11080 — both toasts read the session's language: the words around
  // the operation's description are pack keys beside `actions.undo`, and the
  // description itself is interpolated unchanged.
  useGlobalUndo({
    dataSource: dataSource ?? undefined,
    onUndo: (op: any) => {
      toast.info(t('actions.undoneOperation', { description: op.description }), { duration: 4000 });
      setRefreshKey(k => k + 1);
      // Precisely-scoped invalidation — UndoableOperation carries the target
      // (objectName + recordId), so detail readers refresh in place too.
      if (op?.objectName) notifyDataChanged({ objectName: op.objectName, recordId: op.recordId });
    },
    onRedo: (op: any) => {
      toast.info(t('actions.redoneOperation', { description: op.description }), { duration: 3000 });
      setRefreshKey(k => k + 1);
      if (op?.objectName) notifyDataChanged({ objectName: op.objectName, recordId: op.recordId });
    },
  });

  useEffect(() => {
    runner.registerHandler('crud_success', async (action: any) => {
      closeRecordForm();
      setRefreshKey(k => k + 1);
      toast.success(action.params?.message ?? 'Record saved successfully');
      return { success: true, reload: true };
    });

    runner.registerHandler('dialog_cancel', async () => {
      closeRecordForm();
      return { success: true };
    });

    // Page-mode navigation handlers — declarative counterparts to the
    // imperative `handleEdit` callback. These let JSON schemas open the
    // full-screen create/edit pages directly via `<action:button>` without
    // any custom code:
    //   { "type": "action:button", "actionType": "navigate_create",
    //     "properties": { "params": { "objectName": "..." } } }
    //   { "type": "action:button", "actionType": "navigate_edit",
    //     "properties": { "params": { "objectName": "...", "recordId": "..." } } }
    // The button forwards `properties.params` as the runner's `params`,
    // which is what the handlers below read (objectui#10289, ruling A: a
    // node-level `params` is only the `ActionParam[]` input list).
    // The `objectName` param falls back to the action context's
    // `objectName` (set per view) so action buttons mounted inside an
    // ObjectView can omit it.
    // NOTE on duplication below: each handler reads `runner.getContext()`
    // INSIDE its closure (at action-invocation time) rather than once at
    // registration. Hoisting the call outside the registrations would
    // freeze the context to whatever it was when the effect last ran,
    // breaking dynamic per-view `runner.updateContext({ objectName, ... })`
    // calls (used by ObjectView / RecordDetailView). Keep the call where
    // it is.
    runner.registerHandler('navigate_create', async (action: any) => {
      const ctx = runner.getContext?.() ?? {};
      const result = resolveNavigateCreateUrl({
        action,
        context: ctx,
        defaultBaseUrl: `/apps/${appName ?? ''}`,
      });
      if (!result.success) return result;
      navigate(result.url);
      return { success: true };
    });

    runner.registerHandler('navigate_edit', async (action: any) => {
      const ctx = runner.getContext?.() ?? {};
      const result = resolveNavigateEditUrl({
        action,
        context: ctx,
        defaultBaseUrl: `/apps/${appName ?? ''}`,
      });
      if (!result.success) return result;
      navigate(result.url);
      return { success: true };
    });

    // NOTE: `flow` actions are handled at the per-view ActionProvider level
    // (RecordDetailView / ObjectView) so they share the same ActionRunner that
    // <action:button> renderers consume via useAction(). Do NOT register a
    // `flow` handler on this top-level useActionRunner — it lives on a
    // different ActionRunner instance and would never be invoked from the
    // record/list action buttons.
  }, [runner, navigate, appName, closeRecordForm]);

  useEffect(() => {
    if (!dataSource) return;
    const unsub = dataSource.onConnectionStateChange((event: any) => {
      setConnectionState(event.state);
      if (event.error) console.error('[Console] Connection error:', event.error);
    });
    setConnectionState(dataSource.getConnectionState());
    return unsub;
  }, [dataSource]);

  const cleanParts = location.pathname.split('/').filter(Boolean);
  let objectNameFromPath = cleanParts[2];
  if (
    objectNameFromPath === 'view' ||
    objectNameFromPath === 'record' ||
    objectNameFromPath === 'page' ||
    objectNameFromPath === 'dashboard' ||
    objectNameFromPath === 'design'
  ) {
    objectNameFromPath = '';
  }

  const currentObjectDef = allObjects.find((o: any) => o.name === objectNameFromPath);

  // The object the record-form overlay edits: the route's object by default,
  // or the `formObject` child override (objectstack-ai/objectstack#2604 D3 — subtable child task opened
  // over its parent's detail).
  const formObjectDef = formObjectParam
    ? allObjects.find((o: any) => o.name === formObjectParam)
    : currentObjectDef;
  const isChildFormTask = !!formObjectParam && formObjectParam !== currentObjectDef?.name;

  const handleCrudSuccess = useCallback(() => {
    const label = formObjectDef ? objectLabel(formObjectDef as any) : t('common.record', { defaultValue: 'Record' });
    executeAction({
      type: 'crud_success',
      params: {
        message: editingRecord
          ? t('form.updateSuccess', { object: label, defaultValue: `${label} updated successfully` })
          : t('form.createSuccess', { object: label, defaultValue: `${label} created successfully` }),
      },
    });
  }, [executeAction, editingRecord, formObjectDef, objectLabel, t]);

  const handleDialogCancel = useCallback(() => {
    executeAction({ type: 'dialog_cancel' });
  }, [executeAction]);

  // objectstack-ai/objectstack#2604 save invariant — *edit never moves you; create takes you to the
  // record you made.* Edit save: the origin route is untouched (crud_success
  // bumps refreshKey → origin refetches in place). Create save: land on the
  // new record's detail, on ITS derived surface — a light object's detail is
  // the drawer over the still-intact list; a heavy one is the detail route.
  // `replace: true` swaps out the transient `?form=…` entry so Back returns
  // to the pre-create origin.
  const handleRecordFormSuccess = useCallback(async (saved: any) => {
    // Child task (objectstack-ai/objectstack#2604 D3): the parent detail must stay EXACTLY as it was —
    // active tab, scroll, everything. So do NOT go through crud_success;
    // the child's open related lists refetch on their own via the
    // invalidation bus (#2269): the dataSource write already emitted a
    // MutationEvent that the bridge fans out — no manual notify needed.
    if (isChildFormTask) {
      const label = formObjectDef ? objectLabel(formObjectDef as any) : t('common.record', { defaultValue: 'Record' });
      toast.success(editingRecord
        ? t('form.updateSuccess', { object: label, defaultValue: `${label} updated successfully` })
        : t('form.createSuccess', { object: label, defaultValue: `${label} created successfully` }));
      closeRecordForm();
      return;
    }
    handleCrudSuccess();
    if (editingRecord || !currentObjectDef) return;
    const target = resolvePostCreateTarget({
      objectName: currentObjectDef.name,
      baseUrl: appSegment ? `/apps/${appSegment}` : '',
      pathname: location.pathname,
      search: window.location.search,
      surface: deriveRecordSurface(currentObjectDef),
      recordId: saved?.id ?? saved?._id,
    });
    if (target.kind === 'none') return;
    if (target.kind === 'detail-page') {
      // The new record's detail is a fresh route carrying no `?from=` trail,
      // so on its own it renders NO back affordance — a dead-end. Thread the
      // create's originating route as a history-state `from`, mirroring
      // ObjectView's list-row navigation (which is why clicking a row DOES
      // yield a back link). The origin is a list/view route, not a record, so
      // it rides history state rather than the record-only `?from=` trail.
      const originSp = new URLSearchParams(window.location.search);
      originSp.delete(RECORD_FORM_PARAM);
      originSp.delete(RECORD_FORM_OBJECT_PARAM);
      originSp.delete(RECORD_FORM_LINK_PARAM);
      const originQs = originSp.toString();
      const originPath = `${location.pathname}${originQs ? `?${originQs}` : ''}`;
      // The origin is a list of the object's records, so the back link names
      // it with the plural, as ObjectView's row navigation does (objectui#11733).
      const originLabel = objectPluralLabel(currentObjectDef);
      navigate(target.url, {
        replace: true,
        state: originLabel ? { from: { pathname: originPath, label: originLabel } } : undefined,
      });
      return;
    }
    navigate(target.url, { replace: true });
  }, [handleCrudSuccess, isChildFormTask, formObjectDef, editingRecord, currentObjectDef, appSegment, location.pathname, navigate, closeRecordForm, objectLabel, objectPluralLabel, t]);

  // Track recent items on route change. The hook matches `appName` against the
  // pathname's app segment, so it takes the ROUTE SEGMENT: handed
  // `activeApp.name`, it recorded nothing on a package-id route (objectui#11818).
  useTrackRouteAsRecent({
    pathname: location.pathname,
    appName: appSegment,
    objects: allObjects,
  });

  const handleEdit = (record: any) => {
    // Page-mode opt-in: when the object metadata declares
    // `editMode: 'page'`, route to the full-screen create/edit page instead
    // of opening the global ModalForm. Default behavior (modal) is
    // preserved for any object without the flag.
    const target = resolveRecordFormTarget({
      objectDef: currentObjectDef as any,
      baseUrl: appSegment ? `/apps/${appSegment}` : '',
      record,
    });
    if (target.kind === 'page') {
      navigate(target.url);
      return;
    }
    // Open the overlay via the URL (pushes one history entry → Back closes
    // the overlay, origin intact). `new` = create; a record id = edit.
    const rawId = record?.id ?? record?._id;
    const sp = new URLSearchParams(window.location.search);
    sp.set(RECORD_FORM_PARAM, rawId != null && rawId !== '' ? String(rawId) : 'new');
    // Top-level task on the route's own object — drop any stale child-task
    // overrides (see the record-form URL contract above).
    sp.delete(RECORD_FORM_OBJECT_PARAM);
    sp.delete(RECORD_FORM_LINK_PARAM);
    // objectui#12291 — a new record that arrives carrying values (the
    // calendar's empty-day hand-off sends the day clicked) opens the create
    // form with them, riding the history entry this push makes
    // (`RECORD_FORM_CREATE_VALUES_STATE`). Page mode carries them in its URL,
    // above (`resolveRecordFormTarget`).
    const createValues = recordFormCreateValues(record);
    setSearchParams(
      sp,
      createValues ? { state: { [RECORD_FORM_CREATE_VALUES_STATE]: createValues } } : undefined,
    );
  };

  const handleAppChange = (newAppName: string) => {
    navigate(`/apps/${newAppName}`);
  };

  // Evaluator for the ModalForm's field-visibility gates below, over the SAME
  // bag the `ExpressionProvider` this component mounts publishes — one builder,
  // called with the same inputs (objectui#6493). This one sits ABOVE that
  // provider in its own tree, so it cannot read it back through the hook; what
  // it can do is stop hand-writing a second, narrower bag.
  //
  // Two roots the private bag dropped, both of which fail OPEN when named:
  // `current_user` (and the `ctx.user` / `os.user` spellings of the same
  // object) and `features`. Its `user` was hand-rolled too, without
  // `positions` — so `'sales' in current_user.positions`, the gate the server
  // enforces on write, faulted here rather than hiding the field.
  // objectui#4421 — the same `permissions` input the provider below reads, so
  // `current_user.can(...)` in a field's `visibleWhen` answers here exactly as
  // it does under the provider (one bag, objectui#6493).
  // objectui#13083 — and the `systemPermissions` list beside it, so
  // `current_user.hasCapability(name)` answers here as it does under the
  // provider (objectui#13006) instead of faulting on an unbound list.
  const expressionPermissions = useExpressionPermissions();
  const expressionSystemPermissions = useExpressionSystemPermissions();
  const expressionEvaluator = useMemo(
    // ⛔ No `app`: objectui#8155 removed it from the predicate scope, because
    // neither ADR-0068 nor the engine's `SCOPE_ROOTS` declares such a root.
    //
    // ⛔ No `data` either: objectui#8166. This site passed `editingRecord` under
    // that root, and it was the ONE mount in the repo where the ambient `data`
    // was not empty — so an authored `visibleWhen: "data.status == 'x'"`
    // RESOLVED here, silently, against the record being edited, while the SAME
    // predicate on the SAME modal's per-field rules (form.tsx, over the
    // provider's `data={{}}`) faulted, and the same predicate in CREATE mode
    // (`editingRecord` null) faulted too. One authored string, three answers,
    // none of them the row's canonical `record.*` binding (`83fe6e741`).
    // The row reaches field predicates as `record`, from the form's own
    // `ruleRecord` — not from this bag, which is why nothing is lost here.
    () => createExpressionEvaluator({
      user: buildExpressionUser(user),
      features,
      permissions: expressionPermissions,
      systemPermissions: expressionSystemPermissions,
    }),
    [user, features, expressionPermissions, expressionSystemPermissions],
  );

  // objectui#5619 — `isWorkspaceAdminResolved` belongs in this readiness gate
  // for the same reason `metadataLoading` does: everything below branches on
  // the verdict. The guard at the "no active app" strand turns a `false` into a
  // replacing redirect to home that the later flip to `true` cannot undo,
  // and the chrome this mounts (ConsoleLayout -> UnifiedSidebar / AppHeader)
  // reads the same verdict to decide which navigation exists. Waiting for three
  // of four inputs and acting on the fourth mid-flight is the defect itself.
  //
  // Deliberately NOT a mask over one page (objectui#5621 correctly removed the
  // last of those): this is the ONE readiness gate this surface already has,
  // and it withholds every consequence shape at once — the redirect, both
  // marketplace refusals routed below, and the nav entries.
  //
  // Cost, measured: `useWorkspaceAdminStatus` reports `isResolved` the instant
  // `isAdmin` is true, so any admin the session already identifies (the
  // `positions[]` leg, which is every admin on a session minted with an active
  // organization stamped) waits exactly zero extra frames. What does wait is
  // the viewer whose verdict genuinely is not known yet — and for them a
  // LoadingScreen is the honest frame, not a screen built on a guess.
  //
  // objectui#12809 — of the lazy metadata, the splash waits only for what the
  // current route reads (`routeReadsSettled`), and only until the first paint.
  if (
    !dataSource ||
    metadataLoading ||
    !isWorkspaceAdminResolved ||
    (!firstPaintDone.current && !routeReadsSettled)
  ) return <LoadingScreen />;
  firstPaintDone.current = true;

  // ADR-0037 — preview mode renders its OWN empty/error states and never
  // falls through to the generic "No Apps Configured" guard below: inside a
  // draft preview (the Live Canvas iframe, or a hand-opened ?preview=draft
  // URL) that screen both lies ("nothing has been registered") and misdirects
  // ("Create Your First App") about an app the AI may have just drafted.
  if (previewDrafts && (requestedAppMissing || !activeApp)) {
    return (
      <PreviewDraftEmptyState
        appName={appName}
        error={metadataError}
        onRetry={() => void refreshMetadata()}
      />
    );
  }

  // (isCreateAppRoute / isSystemRoute / isMetadataRoute / isSetupRoute are
  // computed near the top — before activeApp — so the fallback + readiness
  // logic can use them. The metadata designer (Studio) in particular must stay
  // reachable with no active app: a fresh env where AI just drafted everything
  // has ZERO published apps, and that is the surface you review & publish from.)

  // objectui#4252 — the app EXISTS and this session may not open it. Say that,
  // and say it as the permanent decision it is: the old copy named a transient
  // deploy state, which sent a downstream acceptance round chasing a platform
  // defect for two test batches over a missing permission-set binding.
  //
  // No Retry here — retrying a permission decision cannot change it, and a
  // button that promises otherwise is the same misdirection one layer down.
  // The way back is HOME instead, because this screen (like every no-app
  // surface in this file) returns ABOVE the single `ConsoleLayout` mount and
  // so carries no header, no navigation and no workspace switcher — the
  // objectui#4473 strand, which a dead end here would recreate. Which home is
  // the DECLARED one (objectui#7373): a control-plane customer bounced to the
  // environment launcher lands among cards that act on an environment their
  // deployment does not have. Router-relative for the same reason as the
  // #4473 fix: `<Navigate>`/`navigate` resolve through the host's `basename`,
  // and both the declared landing and the launcher fallback are part of the
  // outer skeleton every host mounting this component provides (see this
  // file's header).
  //
  // The way home itself is shared with the app-missing screen below
  // (objectui#13122): that screen returns above `ConsoleLayout` too, so a Retry
  // alone left a stale bookmark or an uninstalled app's link a full-screen dead
  // end. One button, one copy key, one navigation for every screen that owes it.
  const renderBackHomeButton = (testId: string) => (
    <Button onClick={() => navigate(homePath)} data-testid={testId}>
      {t('empty.appAccessDeniedHome', { defaultValue: 'Back to home' })}
    </Button>
  );

  // One screen for both branches that draw a `denied` verdict below.
  const renderAppAccessDenied = () => (
    <div className="h-screen flex items-center justify-center">
      <Empty data-testid="app-access-denied">
        <EmptyTitle>
          {t('empty.appAccessDenied', { defaultValue: "You don't have access to this app" })}
        </EmptyTitle>
        <EmptyDescription>
          {t('empty.appAccessDeniedDescription', {
            defaultValue:
              'This app exists, but your account is not authorized to open it. Ask an administrator to grant you access.',
          })}
        </EmptyDescription>
        <div className="mt-4">{renderBackHomeButton('app-access-denied-home')}</div>
      </Empty>
    </div>
  );

  // objectui#12706 — an app surface under a pseudo-route, for an app the list
  // does not carry (`appSurfaceAwaitsVerdict`, computed near the top). Nothing
  // of it renders before the verdict, so a refused caller never mounts the
  // page; `denied` is the screen above, and every other verdict falls through
  // to the pseudo-route rendering below, unchanged.
  if (appSurfaceAwaitsVerdict && !previewDrafts) {
    if (accessVerdict === null) return <LoadingScreen />;
    if (accessVerdict === 'denied') return renderAppAccessDenied();
  }

  // A normal app was requested but isn't in the loaded metadata. Re-check once
  // for the post-publish lag, then say it's not available — NEVER render a
  // different app, and don't show the misleading "no apps configured" screen
  // below (there ARE apps). requestedAppMissing already excludes pseudo-routes.
  if (requestedAppMissing) {
    if (missingRecheck !== 'done' || accessVerdict === null) return <LoadingScreen />;
    if (accessVerdict === 'denied') return renderAppAccessDenied();
    // objectui#9262 — the remaining verdicts, each saying only what the probe
    // obtained. The screen this replaced asserted ONE transient deploy state
    // ("it may still be publishing") over every one of them; that sentence is
    // retired by the ruling, and a genuine post-publish lag now reads as
    // `not_found` — the forced `refreshMetadata()` above is what gives that lag
    // its chance to resolve before anything is said about it.
    //
    // Retry is offered on all three because all three can change on their own:
    // an absence ends when the app is created or published, an unreachable
    // server comes back, and an unasked question is still unasked. That is the
    // opposite of `denied` above, which no retry can move. Retry is never the
    // ONLY way out, though: each of the three also offers the denied screen's
    // way home (objectui#13122), since nothing here is guaranteed to change.
    //
    // ⭐ `granted` lands on the NEUTRAL screen deliberately, with `unknown`.
    // Reaching here with `granted` means the by-name route served the app while
    // the refreshed list still does not carry it (objectui#9262 cause 8, and the
    // one shape measured on a real server before this branch was written). The
    // console has no app document to render from and no account of the
    // disagreement, so the screen that asserts nothing is the honest one.
    const verdictScreen =
      accessVerdict === 'not_found'
        ? {
            testId: 'app-not-found',
            title: t('empty.appNotFound', { defaultValue: "This app can't be opened" }),
            description: t('empty.appNotFoundDescription', {
              defaultValue: 'The server did not return this app for your account.',
            }),
          }
        : accessVerdict === 'unreachable'
          ? {
              testId: 'app-unreachable',
              title: t('empty.appUnreachable', { defaultValue: "Couldn't reach the server" }),
              description: t('empty.appUnreachableDescription', {
                defaultValue: 'This app could not be checked. Try again in a moment.',
              }),
            }
          : {
              testId: 'app-not-available',
              title: t('empty.appNotAvailable', { defaultValue: 'App not available' }),
              description: t('empty.appNotAvailableDescription', {
                defaultValue: 'This app is not available — try again in a moment.',
              }),
            };
    return (
      <div className="h-screen flex items-center justify-center">
        <Empty data-testid={verdictScreen.testId}>
          <EmptyTitle>{verdictScreen.title}</EmptyTitle>
          <EmptyDescription>{verdictScreen.description}</EmptyDescription>
          <div className="mt-4 flex items-center justify-center gap-2">
            <Button onClick={() => setMissingRecheckRun(null)} data-testid={`${verdictScreen.testId}-retry`}>
              {t('common.retry', { defaultValue: 'Retry' })}
            </Button>
            {renderBackHomeButton(`${verdictScreen.testId}-home`)}
          </div>
        </Empty>
      </div>
    );
  }

  // objectui#4473 — a viewer with NO app to enter here must not be left on a
  // chrome-less screen. The app list arrives from `GET /api/v1/meta/:type` with
  // the SINGULAR type segment `app`, and the server filters that list PER
  // SESSION (`filterAppForUser`, `packages/rest/src/rest-server.ts`), so an
  // empty list on a `member` means "nothing here is yours to open", not "this
  // workspace has no apps" — and switching
  // organization lands exactly there: `WorkspaceSwitcher` reloads onto the
  // console root, `RootLandingRedirect` resolves the landing from the app
  // metadata `MetadataProvider` seeded out of sessionStorage (the PREVIOUS
  // org's, keyed by type only), and the resulting `/apps/setup` settles with an
  // empty list. Every no-app surface in this file returns ABOVE the single
  // `ConsoleLayout` mount, so what renders has no header, no navigation and no
  // workspace switcher: no way back except editing the URL by hand.
  //
  // The bounce is role-aware because that is what the empty state below already
  // presupposes, not as a stand-in for per-app access: its copy asserts a
  // WORKSPACE-level fact ("no apps are registered") that a per-user-filtered
  // list cannot establish, and offers two actions — create an app, open system
  // settings — that a non-admin cannot perform. For a workspace admin it stays
  // the deliberate first-run surface (#3573 / #3590). For everyone else HOME is
  // the honest destination: it renders inside the shell (top bar + workspace
  // switcher) and already carries the role-aware copy for this state ("No
  // applications yet — your workspace is being set up…", `home/HomePage.tsx`).
  // `replace`, so the strand is not left in history behind them.
  //
  // WHICH home is `homePath` (objectui#7373), not the launcher literal this
  // line used to carry: on a deployment that DECLARES a landing the launcher is
  // the wrong screen to strand someone on — cloud's control plane has no
  // environment for its "Build an app" cards to act on. Where nothing is
  // declared `homePath` IS the launcher, so this branch is unchanged for every
  // ordinary environment.
  //
  // Router-relative on purpose: `<Navigate>` resolves through the host's
  // `basename`, so the console's `/_console` mount is preserved without
  // building a URL by hand (`resolveConsoleUrl` is for full-page navigations
  // that leave the router — see `organizations/resolveHomeUrl.ts`). Both the
  // declared landing and the launcher fallback are
  // part of the outer skeleton every host that mounts this component provides
  // (see this file's header), and `RequireAiSurface` in `ConsoleShell.tsx`
  // already bounces the same way for a surface this runtime cannot serve.
  //
  // Telling "you may not enter THIS app" apart from "this app is not published"
  // is the other half of #4473 and stays gated on the backend permission-denied
  // envelope (objectstack#8013 → objectui#4252). Nothing here waits on it: the
  // guard reads only the per-user-filtered list that ships today.
  if (!activeApp && !isCreateAppRoute && !isSystemRoute && !isMetadataRoute && !isWorkspaceAdmin) {
    // `RedirectWithSplash`, not a bare `<Navigate>` (objectui#6378 / #6507).
    // Every readiness gate above this branch renders `LoadingScreen`, and the
    // branch returns ABOVE the single `ConsoleLayout` mount — so a bare
    // redirect, which renders null, hands the WHOLE viewport back to the page
    // background while `/home` renders at transition priority. Measured on the
    // three sibling gates #6506 fixed: 41-147 ms of empty `#root`. This one is
    // a boot-path gate on the same evidence rule and keeps the splash painted
    // across the handoff; the URL-rewrite redirects further down this file
    // (`LegacyMetadataRedirect`, `ShorthandRecordRedirect`) deliberately do NOT
    // convert -- they fire INSIDE `ConsoleLayout`, with the console already on
    // screen, and a splash there would cover a layout that never went away.
    return <RedirectWithSplash to={homePath} replace />;
  }

  if (!activeApp && !isCreateAppRoute && !isSystemRoute && !isMetadataRoute) return (
    <div className="h-screen flex items-center justify-center">
      <Empty>
        <EmptyTitle>{t('empty.noAppsConfigured')}</EmptyTitle>
        <EmptyDescription>
          {t('empty.noAppsConfiguredDescription')}
        </EmptyDescription>
        <div className="mt-4 flex flex-col sm:flex-row items-center gap-3">
          {/* #3573 — target the APP-SCOPED route, not the host root. `create-app`
              is declared by THIS component (the no-active-app branch just below,
              and the with-app router further down), i.e. inside the
              `/apps/:appName/*` subtree — never at the root. The former absolute
              `/create-app` resolved against the HOST's root route tree, which
              declares no such path, so the host's trailing catch-all silently
              bounced the user back to the landing page: a dead first-screen CTA.
              A plain relative `navigate('create-app')` does NOT fix it either —
              react-router 7 resolves a relative `to` against the LEAF match's
              FULL pathname, splat INCLUDED (`getResolveToMatches`), so from
              `/apps/setup/<anything>` it builds `/apps/setup/<anything>/create-app`,
              which matches no route and renders a blank screen. `/apps/<segment>`
              is the platform's canonical app URL (ADR-0048) and is what every
              other navigation in this file builds, so build it here too. (This
              branch is only reachable under `/apps/setup…`: it requires
              `isSetupRoute`, the one pseudo-route the guard above does not
              exclude — so `appName` is always present here.) */}
          <Button onClick={() => navigate(`/apps/${appName}/create-app`)} data-testid="create-first-app-btn">
            {t('empty.createFirstApp')}
          </Button>
          {/* #3590 — system settings live at `/apps/setup/system`, NOT at the
              bare `/apps/setup`. Being inside the `/apps/:appName/*` subtree is
              necessary but NOT sufficient: `isSystemRoute` keys on a `/system`
              segment, so bare `/apps/setup` fails every pseudo-route test above
              except `isSetupRoute` and falls straight back into THIS guard —
              i.e. it is this empty state's own URL, and the click was a no-op
              loop. `/apps/setup/system` flips `isSystemRoute`, which is exactly
              the switch that mounts `extraRoutesNoApp` (the branch just below),
              where the host declares its own `system` landing. The reference
              console host forwards it onto its settings hub, `system/settings`
              (objectui#3743 retired the card wall that used to render there).
              Spelled the same absolute way as the sidebar's whole `sys-*`
              cluster (`/apps/setup/system/...`); `appName` is provably `setup`
              here, so the two forms coincide. */}
          <Button variant="outline" onClick={() => navigate('/apps/setup/system')} data-testid="go-to-settings-btn">
            {t('empty.systemSettings')}
          </Button>
        </div>
      </Empty>
    </div>
  );

  if (!activeApp && (isCreateAppRoute || isSystemRoute || isMetadataRoute)) {
    // objectui#12809 — no chrome on this branch, so a route still waiting on
    // its metadata keeps the splash, as its Suspense fallback does.
    if (!routeReadsSettled) return <LoadingScreen />;
    return (
      <Suspense fallback={<LoadingScreen />}>
        <Routes>
          <Route path="create-app" element={<CreateAppPage />} />
          <Route path="system/marketplace" element={<MarketplacePage />} />
          <Route path="system/marketplace/:packageId" element={<MarketplacePackagePage />} />
          {/* Studio / metadata designer — reachable with no active app so a
              fresh env can review + publish its first (AI-authored) drafts. */}
          <Route path="metadata" element={<MetadataDirectoryPage />} />
          <Route path="metadata/_diagnostics" element={<MetadataDiagnosticsPage />} />
          <Route path="metadata/:type" element={<MetadataResourceListPage />} />
          <Route path="metadata/:type/new" element={<MetadataResourceEditPage createMode />} />
          <Route path="metadata/:type/:name" element={<MetadataResourceEditPage />} />
          <Route path="metadata/:type/:name/history" element={<MetadataResourceHistoryPage />} />
          {/* #3610 — the legacy metadata aliases, mirrored from the with-app
              branch below. They are NOT a second copy of the page: both render
              `LegacyMetadataRedirect`, which forwards onto the canonical
              `metadata/:type…` routes declared just above. Declaring them here
              is what stopped the zero-app console rendering a blank screen: the
              fallback navigation then aimed `sys-datasources` at an alias, and
              carried `sys-objects` onto one via the host's
              `system/metadata/:type` rewrite. Both pass `isMetadataRoute` (a
              `metadata` path segment — a substring test until #3638) and so land
              in THIS branch, which declared no `component/…` route at all —
              every one of them rendered a blank screen. #3610 mirrored the
              routes rather than re-point that navigation, because inventing a
              zero-app-only spelling would have given the alias a second
              canonical destination. #3660 re-pointed `sys-datasources` anyway —
              at the shared `metadata/:type` routes above, so no second spelling
              was created — and #3739 did the same for `sys-objects` and the
              home "Manage Objects" card, whose chain had already left these two
              routes at #3658, when the host stopped rewriting onto the alias.
              What is left for these two is bookmarks and external links: the
              arrivals that can never be re-pointed. */}
          <Route path="component/metadata/directory" element={<LegacyMetadataRedirect mode="directory" />} />
          <Route path="component/metadata/resource/*" element={<LegacyMetadataRedirect mode="resource" />} />
          {extraRoutesNoApp}
          {/* #3610 — same catch-all the with-app branch has carried all along.
              A `<Routes>` with no match renders `null`, i.e. a blank page that
              is indistinguishable from a crash: no 404, no error, nothing to
              report. This branch is the one a zero-app deployment lives in, so
              it is precisely where an unresolved URL most needs to say so. */}
          <Route path="*" element={<RouteNotFound />} />
        </Routes>
      </Suspense>
    );
  }

  const expressionUser = buildExpressionUser(user);

  return (
    <ExpressionProvider user={expressionUser} app={activeApp} data={{}} features={features}>
      {/* Session scope for `{current_user_id}` / `{current_org_id}` filter
          placeholders. Mounted here rather than folded into the expression
          scope above: that one is the predicate evaluation context (it carries
          no organization), and widening it for filter resolution would couple
          two unrelated contracts. Renderer packages deliberately do not depend
          on @object-ui/auth, so the shell supplies the values (framework
          objectstack-ai/objectstack#3574). */}
      <FilterScopeProvider
        currentUserId={user?.id ?? null}
        currentOrgId={activeOrganization?.id ?? null}
      >
      <NavigationSyncEffect />
      <ConsoleLayout
        activeAppName={activeApp.name}
        activeApp={activeApp}
        onAppChange={handleAppChange}
        objects={allObjects}
        connectionState={connectionState}
        userId={user?.id}
      >
        <CommandPalette
          apps={apps}
          activeApp={activeApp}
          objects={allObjects}
          onAppChange={handleAppChange}
          dataSource={dataSource}
        />
        <KeyboardShortcutsDialog />
        <OnboardingWalkthrough />
        <DraftReviewNavigator appName={appName} />
          <ErrorBoundary>
            <Suspense fallback={<LoadingScreen />}>
              <RouteFader className="h-full">
                {/* objectui#12809 — the route's metadata has not landed: its
                    skeleton, never its empty or "not found" state. */}
                {!routeReadsSettled ? <RouteMetadataSkeleton reads={routeReadsKey || 'object'} /> : objectScope && routeObjectReadsFailed.length > 0 ? (
                  // objectui#13052 — the route's object read failed (a 5xx, a
                  // network drop, a code this build does not know): say so in
                  // the shell, and let Retry ask those names once more.
                  <RouteObjectReadFailed
                    onRetry={() => {
                      for (const name of routeObjectReadsFailed) metadata.invalidate('object', name);
                    }}
                  />
                ) : routeObjectRefusal?.code === 'OBJECT_PACKAGE_DISABLED' ? (
                  // objectui#13052 — the server answered that the route's
                  // object exists and its package is disabled: the not-found
                  // view, with the sentence that says so.
                  <ObjectNotFoundState objectName={routeObjectRefusal.objectName} packageDisabled />
                ) : (
                <Routes>
                <Route
                  path="/"
                  element={
                    <AppRootLanding
                      app={activeApp}
                      ctx={{ currentUserId: user?.id ?? null }}
                      setupPath={isWorkspaceAdmin ? resolveSetupAppPath(apps) : null}
                    />
                  }
                />
                {/* Metadata admin routes — declared BEFORE the generic
                    `:objectName/...` routes so the static `metadata` prefix
                    wins React Router's score tiebreaker (both
                    `metadata/:type/:name` and `:objectName/view/:viewId`
                    score 16; declaration order breaks the tie). */}
                <Route
                  path="metadata/package/*"
                  element={<Navigate to={`/apps/${appSegment}/component/developer/packages`} replace />}
                />
                <Route path="metadata">
                  <Route index element={<MetadataDirectoryPage />} />
                  <Route path="_diagnostics" element={<MetadataDiagnosticsPage />} />
                  <Route path=":type" element={<MetadataResourceListPage />} />
                  <Route path=":type/new" element={<MetadataResourceEditPage createMode />} />
                  <Route path=":type/:name" element={<MetadataResourceEditPage />} />
                  <Route path=":type/:name/history" element={<MetadataResourceHistoryPage />} />
                </Route>
                <Route path=":objectName" element={
                  <ObjectView dataSource={dataSource} objects={allObjects} onEdit={handleEdit} externalRefreshKey={refreshKey} />
                } />
                <Route path=":objectName/new" element={
                  <RecordFormPage mode="create" />
                } />
                <Route path=":objectName/view/:viewId" element={
                  <ObjectView dataSource={dataSource} objects={allObjects} onEdit={handleEdit} externalRefreshKey={refreshKey} />
                } />
                {/* ADR-0055: parameterized bare data surface — URL `filter[...]`
                    conditions over everything row-level security permits, NOT
                    anchored to any saved view. `data` is a reserved segment
                    alongside `new` / `view` / `record`. */}
                <Route path=":objectName/data" element={
                  <ObjectDataPage dataSource={dataSource} objects={allObjects} />
                } />
                <Route path=":objectName/record/:recordId" element={
                  <RecordDetailView dataSource={dataSource} objects={allObjects} onEdit={handleEdit} />
                } />
                <Route path=":objectName/record/:recordId/edit" element={
                  <RecordFormPage mode="edit" />
                } />
                <Route path={RECORD_NAMED_PAGE_ROUTE} element={
                  <RecordDetailView dataSource={dataSource} objects={allObjects} onEdit={handleEdit} />
                } />
                <Route path="dashboard/:dashboardName" element={<DashboardView dataSource={dataSource} />} />
                <Route path="report/:reportName" element={<ReportView dataSource={dataSource} />} />
                {/* objectui#13020: the app's report index, linked from the sidebar. */}
                <Route path="reports" element={<AppReportIndexView />} />
                <Route path="page/:pageName" element={<PageView />} />
                <Route path="component/:ns/:name/*" element={<ComponentNavView />} />
                {/* Legacy: old metadata routes built before the REST-style nesting
                    landed. Redirect to the new /metadata/:type/... shape. */}
                <Route path="component/metadata/directory" element={<LegacyMetadataRedirect mode="directory" />} />
                <Route path="component/metadata/resource/*" element={<LegacyMetadataRedirect mode="resource" />} />
                <Route path="design/dashboard/:dashboardName" element={<DashboardDesignPage />} />
                <Route path="search" element={<SearchResultsPage />} />
                <Route path="create-app" element={<CreateAppPage />} />
                <Route path="edit-app/:editAppName" element={<EditAppPage />} />
                <Route path="system/marketplace" element={<MarketplacePage />} />
                <Route path="system/marketplace/:packageId" element={<MarketplacePackagePage />} />
                {extraRoutes}
                {/* Shorthand-deep-link redirect: a bare `/{:objectName}/:maybeRecordId`
                    URL is ambiguous — it could be a view id or a record id. When
                    the second segment matches a record-id shape (URL-safe, ≥6
                    chars, not a reserved word like `new` / `view` / `record`)
                    we forward it to the canonical record route. This catches:
                    - middle/Cmd-click links that legacy producers built before
                      the URL builder was fixed
                    - externally shared / pasted links (email, Slack)
                    - copy-paste of a record id appended to an object URL */}
                <Route path=":objectName/:maybeRecordId" element={<ShorthandRecordRedirect />} />
                {/* Catch-all: render an explicit "not found" instead of a blank
                    page so users always know when a URL didn't resolve. */}
                <Route path="*" element={<RouteNotFound />} />
              </Routes>
                )}
              </RouteFader>
            </Suspense>
          </ErrorBoundary>
          {formObjectDef && (
            <ModalForm
              key={`${formObjectDef.name}:${editingRecord?.id || 'new'}`}
              schema={{
                type: 'object-form',
                formType: 'modal',
                objectName: formObjectDef.name,
                mode: editingRecord ? 'edit' : 'create',
                recordId: editingRecord?.id,
                // Child create task (objectstack-ai/objectstack#2604 D3): pre-link the parent from the
                // `formLink` URL param (refresh-safe — the link survives).
                // Otherwise a create seeded by its opener (objectui#12291 — the
                // calendar's empty-day hand-off) opens with the values its
                // history entry carries. Each is handed as the object it is,
                // never a merge rebuilt per render: the form re-seeds whenever
                // `initialValues` is a new object.
                ...(!editingRecord && (formLinkValues ?? overlayCreateValues)
                  ? { initialValues: formLinkValues ?? overlayCreateValues }
                  : {}),
                // Honor the object's DEFAULT FORM VIEW: curated sections (field
                // selection + order + grouping), `contentLayout: 'tabbed'` when the
                // view is tabbed, inline child collections (master-detail), and its
                // authored `modalSize`. When the view declares sections they drive
                // the modal layout and win over the flat `fields` list below;
                // otherwise `fields` (every field, raw schema order) is used as
                // before. `formType` stays 'modal' (the container).
                // (objectstack-ai/objectstack#1890 / ADR-0050.)
                //
                // The size: objectstack-ai/objectstack#2604 D1 — create/edit follow
                // the flow-surface derivation. This host calls it with no
                // `viewport`, so it gets the desktop answer, a bounded modal
                // (`size: 'auto'`) for field-heavy and light objects alike
                // (objectstack-ai/objectstack#23734, objectui#12592); a phone gets
                // ModalForm's full-screen sheet below `sm`. objectui#12803: an
                // authored `FormView.modalSize` wins over that derived default on
                // desktop, and a derived `'full'` (the phone posture) stays full.
                // The precedence lives in `resolveRecordFormModalLayout`, not in
                // spread order. Child tasks size to the CHILD object's def.
                //
                // The form view: a create uses the object's `create` form view
                // when it declares one (objectui#13099), an edit its default.
                // The flow is the same `editingRecord` test the `mode` above
                // reads, so the selected view always matches the form's mode.
                ...resolveRecordFormModalLayout(
                  formObjectDef as any,
                  deriveRecordFlowSurface(
                    formObjectDef,
                    isChildFormTask
                      ? (editingRecord ? 'child-edit' : 'child-create')
                      : (editingRecord ? 'edit' : 'create'),
                  ).size,
                  editingRecord ? 'edit' : 'create',
                ),
                title: editingRecord
                  ? t('form.editTitle', { object: objectLabel(formObjectDef as any) })
                  : t('form.createTitle', { object: objectLabel(formObjectDef as any) }),
                open: isDialogOpen,
                onOpenChange: (open: boolean) => { if (!open) closeRecordForm(); },
                layout: 'vertical',
                // objectui#6514 — the same declared-key gate `RecordFormPage`
                // runs, through the same helper. This read `f.visible`, a key
                // `FieldSchema` refuses by name, so nothing an author could
                // legally write ever reached it; `isObjectFieldVisible` reads the
                // static `hidden` (INVERTED) and the `visibleWhen` predicate,
                // and the dead read is deleted rather than kept beside them.
                fields: formObjectDef.fields
                  ? (Array.isArray(formObjectDef.fields)
                      ? formObjectDef.fields
                          .filter((f: any) => {
                            if (typeof f === 'string') return true;
                            return isObjectFieldVisible(f, expressionEvaluator);
                          })
                          .map((f: any) => typeof f === 'string' ? f : f.name)
                      : Object.entries(formObjectDef.fields)
                          .filter(([_, f]: [string, any]) => isObjectFieldVisible(f, expressionEvaluator))
                          .map(([key]: [string, any]) => key))
                  : [],
                onSuccess: handleRecordFormSuccess,
                onCancel: handleDialogCancel,
                showSubmit: true,
                showCancel: true,
                submitText: editingRecord
                  ? t('form.update', { defaultValue: 'Update' })
                  : t('form.create', { defaultValue: 'Create' }),
                cancelText: t('common.cancel'),
              }}
              dataSource={dataSource}
            />
          )}
      </ConsoleLayout>
      </FilterScopeProvider>
    </ExpressionProvider>
  );
}

function findFirstRoute(items: any[], ctx?: NavTemplateContext): string {
  if (!items || items.length === 0) return '';
  for (const item of items) {
    // objectui#12113 — a `component` entry lands too: its URL is the one the
    // sidebar follows, through `buildItemRoute` → `resolveHref`. Without it
    // the Studio app, whose navigation is all `component` entries, had no
    // landing at all.
    if (
      item.type === 'object' ||
      item.type === 'page' ||
      item.type === 'dashboard' ||
      item.type === 'report' ||
      item.type === 'component'
    ) {
      const route = buildItemRoute(item, ctx);
      if (route) return route;
      continue;
    }
    if (item.type === 'url') continue;
    if (item.type === 'group' && item.children) {
      const childRoute = findFirstRoute(item.children, ctx);
      if (childRoute !== '') return childRoute;
    }
  }
  return '';
}

// Build the per-item route segment without recursing through groups — the
// caller has already picked the item and just needs to know how to address
// it. Delegates to the layout package's resolveHref() so
// `recordId`/`recordMode`/`componentRef` semantics stay consistent with the
// sidebar.
function buildItemRoute(item: any, ctx?: NavTemplateContext): string {
  if (!item) return '';
  if (item.type === 'url' || item.type === 'action' || item.type === 'separator' || item.type === 'group') return '';
  const { href, external } = resolveHref(item, '', ctx);
  if (external || !href || href === '#') return '';
  // resolveHref returns leading-slash paths (`/sys_user/...`); the
  // Navigate target inside <Routes basename="/apps/:appName"> wants a
  // *relative* path so it composes with the app base.
  return href.replace(/^\//, '');
}

/**
 * Resolves the route to navigate to when the user lands on the bare
 * `/console/apps/:appName` URL: the app's landing page is its FIRST reachable
 * navigation item, in `order`, among the entries the member is shown
 * (`navigation` arrives already gated, objectui#12426) — `findFirstRoute` walks groups and lands on an
 * `object`, `page`, `dashboard`, `report` or `component` entry (objectui#12113
 * added `component`). It skips the item types that address nothing inside
 * the app (`url`, `separator`, `action`), and a `doc` entry is never the
 * landing (objectui#11197). Which app the ROOT lands on is a separate
 * question, decided by `isDefault`.
 *
 * This used to honour an explicit `app.homePageId`. Spec 17.0.0 retired that
 * key (objectstack#4667, premise corrected in objectstack-ai/objectstack#4709 / objectui#3287): it was
 * an ID cross-reference with no referential integrity, so a dangling id fell
 * back to the first item *silently*. If the capability returns, the correct
 * encoding is a flag on the navigation item itself (`navigation[].landing`),
 * which cannot dangle — hence this function is kept as the seam even though it
 * now has a single expression.
 */
function resolveLandingRoute(navigation: NavigationItem[], ctx?: NavTemplateContext): string {
  return findFirstRoute(navigation, ctx);
}

/**
 * The app root (`/apps/:appName`): navigates to the app's landing, or says the
 * member has nothing here.
 *
 * The landing is the first entry THIS MEMBER is shown (objectui#12426): the
 * tree is read through `navEntriesShownToMember` with the gates
 * `useNavMemberGates` builds, the very gates `UnifiedSidebar` draws with: the
 * `visible` evaluation, `requiredPermissions`, the runtime-capability gates and
 * the object-read prune. It used to read the SERVED tree, so a member whose
 * first entry the sidebar hid was sent to it anyway: on HotCRM a
 * `service_agent` landed on a dashboard built on an object they may not read,
 * with no active sidebar entry.
 *
 * An entry whose API `dataSource` read is still pending is hidden by those
 * gates (objectui#13029), but it is not decided yet (objectui#13097). So the
 * landing is asked twice: over the trees as the member is shown them now, and
 * over the trees as they would be shown if every pending entry were shown once
 * it answers. When the two disagree, on the landing route or on whether the
 * app shows this member anything, a pending read ahead of the first decided
 * entry could still change the answer: the root holds on a skeleton, neither
 * navigating nor saying "nothing here", and lands when the reads answer. A
 * failed read hides its entry, and the landing moves on. An app with no bound
 * entry, or whose first decided entry comes before every pending one, gets the
 * same answer twice and lands on first render, as before.
 *
 * It is a component, not an expression in `AppContent`'s render, because the
 * `visible` evaluator is the `ExpressionProvider` mounted INSIDE that render;
 * read from `AppContent` itself it would be an outer one, not the sidebar's.
 */
function AppRootLanding({
  app,
  ctx,
  setupPath,
}: {
  app: any;
  ctx: NavTemplateContext;
  setupPath: string | null;
}) {
  const gates = useNavMemberGates();
  // objectstack#25338 — an app that names objects, none of which this member
  // may read, has nothing for them: its dashboards and pages would answer a
  // grid of "You don't have access" tiles. Say so once, before any landing is
  // chosen. The verdict is the object-read prune's own (`gates.can`), already
  // held for the whole shell, so nothing here waits on a read.
  if (appNamesOnlyUnreadableObjects(app, gates.can)) {
    return <AppNoAccessEmptyState app={app} setupPath={setupPath} reason="no-readable-object" />;
  }
  const navigation = navEntriesShownToMember(app?.navigation || [], gates);
  const landing = resolveLandingRoute(navigation, ctx);
  const areas = (app?.areas || []) as Array<{ navigation?: NavigationItem[] } | null | undefined>;
  const shownApp = {
    navigation,
    areas: areas.map((area) => ({ navigation: navEntriesShownToMember(area?.navigation || [], gates) })),
  };
  // objectui#13097 — the same questions, as if every pending read showed its
  // entry. A different answer means a pending read is still deciding it.
  const undecided = navEntriesShownOncePendingReadsShow(app?.navigation || [], gates);
  const undecidedApp = {
    navigation: undecided,
    areas: areas.map((area) => ({ navigation: navEntriesShownOncePendingReadsShow(area?.navigation || [], gates) })),
  };
  if (
    resolveLandingRoute(undecided, ctx) !== landing ||
    (!landing && appServesNoNavigation(shownApp) !== appServesNoNavigation(undecidedApp))
  ) {
    return (
      <div data-testid="app-landing-pending" className="h-full">
        <SkeletonGrid />
      </div>
    );
  }
  if (landing) return <Navigate to={landing} replace />;
  // objectui#12079 — an app that shows this member NO navigation (every entry
  // gated away from them, or none served at all) is an app they have no access
  // in yet. Say so, and offer Setup to a caller who can grant access: the
  // same `isWorkspaceAdmin` read the no-app empty state gates its Setup button
  // on, and the same Setup URL the `/setup` deep link resolves. The question is
  // asked of the trees as this member is shown them (objectui#12426), so a
  // member who can see no entry gets this answer, never a page the sidebar
  // hides.
  if (appServesNoNavigation(shownApp)) {
    return <AppNoAccessEmptyState app={app} setupPath={setupPath} />;
  }
  // A navigation with no landing: every entry the sidebar draws is a `url`,
  // `action` or `doc` link, or the items live only under `areas`, which the
  // resolver does not walk. The root renders no page of its own and the
  // sidebar offers the entries. It used to render the Studio app's overview,
  // `StudioHomePage`, which objectui#12113 retired.
  return null;
}

/**
 * Heuristic: distinguish a record id from a route fragment.
 *
 * Record ids in this system are URL-safe slugs (alnum + `_` / `-`), typically
 * 8+ chars (often 16+). They never collide with reserved second-segment
 * keywords used by the route table (`new`, `view`, `record`, `dashboard`,
 * `report`, `page`, `design`, `search`, `create-app`, `edit-app`).
 */
const RESERVED_SECOND_SEGMENTS = new Set([
  'new', 'view', 'record', 'edit',
  'dashboard', 'report', 'page',
  'design', 'search', 'create-app', 'edit-app',
  'metadata',
]);

function looksLikeRecordId(segment: string | undefined): boolean {
  if (!segment) return false;
  if (RESERVED_SECOND_SEGMENTS.has(segment)) return false;
  // Allow URL-safe slug chars; reject anything with `/`, `?`, `#`, spaces.
  if (!/^[A-Za-z0-9_-]+$/.test(segment)) return false;
  // Most record ids are at least 6 chars (UUID, ULID, nanoid all >=8).
  return segment.length >= 6;
}

/**
 * Translates pre-refactor metadata admin URLs
 * (`/apps/:app/component/metadata/resource/:name?type=:type`,
 *  `/apps/:app/component/metadata/directory`) into the new REST-style
 * shape (`/apps/:app/metadata/:type/:name`). Keeps bookmarks and any
 * still-unmigrated link producers working.
 */
function LegacyMetadataRedirect({ mode }: { mode: 'directory' | 'resource' }) {
  const location = useLocation();
  const appBase = location.pathname.replace(/\/component\/metadata\/.*$/, '');
  if (mode === 'directory') {
    return <Navigate to={`${appBase}/metadata${location.search}${location.hash}`} replace />;
  }
  const sp = new URLSearchParams(location.search);
  const type = sp.get('type') ?? '';
  const tail = location.pathname.match(/\/component\/metadata\/resource(\/.*)?$/)?.[1] ?? '';
  const target = type
    ? `${appBase}/metadata/${encodeURIComponent(type)}${tail}${location.hash}`
    : `${appBase}/metadata${location.hash}`;
  return <Navigate to={target} replace />;
}

/**
 * Redirects `/apps/:appName/:objectName/:recordId` shorthand to the
 * canonical `/apps/:appName/:objectName/record/:recordId` so externally
 * shared / pasted links work, and legacy URL producers that built the
 * shorthand keep functioning.
 */
function ShorthandRecordRedirect() {
  const { objectName, maybeRecordId } = useParams();
  const location = useLocation();
  if (objectName && looksLikeRecordId(maybeRecordId)) {
    const target = `${location.pathname.replace(/\/$/, '').replace(`/${maybeRecordId}`, `/record/${maybeRecordId}`)}${location.search}${location.hash}`;
    return <Navigate to={target} replace />;
  }
  return <RouteNotFound />;
}

/**
 * Visible "not found" fallback rendered for any unmatched URL inside the
 * console app shell. Previously these URLs produced a fully blank content
 * area with no indication that anything had gone wrong — users would think
 * the app had crashed. An explicit Empty state with a "back to app home"
 * action turns an opaque failure into a recoverable one.
 */
function RouteNotFound() {
  const navigate = useNavigate();
  const { t } = useObjectTranslation();
  return (
    <div className="flex h-full w-full items-center justify-center p-8">
      <Empty>
        <EmptyTitle>{t('console.notFound.title', { defaultValue: 'Page not found' })}</EmptyTitle>
        <EmptyDescription>
          {t('console.notFound.description', { defaultValue: 'The URL you followed does not match any view in this app.' })}
        </EmptyDescription>
        <div className="mt-4">
          <Button variant="outline" onClick={() => navigate(-1)}>
            {t('console.notFound.back', { defaultValue: 'Go back' })}
          </Button>
        </div>
      </Empty>
    </div>
  );
}

/**
 * objectui#13052 — the route slot when the by-name read of the object it
 * shows obtained no answer: inside the shell, never the boot splash, with a
 * Retry that asks again once (`invalidate` drops the failed read; the next
 * render asks it). The list's own load-failure copy: this is the same
 * question, a list that could not be loaded.
 */
function RouteObjectReadFailed({ onRetry }: { onRetry: () => void }) {
  const { t } = useObjectTranslation();
  return (
    <div className="flex h-full w-full items-center justify-center p-8">
      <Empty data-testid="route-object-read-failed">
        <EmptyTitle>{t('list.loadErrorTitle', { defaultValue: 'Couldn\u2019t load records' })}</EmptyTitle>
        <EmptyDescription>
          {t('list.loadErrorMessage', {
            defaultValue: 'Something went wrong while loading this data. Check your connection and try again.',
          })}
        </EmptyDescription>
        <div className="mt-4">
          <Button onClick={onRetry} data-testid="route-object-read-failed-retry">
            {t('common.retry', { defaultValue: 'Retry' })}
          </Button>
        </div>
      </Empty>
    </div>
  );
}

/**
 * objectui#12809 — whether the record-form overlay is open in the URL. Its
 * object definition comes from the `object` bucket on every route.
 */
function searchParamsHasRecordForm(search: string): boolean {
  const sp = new URLSearchParams(search);
  return sp.has(RECORD_FORM_PARAM) || sp.has(RECORD_FORM_OBJECT_PARAM);
}

const NO_OBJECTS: any[] = [];

/**
 * objectui#12809 — whether every bucket in `readsKey` (comma-joined) has
 * answered: ready, or failed (a failure is an answer the route renders).
 *
 * A bucket that answered once and is now refetching (a `refresh()`, a lapsed
 * TTL) keeps its items while it loads, so it still counts: the route stays
 * mounted instead of dropping to a skeleton. A bucket back at `idle` (an
 * organization switch or an `invalidate` dropped its items) waits again.
 *
 * A provider without `ensureType` / `getTypeStatus` (test doubles, hosts on an
 * older context) has nothing to wait on: settled, as the old preload read it.
 */
function useLazyMetadataSettled(
  readsKey: string,
  ensureType: ((type: string) => Promise<unknown>) | undefined,
  getTypeStatus: ((type: string) => string) | undefined,
): boolean {
  const answered = useRef(new Set<string>());
  const types = readsKey ? readsKey.split(',') : [];
  const statuses = types.map((type) => getTypeStatus?.(type) ?? 'idle');
  // Asked from an effect, never from render (the provider bumps its context
  // when an answer lands). Re-asked whenever one of them is back at `idle`.
  const idleKey = types.filter((_, i) => statuses[i] === 'idle').join(',');
  useEffect(() => {
    if (!ensureType) return;
    for (const type of readsKey.split(',')) if (type) void ensureType(type);
  }, [readsKey, idleKey, ensureType]);

  if (!ensureType || !getTypeStatus || types.length === 0) return true;
  let settled = true;
  types.forEach((type, i) => {
    const status = statuses[i];
    if (status === 'ready' || status === 'error') answered.current.add(type);
    else if (status === 'idle') answered.current.delete(type);
    if (!answered.current.has(type)) settled = false;
  });
  return settled;
}

/** The route slot while its metadata loads, shaped like what will land there. */
function RouteMetadataSkeleton({ reads }: { reads: string }) {
  const types = reads.split(',') as LazyMetadataType[];
  return (
    <div data-testid="route-metadata-skeleton" className="h-full">
      {types[0] === 'dashboard' ? <SkeletonDashboard /> : types.includes('page') ? <SkeletonDetail /> : <SkeletonGrid />}
    </div>
  );
}
