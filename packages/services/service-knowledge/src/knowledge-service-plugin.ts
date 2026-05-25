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
        if (
          type === 'record.created' ||
          type === 'record.updated' ||
          type === 'data.record.created' ||
          type === 'data.record.updated'
        ) {
          const record =
            (payload.record as Record<string, unknown> | undefined) ?? payload;
          if (record && typeof record === 'object') {
            await service.handleRecordUpsert(object, record as Record<string, unknown>);
          }
          return;
        }
        if (type === 'record.deleted' || type === 'data.record.deleted') {
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
