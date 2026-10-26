/**
 * Console building blocks — composable JSX elements that consumers assemble in
 * their own App.tsx to build the console routing tree.
 *
 * Previously this module exported a `createConsole(config)` factory that hid the
 * routing tree behind a config object. In practice every real project wants to
 * edit the routes directly (add /billing, tweak AuthGuard behaviour, reorder
 * providers), so we now export the pieces and let consumers write ~40 lines of
 * JSX in App.tsx. See examples/console-starter/src/App.tsx for a minimal example,
 * apps/console/src/App.tsx for one with custom system routes + CreateApp.
 */

import { Suspense, useEffect, useRef, useState, type ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { AuthGuard, useAuth, createAuthenticatedFetch } from '@object-ui/auth';
import { useObjectTranslation } from '@object-ui/i18n';
import { SchemaRendererProvider, ActionProvider, NotificationProvider } from '@object-ui/react';
import { NotificationAlerts, NotificationSnackbar } from '@object-ui/components';
import { presentNotificationToast } from '../chrome/notificationToast.js';
import { useActionModal } from '../hooks/useActionModal.js';
import { useConsoleActionRuntime } from '../hooks/useConsoleActionRuntime.js';
import {
  createObjectStackUserPreferenceFamily,
  createObjectStackUserStateAdapter,
} from '@object-ui/data-objectstack';
import { AdapterProvider, useAdapter } from '../providers/AdapterProvider.js';
import { withSettleSignal } from '../observability/settleSignal.js';
import { MetadataProvider, useMetadata } from '../providers/MetadataProvider.js';
import { useAppObjectScopePrefetch } from './appObjectScope.js';
import { appRouteSegment } from '../utils/appRoute.js';
import { SETUP_APP_PACKAGE_ID, SETUP_APP_NAME } from './setupApp.js';
import { useAiSurfaceEnabled } from '../hooks/useAiSurface.js';
import { useHomePath } from '../hooks/useHomePath.js';
import { PreviewModeProvider } from '../preview/PreviewModeContext.js';
import { NavigationProvider } from '../context/NavigationContext.js';
import { FavoritesProvider } from '../context/FavoritesProvider.js';
import { RecentItemsProvider } from '../context/RecentItemsProvider.js';
import { FlowPaletteRecentsProvider } from '../context/FlowPaletteRecentsProvider.js';
import {
  UserStateAdaptersProvider,
  useAttachListStateFamily,
  useAttachUserStateAdapters,
} from '../context/UserStateAdapters.js';
import {
  LIST_PREFERENCE_PREFIX,
  ListPreferencesProvider,
} from '../context/ListPreferencesProvider.js';
import { ThemeProvider } from '../chrome/ThemeProvider.js';
import { LoadingScreen } from '../chrome/LoadingScreen.js';
import { RedirectWithSplash } from '../chrome/RedirectWithSplash.js';
import { RemediationOverlay } from './RemediationOverlay.js';
import { HostNavigationBridge } from './HostNavigationBridge.js';
import { ConsoleElementApiOpen } from './ConsoleElementApiOpen.js';
import { ImpersonationBanner } from '../layout/ImpersonationBanner.js';
import { ReadRateBanner } from '../layout/ReadRateBanner.js';
import { StorageUsageBanner } from '../layout/StorageUsageBanner.js';

// The console's every pre-React / pre-auth gate (Suspense fallback, adapter
// not ready, org/auth loading) renders this. It used to be a bare, unbranded
// "Loading…" line — ~8s of blank chrome before the login redirect on a cold
// /_console load (framework#2615 P3). Delegate to the branded, boot-safe
// splash (logo + product name + step list) that the rest of the shell already
// uses, so the cold load looks like the product from the first frame.
export function LoadingFallback() {
  return <LoadingScreen />;
}

/**
 * The console ROOT action runtime — the same level the global
 * SchemaRendererProvider (dataSource) sits, so it reaches EVERY field widget,
 * including a relation field inside a create/edit form that renders in a Radix
 * Dialog portal (which sits above the lower per-view ActionProviders).
 *
 * It started as a modal-only provider (what lets a lookup's inline "create the
 * referenced record" open that object's OWN create form). But an
 * `ActionProvider` also decides what a `useAction()` consumer BELOW it can
 * dispatch, and this one carried no `handlers` map — so every `action:button`
 * outside ObjectView / RecordDetailView / PageView / DeclaredActionsBar bound
 * to a runner that could only open modals. A `type: 'flow'` action there failed
 * with "Flow handler not registered", which is one way a screen flow becomes
 * unlaunchable (framework#3528); `api` and `script` were equally dead.
 *
 * It now carries the shared console runtime's api / flow / script handlers and
 * its confirm / param / result / screen-flow dialogs, so those action types
 * work anywhere by default. Richer per-view providers still override it where
 * they apply.
 *
 * `modal` deliberately stays on the CLIENT-side `useActionModal` handler rather
 * than the runtime's server-action mapping: a modal action at this level is the
 * inline-create affordance above, not a server endpoint. Registering it in
 * `handlers` would take precedence over `onModal` and reroute those clicks to
 * `/api/v1/actions/...`.
 *
 * Must render inside MetadataProvider (useActionModal reads useMetadata).
 */
function GlobalActionRuntimeProvider({ dataSource, children }: { dataSource: unknown; children: ReactNode }) {
  const { modalHandler, modalElement } = useActionModal(dataSource);
  // objectui#12811 — the current app's object scope starts here, as soon as the
  // app list names the app: `AppContent` mounts only after the session's
  // permission read, and the whole object list this root used to load (through
  // `useActionModal`) loaded beside that read.
  useAppObjectScopePrefetch();
  const runtime = useConsoleActionRuntime({ dataSource });
  return (
    <ActionProvider
      context={runtime.actionProviderProps.context}
      onConfirm={runtime.actionProviderProps.onConfirm}
      onToast={runtime.actionProviderProps.onToast}
      onNavigate={runtime.actionProviderProps.onNavigate}
      onParamCollection={runtime.actionProviderProps.onParamCollection}
      onResultDialog={runtime.actionProviderProps.onResultDialog}
      onModal={modalHandler}
      handlers={{
        api: runtime.apiHandler,
        flow: runtime.flowHandler,
        script: runtime.serverActionHandler,
      }}
    >
      {children}
      {runtime.dialogs}
      {modalElement}
    </ActionProvider>
  );
}

/**
 * ConsoleShell — top-level provider stack shared by every console route.
 * Wraps children in ThemeProvider + NavigationProvider + FavoritesProvider +
 * NotificationProvider + Suspense so lazy route components get a default
 * loading fallback, dark/light/system theme switching, and a notification
 * system that honors the spec `displayType`.
 *
 * Place this inside a <BrowserRouter> and around your <Routes>:
 *
 *   <BrowserRouter>
 *     <ConsoleShell>
 *       <Routes>...</Routes>
 *     </ConsoleShell>
 *   </BrowserRouter>
 *
 * ── Notification surfaces (#3014) ──
 * Each spec display type has its own presentation, so the shell mounts the ones
 * with a single global home and leaves the rest to their owners:
 *
 *   toast     → `presentNotificationToast` (sonner, via `onToast`)
 *   snackbar  → <NotificationSnackbar />   here — it anchors itself bottom-center
 *   alert     → <NotificationAlerts />     here — a blocking dialog is global
 *   banner    → <NotificationBanners />    in `ConsoleLayout`, at the top of the
 *                                          content area, next to the draft /
 *                                          unpublished bars it sits with
 *   inline    → nothing here, by contract — an inline notification is rendered
 *               by the surface that RAISED it (`<NotificationInline scope=…/>`),
 *               which is the whole difference between it and a banner
 */
export function ConsoleShell({ children }: { children: ReactNode }) {
  return (
    /* objectui#4989 — hand published renderers this console's OWN navigate, so a
       destination they resolved (a form's ruled `submitBehavior.url`) is
       travelled to through the router that knows the deployment's basename
       instead of a full-page `window.location.assign` against the origin root.
       Outermost, because the renderers that read it are reached from every
       console route and several arrive through `ComponentRegistry`, where no
       prop could be passed. */
    <HostNavigationBridge>
      <ConsoleShellProviders>{children}</ConsoleShellProviders>
    </HostNavigationBridge>
  );
}

/** The provider stack itself — see {@link ConsoleShell}, which wraps it. */
function ConsoleShellProviders({ children }: { children: ReactNode }) {
  return (
    <ThemeProvider defaultTheme="system" storageKey="object-ui-theme">
      {/* `defaultDuration` matches ConsoleToaster's 4s toast default and
          `maxVisible` its `visibleToasts={4}`, so a snackbar and a toast raised
          together disappear together and the banner stack caps like the toast
          stack. No `defaultPosition`: nothing declared means the sonner
          container keeps placing toasts (it also serves the console's direct
          `toast.*` calls) and the snackbar keeps its own bottom anchor — a
          notification that DECLARES a position still overrides both. */}
      <NotificationProvider config={{ defaultDuration: 4000, maxVisible: 4 }} onToast={presentNotificationToast}>
        <NavigationProvider>
          <UserStateAdaptersProvider>
            <FavoritesProvider>
              <RecentItemsProvider>
                <FlowPaletteRecentsProvider>
                  <ListPreferencesProvider>
                    {/* objectui#4467 — the impersonation indicator. Above the
                        routes, so it is chrome for EVERY console page (home has
                        its own layout and would otherwise carry no indicator),
                        and in flow rather than overlaid, so it never covers the
                        header it warns about. Renders null on every ordinary
                        session. */}
                    <ImpersonationBanner />
                    {/* objectui#9954 — the environment admin's read-rate report.
                        Beside the impersonation indicator for the same reason it
                        is here: chrome for EVERY console page, including `/home`,
                        which has its own layout and would otherwise carry no
                        report. Renders null unless the control plane's verdict is
                        `anomalous`, so an ordinary session and an unmeasured
                        environment both see nothing — and a non-admin session
                        never even issues the request, nor does any session on a
                        runtime whose config does not serve `storageUsage`
                        (objectui#11002). */}
                    <ReadRateBanner />
                    {/* objectui#10439 — the environment admin's storage-capacity
                        banner, beside the read-rate report and behind the same
                        two gates (the admin, and the runtime serving
                        `storageUsage`); the two read one `/usage/storage` response.
                        Renders null unless the runtime's own verdict says `warn`
                        (80% and up) or `blocked` (uploads and imports refused). */}
                    <StorageUsageBanner />
                    <Suspense fallback={<LoadingFallback />}>{children}</Suspense>
                    {/* ADR-0069 — full-screen gate (expired password / required MFA) above all routes */}
                    <RemediationOverlay />
                    <NotificationSnackbar />
                    <NotificationAlerts />
                  </ListPreferencesProvider>
                </FlowPaletteRecentsProvider>
              </RecentItemsProvider>
            </FavoritesProvider>
          </UserStateAdaptersProvider>
        </NavigationProvider>
      </NotificationProvider>
    </ThemeProvider>
  );
}

/**
 * ConnectedShell — mounts the data layer (AdapterProvider + MetadataProvider).
 * Use this around any route element that needs metadata access, i.e. anything
 * rendering objects / dashboards / pages.
 */
export function ConnectedShell({ children }: { children: ReactNode }) {
  return (
    <AdapterProvider>
      {/* ADR-0037: one URL flag (?preview=draft) flips the whole metadata
          tree below into the draft-overlaid world. Above MetadataProvider so
          the provider itself reads through the right source. */}
      <PreviewModeProvider>
        <ConnectedShellInner>{children}</ConnectedShellInner>
      </PreviewModeProvider>
    </AdapterProvider>
  );
}

// The host's authenticated fetch, handed to the renderers as `apiFetch`
// (#2725): their own reads of the host's API (chart metadata, dataset
// dimension labels, record-permission probes) get the same Authorization /
// X-Tenant-ID / Accept-Language headers as the native adapter channel, so a
// cookie whose HMAC signature rotated (e.g. dev-server restart) no longer
// strands them on 401. `sameOriginOnly` keeps the bearer token off any
// third-party host a request may name, and
// withSettleSignal keeps these requests visible to the ADR-0054 C5 idle probe.
const apiProviderFetch = withSettleSignal(createAuthenticatedFetch({ sameOriginOnly: true }));

function ConnectedShellInner({ children }: { children: ReactNode }) {
  const adapter = useAdapter();
  const { language } = useObjectTranslation();
  // ── Session gate (objectui#4042) ──
  //
  // Everything below this line reads `/api/v1/meta/*`, which requires a
  // session. Mounting the metadata tree while `GET /auth/get-session` is still
  // in flight fires `meta/object` + `meta/view` + `meta/app` blind: on an
  // unauthenticated visitor they all come back 401, and the console's landing
  // route (`<Route path="/">`) mounts this shell with no AuthGuard above it, so
  // simply opening `/_console/` produced a screenful of red `HTTP request
  // failed` before the login form was even drawn.
  //
  // Waiting for auth to RESOLVE is the whole gate. We deliberately do not gate
  // on `isAuthenticated`: a consumer that mounts ConnectedShell outside an
  // AuthGuard still renders through once the session answer is known (unchanged
  // behaviour, including a legitimate 401 that must stay visible), and the
  // console's own login bounce is the route guard's job. `useAuth()` outside an
  // AuthProvider reports `isLoading: false`, so a provider-less embed is
  // untouched.
  //
  // Post-login flow is unchanged — AuthGuard already withholds every protected
  // route until auth resolves, so on those routes this gate is already open by
  // the time the shell mounts and the same queries fire, once each.
  const { isLoading: isAuthLoading } = useAuth();

  // ── Language switch → relabel without a page refresh (issue objectstack-ai/objectstack#1319) ──
  //
  // Static UI strings already flip reactively through react-i18next, and
  // metadata labels that have a translation key resolve client-side via
  // `useObjectLabel`. The gap is *server-resolved* labels (object/field/view
  // labels, action-dialog text) with no client key: renderers fetch those into
  // local state keyed by object name, so they never re-fetch on a language
  // change and the UI ends up half-translated until a hard refresh.
  //
  // We close the gap in two moves, both keyed off `language`:
  //   1. Drop the adapter's locale-blind metadata cache (render phase, before
  //      any child re-fetches) so the next read hits the network. This runs in
  //      render — not an effect — because the remount below mounts children
  //      (and their fetch effects) before a parent effect here would fire, so
  //      an effect-based clear would race and serve the stale entry.
  //   2. Remount the metadata subtree via `key={language}` so every renderer's
  //      fetch effect re-runs; combined with the new `Accept-Language` header
  //      (see `createAuthenticatedFetch`) the refetch comes back in the new
  //      locale. The adapter — and its live connection — sits above the key and
  //      is preserved, so this is an in-app relabel, not a reconnect.
  const lastLanguage = useRef<string | null>(null);
  if (adapter && lastLanguage.current !== null && lastLanguage.current !== language) {
    adapter.clearCache?.();
  }
  if (adapter) lastLanguage.current = language;

  if (!adapter || isAuthLoading) return <LoadingFallback />;
  // Expose the adapter via SchemaRendererContext so descendant hooks that fall
  // back to the context's `dataSource` (`useViewData`, `useElementDataSource`)
  // can resolve it.
  return (
    <SchemaRendererProvider dataSource={adapter} apiFetch={apiProviderFetch}>
      <MetadataProvider key={language} adapter={adapter}>
        {/* objectui#13323 — one open's API reads, shared by the navigation's
            gates and the page's elements. Inside the language key, so a
            switch of language reads again. */}
        <ConsoleElementApiOpen>
          <UserStateBridge />
          <GlobalActionRuntimeProvider dataSource={adapter}>
            {children}
          </GlobalActionRuntimeProvider>
        </ConsoleElementApiOpen>
      </MetadataProvider>
    </SchemaRendererProvider>
  );
}

/**
 * UserStateBridge — once we have an authenticated user + a connected data
 * adapter, plug ObjectStack-backed persistence into the favorites and
 * recent-items providers. Renders nothing.
 *
 * Failure modes (object schema not configured, network errors, etc.) are
 * absorbed by the adapter itself — the UI then transparently falls back to
 * localStorage-only behaviour.
 */
function UserStateBridge() {
  const { user } = useAuth();
  const dataSource = useAdapter();
  const attach = useAttachUserStateAdapters();
  const attachListState = useAttachListStateFamily();

  useEffect(() => {
    if (!user?.id || !dataSource) {
      attach('favorites', null);
      attach('recent', null);
      attach('flowPaletteRecents', null);
      attachListState(null);
      return;
    }
    const favorites = createObjectStackUserStateAdapter({
      dataSource,
      userId: user.id,
      key: 'ui.favorites',
    });
    const recent = createObjectStackUserStateAdapter({
      dataSource,
      userId: user.id,
      key: 'ui.recent',
    });
    const flowPaletteRecents = createObjectStackUserStateAdapter<string>({
      dataSource,
      userId: user.id,
      key: 'ui.flow.palette.recents',
    });
    // objectui#12418 — every object's list state, `ui.list.<object>`: a key
    // family, loaded by prefix in the same one read as the three slots above.
    const listState = createObjectStackUserPreferenceFamily({
      dataSource,
      userId: user.id,
      prefix: LIST_PREFERENCE_PREFIX,
    });
    attach('favorites', favorites);
    attach('recent', recent);
    attach('flowPaletteRecents', flowPaletteRecents);
    attachListState(listState);
    return () => {
      attach('favorites', null);
      attach('recent', null);
      attach('flowPaletteRecents', null);
      attachListState(null);
    };
  }, [user?.id, dataSource, attach, attachListState]);

  return null;
}

/**
 * RequireOrganization — redirects to /organizations when the multi-tenant
 * feature is enabled (user has orgs but no active one). Single-tenant
 * deployments (empty organizations list) render through.
 */
export function RequireOrganization({ children }: { children: ReactNode }) {
  const { activeOrganization, organizations, isOrganizationsLoading, getAuthConfig } = useAuth();
  // Multi-org (cloud) deployments route a brand-new, org-less user into the
  // guided "Create your workspace" flow; single-tenant self-host renders through.
  const [multiOrgEnabled, setMultiOrgEnabled] = useState<boolean | null>(null);
  useEffect(() => {
    let cancelled = false;
    getAuthConfig()
      .then((cfg: any) => { if (!cancelled) setMultiOrgEnabled(cfg?.features?.multiOrgEnabled !== false); })
      .catch(() => { if (!cancelled) setMultiOrgEnabled(false); });
    return () => { cancelled = true; };
  }, [getAuthConfig]);
  if (isOrganizationsLoading) return <LoadingFallback />;
  const orgList = organizations ?? [];
  const orgFeatureEnabled = orgList.length > 0 || !!activeOrganization;
  // `RedirectWithSplash` at every DECIDE below, not a bare `<Navigate>`
  // (objectui#6378 / #6507): this gate renders `LoadingFallback` while it waits
  // (one line up), and a bare redirect renders null — so the splash the user is
  // looking at is dropped and nothing replaces it until `/organizations`
  // renders at transition priority. Measured on the three sibling gates #6506
  // fixed: 41-147 ms of empty `#root`, a white flash on 67/87 boots. The
  // replacement paints the SAME `LoadingScreen` this gate was already showing,
  // so the handoff changes no pixels.
  if (orgFeatureEnabled && !activeOrganization)
    return <RedirectWithSplash to="/organizations" replace />;
  // No org at all: on multi-org, send them to /organizations (the create
  // screen); wait for the flag so we don't flash /home then redirect.
  if (orgList.length === 0 && !activeOrganization) {
    if (multiOrgEnabled === null) return <LoadingFallback />;
    if (multiOrgEnabled) return <RedirectWithSplash to="/organizations" replace />;
  }
  return <>{children}</>;
}

/**
 * RequireAiSurface — gate for the `/ai*` routes. The console is edition-agnostic
 * (MIT, runtime-gated): a Community Edition runtime serves no AI agent, so a
 * stale `/ai` bookmark or external link must not land on a broken/empty chat.
 * When the server serves no agent it redirects to `redirectTo` (home) instead.
 *
 * Availability is the live agent catalog (see {@link useAiSurfaceEnabled}) — the
 * same signal every other AI entry point now gates on, so the route is reachable
 * from exactly the entry points that are visible (no shown CTA that bounces back
 * to home, no hidden FAB to a working route). Waits for the catalog to resolve
 * before deciding so the redirect never flashes on first paint.
 *
 * WHICH home it bounces to is the DECLARED landing (objectui#7373), resolved by
 * `useHomePath()` — the default is no longer the launcher literal. A caller that
 * passes `redirectTo` still wins, and on a deployment that declares no landing
 * the hook answers the launcher, so every ordinary environment is unchanged.
 */
export function RequireAiSurface({
  children,
  redirectTo,
}: {
  children: ReactNode;
  /** Overrides the declared-home default. */
  redirectTo?: string;
}) {
  const homePath = useHomePath();
  const { enabled, isLoading } = useAiSurfaceEnabled();
  if (isLoading) return <LoadingFallback />;
  // Splash-preserving handoff (objectui#6507). This is a BOOT-path redirect
  // even though `/ai` is reachable from inside the console: every in-app entry
  // point gates on this same `useAiSurfaceEnabled` signal (`AppHeader`'s
  // assistant button, `ConsoleLayout`'s dock, `HomeLayout`/`HomePage`), so on a
  // runtime where this branch fires none of them is rendered. What reaches it
  // is a stale bookmark or an external link — a first navigation, with the
  // splash still up and no layout underneath.
  if (!enabled) return <RedirectWithSplash to={redirectTo ?? homePath} replace />;
  return <>{children}</>;
}

/**
 * AuthenticatedRoute — convenience wrapper composing AuthGuard + ConnectedShell
 * (+ optional RequireOrganization). Covers the common case for protected
 * routes. For bespoke needs, compose the primitives directly.
 */
export function AuthenticatedRoute({
  children,
  requireOrganization = true,
  loginPath = '/login',
}: {
  children: ReactNode;
  requireOrganization?: boolean;
  loginPath?: string;
}) {
  return (
    // The same splash-preserving handoff as the gates above, written as two
    // props rather than two returns (objectui#6507): `loadingFallback` paints
    // while the session resolves and `fallback` is what replaces it the moment
    // it decides. A bare `<Navigate>` there renders null, which is the same
    // blank viewport #6378 measured — and `apps/console` already converted its
    // own copy of this composition (`ProtectedRoute.tsx`) under #6506, so a
    // consumer assembling protected routes from THIS wrapper would otherwise
    // get the unfixed handoff.
    <AuthGuard
      fallback={<RedirectWithSplash to={loginPath} />}
      loadingFallback={<LoadingFallback />}
    >
      <ConnectedShell>
        {requireOrganization ? <RequireOrganization>{children}</RequireOrganization> : children}
      </ConnectedShell>
    </AuthGuard>
  );
}

/**
 * SystemRedirect — forwards legacy /system/* URLs to the canonical
 * /apps/setup/system/* location so bookmarks keep working. Suffix is preserved.
 *
 * #3611 — the bare `/system` bookmark used to land on the bare `/apps/setup`,
 * which on a zero-app deployment is the "No Apps Configured" empty state's own
 * URL. Every suffixed bookmark was already forwarded to `/apps/setup/system…`;
 * the bare one now agrees with them instead of dropping the `system` segment
 * that makes the hub mount at all.
 */
export function SystemRedirect() {
  // ⚠️ DELIBERATELY a bare `<Navigate>`, unlike every other redirect in this
  // file (objectui#6507). It does carry the null-render shape on a first
  // navigation — but it is the one site here that ALSO fires with the console
  // already painted: `SettingsView.tsx` navigates to `/system/settings` from a
  // button. That is gated on nothing, so it is live in exactly the runtimes this
  // component serves.
  // The #6507 triage ruling is explicit that a redirect firing under an
  // already-painted layout must KEEP that layout rather than gain a splash, so
  // converting this one would trade a boot-path blank for a full-screen splash
  // flashing over a working console. Splitting the two paths (deep link vs
  // in-app navigation) needs a measurement neither #6378 nor #6507 has taken.
  // Pinned as unconverted by `__tests__/bootRedirectCoverage.test.tsx`.
  const location = useLocation();
  const suffix = location.pathname.replace(/^\/system/, '');
  const target = suffix ? `/apps/setup/system${suffix}` : '/apps/setup/system';
  return <Navigate to={`${target}${location.search}${location.hash}`} replace />;
}

// The Setup app's identity lives in `./setupApp.ts` (objectui#12606), which the
// page header reads too; re-exported here so the package root keeps its names.
export { SETUP_APP_PACKAGE_ID, SETUP_APP_NAME };

/**
 * Minimal shape this resolver needs off each App metadata record. Structurally
 * identical to `appRoute.ts`'s `AppLike` — including the index signature, so an
 * app read out of metadata stays assignable to `appRouteSegment()`.
 */
type SetupAppLike = { name?: unknown; _packageId?: unknown } & Record<string, unknown>;

/**
 * The path `/setup` should forward to, resolved purely from the App list.
 * Extracted from the component so the policy is unit-testable without a
 * router/render — the same shape `resolveLandingPath` uses for `/`.
 *
 * The target is the setup app's ROOT (`/apps/<segment>`), never a hardcoded
 * page inside it: `AppContent.resolveLandingRoute()` already resolves an app
 * root to that app's first reachable navigation item, which for Setup is its
 * System Overview dashboard. Naming that dashboard here would fork the
 * "where does an app open" policy into a second place and let this alias drift
 * the moment Setup's nav is re-ordered.
 *
 * The segment is built by `appRouteSegment()` — the SAME helper the home
 * launcher's app cards use (`console/home/AppCard.tsx`), so the alias lands on
 * byte-identical URLs to clicking the 「系统设置」 card.
 *
 * ABSENT SETUP APP (a stripped deployment, a viewer without `setup.access` —
 * the app is server-filtered out of their metadata, or a publish still
 * landing): the fallback is the canonical package-id URL, NOT home and NOT the
 * bare `/apps/setup`. That is deliberate on both counts:
 *   - home is the defect this alias exists to fix (objectui#2794) — a deep link
 *     that silently lands somewhere else is indistinguishable from a broken one;
 *   - `/apps/setup` is `AppContent`'s `isSetupRoute` pseudo-route, which falls
 *     back to the DEFAULT app, i.e. it would silently render a different app.
 * `/apps/com.objectstack.setup` matches no pseudo-route, so `AppContent`'s own
 * `requestedAppMissing` branch handles it — the "App not available" screen with
 * a Retry, exactly what typing any other missing app's URL produces today. It
 * also self-heals: that branch re-checks metadata once before concluding.
 */
export function resolveSetupAppPath(apps: readonly SetupAppLike[] | null | undefined): string {
  const list = apps ?? [];
  const setupApp =
    list.find((a) => a?._packageId === SETUP_APP_PACKAGE_ID) ??
    list.find((a) => a?.name === SETUP_APP_NAME);
  return `/apps/${appRouteSegment(setupApp) ?? SETUP_APP_PACKAGE_ID}`;
}

/**
 * SetupRedirect — the stable `/setup` deep link for platform administration
 * (objectui#2794). System settings had no direct URL: it was reachable only by
 * clicking the home launcher's 「系统设置」 card, so it could not be bookmarked,
 * shared, or named in a support/runbook instruction.
 *
 * Same shape as {@link SystemRedirect} beside it — resolve a target, then one
 * `<Navigate replace>`; search and hash carry over. The difference is that this
 * target is READ FROM METADATA rather than spelled out, because the setup app's
 * canonical address is whatever `appRouteSegment()` builds for it (ADR-0048
 * keys `/apps/<segment>` on the package id, falling back to the app name).
 *
 * Mount it behind the host's authenticated route wrapper, so an unauthenticated
 * deep link goes to login with a redirect back to `/setup` under the host's
 * existing auth-redirect contract rather than a second spelling of it.
 */
export function SetupRedirect() {
  const { apps, loading } = useMetadata();
  const location = useLocation();
  if (loading) return <LoadingFallback />;
  const target = resolveSetupAppPath(apps as SetupAppLike[] | undefined);
  // Splash-preserving handoff (objectui#6507) — the gate one line up renders
  // `LoadingFallback`, so a bare redirect would drop it for nothing. Unlike
  // `SystemRedirect` beside it, `/setup` has no in-app producer: it is mounted
  // as a route and reached by bookmark, deep link or runbook, i.e. always as a
  // first navigation with the splash up. (The home launcher's card links to
  // `/apps/<segment>` directly, not through this alias.)
  return <RedirectWithSplash to={`${target}${location.search}${location.hash}`} replace />;
}
