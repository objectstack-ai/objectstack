// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#32086] The third-party-initiated OIDC sign-in entry: an Okta or Entra ID
 * app tile starts a sign-in at the platform (OIDC Core 1.0 §4, "Initiating
 * Login from a Third Party").
 *
 * ## What the IdP sends, and what it got before
 *
 * Okta's OIDC IdP-initiated sign-in in `SPEC` mode, and Entra ID's My Apps,
 * send the browser to the app's `initiate_login_uri` carrying `iss` (and
 * optionally `target_link_uri` and `login_hint`), never a `code`. With that
 * URI set to the provider's callback, `GET {basePath}/sso/callback/:providerId`,
 * `@better-auth/sso` 1.7.12 answered `302 …?error=state_not_found`: its own
 * IdP-initiated handling (`bounceIfIdpInitiated`) runs only for a callback
 * with a `code` and no `state`, and the `iss` shape reaches `parseState`
 * with no state.
 *
 * ## The entry (maintainer ruling A on #32150, record 6764924025)
 *
 * A request on that callback carrying `iss` and no `code`, `state` or `error`
 * ({@link thirdPartyInitiatedLoginOf}) is handed to the vendor's own
 * `POST /sign-in/sso` (fresh state, PKCE when the provider uses it) and
 * answered with a `302` to the IdP, ONLY when all four hold
 * ({@link judgeThirdPartyInitiatedLogin}):
 *
 *  1. the provider is registered (a `sys_sso_provider` row with that
 *     `provider_id`, read with system context) and is an OIDC provider (it
 *     stores an `oidc_config`; a SAML provider is refused here, and the start
 *     names `providerType: 'oidc'` besides);
 *  2. its `allow_idp_initiated` toggle is on (the per-provider toggle of
 *     #30967 ruling A, record 6718355623: default off, every change audited);
 *  3. `iss` equals the registered `issuer` byte for byte (§4: the RP MUST
 *     verify it; no case or trailing-slash normalisation);
 *  4. `target_link_uri` is absent, same-origin, or a trusted origin (§4: the
 *     RP MUST check it against open redirection), judged by better-auth's own
 *     `isTrustedOrigin`, whose list always holds the deployment's origin. A
 *     `target_link_uri` sent more than once, or empty, is a miss too.
 *
 * Any miss, an unreadable row, or a start the vendor refuses (an unverified
 * domain, a failed discovery) keeps today's answer: the vendor runs on the
 * request unchanged and answers `state_not_found`, and one `warn` line names
 * the miss. There is no permissive fallback.
 *
 * ## It mints nothing
 *
 * The entry sets no session cookie and writes no `sys_session` row:
 * `/sign-in/sso` answers JSON with the IdP's authorization URL, its state
 * cookie and its `auth-state` verification row, and nothing else. The start
 * carries an allow-list of headers ({@link startHeaders}): no cookie and no
 * `authorization`, so no session is read or renewed on the way. It is handed
 * the transport of the request it serves (#24877), so the vendor's per-address
 * rate limit counts each caller as it counts a direct `POST /sign-in/sso`.
 * A session is created only by the vendor's callback,
 * after the IdP returns a `code` with the matching `state`, the code exchange
 * succeeds and the ID token verifies, which is #30967's "no sign-in mechanism
 * of our own": state, PKCE, the exchange, the verification and the session
 * are all the vendor's, and only the entry is this module's. It adds no
 * configuration key.
 *
 * Where the sign-in lands: `target_link_uri` when it passed check 4, else the
 * deployment's base URL, which is where the vendor's own code-without-state
 * bounce lands (`generateState` falls back to `options.baseURL`). `login_hint`
 * is passed on to the IdP as `loginHint`.
 */

import { carryForwardedClientAddress } from './client-address-forwarding.js';
import { SSO_OIDC_CONFIG_FIELD, SSO_PROVIDER_OBJECT } from './sso-client-secret.js';
import { SSO_ALLOW_IDP_INITIATED_FIELD, ssoToggleStoredOn, type SsoProviderReader } from './sso-sign-in-options.js';
import type { SsoRefusalHostLogger } from './sso-oidc-refusal-cause.js';

/** What a third-party-initiated login request carries (OIDC Core 1.0 §4). */
export interface ThirdPartyInitiatedLogin {
  iss: string;
  targetLinkUri?: string;
  /** `target_link_uri` was sent, but not exactly once with a value: a miss, never read as absent. */
  targetLinkUriUnusable?: true;
  loginHint?: string;
}

/**
 * The §4 shape: a `GET` carrying exactly one non-empty `iss`, and no `code`,
 * `state` or `error`. Anything else is not this entry's (`undefined`), and the
 * vendor answers it as it always has. A `target_link_uri` that is repeated or
 * empty is marked `targetLinkUriUnusable` (the gate refuses it); a repeated or
 * empty `login_hint` is not passed on.
 */
export function thirdPartyInitiatedLoginOf(request: Request): ThirdPartyInitiatedLogin | undefined {
  if (request.method !== 'GET') return undefined;
  let query: URLSearchParams;
  try {
    query = new URL(request.url).searchParams;
  } catch {
    return undefined;
  }
  if (query.has('code') || query.has('state') || query.has('error')) return undefined;
  const iss = query.getAll('iss');
  if (iss.length !== 1 || !iss[0]) return undefined;
  const one = (name: string): string | undefined => {
    const values = query.getAll(name);
    return values.length === 1 && values[0] ? values[0] : undefined;
  };
  const targetLinkUri = one('target_link_uri');
  const targetLinkUriUnusable = targetLinkUri === undefined && query.has('target_link_uri');
  const loginHint = one('login_hint');
  return {
    iss: iss[0],
    ...(targetLinkUri !== undefined ? { targetLinkUri } : {}),
    ...(targetLinkUriUnusable ? { targetLinkUriUnusable: true as const } : {}),
    ...(loginHint !== undefined ? { loginHint } : {}),
  };
}

/** The registered provider, as the entry's gate reads it. */
export interface ThirdPartyLoginProvider {
  issuer: string;
  oidc: boolean;
  allowIdpInitiated: boolean;
}

/**
 * Read the provider row by `provider_id` through `reader` (a system-context
 * reader). No row or a failed read ⇒ `undefined` (fail closed: the entry
 * answers as today).
 */
export async function readThirdPartyLoginProvider(
  reader: SsoProviderReader | undefined,
  providerId: string,
): Promise<ThirdPartyLoginProvider | undefined> {
  if (!reader || typeof reader.find !== 'function' || !providerId) return undefined;
  try {
    const rows = await reader.find(SSO_PROVIDER_OBJECT, { where: { provider_id: providerId }, limit: 1 });
    const row = Array.isArray(rows) ? (rows[0] as Record<string, unknown> | undefined) : undefined;
    if (!row || row.provider_id !== providerId) return undefined;
    const oidcConfig = row[SSO_OIDC_CONFIG_FIELD];
    return {
      issuer: typeof row.issuer === 'string' ? row.issuer : '',
      oidc: (typeof oidcConfig === 'string' && oidcConfig.trim() !== '') || (!!oidcConfig && typeof oidcConfig === 'object'),
      allowIdpInitiated: ssoToggleStoredOn(row[SSO_ALLOW_IDP_INITIATED_FIELD]),
    };
  } catch {
    return undefined;
  }
}

/** Why the entry kept today's answer: the `reason` of its one `warn` line. */
export const THIRD_PARTY_INITIATED_LOGIN_MISSES = [
  'provider_not_registered',
  'provider_not_oidc',
  'idp_initiated_off',
  'issuer_mismatch',
  'target_link_uri_untrusted',
  'start_refused',
] as const;
export type ThirdPartyInitiatedLoginMiss = (typeof THIRD_PARTY_INITIATED_LOGIN_MISSES)[number];

/**
 * The four conditions of ruling 6764924025, in order: the first miss, or
 * `undefined` when all four hold.
 */
export function judgeThirdPartyInitiatedLogin(
  login: ThirdPartyInitiatedLogin,
  provider: ThirdPartyLoginProvider | undefined,
  isTrustedTarget: (url: string) => boolean,
): ThirdPartyInitiatedLoginMiss | undefined {
  if (!provider) return 'provider_not_registered';
  if (!provider.oidc) return 'provider_not_oidc';
  if (!provider.allowIdpInitiated) return 'idp_initiated_off';
  if (!provider.issuer || login.iss !== provider.issuer) return 'issuer_mismatch';
  if (login.targetLinkUriUnusable) return 'target_link_uri_untrusted';
  if (login.targetLinkUri !== undefined && !isTrustedTarget(login.targetLinkUri)) return 'target_link_uri_untrusted';
  return undefined;
}

/** The members of better-auth's context the entry reads. */
export interface ThirdPartyLoginContext {
  isTrustedOrigin: (url: string, settings?: { allowRelativePaths?: boolean }) => boolean;
  options: { baseURL?: string };
}

/** What the entry needs from its host (`AuthManager#runSsoCallback`). */
export interface ThirdPartyLoginHost {
  readProvider: () => Promise<ThirdPartyLoginProvider | undefined>;
  context: () => Promise<ThirdPartyLoginContext>;
  /** The vendor's `POST {basePath}/sign-in/sso`, as an absolute URL. */
  startUrl: string;
  /**
   * Re-dispatch one request through the manager's own request seam, with the
   * transport of the request the entry serves (#24877).
   */
  dispatch: (request: Request) => Promise<Response>;
  logger?: SsoRefusalHostLogger;
}

/**
 * The headers the re-dispatched start carries, by allow-list as the bridges
 * build theirs (`register-sso-provider.ts` `forwardAuthHeaders`,
 * `sys-session-revoke.ts`): its JSON body type, the request's own `Origin`, and
 * the forwarding facts the client-address rule reads
 * (`carryForwardedClientAddress`). No cookie and no `authorization`: the start
 * reads and renews no session.
 */
function startHeaders(request: Request, origin: string): Headers {
  const headers = new Headers({ 'content-type': 'application/json', origin });
  carryForwardedClientAddress(request.headers, headers);
  return headers;
}

/** The longest `providerId` the `warn` line carries: the path segment is the caller's. */
const LOGGED_PROVIDER_ID_MAX = 128;
const loggedProviderId = (providerId: string): string =>
  providerId.length > LOGGED_PROVIDER_ID_MAX ? `${providerId.slice(0, LOGGED_PROVIDER_ID_MAX)}…` : providerId;

/**
 * Run one `/sso/callback/:providerId` request through the entry: a request of
 * the §4 shape that passes the gate is answered `302` to the IdP by the
 * vendor's own start; every other request, and every miss, is answered by
 * `fallThrough` (the vendor's callback, unchanged).
 */
export async function runThirdPartyInitiatedLogin(
  entry: { providerId: string; request: Request },
  host: ThirdPartyLoginHost,
  fallThrough: () => Promise<Response>,
): Promise<Response> {
  const login = thirdPartyInitiatedLoginOf(entry.request);
  if (!login) return fallThrough();

  const miss = async (reason: ThirdPartyInitiatedLoginMiss): Promise<Response> => {
    const meta = { providerId: loggedProviderId(entry.providerId), entry: 'third_party_initiated', reason };
    const text = `[auth] Third-party-initiated SSO sign-in not started: the request did not pass the entry's checks (${reason})`;
    if (host.logger) host.logger.warn(text, meta);
    else console.warn(text, meta);
    return fallThrough();
  };

  let provider: ThirdPartyLoginProvider | undefined;
  try {
    provider = await host.readProvider();
  } catch {
    provider = undefined;
  }
  let context: ThirdPartyLoginContext;
  try {
    context = await host.context();
  } catch {
    return miss('start_refused');
  }
  const isTrustedTarget = (url: string): boolean => {
    try {
      return context.isTrustedOrigin(url, { allowRelativePaths: true });
    } catch {
      return false;
    }
  };
  const verdict = judgeThirdPartyInitiatedLogin(login, provider, isTrustedTarget);
  if (verdict) return miss(verdict);

  const callbackURL = login.targetLinkUri ?? context.options.baseURL;
  if (!callbackURL) return miss('start_refused');
  let started: Response;
  try {
    started = await host.dispatch(
      new Request(host.startUrl, {
        method: 'POST',
        headers: startHeaders(entry.request, new URL(entry.request.url).origin),
        body: JSON.stringify({
          providerId: entry.providerId,
          providerType: 'oidc',
          callbackURL,
          ...(login.loginHint !== undefined ? { loginHint: login.loginHint } : {}),
        }),
      }),
    );
  } catch {
    return miss('start_refused');
  }
  const url = started.status === 200 ? await authorizationUrlOf(started) : undefined;
  if (!url) return miss('start_refused');

  const answer = new Headers({ location: url });
  for (const cookie of started.headers.getSetCookie?.() ?? []) answer.append('set-cookie', cookie);
  return new Response(null, { status: 302, headers: answer });
}

/** The `url` of the vendor's `{ url, redirect: true }` answer, when it is an absolute http(s) URL. */
async function authorizationUrlOf(response: Response): Promise<string | undefined> {
  try {
    const body = (await response.json()) as { url?: unknown } | null;
    const url = body?.url;
    if (typeof url !== 'string') return undefined;
    const parsed = new URL(url);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? parsed.href : undefined;
  } catch {
    return undefined;
  }
}
