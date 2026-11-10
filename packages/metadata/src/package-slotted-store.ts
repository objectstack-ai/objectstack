// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * # The in-memory store's slot for a by-package type (ADR-0150 D3/D4)
 *
 * `MetadataManager` keeps its in-memory items as `type → key → item`. For
 * every type the key is the item's name — except a type listed in
 * {@link PACKAGE_SLOTTED_STORE_TYPES}, whose items are addressed by
 * `(package, name)`: each package's item has its own slot, so one package's
 * item can never overwrite another package's same-named item before any
 * reader sees it.
 *
 * The rules live here, once, and the manager asks them at every seam that
 * writes, reads, enumerates or removes a stored item:
 *
 *  - **write** ({@link storeWriteKey}): an item that carries its package
 *    (`packageId` on its stored envelope, or the registry's `_packageId`
 *    stamp) fills that package's slot. An item that carries none, under a
 *    name exactly one package holds here, is that holder's customization
 *    (D4: a package-less row bearing a package-held name is never a second
 *    item) and fills the holder's slot; otherwise it fills the name's bare
 *    slot, the environment's own item (D1 bucket 4). A package's item written
 *    while the name has only a bare slot replaces it, as the bare-name map did.
 *    With one holder per name the store therefore holds exactly the one item
 *    the bare-name map held.
 *  - **read** ({@link readStoreEntry}): a read naming a package is that
 *    package's slot — ⛔ never another package's item; a read naming none is
 *    D3 for a caller with no package (`@objectstack/core`'s one rule): the
 *    environment's own item, else the unique holder, else a refusal naming
 *    every holder ({@link PackageScopedNameRefusedError}, `409`).
 *  - **enumerate / remove**: every slot of a name answers to that name
 *    ({@link storedNameOf}, {@link storeKeysNamed}).
 *
 * ⛔ `api`'s endpoint matcher keys its routes by METHOD + path (bucket 1);
 * nothing here resolves a path. What changes is that the matcher now sees
 * every package's endpoint instead of the last one registered under a name.
 *
 * ## Which types
 *
 * `api` (#32069), and every type whose one-holder rule has narrowed to the
 * namespace — objectql's `NAMESPACE_SCOPED_BARE_NAME_TYPES`, today `agent` and
 * `skill` (#31701). Two packages of two namespaces may each install such a
 * name, so a store keyed by bare name would keep whichever registered last:
 * the artifact door registers every package body's items here, and a read
 * naming the other package (`get(type, name, packageId)`, the `/meta` code
 * layer) was served the survivor. ⛔ A type joins the narrowed set only in the
 * same change that adds it here: objectql pins the superset
 * (`registry-bare-name-one-holder-ai-family.test.ts`), since this package
 * cannot import objectql (objectql depends on it).
 */

import {
  PackageScopedNameRefusedError,
  packageScopedHolderSource,
  resolvePackageScopedHolders,
  type PackageScopedResolvableType,
} from '@objectstack/core';
import { peelStoredEnvelope } from './stored-envelope.js';

/**
 * The types whose in-memory items are stored per `(package, name)`: `api`,
 * then every namespace-scoped type (#32151, #31697; see "Which types" above).
 */
export const PACKAGE_SLOTTED_STORE_TYPES: ReadonlySet<string> = new Set(['api', 'agent', 'skill', 'action']);

/** The provenance sentinel a rehydrated row carries in place of a package. */
const OVERLAY_SENTINEL = 'sys_metadata';

const SLOT_SEPARATOR = '\u0000';

/** The store key of `packageId`'s item of `name`. */
function slotKey(packageId: string, name: string): string {
  return `${packageId}${SLOT_SEPARATOR}${name}`;
}

/** The name a store key addresses: the key itself, or the name of a package slot. */
export function storedNameOf(key: string): string {
  const at = key.indexOf(SLOT_SEPARATOR);
  return at === -1 ? key : key.slice(at + 1);
}

/** The package of a package slot's key; `undefined` for a bare key. */
function slotPackageOf(key: string): string | undefined {
  const at = key.indexOf(SLOT_SEPARATOR);
  return at === -1 ? undefined : key.slice(0, at);
}

/**
 * [ADR-0150 D4, child E6] The package a stored or registered item carries:
 * its stored envelope's `packageId` (flat or under the publish envelope), else
 * the registry's `_packageId` stamp on the body; `undefined` for an item bound
 * to no package (the `sys_metadata` provenance sentinel included).
 */
export function storedItemPackageId(item: unknown): string | undefined {
  const peeled = peelStoredEnvelope(item);
  const fromEnvelope = (peeled.envelope as { packageId?: unknown }).packageId;
  const body = peeled.body as { _packageId?: unknown } | null | undefined;
  const stamped = body && typeof body === 'object' ? body._packageId : undefined;
  for (const candidate of [fromEnvelope, stamped]) {
    if (typeof candidate === 'string' && candidate !== '' && candidate !== OVERLAY_SENTINEL) return candidate;
  }
  return undefined;
}

/** Every key of `store` addressing `name`: its bare slot and each package's slot. */
export function storeKeysNamed(store: ReadonlyMap<string, unknown> | undefined, type: string, name: string): string[] {
  if (!store) return [];
  if (!PACKAGE_SLOTTED_STORE_TYPES.has(type)) return store.has(name) ? [name] : [];
  return [...store.keys()].filter((key) => storedNameOf(key) === name);
}

/** The packages holding a slot of `name`, in the store's order. */
function packageSlotsOf(store: ReadonlyMap<string, unknown>, name: string): string[] {
  const holders: string[] = [];
  for (const key of store.keys()) {
    const packageId = slotPackageOf(key);
    if (packageId !== undefined && storedNameOf(key) === name) holders.push(packageId);
  }
  return holders;
}

/**
 * Where a write of `(type, name, data)` lands: the key it fills, and the keys
 * it replaces besides that one (the bare slot a package's first item takes
 * over). See the module doc's **write** rule.
 */
export function storeWriteKey(
  store: ReadonlyMap<string, unknown> | undefined,
  type: string,
  name: string,
  data: unknown,
): { key: string; replaces: string[] } {
  if (!PACKAGE_SLOTTED_STORE_TYPES.has(type) || !store) {
    const packageId = PACKAGE_SLOTTED_STORE_TYPES.has(type) ? storedItemPackageId(data) : undefined;
    return { key: packageId === undefined ? name : slotKey(packageId, name), replaces: [] };
  }
  const holders = packageSlotsOf(store, name);
  const packageId = storedItemPackageId(data);
  if (packageId === undefined) {
    return { key: holders.length === 1 ? slotKey(holders[0]!, name) : name, replaces: [] };
  }
  const others = holders.filter((holder) => holder !== packageId);
  return { key: slotKey(packageId, name), replaces: others.length === 0 && store.has(name) ? [name] : [] };
}

/** Whether a package id names a caller with a package (not empty, not the provenance sentinel). */
function isPackageCaller(packageId: string | null | undefined): packageId is string {
  return typeof packageId === 'string' && packageId !== '' && packageId !== OVERLAY_SENTINEL;
}

/**
 * The in-memory answer to a by-name read of `(type, name)`.
 *
 *  - `{ found: true, data }` — the store answers;
 *  - `{ found: false, settled: false }` — the store holds nothing for the
 *    read, and the loaders are asked as before;
 *  - `{ found: false, settled: true }` — the read names a package and only
 *    OTHER packages hold the name here: no item answers, and no loader's
 *    by-name copy is served in its place (⛔ never another package's item).
 *
 * @throws {PackageScopedNameRefusedError} a read naming no package of a name
 *   two or more packages hold (D3, `ambiguous-in-environment`).
 */
export function readStoreEntry(
  store: ReadonlyMap<string, unknown> | undefined,
  type: string,
  name: string,
  packageId?: string | null,
): { found: true; data: unknown } | { found: false; settled: boolean } {
  if (!store) return { found: false, settled: false };
  if (!PACKAGE_SLOTTED_STORE_TYPES.has(type)) {
    return store.has(name) ? { found: true, data: store.get(name) } : { found: false, settled: false };
  }
  const holders = packageSlotsOf(store, name);
  if (holders.length === 0) {
    return store.has(name) ? { found: true, data: store.get(name) } : { found: false, settled: false };
  }
  if (isPackageCaller(packageId)) {
    return holders.includes(packageId)
      ? { found: true, data: store.get(slotKey(packageId, name)) }
      : { found: false, settled: true };
  }
  const resolution = resolvePackageScopedHolders(
    { type: type as PackageScopedResolvableType, name, callerPackageId: null },
    packageScopedHolderSource(holders.map((holder) => [holder, store.get(slotKey(holder, name))] as const)),
    () => new Set<string>(),
  );
  if (resolution.status === 'refused') throw new PackageScopedNameRefusedError(resolution);
  return resolution.status === 'resolved' ? { found: true, data: resolution.item } : { found: false, settled: false };
}
