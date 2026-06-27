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
      body: { success: false, error: { code: 'invalid_request', message: `Missing required field(s): ${missing.join(', ')}` } },
    };
  }

  const oidcConfig: Record<string, unknown> = { clientId, clientSecret };
  if (discoveryEndpoint) oidcConfig.discoveryEndpoint = discoveryEndpoint;
  oidcConfig.scopes = scopesRaw ? scopesRaw.split(/[\s,]+/).filter(Boolean) : ['openid', 'email', 'profile'];
  oidcConfig.mapping = {
    id: str(body?.mapId) || 'sub',
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
    return { status: 400, body: { success: false, error: { code: 'invalid_request', message: 'Bad request URL' } } };
  }
  const headers = new Headers({ 'content-type': 'application/json' });
  const cookie = request.headers.get('cookie');
  if (cookie) headers.set('cookie', cookie);
  const authz = request.headers.get('authorization');
  if (authz) headers.set('authorization', authz);
  headers.set('origin', request.headers.get('origin') || origin);

  const innerReq = new Request(innerUrl, {
    method: 'POST',
    headers,
    body: JSON.stringify({ providerId, issuer, domain, oidcConfig }),
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
      body: { success: false, error: { code: 'sso_register_failed', message: parsed?.message || 'SSO provider registration failed' } },
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
    return { status: 400, body: { success: false, error: { code: 'invalid_request', message: `Missing required field(s): ${missing.join(', ')}` } } };
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
    return { status: 400, body: { success: false, error: { code: 'invalid_request', message: 'Bad request URL' } } };
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

  const innerReq = new Request(innerUrl, {
    method: 'POST',
    headers,
    body: JSON.stringify({ providerId, issuer, domain, samlConfig }),
  });
  const resp = await handle(innerReq);
  let parsed: any = {};
  try { const t = await resp.text(); parsed = t ? JSON.parse(t) : {}; } catch { parsed = {}; }
  if (!resp.ok) {
    return { status: resp.status, body: { success: false, error: { code: 'saml_register_failed', message: parsed?.message || 'SAML provider registration failed' } } };
  }
  return { status: 200, body: { success: true, data: { providerId: parsed?.providerId ?? providerId }, acsUrl, spMetadataUrl } };
}
