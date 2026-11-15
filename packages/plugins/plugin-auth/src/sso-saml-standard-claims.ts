// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * An unmapped SAML sign-in reads the standard claims before the NameID.
 *
 * ## The rule
 *
 * For each of the four members of a SAML provider's attribute mapping the
 * administrator left unset, a sign-in whose assertion carries the standard
 * claim for that member reads it, before the vendor's own default name and
 * before the NameID:
 *
 * | Member      | Standard claim (Microsoft Entra ID and AD FS send these by default) |
 * | :---------- | :------------------------------------------------------------------ |
 * | `email`     | `http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress` |
 * | `firstName` | `http://schemas.xmlsoap.org/ws/2005/05/identity/claims/givenname`    |
 * | `lastName`  | `http://schemas.xmlsoap.org/ws/2005/05/identity/claims/surname`      |
 * | `name`      | `http://schemas.xmlsoap.org/ws/2005/05/identity/claims/name`         |
 *
 * A member the administrator named is read as named, whatever the assertion
 * carries. A member left unset whose standard claim the assertion does not
 * carry keeps the vendor's default (`email`, then the NameID; `givenName` +
 * `surname`, then `displayName`, then the NameID). So a provider that sends
 * `email` and none of the claims above signs in exactly as before.
 *
 * Why it matters: without a mapping, `@better-auth/sso` reads the email from
 * an `email` attribute, which Entra ID does not send, and so falls back to the
 * NameID. An SP-initiated sign-in asks for an email-format NameID and gets the
 * user principal name; an IdP-initiated one (no request) gets Entra's default
 * persistent NameID, an opaque pairwise id. The same person then resolved to
 * two different "emails". Reading the email claim first resolves both entries
 * to the one address the IdP states, so the second entry reaches the account
 * the first one made (and is judged by the platform's linking rules there,
 * `implicit-account-linking.ts`), instead of making another account.
 *
 * ## How it reaches the vendor (measured on `@better-auth/sso` 1.7.12)
 *
 * The vendor reads ONE attribute name per member (`attr(mapping.email ||
 * "email") || extract.nameID`) off the provider's `samlConfig.mapping`, which
 * it reads through this platform's adapter at the ACS. It has no option for a
 * list of names, and no seam between verifying the assertion and resolving the
 * user. So:
 *
 *  1. Before the vendor runs, the ACS request's posted `SAMLResponse` is read
 *     once for the attribute NAMES its one assertion carries
 *     ({@link samlAssertionAttributeNames}) and put in the request's SAML
 *     scope (`sso-sign-in-options.ts`). Only names are taken from this
 *     unverified read: every VALUE the sign-in uses is still the vendor's own,
 *     read from the assertion it verified. A name the verified assertion does
 *     not carry reads nothing, exactly as an unset member's default would on
 *     an IdP that does not send it. An encrypted assertion's attributes cannot
 *     be seen before the vendor decrypts it, so it reads no name, and the
 *     mapping stays as stored: map such a provider's members explicitly.
 *  2. The adapter's read of that provider's row, in that scope
 *     ({@link applyStandardSamlClaimsOnRead}), hands the vendor a `samlConfig`
 *     whose mapping also names the standard claim for each unset member the
 *     assertion carries. The added members are NON-ENUMERABLE: the vendor
 *     fingerprints a provider's configuration (its enumerable members) when a
 *     sign-in starts and again at the ACS, and refuses the sign-in when the
 *     two differ, so a member visible to that fingerprint would refuse every
 *     SP-initiated sign-in it touched. Nothing is written: the stored mapping
 *     and every read outside the ACS scope are unchanged.
 *
 * A vendor upgrade that copies the configuration before reading the mapping
 * drops the added members and returns the vendor's defaults; the end-to-end
 * pins in `sso-saml-refusal-landing.test.ts` go red on it.
 */

import { XMLParser } from 'fast-xml-parser';
import { SSO_PROVIDER_OBJECT } from './sso-client-secret.js';
import { postedSamlResponseOf, responseXmlOf } from './sso-saml-refusal-cause.js';
import { samlAssertionAttributeNamesInScope } from './sso-sign-in-options.js';

const CLAIMS = 'http://schemas.xmlsoap.org/ws/2005/05/identity/claims';

/** The standard claim each SAML mapping member reads when the administrator left it unset. */
export const SAML_STANDARD_CLAIMS = {
  email: `${CLAIMS}/emailaddress`,
  firstName: `${CLAIMS}/givenname`,
  lastName: `${CLAIMS}/surname`,
  name: `${CLAIMS}/name`,
} as const;

export type SamlMappingMember = keyof typeof SAML_STANDARD_CLAIMS;

const MEMBERS = Object.keys(SAML_STANDARD_CLAIMS) as SamlMappingMember[];

/** `sys_sso_provider` column holding the SAML configuration blob. */
const SSO_SAML_CONFIG_FIELD = 'saml_config';

/**
 * The largest posted `SAMLResponse` read for names: the vendor's own default
 * `maxResponseSize`, above which it refuses the response unread.
 */
export const SAML_NAMES_MAX_RESPONSE_BYTES = 262_144;

/**
 * The parser options the vendor reads SAML XML with (no namespace prefixes,
 * attributes kept, no entity expansion), plus three for reading a text value
 * as written (`sso-saml-account-key.ts`): no number coercion, and comments and
 * CDATA kept apart from the text, so a value written with either reads as
 * unreadable rather than as a part of itself.
 */
const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  removeNSPrefix: true,
  processEntities: false,
  parseTagValue: false,
  commentPropName: '#comment',
  cdataPropName: '#cdata',
});

type Node = Record<string, unknown>;

const isNode = (value: unknown): value is Node => !!value && typeof value === 'object' && !Array.isArray(value);

const listOf = (value: unknown): unknown[] => (value === undefined ? [] : Array.isArray(value) ? value : [value]);

/** How many `name` elements occur anywhere under `node`. */
function countElements(node: unknown, name: string): number {
  if (Array.isArray(node)) return node.reduce((sum: number, item) => sum + countElements(item, name), 0);
  if (!isNode(node)) return 0;
  let count = 0;
  for (const [key, value] of Object.entries(node)) {
    if (key.startsWith('@_') || key === '#text') continue;
    if (key === name) count += listOf(value).length;
    count += countElements(value, name);
  }
  return count;
}

/**
 * What the one assertion of a posted `SAMLResponse` carries, as posted:
 * read before the vendor verified anything, so a caller uses it only to
 * decide what to read, never as a verified value (the module header, and
 * `sso-saml-account-key.ts` for how that one confirms what it read).
 */
export interface SamlAssertionPreview {
  /** The attribute names (`Attribute/@Name`), each once, in document order. */
  readonly attributeNames: readonly string[];
  /** The subject's `NameID` text, or `null` when it is not exactly one plain text value. */
  readonly nameId: string | null;
  /**
   * The first value of the attribute named `name`, or `null` when the
   * assertion does not carry exactly one attribute of that name, or its first
   * value is not one plain text value (empty, or written with a comment,
   * CDATA, an entity reference or a child element).
   */
  singleValueOf(name: string): string | null;
}

/**
 * The text an element carries when it is exactly one plain text value: no
 * child element, comment or CDATA section, no entity reference (which the
 * vendor's verifier decodes and this read does not), and not empty.
 */
function plainTextOf(node: unknown): string | null {
  let text: unknown = node;
  if (isNode(node)) {
    for (const key of Object.keys(node)) if (key !== '#text' && !key.startsWith('@_')) return null;
    text = node['#text'];
  }
  return typeof text === 'string' && text !== '' && !text.includes('&') ? text : null;
}

/** The one element `name` under `node`, or `undefined` when there is none or more than one. */
function onlyChild(node: Node, name: string): unknown {
  const all = listOf(node[name]);
  return all.length === 1 ? all[0] : undefined;
}

/**
 * The preview of the one assertion of a posted `SAMLResponse`
 * ({@link SamlAssertionPreview}), or `null` when the value is too large, is
 * not base64 XML, is not a `Response`, holds an encrypted assertion, or holds
 * anything but exactly one `Assertion`. Pure: no cryptography, no decision.
 */
export function samlAssertionPreview(samlResponse: string): SamlAssertionPreview | null {
  if (typeof samlResponse !== 'string' || samlResponse.length > SAML_NAMES_MAX_RESPONSE_BYTES) return null;
  const xml = responseXmlOf(samlResponse);
  if (!xml) return null;
  let parsed: Node;
  try {
    parsed = parser.parse(xml) as Node;
  } catch {
    return null;
  }
  const response = parsed.Response;
  if (!isNode(response)) return null;
  if (countElements(response, 'EncryptedAssertion') > 0 || countElements(response, 'Assertion') !== 1) return null;
  const assertion = response.Assertion;
  if (!isNode(assertion)) return null;
  const names = new Set<string>();
  const byName = new Map<string, unknown[]>();
  for (const statement of listOf(assertion.AttributeStatement)) {
    if (!isNode(statement)) continue;
    for (const attribute of listOf(statement.Attribute)) {
      const name = isNode(attribute) ? attribute['@_Name'] : undefined;
      if (typeof name !== 'string' || !name) continue;
      names.add(name);
      byName.set(name, [...(byName.get(name) ?? []), attribute]);
    }
  }
  const subject = onlyChild(assertion, 'Subject');
  const nameId = isNode(subject) ? plainTextOf(onlyChild(subject, 'NameID')) : null;
  return {
    attributeNames: [...names],
    nameId,
    singleValueOf: (name) => {
      const attributes = byName.get(name) ?? [];
      if (attributes.length !== 1 || !isNode(attributes[0])) return null;
      return plainTextOf(listOf(attributes[0].AttributeValue)[0]);
    },
  };
}

/**
 * The attribute names (`Attribute/@Name`) the one assertion of a posted
 * `SAMLResponse` carries, each once, in document order
 * ({@link samlAssertionPreview}); empty when it reads none. See the module
 * header for why only names are taken from this read.
 */
export function samlAssertionAttributeNames(samlResponse: string): string[] {
  return [...(samlAssertionPreview(samlResponse)?.attributeNames ?? [])];
}

/**
 * The preview of the assertion posted to a SAML ACS request
 * ({@link samlAssertionPreview}), read from a clone so the vendor still reads
 * the body. `null` on any failure.
 */
export async function readSamlAssertionPreview(request: Request): Promise<SamlAssertionPreview | null> {
  try {
    const samlResponse = await postedSamlResponseOf(request.clone());
    return samlResponse ? samlAssertionPreview(samlResponse) : null;
  } catch {
    return null;
  }
}

/**
 * The attribute names the assertion posted to a SAML ACS request carries
 * ({@link samlAssertionAttributeNames}), read from a clone so the vendor
 * still reads the body. Empty on any failure.
 */
export async function readSamlAssertionAttributeNames(request: Request): Promise<string[]> {
  return [...((await readSamlAssertionPreview(request))?.attributeNames ?? [])];
}

/**
 * For each member `mapping` leaves unset (no own member of that name), the
 * standard claim when `names` carries it. A member the mapping names, even
 * one naming an attribute the assertion lacks, is never in the answer.
 */
export function samlStandardClaimMembers(
  mapping: unknown,
  names: readonly string[],
): Partial<Record<SamlMappingMember, string>> {
  const stored = isNode(mapping) ? mapping : {};
  const added: Partial<Record<SamlMappingMember, string>> = {};
  for (const member of MEMBERS) {
    if (Object.prototype.hasOwnProperty.call(stored, member)) continue;
    const claim = SAML_STANDARD_CLAIMS[member];
    if (names.includes(claim)) added[member] = claim;
  }
  return added;
}

/**
 * A member the vendor reads and its fingerprint does not see: the vendor's
 * `computeProviderAuthenticationFingerprint` (@better-auth/sso 1.7.12) hashes
 * `serializeCanonical` of the config's `Object.entries`, which skips
 * non-enumerable members.
 */
const hidden = (target: object, key: string, value: unknown): void => {
  Object.defineProperty(target, key, { value, enumerable: false, writable: true, configurable: true });
};

/**
 * READ half, in place: a `sys_sso_provider` row read during the SAML ACS
 * request of its own provider, whose assertion carries a standard claim for a
 * member its stored mapping leaves unset, has its `saml_config` handed back as
 * an object whose mapping also names that claim, as a non-enumerable member
 * (see the module header). Any other row, any read outside that scope, and a
 * configuration that cannot be parsed are left untouched.
 */
export function applyStandardSamlClaimsOnRead(objectName: string, row: unknown): void {
  if (objectName !== SSO_PROVIDER_OBJECT || !isNode(row)) return;
  const names = samlAssertionAttributeNamesInScope(row.provider_id);
  if (names.length === 0) return;
  const stored = row[SSO_SAML_CONFIG_FIELD];
  let config: unknown;
  try {
    // A fresh copy either way: the engine's own object is never changed.
    config = JSON.parse(typeof stored === 'string' ? stored : JSON.stringify(stored ?? null));
  } catch {
    return;
  }
  if (!isNode(config)) return;
  const added = samlStandardClaimMembers(config.mapping, names);
  if (Object.keys(added).length === 0) return;
  if (isNode(config.mapping)) {
    for (const [member, claim] of Object.entries(added)) hidden(config.mapping, member, claim);
  } else if (config.mapping === undefined) {
    hidden(config, 'mapping', { ...added });
  } else {
    return;
  }
  row[SSO_SAML_CONFIG_FIELD] = config;
}
