// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import type { Plugin, PluginContext } from '@objectstack/core';
import { SysJobQueue } from '@objectstack/platform-objects/audit';
import { MemoryQueueAdapter } from './memory-queue-adapter.js';
import type { MemoryQueueAdapterOptions } from './memory-queue-adapter.js';
import { DbQueueAdapter } from './db-queue-adapter.js';
import type { DbQueueAdapterOptions, LifecycleFloorRegistrar } from './db-queue-adapter.js';

/**
 * Configuration options for the QueueServicePlugin.
 */
export interface QueueServicePluginOptions {
  /**
   * Queue adapter type.
   *  - 'auto' (default): use DbQueueAdapter when objectql engine available, else MemoryQueueAdapter
   *  - 'db': require objectql; persists messages, retries, and DLQ to sys_job_queue
   *  - 'memory': in-process MemoryQueueAdapter (non-durable, dev/test)
   */
  adapter?: 'auto' | 'db' | 'memory';
  /** Options for the memory queue adapter */
  memory?: MemoryQueueAdapterOptions;
  /** Options for the DB adapter (polling, batch, lease, idempotency window…) */
  db?: DbQueueAdapterOptions;
}

/**
 * QueueServicePlugin — Production IQueueService implementation.
 *
 * Default: registers MemoryQueueAdapter synchronously so producers can
 * publish during plugin init; upgrades to DbQueueAdapter on `kernel:ready`
 * when an ObjectQL engine is available. Subscribers registered against
 * the (now-replaced) memory queue must re-subscribe after upgrade — for
 * that reason most plugins register subscribers inside their own
 * `kernel:ready` hook, which fires after this one.
 */
export class QueueServicePlugin implements Plugin {
  name = 'com.objectstack.service.queue';
  /**
   * Services init() registers on every path (ADR-0116, #4131) — lets the
   * kernel name this plugin when a consumer requires one before it inits.
   */
  providesServices = ['queue'];
  /**
   * init() registers sys_job_queue through the `manifest` service
   * ObjectQLPlugin provides — order-if-present so the registration is
   * deterministic (ADR-0116, #4471). Soft, not hard: without an engine the
   * plugin degrades on purpose (in-memory queue adapter).
   */
  optionalDependencies = ['com.objectstack.engine.objectql'];
  version = '1.1.0';
  type = 'standard';

  private readonly options: QueueServicePluginOptions;
  private dbAdapter?: DbQueueAdapter;

  constructor(options: QueueServicePluginOptions = {}) {
    this.options = { adapter: 'auto', ...options };
  }

  async init(ctx: PluginContext): Promise<void> {
    // Register sys_job_queue (also serves as DLQ view) so Studio can list/replay.
    try {
      ctx.getService<{ register(m: any): void }>('manifest').register({
        id: 'com.objectstack.service.queue',
        name: 'Queue Service',
        version: '1.1.0',
        type: 'plugin',
        scope: 'system',
        defaultDatasource: 'cloud',
        namespace: 'sys',
        objects: [SysJobQueue],
      });
    } catch (err) {
      ctx.logger.warn('QueueServicePlugin: manifest service unavailable; sys_job_queue not registered', err as any);
    }

    const choice = this.options.adapter ?? 'auto';

    if (choice === 'memory') {
      const q = new MemoryQueueAdapter(this.options.memory);
      ctx.registerService('queue', q);
      ctx.logger.info('QueueServicePlugin: registered MemoryQueueAdapter');
      return;
    }

    // auto / db — register memory placeholder, upgrade on kernel:ready
    ctx.registerService('queue', new MemoryQueueAdapter(this.options.memory));

    ctx.hook('kernel:ready', async () => {
      let engine: any = null;
      try { engine = ctx.getService<any>('objectql'); }
      catch { try { engine = ctx.getService<any>('data'); } catch { /* ignore */ } }

      if (!engine) {
        if (choice === 'db') {
          ctx.logger.warn('QueueServicePlugin: db adapter requested but no ObjectQL engine — staying on MemoryQueueAdapter');
        } else {
          ctx.logger.info('QueueServicePlugin: no ObjectQL engine — staying on MemoryQueueAdapter');
        }
        return;
      }

      this.dbAdapter = new DbQueueAdapter({
        engine,
        logger: ctx.logger,
        options: this.options.db,
      });

      // [#5195] Tell the LifecycleService how short sys_job_queue's retention
      // may get. The adapter's constructor already refuses an idempotency
      // window longer than the DECLARED retention (#5179), but ADR-0057 P4
      // overrides live in the `lifecycle` settings namespace, which the
      // constructor never sees — an operator setting `maxAge: '1h'` would reap
      // the rows publish dedups against and duplicate deliveries would resume
      // silently. The floor carries the window this adapter was actually
      // constructed with, so a non-default `db.idempotencyWindowMs` is covered
      // too.
      this.registerRetentionFloor(ctx, this.dbAdapter);

      try {
        (ctx as any).replaceService?.('queue', this.dbAdapter);
        this.dbAdapter.start();
        ctx.logger.info('QueueServicePlugin: upgraded to DbQueueAdapter (sys_job_queue persistence)');
      } catch (err) {
        ctx.logger.warn('QueueServicePlugin: replaceService failed; staying on MemoryQueueAdapter', err as any);
      }
    });
  }

  /**
   * [#5195] Register the adapter's retention floor with the platform
   * LifecycleService. Best-effort: a kernel without a lifecycle service has no
   * sweeper either, so there is no override for anything to bypass.
   *
   * The lookup is typed to {@link LifecycleFloorRegistrar} — the slot's
   * contract as this package consumes it — rather than erased to `any`
   * (#4127/#4251). The `typeof … === 'function'` probe stays because the method
   * is genuinely optional (a lifecycle service predating floors), but it is now
   * a check the compiler can see rather than one `any` was hiding.
   */
  private registerRetentionFloor(ctx: PluginContext, adapter: DbQueueAdapter): void {
    let lifecycle: LifecycleFloorRegistrar | undefined;
    try {
      lifecycle = ctx.getService<LifecycleFloorRegistrar>('lifecycle');
    } catch {
      lifecycle = undefined;
    }
    if (!lifecycle || typeof lifecycle.registerRetentionFloor !== 'function') return;
    try {
      lifecycle.registerRetentionFloor(SysJobQueue.name, adapter.retentionFloor());
      ctx.logger.info(
        `QueueServicePlugin: registered a ${adapter.idempotencyWindowMs}ms retention floor on ${SysJobQueue.name} `
        + 'with the lifecycle service (settings overrides below it are rejected)',
      );
    } catch (err) {
      // A floor the service refused is a wiring bug in THIS plugin, not a
      // degraded deployment — but it must not stop the queue from coming up.
      ctx.logger.error(
        'QueueServicePlugin: the lifecycle service rejected the sys_job_queue retention floor. A `lifecycle` '
        + 'settings override may now shorten sys_job_queue.retention below the idempotency window, in which case '
        + 'publish would silently re-accept duplicates (#5195). Fix the floor registration, or keep '
        + 'lifecycle.retention_overrides.sys_job_queue unset.',
        err as any,
      );
    }
  }

  async destroy(): Promise<void> {
    await this.dbAdapter?.stop();
  }
}
