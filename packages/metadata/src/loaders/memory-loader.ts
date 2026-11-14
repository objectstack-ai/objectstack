// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Memory Metadata Loader
 * 
 * Stores metadata in memory only. Changes are lost when process restarts.
 * Useful for testing, temporary overrides, or "dirty" edits.
 *
 * [ADR-0150 D3/D4, #32246] A type stored per `(package, name)`
 * (`PACKAGE_SLOTTED_STORE_TYPES`) is held under the in-memory registry's own
 * keys, by the same rules (`package-slotted-store.ts`): each package's item in
 * its own slot, so the artifact door — which saves every package body's items
 * here — keeps both packages' items of one name instead of the last one
 * saved. `loadSlots` / `loadManySlots` answer every slot; `load`, `loadMany`
 * and `loadManyKeyed` still answer one item per name, the one saved last, as
 * they did. Every other type is held by name, as before.
 *
 * [#31699 R3-B, epic ruling 6796068023] A bundled type (`email_template`)
 * answers `loadMany` / `loadManyKeyed` one entry per `(package, name, member)`,
 * as `DatabaseLoader` does. [#32517] Each member of a slot is saved under its
 * own key (`memberKeyOf`), so a second locale of one package's template no
 * longer overwrites the first: every key is one member.
 */

import type {
  MetadataLoadOptions,
  MetadataLoadResult,
  MetadataStats,
  MetadataLoaderContract,
  MetadataSaveOptions,
  MetadataSaveResult,
} from '@objectstack/spec/system';
import type { MetadataLoader, MetadataKeyedItem, MetadataLoaderDeleteOptions } from './loader-interface.js';
import {
  PACKAGE_SLOTTED_STORE_TYPES,
  isBundledStoreType,
  lastWrittenKeyOf,
  latestMembersFirst,
  lastWrittenOf,
  latestMemberOf,
  recordStoreWrite,
  slotOfKey,
  slotPackageOf,
  storedNameOf,
  storeKeysNamed,
  storeRemovalKeys,
  storeWriteKey,
} from '../package-slotted-store.js';

export class MemoryLoader implements MetadataLoader {
  readonly contract: MetadataLoaderContract = {
    name: 'memory',
    protocol: 'memory:',
    capabilities: {
      read: true,
      write: true,
      watch: false,
      list: true,
    },
  };

  // Storage: Type -> Key -> Data. The key is the name, or for a type stored
  // per `(package, name)` the registry's store key (a package's slot; a
  // bundled type's member under its slot, [#32517]).
  private storage = new Map<string, Map<string, any>>();

  /** [#32246] For a type stored per `(package, name)`: the slot of the name saved last. */
  async load(
    type: string,
    name: string,
    _options?: MetadataLoadOptions
  ): Promise<MetadataLoadResult> {
    const typeStore = this.storage.get(type);
    const data = PACKAGE_SLOTTED_STORE_TYPES.has(type) ? lastWrittenOf(typeStore, type, name) : typeStore?.get(name);

    if (data) {
      return {
        data,
        source: 'memory',
        format: 'json',
        loadTime: 0,
      };
    }

    return { data: null };
  }

  async loadMany<T = any>(
    type: string,
    _options?: MetadataLoadOptions
  ): Promise<T[]> {
    const typeStore = this.storage.get(type);
    if (!typeStore) return [];
    if (PACKAGE_SLOTTED_STORE_TYPES.has(type)) return this.latestByName<T>(type, typeStore).map((entry) => entry.data);
    return Array.from(typeStore.values()) as T[];
  }

  /**
   * [#14205] The keyed half of {@link loadMany}. The storage map is already
   * `Type -> Name -> Data`, so the key this loader holds an item under is the
   * map key — `loadMany()` was simply discarding it, which dropped every
   * nameless body out of `MetadataManager.list()` and out of the endpoint index.
   *
   * The body is handed back by reference, unchanged: the key travels beside it,
   * never folded into it.
   */
  async loadManyKeyed<T = any>(
    type: string,
    _options?: MetadataLoadOptions
  ): Promise<MetadataKeyedItem<T>[]> {
    const typeStore = this.storage.get(type);
    if (!typeStore) return [];
    if (PACKAGE_SLOTTED_STORE_TYPES.has(type)) return this.latestByName<T>(type, typeStore);
    return Array.from(typeStore, ([name, data]) => ({ name, data: data as T }));
  }

  /**
   * [#32246] Every slot of `name`, each with the package it is held for.
   * [#32517] A bundled type's slot hands its member saved last first, as
   * {@link loadManySlots} does, so a reader that keeps a slot's first item
   * answers what the slot answers.
   */
  async loadSlots<T = any>(type: string, name: string): Promise<MetadataKeyedItem<T>[]> {
    const typeStore = this.storage.get(type);
    if (!typeStore) return [];
    return latestMembersFirst(typeStore, storeKeysNamed(typeStore, type, name)).map((key) => keyedSlot<T>(key, typeStore.get(key)));
  }

  /**
   * [#32246] Every slot of every name, each with its name and the package it
   * is held for. [#32517] A bundled type's slot hands its member saved last
   * first (what the slot held before its members had keys of their own),
   * then its other members, slots in the order they were first saved.
   */
  async loadManySlots<T = any>(type: string): Promise<MetadataKeyedItem<T>[]> {
    const typeStore = this.storage.get(type);
    if (!typeStore) return [];
    if (!isBundledStoreType(type)) return Array.from(typeStore, ([key, data]) => keyedSlot<T>(key, data));
    const keys: string[] = [];
    for (const slot of new Set(Array.from(typeStore.keys(), slotOfKey))) {
      const latest = latestMemberOf(typeStore, slot);
      keys.push(latest, ...Array.from(typeStore.keys()).filter((key) => key !== latest && slotOfKey(key) === slot));
    }
    return keys.map((key) => keyedSlot<T>(key, typeStore.get(key)));
  }

  /**
   * [#32517] One entry per `(package, name)` — each package's slot of the
   * name, and the name's package-less slot — in the order they were first
   * saved: the slot of the package saved last (an action bound to several
   * objects by one package is one entry, the binding saved last, as this read
   * answered it before and as `DatabaseLoader`'s unscoped read answers it;
   * {@link loadManySlots} serves every binding), each with the package it is
   * held for. Keyed by name alone, this
   * answered one package's item and folded every other package's away. A
   * package-less slot under a name one package holds is that holder's (D4),
   * so a one-holder name answers its one item saved last, as before.
   * [#31699 R3-B] A bundled type: every key (each slot's every member), each
   * under its name.
   */
  private latestByName<T>(type: string, typeStore: Map<string, any>): MetadataKeyedItem<T>[] {
    if (isBundledStoreType(type)) return Array.from(typeStore, ([key, data]) => ({ name: storedNameOf(key), data: data as T }));
    // [ADR-0150 D4] A package-less slot under a name exactly one package
    // holds is that holder's customization, whatever object an action binds:
    // it folds into the holder's entry, which answers the one saved last.
    const holdersOf = new Map<string, Set<string>>();
    for (const key of typeStore.keys()) {
      const packageId = slotPackageOf(key);
      if (packageId === undefined) continue;
      const name = storedNameOf(key);
      holdersOf.set(name, (holdersOf.get(name) ?? new Set()).add(packageId));
    }
    const held = new Map<string, string[]>();
    for (const key of typeStore.keys()) {
      const name = storedNameOf(key);
      const holders = holdersOf.get(name);
      const holder = slotPackageOf(key) ?? (holders?.size === 1 ? [...holders][0] : undefined);
      const holding = JSON.stringify([holder ?? null, name]);
      held.set(holding, [...(held.get(holding) ?? []), key]);
    }
    return [...held.values()].map((keys) => {
      const latest = lastWrittenKeyOf(typeStore, keys);
      return keyedSlot<T>(latest, typeStore.get(latest));
    });
  }

  async exists(type: string, name: string): Promise<boolean> {
    return storeKeysNamed(this.storage.get(type), type, name).length > 0;
  }

  async stat(type: string, name: string): Promise<MetadataStats | null> {
    if (await this.exists(type, name)) {
      return {
        size: 0, // In-memory
        mtime: new Date().toISOString(),
        format: 'json',
      };
    }
    return null;
  }

  async list(type: string): Promise<string[]> {
    const typeStore = this.storage.get(type);
    if (!typeStore) return [];
    if (!PACKAGE_SLOTTED_STORE_TYPES.has(type)) return Array.from(typeStore.keys());
    return [...new Set(Array.from(typeStore.keys(), storedNameOf))];
  }

  async save(
    type: string,
    name: string,
    data: any,
    _options?: MetadataSaveOptions
  ): Promise<MetadataSaveResult> {
    if (!this.storage.has(type)) {
      this.storage.set(type, new Map());
    }

    // [ADR-0150 D4, #32246] The slot the registry's write rule picks, and the
    // bare slot a package's first item takes over. By name for other types.
    const typeStore = this.storage.get(type)!;
    const { key, replaces } = storeWriteKey(typeStore, type, name, data);
    for (const replaced of replaces) typeStore.delete(replaced);
    typeStore.set(key, data);
    recordStoreWrite(typeStore, key);

    return {
      success: true,
      path: `memory://${type}/${name}`,
      saveTime: 0,
    };
  }

  /**
   * Delete a metadata item from memory storage
   *
   * [ADR-0150 D3/D4, #32246] For a type stored per `(package, name)`: with
   * `options.packageId`, every slot of the name held for that package (an
   * object-bound action's included, as `DatabaseLoader`'s one row of the
   * package holds it; a bundled type's every member, [#32517]) — ⛔ never
   * another package's item; with none, by the
   * registry's removal rule (`storeRemovalKeys`): every slot of the name
   * while at most one package holds it, refused
   * (`PackageScopedNameRefusedError`) when two or more do. [#32560] With
   * `options.packagelessOnly`, the name's package-less slots only: the
   * manager judged the removal over every store, so a door that holds a
   * package's item alone keeps it.
   */
  async delete(type: string, name: string, options?: MetadataLoaderDeleteOptions): Promise<void> {
    const typeStore = this.storage.get(type);
    if (typeStore) {
      if (PACKAGE_SLOTTED_STORE_TYPES.has(type)) {
        const packageId = options?.packageId;
        const keys = packageId !== undefined
          ? storeKeysNamed(typeStore, type, name).filter((key) => slotPackageOf(key) === packageId)
          : options?.packagelessOnly === true
            ? storeKeysNamed(typeStore, type, name).filter((key) => slotPackageOf(key) === undefined)
            : storeRemovalKeys(typeStore, type, name).keys;
        for (const key of keys) typeStore.delete(key);
      } else {
        typeStore.delete(name);
      }
      if (typeStore.size === 0) {
        this.storage.delete(type);
      }
    }
  }
}

/** One stored slot, keyed by its name, with its package when its key is a package's slot. */
function keyedSlot<T>(key: string, data: unknown): MetadataKeyedItem<T> {
  const packageId = slotPackageOf(key);
  return packageId === undefined
    ? { name: storedNameOf(key), data: data as T }
    : { name: storedNameOf(key), data: data as T, packageId };
}
