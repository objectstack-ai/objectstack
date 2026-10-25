// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#4109 — `/forms/:name` (mode=internal) renders INSIDE the console
 * shell; `/f/:slug` (mode=public) stays chrome-less.
 *
 * Maintainer ruling, 2026-08-10, quoted verbatim from objectstack#7245:
 *
 * > 1. `/forms/:name` in `mode="internal"` nests inside the console shell (keep
 * >    the route — deep-linking survives; the missing chrome is the defect, not
 * >    the navigation).
 *
 * ## What this measures, and why it renders the REAL App
 *
 * The deliverable is a property of `App.tsx`'s route table — which element each
 * of the two form routes mounts — so this file renders that table rather than a
 * transcription of it. A hand-copied route list would be free to agree with
 * whatever the source does, which is the trap
 * `AppContent.systemHubRoutes.test.tsx` documents at length for the same
 * reason. Everything App.tsx imports but this card does not touch is stubbed
 * (auth surfaces, docs, dev harnesses, the per-app SPA) so the table itself is
 * the only thing under test.
 *
 * The console chrome is stubbed to a MARKER, following the same precedent
 * (`AppContent.systemHubRoutes.test.tsx` stubs `ConsoleLayout` to a
 * `data-testid` div): what is being pinned here is that the internal form is
 * nested inside the shell layout at all, not how `HomeLayout` paints — that
 * belongs to `@object-ui/app-shell`'s own tests.
 *
 * ## Reverse verification
 *
 * Both tests are change-detectors, in opposite directions. Restoring the
 * pre-fix element (`<FormPage mode="internal" />` bare, a sibling of the
 * app-shell routes) turns the first test red — the marker never renders — and
 * leaves the second green. Wrapping the PUBLIC route in the same chrome turns
 * the second red and leaves the first green. So neither can pass by accident
 * for the other one's reason.
 */

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';

// `vi.hoisted`, not plain consts: every `vi.mock` factory below is hoisted to
// the top of the file, so a factory closing over an ordinary `const` reads it
// before initialization.
const { passthrough, stub } = vi.hoisted(() => ({
  passthrough: ({ children }: { children?: ReactNode }) => <>{children}</>,
  stub: (testid: string) => () => <div data-testid={testid} />,
}));

// ── The console chrome, stubbed to a marker ──────────────────────────────
// `DefaultHomeLayout` is the console's layout for app-INDEPENDENT authed pages
// (`/home`, `/organizations` — and now the internal form). Its presence IS the
// "nested inside the console shell" assertion.
vi.mock('@object-ui/app-shell', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  ConsoleShell: passthrough,
  ConsoleToaster: () => null,
  // Suspense fallback for App.tsx's lazy /docs routes (objectui#5467).
  // The route elements are built when App renders, so this export is
  // read even by a test that never visits /docs.
  LoadingScreen: stub('loading-screen'),
  // App.tsx's catch-all route element (objectui#6378). Read for the same
  // reason `LoadingScreen` is: the route table is built when App renders.
  RedirectWithSplash: stub('redirect-with-splash'),
  RequireAiSurface: passthrough,
  SystemRedirect: () => null,
  DefaultHomeLayout: ({ children }: { children?: ReactNode }) => (
    <div data-testid="console-shell-layout">{children}</div>
  ),
  DefaultHomePage: stub('home-page'),
  DefaultOrganizationsLayout: passthrough,
  DefaultOrganizationsPage: stub('organizations-page'),
  DefaultOrganizationLayout: stub('organization-layout'),
  DefaultMembersPage: stub('members-page'),
  DefaultInvitationsPage: stub('invitations-page'),
  DefaultSettingsPage: stub('settings-page'),
  DefaultAcceptInvitationPage: stub('accept-invitation-page'),
  DefaultAiChatPage: stub('ai-chat-page'),
  StudioDesignSurface: stub('studio-design-surface'),
  BuilderLanding: stub('builder-landing'),
  getProductName: () => 'ObjectOS',
  getFaviconUrl: () => '',
  // Consumed by InternalFormRoute to resolve the created-record target.
  useMetadata: () => ({ apps: [{ name: 'showcase_app', _packageId: 'ai.objectstack.showcase' }] }),
  useNavigationContext: () => ({ currentAppName: 'showcase_app' }),
  // Consumed by InternalFormRoute to publish the session principal as the form
  // route's predicate scope (objectui#6110). Stubbed, like every other entry in
  // this factory: this file pins the #4109 SHELL NESTING and authors no
  // `current_user` predicate, so a real provider would only slow it down. The
  // BINDING itself is pinned in `components/FormPage.predicateScope.test.tsx`,
  // whose `hop1SessionPrincipal` case mounts the real `InternalFormRoute` with
  // the real provider and goes red the moment this mount is removed.
  ExpressionProvider: passthrough,
  buildExpressionUser: (user: unknown) => user,
}));

vi.mock('@object-ui/auth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  AuthProvider: passthrough,
  useAuth: () => ({ user: { id: 'u1' } }),
}));

// ── Everything else App.tsx imports but this card does not touch ─────────
vi.mock('../components/ProtectedRoute', () => ({ ProtectedRoute: passthrough }));
vi.mock('../components/RootLandingRedirect', () => ({ RootLandingRedirect: stub('root-landing') }));
vi.mock('../components/SetupRoute', () => ({ SetupRoute: stub('setup-route') }));
vi.mock('../components/MetadataHmrReloader', () => ({ MetadataHmrReloader: () => null }));
vi.mock('../AppContent', () => ({
  AppContent: stub('app-content'),
  // objectui#12700: the permissions scope `App` mounts over /home and /apps, a pass-through here.
  ConsolePermissionsScope: ({ children }: { children?: ReactNode }) => <>{children}</>,
}));
vi.mock('../pages/SharedRecordPage', () => ({ default: stub('shared-record-page') }));
vi.mock('../pages/DocPage', () => ({ default: stub('doc-page') }));
vi.mock('../pages/DocsIndex', () => ({ default: stub('docs-index') }));
vi.mock('../pages/DocsSlug', () => ({ default: stub('docs-slug') }));
vi.mock('../pages/DocsLayout', () => ({ default: stub('docs-layout') }));
vi.mock('../pages/auth/LoginPage', () => ({ LoginPage: stub('login-page') }));
vi.mock('../pages/auth/RegisterPage', () => ({ RegisterPage: stub('register-page') }));
vi.mock('../pages/auth/ForgotPasswordPage', () => ({ ForgotPasswordPage: stub('forgot-page') }));
vi.mock('../pages/auth/ResetPasswordPage', () => ({ ResetPasswordPage: stub('reset-page') }));
vi.mock('../pages/auth/SetPasswordPage', () => ({ SetPasswordPage: stub('set-password-page') }));
vi.mock('../pages/auth/VerifyEmailPage', () => ({ VerifyEmailPage: stub('verify-email-page') }));
vi.mock('../pages/auth/VerifyEmailPromptPage', () => ({ VerifyEmailPromptPage: stub('verify-prompt-page') }));
vi.mock('../pages/auth/OAuthConsentPage', () => ({ OAuthConsentPage: stub('oauth-consent-page') }));
vi.mock('../pages/auth/DeviceAuthPage', () => ({ DeviceAuthPage: stub('device-auth-page') }));
vi.mock('../dev/DevMasterDetail', () => ({ DevMasterDetail: stub('dev-master-detail') }));
vi.mock('../dev/DevLists', () => ({ DevLists: stub('dev-lists') }));
vi.mock('../dev/DevModal', () => ({ DevModal: stub('dev-modal') }));
vi.mock('../dev/DevLookup', () => ({ DevLookup: stub('dev-lookup') }));
vi.mock('../dev/DevRowActions', () => ({ DevRowActions: stub('dev-row-actions') }));

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { App } from '../App';

/** The FormView + object metadata both form modes resolve their spec from. */
const INTERNAL_VIEW = {
  name: 'showcase_task.edit',
  object: 'showcase_task',
  viewKind: 'form',
  label: 'Log Time',
  config: { type: 'simple', sections: [{ fields: ['title'] }] },
};
const OBJECT_SCHEMA = { name: 'showcase_task', fields: { title: { type: 'text', label: 'Title' } } };
const PUBLIC_FORM = {
  slug: 'contact-us',
  object: 'showcase_inquiry',
  label: 'Contact us',
  form: { type: 'simple', sections: [{ fields: ['title'] }] },
  objectSchema: { name: 'showcase_inquiry', fields: { title: { type: 'text', label: 'Title' } } },
};

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      const body = String(url).includes('/meta/view/')
        ? INTERNAL_VIEW
        : String(url).includes('/meta/object/')
          ? OBJECT_SCHEMA
          : PUBLIC_FORM;
      return {
        ok: true,
        status: 200,
        statusText: 'OK',
        json: async () => body,
        text: async () => JSON.stringify(body),
      } as unknown as Response;
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  window.history.pushState({}, '', '/');
});

describe('form routes and the console shell (objectui#4109)', () => {
  it('nests the internal /forms/:name inside the console shell layout', async () => {
    window.history.pushState({}, '', '/forms/showcase_task.edit');
    render(<App />);

    // The form itself resolved and rendered…
    expect(await screen.findByLabelText(/Title/)).toBeInTheDocument();
    // …inside the shell chrome, which is the whole point of the ruling.
    const shell = screen.getByTestId('console-shell-layout');
    expect(shell).toBeInTheDocument();
    expect(shell).toContainElement(screen.getByLabelText(/Title/));
  });

  it('keeps the public /f/:slug chrome-less', async () => {
    window.history.pushState({}, '', '/f/contact-us');
    render(<App />);

    // Same renderer, same form…
    expect(await screen.findByLabelText(/Title/)).toBeInTheDocument();
    // …but an anonymous visitor has no console to be inside.
    expect(screen.queryByTestId('console-shell-layout')).not.toBeInTheDocument();
  });
});
