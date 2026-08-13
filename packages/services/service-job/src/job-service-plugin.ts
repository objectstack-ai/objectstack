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

/**
 * Best-effort environment label for the cron adapter's entry in croner's
 * process-global name registry — it makes `scheduledJobs` readable when several
 * environments share one container. Cosmetic only: per-instance uniqueness is
 * the adapter's own guarantee and does not depend on this resolving to
 * anything (#8362).
 */
function environmentLabel(): string | undefined {
  const raw = process.env.OS_ENVIRONMENT_ID?.trim();
  return raw ? raw : undefined;
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
  /**
   * init() registers sys_job/sys_job_run through the `manifest` service
   * ObjectQLPlugin provides, and probes the `cluster` service for the cron
   * adapter's leader election — order-if-present so both resolutions are
   * deterministic (ADR-0116, #4471). Soft, not hard: without either the
   * plugin degrades on purpose (in-memory adapter, single-node cron).
   */
  optionalDependencies = ['com.objectstack.engine.objectql', 'com.objectstack.service.cluster'];
  version = '1.1.0';
  type = 'standard';

  private readonly options: JobServicePluginOptions;
  private dbAdapter?: DbJobAdapter;
  private intervalAdapter?: IntervalJobAdapter;
  /** Only set on the `adapter: 'cron'` path — otherwise the cron adapter is
   *  owned (and destroyed) by {@link DbJobAdapter}. */
  private cronAdapter?: CronJobAdapter;

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
      this.intervalAdapter = new IntervalJobAdapter({ ...this.options.interval, logger: ctx.logger });
      ctx.registerService('job', this.intervalAdapter);
      ctx.logger.info('JobServicePlugin: registered IntervalJobAdapter (in-memory)');
      return;
    }

    if (choice === 'cron') {
      // Held on the instance so `destroy()` can reach it: this adapter owns
      // process-global croner names, and a kernel evicted without releasing
      // them blocks every later rebind of those jobs (#8362).
      this.cronAdapter = new CronJobAdapter({
        timezone: 'UTC',
        cluster: getClusterSafe(ctx),
        namespace: environmentLabel(),
        logger: ctx.logger,
      });
      ctx.registerService('job', this.cronAdapter);
      ctx.logger.info('JobServicePlugin: registered CronJobAdapter');
      return;
    }

    // 'auto' or 'db' — register a placeholder Interval adapter synchronously
    // so callers can `getService('job')` during init, then upgrade in kernel:ready
    // when the objectql engine is wired.
    this.intervalAdapter = new IntervalJobAdapter({ ...this.options.interval, logger: ctx.logger });
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
        // Jobs stuck on the placeholder include cron schedules that
        // will never fire. The per-registration warning already fired, but the
        // summary makes "background automation is off" visible in one line.
        const stranded = this.intervalAdapter?.getRegistrations()
          .filter((r) => r.schedule.type === 'cron')
          .map((r) => r.name) ?? [];
        if (stranded.length > 0) {
          ctx.logger.warn(
            `JobServicePlugin: ${stranded.length} cron job(s) will NOT run on IntervalJobAdapter: ${stranded.join(', ')}`,
          );
        }
        return;
      }

      // Build cron adapter if enabled
      let cron: CronJobAdapter | undefined;
      if (this.options.enableCron !== false) {
        try {
          cron = new CronJobAdapter({
            timezone: 'UTC',
            cluster: getClusterSafe(ctx),
            namespace: environmentLabel(),
            logger: ctx.logger,
          });
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
        return;
      }

      // Migrate every registration made against the placeholder.
      // Business plugins `start()` before this hook runs, so their schedules
      // all landed on the IntervalJobAdapter: its cron entries never fired at
      // all, and its interval timers would keep running on the orphaned
      // placeholder (invisible to sys_job) after the swap. Stop the placeholder
      // FIRST — a brief gap beats a double-fire — then re-schedule everything
      // on the DbJobAdapter.
      const pending = this.intervalAdapter?.getRegistrations() ?? [];
      if (this.intervalAdapter) {
        await this.intervalAdapter.destroy();
        this.intervalAdapter = undefined;
      }
      for (const r of pending) {
        try {
          await this.dbAdapter.schedule(r.name, r.schedule, r.handler, r.options);
        } catch (err) {
          ctx.logger.warn(`JobServicePlugin: failed to migrate job "${r.name}" to DbJobAdapter`, err as any);
        }
      }
      if (pending.length > 0) {
        ctx.logger.info(`JobServicePlugin: migrated ${pending.length} early job registration(s) to DbJobAdapter`);
      }

      // Retention is owned by the platform LifecycleService (ADR-0057):
      // sys_job_run declares a 30d `lifecycle` window and the Reaper enforces
      // it — the plugin-local JobRunRetention sweeper this used to wire is
      // retired (ADR-0057 §6: lifecycle is a platform primitive, owned once).
      // Override windows per environment/tenant via the `lifecycle` settings
      // namespace (`retention_overrides`).
    });
  }

  /**
   * Kernel eviction lands here. Every adapter this plugin built must be
   * released, cron included: croner's named registry is process-global, so a
   * timer that outlives its kernel keeps its name for the life of the process
   * and blocks the rebuilt kernel from ever re-binding that job (#8362).
   * `dbAdapter.destroy()` covers the cron adapter it owns; `cronAdapter` is
   * the `adapter: 'cron'` path, where nothing else would.
   */
  async destroy(): Promise<void> {
    await this.dbAdapter?.destroy();
    await this.intervalAdapter?.destroy();
    await this.cronAdapter?.destroy();
  }
}
