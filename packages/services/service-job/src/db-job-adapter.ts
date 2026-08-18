// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import type {
  IJobService,
  JobSchedule,
  JobHandler,
  JobExecution,
  JobRunOutcome,
  JobScheduleOptions,
} from '@objectstack/spec/contracts';
import { IntervalJobAdapter } from './interval-job-adapter.js';
import { runWithPolicy } from './run-with-policy.js';

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
  /**
   * Record each scheduled or triggered execution as a `sys_job_run` row —
   * inserted at the start of every attempt and updated to its terminal status
   * when that attempt settles. Default **`true`**.
   *
   * This is an on/off switch for run history, NOT a retention cap: setting it to
   * `false` means no per-attempt rows are written at all, so `sys_job_run` holds
   * nothing for these executions and `listExecutionsByStatus` has nothing to
   * read. Two things are unaffected either way — the `sys_job` row's own
   * `last_status` / `run_count` / `failure_count` counters, and
   * {@link DbJobAdapter.replay}, which writes its synthetic `trigger: 'replay'`
   * row regardless of this flag.
   */
  recordRuns?: boolean;
}

/** Terminal statuses a finished run can land in — everything except `running`. */
type TerminalStatus = 'success' | 'failed' | 'degraded' | 'timeout';

/**
 * The options handed DOWN to the timer adapter.
 *
 * `retryPolicy` and `timeout` are deliberately NOT forwarded (#7734): this
 * adapter now runs the policy itself, inside {@link DbJobAdapter.wrap}, which
 * is what lets the recorder observe a timeout at the instant it happens. A
 * second `runWithPolicy` downstream would race that whole retry sequence
 * against one more timeout budget and abandon the retries mid-flight.
 * Every other option keeps flowing through untouched.
 */
function withoutPolicy(options?: JobScheduleOptions): JobScheduleOptions | undefined {
  if (!options) return options;
  const { retryPolicy: _retryPolicy, timeout: _timeout, ...rest } = options;
  return Object.keys(rest).length > 0 ? (rest as JobScheduleOptions) : undefined;
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
    const wrapped = this.wrap(name, handler, 'schedule', options);
    // The wrapper OWNS `retryPolicy`/`timeout` from here down — see withoutPolicy.
    const downstream = withoutPolicy(options);

    if (schedule.type === 'cron') {
      if (this.cron) await this.cron.schedule(name, schedule, wrapped, downstream);
      else this.logger?.warn?.(
        `DbJobAdapter: cron schedule registered for "${name}" without CronJobAdapter — job will only run via manual trigger`,
      );
      // Still record in inner so trigger() works
      await this.inner.schedule(name, schedule, wrapped, downstream);
    } else {
      await this.inner.schedule(name, schedule, wrapped, downstream);
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
      // #7734 widened this from `degraded` to every terminal status for the
      // same reason #5548 introduced it: a replayed run that timed out (or
      // threw — `executeJob` swallows the error, so the catch below never sees
      // it) used to land a `success` row next to the wrapper's honest one.
      const [last] = await this.inner.getExecutions(name, 1);
      const status = last?.status;
      if (status === 'degraded' || status === 'timeout' || status === 'failed') {
        await this.finishRun(runId, status, last.error);
      } else {
        await this.finishRun(runId, 'success');
      }
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

  /**
   * Release every timer this adapter owns — BOTH halves of it.
   *
   * This is the far end of the kernel eviction chain
   * (`KernelManager.evict()` -> `kernel.shutdown()` -> `plugin.destroy()` ->
   * `JobServicePlugin.destroy()` -> here), and eviction is routine rather than
   * exceptional in the cloud runtime: a freshness probe runs every few seconds
   * and every auto-publish bumps freshness. Until #8362 this method destroyed
   * `inner` and never `cron`, so each evicted kernel left its croner timers
   * running and holding their PROCESS-GLOBAL names for the life of the
   * process. The rebuilt kernel then failed to bind that flow — permanently,
   * reproduced across four consecutive rebuilds — and the only signal was one
   * WARN from the trigger.
   *
   * `IJobService` does not declare `destroy()`, so the call is structural,
   * exactly like the `cancel` forwarding above.
   */
  async destroy(): Promise<void> {
    await this.inner.destroy();
    const cron = this.cron as (IJobService & { destroy?: () => Promise<void> }) | undefined;
    if (!cron || typeof cron.destroy !== 'function') return;
    try {
      await cron.destroy();
    } catch (err) {
      // Runtime state now disagrees with every other surface: the kernel is
      // gone, its cron timers are not, and nothing else in the system looks
      // wrong — so this is the durability class, not the functional one.
      const report = this.logger?.error?.bind(this.logger) ?? this.logger?.warn?.bind(this.logger);
      report?.(
        'DbJobAdapter: the cron adapter failed to shut down — its croner jobs stay ALIVE holding their ' +
          'process-global names, so scheduled flows will silently fail to re-bind after this kernel is ' +
          'rebuilt, while every other surface keeps reporting them healthy. Restart the process to clear them.',
        err as any,
      );
    }
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
   * | exceeds its `timeout` | `timeout` (guard message in `error`) | `timeout`, `failure_count` +1 | yes, by the retry policy |
   *
   * **Who runs the policy, and why it has to be this one** (#7734). The
   * wrapper does not merely record around the handler — it runs the handler
   * *under* `runWithPolicy` and records from that policy's per-attempt
   * {@link JobAttemptRecorder}. Until this wiring, the wrapper was handed to
   * the timer adapter, which applied `withTimeout` around the WRAPPER: the
   * guard rejected, the adapter noted `timeout` in its in-memory history, and
   * the wrapper's own `await handler(ctx)` — still pending on a handler
   * JavaScript cannot cancel — resolved minutes later and wrote
   * `finishRun(runId, 'success')` over the run an operator was looking at.
   * A row saying `success` with a `duration_ms` five times the declared
   * `timeout` was the visible symptom.
   *
   * Recording from inside the policy closes that race by construction: the
   * abandoned attempt's eventual value loses `Promise.race` and reaches no
   * observer at all. The per-run `settled` latch below is the second lock on
   * the same door — one terminal write per `sys_job_run` row, so no path that
   * anyone adds later can move a run off a terminal status.
   *
   * It also makes the attempt number REAL: `runWithPolicy` counts the attempts,
   * so a retry lands `sys_job_run.attempt: 2` instead of the `1` every row used
   * to carry.
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
  private wrap(
    name: string,
    handler: JobHandler,
    defaultTrigger: 'schedule' | 'manual' | 'replay',
    options?: JobScheduleOptions,
  ): JobHandler {
    return async (ctx) => {
      // Per-FIRE state: one of these closures exists per invocation, so two
      // overlapping fires of the same job never share a run row.
      let current: { id?: string; settled: boolean } | undefined;

      const settle = async (status: TerminalStatus, error?: string, durationMs?: number) => {
        const run = current;
        // One terminal write per row. Nothing reaches here twice today; the
        // latch is what keeps that true as this seam grows (#7734).
        if (!run || run.settled) return;
        run.settled = true;
        if (run.id) await this.finishRun(run.id, status, error, durationMs);
        await this.bumpJob(name, status, error);
      };

      return await runWithPolicy<void | JobRunOutcome>(name, () => handler(ctx), options, {
        onAttemptStart: async (attempt) => {
          current = { id: this.recordRuns ? await this.startRun(name, defaultTrigger, attempt) : undefined, settled: false };
        },
        onAttemptSettled: async (_attempt, result) => {
          if (result.ok) {
            const outcome = result.value;
            if (outcome && outcome.outcome === 'degraded') {
              // Not a failure: the reason rides the existing `error` column and
              // `failure_count` stays flat (decided on #7072, recorded in the
              // `JobExecutionStatus` TSDoc). A reader must gate on `status`
              // before reading that column as a failure.
              await settle('degraded', outcome.reason, result.durationMs);
            } else {
              await settle('success', undefined, result.durationMs);
            }
            return;
          }
          const msg = result.error instanceof Error ? result.error.message : String(result.error);
          // `timeout` vs `failed` is the distinction `JobExecutionStatus` has
          // always declared and the durable record never carried.
          await settle(result.timedOut ? 'timeout' : 'failed', msg, result.durationMs);
        },
      });
    };
  }

  private async startRun(
    jobName: string,
    trigger: 'schedule' | 'manual' | 'replay',
    attempt = 1,
  ): Promise<string | undefined> {
    const id = uid('run');
    const now = new Date().toISOString();
    try {
      await this.engine.insert(RUN_TABLE, {
        id,
        job_name: jobName,
        status: 'running',
        started_at: now,
        trigger,
        attempt,
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
   *
   * `timeout` (#7734) is the mirror image of `degraded` here: it IS a failure —
   * the run did not finish, the policy retries it — so it bumps `failure_count`
   * alongside `failed`. Alerting that keys on that count is the reason a job
   * stuck at five times its declared `timeout` must not read as a quiet success.
   */
  private async bumpJob(name: string, last_status: TerminalStatus, last_error?: string): Promise<void> {
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
        failure_count:
          (row.failure_count ?? 0) + (last_status === 'failed' || last_status === 'timeout' ? 1 : 0),
        updated_at: now,
      }, { context: SYSTEM_CTX });
    } catch (err) {
      this.logger?.warn?.('DbJobAdapter: bumpJob failed', err as any);
    }
  }
}
