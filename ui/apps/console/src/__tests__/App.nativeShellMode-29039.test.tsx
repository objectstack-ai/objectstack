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
  NATIVE_HOST_GLOBAL,
  NATIVE_NAVIGATE_EVENT,
  resetNativeHostEventsForTests,
  type ObjectStackNative,
} from '../../../../packages/mobile/src/nativeHost';
import { resetNativeHostWatchForTests } from '../../../../packages/mobile/src/useNativeHost';

const { passthrough, stub } = vi.hoisted(() => {
  const passthrough = ({ children }: { children?: ReactNode }) => <>{children}</>;
  const stub = (testid: string) => () => <div data-testid={testid} />;
  return { passthrough, stub };
});

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
}));

vi.mock('@object-ui/auth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  AuthProvider: passthrough,
  useAuth: () => ({ user: { id: 'u1' } }),
}));

vi.mock('../AppContent', () => ({
  AppContent: stub('app-content'),
  ConsolePermissionsScope: ({ children }: { children?: ReactNode }) => <>{children}</>,
  // objectstack#29114: the early permissions request beside the route, nothing here.
  ConsolePermissionsRequest: () => null,
}));
vi.mock('../components/ProtectedRoute', () => ({ ProtectedRoute: passthrough }));
vi.mock('../components/RootLandingRedirect', () => ({ RootLandingRedirect: stub('root-landing') }));
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
