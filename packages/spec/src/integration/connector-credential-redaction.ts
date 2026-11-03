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
 *
 *     **Withheld and NOT carried forward** (#28640 ②B, ruling 6566912252):
 *     each such position is named in `notCarriedForwardKeys` as well as in
 *     `redactedKeys`. Every instance-auth kind is a strict shape, so the save
 *     door refuses an undeclared `auth` key whatever its value, and nothing at
 *     runtime reads one: a stored value there is cleartext a row written
 *     before the shapes went strict still holds, and keeping it through a save
 *     keeps nothing but the exposure. So a save of the served form drops it,
 *     and the save names each key it dropped. For the same reason a CLEARED
 *     value (`null`, `''`, an empty map) is withheld here too, unlike the
 *     credential positions below: serving it back would make a plain read then
 *     save meet the strict shape's refusal.
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
 *  5. **The credential parts of every URL under `providerConfig` and
 *     `auth`** — rewritten, not removed: the userinfo (`https://user:pass@host`, and the
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
 *     an OBJECT depth of `providerConfig`; and the endpoints an instance-auth
 *     kind declares (`auth.tokenUrl`, `auth.authorizationUrl`, `auth.resource`)
 *     and any URL a kind declares later. A string is judged when it starts
 *     with `scheme://`. What a credential part is, and the walk that finds
 *     every URL holding one, live in ONE place,
 *     `./connector-url-credentials.ts`, which the write door's refinement
 *     runs too: an authored URL holding one is refused, so only a row stored
 *     before that refusal can carry one to this read.
 *  6. **An array under `providerConfig` or `auth` that holds such a URL,
 *     WHOLE**, and **a key under them whose own name carries a dot that holds
 *     such a URL at any depth, WHOLE.** The carry-forward cannot address an
 *     array element by position, nor a dotted key segment by segment (its
 *     dotted name is indistinguishable from a nested path once `redactedKeys`
 *     joins on dots), so neither is rewritten in place; each is withheld whole
 *     instead, as a non-object `auth` is (item 4), and the carry-forward keeps
 *     the stored value at rest by the whole-string fallback the protocol's
 *     carry-forward runs when the dotted split resolves to nothing. This is
 *     item 5's "avoid silent deletion" yielding to item 7's fail-closed: a
 *     dotted position that cannot be rewritten part-for-part is withheld
 *     rather than served as stored. An array or dotted key holding no such URL
 *     is served as stored.
 *  7. **Every top-level key the authored entry does not declare, WHOLE —
 *     whatever its value.** The save door stores the body it accepts (ADR-0005
 *     appendix (c), ruling B), so a row stored while the entry was open can
 *     hold a key no declared position names — and a key no position names is
 *     one this redactor cannot judge. The declared keys are read from
 *     {@link DeclarativeConnectorEntrySchema} itself (its read-through
 *     `shape`), so a key the entry declares later is served with nothing to
 *     edit here. The read decorations ({@link METADATA_READ_DECORATIONS}) are
 *     the response's, not the entry's, and are left alone. Unlike the
 *     credential positions above, a CLEARED undeclared key (`null`, `''`, an
 *     empty map) is withheld too, not served: the closed entry refuses the key
 *     at the save door, so serving its cleared form back makes a plain read
 *     then save meet that refusal. The carry-forward keeps the stored value
 *     (its dotted name included, by the whole-string fallback).
 *  8. **Every key the two nested shapes the entry declares do not declare,
 *     WHOLE — whatever its value: inside `retryConfig`, and inside each
 *     element of `actions`.** A key no declared position names is one this
 *     redactor cannot judge, and nothing reads it. The declared keys are read
 *     from {@link RetryConfigSchema} and {@link ConnectorActionSchema}
 *     themselves. An `actions` element is addressed by its index
 *     (`actions.<i>.<key>`), which the carry-forward resolves to the element's
 *     own `key`, so a save of a reordered list keeps each element's stored
 *     value on that element. A `retryConfig` that is not an object, and an
 *     `actions` that is not an array or holds an element that is not an
 *     object, are withheld WHOLE (a cleared form excepted), as a non-object
 *     `auth` is (item 4): the entry refuses each at every authoring door, so
 *     only a row stored outside them carries one, and nothing in it can be
 *     judged. An element is never removed on its own, which would shift every
 *     later index; the carry-forward keeps the stored value at rest.
 *
 *     **A key inside an object `retryConfig`: withheld and NOT carried
 *     forward** (the maintainer's ruling 6593804783): each is named in
 *     `notCarriedForwardKeys` as well as in `redactedKeys`, as item 1's are.
 *     The authored `retryConfig` is closed, so every door refuses such a key,
 *     and nothing at runtime reads one: the instance materialization parses
 *     the stored policy with the open {@link RetryConfigSchema}, which drops
 *     it, and hands the provider only the parsed policy. So a save that sends
 *     `retryConfig` — the served form, `{}`, any object — replaces the stored
 *     container whole, and the save names each key it dropped; a save that
 *     leaves `retryConfig` out removes the container, as it always did. An
 *     `actions` element's key, and a `retryConfig` that is not an object
 *     (withheld whole), stay carried forward.
 *
 * ## Cleared forms, and what is never touched
 *
 * A position holding nothing — `null`, `''`, or an empty map — is served as
 * written and not reported, as the schema derivation serves its cleared forms:
 * a reader can tell "cleared" from "withheld". The undeclared keys (items 1, 7
 * and 8) are the exception, each for the reason its item gives: no door
 * accepts them, so their cleared forms are withheld too. Every other key of the item is
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
import { ConnectorActionSchema, DeclarativeConnectorEntrySchema, RetryConfigSchema } from './connector.zod';
import { METADATA_READ_DECORATIONS } from '../kernel/metadata-read-decorations';
import { redactUrlCredentialQueryParams } from '../data/datasource-credential-redaction';
import {
  CONNECTOR_CREDENTIAL_MAP_PATHS,
  CONNECTOR_CREDENTIAL_URL_QUERY_PARAM_NAMES,
  URL_USERINFO_RE,
  connectorCredentialQueryParamsOf,
  connectorUrlCredentialPositionOf,
  findConnectorUrlCredentials,
} from './connector-url-credentials';
import { objectShapeOf, wrapperChainOf, zodDefOf } from '../kernel/metadata-credential-fields';
import type { MetadataRedactionResult } from '../kernel/metadata-type-redaction';

/** The map positions under `providerConfig` withheld whole (see the module note, item 3). */
export { CONNECTOR_CREDENTIAL_MAP_PATHS };

/**
 * The query parameters whose value a connector URL is read as carrying a
 * credential in (see the module note, item 5) — declared once, beside the
 * walk the write door shares (`./connector-url-credentials.ts`). A name here
 * that holds no secret on some API costs that API's served URL the parameter,
 * never its stored value: the carry-forward keeps it on a save of the served
 * form.
 */
export { CONNECTOR_CREDENTIAL_URL_QUERY_PARAM_NAMES };

/** One URL with its userinfo and credential query parameters removed; the input when there is none. */
function redactConnectorUrl(value: string, params: readonly string[]): string {
  return redactUrlCredentialQueryParams(value.replace(URL_USERINFO_RE, '$1'), params);
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

/** The child at `segment`: a key of a plain object, or an index of an array (item 8's `actions` hop). */
function childAt(node: unknown, segment: string): unknown {
  if (isPlainRecord(node)) return node[segment];
  if (Array.isArray(node) && /^(0|[1-9][0-9]*)$/.test(segment)) return node[Number(segment)];
  return undefined;
}

/**
 * `node` with the key at `path` removed, copying each container on the way (an
 * array hop copies the array); the input is never touched.
 */
function withoutKeyAt<T>(node: T, path: readonly string[]): T {
  const [head, ...rest] = path as [string, ...string[]];
  if (Array.isArray(node)) {
    const copy = node.slice();
    copy[Number(head)] = withoutKeyAt(node[Number(head)], rest);
    return copy as T;
  }
  const record = node as Record<string, unknown>;
  if (rest.length === 0) {
    const { [head]: _withheld, ...kept } = record;
    return kept as T;
  }
  return { ...record, [head]: withoutKeyAt(record[head], rest) } as T;
}

/** The value at `path` in `item`, and whether its parent is a plain object holding the key. */
function readAt(item: Record<string, unknown>, path: readonly string[]): { present: boolean; value: unknown } {
  let parent: unknown = item;
  for (const key of path.slice(0, -1)) parent = childAt(parent, key);
  const leaf = path[path.length - 1] as string;
  if (!isPlainRecord(parent) || !Object.prototype.hasOwnProperty.call(parent, leaf)) return { present: false, value: undefined };
  return { present: true, value: parent[leaf] };
}

/**
 * Read once, on first use: the top-level keys the authored entry declares
 * (item 7). The entry is a lazy schema and is not evaluated at module load; its
 * read-through `shape` is the closed entry's own declaration.
 */
let declaredEntryKeys: ReadonlySet<string> | undefined;
export function declaredConnectorEntryKeys(): ReadonlySet<string> {
  if (!declaredEntryKeys) {
    const shape = (DeclarativeConnectorEntrySchema as unknown as { shape?: unknown }).shape;
    // No readable shape ⇒ nothing is declared, and every key is withheld: fail closed.
    declaredEntryKeys = new Set(isPlainRecord(shape) ? Object.keys(shape) : []);
  }
  return declaredEntryKeys;
}

const READ_DECORATION_KEYS: ReadonlySet<string> = new Set(METADATA_READ_DECORATIONS);

/**
 * Item 7: every top-level key the entry does not declare, as item-relative
 * single-segment paths. The read decorations ({@link METADATA_READ_DECORATIONS})
 * are the response's, not the entry's, and are never counted. Withheld whole
 * regardless of value — a cleared one included — unlike the credential
 * positions below: an undeclared key the entry refuses can never be served, so
 * serving its cleared form back makes a plain GET then PUT meet the closed save
 * door. The carry-forward keeps the stored value at rest.
 */
function undeclaredRootKeysOf(item: Record<string, unknown>): string[][] {
  const declared = declaredConnectorEntryKeys();
  const paths: string[][] = [];
  for (const key of Object.keys(item)) {
    if (!declared.has(key) && !READ_DECORATION_KEYS.has(key)) paths.push([key]);
  }
  return paths;
}

/** Read once, on first use: the keys item 8's two nested shapes declare (the schemas are lazy). */
let declaredNestedKeys: { retryConfig: ReadonlySet<string>; action: ReadonlySet<string> } | undefined;
function nestedKeys(): { retryConfig: ReadonlySet<string>; action: ReadonlySet<string> } {
  // No readable shape ⇒ nothing is declared, and every nested key is withheld: fail closed.
  declaredNestedKeys ??= {
    retryConfig: new Set(Object.keys(objectShapeOf(RetryConfigSchema) ?? {})),
    action: new Set(Object.keys(objectShapeOf(ConnectorActionSchema) ?? {})),
  };
  return declaredNestedKeys;
}

/**
 * Item 8, the carried-forward half: every key each `actions` element does not
 * declare, as item-relative paths (an `actions` hop is the element's index),
 * or the container itself when `retryConfig` or `actions` is not the shape the
 * entry declares. The keys of an object `retryConfig` are
 * {@link undeclaredRetryConfigKeysOf}'s.
 */
function undeclaredNestedKeysOf(item: Record<string, unknown>): string[][] {
  const declared = nestedKeys();
  const paths: string[][] = [];
  const retryConfig = item.retryConfig;
  if (!isPlainRecord(retryConfig) && !isClearedForm(retryConfig)) paths.push(['retryConfig']);
  const actions = item.actions;
  if (Array.isArray(actions) && actions.every(isPlainRecord)) {
    actions.forEach((action, index) => {
      for (const key of Object.keys(action)) if (!declared.action.has(key)) paths.push(['actions', String(index), key]);
    });
  } else if (!isClearedForm(actions)) {
    // Not an array, or an element is not an object: withheld whole (an element
    // removed on its own would shift every later index).
    paths.push(['actions']);
  }
  return paths;
}

/**
 * Item 8, the half NOT carried forward: every key an object `retryConfig`
 * does not declare, as item-relative paths — withheld whatever its value (see
 * the module note). `[]` when `retryConfig` is not an object
 * ({@link undeclaredNestedKeysOf} withholds that whole, carried forward).
 */
function undeclaredRetryConfigKeysOf(item: Record<string, unknown>): string[][] {
  const retryConfig = item.retryConfig;
  if (!isPlainRecord(retryConfig)) return [];
  const declared = nestedKeys().retryConfig;
  return Object.keys(retryConfig).filter((key) => !declared.has(key)).map((key) => ['retryConfig', key]);
}

/**
 * Item 1: every key the item's instance-auth kind does not declare, as
 * item-relative paths — withheld whatever its value, and not carried forward
 * (see the module note). `[]` when `auth` is not an object (item 4 judges that).
 */
function undeclaredAuthKeysOf(item: Record<string, unknown>): string[][] {
  const auth = item.auth;
  if (!isPlainRecord(auth)) return [];
  const declared = declaredConnectorAuthKeys(auth);
  return Object.keys(auth).filter((key) => !declared.has(key)).map((key) => ['auth', key]);
}

/** Every other credential position present in `item` that is withheld by removal, as item-relative paths. */
function credentialPathsOf(item: Record<string, unknown>): string[][] {
  const paths: string[][] = [];
  // Item 4: `auth` that is not an object is withheld whole (a cleared form is
  // skipped by the caller); an object `auth` is item 1's, judged key by key.
  if (!isPlainRecord(item.auth)) paths.push(['auth']);
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
 * Items 5 and 6: every URL the write door's own walk returns
 * ({@link findConnectorUrlCredentials} — the one traversal both doors run), at
 * the position {@link connectorUrlCredentialPositionOf} names. A URL reached
 * through object keys alone is rewritten in place — the path and the value
 * {@link redactConnectorUrl} leaves. An array holding such a URL, and a key
 * whose own name carries a dot holding one at any depth, cannot be addressed
 * part for part, so each is withheld WHOLE (`value` absent), once however many
 * URLs it holds: fail closed, and the carry-forward keeps the stored value at
 * rest by the whole-string fallback. Item 5's "avoid silent deletion" yields to
 * item 7's fail-closed there.
 */
function credentialUrlRewritesOf(
  item: Record<string, unknown>,
): Array<{ path: string[]; value?: string }> {
  const rewrites: Array<{ path: string[]; value?: string }> = [];
  const withheld = new Set<string>();
  const params = connectorCredentialQueryParamsOf(item);
  for (const found of findConnectorUrlCredentials(item)) {
    const position = connectorUrlCredentialPositionOf(found.path);
    if (position.rewrite) {
      rewrites.push({ path: position.path, value: redactConnectorUrl(found.url, params) });
      continue;
    }
    const key = JSON.stringify(position.path);
    if (withheld.has(key)) continue;
    withheld.add(key);
    rewrites.push({ path: position.path });
  }
  return rewrites;
}

/**
 * The built-in `connector` redactor: withholds the positions the module note
 * lists, names each in `redactedKeys` (dotted, sorted) and item 1's and an
 * object `retryConfig`'s undeclared keys in `notCarriedForwardKeys` too, and
 * returns the input by reference when there is nothing to withhold.
 */
export function redactConnectorItem(item: Record<string, unknown>): MetadataRedactionResult {
  let served = item;
  const redactedKeys: string[] = [];
  const notCarriedForwardKeys: string[] = [];
  // Items 7 and 8, first: an undeclared key is withheld whatever its value —
  // a cleared one included — because nothing can judge it.
  for (const path of [...undeclaredRootKeysOf(item), ...undeclaredNestedKeysOf(item)]) {
    const { present } = readAt(served, path);
    if (!present) continue;
    served = withoutKeyAt(served, path);
    redactedKeys.push(path.join('.'));
  }
  // Item 1, and item 8's keys of an object `retryConfig`: an undeclared key,
  // whatever its value, withheld and not carried forward — a save of the
  // served form drops it.
  for (const path of [...undeclaredRetryConfigKeysOf(item), ...undeclaredAuthKeysOf(item)]) {
    const { present } = readAt(served, path);
    if (!present) continue;
    served = withoutKeyAt(served, path);
    redactedKeys.push(path.join('.'));
    notCarriedForwardKeys.push(path.join('.'));
  }
  for (const path of credentialPathsOf(item)) {
    const { present, value } = readAt(served, path);
    if (!present || isClearedForm(value)) continue;
    served = withoutKeyAt(served, path);
    redactedKeys.push(path.join('.'));
  }
  // After the removals, so a map withheld whole is never walked for URLs.
  for (const { path, value } of credentialUrlRewritesOf(served)) {
    served = value === undefined ? withoutKeyAt(served, path) : withValueAt(served, path, value);
    redactedKeys.push(path.join('.'));
  }
  if (redactedKeys.length === 0) return { item, redactedKeys: [] };
  return {
    item: served,
    redactedKeys: redactedKeys.sort(),
    // Set only when it names a position: absent means none (the contract's own reading).
    ...(notCarriedForwardKeys.length > 0 ? { notCarriedForwardKeys: notCarriedForwardKeys.sort() } : {}),
  };
}
