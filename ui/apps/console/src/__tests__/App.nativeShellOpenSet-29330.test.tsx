/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Native shell mode beyond the mobile app, as the real `App` wires it.
 *
 * `ObjectStackNative.platform` is an open set: the desktop shell reports a
 * value other than `ios` or `android`, and announces only the capabilities it
 * has. The Console must treat that host exactly like the mobile one: shell
 * mode on, `ready` posted once, the root attribute carrying the platform
 * verbatim, and no call to a method the shell did not announce.
 *
 * Two more pins sit beside it:
 *
 * - `ready` means "the Console has painted its own UI". On a cold start to a
 *   protected route that UI is the auth guard's loading fallback, and `ready`
 *   is posted while it is still on screen, so the shell's loading cover hands
 *   over to the Console's spinner instead of waiting out the session read.
 * - A bridge speaking a newer protocol than this Console (`version` 2) reads
 *   as no bridge: no shell mode and no `ready`.
 *
 * `App` is the real module under the real `BrowserRouter`, and so are
 * `ProtectedRoute` and `AuthGuard`; the pages and the shell chrome are stubs,
 * as in `App.nativeShellMode-29039.test.tsx`.
 */

import { describe, expect, it, vi, afterEach, beforeEach, type Mock } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import type { ReactNode } from 'react';
import {
  NATIVE_HOST_GLOBAL,
  nativeGetPushToken,
  nativeHaptic,
  nativeNavigate,
  nativeOpenExternal,
  nativeResetServer,
  resetNativeHostEventsForTests,
  type ObjectStackNative,
} from '../../../../packages/mobile/src/nativeHost';
import { resetNativeHostWatchForTests } from '../../../../packages/mobile/src/useNativeHost';

const { passthrough, stub, authState } = vi.hoisted(() => {
  const passthrough = ({ children }: { children?: ReactNode }) => <>{children}</>;
  const stub = (testid: string) => () => <div data-testid={testid} />;
  /** What the session read has answered so far; `isLoading` is a cold start. */
  const authState = { isLoading: false };
  return { passthrough, stub, authState };
});

vi.mock('@object-ui/app-shell', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  ConsoleShell: passthrough,
  ConsoleToaster: () => null,
  ConnectedShell: passthrough,
  RequireOrganization: passthrough,
  LoadingFallback: stub('auth-loading-fallback'),
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

// The real `AuthGuard` reads the real auth context. The provider is replaced
// by one that publishes `authState`, so a test can hold the session read open.
vi.mock('@object-ui/auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@object-ui/auth')>();
  const { AuthCtx } = await import('../../../../packages/auth/src/AuthContext');
  function AuthStateProvider({ children }: { children?: ReactNode }) {
    // Outside any provider `useAuth` answers its signed-out defaults.
    const signedOut = actual.useAuth();
    return <AuthCtx.Provider value={{ ...signedOut, isLoading: authState.isLoading }}>{children}</AuthCtx.Provider>;
  }
  return { ...actual, AuthProvider: AuthStateProvider };
});

vi.mock('../AppContent', () => ({
  AppContent: stub('app-content'),
  ConsolePermissionsScope: ({ children }: { children?: ReactNode }) => <>{children}</>,
  ConsolePermissionsRequest: () => null,
}));
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

type FakeBridge = ObjectStackNative & {
  getPushToken: Mock<ObjectStackNative['getPushToken']>;
  haptic: Mock<ObjectStackNative['haptic']>;
  openExternal: Mock<ObjectStackNative['openExternal']>;
  navigate: Mock<ObjectStackNative['navigate']>;
  resetServer: Mock<ObjectStackNative['resetServer']>;
};

/**
 * A fake bridge recording what the Console posts. `ready` notes which of the
 * two first screens is up when it arrives: the shell lifts its cover on it.
 */
function installBridge({
  platform,
  version = 1,
  capabilities,
}: {
  platform: string;
  version?: number;
  capabilities: readonly string[];
}): { bridge: FakeBridge; events: string[] } {
  const events: string[] = [];
  const onScreen = () =>
    screen.queryByTestId('auth-loading-fallback')
      ? 'auth-loading-fallback'
      : screen.queryByTestId('login-page')
        ? 'login-page'
        : 'nothing';
  const bridge: FakeBridge = {
    version,
    platform,
    appVersion: '1.0.0',
    capabilities,
    safeArea: { top: 0, bottom: 0, left: 0, right: 0 },
    has: (capability: string) => capabilities.includes(capability),
    getPushToken: vi.fn(async () => null),
    haptic: vi.fn(async () => null),
    openExternal: vi.fn(async () => null),
    navigate: vi.fn(async () => null),
    resetServer: vi.fn(async () => null),
    ready: () => events.push(`ready:${onScreen()}`),
    routeChanged: (route: string) => events.push(`route:${route}`),
  };
  (window as unknown as Record<string, unknown>)[NATIVE_HOST_GLOBAL] = bridge;
  return { bridge, events };
}

beforeEach(() => {
  resetNativeHostEventsForTests();
  resetNativeHostWatchForTests();
  authState.isLoading = false;
  window.history.pushState({}, '', '/login');
});

afterEach(() => {
  cleanup();
  delete (window as unknown as Record<string, unknown>)[NATIVE_HOST_GLOBAL];
  window.history.pushState({}, '', '/');
});

describe('a shell whose platform is neither ios nor android', () => {
  it('desktop with a capability subset: shell mode on, ready once, the platform verbatim, nothing unannounced called', async () => {
    const { bridge, events } = installBridge({ platform: 'desktop', capabilities: ['haptic', 'openExternal'] });
    const { rerender } = render(<App />);
    expect(await screen.findByTestId('login-page')).toBeInTheDocument();

    expect(document.documentElement.getAttribute('data-os-native-shell')).toBe('desktop');
    expect(events).toEqual(['ready:login-page', 'route:/login']);

    // Every typed call, from inside the running Console: the announced ones
    // reach the shell, the rest resolve `unavailable` without a call.
    await expect(nativeHaptic('success')).resolves.toEqual({ status: 'ok', value: null });
    await expect(nativeOpenExternal('https://example.com')).resolves.toEqual({ status: 'ok', value: null });
    await expect(nativeGetPushToken()).resolves.toEqual({ status: 'unavailable' });
    await expect(nativeNavigate('/home')).resolves.toEqual({ status: 'unavailable' });
    await expect(nativeResetServer()).resolves.toEqual({ status: 'unavailable' });

    rerender(<App />);
    expect(events.filter((e) => e.startsWith('ready:'))).toHaveLength(1);
    expect(bridge.haptic).toHaveBeenCalledTimes(1);
    expect(bridge.openExternal).toHaveBeenCalledTimes(1);
    expect(bridge.getPushToken).not.toHaveBeenCalled();
    expect(bridge.navigate).not.toHaveBeenCalled();
    expect(bridge.resetServer).not.toHaveBeenCalled();
  });
});

describe('what ready means: the Console has painted its own UI', () => {
  it('a cold start to a protected route posts ready while the auth guard still shows its loading fallback', async () => {
    authState.isLoading = true;
    window.history.pushState({}, '', '/');
    const { events } = installBridge({ platform: 'ios', capabilities: [] });
    render(<App />);
    expect(await screen.findByTestId('auth-loading-fallback')).toBeInTheDocument();
    // The session is still being read: the guard has not let the route through.
    expect(screen.queryByTestId('root-landing')).not.toBeInTheDocument();
    expect(events).toEqual(['ready:auth-loading-fallback', 'route:/']);
  });
});

describe('a bridge speaking a newer protocol is no bridge', () => {
  it('version 2: no shell mode, no ready, no route posts', async () => {
    const { events } = installBridge({ platform: 'ios', version: 2, capabilities: ['haptic'] });
    render(<App />);
    expect(await screen.findByTestId('login-page')).toBeInTheDocument();
    expect(document.documentElement.hasAttribute('data-os-native-shell')).toBe(false);
    expect(events).toEqual([]);
    await expect(nativeHaptic('success')).resolves.toEqual({ status: 'unavailable' });
  });

  it('control: version 1, the same bridge otherwise, is the shell', async () => {
    const { events } = installBridge({ platform: 'ios', version: 1, capabilities: ['haptic'] });
    render(<App />);
    expect(await screen.findByTestId('login-page')).toBeInTheDocument();
    expect(document.documentElement.getAttribute('data-os-native-shell')).toBe('ios');
    expect(events).toEqual(['ready:login-page', 'route:/login']);
  });
});
