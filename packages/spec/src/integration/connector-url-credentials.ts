// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The credential parts of a URL a connector entry keeps — the ONE definition
 * both connector doors judge by. Internal: imported by the write door's
 * refinement (`DeclarativeConnectorEntrySchema` in `./connector.zod.ts`) and by
 * the read redactor (`./connector-credential-redaction.ts`), never exported on
 * its own.
 *
 * ## The strings judged
 *
 * Every string under the two places an entry keeps a URL
 * ({@link CONNECTOR_URL_ROOTS}):
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
 *    the form several HTTP APIs read as a token. Judged on the string trimmed
 *    of its leading and trailing C0 control characters and spaces
 *    (`urlTrimmedBounds`, `data/driver/url-boundary.ts`) — where a URL parser
 *    reads it — when that trimmed string starts with `scheme://`;
 *  - **each credential query parameter** with a non-empty value, in ANY
 *    judged string, whether or not it starts with a scheme: the names in
 *    {@link CONNECTOR_CREDENTIAL_URL_QUERY_PARAM_NAMES}, plus the
 *    `auth.paramName` an `api-key` instance itself names. The query is read by
 *    `urlCredentialQueryParams` (`data/driver/common.zod.ts`), the single
 *    value-level parse the datasource doors run too, and a pair is judged by
 *    `credentialQueryParamOf` beside it: the query runs from the first `?` to
 *    the fragment, names match case-insensitively on the percent-decoded key,
 *    and an empty value carries nothing.
 *
 * ## One traversal, two doors
 *
 * {@link findConnectorUrlCredentials} is the only walk over an entry's URLs.
 * The write door's refinement refuses each URL it returns, at that URL's path;
 * the read redactor rewrites each one it can address and withholds the rest
 * whole ({@link connectorUrlCredentialPositionOf}). One definition and one
 * walk, so the two cannot disagree about which URLs carry a credential part.
 * Neither judges a URL inside a header or environment map
 * ({@link CONNECTOR_CREDENTIAL_MAP_PATHS}): the read withholds such a map
 * whole.
 */

import { CREDENTIAL_URL_QUERY_PARAM_NAMES, urlCredentialQueryParams } from '../data/driver/common.zod';
import { urlTrimmedBounds } from '../data/driver/url-boundary';

/**
 * The header and environment maps a provider sends upstream — withheld WHOLE by
 * the read redactor (a map's entries cannot be told apart), so neither door
 * judges the URLs inside one: the read never rewrites inside a map, and the
 * write leaves a map's entries to the authoring lint that judges them.
 */
export const CONNECTOR_CREDENTIAL_MAP_PATHS: readonly (readonly string[])[] = Object.freeze([
  ['providerConfig', 'headers'],
  ['providerConfig', 'defaultHeaders'],
  ['providerConfig', 'transport', 'headers'],
  ['providerConfig', 'transport', 'env'],
]);

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

/**
 * `scheme://userinfo@` — the whole userinfo. Every class excludes `/?#`, so the
 * `@` must sit in the authority; the greedy class backtracks to the LAST `@`
 * before the path, the userinfo boundary RFC 3986 defines. Run on the trimmed
 * span only ({@link connectorUrlWithoutUserinfo}).
 */
const URL_USERINFO_RE = /^([a-z][a-z0-9+.\-]*:\/\/)[^/?#]*@/i;

/**
 * `value` with its userinfo removed, or `value` itself when it holds none —
 * the userinfo half's ONE judgement, which the write door asks (does this
 * change the value?) and the read redactor applies, so the read rewrites
 * exactly what the write refuses. The userinfo is judged on the span a URL
 * parser reads — `value` trimmed of its leading and trailing C0 control
 * characters and spaces (`urlTrimmedBounds`) — and removed there, every
 * other character of `value`, the surrounding ones included, kept byte for
 * byte.
 */
export function connectorUrlWithoutUserinfo(value: string): string {
  const [start, end] = urlTrimmedBounds(value);
  const url = value.slice(start, end);
  const rewritten = url.replace(URL_USERINFO_RE, '$1');
  return rewritten === url ? value : `${value.slice(0, start)}${rewritten}${value.slice(end)}`;
}

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

/** Whether `path` is one of {@link CONNECTOR_CREDENTIAL_MAP_PATHS}. */
function isCredentialMapPath(path: ReadonlyArray<string | number>): boolean {
  return CONNECTOR_CREDENTIAL_MAP_PATHS.some(
    (mapPath) => mapPath.length === path.length && mapPath.every((segment, i) => segment === path[i]),
  );
}

/** What credential parts one URL holds. */
export interface ConnectorUrlCredentialParts {
  /** The URL carries a userinfo (`user@`, `user:password@`). */
  userinfo: boolean;
  /** The credential query parameters it carries with a value, as the judged name spells them. */
  params: string[];
}

/**
 * The credential parts `value` holds, or `undefined` when it holds none: the
 * userinfo on the trimmed span ({@link connectorUrlWithoutUserinfo}), and the
 * credential query parameters in any string, scheme or none (see the module
 * note).
 */
export function connectorUrlCredentialPartsOf(
  value: string,
  params: readonly string[],
): ConnectorUrlCredentialParts | undefined {
  const userinfo = connectorUrlWithoutUserinfo(value) !== value;
  const found = urlCredentialQueryParams(value, params);
  return userinfo || found.length > 0 ? { userinfo, params: found } : undefined;
}

/** One URL holding credential parts, located from the entry root. */
export interface ConnectorUrlCredential extends ConnectorUrlCredentialParts {
  /** The URL's position: object keys, and an array element's index. */
  path: Array<string | number>;
  /** The URL itself — what the read redactor rewrites. ⛔ Never echoed by the write door's refusal. */
  url: string;
}

/**
 * Every string under {@link CONNECTOR_URL_ROOTS} that holds a credential part
 * (see the module note), at any depth — inside arrays and under keys whose own
 * name carries a dot too —
 * except inside the maps of {@link CONNECTOR_CREDENTIAL_MAP_PATHS}, whatever a
 * map position holds. The one traversal both doors run (see the module note):
 * the write door refuses every URL returned, the read redactor withholds each
 * at its {@link connectorUrlCredentialPositionOf}.
 */
export function findConnectorUrlCredentials(item: Record<string, unknown>): ConnectorUrlCredential[] {
  const params = connectorCredentialQueryParamsOf(item);
  const found: ConnectorUrlCredential[] = [];
  const walk = (value: unknown, path: Array<string | number>): void => {
    if (isCredentialMapPath(path)) return;
    if (typeof value === 'string') {
      const parts = connectorUrlCredentialPartsOf(value, params);
      if (parts) found.push({ path, url: value, ...parts });
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

/**
 * Where the read redactor withholds a URL {@link findConnectorUrlCredentials}
 * returned. The served body's withheld positions are named in `redactedKeys`,
 * joined on dots, and the save-side carry-forward re-grafts the stored value by
 * that name, so a position must be addressable by it: object keys without a
 * dot are. The first hop along the path that is not — an array element (the
 * carry-forward cannot address one by index), or a key whose own name carries
 * a dot (indistinguishable from a nested path once joined) — ends the position
 * there, and everything under it is withheld whole: the ARRAY itself, or the
 * dotted KEY. `rewrite` is true when no such hop exists, and the URL is then
 * rewritten in place, its credential parts removed.
 */
export function connectorUrlCredentialPositionOf(
  path: ReadonlyArray<string | number>,
): { path: string[]; rewrite: boolean } {
  for (let i = 1; i < path.length; i += 1) {
    const hop = path[i]!;
    if (typeof hop === 'number') return { path: path.slice(0, i) as string[], rewrite: false };
    if (hop.includes('.')) return { path: path.slice(0, i + 1) as string[], rewrite: false };
  }
  return { path: [...path] as string[], rewrite: true };
}
