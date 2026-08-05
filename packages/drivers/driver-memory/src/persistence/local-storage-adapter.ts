// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * LocalStoragePersistenceAdapter
 *
 * Persists the in-memory database to browser localStorage.
 * Synchronous storage with a ~5MB size limit warning.
 *
 * Browser only — will throw if used in non-browser environments.
 */
export class LocalStoragePersistenceAdapter {
  private readonly storageKey: string;
  private static readonly SIZE_WARNING_BYTES = 4.5 * 1024 * 1024; // 4.5MB warning threshold

  constructor(options?: { key?: string }) {
    this.storageKey = options?.key || 'objectstack:memory-db';
  }

  /**
   * Load persisted data from localStorage.
   * Returns null if no data exists.
   */
  async load(): Promise<Record<string, any[]> | null> {
    try {
      const raw = localStorage.getItem(this.storageKey);
      if (!raw) return null;
      return JSON.parse(raw) as Record<string, any[]>;
    } catch {
      return null;
    }
  }

  /**
   * Save data to localStorage.
   * Warns if data size approaches the ~5MB localStorage limit.
   */
  async save(db: Record<string, any[]>): Promise<void> {
    const json = JSON.stringify(db);

    if (json.length > LocalStoragePersistenceAdapter.SIZE_WARNING_BYTES) {
      console.warn(
        `[ObjectStack] localStorage persistence data size (${(json.length / 1024 / 1024).toFixed(2)}MB) ` +
        `is approaching the ~5MB limit. Consider using a different persistence strategy.`
      );
    }

    try {
      localStorage.setItem(this.storageKey, json);
    } catch (e: any) {
      console.error('[ObjectStack] Failed to persist data to localStorage:', e?.message || e);
    }
  }

  /**
   * Flush is a no-op for localStorage (writes are synchronous).
   */
  async flush(): Promise<void> {
    // localStorage writes are synchronous, no flushing needed
  }
}
