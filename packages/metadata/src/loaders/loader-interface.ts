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

