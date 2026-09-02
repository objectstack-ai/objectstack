// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Metadata Loader Interface
 * 
 * Defines the contract for loading metadata from various sources
 */

import type {
  MetadataLoadOptions,
  MetadataLoadResult,
  MetadataStats,
  MetadataLoaderContract,
  MetadataSaveOptions,
  MetadataSaveResult,
} from '@objectstack/spec/system';

/**
 * [#14205] One loaded item paired with the KEY its store holds it under.
 *
 * The pair exists because a metadata body is not required to name itself. Most
 * do — and for those the key and `data.name` agree, because
 * `assertMetadataRegisterContract` refuses a `register(type, name, data)` whose
 * `data.name` disagrees with the `name` argument. But an aggregated `defineView`
 * container has no own `name` BY DESIGN (its identity is the target object), and
 * `register()` explicitly allows that: "A document with NO `name` of its own is
 * fine — the argument is the key".
 *
 * So the key is a fact about the STORE, not about the body, and it is the only
 * identity a nameless item has. Carrying it BESIDE `data` rather than folding it
 * into `data` is the whole point: the body stays byte-identical to what was
 * stored, so no consumer sees a synthesised `name` and the register contract's
 * `data.name` check keeps meaning what it means.
 */
export interface MetadataKeyedItem<T = any> {
  /** The key this item is stored under — `register()`'s `name` argument. */
  readonly name: string;
  /** The stored body, exactly as {@link MetadataLoader.loadMany} would return it. */
  readonly data: T;
}

/**
 * Abstract interface for metadata loaders
 * Implementations can load from filesystem, HTTP, S3, databases, etc.
 */
export interface MetadataLoader {
  /**
   * Loader contract information
   */
  readonly contract: MetadataLoaderContract;

  /**
   * Load a single metadata item
   * @param type The metadata type (e.g., 'object', 'view', 'app')
   * @param name The item name/identifier
   * @param options Load options
   * @returns Load result with data or null if not found
   */
  load(
    type: string,
    name: string,
    options?: MetadataLoadOptions
  ): Promise<MetadataLoadResult>;

  /**
   * Load multiple items matching patterns
   * @param type The metadata type
   * @param options Load options with patterns
   * @returns Array of loaded items
   */
  loadMany<T = any>(
    type: string,
    options?: MetadataLoadOptions
  ): Promise<T[]>;

  /**
   * Load multiple items of a type, each paired with the KEY this loader holds
   * it under.
   *
   * [#14205] Optional, and the reason it is a second method rather than a
   * widened `loadMany()`: `MetadataLoader` is exported from this package's
   * public entry, with implementors outside it (`packages/objectql`'s
   * conformance fixtures among them). Changing `loadMany()`'s return type would
   * break every one of them; an optional member breaks none, and a loader that
   * cannot produce keys — `RemoteLoader`, whose wire format carries bodies only
   * — simply does not declare it.
   *
   * `MetadataManager` prefers this method wherever it merges a loader's answer
   * into a keyed set (`list()`, and the endpoint index), and falls back to
   * `loadMany()` keyed by `data.name` when it is absent. That fallback is
   * exactly the pre-#14205 behaviour, so it drops items whose body has no
   * top-level `name`: implement this method on any loader that can be asked to
   * hold one.
   *
   * `data` MUST be the same body `loadMany()` would return for the item —
   * unmodified, in particular with no `name` folded in. `name` is the store's
   * key, carried beside the body, never written into it.
   *
   * @param type The metadata type
   * @param options Load options with patterns
   * @returns Array of (key, body) pairs
   */
  loadManyKeyed?<T = any>(
    type: string,
    options?: MetadataLoadOptions
  ): Promise<MetadataKeyedItem<T>[]>;

  /**
   * Check if item exists
   * @param type The metadata type
   * @param name The item name
   * @returns True if exists
   */
  exists(type: string, name: string): Promise<boolean>;

  /**
   * Get item metadata (without loading full content)
   * @param type The metadata type
   * @param name The item name
   * @returns Metadata statistics
   */
  stat(type: string, name: string): Promise<MetadataStats | null>;

  /**
   * List all items of a type
   * @param type The metadata type
   * @returns Array of item names
   */
  list(type: string): Promise<string[]>;

  /**
   * Save metadata item into this loader's store.
   *
   * [#5654] Optional on the interface, **mandatory for a `datasource:` loader
   * that declares `capabilities.write`** — `MetadataManager.registerLoader()`
   * refuses to register such a loader when this method is missing, so the
   * combination "declared writable, cannot persist" never reaches the runtime.
   *
   * The reason it is enforced at registration rather than tolerated at the write
   * site: `MetadataManager.register()` persists into every writable
   * `datasource:` loader, and it used to read `loader.save &&` first — a loader
   * that declares it can be written to but has no `save()` made every write a
   * silent lie. `register()` would skip it, then write the in-memory registry,
   * invalidate the list cache, announce a `created`/`updated` event and notify
   * watchers, so the caller is told the write succeeded; the item reads back
   * correctly for the life of the process and is **gone at the next restart**,
   * with nothing to retry it.
   *
   * Loaders on the other protocols (`file:`, `memory:`, `http:`, `s3:`) are not
   * gated: `MetadataManager` never persists to them at runtime — `register()`
   * filters on `datasource:` — so a missing `save()` there loses nothing.
   *
   * @param type The metadata type
   * @param name The item name
   * @param data The data to save
   * @param options Save options
   */
  save?(
    type: string,
    name: string,
    data: any,
    options?: MetadataSaveOptions
  ): Promise<MetadataSaveResult>;

  /**
   * Delete a metadata item from this loader's store.
   *
   * [#5276, #5654] Optional on the interface, **mandatory for a `datasource:`
   * loader that declares `capabilities.write`** — `MetadataManager.registerLoader()`
   * refuses to register such a loader when this method is missing, so the
   * combination "declared writable, cannot delete" never reaches the runtime.
   *
   * The reason it is enforced at registration rather than tolerated at the
   * delete site: `MetadataManager.register()` persists into every writable
   * `datasource:` loader, and `unregister()` has to take those rows back out
   * again. A loader that can be written to but not deleted from makes every
   * deletion a silent lie — `unregister()` would skip it, then drop the
   * registry entry, invalidate the list cache and announce a `deleted` event,
   * so the caller is told the delete succeeded while the row is read straight
   * back out of this loader by the next `list()`/`get()`. `capabilities.write`
   * therefore means *both* directions of the write, on both ends of the item's
   * life — declared = enforced.
   *
   * One gate covers both halves: `assertWritableLoaderContract` in
   * `metadata-manager.ts` requires `save()` **and** `delete()` for this
   * combination and names whichever is missing. #5276 built it for `delete`;
   * #5654 widened it to `save`, which had the identical silent skip in
   * `register()` — see the note on `save?` above.
   *
   * Loaders on the other protocols (`file:`, `memory:`, `http:`, `s3:`) are not
   * gated: `MetadataManager` never writes to them at runtime, so it never has a
   * deletion of its own to take back.
   *
   * @param type The metadata type
   * @param name The item name
   */
  delete?(type: string, name: string): Promise<void>;
}

