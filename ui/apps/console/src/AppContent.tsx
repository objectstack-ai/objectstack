/**
 * AppContent — console-specific thin wrapper around DefaultAppContent.
 *
 * The full inner-SPA shell (ConsoleLayout, CommandPalette, ObjectView etc.)
 * lives in @object-ui/app-shell as DefaultAppContent. This wrapper only
 * injects console-specific system routes (AppManagement / Profile / Settings
 * and the legacy-URL redirects) and routes an approval request's record reads
 * to the approvals routes (`ApprovalRecordReads`) — third-party hosts that
 * don't need those use DefaultAppContent directly.
 */

import { lazy, Suspense, useMemo, type ReactNode } from 'react';
import { Route, useParams, useLocation, Navigate } from 'react-router-dom';
import { DefaultAppContent, ENVIRONMENT_SCOPE_QUERY, LoadingScreen, useAdapter } from '@object-ui/app-shell';
import { AdapterCtx } from '@object-ui/react';
import { MePermissionsProvider, ServerReadScope } from '@object-ui/permissions';
import { createAuthenticatedFetch } from '@object-ui/auth';
import type { DataSource } from '@object-ui/types';
import { LocalizationFetchProvider } from './LocalizationFetchProvider';
import { InAppFormRoute } from './components/InternalFormRoute';
import { WorkspaceTimezonePrompt } from './pages/settings/WorkspaceTimezonePrompt';
import { APPROVAL_ACTION_OBJECT, APPROVAL_REQUEST_OBJECT, routeApprovalRecordReads } from './services/approvalRequestsDataSource';

const AppManagementPage = lazy(() => import('./pages/system/AppManagementPage').then(m => ({ default: m.AppManagementPage })));
const ProfilePage = lazy(() => import('./pages/system/ProfilePage').then(m => ({ default: m.ProfilePage })));
const ApprovalsInboxPage = lazy(() => import('./pages/system/ApprovalsInboxPage').then(m => ({ default: m.ApprovalsInboxPage })));
const AiPendingActionsPage = lazy(() => import('./pages/system/AiPendingActionsPage').then(m => ({ default: m.AiPendingActionsPage })));
const AuditLogPage = lazy(() => import('./pages/system/AuditLogPage').then(m => ({ default: m.AuditLogPage })));
const SettingsHub = lazy(() => import('./pages/settings/SettingsHub').then(m => ({ default: m.SettingsHub })));
const SettingsView = lazy(() => import('./pages/settings/SettingsView').then(m => ({ default: m.SettingsView })));
const ApiConsolePage = lazy(() => import('./pages/developer/ApiConsolePage').then(m => ({ default: m.ApiConsolePage })));
const FlowRunsPage = lazy(() => import('./pages/developer/FlowRunsPage').then(m => ({ default: m.FlowRunsPage })));
const PublicFormsPage = lazy(() => import('./pages/developer/PublicFormsPage').then(m => ({ default: m.PublicFormsPage })));
const IntegrationsPage = lazy(() => import('./pages/developer/IntegrationsPage').then(m => ({ default: m.IntegrationsPage })));
// ADR-0048 — package docs are viewed inside their package container:
// /apps/:packageId/docs/:name (DocPage is a default export), with an
// app-scoped index at /apps/:packageId/docs (AppDocsIndex).
const DocPage = lazy(() => import('./pages/DocPage'));
const AppDocsIndex = lazy(() => import('./pages/AppDocsIndex'));
const DocsSlug = lazy(() => import('./pages/DocsSlug'));
const DocsLayout = lazy(() => import('./pages/DocsLayout'));

// Note: marketplace routes (`system/marketplace`, `system/marketplace/:packageId`)
// are registered by DefaultAppContent in @object-ui/app-shell so they're
// available to every host (including framework/console).

/**
 * Forwards legacy `system/objects[/:objectName]` URLs to the metadata-admin
 * engine, preserving the active-app prefix. The engine routes are the
 * REST-style `…/metadata/object/:name` (edit) and `…/metadata/object` (list),
 * declared by `DefaultAppContent` in `@object-ui/app-shell`.
 *
 * NOT `…/component/metadata/resource/:name?type=object` (objectui#3639).
 * That spelling pre-dates the REST-style nesting and is no longer a page at
 * all: app-shell declares it as a legacy *alias* whose element is
 * `LegacyMetadataRedirect`, i.e. a second `<Navigate>` onto precisely the
 * target built below. Emitting it here bought a redundant hop and, worse,
 * documented the alias as if it were canonical. The alias route itself stays
 * (bookmarks and external links still land on it) — we simply stop feeding it
 * from our own code.
 */
function ObjectRedirect() {
  const { objectName } = useParams<{ objectName?: string }>();
  const location = useLocation();
  const prefix = location.pathname.replace(/\/(system\/)?objects(\/.*)?$/, '');
  const target = objectName
    ? `${prefix}/metadata/object/${objectName}`
    : `${prefix}/metadata/object`;
  return <Navigate to={target} replace />;
}

/**
 * Forwards legacy `system/metadata[/:metadataType[/:itemName]]` URLs to the
 * metadata-admin engine's own REST-style routes: `…/metadata` (directory),
 * `…/metadata/:type` (one type's list), `…/metadata/:type/:name` (one item).
 * The legacy page-based editor was removed once the server's `/api/v1/meta`
 * endpoint started emitting JSON Schema per type, letting the engine render
 * every type generically.
 *
 * Those really are the engine's routes now — unlike the `component/metadata/…`
 * spelling this used to emit, which is itself a legacy alias that only
 * `<Navigate>`s onto the same destinations (objectui#3639). Two notes on
 * staying byte-identical to what that alias hop produced: `:type` is
 * percent-encoded (the alias carried it through `?type=` and the alias hop
 * encoded it back into the path), while `:name` is passed through verbatim
 * (the alias hop forwarded its path tail untouched).
 */
function MetadataRedirect() {
  const { metadataType, itemName } = useParams<{ metadataType?: string; itemName?: string }>();
  const location = useLocation();
  // Strip an optional leading `system/` too — legacy nav uses
  // `…/system/metadata/:type`, and the engine routes live at the app root
  // (`…/metadata/…`), not under `system/`.
  const prefix = location.pathname.replace(/\/(system\/)?metadata(\/.*)?$/, '');
  const base = `${prefix}/metadata`;
  const target = !metadataType
    ? base
    : itemName
      ? `${base}/${encodeURIComponent(metadataType)}/${itemName}`
      : `${base}/${encodeURIComponent(metadataType)}`;
  return <Navigate to={target} replace />;
}

/**
 * Forwards the retired `system/{users,organizations,roles,positions,permissions}`
 * console pages onto the canonical object routes served by the generic
 * `…/:objectName` route in `@object-ui/app-shell` (objectui#3655).
 *
 * These five were real routes until `apps/console` was slimmed for third-party
 * customisation (cccdf84d7): "Delete bespoke /system/* wrapper pages
 * (User/Role/Permission/Audit/Org) … these objects are now contributed by
 * framework plugins (plugin-auth, -security, -audit) into the Setup app
 * navigation and resolved via the generic /apps/setup/<object_name> route."
 * The pages went; the URLs did not — `UnifiedSidebar`'s `sys-*` cluster still
 * emits three of them (`users`, `organizations`, `roles`), bookmarks carry all
 * five. Until objectui#3743 retired it, the system hub's card wall was the
 * in-app producer of the other two (`positions`, `permissions`); those two now
 * arrive from bookmarks only. Nothing declared them
 * afterwards, so they fell through to app-shell's tail and produced TWO
 * different failures depending on the word's length (`looksLikeRecordId`
 * requires 6+ chars): `users` / `roles` reached `RouteNotFound`, while
 * `organizations` / `positions` were rewritten to
 * `…/system/record/<word>` and rendered `RecordDetailView` for an
 * object literally named `system`. Both landings are measured in
 * `__tests__/AppContent.systemHubRoutes.test.tsx`.
 *
 * The object names are the framework's, not this repo's — read off
 * `platform-objects`' Setup-app navigation contributions and plugin-security's:
 *
 *   users         -> sys_user          (`nav_users`)
 *   organizations -> sys_organization  (`nav_organizations`, the LIST — the
 *                                       record-scoped `nav_organization`
 *                                       needs a runtime `{current_org_id}`
 *                                       that a static redirect cannot resolve)
 *
 * Three of the five no longer land on an object at all (objectui#7611):
 * `roles`, `positions` and `permissions` name the security CATALOG, which
 * ADR-0131 D3 moves into the environment registry, so they forward onto the
 * Setup catalog — the metadata-admin list in its environment scope — through
 * {@link SystemCatalogRedirect} below.
 *
 * Same shape as `ObjectRedirect` / `MetadataRedirect` above (a legacy URL is
 * translated, the page is not resurrected), including their treatment of
 * `location.search` / `location.hash`: neither is forwarded. None of these
 * URLs has ever carried one.
 */
function SystemObjectRedirect({ objectName }: { objectName: string }) {
  const location = useLocation();
  // The matched path is always `<prefix>/system/<one segment>`; anchoring at
  // the end keeps an app segment that happens to be spelled `system` intact.
  const prefix = location.pathname.replace(/\/system\/[^/]+\/?$/, '');
  return <Navigate to={`${prefix}/${objectName}`} replace />;
}

/**
 * Forwards the retired `system/{roles,positions,permissions}` console pages
 * onto the Setup CATALOG (objectui#7611): the metadata-admin list of the
 * registry type, in its environment scope (`…/metadata/<type>?scope=environment`,
 * `catalog-scope.ts` in `@object-ui/app-shell`).
 *
 * ADR-0131 D3 gives positions and permission sets one home, the environment
 * registry, and D7 says Setup lists that registry; the ruling that unblocked
 * objectui#7611 says the Setup pages are the existing metadata-admin pages,
 * re-routed. The words map as they always did — `roles` was ADR-0090 D3's old
 * name for positions, and objectui#3655 decision A bound `permissions` to the
 * permission-set surface (layer 2), not the capability definitions (layer 1).
 * Same prefix handling, and the same treatment of `location.search` /
 * `location.hash`, as {@link SystemObjectRedirect}.
 */
function SystemCatalogRedirect({ type }: { type: 'position' | 'permission' }) {
  const location = useLocation();
  const prefix = location.pathname.replace(/\/system\/[^/]+\/?$/, '');
  return <Navigate to={`${prefix}/metadata/${type}?${ENVIRONMENT_SCOPE_QUERY}`} replace />;
}

/**
 * The bare `…/system` landing: forwards onto `…/system/settings`, the settings
 * hub (objectui#3743).
 *
 * This URL used to render `SystemHubPage`, a hand-written card wall that
 * mirrored the navigation next to it: its own card array, its own count
 * queries, its own badge copy. Every change to the object or permission model
 * had to be copied into it by hand, and the retirement ruling lists the repair
 * rounds it needed for drifting (objectui#3670, #3679, #3680, #3686, #3655).
 * objectui#3743 retired it. The
 * URL stays, because app-shell sends users here: `UnifiedSidebar`'s
 * `sys-settings` entry, the zero-app empty state's "System Settings" button,
 * the home Quick Action and the legacy `/system` bookmark redirect all target
 * `/apps/setup/system`.
 *
 * WHERE it lands is read off the navigation, not chosen here. `system/settings`
 * is the one system entry that all three navigations declared when this
 * redirect landed (a reading taken once — nothing re-derives it):
 *
 *   - the framework Setup app: `nav_settings_hub` ("All Settings",
 *     `/apps/setup/system/settings`), from `platform-objects`' Setup
 *     navigation contributions;
 *   - `AppSidebar.systemFallbackNavigation`: `sys-config`;
 *   - `UnifiedSidebar`'s `/home` Administration cluster: `sys-config`.
 *
 * The page is driven by a registry too: `SettingsHub` lists the settings
 * manifests the server returns for this user, so nothing on it is hand-kept.
 * The target is also declared in both `DefaultAppContent` route tables (this
 * fragment is passed as `extraRoutes` AND `extraRoutesNoApp`), so it renders on
 * a zero-app deployment. Redirecting to the app root instead would not: there,
 * `/apps/setup` is the "No Apps Configured" empty state whose "System Settings"
 * button brings the user here, which would be a loop (objectui#3590).
 *
 * Resolved relative to this route's own match (`…/system`), so the active-app
 * prefix is kept. Same treatment of `location.search` / `location.hash` as
 * `SystemObjectRedirect` above: neither is forwarded, because no producer
 * sends either.
 */
function SystemLandingRedirect() {
  return <Navigate to="settings" replace />;
}

// Exported for `__tests__/AppContent.legacyRedirects.test.tsx`, which mounts
// this exact fragment in a bare `MemoryRouter` to measure the redirect chain.
// Transcribing the routes into the test instead would let the copy drift from
// the original — which is precisely how the `component/metadata/resource`
// spelling survived here long after it stopped being canonical (objectui#3639).
export const systemRoutes = (
  <>
    <Route path="system" element={<SystemLandingRedirect />} />
    <Route path="system/apps" element={<Suspense fallback={<LoadingScreen />}><AppManagementPage /></Suspense>} />
    <Route path="system/profile" element={<Suspense fallback={<LoadingScreen />}><ProfilePage /></Suspense>} />
    <Route path="system/approvals" element={<Suspense fallback={<LoadingScreen />}><ApprovalsInboxPage /></Suspense>} />
    <Route path="system/ai-approvals" element={<Suspense fallback={<LoadingScreen />}><AiPendingActionsPage /></Suspense>} />
    <Route path="system/audit-log" element={<Suspense fallback={<LoadingScreen />}><AuditLogPage /></Suspense>} />
    <Route path="system/settings" element={<Suspense fallback={<LoadingScreen />}><SettingsHub /></Suspense>} />
    <Route path="system/settings/:namespace" element={<Suspense fallback={<LoadingScreen />}><SettingsView /></Suspense>} />
    {/* No bare `developer` route (objectui#10520): the Developer Hub card wall
        retired once all four of its destinations were `developer:*` registry
        keys that framework navigation can name. A `/developer` bookmark falls
        through to app-shell's generic `:objectName` route instead of a blank
        screen; what it lands on is measured in
        `__tests__/AppContent.systemHubRoutes.test.tsx`. The sub-page routes
        below stay for bookmarks and deep links. */}
    <Route path="developer/api-console" element={<Suspense fallback={<LoadingScreen />}><ApiConsolePage /></Suspense>} />
    <Route path="developer/flow-runs" element={<Suspense fallback={<LoadingScreen />}><FlowRunsPage /></Suspense>} />
    <Route path="developer/public-forms" element={<Suspense fallback={<LoadingScreen />}><PublicFormsPage /></Suspense>} />
    <Route path="developer/integrations" element={<Suspense fallback={<LoadingScreen />}><IntegrationsPage /></Suspense>} />
    {/* ADR-0048 — package docs under the package container: app-scoped index
        (/apps/:packageId/docs) + single-doc viewer (/apps/:packageId/docs/:name) */}
    {/* ADR-0046 §6 — the docs layout fetches book + doc once and shares it with
        the app-scoped index, book landings, and reader (one segment resolves to
        a book landing or redirects a flat doc to /docs/<book>/<name>). */}
    <Route path="docs" element={<Suspense fallback={<LoadingScreen />}><DocsLayout /></Suspense>}>
      <Route index element={<Suspense fallback={<LoadingScreen />}><AppDocsIndex /></Suspense>} />
      <Route path=":slug" element={<Suspense fallback={<LoadingScreen />}><DocsSlug /></Suspense>} />
      <Route path=":slug/:name" element={<Suspense fallback={<LoadingScreen />}><DocPage /></Suspense>} />
    </Route>
    {/* Legacy URL redirects → metadata-admin engine (zero-cost compatibility). */}
    <Route path="system/objects" element={<ObjectRedirect />} />
    <Route path="system/objects/:objectName" element={<ObjectRedirect />} />
    <Route path="system/metadata" element={<MetadataRedirect />} />
    <Route path="system/metadata/:metadataType" element={<MetadataRedirect />} />
    <Route path="system/metadata/:metadataType/:itemName" element={<MetadataRedirect />} />
    {/* Legacy URL redirects → the framework-owned system objects (objectui#3655),
        and — since objectui#7611 — the Setup catalog for the last three
        (`SystemCatalogRedirect`: positions and permission sets are registry
        items, ADR-0131 D3). The history below is why `permissions` means the
        permission-set surface. All five resolve. `system/permissions` was the one held back in PR
        #3673: the framework splits what this console calls "Permissions" into
        TWO Setup entries, and picking one on a hunch would have bound every
        future click and bookmark to a surface nobody chose.

          `sys_capability`     (nav "Capabilities") — ADR-0066 layer 1, the
            DEFINITION registry of "what can be done". Its own docblock says it
            is what the ADR "loosely floats" as `sys_permission` — the name the
            retired page used — so LINEAGE points here.
          `sys_permission_set` (nav "Permission Sets") — ADR-0066 layer 2, the
            grant/assignment container the permissions docs call "the only
            capability container" (object CRUD + field security + access depth
            + system capabilities). FUNCTION points here.

        Decided as A, `sys_permission_set` (objectui#3655): the card that
        emitted this URL read "Manage permission rules and assignments", and
        rules-and-assignments is layer 2 — the definition catalog is what you
        reference BY NAME from a set, not what you assign. Option C, retiring
        that bespoke card wall, was ruled and carried out later (objectui#3743);
        the redirect stays, because it is what keeps old bookmarks resolving.

        One correction worth leaving here, since it circulated while this was
        open: the "capabilities are platform-locked, permission sets are the
        admin-CRUD one" reading does NOT survive a re-read of the framework.
        BOTH objects are `managedBy: 'config'` with `protection.lock:
        'no-overlay'`, and both docblocks say the lock is on the SCHEMA while
        tenants/admins may add rows. The layer-1 / layer-2 split above is the
        distinction that actually holds. */}
    <Route path="system/users" element={<SystemObjectRedirect objectName="sys_user" />} />
    <Route path="system/organizations" element={<SystemObjectRedirect objectName="sys_organization" />} />
    <Route path="system/roles" element={<SystemCatalogRedirect type="position" />} />
    <Route path="system/positions" element={<SystemCatalogRedirect type="position" />} />
    <Route path="system/permissions" element={<SystemCatalogRedirect type="permission" />} />
  </>
);

/** One routed adapter per console adapter, keyed on the adapter object itself. */
const recordReadsByAdapter = new WeakMap<object, unknown>();

function approvalRecordReadsFor<T extends DataSource>(adapter: T): T {
  const hit = recordReadsByAdapter.get(adapter) as T | undefined;
  if (hit) return hit;
  const routed = routeApprovalRecordReads(adapter);
  recordReadsByAdapter.set(adapter, routed);
  return routed;
}

/**
 * Every surface that opens an approval request reads it through the approvals
 * routes (objectui#12045, B1 of objectui#2763).
 *
 * The console's adapter is the data API. For an approval request that is the
 * wrong door for a record page: it attaches neither the `viewer` block the
 * request's declared decision actions gate on nor the `decision_progress`
 * tally, and it refuses the request's timeline (`sys_approval_action`) to an
 * ordinary approver. The approvals routes answer all three for anyone who is a
 * party to the request.
 *
 * A request opens on more than one surface, and `DefaultAppContent` hands each
 * of them the adapter this context provides: its record route, an
 * `ObjectView` drawer or split overlay (when a view authors one; with none,
 * the object's field count opens the record route), and the record views
 * embedded in the object data page and in an interface list page. So the
 * re-routing is done once, here, for all of them, rather than once per
 * surface: below this provider, `useAdapter()` answers the console's adapter
 * with a request's `findOne` and its timeline read sent to the approvals
 * routes (`routeApprovalRecordReads`). Lists of requests, and every other
 * read and member, stay the adapter's.
 *
 * The routed adapter is cached on the adapter object in a `WeakMap`, never in
 * a `useMemo`: every surface below keys its reads on this identity, and
 * React may discard a memo (AGENTS.md #10).
 *
 * The same surfaces gate what they draw on the client's read verdicts, which
 * mirror the DATA API's rule from `/auth/me/permissions` (objectui#13324):
 * every row is folded down to the fields the caller may read, and a related
 * list of an object the caller may not read is not drawn. That answer is the
 * wrong rule for what the approvals routes serve: objectstack keeps the data
 * API closed on both approval objects to everyone but administrators, so a
 * member's answer names neither, both verdicts fail closed for both, and the
 * record page folded the request down to its `id` — no fields, no `viewer`, so
 * no decision action — and dropped its Timeline
 * (objectstack-ai/objectstack#25228). So this provider also leaves the reads of
 * both objects to the server (`ServerReadScope`): the approvals routes serve
 * each party what it may see, and a list of requests, still read through the
 * data API, is refused to a member or comes back with the fields the caller
 * may not read already removed. Writes and every other object keep the
 * enclosing answer. ⛔ The fix is not a read grant on either object: the data
 * API stays closed to members, as objectstack intends.
 */
export function ApprovalRecordReads({ children }: { children: ReactNode }) {
  const adapter = useAdapter();
  return (
    <AdapterCtx.Provider value={adapter ? approvalRecordReadsFor(adapter) : null}>
      <ServerReadScope objects={APPROVAL_READ_OBJECTS}>{children}</ServerReadScope>
    </AdapterCtx.Provider>
  );
}

/** The objects whose rows `ApprovalRecordReads` reads through the approvals routes. */
const APPROVAL_READ_OBJECTS = [APPROVAL_REQUEST_OBJECT, APPROVAL_ACTION_OBJECT] as const;

/**
 * The console's ONE `/auth/me/permissions` source, shared by Home and every app
 * (objectui#12700).
 *
 * It used to be mounted inside `AppContent`, the element of `/apps/:appName/*`
 * alone, so `/home` had no permission answer at all: Home's bell and activity
 * card derive their roster from every app's navigation, and a
 * `current_user.can(object, verb)` gate there could only fault (reported on
 * every console load, and withheld). `App.tsx` now mounts this once, as the
 * element of a pathless layout route whose only children are `/home` and
 * `/apps/:appName/*`. Moving between the two keeps the layout element, so the
 * provider (its one fetch and its one cache) survives the navigation instead
 * of being duplicated per route.
 *
 * ⛔ `/studio/*` is NOT under it, on purpose: `components/studioEntry.ts` says
 * why installing this context over the builder would change what it renders
 * for a holder.
 *
 * The loading and error posture is the one `/apps` always had: nothing below
 * renders until the answer arrives, and a failure shows the console's error
 * splash with its Retry.
 */
export function ConsolePermissionsScope({ children }: { children: ReactNode }) {
  const serverUrl = import.meta.env.VITE_SERVER_URL || '';
  const endpoint = `${serverUrl}/api/v1/auth/me/permissions`;
  // [#2926 ④] /me/permissions must carry the Bearer token like every other
  // data call (same wrapper AdapterProvider uses) — with the cookie-only
  // default fetch, a token-only session resolved as anonymous and FLS
  // rendering fell open (restricted fields rendered editable).
  const authFetch = useMemo(() => createAuthenticatedFetch(), []);
  return (
    <MePermissionsProvider
      endpoint={endpoint}
      fetcher={authFetch}
      loadingFallback={<LoadingScreen />}
      // Without this, the provider's error state renders `loadingFallback` too —
      // an eternal spinner with a `retry` nobody can reach. The provider already
      // re-attempts a transient failure (a cold environment kernel answers 503 +
      // `Retry-After` while it warms, objectstack#4159); this is what the user
      // sees once those are exhausted, and `LoadingScreen` has carried the
      // error + retry affordance all along.
      errorFallback={(err, retry) => <LoadingScreen error={err.message} onRetry={retry} />}
    >
      {children}
    </MePermissionsProvider>
  );
}

/**
 * The internal form inside an app, `/apps/:appName/forms/:name`
 * (objectui#13433) — the twin of the app-less `/forms/:name` in `App.tsx`,
 * rendering the same `FormPage` inside the app's own shell. A `type: 'form'`
 * action fired from an app route opens here (`hostInConsolePath` in
 * app-shell); `InternalFormRoute.tsx` says why the app-less route stays.
 *
 * Only in the app route table: the no-app table serves a deployment with no
 * app to be inside, and a form there keeps the app-less route.
 */
const appFormRoutes = (
  <Route path="forms/:name" element={<InAppFormRoute />} />
);

/** The host routes of the app route table: the system routes plus the in-app form. */
export const appRoutes = (
  <>
    {systemRoutes}
    {appFormRoutes}
  </>
);

/**
 * The element of `/apps/:appName/*`. It renders under `ConsolePermissionsScope`
 * (mounted by `App.tsx` above this route), never without it.
 */
export function AppContent() {
  const serverUrl = import.meta.env.VITE_SERVER_URL || '';
  const localizationEndpoint = `${serverUrl}/api/v1/auth/me/localization`;
  // The ObjectStack upload destination for ImageField / FileField /
  // CommentAttachment used to be mounted HERE, and that was the defect
  // objectui#10131 measured: this component is the element of a single route
  // (`/apps/:appName/*`), while `ConnectedShell`'s
  // `GlobalActionRuntimeProvider` renders the action-param dialog and the
  // `ModalForm` a modal action opens as SIBLINGS of the route element. Those
  // dialogs therefore sat outside the provider, `useUpload()` fell open to
  // `createObjectUrlAdapter()` without a word, and a file picked in one of
  // them reached the engine as an inline blob object with no request ever
  // sent. It now lives in `App`, above `ConsoleShell`, so every console
  // surface shares one upload destination — see the rationale on
  // `uploadAdapter` there.
  return (
    <>
      <LocalizationFetchProvider endpoint={localizationEndpoint}>
        <ApprovalRecordReads>
          <DefaultAppContent
            extraRoutes={appRoutes}
            extraRoutesNoApp={systemRoutes}
          />
        </ApprovalRecordReads>
      </LocalizationFetchProvider>
      {/* objectui#11758 — asks an administrator once to set a still-default
          workspace timezone. Under `ConsolePermissionsScope`, because that
          provider is what answers whether this session may write the
          setting; mounted once for the whole app shell, beside the routes. */}
      <WorkspaceTimezonePrompt />
    </>
  );
}
