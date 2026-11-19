// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The public base URL `GET /auth/config` serves as `features.publicBaseUrl`,
 * from the canonical origin every link the auth layer hands out is built on.
 *
 * The door is anonymous, so only the ADDRESS is served: scheme, host (with a
 * non-default port) and path, no trailing slash. A username, password, query
 * or fragment in the configured base URL is dropped. A value that does not
 * parse as an absolute URL is not served at all (`undefined`), so the console
 * reads it as "this server does not offer an address" rather than encoding a
 * broken one.
 */
export function publicBaseUrlOf(canonicalOrigin: string): string | undefined {
  let url: URL;
  try {
    url = new URL(canonicalOrigin);
  } catch {
    return undefined;
  }
  if (!url.host) return undefined;
  return `${url.protocol}//${url.host}${url.pathname.replace(/\/+$/, '')}`;
}
