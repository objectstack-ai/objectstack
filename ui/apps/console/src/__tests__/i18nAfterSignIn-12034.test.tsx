/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#12034: the sign-in page renders from the built-in language packs,
 * and the application's translations load after sign-in, with the session.
 *
 * ## The server this file talks to
 *
 * A fake framework whose `/api/v1/i18n/*` answers `401 UNAUTHENTICATED` to any
 * caller without the session's bearer: the head of
 * objectstack-ai/objectstack#22432, which gives that domain the anonymous
 * refusal every other dispatcher domain has. It knows the bearer only. That is
 * the deployment where no session cookie rides along (a console built with an
 * absolute `VITE_SERVER_URL`). On a same-origin cookie deployment the old bare
 * `fetch` was served after sign-in by the cookie; it never sent the bearer.
 *
 * ## The tree
 *
 * The REAL `App`: its `AuthProvider` props (so its `onAuthStateChange`), its
 * route table, the real `LoginPage` and the real `ProtectedRoute`. The only
 * auth substitution is the network client the provider talks to. The
 * `I18nProvider` mount is `main.tsx`'s, transcribed, with the real loaders:
 * that module boots the page as a side effect of being imported, so a test
 * cannot import it. The application route's element (`AppContent`) is a probe
 * that draws one application label (`useObjectLabel`, the reader the app's
 * labels go through) and one built-in-pack string. Everything else `App`
 * imports and this card does not touch is stubbed, as in the other `App`
 * tests in this folder.
 *
 * ## The pins, one per pin of the card
 *
 *   1. Signed out on the sign-in page, through the sign-in itself: no `/i18n`
 *      request, and the page is drawn in Chinese from the built-in pack.
 *   2. Signed in: the application's label comes from the authenticated
 *      `/i18n` reads. Asserted on the RENDERED text of one mounted heading,
 *      which changes from the authored literal to the translation when the
 *      read lands (objectui#10382: a re-render here has been a no-op before,
 *      so a request count alone proves nothing).
 *   3. The whole sign-in → app path against that server shows no raw key, on
 *      any frame, from the first render of the sign-in page to the translated
 *      application label after sign-in. A positive control shows the recorder
 *      catches a key that is drawn raw.
 *
 * Between the two boots the console does what it does after sign-in: a
 * full-page navigation (`window.location.assign`, pinned by
 * `authExitBasename.test.tsx`). Here that is the end of one render and the
 * start of the next, with the session the sign-in established.
 */

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { StrictMode, type ReactNode } from 'react';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const { passthrough, stub, authClient } = vi.hoisted(() => ({
  passthrough: ({ children }: { children?: ReactNode }) => <>{children}</>,
  stub: (testid: string) => () => <div data-testid={testid} />,
  /** The network client the REAL `AuthProvider` talks to, set per boot. */
  authClient: { current: null as unknown },
}));

vi.mock('@object-ui/app-shell', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  ConsoleShell: passthrough,
  ConsoleToaster: () => null,
  LoadingScreen: stub('loading-screen'),
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
  // `ProtectedRoute` stays real; the shell it mounts is cut down to its
  // children, and its loading state to a marker.
  ConnectedShell: passthrough,
  RequireOrganization: passthrough,
  LoadingFallback: stub('loading-fallback'),
}));

vi.mock('@object-ui/auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@object-ui/auth')>();
  const RealAuthProvider = actual.AuthProvider;
  return {
    ...actual,
    // App's own props, `onAuthStateChange` among them, reach the REAL
    // provider; only the network client is this file's.
    AuthProvider: (props: Parameters<typeof RealAuthProvider>[0]) => (
      <RealAuthProvider {...props} client={authClient.current as never} />
    ),
  };
});

vi.mock('../AppContent', async () => {
  const { useObjectLabel, useObjectTranslation } = await import('@object-ui/i18n');
  /** The application route: one application label, one built-in-pack string. */
  function AppProbe() {
    const { objectLabel } = useObjectLabel();
    const { t } = useObjectTranslation();
    return (
      <main data-testid="app-probe">
        <h1>{objectLabel({ name: 'crm_lead', label: 'Lead' })}</h1>
        <button type="button">{t('common.save')}</button>
      </main>
    );
  }
  return {
    AppContent: AppProbe,
    // objectui#12700: the permissions scope `App` mounts over /home and /apps, a pass-through here.
    ConsolePermissionsScope: ({ children }: { children?: ReactNode }) => <>{children}</>,
  };
});

vi.mock('../components/RootLandingRedirect', () => ({ RootLandingRedirect: stub('root-landing') }));
vi.mock('../components/SetupRoute', () => ({ SetupRoute: stub('setup-route') }));
vi.mock('../components/MetadataHmrReloader', () => ({ MetadataHmrReloader: () => null }));
vi.mock('../pages/SharedRecordPage', () => ({ default: stub('shared-record-page') }));
vi.mock('../pages/DocPage', () => ({ default: stub('doc-page') }));
vi.mock('../pages/DocsIndex', () => ({ default: stub('docs-index') }));
vi.mock('../pages/DocsSlug', () => ({ default: stub('docs-slug') }));
vi.mock('../pages/DocsLayout', () => ({ default: stub('docs-layout') }));
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

import { I18nProvider, LOCALE_STORAGE_KEY, preloadBootstrapLocale, useObjectTranslation } from '@object-ui/i18n';
import { builtInLocales } from '@object-ui/i18n/locales';
import { TokenStorage, type AuthClient, type AuthPublicConfig, type AuthUser } from '@object-ui/auth';
import { App } from '../App';
import { loadLanguage } from '../loadLanguage';
import { loadLocales } from '../loadLocales';

const zh = builtInLocales.zh;
const TOKEN = 'tok-12034';
const USER = { id: 'u_12034', email: 'ada@example.com', name: 'Ada' } as unknown as AuthUser;
const SESSION = { token: TOKEN, expiresAt: new Date(Date.now() + 3_600_000) };
const ORG = { id: 'org_12034', name: 'Acme', slug: 'acme' };
const OPEN: AuthPublicConfig = {
  emailPassword: { enabled: true, disableSignUp: false },
  features: { audiencePosture: 'open' },
};

// ---------------------------------------------------------------------------
// The fake framework
// ---------------------------------------------------------------------------

interface I18nRead {
  path: string;
  authorization: string | null;
  status: number;
}

/** Every `/i18n` request the console made, with the bearer it carried and the status it got. */
let i18nReads: I18nRead[] = [];
/** When set, the translations answer waits for it. */
let translationsGate: Promise<void> | null = null;

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

async function framework(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  const { pathname } = new URL(url, window.location.href);
  if (!pathname.startsWith('/api/v1/i18n/')) return json(404, {});
  const authorization = new Headers(init?.headers).get('Authorization');
  const signedIn = authorization === `Bearer ${TOKEN}`;
  i18nReads.push({ path: pathname, authorization, status: signedIn ? 200 : 401 });
  if (!signedIn) {
    return json(401, { success: false, error: { code: 'UNAUTHENTICATED', message: 'Authentication required' } });
  }
  if (pathname === '/api/v1/i18n/locales') {
    return json(200, { data: { locales: [{ code: 'en' }, { code: 'zh' }] } });
  }
  const locale = decodeURIComponent(pathname.slice('/api/v1/i18n/translations/'.length));
  if (translationsGate) await translationsGate;
  return json(200, { data: { locale, translations: { objects: { crm_lead: { label: '线索' } } } } });
}

// ---------------------------------------------------------------------------
// The two network clients the auth provider talks to
// ---------------------------------------------------------------------------

/** Nobody signed in; `signIn` answers as the server does, and the page load after it holds the session. */
function signedOutClient(): AuthClient {
  return {
    getSession: vi.fn().mockResolvedValue(null),
    getConfig: vi.fn().mockResolvedValue(OPEN),
    signIn: vi.fn(async () => ({ user: USER, session: SESSION })),
    ...memberOfOrg(),
  } as unknown as AuthClient;
}

/** The page load after sign-in: the session is there from the first read. */
function signedInClient(): AuthClient {
  return {
    getSession: vi.fn().mockResolvedValue({ user: USER, session: SESSION }),
    getConfig: vi.fn().mockResolvedValue(OPEN),
    ...memberOfOrg(),
  } as unknown as AuthClient;
}

function memberOfOrg(): Partial<AuthClient> {
  return {
    listOrganizations: vi.fn().mockResolvedValue([ORG]),
    getActiveOrganization: vi.fn().mockResolvedValue(ORG),
    setActiveOrganization: vi.fn().mockResolvedValue(ORG),
    getActiveMember: vi.fn().mockResolvedValue({ id: 'mem_12034', organizationId: ORG.id, userId: USER.id, role: 'owner' }),
  } as unknown as Partial<AuthClient>;
}

// ---------------------------------------------------------------------------
// Raw keys, on every frame
// ---------------------------------------------------------------------------

/**
 * What an i18next key drawn raw looks like: dot-separated identifier segments
 * and nothing else. Unicode letter classes, per AGENTS.md: an ASCII `\w` would
 * be blind to a key spelled in any other script.
 */
const KEY_SHAPE = /^[\p{L}_][\p{L}\p{N}_-]*(?:\.[\p{L}_][\p{L}\p{N}_-]*)+$/u;
const KEY_ATTRIBUTES = ['aria-label', 'placeholder', 'title', 'alt'];

function rawKeysIn(root: HTMLElement): string[] {
  const found: string[] = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = node.textContent?.trim() ?? '';
    if (KEY_SHAPE.test(text)) found.push(text);
  }
  for (const el of root.querySelectorAll('*')) {
    for (const name of KEY_ATTRIBUTES) {
      const value = el.getAttribute(name)?.trim();
      if (value && KEY_SHAPE.test(value)) found.push(value);
    }
  }
  return found;
}

/** Records every raw key drawn on any frame from now until `stop()`. */
function recordRawKeys(): { seen: Set<string>; stop: () => void } {
  const seen = new Set<string>();
  const scan = () => rawKeysIn(document.body).forEach((key) => seen.add(key));
  const observer = new MutationObserver(scan);
  observer.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true });
  scan();
  return {
    seen,
    stop: () => {
      scan();
      observer.disconnect();
    },
  };
}

// ---------------------------------------------------------------------------
// Boots
// ---------------------------------------------------------------------------

let assign: ReturnType<typeof vi.fn>;

/** One page load of the console at `url`, as `main.tsx` mounts it. */
async function bootConsole(url: string, client: AuthClient) {
  authClient.current = client;
  window.history.pushState({}, '', url);
  await preloadBootstrapLocale({ hasLoader: true });
  return render(
    <StrictMode>
      <I18nProvider loadLanguage={loadLanguage} loadLocales={loadLocales}>
        <App />
      </I18nProvider>
    </StrictMode>,
  );
}

/** Sign in through the real form; resolves with where the console's full-page exit goes. */
async function signInThroughTheForm(): Promise<string> {
  const user = userEvent.setup();
  await user.type(await screen.findByLabelText(zh.auth.login.emailLabel), 'ada@example.com');
  await user.type(screen.getByLabelText(zh.auth.login.passwordLabel), 'correct horse');
  await user.click(screen.getByRole('button', { name: zh.auth.login.submitButton }));
  await waitFor(() => expect(assign).toHaveBeenCalled());
  return assign.mock.calls[0][0] as string;
}

beforeEach(() => {
  window.localStorage.clear();
  TokenStorage.clear();
  // A Chinese reader, so "drawn from the built-in pack" is visible as Chinese.
  window.localStorage.setItem(LOCALE_STORAGE_KEY, 'zh');
  i18nReads = [];
  translationsGate = null;
  vi.stubGlobal('fetch', vi.fn(framework));
  assign = vi.fn();
  vi.spyOn(window.location, 'assign').mockImplementation(assign as never);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  TokenStorage.clear();
  window.localStorage.clear();
  window.history.pushState({}, '', '/');
});

describe('console i18n before and after sign-in (objectui#12034)', () => {
  it('signed out, the sign-in page asks /i18n nothing and is drawn from the built-in pack, through the sign-in itself', async () => {
    await bootConsole('/login?redirect=%2Fapps%2Fcrm', signedOutClient());

    expect(await screen.findByLabelText(zh.auth.login.emailLabel)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: zh.auth.login.submitButton })).toBeInTheDocument();

    const exit = await signInThroughTheForm();

    expect(new URL(exit, window.location.href).pathname).toBe('/apps/crm');
    expect(i18nReads).toEqual([]);
  });

  it('signed in, the application label comes from the authenticated /i18n reads, and the mounted heading re-renders to it', async () => {
    let release!: () => void;
    translationsGate = new Promise<void>((resolve) => {
      release = resolve;
    });
    TokenStorage.set(TOKEN);
    await bootConsole('/apps/crm', signedInClient());

    // First render after sign-in: the authored literal and the built-in pack, no key.
    const heading = await screen.findByRole('heading', { name: 'Lead' });
    expect(screen.getByRole('button', { name: zh.common.save })).toBeInTheDocument();

    release();

    await waitFor(() => expect(heading).toHaveTextContent('线索'));
    expect(heading).toBeInTheDocument();
    // The locale list is read after the console's first paint (objectui#12980),
    // so it may land a beat after the heading re-renders.
    await waitFor(() =>
      expect(i18nReads).toEqual(
        expect.arrayContaining([
          { path: '/api/v1/i18n/translations/zh', authorization: `Bearer ${TOKEN}`, status: 200 },
          { path: '/api/v1/i18n/locales', authorization: `Bearer ${TOKEN}`, status: 200 },
        ]),
      ),
    );
    expect(i18nReads.every((read) => read.status === 200)).toBe(true);
  });

  it('against a framework that refuses an anonymous /i18n read, the whole sign-in → app path draws no raw key on any frame', async () => {
    const recorder = recordRawKeys();

    await bootConsole('/login?redirect=%2Fapps%2Fcrm', signedOutClient());
    const exit = await signInThroughTheForm();

    // The full-page navigation: this page load ends, the next one starts signed in.
    cleanup();
    TokenStorage.set(TOKEN);
    await bootConsole(exit, signedInClient());
    expect(await screen.findByRole('heading', { name: '线索' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: zh.common.save })).toBeInTheDocument();

    recorder.stop();
    expect([...recorder.seen]).toEqual([]);
    expect(i18nReads.length).toBeGreaterThan(0);
    expect(i18nReads.filter((read) => read.status !== 200)).toEqual([]);
  });

  it('control: the raw-key recorder catches a key that is drawn raw', async () => {
    const recorder = recordRawKeys();
    function MissingKey() {
      const { t } = useObjectTranslation();
      return <p>{t('console.noSuchKey12034')}</p>;
    }
    // `missingKeyHandler` warns in development builds; the warning is not the subject here.
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    render(
      <I18nProvider persistLanguage={false}>
        <MissingKey />
      </I18nProvider>,
    );

    await waitFor(() => expect(recorder.seen.has('console.noSuchKey12034')).toBe(true));
    recorder.stop();
  });
});
