// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import type { Plugin, PluginContext } from '@objectstack/core';
import type {
  IDataEngine,
  IRealtimeService,
} from '@objectstack/spec/contracts';
import type { KnowledgeSource } from '@objectstack/spec/ai';
import { KNOWLEDGE_SERVICE } from '@objectstack/spec/contracts';
import { KnowledgeService } from './knowledge-service.js';
import type { KnowledgeLogger } from './knowledge-service.js';

/**
 * Configuration options for the `KnowledgeServicePlugin`.
 */
export interface KnowledgeServicePluginOptions {
  /**
   * Knowledge sources to register at boot. Sources may also be
   * registered programmatically later via `service.registerSource`.
   */
  sources?: KnowledgeSource[];
  /**
   * Subscribe to ObjectQL `record.*` events from `IRealtimeService`
   * for `object` sources. Defaults to `true`. Set to `false` to
   * disable inline event sync (e.g. when an external indexer drives
   * upserts).
   * @default true
   */
  enableEventSync?: boolean;
  /** Default top-K when callers omit it. @default 10 */
  defaultTopK?: number;
}

/**
 * `KnowledgeServicePlugin` — registers `IKnowledgeService` with the
 * kernel, binds it to `IDataEngine` for RLS-aware permission filtering,
 * and (optionally) subscribes to `IRealtimeService` so ObjectQL record
 * mutations automatically propagate to adapter backends.
 *
 * @example
 * ```ts
 * import { ObjectKernel } from '@objectstack/core';
 * import { KnowledgeServicePlugin } from '@objectstack/service-knowledge';
 *
 * const kernel = new ObjectKernel();
 * kernel.use(new KnowledgeServicePlugin({
 *   sources: [{
 *     id: 'task_notes', label: 'Task notes', adapter: 'memory',
 *     source: { kind: 'object', object: 'task', contentFields: ['notes'] },
 *   }],
 * }));
 * await kernel.bootstrap();
 *
 * const knowledge = kernel.getService('knowledge');
 * const hits = await knowledge.search('shopping list', { executionContext });
 * ```
 */
export class KnowledgeServicePlugin implements Plugin {
  name = 'com.objectstack.service.knowledge';
  version = '0.1.0';
  type = 'standard';
  /**
   * init() resolves the `objectql` engine for RLS re-checks —
   * order-if-present so the resolution is deterministic (ADR-0116, #4471).
   * Soft, not hard: without an engine the service degrades on purpose
   * (pure-search mode with conservative RLS).
   */
  optionalDependencies = ['com.objectstack.engine.objectql'];

  private service: KnowledgeService | null = null;
  private subscriptionId: string | undefined;

  constructor(private readonly options: KnowledgeServicePluginOptions = {}) {}

  async init(ctx: PluginContext): Promise<void> {
    let engine: IDataEngine | undefined;
    try {
      engine = ctx.getService<IDataEngine>('objectql');
    } catch {
      // Data engine not wired — service still works in pure-search mode
      // but RLS re-checks will be conservative (drop object-source hits
      // when caller is non-system).
    }

    const logger: KnowledgeLogger = {
      info: (msg, ...rest) => {
        (ctx.logger as { info?: (m: string, ...r: unknown[]) => void }).info?.(msg, ...rest);
      },
      warn: (msg, ...rest) => {
        (ctx.logger as { warn?: (m: string, ...r: unknown[]) => void }).warn?.(msg, ...rest);
      },
      error: (msg, ...rest) => {
        (ctx.logger as { error?: (m: string, ...r: unknown[]) => void }).error?.(msg, ...rest);
      },
      debug: (msg, ...rest) => {
        (ctx.logger as { debug?: (m: string, ...r: unknown[]) => void }).debug?.(msg, ...rest);
      },
    };

    this.service = new KnowledgeService({
      dataEngine: engine,
      logger,
      defaultTopK: this.options.defaultTopK,
    });

    for (const source of this.options.sources ?? []) {
      this.service.registerSource(source);
    }

    ctx.registerService(KNOWLEDGE_SERVICE, this.service);
    ctx.logger.info?.(
      `KnowledgeServicePlugin: registered '${KNOWLEDGE_SERVICE}' service (eventSync=${
        this.options.enableEventSync !== false
      }, dataEngine=${engine ? 'yes' : 'no'})`,
    );
  }

  async start(ctx: PluginContext): Promise<void> {
    if (this.options.enableEventSync === false) return;
    const service = this.service;
    if (!service) return;

    ctx.hook('kernel:ready', async () => {
      let realtime: IRealtimeService | null = null;
      try {
        realtime = ctx.getService<IRealtimeService>('realtime');
      } catch {
        // realtime service not available — sync becomes opt-in via
        // explicit handleRecordUpsert / handleRecordDelete calls.
        ctx.logger.warn?.(
          'KnowledgeServicePlugin: IRealtimeService unavailable — event sync disabled. ' +
            'Adapters can still be driven manually via the service API.',
        );
        return;
      }

      this.subscriptionId = await realtime.subscribe('knowledge-event-sync', async (event) => {
        const object = event.object;
        if (!object) return;
        const type = event.type;
        const payload = (event.payload ?? {}) as Record<string, unknown>;

        // [#4626] `data.record.*` payloads ARE the spec's `DataEvent`
        // (`@objectstack/spec/api`): the record body lives in `after`, the id
        // in the required top-level `recordId`. Reading the payload itself as
        // a record (what the shared branch below did) indexed the ENVELOPE —
        // `{ recordId, after }` — as if it were the row, so object sources
        // were syncing documents with none of the record's fields, and a
        // delete never resolved an id at all. Kept separate from the legacy
        // `record.*` shape rather than merged behind fallbacks.
        if (type === 'data.record.created' || type === 'data.record.updated') {
          const record = payload.after as Record<string, unknown> | undefined;
          if (record && typeof record === 'object') {
            await service.handleRecordUpsert(object, record);
          }
          return;
        }
        if (type === 'data.record.deleted') {
          const recordId = payload.recordId;
          if (typeof recordId === 'string' && recordId !== '') {
            await service.handleRecordDelete(object, recordId);
          }
          return;
        }

        // [#4639] Aggregate events from a predicate write (`multi: true`).
        // A knowledge index is a PER-RECORD projection, and `matched: 40`
        // names no record — there is no upsert or delete this handler could
        // derive from it, and none of the adapters take a predicate. So the
        // index is now stale in a way this subscription cannot repair.
        //
        // Say so rather than falling through to the `return` below: a silent
        // no-op here reads identically to "nothing happened", which is how the
        // gap stayed invisible before #4639 gave bulk writes an event at all.
        // The durable fix is a reconciliation pass over the object source
        // (events keep the index FRESH; reconciliation keeps it CORRECT) —
        // tracked separately in #4672.
        if (type === 'data.records.updated' || type === 'data.records.deleted') {
          const matched = payload.matched;
          ctx.logger.warn?.(
            `KnowledgeServicePlugin: '${object}' had a predicate write (${type}) affecting ` +
              `${typeof matched === 'number' ? matched : 'an unreported number of'} record(s). ` +
              'A bulk event carries a count, not records, so the knowledge index for this object ' +
              'may now be stale and cannot be repaired from the event stream (#4639; ' +
              'reconciliation tracked in #4672).',
            { object, type, matched },
          );
          return;
        }

        if (type === 'record.created' || type === 'record.updated') {
          const record =
            (payload.record as Record<string, unknown> | undefined) ?? payload;
          if (record && typeof record === 'object') {
            await service.handleRecordUpsert(object, record as Record<string, unknown>);
          }
          return;
        }
        if (type === 'record.deleted') {
          const recordObj = payload.record as Record<string, unknown> | undefined;
          const id =
            (payload.id as string | undefined) ?? (recordObj?.id as string | undefined);
          if (id) await service.handleRecordDelete(object, id);
        }
      });
      ctx.logger.info?.('KnowledgeServicePlugin: event sync subscription active.');
    });
  }

  async stop(ctx: PluginContext): Promise<void> {
    if (!this.subscriptionId) return;
    try {
      const realtime = ctx.getService<IRealtimeService>('realtime');
      await realtime.unsubscribe(this.subscriptionId);
    } catch {
      // best-effort
    }
    this.subscriptionId = undefined;
  }
}
