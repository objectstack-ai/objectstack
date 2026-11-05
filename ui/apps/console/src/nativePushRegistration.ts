/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Native shell push registration: the Console registers the mobile shell's
 * push token with the server's device registry (`POST
 * /api/v1/notifications/devices`) under its own session, and unregisters it
 * when the shell removes this Console's connection.
 *
 * The shell holds no API credential, so the Console is the only party that
 * can register. What it does, in the shell only (a browser installs nothing):
 *
 * - Asks the shell for the token (`getPushToken()`, announced as the
 *   `getPushToken` capability) once per page load, and only once a signed-in
 *   person has reached a meaningful screen (`/home` or an app) and stayed on it
 *   for `NATIVE_PUSH_PROMPT_DELAY_MS`. The first call shows the OS permission
 *   prompt, so it never runs on a sign-in surface. A `null` answer (simulator,
 *   permission denied, no token) sends nothing.
 * - Registers the token, and re-registers when the shell announces a rotated
 *   one (`objectstack-native:pushTokenChanged`, announced as the
 *   `pushTokenChanged` capability) or another person signs in on this page.
 *   The last registration is kept for the session (`sessionStorage`); an equal
 *   token for the same person is not sent again. The registry moves a token
 *   from whoever held it, so a new person's registration takes the device over
 *   from the previous one.
 * - Never registers while the session is an impersonation: that would move
 *   the impersonated person's pushes onto the administrator's device.
 * - Sends `deviceId` as the shell's `installId` when the shell exposes one as
 *   a string, else the id the server answered last time, else none.
 * - Sends `origin` only when the page was loaded over `http:` or `https:`: an
 *   opaque origin reads `"null"`, which the request grammar refuses.
 *
 * `installId` and the rotation event are optional members of the bridge and
 * are feature-detected, so an older shell keeps working.
 */

import { useEffect, useRef, useState } from 'react';
import { ObjectStackClient } from '@objectstack/client';
import { createAuthenticatedFetch, registerBeforeSignOut, useAuth } from '@object-ui/auth';
import {
  NATIVE_PUSH_TOKEN_CHANGED_EVENT,
  nativeGetPushToken,
  nativeHostCan,
  useNativeHost,
  type NativePushToken,
  type NativePushTokenChangedEvent,
  type ObjectStackNative,
} from '@object-ui/mobile';

/** The capability a shell announces when it dispatches `NATIVE_PUSH_TOKEN_CHANGED_EVENT`. */
const PUSH_TOKEN_CHANGED_CAPABILITY = 'pushTokenChanged';

/**
 * How long a signed-in person stays on a meaningful screen before the Console
 * asks the shell for the token (and the OS shows its permission prompt).
 */
export const NATIVE_PUSH_PROMPT_DELAY_MS = 1500;

/** Where the session's last registration is kept. */
export const NATIVE_PUSH_REGISTRATION_KEY = 'objectui:native-push:registration';

/** The session's last registration: who, which token, and the device id the server answered. */
interface PushRegistrationRecord {
  userId: string;
  token: string;
  vendor: NativePushToken['vendor'];
  deviceId: string;
}

const SERVER_URL = import.meta.env.VITE_SERVER_URL || '';

let client: ObjectStackClient | null = null;
/** Whether this page load has asked the shell for the token yet. */
let tokenAsked = false;
/** The latest token this page load has seen, from `getPushToken()` or the rotation event. */
let knownToken: NativePushToken | null = null;
/** Registrations run one after another, so two triggers never race to the registry. */
let queue: Promise<void> = Promise.resolve();

function pushClient(): ObjectStackClient {
  client ??= new ObjectStackClient({ baseUrl: SERVER_URL, fetch: createAuthenticatedFetch() });
  return client;
}

function readRecord(): PushRegistrationRecord | null {
  try {
    const raw = sessionStorage.getItem(NATIVE_PUSH_REGISTRATION_KEY);
    if (!raw) return null;
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== 'object') return null;
    const { userId, token, vendor, deviceId } = value as Record<string, unknown>;
    if (typeof userId !== 'string' || typeof token !== 'string' || typeof deviceId !== 'string') return null;
    if (vendor !== 'apns' && vendor !== 'fcm') return null;
    return { userId, token, vendor, deviceId };
  } catch {
    return null;
  }
}

function writeRecord(record: PushRegistrationRecord): void {
  try {
    sessionStorage.setItem(NATIVE_PUSH_REGISTRATION_KEY, JSON.stringify(record));
  } catch {
    /* storage unavailable: the next trigger registers again, which the registry treats as a refresh */
  }
}

function clearRecord(): void {
  try {
    sessionStorage.removeItem(NATIVE_PUSH_REGISTRATION_KEY);
  } catch {
    /* storage unavailable */
  }
}

/** The shell's `installId` when it exposes one as a string (a shell that predates it carries none). */
function installIdOf(host: ObjectStackNative): string | null {
  const { installId } = host;
  return typeof installId === 'string' && installId !== '' ? installId : null;
}

/** The registry's platform for this shell, or `null` for a shell that is neither iOS nor Android. */
function platformOf(host: ObjectStackNative): 'ios' | 'android' | null {
  return host.platform === 'ios' || host.platform === 'android' ? host.platform : null;
}

/**
 * The `origin` a registration sends: the page's origin, only when it was loaded
 * over http or https. A sandboxed or `about:blank` / `data:` page reads the
 * opaque `"null"`, which the request grammar refuses, and that would refuse the
 * whole registration; such a page sends no `origin`.
 */
export function registrationOrigin(location: Pick<Location, 'protocol' | 'origin'>): string | undefined {
  return location.protocol === 'http:' || location.protocol === 'https:' ? location.origin : undefined;
}

function isPushToken(value: unknown): value is NativePushToken {
  if (!value || typeof value !== 'object') return false;
  const { token, vendor } = value as Record<string, unknown>;
  return typeof token === 'string' && token !== '' && (vendor === 'apns' || vendor === 'fcm');
}

function shellAnnounces(host: ObjectStackNative, capability: string): boolean {
  try {
    return typeof host.has === 'function' && host.has(capability) === true;
  } catch {
    return false;
  }
}

/** Register `token` for `userId` unless the session already registered exactly that. */
function syncRegistration(host: ObjectStackNative, userId: string, token: NativePushToken): Promise<void> {
  queue = queue.then(async () => {
    const platform = platformOf(host);
    if (!platform) return;
    const record = readRecord();
    if (record && record.userId === userId && record.token === token.token && record.vendor === token.vendor) return;
    const deviceId = installIdOf(host) ?? (record?.userId === userId ? record.deviceId : undefined);
    const origin = typeof window === 'undefined' ? undefined : registrationOrigin(window.location);
    try {
      const answer = await pushClient().notifications.registerDevice({
        token: token.token,
        vendor: token.vendor,
        platform,
        ...(deviceId ? { deviceId } : {}),
        ...(origin ? { origin } : {}),
      });
      writeRecord({ userId, token: token.token, vendor: token.vendor, deviceId: answer.deviceId });
    } catch (error) {
      console.warn('[native-push] the device registration failed; pushes will not reach this device until it succeeds', error);
    }
  });
  return queue;
}

/** Whether `pathname` is a screen the person came for: Home or an app. */
function isMeaningfulScreen(pathname: string): boolean {
  return pathname === '/home' || pathname.startsWith('/home/') || pathname.startsWith('/apps/');
}

interface LatestState {
  host: ObjectStackNative | null;
  userId: string | null;
  signedIn: boolean;
}

/**
 * Unregister the device this Console registered, under the current session.
 * Resolves when nothing is left registered; rejects when the device may still
 * be registered (no session to unregister with, or the request failed).
 */
async function unregisterThisDevice(latest: { current: LatestState }): Promise<void> {
  await queue;
  const current = latest.current;
  const record = readRecord();
  const deviceId = record?.deviceId ?? (current.host ? installIdOf(current.host) : null);
  if (!deviceId) return;
  if (!current.signedIn) {
    throw new Error('[native-push] no session to unregister this device with; it may still be registered');
  }
  try {
    await pushClient().notifications.unregisterDevice(deviceId);
  } catch (error) {
    // The registry no longer holds it (or never did): nothing is left registered.
    if ((error as { httpStatus?: unknown } | null)?.httpStatus !== 404) throw error;
  }
  clearRecord();
}

/**
 * Wires push registration to the native shell. Call it from the component that
 * calls `useNativeHostRouting`, before that call, and pass what it returns as
 * that call's `onConnectionRemoved`: the rotation listener is then installed in
 * the same commit that posts `ready()`, which is when the shell releases a
 * token it held. `pathname` is the router's path without the basename.
 *
 * The returned function unregisters the device this Console registered, under
 * its own session, and `signOut()` runs it before the session ends. It
 * resolves when there is nothing to unregister or the registry no longer holds
 * the device, and rejects when the device may still be registered, so the
 * shell records the truth. Its identity is stable for the component's life.
 */
export function useNativePushRegistration(pathname: string): () => Promise<void> {
  const host = useNativeHost();
  const { user, session, isAuthenticated } = useAuth();
  const signedIn = isAuthenticated && typeof user?.id === 'string' && user.id !== '';
  // An impersonation never registers: it would move the impersonated person's
  // pushes onto the administrator's device.
  const userId = signedIn && !session?.impersonatedBy ? (user?.id ?? null) : null;
  const meaningful = isMeaningfulScreen(pathname);

  const latest = useRef<LatestState>({ host, userId, signedIn });
  useEffect(() => {
    latest.current = { host, userId, signedIn };
  });
  // `useState`'s initializer runs once, so the identity never changes (a memo may be discarded).
  const [unregister] = useState(() => () => unregisterThisDevice(latest));

  // A token the shell rotated: register it for whoever is signed in now, or
  // keep it for the next person who signs in on this page.
  useEffect(() => {
    if (!host || !shellAnnounces(host, PUSH_TOKEN_CHANGED_CAPABILITY)) return undefined;
    const onTokenChanged = (event: Event) => {
      const { detail } = event as Partial<NativePushTokenChangedEvent>;
      if (!isPushToken(detail)) return;
      knownToken = { token: detail.token, vendor: detail.vendor };
      const current = latest.current;
      if (current.host && current.userId) void syncRegistration(current.host, current.userId, knownToken);
    };
    window.addEventListener(NATIVE_PUSH_TOKEN_CHANGED_EVENT, onTokenChanged);
    return () => window.removeEventListener(NATIVE_PUSH_TOKEN_CHANGED_EVENT, onTokenChanged);
  }, [host]);

  // A signed-in person with a token already known: register it for them.
  useEffect(() => {
    if (!host || !userId || !knownToken) return;
    void syncRegistration(host, userId, knownToken);
  }, [host, userId]);

  // No token yet: ask the shell once per page load, after the person has
  // reached a meaningful screen, so the OS prompt never interrupts sign-in.
  useEffect(() => {
    if (!host || !userId || !meaningful || tokenAsked || knownToken) return undefined;
    if (!nativeHostCan(host, 'getPushToken')) return undefined;
    const timer = window.setTimeout(() => {
      if (tokenAsked) return;
      tokenAsked = true;
      void nativeGetPushToken().then((result) => {
        if (result.status !== 'ok' || !isPushToken(result.value)) return;
        knownToken = { token: result.value.token, vendor: result.value.vendor };
        const current = latest.current;
        if (current.host && current.userId) void syncRegistration(current.host, current.userId, knownToken);
      });
    }, NATIVE_PUSH_PROMPT_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [host, userId, meaningful]);

  // Signing out ends the session the unregister needs, so it runs first.
  useEffect(() => {
    if (!host) return undefined;
    return registerBeforeSignOut(unregister);
  }, [host, unregister]);

  return unregister;
}

/** Test seam: forget this page load's token, ask and client. */
export function resetNativePushRegistrationForTests(): void {
  client = null;
  tokenAsked = false;
  knownToken = null;
  queue = Promise.resolve();
}
