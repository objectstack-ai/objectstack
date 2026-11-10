/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Client side of "the server no longer knows this session" (objectstack#32138).
 *
 * The authenticated fetch wrapper sees every console API response. When one of
 * them answers `401`, the session it was sent with may have ended on the server
 * (signed out elsewhere, expired, revoked). The wrapper reports that here, and
 * `AuthProvider` subscribes: it asks the server once whether a session is still
 * held, and only a "no" from the server ends the session in the tab, so the
 * route guard sends the visitor to the login page with a return link.
 *
 * A `401` is a hint, never the verdict: one endpoint can refuse a request for
 * its own reasons while the session stays live, so the provider's re-check is
 * what decides. Same module-level emitter shape as `auth-gate-events.ts`, which
 * keeps the plain fetch wrapper free of React.
 */

type Listener = () => void;
const listeners = new Set<Listener>();

export const sessionEndEvents = {
  /** Report that an API request was answered `401`. */
  emit(): void {
    for (const l of Array.from(listeners)) {
      try { l(); } catch { /* a listener throwing must not break others */ }
    }
  },
  /** Subscribe; returns an unsubscribe fn. */
  subscribe(listener: Listener): () => void {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
  },
};
