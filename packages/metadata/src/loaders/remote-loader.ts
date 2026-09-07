// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Remote Metadata Loader
 * 
 * Loads metadata from an HTTP API.
 * This loader is stateless and delegates storage to the remote server.
 */

import type {
  MetadataLoadOptions,
  MetadataLoadResult,
  MetadataStats,
  MetadataLoaderContract,
  MetadataSaveOptions,
  MetadataSaveResult,
} from '@objectstack/spec/system';
import type { MetadataLoader } from './loader-interface.js';

export class RemoteLoader implements MetadataLoader {
  readonly contract: MetadataLoaderContract = {
    name: 'remote',
    protocol: 'http:',
    capabilities: {
      read: true,
      write: true,
      watch: false, // Could implement SSE/WebSocket in future
      list: true,
    },
  };

  constructor(private baseUrl: string, private authToken?: string) {}

  private get headers() {
    return {
      'Content-Type': 'application/json',
      ...(this.authToken ? { Authorization: `Bearer ${this.authToken}` } : {}),
    };
  }

  async load(
    type: string,
    name: string,
    _options?: MetadataLoadOptions
  ): Promise<MetadataLoadResult> {
    try {
      const response = await fetch(`${this.baseUrl}/${type}/${name}`, {
        method: 'GET',
        headers: this.headers,
      });

      if (response.status === 404) {
        return { data: null };
      }

      if (!response.ok) {
        throw new Error(`Remote load failed: ${response.statusText}`);
      }

      const data = await response.json();
      return {
        data,
        source: this.baseUrl,
        format: 'json',
        loadTime: 0, 
      };
    } catch (error) {
      console.error(`RemoteLoader error loading ${type}/${name}`, error);
      throw error;
    }
  }

  async loadMany<T = any>(
    type: string,
    _options?: MetadataLoadOptions
  ): Promise<T[]> {
    const response = await fetch(`${this.baseUrl}/${type}`, {
      method: 'GET',
      headers: this.headers,
    });

    if (!response.ok) {
      return [];
    }

    return (await response.json()) as T[];
  }

  async exists(type: string, name: string): Promise<boolean> {
    const response = await fetch(`${this.baseUrl}/${type}/${name}`, {
      method: 'HEAD',
      headers: this.headers,
    });
    return response.ok;
  }

  async stat(type: string, name: string): Promise<MetadataStats | null> {
    // Basic implementation using HEAD
    const response = await fetch(`${this.baseUrl}/${type}/${name}`, {
      method: 'HEAD',
      headers: this.headers,
    });
    
    if (!response.ok) return null;

    return {
      size: Number(response.headers.get('content-length') || 0),
      mtime: new Date(response.headers.get('last-modified') || Date.now()).toISOString(),
      format: 'json',
    };
  }

  /**
   * [#15037] Report only the names that ARE names.
   *
   * This read used to be `loadMany<{ name: string }>(type)` mapped straight to
   * `items.map(i => i.name)`. That type argument is an ASSERTION about bodies
   * that arrived over HTTP, and nothing checked it: a body with no top-level
   * `name` yielded `undefined`, which went into an array this signature
   * declares as `string[]` and reached consumers through
   * `MetadataManager.listNames()` — a runtime violation of a declared type,
   * not an untidy entry. A consumer that keys by it, lower-cases it, or feeds
   * it back to a by-name `load()` gets `undefined` where the type says it
   * cannot be.
   *
   * The guard is `DatabaseLoader.list()`'s, one file away: same cast-then-map
   * spelling, one `typeof` filter behind it. Silently dropping is the landed
   * direction, not a preference — `DatabaseLoader` drops rather than throws,
   * and `FilesystemLoader`'s narrowing carries a maintainer ruling (via the
   * director seat on #14486, 2026-09-02) that chose narrowing (A) over
   * refusing loudly (B), because a name in the list that the door answers
   * `null` for is the silent failure an author reads as their own typo. An
   * `undefined` here is the extreme form of that name.
   *
   * ⛔ NOT copied from the siblings: `MemoryLoader` answers with its store
   * keys, and #14205 ruled that identity is the key the store holds an item
   * under rather than `body.name`. This loader reads over HTTP and holds no
   * store key, so `body.name` is the only identity it has — the list is
   * narrowed to agree with the door instead. `loadMany()` is deliberately
   * untouched: it keys nothing, so a nameless body is still served there.
   *
   * The predicate is spelled as a type guard, and the mapped element type left
   * `unknown`, so `tsc` PROVES the declared `string[]` instead of a cast
   * asserting it — otherwise the compiler reads the filter as always-true and
   * a later reader deletes it as dead.
   */
  async list(type: string): Promise<string[]> {
    const items = await this.loadMany<{ name?: unknown }>(type);
    return items
      .map(item => item.name)
      .filter((name): name is string => typeof name === 'string');
  }

  async save(
    type: string,
    name: string,
    data: any,
    _options?: MetadataSaveOptions
  ): Promise<MetadataSaveResult> {
    const response = await fetch(`${this.baseUrl}/${type}/${name}`, {
      method: 'PUT',
      headers: this.headers,
      body: JSON.stringify(data),
    });

    if (!response.ok) {
      throw new Error(`Remote save failed: ${response.statusText}`);
    }

    return {
      success: true,
      path: `${this.baseUrl}/${type}/${name}`,
      saveTime: 0,
    };
  }
}
