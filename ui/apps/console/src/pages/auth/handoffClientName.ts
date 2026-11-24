/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The application name for an OAuth sign-in hand-off (objectstack#34168).
 *
 * When an application sends a person to sign in, the provider lands them on
 * this page with the authorization request on the URL, signed by the server
 * (`sig`, `exp`). The sign-in page reads the client name only for the client
 * its signed request names: it hands that signed request back to plugin-auth's
 * `GET /oauth2/client-name` and shows "Sign in to continue to NAME".
 *
 * Any answer other than a name (no signed request on the URL, a refusal, a
 * network failure, a body of another shape) is `null`, and the page keeps its
 * host line.
 */

import { useEffect, useState } from 'react';

/** The URL's signed authorization request, without the leading `?`, or `null`. */
export function signedHandoffQuery(search: string): string | null {
  const query = search.startsWith('?') ? search.slice(1) : search;
  const params = new URLSearchParams(query);
  if (!params.get('client_id') || !params.get('redirect_uri') || !params.get('sig')) return null;
  return query;
}

/** The client name in the route's answer, or `null` for anything else. */
export async function readHandoffClientName(res: Response): Promise<string | null> {
  if (!res.ok) return null;
  try {
    const body = (await res.json()) as { success?: unknown; data?: { client_name?: unknown } } | null;
    const name = body?.success === true ? body.data?.client_name : undefined;
    return typeof name === 'string' && name.trim() ? name.trim() : null;
  } catch {
    return null;
  }
}

/** The application's name for this hand-off, or `null` while unknown or on any failure. */
export function useHandoffClientName(authBase: string, isHandoff: boolean): string | null {
  const [name, setName] = useState<string | null>(null);
  useEffect(() => {
    if (!isHandoff || typeof window === 'undefined') return;
    const query = signedHandoffQuery(window.location.search);
    if (!query) return;
    const clientId = new URLSearchParams(query).get('client_id') ?? '';
    let cancelled = false;
    const url =
      `${authBase}/oauth2/client-name?client_id=${encodeURIComponent(clientId)}` +
      `&oauth_query=${encodeURIComponent(query)}`;
    Promise.resolve()
      .then(() => fetch(url, { credentials: 'include' }))
      .then(readHandoffClientName, () => null)
      .then((answer) => {
        if (!cancelled) setName(answer);
      });
    return () => {
      cancelled = true;
    };
  }, [authBase, isHandoff]);
  return name;
}
