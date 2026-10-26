/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * `createOfflineDataSource` — wraps any DataSource so that mutations made
 * while the network is offline (or while the inner source rejects with a
 * network-style error) are persisted to an offline queue and replayed
 * automatically when connectivity returns.
 *
 * Reads (`find` / `findOne`) are pass-through; the optional `cache` hook
 * lets callers opt into local caching but is not built in here.
 */

import { type OfflineQueueBackend, type OfflineOperation, generateOpId } from './offlineQueue.js';

/** Minimal DataSource shape we care about. */
export interface QueueableDataSource {
  find?: (object: string, query?: any) => Promise<any>;
  findOne?: (object: string, id: string | number, query?: any) => Promise<any>;
  create?: (object: string, payload: any) => Promise<any>;
  update?: (object: string, id: string | number, payload: any) => Promise<any>;
  delete?: (object: string, id: string | number) => Promise<any>;
  [k: string]: any;
}

export interface OfflineDataSourceOptions {
  queue: OfflineQueueBackend;
  /** Custom predicate to detect network failure. Defaults to instanceof TypeError + 5xx. */
  isNetworkError?: (err: unknown) => boolean;
  /** Override online detection. Defaults to `navigator.onLine`. */
  isOnline?: () => boolean;
  /** Called whenever queue contents change (enqueue / replay / drop). */
  onChange?: (ops: OfflineOperation[]) => void;
  /**
   * Optional conflict resolver. Returns `'retry'` to leave the op in place,
   * `'drop'` to discard, or a fresh payload to retry with overrides.
   */
  resolveConflict?: (op: OfflineOperation, error: unknown) => Promise<'retry' | 'drop' | { payload: any }>;
}

const defaultIsNetworkError = (err: unknown): boolean => {
  if (!err) return false;
  if (err instanceof TypeError) return true;
  const e = err as any;
  if (e.code === 'ENOTFOUND' || e.code === 'ECONNREFUSED' || e.code === 'NETWORK_ERROR') return true;
  if (typeof e.status === 'number' && e.status >= 500) return true;
  if (typeof e.message === 'string' && /network|fetch|offline/i.test(e.message)) return true;
  return false;
};

const defaultIsOnline = (): boolean => {
  if (typeof navigator === 'undefined') return true;
  return navigator.onLine !== false;
};

/** A DataSource wrapper that queues mutations while offline. */
export interface OfflineDataSource extends QueueableDataSource {
  /** Number of pending operations (sync, may lag a tick — call `pendingCount()` for fresh). */
  pendingCount(): Promise<number>;
  /** Replay all pending ops in order. Returns counts. */
  replay(): Promise<{ succeeded: number; failed: number; remaining: number }>;
  /** Drop a specific queued op (e.g. from a UI). */
  drop(opId: string): Promise<void>;
  /** Drop all queued ops (e.g. "discard local changes"). */
  clear(): Promise<void>;
  /** Inspect all queued ops. */
  pending(): Promise<OfflineOperation[]>;
}

/**
 * Wrap an inner DataSource. Mutations that fail with a network-style error
 * — or are issued while offline — are stored in the queue and replayed on
 * reconnect.
 */
export function createOfflineDataSource(
  inner: QueueableDataSource,
  options: OfflineDataSourceOptions,
): OfflineDataSource {
  const { queue, onChange } = options;
  const isNetErr = options.isNetworkError ?? defaultIsNetworkError;
  const isOnline = options.isOnline ?? defaultIsOnline;

  const notify = async () => {
    if (!onChange) return;
    try { onChange(await queue.list()); } catch { /* ignore */ }
  };

  const enqueue = async (op: Omit<OfflineOperation, 'id' | 'enqueuedAt' | 'attempts'>) => {
    const full: OfflineOperation = {
      id: generateOpId(),
      enqueuedAt: Date.now(),
      attempts: 0,
      ...op,
    };
    await queue.enqueue(full);
    await notify();
    return full;
  };

  // Optimistic helper: try the inner mutation, queue on network failure.
  const guarded = async <T>(
    op: Omit<OfflineOperation, 'id' | 'enqueuedAt' | 'attempts'>,
    runner: () => Promise<T>,
  ): Promise<T | { queued: true; op: OfflineOperation }> => {
    if (!isOnline()) {
      const queued = await enqueue(op);
      return { queued: true as const, op: queued };
    }
    try {
      return await runner();
    } catch (err) {
      if (isNetErr(err)) {
        const queued = await enqueue(op);
        return { queued: true as const, op: queued };
      }
      throw err;
    }
  };

  const wrapped: OfflineDataSource = {
    ...inner,
    find: inner.find?.bind(inner),
    findOne: inner.findOne?.bind(inner),
    create: inner.create
      ? (object, payload) => guarded({ op: 'create', object, payload }, () => inner.create!(object, payload))
      : undefined,
    update: inner.update
      ? (object, id, payload) =>
          guarded({ op: 'update', object, recordId: id, payload }, () => inner.update!(object, id, payload))
      : undefined,
    delete: inner.delete
      ? (object, id) =>
          guarded({ op: 'delete', object, recordId: id }, () => inner.delete!(object, id))
      : undefined,

    async pendingCount() { return (await queue.list()).length; },
    async pending() { return queue.list(); },
    async drop(opId: string) { await queue.remove(opId); await notify(); },
    async clear() { await queue.clear(); await notify(); },

    async replay() {
      let succeeded = 0;
      let failed = 0;
      const ops = await queue.list();
      for (const op of ops) {
        try {
          if (op.op === 'create' && inner.create) await inner.create(op.object, op.payload);
          else if (op.op === 'update' && inner.update) await inner.update(op.object, op.recordId!, op.payload);
          else if (op.op === 'delete' && inner.delete) await inner.delete(op.object, op.recordId!);
          else throw new Error(`Unsupported op: ${op.op}`);
          await queue.remove(op.id);
          succeeded++;
        } catch (err) {
          // Non-network failures may be conflicts: ask the resolver.
          if (!isNetErr(err) && options.resolveConflict) {
            const decision = await options.resolveConflict(op, err);
            if (decision === 'drop') {
              await queue.remove(op.id);
              succeeded++;
              continue;
            }
            if (typeof decision === 'object' && 'payload' in decision) {
              const next = { ...op, payload: decision.payload, attempts: op.attempts + 1 };
              await queue.update(next);
              continue;
            }
            // 'retry' falls through to bumping attempts below.
          }
          const next = {
            ...op,
            attempts: op.attempts + 1,
            lastError: err instanceof Error ? err.message : String(err),
          };
          await queue.update(next);
          failed++;
          // For network errors stop processing — we'll likely fail the rest too.
          if (isNetErr(err)) break;
        }
      }
      const remaining = (await queue.list()).length;
      await notify();
      return { succeeded, failed, remaining };
    },
  };

  return wrapped;
}
