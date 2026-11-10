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
 *  - **enumerate**: every slot of a name answers to that name
 *    ({@link storedNameOf}, {@link storeKeysNamed}).
 *  - **remove** ({@link storeRemovalKeys}): a removal naming a package drops
 *    that package's slot only — ⛔ never another package's item; a removal
 *    naming none drops every slot of the name while at most one package holds
 *    it, and is refused naming every holder when two or more do (D3), so it
 *    never takes both and never picks one.
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
 *
 * `action` (#31697) joins with one difference: an action's identity is
 * `(package, owning object, name)`, not `(package, name)` — two actions of one
 * name bound to two objects are two names that never meet (objectql's
 * `actionOwnerScopedRegistry`). So an action BOUND to an object is slotted by
 * its object and name ({@link slotIdentityOf}); an object-less action by its
 * name alone, exactly as `api`. The D3 refusal fires only among slots of one
 * identity: two packages on the object-less name, or on one object and name.
 * A by-name read that cannot see the object, of a name bound to more than one
 * owner, answers the item written last under the name — what the bare-name
 * map answered — and refuses only if one identity among them is itself a
 * two-holder name ({@link readStoreEntry}).
 */

import {
  PackageScopedNameRefusedError,
  packageScopedHolderSource,
  packageScopedRefusalMessage,
  resolvePackageScopedHolders,
  type PackageScopedRefusal,
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

/** Between an action's owning object and its name in a slot identity. */
const OWNER_SEPARATOR = '\u0001';

/** The types whose slot identity carries the owning object besides the name. */
const OWNER_KEYED_SLOT_TYPES: ReadonlySet<string> = new Set(['action']);

/**
 * The spellings of the object-LESS owner an action may carry: objectql's
 * `GLOBAL_ACTION_OBJECT_KEY` and the legacy wildcard (this package cannot
 * import objectql, which depends on it).
 */
const OBJECT_LESS_OWNERS: ReadonlySet<string> = new Set(['global', '*']);

/** The object an action item is bound to; `undefined` for an object-less one. */
function boundObjectOf(data: unknown): string | undefined {
  const body = peelStoredEnvelope(data).body as { objectName?: unknown; object?: unknown } | null | undefined;
  if (!body || typeof body !== 'object') return undefined;
  for (const owner of [body.objectName, body.object]) {
    if (typeof owner === 'string' && owner !== '') return OBJECT_LESS_OWNERS.has(owner) ? undefined : owner;
  }
  return undefined;
}

/**
 * The identity a write of `(type, name, data)` is slotted under: the name, or,
 * for an action bound to an object, its object and name.
 */
function slotIdentityOf(type: string, name: string, data: unknown): string {
  if (!OWNER_KEYED_SLOT_TYPES.has(type)) return name;
  const owner = boundObjectOf(data);
  return owner === undefined ? name : `${owner}${OWNER_SEPARATOR}${name}`;
}

/** The identity a store key addresses: the key without its package. */
function keyIdentityOf(key: string): string {
  const at = key.indexOf(SLOT_SEPARATOR);
  return at === -1 ? key : key.slice(at + 1);
}

/**
 * [#31697] The order the store's keys were last written in, per store: a
 * by-name read of an action name bound to more than one owner answers the one
 * written last, as the bare-name map did. Recorded by {@link recordStoreWrite}.
 */
const writeOrder = new WeakMap<ReadonlyMap<string, unknown>, Map<string, number>>();
let writeSequence = 0;

/** Record that `key` of `store` was just written ({@link readStoreEntry}'s "written last"). */
export function recordStoreWrite(store: ReadonlyMap<string, unknown>, key: string): void {
  let order = writeOrder.get(store);
  if (!order) writeOrder.set(store, (order = new Map()));
  order.set(key, ++writeSequence);
}

/** Of `keys`, the one written last (the last in the store's order when none was recorded). */
function writtenLast(store: ReadonlyMap<string, unknown>, keys: readonly string[]): string {
  const order = writeOrder.get(store);
  let best = keys[keys.length - 1]!;
  let bestAt = order?.get(best) ?? 0;
  for (const key of keys) {
    const at = order?.get(key) ?? 0;
    if (at > bestAt) { best = key; bestAt = at; }
  }
  return best;
}

/** The store key of `packageId`'s item of `name`. */
function slotKey(packageId: string, name: string): string {
  return `${packageId}${SLOT_SEPARATOR}${name}`;
}

/** The name a store key addresses: the key itself, or the name of a package slot (an action's without its object). */
export function storedNameOf(key: string): string {
  const identity = keyIdentityOf(key);
  const at = identity.lastIndexOf(OWNER_SEPARATOR);
  return at === -1 ? identity : identity.slice(at + 1);
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

/** The packages holding a slot of `identity`, in the store's order. */
function packageSlotsOf(store: ReadonlyMap<string, unknown>, identity: string): string[] {
  const holders: string[] = [];
  for (const key of store.keys()) {
    const packageId = slotPackageOf(key);
    if (packageId !== undefined && keyIdentityOf(key) === identity) holders.push(packageId);
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
  if (!PACKAGE_SLOTTED_STORE_TYPES.has(type)) return { key: name, replaces: [] };
  const identity = slotIdentityOf(type, name, data);
  if (!store) {
    const packageId = storedItemPackageId(data);
    return { key: packageId === undefined ? identity : slotKey(packageId, identity), replaces: [] };
  }
  const holders = packageSlotsOf(store, identity);
  const packageId = storedItemPackageId(data);
  if (packageId === undefined) {
    return { key: holders.length === 1 ? slotKey(holders[0]!, identity) : identity, replaces: [] };
  }
  const others = holders.filter((holder) => holder !== packageId);
  return { key: slotKey(packageId, identity), replaces: others.length === 0 && store.has(identity) ? [identity] : [] };
}

/** Whether a package id names a caller with a package (not empty, not the provenance sentinel). */
function isPackageCaller(packageId: string | null | undefined): packageId is string {
  return typeof packageId === 'string' && packageId !== '' && packageId !== OVERLAY_SENTINEL;
}

/**
 * [ADR-0150 D3/D4, #32198] What a removal of `(type, name)` takes out of the
 * store: the keys it drops, and — for a type stored per `(package, name)`
 * removed by one package — that package, which the storage half deletes by
 * and the `deleted` announcement names.
 *
 *  - **naming a package**: that package's slot only; no key when it holds no
 *    slot of the name. ⛔ Never another package's item, and never the name's
 *    bare slot (the environment's own item, or a customization of a holder).
 *  - **naming none**: every slot of the name while at most one package holds
 *    it — the one item the bare-name map held, removed as it was. With two or
 *    more package holders the removal is refused before anything is touched,
 *    naming every holder ({@link PackageScopedNameRefusedError},
 *    `ambiguous-in-environment`, `409`): it never takes both, and it never
 *    picks one — not even where a read naming no package would resolve to a
 *    unique non-baseline holder, because a removal acts on what it names.
 *
 * A type outside {@link PACKAGE_SLOTTED_STORE_TYPES} keeps one item per name:
 * the name's key, whatever package is named, and no package to delete by.
 *
 * @throws {PackageScopedNameRefusedError} a removal naming no package of a
 *   name two or more packages hold.
 */
export function storeRemovalKeys(
  store: ReadonlyMap<string, unknown> | undefined,
  type: string,
  name: string,
  packageId?: string | null,
): { keys: string[]; packageId?: string } {
  if (!PACKAGE_SLOTTED_STORE_TYPES.has(type)) return { keys: storeKeysNamed(store, type, name) };
  if (isPackageCaller(packageId)) {
    const key = slotKey(packageId, name);
    return { keys: store?.has(key) ? [key] : [], packageId };
  }
  const holders = store ? packageSlotsOf(store, name) : [];
  if (holders.length > 1) {
    const base: Omit<PackageScopedRefusal, 'message'> = {
      status: 'refused',
      reason: 'ambiguous-in-environment',
      type: type as PackageScopedResolvableType,
      name,
      callerPackageId: null,
      candidates: holders.map((holder) => ({ kind: 'package' as const, packageId: holder })),
    };
    throw new PackageScopedNameRefusedError({ ...base, message: packageScopedRefusalMessage(base) });
  }
  return { keys: storeKeysNamed(store, type, name) };
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
 * For an action name bound to more than one owner (two objects, or an object
 * and the object-less key) the read cannot see the object: it answers the slot
 * written last among those it may read (a read naming a package: that
 * package's slots; one naming none: every identity's D3 answer), as the
 * bare-name map did.
 *
 * @throws {PackageScopedNameRefusedError} a read naming no package of a name
 *   two or more packages hold on one identity (D3, `ambiguous-in-environment`).
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
  const identities = [...new Set(storeKeysNamed(store, type, name).map(keyIdentityOf))];
  if (identities.length === 0) return { found: false, settled: false };
  const answers = identities.map((identity) => readIdentity(store, type, name, identity, packageId));
  const found = answers.filter((answer): answer is { key: string } => answer !== undefined && answer !== 'settled');
  if (found.length === 0) {
    return { found: false, settled: answers.some((answer) => answer === 'settled') };
  }
  return { found: true, data: store.get(writtenLast(store, found.map((answer) => answer.key))) };
}

/**
 * One identity's answer to a by-name read: the key that answers, `'settled'`
 * when the read names a package and only other packages hold the identity, or
 * `undefined` when nothing does. See the module doc's **read** rule.
 */
function readIdentity(
  store: ReadonlyMap<string, unknown>,
  type: string,
  name: string,
  identity: string,
  packageId: string | null | undefined,
): { key: string } | 'settled' | undefined {
  const holders = packageSlotsOf(store, identity);
  if (holders.length === 0) return store.has(identity) ? { key: identity } : undefined;
  if (isPackageCaller(packageId)) {
    return holders.includes(packageId) ? { key: slotKey(packageId, identity) } : 'settled';
  }
  const resolution = resolvePackageScopedHolders(
    { type: type as PackageScopedResolvableType, name, callerPackageId: null },
    packageScopedHolderSource(holders.map((holder) => [holder, slotKey(holder, identity)] as const)),
    () => new Set<string>(),
  );
  if (resolution.status === 'refused') throw new PackageScopedNameRefusedError(resolution);
  return resolution.status === 'resolved' ? { key: resolution.item as string } : undefined;
}
