/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#5467 — the console's `/docs` portal must stay OUT of the eager
 * module graph.
 *
 * ## What this measures, and why it is not a source-text check
 *
 * `AppContent.tsx` lazy-imports `DocsLayout` / `DocsSlug` / `DocPage` for the
 * app-scoped `/apps/:packageId/docs` tree (ADR-0048). `App.tsx` used to import
 * the same three STATICALLY for the platform portal at `/docs` (ADR-0046
 * section 6), which put them in the eager graph anyway and made that
 * `import()` decoration — three `INEFFECTIVE_DYNAMIC_IMPORT` warnings on every
 * `vite build`, and a build warning fails nothing.
 *
 * So the regression this file exists to catch is a static import re-appearing
 * in `App.tsx`, and it is asserted as the PROPERTY rather than the spelling: a
 * `vi.mock` factory runs the first time its module is imported, so the flags
 * below record *when* each page entered the graph. A static import makes the
 * page load while `App.tsx` itself is evaluated — before any test body runs —
 * and this file goes red. A regex over `App.tsx` would pin one spelling of the
 * mistake; this pins the mistake.
 *
 * ## Counter-probes
 *
 * Two, because "the page never loaded" is exactly what a flag that can never
 * be set looks like.
 *
 *   1. `LoginPage` is a LIVE positive control: `App.tsx` still imports it
 *      statically, so its flag must already be set before the first render.
 *      If the observer stopped seeing static imports, that assertion fails
 *      instead of the lazy ones passing vacuously. (`SharedRecordPage` was the
 *      control until objectui#13410 made `/s/:token` lazy too.)
 *   2. Visiting `/docs` must FLIP the layout's flag and render it. A flag that
 *      is merely stuck at unset cannot satisfy both halves.
 *
 * `DocsSlug` and `DocPage` sit on deeper routes that `/docs` does not match,
 * so they must still be unloaded after the render — the portal is split per
 * page, not into one docs bundle.
 */

import { describe, expect, it, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { Outlet } from 'react-router-dom';
import type { ReactNode } from 'react';

// `vi.hoisted`, not plain consts: every `vi.mock` factory below is hoisted to
// the top of the file, so a factory closing over an ordinary `const` reads it
// before initialization.
const { loaded, passthrough, stub, tracked } = vi.hoisted(() => {
  const loaded: Record<string, boolean> = {};
  const passthrough = ({ children }: { children?: ReactNode }) => <>{children}</>;
  const stub = (testid: string) => () => <div data-testid={testid} />;
  /** A default-export page module that records the moment it is imported. */
  const tracked = (name: string, testid: string) => () => {
    loaded[name] = true;
    return { default: stub(testid) };
  };
  return { loaded, passthrough, stub, tracked };
});

// ── The four docs pages ───────────────────────────────────────────────────
// The layout renders its `Outlet` so the index child actually mounts —
// otherwise `DocsIndex` would read as "still lazy" for the wrong reason
// (nothing ever asked for it) and the assertion on it would be vacuous.
vi.mock('../pages/DocsLayout', () => {
  loaded.DocsLayout = true;
  return {
    default: () => (
      <div data-testid="docs-layout">
        <Outlet />
      </div>
    ),
  };
});
vi.mock('../pages/DocsIndex', tracked('DocsIndex', 'docs-index'));
vi.mock('../pages/DocsSlug', tracked('DocsSlug', 'docs-slug'));
vi.mock('../pages/DocPage', tracked('DocPage', 'doc-page'));

// ── Everything else App.tsx imports but this card does not touch ──────────
vi.mock('@object-ui/app-shell', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  ConsoleShell: passthrough,
  ConsoleToaster: () => null,
  LoadingScreen: stub('loading-screen'),
  // objectui#6378 — App.tsx's catch-all route element. Stubbed like every
  // other chrome symbol here; that it renders the splash while redirecting
  // is pinned by `packages/app-shell/src/chrome/RedirectWithSplash.test.tsx`.
  RedirectWithSplash: stub('redirect-with-splash'),
  RequireAiSurface: passthrough,
  SystemRedirect: () => null,
  DefaultHomeLayout: passthrough,
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
}));

vi.mock('@object-ui/auth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  AuthProvider: passthrough,
  useAuth: () => ({ user: { id: 'u1' } }),
}));

vi.mock('../AppContent', () => ({
  AppContent: stub('app-content'),
  // objectui#12700: the permissions scope `App` mounts over /home and /apps, a pass-through here.
  ConsolePermissionsScope: ({ children }: { children?: ReactNode }) => <>{children}</>,
}));
vi.mock('../components/ProtectedRoute', () => ({ ProtectedRoute: passthrough }));
vi.mock('../components/RootLandingRedirect', () => ({ RootLandingRedirect: stub('root-landing') }));
vi.mock('../components/SetupRoute', () => ({ SetupRoute: stub('setup-route') }));
vi.mock('../components/FormPage', () => ({ FormPage: stub('form-page') }));
vi.mock('../components/InternalFormRoute', () => ({ InternalFormRoute: stub('internal-form-route') }));
vi.mock('../components/MetadataHmrReloader', () => ({ MetadataHmrReloader: () => null }));
// The statically imported positive control (counter-probe 1).
vi.mock('../pages/auth/LoginPage', () => {
  loaded.LoginPage = true;
  return { LoginPage: stub('login-page') };
});
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

afterEach(() => {
  cleanup();
  window.history.pushState({}, '', '/');
});

describe('the /docs portal is genuinely lazy (objectui#5467)', () => {
  it('leaves the docs pages out of the graph until a /docs route matches', async () => {
    // Counter-probe 1 — a page App.tsx still imports statically. Importing
    // `../App` above was enough to load it, which is what "eager" means and
    // what the four assertions below deny for the docs portal.
    expect(loaded.LoginPage).toBe(true);

    expect(loaded.DocsLayout).toBeUndefined();
    expect(loaded.DocsIndex).toBeUndefined();
    expect(loaded.DocsSlug).toBeUndefined();
    expect(loaded.DocPage).toBeUndefined();

    window.history.pushState({}, '', '/docs');
    render(<App />);

    // Counter-probe 2 — the flags can be set, and the Suspense boundary the
    // lazy elements sit behind actually resolves them. Without it React would
    // throw here rather than render the layout.
    expect(await screen.findByTestId('docs-layout')).toBeInTheDocument();
    expect(loaded.DocsLayout).toBe(true);
    expect(loaded.DocsIndex).toBe(true);

    // Split per page, not into one docs bundle: `/docs` matches neither of
    // these deeper routes, so neither may have been pulled in.
    expect(loaded.DocsSlug).toBeUndefined();
    expect(loaded.DocPage).toBeUndefined();
  });
});
