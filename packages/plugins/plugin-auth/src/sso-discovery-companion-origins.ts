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
 * names the origins a `/sso/register` body names (its issuer and any explicit
 * `oidcConfig` endpoint), trusted for the discovery validation the same way as
 * a companion origin (below), so an IdP whose endpoints all share the issuer's
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
 *   endpoint's own context AFTER its router-level origin check has run. That
 *   check reads the deployment's configured trusted origins alone and never
 *   sees it, and no other endpoint does.
 *
 * The origins a register or update body names follow the same rule: an
 * origin taken from that body is trusted only for the server-side discovery
 * fetch and validation of that provider, and never becomes an accepted
 * `Origin` for the request's own origin check. Two readers take them:
 *
 * - the vendor's `/sso/register` discovery and endpoint validation, through
 *   the same per-endpoint context change as a companion origin;
 * - the sign-out capability check on `/sso/register` and
 *   `/sso/update-provider` (`AuthManager.assertSsoSignOutOfIdpSupported`):
 *   its verdict on the provider's logout endpoint alone, through
 *   {@link trustingBodyNamedOrigins}. The discovery document it reads to
 *   find that endpoint is fetched under the configured trust.
 *
 * The vendor's `/sso/update-provider` itself fetches no discovery document,
 * and its endpoint validation admits any public host on its own, so it reads
 * none of them.
 *
 * That trust covers origin verdicts only. SSO discovery fetches only hosts
 * that resolve to public addresses: the host a registration's discovery reads
 * is resolved before the vendor's register endpoint runs, and the body-named
 * origins are handed to it only after that check, for an actor the register
 * gates admitted ({@link refuseSsoDiscoveryHostNotPublic}).
 *
 * ⛔ An origin a fetched discovery document names is never trusted because the
 * document names it: an unknown issuer whose discovery points at a foreign
 * userinfo host is still refused. The remedy for any other IdP is the explicit
 * `oidcConfig` endpoint (`userInfoEndpoint`, `tokenEndpoint`, `jwksEndpoint`,
 * `authorizationEndpoint`; the Register SSO Provider bridge takes each as a
 * field of the same name), whose origin the request body already makes trusted.
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
 * adds the origins the body names and the issuer's companion origins to the
 * trusted origins the vendor's register endpoint validates its discovery
 * document against, or `undefined` when there are none (the request runs
 * exactly as before).
 *
 * `ctx` is the hook's endpoint context: `ctx.body.issuer` is the request's
 * issuer, `ctx.context.trustedOrigins` the list the request already trusts.
 * `bodyOrigins` is `AuthManager.ssoDiscoveryTrustedOrigins` of that body.
 */
export function ssoDiscoveryCompanionContext(
  ctx: { path?: unknown; body?: unknown; context?: { trustedOrigins?: unknown } } | undefined,
  bodyOrigins: readonly string[] = [],
): { context: { context: { trustedOrigins: string[] } } } | undefined {
  if (ctx?.path !== SSO_REGISTER_PATH) return undefined;
  const issuer = (ctx.body as { issuer?: unknown } | undefined)?.issuer;
  const companions = [...bodyOrigins, ...ssoDiscoveryCompanionOrigins(issuer)];
  if (companions.length === 0) return undefined;
  const current = Array.isArray(ctx.context?.trustedOrigins)
    ? (ctx.context!.trustedOrigins as unknown[]).filter((o): o is string => typeof o === 'string')
    : [];
  const trustedOrigins = [...current];
  for (const origin of companions) if (!trustedOrigins.includes(origin)) trustedOrigins.push(origin);
  return { context: { context: { trustedOrigins } } };
}

/**
 * A trusted-origin predicate for a validation of the provider a register or
 * update body names: the request's own predicate, and also the
 * origins that body names (`AuthManager.ssoDiscoveryTrustedOrigins`), matched
 * exactly, as the vendor matches a plain origin. ⛔ Only for such a
 * validation: the request's origin check never takes it.
 */
export function trustingBodyNamedOrigins(
  isTrustedOrigin: (url: string) => boolean,
  bodyOrigins: readonly string[],
): (url: string) => boolean {
  if (bodyOrigins.length === 0) return isTrustedOrigin;
  return (url) => {
    if (isTrustedOrigin(url)) return true;
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return false;
    }
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return false;
    return bodyOrigins.includes(parsed.origin);
  };
}

// ── The host a registration's discovery reads resolves to public addresses ──

/** A name resolver: every address a host name resolves to. */
export type SsoHostResolver = (hostname: string) => Promise<ReadonlyArray<{ address: string }>>;

/** `node:dns/promises` `lookup` for every address, read when called; none on a runtime without it. */
async function systemResolver(): Promise<SsoHostResolver | undefined> {
  try {
    const dns = await import('node:dns/promises');
    return (hostname) => dns.lookup(hostname, { all: true });
  } catch {
    return undefined;
  }
}

/** The body member naming the URL a registration's discovery reads. */
export type SsoDiscoveryReadMember = 'issuer' | 'oidcConfig.discoveryEndpoint';

/**
 * The URL a `/sso/register` body has the vendor's register endpoint read
 * server-side, and the member that names it: the OIDC discovery document, at
 * the explicit `oidcConfig.discoveryEndpoint`, else at the issuer's well-known
 * URL (`computeDiscoveryUrl`, the vendor's own). `undefined` when the
 * registration reads none: no `oidcConfig` (a SAML registration), or
 * `oidcConfig.skipDiscovery`. The vendor's register endpoint makes no other
 * server-side read (`@better-auth/sso` 1.7.12 `discoverOIDCConfig`). With
 * `signOutOfIdp` on, the register door's sign-out check
 * (`assertSsoSignOutOfIdpSupported`) reads the same document first, under the
 * configured trust only, and only after {@link refuseSsoDiscoveryHostNotPublic}
 * has admitted its host.
 */
export function ssoRegisterDiscoveryRead(
  body: unknown,
  computeDiscoveryUrl: (issuer: string) => string,
): { member: SsoDiscoveryReadMember; url: string } | undefined {
  if (!body || typeof body !== 'object') return undefined;
  const oidc = (body as { oidcConfig?: unknown }).oidcConfig;
  if (!oidc || typeof oidc !== 'object') return undefined;
  if ((oidc as { skipDiscovery?: unknown }).skipDiscovery === true) return undefined;
  const explicit = (oidc as { discoveryEndpoint?: unknown }).discoveryEndpoint;
  if (typeof explicit === 'string' && explicit.length > 0) return { member: 'oidcConfig.discoveryEndpoint', url: explicit };
  const issuer = (body as { issuer?: unknown }).issuer;
  if (typeof issuer === 'string' && issuer.length > 0) return { member: 'issuer', url: computeDiscoveryUrl(issuer) };
  return undefined;
}

/** The refusal {@link refuseSsoDiscoveryHostNotPublic} answers. */
export interface SsoDiscoveryHostRefusal {
  status: 'BAD_REQUEST';
  code: 'VALIDATION_FAILED';
  field: SsoDiscoveryReadMember;
  message: string;
}

/**
 * SSO discovery fetches only hosts that resolve to public addresses.
 *
 * The host whose discovery document a `/sso/register` body has the server
 * read ({@link ssoRegisterDiscoveryRead}) is resolved here, before the
 * vendor's register endpoint runs, and every address it resolves to must be
 * public (`isPublicRoutableHost`, the predicate the vendor's own checks
 * apply). The origins the body names are trusted for the origin verdicts of
 * that registration's discovery (`ssoDiscoveryCompanionContext`); that trust
 * never stands in for this check. The deployment's configured trusted origins
 * stay the one way to register an identity provider on an internal network:
 * a discovery URL they trust is not resolved here, as the vendor resolves none.
 *
 * Judged as the vendor judges its own resolution: an address literal is left
 * to the vendor's synchronous host check, a name that looks non-public
 * (`localhost`, a metadata name) to its refusal of an untrusted or private
 * host, and a name that does not resolve, or a runtime with no
 * `node:dns/promises`, to the read itself. Answers the refusal, or
 * `undefined` when the registration may go on; it reads `body` only.
 */
export async function refuseSsoDiscoveryHostNotPublic(input: {
  body: unknown;
  /** The deployment's configured trusted-origin predicate (the request's, before any body-named origin joins it). */
  isConfiguredTrusted: (url: string) => boolean;
  /** Name resolution; `node:dns/promises` when absent. */
  resolve?: SsoHostResolver;
}): Promise<SsoDiscoveryHostRefusal | undefined> {
  const { computeDiscoveryUrl } = await import('@better-auth/sso');
  const read = ssoRegisterDiscoveryRead(input.body, computeDiscoveryUrl);
  if (!read) return undefined;
  let url: URL;
  try {
    url = new URL(read.url);
  } catch {
    return undefined;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return undefined;
  const { classifyHost, isPublicRoutableHost } = await import('@better-auth/core/utils/host');
  const host = url.hostname;
  if (classifyHost(host).literal !== 'fqdn' || !isPublicRoutableHost(host)) return undefined;
  if (input.isConfiguredTrusted(url.href)) return undefined;
  const resolve = input.resolve ?? (await systemResolver());
  if (!resolve) return undefined;
  let addresses: ReadonlyArray<{ address: string }>;
  try {
    addresses = await resolve(host);
  } catch {
    return undefined;
  }
  if (addresses.every(({ address }) => isPublicRoutableHost(address))) return undefined;
  return {
    status: 'BAD_REQUEST',
    code: 'VALIDATION_FAILED',
    field: read.member,
    message:
      `The host "${host}" that ${read.member} names for this provider's discovery document resolves to an address that is not public, `
      + 'so the document was not read and the provider was not registered. SSO discovery reads only hosts that resolve to public addresses; '
      + `an identity provider on an internal network registers once the deployment's trusted origins (OS_TRUSTED_ORIGINS) list its origin, ${url.origin}.`,
  };
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
    + `POST /admin/sso/register, takes it as the field "${field}"). `
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
