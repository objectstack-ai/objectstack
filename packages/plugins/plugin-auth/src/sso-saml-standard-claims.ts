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

/** The parser options the vendor reads SAML XML with: no namespace prefixes, attributes kept, no entity expansion. */
const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  removeNSPrefix: true,
  processEntities: false,
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
 * The attribute names (`Attribute/@Name`) the one assertion of a posted
 * `SAMLResponse` carries, each once, in document order. Empty when the value
 * is too large, is not base64 XML, is not a `Response`, holds an encrypted
 * assertion, or holds anything but exactly one `Assertion`. Pure: no
 * cryptography, no decision; see the module header for why only names are
 * read.
 */
export function samlAssertionAttributeNames(samlResponse: string): string[] {
  if (typeof samlResponse !== 'string' || samlResponse.length > SAML_NAMES_MAX_RESPONSE_BYTES) return [];
  const xml = responseXmlOf(samlResponse);
  if (!xml) return [];
  let parsed: Node;
  try {
    parsed = parser.parse(xml) as Node;
  } catch {
    return [];
  }
  const response = parsed.Response;
  if (!isNode(response)) return [];
  if (countElements(response, 'EncryptedAssertion') > 0 || countElements(response, 'Assertion') !== 1) return [];
  const assertion = response.Assertion;
  if (!isNode(assertion)) return [];
  const names = new Set<string>();
  for (const statement of listOf(assertion.AttributeStatement)) {
    if (!isNode(statement)) continue;
    for (const attribute of listOf(statement.Attribute)) {
      const name = isNode(attribute) ? attribute['@_Name'] : undefined;
      if (typeof name === 'string' && name) names.add(name);
    }
  }
  return [...names];
}

/**
 * The attribute names the assertion posted to a SAML ACS request carries
 * ({@link samlAssertionAttributeNames}), read from a clone so the vendor
 * still reads the body. Empty on any failure.
 */
export async function readSamlAssertionAttributeNames(request: Request): Promise<string[]> {
  try {
    const samlResponse = await postedSamlResponseOf(request.clone());
    return samlResponse ? samlAssertionAttributeNames(samlResponse) : [];
  } catch {
    return [];
  }
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

/** A member the vendor reads and its fingerprint does not see. */
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
