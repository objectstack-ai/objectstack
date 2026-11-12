// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#32148] A SCIM conflict the vendor words in its own name reaches the
 * identity provider in the platform's words. PACKAGE-INTERNAL.
 *
 * `@better-auth/scim` answers a create whose email another account holds with
 * 409 "A Better Auth User already uses this email", and three more 409 details
 * name "Better Auth User". An identity provider shows that text to the
 * customer's administrator, who has never heard of the library and cannot act
 * on it. The answer is translated where every `/scim/v2/*` request leaves —
 * `handleRequest`'s SCIM arm (`auth-manager-request-routing.ts`) — so no
 * vendor path can skip it.
 *
 * Only a 409 whose SCIM error body carries one of the details below is
 * rewritten, and only its `detail`: the status, `scimType`, the headers and
 * every other answer stay as the vendor sent them. A detail the vendor words
 * differently in a later release is not translated; the end-to-end pin in
 * `scim-sso-adoption.test.ts` reads the real vendor's text, so such a release
 * goes red there.
 */

/** Vendor detail → the platform's wording. */
export const SCIM_CONFLICT_DETAIL_TRANSLATIONS: Readonly<Record<string, string>> = Object.freeze({
  'A Better Auth User already uses this email': 'An account with this email already exists',
  'This connection already provisions the resolved Better Auth User':
    'This connection already provisions the resolved account',
  'The resolved Better Auth User does not exist': 'The resolved account does not exist',
  'The linked Better Auth User no longer exists': 'The linked account no longer exists',
});

/**
 * `response` with its vendor-worded 409 detail translated, or `response`
 * itself — the same object, its body unread — when there is nothing to
 * translate.
 */
export async function translateScimConflictDetail(response: Response): Promise<Response> {
  if (response.status !== 409) return response;
  let body: unknown;
  try {
    body = JSON.parse(await response.clone().text());
  } catch {
    return response;
  }
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return response;
  const detail = (body as { detail?: unknown }).detail;
  if (typeof detail !== 'string' || !Object.hasOwn(SCIM_CONFLICT_DETAIL_TRANSLATIONS, detail)) return response;
  const headers = new Headers(response.headers);
  headers.delete('content-length');
  return new Response(JSON.stringify({ ...body, detail: SCIM_CONFLICT_DETAIL_TRANSLATIONS[detail] }), {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
