/**
 * The session answer the console's two `/i18n` loaders wait for
 * (objectui#12034).
 *
 * `loadLanguage` and `loadLocales` are handed to `I18nProvider` in `main.tsx`.
 * That provider mounts ABOVE `<AuthProvider>` and calls both loaders on its
 * first commit, before anyone knows whether this page load is signed in. They
 * used to fetch at once with a bare `fetch`. So the sign-in page read
 * `/api/v1/i18n/*` as an anonymous caller, which the framework refuses with a
 * 401 once that domain gets the anonymous refusal every other dispatcher domain
 * has (objectstack-ai/objectstack#22432). And the signed-in boot's read
 * carried the session only when a same-origin cookie rode along, never the
 * bearer the rest of the console authenticates with.
 *
 * This module holds the one fact both loaders now wait for: the console
 * `AuthProvider`'s answer for this page load. `App.tsx` feeds it through that
 * provider's `onAuthStateChange`. That is the session authority itself: not a
 * second session read, and not a token lifted out of storage.
 *
 * - Signed out: no request. The sign-in page renders from the built-in
 *   language packs alone.
 * - Signed in: the read goes through `withSettleSignal(createAuthenticatedFetch())`,
 *   the request path the data adapter uses for every signed-in read (bearer,
 *   `X-Tenant-ID`, `Accept-Language`, session-rotation adoption, and the
 *   in-flight count an automated driver waits on).
 * - Not answered yet (the provider's `isLoading`): the loader waits. The wait
 *   ends when the session read does, and it never rejects.
 *
 * Why nothing re-runs the loaders after sign-in: every console sign-in exit is
 * a full-page navigation (`window.location.assign` in `LoginPage`,
 * `RegisterPage` and `SetupPage`; `authExitBasename.test.tsx` pins it). The
 * post-sign-in load is therefore the next boot's own loader call, answered
 * signed in, and `I18nProvider`'s own store write re-renders every reader when
 * it lands (objectui#10382). A session that began in place, with no such
 * navigation, would keep the built-in packs until the next page load.
 */
import { createAuthenticatedFetch, type AuthState } from '@object-ui/auth';
import { withSettleSignal } from '@object-ui/app-shell';

/** `null` while the session is unanswered: before the first read, and while it re-resolves. */
let signedIn: boolean | null = null;
const waiting: Array<(answer: boolean) => void> = [];

/**
 * Record the console `AuthProvider`'s current answer. Passed to that provider as
 * `onAuthStateChange`, which calls it on mount and on every change.
 *
 * A module-level function, so its identity never changes: the provider keys
 * the effect that calls it on it.
 */
export function publishAuthState({
  isAuthenticated,
  isLoading,
}: Pick<AuthState, 'isAuthenticated' | 'isLoading'>): void {
  signedIn = isLoading ? null : isAuthenticated;
  if (signedIn === null) return;
  const answer = signedIn;
  for (const resolve of waiting.splice(0)) resolve(answer);
}

/** Resolves `true` when this page load is signed in, `false` when it is not. Never rejects. */
export function whenSessionAnswered(): Promise<boolean> {
  if (signedIn !== null) return Promise.resolve(signedIn);
  return new Promise((resolve) => {
    waiting.push(resolve);
  });
}

/** The data adapter's own request path (`AdapterProvider`), for the two `/i18n` reads. */
export const i18nFetch = withSettleSignal(createAuthenticatedFetch());
