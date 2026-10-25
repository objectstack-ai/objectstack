/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * desktopNotifications — the console's ONLY door to the browser Notification
 * API (objectui#7011).
 *
 * Before this module the repo made no `new Notification(...)` and no
 * `Notification.requestPermission()` call anywhere, which is why a backgrounded
 * tab could not be told anything at all. One door rather than call sites is
 * what makes the two rules below checkable instead of merely intended.
 *
 * ## Rule 1 — permission is requested from a user gesture, never on load
 *
 * {@link requestDesktopNotificationPermission} is the only function here that
 * prompts, and the only caller it is wired to is the settings toggle's own
 * change handler. Asking on page load is the standard antipattern for this API,
 * and the cost of getting it wrong is not a bad first impression: a `denied`
 * verdict is PERMANENT for the origin as far as the page is concerned — the
 * browser will not ask again, and no later release can undo it. There is no
 * recovery path in code, only "go and change it in browser settings", which
 * almost nobody does. So the channel is lost for that user forever.
 *
 * `no-restricted-globals`-style enforcement is not available for a member
 * access like `Notification.requestPermission`, so the pin that guards this
 * lives in the suite instead (`useInboxArrivalNotifier.permission.test.tsx`):
 * it mounts, refreshes the feed and delivers a first message, and asserts the
 * request was never issued.
 *
 * ## Rule 2 — the API is read at CALL time, never captured at module load
 *
 * `globalThis.Notification` is absent in happy-dom (and in any SSR pass), and a
 * module-level `const Ctor = globalThis.Notification` would freeze that absence
 * into the module for the life of the process — which in a test run means a
 * stubbed API installed by a case would never be seen, and every assertion
 * about the desktop path would pass by doing nothing. Every function here
 * therefore goes through {@link notificationApi}.
 *
 * @module
 */

/** The permission verdicts the API can report, plus "no API here at all". */
export type DesktopNotificationPermission = 'granted' | 'denied' | 'default' | 'unsupported';

/** The slice of the Notification API this module uses. */
interface NotificationApi {
  permission: 'granted' | 'denied' | 'default';
  requestPermission?: () => Promise<'granted' | 'denied' | 'default'>;
  new (title: string, options?: Record<string, unknown>): {
    onclick: ((this: unknown, ev: unknown) => unknown) | null;
    close?: () => void;
  };
}

/**
 * The live API, or `null` where there is none.
 *
 * Read fresh every time — see the module header. `typeof` rather than a
 * property probe because `globalThis` is not guaranteed to exist on every
 * target this package is built for.
 */
function notificationApi(): NotificationApi | null {
  if (typeof globalThis === 'undefined') return null;
  const api = (globalThis as { Notification?: unknown }).Notification;
  return typeof api === 'function' ? (api as unknown as NotificationApi) : null;
}

/** Whether this browser offers desktop notifications at all. */
export function isDesktopNotificationSupported(): boolean {
  return notificationApi() !== null;
}

/**
 * The current verdict, without asking for anything.
 *
 * Safe to call on load, and the settings UI does: showing the toggle greyed out
 * with "blocked in your browser settings" needs to READ the verdict, and
 * reading it is not requesting it.
 */
export function desktopNotificationPermission(): DesktopNotificationPermission {
  const api = notificationApi();
  if (!api) return 'unsupported';
  const permission = api.permission;
  return permission === 'granted' || permission === 'denied' ? permission : 'default';
}

/**
 * Prompt the user for permission.
 *
 * ⛔ Call this from a user gesture and from nowhere else. Never from an effect,
 * a mount, a feed refresh or a message arrival — see the module header for what
 * a denial costs. Today the single call site is the "Desktop notifications"
 * toggle in the account menu.
 *
 * An already-settled verdict is returned without prompting: browsers ignore a
 * second request on a `denied` origin anyway, and re-asking a `granted` one is
 * pure noise.
 */
export async function requestDesktopNotificationPermission(): Promise<DesktopNotificationPermission> {
  const api = notificationApi();
  if (!api) return 'unsupported';
  if (api.permission === 'granted' || api.permission === 'denied') return api.permission;
  if (typeof api.requestPermission !== 'function') return desktopNotificationPermission();
  try {
    const verdict = await api.requestPermission();
    return verdict === 'granted' || verdict === 'denied' ? verdict : 'default';
  } catch {
    // A browser that refuses the call (an insecure origin, an iframe without
    // the permission) has not granted anything, and must not be reported as if
    // it had — the caller writes the preference off this answer.
    return desktopNotificationPermission();
  }
}

export interface DesktopNotificationRequest {
  title: string;
  body?: string;
  /**
   * Collapse key. Two notifications sharing a tag replace one another in the
   * OS tray rather than stacking, which is the desktop half of "one cycle
   * announces once" — a user who was away for several cycles comes back to one
   * entry per topic, not a wall.
   */
  tag?: string;
  /** Run when the user clicks the system notification. */
  onActivate?: () => void;
}

/**
 * Show one system notification. Returns whether one was actually shown, so a
 * caller (and a pin) can tell "shown" from "silently not shown".
 *
 * Refuses unless permission is already `granted`: this function never prompts,
 * so a `default` verdict here means the user has not opted in and the correct
 * behaviour is the pre-#7011 one — silence.
 */
export function showDesktopNotification(request: DesktopNotificationRequest): boolean {
  const api = notificationApi();
  if (!api || api.permission !== 'granted') return false;
  try {
    const notification = new api(request.title, {
      ...(request.body ? { body: request.body } : {}),
      ...(request.tag ? { tag: request.tag } : {}),
    });
    notification.onclick = () => {
      // Bring the tab forward first: the deep link is useless in a window the
      // user cannot see, and this is the one thing a system notification can do
      // that an in-page toast never needs to.
      (globalThis as { focus?: () => void }).focus?.();
      request.onActivate?.();
      notification.close?.();
    };
    return true;
  } catch {
    // Some engines throw for a notification raised outside a service worker.
    // A failed announcement is not worth an error to the user — the badge and
    // the bell still carry the message.
    return false;
  }
}
