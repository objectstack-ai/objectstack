// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The credential parts of a URL a connector entry keeps — the ONE definition
 * both connector doors judge by. Internal: imported by the write door's
 * refinement (`DeclarativeConnectorEntrySchema` in `./connector.zod.ts`) and by
 * the read redactor (`./connector-credential-redaction.ts`), never exported on
 * its own.
 *
 * ## The URLs judged
 *
 * Every string that starts with `scheme://` under the two places an entry
 * keeps a URL ({@link CONNECTOR_URL_ROOTS}):
 *
 *  - `providerConfig` — the provider's own vocabulary: `baseUrl` (`rest`,
 *    `openapi`), `transport.url` (`mcp` over http), a URL `spec` (`openapi`),
 *    and any other URL a provider keeps there;
 *  - `auth` — the endpoints an instance-auth kind declares: `tokenUrl`,
 *    `authorizationUrl` and `resource` (`oauth2`), and any URL a kind declares
 *    later.
 *
 * No list of provider keys: a URL is recognised by its value, so a provider
 * that keeps a URL under a new key is judged with nothing to edit here.
 *
 * ## The credential parts
 *
 *  - **the userinfo**, whole: `https://user:pass@host`, and `https://<token>@host`,
 *    the form several HTTP APIs read as a token;
 *  - **each credential query parameter** with a non-empty value: the names in
 *    {@link CONNECTOR_CREDENTIAL_URL_QUERY_PARAM_NAMES}, plus the
 *    `auth.paramName` an `api-key` instance itself names. A pair is judged by
 *    `credentialQueryParamOf` (`data/driver/common.zod.ts`), the boundary
 *    definition the datasource doors share: the query runs from the first `?`
 *    to the fragment, names match case-insensitively on the percent-decoded
 *    key, and an empty value carries nothing.
 *
 * The write door refuses a URL holding either part; the read redactor removes
 * exactly these parts from a stored one. One definition, so the two cannot
 * disagree about what a credential in a URL is.
 */

import { CREDENTIAL_URL_QUERY_PARAM_NAMES, urlCredentialQueryParams } from '../data/driver/common.zod';

/** The entry keys under which a connector keeps URLs (see the module note). */
export const CONNECTOR_URL_ROOTS: readonly string[] = Object.freeze(['providerConfig', 'auth']);

/**
 * The query parameters whose value a connector URL is read as carrying a
 * credential in: the datasource set (`password`, `authToken`) and the names
 * HTTP APIs conventionally take a key, token or signature under. Matched
 * case-insensitively on the decoded name (`credentialQueryParamOf`).
 */
export const CONNECTOR_CREDENTIAL_URL_QUERY_PARAM_NAMES: readonly string[] = Object.freeze([
  ...CREDENTIAL_URL_QUERY_PARAM_NAMES,
  'access_token',
  'api_key',
  'api-key',
  'apikey',
  'auth_token',
  'client_secret',
  'id_token',
  'key',
  'passwd',
  'refresh_token',
  'secret',
  'sig',
  'signature',
  'token',
  'x-api-key',
]);

/** `scheme://` — the strings judged as URLs. */
export const URL_SCHEME_RE = /^[a-z][a-z0-9+.\-]*:\/\//i;

/**
 * `scheme://userinfo@` — the whole userinfo. Every class excludes `/?#`, so the
 * `@` must sit in the authority; the greedy class backtracks to the LAST `@`
 * before the path, the userinfo boundary RFC 3986 defines.
 */
export const URL_USERINFO_RE = /^([a-z][a-z0-9+.\-]*:\/\/)[^/?#]*@/i;

const isPlainRecord = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);

/** The query parameter names judged for `item`: the fixed set plus its own `auth.paramName`. */
export function connectorCredentialQueryParamsOf(item: Record<string, unknown>): readonly string[] {
  const auth = item.auth;
  const own = isPlainRecord(auth) && auth.type === 'api-key' && typeof auth.paramName === 'string' && auth.paramName !== ''
    ? auth.paramName
    : undefined;
  return own === undefined ? CONNECTOR_CREDENTIAL_URL_QUERY_PARAM_NAMES : [...CONNECTOR_CREDENTIAL_URL_QUERY_PARAM_NAMES, own];
}

/** What credential parts one URL holds. */
export interface ConnectorUrlCredentialParts {
  /** The URL carries a userinfo (`user@`, `user:password@`). */
  userinfo: boolean;
  /** The credential query parameters it carries with a value, as the judged name spells them. */
  params: string[];
}

/** The credential parts `value` holds, or `undefined` when it is not a URL or holds none. */
export function connectorUrlCredentialPartsOf(
  value: string,
  params: readonly string[],
): ConnectorUrlCredentialParts | undefined {
  if (!URL_SCHEME_RE.test(value)) return undefined;
  const userinfo = URL_USERINFO_RE.test(value);
  const found = urlCredentialQueryParams(value, params);
  return userinfo || found.length > 0 ? { userinfo, params: found } : undefined;
}

/** One URL holding credential parts, located from the entry root. */
export interface ConnectorUrlCredential extends ConnectorUrlCredentialParts {
  /** The URL's position: object keys, and an array element's index. */
  path: Array<string | number>;
}

/**
 * Every URL under {@link CONNECTOR_URL_ROOTS} that holds a credential part, at
 * any depth — inside arrays and under keys whose own name carries a dot too.
 * The write door's walk: it reports every position, where the read redactor
 * rewrites what it can address and withholds the rest whole.
 */
export function findConnectorUrlCredentials(item: Record<string, unknown>): ConnectorUrlCredential[] {
  const params = connectorCredentialQueryParamsOf(item);
  const found: ConnectorUrlCredential[] = [];
  const walk = (value: unknown, path: Array<string | number>): void => {
    if (typeof value === 'string') {
      const parts = connectorUrlCredentialPartsOf(value, params);
      if (parts) found.push({ path, ...parts });
    } else if (Array.isArray(value)) {
      value.forEach((element, index) => walk(element, [...path, index]));
    } else if (isPlainRecord(value)) {
      for (const [key, child] of Object.entries(value)) walk(child, [...path, key]);
    }
  };
  for (const root of CONNECTOR_URL_ROOTS) {
    if (isPlainRecord(item[root])) walk(item[root], [root]);
  }
  return found;
}
