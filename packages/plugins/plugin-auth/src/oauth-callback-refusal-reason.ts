// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The host's refusal reason, carried across the environment's own OAuth
 * callback to the Console's sign-in page.
 *
 * When the platform identity provider refuses a signed-in account for an
 * environment, it sends the browser back to the environment's registered
 * callback with `error=access_denied`, the host's sentence as
 * `error_description`, and the host's reason as
 * {@link OAUTH_REFUSAL_REASON_PARAM} (`oauth-authorize-refusal.ts`). The
 * callback (better-auth's `GET /callback/:id`) then redirects to the sign-in
 * page's error URL, rebuilding the query from `error` and `error_description`
 * alone, so the reason would stop there. This after-hook puts it back on that
 * redirect, so the sign-in page can say which refusal it was.
 *
 * It acts only when every part holds:
 *
 *  - the request is a `GET` of the callback for the platform identity
 *    provider ({@link PLATFORM_IDP_PROVIDER_ID}), the one whose refusals carry
 *    the parameter;
 *  - the request's own query says `error=access_denied` and carries exactly
 *    one reason of {@link REFUSAL_REASON_PATTERN}'s shape (read from the
 *    request URL, since the callback's parsed query drops unknown names);
 *  - the callback answered a redirect whose own query says
 *    `error=access_denied` and carries no reason yet.
 *
 * Anything else is left exactly as the callback answered. The organization's
 * name is not carried: it travels only inside the host's sentence.
 */

import { OAUTH_ACCESS_DENIED_ERROR, OAUTH_REFUSAL_REASON_PARAM, REFUSAL_REASON_PATTERN } from './oauth-authorize-refusal.js';
import { PLATFORM_IDP_PROVIDER_ID } from './implicit-account-linking.js';

/** The callback's endpoint path, as the after-hook sees it. */
export const OAUTH_CALLBACK_ENDPOINT_PATH = '/callback/:id';

/** The validated reason on the callback request, or `undefined`. */
function reasonOnRequest(ctx: any): string | undefined {
  if (String(ctx?.request?.method ?? ctx?.method ?? '').toUpperCase() !== 'GET') return undefined;
  if (ctx?.params?.id !== PLATFORM_IDP_PROVIDER_ID) return undefined;
  const url = typeof ctx?.request?.url === 'string' ? ctx.request.url : undefined;
  if (!url) return undefined;
  let query: URLSearchParams;
  try {
    query = new URL(url).searchParams;
  } catch {
    return undefined;
  }
  if (query.getAll('error').join() !== OAUTH_ACCESS_DENIED_ERROR) return undefined;
  const reasons = query.getAll(OAUTH_REFUSAL_REASON_PARAM);
  if (reasons.length !== 1 || !REFUSAL_REASON_PATTERN.test(reasons[0])) return undefined;
  return reasons[0];
}

interface LocationHolder {
  read(): string | undefined;
  write(value: string): void;
}

/** The location header of one header holder (a `Headers` or a plain record), when it has one. */
function locationIn(headers: any): LocationHolder | undefined {
  if (headers instanceof Headers) {
    if (!headers.has('location')) return undefined;
    return { read: () => headers.get('location') ?? undefined, write: (v) => headers.set('location', v) };
  }
  if (headers && typeof headers === 'object') {
    const key = Object.keys(headers).find((k) => k.toLowerCase() === 'location');
    if (!key) return undefined;
    return {
      read: () => (typeof headers[key] === 'string' ? headers[key] : undefined),
      write: (v) => {
        headers[key] = v;
      },
    };
  }
  return undefined;
}

/**
 * Every holder of the redirect's location, when the callback answered a
 * redirect: the thrown redirect's own headers and the response headers the
 * dispatcher answers with (the latter win when the response is written, so
 * both are kept equal).
 */
function redirectLocations(ctx: any): LocationHolder[] {
  const returned = ctx?.context?.returned;
  const status = returned?.statusCode ?? returned?.status;
  if (status !== 302 && status !== 'FOUND') return [];
  return [locationIn(returned?.headers), locationIn(ctx?.context?.responseHeaders)].filter(
    (h): h is LocationHolder => h !== undefined,
  );
}

/**
 * The after-hook step: on a refused platform sign-in, add the host's reason to
 * the callback's redirect to the sign-in page. Returns whether it did.
 */
export function carryRefusalReasonOnCallback(ctx: any): boolean {
  if (ctx?.path !== OAUTH_CALLBACK_ENDPOINT_PATH) return false;
  const reason = reasonOnRequest(ctx);
  if (!reason) return false;
  const locations = redirectLocations(ctx);
  const target = locations[0]?.read();
  if (!target || locations.some((l) => l.read() !== target)) return false;
  let next: URL;
  try {
    next = new URL(target, 'http://relative.invalid');
  } catch {
    return false;
  }
  if (next.searchParams.get('error') !== OAUTH_ACCESS_DENIED_ERROR) return false;
  if (next.searchParams.has(OAUTH_REFUSAL_REASON_PARAM)) return false;
  // Appended to the location's own text, so the rest of it is kept byte for byte.
  const hashAt = target.indexOf('#');
  const head = hashAt < 0 ? target : target.slice(0, hashAt);
  const tail = hashAt < 0 ? '' : target.slice(hashAt);
  const carried = `${head}${head.includes('?') ? '&' : '?'}${OAUTH_REFUSAL_REASON_PARAM}=${reason}${tail}`;
  for (const location of locations) location.write(carried);
  return true;
}
