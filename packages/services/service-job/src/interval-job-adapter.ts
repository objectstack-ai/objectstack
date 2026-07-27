// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import type { IJobService, JobSchedule, JobHandler, JobExecution, JobScheduleOptions } from '@objectstack/spec/contracts';
import { runWithPolicy, JobTimeoutError } from './run-with-policy.js';

/**
 * Internal record for a scheduled job.
 */
interface JobRecord {
  name: string;
  schedule: JobSchedule;
  handler: JobHandler;
  options?: JobScheduleOptions;
  timerId?: ReturnType<typeof setInterval> | ReturnType<typeof setTimeout>;
  executions: JobExecution[];
}

/**
 * Configuration options for IntervalJobAdapter.
 */
export interface IntervalJobAdapterOptions {
  /** Maximum number of execution records to retain per job (default: 100) */
  maxExecutions?: number;
}

/**
 * setInterval-based job adapter implementing IJobService.
 *
 * Supports `interval` and `once` schedule types using Node.js timers.
 * `cron` schedules are stored but not actively executed (requires a cron
 * library — see CronJobAdapter skeleton).
 *
 * Suitable for single-process environments, development, and testing.
 */
export class IntervalJobAdapter implements IJobService {
  private readonly jobs = new Map<string, JobRecord>();
  private readonly maxExecutions: number;

  constructor(options: IntervalJobAdapterOptions = {}) {
    this.maxExecutions = options.maxExecutions ?? 100;
  }

  async schedule(name: string, schedule: JobSchedule, handler: JobHandler, options?: JobScheduleOptions): Promise<void> {
    // Cancel any existing job with the same name
    await this.cancel(name);

    const record: JobRecord = { name, schedule, handler, options, executions: [] };

    if (schedule.type === 'interval' && schedule.intervalMs) {
      record.timerId = setInterval(async () => {
        await this.executeJob(record);
      }, schedule.intervalMs);
    } else if (schedule.type === 'once' && schedule.at) {
      const delay = new Date(schedule.at).getTime() - Date.now();
      if (delay > 0) {
        record.timerId = setTimeout(async () => {
          await this.executeJob(record);
        }, delay);
      }
    }
    // 'cron' type: stored but not actively scheduled (needs cron library)

    this.jobs.set(name, record);
  }

  async cancel(name: string): Promise<void> {
    const record = this.jobs.get(name);
    if (record?.timerId) {
      clearInterval(record.timerId as ReturnType<typeof setInterval>);
      clearTimeout(record.timerId as ReturnType<typeof setTimeout>);
    }
    this.jobs.delete(name);
  }

  async trigger(name: string, data?: unknown): Promise<void> {
    const record = this.jobs.get(name);
    if (!record) {
      throw new Error(`Job "${name}" not found`);
    }
    await this.executeJob(record, data);
  }

  async getExecutions(name: string, limit?: number): Promise<JobExecution[]> {
    const record = this.jobs.get(name);
    if (!record) return [];
    const execs = record.executions;
    return limit ? execs.slice(-limit) : execs;
  }

  async listJobs(): Promise<string[]> {
    return [...this.jobs.keys()];
  }

  /**
   * Stop all active timers. Call during plugin destroy phase.
   */
  async destroy(): Promise<void> {
    for (const record of this.jobs.values()) {
      if (record.timerId) {
        clearInterval(record.timerId as ReturnType<typeof setInterval>);
        clearTimeout(record.timerId as ReturnType<typeof setTimeout>);
      }
    }
    this.jobs.clear();
  }

  private async executeJob(record: JobRecord, data?: unknown): Promise<void> {
    const execution: JobExecution = {
      jobId: record.name,
      status: 'running',
      startedAt: new Date().toISOString(),
    };

    const startMs = Date.now();
    try {
      await runWithPolicy(record.name, () => record.handler({ jobId: record.name, data }), record.options);
      execution.status = 'success';
    } catch (err) {
      execution.status = err instanceof JobTimeoutError ? 'timeout' : 'failed';
      execution.error = err instanceof Error ? err.message : String(err);
    } finally {
      execution.completedAt = new Date().toISOString();
      execution.durationMs = Date.now() - startMs;

      record.executions.push(execution);
      // Trim old executions
      if (record.executions.length > this.maxExecutions) {
        record.executions.splice(0, record.executions.length - this.maxExecutions);
      }
    }
  }
}
