// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { z } from 'zod';
import { CronExpressionInputSchema } from '../shared/expression.zod';

/**
 * Cron Schedule Schema
 * Schedule jobs using cron expressions
 */
import { lazySchema } from '../shared/lazy-schema';
export const CronScheduleSchema = lazySchema(() => z.object({
  type: z.literal('cron'),
  expression: CronExpressionInputSchema.describe('Cron expression — cron`0 0 * * *` for daily at midnight. Build emits {dialect:"cron",source} envelope.'),
  timezone: z.string().optional().default('UTC').describe('Timezone for cron execution (e.g., "America/New_York")'),
}));

/**
 * Interval Schedule Schema
 * Schedule jobs at fixed intervals
 */
export const IntervalScheduleSchema = lazySchema(() => z.object({
  type: z.literal('interval'),
  intervalMs: z.number().int().positive().describe('Interval in milliseconds'),
}));

/**
 * Once Schedule Schema
 * Schedule a job to run once at a specific time
 */
export const OnceScheduleSchema = lazySchema(() => z.object({
  type: z.literal('once'),
  at: z.string().datetime().describe('ISO 8601 datetime when to execute'),
}));

/**
 * Schedule Schema
 * Discriminated union of all schedule types
 */
export const ScheduleSchema = lazySchema(() => z.discriminatedUnion('type', [
  CronScheduleSchema,
  IntervalScheduleSchema,
  OnceScheduleSchema,
]));

export type Schedule = z.infer<typeof ScheduleSchema>;
export type CronSchedule = z.infer<typeof CronScheduleSchema>;
export type IntervalSchedule = z.infer<typeof IntervalScheduleSchema>;
export type OnceSchedule = z.infer<typeof OnceScheduleSchema>;
export type JobSchedule = Schedule; // Alias for backwards compatibility

/**
 * Retry Policy Schema
 * Configuration for job retry behavior with exponential backoff
 */
export const RetryPolicySchema = lazySchema(() => z.object({
  maxRetries: z.number().int().min(0).default(3).describe('Maximum number of retry attempts'),
  backoffMs: z.number().int().positive().default(1000).describe('Initial backoff delay in milliseconds'),
  backoffMultiplier: z.number().positive().default(2).describe('Multiplier for exponential backoff'),
}));

export type RetryPolicy = z.infer<typeof RetryPolicySchema>;

/**
 * Job Schema
 * Defines a scheduled job that executes background logic.
 * 
 * @example Metadata Sync Job (Cron)
 * {
 *   id: "job_sync_meta",
 *   name: "sync_metadata_nightly",
 *   schedule: {
 *     type: "cron",
 *     expression: "0 0 * * *", // Midnight
 *     timezone: "UTC"
 *   },
 *   handler: "services/syncStatus.ts:syncAll", 
 *   retryPolicy: {
 *     maxRetries: 3,
 *     backoffMs: 5000
 *   }
 * }
 */
export const JobSchema = lazySchema(() => z.object({
  id: z.string().optional().describe('Unique job identifier (defaults to `name` when omitted)'),
  name: z.string().regex(/^[a-z_][a-z0-9_]*$/).describe('Job name (snake_case)'),
  label: z.string().optional().describe('Human-readable label'),
  description: z.string().optional().describe('Job description / purpose'),
  schedule: ScheduleSchema.describe('Job schedule configuration'),
  handler: z.string().describe('Handler function name (must match a key in `defineStack({ functions })`)'),
  retryPolicy: RetryPolicySchema.optional().describe('Retry policy configuration. [EXPERIMENTAL — not enforced] The service-job scheduler does not yet read retryPolicy; failed runs are not retried per this config (liveness audit #1878/#1893).'),
  timeout: z.number().int().positive().optional().describe('Timeout in milliseconds. [EXPERIMENTAL — not enforced] The service-job scheduler does not yet enforce a per-run timeout (liveness audit #1878/#1893).'),
  enabled: z.boolean().default(true).describe('Whether the job is enabled'),
}));

export type Job = z.infer<typeof JobSchema>;
/** Authoring input for {@link Job} — defaulted fields are optional. */
export type JobInput = z.input<typeof JobSchema>;

/**
 * Type-safe factory for declaring background jobs in metadata-as-code.
 *
 * @example
 * ```ts
 * export const nightlySync = defineJob({
 *   name: 'sync_metadata_nightly',
 *   schedule: { type: 'cron', expression: '0 0 * * *', timezone: 'UTC' },
 *   handler: 'syncMetadata', // must be registered in defineStack({ functions: { syncMetadata: () => ... } })
 * });
 * ```
 */
export function defineJob(config: z.input<typeof JobSchema>): Job {
  return JobSchema.parse(config);
}

/**
 * Job Execution Status Enum
 * Status of job execution
 */
export const JobExecutionStatus = z.enum([
  'running',
  'success',
  'failed',
  'timeout',
]);

export type JobExecutionStatus = z.infer<typeof JobExecutionStatus>;

/**
 * Job Execution Schema
 * Logs for job execution
 */
export const JobExecutionSchema = lazySchema(() => z.object({
  jobId: z.string().describe('Job identifier'),
  startedAt: z.string().datetime().describe('ISO 8601 datetime when execution started'),
  completedAt: z.string().datetime().optional().describe('ISO 8601 datetime when execution completed'),
  status: JobExecutionStatus.describe('Execution status'),
  error: z.string().optional().describe('Error message if failed'),
  duration: z.number().int().optional().describe('Execution duration in milliseconds'),
}));

export type JobExecution = z.infer<typeof JobExecutionSchema>;
