// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The agent preview's "Try in chat" link, followed into the console's REAL
 * root route table (objectui#10640).
 *
 * ## The defect
 *
 * app-shell's `AgentPreview` (Studio, an agent, the preview's toolbar) drew
 * its "Try in chat" link as a plain anchor to `/console/ai/agents/NAME/chat`.
 * `App.tsx` declares no path beginning with `/console`: the agent chat routes
 * are `/ai`, `/ai/:agent` and `/ai/:agent/:conversationId`. So the link matched
 * only the root `path="*"` catch-all, a redirect home. As a plain anchor it
 * also stepped outside the router's basename (the console mounts under
 * `/_console`).
 *
 * ## What this file pins, and why it renders the REAL App
 *
 * Whether the link reaches the chat is a property of `App.tsx`'s route table,
 * and that table is not exported, so this file renders `App` itself, the way
 * `internalFormShell.test.tsx` does. A hand-copied route list would be free to
 * agree with whatever the source does. Everything `App.tsx` imports but this
 * card does not touch is stubbed, with the same list that file uses. The
 * catch-all's element (`RedirectWithSplash`) and the chat page
 * (`DefaultAiChatPage`) are stubbed to markers; the chat stub reports the
 * `:agent` and `:conversationId` params and the `new` flag it was routed with.
 *
 * The href is not written here: it is the one the REAL registered agent
 * preview draws (`getMetadataPreview('agent')`), rendered where the console
 * renders it, under `/apps/:appName/*`.
 *
 *   1. That href reaches the chat page for that agent, as `/ai/:agent` (a new
 *      chat, no conversation id), not the catch-all.
 *   2. An agent name that needs escaping arrives as the `:agent` param
 *      exactly, and its slash does not spill into `:conversationId`.
 *   3. Control: the pre-fix URL reaches the catch-all and not the chat page.
 *      This is the defect reproduced through the same table, and it proves
 *      the catch-all marker is reachable in this harness.
 *
 * Restoring the pre-fix href in `AgentPreview` turns 1 and 2 red and leaves 3
 * green.
 */

import { describe, expect, it, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

// `vi.hoisted`, not plain consts: every `vi.mock` factory below is hoisted to
// the top of the file, so a factory closing over an ordinary `const` reads it
// before initialization.
const { passthrough, stub } = vi.hoisted(() => ({
  passthrough: ({ children }: { children?: ReactNode }) => <>{children}</>,
  stub: (testid: string) => () => <div data-testid={testid} />,
}));

vi.mock('@object-ui/app-shell', async (importOriginal) => {
  const { useParams, useSearchParams } = await import('react-router-dom');
  /** The chat page, reduced to the route params it was reached with. */
  function AiChatPageProbe() {
    const { agent, conversationId } = useParams<{ agent?: string; conversationId?: string }>();
    const [searchParams] = useSearchParams();
    return (
      <div
        data-testid="ai-chat-page"
        data-agent={agent ?? ''}
        data-conversation-id={conversationId ?? ''}
        data-new={searchParams.get('new') ?? ''}
      />
    );
  }
  return {
    ...(await importOriginal<Record<string, unknown>>()),
    ConsoleShell: passthrough,
    ConsoleToaster: () => null,
    // Suspense fallback for App.tsx's lazy /docs routes (objectui#5467); the
    // route elements are built when App renders, so this export is read even
    // by a test that never visits /docs.
    LoadingScreen: stub('loading-screen'),
    // App.tsx's catch-all route element (objectui#6378): the marker a URL no
    // route declares lands on.
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
    DefaultAiChatPage: AiChatPageProbe,
    StudioDesignSurface: stub('studio-design-surface'),
    BuilderLanding: stub('builder-landing'),
    getProductName: () => 'ObjectOS',
    getFaviconUrl: () => '',
  };
});

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

import { getMetadataPreview } from '@object-ui/app-shell';
import { App } from '../App';
// The built-in designers. Importing the @object-ui/app-shell root registers them
// from a chunk it loads with a dynamic `import()` (objectui#11939 step 2), so
// they land after this module has run. Loaded and registered here, at module
// scope — the import phase, outside every test's window — by the function the
// root calls when that chunk arrives, so the registry read below returns the
// real built-in designer.
//
// `vi.importActual` and a workspace SOURCE path, not an `import` statement: the
// package publishes no subpath and the function is not on its barrel, and a
// static import would put the designers' sources into this app's `tsc` program,
// which checks them under rules their own package does not apply.
const { registerBuiltinDesigners } = await vi.importActual<{ registerBuiltinDesigners: () => void }>(
  '../../../../packages/app-shell/src/views/metadata-admin/register-builtin-designers',
);
registerBuiltinDesigners();

/** The pre-fix link, byte for byte what `AgentPreview` used to draw. */
const PRE_FIX_HREF = '/console/ai/agents/sales_copilot/chat';

afterEach(() => {
  cleanup();
  window.history.pushState({}, '', '/');
});

/**
 * The href the REAL registered agent preview draws for `agentName`, opened from
 * Studio: the console renders it inside `ResourceEditPage`, the element of
 * `metadata/:type/:name` under `/apps/:appName/*`.
 */
function agentPreviewHref(agentName: string): string {
  const AgentPreview = getMetadataPreview('agent');
  if (!AgentPreview) throw new Error('the agent preview is not registered');
  render(
    <MemoryRouter initialEntries={[`/apps/studio/metadata/agent/${encodeURIComponent(agentName)}`]}>
      <Routes>
        <Route
          path="/apps/:appName/*"
          element={
            <AgentPreview
              type="agent"
              name={agentName}
              draft={{ name: agentName, label: 'Sales Copilot', instructions: 'Help sales reps.' }}
            />
          }
        />
      </Routes>
    </MemoryRouter>,
  );
  const href = screen.getByRole('link', { name: /try in chat/i }).getAttribute('href');
  cleanup();
  if (!href) throw new Error('the agent preview drew no href');
  return href;
}

/** The real console, booted at `url` (App's router reads `window.location`). */
function renderConsoleAt(url: string) {
  window.history.pushState({}, '', url);
  return render(<App />);
}

describe("the agent preview's chat link through the console's root route table (objectui#10640)", () => {
  it("reaches the agent's chat page as /ai/:agent, not the root catch-all", async () => {
    renderConsoleAt(agentPreviewHref('sales_copilot'));

    const chat = await screen.findByTestId('ai-chat-page');
    expect(chat).toHaveAttribute('data-agent', 'sales_copilot');
    // `/ai/:agent`, not `/ai/:agent/:conversationId`: the preview has no
    // conversation to resume, and asks for a new one.
    expect(chat).toHaveAttribute('data-conversation-id', '');
    expect(chat).toHaveAttribute('data-new', '1');
    expect(screen.queryByTestId('redirect-with-splash')).not.toBeInTheDocument();
  });

  it('delivers an agent name that needs escaping as the :agent param exactly', async () => {
    const odd = 'odd name/x?y#z';
    renderConsoleAt(agentPreviewHref(odd));

    const chat = await screen.findByTestId('ai-chat-page');
    expect(chat).toHaveAttribute('data-agent', odd);
    // An unescaped slash would have split the name across `:conversationId`.
    expect(chat).toHaveAttribute('data-conversation-id', '');
    expect(screen.queryByTestId('redirect-with-splash')).not.toBeInTheDocument();
  });

  it('control: the pre-fix URL reaches only the root catch-all', async () => {
    renderConsoleAt(PRE_FIX_HREF);

    expect(await screen.findByTestId('redirect-with-splash')).toBeInTheDocument();
    expect(screen.queryByTestId('ai-chat-page')).not.toBeInTheDocument();
  });
});
