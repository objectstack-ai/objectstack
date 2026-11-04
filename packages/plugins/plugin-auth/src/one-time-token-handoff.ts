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
 *    with `C = BASE64URL(SHA-256(code_verifier))`. That URL is the shell's only
 *    entry: a browser that has yet to sign in is sent to the sign-in page from
 *    here, and comes back here afterwards (see "The sign-in entry" below).
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
 * ## Who can open it (maintainer ruling A, card comment 6597001931)
 *
 * The binding stops a callback being redeemed by an app that intercepts it.
 * It does not stop an app or a web page from OPENING the hand-off itself,
 * with its own challenge, in a browser that already holds the user's session.
 * Two refusals close that:
 *
 *  - **Freshness.** A token is minted only for a session created within
 *    {@link ONE_TIME_TOKEN_HANDOFF_SESSION_MAX_AGE_SECONDS}. An older one is
 *    refused the way no session is, because the remedy is the same: a sign-in.
 *    So every hand-off follows a full sign-in in the system auth session (an
 *    ephemeral session is fine); an existing Safari or Custom Tabs session is
 *    not enough.
 *  - **Cross-site navigation.** A request carrying `Sec-Fetch-Site:
 *    cross-site` answers `400 VALIDATION_ERROR` before anything else is read:
 *    a malformed request context, not a missing sign-in. The header is judged
 *    only when present.
 *
 * Generation happens only inside this route ({@link withHandoffChallenge}):
 * the plugin's generate endpoint refuses every HTTP request
 * (`disableClientRequest`), and a server-side call made outside this route's
 * scope stores a key no redemption can reach, so it fails closed.
 *
 * ## The sign-in entry (maintainer ruling: 「改成服务端入口」)
 *
 * The app opens this route and nothing else, so the Console's sign-in route
 * stays internal to this repository and its release: an installed app lives
 * for months, and a Console upgrade must not be able to strand it. A valid
 * request whose session is missing or too old therefore answers one of two
 * ways, and every `400` above is decided before either:
 *
 *  - **A page navigation** ({@link isPageNavigation}) answers `302` to this
 *    deployment's sign-in page, with `redirect` naming this same request, so
 *    the user sees a form instead of raw JSON.
 *  - **Anything else** answers `401 UNAUTHENTICATED`. The app's anonymous probe
 *    is one of these, and it reads `401` as "this server registered me".
 *
 * Which is which rests on no single header, because neither has been measured
 * in a real `ASWebAuthenticationSession` or Custom Tabs. `Sec-Fetch-Dest` decides
 * when a browser sends it (`document` for a top-level page, `empty` for a
 * `fetch`); a browser without Fetch Metadata still asks for `text/html` on a
 * navigation. A request carrying neither gets the `401`, which is what this
 * route answered before the entry existed.
 *
 * Three more rules, each read off a failure:
 *
 *  - **The browser stays on the origin it arrived on.** The session cookie and
 *    the sign-in page's same-origin match of `redirect` both depend on it, so
 *    `Location` is root-relative. `AuthManager.getConsoleUrl` composes from the
 *    canonical origin; {@link resolveHandoffSignInEntry} takes only the PATH of
 *    its answer, which keeps `uiBasePath` and any base path in `baseUrl`.
 *  - **No Console, no redirect.** A sign-in page is sent to only when this
 *    process answers it with an HTML document, asked the way the browser would
 *    be about to ask. `--no-ui`, a Console that was not built, a host that
 *    redirects the Console elsewhere and a Console served by something in front
 *    of this process all keep the `401`, and the first one says so once at
 *    `warn`.
 *  - **It cannot bounce.** The sign-in page judges a session's age on the
 *    device's clock and this route judges it on the server's, so on a device
 *    whose clock is behind, the page forwards a session this route refuses.
 *    Two things stop that: the redirect carries {@link HANDOFF_REFUSED_AT_PARAM},
 *    the server's time of the refusal, which lets the page hold its form for
 *    any session created by then without reading the device's clock; and a
 *    navigation reporting `Sec-Fetch-Site: same-origin` that this route still
 *    refuses is one the sign-in page forwarded, so it gets the `401`, never
 *    another redirect. The second holds even for a page that ignores the first.
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
import { AuthEndpointPaths } from '@objectstack/spec/api';
import { TrustedAppSchemeSchema } from '@objectstack/spec/system';

/** The hand-off route under the auth base path (an ObjectStack mount), as the spec names it. */
export const ONE_TIME_TOKEN_HANDOFF_PATH = AuthEndpointPaths.oneTimeTokenHandoff;

/** The vendor plugin's redemption route under the auth base path, as the spec names it. */
export const ONE_TIME_TOKEN_VERIFY_PATH = AuthEndpointPaths.oneTimeTokenVerify;

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

/**
 * How old the caller's session may be, in SECONDS, for the hand-off to carry
 * it (maintainer ruling A on the residual risk this PR raised, card comment
 * 6597001931). The hand-off hands over a session the shell has just watched
 * the user create in the system auth session; a session older than this was
 * made for something else, and a page or app that opens the hand-off against
 * it would carry it off silently. Five minutes covers a sign-in with a slow
 * second factor.
 */
export const ONE_TIME_TOKEN_HANDOFF_SESSION_MAX_AGE_SECONDS = 5 * 60;

/**
 * On the redirect to the sign-in page, beside `redirect`: when this route
 * refused the browser's session, in epoch milliseconds on the SERVER's clock.
 *
 * A session whose `createdAt` is not later than this is one the route has
 * already refused, whatever the device's clock says, so the page holds its form
 * for it; a session made after it (a sign-in on the page, or a provider's
 * sign-in that returned to the same URL) is forwarded. The comparison is between
 * two readings of one clock. The page's verdict is never a security question:
 * this route refuses on its own.
 */
export const HANDOFF_REFUSED_AT_PARAM = 'handoff_refused_at';

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
 * Why `entry` cannot be a registered app scheme, or `undefined` when it can.
 * The rule is the spec's own {@link TrustedAppSchemeSchema} (RFC 8252 §7.1:
 * a lowercase reverse-domain private-use scheme such as `com.example.app`,
 * with no `:` suffix), imported, never copied: the auth manager also
 * receives plain objects that never passed through `AuthConfigSchema`, so
 * it runs the same schema again. The reverse-domain rule is also the first
 * interception defence: a scheme named for a domain the app's publisher
 * controls is one another app has no business claiming.
 * {@link NEVER_APP_SCHEMES} is checked first only for the clearer message —
 * none of them contains a dot, so the schema refuses each one anyway.
 */
export function appSchemeRefusal(entry: unknown): string | undefined {
  if (typeof entry !== 'string') return 'is not a string';
  if (NEVER_APP_SCHEMES.includes(entry.toLowerCase().replace(/:.*$/, ''))) {
    return 'is a web or script scheme the browser itself handles, never an app scheme';
  }
  if (!TrustedAppSchemeSchema.safeParse(entry).success) {
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

/** Where a page navigation goes to sign in, both root-relative: see "The sign-in entry" above. */
export interface HandoffSignInEntry {
  /** This deployment's sign-in page. */
  signInPage: string;
  /** This route, as the page navigates back to it. */
  handoff: string;
}

export interface HandoffDeps {
  /** The registered app schemes ({@link registeredAppSchemesOf}). */
  registeredSchemes: readonly string[];
  /**
   * When the live session `headers` carry was created, or `null` when they
   * carry none: the vendor session's `session.createdAt` (`sys_session.created_at`),
   * which a refresh or a bearer replay never moves (those move `updatedAt`).
   */
  sessionCreatedAt(headers: Headers): Promise<Date | null>;
  /** The clock, for the freshness window; `Date.now` by default. */
  now?: () => number;
  /** The vendor plugin's generate endpoint, called server-side with the caller's headers. */
  generate(headers: Headers): Promise<{ token: string }>;
  /**
   * Where a page navigation goes to sign in, or `null` when this deployment
   * serves no sign-in page ({@link resolveHandoffSignInEntry}). Asked only for a
   * valid request whose session is refused.
   */
  signInEntry(headers: Headers): Promise<HandoffSignInEntry | null>;
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

/** The request's `Sec-Fetch-Site`, `undefined` when it carries none. */
function fetchSite(headers: Headers): string | undefined {
  return headers.get('sec-fetch-site')?.trim().toLowerCase();
}

/**
 * Whether the request is a browser navigating to a page, not a client calling an
 * API. `Sec-Fetch-Dest` decides when present, so a `fetch` asking for HTML stays
 * a call and an iframe is not the top-level page. A browser without Fetch
 * Metadata still names `text/html` in `Accept` on a navigation; the app's probe
 * (`Accept: application/json`) and a bare `curl` (which accepts anything) do not.
 */
export function isPageNavigation(headers: Headers): boolean {
  const dest = headers.get('sec-fetch-dest')?.trim().toLowerCase();
  if (dest) return dest === 'document';
  return (headers.get('accept') ?? '')
    .split(',')
    .some((range) => range.split(';')[0].trim().toLowerCase() === 'text/html');
}

/**
 * The sign-in entry of this deployment, when this process serves its sign-in
 * page. Only the PATH of the manager's absolute URLs is taken, so the browser
 * stays on the origin the request arrived on; they are never composed a second
 * time, so `uiBasePath` and a base path in `baseUrl` mean what they mean in every
 * link this deployment mails.
 *
 * Whether the page exists is asked of the composed server, per request, the way
 * the Console's own document asks for its branding: a route being registered
 * would not tell a Console from the `503` a server answers on the same paths when
 * its build is missing.
 */
export async function resolveHandoffSignInEntry(source: {
  /** `AuthManager.getConsoleUrl` for the sign-in page. */
  signInPageUrl: string;
  /** `AuthManager.getAuthIssuer`: the canonical origin, any base path, and the auth mount. */
  authBaseUrl: string;
  /** The path this process mounts the auth routes at. */
  authMountPath: string;
  requestUrl: string;
  requestHost: string | null;
  /** The composed server, answering in-process. */
  dispatch(request: Request): Response | Promise<Response>;
  /** Told why no entry exists; the caller says so once. */
  onUnserved(path: string, reason: string): void;
}): Promise<HandoffSignInEntry | null> {
  let signInPage: string;
  let authBase: string;
  try {
    signInPage = new URL(source.signInPageUrl).pathname;
    authBase = new URL(source.authBaseUrl).pathname.replace(/\/+$/, '');
  } catch {
    source.onUnserved(source.signInPageUrl, 'it is not a URL: check uiBasePath and baseUrl');
    return null;
  }
  // A base path in `baseUrl` belongs to whatever is in front of this process, so
  // the browser's path carries it and this process's own route does not.
  const deploymentBase = authBase.endsWith(source.authMountPath)
    ? authBase.slice(0, authBase.length - source.authMountPath.length)
    : '';
  const localPath = deploymentBase && signInPage.startsWith(`${deploymentBase}/`)
    ? signInPage.slice(deploymentBase.length)
    : signInPage;

  const headers = new Headers({ accept: 'text/html' });
  if (source.requestHost) headers.set('host', source.requestHost);
  const answer = await source.dispatch(new Request(new URL(localPath, source.requestUrl), { headers }));
  const served = answer.status === 200 && (answer.headers.get('content-type') ?? '').toLowerCase().startsWith('text/html');
  const reason = `it answers ${answer.status}`;
  try {
    await answer.body?.cancel();
  } catch {
    // The body is never read; a stream that cannot be cancelled changes nothing.
  }
  if (!served) {
    source.onUnserved(localPath, reason);
    return null;
  }
  return { signInPage, handoff: `${authBase}${ONE_TIME_TOKEN_HANDOFF_PATH}` };
}

/**
 * The answer to a valid request whose session is refused: `refused` (the `401`),
 * or for a page navigation the `302` to the sign-in page. See "The sign-in entry"
 * in the module docblock.
 */
async function refusedSessionAnswer(
  deps: HandoffDeps,
  request: HandoffRequest,
  validated: URLSearchParams,
  now: number,
  refused: HandoffAnswer,
): Promise<HandoffAnswer> {
  if (!isPageNavigation(request.headers)) return refused;
  // The sign-in page forwarded a session this route refuses. Sending it back
  // would bounce forever; the shell's own entry reports `none`.
  if (fetchSite(request.headers) === 'same-origin') return refused;
  const entry = await deps.signInEntry(request.headers);
  if (entry === null) return refused;
  const query = new URLSearchParams({
    redirect: `${entry.handoff}?${validated}`,
    [HANDOFF_REFUSED_AT_PARAM]: String(now),
  });
  return { status: 302, headers: { ...NO_STORE, Location: `${entry.signInPage}?${query}` } };
}

/** `GET /api/v1/auth/one-time-token/handoff` — see the module docblock. */
export async function runOneTimeTokenHandoff(deps: HandoffDeps, request: HandoffRequest): Promise<HandoffAnswer> {
  // A navigation another site started (a link, a form, a script) arrives with
  // `Sec-Fetch-Site: cross-site` and the session cookie, since `SameSite=Lax`
  // sends it on a top-level GET. The shell opens the hand-off itself, which a
  // browser reports as `none`. Judged only when the header is present: a
  // browser that sends none is not refused for its absence (ruling A).
  if (fetchSite(request.headers) === 'cross-site') {
    return refusal(
      400,
      'VALIDATION_ERROR',
      'The sign-in hand-off cannot be opened from another site: the app opens it in its own system auth session.',
    );
  }

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

  // Every parameter is valid from here on, so these are what `redirect` is
  // rebuilt from: nothing else the request carried reaches the sign-in page.
  const validated = new URLSearchParams({ redirect_uri: redirect.value, code_challenge: challenge.value });
  if (method.value !== undefined) validated.set('code_challenge_method', method.value);

  const now = (deps.now ?? Date.now)();
  const createdAt = await deps.sessionCreatedAt(request.headers);
  if (!createdAt) {
    return refusedSessionAnswer(
      deps,
      request,
      validated,
      now,
      refusal(401, 'UNAUTHENTICATED', 'Sign in first: the hand-off carries the signed-in session of this browser to the app.'),
    );
  }
  const ageMs = now - createdAt.getTime();
  if (!(ageMs <= ONE_TIME_TOKEN_HANDOFF_SESSION_MAX_AGE_SECONDS * 1000)) {
    return refusedSessionAnswer(
      deps,
      request,
      validated,
      now,
      refusal(
        401,
        'UNAUTHENTICATED',
        `Sign in again: the hand-off carries only a session signed in within the last ${ONE_TIME_TOKEN_HANDOFF_SESSION_MAX_AGE_SECONDS / 60} minutes, ` +
          'so the app completes a sign-in in its system auth session before every hand-off.',
      ),
    );
  }

  const { token } = await withHandoffChallenge(challenge.value, () => deps.generate(request.headers));
  target.searchParams.set('token', token);
  return { status: 302, headers: { ...NO_STORE, Location: target.toString() } };
}
