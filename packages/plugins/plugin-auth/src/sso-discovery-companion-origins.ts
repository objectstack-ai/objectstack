// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Known identity-provider companion origins: hosts a well-known IdP's own
 * OIDC discovery document names for an endpoint, other than the issuer's host.
 *
 * ## The gap
 *
 * `@better-auth/sso` (1.7.12) validates every endpoint of a fetched discovery
 * document against the request's trusted origins (`normalizeDiscoveryUrls`:
 * `discovery_untrusted_origin`). `AuthManager.ssoDiscoveryTrustedOrigins`
 * trusts the origins a `/sso/register` body names (its issuer and any explicit
 * `oidcConfig` endpoint), so an IdP whose endpoints all share the issuer's
 * host registers with no boot configuration. Microsoft Entra ID does not: its
 * discovery document names `userinfo_endpoint` on `graph.microsoft.com`, so
 * every Entra ID registration was refused unless the operator widened the
 * global trusted-origins list (and with it the CSRF allow-list) through
 * `OS_TRUSTED_ORIGINS`.
 *
 * ## What this trusts, and where
 *
 * {@link SSO_DISCOVERY_COMPANION_ORIGINS} is a closed, built-in table keyed by
 * the issuer's host. A companion origin is trusted only:
 *
 * - for a `/sso/register` request whose `issuer` is an `https:` URL on a host
 *   the table names (exact host match, no suffix or wildcard);
 * - only while the vendor's register endpoint runs: the global before-hook
 *   returns it as a per-endpoint context change
 *   ({@link ssoDiscoveryCompanionContext}), which better-auth merges into the
 *   endpoint's own context AFTER its router-level origin check has run. The
 *   CSRF allow-list (the request's `trustedOrigins` function, which that check
 *   reads) never sees it, and no other endpoint does.
 *
 * ⛔ An origin a fetched discovery document names is never trusted because the
 * document names it: an unknown issuer whose discovery points at a foreign
 * userinfo host is still refused. The remedy for any other IdP is the explicit
 * `oidcConfig.userInfoEndpoint` (or the Register SSO Provider bridge's
 * `userInfoEndpoint`), whose origin the request body already makes trusted.
 *
 * Sovereign-cloud Entra hosts are deliberately absent: an entry is added only
 * with the IdP's own documentation of the origin its discovery document names.
 */

/**
 * Issuer host → the origins that IdP's own discovery document names for its
 * endpoints. Microsoft Entra ID (the global service) answers
 * `userinfo_endpoint: https://graph.microsoft.com/oidc/userinfo` for every
 * tenant's `https://login.microsoftonline.com/<tenant>/v2.0` issuer.
 */
export const SSO_DISCOVERY_COMPANION_ORIGINS: Readonly<Record<string, readonly string[]>> = Object.freeze({
  'login.microsoftonline.com': Object.freeze(['https://graph.microsoft.com']),
});

/** The companion origins for one issuer, or none for an issuer the table does not name. */
export function ssoDiscoveryCompanionOrigins(issuer: unknown): readonly string[] {
  if (typeof issuer !== 'string' || issuer.length === 0) return [];
  let url: URL;
  try {
    url = new URL(issuer);
  } catch {
    return [];
  }
  if (url.protocol !== 'https:') return [];
  return Object.prototype.hasOwnProperty.call(SSO_DISCOVERY_COMPANION_ORIGINS, url.hostname)
    ? SSO_DISCOVERY_COMPANION_ORIGINS[url.hostname]!
    : [];
}

/** The vendor endpoint whose discovery validation the table serves. */
export const SSO_REGISTER_PATH = '/sso/register';

/**
 * The before-hook answer for a `/sso/register` request: a context change that
 * adds the issuer's companion origins to the trusted origins the vendor's
 * register endpoint validates its discovery document against, or `undefined`
 * when the issuer has none (the request runs exactly as before).
 *
 * `ctx` is the hook's endpoint context: `ctx.body.issuer` is the request's
 * issuer, `ctx.context.trustedOrigins` the list the request already trusts.
 */
export function ssoDiscoveryCompanionContext(
  ctx: { path?: unknown; body?: unknown; context?: { trustedOrigins?: unknown } } | undefined,
): { context: { context: { trustedOrigins: string[] } } } | undefined {
  if (ctx?.path !== SSO_REGISTER_PATH) return undefined;
  const issuer = (ctx.body as { issuer?: unknown } | undefined)?.issuer;
  const companions = ssoDiscoveryCompanionOrigins(issuer);
  if (companions.length === 0) return undefined;
  const current = Array.isArray(ctx.context?.trustedOrigins)
    ? (ctx.context!.trustedOrigins as unknown[]).filter((o): o is string => typeof o === 'string')
    : [];
  const trustedOrigins = [...current];
  for (const origin of companions) if (!trustedOrigins.includes(origin)) trustedOrigins.push(origin);
  return { context: { context: { trustedOrigins } } };
}

// ── The refusal: name the endpoint, and say how to name it explicitly ───────

/** The vendor's code for a discovery endpoint outside the trusted origins. */
const UNTRUSTED_DISCOVERY_CODE = 'discovery_untrusted_origin';

/**
 * Discovery-document member → the `oidcConfig` member that names it in a
 * registration. A member missing here (`revocation_endpoint`,
 * `end_session_endpoint`, `introspection_endpoint`) cannot be named in a
 * registration.
 */
const REGISTRATION_MEMBER_OF: Readonly<Record<string, string>> = Object.freeze({
  'main discovery endpoint': 'discoveryEndpoint',
  authorization_endpoint: 'authorizationEndpoint',
  token_endpoint: 'tokenEndpoint',
  userinfo_endpoint: 'userInfoEndpoint',
  jwks_uri: 'jwksEndpoint',
});

/** The vendor sentence: `The <member> "<url>" is not trusted by your trusted origins configuration.` */
const UNTRUSTED_SENTENCE = /The ([a-z_ ]+?) "([^"]+)" is not trusted by your trusted origins configuration\./;

/**
 * The vendor's untrusted-endpoint refusal message with the remedy appended:
 * the registration member that names that endpoint explicitly, and that an
 * endpoint the registration names is trusted for it. A message that is not
 * that refusal comes back unchanged.
 */
export function explainUntrustedDiscoveryEndpoint(message: string): string {
  const match = UNTRUSTED_SENTENCE.exec(message);
  if (!match) return message;
  const [, member, url] = match;
  const field = REGISTRATION_MEMBER_OF[member!];
  if (!field) {
    return `${message} A registration cannot name this endpoint, so it is admitted only when the server's `
      + 'trusted origins list its origin.';
  }
  return `${message} To trust it for this provider, name it explicitly in the registration: `
    + `"${field}": "${url}" (oidcConfig.${field} on POST /sso/register; the Register SSO Provider bridge, `
    + 'POST /admin/sso/register, takes userInfoEndpoint and discoveryEndpoint as fields of the same names). '
    + 'An endpoint the registration names is trusted for that registration.';
}

/**
 * After-hook half: a `/sso/register` refused for an untrusted discovery
 * endpoint is answered with the same status and code and the remedy appended
 * to its message ({@link explainUntrustedDiscoveryEndpoint}). Both doors reach
 * it: the vendor's own `/sso/register` and the Register SSO Provider bridge,
 * which re-dispatches there and answers the vendor's message.
 */
export async function explainUntrustedDiscoveryRefusal(ctx: any): Promise<void> {
  if (ctx?.path !== SSO_REGISTER_PATH) return;
  const returned = ctx?.context?.returned;
  const { APIError, isAPIError } = await import('better-auth/api');
  if (!isAPIError(returned)) return;
  const body = returned.body as { code?: unknown; message?: unknown } | undefined;
  if (typeof body?.code !== 'string' || body.code.toLowerCase() !== UNTRUSTED_DISCOVERY_CODE) return;
  if (typeof body.message !== 'string') return;
  const message = explainUntrustedDiscoveryEndpoint(body.message);
  if (message === body.message) return;
  throw new APIError('BAD_REQUEST', { code: body.code, message });
}
