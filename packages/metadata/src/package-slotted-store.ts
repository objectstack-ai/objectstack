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
 * [#32246] The loaders under the registry hold these types by the same rules:
 * the artifact door's `MemoryLoader` under these keys, `DatabaseLoader` one
 * row per `(package, name)`; and a read the registry cannot answer reads the
 * loaders' stored items of the name through {@link readStoreEntry}
 * ({@link slotStoreOf}). A loader's own unscoped read still answers the item
 * of a name written last ({@link lastWrittenOf}), as it did.
 *
 * [#32517] A bundled type (`isBundledStoreType`: `email_template`, one member
 * per `locale`) holds several members in one slot, as `DatabaseLoader` holds a
 * row per member since #32214: each member has its own key under its slot
 * ({@link memberKeyOf}; the canonical member keeps the slot's own key), so a
 * second locale of one package's item never overwrites the first. The slot
 * rules above count SLOTS, never members: one package's two locales are one
 * holder (no D3 refusal), a package-less member under a one-holder name is
 * that holder's member (D4), a removal naming a package drops every member of
 * its slot, and a read of a slot answers its member written last.
 *
 * ⛔ `api`'s endpoint matcher keys its routes by METHOD + path (bucket 1);
 * nothing here resolves a path. What changes is that the matcher now sees
 * every package's endpoint instead of the last one registered under a name.
 *
 * ## Which types
 *
 * `api` (#32069), and every type whose one-holder rule has narrowed to the
 * namespace — objectql's `NAMESPACE_SCOPED_BARE_NAME_TYPES`, today `agent`,
 * `skill` (#31701), `action` (#31697, below) and `email_template` (#31699).
 * Two packages of two namespaces may each install such a name, so a store keyed by bare name would keep whichever registered last:
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
 * map answered — when one package holds every one of them; it refuses when
 * one identity among them is itself a two-holder name, and [#32244] when the
 * name's owners belong to two or more packages, naming each package with its
 * object ({@link readStoreEntry}).
 *
 * `permission` (#32162): two packages of two namespaces may each ship a
 * permission set of one name once its one-holder rule narrows (#31698), and
 * the security registrars write each package's set here — the artifact door
 * stamped with `_packageId`, the stack registrar (`AppPlugin`) likewise for
 * this type — so a read naming one package (`/meta/permission/NAME?package=`)
 * is served that package's grants, never the set registered last.
 */

import {
  PackageScopedNameRefusedError,
  packageScopedActionOwnersSentence,
  packageScopedHolderSource,
  packageScopedRefusalMessage,
  resolvePackageScopedHolders,
  type PackageScopedRefusal,
  type PackageScopedResolvableType,
} from '@objectstack/core';
import { ITEM_KEY_DISCRIMINATORS, itemDiscriminator } from '@objectstack/metadata-core';
import { peelStoredEnvelope } from './stored-envelope.js';

/**
 * The types whose in-memory items are stored per `(package, name)`: `api`,
 * then every namespace-scoped type (#32151, #31697; see "Which types" above):
 * `agent`, `skill`, the object-less `action`, and `email_template` (#31699,
 * ADR-0150 child B), which joins in the same change that adds it to
 * `NAMESPACE_SCOPED_BARE_NAME_TYPES`; then `permission` (#32162).
 */
export const PACKAGE_SLOTTED_STORE_TYPES: ReadonlySet<string> = new Set(['api', 'agent', 'skill', 'action', 'email_template', 'permission']);

/** The provenance sentinel a rehydrated row carries in place of a package. */
const OVERLAY_SENTINEL = 'sys_metadata';

const SLOT_SEPARATOR = '\u0000';

/** Between an action's owning object and its name in a slot identity. */
const OWNER_SEPARATOR = '\u0001';

/** [#32517] Between a slot and a bundled type's non-canonical member in a store key. */
const MEMBER_SEPARATOR = '\u0002';

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

/**
 * [#32517] The slot a store key addresses: the key without a bundled type's
 * member — the key itself for every other key.
 */
export function slotOfKey(key: string): string {
  const at = key.indexOf(MEMBER_SEPARATOR);
  return at === -1 ? key : key.slice(0, at);
}

/** [#32517] The member part of a store key (`''` for a slot's own key), to address the same member of another slot. */
export function memberSuffixOf(key: string): string {
  return key.slice(slotOfKey(key).length);
}

/**
 * [#32517] The store key of `data` in `slot`: for a bundled type stored per
 * `(package, name)`, the slot and the member the item holds
 * ({@link storedBundleMemberOf}) — the canonical member keeps the slot's own
 * key, so a one-locale bundle is keyed as before; every other type, the slot.
 */
export function memberKeyOf(type: string, slot: string, data: unknown): string {
  if (!PACKAGE_SLOTTED_STORE_TYPES.has(type) || !isBundledStoreType(type)) return slot;
  const member = storedBundleMemberOf(type, data);
  return member === null || member === undefined ? slot : `${slot}${MEMBER_SEPARATOR}${member}`;
}

/** The identity a store key addresses: the key without its package (and without its member). */
export function keyIdentityOf(key: string): string {
  const slot = slotOfKey(key);
  const at = slot.indexOf(SLOT_SEPARATOR);
  return at === -1 ? slot : slot.slice(at + 1);
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
export function slotPackageOf(key: string): string | undefined {
  const at = key.indexOf(SLOT_SEPARATOR);
  return at === -1 ? undefined : key.slice(0, at);
}

/**
 * [#32246] The store key of `data`, an item of `name` held for `packageId`:
 * that package's slot of the item's identity ({@link slotIdentityOf} — the
 * name, or an object-bound action's object and name), or the identity's bare
 * slot when it is held for no package; [#32517] a bundled type's member keyed
 * under its slot ({@link memberKeyOf}).
 */
export function storeSlotKey(type: string, name: string, packageId: string | null | undefined, data: unknown): string {
  const identity = PACKAGE_SLOTTED_STORE_TYPES.has(type) ? slotIdentityOf(type, name, data) : name;
  return memberKeyOf(type, isPackageCaller(packageId) ? slotKey(packageId, identity) : identity, data);
}

/**
 * [#32246] The key of a `DatabaseLoader` row of `name` held for `packageId`:
 * one slot per `(package, name)`, whatever object an action is bound to
 * (see {@link storeRowWriteKey}).
 */
export function storeRowKey(name: string, packageId: string | null | undefined): string {
  return isPackageCaller(packageId) ? slotKey(packageId, name) : name;
}

/**
 * [ADR-0150 D3/D4, #32246] Loaders' stored items of `name` (one loader's, or
 * every loader's in precedence order), keyed the way the in-memory store keys
 * them ({@link storeSlotKey}), the first item of a slot (a bundled type: of a
 * slot's member) kept. The store's own
 * rule ({@link readStoreEntry}) then answers for the loaders exactly as it
 * answers for the registry, so the rule stays here, once.
 */
export function slotStoreOf<T>(
  type: string,
  name: string,
  items: Iterable<{ readonly packageId?: string; readonly data: T }>,
): Map<string, T> {
  const store = new Map<string, T>();
  for (const { packageId, data } of items) {
    const key = storeSlotKey(type, name, packageId, data);
    if (!store.has(key)) store.set(key, data);
  }
  return store;
}

/**
 * [#32246] The item of `name` written last among every slot of it — what a
 * store keyed by bare name held. The loaders' own unscoped reads (`load`,
 * `loadMany`, `loadManyKeyed`) answer it, as they answered before they kept a
 * slot per package; `undefined` when no slot of the name is held.
 */
export function lastWrittenOf(store: ReadonlyMap<string, unknown> | undefined, type: string, name: string): unknown {
  const keys = storeKeysNamed(store, type, name);
  return keys.length === 0 ? undefined : store!.get(writtenLast(store!, keys));
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

/**
 * [#31699 R3-B, epic ruling 6796068023] A bundled type — one that declares an
 * item-key discriminator (`ITEM_KEY_DISCRIMINATORS`, `@objectstack/metadata-core`:
 * `email_template`'s `locale`) — holds several members under one
 * `(package, name)`, each its own stored row. A loader's unscoped read of
 * such a type keeps one entry per `(package, name, member)`, never one per
 * name or per slot, so no member of a bundle is dropped.
 */
export function isBundledStoreType(type: string): boolean {
  return ITEM_KEY_DISCRIMINATORS[type] !== undefined;
}

/**
 * The bundle member a stored item of `type` holds, spelled as the store's
 * `bundle_member` column spells it (`overlayMemberValue`, metadata-protocol's
 * `migrations/overlay-index.ts`): `null` for the canonical member, the trimmed
 * value for any other, `undefined` for a type that declares no discriminator.
 * A non-empty `column` (the row's `bundle_member`) is read first; else the
 * body declares it (`itemDiscriminator`), a body that declares none being the
 * canonical member.
 */
export function storedBundleMemberOf(type: string, item: unknown, column?: unknown): string | null | undefined {
  const disc = ITEM_KEY_DISCRIMINATORS[type];
  if (!disc) return undefined;
  const declared = typeof column === 'string' && column.trim() !== ''
    ? column.trim()
    : itemDiscriminator(type, peelStoredEnvelope(item).body) ?? '';
  return declared === '' || declared === disc.canonical ? null : declared;
}

/**
 * [#31699 R3-B] The identity an unscoped plural read keeps one entry per, for
 * a bundled type stored per `(package, name)`: `(package, name, member)`, the
 * package being `packageId` else the one the item carries
 * ({@link storedItemPackageId}). `undefined` for every other type, whose
 * unscoped reads keep their own identity.
 */
export function bundleEntryKey(type: string, name: string, data: unknown, packageId?: string): string | undefined {
  if (!PACKAGE_SLOTTED_STORE_TYPES.has(type) || !isBundledStoreType(type)) return undefined;
  return JSON.stringify([packageId ?? storedItemPackageId(data) ?? null, name, storedBundleMemberOf(type, data) ?? null]);
}

/** Every key of `store` addressing `name`: its bare slot and each package's slot. */
export function storeKeysNamed(store: ReadonlyMap<string, unknown> | undefined, type: string, name: string): string[] {
  if (!store) return [];
  if (!PACKAGE_SLOTTED_STORE_TYPES.has(type)) return store.has(name) ? [name] : [];
  return [...store.keys()].filter((key) => storedNameOf(key) === name);
}

/**
 * The packages holding a slot of `identity`, in the store's order, each once
 * ([#32517] a package holding several members of a bundle is one holder).
 */
function packageSlotsOf(store: ReadonlyMap<string, unknown>, identity: string): string[] {
  const holders: string[] = [];
  for (const key of store.keys()) {
    const packageId = slotPackageOf(key);
    if (packageId !== undefined && keyIdentityOf(key) === identity && !holders.includes(packageId)) holders.push(packageId);
  }
  return holders;
}

/** [#32517] Whether `store` holds any member of `slot`. */
function holdsSlot(store: ReadonlyMap<string, unknown>, slot: string): boolean {
  for (const key of store.keys()) if (slotOfKey(key) === slot) return true;
  return false;
}

/** [#32517] Of `slot`'s members in `store`, the key written last ({@link writtenLast}); the slot itself when none is held. */
function latestMemberOf(store: ReadonlyMap<string, unknown>, slot: string): string {
  const members = [...store.keys()].filter((key) => slotOfKey(key) === slot);
  return members.length === 0 ? slot : writtenLast(store, members);
}

/**
 * Where a write of `(type, name, data)` lands: the key it fills, and the keys
 * it replaces besides that one (the bare slot a package's first item takes
 * over). See the module doc's **write** rule. [#32517] A bundled type's
 * member fills its own key under the slot ({@link memberKeyOf}), and a
 * package's first item takes over the bare slot's SAME member only, as
 * `DatabaseLoader` binds the package-less row of the member it writes.
 */
export function storeWriteKey(
  store: ReadonlyMap<string, unknown> | undefined,
  type: string,
  name: string,
  data: unknown,
): { key: string; replaces: string[] } {
  return slottedWriteKey(store, type, name, data, slotIdentityOf(type, name, data), true);
}

/**
 * {@link storeWriteKey} over `identity`; `members` keys a bundled type's
 * member under its slot ({@link memberKeyOf}), off for a store that holds
 * one entry per slot ({@link storeRowWriteKey}).
 */
function slottedWriteKey(
  store: ReadonlyMap<string, unknown> | undefined,
  type: string,
  name: string,
  data: unknown,
  identity: string,
  members: boolean,
): { key: string; replaces: string[] } {
  if (!PACKAGE_SLOTTED_STORE_TYPES.has(type)) return { key: name, replaces: [] };
  const keyed = (slot: string): string => (members ? memberKeyOf(type, slot, data) : slot);
  if (!store) {
    const packageId = storedItemPackageId(data);
    return { key: keyed(packageId === undefined ? identity : slotKey(packageId, identity)), replaces: [] };
  }
  const holders = packageSlotsOf(store, identity);
  const packageId = storedItemPackageId(data);
  if (packageId === undefined) {
    return { key: keyed(holders.length === 1 ? slotKey(holders[0]!, identity) : identity), replaces: [] };
  }
  const others = holders.filter((holder) => holder !== packageId);
  const bare = keyed(identity);
  return { key: keyed(slotKey(packageId, identity)), replaces: others.length === 0 && store.has(bare) ? [bare] : [] };
}

/**
 * [#32246] {@link storeWriteKey} for a store with one slot per `(package,
 * name)` whatever object an action is bound to: `DatabaseLoader`'s rows,
 * which `sys_metadata`'s unique key `(type, name, package_id, bundle_member)`
 * holds once per package of a name.
 */
export function storeRowWriteKey(
  store: ReadonlyMap<string, unknown> | undefined,
  type: string,
  name: string,
  data: unknown,
): { key: string; replaces: string[] } {
  return slottedWriteKey(store, type, name, data, name, false);
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
 *  - **naming a package**: that package's slot only ([#32517] every member
 *    of it); no key when it holds no slot of the name. ⛔ Never another package's item, and never the name's
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
    const slot = slotKey(packageId, name);
    return { keys: storeKeysNamed(store, type, name).filter((key) => slotOfKey(key) === slot), packageId };
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
 * [ADR-0150 D3, #32246 R1/R1b] Refuse a write by name that cannot tell which
 * slot of `name` it means: `store` holds more than one slot of the name — two
 * packages', or a package's beside the name's package-less slot. The refusal
 * names every holder in the store's order (each package, and the environment
 * for the package-less slot), and nothing picks one. `DatabaseLoader`'s
 * rollback by name asks it over the name's rows. [#32517] Slots are counted,
 * never a bundle's members: one slot's two locales are one holder.
 *
 * @throws {PackageScopedNameRefusedError} two or more slots of the name.
 */
export function refuseSeveralSlots(store: ReadonlyMap<string, unknown> | undefined, type: string, name: string): void {
  const keys = [...new Set(storeKeysNamed(store, type, name).map(slotOfKey))];
  if (keys.length <= 1) return;
  const base: Omit<PackageScopedRefusal, 'message'> = {
    status: 'refused',
    reason: 'ambiguous-in-environment',
    type: type as PackageScopedResolvableType,
    name,
    callerPackageId: null,
    candidates: keys.map((key) => {
      const packageId = slotPackageOf(key);
      return packageId === undefined ? { kind: 'environment' as const } : { kind: 'package' as const, packageId };
    }),
  };
  throw new PackageScopedNameRefusedError({ ...base, message: packageScopedRefusalMessage(base) });
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
 * bare-name map did. [#32244] A read naming none whose answers belong to two
 * or more packages is refused instead ({@link refuseAcrossOwners}): it would
 * pick one package's action over another's. [#32517] A slot that holds a
 * bundle's members answers its member written last, as the slot keyed by
 * `(package, name)` alone held it.
 *
 * @throws {PackageScopedNameRefusedError} a read naming no package of a name
 *   two or more packages hold on one identity, or each on its own object
 *   (D3, `ambiguous-in-environment`).
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
  const keys = found.map((answer) => latestMemberOf(store, answer.key));
  if (!isPackageCaller(packageId)) refuseAcrossOwners(store, type, name, keys);
  return { found: true, data: store.get(writtenLast(store, keys)) };
}

/**
 * [ADR-0150 D3, #32244] A read naming no package of an action name that two
 * or more packages each hold on its own object (or one on an object and one
 * object-less): every identity has one holder, so no identity refuses, yet the
 * read cannot see the object and answered the one written last, which is a
 * pick between two packages' actions. Refused here, naming each package with
 * the object it binds the name to (`ambiguous-in-environment`, `409`).
 *
 * One package binding the name to two objects is one holder: the read answers
 * the one written last, as before. A package-less item beside one package's
 * is not two packages, and answers as before too.
 *
 * @throws {PackageScopedNameRefusedError} when `keys` span two or more packages.
 */
function refuseAcrossOwners(store: ReadonlyMap<string, unknown>, type: string, name: string, keys: readonly string[]): void {
  if (!OWNER_KEYED_SLOT_TYPES.has(type) || keys.length < 2) return;
  const objectsOf = new Map<string, Array<string | undefined>>();
  for (const key of keys) {
    const packageId = slotPackageOf(key);
    if (packageId === undefined) continue;
    const objects = objectsOf.get(packageId) ?? [];
    objects.push(boundObjectOf(store.get(key)));
    objectsOf.set(packageId, objects);
  }
  if (objectsOf.size < 2) return;
  const base: Omit<PackageScopedRefusal, 'message'> = {
    status: 'refused',
    reason: 'ambiguous-in-environment',
    type: type as PackageScopedResolvableType,
    name,
    callerPackageId: null,
    candidates: [...objectsOf.keys()].map((packageId) => ({ kind: 'package' as const, packageId })),
  };
  throw new PackageScopedNameRefusedError({
    ...base,
    message: `${packageScopedRefusalMessage(base)} ${packageScopedActionOwnersSentence(objectsOf)}`,
  });
}

/**
 * One identity's answer to a by-name read: the slot that answers, `'settled'`
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
  if (holders.length === 0) return holdsSlot(store, identity) ? { key: identity } : undefined;
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
