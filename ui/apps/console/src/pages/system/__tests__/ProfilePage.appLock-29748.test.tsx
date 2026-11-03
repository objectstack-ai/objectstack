// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Profile — the mobile shell's App lock row (objectstack#29748).
 *
 * Inside the ObjectStack mobile shell, a bridge that announces
 * `openAppLockSettings` gets an "App lock" row on the profile page. Its state
 * comes from `getAppLock()`; a tap opens the shell's native settings screen.
 * The lock itself is the shell's: by ruling (objectstack-ai/mobile#145,
 * option A) the Console reads it and never writes it, so the row offers no
 * toggle. The contract is objectstack-ai/mobile `docs/HYBRID-SHELL.md`,
 * "App lock" and "Reading the app lock".
 *
 * These cases render the REAL page and the REAL `@object-ui/mobile` bridge
 * reader against a fake `window.ObjectStackNative`; only the page's data
 * hooks are stubbed, as in the sibling profile suites. The translator echoes
 * each call site's `defaultValue`, filling its holes, and is a spy so a case
 * can name the pack key it read.
 *
 * CONTROL: no bridge, a bridge without the method, and a bridge whose `has()`
 * says no all draw no row and call nothing.
 */

import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi, type Mock } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const { ADAPTER, translate } = vi.hoisted(() => ({
  // A STABLE adapter, as the app's provider hands out (see the sibling suites).
  ADAPTER: { findOne: async () => ({ id: 'usr_1' }), update: async () => ({}) },
  translate: vi.fn((key: string, options?: Record<string, unknown>) =>
    String(options?.defaultValue ?? key).replace(/\{\{(\w+)\}\}/g, (_hole, name: string) =>
      String(options?.[name] ?? ''),
    ),
  ),
}));

vi.mock('@object-ui/auth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAuth: () => ({
    user: { id: 'usr_1', name: 'Ada', email: 'ada@example.com' },
    updateUser: async () => {},
    isLoading: false,
    changePassword: async () => {},
    setInitialPassword: async () => {},
    hasLocalPassword: async () => true,
  }),
}));

vi.mock('@object-ui/providers', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useUpload: () => ({ upload: async () => ({ url: '' }) }),
}));

vi.mock('@object-ui/i18n', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useObjectTranslation: () => ({ t: translate, language: 'en', offerableLanguages: ['en'] }),
}));

vi.mock('@object-ui/react', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAdapter: () => ADAPTER,
}));

vi.mock('@object-ui/permissions', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  usePermissions: () => ({ isLoaded: true, checkField: () => true }),
}));

// Imported after the mocks so the page picks them up.
const { ProfilePage } = await import('../ProfilePage');

type AppLock = { enabled: boolean; timeoutSeconds: number };

/** Every method the shell dispatches on, so a case can show none but the two it allows were called. */
const OTHER_METHODS = [
  'getPushToken',
  'haptic',
  'openExternal',
  'navigate',
  'resetServer',
  'scan',
  'showConnectionSwitcher',
] as const;

function fakeShell(
  lock: AppLock,
  { capabilities = ['getAppLock', 'openAppLockSettings'] as readonly string[] } = {},
) {
  const bridge: Record<string, unknown> & { getAppLock: Mock; openAppLockSettings: Mock } = {
    version: 1,
    platform: 'ios',
    appVersion: '2.0.0',
    capabilities,
    safeArea: { top: 0, bottom: 0, left: 0, right: 0 },
    has: (capability: string) => capabilities.includes(capability),
    getAppLock: vi.fn(async () => ({ ...lock })),
    openAppLockSettings: vi.fn(async () => null),
    ready: vi.fn(),
    routeChanged: vi.fn(),
  };
  for (const method of OTHER_METHODS) bridge[method] = vi.fn(async () => null);
  return bridge;
}

function install(bridge: unknown) {
  (window as unknown as Record<string, unknown>).ObjectStackNative = bridge;
}

afterEach(() => {
  cleanup();
  delete (window as unknown as Record<string, unknown>).ObjectStackNative;
  translate.mockClear();
});

/** Render, and let the language card's row read settle so a missing row is not a race. */
async function renderPage() {
  const utils = render(<ProfilePage />);
  await waitFor(() => expect(screen.getByTestId('profile-language-select')).toBeInTheDocument());
  return utils;
}

describe('Profile — the App lock row inside the mobile shell (objectstack#29748)', () => {
  it('shows the lock as on, with its timeout, from getAppLock()', async () => {
    const bridge = fakeShell({ enabled: true, timeoutSeconds: 300 });
    install(bridge);
    await renderPage();

    const row = await screen.findByTestId('profile-app-lock-row');
    expect(row).toHaveTextContent('App lock');
    await waitFor(() =>
      expect(screen.getByTestId('profile-app-lock-state')).toHaveTextContent(
        'On, locks 5 minutes after you leave the app',
      ),
    );
    expect(translate).toHaveBeenCalledWith('profile.appLock.onAfter', expect.objectContaining({ duration: '5 minutes' }));
    expect(bridge.getAppLock).toHaveBeenCalledWith();
  });

  it('shows "immediately" for a zero timeout and an hour in hours', async () => {
    install(fakeShell({ enabled: true, timeoutSeconds: 0 }));
    await renderPage();
    await waitFor(() =>
      expect(screen.getByTestId('profile-app-lock-state')).toHaveTextContent('On, locks as soon as you leave the app'),
    );
    cleanup();

    install(fakeShell({ enabled: true, timeoutSeconds: 3600 }));
    await renderPage();
    await waitFor(() =>
      expect(screen.getByTestId('profile-app-lock-state')).toHaveTextContent('On, locks 1 hour after you leave the app'),
    );
  });

  it('shows the lock as off', async () => {
    install(fakeShell({ enabled: false, timeoutSeconds: 300 }));
    await renderPage();
    await waitFor(() => expect(screen.getByTestId('profile-app-lock-state')).toHaveTextContent('Off'));
    expect(translate).toHaveBeenCalledWith('profile.appLock.off', expect.anything());
  });

  it('a tap opens the native settings screen once, and offers no toggle', async () => {
    const bridge = fakeShell({ enabled: false, timeoutSeconds: 300 });
    install(bridge);
    await renderPage();

    const row = await screen.findByTestId('profile-app-lock-row');
    expect(row.tagName).toBe('BUTTON');
    expect(screen.getByTestId('profile-app-lock').querySelector('[role="switch"], input[type="checkbox"]')).toBeNull();

    fireEvent.click(row);
    await waitFor(() => expect(bridge.openAppLockSettings).toHaveBeenCalledTimes(1));
    expect(bridge.openAppLockSettings).toHaveBeenCalledWith();
    // Only the read and the open: nothing else on the bridge is touched.
    for (const method of OTHER_METHODS) expect(bridge[method]).not.toHaveBeenCalled();
  });

  it('reads the lock again when the page is shown again, since no event announces a change', async () => {
    let lock: AppLock = { enabled: false, timeoutSeconds: 300 };
    const bridge = fakeShell(lock);
    bridge.getAppLock.mockImplementation(async () => ({ ...lock }));
    install(bridge);
    await renderPage();
    await waitFor(() => expect(screen.getByTestId('profile-app-lock-state')).toHaveTextContent('Off'));
    const readsOnMount = bridge.getAppLock.mock.calls.length;

    // The user turned the lock on in the native screen and came back.
    lock = { enabled: true, timeoutSeconds: 60 };
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await waitFor(() =>
      expect(screen.getByTestId('profile-app-lock-state')).toHaveTextContent(
        'On, locks 1 minute after you leave the app',
      ),
    );
    expect(bridge.getAppLock.mock.calls.length).toBeGreaterThan(readsOnMount);

    lock = { enabled: false, timeoutSeconds: 60 };
    await act(async () => {
      window.dispatchEvent(new Event('focus'));
    });
    await waitFor(() => expect(screen.getByTestId('profile-app-lock-state')).toHaveTextContent('Off'));
  });

  it('a read the shell refuses leaves the row without a state line', async () => {
    const bridge = fakeShell({ enabled: true, timeoutSeconds: 300 });
    bridge.getAppLock.mockImplementation(async () => {
      throw Object.assign(new Error('nope'), { code: 'failed' });
    });
    install(bridge);
    await renderPage();
    expect(await screen.findByTestId('profile-app-lock-row')).toBeInTheDocument();
    await waitFor(() => expect(bridge.getAppLock).toHaveBeenCalled());
    expect(screen.queryByTestId('profile-app-lock-state')).toBeNull();
  });
});

describe('Profile — no App lock row outside a shell that offers it (CONTROL, objectstack#29748)', () => {
  it('a plain browser (no bridge) draws no row', async () => {
    await renderPage();
    expect(screen.queryByTestId('profile-app-lock')).toBeNull();
    expect(translate).not.toHaveBeenCalledWith('profile.appLock.title', expect.anything());
  });

  it('an older shell without the method draws no row and reads nothing', async () => {
    const bridge = fakeShell({ enabled: true, timeoutSeconds: 300 }, { capabilities: ['getPushToken'] });
    delete (bridge as Record<string, unknown>).openAppLockSettings;
    install(bridge);
    await renderPage();
    expect(screen.queryByTestId('profile-app-lock')).toBeNull();
    expect(bridge.getAppLock).not.toHaveBeenCalled();
  });

  it('a bridge whose has() does not announce openAppLockSettings draws no row and reads nothing', async () => {
    const bridge = fakeShell({ enabled: true, timeoutSeconds: 300 }, { capabilities: ['getAppLock'] });
    install(bridge);
    await renderPage();
    expect(screen.queryByTestId('profile-app-lock')).toBeNull();
    expect(bridge.getAppLock).not.toHaveBeenCalled();
    expect(bridge.openAppLockSettings).not.toHaveBeenCalled();
  });
});
