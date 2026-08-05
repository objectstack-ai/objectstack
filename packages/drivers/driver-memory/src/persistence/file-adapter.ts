// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import * as fs from 'node:fs';
import * as path from 'node:path';

/**
 * FileSystemPersistenceAdapter
 *
 * Persists the in-memory database to a JSON file on disk.
 * Supports atomic writes (write to temp file then rename) and auto-save with dirty tracking.
 *
 * Node.js only — will throw if used in non-Node.js environments.
 */
export class FileSystemPersistenceAdapter {
  private readonly filePath: string;
  private readonly autoSaveInterval: number;
  private dirty = false;
  private timer: ReturnType<typeof setInterval> | null = null;
  private currentDb: Record<string, any[]> | null = null;

  constructor(options?: { path?: string; autoSaveInterval?: number }) {
    this.filePath = options?.path || path.join('.objectstack', 'data', 'memory-driver.json');
    this.autoSaveInterval = options?.autoSaveInterval ?? 2000;
  }

  /**
   * Load persisted data from disk.
   * Returns null if no file exists.
   */
  async load(): Promise<Record<string, any[]> | null> {
    try {
      if (!fs.existsSync(this.filePath)) {
        return null;
      }
      const raw = fs.readFileSync(this.filePath, 'utf-8');
      const data = JSON.parse(raw);
      return data as Record<string, any[]>;
    } catch {
      return null;
    }
  }

  /**
   * Save data to disk using atomic write (temp file + rename).
   */
  async save(db: Record<string, any[]>): Promise<void> {
    this.currentDb = db;
    this.dirty = true;
  }

  /**
   * Flush pending writes to disk immediately.
   */
  async flush(): Promise<void> {
    if (!this.dirty || !this.currentDb) return;
    await this.writeToDisk(this.currentDb);
    this.dirty = false;
  }

  /**
   * Start the auto-save timer.
   */
  startAutoSave(): void {
    if (this.timer) return;
    this.timer = setInterval(async () => {
      if (this.dirty && this.currentDb) {
        await this.writeToDisk(this.currentDb);
        this.dirty = false;
      }
    }, this.autoSaveInterval);

    // Allow process to exit even if timer is running
    if (this.timer) {
      this.timer.unref();
    }
  }

  /**
   * Stop the auto-save timer and flush pending writes.
   */
  async stopAutoSave(): Promise<void> {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    await this.flush();
  }

  /**
   * Atomic write: write to temp file, then rename.
   */
  private async writeToDisk(db: Record<string, any[]>): Promise<void> {
    const dir = path.dirname(this.filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    const tmpPath = this.filePath + '.tmp';
    const json = JSON.stringify(db, null, 2);
    fs.writeFileSync(tmpPath, json, 'utf-8');
    fs.renameSync(tmpPath, this.filePath);
  }
}
