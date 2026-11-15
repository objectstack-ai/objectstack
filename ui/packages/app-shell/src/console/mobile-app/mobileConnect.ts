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
 * - `ready`: a QR code and a copyable link carrying that URL.
 * - `unreachable`: the URL names a loopback or private address a phone
 *   cannot open, so the page refuses with the `OS_AUTH_URL` remedy.
 * - `unpublished`: the server published no public URL; the browser's own
 *   address is never used in its place, because it can be an internal or
 *   proxied host.
 */
export type MobileConnectTarget =
  | { readonly kind: 'ready'; readonly serverUrl: string; readonly connectLink: string }
  | { readonly kind: 'unreachable'; readonly serverUrl: string }
  | { readonly kind: 'unpublished' };

/** The connect link for a server URL: `objectos://connect?server=<URL-encoded server URL>`. */
export function mobileConnectLink(serverUrl: string): string {
  return `${MOBILE_CONNECT_LINK_BASE}?server=${encodeURIComponent(serverUrl)}`;
}

export function mobileConnectTarget(publicBaseUrl: unknown): MobileConnectTarget {
  if (typeof publicBaseUrl !== 'string' || publicBaseUrl.trim() === '') return { kind: 'unpublished' };
  if (!isPublicHostAddress(publicBaseUrl)) return { kind: 'unreachable', serverUrl: publicBaseUrl };
  return { kind: 'ready', serverUrl: publicBaseUrl, connectLink: mobileConnectLink(publicBaseUrl) };
}
