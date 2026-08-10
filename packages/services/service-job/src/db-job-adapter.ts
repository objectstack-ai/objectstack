// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import type {
  IJobService,
  JobSchedule,
  JobHandler,
  JobExecution,
  JobScheduleOptions,
} from '@objectstack/spec/contracts';
import { IntervalJobAdapter } from './interval-job-adapter.js';

const JOB_TABLE = 'sys_job';
const RUN_TABLE = 'sys_job_run';
const SYSTEM_CTX = { isSystem: true, positions: [], permissions: [] } as const;

export interface JobEngineLike {
  find(object: string, options?: any): Promise<any[]>;
  insert(object: string, data: any, options?: any): Promise<any>;
  update(object: string, idOrData: any, dataOrOptions?: any, options?: any): Promise<any>;
  delete?(object: string, options?: any): Promise<any>;
}

export interface JobLoggerLike {
  info(msg: string, meta?: unknown): void;
  warn(msg: string, meta?: unknown): void;
  error?(msg: string, meta?: unknown): void;
}

export interface DbJobAdapterOptions {
  /** Maximum executions kept in memory per job (default 100) */
  maxExecutions?: number;
  /** Soft cap on sys_job_run rows recorded per job (defaults to none — handled by retention jobs) */
  recordRuns?: boolean;
}

function uid(prefix: string): string {
  const g: any = globalThis as any;
  if (g.crypto?.randomUUID) return `${prefix}_${g.crypto.randomUUID()}`;
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * DbJobAdapter — IJobService that persists job registry and execution
 * history to ObjectQL while delegating timer mechanics to
 * `IntervalJobAdapter`. Cron is delegated to `CronJobAdapter` callers
 * supplied via {@link withCron}.
 *
 * Persisted side effects:
 *   - `schedule(name, …)` upserts a `sys_job` row (active=true)
 *   - `cancel(name)` marks the row inactive
 *   - every execution writes a `sys_job_run` row
 *   - every execution updates `sys_job.last_run_at / last_status / run_count / failure_count`
 *
 * The persistence is best-effort: a DB failure is logged but does not
 * break job execution. This keeps a healthy job system resilient to
 * transient storage hiccups.
 */
export class DbJobAdapter implements IJobService {
  private readonly inner: IntervalJobAdapter;
  private readonly cron?: IJobService;
  private readonly engine: JobEngineLike;
  private readonly logger?: JobLoggerLike;
  private readonly recordRuns: boolean;

  constructor(args: {
    engine: JobEngineLike;
    logger?: JobLoggerLike;
    options?: DbJobAdapterOptions;
    cron?: IJobService;
  }) {
    this.engine = args.engine;
    this.logger = args.logger;
    this.recordRuns = args.options?.recordRuns ?? true;
    this.inner = new IntervalJobAdapter({ maxExecutions: args.options?.maxExecutions });
    this.cron = args.cron;
  }

  // ── IJobService ──────────────────────────────────────────────────

  async schedule(name: string, schedule: JobSchedule, handler: JobHandler, options?: JobScheduleOptions): Promise<void> {
    const wrapped = this.wrap(name, handler, 'schedule');

    if (schedule.type === 'cron') {
      if (this.cron) await this.cron.schedule(name, schedule, wrapped, options);
      else this.logger?.warn?.(
        `DbJobAdapter: cron schedule registered for "${name}" without CronJobAdapter — job will only run via manual trigger`,
      );
      // Still record in inner so trigger() works
      await this.inner.schedule(name, schedule, wrapped, options);
    } else {
      await this.inner.schedule(name, schedule, wrapped, options);
    }

    await this.upsertJobRow(name, schedule, true);
  }

  async cancel(name: string): Promise<void> {
    await this.inner.cancel(name);
    if (this.cron && typeof this.cron.cancel === 'function') {
      try { await this.cron.cancel(name); } catch { /* ignore */ }
    }
    await this.setActive(name, false);
  }

  async trigger(name: string, data?: unknown): Promise<void> {
    await this.inner.trigger(name, data);
  }

  async getExecutions(name: string, limit?: number): Promise<JobExecution[]> {
    return this.inner.getExecutions(name, limit);
  }

  async listJobs(): Promise<string[]> {
    return this.inner.listJobs();
  }

  async replay(name: string, data?: unknown): Promise<void> {
    // Same execution path as trigger but tag the run as 'replay'.
    const handlers = (this.inner as any).jobs?.get?.(name);
    if (!handlers) throw new Error(`Job "${name}" not found`);
    // Reuse trigger; the wrap function uses a closure flag — simpler:
    // expose by calling inner.trigger with a marker via data is intrusive,
    // so we record a synthetic run row before/after to ensure 'replay' tag.
    const runId = await this.startRun(name, 'replay');
    try {
      await this.inner.trigger(name, data);
      // The wrap already recorded a run; settle our synthetic row the same way
      // it settled that one. `IJobService.trigger` resolves `void` by contract,
      // so the outcome cannot come back through it — it is read off the
      // execution the inner adapter just recorded (#5548). Without this, a
      // replayed degraded run would land TWO rows disagreeing with each other,
      // one `degraded` and one `success`, which is the very defect this card
      // fixes wearing a `trigger: 'replay'` tag.
      const [last] = await this.inner.getExecutions(name, 1);
      if (last?.status === 'degraded') await this.finishRun(runId, 'degraded', last.error);
      else await this.finishRun(runId, 'success');
    } catch (err) {
      await this.finishRun(runId, 'failed', err instanceof Error ? err.message : String(err));
      throw err;
    }
  }

  async listExecutionsByStatus(
    status: JobExecution['status'],
    limit?: number,
  ): Promise<JobExecution[]> {
    const rows = await this.engine.find(RUN_TABLE, {
      where: { status },
      limit: limit ?? 50,
      orderBy: [{ field: 'started_at', order: 'desc' }],
      context: SYSTEM_CTX,
    });
    return (rows ?? []).map((r: any) => ({
      jobId: String(r.job_name),
      status: r.status,
      startedAt: r.started_at,
      completedAt: r.completed_at ?? undefined,
      durationMs: r.duration_ms ?? undefined,
      error: r.error ?? undefined,
    }));
  }

  async destroy(): Promise<void> {
    await this.inner.destroy();
  }

  // ── Internals ────────────────────────────────────────────────────

  /**
   * Wrap a handler so every execution lands a `sys_job_run` row and updates
   * the `sys_job` summary.
   *
   * **How the run's status is decided** (#5548, executing the 2026-08-08
   * maintainer ruling — B-minimal — on the three-outcome {@link JobHandler}
   * table #6617 shipped):
   *
   * | The handler… | `sys_job_run.status` | `sys_job.last_status` | retried? |
   * |:---|:---|:---|:---|
   * | throws | `failed` (message in `error`) | `failed`, `failure_count` +1 | yes, by the retry policy |
   * | resolves `undefined` | `success` | `success` | no |
   * | resolves `{ outcome: 'completed' }` | `success` | `success` | no |
   * | resolves `{ outcome: 'degraded', reason? }` | `degraded` (reason in `error`) | `degraded`, `failure_count` **flat** | no |
   *
   * Until this wiring, "the handler did not throw" WAS the success criterion,
   * so a handler that degraded internally — #5529's wait-wake shot into an
   * unreachable store is the live specimen — was recorded as indistinguishable
   * from one that did its work.
   *
   * **Additive by construction**: the third state is read off the RESOLVED
   * VALUE, and a handler that resolves `undefined` (i.e. every handler written
   * before #6617, byte for byte) takes the `success` branch exactly as before.
   * Retry is untouched — it keys on a *rejected* promise only, so a `degraded`
   * run never re-runs (`spec/contracts/job-service.ts`, the JobHandler TSDoc).
   */
  private wrap(name: string, handler: JobHandler, defaultTrigger: 'schedule' | 'manual' | 'replay'): JobHandler {
    return async (ctx) => {
      const runId = this.recordRuns ? await this.startRun(name, defaultTrigger) : undefined;
      const startMs = Date.now();
      try {
        const outcome = await handler(ctx);
        if (outcome && outcome.outcome === 'degraded') {
          // Not a failure: the reason rides the existing `error` column and
          // `failure_count` stays flat (decided on #7072, recorded in the
          // `JobExecutionStatus` TSDoc). A reader must gate on `status`
          // before reading that column as a failure.
          const reason = outcome.reason;
          if (runId) await this.finishRun(runId, 'degraded', reason, Date.now() - startMs);
          await this.bumpJob(name, 'degraded', reason);
          return outcome;
        }
        if (runId) await this.finishRun(runId, 'success', undefined, Date.now() - startMs);
        await this.bumpJob(name, 'success');
        return outcome;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (runId) await this.finishRun(runId, 'failed', msg, Date.now() - startMs);
        await this.bumpJob(name, 'failed', msg);
        throw err;
      }
    };
  }

  private async startRun(jobName: string, trigger: 'schedule' | 'manual' | 'replay'): Promise<string | undefined> {
    const id = uid('run');
    const now = new Date().toISOString();
    try {
      await this.engine.insert(RUN_TABLE, {
        id,
        job_name: jobName,
        status: 'running',
        started_at: now,
        trigger,
        attempt: 1,
        created_at: now,
      }, { context: SYSTEM_CTX });
      return id;
    } catch (err) {
      this.logger?.warn?.('DbJobAdapter: failed to insert sys_job_run', err as any);
      return undefined;
    }
  }

  private async finishRun(
    id: string | undefined,
    status: JobExecution['status'],
    error?: string,
    durationMs?: number,
  ): Promise<void> {
    if (!id) return;
    const now = new Date().toISOString();
    try {
      await this.engine.update(RUN_TABLE, {
        id,
        status,
        completed_at: now,
        duration_ms: durationMs,
        error: error ?? null,
      }, { context: SYSTEM_CTX });
    } catch (err) {
      this.logger?.warn?.('DbJobAdapter: failed to update sys_job_run', err as any);
    }
  }

  private async upsertJobRow(name: string, schedule: JobSchedule, active: boolean): Promise<void> {
    const now = new Date().toISOString();
    const expression =
      schedule.expression ?? (schedule.intervalMs != null ? String(schedule.intervalMs) : schedule.at);
    try {
      const existing = await this.engine.find(JOB_TABLE, {
        where: { name },
        limit: 1,
        context: SYSTEM_CTX,
      });
      const row = existing?.[0];
      if (row) {
        await this.engine.update(JOB_TABLE, {
          id: row.id,
          schedule_type: schedule.type,
          schedule_expression: expression ?? null,
          timezone: schedule.timezone ?? null,
          active,
          updated_at: now,
        }, { context: SYSTEM_CTX });
      } else {
        await this.engine.insert(JOB_TABLE, {
          id: uid('job'),
          name,
          schedule_type: schedule.type,
          schedule_expression: expression ?? null,
          timezone: schedule.timezone ?? null,
          active,
          run_count: 0,
          failure_count: 0,
          created_at: now,
          updated_at: now,
        }, { context: SYSTEM_CTX });
      }
    } catch (err) {
      this.logger?.warn?.('DbJobAdapter: failed to upsert sys_job', err as any);
    }
  }

  private async setActive(name: string, active: boolean): Promise<void> {
    try {
      const existing = await this.engine.find(JOB_TABLE, {
        where: { name },
        limit: 1,
        context: SYSTEM_CTX,
      });
      const row = existing?.[0];
      if (!row) return;
      await this.engine.update(JOB_TABLE, {
        id: row.id,
        active,
        updated_at: new Date().toISOString(),
      }, { context: SYSTEM_CTX });
    } catch (err) {
      this.logger?.warn?.('DbJobAdapter: setActive failed', err as any);
    }
  }

  /**
   * Mirror a finished run onto the `sys_job` summary row.
   *
   * `degraded` (#5548) is mirrored here for the same reason it is written to
   * `sys_job_run`: the summary row is what an operator reads first, and a job
   * whose last shot accomplished nothing must not read `success` there either.
   * Two things it deliberately does NOT do, both direct consequences of
   * "`degraded` is not a failure" (`spec/contracts/job-service.ts`):
   *
   *  - `failure_count` stays flat — it is the failure signal that feeds
   *    alerting, and a degraded run is not a failure;
   *  - nothing about retry changes — retry keys on a thrown handler only.
   *
   * `last_error` carries the degraded `reason`, per the column decision
   * recorded in the `JobExecutionStatus` TSDoc (#7072): no new column, and the
   * "Error" label only reads correctly alongside `last_status`.
   */
  private async bumpJob(name: string, last_status: 'success' | 'failed' | 'degraded', last_error?: string): Promise<void> {
    try {
      const existing = await this.engine.find(JOB_TABLE, {
        where: { name },
        limit: 1,
        context: SYSTEM_CTX,
      });
      const row = existing?.[0];
      if (!row) return;
      const now = new Date().toISOString();
      await this.engine.update(JOB_TABLE, {
        id: row.id,
        last_run_at: now,
        last_status,
        last_error: last_status === 'success' ? null : (last_error ?? null),
        run_count: (row.run_count ?? 0) + 1,
        failure_count: (row.failure_count ?? 0) + (last_status === 'failed' ? 1 : 0),
        updated_at: now,
      }, { context: SYSTEM_CTX });
    } catch (err) {
      this.logger?.warn?.('DbJobAdapter: bumpJob failed', err as any);
    }
  }
}
