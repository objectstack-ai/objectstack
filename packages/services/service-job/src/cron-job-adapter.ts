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
import { skippedTickMessage, type ScheduledFire } from './scheduled-fire.js';

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

/**
 * The part of a lock handle (`LockHandle` in `@objectstack/spec/contracts`) a
 * scheduled fire uses. Every cluster driver's handle carries `renew` and
 * `isHeld`; they are optional here only so a structural double that models a
 * lease nobody renews stays assignable. A handle without `renew` is held for
 * its first lease and no longer.
 */
interface SchedulerLockHandle {
  release(): Promise<void>;
  /** Extend the lease by `ttlMs`. Throws when the lease was lost. */
  renew?(ttlMs?: number): Promise<void>;
  /** True while this handle still owns the lock. */
  isHeld?(): boolean;
}

/** Minimal cluster lock surface for scheduler leader-election (structural — no hard dep on the cluster contract). */
interface SchedulerCluster {
  lock?: {
    acquire(key: string, opts?: { ttlMs?: number; waitMs?: number }): Promise<SchedulerLockHandle | null>;
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
  /**
   * Lease TTL (ms) a scheduled fire takes on `job:<name>`. Default 60000. The
   * fire renews it every `leaseMs / 3` while it runs (#31843), so a run longer
   * than the lease keeps it.
   */
  leaseMs?: number;
  /**
   * Human-readable label folded into this adapter's entry in croner's
   * process-global name registry — an environment id, a kernel id, anything
   * that makes `scheduledJobs` readable while debugging a multi-tenant
   * container. Purely cosmetic: uniqueness is guaranteed by the per-instance
   * discriminator and NEVER depends on this value being supplied or distinct.
   */
  namespace?: string;
  /** Surface for registry-level anomalies (a reclaimed job name) and cluster-lock outages. */
  logger?: { warn(msg: string, meta?: unknown): void; info?(msg: string, meta?: unknown): void };
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
  private readonly logger?: { warn(msg: string, meta?: unknown): void; info?(msg: string, meta?: unknown): void };
  /**
   * True from the first cluster-lock failure until the lock answers again:
   * the outage is warned about once, not once per tick of every job.
   */
  private lockOutage = false;
  /**
   * job name → the scheduled fire of it still in flight on THIS node, if any
   * (#31811). See {@link CronJobAdapter.runScheduled}.
   */
  private readonly scheduledInFlight = new Map<string, ScheduledFire>();

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
   *
   * State the guarantee WITH its window: the lock below is held for the
   * duration of the fire (acquired here, released in `finally`), so it
   * de-duplicates *concurrent* fires — its mutual-exclusion window is the
   * handler's runtime, not the scheduling deadline. Exactly-once per deadline
   * holds only when replica clocks agree to within that window (the normal
   * case on an NTP-synced deployment). A replica whose clock lags past the
   * window finds the lock already released and reruns the job; `once` has no
   * later tick during which a business-level de-duplication marker could win.
   *
   * **A job never overlaps its own scheduled run on this node** (#31811).
   * Before the lock is asked, the per-job in-flight latch below skips a tick
   * whose previous scheduled fire has not settled, and says so in one `warn`.
   * It is in-process on purpose: nothing persisted, so a restart cannot leave
   * it stuck. Manual `trigger()` neither checks nor sets it.
   *
   * **Across nodes the lease is what excludes a second fire**, so the fire
   * keeps it alive: {@link CronJobAdapter.runElected} renews the handle on a
   * heartbeat while the handler runs (#31843). If a renewal fails, the run
   * goes on; once the lease lapses, another node's next tick may take the key
   * and start the job there too. The latch still covers this node.
   */
  private async runScheduled(name: string): Promise<void> {
    const record = this.jobs.get(name);
    if (!record) return;
    const running = this.scheduledInFlight.get(name);
    if (running) {
      this.logger?.warn(skippedTickMessage('CronJobAdapter', name, running));
      return;
    }
    // Set before the first await, so a tick landing while this one is still
    // asking for the lock reads it too.
    const fire: ScheduledFire = { startedAt: new Date().toISOString() };
    this.scheduledInFlight.set(name, fire);
    try {
      await this.runElected(name, record);
    } finally {
      if (this.scheduledInFlight.get(name) === fire) this.scheduledInFlight.delete(name);
    }
  }

  /** The leader-elected half of {@link CronJobAdapter.runScheduled}. */
  private async runElected(name: string, record: CronJobRecord): Promise<void> {
    const lock = this.cluster?.lock;
    if (!lock) { await this.execute(record); return; }
    // The timers above fire this as `void this.runScheduled(...)`, so a
    // rejection here is an unhandled one, and an unhandled rejection ends the
    // process: before this guard, a remote lock store going away crashed every
    // replica at its next tick. An unreachable lock is not "another node is the
    // leader" either — it is no answer at all — so the fire is skipped (no
    // node can prove it alone runs it) and the next tick asks again.
    let handle: { release(): Promise<void> } | null;
    try {
      handle = await lock.acquire(`job:${name}`, { ttlMs: this.leaseMs, waitMs: 0 });
    } catch (err) {
      this.reportLockFailure(name, 'acquire', err);
      return;
    }
    this.reportLockAnswered();
    if (!handle) return; // another node is the leader for this fire
    const stopHeartbeat = this.keepLeaseAlive(name, handle);
    try {
      await this.execute(record);
    } finally {
      stopHeartbeat();
      try {
        await handle.release();
      } catch (err) {
        // The lease still expires on its TTL; the fire itself ran.
        this.reportLockFailure(name, 'release', err);
      }
    }
  }

  /**
   * Renew `handle`'s lease every `leaseMs / 3` until the returned stop
   * function is called (#31843). Uses the handle's own `renew()` — the
   * lease stays a lease: a node that dies stops renewing and the key frees
   * itself on its TTL.
   *
   * A failed renewal never cancels the run: it logs one `warn` per failure,
   * naming the job and the error. While the handle still reports it holds the
   * lock (a store that did not answer), the next heartbeat tries again; once it
   * reports the lease lost, renewal stops for this run, since a lapsed lease
   * cannot be renewed. Each heartbeat is armed after the previous renewal
   * settles, so a slow store never stacks renewals.
   */
  private keepLeaseAlive(name: string, handle: SchedulerLockHandle): () => void {
    if (typeof handle.renew !== 'function') return () => {};
    const periodMs = Math.max(1, Math.floor(this.leaseMs / 3));
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const beat = async (): Promise<void> => {
      try {
        await handle.renew!(this.leaseMs);
      } catch (err) {
        if (stopped) return;
        const held = handle.isHeld?.() === true;
        this.logger?.warn(
          `CronJobAdapter: could not renew the cluster lease on "job:${name}" while its scheduled run is in flight ` +
            `(${err instanceof Error ? err.message : String(err)}). The run continues; once the lease lapses, another ` +
            "node's next tick may take the key and start the same job. " +
            (held ? 'Renewal is retried on the next heartbeat.' : 'The lease is lost; renewal stops for this run.'),
        );
        if (!held) return;
      }
      arm();
    };
    const arm = (): void => {
      if (stopped) return;
      timer = setTimeout(() => { void beat(); }, periodMs);
      (timer as any)?.unref?.();
    };
    arm();
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    };
  }

  /** One warning per outage of the cluster lock, never one per tick. */
  private reportLockFailure(name: string, step: 'acquire' | 'release', err: unknown): void {
    if (this.lockOutage) return;
    this.lockOutage = true;
    this.logger?.warn(
      `CronJobAdapter: the cluster lock could not ${step} "job:${name}" (${err instanceof Error ? err.message : String(err)}); ` +
        'scheduled fires are skipped while the lock is unreachable and each job retries on its next tick. ' +
        'Further lock failures are not logged until it answers again.',
    );
  }

  /** The lock answered (granted or held elsewhere): an outage, if one was reported, is over. */
  private reportLockAnswered(): void {
    if (!this.lockOutage) return;
    this.lockOutage = false;
    this.logger?.info?.('CronJobAdapter: the cluster lock answers again; scheduled fires resume.');
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
