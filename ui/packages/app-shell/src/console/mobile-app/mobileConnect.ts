// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { isPublicHostAddress } from '../connect/deploymentReach.js';

/** The link the ObjectOS mobile app opens to connect to a server. */
export const MOBILE_CONNECT_LINK_BASE = 'objectos://connect';

/** The server setting that names this deployment's public address. */
export const PUBLIC_ADDRESS_SETTING = 'OS_AUTH_URL';

/**
 * What the Mobile App page shows, judged from the server's published public
 * base URL (`features.publicBaseUrl` on the public auth config).
 *
 * - `ready`: a QR code and a copyable link carrying that URL, normalised.
 * - `unreachable`, `not-public`: the URL names a loopback or private address
 *   a phone cannot open, or its scheme is not http(s).
 * - `unreachable`, `not-https`: a public host on plain `http:`. The mobile app
 *   signs in through this address, so it must be HTTPS.
 * - `unpublished`: the server does not serve the key, or serves a value that
 *   is not an absolute URL (never shown: it may hold anything). The
 *   browser's own address is never used in its place, because it can be an
 *   internal or proxied host.
 *
 * `serverUrl` on every arm is the normalised address, so a credential in the
 * configured value is never shown or encoded.
 */
export type MobileConnectTarget =
  | { readonly kind: 'ready'; readonly serverUrl: string; readonly connectLink: string }
  | { readonly kind: 'unreachable'; readonly reason: 'not-public' | 'not-https'; readonly serverUrl: string }
  | { readonly kind: 'unpublished' };

/**
 * The address a configured base URL stands for: scheme, host (port included)
 * and path, with no trailing slash. A username, password, query or fragment
 * in the value is dropped, so the code carries the server's address and
 * nothing else. `null` for a value that is not an absolute URL.
 */
export function normalizeServerUrl(value: string): string | null {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    return null;
  }
  if (!url.host) return null;
  return `${url.protocol}//${url.host}${url.pathname.replace(/\/+$/, '')}`;
}

/** The connect link for a normalised server URL: `objectos://connect?server=<URL-encoded server URL>`. */
export function mobileConnectLink(serverUrl: string): string {
  return `${MOBILE_CONNECT_LINK_BASE}?server=${encodeURIComponent(serverUrl)}`;
}

export function mobileConnectTarget(publicBaseUrl: unknown): MobileConnectTarget {
  if (typeof publicBaseUrl !== 'string' || publicBaseUrl.trim() === '') return { kind: 'unpublished' };
  const serverUrl = normalizeServerUrl(publicBaseUrl);
  // Not an absolute URL: no address to judge, and the raw value is never shown.
  if (serverUrl === null) return { kind: 'unpublished' };
  if (!isPublicHostAddress(serverUrl)) return { kind: 'unreachable', reason: 'not-public', serverUrl };
  if (!serverUrl.startsWith('https://')) return { kind: 'unreachable', reason: 'not-https', serverUrl };
  return { kind: 'ready', serverUrl, connectLink: mobileConnectLink(serverUrl) };
}
