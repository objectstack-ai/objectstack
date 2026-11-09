/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Native shell mode, as the real `App` wires it to its router.
 *
 * The ObjectStack mobile shell injects `window.ObjectStackNative` before the
 * Console's scripts run. With a fake bridge installed before `App` renders,
 * the Console must post `ready()` once, after the first route has rendered,
 * post `routeChanged` with the router path on every navigation, and move its
 * own router (no document reload) when the shell dispatches
 * `objectstack-native:navigate`. Without the global, every one of those is
 * absent: that is the control half of each case.
 *
 * `App` is the real module under the real `BrowserRouter`; the pages and the
 * shell chrome are stubs, as in `App.docsPortalLazy.test.tsx`, because this
 * file is about the router wiring, not about what the pages draw.
 */

import { describe, expect, it, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup, act } from '@testing-library/react';
import type { ReactNode } from 'react';
import {
  NATIVE_CONNECTION_REMOVED_EVENT,
  NATIVE_HOST_GLOBAL,
  NATIVE_NAVIGATE_EVENT,
  resetNativeHostEventsForTests,
  type ObjectStackNative,
} from '../../../../packages/mobile/src/nativeHost';
import { resetNativeHostWatchForTests } from '../../../../packages/mobile/src/useNativeHost';
import {
  NATIVE_PUSH_PROMPT_DELAY_MS,
  NATIVE_PUSH_REGISTRATION_KEY,
  resetNativePushRegistrationForTests,
} from '../nativePushRegistration';

const { passthrough, stub, shellState, authState } = vi.hoisted(() => {
  const passthrough = ({ children }: { children?: ReactNode }) => <>{children}</>;
  const stub = (testid: string) => () => <div data-testid={testid} />;
  // objectstack#29750: what the shell's navigation context and the metadata
  // provider answer. The defaults are what this file's other cases read
  // without either provider: no current app, an empty app list, not loading.
  const shellState = {
    currentAppName: undefined as string | undefined,
    apps: [] as Array<Record<string, unknown>>,
    loading: false,
    appStatus: undefined as 'idle' | 'loading' | 'ready' | 'error' | undefined,
  };
  // objectstack#29042: who the auth context names. The default is what this
  // file's other cases read: a user id and no session answer.
  const authState = { value: { user: { id: 'u1' } } as Record<string, unknown> };
  return { passthrough, stub, shellState, authState };
});

vi.mock('@object-ui/app-shell', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  ConsoleShell: passthrough,
  ConsoleToaster: () => null,
  LoadingScreen: stub('loading-screen'),
  // Records where it would go, so the catch-all's answer is readable.
  RedirectWithSplash: ({ to }: { to: string }) => <div data-testid="redirect-with-splash" data-to={to} />,
  LoadingFallback: stub('loading-fallback'),
  useNavigationContext: () => ({
    context: 'app',
    setContext: () => {},
    currentAppName: shellState.currentAppName,
    setCurrentAppName: () => {},
    recordTitle: undefined,
    setRecordTitle: () => {},
  }),
  useMetadata: () => ({
    apps: shellState.apps,
    loading: shellState.loading,
    getTypeStatus: (type: string) => (type === 'app' ? shellState.appStatus : undefined),
  }),
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
  useAuth: () => authState.value,
}));

vi.mock('../AppContent', () => ({
  AppContent: stub('app-content'),
  ConsolePermissionsScope: ({ children }: { children?: ReactNode }) => <>{children}</>,
  // objectstack#29114: the early permissions request beside the route, nothing here.
  ConsolePermissionsRequest: () => null,
}));
vi.mock('../components/ProtectedRoute', () => ({ ProtectedRoute: passthrough }));
// objectstack#29750: the catch-all reads `isAppListConclusive` from here.
vi.mock('../components/RootLandingRedirect', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  RootLandingRedirect: stub('root-landing'),
}));
vi.mock('../components/SetupRoute', () => ({ SetupRoute: stub('setup-route') }));
vi.mock('../components/FormPage', () => ({ FormPage: stub('form-page') }));
vi.mock('../components/InternalFormRoute', () => ({ InternalFormRoute: stub('internal-form-route') }));
vi.mock('../components/MetadataHmrReloader', () => ({ MetadataHmrReloader: () => null }));
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

/** The fake bridge: the contract's members, recording what the Console posts. */
function installBridge() {
  const events: string[] = [];
  const bridge: ObjectStackNative = {
    version: 1,
    platform: 'android',
    appVersion: '2.0.0',
    capabilities: ['getPushToken', 'haptic', 'openExternal', 'navigate', 'resetServer'],
    safeArea: { top: 24, bottom: 16, left: 0, right: 0 },
    has: () => true,
    getPushToken: async () => null,
    haptic: async () => null,
    openExternal: async () => null,
    navigate: async () => null,
    resetServer: async () => null,
    // What the page shows at the moment `ready` arrives: the shell lifts its
    // loading cover on it, so the first route must already be on screen.
    ready: () => events.push(`ready:${screen.queryByTestId('login-page') ? 'login-page' : 'nothing'}`),
    routeChanged: (route: string) => events.push(`route:${route}`),
  };
  (window as unknown as Record<string, unknown>)[NATIVE_HOST_GLOBAL] = bridge;
  return events;
}

function dispatchNavigate(route: unknown): CustomEvent {
  const event = new CustomEvent(NATIVE_NAVIGATE_EVENT, { cancelable: true, detail: { route } });
  act(() => {
    window.dispatchEvent(event);
  });
  return event;
}

beforeEach(() => {
  resetNativeHostEventsForTests();
  resetNativeHostWatchForTests();
  shellState.currentAppName = undefined;
  shellState.apps = [];
  shellState.loading = false;
  shellState.appStatus = undefined;
  authState.value = { user: { id: 'u1' } };
  resetNativePushRegistrationForTests();
  sessionStorage.clear();
  window.history.pushState({}, '', '/login');
});

afterEach(() => {
  cleanup();
  delete (window as unknown as Record<string, unknown>)[NATIVE_HOST_GLOBAL];
  window.history.pushState({}, '', '/');
});

describe('the Console in the mobile shell', () => {
  it('posts ready once, after the first route rendered, and the route the router is on', async () => {
    const events = installBridge();
    render(<App />);
    expect(await screen.findByTestId('login-page')).toBeInTheDocument();
    expect(events).toEqual(['ready:login-page', 'route:/login']);
    expect(document.documentElement.getAttribute('data-os-native-shell')).toBe('android');
  });

  it('the shell navigate event moves the router without a reload, and posts that route once', async () => {
    const events = installBridge();
    render(<App />);
    await screen.findByTestId('login-page');
    const before = window.history.length;

    const event = dispatchNavigate('/register?from=push');
    expect(event.defaultPrevented).toBe(true);
    expect(await screen.findByTestId('register-page')).toBeInTheDocument();
    // The router pushed a history entry: an SPA move, not a document load.
    expect(window.location.pathname).toBe('/register');
    expect(window.history.length).toBe(before + 1);
    expect(events).toEqual(['ready:login-page', 'route:/login', 'route:/register?from=push']);
  });

  it('a route that is not an in-app path is left to the shell', async () => {
    const events = installBridge();
    render(<App />);
    await screen.findByTestId('login-page');
    const event = dispatchNavigate('//evil.example/register');
    expect(event.defaultPrevented).toBe(false);
    expect(window.location.pathname).toBe('/login');
    expect(events).toEqual(['ready:login-page', 'route:/login']);
  });
});

describe('control: the Console in a browser behaves as today', () => {
  it('posts nothing, marks nothing, and leaves the navigate event alone', async () => {
    render(<App />);
    expect(await screen.findByTestId('login-page')).toBeInTheDocument();
    expect(document.documentElement.hasAttribute('data-os-native-shell')).toBe(false);
    const event = dispatchNavigate('/register');
    expect(event.defaultPrevented).toBe(false);
    expect(window.location.pathname).toBe('/login');
  });
});

/**
 * objectstack#29750 — the shell's route is a push route, the notification's
 * `actionUrl`, and the push contract (`packages/spec/src/api/push-delivery.zod.ts`)
 * says it is resolved "as the inbox does, never verbatim": app-relative paths
 * are hosted under `/apps/APP/`, an `/apps/…` route passes through. Navigated
 * verbatim, `/opportunity/123` matched no route and the catch-all sent the
 * person to Home.
 */
describe('a push route from the shell is hosted the way the inbox hosts it', () => {
  it('an app-relative route is hosted under the app in the URL', async () => {
    installBridge();
    window.history.pushState({}, '', '/apps/crm/opportunity');
    render(<App />);
    await screen.findByTestId('app-content');
    const event = dispatchNavigate('/opportunity/123?tab=activity#notes');
    expect(event.defaultPrevented).toBe(true);
    expect(`${window.location.pathname}${window.location.search}${window.location.hash}`)
      .toBe('/apps/crm/opportunity/123?tab=activity#notes');
  });

  it('away from an app, the catch-all hosts it under the app the person last had open', async () => {
    // `currentAppName` is an app NAME; the catch-all turns it into the app's
    // route segment with the app list, which the listener does not have.
    installBridge();
    shellState.currentAppName = 'sales';
    shellState.apps = [{ name: 'crm', active: true }, { name: 'sales', active: true, _packageId: 'com.acme.sales' }];
    shellState.appStatus = 'ready';
    window.history.pushState({}, '', '/home');
    render(<App />);
    await screen.findByTestId('home-page');
    const event = dispatchNavigate('/opportunity/123');
    expect(event.defaultPrevented).toBe(true);
    expect(window.location.pathname).toBe('/opportunity/123');
    expect((await screen.findByTestId('redirect-with-splash')).getAttribute('data-to'))
      .toBe('/apps/com.acme.sales/opportunity/123');
  });

  it('a Console route under /apps passes through unchanged', async () => {
    installBridge();
    window.history.pushState({}, '', '/apps/crm/opportunity');
    render(<App />);
    await screen.findByTestId('app-content');
    const event = dispatchNavigate('/apps/x/y/1');
    expect(event.defaultPrevented).toBe(true);
    expect(window.location.pathname).toBe('/apps/x/y/1');
  });

  it('with no app open, the catch-all hosts the handed-over route under the default app', async () => {
    installBridge();
    shellState.apps = [{ name: 'crm', active: true }];
    shellState.appStatus = 'ready';
    render(<App />);
    await screen.findByTestId('login-page');
    const event = dispatchNavigate('/opportunity/123');
    expect(event.defaultPrevented).toBe(true);
    expect(window.location.pathname).toBe('/opportunity/123');
    expect((await screen.findByTestId('redirect-with-splash')).getAttribute('data-to'))
      .toBe('/apps/crm/opportunity/123');
  });
});

/**
 * objectstack#29750 — the same push route can arrive as the page's FIRST URL:
 * the mobile shell starts a re-created WebView at a held route, and falls back
 * to `location.assign` of it when no navigate listener answered. The
 * catch-all hosts an app-relative path like the inbox; a stale Console link
 * keeps the old redirect to `/`.
 */
describe('the catch-all hosts an app-relative first URL under an app', () => {
  function catchAllTarget(): Promise<string | null> {
    return screen.findByTestId('redirect-with-splash').then((el) => el.getAttribute('data-to'));
  }

  it('hosts it under the first active app, query and hash kept', async () => {
    shellState.apps = [{ name: 'gone', active: false }, { name: 'crm', active: true }];
    shellState.appStatus = 'ready';
    window.history.pushState({}, '', '/opportunity/123?tab=activity#notes');
    render(<App />);
    expect(await catchAllTarget()).toBe('/apps/crm/opportunity/123?tab=activity#notes');
  });

  it('hosts it under the app the person last had open while that app is still active', async () => {
    shellState.apps = [{ name: 'crm', active: true }, { name: 'sales', active: true }];
    shellState.appStatus = 'ready';
    shellState.currentAppName = 'sales';
    window.history.pushState({}, '', '/opportunity/123');
    render(<App />);
    expect(await catchAllTarget()).toBe('/apps/sales/opportunity/123');
  });

  it('waits for the app list before it answers', async () => {
    shellState.loading = true;
    window.history.pushState({}, '', '/opportunity/123');
    render(<App />);
    expect(await screen.findByTestId('loading-fallback')).toBeInTheDocument();
    expect(screen.queryByTestId('redirect-with-splash')).toBeNull();
  });

  it('waits while a session-cached app list is still being re-read', async () => {
    // Measured live: the provider stops `loading` on the cached list while
    // the app type's own status still reads `loading`.
    shellState.apps = [{ name: 'crm', active: true }];
    shellState.appStatus = 'loading';
    window.history.pushState({}, '', '/opportunity/123');
    render(<App />);
    expect(await screen.findByTestId('loading-fallback')).toBeInTheDocument();
    expect(screen.queryByTestId('redirect-with-splash')).toBeNull();
  });

  it('an app list that failed to load is no answer: the old redirect to / runs', async () => {
    shellState.appStatus = 'error';
    window.history.pushState({}, '', '/opportunity/123');
    render(<App />);
    expect(await catchAllTarget()).toBe('/');
  });

  it('control: a stale Console link still redirects to /', async () => {
    shellState.apps = [{ name: 'crm', active: true }];
    shellState.appStatus = 'ready';
    for (const path of ['/dev/nope', '/home/nope', '/apps']) {
      window.history.pushState({}, '', path);
      render(<App />);
      expect(await catchAllTarget()).toBe('/');
      cleanup();
    }
  });

  it('control: a real top-level Console route is never rewritten', async () => {
    shellState.apps = [{ name: 'crm', active: true }];
    shellState.appStatus = 'ready';
    window.history.pushState({}, '', '/home');
    render(<App />);
    expect(await screen.findByTestId('home-page')).toBeInTheDocument();
    expect(screen.queryByTestId('redirect-with-splash')).toBeNull();
    expect(window.location.pathname).toBe('/home');
  });
});

/**
 * objectstack#29042 — the router wiring of push registration: the route the
 * router is on decides when the token is asked for, and the shell's removal of
 * this connection is answered with the unregister, under the Console's session.
 */
describe('push registration through the router wiring', () => {
  const signedIn = { user: { id: 'u1' }, session: { token: 'session' }, isAuthenticated: true };

  function deviceCalls(fetchMock: ReturnType<typeof vi.fn>): string[] {
    return fetchMock.mock.calls
      .map(([url, init]) => `${(init as RequestInit | undefined)?.method ?? 'GET'} ${String(url)}`)
      .filter((call) => call.includes('/api/v1/notifications/devices'));
  }

  function stubFetch() {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => ({
      ok: true,
      status: 200,
      headers: new Headers(),
      json: async () => ({
        success: true,
        data: init?.method === 'POST' ? { deviceId: 'install-7', success: true } : { success: true },
      }),
    }));
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
  }

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('Home asks the shell for the token once the delay has passed, and registers it', async () => {
    const fetchMock = stubFetch();
    authState.value = signedIn;
    installBridge();
    const bridge = window[NATIVE_HOST_GLOBAL as keyof Window] as unknown as ObjectStackNative;
    const getPushToken = vi.spyOn(bridge, 'getPushToken').mockResolvedValue({ token: 'tok-1', vendor: 'fcm' });
    window.history.pushState({}, '', '/home');
    render(<App />);
    await screen.findByTestId('home-page');
    expect(getPushToken).not.toHaveBeenCalled();
    await vi.waitFor(
      () => expect(deviceCalls(fetchMock)).toEqual([expect.stringMatching(/^POST .*\/api\/v1\/notifications\/devices$/)]),
      { timeout: NATIVE_PUSH_PROMPT_DELAY_MS + 2000 },
    );
    expect(getPushToken).toHaveBeenCalledTimes(1);
  });

  it('the shell removing this connection waits for the unregister of the registered device', async () => {
    const fetchMock = stubFetch();
    authState.value = signedIn;
    sessionStorage.setItem(
      NATIVE_PUSH_REGISTRATION_KEY,
      JSON.stringify({ userId: 'u1', token: 'tok-1', vendor: 'fcm', deviceId: 'install-7' }),
    );
    installBridge();
    render(<App />);
    await screen.findByTestId('login-page');

    const held: Promise<unknown>[] = [];
    const event = new Event(NATIVE_CONNECTION_REMOVED_EVENT);
    Object.assign(event, { waitUntil: (promise: Promise<unknown>) => held.push(promise) });
    act(() => {
      window.dispatchEvent(event);
    });
    expect(held).toHaveLength(1);
    await held[0];
    expect(deviceCalls(fetchMock)).toEqual([expect.stringMatching(/^DELETE .*\/api\/v1\/notifications\/devices\/install-7$/)]);
    expect(sessionStorage.getItem(NATIVE_PUSH_REGISTRATION_KEY)).toBeNull();
  });
});
