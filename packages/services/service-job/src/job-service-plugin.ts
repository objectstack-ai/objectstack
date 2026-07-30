// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import type { Plugin, PluginContext } from '@objectstack/core';
import { SysJob, SysJobRun } from '@objectstack/platform-objects/audit';
import { IntervalJobAdapter } from './interval-job-adapter.js';
import type { IntervalJobAdapterOptions } from './interval-job-adapter.js';
import { CronJobAdapter } from './cron-job-adapter.js';
import { DbJobAdapter } from './db-job-adapter.js';
import type { DbJobAdapterOptions } from './db-job-adapter.js';

/**
 * Configuration options for the JobServicePlugin.
 */
/** Resolve the cluster service if present; undefined on single-node. */
function getClusterSafe(ctx: any): any {
  try { return ctx.getService('cluster'); } catch { return undefined; }
}

export interface JobServicePluginOptions {
  /**
   * Job adapter type.
   *  - 'auto' (default): use DbJobAdapter when objectql engine available, else IntervalJobAdapter
   *  - 'db': require objectql; persists schedules and runs to sys_job/sys_job_run
   *  - 'interval': in-memory IntervalJobAdapter (legacy, non-durable)
   *  - 'cron': in-memory CronJobAdapter using `croner`
   */
  adapter?: 'auto' | 'db' | 'interval' | 'cron';
  /** Options for the interval job adapter */
  interval?: IntervalJobAdapterOptions;
  /** Options for the DB adapter */
  db?: DbJobAdapterOptions;
  /** Whether to also wire CronJobAdapter for cron schedules (default: true when available) */
  enableCron?: boolean;
}

/**
 * JobServicePlugin — Production IJobService implementation.
 *
 * Default behaviour: registers a `DbJobAdapter` when the ObjectQL engine is
 * available (persisting registry + execution history to `sys_job` and
 * `sys_job_run`), falling back to in-memory `IntervalJobAdapter` otherwise.
 * Cron schedules are routed to `CronJobAdapter` (croner-backed).
 */
export class JobServicePlugin implements Plugin {
  name = 'com.objectstack.service.job';
  /**
   * Services init() registers on every path (ADR-0116, #4131) — lets the
   * kernel name this plugin when a consumer requires one before it inits.
   */
  providesServices = ['job'];
  version = '1.1.0';
  type = 'standard';

  private readonly options: JobServicePluginOptions;
  private dbAdapter?: DbJobAdapter;
  private intervalAdapter?: IntervalJobAdapter;

  constructor(options: JobServicePluginOptions = {}) {
    this.options = {
      adapter: 'auto',
      enableCron: true,
      ...options,
    };
  }

  async init(ctx: PluginContext): Promise<void> {
    // Register platform objects so Studio can see scheduled jobs and runs.
    try {
      ctx.getService<{ register(m: any): void }>('manifest').register({
        id: 'com.objectstack.service.job',
        name: 'Background Job Service',
        version: '1.1.0',
        type: 'plugin',
        scope: 'system',
        defaultDatasource: 'cloud',
        namespace: 'sys',
        objects: [SysJob, SysJobRun],
      });
    } catch (err) {
      ctx.logger.warn('JobServicePlugin: manifest service unavailable; sys_job/sys_job_run not registered', err as any);
    }

    const choice = this.options.adapter ?? 'auto';

    if (choice === 'interval') {
      this.intervalAdapter = new IntervalJobAdapter(this.options.interval);
      ctx.registerService('job', this.intervalAdapter);
      ctx.logger.info('JobServicePlugin: registered IntervalJobAdapter (in-memory)');
      return;
    }

    if (choice === 'cron') {
      const cron = new CronJobAdapter({ timezone: 'UTC', cluster: getClusterSafe(ctx) });
      ctx.registerService('job', cron);
      ctx.logger.info('JobServicePlugin: registered CronJobAdapter');
      return;
    }

    // 'auto' or 'db' — register a placeholder Interval adapter synchronously
    // so callers can `getService('job')` during init, then upgrade in kernel:ready
    // when the objectql engine is wired.
    this.intervalAdapter = new IntervalJobAdapter(this.options.interval);
    ctx.registerService('job', this.intervalAdapter);

    ctx.hook('kernel:ready', async () => {
      let engine: any = null;
      try { engine = ctx.getService<any>('objectql'); }
      catch { try { engine = ctx.getService<any>('data'); } catch { /* ignore */ } }

      if (!engine) {
        if (choice === 'db') {
          ctx.logger.warn('JobServicePlugin: db adapter requested but no ObjectQL engine — staying on IntervalJobAdapter');
        } else {
          ctx.logger.info('JobServicePlugin: no ObjectQL engine — staying on IntervalJobAdapter');
        }
        return;
      }

      // Build cron adapter if enabled
      let cron: CronJobAdapter | undefined;
      if (this.options.enableCron !== false) {
        try {
          cron = new CronJobAdapter({ timezone: 'UTC', cluster: getClusterSafe(ctx) });
        } catch (err) {
          ctx.logger.warn('JobServicePlugin: cron adapter init failed; cron jobs will not auto-run', err as any);
        }
      }

      this.dbAdapter = new DbJobAdapter({
        engine,
        logger: ctx.logger,
        options: this.options.db,
        cron,
      });

      try {
        (ctx as any).replaceService?.('job', this.dbAdapter);
        ctx.logger.info('JobServicePlugin: upgraded to DbJobAdapter (sys_job + sys_job_run persistence)');
      } catch (err) {
        ctx.logger.warn('JobServicePlugin: replaceService failed; staying on IntervalJobAdapter', err as any);
      }

      // Retention is owned by the platform LifecycleService (ADR-0057):
      // sys_job_run declares a 30d `lifecycle` window and the Reaper enforces
      // it — the plugin-local JobRunRetention sweeper this used to wire is
      // retired (ADR-0057 §6: lifecycle is a platform primitive, owned once).
      // Override windows per environment/tenant via the `lifecycle` settings
      // namespace (`retention_overrides`).
    });
  }

  async destroy(): Promise<void> {
    await this.dbAdapter?.destroy();
    await this.intervalAdapter?.destroy();
  }
}
