/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * IndexedDB-backed offline write queue.
 *
 * Designed to back a `createOfflineDataSource()` wrapper: when the network
 * is unavailable the wrapper enqueues mutations here, then replays them in
 * insertion order when connectivity is restored (or a Service Worker
 * `sync` event fires).
 *
 * The implementation is dependency-free and uses raw IndexedDB so it works
 * inside both pages and Service Workers. Falls back to an in-memory store
 * when IndexedDB is unavailable (e.g. during SSR or in unit tests without
 * `fake-indexeddb`).
 */

/** A queued mutation. */
export interface OfflineOperation {
  /** Auto-generated stable id (uuid-like). */
  id: string;
  /** Logical op type. */
  op: 'create' | 'update' | 'delete' | 'custom';
  /** Object/collection the mutation targets. */
  object: string;
  /** Optional record id (required for update/delete). */
  recordId?: string | number;
  /** Mutation payload. */
  payload?: any;
  /**
   * Optional ObjectQL FilterAST snapshot of the *expected* current row
   * state. Used by conflict-resolution to detect "stale write" conflicts
   * when the server row has changed in the interim.
   *
   * The shape is left as `unknown` here so this package doesn't need a
   * runtime dep on `@objectstack/spec` — consumers may pass through any
   * serializable structure.
   */
  expectFilter?: unknown;
  /** Wall-clock millis when the op was enqueued. */
  enqueuedAt: number;
  /** Number of replay attempts so far. */
  attempts: number;
  /** Last error message, if any. */
  lastError?: string;
}

/** Backend-agnostic queue contract. */
export interface OfflineQueueBackend {
  enqueue(op: OfflineOperation): Promise<void>;
  list(): Promise<OfflineOperation[]>;
  remove(id: string): Promise<void>;
  update(op: OfflineOperation): Promise<void>;
  clear(): Promise<void>;
}

/** Generate a short, sortable id without external deps. */
export function generateOpId(): string {
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 10);
  return `op-${ts}-${rand}`;
}

const DB_NAME = 'objectui-offline';
const STORE = 'queue';
const DB_VERSION = 1;

/** Open the IndexedDB database, creating the queue object store on first run. */
function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: 'id' });
        store.createIndex('enqueuedAt', 'enqueuedAt', { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** IndexedDB-backed queue. Constructor returns a backend usable everywhere. */
export class IndexedDbOfflineQueue implements OfflineQueueBackend {
  private dbPromise: Promise<IDBDatabase> | null = null;
  private getDb(): Promise<IDBDatabase> {
    if (!this.dbPromise) this.dbPromise = openDb();
    return this.dbPromise;
  }
  private async tx<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
    const db = await this.getDb();
    return new Promise<T>((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const store = tx.objectStore(STORE);
      const req = fn(store);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  async enqueue(op: OfflineOperation): Promise<void> { await this.tx('readwrite', (s) => s.add(op)); }
  async update(op: OfflineOperation): Promise<void> { await this.tx('readwrite', (s) => s.put(op)); }
  async remove(id: string): Promise<void> { await this.tx('readwrite', (s) => s.delete(id)); }
  async clear(): Promise<void> { await this.tx('readwrite', (s) => s.clear()); }
  async list(): Promise<OfflineOperation[]> {
    const db = await this.getDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const store = tx.objectStore(STORE);
      const idx = store.index('enqueuedAt');
      const req = idx.getAll();
      req.onsuccess = () => resolve((req.result as OfflineOperation[]) ?? []);
      req.onerror = () => reject(req.error);
    });
  }
}

/** In-memory fallback. Used in SSR / tests / when IndexedDB is blocked. */
export class MemoryOfflineQueue implements OfflineQueueBackend {
  private rows = new Map<string, OfflineOperation>();
  async enqueue(op: OfflineOperation) { this.rows.set(op.id, op); }
  async update(op: OfflineOperation) { this.rows.set(op.id, op); }
  async remove(id: string) { this.rows.delete(id); }
  async clear() { this.rows.clear(); }
  async list(): Promise<OfflineOperation[]> {
    return [...this.rows.values()].sort((a, b) => a.enqueuedAt - b.enqueuedAt);
  }
}

/** Choose the best available backend for the current runtime. */
export function createOfflineQueue(): OfflineQueueBackend {
  if (typeof indexedDB === 'undefined') return new MemoryOfflineQueue();
  try { return new IndexedDbOfflineQueue(); } catch { return new MemoryOfflineQueue(); }
}
