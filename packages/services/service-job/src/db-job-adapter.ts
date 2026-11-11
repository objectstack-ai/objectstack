// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { AsyncLocalStorage } from 'node:async_hooks';
import type {
  IJobService,
  JobSchedule,
  JobHandler,
  JobExecution,
  JobRunOutcome,
  JobRunTrigger,
  JobScheduleOptions,
  JobReplayOptions,
} from '@objectstack/spec/contracts';
import { IntervalJobAdapter } from './interval-job-adapter.js';
import { runWithPolicy } from './run-with-policy.js';

const JOB_TABLE = 'sys_job';
const RUN_TABLE = 'sys_job_run';
const SYSTEM_CTX = { isSystem: true, positions: [], permissions: [] } as const;

/**
 * What a `sys_job_run` row's `trigger` column records: why the run started,
 * as the handler's context says it, plus `replay` — which the handler's
 * context reports as `manual`, because a replay runs through `trigger()`.
 */
type RunRowTrigger = JobRunTrigger | 'replay';

/**
 * The run a `replay()` call is asking for: the wrapper `inner` will invoke,
 * and whether that invocation has already taken the `replay` tag.
 */
interface ReplayClaim {
  readonly wrapper: JobHandler;
  taken: boolean;
}

/**
 * Carries a `replay()` call down to the wrapper it reaches through
 * `inner.trigger()`, whose context cannot say "replay" — see
 * {@link DbJobAdapter.replay}.
 */
const replayScope = new AsyncLocalStorage<ReplayClaim>();

/**
 * The `trigger` a run row records for one invocation of `wrapper` — the
 * table in {@link DbJobAdapter}'s `wrap` says why each row reads as it does.
 */
function runTriggerOf(wrapper: JobHandler, ctx: Parameters<JobHandler>[0]): RunRowTrigger {
  const claim = replayScope.getStore();
  if (claim && claim.wrapper === wrapper && !claim.taken) {
    claim.taken = true;
    return 'replay';
  }
  return ctx.trigger ?? 'schedule';
}

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
   * `false` means no rows are written at all — not the per-attempt rows above,
   * whatever their `trigger`, {@link DbJobAdapter.replay}'s `replay` rows included —
   * so `sys_job_run` stays empty for this adapter and `listExecutionsByStatus`
   * has nothing to read. The one thing unaffected either way is the `sys_job`
   * row's own `last_status` / `run_count` / `failure_count` counters.
   */
  recordRuns?: boolean;
}

/** Terminal statuses a finished run can land in — everything except `running`. */
type TerminalStatus = 'success' | 'failed' | 'degraded' | 'timeout';

/**
 * The options handed DOWN to the timer adapter.
 *
 * `retryPolicy` and `timeoutMs` are deliberately NOT forwarded (#7734): this
 * adapter now runs the policy itself, inside {@link DbJobAdapter.wrap}, which
 * is what lets the recorder observe a timeout at the instant it happens. A
 * second `runWithPolicy` downstream would race that whole retry sequence
 * against one more timeout budget and abandon the retries mid-flight.
 * Every other option keeps flowing through untouched.
 */
function withoutPolicy(options?: JobScheduleOptions): JobScheduleOptions | undefined {
  if (!options) return options;
  const { retryPolicy: _retryPolicy, timeoutMs: _timeoutMs, ...rest } = options;
  return Object.keys(rest).length > 0 ? (rest as JobScheduleOptions) : undefined;
}

/**
 * What a {@link ReplayGuard} answers (#14501 — the behaviour half of the
 * maintainer's A + a2 ruling on #14501; the contract half is
 * {@link IJobService.replay}'s TSDoc, landed by #14766).
 */
export type ReplayGuardDecision =
  | { readonly allow: true }
  | {
      readonly allow: false;
      /** Human-readable identity of the window that was already delivered. */
      readonly window: string;
      /** When that window's claim was taken (ISO-8601), if the ledger knows. */
      readonly claimedAt: string | null;
    };

/**
 * A per-job pre-flight for `replay()`, registered by whoever owns the job's
 * idempotency (#14501).
 *
 * This adapter deliberately knows nothing about flows, tick windows or the
 * `sys_flow_dispatch` ledger — it cannot: a job name is an opaque string here,
 * and the ledger lives two packages away. What it owns is the REFUSAL: the
 * ADR-0112 envelope, the `force` door past it, and the guarantee that a
 * refusal is loud rather than a silent no-op. The party that scheduled the job
 * — for a scheduled flow, `@objectstack/trigger-schedule` — registers a guard
 * that answers for its own window.
 *
 * A guard is asked once per replay and it also PREPARES: `{ allow: true }`
 * means the guard has already armed whatever its owner needs to let the
 * replayed run past its own idempotency gate. So this adapter never calls a
 * guard for a replay it then abandons.
 */
export type ReplayGuard = (options: { readonly force: boolean }) => Promise<ReplayGuardDecision>;

/**
 * The ADR-0112 envelope `replay()` refuses a delivered window with.
 *
 * `RESOURCE_CONFLICT` is the standard-catalog member HTTP 409 derives
 * (`HttpStatusErrorCodeMap[409]`) and the code the `domain:spec` seat ruled for
 * this refusal — ⛔ no service extension code is minted for a case that
 * already has one. Consumers assert on `code` and `status`; the message is for
 * the operator reading it, and names both halves of the refusal: the window
 * that was asked for and the claim that refused it.
 */
function replayConflict(name: string, decision: Extract<ReplayGuardDecision, { allow: false }>): Error {
  const claimed = decision.claimedAt ? ` (claimed at ${decision.claimedAt})` : '';
  const err = new Error(
    `Job "${name}" has already delivered its ${decision.window}${claimed}, and that dispatch claim recorded ` +
      `SUCCESS. Replaying it would deliver the same window a second time. Pass { force: true } to replay it ` +
      `anyway, knowing the delivery is a duplicate.`,
  ) as Error & { code?: string; status?: number };
  err.code = 'RESOURCE_CONFLICT';
  err.status = 409;
  return err;
}

/**
 * A job's arming as its `sys_job` row records it — see
 * {@link DbJobAdapter.readArming}.
 */
export interface JobArming {
  /** Scheduled and never cancelled since. */
  readonly active: boolean;
  /** The schedule the row was armed with; `null` when the row cannot be read back as one. */
  readonly schedule: JobSchedule | null;
  /**
   * The last instant the row's holder is known to have been alive for this
   * job (ISO-8601): the row's last write, which is its arming or the settle
   * of its last fire, whichever came later. `null` when the row carries none.
   */
  readonly lastAliveAt: string | null;
}

/**
 * The {@link JobSchedule} a `sys_job` row was written from — the inverse of
 * `upsertJobRow`'s `schedule_expression` folding (cron expression, interval
 * milliseconds as a string, or the one-shot ISO instant).
 */
function scheduleFromJobRow(row: Record<string, any>): JobSchedule | null {
  const expression = typeof row.schedule_expression === 'string' ? row.schedule_expression : null;
  if (!expression) return null;
  if (row.schedule_type === 'cron') {
    return typeof row.timezone === 'string' && row.timezone
      ? { type: 'cron', expression, timezone: row.timezone }
      : { type: 'cron', expression };
  }
  if (row.schedule_type === 'interval') {
    const intervalMs = Number(expression);
    return Number.isFinite(intervalMs) && intervalMs > 0 ? { type: 'interval', intervalMs } : null;
  }
  if (row.schedule_type === 'once') return { type: 'once', at: expression };
  return null;
}

/** The first argument that reads as an instant, as ISO-8601. */
function firstInstant(...values: unknown[]): string | null {
  for (const value of values) {
    if (value == null || value === '') continue;
    const ms = value instanceof Date ? value.getTime() : new Date(value as string | number).getTime();
    if (Number.isFinite(ms)) return new Date(ms).toISOString();
  }
  return null;
}

function uid(prefix: string): string {
  const g: any = globalThis as any;
  if (g.crypto?.randomUUID) return `${prefix}_${g.crypto.randomUUID()}`;
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * DbJobAdapter — IJobService that persists job registry and execution
 * history to ObjectQL while delegating timer mechanics downwards.
 *
 * Every SCHEDULED fire goes to the `cron` adapter callers supply — `cron`,
 * `interval` and `once` schedules alike — because that adapter is the one that
 * leader-elects each fire against the cluster lock (#13686, #13918); `inner`
 * (`IntervalJobAdapter`) keeps the registration for `trigger()` / `replay()`
 * and owns the timer only when no `cron` adapter was assembled at all. See
 * {@link DbJobAdapter.schedule} for the routing and its no-cron fallbacks.
 *
 * Persisted side effects:
 *   - `schedule(name, …)` upserts a `sys_job` row (active=true)
 *   - `cancel(name)` marks the row inactive
 *   - every execution writes a `sys_job_run` row per attempt, its `trigger`
 *     the call that ran it: `schedule` for a scheduled fire, `manual` for
 *     `trigger()`, `replay` for {@link DbJobAdapter.replay} — unless
 *     {@link DbJobAdapterOptions.recordRuns} is `false`, the on/off switch for
 *     run history, which writes none of them.
 *   - every execution updates `sys_job.last_run_at / last_status / run_count /
 *     failure_count` — unconditionally: `recordRuns` gates the per-attempt rows
 *     above, never these counters.
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
  /** job name → its `replay()` pre-flight (#14501). See {@link ReplayGuard}. */
  private readonly replayGuards = new Map<string, ReplayGuard>();

  constructor(args: {
    engine: JobEngineLike;
    logger?: JobLoggerLike;
    options?: DbJobAdapterOptions;
    cron?: IJobService;
  }) {
    this.engine = args.engine;
    this.logger = args.logger;
    this.recordRuns = args.options?.recordRuns ?? true;
    // The logger reaches `inner` so its skipped-tick line (#31811) is heard on
    // the no-cron fallback, where `inner` owns the timer.
    this.inner = new IntervalJobAdapter({ maxExecutions: args.options?.maxExecutions, logger: args.logger });
    this.cron = args.cron;
  }

  // ── IJobService ──────────────────────────────────────────────────

  /**
   * Register `name`, and decide WHICH adapter owns its scheduled fire — which
   * is the same thing as deciding whether that fire is leader-elected (#13686,
   * #13918).
   *
   * `CronJobAdapter` is the only adapter here that holds a cluster lock, and it
   * takes that lock in `runScheduled()` — the single path ALL THREE of its limbs
   * fire through, `once` included. `IntervalJobAdapter` has no lock at all. So on
   * a multi-replica deployment the routing below *is* the leader election: every
   * schedule type this adapter hands to `inner` runs on every replica at once.
   * `interval` used to be one of them, which made #2219's declared "leader-elect
   * scheduled cron/interval jobs across the cluster" true of only its cron half —
   * measured in the field as one tick executing N times, its duplicate writes
   * visible wherever per-handler business de-duplication did not happen to cover
   * them (three recipients, six notification rows, 54 ms apart). `once` was the
   * last one left (#13918), and the worst-shaped of the three: a one-shot has no
   * later tick during which a business-level de-duplication marker could win, so
   * every replica's copy lands inside the same short window.
   *
   * **State the guarantee WITH its window.** The lock `CronJobAdapter.runScheduled()`
   * takes is held for the duration of the fire, not for the deadline — its
   * mutual-exclusion window is the handler's runtime. So the routing above
   * de-duplicates *concurrent* fires: exactly-once per deadline holds only
   * when replica clocks agree to within that window (NTP-synced deployments,
   * the normal case). A replica whose clock lags past the window finds the
   * lock already released and reruns the job, and `once` is the sharpest case
   * because there is no later tick to self-correct that away.
   *
   * **The lock's window is also bounded by its lease** (`leaseMs`). The fire
   * renews it while the handler runs (#31843), but a renewal that fails lets it
   * lapse mid-run, so the lease is not what stops a job from overlapping ITSELF
   * on one node (#31811). That is the timer adapters' own in-process
   * latch: on whichever adapter owns the timer, a scheduled tick of a job whose
   * previous scheduled run is still in flight on this node is skipped with one
   * `warn`, and manual `trigger()` / `replay()` are not gated by it. No
   * `sys_job_run` row is written for a skipped tick — no run status fits one.
   *
   * **`once` is AT-MOST-ONCE per cluster, and deliberately so** (maintainer
   * ruling 2026-09-01). Election decides *who* fires, never *that* the fire
   * survives: there is no second deadline, so a leader that dies mid-fire loses
   * the fire outright and nothing re-arms it. That takes nothing away — today's
   * unelected `setTimeout` is not persisted either and the same crash loses it on
   * every replica at once — so no re-arm, no "release the lease only on success",
   * and no persistence is built here for a scenario no measured consumer has.
   *
   * All three delegated types are ALSO registered in `inner` — via
   * {@link IntervalJobAdapter.register}, which stores without arming a timer, so
   * one process never ends up holding an elected timer and an unelected one for
   * the same job. That registration is what keeps `trigger()`, `replay()`,
   * `getExecutions()` and `listJobs()` reading from one place regardless of who
   * owns the clock, and it is deliberately NOT leader-elected: a manual trigger is
   * an operator asking THIS node to run the job now.
   *
   * **Without a `cron` adapter** (`enableCron: false`, or its construction threw)
   * the types part company, because their fallbacks are not the same choice: a
   * `cron` schedule cannot run here at all, so it is warned about and left to
   * manual triggering, whereas `interval` and `once` schedules still fire on
   * `inner`'s own timer exactly as they did before this routing existed —
   * silently dropping a job an assembly CAN run is not an improvement on running
   * it more often than intended. `interval` says so in a `warn`; `once`
   * deliberately does NOT, and the asymmetry is about FREQUENCY, not about one
   * being less worth saying: interval registrations are per-plugin-startup and
   * countable, while `once` registrations are per-occurrence — the wait-node arms
   * one per suspended flow run (`service-automation`
   * `builtin/wait-node.ts`) — so the same line there is a per-run log flood, and
   * the way to make everyone skim `warn` is to write one on a hot path.
   */
  async schedule(name: string, schedule: JobSchedule, handler: JobHandler, options?: JobScheduleOptions): Promise<void> {
    const wrapped = this.wrap(name, handler, options);
    // The wrapper OWNS `retryPolicy`/`timeoutMs` from here down — see withoutPolicy.
    const downstream = withoutPolicy(options);

    if (schedule.type === 'cron') {
      if (this.cron) await this.cron.schedule(name, schedule, wrapped, downstream);
      else this.logger?.warn?.(
        `DbJobAdapter: cron schedule registered for "${name}" without CronJobAdapter — job will only run via manual trigger`,
      );
      // Still record in inner so trigger() works
      await this.inner.register(name, schedule, wrapped, downstream);
    } else if ((schedule.type === 'interval' || schedule.type === 'once') && this.cron) {
      // The leader-elected path — same one cron takes, for the same reason.
      await this.cron.schedule(name, schedule, wrapped, downstream);
      await this.inner.register(name, schedule, wrapped, downstream);
    } else {
      if (schedule.type === 'interval') this.logger?.warn?.(
        `DbJobAdapter: interval schedule registered for "${name}" without CronJobAdapter — it will run, ` +
          'but with NO leader election, so on a multi-replica deployment every replica runs it on every ' +
          'tick. Enable the cron adapter (JobServicePlugin enableCron) to have one replica win each fire.',
      );
      await this.inner.schedule(name, schedule, wrapped, downstream);
    }

    await this.upsertJobRow(name, schedule, true);
  }

  async cancel(name: string): Promise<void> {
    this.replayGuards.delete(name);
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

  /**
   * Register (or with `null`, clear) the `replay()` pre-flight for one job —
   * #14501's behaviour half. NOT part of `IJobService`: a job service without
   * this method installs no guard and replays exactly as it always did, which
   * is why the caller treats it as optional. See {@link ReplayGuard}.
   */
  setReplayGuard(name: string, guard: ReplayGuard | null): void {
    if (guard) this.replayGuards.set(name, guard);
    else this.replayGuards.delete(name);
  }

  /**
   * How the job's `sys_job` row stands right now — read BEFORE this kernel
   * schedules the job, it is how the PREVIOUS holder left it. `null` when the
   * job was never scheduled here (no row).
   *
   * This is what tells "the kernel was not ticking" apart from "the job was
   * not armed". A kernel that stops ticking — evicted, crashed, restarted —
   * never cancels its jobs: {@link destroy} releases the timers and leaves
   * every row `active`. A deliberate unbind (a flow disabled, republished or
   * withdrawn) goes through {@link cancel}, which clears `active`. So a row
   * still `active` when the next kernel arrives was armed and then stopped
   * ticking, and its last-alive instant is where the silence began.
   *
   * Like {@link setReplayGuard}, NOT part of `IJobService`: the scheduled-flow
   * trigger asks for it structurally, and a job service without it simply has
   * no reading to give.
   *
   * ⛔ Not caught here. A read that fails is not a row that says "inactive",
   * and answering one would hide a silence the caller exists to report.
   */
  async readArming(name: string): Promise<JobArming | null> {
    const rows = await this.engine.find(JOB_TABLE, {
      where: { name },
      limit: 1,
      context: SYSTEM_CTX,
    });
    const row = rows?.[0];
    if (!row) return null;
    return {
      active: row.active === true || row.active === 1,
      schedule: scheduleFromJobRow(row),
      lastAliveAt: firstInstant(row.updated_at, row.last_run_at, row.created_at),
    };
  }

  /**
   * Replay a job's most recent execution, tagging its run `trigger: 'replay'`.
   *
   * The replay is ONE run, so it lands as one `sys_job_run` row per attempt,
   * like any other run: the wrapper's own row, which it opens with
   * `trigger: 'replay'` and settles to the run's real status from inside the
   * retry/timeout policy. The handler's context still says `manual` — the
   * contract's value for a replay, which runs through `trigger()` — and its
   * `runId` names that `replay` row.
   *
   * How the wrapper knows: the call reaches it through `inner.trigger()`,
   * whose context cannot say "replay", so this method opens a
   * {@link replayScope} naming the exact wrapper `inner` holds for the job.
   * That wrapper's first invocation inside the scope takes the tag, once, and
   * reads it before its first attempt; any other run the replayed handler
   * starts — another job's `trigger()`, a second call of this one, a timer
   * armed inside it — finds the tag taken or names another wrapper, and
   * records its own trigger.
   *
   * The row is governed by {@link DbJobAdapterOptions.recordRuns} exactly as
   * every other run row is: with the flag `false` the handler still runs and
   * no row is written. `sys_job_run` is run history, not an audit trail; an
   * operator who switched history off gets nothing durable from this path.
   *
   * **Once-only delivery on the scheduled path (#14501).** A job carrying a
   * {@link ReplayGuard} — a scheduled flow, registered by the schedule trigger
   * — has its current dispatch window checked first. A window whose
   * `(flow, tick-window)` claim recorded SUCCESS is refused with the ADR-0112
   * `RESOURCE_CONFLICT` / 409 envelope the contract declares, and the promise
   * REJECTS: an operator who pressed replay and saw nothing happen is the
   * experience the ruling rejected outright. Absent, failed and unsettled
   * claims re-run exactly as before, and `{ force: true }` skips the check
   * entirely — the operator is stating the duplicate is wanted.
   *
   * A guard that THROWS lets the replay through, logged: this is the same
   * availability-over-strict-once posture the claim ledger takes everywhere
   * else. A refusal is a positive reading, never the absence of one.
   */
  async replay(name: string, data?: unknown, options?: JobReplayOptions): Promise<void> {
    // Same execution path as trigger, with the run tagged 'replay'.
    const record: { handler: JobHandler } | undefined = (this.inner as any).jobs?.get?.(name);
    if (!record) throw new Error(`Job "${name}" not found`);

    const guard = this.replayGuards.get(name);
    if (guard) {
      const force = options?.force === true;
      let decision: ReplayGuardDecision | undefined;
      try {
        decision = await guard({ force });
      } catch (err) {
        this.logger?.warn(
          `DbJobAdapter: replay pre-flight for job "${name}" failed — replaying anyway ` +
            '(availability over strict-once: a refusal is a positive reading, never the absence of one)',
          err as any,
        );
      }
      if (decision && decision.allow === false) throw replayConflict(name, decision);
    }
    // No row of its own: a second, synthetic row beside the wrapper's is what
    // made one replay read as two runs, the wrapper's tagged `schedule`. The
    // wrapper's row IS the replay's, written and settled by the same code as
    // every other run's, so its status needs no reading back either.
    const claim: ReplayClaim = { wrapper: record.handler, taken: false };
    await replayScope.run(claim, () => this.inner.trigger(name, data));
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
   *
   * **Which `trigger` the row records is decided per call, never at wrap
   * time.** One wrapper serves every way the job runs: `schedule()` hands the
   * same closure to the scheduler that fires it and to `inner`, which runs it
   * for `trigger()` and `replay()` — and on the no-cron fallback `inner` is
   * the scheduler too. So the value is read off the invocation, once, before
   * the first attempt (every attempt of one run carries it):
   *
   * | The call | `sys_job_run.trigger` |
   * |:---|:---|
   * | the {@link replayScope} `replay()` opened for this very wrapper, first invocation | `replay` |
   * | the context says `manual` (`trigger()`, through either timer adapter) | `manual` |
   * | the context says `schedule` (a timer's fire) | `schedule` |
   * | the context says nothing | `schedule` |
   *
   * The last row is not a guess: the only caller that may leave the trigger
   * unstated (it is optional in the `JobHandler` contract) is the `cron`
   * adapter, which can be any `IJobService` — and this class never calls that
   * adapter's `trigger()`, so a call arriving through it is its scheduled fire.
   * `inner`, which serves every manual call, always states it.
   */
  private wrap(
    name: string,
    handler: JobHandler,
    options?: JobScheduleOptions,
  ): JobHandler {
    const wrapped: JobHandler = async (ctx) => {
      const trigger = runTriggerOf(wrapped, ctx);
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

      // [ADR-0153 D7] The handler is told this attempt's `sys_job_run` row:
      // `current` is set by `onAttemptStart`, which runs before each attempt.
      return await runWithPolicy<void | JobRunOutcome>(name, () => handler(current?.id ? { ...ctx, runId: current.id } : ctx), options, {
        onAttemptStart: async (attempt) => {
          current = { id: this.recordRuns ? await this.startRun(name, trigger, attempt) : undefined, settled: false };
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
    return wrapped;
  }

  private async startRun(
    jobName: string,
    trigger: RunRowTrigger,
    attempt: number,
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
   * stuck at five times its declared `timeoutMs` must not read as a quiet success.
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
