// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Why an enterprise OIDC sign-in was refused: one cause per refusal class, on
 * the redirect and in one structured log line.
 *
 * ## The gap
 *
 * `@better-auth/sso` (1.7.12) verifies the IdP's ID token in
 * `handleOIDCCallback` and, whatever went wrong, answers ONE redirect:
 * `error=invalid_provider&error_description=token_not_verified`. A wrong
 * audience, an expired token, a foreign issuer and a retired signing key all
 * read the same, so an administrator wiring Okta or Entra ID cannot tell which
 * setting to fix. The vendor offers no hook on that verification and no option
 * that keeps the cause.
 *
 * ## Where the cause is readable
 *
 * The vendor catches the `jose` error and hands the error OBJECT to its logger
 * (`ctx.context.logger.error(error)`, `dist/index.mjs` in `handleOIDCCallback`)
 * before it redirects. `betterAuth({ logger: { log } })` receives that object
 * as `message` (`@better-auth/core` `createLogger`: `options.log(level,
 * message, ...args)`). That is the one place the cause survives, so this
 * module reads it there:
 *
 *  1. `AuthManager.handleRequest` opens a {@link runSsoOidcCallbackScope} scope
 *     around a `/sso/callback/:providerId` request;
 *  2. the log sink plugin-auth gives `betterAuth` ({@link createBetterAuthLogSink})
 *     holds back an error line whose message is a `jose` error with a code this
 *     module classifies, and records the cause in the scope;
 *  3. when the vendor's answer is the opaque redirect, the scope rewrites its
 *     `error_description` to the cause, writes one `warn` line, and drops the
 *     held vendor line, which the warn line replaces. Every other answer
 *     releases the held lines unchanged.
 *
 * Classification reads the `jose` error `code` (and `claim` for a claim
 * failure), never its message text. A refusal this module cannot classify
 * keeps `token_not_verified`.
 *
 * ## What stays out, on purpose
 *
 * - `error=` stays `invalid_provider`: consumers may branch on it.
 * - The redirect and the log line carry a cause token and the provider id,
 *   nothing else: no token content, no claim value, no subject or email, and
 *   nothing that depends on whether an account exists. The refusal happens
 *   before any user lookup, so the answer is the same for every account.
 * - SAML causes: the vendor discards the SAML cause inside the package (a
 *   bare `catch` around `parseLoginResponse`), so it is not readable here; that
 *   half waits on the vendor. Where a SAML refusal LANDS is this module's,
 *   below.
 *
 * The values are lowercase `error_description` tokens in the vendor's own
 * dialect for that slot (`token_not_verified`, `id_token_subject_missing`), not
 * ADR-0112 `error.code` members: a redirect query is not one of that
 * vocabulary's doors.
 *
 * ## SAML: where a refusal lands
 *
 * The same scope wraps the SAML ACS (`POST /sso/saml2/sp/acs/:providerId`),
 * for a different gap. `@better-auth/sso` (1.7.12, `processSAMLResponse`)
 * sends nearly every SAML refusal to the flow's error URL: the sign-in's
 * `errorCallbackURL`, else the platform error page (`onAPIError.errorURL`),
 * as the OIDC callback does. Two do not:
 *
 *  - an account refusal answered by better-auth's `handleOAuthUserInfo`
 *    (`account_not_linked`, `signup_disabled`, `unable_to_link_account`,
 *    `unable_to_create_user`, `email_not_verified`,
 *    `unable_to_create_session`) is redirected to the SUCCESS `callbackURL`
 *    with only `?error=`, so the user lands on the signed-in page, not
 *    signed in;
 *  - a refusal thrown before the vendor reads the relay state (a response
 *    over `maxResponseSize`) lands on the provider's fallback, the app origin
 *    for a provider the Register SAML Provider bridge stored.
 *
 * The vendor computes the error URL from the relay state and offers no hook
 * on it, so {@link readSamlAcsLanding} reads the same relay-state row through
 * the vendor's own `internalAdapter` BEFORE the vendor consumes it, and
 * applies the vendor's own redirect safety rule to it. When the vendor's answer
 * is then a redirect carrying `error=` that is not the success URL, it is
 * re-based onto that error URL with its `error` and `error_description` as
 * the vendor wrote them, built the way the vendor builds every other SAML
 * refusal. A refusal already on the error URL comes out byte-identical; a
 * success, an IdP-initiated response (no relay state), and a relay state the
 * vendor itself cannot read are left as the vendor answered them.
 */

import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * The closed list of OIDC refusal causes this package answers in the
 * callback redirect's `error_description` and in its log line. Documented in
 * `content/docs/permissions/sso.mdx` ("Why an OIDC sign-in was refused").
 */
export const SSO_OIDC_REFUSAL_CAUSES = [
  'id_token_expired',
  'id_token_not_yet_valid',
  'id_token_audience_mismatch',
  'id_token_issuer_mismatch',
  'id_token_signing_key_unknown',
  'id_token_signature_invalid',
] as const;

export type SsoOidcRefusalCause = (typeof SSO_OIDC_REFUSAL_CAUSES)[number];

/** The vendor's own description for a refused ID token; kept when no cause is classified. */
export const SSO_OIDC_UNCLASSIFIED_REFUSAL = 'token_not_verified';

/** The vendor's `error=` value on that redirect, which this module never changes. */
const OPAQUE_REFUSAL_ERROR = 'invalid_provider';

const CALLBACK_PATH_PREFIX = '/sso/callback/';

/**
 * The cause a `jose` verification error stands for, read off its `code` (and
 * `claim`), or `undefined` when it is none of the classified kinds.
 */
export function classifySsoOidcIdTokenError(error: unknown): SsoOidcRefusalCause | undefined {
  if (!error || typeof error !== 'object') return undefined;
  const { code, claim } = error as { code?: unknown; claim?: unknown };
  switch (code) {
    case 'ERR_JWT_EXPIRED':
      return 'id_token_expired';
    case 'ERR_JWT_CLAIM_VALIDATION_FAILED':
      if (claim === 'aud') return 'id_token_audience_mismatch';
      if (claim === 'iss') return 'id_token_issuer_mismatch';
      if (claim === 'nbf') return 'id_token_not_yet_valid';
      return undefined;
    case 'ERR_JWKS_NO_MATCHING_KEY':
      return 'id_token_signing_key_unknown';
    case 'ERR_JWS_SIGNATURE_VERIFICATION_FAILED':
      return 'id_token_signature_invalid';
    default:
      return undefined;
  }
}

/**
 * The provider id of an OIDC callback request (`/sso/callback/:providerId`,
 * the endpoint path as `betterAuthEndpointPath` answers it), or `undefined`
 * for any other path. The shared `/sso/callback` endpoint is not scoped:
 * it is reached only when `sso({ redirectURI })` is set, and plugin-auth does
 * not set it.
 */
export function ssoOidcCallbackProviderId(endpointPath: string | undefined): string | undefined {
  if (!endpointPath?.startsWith(CALLBACK_PATH_PREFIX)) return undefined;
  const providerId = endpointPath.slice(CALLBACK_PATH_PREFIX.length);
  if (!providerId || providerId.includes('/')) return undefined;
  try {
    return decodeURIComponent(providerId);
  } catch {
    return providerId;
  }
}

/** A vendor error line held back while the callback runs. */
interface HeldLine {
  cause: SsoOidcRefusalCause;
  release: () => void;
}

interface CallbackScope {
  held: HeldLine[];
}

const callbackScope = new AsyncLocalStorage<CallbackScope>();

/** The levels `@better-auth/core`'s logger hands a custom `log`. */
type BetterAuthLogLevel = 'debug' | 'info' | 'success' | 'warn' | 'error';

/** The host logger `AuthManagerOptions.logger` describes. */
export interface SsoRefusalHostLogger {
  info?: (message: string, meta?: any) => void;
  warn: (message: string, meta?: any) => void;
  error?: (message: string, meta?: any) => void;
}

/**
 * The text of a vendor line. A message that is an error object is rendered as
 * its name and message, as better-auth's own console logger rendered it: a
 * `jose` claim error carries the token's whole claim set on `payload`, which
 * must never reach a log line.
 */
function messageText(message: unknown): string {
  if (typeof message === 'string') return message;
  if (message instanceof Error) return `${message.name}: ${message.message}`;
  return String(message);
}

/**
 * Forward one vendor log line to the host logger, level for level: better-auth
 * already chose `error` or `warn` for its own lines, and moving them onto the
 * kernel logger does not regrade them. With no host logger, the lines go to the
 * console, as they did before a sink existed.
 */
function forwardVendorLine(
  host: SsoRefusalHostLogger | undefined,
  level: BetterAuthLogLevel,
  message: unknown,
  args: unknown[],
): void {
  const text = `[better-auth] ${messageText(message)}`;
  // Further arguments are the vendor's own context (an error it caught, a
  // `{ providerId }` record) and pass through as it wrote them.
  const meta = args.length === 0 ? undefined : args.length === 1 ? args[0] : { details: args };
  if (!host) {
    const write = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
    if (meta === undefined) write(text);
    else write(text, meta);
    return;
  }
  if (level === 'error') {
    if (host.error) host.error(text, meta);
    else host.warn(text, meta);
  } else if (level === 'warn') {
    host.warn(text, meta);
  } else {
    host.info?.(text, meta);
  }
}

/**
 * The `logger` plugin-auth hands `betterAuth`. Outside an OIDC callback scope
 * it only forwards. Inside one, an error line whose message is a classified
 * `jose` error is held back, with its cause recorded, until the scope knows
 * whether the vendor answered the opaque refusal.
 *
 * `level` is left at the vendor default (`warn`), so the same lines are
 * published as before this sink existed.
 */
export function createBetterAuthLogSink(host: () => SsoRefusalHostLogger | undefined): {
  log: (level: BetterAuthLogLevel, message: unknown, ...args: unknown[]) => void;
} {
  return {
    log(level, message, ...args) {
      const release = () => forwardVendorLine(host(), level, message, args);
      const scope = callbackScope.getStore();
      const cause = scope && level === 'error' ? classifySsoOidcIdTokenError(message) : undefined;
      if (scope && cause) {
        scope.held.push({ cause, release });
        return;
      }
      release();
    },
  };
}

/**
 * Split a `Location` value into its query segments, leaving everything else
 * byte-for-byte as the vendor wrote it.
 */
function splitLocation(location: string): { head: string; segments: string[]; fragment: string } | undefined {
  const hashAt = location.indexOf('#');
  const fragment = hashAt === -1 ? '' : location.slice(hashAt);
  const beforeHash = hashAt === -1 ? location : location.slice(0, hashAt);
  const queryAt = beforeHash.indexOf('?');
  if (queryAt === -1) return undefined;
  return {
    head: beforeHash.slice(0, queryAt),
    segments: beforeHash.slice(queryAt + 1).split('&'),
    fragment,
  };
}

/** Whether a `Location` is the vendor's opaque ID-token refusal. */
function isOpaqueRefusal(location: string): boolean {
  const parts = splitLocation(location);
  return (
    !!parts &&
    parts.segments.includes(`error=${OPAQUE_REFUSAL_ERROR}`) &&
    parts.segments.includes(`error_description=${SSO_OIDC_UNCLASSIFIED_REFUSAL}`)
  );
}

function withDescription(location: string, cause: SsoOidcRefusalCause): string {
  const parts = splitLocation(location)!;
  const segments = parts.segments.map((s) =>
    s === `error_description=${SSO_OIDC_UNCLASSIFIED_REFUSAL}` ? `error_description=${cause}` : s,
  );
  return `${parts.head}?${segments.join('&')}${parts.fragment}`;
}

/**
 * Run one `/sso/callback/:providerId` request inside a refusal scope, and
 * answer it with the cause put on the redirect.
 *
 * When the vendor answers `error=invalid_provider&error_description=
 * token_not_verified`, the description becomes the cause of the last held
 * `jose` error (the ID-token verification is the vendor's last log line
 * before that redirect), the held line is dropped, and one `warn` line is
 * written: `providerId`, `protocol: 'oidc'`, `cause`. With no classified
 * cause the redirect is left as it is and the warn line names
 * `token_not_verified`. Any other answer is returned untouched and every held
 * line is released as the vendor wrote it.
 */
export async function runSsoOidcCallbackScope(
  providerId: string,
  host: SsoRefusalHostLogger | undefined,
  run: () => Promise<Response>,
): Promise<Response> {
  const scope: CallbackScope = { held: [] };
  let response: Response;
  try {
    response = await callbackScope.run(scope, run);
  } catch (error) {
    for (const line of scope.held) line.release();
    throw error;
  }

  const location = response.headers.get('location');
  if (!location || !isOpaqueRefusal(location)) {
    for (const line of scope.held) line.release();
    return response;
  }

  const classified = scope.held.length > 0 ? scope.held[scope.held.length - 1] : undefined;
  for (const line of scope.held.slice(0, -1)) line.release();
  const cause = classified?.cause ?? SSO_OIDC_UNCLASSIFIED_REFUSAL;
  const meta = { providerId, protocol: 'oidc', cause };
  const text = `[auth] SSO sign-in refused: the identity provider's ID token was not accepted (${cause})`;
  if (host) host.warn(text, meta);
  else console.warn(text, meta);
  if (!classified) return response;

  const headers = new Headers(response.headers);
  headers.set('location', withDescription(location, classified.cause));
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

// ── SAML: where a refusal lands ─────────────────────────────────────────────

const SAML_ACS_PATH_PREFIX = '/sso/saml2/sp/acs/';

/**
 * The provider id of a SAML ACS request (`/sso/saml2/sp/acs/:providerId`, the
 * endpoint path as `betterAuthEndpointPath` answers it), or `undefined` for
 * any other path.
 */
export function ssoSamlAcsProviderId(endpointPath: string | undefined): string | undefined {
  if (!endpointPath?.startsWith(SAML_ACS_PATH_PREFIX)) return undefined;
  const providerId = endpointPath.slice(SAML_ACS_PATH_PREFIX.length);
  if (!providerId || providerId.includes('/')) return undefined;
  try {
    return decodeURIComponent(providerId);
  } catch {
    return providerId;
  }
}

/** One SSO callback request that runs inside the refusal scope. */
export type SsoCallbackRequest =
  | { protocol: 'oidc'; providerId: string }
  | { protocol: 'saml'; providerId: string; request: Request };

/**
 * The SSO callback a request is, if any: the OIDC callback, or a `POST` to the
 * SAML ACS (the IdP's assertion; a `GET` there carries no assertion).
 */
export function ssoCallbackOf(endpointPath: string | undefined, request: Request): SsoCallbackRequest | undefined {
  const oidc = ssoOidcCallbackProviderId(endpointPath);
  if (oidc !== undefined) return { protocol: 'oidc', providerId: oidc };
  const saml = ssoSamlAcsProviderId(endpointPath);
  if (saml !== undefined && request.method === 'POST') return { protocol: 'saml', providerId: saml, request };
  return undefined;
}

/** The members of better-auth's endpoint context the SAML landing reads. */
export interface SamlLandingContext {
  baseURL: string;
  options: { onAPIError?: { errorURL?: string } };
  isTrustedOrigin: (url: string, settings?: { allowRelativePaths: boolean }) => boolean;
  internalAdapter: { findVerificationValue: (identifier: string) => Promise<{ value: string } | null | undefined> };
}

/** Where one SAML sign-in lands: its success URL, and the error URL for every refusal. */
export interface SamlAcsLanding {
  success: string;
  error: string;
}

/** The `RelayState` an ACS `POST` carries, form-encoded or JSON (the two media types the vendor admits). */
async function relayStateOf(request: Request): Promise<string | undefined> {
  const text = await request.clone().text();
  const type = request.headers.get('content-type') ?? '';
  let relayState: unknown;
  if (type.includes('application/json')) {
    try {
      relayState = (JSON.parse(text) as { RelayState?: unknown } | null)?.RelayState;
    } catch {
      return undefined;
    }
  } else {
    relayState = new URLSearchParams(text).get('RelayState');
  }
  return typeof relayState === 'string' && relayState ? relayState : undefined;
}

/**
 * The vendor's redirect safety rule for a SAML redirect target
 * (`@better-auth/sso` `getSafeRedirectCandidate`): a same-origin path that does
 * not start `//` or `/\`, or an absolute URL on the app origin or a trusted
 * origin; never the ACS itself.
 */
function safeSamlTarget(
  url: string,
  acsPathname: string,
  appOrigin: string,
  isTrustedOrigin: SamlLandingContext['isTrustedOrigin'],
): string | undefined {
  if (url.startsWith('/')) {
    if (/^\/(?:\/|\\|%2f|%5c)/i.test(url)) return undefined;
    try {
      const absolute = new URL(url, appOrigin);
      return absolute.origin !== appOrigin || absolute.pathname === acsPathname ? undefined : url;
    } catch {
      return undefined;
    }
  }
  let absolute: URL;
  try {
    absolute = new URL(url);
  } catch {
    return undefined;
  }
  if (absolute.origin !== appOrigin && !isTrustedOrigin(url, { allowRelativePaths: false })) return undefined;
  if (absolute.origin === appOrigin && absolute.pathname === acsPathname) return undefined;
  return url;
}

/**
 * Where this ACS request's refusals land, read BEFORE the vendor runs: the
 * relay-state row the vendor wrote at `/sign-in/sso` (`auth-state:<RelayState>`,
 * read through the vendor's own `internalAdapter`, which the vendor deletes
 * once it has read it), with the same default and the same safety rule the
 * vendor applies to it. `undefined` when there is no relay state, the row is
 * gone or unreadable, or the error URL is not a safe target: the vendor then
 * has no error URL either, and its answer stands.
 */
export async function readSamlAcsLanding(
  context: SamlLandingContext,
  providerId: string,
  request: Request,
): Promise<SamlAcsLanding | undefined> {
  const relayState = await relayStateOf(request);
  if (!relayState) return undefined;
  const row = await context.internalAdapter.findVerificationValue(`auth-state:${relayState}`);
  if (!row?.value) return undefined;
  let state: { callbackURL?: unknown; errorURL?: unknown };
  try {
    state = JSON.parse(row.value);
  } catch {
    return undefined;
  }
  if (typeof state?.callbackURL !== 'string') return undefined;
  const errorURL =
    typeof state.errorURL === 'string' && state.errorURL
      ? state.errorURL
      : context.options.onAPIError?.errorURL || `${context.baseURL}/error`;
  const appOrigin = new URL(context.baseURL).origin;
  const acsPathname = new URL(`${context.baseURL}${SAML_ACS_PATH_PREFIX}${providerId}`).pathname;
  const error = safeSamlTarget(errorURL, acsPathname, appOrigin, context.isTrustedOrigin);
  return error ? { success: state.callbackURL, error } : undefined;
}

/**
 * The vendor's refusal `location`, re-based onto `target` with its `error` and
 * `error_description` kept as written, built as the vendor builds every other
 * SAML refusal (`buildSAMLRedirectUrl`: query values set on the target, a
 * relative target kept relative).
 */
function rebaseSamlRefusal(location: string, target: string): string {
  const from = new URL(location, 'http://better-auth.local');
  const url = new URL(target, 'http://better-auth.local');
  for (const key of ['error', 'error_description']) {
    const value = from.searchParams.get(key);
    if (value !== null) url.searchParams.set(key, value);
  }
  return target.startsWith('/') && !target.startsWith('//') ? `${url.pathname}${url.search}${url.hash}` : url.toString();
}

/**
 * Put one SAML ACS answer on its landing: a redirect that carries `error=` and
 * is not the success URL is re-based onto the error URL. Every other answer is
 * returned untouched.
 */
export function landSamlRefusal(response: Response, landing: SamlAcsLanding): Response {
  const location = response.headers.get('location');
  if (!location || location === landing.success) return response;
  if (!new URL(location, 'http://better-auth.local').searchParams.has('error')) return response;
  const landed = rebaseSamlRefusal(location, landing.error);
  if (landed === location) return response;
  const headers = new Headers(response.headers);
  headers.set('location', landed);
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

/**
 * Run one SSO callback request inside the refusal scope: the OIDC callback
 * through {@link runSsoOidcCallbackScope}, the SAML ACS with its landing read
 * before the vendor runs and applied to its answer.
 */
export async function runSsoCallbackScope(
  callback: SsoCallbackRequest,
  host: SsoRefusalHostLogger | undefined,
  readSamlLanding: (saml: Extract<SsoCallbackRequest, { protocol: 'saml' }>) => Promise<SamlAcsLanding | undefined>,
  run: () => Promise<Response>,
): Promise<Response> {
  if (callback.protocol === 'oidc') return runSsoOidcCallbackScope(callback.providerId, host, run);
  // A landing that cannot be read leaves the vendor's answer as it is.
  const landing = await readSamlLanding(callback).catch(() => undefined);
  const response = await run();
  return landing ? landSamlRefusal(response, landing) : response;
}
