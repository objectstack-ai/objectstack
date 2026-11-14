// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Per-provider "sign out of the company sign-in too" (ruling record
 * 6866334319, item 4 → A, following the per-provider switch precedent of
 * ruling record 6718355623).
 *
 * Each enterprise SSO provider carries one switch, `sys_sso_provider.sign_out_of_idp`
 * (vendor additional field `signOutOfIdp`, declared beside the sign-in options
 * in `sso-sign-in-options.ts`), OFF by default and `trackHistory`, so a change
 * is audited like the sign-in options. Off, nothing here runs: sign-out ends
 * the platform session only, and the identity provider's logout endpoint stays
 * closed. On, a sign-out of a session that started at that provider also ends
 * the provider's session:
 *
 * - **SAML: single logout, the vendor's own.** `@better-auth/sso` implements
 *   SP-initiated logout (`/sso/saml2/logout/:providerId`) and the identity
 *   provider's logout endpoint (`/sso/saml2/sp/slo/:providerId`), behind its
 *   plugin-wide `saml.enableSingleLogout`. plugin-auth hands it a getter
 *   (`ssoSamlOptions`) that answers the request's own provider's switch, so
 *   both are open for a provider with the switch on and closed for every
 *   other. A logout message coming back from the identity provider is
 *   accepted only when signed: `wantLogoutRequestSigned` and
 *   `wantLogoutResponseSigned` are constant `true`. The provider's logout
 *   address is the vendor's own `samlConfig.idpMetadata.singleLogoutService`
 *   (or a `SingleLogoutService` in the IdP metadata XML), written by the
 *   `logoutUrl` field of Register / Edit SAML Settings.
 * - **OIDC: an RP-initiated logout URL.** The vendor implements none, so the
 *   sign-out answers better-auth's own RP-logout shape (`{ success, url,
 *   redirect }`, the shape `/sign-out` already answers for a social
 *   provider's `createEndSessionURL`) with the provider's
 *   `end_session_endpoint`, `id_token_hint` (the `sys_account.id_token` of the
 *   user's account at that provider), `client_id`, and
 *   `post_logout_redirect_uri` / `state` from the sign-out body. The endpoint
 *   is read from the provider's discovery document when the switch is saved
 *   on, and kept in its `oidc_config` blob as `endSessionEndpoint`.
 *
 * ## How a session knows its provider
 *
 * A session row names no provider. Each protocol records it at sign-in, for a
 * provider whose switch is on at that moment:
 *
 * - SAML: the vendor's own `saml-session-by-id:<sessionId>` verification row,
 *   written by the ACS when `enableSingleLogout` answers true.
 * - OIDC: plugin-auth's `oidc-session-by-id:<sessionId>` verification row,
 *   written after the provider's callback signs someone in
 *   ({@link recordOidcSignOutSession}).
 *
 * Both expire with the session. A session minted before the switch was turned
 * on has no record, so its sign-out is the platform's only.
 *
 * ## Saving the switch on
 *
 * Refused `400 VALIDATION_FAILED` on `signOutOfIdp`, before the vendor writes,
 * when the provider cannot honour it ({@link judgeSignOutOfIdpCapability}): a
 * SAML provider with no logout address, an OIDC provider whose discovery
 * document names no `end_session_endpoint`.
 */

import {
  readSsoProviderSignInOptions,
  runWithSamlProviderScope,
  type SsoProviderReader,
} from './sso-sign-in-options.js';

/** better-auth's sign-out endpoint. */
export const SIGN_OUT_ENDPOINT_PATH = '/sign-out';

const SAML_SP_LOGOUT_PATH_PREFIX = '/sso/saml2/logout/';
/** The vendor's endpoint the identity provider posts or redirects its logout messages to. */
const SAML_IDP_LOGOUT_PATH_PREFIX = '/sso/saml2/sp/slo/';
/** The vendor's SP metadata, which advertises the logout service while single logout is on. */
const SAML_SP_METADATA_PATH = '/sso/saml2/sp/metadata';
/** The vendor's OIDC callback. */
export const SSO_OIDC_CALLBACK_PATH = '/sso/callback/:providerId';

/** The vendor's reverse lookup of a SAML session by better-auth session id. */
export const SAML_SESSION_BY_ID_PREFIX = 'saml-session-by-id:';
/** plugin-auth's record of the OIDC provider a session started at. */
export const OIDC_SESSION_BY_ID_PREFIX = 'oidc-session-by-id:';

/** Where the OIDC `end_session_endpoint` is kept in the provider's `oidc_config` blob. */
export const OIDC_END_SESSION_ENDPOINT_KEY = 'endSessionEndpoint';

/** The bindings the `logoutUrl` field stores its address under. */
export const SAML_HTTP_REDIRECT_BINDING = 'urn:oasis:names:tc:SAML:2.0:bindings:HTTP-Redirect';
export const SAML_HTTP_POST_BINDING = 'urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST';

/** The request-body member the switch is written as. */
export const SIGN_OUT_OF_IDP_BODY_KEY = 'signOutOfIdp';

// ── Paths ───────────────────────────────────────────────────────────────────

function providerIdAfter(endpointPath: string, prefix: string): string | undefined {
  if (!endpointPath.startsWith(prefix)) return undefined;
  const raw = endpointPath.slice(prefix.length);
  if (!raw || raw.includes('/')) return undefined;
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

/**
 * The provider of a vendor SAML single-logout request, if `endpointPath` is
 * one: the identity provider's logout endpoint (GET or POST), the SP-initiated
 * logout (POST), or the SP metadata (GET, `?providerId=`). These run with the
 * provider's switch in scope, so the vendor's `enableSingleLogout` answers it.
 */
export function samlSingleLogoutProviderId(endpointPath: string | undefined, request: Request): string | undefined {
  if (!endpointPath) return undefined;
  const idp = providerIdAfter(endpointPath, SAML_IDP_LOGOUT_PATH_PREFIX);
  if (idp !== undefined) return idp;
  if (request.method === 'POST') {
    const sp = providerIdAfter(endpointPath, SAML_SP_LOGOUT_PATH_PREFIX);
    if (sp !== undefined) return sp;
  }
  if (endpointPath === SAML_SP_METADATA_PATH && request.method === 'GET') {
    try {
      const providerId = new URL(request.url).searchParams.get('providerId');
      return providerId || undefined;
    } catch {
      return undefined;
    }
  }
  return undefined;
}

// ── Stored configuration ────────────────────────────────────────────────────

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

/** A stored protocol blob (JSON string or object) as an object, or `undefined`. */
export function parseProtocolConfig(value: unknown): Record<string, unknown> | undefined {
  if (isRecord(value)) return value;
  if (typeof value !== 'string' || value.trim() === '') return undefined;
  try {
    const parsed: unknown = JSON.parse(value);
    return isRecord(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Whether a SAML configuration names the identity provider's logout address:
 * the vendor's own predicate for single logout (`IDP_SLO_NOT_SUPPORTED`), a
 * `singleLogoutService` entry or a `SingleLogoutService` in the IdP metadata.
 */
export function samlConfigHasLogoutAddress(samlConfig: unknown): boolean {
  const config = parseProtocolConfig(samlConfig);
  const idp = isRecord(config?.idpMetadata) ? config!.idpMetadata : undefined;
  if (!idp) return false;
  const services = idp.singleLogoutService;
  if (Array.isArray(services) && services.some((s) => isRecord(s) && typeof s.Location === 'string' && s.Location.trim() !== '')) {
    return true;
  }
  return typeof idp.metadata === 'string' && idp.metadata.includes('SingleLogoutService');
}

/**
 * The `logoutUrl` field as the vendor's `singleLogoutService`, or a refusal
 * message when it is not an http(s) URL. One address, under both bindings:
 * the vendor sends its own LogoutRequest in the HTTP-Redirect binding, and
 * answers the identity provider's LogoutRequest in the binding it came in.
 */
export function samlLogoutServiceOf(logoutUrl: string): { service: Array<{ Binding: string; Location: string }> } | { refusal: string } {
  let url: URL;
  try {
    url = new URL(logoutUrl);
  } catch {
    return { refusal: 'logoutUrl is not a URL: paste the identity provider’s SAML single logout (redirect) endpoint.' };
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    return { refusal: 'logoutUrl must be an http(s) URL: the identity provider’s SAML single logout (redirect) endpoint.' };
  }
  return {
    service: [
      { Binding: SAML_HTTP_REDIRECT_BINDING, Location: url.toString() },
      { Binding: SAML_HTTP_POST_BINDING, Location: url.toString() },
    ],
  };
}

// ── The better-auth members this module reads ───────────────────────────────

/** One verification row, as better-auth's internal adapter answers it. */
interface VerificationRow {
  value: string;
}

/** One `sys_account` row, as better-auth's internal adapter answers it. */
interface AccountRow {
  providerId?: string;
  idToken?: string | null;
}

/** One `where` clause of the better-auth adapter. */
interface AdapterWhere {
  field: string;
  value: unknown;
}

/**
 * The two better-auth adapter calls this reads and writes the provider row
 * through (`ctx.context.adapter`): keyword-object calls on the vendor's
 * `ssoProvider` model, the same ones the vendor's own update-provider makes,
 * not the data engine's `(object, data, options)` door.
 */
export interface SsoProviderRowAdapter {
  findOne(args: { model: string; where: AdapterWhere[] }): Promise<Record<string, unknown> | null>;
  update(args: { model: string; where: AdapterWhere[]; update: Record<string, unknown> }): Promise<unknown>;
}

/** The members of better-auth's endpoint context this module reads. */
export interface SignOutAuthContext {
  baseURL: string;
  isTrustedOrigin: (url: string, settings?: { allowRelativePaths: boolean }) => boolean;
  internalAdapter: {
    findVerificationValue: (identifier: string) => Promise<VerificationRow | null | undefined>;
    createVerificationValue: (data: { identifier: string; value: string; expiresAt: Date }) => Promise<unknown>;
    deleteVerificationByIdentifier: (identifier: string) => Promise<unknown>;
    findAccounts: (userId: string) => Promise<AccountRow[]>;
  };
  adapter: SsoProviderRowAdapter;
}

/** A session as `getSession` answers it. */
export interface SignOutSession {
  session: { id: string; expiresAt?: Date | string };
  user: { id: string };
}

/** What the sign-out flow needs from the manager. */
export interface SsoSignOutDeps {
  context: () => Promise<SignOutAuthContext>;
  /** A system-context reader of `sys_sso_provider` (the switch). */
  reader: () => SsoProviderReader | undefined;
  /** better-auth's `getSession`, for the cookies in `headers`. */
  getSession: (headers: Headers) => Promise<SignOutSession | null>;
  /** One request through better-auth's handler, in this request's scopes. */
  dispatch: (request: Request) => Promise<Response>;
  warn: (message: string) => void;
}

async function readProviderRow(context: SignOutAuthContext, providerId: string): Promise<Record<string, unknown> | undefined> {
  try {
    const row = await context.adapter.findOne({ model: 'ssoProvider', where: [{ field: 'providerId', value: providerId }] });
    return row ?? undefined;
  } catch {
    return undefined;
  }
}

// ── Which provider a session started at ─────────────────────────────────────

/** The provider and protocol a session's sign-in recorded, or `undefined`. */
export async function signOutProviderOfSession(
  context: SignOutAuthContext,
  sessionId: string,
): Promise<{ protocol: 'saml' | 'oidc'; providerId: string } | undefined> {
  const internal = context.internalAdapter;
  try {
    const samlLookup = await internal.findVerificationValue(`${SAML_SESSION_BY_ID_PREFIX}${sessionId}`);
    if (samlLookup?.value) {
      const stored = await internal.findVerificationValue(samlLookup.value);
      const data = parseProtocolConfig(stored?.value);
      if (typeof data?.providerId === 'string' && data.providerId) return { protocol: 'saml', providerId: data.providerId };
    }
    const oidc = await internal.findVerificationValue(`${OIDC_SESSION_BY_ID_PREFIX}${sessionId}`);
    if (oidc?.value) return { protocol: 'oidc', providerId: oidc.value };
  } catch {
    return undefined;
  }
  return undefined;
}

/** `name=value` pairs of a response's `Set-Cookie` headers, as one `Cookie` header. */
function cookieHeaderOf(response: Response): string {
  const setCookies = response.headers.getSetCookie?.() ?? [response.headers.get('set-cookie') ?? ''];
  return setCookies.map((c) => c.split(';')[0]!.trim()).filter(Boolean).join('; ');
}

/**
 * After an OIDC callback for `providerId` answers: when it signed someone in
 * and the provider's switch is on, record that the new session started there.
 * Best effort: a failure is logged and the sign-in stands (its sign-out is
 * then the platform's only, the switch-off behaviour).
 */
export async function recordOidcSignOutSession(deps: SsoSignOutDeps, providerId: string, response: Response): Promise<void> {
  const cookie = cookieHeaderOf(response);
  if (!cookie || !/session_token=[^;]/.test(cookie)) return;
  try {
    const options = await readSsoProviderSignInOptions(deps.reader(), providerId);
    if (!options.signOutOfIdp) return;
    const signedIn = await deps.getSession(new Headers({ cookie }));
    if (!signedIn?.session?.id) return;
    const context = await deps.context();
    const expiresAt = signedIn.session.expiresAt ? new Date(signedIn.session.expiresAt) : new Date(Date.now() + 7 * 24 * 3600_000);
    await context.internalAdapter.createVerificationValue({
      identifier: `${OIDC_SESSION_BY_ID_PREFIX}${signedIn.session.id}`,
      value: providerId,
      expiresAt,
    });
  } catch (error) {
    deps.warn(
      `[sso] Could not record that a session started at OIDC provider "${providerId}"; signing out of it will not sign out of the identity provider: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

// ── The OIDC logout URL ─────────────────────────────────────────────────────

/** An RP-initiated logout URL (OpenID Connect RP-Initiated Logout 1.0 §2). */
export function oidcEndSessionUrl(
  endpoint: string,
  params: { idToken?: string | null; clientId?: string; postLogoutRedirectUri?: string; state?: string },
): string {
  const url = new URL(endpoint);
  if (params.idToken) url.searchParams.set('id_token_hint', params.idToken);
  if (params.clientId) url.searchParams.set('client_id', params.clientId);
  if (params.postLogoutRedirectUri) url.searchParams.set('post_logout_redirect_uri', params.postLogoutRedirectUri);
  if (params.state) url.searchParams.set('state', params.state);
  return url.toString();
}

/** The sign-out body members better-auth's `/sign-out` declares. */
interface SignOutBody {
  callbackURL?: string;
  disableRedirect?: boolean;
  state?: string;
}

async function readSignOutBody(request: Request): Promise<SignOutBody> {
  try {
    const text = await request.clone().text();
    if (!text) return {};
    const parsed: unknown = JSON.parse(text);
    if (!isRecord(parsed)) return {};
    return {
      ...(typeof parsed.callbackURL === 'string' ? { callbackURL: parsed.callbackURL } : {}),
      ...(parsed.disableRedirect === true ? { disableRedirect: true } : {}),
      ...(typeof parsed.state === 'string' ? { state: parsed.state } : {}),
    };
  } catch {
    return {};
  }
}

/** The sign-out answer with the identity provider's logout URL: better-auth's own RP-logout shape. */
function signOutAnswer(url: string, body: SignOutBody, from: Response): Response {
  const headers = new Headers();
  from.headers.forEach((value, name) => {
    const lower = name.toLowerCase();
    if (lower === 'set-cookie' || lower === 'content-length' || lower === 'location' || lower === 'content-type') return;
    headers.set(name, value);
  });
  for (const cookie of from.headers.getSetCookie?.() ?? []) headers.append('set-cookie', cookie);
  headers.set('content-type', 'application/json');
  const redirect = !body.disableRedirect;
  if (redirect) headers.set('location', url);
  return new Response(JSON.stringify({ success: true, url, redirect }), { status: 200, headers });
}

/** `callbackURL` as an absolute URL when this deployment trusts it, else `undefined`. */
function trustedPostLogoutUri(context: SignOutAuthContext, callbackURL: string | undefined): string | undefined {
  if (!callbackURL) return undefined;
  try {
    if (!context.isTrustedOrigin(callbackURL, { allowRelativePaths: true })) return undefined;
    return new URL(callbackURL, context.baseURL).toString();
  } catch {
    return undefined;
  }
}

// ── Sign-out ────────────────────────────────────────────────────────────────

/**
 * Run one `POST /sign-out`. A session that started at a provider whose switch
 * is on also ends the identity provider's session; every other sign-out is
 * `run` itself, unchanged.
 */
export async function runSsoSignOut(deps: SsoSignOutDeps, request: Request, run: () => Promise<Response>): Promise<Response> {
  if (request.method !== 'POST') return run();
  let context: SignOutAuthContext;
  let current: SignOutSession | null;
  let started: { protocol: 'saml' | 'oidc'; providerId: string } | undefined;
  try {
    current = await deps.getSession(request.headers);
    if (!current?.session?.id) return run();
    context = await deps.context();
    started = await signOutProviderOfSession(context, current.session.id);
  } catch {
    return run();
  }
  if (!started) return run();
  const options = await readSsoProviderSignInOptions(deps.reader(), started.providerId);
  if (!options.signOutOfIdp) return run();
  const body = await readSignOutBody(request);

  if (started.protocol === 'saml') {
    // The vendor's own SP-initiated logout: it builds the LogoutRequest from
    // the NameID and SessionIndex the ACS recorded, ends the session, and
    // answers 302 to the identity provider.
    const providerId = started.providerId;
    // `baseURL` is better-auth's own, base path included (`…/api/v1/auth`).
    const logoutUrl = `${context.baseURL.replace(/\/+$/, '')}${SAML_SP_LOGOUT_PATH_PREFIX}${encodeURIComponent(providerId)}`;
    const headers = new Headers(request.headers);
    headers.set('content-type', 'application/json');
    headers.delete('content-length');
    const logout = await runWithSamlProviderScope({ singleLogout: true }, () =>
      deps.dispatch(
        new Request(logoutUrl, {
          method: 'POST',
          headers,
          body: JSON.stringify(body.callbackURL ? { callbackURL: body.callbackURL } : {}),
        }),
      ),
    );
    const location = logout.headers.get('location');
    if (logout.status >= 300 && logout.status < 400 && location) return signOutAnswer(location, body, logout);
    deps.warn(
      `[sso] Signing out of SAML provider "${providerId}" did not reach the identity provider's single logout (HTTP ${logout.status}); `
        + 'the platform session is ended, the identity provider session is not. Check the provider\'s IdP Logout URL.',
    );
    return run();
  }

  // OIDC: the platform's sign-out runs first, unchanged; its answer then
  // carries the provider's logout URL.
  const accountsBefore = await context.internalAdapter.findAccounts(current.user.id).catch(() => [] as AccountRow[]);
  const answer = await run();
  if (answer.status !== 200) return answer;
  const answered = parseProtocolConfig(await answer.clone().text().catch(() => ''));
  if (typeof answered?.url === 'string' && answered.url) return answer;
  await context.internalAdapter
    .deleteVerificationByIdentifier(`${OIDC_SESSION_BY_ID_PREFIX}${current.session.id}`)
    .catch(() => undefined);
  const row = await readProviderRow(context, started.providerId);
  const oidc = parseProtocolConfig(row?.oidcConfig);
  const endpoint = typeof oidc?.[OIDC_END_SESSION_ENDPOINT_KEY] === 'string' ? (oidc[OIDC_END_SESSION_ENDPOINT_KEY] as string) : '';
  if (!endpoint) {
    deps.warn(
      `[sso] OIDC provider "${started.providerId}" has "sign out of the company sign-in too" on but no stored end_session_endpoint; `
        + 'the platform session is ended, the identity provider session is not. Save the provider\'s sign-in options again to read it from discovery.',
    );
    return answer;
  }
  const account = accountsBefore.find((a) => a.providerId === started!.providerId);
  let url: string;
  try {
    url = oidcEndSessionUrl(endpoint, {
      idToken: account?.idToken,
      clientId: typeof oidc?.clientId === 'string' ? oidc.clientId : undefined,
      postLogoutRedirectUri: trustedPostLogoutUri(context, body.callbackURL),
      state: body.state,
    });
  } catch {
    return answer;
  }
  return signOutAnswer(url, body, answer);
}

// ── Saving the switch on ────────────────────────────────────────────────────

/** A refusal of saving the switch on, as the before-hook throws it. */
export interface SignOutOfIdpRefusal {
  status: 'BAD_REQUEST';
  code: 'VALIDATION_FAILED';
  field: typeof SIGN_OUT_OF_IDP_BODY_KEY;
  message: string;
}

/** What {@link judgeSignOutOfIdpCapability} answers: a refusal, or the OIDC endpoint to keep. */
export type SignOutOfIdpVerdict =
  | { ok: true; endSessionEndpoint?: string }
  | { ok: false; refusal: SignOutOfIdpRefusal };

const refuse = (message: string): SignOutOfIdpVerdict => ({
  ok: false,
  refusal: { status: 'BAD_REQUEST', code: 'VALIDATION_FAILED', field: SIGN_OUT_OF_IDP_BODY_KEY, message },
});

/** The inputs {@link judgeSignOutOfIdpCapability} reads. */
export interface SignOutOfIdpCapabilityInput {
  providerId: string;
  /** The issuer: the body's, else the stored one. */
  issuer?: string;
  /** The stored `samlConfig` / `oidcConfig` (none on a registration). */
  stored?: { samlConfig?: unknown; oidcConfig?: unknown };
  /** The request body's `samlConfig` / `oidcConfig`. */
  body?: { samlConfig?: unknown; oidcConfig?: unknown };
  isTrustedOrigin: (url: string) => boolean;
  /** The discovery fetch (the vendor's `fetchDiscoveryDocument`); injectable for tests. */
  fetchDiscovery?: (url: string, isTrustedOrigin: (url: string) => boolean) => Promise<Record<string, unknown>>;
}

/**
 * Whether a provider can honour "sign out of the company sign-in too": a SAML
 * provider must name its identity provider's logout address; an OIDC
 * provider's discovery document must name an `end_session_endpoint`, which is
 * answered to be kept.
 */
export async function judgeSignOutOfIdpCapability(input: SignOutOfIdpCapabilityInput): Promise<SignOutOfIdpVerdict> {
  const storedSaml = parseProtocolConfig(input.stored?.samlConfig);
  const bodySaml = parseProtocolConfig(input.body?.samlConfig);
  const storedOidc = parseProtocolConfig(input.stored?.oidcConfig);
  const bodyOidc = parseProtocolConfig(input.body?.oidcConfig);
  if (storedSaml || bodySaml) {
    if (samlConfigHasLogoutAddress(bodySaml) || samlConfigHasLogoutAddress(storedSaml)) return { ok: true };
    return refuse(
      `SSO provider "${input.providerId}" names no identity provider logout address, so signing out cannot sign out of the company sign-in. `
        + 'Set its IdP Logout URL ("Edit SAML Settings") first, then turn this on.',
    );
  }
  if (storedOidc || bodyOidc) {
    // The vendor's own discovery helpers, loaded only here (the plugin loads lazily).
    const { computeDiscoveryUrl, fetchDiscoveryDocument, normalizeUrl } = await import('@better-auth/sso');
    const discoveryEndpoint =
      (typeof bodyOidc?.discoveryEndpoint === 'string' && bodyOidc.discoveryEndpoint)
      || (typeof storedOidc?.discoveryEndpoint === 'string' && storedOidc.discoveryEndpoint)
      || (input.issuer ? computeDiscoveryUrl(input.issuer) : '');
    if (!discoveryEndpoint) {
      return refuse(`SSO provider "${input.providerId}" has no issuer or discovery URL to read its logout endpoint from.`);
    }
    const fetchDiscovery =
      input.fetchDiscovery
      ?? (async (url: string, trusted: (u: string) => boolean) =>
        (await fetchDiscoveryDocument(url, undefined, trusted)) as unknown as Record<string, unknown>);
    let document: Record<string, unknown>;
    try {
      document = await fetchDiscovery(discoveryEndpoint, input.isTrustedOrigin);
    } catch (error) {
      return refuse(
        `The discovery document of SSO provider "${input.providerId}" (${discoveryEndpoint}) could not be read to find its logout endpoint, so this was not saved: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
    const raw = document.end_session_endpoint;
    if (typeof raw !== 'string' || raw.trim() === '') {
      return refuse(
        `The identity provider of SSO provider "${input.providerId}" publishes no end_session_endpoint in its discovery document, `
          + 'so signing out cannot sign out of the company sign-in. Leave this off for this provider.',
      );
    }
    let endpoint: string;
    try {
      endpoint = normalizeUrl('end_session_endpoint', raw, input.issuer ?? discoveryEndpoint);
    } catch {
      return refuse(`The end_session_endpoint of SSO provider "${input.providerId}" is not a URL: ${raw}`);
    }
    if (!input.isTrustedOrigin(endpoint)) {
      return refuse(
        `The end_session_endpoint of SSO provider "${input.providerId}" (${endpoint}) is not on an origin this deployment trusts, so it was not saved.`,
      );
    }
    return { ok: true, endSessionEndpoint: endpoint };
  }
  return refuse(`SSO provider "${input.providerId}" has no OIDC or SAML configuration.`);
}

/**
 * Keep the OIDC `end_session_endpoint` the save read in the provider's
 * `oidc_config` blob, through better-auth's own adapter (the read and write
 * path the vendor's own update takes, so the stored client secret is handled
 * as on every vendor write).
 */
export async function parkOidcEndSessionEndpoint(
  context: SignOutAuthContext,
  providerId: string,
  endpoint: string,
): Promise<void> {
  const row = await readProviderRow(context, providerId);
  const config = parseProtocolConfig(row?.oidcConfig);
  if (!config) return;
  if (config[OIDC_END_SESSION_ENDPOINT_KEY] === endpoint) return;
  config[OIDC_END_SESSION_ENDPOINT_KEY] = endpoint;
  await context.adapter.update({
    model: 'ssoProvider',
    where: [{ field: 'providerId', value: providerId }],
    update: { oidcConfig: JSON.stringify(config) },
  });
}
