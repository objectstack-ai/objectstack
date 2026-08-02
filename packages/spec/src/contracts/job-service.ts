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
 * Job handler function
 */
export type JobHandler = (context: { jobId: string; data?: unknown }) => Promise<void>;

/**
 * Retry policy for a scheduled job (mirrors the authorable
 * `RetryPolicySchema` in system/job.zod.ts).
 */
export interface JobRetryPolicy {
    /** Maximum number of retry attempts after the initial run (default 3) */
    maxRetries?: number;
    /** Initial backoff delay in milliseconds (default 1000) */
    backoffMs?: number;
    /** Multiplier for exponential backoff (default 2) */
    backoffMultiplier?: number;
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
