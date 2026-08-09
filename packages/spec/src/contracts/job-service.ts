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
 * matched'`) — free text for an audit surface, never a machine-dispatched code.
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
    /** Why the run was degraded — short, human-readable, for the audit trail. */
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
 * is #5548's half and is **not yet wired**: the shipped adapters currently
 * discard the resolved value, which is precisely why doing so is safe.
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
     * in the execution audit trail.
     */
    replay?(name: string, data?: unknown): Promise<void>;

    /**
     * List executions filtered by status across all jobs (admin/observability).
     */
    listExecutionsByStatus?(
        status: JobExecution['status'],
        limit?: number,
    ): Promise<JobExecution[]>;
}
