// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The answer to an authorization request the ADR-0069 D5.1 environment-access
 * gate refuses: an AUTHENTICATED subject the host's `oidcAuthorizeGate` does
 * not admit to the requesting client (an environment) at `/oauth2/authorize`.
 *
 * The refusal itself is decided in `auth-manager-before-hook.ts`; this module
 * only chooses how it is delivered, by who is asking. One refusal used to
 * answer every caller with the same `403` JSON envelope, so a browser that
 * navigated to the authorize URL (a user who signed out of an environment and
 * signed back in as an account that is not a member) was shown the raw JSON
 * as the page, with no sentence and no way on.
 *
 * ## Who gets which answer
 *
 *  - **Anything that is not a page navigation** keeps the `403` envelope,
 *    byte for byte: `code: ENV_ACCESS_DENIED` and the same message. That is
 *    the Console's own post-sign-in `fetch` (`Accept: application/json`), a
 *    bearer API client, and a bare `curl`. Whether a request is a navigation is
 *    {@link isPageNavigation}'s answer, the one this package already gives the
 *    mobile sign-in hand-off, so the two doors cannot disagree about it. By
 *    that rule a script that sends `Accept: text/html` (and no Fetch Metadata
 *    saying otherwise) is read as a navigation, and gets the redirect or the
 *    page below, not the envelope.
 *  - **A page navigation whose `redirect_uri` is registered for the client**
 *    is sent back to that client, RFC 6749 §4.1.2.1: `302` to the
 *    `redirect_uri` with `error=access_denied`, an `error_description`, the
 *    original `state`, and (RFC 9207) `iss`. The relying party then shows its
 *    own sign-in page with the refusal.
 *  - **A page navigation with no such `redirect_uri`** gets a readable `403`
 *    HTML page: the sentence, the account it is signed in as, and two
 *    actions: switch account (the provider's own RP-initiated logout,
 *    `/oauth2/end-session`) and back to the console. The page is in English
 *    only; it does not read `Accept-Language`.
 *
 * ## Which `redirect_uri` is followed
 *
 * ⛔ Never one the provider has not validated against the client's
 * registration: following a requested URI the provider would refuse is an
 * open redirect. The provider's own validator (`resolveTrustedRedirectUri` in
 * `@better-auth/oauth-provider` 1.7.12) is module-private: no entry of the
 * package exports it, so it cannot be called from here. What IS reused is the
 * provider's own client loader (`getOAuthProviderApi(...).getClient`, the read
 * the authorize endpoint makes) and its issuer (`getIssuer`). On top of that
 * read, this module follows a `redirect_uri` only when the provider would also
 * deliver an error there, and only for the strictest form of its rule:
 *
 *  - a `GET` with `response_type=code` and no `request` / `request_uri`
 *    (the provider reads a `POST` from the body, and a request object from
 *    elsewhere, so those keep the page);
 *  - the client exists, is not disabled, and may use the authorization code
 *    grant (the provider sends each of those failures to its error page, never
 *    to the client);
 *  - the requested URI equals a registered one, string for string. The
 *    provider also accepts a loopback URI whose port differs; that form gets
 *    the page here, never the redirect. Strictly narrower, so it can never
 *    follow a URI the provider would refuse;
 *  - when the provider is given a custom `validateRedirectUri`, that function
 *    must also accept the URI, as it has the last word at the provider.
 *
 * Anything else, including any failure to read the client, answers the page.
 */

import { isPageNavigation } from './one-time-token-handoff.js';

/** The refusal's ADR-0112 code, unchanged for every caller that keeps the envelope. */
export const ENV_ACCESS_DENIED_CODE = 'ENV_ACCESS_DENIED';

/** The refusal's message: the envelope's `message`, and the `error_description` the client receives. */
export const ENV_ACCESS_DENIED_MESSAGE = 'You are not authorized to sign in to this environment.';

/** RFC 6749 §4.1.2.1: the error a client receives when the authorization server refuses the request. */
export const OAUTH_ACCESS_DENIED_ERROR = 'access_denied';

/** The provider's RP-initiated logout, relative to the auth base URL: the page's "switch account". */
export const OAUTH_END_SESSION_PATH = '/oauth2/end-session';

/** What the gate hands this module beside the request. */
export interface RefusedAuthorizationContext {
  /** The refused subject. */
  readonly userId: string;
  /** The absolute URL of the console's home page: the page's "back to console". */
  readonly consoleUrl: string;
}

const NO_STORE_HEADERS = {
  'Cache-Control': 'no-store',
  Pragma: 'no-cache',
  'Referrer-Policy': 'no-referrer',
} as const;

/**
 * The answer to a refused authorization request. Throws the `403` envelope for
 * a caller that is not a page navigation; returns the redirect or the page for
 * one that is.
 */
export async function answerRefusedAuthorization(ctx: any, refused: RefusedAuthorizationContext): Promise<Response> {
  const headers: Headers | undefined = ctx?.request?.headers ?? ctx?.headers;
  if (!(headers instanceof Headers) || !isPageNavigation(headers)) {
    const { APIError } = await import('better-auth/api');
    throw new APIError('FORBIDDEN', {
      message: ENV_ACCESS_DENIED_MESSAGE,
      code: ENV_ACCESS_DENIED_CODE,
    });
  }

  const back = await registeredRedirect(ctx);
  if (back) {
    const location = new URL(back.redirectUri);
    location.searchParams.append('error', OAUTH_ACCESS_DENIED_ERROR);
    location.searchParams.append('error_description', ENV_ACCESS_DENIED_MESSAGE);
    if (back.state !== undefined) location.searchParams.append('state', back.state);
    location.searchParams.append('iss', back.issuer);
    return new Response(null, {
      status: 302,
      headers: { Location: location.toString(), ...NO_STORE_HEADERS },
    });
  }

  return refusalPage({
    email: await signedInEmail(ctx, refused.userId),
    switchAccountUrl: `${String(ctx?.context?.baseURL ?? '').replace(/\/$/, '')}${OAUTH_END_SESSION_PATH}`,
    consoleUrl: refused.consoleUrl,
  });
}

interface RegisteredRedirect {
  readonly redirectUri: string;
  readonly state?: string;
  readonly issuer: string;
}

/** The request's `redirect_uri` when the provider would deliver an error there; see the header. */
async function registeredRedirect(ctx: any): Promise<RegisteredRedirect | null> {
  if (String(ctx?.method ?? '').toUpperCase() !== 'GET') return null;
  const query = (ctx?.query ?? {}) as Record<string, unknown>;
  if (query.request !== undefined || query.request_uri !== undefined) return null;
  if (query.response_type !== 'code') return null;
  const clientId = query.client_id;
  const redirectUri = query.redirect_uri;
  if (typeof clientId !== 'string' || !clientId || typeof redirectUri !== 'string' || !redirectUri) return null;
  if (query.state !== undefined && typeof query.state !== 'string') return null;

  try {
    const provider = ctx?.context?.getPlugin?.('oauth-provider');
    const opts = provider?.options;
    if (!opts) return null;
    const { getIssuer, getOAuthProviderApi } = await import('@better-auth/oauth-provider');
    const client: any = await getOAuthProviderApi(ctx, opts).getClient(clientId);
    if (!client || client.disabled) return null;
    const grants: unknown[] = Array.isArray(client.grantTypes) && client.grantTypes.length > 0
      ? client.grantTypes
      : ['authorization_code'];
    if (!grants.includes('authorization_code')) return null;
    const registered: string[] = Array.isArray(client.redirectUris) ? client.redirectUris : [];
    if (!registered.includes(redirectUri)) return null;
    if (typeof opts.validateRedirectUri === 'function'
      && !(await opts.validateRedirectUri(redirectUri, registered, true))) {
      return null;
    }
    return { redirectUri, state: query.state as string | undefined, issuer: getIssuer(ctx, opts) };
  } catch {
    return null;
  }
}

/** The refused subject's email, for the page; `undefined` when it cannot be read. */
async function signedInEmail(ctx: any, userId: string): Promise<string | undefined> {
  try {
    const user = await ctx?.context?.internalAdapter?.findUserById?.(userId);
    return typeof user?.email === 'string' && user.email ? user.email : undefined;
  } catch {
    return undefined;
  }
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

/** The page a browser sees when no registered `redirect_uri` can carry the refusal. */
function refusalPage(page: { email?: string; switchAccountUrl: string; consoleUrl: string }): Response {
  const who = page.email
    ? `You are signed in as <strong>${escapeHtml(page.email)}</strong>, and this account does not have access to this environment.`
    : 'The account you are signed in with does not have access to this environment.';
  const html = [
    '<!doctype html>',
    '<html lang="en"><head><meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    '<title>No access to this environment</title>',
    '<style>body{font-family:system-ui,sans-serif;margin:0;padding:16px;color:#1f2328;background:#fff}',
    'main{max-width:32rem;margin:15vh auto 0}h1{font-size:1.25rem}',
    'a{display:inline-block;margin:8px 12px 0 0;padding:8px 14px;border:1px solid #d0d7de;border-radius:6px;color:inherit;text-decoration:none}',
    '@media (prefers-color-scheme:dark){body{color:#e6edf3;background:#0d1117}a{border-color:#30363d}}</style>',
    '</head><body><main>',
    '<h1>No access to this environment</h1>',
    `<p data-refusal-code="${ENV_ACCESS_DENIED_CODE}">${who}</p>`,
    '<p>Switch to an account that has access, or go back to the console. An administrator of the environment\'s organization can add you as a member.</p>',
    '<p>',
    `<a data-action="switch-account" href="${escapeHtml(page.switchAccountUrl)}">Switch account</a>`,
    `<a data-action="back-to-console" href="${escapeHtml(page.consoleUrl)}">Back to console</a>`,
    '</p>',
    '</main></body></html>',
  ].join('');
  return new Response(html, {
    status: 403,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
      'X-Content-Type-Options': 'nosniff',
      ...NO_STORE_HEADERS,
    },
  });
}
