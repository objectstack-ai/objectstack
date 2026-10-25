/**
 * ObjectStack Console — fork-ready runtime console template.
 *
 * Owns the full route tree including unauthenticated auth surfaces
 * (login, register, forgot/reset password, verify-email, setup,
 * oauth/consent, auth/device, accept-invitation). The legacy Account
 * SPA at `/_account/*` is being retired — these routes now live here
 * in the Console SPA so a single bundle covers the whole experience.
 *
 * Console-specific extras (system / settings / legacy metadata editor)
 * are injected via {@link AppContent}, which wraps `DefaultAppContent`
 * with extra `<Route>` children.
 */

import { lazy, Suspense, useMemo } from 'react';
import { BrowserRouter, Routes, Route, Navigate, Outlet } from 'react-router-dom';
import { AuthProvider, useAuth, createAuthenticatedFetch } from '@object-ui/auth';
import { UploadProvider, createObjectStackUploadAdapter } from '@object-ui/providers';
import { DevMasterDetail } from './dev/DevMasterDetail';
import { DevLists } from './dev/DevLists';
import { DevModal } from './dev/DevModal';
import { DevLookup } from './dev/DevLookup';
import { DevRowActions } from './dev/DevRowActions';
import {
  ConsoleShell,
  RequireAiSurface,
  SystemRedirect,
  ConsoleToaster,
  LoadingScreen,
  DefaultHomeLayout,
  DefaultHomePage,
  DefaultOrganizationsLayout,
  DefaultOrganizationsPage,
  DefaultOrganizationLayout,
  DefaultMembersPage,
  DefaultInvitationsPage,
  DefaultSettingsPage,
  DefaultAcceptInvitationPage,
  RedirectWithSplash,
} from '@object-ui/app-shell';

import { AppContent, ConsolePermissionsScope } from './AppContent';
import { publishAuthState } from './i18nSession';
import { FaviconSync } from './components/FaviconSync';
import { RootLandingRedirect } from './components/RootLandingRedirect';
import { ProtectedRoute } from './components/ProtectedRoute';
import { studioRoutes } from './components/StudioRoute';
import { SetupRoute } from './components/SetupRoute';
import { FormPage } from './components/FormPage';
import { InternalFormRoute } from './components/InternalFormRoute';
import { MetadataHmrReloader } from './components/MetadataHmrReloader';
import { LoginPage } from './pages/auth/LoginPage';
import { RegisterPage } from './pages/auth/RegisterPage';
import { ForgotPasswordPage } from './pages/auth/ForgotPasswordPage';
import { ResetPasswordPage } from './pages/auth/ResetPasswordPage';
import { SetPasswordPage } from './pages/auth/SetPasswordPage';
import { VerifyEmailPage } from './pages/auth/VerifyEmailPage';
import { VerifyEmailPromptPage } from './pages/auth/VerifyEmailPromptPage';
import { OAuthConsentPage } from './pages/auth/OAuthConsentPage';
import { DeviceAuthPage } from './pages/auth/DeviceAuthPage';

/*
 * Package documentation portal (ADR-0046 section 6), lazy on purpose.
 *
 * Nothing on a normal console page load visits /docs, and `DocPage` is the
 * only console-owned module that reaches `@object-ui/plugin-markdown`. These
 * four therefore belong behind a lazy boundary.
 *
 * `AppContent.tsx` already lazy-imports `DocsLayout` / `DocsSlug` / `DocPage`
 * for the app-scoped `/apps/:packageId/docs` tree (ADR-0048). Importing the
 * same three STATICALLY here put them in the eager graph anyway, so that
 * `import()` moved nothing -- three `INEFFECTIVE_DYNAMIC_IMPORT` warnings on
 * every build (objectui#5467). Both sides must stay lazy: a static import on
 * either one silently re-defeats the split for BOTH, and the only signal is a
 * build warning that fails nothing.
 *
 * `DocsIndex` is lazy here for the same reason even though it carried no
 * warning (`AppContent` renders `AppDocsIndex` at that slot, so nothing
 * imported it dynamically). Left static it would keep `DocShell`,
 * `use-book-data` and `book-nav` eager on its own and the portal would only
 * half-leave the closure.
 */
const DocsLayout = lazy(() => import('./pages/DocsLayout'));
const DocsIndex = lazy(() => import('./pages/DocsIndex'));
const DocsSlug = lazy(() => import('./pages/DocsSlug'));
const DocPage = lazy(() => import('./pages/DocPage'));

/*
 * The AI chat surfaces, lazy for the same reason (objectui#13410).
 *
 * `/ai…` and the public share page `/s/:token` are the two console routes that
 * render the chat UI (`ChatbotEnhanced` and everything it reaches in
 * `@object-ui/plugin-chatbot`: `streamdown`, `shiki`, the AI Elements). Imported
 * statically here, that UI was in every first page load, the third-largest
 * eager chunk, including for users who never open a chat. The AI page arrives
 * through `./components/aiChatPage`, a console-local module nothing imports
 * statically, because an `import()` of the `@object-ui/app-shell` barrel this
 * file already imports would move nothing (see `./components/studioBuilder`).
 */
const DefaultAiChatPage = lazy(() =>
  import('./components/aiChatPage').then((m) => ({ default: m.DefaultAiChatPage })),
);
const SharedRecordPage = lazy(() => import('./pages/SharedRecordPage'));

const SERVER_URL = import.meta.env.VITE_SERVER_URL || '';
const AUTH_URL = `${SERVER_URL}/api/v1/auth`;

/**
 * Resolve the React Router basename from an explicit `<base href>` tag.
 *
 * The published Console build uses a relative Vite base (`./`) so the
 * same `dist/` works under any mount path. Hosts that embed the SPA
 * inject a `<base href="/path/">` into the served HTML (the framework
 * CLI does this automatically); standalone / dev runs have no `<base>`
 * and fall back to `'/'`.
 *
 * **Do not use `document.baseURI`** — when no `<base>` tag is present
 * it returns the *current document URL*, which would make the router
 * treat e.g. `/home` as its basename and cascade into `/home/home/home`
 * on every subsequent navigation.
 */
function resolveBasename(): string {
  try {
    if (typeof document === 'undefined') return '/';
    const baseEl = document.querySelector('base');
    const href = baseEl?.getAttribute('href');
    if (!href) return '/';
    const url = new URL(href, window.location.origin);
    const path = url.pathname.replace(/\/$/, '');
    return path || '/';
  } catch {
    return '/';
  }
}

const BASENAME = resolveBasename();

/** Wraps `DefaultHomeLayout` so the FAB gets the signed-in user id. */
function HomeRoute() {
  const { user } = useAuth();
  return (
    <DefaultHomeLayout userId={user?.id}>
      <DefaultHomePage />
    </DefaultHomeLayout>
  );
}

export function App() {
  /**
   * The console's ONE upload destination, mounted above `ConsoleShell` so it
   * reaches every file/image control in the console — including the ones that
   * do NOT render inside the route tree (objectui#10131).
   *
   * Why the altitude is the whole fix. `ConnectedShell`'s
   * `GlobalActionRuntimeProvider` renders `{children}` and then
   * `{runtime.dialogs}` + `{modalElement}` as its SIBLINGS: the action-param
   * dialog and the `ModalForm` a modal action opens (a lookup's inline
   * "create the referenced record", a related list's New) are mounted beside
   * the route element, not under it. This provider used to live in
   * `AppContent`, which is the element of exactly one route — `/apps/:appName/*`
   * — so every one of those dialogs rendered OUTSIDE it.
   *
   * And `useUpload()` fails OPEN: with no provider above it, it silently hands
   * back `createObjectUrlAdapter()`, which mints a `blob:` URL from thin air
   * and reports success. So a file picked in one of those dialogs produced
   * ZERO requests on the wire, `fileValueForSubmit` stored the legacy inline
   * blob instead of the `sys_file` id, and the engine answered
   * `400 ... expected string, received object` — a payload-shaped error whose
   * cause was a missing upload. Both halves are this one mount point.
   *
   * Contrast the control that already worked in those same dialogs: a lookup
   * round-trips its opaque server-minted id because the `dataSource` it needs
   * (`SchemaRendererProvider`) was deliberately hoisted to the level whose own
   * docstring says it sits there "so it reaches EVERY field widget, including
   * a relation field inside a create/edit form that renders in a Radix Dialog
   * portal". Uploads now sit at that same altitude.
   *
   * `fetchImpl` is not optional here: the storage routes authenticate the
   * caller, and `RecordAttachmentsPanel` — the one console surface that was
   * already uploading correctly — states why the adapter's default bare
   * `fetch` is not enough, that "the storage routes require a session and
   * there is no cookie for `credentials: 'include'` to carry". The same
   * wrapper also carries `X-Tenant-ID`, so an upload lands in the tenant the
   * rest of the session is reading.
   */
  const uploadFetch = useMemo(() => createAuthenticatedFetch(), []);
  const uploadAdapter = useMemo(
    () => createObjectStackUploadAdapter({ baseUrl: SERVER_URL, fetchImpl: uploadFetch }),
    [uploadFetch],
  );
  // `onAuthStateChange`: the session answer the two `/i18n` loaders `main.tsx`
  // hands to `I18nProvider` wait for, so a signed-out page load never reads
  // `/i18n` and a signed-in one reads it with the session (objectui#12034).
  return (
    <AuthProvider authUrl={AUTH_URL} onAuthStateChange={publishAuthState}>
      {/* objectui#7482 — no `position` override: the console takes
          `ConsoleToaster`'s own documented top-right anchor.

          `bottom-right` predates the ChatDock (ADR-0057 P3a) and the FAB that
          launches it, and the bottom-right corner now belongs to them: a
          success toast landed exactly on the assistant composer's send button.
          Two things went wrong, not one. It COVERED the button — and because
          sonner pauses a toast's dismiss timer while the pointer is over the
          toaster region (`expanded || interacting || isDocumentHidden`), a
          pointer resting on the composer under it kept 「客户更新成功」 on
          screen indefinitely, so the only way out was the × . The toaster's
          4s default was never wrong; it just never got to run. */}
      <ConsoleToaster />
      <MetadataHmrReloader />
      <BrowserRouter basename={BASENAME}>
        <FaviconSync />
        <UploadProvider adapter={uploadAdapter}>
        <ConsoleShell>
          <Routes>
            {/*
              * Public auth surfaces — render OUTSIDE ProtectedRoute so
              * unauthenticated visitors can reach them. Each page handles
              * its own redirect-once-authenticated logic.
              */}
            <Route path="/login" element={<LoginPage />} />
            <Route path="/register" element={<RegisterPage />} />
            <Route path="/forgot-password" element={<ForgotPasswordPage />} />
            <Route path="/reset-password" element={<ResetPasswordPage />} />
            {/*
              * Set an initial local password after SSO-as-owner entry on a
              * per-environment runtime. Public (session cookie already set by
              * the cloud sso-exchange) + shell-less, like the other auth
              * surfaces — see SetPasswordPage. The cloud auth-proxy redirects
              * here as `/set-password?next=…`.
              */}
            <Route path="/set-password" element={<SetPasswordPage />} />
            <Route path="/verify-email" element={<VerifyEmailPage />} />
            <Route path="/verify-email-prompt" element={<VerifyEmailPromptPage />} />
            {/* Public ONLY while the deployment is un-bootstrapped — see
              * SetupRoute. Once an owner exists this is the platform-settings
              * deep link and carries this host's normal auth guard. */}
            <Route path="/setup" element={<SetupRoute />} />
            <Route path="/oauth/consent" element={<OAuthConsentPage />} />
            <Route path="/auth/device" element={<DeviceAuthPage />} />
            {/*
              * Invitation acceptance — app-shell's `DefaultAcceptInvitationPage`
              * (objectui#3811). This route used to render a console-local thin
              * page that offered only accept/decline; the app-shell page fetches
              * the invitation and shows which organization, which role and when
              * it expires, then switches the user into that organization on
              * accept. Both were shipped for the same URL under two i18n
              * namespaces; the thin page and its `acceptInvitation.*` keys are
              * gone, `organization.accept.*` is the only namespace for this
              * screen. Rendered bare (no `AuthLayout`) — the page paints its own
              * full-viewport shell, like the other self-shelled auth surfaces.
              */}
            <Route
              path="/accept-invitation/:invitationId"
              element={<DefaultAcceptInvitationPage />}
            />
            {/*
              * Public anonymous form — rendered OUTSIDE ProtectedRoute so
              * unauthenticated visitors can submit. The slug maps 1:1 to a
              * FormView whose `sharing.allowAnonymous === true`.
              */}
            <Route path="/f/:slug" element={<FormPage mode="public" />} />
            {/*
              * Public capability-token landing page. Lives outside
              * ProtectedRoute so anonymous visitors can open a share
              * link. The page itself talks directly to the framework
              * REST API and renders a read-only view.
              */}
            <Route path="/s/:token" element={<Suspense fallback={<LoadingScreen />}><SharedRecordPage /></Suspense>} />
            {/* Application builder (ADR-0080/0084) — the whole `/studio`
              * subtree, declared in `components/StudioRoute` so its ENTRY gate
              * and the routes it guards cannot be separated by an edit to
              * either one.
              *
              * Before objectui#5519 these were three sibling routes here, two
              * of them wrapped in `ProtectedRoute` (auth only) and one wrapped
              * in nothing: `/_console/studio/` rendered the full pillar builder
              * to any authenticated principal on deployments where the nav tile
              * is deliberately absent and every metadata write is refused. The
              * only gate in the path was the backend's write refusal — one
              * layer too late for a capability whose declared meaning is
              * "Enter the Studio metadata-design surfaces". */}
            {studioRoutes}
            {/* Internal authed form — same renderer as `/f/:slug`, different
              * submit path, and (objectui#4109) rendered INSIDE the console
              * shell instead of as a bare page. The route stays exactly where
              * it is: per the 2026-08-10 ruling on objectstack#7245 the missing
              * chrome was the defect, not the navigation, so deep links keep
              * working. `InternalFormRoute` owns the chrome + the "land on the
              * created record" target; the public path above stays chrome-less
              * on purpose (an anonymous visitor has no console to be in). */}
            <Route path="/forms/:name" element={
              <ProtectedRoute>
                <InternalFormRoute />
              </ProtectedRoute>
            } />
            {/* Package documentation (ADR-0046): a platform-level portal
              * lists every installed `doc` (grouped by package), and one
              * viewer route renders any item; cross-references between docs
              * resolve to that same viewer route. Both are app-independent. */}
            {/* Docs portal (ADR-0046 §6). The layout fetches book + doc once
              * and shares it with every child route via context. Children:
              *   index        → book index
              *   :slug        → a book landing, or a flat-doc permalink that
              *                  redirects to its canonical /docs/<book>/<name>
              *   :slug/:name  → in-book reader (doc identity stays single-
              *                  coordinate; the book segment is derived nav). */}
            <Route path="/docs" element={
              <ProtectedRoute>
                <Suspense fallback={<LoadingScreen />}><DocsLayout /></Suspense>
              </ProtectedRoute>
            }>
              <Route index element={<Suspense fallback={<LoadingScreen />}><DocsIndex /></Suspense>} />
              <Route path=":slug" element={<Suspense fallback={<LoadingScreen />}><DocsSlug /></Suspense>} />
              <Route path=":slug/:name" element={<Suspense fallback={<LoadingScreen />}><DocPage /></Suspense>} />
            </Route>
            {/* objectui#12700 — Home and every app share ONE
              * `/auth/me/permissions` source. A pathless layout route is their
              * common ancestor: its element (auth, the shell, the permissions
              * provider) stays mounted when the user moves between `/home` and
              * `/apps/…`, so the answer is fetched once per session load and
              * Home's navigation gates (the bell's and the activity card's
              * roster) answer `current_user.can(...)` from it.
              * ⛔ `/studio/*` stays outside it (`components/studioEntry.ts`). */}
            <Route element={
              <ProtectedRoute>
                <ConsolePermissionsScope>
                  <Outlet />
                </ConsolePermissionsScope>
              </ProtectedRoute>
            }>
              <Route path="/home" element={<HomeRoute />} />
              <Route path="/apps/:appName/*" element={<AppContent />} />
            </Route>
            {/* Dev-only: ADR-0001 master-detail subform verification harness. */}
            <Route path="/dev/master-detail" element={
              <ProtectedRoute>
                <DevMasterDetail />
              </ProtectedRoute>
            } />
            {/* Dev-only: lightweight list primitives (definition-list, repeater). */}
            <Route path="/dev/lists" element={
              <ProtectedRoute>
                <DevLists />
              </ProtectedRoute>
            } />
            {/* Dev-only: action modal transport (center/side/bottom/fullscreen). */}
            <Route path="/dev/modal" element={
              <ProtectedRoute>
                <DevModal />
              </ProtectedRoute>
            } />
            {/* Dev-only: line-item grid with a lookup cell. */}
            <Route path="/dev/lookup" element={
              <ProtectedRoute>
                <DevLookup />
              </ProtectedRoute>
            } />
            {/* Dev-only: row-action inline-overflow (multiple primary actions). */}
            <Route path="/dev/row-actions" element={
              <ProtectedRoute>
                <DevRowActions />
              </ProtectedRoute>
            } />
            <Route path="/organizations" element={
              <ProtectedRoute requireOrganization={false}>
                <DefaultOrganizationsLayout><DefaultOrganizationsPage /></DefaultOrganizationsLayout>
              </ProtectedRoute>
            } />
            {/*
              * Organization management — single-org admin surface reached
              * from the "Manage" button on the organizations list. The
              * layout resolves the org by `:slug`, makes it active, and
              * renders Members / Invitations / Settings tabs into its
              * Outlet. `requireOrganization={false}` because the layout
              * itself drives org activation from the slug.
              */}
            <Route path="/organizations/:slug" element={
              <ProtectedRoute requireOrganization={false}>
                <DefaultOrganizationLayout />
              </ProtectedRoute>
            }>
              <Route index element={<Navigate to="members" replace />} />
              <Route path="members" element={<DefaultMembersPage />} />
              <Route path="invitations" element={<DefaultInvitationsPage />} />
              <Route path="settings" element={<DefaultSettingsPage />} />
            </Route>
            <Route path="/system/*" element={<SystemRedirect />} />
            {/*
              AI surfaces are agent-scoped: the active assistant is baked into
              the route (`/ai/:agent`) rather than a `?agent=` query snapshot,
              so each assistant ("build" authoring vs "ask" data Q&A, plus any
              custom `*.agent.ts`) is its own page. AiChatPage handles the
              back-compat redirects: bare `/ai` → the default agent surface, and
              a single-segment `/ai/:agent` that is actually a legacy bare
              conversation id → `/ai/:agent/:conversationId`.

              `RequireAiSurface` keeps these from dead-ending on a runtime that
              serves no AI (Community Edition): with AI unavailable a stale
              bookmark / external link redirects to home instead of mounting a
              chat with no agent to talk to. Cloud installs pass straight
              through. Purely additive runtime gating — same server signal the
              floating-chat FAB has always used.
            */}
            <Route path="/ai" element={
              <ProtectedRoute>
                <RequireAiSurface><Suspense fallback={<LoadingScreen />}><DefaultAiChatPage /></Suspense></RequireAiSurface>
              </ProtectedRoute>
            } />
            <Route path="/ai/:agent" element={
              <ProtectedRoute>
                <RequireAiSurface><Suspense fallback={<LoadingScreen />}><DefaultAiChatPage /></Suspense></RequireAiSurface>
              </ProtectedRoute>
            } />
            <Route path="/ai/:agent/:conversationId" element={
              <ProtectedRoute>
                <RequireAiSurface><Suspense fallback={<LoadingScreen />}><DefaultAiChatPage /></Suspense></RequireAiSurface>
              </ProtectedRoute>
            } />
            {/*
              * The landing resolver reads App METADATA, so it needs the data
              * layer — which needs a session. It used to mount `ConnectedShell`
              * bare, with no AuthGuard above it, so an unauthenticated visitor
              * opening `/_console/` mounted the whole metadata tree and fired
              * `meta/object` + `meta/view` + `meta/app` straight into 401
              * before the login form was drawn (objectui#4042). Guarding it
              * sends those visitors to /login without a single doomed request;
              * a signed-in visitor still lands exactly where `isDefault`
              * resolves. `requireOrganization={false}` because `/` only
              * redirects — the org gate belongs to the destination route.
              */}
            <Route path="/" element={
              <ProtectedRoute requireOrganization={false}>
                <RootLandingRedirect />
              </ProtectedRoute>
            } />
            {/* `RedirectWithSplash`, not a bare `<Navigate>` (objectui#6378).
              * This is a BOOT redirect: a URL the router does not know is
              * commonly the very first thing a session renders (a stale deep
              * link, or a console served under a mount path with no
              * `<base href>` for `resolveBasename` to read), so it fires with
              * the splash freshly torn down and nothing else on screen.
              * Measured on that entry: 35-95 ms of empty `#root`. The nested
              * `index` redirect above is deliberately NOT changed — it fires
              * under an already-painted organization layout, where covering the
              * screen with a splash would be the regression. */}
            <Route path="*" element={<RedirectWithSplash to="/" replace />} />
          </Routes>
        </ConsoleShell>
        </UploadProvider>
      </BrowserRouter>
    </AuthProvider>
  );
}

// Re-export AppContent so tests/extenders that import { AppContent } from './App'
// keep working.
export { AppContent } from './AppContent';
