/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import type { AuthPublicConfig } from '@object-ui/auth';

/**
 * Direct sign-in, the sign-in page's half. With the server's
 * `features.directSignIn` on, a signed-out visitor to `/login` is sent
 * straight to the identity provider through the server's start door,
 * `GET {authUrl}/sign-in/direct`, and the sign-in returns to this same `/login`
 * URL, marked `direct=returned`: the page's post-login steps then run as after
 * any sign-in (the OAuth and mobile hand-offs, the organization pick, the safe
 * `?redirect=`).
 *
 * The door keeps only a same-origin path as the return address, so this page
 * hands it the document's own path and query, never a URL.
 *
 * ## The loop guard
 *
 * The page draws instead of navigating when any of these holds:
 *
 *  - the URL carries `error`: an identity-provider error, a failed callback,
 *    an account refused at link, or the door's own `direct_sign_in_unavailable`
 *    all land here that way;
 *  - the URL carries the return mark and nobody is signed in: the sign-in came
 *    back without a session (a blocked cookie), and starting again would
 *    bounce forever;
 *  - an OAuth client's hand-off (`client_id` / `redirect_uri`) is on the URL:
 *    it keeps today's page, so MCP and OAuth clients are unaffected;
 *  - `?local=1` while the local sign-in path is `hidden`;
 *  - the person signed out in this tab just now: the identity provider's
 *    session usually outlives ours, so starting again would sign them straight
 *    back in. The page offers the sign-in instead, and starts it when asked.
 */

/** The query mark on the return address. */
export const DIRECT_SIGN_IN_RETURN_PARAM = 'direct';
export const DIRECT_SIGN_IN_RETURN_VALUE = 'returned';

/** The door's `error` code when it could not start a sign-in. */
export const DIRECT_SIGN_IN_UNAVAILABLE = 'direct_sign_in_unavailable';

/** The door's `error` code when the sign-in rate limit refused the start. */
export const DIRECT_SIGN_IN_RATE_LIMITED = 'direct_sign_in_rate_limited';

/** What the page does for a signed-out visitor. */
export type DirectSignInDecision =
  /** Direct sign-in is off: today's page. */
  | 'off'
  /** Navigate to the start door. */
  | 'start'
  /** `?local=1` under `hidden`: today's page, password form included. */
  | 'local'
  /** On, but an OAuth client's hand-off is on the URL: today's page. */
  | 'handoff'
  /** On, but the URL carries `error`: the page says so and offers a retry. */
  | 'hold'
  /** On, and the last start came back without a session. */
  | 'incomplete'
  /** On, and the person signed out in this tab: the page offers the sign-in. */
  | 'signedOut';

export function decideDirectSignIn(input: {
  features: AuthPublicConfig['features'] | undefined;
  search: string;
  /** `useAuth().sessionEndedBySignOut`: an explicit sign-out ended the session. */
  signedOut?: boolean;
}): DirectSignInDecision {
  const { features } = input;
  if (features?.directSignIn !== true) return 'off';
  const params = new URLSearchParams(input.search);
  if (params.get('local') === '1' && features.localSignIn !== 'off') return 'local';
  if (params.has('client_id') || params.has('redirect_uri')) return 'handoff';
  if (params.has('error')) return 'hold';
  if (params.get(DIRECT_SIGN_IN_RETURN_PARAM) === DIRECT_SIGN_IN_RETURN_VALUE) return 'incomplete';
  if (input.signedOut === true) return 'signedOut';
  return 'start';
}

/**
 * The start door's URL for this page. The return address is the document's
 * own path and query with the return mark set, and without `local` or a
 * previous attempt's `error`.
 */
export function directSignInStartUrl(authUrl: string, pathname: string, search: string): string {
  const params = new URLSearchParams(search);
  params.delete('local');
  params.delete('error');
  params.delete('error_description');
  params.set(DIRECT_SIGN_IN_RETURN_PARAM, DIRECT_SIGN_IN_RETURN_VALUE);
  const returnPath = `${pathname}?${params.toString()}`;
  return `${authUrl}/sign-in/direct?callbackURL=${encodeURIComponent(returnPath)}`;
}
