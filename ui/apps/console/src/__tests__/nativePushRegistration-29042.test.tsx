/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The Console registers the mobile shell's push token under its own session
 * (objectstack#29042).
 *
 * A fake bridge stands in for the shell and a fake `fetch` for the server: the
 * assertions read the requests that reach `/api/v1/notifications/devices`. The
 * auth state is the real context with a test-held value, so sign-in, a person
 * switch and an impersonation are re-renders.
 */

import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';
import type { ReactNode } from 'react';
import { AuthCtx, type AuthContextValue } from '../../../../packages/auth/src/AuthContext';
import { useAuth } from '../../../../packages/auth/src/useAuth';
import { resetBeforeSignOutForTests, runBeforeSignOut } from '../../../../packages/auth/src/beforeSignOut';
import {
  NATIVE_HOST_GLOBAL,
  NATIVE_PUSH_TOKEN_CHANGED_EVENT,
  type NativePushToken,
  type ObjectStackNative,
} from '../../../../packages/mobile/src/nativeHost';
import { resetNativeHostWatchForTests } from '../../../../packages/mobile/src/useNativeHost';
import {
  NATIVE_PUSH_PROMPT_DELAY_MS,
  NATIVE_PUSH_REGISTRATION_KEY,
  registrationOrigin,
  resetNativePushRegistrationForTests,
  useNativePushRegistration,
} from '../nativePushRegistration';

const DEVICES = '/api/v1/notifications/devices';

interface AuthState {
  userId: string | null;
  impersonatedBy?: string;
}

type FakeBridge = ObjectStackNative & { getPushToken: Mock<ObjectStackNative['getPushToken']> };

function installBridge({
  token = { token: 'tok-1', vendor: 'apns' },
  platform = 'ios',
  capabilities = ['getPushToken', 'pushTokenChanged'],
  installId,
}: {
  token?: NativePushToken | null;
  platform?: string;
  capabilities?: readonly string[];
  installId?: string | null;
} = {}): FakeBridge {
  const bridge: FakeBridge = {
    version: 1,
    platform,
    appVersion: '2.1.0',
    capabilities,
    safeArea: { top: 0, bottom: 0, left: 0, right: 0 },
    ...(installId !== undefined ? { installId } : {}),
    has: (capability: string) => capabilities.includes(capability),
    getPushToken: vi.fn(async () => token),
    haptic: async () => null,
    openExternal: async () => null,
    navigate: async () => null,
    resetServer: async () => null,
    ready: () => {},
    routeChanged: () => {},
  };
  (window as unknown as Record<string, unknown>)[NATIVE_HOST_GLOBAL] = bridge;
  return bridge;
}

let fetchMock: Mock;
let unregister: (() => Promise<void>) | null = null;

function answer(status: number, body: unknown) {
  return { ok: status >= 200 && status < 300, status, statusText: String(status), headers: new Headers(), json: async () => body };
}

function deviceRequests(): Array<{ method: string; url: string; body: unknown }> {
  return fetchMock.mock.calls
    .map(([url, init]: [string, RequestInit | undefined]) => ({
      method: init?.method ?? 'GET',
      url: String(url),
      body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined,
    }))
    .filter((request) => request.url.includes(DEVICES));
}

function Probe({ pathname }: { pathname: string }) {
  unregister = useNativePushRegistration(pathname);
  return null;
}

function Harness({ auth, pathname }: { auth: AuthState; pathname: string }): ReactNode {
  // Outside a provider `useAuth` answers its signed-out defaults; the test overrides who.
  const signedOut = useAuth();
  const value: AuthContextValue = {
    ...signedOut,
    isAuthenticated: auth.userId !== null,
    user: auth.userId ? ({ id: auth.userId, email: `${auth.userId}@example.com`, name: auth.userId } as AuthContextValue['user']) : null,
    session: auth.userId
      ? ({ token: 'session', ...(auth.impersonatedBy ? { impersonatedBy: auth.impersonatedBy } : {}) } as AuthContextValue['session'])
      : null,
  };
  return (
    <AuthCtx.Provider value={value}>
      <Probe pathname={pathname} />
    </AuthCtx.Provider>
  );
}

/** Let the prompt delay pass, then let the shell's answer and the request settle. */
async function passPromptDelay() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(NATIVE_PUSH_PROMPT_DELAY_MS);
  });
}

async function settle() {
  await act(async () => {
    for (let i = 0; i < 10; i += 1) await Promise.resolve();
  });
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  resetNativeHostWatchForTests();
  resetNativePushRegistrationForTests();
  resetBeforeSignOutForTests();
  sessionStorage.clear();
  unregister = null;
  fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (String(url).endsWith(DEVICES) && init?.method === 'POST') {
      const body = JSON.parse(String(init.body)) as { deviceId?: string };
      return answer(200, { success: true, data: { deviceId: body.deviceId ?? 'minted-1', success: true } });
    }
    if (String(url).includes(`${DEVICES}/`) && init?.method === 'DELETE') {
      return answer(200, { success: true, data: { success: true } });
    }
    return answer(404, { success: false, error: { code: 'NOT_FOUND', message: 'no' } });
  });
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  delete (window as unknown as Record<string, unknown>)[NATIVE_HOST_GLOBAL];
});

describe('push registration in the mobile shell (objectstack#29042)', () => {
  it('a signed-in person on Home: the token is asked for after the delay, once, and registered', async () => {
    const bridge = installBridge({ installId: 'install-7' });
    render(<Harness auth={{ userId: 'u1' }} pathname="/home" />);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(NATIVE_PUSH_PROMPT_DELAY_MS - 1);
    });
    expect(bridge.getPushToken).not.toHaveBeenCalled();

    await passPromptDelay();
    await settle();
    expect(bridge.getPushToken).toHaveBeenCalledTimes(1);
    expect(deviceRequests()).toEqual([
      {
        method: 'POST',
        url: expect.stringContaining(DEVICES),
        body: {
          token: 'tok-1',
          vendor: 'apns',
          platform: 'ios',
          deviceId: 'install-7',
          origin: window.location.origin,
        },
      },
    ]);
    expect(JSON.parse(sessionStorage.getItem(NATIVE_PUSH_REGISTRATION_KEY) ?? 'null')).toEqual({
      userId: 'u1',
      token: 'tok-1',
      vendor: 'apns',
      deviceId: 'install-7',
    });
  });

  it('no installId: no deviceId is sent, and the id the server minted is kept for the session', async () => {
    installBridge({ installId: null });
    render(<Harness auth={{ userId: 'u1' }} pathname="/apps/crm" />);
    await passPromptDelay();
    await settle();
    const [request] = deviceRequests();
    expect(request.body).not.toHaveProperty('deviceId');
    expect(JSON.parse(sessionStorage.getItem(NATIVE_PUSH_REGISTRATION_KEY) ?? 'null')).toMatchObject({ deviceId: 'minted-1' });
  });

  it('a sign-in surface, or no session: the shell is never asked, so the OS prompt never shows there', async () => {
    const bridge = installBridge();
    const { rerender } = render(<Harness auth={{ userId: 'u1' }} pathname="/login" />);
    await passPromptDelay();
    rerender(<Harness auth={{ userId: null }} pathname="/home" />);
    await passPromptDelay();
    await settle();
    expect(bridge.getPushToken).not.toHaveBeenCalled();
    expect(deviceRequests()).toEqual([]);
  });

  it('leaving Home before the delay passes asks nothing until the person is back', async () => {
    const bridge = installBridge();
    const { rerender } = render(<Harness auth={{ userId: 'u1' }} pathname="/home" />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(NATIVE_PUSH_PROMPT_DELAY_MS / 2);
    });
    rerender(<Harness auth={{ userId: 'u1' }} pathname="/organizations" />);
    await passPromptDelay();
    expect(bridge.getPushToken).not.toHaveBeenCalled();
  });

  it('a null token (simulator, permission denied) sends no request', async () => {
    const bridge = installBridge({ token: null });
    render(<Harness auth={{ userId: 'u1' }} pathname="/home" />);
    await passPromptDelay();
    await settle();
    expect(bridge.getPushToken).toHaveBeenCalledTimes(1);
    expect(deviceRequests()).toEqual([]);
  });

  it('an impersonation registers nothing: the device stays the administrator’s', async () => {
    const bridge = installBridge();
    render(<Harness auth={{ userId: 'u2', impersonatedBy: 'admin-1' }} pathname="/home" />);
    await passPromptDelay();
    await settle();
    expect(bridge.getPushToken).not.toHaveBeenCalled();
    expect(deviceRequests()).toEqual([]);
  });

  it('a shell that is neither iOS nor Android registers nothing', async () => {
    installBridge({ platform: 'desktop' });
    render(<Harness auth={{ userId: 'u1' }} pathname="/home" />);
    await passPromptDelay();
    await settle();
    expect(deviceRequests()).toEqual([]);
  });

  it('a rotated token is registered; the same token again is not sent twice', async () => {
    installBridge({ installId: 'install-7' });
    render(<Harness auth={{ userId: 'u1' }} pathname="/home" />);
    await passPromptDelay();
    await settle();

    const rotate = (token: string) =>
      act(() => {
        window.dispatchEvent(new CustomEvent(NATIVE_PUSH_TOKEN_CHANGED_EVENT, { detail: { token, vendor: 'apns' } }));
      });
    rotate('tok-2');
    await settle();
    rotate('tok-2');
    await settle();

    expect(deviceRequests().map((r) => (r.body as { token: string }).token)).toEqual(['tok-1', 'tok-2']);
  });

  it('a rotation that arrives before anyone signs in is registered at sign-in, without asking the shell', async () => {
    const bridge = installBridge();
    const { rerender } = render(<Harness auth={{ userId: null }} pathname="/login" />);
    act(() => {
      window.dispatchEvent(
        new CustomEvent(NATIVE_PUSH_TOKEN_CHANGED_EVENT, { detail: { token: 'tok-early', vendor: 'fcm' } }),
      );
    });
    rerender(<Harness auth={{ userId: 'u1' }} pathname="/login" />);
    await settle();
    expect(bridge.getPushToken).not.toHaveBeenCalled();
    expect(deviceRequests().map((r) => r.body)).toEqual([
      expect.objectContaining({ token: 'tok-early', vendor: 'fcm', platform: 'ios' }),
    ]);
  });

  it('another person signing in on the page registers the device for them', async () => {
    const bridge = installBridge({ installId: 'install-7' });
    const { rerender } = render(<Harness auth={{ userId: 'u1' }} pathname="/home" />);
    await passPromptDelay();
    await settle();
    rerender(<Harness auth={{ userId: null }} pathname="/login" />);
    rerender(<Harness auth={{ userId: 'u2' }} pathname="/home" />);
    await settle();
    expect(bridge.getPushToken).toHaveBeenCalledTimes(1);
    expect(deviceRequests()).toHaveLength(2);
    expect(JSON.parse(sessionStorage.getItem(NATIVE_PUSH_REGISTRATION_KEY) ?? 'null')).toMatchObject({ userId: 'u2' });
  });
});

describe('unregistering the device this Console registered (objectstack#29042)', () => {
  async function registered(auth: AuthState = { userId: 'u1' }) {
    installBridge({ installId: 'install-7' });
    const view = render(<Harness auth={auth} pathname="/home" />);
    await passPromptDelay();
    await settle();
    return view;
  }

  it('the connection-removed answer deletes the device under the session and forgets it', async () => {
    await registered();
    await act(async () => {
      await unregister!();
    });
    expect(deviceRequests().at(-1)).toEqual({ method: 'DELETE', url: expect.stringContaining(`${DEVICES}/install-7`), body: undefined });
    expect(sessionStorage.getItem(NATIVE_PUSH_REGISTRATION_KEY)).toBeNull();
  });

  it('sign-out runs the unregister before the session ends', async () => {
    await registered();
    await act(async () => {
      await runBeforeSignOut();
    });
    expect(deviceRequests().map((r) => r.method)).toEqual(['POST', 'DELETE']);
  });

  it('a device the registry no longer holds (404) counts as unregistered', async () => {
    await registered();
    fetchMock.mockImplementation(async () => answer(404, { success: false, error: { code: 'NOT_FOUND', message: 'gone' } }));
    await expect(unregister!()).resolves.toBeUndefined();
    expect(sessionStorage.getItem(NATIVE_PUSH_REGISTRATION_KEY)).toBeNull();
  });

  it('a failed unregister rejects, so the shell records the token as left registered', async () => {
    await registered();
    fetchMock.mockImplementation(async () => answer(500, { success: false, error: { code: 'INTERNAL_ERROR', message: 'boom' } }));
    await expect(unregister!()).rejects.toThrow();
  });

  it('no session left to unregister with rejects, so the shell records the token as left registered', async () => {
    const { rerender } = await registered();
    rerender(<Harness auth={{ userId: null }} pathname="/login" />);
    await expect(unregister!()).rejects.toThrow(/no session/);
  });

  it('nothing registered and no installId: resolves without a request', async () => {
    installBridge({ installId: null });
    render(<Harness auth={{ userId: 'u1' }} pathname="/login" />);
    await expect(unregister!()).resolves.toBeUndefined();
    expect(deviceRequests()).toEqual([]);
  });
});

describe('the origin a registration sends (objectstack#29042)', () => {
  it('http and https send the page origin; an opaque origin sends none', () => {
    expect(registrationOrigin({ protocol: 'https:', origin: 'https://crm.example.com' })).toBe('https://crm.example.com');
    expect(registrationOrigin({ protocol: 'http:', origin: 'http://localhost:5180' })).toBe('http://localhost:5180');
    expect(registrationOrigin({ protocol: 'about:', origin: 'null' })).toBeUndefined();
    expect(registrationOrigin({ protocol: 'data:', origin: 'null' })).toBeUndefined();
  });
});
