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
import { createKnowledgeReapGuard, guardedObjectsFor } from './knowledge-reap-guard.js';

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
  /**
   * Captured where the subscription is taken out, not resolved at teardown:
   * `destroy()` — the hook the kernel actually calls — takes NO
   * `PluginContext` (`Plugin.destroy?(): Promise<void> | void`, core
   * `types.ts`). Holding the very service the subscription was placed with also
   * means the unsubscribe cannot miss it because the registry has already been
   * torn down around us.
   */
  private realtime: IRealtimeService | undefined;
  private logger: KnowledgeLogger | undefined;

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

    this.logger = logger;
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
      // Reap-path de-indexing first: it is independent of the realtime service,
      // and the branch below returns early when that one is absent.
      this.installReapGuards(ctx, service);

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

      this.realtime = realtime;
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
        //
        // [#4672] The warn STAYS, and it is deliberately still a warn about a
        // gap — but a narrower gap than it named before. The platform's own
        // predicate delete (the retention sweep's reap, and the source this
        // issue called out as the main one) no longer reaches this handler as a
        // stale index at all: `installReapGuards` de-indexes those rows before
        // they are deleted. What is left is APPLICATION-level predicate writes
        // — a caller's own `multi: true` update/delete — which no guard sits in
        // front of. That half is honestly uncovered rather than quietly
        // half-claimed, and stays so until a real object source justifies the
        // adapter-enumeration surface it would need (#4606's enforced-first
        // rule). Reporting it accurately is the whole job of this branch.
        if (type === 'data.records.updated' || type === 'data.records.deleted') {
          const matched = payload.matched;
          ctx.logger.warn?.(
            `KnowledgeServicePlugin: '${object}' had a predicate write (${type}) affecting ` +
              `${typeof matched === 'number' ? matched : 'an unreported number of'} record(s). ` +
              'A bulk event carries a count, not records, so the knowledge index for this object ' +
              'may now be stale and cannot be repaired from the event stream (#4639). ' +
              'Retention-sweep deletes are covered separately by the lifecycle reap guard (#4672); ' +
              'application-level predicate writes are not, and need an explicit reindexSource.',
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

  /**
   * Register the lifecycle reap guard (#4672, ADR-0057 amendment) for every
   * object an `object` source projects.
   *
   * ## Why the guard rather than an event
   *
   * The retention sweep deletes rows by predicate, and ADR-0057 §3.3 forbids
   * fanning that out per record (the cleanup would re-feed the tables it is
   * draining). Without a guard the rows go and their documents stay: orphans,
   * keyed by a `sourceRecordId` that resolves to nothing. The ADR's own answer
   * to this shape is the guard — "a domain callback, not a second sweeper" —
   * and it arrives batched and interruptible for free (500 rows a batch, 20
   * batches a sweep), which is the cost bound this work would otherwise owe.
   *
   * ## Seams, all pre-existing
   *
   * Reached exactly as `service-storage` reaches it for `sys_file` byte
   * reclaim: duck-typed `ctx.getService('lifecycle')` +
   * `registerReapGuard(object, guard)`. No spec key, no `IKnowledgeAdapter`
   * member, no `packages/objectql` change (#4606's zero-addition boundary).
   * Guards compose by intersection (#5535), so registering here cannot displace
   * storage's byte-reclaim guard, nor it ours.
   *
   * Silent when there is no lifecycle service (a bare kernel): the sweep is
   * what deletes rows, so no sweeper means no orphans to prevent. Nothing is
   * concluded about the registry either — this runs at `kernel:ready`, and the
   * absence is neither cached nor asserted.
   *
   * One guard instance serves every object (it resolves its targets from the
   * `object` it is called with), and re-registering the identical function is a
   * documented no-op, so re-run wiring cannot double a de-index.
   *
   * ## Boundary, stated rather than implied
   *
   * The OBJECT SET is read once, here — every object declared by boot time,
   * which is every object the sources a host composes can name. A source
   * registered later through `registerSource` for an object that had none at
   * boot is therefore unguarded, while one for an already-guarded object is
   * picked up (the guard re-resolves its targets on each call). Making the set
   * itself dynamic would mean a new notification surface on the service, which
   * is precisely the addition #4606 rules out until a real `object` source
   * exists to justify it.
   */
  private installReapGuards(ctx: PluginContext, service: KnowledgeService): void {
    const objects = guardedObjectsFor(service.listSources());
    if (objects.length === 0) return;

    type LifecycleLike = {
      registerReapGuard?: (object: string, guard: ReturnType<typeof createKnowledgeReapGuard>) => void;
    };
    let lifecycle: LifecycleLike | undefined;
    try {
      lifecycle = ctx.getService<LifecycleLike>('lifecycle');
    } catch {
      return; // no lifecycle service — nothing reaps, nothing to guard.
    }
    if (!lifecycle || typeof lifecycle.registerReapGuard !== 'function') return;

    const guard = createKnowledgeReapGuard(service, this.logger);
    // Called AS A METHOD, never through a detached reference: the real
    // `LifecycleService.registerReapGuard` reads `this.reapGuards`, so
    // `const register = lifecycle.registerReapGuard` throws on the first call.
    for (const object of objects) lifecycle.registerReapGuard(object, guard);
    ctx.logger.info?.(
      `KnowledgeServicePlugin: reap guards registered with the lifecycle service for [${objects.join(', ')}] — ` +
        'rows are de-indexed before the retention sweep deletes them.',
    );
  }

  /**
   * The kernel's teardown hook (`Plugin.destroy?()`, core `types.ts`) — the
   * ONLY teardown entry point `ObjectKernel.performShutdown()` and
   * `LiteKernel.destroy()` invoke.
   *
   * [#10371] IT USED TO BE `stop()`, WHICH NOTHING CALLED. `Plugin` declares
   * `init()`, `start?()` and `destroy?()` and no `stop()`, so the kernel walked
   * past this plugin at shutdown and the `knowledge-event-sync` realtime
   * subscription outlived the kernel that created it. `start()` IS on the
   * interface, so the pair read as symmetric in review — that asymmetry is what
   * let the same shape survive in six packages at once.
   *
   * No timer here, so this member never cost a merge-queue eviction the way the
   * `plugin-reports` / `service-messaging` members did (#9371). The class is
   * the same one either way: a teardown the kernel does not reach.
   */
  async destroy(): Promise<void> {
    if (!this.subscriptionId) return;
    try {
      await this.realtime?.unsubscribe(this.subscriptionId);
    } catch {
      // best-effort
    }
    this.subscriptionId = undefined;
    this.realtime = undefined;
  }

  /**
   * Retained alias for {@link destroy}. Kept because it is public API of an
   * exported class, and removing it would break an embedder who learned to call
   * it directly precisely BECAUSE the kernel never did. The parameter is now
   * optional and ignored: `destroy()` takes no context, so teardown uses the
   * realtime service captured when the subscription was taken out. Prefer
   * kernel shutdown; direct callers keep working unchanged.
   */
  async stop(_ctx?: PluginContext): Promise<void> {
    await this.destroy();
  }
}
