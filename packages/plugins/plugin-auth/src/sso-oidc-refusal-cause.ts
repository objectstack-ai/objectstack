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
 * - SAML: the vendor discards the SAML cause inside the package (a bare
 *   `catch` around `parseLoginResponse`), so it is not readable here; that half
 *   waits on the vendor.
 *
 * The values are lowercase `error_description` tokens in the vendor's own
 * dialect for that slot (`token_not_verified`, `id_token_subject_missing`), not
 * ADR-0112 `error.code` members: a redirect query is not one of that
 * vocabulary's doors.
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
 * The one shape a vendor log argument reaches the host logger in. An `Error`
 * becomes its name, message and string `code`, and nothing else: a `jose`
 * claim error carries the token's whole claim set on `payload`, which must
 * never be logged.
 */
function describeLogValue(value: unknown): unknown {
  if (value instanceof Error) {
    const code = (value as { code?: unknown }).code;
    return { name: value.name, message: value.message, ...(typeof code === 'string' ? { code } : {}) };
  }
  return value;
}

function messageText(message: unknown): string {
  if (typeof message === 'string') return message;
  if (message instanceof Error) return `${message.name}: ${message.message}`;
  return String(message);
}

/**
 * Forward one vendor log line to the host logger, level for level: better-auth
 * already chose `error` or `warn` for its own lines, and moving them onto the
 * kernel logger does not regrade them. With no host logger, the lines go to the
 * console exactly as they did before a sink existed.
 */
function forwardVendorLine(
  host: SsoRefusalHostLogger | undefined,
  level: BetterAuthLogLevel,
  message: unknown,
  args: unknown[],
): void {
  const text = `[better-auth] ${messageText(message)}`;
  const details = [message instanceof Error ? describeLogValue(message) : undefined, ...args.map(describeLogValue)]
    .filter((v) => v !== undefined);
  const meta = details.length === 0 ? undefined : details.length === 1 ? details[0] : { details };
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
