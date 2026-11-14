// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Direct sign-in: with single sign-on configured, a person who opens the
 * deployment signed out goes straight to the identity provider instead of the
 * sign-in page, and comes back to the page they opened.
 *
 * ## The two halves
 *
 * - This module is the server half: the setting ({@link resolveDirectSignIn}),
 *   the provider it starts ({@link chooseDirectSignInProvider}), the return
 *   path it keeps ({@link keptReturnPath}), and the start door
 *   `GET {basePath}/sign-in/direct` ({@link runDirectSignIn}).
 * - The Console's `/login` route is the other half: it navigates to the door
 *   when `/auth/config` serves `features.directSignIn: true`, and draws the
 *   page instead whenever its loop guard says so (an `error` on the URL, a
 *   recent start that did not end in a session, `?local=1` while the local
 *   path is `hidden`, an OAuth client's hand-off).
 *
 * The redirect is only ever made by that page. No server route answers a
 * request with a redirect it did not answer with before: the API, `/mcp`,
 * API-key and bearer requests, the OAuth authorize and callback doors are
 * untouched, and with the setting off the start door is not mounted.
 *
 * ## It mints nothing
 *
 * The door is the `sso-third-party-initiated-login.ts` entry's shape: it hands
 * the vendor's OWN start (`POST /sign-in/social` for an `oidcProviders` entry,
 * which is where better-auth mounts a generic-OAuth provider, and
 * `POST /sign-in/sso` for a `sys_sso_provider` row) a fresh request with no
 * cookie and no `authorization`, and answers `302` to the authorization URL
 * the vendor returned, with the vendor's state cookie. State, PKCE, the code
 * exchange, the ID token check and the session are all the vendor's.
 *
 * ## The return path (no open redirect)
 *
 * Only a same-origin relative path is kept, judged before and after percent
 * decoding; anything else (an absolute URL, a protocol-relative one, a
 * backslash, a control character) is DROPPED and the sign-in returns to the
 * Console root. Dropped, not refused: a bad link still signs the person in.
 * The kept path is composed onto the deployment's canonical origin, so the
 * vendor's own origin check judges an absolute URL on a trusted origin.
 *
 * ## The local sign-in path
 *
 * `localSignIn: 'hidden'` keeps the sign-in page reachable at `/login?local=1`;
 * `'off'` stops the page from offering it. Either way the server's password
 * sign-in is unchanged, so the break-glass administrator of ADR-0135 D5.2
 * keeps a local credential reachable.
 */

import { carryForwardedClientAddress } from './client-address-forwarding.js';
import { SSO_PROVIDER_OBJECT } from './sso-client-secret.js';
import type { SsoProviderReader } from './sso-sign-in-options.js';

/** What a deployment declares to turn direct sign-in on. */
export interface DirectSignInOptions {
  /**
   * The identity provider a signed-out visit goes to: an `oidcProviders`
   * `providerId` (the platform identity provider is one, `objectstack-cloud`)
   * or a `sys_sso_provider` `provider_id`. Unset: the one provider configured,
   * when exactly one is; with none or several, nobody is redirected.
   */
  provider?: string;
  /**
   * The sign-in page behind direct sign-in: `hidden` (default) keeps it at
   * `/login?local=1`, `off` stops the page from offering it. The server's
   * password sign-in is the same either way.
   */
  localSignIn?: DirectSignInLocalPath;
}

/** The two states of the local sign-in path behind direct sign-in. */
export const DIRECT_SIGN_IN_LOCAL_PATHS = ['hidden', 'off'] as const;
export type DirectSignInLocalPath = (typeof DIRECT_SIGN_IN_LOCAL_PATHS)[number];

/** The setting in force. */
export type ResolvedDirectSignIn =
  | { enabled: false }
  | { enabled: true; provider?: string; localSignIn: DirectSignInLocalPath };

/** The environment variables a self-hosted deployment sets. */
export const DIRECT_SIGN_IN_ENV = {
  enabled: 'OS_AUTH_DIRECT_SIGN_IN_ENABLED',
  provider: 'OS_AUTH_DIRECT_SIGN_IN_PROVIDER',
  localSignIn: 'OS_AUTH_LOCAL_SIGN_IN',
} as const;

/** The start door's path under the auth `basePath`. */
export const DIRECT_SIGN_IN_PATH = '/sign-in/direct';

/** The start door's closed query-parameter set (AGENTS.md, route rule 5). */
export const DIRECT_SIGN_IN_QUERY_PARAMS: readonly string[] = ['callbackURL'];

/**
 * The `error` code the door lands on the sign-in page with when it cannot
 * start a sign-in (no single provider to start, or the vendor refused the
 * start). The page draws, and does not navigate again.
 */
export const DIRECT_SIGN_IN_UNAVAILABLE = 'direct_sign_in_unavailable';

/** The longest return path kept; a longer one is dropped. */
export const RETURN_PATH_MAX = 2048;

const FALSE_WORDS = ['0', 'false', 'off', 'no'];

function readEnvBoolean(raw: string | undefined): boolean | undefined {
  if (raw == null) return undefined;
  const normalized = String(raw).trim().toLowerCase();
  if (normalized === '') return undefined;
  return !FALSE_WORDS.includes(normalized);
}

function readEnvText(raw: string | undefined): string | undefined {
  if (raw == null) return undefined;
  const trimmed = String(raw).trim();
  return trimmed === '' ? undefined : trimmed;
}

function isLocalPath(value: unknown): value is DirectSignInLocalPath {
  return (DIRECT_SIGN_IN_LOCAL_PATHS as readonly unknown[]).includes(value);
}

/**
 * The setting in force: the environment wins over the option, field by field
 * (the `OS_AUTH_SSO_ONLY` parity rule), so a deployment can turn it on or off
 * whatever the host passed. Absent everywhere ⇒ off.
 *
 * An off-vocabulary `localSignIn` (option or env) THROWS: a typo there must
 * not quietly reopen, or quietly close, the local sign-in page.
 */
export function resolveDirectSignIn(
  option: DirectSignInOptions | undefined,
  env: Record<string, string | undefined>,
): ResolvedDirectSignIn {
  const enabledFromEnv = readEnvBoolean(env[DIRECT_SIGN_IN_ENV.enabled]);
  const enabled = enabledFromEnv ?? (option !== undefined);
  const localRaw = readEnvText(env[DIRECT_SIGN_IN_ENV.localSignIn]) ?? option?.localSignIn;
  if (localRaw !== undefined && !isLocalPath(localRaw)) {
    throw new Error(
      `[auth] Direct sign-in: the local sign-in path is ${JSON.stringify(localRaw)}, which is not one of `
      + `${DIRECT_SIGN_IN_LOCAL_PATHS.join(', ')}. Set ${DIRECT_SIGN_IN_ENV.localSignIn} (or directSignIn.localSignIn) `
      + 'to hidden, to keep the sign-in page at /login?local=1, or to off.',
    );
  }
  if (!enabled) return { enabled: false };
  const provider = readEnvText(env[DIRECT_SIGN_IN_ENV.provider]) ?? readEnvText(option?.provider);
  return {
    enabled: true,
    ...(provider !== undefined ? { provider } : {}),
    localSignIn: localRaw ?? 'hidden',
  };
}

/** Characters that never appear in a kept return path. */
// eslint-disable-next-line no-control-regex
const CONTROL_CHARACTER = /[\u0000-\u001f\u007f]/;

/** One decoding layer: is this spelling a same-origin path, read literally? */
function isPlainSameOriginPath(path: string): boolean {
  if (!path.startsWith('/')) return false;
  if (path.startsWith('//')) return false;
  if (path.includes('\\')) return false;
  if (CONTROL_CHARACTER.test(path)) return false;
  return true;
}

/**
 * The return path a sign-in comes back to, or `undefined` when `raw` is not a
 * same-origin relative path and must be dropped.
 *
 * Kept only when, at every layer of percent-decoding (up to three), it starts
 * with exactly one `/`, carries no backslash and no control character (a tab or
 * a newline included), and when a URL parser resolving it against an
 * arbitrary origin stays on that origin. A path that does not decode cleanly is
 * dropped too.
 */
export function keptReturnPath(raw: unknown): string | undefined {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > RETURN_PATH_MAX) return undefined;
  let layer = raw;
  for (let i = 0; i < 3; i++) {
    if (!isPlainSameOriginPath(layer)) return undefined;
    let decoded: string;
    try {
      decoded = decodeURIComponent(layer);
    } catch {
      return undefined;
    }
    if (decoded === layer) break;
    layer = decoded;
  }
  if (!isPlainSameOriginPath(layer)) return undefined;
  const probe = 'https://return-path.invalid';
  try {
    if (new URL(raw, probe).origin !== probe) return undefined;
  } catch {
    return undefined;
  }
  return raw;
}

/** Which vendor start a provider takes. */
export type DirectSignInProvider =
  | { kind: 'oauth'; providerId: string }
  | { kind: 'sso'; providerId: string };

/** Why no provider was chosen. */
export const DIRECT_SIGN_IN_PROVIDER_MISSES = ['provider_not_found', 'no_provider', 'several_providers'] as const;
export type DirectSignInProviderMiss = (typeof DIRECT_SIGN_IN_PROVIDER_MISSES)[number];

/**
 * The provider a signed-out visit goes to.
 *
 * - Named (`provider`): an `oidcProviders` entry of that id, else a
 *   `sys_sso_provider` row of that id; neither ⇒ `provider_not_found`.
 * - Unnamed: the one candidate across `oidcProviders` and the registered
 *   `sys_sso_provider` rows; none ⇒ `no_provider`, several ⇒
 *   `several_providers`. Built-in social providers (Google, …) are never
 *   candidates: they are a person's choice on the page, not the deployment's
 *   identity provider.
 */
export function chooseDirectSignInProvider(input: {
  provider?: string;
  oauthProviderIds: readonly string[];
  ssoProviderIds: readonly string[];
}): DirectSignInProvider | { miss: DirectSignInProviderMiss } {
  const { provider, oauthProviderIds, ssoProviderIds } = input;
  if (provider !== undefined) {
    if (oauthProviderIds.includes(provider)) return { kind: 'oauth', providerId: provider };
    if (ssoProviderIds.includes(provider)) return { kind: 'sso', providerId: provider };
    return { miss: 'provider_not_found' };
  }
  const oauth = [...new Set(oauthProviderIds)];
  const sso = [...new Set(ssoProviderIds)].filter((id) => !oauth.includes(id));
  const count = oauth.length + sso.length;
  if (count === 0) return { miss: 'no_provider' };
  if (count > 1) return { miss: 'several_providers' };
  return oauth.length === 1 ? { kind: 'oauth', providerId: oauth[0] } : { kind: 'sso', providerId: sso[0] };
}

/**
 * The `sys_sso_provider` ids a choice reads: the named one alone, or up to two
 * rows (enough to tell one from several). A failed read answers none, so the
 * choice misses and nobody is redirected.
 */
export async function readSsoProviderIds(
  reader: SsoProviderReader | undefined,
  provider: string | undefined,
): Promise<string[]> {
  if (!reader || typeof reader.find !== 'function') return [];
  try {
    const rows = await reader.find(
      SSO_PROVIDER_OBJECT,
      provider !== undefined ? { where: { provider_id: provider }, limit: 1 } : { limit: 2 },
    );
    if (!Array.isArray(rows)) return [];
    return rows
      .map((row) => (row as Record<string, unknown> | undefined)?.provider_id)
      .filter((id): id is string => typeof id === 'string' && id !== '');
  } catch {
    return [];
  }
}

/** What the start door needs from its host (`AuthManager`). */
export interface DirectSignInHost {
  /** The setting in force. */
  setting: () => ResolvedDirectSignIn;
  /** The provider a visit goes to, or why none. */
  chooseProvider: () => Promise<DirectSignInProvider | { miss: DirectSignInProviderMiss }>;
  /** The deployment's canonical origin (`https://host`). */
  origin: () => string;
  /** The absolute URL of a Console page. */
  consolePageUrl: (path: string) => string;
  /** The vendor's start, as an absolute URL, for a provider kind. */
  startUrl: (kind: DirectSignInProvider['kind']) => string;
  /** Re-dispatch one request to the vendor, never back through the route table. */
  dispatch: (request: Request) => Promise<Response>;
  logger?: { warn: (message: string, meta?: Record<string, unknown>) => void; debug?: (message: string, meta?: Record<string, unknown>) => void };
}

/** Why the door did not start a sign-in: the `reason` of its one `warn` line. */
export type DirectSignInMiss = DirectSignInProviderMiss | 'start_refused';

function startHeaders(request: Request, origin: string): Headers {
  const headers = new Headers({ 'content-type': 'application/json', origin });
  carryForwardedClientAddress(request.headers, headers);
  return headers;
}

/** The `url` of the vendor's `{ url, redirect }` answer, when it is an absolute http(s) URL. */
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

function redirect(location: string, cookies: readonly string[] = []): Response {
  const headers = new Headers({ location, 'cache-control': 'no-store' });
  for (const cookie of cookies) headers.append('set-cookie', cookie);
  return new Response(null, { status: 302, headers });
}

/** The query names a request carries, each once per occurrence. */
function queryNames(url: URL): string[] {
  return [...url.searchParams.keys()];
}

/**
 * Answer one `GET {basePath}/sign-in/direct` request.
 *
 * - An unknown query parameter, or `callbackURL` sent more than once ⇒
 *   `400 VALIDATION_ERROR` (the door's closed set).
 * - Otherwise `302` to the identity provider with the vendor's state cookie,
 *   returning to the kept path ({@link keptReturnPath}) or the Console root;
 *   every failure of the sign-in lands on the Console's `/login` with `error`.
 * - No provider to start, or a start the vendor refused ⇒ `302` to the
 *   Console's `/login?error=direct_sign_in_unavailable`, and one `warn` line.
 *
 * The caller mounts the door only while the setting is on; a call with it off
 * answers 404 like an unmounted route.
 */
export async function runDirectSignIn(request: Request, host: DirectSignInHost): Promise<Response> {
  const setting = host.setting();
  if (!setting.enabled) {
    return new Response(JSON.stringify({ success: false, error: { code: 'NOT_FOUND', message: 'Not found' } }), {
      status: 404,
      headers: { 'content-type': 'application/json' },
    });
  }
  const url = new URL(request.url);
  const names = queryNames(url);
  const unknown = [...new Set(names.filter((name) => !DIRECT_SIGN_IN_QUERY_PARAMS.includes(name)))].sort();
  const repeated = names.filter((name) => name === 'callbackURL').length > 1;
  if (unknown.length > 0 || repeated) {
    const message = unknown.length > 0
      ? `${unknown.length === 1 ? `The "${unknown[0]}" query parameter is` : `The query parameters ${unknown.map((n) => `"${n}"`).join(', ')} are`} `
        + 'not supported by this endpoint. This endpoint will not silently ignore a parameter it does not understand. '
        + `Supported parameters: ${DIRECT_SIGN_IN_QUERY_PARAMS.join(', ')}.`
      : 'The "callbackURL" query parameter was supplied more than once; send it once.';
    return new Response(JSON.stringify({ success: false, error: { code: 'VALIDATION_ERROR', message } }), {
      status: 400,
      headers: { 'content-type': 'application/json' },
    });
  }

  const unavailable = (reason: DirectSignInMiss, providerId?: string): Response => {
    const text = `[auth] Direct sign-in not started: ${reason}. The sign-in page is shown instead.`;
    const meta = { entry: 'direct_sign_in', reason, ...(providerId ? { providerId } : {}) };
    if (host.logger) host.logger.warn(text, meta);
    else console.warn(text, meta);
    return redirect(`${host.consolePageUrl('/login')}?error=${DIRECT_SIGN_IN_UNAVAILABLE}`);
  };

  let chosen: DirectSignInProvider | { miss: DirectSignInProviderMiss };
  try {
    chosen = await host.chooseProvider();
  } catch {
    return unavailable('start_refused');
  }
  if ('miss' in chosen) return unavailable(chosen.miss);

  const requested = url.searchParams.get('callbackURL');
  const kept = keptReturnPath(requested);
  if (requested !== null && kept === undefined) {
    host.logger?.debug?.('[auth] Direct sign-in: the return path is not a same-origin path and was dropped.', {
      entry: 'direct_sign_in',
    });
  }
  const origin = host.origin();
  const callbackURL = kept !== undefined ? `${origin}${kept}` : host.consolePageUrl('/');
  // Defence in depth: whatever was kept, the sign-in returns to this origin.
  if (new URL(callbackURL).origin !== new URL(origin).origin) return unavailable('start_refused');
  const errorCallbackURL = host.consolePageUrl('/login');

  const body = chosen.kind === 'oauth'
    ? { provider: chosen.providerId, callbackURL, errorCallbackURL, disableRedirect: true }
    : { providerId: chosen.providerId, callbackURL, errorCallbackURL };
  let started: Response;
  try {
    started = await host.dispatch(
      new Request(host.startUrl(chosen.kind), {
        method: 'POST',
        headers: startHeaders(request, new URL(origin).origin),
        body: JSON.stringify(body),
      }),
    );
  } catch {
    return unavailable('start_refused', chosen.providerId);
  }
  const location = started.status === 200 ? await authorizationUrlOf(started) : undefined;
  if (!location) return unavailable('start_refused', chosen.providerId);
  return redirect(location, started.headers.getSetCookie?.() ?? []);
}
