// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { isSummaryRecomputeRefusal } from '@objectstack/types';
import { guardedObjectsFor } from './knowledge-reap-guard.js';
import type { KnowledgeLogger, KnowledgeService } from './knowledge-service.js';

/**
 * The `packageId` every after-write hook of the record sync is registered
 * under, so the plugin's teardown removes exactly these
 * (`unregisterHooksByPackage`).
 */
export const KNOWLEDGE_RECORD_SYNC_HOOK_PACKAGE = 'service-knowledge:record-sync';

/**
 * The engine operation a recycle-bin restore is dispatched as
 * (`OperationContext.operation`, objectql `engine-top-level.ts`).
 */
const RESTORE_OPERATION = 'restore';

/** The after-write events the record sync listens on. */
const RECORD_SYNC_EVENTS = ['afterInsert', 'afterUpdate', 'afterDelete'] as const;
type RecordSyncEvent = (typeof RECORD_SYNC_EVENTS)[number];

/**
 * The slice of the ObjectQL engine the record sync uses, reached duck-typed
 * from the `objectql` service as every plugin reaches it
 * (`IObjectQLEngine.registerHook`, `@objectstack/spec/contracts`).
 * `runAfterOpenUnitsCommit` is `ObjectQL`'s (`unit-detach.ts`); an engine
 * without it starts the sync at once. `registerMiddleware` is how a
 * recycle-bin restore is heard (`IObjectQLEngine.registerMiddleware`); an
 * engine without it leaves a restored row to the reconcile.
 */
export interface KnowledgeRecordHookEngine {
  registerHook(
    event: string,
    handler: (context: unknown) => Promise<void> | void,
    options?: { object?: string; packageId?: string },
  ): void;
  unregisterHooksByPackage?(packageId: string): number;
  registerMiddleware?(fn: (opCtx: RestoreOperationContext, next: () => Promise<void>) => Promise<void>): void;
  runAfterOpenUnitsCommit?(body: () => void): void;
}

/** `engine` as a {@link KnowledgeRecordHookEngine}, or `undefined` when it takes no hooks. */
export function recordHookEngineOf(engine: unknown): KnowledgeRecordHookEngine | undefined {
  if (!engine || typeof engine !== 'object') return undefined;
  return typeof (engine as { registerHook?: unknown }).registerHook === 'function'
    ? (engine as KnowledgeRecordHookEngine)
    : undefined;
}

/** The slice of `KnowledgeService` the record sync drives. */
type RecordSyncService = Pick<
  KnowledgeService,
  'indexedSources' | 'handleRecordUpsert' | 'handleRecordDelete' | 'recordSyncQueued' | 'enqueueRecordSync'
>;

/** The after-write hook context fields the sync reads (`HookContext`, single-record shape). */
interface AfterWriteContext {
  input?: { id?: unknown };
  result?: unknown;
  previous?: unknown;
}

function idOf(value: unknown): string | undefined {
  if (typeof value === 'string' && value !== '') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return undefined;
}

function rowOf(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

/** The fields of the engine's operation context the restore middleware reads (`OperationContext`). */
interface RestoreOperationContext {
  operation?: unknown;
  result?: unknown;
}

/**
 * The rows a restore wrote back, in its order (the master first), read off
 * what `ObjectQL.restore` answers (`RecycleBinRestoreResult.rows`); `[]` for
 * a restore that found no entry (`null`).
 */
function restoredRowsOf(result: unknown): Array<{ object: string; id: string }> {
  const rows = rowOf(result)?.rows;
  if (!Array.isArray(rows)) return [];
  const out: Array<{ object: string; id: string }> = [];
  for (const row of rows) {
    const object = rowOf(row)?.object;
    const id = idOf(rowOf(row)?.id);
    if (typeof object === 'string' && object !== '' && id !== undefined) out.push({ object, id });
  }
  return out;
}

/**
 * The record sync's trigger when the kernel composes no `realtime` service:
 * the data engine's after-write hooks (`afterInsert` / `afterUpdate` /
 * `afterDelete`) on every object a source indexes, each calling the same
 * `handleRecordUpsert` / `handleRecordDelete` the realtime subscription calls.
 *
 * ## One trigger per kernel
 *
 * The plugin starts this only where the realtime subscription is not taken
 * (`KnowledgeServicePlugin`, `kernel:ready`), so a write is synced by exactly
 * one of the two. The engine publishes its `data.record.*` events only where
 * the same `realtime` service is composed (the ObjectQL plugin bridges it),
 * so on a kernel without it the hooks are the only signal a write gives.
 *
 * ## Every row of a predicate write
 *
 * An object with an `afterUpdate` / `afterDelete` hook gets one per-row
 * dispatch for each row a `multi: true` write matches (the engine reads the
 * matched rows for it, ADR-0058 Addendum II), so a predicate write is synced
 * row by row here — no aggregate event, no reconcile needed. The engine holds
 * such a write to its per-row hook ceiling (`MAX_BULK_PER_ROW_HOOK_ROWS`,
 * `resolveBulkPerRowHookBudget`): over it the write is refused, as it is for
 * every object that already carries a per-row hook (audit, sharing).
 *
 * ## Off the write's response path, and after its commit
 *
 * A hook runs inside the write, before any unit of work around it commits.
 * The hook therefore only hands the sync to {@link deferRecordSync} and
 * returns: the re-read, the split and the embed never sit on the write's
 * response. The engine's `runAfterOpenUnitsCommit` starts the sync once the
 * unit open at the hook commits — so the re-read sees the committed row — and
 * never when it rolls back, so a rolled-back write leaves the index as it
 * was. With no unit open the sync starts at once, outside every unit.
 *
 * Where record syncs run through the queue (`KnowledgeService.routeRecordSyncs`)
 * the hook asks for the sync instead (`KnowledgeService.enqueueRecordSync`),
 * which publishes the message on the same commit, and never on a rollback;
 * the worker then syncs, retrying a failure.
 *
 * ## A recycle-bin restore
 *
 * A restore writes its rows back through each object's driver and runs no
 * hook (a restore is never a create, ADR-0148 D2), and the
 * `data.record.restored` events it publishes go only to a `realtime` service.
 * So the restore is heard as the engine operation it is dispatched as: one
 * engine middleware, registered for every object, that passes every other
 * operation straight through and, once a `restore` has answered, syncs each row
 * it wrote back, the master first, in the order the events are published. A
 * restore that refuses or fails syncs nothing. A restore that landed but could
 * not recompute a roll-up (`ERR_SUMMARY_RECOMPUTE`, its rows written) syncs
 * them as one that recomputed. Every object, not only the indexed ones: a
 * restored detail of an indexed object comes back with a master no source
 * indexes, and an object-keyed middleware would also turn the analytics
 * native-SQL path away from the object (`hasObjectMiddleware`). The sync takes
 * the same seams as a write's: {@link deferRecordSync} (once the unit open at
 * the restore commits, never on its rollback, off the restore's response) or
 * `enqueueRecordSync` through the queue. The answer names only ids, and the
 * service re-reads each row by its id under the source's `where` (the engine
 * whose hooks run here is the one bound to the service).
 *
 * ## The objects follow the sources
 *
 * Registered for every object a record-change source indexes now, and for
 * each object a later source adds ({@link sync}). An object whose last source
 * goes keeps its hooks (the engine has no per-hook unregister); the service
 * finds no source for it and syncs nothing.
 */
export class KnowledgeRecordHooks {
  private readonly hooked = new Set<string>();
  private readonly inFlight = new Set<Promise<void>>();
  private stopped = false;
  /** Whether the restore middleware is registered ({@link watchRestores}). */
  private restoresWatched = false;

  constructor(
    private readonly engine: KnowledgeRecordHookEngine,
    private readonly service: RecordSyncService,
    private readonly logger?: KnowledgeLogger,
  ) {}

  /**
   * Register the after-write hooks for each object a record-change source
   * indexes that has none yet. Answers the objects registered by this call.
   */
  sync(): string[] {
    if (this.stopped) return [];
    this.watchRestores();
    const objects = guardedObjectsFor(this.service.indexedSources()).filter((object) => !this.hooked.has(object));
    for (const object of objects) {
      for (const event of RECORD_SYNC_EVENTS) {
        this.engine.registerHook(event, (context) => this.onWrite(event, object, context as AfterWriteContext), {
          object,
          packageId: KNOWLEDGE_RECORD_SYNC_HOOK_PACKAGE,
        });
      }
      this.hooked.add(object);
    }
    return objects;
  }

  /** Whether a recycle-bin restore is synced: the engine took the restore middleware. */
  get watchesRestores(): boolean {
    return this.restoresWatched;
  }

  /**
   * Register the restore middleware, once per instance: the engine has no
   * per-middleware unregister, so after {@link stop} it passes every
   * operation through.
   */
  private watchRestores(): void {
    if (this.restoresWatched || typeof this.engine.registerMiddleware !== 'function') return;
    this.engine.registerMiddleware((opCtx, next) => this.onOperation(opCtx, next));
    this.restoresWatched = true;
  }

  /** The middleware: let the operation run, and after a `restore` sync the rows it wrote back. */
  private async onOperation(opCtx: RestoreOperationContext, next: () => Promise<void>): Promise<void> {
    if (opCtx?.operation !== RESTORE_OPERATION || this.stopped) return next();
    try {
      await next();
    } catch (err) {
      // The rows ARE written; only a roll-up is stale.
      if (isSummaryRecomputeRefusal(err)) this.onRestore(err.written);
      throw err;
    }
    this.onRestore(opCtx.result);
  }

  /** Hand the sync of each restored row off, the master first. Never throws. */
  private onRestore(result: unknown): void {
    if (this.stopped) return;
    const rows = restoredRowsOf(result);
    if (rows.length === 0) return;
    if (this.service.recordSyncQueued) {
      for (const row of rows) this.service.enqueueRecordSync(row.object, row.id);
      return;
    }
    this.deferRecordSync(async () => {
      for (const row of rows) await this.service.handleRecordUpsert(row.object, { id: row.id });
    });
  }

  /** The objects the hooks are registered for. */
  objects(): string[] {
    return [...this.hooked];
  }

  /**
   * Remove the hooks and start no further sync; a sync already running runs
   * to its end.
   */
  stop(): void {
    if (this.stopped) return;
    this.stopped = true;
    try {
      this.engine.unregisterHooksByPackage?.(KNOWLEDGE_RECORD_SYNC_HOOK_PACKAGE);
    } catch {
      // the engine is going down too
    }
  }

  /** Resolves once every sync started so far has finished. */
  async settled(): Promise<void> {
    while (this.inFlight.size > 0) await Promise.all([...this.inFlight]);
  }

  /** The hook: read the row's id and hand the sync off. Never throws, never awaits the sync. */
  private onWrite(event: RecordSyncEvent, object: string, context: AfterWriteContext): void {
    if (this.stopped) return;
    if (event === 'afterDelete') {
      const id = idOf(context?.input?.id) ?? idOf(rowOf(context?.previous)?.id);
      if (id === undefined) return;
      if (this.service.recordSyncQueued) this.service.enqueueRecordSync(object, id);
      else this.deferRecordSync(() => this.service.handleRecordDelete(object, id));
      return;
    }
    const result = rowOf(context?.result);
    const id = idOf(context?.input?.id) ?? idOf(result?.id);
    if (id === undefined) return;
    if (this.service.recordSyncQueued) {
      this.service.enqueueRecordSync(object, id);
      return;
    }
    // A copy, taken now: the engine strips the row it hands the caller after
    // this hook. The service re-reads the row by its id under the source's
    // `where` anyway; the copy is what a source with no engine would index.
    const record = { ...(result ?? {}), id: result?.id ?? id };
    this.deferRecordSync(() => this.service.handleRecordUpsert(object, record));
  }

  /**
   * The inline sync's seam: start `run` once the unit of work open at the
   * write commits, never when it rolls back, and never on the write's
   * response path.
   */
  private deferRecordSync(run: () => Promise<void>): void {
    const start = (): void => {
      if (this.stopped) return;
      const task = Promise.resolve()
        .then(run)
        .catch((err: unknown) => {
          // The service's sync paths log their own failures and never throw;
          // this is the backstop for one they could not name.
          this.logger?.warn?.(
            `[knowledge] record sync failed: ${err instanceof Error ? err.message : String(err)}`,
          );
        })
        .finally(() => {
          this.inFlight.delete(task);
        });
      this.inFlight.add(task);
    };
    const defer = this.engine.runAfterOpenUnitsCommit;
    if (typeof defer === 'function') defer.call(this.engine, start);
    else start();
  }
}
