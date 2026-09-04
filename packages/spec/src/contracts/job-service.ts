// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * IJobService - Background Job Service Contract
 *
 * Defines the interface for scheduling and managing background jobs
 * in ObjectStack. Concrete implementations (BullMQ, node-cron, etc.)
 * should implement this interface.
 *
 * Follows Dependency Inversion Principle - plugins depend on this interface,
 * not on concrete job scheduler implementations.
 *
 * Aligned with CoreServiceName 'job' in core-services.zod.ts.
 */

// [#4538] `JobExecution` is the system domain's zod-derived type — one
// declaration, re-exported here for the IJobService surface below.
import type { JobExecution } from '../system/job.zod';
export type { JobExecution } from '../system/job.zod';

/**
 * Schedule definition for a job — the `IJobService.schedule` BOUNDARY shape.
 *
 * [#4538] The SOLE declaration of this name; the legacy `JobSchedule =
 * Schedule` alias on `./system` was consumer-free and removed. This is
 * deliberately NOT the authored `Schedule` union from `system/job.zod.ts`:
 * that is the authoring/persistence tier (discriminated union, cron
 * `expression` parsed into the ADR expression envelope, `timezone`
 * defaulted), while this is the plain-runtime-value shape the schedulers
 * consume — `trigger-schedule` normalizes authored shorthands into it, and
 * the cron adapter hands `expression` (a bare cron string here) straight to
 * croner.
 */
export interface JobSchedule {
    /** Schedule type */
    type: 'cron' | 'interval' | 'once';
    /** Cron expression (when type is 'cron') */
    expression?: string;
    /** Timezone for cron (when type is 'cron') */
    timezone?: string;
    /** Interval in milliseconds (when type is 'interval') */
    intervalMs?: number;
    /** ISO 8601 datetime (when type is 'once') */
    at?: string;
}

/**
 * What a job handler reports about a run that finished without throwing —
 * the OPTIONAL third state of {@link JobHandler} (#6617, the spec half of the
 * #5548 B-minimal ruling).
 *
 * A handler that resolves this instead of `undefined` distinguishes *"ran and
 * did the work"* from *"ran to completion but did not accomplish it"*. The
 * motivating case is #5529's wait-wake handler: when its store is unavailable
 * it fires the shot at nothing, completes normally, and today is recorded as
 * indistinguishable from a wake that actually woke something.
 *
 * `reason` is a short operator-facing note (`'STORE_UNAVAILABLE'`, `'0 rows
 * matched'`) — free text for run history, never a machine-dispatched code.
 */
export interface JobRunOutcome {
    /**
     * `'completed'` — the run did its work. Identical in meaning to resolving
     * `undefined`; spell it out when a handler computes the verdict either way.
     *
     * `'degraded'` — the run finished, but its work did not happen. **This is
     * not a failure** (see {@link JobHandler}).
     */
    outcome: 'completed' | 'degraded';
    /** Why the run was degraded — short, human-readable, for job run history. */
    reason?: string;
}

/**
 * Job handler function.
 *
 * **Three outcomes, of which the third is optional and additive** (#6617):
 *
 * | The handler… | Means | Recorded as |
 * |:---|:---|:---|
 * | throws / rejects | the run **failed** | `failed` — and the retry policy applies |
 * | resolves `undefined` (or `{ outcome: 'completed' }`) | the run **succeeded** | `success` |
 * | resolves `{ outcome: 'degraded', reason? }` | ran to completion, **work did not happen** | a status distinct from `success` (#5548) |
 *
 * ⚠️ **`degraded` is NOT a failure and does NOT trigger a retry.** Retry and
 * failure are driven exclusively by a *rejected* promise (`runWithPolicy`
 * retries on throw), so a resolved outcome — whatever it says — never re-runs
 * the job and never surfaces as an error. A handler that wants the run retried
 * must throw, exactly as before. This separation is the whole point of the
 * ruling: option A (make these handlers throw) was rejected precisely because
 * it would change the failure semantics that third-party `IJobService`
 * implementations already build retry behaviour on.
 *
 * **Additivity — the compatibility contract this type owes** (the ruling's
 * 「可加性条款」, and the acceptance criterion of #6617):
 *
 * - An existing `Promise<void>` handler is **unchanged, byte for byte**. It
 *   reports nothing, and reporting nothing is today's behaviour exactly:
 *   *no throw ⇒ success*.
 * - An existing `IJobService` implementation is **unchanged**. This is a
 *   widened *return* type, not a new member on the handler context, so no
 *   implementation has to grow anything — an adapter that simply ignores the
 *   resolved value keeps its current semantics. (A `ctx.reportOutcome`
 *   callback would have forced every implementation to construct a new context
 *   member; that is why the return-value shape was chosen.)
 *
 * The reporting channel is deliberately opt-in on **both** ends. Consuming it
 * — mapping `degraded` onto a `sys_job_run.status` distinct from `success` —
 * is #5548's half, and it is wired: all three shipped adapters
 * (`cron-job-adapter.ts`, `interval-job-adapter.ts`, `db-job-adapter.ts`) map
 * a resolved `{ outcome: 'degraded' }` onto a run status distinct from
 * `success`, the `reason` lands in `error` / `last_error`, and
 * `failure_count` stays flat — never a retry, never an alert. Both
 * `sys_job_run.status` and `sys_job.last_status` carry `degraded` in their
 * ObjectQL-enforced select vocabularies (#7072), which must stay in step with
 * {@link JobExecutionStatus} in `system/job.zod.ts` — see that type's TSDoc
 * for the full mapping and the cost of routing `reason` through an "Error"
 * column.
 */
export type JobHandler = (context: { jobId: string; data?: unknown }) => Promise<void | JobRunOutcome>;

/**
 * Retry policy for a scheduled job (mirrors the authorable `RetryPolicySchema`,
 * which since 17.0.0 is declared once in `shared/retry-policy.zod.ts` and
 * re-exported by both `./automation` and `./system` — #4661).
 *
 * Defaults restated here because this is a hand-written boundary type: a caller
 * that builds `JobScheduleOptions` itself never goes through Zod, so
 * `runWithPolicy` applies the same values the schema declares.
 */
export interface JobRetryPolicy {
    /** Retry attempts after the initial run. 0 (the default since 17.0.0, #4661) means no retry. */
    maxRetries?: number;
    /** Base delay before the first retry, in milliseconds (default 1000) */
    backoffMs?: number;
    /** Multiplier for exponential backoff (default 1 since 17.0.0, #4661 — a flat delay) */
    backoffMultiplier?: number;
    /** Ceiling for a single backoff delay, in milliseconds (default 30000) */
    maxRetryDelayMs?: number;
    /** Randomize each delay within [50%, 100%] of its computed value (default false) */
    jitter?: boolean;
}

/**
 * Per-job execution options threaded from the authored JobSchema
 * (`retryPolicy` / `timeout`) down to the executing adapter.
 *
 * Omitted options preserve the legacy behavior: one attempt, no time limit.
 */
export interface JobScheduleOptions {
    /** Retry failed runs with exponential backoff */
    retryPolicy?: JobRetryPolicy;
    /**
     * Per-attempt time limit in milliseconds. A run that exceeds it is
     * recorded with status 'timeout'. Note: JavaScript cannot forcibly
     * cancel the in-flight handler — the attempt is abandoned, not killed.
     */
    timeout?: number;
}

/**
 * The optional third argument of {@link IJobService.replay} (#14766 — the
 * contract half of the maintainer's A + a2 ruling on #14501).
 *
 * An options object rather than a bare positional boolean, by the convention
 * this interface already follows for `schedule(…, options?: JobScheduleOptions)`:
 * a named, exported options type reads at the call site —
 * `replay(name, data, { force: true })` says what it does, `replay(name, data,
 * true)` does not — and a later knob is a second key here, never a fourth
 * positional. Omitting the argument is the pre-#14766 call exactly.
 */
export interface JobReplayOptions {
    /**
     * Re-send a scheduled flow's tick window even though that window's
     * `(flow, tick-window)` dispatch claim has already **succeeded**.
     *
     * Absent or `false`, a replay of a delivered window is refused with the
     * ADR-0112 envelope {@link IJobService.replay} declares. `true` is the
     * explicit operator door the ruling kept open (option a2): the operator is
     * stating that the window is known to have been delivered and is to be
     * delivered again, and takes the duplicate knowingly. It never touches a
     * window whose claim is absent or failed — those re-run either way.
     */
    force?: boolean;
}

export interface IJobService {
    /**
     * Schedule a recurring or one-time job
     * @param name - Job name (snake_case)
     * @param schedule - Schedule configuration
     * @param handler - Job handler function
     * @param options - Optional per-job retry policy / timeout
     */
    schedule(name: string, schedule: JobSchedule, handler: JobHandler, options?: JobScheduleOptions): Promise<void>;

    /**
     * Cancel a scheduled job
     * @param name - Job name
     */
    cancel(name: string): Promise<void>;

    /**
     * Trigger a job to run immediately (outside its normal schedule)
     * @param name - Job name
     * @param data - Optional data to pass to the handler
     */
    trigger(name: string, data?: unknown): Promise<void>;

    /**
     * Get the status of recent job executions
     * @param name - Job name
     * @param limit - Maximum number of executions to return
     * @returns Array of job execution records
     */
    getExecutions?(name: string, limit?: number): Promise<JobExecution[]>;

    /**
     * List all registered job names
     * @returns Array of job names
     */
    listJobs?(): Promise<string[]>;

    /**
     * Replay the most recent execution of a job — useful from admin UI.
     * Equivalent to `trigger(name)` but records that this run is a replay
     * in job run history (`sys_job_run`) — not the audit trail; that's
     * `sys_audit_log`, with its own opt-in, writer and retention. Recording
     * anything durable depends on an adapter that persists run history at all
     * (e.g. `DbJobAdapter`'s `recordRuns` option).
     *
     * **Once-only delivery on the scheduled path** (#14766, the contract half
     * of the maintainer's A + a2 ruling on #14501; the behaviour half is
     * #14501 and lands in `DbJobAdapter.replay`). A scheduled (cron) flow
     * takes a dispatch claim in the `sys_flow_dispatch` ledger keyed
     * `(flow, tick-window)` — the same ledger a `time_relative` flow claims per
     * `(flow, window, record)` (#10220). A replay of a scheduled flow reads
     * that window's claim, and the contract admits exactly three outcomes:
     *
     * | The `(flow, tick-window)` claim is… | `replay(name, data)` | `replay(name, data, { force: true })` |
     * |:---|:---|:---|
     * | **absent** — the window was never claimed | re-runs the window (unchanged behaviour) | re-runs the window |
     * | **failed** — claimed, and the dispatch did not succeed | re-runs the window (unchanged behaviour) | re-runs the window |
     * | **succeeded** — the window was delivered | **refused**, loudly — see below | re-runs the window: sends anyway, the duplicate is the operator's, taken knowingly |
     *
     * A job that never takes a claim — every job that is not a scheduled
     * flow — is the **absent** row: it re-runs, with or without `force`, and
     * nothing about it changes.
     *
     * **The refusal is an ADR-0112 envelope, never a silent no-op.** The
     * promise **rejects** (it does not resolve having done nothing — the
     * ruling rejected that shape outright: an operator who pressed replay and
     * saw nothing happen is the bad experience this clause exists to prevent)
     * with an error carrying `code: 'RESOURCE_CONFLICT'` — the standard-catalog
     * member HTTP 409 derives (`HttpStatusErrorCodeMap[409]`, `api/errors.zod.ts`;
     * no service extension code is registered for this) — and `status: 409`,
     * and its message names **the window** that was asked for (the flow and
     * its tick window) and **the claim** that refused it (the
     * `sys_flow_dispatch` row: when the window was claimed and that the
     * dispatch succeeded). A consumer asserts the refusal on `code` and
     * `status`; the message is for the operator reading it.
     *
     * `options.force: true` is the only door past the refusal (option a2).
     * Option a1 (refuse always, no door) and option a3 (send anyway, accept
     * the duplicate silently) were considered on #14501 and **not** taken.
     *
     * @param name - Job name
     * @param data - Optional data to pass to the handler
     * @param options - {@link JobReplayOptions}; omitted is the pre-#14766
     * call and refuses a delivered window
     * @throws `RESOURCE_CONFLICT` / 409 when the window's claim succeeded and
     * `options.force` is not `true`
     */
    replay?(name: string, data?: unknown, options?: JobReplayOptions): Promise<void>;

    /**
     * List executions filtered by status across all jobs (admin/observability).
     */
    listExecutionsByStatus?(
        status: JobExecution['status'],
        limit?: number,
    ): Promise<JobExecution[]>;
}
