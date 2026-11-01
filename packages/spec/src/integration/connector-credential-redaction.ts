// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Read-path credential redaction for a stored `connector` body — the built-in
 * `connector` entry of the metadata-type redactor registry
 * (`kernel/metadata-type-redaction.ts`). Internal: reached through
 * `getMetadataTypeRedactor('connector')`, never exported on its own.
 *
 * ## Why a built-in, and why not the schema derivation
 *
 * A `connector` row reaches `sys_metadata` through the metadata save door with
 * or without any connector plugin mounted, so a registration from a plugin
 * would protect only the compositions that mount it — the fail-open shape the
 * registry's module note records for `datasource`. And the positions are not
 * declared fields the `.meta({ credential })` derivation can reach: `auth` is a
 * discriminated union and `providerConfig` a record the provider owns, and the
 * derivation descends into neither (`kernel/metadata-credential-fields.ts`).
 * So the positions are named here, read from the declared shapes where a
 * declared shape exists.
 *
 * ## The positions withheld
 *
 *  1. **`auth.<key>` — every key the item's instance-auth kind does not
 *     declare.** Every key a kind declares is a reference (`credentialRef`,
 *     `vendorPublicKeyRef`) or not a secret (`username`, `keyId`, `clientId`,
 *     the endpoints) — ADR-0097 §3, ADR-0143 D3 — so an undeclared key is the
 *     one place an inline secret can sit. The declared keys are read from
 *     {@link ConnectorInstanceAuthSchema} itself, so a kind added to the union
 *     later is covered with nothing to edit here. A `type` that names no kind
 *     leaves `type` alone declared.
 *  2. **`authentication.<key>` — every key but `type`.** The runtime shape
 *     carries its secret inline (`token`, `key`, `password`), and an authored
 *     entry may hold only `{ type: 'none' }` (the publish refusal registered as
 *     `connector-inline-authentication-publish-refused`), so any other key is
 *     the shape of an inline secret on a row stored before that refusal.
 *  3. **The header and environment maps a provider sends upstream, each
 *     WHOLE**: `providerConfig.headers`, `providerConfig.defaultHeaders`
 *     (`rest`), `providerConfig.transport.headers` (`mcp` over http) and
 *     `providerConfig.transport.env` (`mcp` over stdio, where a server takes
 *     its credentials). A map's entries cannot be told apart — an
 *     `Authorization` entry and an `Accept` entry are both strings — so the
 *     whole map is withheld, the posture ruled for a webhook's `headers`
 *     (`.meta({ credential: 'map' })`).
 *  4. **`auth` / `authentication` that is not an object, WHOLE.** Every door
 *     that authors an entry refuses such a value (`invalid_type`), so a stored
 *     one came from outside them, and what it holds cannot be judged key by
 *     key: an `auth: '<token>'` is the secret itself. Withheld whole, fail
 *     closed, rather than served as stored.
 *  5. **The credential parts of every URL under `providerConfig`** — rewritten,
 *     not removed: the userinfo (`https://user:pass@host`, and the
 *     `https://<token>@host` form several HTTP APIs read as a token, so the
 *     user part goes too) and each credential query parameter
 *     ({@link CONNECTOR_CREDENTIAL_URL_QUERY_PARAM_NAMES}, plus the
 *     `auth.paramName` an `api-key` instance itself names), with the rest of
 *     the URL byte for byte. That is the read half the datasource redactor
 *     applies to a driver URL (`data/datasource-credential-redaction.ts`), and
 *     the query half runs through the same `redactUrlCredentialQueryParams`.
 *     It covers `providerConfig.baseUrl` (`rest`, `openapi`),
 *     `providerConfig.transport.url` (`mcp` over http) and a URL
 *     `providerConfig.spec` (`openapi`), and any other URL a provider keeps at
 *     an OBJECT depth of `providerConfig`: a string is judged when it starts
 *     with `scheme://`. Arrays are off the walk, as they are for the datasource
 *     scrub, and so is a key spelled with a dot: the carry-forward addresses a
 *     withheld position by its dotted path, so a position it cannot address
 *     would turn a save of the served form into a silent credential deletion.
 *
 * ## Cleared forms, and what is never touched
 *
 * A position holding nothing — `null`, `''`, or an empty map — is served as
 * written and not reported, as the schema derivation serves its cleared forms:
 * a reader can tell "cleared" from "withheld". Every other key of the item is
 * left byte for byte, `_diagnostics` included, and the input is never mutated:
 * redaction is a SERVING act. The runtime reads connectors through the
 * protocol's execution read, which applies no serving decoration, so a
 * withheld map still reaches the provider that sends it.
 *
 * A rewritten URL is a withheld position like a removed one: it is named in
 * `redactedKeys`, and a save that sends the served URL back unchanged keeps the
 * stored one (the protocol's carry-forward compares the incoming value with
 * the served form and re-grafts the stored value only where they match), while
 * a URL the author edits is the author's word.
 */

import { ConnectorInstanceAuthSchema } from '../shared/connector-auth.zod';
import { CREDENTIAL_URL_QUERY_PARAM_NAMES } from '../data/driver/common.zod';
import { redactUrlCredentialQueryParams } from '../data/datasource-credential-redaction';
import { objectShapeOf, wrapperChainOf, zodDefOf } from '../kernel/metadata-credential-fields';
import type { MetadataRedactionResult } from '../kernel/metadata-type-redaction';

/** The map positions under `providerConfig` withheld whole (see the module note, item 3). */
export const CONNECTOR_CREDENTIAL_MAP_PATHS: readonly (readonly string[])[] = Object.freeze([
  ['providerConfig', 'headers'],
  ['providerConfig', 'defaultHeaders'],
  ['providerConfig', 'transport', 'headers'],
  ['providerConfig', 'transport', 'env'],
]);

/**
 * The query parameters whose value a connector URL is read as carrying a
 * credential in (see the module note, item 5): the datasource set
 * (`password`, `authToken`) and the names HTTP APIs conventionally take a key,
 * token or signature under. Matched case-insensitively on the decoded name
 * (`credentialQueryParamOf`). A name here that holds no secret on some API
 * costs that API's served URL the parameter, never its stored value: the
 * carry-forward keeps it on a save of the served form.
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

/** `scheme://` — the strings item 5 judges. */
const URL_SCHEME_RE = /^[a-z][a-z0-9+.\-]*:\/\//i;

/**
 * `scheme://userinfo@` — the whole userinfo. Every class excludes `/?#`, so the
 * `@` must sit in the authority; the greedy class backtracks to the LAST `@`
 * before the path, the userinfo boundary RFC 3986 defines (the reading
 * `URL_USERINFO_RE` in the datasource module documents).
 */
const URL_USERINFO_RE = /^([a-z][a-z0-9+.\-]*:\/\/)[^/?#]*@/i;

/** One URL with its userinfo and credential query parameters removed; the input when there is none. */
function redactConnectorUrl(value: string, params: readonly string[]): string {
  return redactUrlCredentialQueryParams(value.replace(URL_USERINFO_RE, '$1'), params);
}

/** The query parameter names item 5 strips for `item`: the fixed set plus its own `auth.paramName`. */
function credentialQueryParamsOf(item: Record<string, unknown>): readonly string[] {
  const auth = item.auth;
  const own = isPlainRecord(auth) && auth.type === 'api-key' && typeof auth.paramName === 'string' && auth.paramName !== ''
    ? auth.paramName
    : undefined;
  return own === undefined ? CONNECTOR_CREDENTIAL_URL_QUERY_PARAM_NAMES : [...CONNECTOR_CREDENTIAL_URL_QUERY_PARAM_NAMES, own];
}

/** One instance-auth kind as the union declares it: its literal-valued keys, and every key it declares. */
interface DeclaredAuthKind {
  /** Each key whose schema is a literal, with the values it accepts (`type`, `grant`, `scheme`). */
  literals: ReadonlyMap<string, readonly unknown[]>;
  keys: ReadonlySet<string>;
}

const isPlainRecord = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);

/** The values a literal field accepts, or `undefined` when the field is not a literal. */
function literalValuesOf(field: unknown): readonly unknown[] | undefined {
  const chain = wrapperChainOf(field);
  const def = zodDefOf(chain[chain.length - 1]) as { type?: string; values?: unknown[] } | undefined;
  return def?.type === 'literal' && Array.isArray(def.values) ? def.values : undefined;
}

/** Every object kind under `schema`, flattening nested unions (`oauth2` by grant, `signed` by scheme). */
function declaredKindsOf(schema: unknown): DeclaredAuthKind[] {
  const chain = wrapperChainOf(schema);
  const core = chain[chain.length - 1];
  const shape = objectShapeOf(core);
  if (shape) {
    const literals = new Map<string, readonly unknown[]>();
    for (const [key, field] of Object.entries(shape)) {
      const values = literalValuesOf(field);
      if (values) literals.set(key, values);
    }
    return [{ literals, keys: new Set(Object.keys(shape)) }];
  }
  const def = zodDefOf(core) as { type?: string; options?: unknown[] } | undefined;
  if (def?.type === 'union' && Array.isArray(def.options)) return def.options.flatMap(declaredKindsOf);
  return [];
}

/** Read once, on first use: the union is a lazy schema and is not evaluated at module load. */
let declaredAuthKinds: DeclaredAuthKind[] | undefined;
function authKinds(): DeclaredAuthKind[] {
  declaredAuthKinds ??= declaredKindsOf(ConnectorInstanceAuthSchema);
  return declaredAuthKinds;
}

/**
 * The keys an `auth` value may carry: the union of the keys of every kind its
 * literal keys select. The candidates are the kinds whose `type` accepts the
 * value's `type`; each other literal key the value carries (`grant`, `scheme`)
 * narrows them to the kinds that accept its value — and narrows nothing when no
 * candidate does, so an unknown `grant` or `scheme` keeps the keys its kind's
 * siblings declare. No candidate ⇒ `type` alone.
 */
export function declaredConnectorAuthKeys(auth: Record<string, unknown>): ReadonlySet<string> {
  let candidates = authKinds().filter((kind) => kind.literals.get('type')?.includes(auth.type) === true);
  const narrowingKeys = new Set(candidates.flatMap((kind) => [...kind.literals.keys()]));
  narrowingKeys.delete('type');
  for (const key of narrowingKeys) {
    if (!Object.prototype.hasOwnProperty.call(auth, key)) continue;
    const accepting = candidates.filter((kind) => kind.literals.get(key)?.includes(auth[key]) === true);
    if (accepting.length > 0) candidates = accepting;
  }
  const declared = new Set<string>(['type']);
  for (const kind of candidates) for (const key of kind.keys) declared.add(key);
  return declared;
}

/** A position holding nothing: served as written, never reported. */
function isClearedForm(value: unknown): boolean {
  return value === undefined || value === null || value === '' || (isPlainRecord(value) && Object.keys(value).length === 0);
}

/** `item` with the key at `path` removed, copying each container on the way; the input is never touched. */
function withoutKeyAt(item: Record<string, unknown>, path: readonly string[]): Record<string, unknown> {
  const [head, ...rest] = path as [string, ...string[]];
  if (rest.length === 0) {
    const { [head]: _withheld, ...kept } = item;
    return kept;
  }
  return { ...item, [head]: withoutKeyAt(item[head] as Record<string, unknown>, rest) };
}

/** The value at `path` in `item`, and whether its parent is a plain object holding the key. */
function readAt(item: Record<string, unknown>, path: readonly string[]): { present: boolean; value: unknown } {
  let parent: unknown = item;
  for (const key of path.slice(0, -1)) parent = isPlainRecord(parent) ? parent[key] : undefined;
  const leaf = path[path.length - 1] as string;
  if (!isPlainRecord(parent) || !Object.prototype.hasOwnProperty.call(parent, leaf)) return { present: false, value: undefined };
  return { present: true, value: parent[leaf] };
}

/** Every credential position present in `item` that is withheld by removal, as item-relative paths. */
function credentialPathsOf(item: Record<string, unknown>): string[][] {
  const paths: string[][] = [];
  const auth = item.auth;
  if (isPlainRecord(auth)) {
    const declared = declaredConnectorAuthKeys(auth);
    for (const key of Object.keys(auth)) if (!declared.has(key)) paths.push(['auth', key]);
  } else {
    // Item 4: not an object, so withheld whole (a cleared form is skipped by the caller).
    paths.push(['auth']);
  }
  const authentication = item.authentication;
  if (isPlainRecord(authentication)) {
    for (const key of Object.keys(authentication)) if (key !== 'type') paths.push(['authentication', key]);
  } else {
    paths.push(['authentication']);
  }
  for (const path of CONNECTOR_CREDENTIAL_MAP_PATHS) paths.push([...path]);
  return paths;
}

/** `item` with the value at `path` replaced, copying each container on the way; the input is never touched. */
function withValueAt(item: Record<string, unknown>, path: readonly string[], value: unknown): Record<string, unknown> {
  const [head, ...rest] = path as [string, ...string[]];
  if (rest.length === 0) return { ...item, [head]: value };
  return { ...item, [head]: withValueAt(item[head] as Record<string, unknown>, rest, value) };
}

/**
 * Item 5: every URL under `providerConfig`, at object depth, whose credential
 * parts {@link redactConnectorUrl} removes — the path and the rewritten value.
 */
function credentialUrlRewritesOf(
  item: Record<string, unknown>,
): Array<{ path: string[]; value: string }> {
  const rewrites: Array<{ path: string[]; value: string }> = [];
  const providerConfig = item.providerConfig;
  if (!isPlainRecord(providerConfig)) return rewrites;
  const params = credentialQueryParamsOf(item);
  const walk = (node: Record<string, unknown>, prefix: readonly string[]): void => {
    for (const [key, value] of Object.entries(node)) {
      if (key.includes('.')) continue;
      const path = [...prefix, key];
      if (typeof value === 'string') {
        if (!URL_SCHEME_RE.test(value)) continue;
        const redacted = redactConnectorUrl(value, params);
        if (redacted !== value) rewrites.push({ path, value: redacted });
      } else if (isPlainRecord(value)) {
        walk(value, path);
      }
    }
  };
  walk(providerConfig, ['providerConfig']);
  return rewrites;
}

/**
 * The built-in `connector` redactor: withholds the positions the module note
 * lists, names each in `redactedKeys` (dotted, sorted), and returns the input
 * by reference when there is nothing to withhold.
 */
export function redactConnectorItem(item: Record<string, unknown>): MetadataRedactionResult {
  let served = item;
  const redactedKeys: string[] = [];
  for (const path of credentialPathsOf(item)) {
    const { present, value } = readAt(served, path);
    if (!present || isClearedForm(value)) continue;
    served = withoutKeyAt(served, path);
    redactedKeys.push(path.join('.'));
  }
  // After the removals, so a map withheld whole is never walked for URLs.
  for (const { path, value } of credentialUrlRewritesOf(served)) {
    served = withValueAt(served, path, value);
    redactedKeys.push(path.join('.'));
  }
  if (redactedKeys.length === 0) return { item, redactedKeys: [] };
  return { item: served, redactedKeys: redactedKeys.sort() };
}
