// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Shared `register-sso-provider` (form) handler.
 *
 * `@better-auth/sso`'s `POST /sso/register` expects the OIDC protocol fields
 * NESTED under `oidcConfig` ({ clientId, clientSecret, discoveryEndpoint,
 * scopes, mapping }). The `sys_sso_provider` `register_sso_provider` UI action
 * collects FLAT form fields (the action param schema has no nested-path
 * support), so posting them straight to `/sso/register` drops
 * clientId/clientSecret at the top level (Zod-stripped) and persists an
 * unusable `oidc_config = null` provider that can never complete a login
 * (ADR-0024).
 *
 * This helper reshapes the flat form body into the nested shape and
 * RE-DISPATCHES it through the real `/sso/register` endpoint (via the
 * better-auth universal handler passed in) so the admin gate, the
 * public-routable `trustedOrigins` allowance, discovery hydration, and secret
 * handling all still run — no logic is duplicated. It is the single source of
 * truth for the two mount points that must stay in lockstep: the full
 * `AuthPlugin` (self-host / OSS host kernel) and the cloud `AuthProxyPlugin`
 * (per-environment runtime) — mirroring `runSetInitialPassword`.
 */

export interface RegisterSsoFormResult {
  /** HTTP status to return to the caller. */
  status: number;
  /** JSON body; mirrors the `{ success, data?, error? }` envelope the client parses. */
  body: {
    success: boolean;
    data?: { providerId: string };
    error?: { code: string; message: string };
  };
}

/** A better-auth universal handler: `(request) => Response`. */
export type AuthRequestHandler = (request: Request) => Promise<Response>;

/**
 * Resolve the caller's active organization id by re-dispatching a
 * `/get-session` through the same better-auth handler. Returns `undefined` on
 * any failure / when no active org is set — callers fall back to an org-less
 * (registrar-only) provider, so this is strictly best-effort. `registerUrl` is
 * the resolved `…/sso/register` URL; we swap the trailing path for
 * `…/get-session` on the same origin/basePath.
 */
async function resolveActiveOrganizationId(
  handle: AuthRequestHandler,
  registerUrl: string,
  headers: Headers,
): Promise<string | undefined> {
  try {
    const sessionUrl = registerUrl.replace(/\/sso\/register$/, '/get-session');
    if (sessionUrl === registerUrl) return undefined;
    const h = new Headers({ accept: 'application/json' });
    const cookie = headers.get('cookie');
    if (cookie) h.set('cookie', cookie);
    const authz = headers.get('authorization');
    if (authz) h.set('authorization', authz);
    const resp = await handle(new Request(sessionUrl, { method: 'GET', headers: h }));
    if (!resp.ok) return undefined;
    const data: any = await resp.json().catch(() => null);
    const org = data?.session?.activeOrganizationId ?? data?.activeOrganizationId;
    return typeof org === 'string' && org.length > 0 ? org : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Reshape a flat SSO-provider registration form body and register it.
 *
 * @param handle  the better-auth universal handler (`AuthManager.handleRequest`
 *                on the host kernel, or the resolved per-env handler in the
 *                cloud proxy). Used to re-dispatch the nested body to the real
 *                `/sso/register` route so all of its gates run.
 * @param request the raw Web `Request` — its headers carry the caller's session
 *                cookie / bearer + Origin; its body carries the flat form
 *                fields ({ providerId, issuer, domain, clientId, clientSecret,
 *                discoveryEndpoint?, scopes?, mapId?, mapEmail?, mapName? }).
 *                `mapId` is accepted only as the (empty or `sub`) no-op it now
 *                is — see the mapping block below.
 */
export async function runRegisterSsoProviderFromForm(
  handle: AuthRequestHandler,
  request: Request,
): Promise<RegisterSsoFormResult> {
  let body: any;
  try {
    body = await request.json();
  } catch {
    body = {};
  }
  const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
  const providerId = str(body?.providerId);
  const issuer = str(body?.issuer);
  const domain = str(body?.domain);
  const clientId = str(body?.clientId);
  const clientSecret = str(body?.clientSecret);
  const discoveryEndpoint = str(body?.discoveryEndpoint);
  const scopesRaw = str(body?.scopes);

  const missing = (
    [
      ['providerId', providerId],
      ['issuer', issuer],
      ['domain', domain],
      ['clientId', clientId],
      ['clientSecret', clientSecret],
    ] as const
  )
    .filter(([, v]) => !v)
    .map(([k]) => k);
  if (missing.length) {
    return {
      status: 400,
      body: { success: false, error: { code: 'INVALID_REQUEST', message: `Missing required field(s): ${missing.join(', ')}` } },
    };
  }

  const oidcConfig: Record<string, unknown> = { clientId, clientSecret };
  if (discoveryEndpoint) oidcConfig.discoveryEndpoint = discoveryEndpoint;
  oidcConfig.scopes = scopesRaw ? scopesRaw.split(/[\s,]+/).filter(Boolean) : ['openid', 'email', 'profile'];

  // `oidcConfig.mapping` is a `z.strictObject` in `@better-auth/sso@1.7.0-rc.2`
  // (dist/index.mjs, `oidcMappingSchema`): members { email, emailVerified?,
  // name, image?, extraFields? }, with `email` and `name` REQUIRED and NO `id`
  // member. Emitting `id` is therefore a hard 400 on EVERY registration:
  //   [body.oidcConfig.mapping] Unrecognized key: "id"
  //
  // `id` is not a key that moved — it was RETIRED upstream, so there is nowhere
  // to re-home it. 1.6.20 declared the mapping as a plain (non-strict)
  // `z.object` that DID carry `id`, and honoured it at login
  // (`id: rawUserInfo[mapping.id || "sub"]`). 1.7.0-rc.2 deletes the member and
  // hard-wires the federated subject to the OIDC `sub` claim
  // (`id: readStringClaim(rawUserInfo, "sub")` / `id: idToken.sub`), then
  // cross-checks it (`id_token_subject_missing`,
  // `id_token_userinfo_subject_mismatch`). `extraFields` is NOT a substitute:
  // it parses, but it is spread BEFORE `id` in the profile literal, so an
  // `extraFields.id` is silently overwritten by `sub` — a no-op that reads as
  // configured. The subject claim is simply not configurable any more, so a
  // caller that asks for a different one is told so instead of being ignored.
  const mapId = str(body?.mapId);
  if (mapId && mapId !== 'sub') {
    return {
      status: 400,
      body: {
        success: false,
        error: {
          code: 'INVALID_REQUEST',
          message:
            'The user ID claim is not configurable: the federated subject is always read from the OIDC "sub" claim. Leave the user-ID claim mapping empty (or set it to "sub").',
        },
      },
    };
  }
  oidcConfig.mapping = {
    email: str(body?.mapEmail) || 'email',
    name: str(body?.mapName) || 'name',
  };

  // Re-dispatch to the real /sso/register (same origin, sibling path) so the
  // admin gate + public-IdP trustedOrigins allowance + discovery hydration run.
  let innerUrl: string;
  let origin: string;
  try {
    const url = new URL(request.url);
    origin = url.origin;
    innerUrl = `${origin}${url.pathname.replace(/\/admin\/sso\/register$/, '/sso/register')}`;
  } catch {
    return { status: 400, body: { success: false, error: { code: 'INVALID_REQUEST', message: 'Bad request URL' } } };
  }
  const headers = new Headers({ 'content-type': 'application/json' });
  const cookie = request.headers.get('cookie');
  if (cookie) headers.set('cookie', cookie);
  const authz = request.headers.get('authorization');
  if (authz) headers.set('authorization', authz);
  headers.set('origin', request.headers.get('origin') || origin);

  // Org-scope the provider to the caller's active organization (best-effort).
  // `@better-auth/sso`'s management endpoints (delete / update / domain
  // verification) gate org-scoped providers on `isOrgAdmin` but gate ORG-LESS
  // ones on `provider.userId === caller` — i.e. only the original registrar can
  // manage them. Scoping to the org means ANY org owner/admin can manage the
  // env's IdPs (the env is single-org in V1). Resolved by re-dispatching a
  // `/get-session` through the same handler; falls back to org-less (no
  // regression) when no active org is set.
  const organizationId = await resolveActiveOrganizationId(handle, innerUrl, headers);

  const innerReq = new Request(innerUrl, {
    method: 'POST',
    headers,
    body: JSON.stringify({ providerId, issuer, domain, oidcConfig, ...(organizationId ? { organizationId } : {}) }),
  });

  const resp = await handle(innerReq);
  let parsed: any = {};
  try {
    const t = await resp.text();
    parsed = t ? JSON.parse(t) : {};
  } catch {
    parsed = {};
  }
  if (!resp.ok) {
    return {
      status: resp.status,
      body: { success: false, error: { code: 'SSO_REGISTER_FAILED', message: parsed?.message || 'SSO provider registration failed' } },
    };
  }
  return { status: 200, body: { success: true, data: { providerId: parsed?.providerId ?? providerId } } };
}


/**
 * ADR-0069 P3 — SAML 2.0 sibling of {@link runRegisterSsoProviderFromForm}.
 *
 * `@better-auth/sso` (samlify-backed) registers a SAML IdP via the SAME
 * `/sso/register` endpoint, with the protocol fields nested under `samlConfig`
 * ({ entryPoint, cert, callbackUrl, identifierFormat? }) instead of `oidcConfig`.
 * The UI action collects FLAT fields; this helper reshapes them, derives the
 * per-provider ACS callback URL (`/sso/saml2/sp/acs/<providerId>`), and
 * re-dispatches through `/sso/register` so the admin gate + provisioning run.
 * Returns the SP ACS + metadata URLs the admin must configure on the IdP.
 */
export async function runRegisterSamlProviderFromForm(
  handle: AuthRequestHandler,
  request: Request,
): Promise<RegisterSsoFormResult & { body: RegisterSsoFormResult['body'] & { acsUrl?: string; spMetadataUrl?: string } }> {
  let body: any;
  try { body = await request.json(); } catch { body = {}; }
  const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
  const providerId = str(body?.providerId);
  const issuer = str(body?.issuer);
  const domain = str(body?.domain);
  const entryPoint = str(body?.entryPoint);
  const cert = str(body?.cert);
  const identifierFormat = str(body?.identifierFormat);

  const missing = (
    [
      ['providerId', providerId],
      ['issuer', issuer],
      ['domain', domain],
      ['entryPoint', entryPoint],
      ['cert', cert],
    ] as const
  ).filter(([, v]) => !v).map(([k]) => k);
  if (missing.length) {
    return { status: 400, body: { success: false, error: { code: 'INVALID_REQUEST', message: `Missing required field(s): ${missing.join(', ')}` } } };
  }

  let origin: string;
  let prefix: string;
  let innerUrl: string;
  try {
    const url = new URL(request.url);
    origin = url.origin;
    prefix = url.pathname.replace(/\/admin\/sso\/register-saml$/, '');
    innerUrl = `${origin}${prefix}/sso/register`;
  } catch {
    return { status: 400, body: { success: false, error: { code: 'INVALID_REQUEST', message: 'Bad request URL' } } };
  }
  const acsUrl = `${origin}${prefix}/sso/saml2/sp/acs/${encodeURIComponent(providerId)}`;
  const spMetadataUrl = `${origin}${prefix}/sso/saml2/sp/metadata?providerId=${encodeURIComponent(providerId)}`;

  const samlConfig: Record<string, unknown> = {
    entryPoint,
    cert,
    callbackUrl: acsUrl,
    // better-auth requires an SP descriptor (its inner fields are optional). Use
    // the SP metadata URL as our EntityID — the value the IdP keys this SP on.
    spMetadata: { entityID: spMetadataUrl },
  };
  if (identifierFormat) samlConfig.identifierFormat = identifierFormat;

  const headers = new Headers({ 'content-type': 'application/json' });
  const cookie = request.headers.get('cookie');
  if (cookie) headers.set('cookie', cookie);
  const authz = request.headers.get('authorization');
  if (authz) headers.set('authorization', authz);
  headers.set('origin', request.headers.get('origin') || origin);

  // Org-scope to the caller's active org (best-effort) so any org owner/admin
  // can manage the provider — see the OIDC helper above.
  const organizationId = await resolveActiveOrganizationId(handle, innerUrl, headers);

  const innerReq = new Request(innerUrl, {
    method: 'POST',
    headers,
    body: JSON.stringify({ providerId, issuer, domain, samlConfig, ...(organizationId ? { organizationId } : {}) }),
  });
  const resp = await handle(innerReq);
  let parsed: any = {};
  try { const t = await resp.text(); parsed = t ? JSON.parse(t) : {}; } catch { parsed = {}; }
  if (!resp.ok) {
    return { status: resp.status, body: { success: false, error: { code: 'SAML_REGISTER_FAILED', message: parsed?.message || 'SAML provider registration failed' } } };
  }
  return { status: 200, body: { success: true, data: { providerId: parsed?.providerId ?? providerId }, acsUrl, spMetadataUrl } };
}


// ── Domain verification (ADR-0024 ②, opt-in OS_SSO_DOMAIN_VERIFICATION) ──────
//
// `@better-auth/sso` proves an external IdP's email DOMAIN is controlled by the
// registrant via a DNS-TXT challenge, mounted ONLY when `domainVerification` is
// enabled on `sso()`. The two endpoints are:
//   • POST /sso/request-domain-verification {providerId} → 201 {domainVerificationToken}
//   • POST /sso/verify-domain {providerId}               → 204 (or 502 if the TXT
//     record is absent / not yet propagated)
// The token alone is not actionable — the admin needs the full DNS record
// (name `_better-auth-token-<providerId>.<domain>`, value
// `_better-auth-token-<providerId>=<token>`; the prefix is @better-auth/sso's
// default `tokenPrefix`, which we do not override). These bridges re-dispatch
// through the real endpoints (so the per-provider admin gate runs) and reshape
// the response into the `{ success, data }` envelope the action `resultDialog`
// reads — request returns the ready-to-paste DNS record; verify returns a
// friendly success/error message. A `404` from the inner endpoint means the
// feature is OFF for this env (endpoints unmounted) → surfaced as such, not a
// bare "not found".

/** @better-auth/sso default verification token prefix (we don't override `tokenPrefix`). */
const SSO_DOMAIN_TOKEN_PREFIX = 'better-auth-token';

/**
 * Strip protocol / path / port so `https://acme.com/` → `acme.com` for the DNS
 * record. Regex-free on purpose — `domain` is request-controlled input, so a
 * backtracking pattern here would be a ReDoS vector (CodeQL js/polynomial-redos).
 */
function bareHostname(domain: string): string {
  let d = domain.trim();
  if (!d) return d;
  const schemeIdx = d.indexOf('://');
  if (schemeIdx !== -1) {
    try {
      return new URL(d).hostname;
    } catch {
      d = d.slice(schemeIdx + 3); // malformed URL — drop the scheme and strip manually
    }
  }
  // Truncate at the first path / port / query / fragment separator.
  for (const sep of ['/', ':', '?', '#']) {
    const i = d.indexOf(sep);
    if (i !== -1) d = d.slice(0, i);
  }
  return d;
}

function rewriteSsoAdminUrl(request: Request, fromSuffix: RegExp, toPath: string): { innerUrl: string; origin: string } | null {
  try {
    const url = new URL(request.url);
    return { origin: url.origin, innerUrl: `${url.origin}${url.pathname.replace(fromSuffix, toPath)}` };
  } catch {
    return null;
  }
}

function forwardAuthHeaders(request: Request, origin: string): Headers {
  const headers = new Headers({ 'content-type': 'application/json' });
  const cookie = request.headers.get('cookie');
  if (cookie) headers.set('cookie', cookie);
  const authz = request.headers.get('authorization');
  if (authz) headers.set('authorization', authz);
  headers.set('origin', request.headers.get('origin') || origin);
  return headers;
}

/**
 * Request a DNS-TXT domain-verification challenge for a registered provider and
 * return the ready-to-paste DNS record (for a one-shot `resultDialog`).
 *
 * Body: `{ providerId, domain? }` (domain only shapes the displayed record name).
 */
export async function runRequestDomainVerification(
  handle: AuthRequestHandler,
  request: Request,
): Promise<RegisterSsoFormResult & { body: RegisterSsoFormResult['body'] & { data?: any } }> {
  let body: any;
  try { body = await request.json(); } catch { body = {}; }
  const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
  const providerId = str(body?.providerId);
  const domain = bareHostname(str(body?.domain));
  if (!providerId) {
    return { status: 400, body: { success: false, error: { code: 'INVALID_REQUEST', message: 'Missing required field: providerId' } } };
  }

  const rw = rewriteSsoAdminUrl(request, /\/admin\/sso\/request-domain-verification$/, '/sso/request-domain-verification');
  if (!rw) return { status: 400, body: { success: false, error: { code: 'INVALID_REQUEST', message: 'Bad request URL' } } };
  const headers = forwardAuthHeaders(request, rw.origin);

  const resp = await handle(new Request(rw.innerUrl, { method: 'POST', headers, body: JSON.stringify({ providerId }) }));
  let parsed: any = {};
  try { const t = await resp.text(); parsed = t ? JSON.parse(t) : {}; } catch { parsed = {}; }
  if (!resp.ok) {
    if (resp.status === 404 && !parsed?.code) {
      return { status: 400, body: { success: false, error: { code: 'DOMAIN_VERIFICATION_DISABLED', message: 'Domain verification is not enabled for this environment (set OS_SSO_DOMAIN_VERIFICATION).' } } };
    }
    return { status: resp.status, body: { success: false, error: { code: parsed?.code || 'request_domain_verification_failed', message: parsed?.message || 'Failed to request domain verification' } } };
  }

  const token = str(parsed?.domainVerificationToken);
  const label = `_${SSO_DOMAIN_TOKEN_PREFIX}-${providerId}`;
  const dnsRecordName = domain ? `${label}.${domain}` : label;
  const dnsRecordValue = `${label}=${token}`;
  return {
    status: 200,
    body: {
      success: true,
      data: { providerId, domain, token, dnsRecordType: 'TXT', dnsRecordName, dnsRecordValue },
    },
  };
}

/**
 * Verify a provider's domain ownership (re-checks the DNS-TXT record). Reshapes
 * @better-auth/sso's empty `204` / `502` into a `{ success, data:{ message } }`
 * envelope so the action surfaces a clear toast.
 *
 * Body: `{ providerId }`.
 */
export async function runVerifyDomain(
  handle: AuthRequestHandler,
  request: Request,
): Promise<RegisterSsoFormResult & { body: RegisterSsoFormResult['body'] & { data?: any } }> {
  let body: any;
  try { body = await request.json(); } catch { body = {}; }
  const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
  const providerId = str(body?.providerId);
  if (!providerId) {
    return { status: 400, body: { success: false, error: { code: 'INVALID_REQUEST', message: 'Missing required field: providerId' } } };
  }

  const rw = rewriteSsoAdminUrl(request, /\/admin\/sso\/verify-domain$/, '/sso/verify-domain');
  if (!rw) return { status: 400, body: { success: false, error: { code: 'INVALID_REQUEST', message: 'Bad request URL' } } };
  const headers = forwardAuthHeaders(request, rw.origin);

  const resp = await handle(new Request(rw.innerUrl, { method: 'POST', headers, body: JSON.stringify({ providerId }) }));
  let parsed: any = {};
  try { const t = await resp.text(); parsed = t ? JSON.parse(t) : {}; } catch { parsed = {}; }
  if (resp.ok) {
    return { status: 200, body: { success: true, data: { providerId, verified: true, message: 'Domain ownership verified — this provider can now sign users in.' } } };
  }
  // Friendlier copy for the expected failure modes.
  let message = parsed?.message || 'Domain verification failed';
  if (resp.status === 404 && !parsed?.code) {
    message = 'Domain verification is not enabled for this environment (set OS_SSO_DOMAIN_VERIFICATION).';
  } else if (parsed?.code === 'NO_PENDING_VERIFICATION') {
    message = 'No pending verification — click “Request Domain Verification” first to get the DNS record.';
  } else if (parsed?.code === 'DOMAIN_VERIFICATION_FAILED') {
    message = 'DNS TXT record not found yet. Add the record shown when you requested verification, allow time for DNS to propagate, then retry.';
  }
  return { status: resp.status, body: { success: false, error: { code: parsed?.code || 'verify_domain_failed', message } } };
}
