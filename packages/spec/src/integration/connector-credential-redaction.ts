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
 */

import { ConnectorInstanceAuthSchema } from '../shared/connector-auth.zod';
import { objectShapeOf, wrapperChainOf, zodDefOf } from '../kernel/metadata-credential-fields';
import type { MetadataRedactionResult } from '../kernel/metadata-type-redaction';

/** The map positions under `providerConfig` withheld whole (see the module note, item 3). */
export const CONNECTOR_CREDENTIAL_MAP_PATHS: readonly (readonly string[])[] = Object.freeze([
  ['providerConfig', 'headers'],
  ['providerConfig', 'defaultHeaders'],
  ['providerConfig', 'transport', 'headers'],
  ['providerConfig', 'transport', 'env'],
]);

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

/** Every credential position present in `item`, as item-relative paths. */
function credentialPathsOf(item: Record<string, unknown>): string[][] {
  const paths: string[][] = [];
  const auth = item.auth;
  if (isPlainRecord(auth)) {
    const declared = declaredConnectorAuthKeys(auth);
    for (const key of Object.keys(auth)) if (!declared.has(key)) paths.push(['auth', key]);
  }
  const authentication = item.authentication;
  if (isPlainRecord(authentication)) {
    for (const key of Object.keys(authentication)) if (key !== 'type') paths.push(['authentication', key]);
  }
  for (const path of CONNECTOR_CREDENTIAL_MAP_PATHS) paths.push([...path]);
  return paths;
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
  if (redactedKeys.length === 0) return { item, redactedKeys: [] };
  return { item: served, redactedKeys: redactedKeys.sort() };
}
