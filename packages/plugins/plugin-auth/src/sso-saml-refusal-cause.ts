// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Why a SAML sign-in was refused: a named cause in place of the vendor's
 * opaque `Invalid SAML response` (#32086).
 *
 * ## The gap
 *
 * `@better-auth/sso` (1.7.12, `processSAMLResponse`) wraps samlify's
 * `parseLoginResponse` in a bare `catch`: whatever samlify rejected, the vendor
 * logs `SAML response validation failed` with no detail and answers
 * `error=saml_error&error_description=Invalid SAML response`. Every one of the
 * common IdP misconfigurations lands there with the same words: a rotated IdP
 * signing certificate, an IdP that answered a failure status (Entra ID's "user
 * is not assigned to the application"), an unsigned response, a wrong IdP
 * entity id. The administrator cannot tell them apart without a debugger.
 *
 * ## The diagnosis
 *
 * After the vendor has refused (the decision is never this module's), the
 * posted `SAMLResponse` is read once more, against the provider's stored
 * configuration, in samlify's own order (2.13.1, `flow.js` `postFlow` and
 * `libsaml.js` `verifySignature`). The first check that fails names the cause:
 *
 *  1. `saml_idp_status_not_success`: the Response's top-level `StatusCode` is
 *     present and is not `urn:oasis:names:tc:SAML:2.0:status:Success`
 *     (samlify `checkStatus`, which runs before any signature check).
 *  2. `saml_response_unsigned`: no `Signature` on the Response nor on its
 *     Assertion, and no `EncryptedAssertion` (whose inner signature cannot be
 *     seen without the SP's key).
 *  3. `saml_signing_certificate_mismatch`: the first signature samlify checks
 *     embeds an `X509Certificate` that is not one of the configured IdP signing
 *     certificates, both normalised as samlify normalises them. samlify throws
 *     `ERROR_UNMATCH_CERTIFICATE_DECLARATION_IN_METADATA` on exactly this, before
 *     any cryptography; it is what an IdP certificate rotation looks like.
 *  4. `saml_issuer_mismatch`: that certificate IS configured, and the
 *     Assertion's `Issuer` is not the configured IdP entity id (samlify
 *     `ERR_UNMATCH_ISSUER`). Without verifying the signature this cannot be
 *     told from "configured certificate, broken signature, wrong issuer"; an
 *     IdP holding the configured key signs validly, so the label is the right
 *     one in practice.
 *
 * Anything else — XML the vendor's own validator rejects, a missing status,
 * a signature without an embedded certificate, an encrypted assertion, a
 * response whose certificate and issuer both match (a broken signature, an
 * expired assertion) — is left unclassified: the vendor's answer stands as it
 * wrote it. No cryptography, no accept decision: a cause is a reading of what
 * the IdP sent next to what the provider is configured with.
 *
 * ## What stays out, on purpose
 *
 * - `error=` stays `saml_error`: consumers (the console's sign-in error
 *   sentence) branch on it. Only `error_description` changes, from
 *   `Invalid SAML response` to the cause token.
 * - The redirect and the log line carry the cause token and the provider id,
 *   nothing else: no assertion content, no subject or email, no certificate.
 *   The diagnosis reads only the response envelope and compares it with the
 *   IdP's signing certificate and entity id, which are public by nature (they
 *   are in the IdP's metadata). It runs on what the IdP posted, before any user
 *   lookup, so the answer is the same for every account.
 * - The vendor's own `SAML response validation failed` line is left as the
 *   vendor wrote it; the cause is one more `warn` line beside it.
 *
 * The tokens are lowercase `error_description` values in the vendor's dialect
 * for that slot, as the OIDC causes are (`sso-oidc-refusal-cause.ts`), not
 * ADR-0112 `error.code` members. Documented in
 * `content/docs/permissions/sso.mdx` ("Why a SAML sign-in was refused").
 */

import { XMLParser, XMLValidator } from 'fast-xml-parser';
import type { SsoRefusalHostLogger } from './sso-oidc-refusal-cause.js';

/** The closed list of SAML refusal causes, in the order they are checked. */
export const SSO_SAML_REFUSAL_CAUSES = [
  'saml_idp_status_not_success',
  'saml_response_unsigned',
  'saml_signing_certificate_mismatch',
  'saml_issuer_mismatch',
] as const;

export type SsoSamlRefusalCause = (typeof SSO_SAML_REFUSAL_CAUSES)[number];

/** The vendor's `error=` on the opaque refusal, which this module never changes. */
const OPAQUE_REFUSAL_ERROR = 'saml_error';

/** The vendor's `error_description` on the opaque refusal: the one value replaced. */
export const SSO_SAML_UNCLASSIFIED_REFUSAL = 'Invalid SAML response';

const SAML_STATUS_SUCCESS = 'urn:oasis:names:tc:SAML:2.0:status:Success';

/**
 * The parser options `@better-auth/sso` reads SAML XML with (its
 * `saml/parser.ts`): namespace prefixes dropped, attributes kept, and no entity
 * expansion.
 */
const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  removeNSPrefix: true,
  processEntities: false,
});

type Node = Record<string, unknown>;

const isNode = (value: unknown): value is Node => !!value && typeof value === 'object' && !Array.isArray(value);

/** A child element that occurs exactly once, or `undefined`. */
function only(node: Node | undefined, name: string): Node | undefined {
  const child = node?.[name];
  return isNode(child) ? child : undefined;
}

/** Every occurrence of a child element, as a list. */
function all(node: Node | undefined, name: string): unknown[] {
  const child = node?.[name];
  if (child === undefined) return [];
  return Array.isArray(child) ? child : [child];
}

/** An element's text, whether it carries attributes (`#text`) or not. */
function textOf(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return String(value);
  if (isNode(value)) return textOf(value['#text']);
  return undefined;
}

/** The first `name` element under `node`, depth first: samlify's `.//*[local-name(.)='X509Certificate']`. */
function firstDescendant(node: unknown, name: string): unknown {
  if (Array.isArray(node)) {
    for (const item of node) {
      const found = firstDescendant(item, name);
      if (found !== undefined) return found;
    }
    return undefined;
  }
  if (!isNode(node)) return undefined;
  if (name in node) return Array.isArray(node[name]) ? (node[name] as unknown[])[0] : node[name];
  for (const [key, value] of Object.entries(node)) {
    if (key.startsWith('@_') || key === '#text') continue;
    const found = firstDescendant(value, name);
    if (found !== undefined) return found;
  }
  return undefined;
}

/** Whether any element named in `names` occurs under `node`. */
function hasDescendant(node: unknown, names: readonly string[]): boolean {
  return names.some((name) => firstDescendant(node, name) !== undefined);
}

/**
 * A certificate body as samlify compares it (`utility.normalizeCerString`):
 * the PEM armour, line breaks, spaces and tabs removed.
 */
export function normalizeSamlCertificate(certificate: string): string {
  return certificate
    .replace(/-----BEGIN CERTIFICATE-----/g, '')
    .replace(/-----END CERTIFICATE-----/g, '')
    .replace(/[\n\r \t]/g, '');
}

/** What the diagnosis compares the response with: the IdP's signing certificates and entity id. */
export interface SamlSigningConfig {
  /** Normalised signing certificates; empty when the configuration names none. */
  certificates: string[];
  /** The IdP entity id samlify checks the Assertion's `Issuer` against. */
  idpEntityId: string | undefined;
}

/** The certificates and entity id of IdP metadata XML, read as samlify reads them (`metadata.js`). */
function signingConfigOfMetadata(xml: string): SamlSigningConfig | undefined {
  let parsed: Node;
  try {
    parsed = parser.parse(xml) as Node;
  } catch {
    return undefined;
  }
  const descriptor = only(parsed, 'EntityDescriptor');
  if (!descriptor) return undefined;
  const keyDescriptors = Object.entries(descriptor)
    .filter(([key]) => key.endsWith('SSODescriptor'))
    .flatMap(([, value]) => (Array.isArray(value) ? value : [value]))
    .flatMap((sso) => all(isNode(sso) ? sso : undefined, 'KeyDescriptor'))
    .filter(isNode);
  const certificateOf = (keyDescriptor: Node) => textOf(only(only(keyDescriptor, 'KeyInfo'), 'X509Data')?.X509Certificate);
  const every = keyDescriptors.map(certificateOf).filter((c): c is string => !!c);
  // One certificate in the whole document is shared by both uses; otherwise
  // only those declared `use="signing"` sign.
  const signing = every.length === 1 ? every : keyDescriptors.filter((k) => k['@_use'] === 'signing').map(certificateOf).filter((c): c is string => !!c);
  const entityId = descriptor['@_entityID'];
  return {
    certificates: signing.map(normalizeSamlCertificate),
    idpEntityId: typeof entityId === 'string' ? entityId : undefined,
  };
}

/**
 * The signing certificates and IdP entity id of a stored `samlConfig` (the
 * JSON text the vendor stores, or the object), read as the vendor builds its
 * samlify IdP (`createIdP`): from `idpMetadata.metadata` XML when present,
 * else `idpMetadata.cert ?? cert` (one or a list) and `idpMetadata.entityID`.
 * `undefined` when the configuration cannot be read.
 */
export function samlSigningConfigOf(samlConfig: unknown): SamlSigningConfig | undefined {
  let config: unknown = samlConfig;
  if (typeof config === 'string') {
    try {
      config = JSON.parse(config);
    } catch {
      return undefined;
    }
  }
  if (!isNode(config)) return undefined;
  const idpMetadata = isNode(config.idpMetadata) ? config.idpMetadata : undefined;
  if (typeof idpMetadata?.metadata === 'string' && idpMetadata.metadata) return signingConfigOfMetadata(idpMetadata.metadata);
  const cert = idpMetadata?.cert ?? config.cert;
  const certificates = (Array.isArray(cert) ? cert : cert === undefined ? [] : [cert])
    .filter((c): c is string => typeof c === 'string' && c.trim() !== '')
    .map(normalizeSamlCertificate);
  const entityId = idpMetadata?.entityID;
  return { certificates, idpEntityId: typeof entityId === 'string' && entityId ? entityId : undefined };
}

/** The XML a posted `SAMLResponse` carries, decoded as the vendor decodes it; `undefined` when it is not base64 XML. */
function responseXmlOf(samlResponse: string): string | undefined {
  const compact = samlResponse.replace(/\s+/g, '');
  if (!compact || !/^[A-Za-z0-9+/=]+$/.test(compact)) return undefined;
  const xml = Buffer.from(compact, 'base64').toString('utf8');
  return xml.includes('<') ? xml : undefined;
}

/**
 * The cause of a refused SAML response, read off the posted `SAMLResponse`
 * (base64) and the provider's signing configuration, or `undefined` when it is
 * none of {@link SSO_SAML_REFUSAL_CAUSES}. Pure: no cryptography, no I/O.
 */
export function classifySamlRefusal(samlResponse: string, config: SamlSigningConfig): SsoSamlRefusalCause | undefined {
  const xml = responseXmlOf(samlResponse);
  // The vendor's schema validator (`XMLValidator`, `allowBooleanAttributes`)
  // runs first; XML it rejects is refused for that, not for a cause here.
  if (!xml || XMLValidator.validate(xml, { allowBooleanAttributes: true }) !== true) return undefined;
  let parsed: Node;
  try {
    parsed = parser.parse(xml) as Node;
  } catch {
    return undefined;
  }
  const response = only(parsed, 'Response');
  if (!response) return undefined;

  // 1. The IdP's own status, checked before any signature.
  const status = only(only(response, 'Status'), 'StatusCode')?.['@_Value'];
  if (typeof status !== 'string' || !status) return undefined;
  if (status !== SAML_STATUS_SUCCESS) return 'saml_idp_status_not_success';

  // samlify refuses a response that nests an Assertion or a Signature inside
  // SubjectConfirmationData (a wrapping attack) before it looks at signatures.
  const assertion = only(response, 'Assertion');
  const confirmationData = all(only(only(assertion, 'Subject'), 'SubjectConfirmation'), 'SubjectConfirmationData');
  if (hasDescendant(confirmationData, ['Assertion', 'Signature'])) return undefined;

  // 2. The signatures samlify checks, in its order: the Response's own, then
  //    the Assertion's.
  const signatures = [...all(response, 'Signature'), ...all(assertion, 'Signature')];
  if (signatures.length === 0) return all(response, 'EncryptedAssertion').length > 0 ? undefined : 'saml_response_unsigned';

  // 3. The first signature's embedded certificate against the configured ones.
  const embedded = textOf(firstDescendant(signatures[0], 'X509Certificate'));
  if (!embedded || config.certificates.length === 0) return undefined;
  const certificate = normalizeSamlCertificate(embedded);
  if (!config.certificates.some((configured) => configured.trim() === certificate.trim())) return 'saml_signing_certificate_mismatch';

  // 4. The Assertion's issuer against the configured IdP entity id.
  const issuer = textOf(assertion?.Issuer);
  if (!assertion || issuer === undefined || !config.idpEntityId) return undefined;
  return issuer !== config.idpEntityId ? 'saml_issuer_mismatch' : undefined;
}

/** The `SAMLResponse` of an ACS `POST`, form-encoded or JSON (the two media types the vendor admits). */
async function postedSamlResponseOf(request: Request): Promise<string | undefined> {
  const text = await request.text();
  const type = request.headers.get('content-type') ?? '';
  let samlResponse: unknown;
  if (type.includes('application/json')) {
    try {
      samlResponse = (JSON.parse(text) as { SAMLResponse?: unknown } | null)?.SAMLResponse;
    } catch {
      return undefined;
    }
  } else {
    samlResponse = new URLSearchParams(text).get('SAMLResponse');
  }
  return typeof samlResponse === 'string' && samlResponse ? samlResponse : undefined;
}

/** Whether a `Location` is the vendor's opaque SAML refusal (`error=saml_error`, `Invalid SAML response`). */
function isOpaqueSamlRefusal(location: string): boolean {
  const { searchParams } = new URL(location, 'http://better-auth.local');
  return searchParams.get('error') === OPAQUE_REFUSAL_ERROR && searchParams.get('error_description') === SSO_SAML_UNCLASSIFIED_REFUSAL;
}

/** `location` with its `error_description` set to the cause, a relative target kept relative. */
function withSamlCause(location: string, cause: SsoSamlRefusalCause): string {
  const url = new URL(location, 'http://better-auth.local');
  url.searchParams.set('error_description', cause);
  return location.startsWith('/') && !location.startsWith('//') ? `${url.pathname}${url.search}${url.hash}` : url.toString();
}

/** The members of better-auth's endpoint context {@link readStoredSamlConfig} reads. */
export interface SamlProviderReadContext {
  adapter: { findOne: (query: { model: string; where: { field: string; value: unknown }[] }) => Promise<unknown> };
}

/**
 * A provider's stored `samlConfig`, read through the vendor's own adapter the
 * way the vendor reads it (`findSAMLProvider`): the `ssoProvider` row by
 * `providerId`. `undefined` when there is no such row.
 */
export async function readStoredSamlConfig(context: SamlProviderReadContext, providerId: string): Promise<unknown> {
  const row = await context.adapter.findOne({ model: 'ssoProvider', where: [{ field: 'providerId', value: providerId }] });
  return isNode(row) ? row.samlConfig : undefined;
}

/**
 * Run one SAML ACS request and, when the vendor answers its opaque refusal,
 * name the cause: `error_description` becomes the cause token and one `warn`
 * line is written (`providerId`, `protocol: 'saml'`, `cause`). Every other
 * answer, an unclassified refusal, and a configuration that cannot be read
 * are returned as the vendor wrote them. The posted body is read from a clone
 * taken before the vendor consumes the request.
 */
export async function runSsoSamlRefusalCauseScope(
  saml: { providerId: string; request: Request },
  host: SsoRefusalHostLogger | undefined,
  readSamlConfig: () => Promise<unknown>,
  run: () => Promise<Response>,
): Promise<Response> {
  const posted = saml.request.clone();
  const response = await run();
  const location = response.headers.get('location');
  if (!location || !isOpaqueSamlRefusal(location)) return response;

  let cause: SsoSamlRefusalCause | undefined;
  try {
    const samlResponse = await postedSamlResponseOf(posted);
    const config = samlSigningConfigOf(await readSamlConfig());
    cause = samlResponse && config ? classifySamlRefusal(samlResponse, config) : undefined;
  } catch {
    cause = undefined;
  }
  if (!cause) return response;

  const meta = { providerId: saml.providerId, protocol: 'saml', cause };
  const text = `[auth] SSO sign-in refused: the identity provider's SAML response was not accepted (${cause})`;
  if (host) host.warn(text, meta);
  else console.warn(text, meta);

  const headers = new Headers(response.headers);
  headers.set('location', withSamlCause(location, cause));
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}
