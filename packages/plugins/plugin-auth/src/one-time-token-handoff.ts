// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The mobile sign-in hand-off: a sign-in completed in the SYSTEM browser is
 * handed back to the app's WebView as a single-use, short-lived token
 * (maintainer ruling, option B: reuse better-auth's `one-time-token` plugin,
 * no hand-written exchange endpoint).
 *
 * ## Why it exists
 *
 * Some identity providers (Google among them) refuse to sign a user in inside
 * an embedded WebView. The mobile shell therefore opens the sign-in in the
 * platform's system auth session (`ASWebAuthenticationSession`, Custom Tabs),
 * where the session cookie lands in the system browser, not in the WebView the
 * Console runs in. This module carries that session across, once.
 *
 * ## The flow, and which half is whose
 *
 * 1. The shell makes a random `code_verifier` (RFC 7636 §4.1) and keeps it.
 * 2. The shell opens, in the system auth session,
 *    `GET /api/v1/auth/one-time-token/handoff?redirect_uri=SCHEME://PATH&code_challenge=C&code_challenge_method=S256`
 *    with `C = BASE64URL(SHA-256(code_verifier))`, after (or as the end of) a
 *    sign-in there.
 * 3. This route checks that `redirect_uri` names a REGISTERED app scheme,
 *    mints a token from the signed-in session through the vendor plugin's own
 *    generate endpoint (called server-side; the plugin refuses it over HTTP),
 *    and answers `302` to `redirect_uri` with `token=T` added.
 * 4. The shell (or the Console it hands both values to) redeems at the vendor
 *    route `POST /api/v1/auth/one-time-token/verify` with
 *    `{ "token": "T.code_verifier" }` and receives that session (and its
 *    cookie, on the WebView's origin).
 *
 * ## How an intercepted callback cannot be redeemed
 *
 * The vendor plugin is not bound to the attempt that started the sign-in: by
 * itself, whoever holds `T` redeems it. On a phone another app can register
 * the same custom scheme and receive the callback. So the token's storage key
 * is bound to the challenge, PKCE-style, through the plugin's own published
 * `storeToken: { type: 'custom-hasher' }` option ({@link oneTimeTokenStoreHasher}):
 *
 *  - at generation the plugin stores the session under
 *    `SHA-256(T ":" C)`, where `C` is the challenge this route was given;
 *  - at redemption the plugin looks the session up under the hash of what the
 *    caller sent, which this hasher computes as `SHA-256(T ":" S256(verifier))`
 *    from `"T.verifier"`.
 *
 * The two keys meet only when the caller holds the verifier whose challenge
 * started the hand-off. An interceptor holds `T` alone: `T`, or `T` with any
 * guessed verifier, hashes to a key no row has, so the plugin answers its own
 * `400 Invalid token` — and, because the lookup is by that wrong key, it
 * consumes nothing: the real holder still redeems afterwards. The verifier
 * never leaves the device (only its hash travels, in step 2).
 *
 * Generation happens only inside this route ({@link withHandoffChallenge}):
 * the plugin's generate endpoint refuses every HTTP request
 * (`disableClientRequest`), and a server-side call made outside this route's
 * scope stores a key no redemption can reach, so it fails closed.
 *
 * ## The registered app-scheme list
 *
 * `redirect_uri` must name a scheme the deployment registered in
 * `AuthConfig.trustedAppSchemes` (matched case-insensitively); any other
 * target is refused with `400 VALIDATION_ERROR` and NO redirect, so the route
 * is never an open redirect. The list itself is refused at construction when
 * an entry is not a reverse-domain private-use scheme (RFC 8252 §7.1) or is a
 * web or script scheme ({@link NEVER_APP_SCHEMES}): a hand-off to `https:`
 * would put the token in a URL any site could receive.
 *
 * ## Query parameters — a closed set (AGENTS.md route rule 5)
 *
 * `redirect_uri`, `code_challenge`, `code_challenge_method`, each at most
 * once; any other name answers the shared recognition rule's located 400.
 */

import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash, randomBytes } from 'node:crypto';
import { repeatedQueryParamMessage, unknownQueryParamRefusalMessage } from '@objectstack/rest';

/** The hand-off route under the auth base path (an ObjectStack mount). */
export const ONE_TIME_TOKEN_HANDOFF_PATH = '/one-time-token/handoff';

/** The vendor plugin's redemption route under the auth base path. */
export const ONE_TIME_TOKEN_VERIFY_PATH = '/one-time-token/verify';

/** The vendor plugin's generate route; refused over HTTP (`disableClientRequest`). */
export const ONE_TIME_TOKEN_GENERATE_PATH = '/one-time-token/generate';

/**
 * Token lifetime, in MINUTES (the plugin's unit). One minute: the token
 * travels from the system browser to the app by a redirect the operating
 * system delivers at once, and is redeemed by the app's very next request, so
 * a whole minute is generous even on a slow device — and every second beyond
 * that is only time for a stolen token to be tried. The vendor default is 3.
 */
export const ONE_TIME_TOKEN_EXPIRES_IN_MINUTES = 1;

/** The route's CLOSED query-parameter set. */
export const ONE_TIME_TOKEN_HANDOFF_QUERY_PARAMS: readonly string[] = [
  'redirect_uri',
  'code_challenge',
  'code_challenge_method',
];

/**
 * Schemes that are never an app scheme, whatever the registered list says: the
 * browser itself navigates, renders or executes them, so a token handed to one
 * would leave the device's app boundary.
 */
export const NEVER_APP_SCHEMES: readonly string[] = [
  'http', 'https', 'javascript', 'data', 'file', 'blob', 'about', 'vbscript', 'ws', 'wss',
];

/** RFC 7636 §4.1 `code_verifier`: 43–128 unreserved characters. */
const CODE_VERIFIER_SYNTAX = /^[A-Za-z0-9\-._~]{43,128}$/;

/** RFC 7636 §4.2 S256 `code_challenge`: BASE64URL of a SHA-256 digest, no padding. */
const S256_CHALLENGE_SYNTAX = /^[A-Za-z0-9\-_]{43}$/;

/** RFC 7636 §4.2 S256: `BASE64URL(SHA-256(ASCII(code_verifier)))`. */
export function s256Challenge(codeVerifier: string): string {
  return createHash('sha256').update(codeVerifier, 'ascii').digest('base64url');
}

/** The storage key a token is kept under, bound to the challenge of the attempt that minted it. */
function bindingKey(token: string, challenge: string): string {
  return createHash('sha256').update(`${token}:${challenge}`, 'utf8').digest('base64url');
}

/** A key no stored row can carry: a redemption that is not well formed finds nothing. */
function unreachableKey(): string {
  return `unredeemable:${randomBytes(18).toString('base64url')}`;
}

/** The challenge of the hand-off in progress, visible to the hasher while the plugin generates. */
const handoffChallenge = new AsyncLocalStorage<string>();

/**
 * Run `generate` with `challenge` bound, so the token the plugin mints inside
 * it is stored under {@link bindingKey}`(token, challenge)`.
 */
export function withHandoffChallenge<T>(challenge: string, generate: () => Promise<T>): Promise<T> {
  return handoffChallenge.run(challenge, generate);
}

/**
 * The plugin's `storeToken.hash`. Inside {@link withHandoffChallenge} it is
 * hashing a token the plugin just generated; everywhere else it is hashing
 * what a redeemer sent, `"T.code_verifier"`. The generated token's alphabet
 * (`a-z 0-9 A-Z - _`) has no `.`, so the first `.` is the separator.
 */
export async function oneTimeTokenStoreHasher(input: string): Promise<string> {
  const challenge = handoffChallenge.getStore();
  if (challenge !== undefined) return bindingKey(input, challenge);
  const dot = input.indexOf('.');
  if (dot <= 0) return unreachableKey();
  const token = input.slice(0, dot);
  const codeVerifier = input.slice(dot + 1);
  if (!CODE_VERIFIER_SYNTAX.test(codeVerifier)) return unreachableKey();
  return bindingKey(token, s256Challenge(codeVerifier));
}

/**
 * A registered app scheme, as RFC 8252 §7.1 requires of a private-use scheme:
 * lowercase RFC 3986 scheme syntax containing a dot (reverse-domain, e.g.
 * `com.example.app`), with no `:` suffix. The reverse-domain rule is also the
 * first interception defence: a scheme named for a domain the app's
 * publisher controls is one another app has no business claiming.
 */
const APP_SCHEME_SYNTAX = /^[a-z][a-z0-9+.-]*$/;

/**
 * Why `entry` cannot be a registered app scheme, or `undefined` when it can.
 * The same rules the spec's `AuthConfig.trustedAppSchemes` refuses at parse;
 * repeated here because the auth manager also receives plain objects.
 */
export function appSchemeRefusal(entry: unknown): string | undefined {
  if (typeof entry !== 'string') return 'is not a string';
  if (NEVER_APP_SCHEMES.includes(entry.toLowerCase().replace(/:.*$/, ''))) {
    return 'is a web or script scheme the browser itself handles, never an app scheme';
  }
  if (!APP_SCHEME_SYNTAX.test(entry) || !entry.includes('.')) {
    return 'is not a lowercase reverse-domain scheme with no ":" suffix (RFC 8252 §7.1), e.g. "com.example.app"';
  }
  return undefined;
}

/**
 * Refuse a configured scheme list with any entry {@link appSchemeRefusal}
 * rejects — loudly, at construction, naming every bad entry. An entry is
 * never dropped: a deployment that misspelt its scheme would otherwise boot
 * with a hand-off that refuses its own app.
 */
export function assertTrustedAppSchemes(configured: unknown): void {
  if (configured === undefined) return;
  if (!Array.isArray(configured)) {
    throw new Error('[auth] trustedAppSchemes must be an array of app schemes, e.g. ["com.example.app"].');
  }
  const problems = configured
    .map((entry) => [entry, appSchemeRefusal(entry)] as const)
    .filter(([, why]) => why !== undefined)
    .map(([entry, why]) => `${JSON.stringify(entry)} ${why}`);
  if (problems.length > 0) {
    throw new Error(
      `[auth] invalid trustedAppSchemes: ${problems.join('; ')}. ` +
        'Each entry is the custom URL scheme of a native app the mobile sign-in hand-off may redirect a token to.',
    );
  }
}

/**
 * The deployment's registered app schemes, from `AuthConfig.trustedAppSchemes`
 * (declared by the spec beside `trustedOrigins`), after
 * {@link assertTrustedAppSchemes}. Empty means the hand-off has nowhere to
 * send a token, and the plugin is not mounted.
 */
export function registeredAppSchemesOf(config: { trustedAppSchemes?: readonly string[] } | undefined): string[] {
  const configured = config?.trustedAppSchemes;
  assertTrustedAppSchemes(configured);
  return [...new Set(configured ?? [])];
}

export interface HandoffAnswer {
  status: 302 | 400 | 401 | 500;
  body?: unknown;
  headers: Record<string, string>;
}

export interface HandoffDeps {
  /** The registered app schemes ({@link registeredAppSchemesOf}). */
  registeredSchemes: readonly string[];
  /** Whether `headers` carry a live session. */
  hasSession(headers: Headers): Promise<boolean>;
  /** The vendor plugin's generate endpoint, called server-side with the caller's headers. */
  generate(headers: Headers): Promise<{ token: string }>;
}

export interface HandoffRequest {
  /** Every query parameter as the transport parsed it, each name with all its values. */
  queries: Record<string, readonly string[]>;
  headers: Headers;
}

/** Every answer of this route is uncacheable and sends no referrer: a token is in flight. */
const NO_STORE = { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' } as const;

function refusal(status: 400 | 401, code: string, message: string): HandoffAnswer {
  return { status, body: { success: false, error: { code, message } }, headers: { ...NO_STORE } };
}

/** The single value of `name`, `undefined` when absent; a repeat is a refusal message. */
function single(queries: Record<string, readonly string[]>, name: string): { value?: string; refusal?: string } {
  const values = queries[name] ?? [];
  if (values.length > 1) return { refusal: repeatedQueryParamMessage(name, values.length) };
  return { value: values[0] };
}

/** `GET /api/v1/auth/one-time-token/handoff` — see the module docblock. */
export async function runOneTimeTokenHandoff(deps: HandoffDeps, request: HandoffRequest): Promise<HandoffAnswer> {
  const unknown = unknownQueryParamRefusalMessage(request.queries, ONE_TIME_TOKEN_HANDOFF_QUERY_PARAMS);
  if (unknown !== undefined) return refusal(400, 'VALIDATION_ERROR', unknown);

  const redirect = single(request.queries, 'redirect_uri');
  if (redirect.refusal) return refusal(400, 'VALIDATION_ERROR', redirect.refusal);
  if (!redirect.value) {
    return refusal(400, 'VALIDATION_ERROR', 'The "redirect_uri" query parameter is required: the app callback the token is handed to.');
  }
  let target: URL;
  try {
    target = new URL(redirect.value);
  } catch {
    return refusal(400, 'VALIDATION_ERROR', 'The "redirect_uri" query parameter is not an absolute URI.');
  }
  const scheme = target.protocol.replace(/:$/, '').toLowerCase();
  if (!deps.registeredSchemes.includes(scheme)) {
    return refusal(
      400,
      'VALIDATION_ERROR',
      `The "redirect_uri" scheme "${scheme}" is not a registered app scheme, so no token is handed to it. ` +
        'A deployment registers the app schemes it hands sign-ins to in its auth configuration.',
    );
  }

  const challenge = single(request.queries, 'code_challenge');
  if (challenge.refusal) return refusal(400, 'VALIDATION_ERROR', challenge.refusal);
  if (!challenge.value || !S256_CHALLENGE_SYNTAX.test(challenge.value)) {
    return refusal(
      400,
      'VALIDATION_ERROR',
      'The "code_challenge" query parameter is required: BASE64URL(SHA-256(code_verifier)), 43 characters (RFC 7636 S256). ' +
        'The redemption must present that code_verifier, so a callback another app intercepts cannot be redeemed.',
    );
  }
  const method = single(request.queries, 'code_challenge_method');
  if (method.refusal) return refusal(400, 'VALIDATION_ERROR', method.refusal);
  if (method.value !== undefined && method.value !== 'S256') {
    return refusal(400, 'VALIDATION_ERROR', 'The "code_challenge_method" query parameter accepts only "S256".');
  }

  if (!(await deps.hasSession(request.headers))) {
    return refusal(401, 'UNAUTHENTICATED', 'Sign in first: the hand-off carries the signed-in session of this browser to the app.');
  }

  const { token } = await withHandoffChallenge(challenge.value, () => deps.generate(request.headers));
  target.searchParams.set('token', token);
  return { status: 302, headers: { ...NO_STORE, Location: target.toString() } };
}
