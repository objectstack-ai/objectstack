// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import type { Plugin, PluginContext } from '@objectstack/core';
import { SysJob, SysJobRun } from '@objectstack/platform-objects/audit';
import { IntervalJobAdapter } from './interval-job-adapter.js';
import type { IntervalJobAdapterOptions } from './interval-job-adapter.js';
import { CronJobAdapter } from './cron-job-adapter.js';
import { DbJobAdapter } from './db-job-adapter.js';
import type { DbJobAdapterOptions, JobEngineLike } from './db-job-adapter.js';
import {
  JobRunRetention,
  DEFAULT_JOB_RUN_RETENTION_DAYS,
  DEFAULT_JOB_RUN_SWEEP_MS,
} from './job-run-retention.js';

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
  /**
   * Retention window in days for `sys_job_run` execution-history rows
   * (launch-readiness.md P1-2). Every run appends a row, so without pruning the
   * table grows unbounded. **Default-on** at {@link DEFAULT_JOB_RUN_RETENTION_DAYS}
   * — a periodic sweep deletes rows older than this. Set to `0` to disable
   * retention (rows kept forever; operator owns cleanup). Only applies on the
   * DB-backed adapter (no `sys_job_run` table exists for interval/cron).
   */
  retentionDays?: number;
  /** Retention sweep interval in ms (default {@link DEFAULT_JOB_RUN_SWEEP_MS}). Only used when `retentionDays > 0`. */
  retentionSweepMs?: number;
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
  version = '1.1.0';
  type = 'standard';

  private readonly options: JobServicePluginOptions;
  private dbAdapter?: DbJobAdapter;
  private intervalAdapter?: IntervalJobAdapter;
  private retentionTimer?: ReturnType<typeof setInterval>;

  constructor(options: JobServicePluginOptions = {}) {
    this.options = {
      adapter: 'auto',
      enableCron: true,
      retentionDays: DEFAULT_JOB_RUN_RETENTION_DAYS,
      retentionSweepMs: DEFAULT_JOB_RUN_SWEEP_MS,
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

      // Retention sweep (launch-readiness.md P1-2): bound the append-only
      // sys_job_run log. Default-on — an unbounded run history is a guaranteed
      // slow leak. Runs once now then on a low-frequency interval; the timer is
      // unref'd so it never keeps the process alive. Only wired on the DB path
      // (the table exists only there).
      const retentionDays = this.options.retentionDays ?? DEFAULT_JOB_RUN_RETENTION_DAYS;
      if (retentionDays > 0) {
        const retention = new JobRunRetention({
          getEngine: () => engine as JobEngineLike,
          logger: ctx.logger,
        });
        const sweepMs = this.options.retentionSweepMs ?? DEFAULT_JOB_RUN_SWEEP_MS;
        const sweep = () => {
          void retention.prune(retentionDays).catch((err) =>
            ctx.logger.warn(`JobServicePlugin: retention sweep failed: ${(err as Error)?.message ?? err}`),
          );
        };
        sweep();
        this.retentionTimer = setInterval(sweep, sweepMs);
        this.retentionTimer.unref?.();
        ctx.logger.info(
          `JobServicePlugin: sys_job_run retention on (prune > ${retentionDays}d every ${Math.round(sweepMs / 1000)}s)`,
        );
      }
    });
  }

  async destroy(): Promise<void> {
    if (this.retentionTimer) {
      clearInterval(this.retentionTimer);
      this.retentionTimer = undefined;
    }
    await this.dbAdapter?.destroy();
    await this.intervalAdapter?.destroy();
  }
}
