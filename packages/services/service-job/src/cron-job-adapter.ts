// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { Cron, scheduledJobs } from 'croner';
import type {
  IJobService,
  JobSchedule,
  JobHandler,
  JobExecution,
  JobScheduleOptions,
} from '@objectstack/spec/contracts';
import { runWithPolicy, JobTimeoutError } from './run-with-policy.js';

/**
 * Monotonic counter that makes every adapter instance's registry prefix unique
 * within the process. Uniqueness has to be PER INSTANCE, not per environment:
 * a kernel rebuild produces a new adapter for the *same* environment id, which
 * is exactly the collision an environment-scoped namespace would fail to
 * prevent (#8362).
 */
let ADAPTER_SEQUENCE = 0;

/** Namespace labels ride in a croner job name — keep them boring. */
function sanitizeNamespaceLabel(label: string | undefined): string {
  const trimmed = (label ?? '').trim().replace(/[^A-Za-z0-9._-]+/g, '-');
  return trimmed.length > 0 ? trimmed.slice(0, 48) : 'kernel';
}

/** Minimal cluster lock surface for scheduler leader-election (structural — no hard dep on the cluster contract). */
interface SchedulerCluster {
  lock?: {
    acquire(key: string, opts?: { ttlMs?: number; waitMs?: number }): Promise<{ release(): Promise<void> } | null>;
  };
}

/**
 * Configuration for the cron-based job adapter.
 */
export interface CronJobAdapterOptions {
  /** Timezone for cron expressions (default: 'UTC') */
  timezone?: string;
  /** Maximum execution history per job (default: 100) */
  maxExecutions?: number;
  /** Cluster service for scheduler leader-election. With a remote driver only ONE
   * node fires each scheduled job; with the in-memory driver the lock always
   * succeeds so single-node behaviour is unchanged. */
  cluster?: SchedulerCluster;
  /** Lease TTL (ms) held while a scheduled fire runs. Default 60000. */
  leaseMs?: number;
  /**
   * Human-readable label folded into this adapter's entry in croner's
   * process-global name registry — an environment id, a kernel id, anything
   * that makes `scheduledJobs` readable while debugging a multi-tenant
   * container. Purely cosmetic: uniqueness is guaranteed by the per-instance
   * discriminator and NEVER depends on this value being supplied or distinct.
   */
  namespace?: string;
  /** Surface for registry-level anomalies (a reclaimed job name). */
  logger?: { warn(msg: string, meta?: unknown): void };
}

interface CronJobRecord {
  name: string;
  schedule: JobSchedule;
  handler: JobHandler;
  options?: JobScheduleOptions;
  task?: Cron;
  executions: JobExecution[];
}

/**
 * Cron-based job adapter implementing IJobService using the `croner`
 * library. Honours per-job timezones, supports the standard 5-field cron
 * syntax, and falls back to setInterval / setTimeout for `interval` and
 * `once` schedule types (so a single CronJobAdapter can serve as the
 * "real" production job runner).
 */
export class CronJobAdapter implements IJobService {
  private readonly defaultTimezone: string;
  private readonly maxExecutions: number;
  private readonly jobs = new Map<string, CronJobRecord>();
  private readonly cluster?: SchedulerCluster;
  private readonly leaseMs: number;
  private readonly logger?: { warn(msg: string, meta?: unknown): void };

  /**
   * This instance's prefix in croner's PROCESS-GLOBAL name registry.
   *
   * croner keys named jobs in a module-level array shared by everything in the
   * process, so a bare job name is a process-wide claim — which is why two
   * environments in one container used to collide on the same AI-generated
   * flow name with no kernel eviction involved at all, and why an evicted
   * kernel's leftovers used to block every later rebind (#8362). Scoping the
   * registry key to the adapter INSTANCE makes both collisions unreachable:
   * one kernel builds one adapter, and a rebuilt kernel builds a new one.
   */
  readonly registryNamespace: string;

  constructor(options: CronJobAdapterOptions = {}) {
    this.defaultTimezone = options.timezone ?? 'UTC';
    this.maxExecutions = options.maxExecutions ?? 100;
    this.cluster = options.cluster;
    this.leaseMs = options.leaseMs ?? 60_000;
    this.logger = options.logger;
    this.registryNamespace = `${sanitizeNamespaceLabel(options.namespace)}#${++ADAPTER_SEQUENCE}.${Math.random()
      .toString(36)
      .slice(2, 8)}`;
  }

  /**
   * The name `jobName` is registered under in croner's process-global
   * registry. Public because that registry is shared with everything else in
   * the process: this is the only way an operator (or a test) can tell which
   * entry of `scheduledJobs` belongs to which kernel.
   */
  cronRegistryName(jobName: string): string {
    return `${this.registryNamespace}::${jobName}`;
  }

  async schedule(name: string, schedule: JobSchedule, handler: JobHandler, options?: JobScheduleOptions): Promise<void> {
    await this.cancel(name);

    const record: CronJobRecord = { name, schedule, handler, options, executions: [] };

    if (schedule.type === 'cron') {
      if (!schedule.expression) {
        throw new Error(`CronJobAdapter: cron schedule for "${name}" missing expression`);
      }
      const registryName = this.cronRegistryName(name);
      this.reclaimRegistryName(registryName);
      const task = new Cron(
        schedule.expression,
        { timezone: schedule.timezone ?? this.defaultTimezone, name: registryName },
        async () => { await this.runScheduled(name); },
      );
      record.task = task;
    } else if (schedule.type === 'interval' && schedule.intervalMs) {
      const handle = setInterval(() => { void this.runScheduled(name); }, schedule.intervalMs);
      (handle as any)?.unref?.();
      // Use a sentinel Cron-like shape with stop() for cancel()
      record.task = { stop: () => clearInterval(handle) } as unknown as Cron;
    } else if (schedule.type === 'once' && schedule.at) {
      const delay = new Date(schedule.at).getTime() - Date.now();
      if (delay > 0) {
        const handle = setTimeout(() => { void this.runScheduled(name); }, delay);
        (handle as any)?.unref?.();
        record.task = { stop: () => clearTimeout(handle) } as unknown as Cron;
      }
    }

    this.jobs.set(name, record);
  }

  async cancel(name: string): Promise<void> {
    const rec = this.jobs.get(name);
    if (rec?.task) {
      try { rec.task.stop(); } catch { /* ignore */ }
    }
    this.jobs.delete(name);
  }

  async trigger(name: string, data?: unknown): Promise<void> {
    const rec = this.jobs.get(name);
    if (!rec) throw new Error(`Job "${name}" not found`);
    await this.execute(rec, data);
  }

  async getExecutions(name: string, limit?: number): Promise<JobExecution[]> {
    const rec = this.jobs.get(name);
    if (!rec) return [];
    return limit ? rec.executions.slice(-limit) : rec.executions;
  }

  async listJobs(): Promise<string[]> {
    return [...this.jobs.keys()];
  }

  /**
   * Replace semantics for the process-global registry: if anything still holds
   * the name we are about to claim, STOP it and take the name — never warn and
   * give up, which is how a failed rebind used to end (#8362).
   *
   * Stopping is the whole point and not a detail. A leaked croner job is not
   * merely holding a string: it is a live timer whose closure still references
   * the kernel that created it. Taking the name while leaving that timer
   * running would turn a silent death into a zombie double-write — two live
   * jobs for one flow, one of them driving a shut-down kernel — which is
   * strictly worse than the bug being fixed. `stop()` both kills the timer and
   * splices the entry out of croner's registry, so the reclaim is complete.
   *
   * With per-instance namespacing our own adapters can no longer collide, so
   * reaching this at all means a foreign holder — worth a line in the log.
   */
  private reclaimRegistryName(registryName: string): void {
    const holder = scheduledJobs.find((job) => job.name === registryName);
    if (!holder) return;
    try { holder.stop(); } catch { /* ignore — the retake below is what matters */ }
    this.logger?.warn(
      `CronJobAdapter: reclaimed croner job name "${registryName}" from a job this adapter did not schedule; ` +
        'the previous job was STOPPED and replaced.',
    );
  }

  /**
   * Stop all timers and release every process-global croner name this adapter
   * holds. Called from `DbJobAdapter.destroy()` and `JobServicePlugin.destroy()`
   * — i.e. from the kernel eviction chain, which until #8362 stopped one level
   * above this method and left every evicted kernel's timers running forever.
   */
  async destroy(): Promise<void> {
    for (const rec of this.jobs.values()) {
      try { rec.task?.stop(); } catch { /* ignore */ }
    }
    this.jobs.clear();
  }

  /**
   * Run a SCHEDULED fire of `name` under cluster leader-election: only the node
   * that acquires the per-job lock runs the handler; peers skip. No cluster /
   * in-memory driver => lock always granted => single-node unchanged. Manual
   * `trigger()` bypasses this.
   */
  private async runScheduled(name: string): Promise<void> {
    const record = this.jobs.get(name);
    if (!record) return;
    const lock = this.cluster?.lock;
    if (!lock) { await this.execute(record); return; }
    const handle = await lock.acquire(`job:${name}`, { ttlMs: this.leaseMs, waitMs: 0 });
    if (!handle) return; // another node is the leader for this fire
    try {
      await this.execute(record);
    } finally {
      try { await handle.release(); } catch { /* ignore */ }
    }
  }

  private async execute(record: CronJobRecord, data?: unknown): Promise<void> {
    const execution: JobExecution = {
      jobId: record.name,
      status: 'running',
      startedAt: new Date().toISOString(),
    };
    const startMs = Date.now();
    try {
      const outcome = await runWithPolicy(record.name, () => record.handler({ jobId: record.name, data }), record.options);
      // #5548 — same mapping as `IntervalJobAdapter.executeJob`, deliberately
      // one shape and not two spellings: a resolved `degraded` outcome is a
      // completed run whose work did not happen, never a `success`.
      if (outcome && outcome.outcome === 'degraded') {
        execution.status = 'degraded';
        execution.error = outcome.reason;
      } else {
        execution.status = 'success';
      }
    } catch (err) {
      execution.status = err instanceof JobTimeoutError ? 'timeout' : 'failed';
      execution.error = err instanceof Error ? err.message : String(err);
    } finally {
      execution.completedAt = new Date().toISOString();
      execution.durationMs = Date.now() - startMs;
      record.executions.push(execution);
      if (record.executions.length > this.maxExecutions) {
        record.executions.splice(0, record.executions.length - this.maxExecutions);
      }
    }
  }
}
