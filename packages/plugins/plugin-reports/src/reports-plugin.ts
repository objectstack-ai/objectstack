// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import type { Plugin, PluginContext } from '@objectstack/core';
import {
  SysSavedReport,
  SysReportSchedule,
} from '@objectstack/platform-objects/audit';
import { ReportService, type ReportEngine, type ReportEmail } from './report-service.js';

export interface ReportsPluginOptions {
  /**
   * How often the dispatcher should poll `sys_report_schedule` for
   * due rows. Defaults to 60 seconds — short enough to honour
   * minute-grained schedules without flooding the DB.
   */
  dispatchIntervalMs?: number;
  /** Cap rows per report. Mirrors ReportServiceOptions.maxRows. */
  maxRows?: number;
  /** Disable the dispatcher tick entirely. */
  disableDispatcher?: boolean;
}

/**
 * ReportsServicePlugin — registers `sys_saved_report` /
 * `sys_report_schedule`, the `reports` service, and the dispatcher
 * loop that emails due schedules.
 *
 * The dispatcher uses `IJobService.schedule` when one is registered;
 * otherwise it falls back to a plain `setInterval` so single-kernel
 * deployments work without `service-job`.
 *
 * @example
 * ```ts
 * import { ReportsServicePlugin } from '@objectstack/plugin-reports';
 *
 * kernel.use(new ReportsServicePlugin({ dispatchIntervalMs: 60_000 }));
 * ```
 */
export class ReportsServicePlugin implements Plugin {
  name = 'com.objectstack.service.reports';
  version = '1.0.0';
  type = 'standard';
  dependencies = ['com.objectstack.engine.objectql'];

  private readonly options: ReportsPluginOptions;
  private service?: ReportService;
  private intervalHandle?: ReturnType<typeof setInterval>;
  private jobName?: string;
  private jobService?: any;

  constructor(options: ReportsPluginOptions = {}) {
    this.options = options;
  }

  async init(ctx: PluginContext): Promise<void> {
    ctx.getService<{ register(m: any): void }>('manifest').register({
      id: 'com.objectstack.service.reports',
      name: 'Reports Service',
      version: '1.0.0',
      type: 'plugin',
      scope: 'system',
      defaultDatasource: 'cloud',
      namespace: 'sys',
      objects: [SysSavedReport, SysReportSchedule],
    });
    ctx.logger.info('ReportsServicePlugin: schemas registered');
  }

  async start(ctx: PluginContext): Promise<void> {
    ctx.hook('kernel:ready', async () => {
      let engine: any = null;
      try { engine = ctx.getService<any>('objectql'); }
      catch { try { engine = ctx.getService<any>('data'); } catch { /* ignore */ } }
      if (!engine) {
        ctx.logger.warn('ReportsServicePlugin: no ObjectQL engine — service NOT registered');
        return;
      }

      let email: ReportEmail | undefined;
      try { email = ctx.getService<any>('email'); } catch { /* email is optional */ }
      if (!email) {
        ctx.logger.warn('ReportsServicePlugin: no email service — schedules will fire without delivery');
      }

      // [#3544 / #3710] The user-level export axis. A `csv`/`json` report is a
      // bulk machine-readable copy of its object — the same privilege
      // `GET /data/:object/export` gates — so the reports surface must ask the
      // SAME question of the SAME authority, or it is a side door around the
      // axis. Resolved lazily per call rather than captured here: `security` is
      // registered by plugin-security's own `kernel:ready` hook and may not
      // exist yet at construction time. Absent service (no plugin-security ⇒ no
      // permission sets anywhere) → the axis does not apply, matching the REST
      // export route's fail-open.
      const canExport = async (object: string, context: unknown): Promise<boolean> => {
        let security: any;
        try { security = ctx.getService<any>('security'); } catch { return true; }
        if (!security || typeof security.canExport !== 'function') return true;
        return await security.canExport(object, context);
      };

      this.service = new ReportService({
        engine: engine as ReportEngine,
        email,
        logger: ctx.logger,
        maxRows: this.options.maxRows,
        canExport,
        // Scheduled reports run under the owner's resolved RLS context, not a
        // system bypass (#2980). No owner-context resolver is wired yet — that
        // is the reports-surface consumer of ADR-0073's user-less identity
        // resolution (M2) — so until it lands, scheduled runs FAIL CLOSED
        // (skipped + marked failed) rather than exfiltrate. Interactive runs
        // (run/runAdHoc) are unaffected: they carry the caller's context.
        resolveOwnerContext: undefined,
      });
      ctx.registerService('reports', this.service);

      if (this.options.disableDispatcher) {
        ctx.logger.info('ReportsServicePlugin: dispatcher disabled (disableDispatcher=true)');
        return;
      }

      const intervalMs = Math.max(5_000, this.options.dispatchIntervalMs ?? 60_000);

      // Prefer the platform job service when available — it lets ops
      // see report dispatch alongside every other scheduled job.
      try {
        const job = ctx.getService<any>('job');
        if (job && typeof job.schedule === 'function') {
          this.jobService = job;
          this.jobName = 'reports.dispatch';
          await job.schedule(this.jobName, { type: 'interval', intervalMs }, async () => {
            try { await this.service?.dispatchDue(); }
            catch (err) { ctx.logger.warn('ReportsServicePlugin: dispatch tick failed', err as any); }
          });
          ctx.logger.info('ReportsServicePlugin: dispatcher registered with job service', { intervalMs });
          return;
        }
      } catch { /* fall through to setInterval */ }

      this.intervalHandle = setInterval(() => {
        this.service?.dispatchDue().catch(err => {
          ctx.logger.warn('ReportsServicePlugin: dispatch tick failed', err);
        });
      }, intervalMs);
      // Don't keep Node alive purely for the dispatcher — common
      // mistake in tests / serverless. unref is a no-op in some
      // runtimes which is fine.
      (this.intervalHandle as any)?.unref?.();
      ctx.logger.info('ReportsServicePlugin: dispatcher registered (setInterval fallback)', { intervalMs });
    });
  }

  async stop(ctx: PluginContext): Promise<void> {
    if (this.intervalHandle) clearInterval(this.intervalHandle);
    this.intervalHandle = undefined;
    if (this.jobService && this.jobName && typeof this.jobService.cancel === 'function') {
      try { await this.jobService.cancel(this.jobName); }
      catch (err) { ctx.logger.warn('ReportsServicePlugin: failed to cancel job', err as any); }
    }
  }
}
