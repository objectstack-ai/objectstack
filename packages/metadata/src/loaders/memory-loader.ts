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
 * saved. Every other type is held by name, as before.
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
  readStoreEntry,
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
  // per `(package, name)` the registry's store key (a package's slot).
  private storage = new Map<string, Map<string, any>>();

  /**
   * [#32246] For a type stored per `(package, name)`, the read naming no
   * package (`readStoreEntry`): the name's package-less item, else its one
   * holder's; refused (`PackageScopedNameRefusedError`, `409`) when two
   * packages hold it.
   */
  async load(
    type: string,
    name: string,
    _options?: MetadataLoadOptions
  ): Promise<MetadataLoadResult> {
    const typeStore = this.storage.get(type);
    const entry = PACKAGE_SLOTTED_STORE_TYPES.has(type) ? readStoreEntry(typeStore, type, name) : undefined;
    const data = entry ? (entry.found ? entry.data : undefined) : typeStore?.get(name);

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
    // [#32246] A package's slot answers with its name and the package.
    return Array.from(typeStore, ([key, data]) => keyedSlot<T>(type, key, data));
  }

  /** [#32246] Every slot of `name`, each with the package it is held for. */
  async loadSlots<T = any>(type: string, name: string): Promise<MetadataKeyedItem<T>[]> {
    const typeStore = this.storage.get(type);
    return storeKeysNamed(typeStore, type, name).map((key) => keyedSlot<T>(type, key, typeStore!.get(key)));
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

    return {
      success: true,
      path: `memory://${type}/${name}`,
      saveTime: 0,
    };
  }

  /**
   * Delete a metadata item from memory storage
   *
   * [ADR-0150 D3/D4, #32246] For a type stored per `(package, name)`, by the
   * registry's removal rule (`storeRemovalKeys`): with `options.packageId`,
   * that package's slot only — ⛔ never another package's item; with none,
   * every slot of the name while at most one package holds it, and refused
   * (`PackageScopedNameRefusedError`) when two or more do.
   */
  async delete(type: string, name: string, options?: MetadataLoaderDeleteOptions): Promise<void> {
    const typeStore = this.storage.get(type);
    if (typeStore) {
      if (PACKAGE_SLOTTED_STORE_TYPES.has(type)) {
        for (const key of storeRemovalKeys(typeStore, type, name, options?.packageId).keys) typeStore.delete(key);
      } else {
        typeStore.delete(name);
      }
      if (typeStore.size === 0) {
        this.storage.delete(type);
      }
    }
  }
}

/** One stored entry, keyed by its name, with its package when its key is a package's slot. */
function keyedSlot<T>(type: string, key: string, data: unknown): MetadataKeyedItem<T> {
  const packageId = PACKAGE_SLOTTED_STORE_TYPES.has(type) ? slotPackageOf(key) : undefined;
  return packageId === undefined
    ? { name: storedNameOf(key), data: data as T }
    : { name: storedNameOf(key), data: data as T, packageId };
}
