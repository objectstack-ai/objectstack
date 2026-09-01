// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import type {
  IQueueService,
  QueuePublishOptions,
  QueueMessage,
  QueueMessageRecord,
  QueueHandler,
} from '@objectstack/spec/contracts';
import { SysJobQueue } from '@objectstack/platform-objects/audit';
import {
  SYSTEM_CTX,
  uid,
  nowIso,
  parseJson,
  lifecycleDurationMs,
  type JobEngine,
  type JobClock,
  type JobLogger,
} from './common.js';

const QUEUE_TABLE = 'sys_job_queue';

/**
 * [#13993] An ISO-8601 date-time that denotes an ABSOLUTE instant — it
 * carries an explicit `Z` or a numeric offset, so reading it never consults
 * the process timezone. Same shape as the OCC seam's `ABSOLUTE_ISO_INSTANT`
 * (#13382, `packages/metadata-protocol/src/protocol.ts`): a string this
 * pattern rejects does not denote an instant and is not guessed at.
 */
const ABSOLUTE_ISO_INSTANT =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$/;

/**
 * [#13993] A `created_at` as a driver hands it out of the record read door,
 * read as epoch milliseconds — or null when the value does not denote an
 * instant.
 *
 * `created_at` is a builtin audit column: it is not in `datetimeFields`, so no
 * declared-field coercion reaches it, and the dialects genuinely disagree on
 * its materialisation (the domain below is the one #13382 measured and #13973
 * re-measured, pinned in `driver-sql`'s
 * `sql-driver-13567-audit-stamp-materialisation.test.ts`):
 *
 *  - **JS `Date`** — Postgres / MySQL (`timestamptz` / `DATETIME(3)` are
 *    instants and the driver materialises them as `Date` on purpose;
 *    `SqlDriver.withPostgresCalendarDayAsText` says so in as many words).
 *  - **canonical ISO-8601 UTC text** — SQLite and its turso / sqlite-wasm
 *    siblings, and `driver-memory`. This adapter writes `toISOString()`.
 *  - **`number`, epoch milliseconds** — a pre-canonical or hand-migrated
 *    SQLite column; the legacy datetime repair is keyed on declared
 *    `Field.datetime` columns, and the engine-injected audit columns are not
 *    in that set.
 *  - **anything else** — not an instant. Returns null, and the caller treats
 *    the row as OUTSIDE the window: the dedup window is measured on the
 *    `created_at` axis, so a row that cannot be placed on that axis cannot be
 *    inside it (and duplicate delivery is tolerated by contract — see
 *    `claimBatch` — while "suppress forever" is the very defect #13993
 *    removes).
 */
function createdAtInstantMs(value: unknown): number | null {
  let ms: number;
  if (value instanceof Date) {
    ms = value.getTime();
  } else if (typeof value === 'number') {
    ms = value;
  } else if (typeof value === 'string' && ABSOLUTE_ISO_INSTANT.test(value.trim())) {
    ms = Date.parse(value.trim());
  } else {
    return null;
  }
  return Number.isFinite(ms) ? ms : null;
}

/**
 * How long a `completed` row survives before the platform Reaper deletes it.
 *
 * Read from the object's own ADR-0057 declaration
 * (`sys_job_queue.lifecycle.retention`, #5179) instead of being a second
 * number here: the declaration is what actually runs (LifecycleService sweeps
 * every registered object hourly), so a copy in this file could only ever be
 * a copy that drifts. A missing or unparseable declaration throws: the queue's
 * dedup contract below is defined against this window, so "no window" is not a
 * state the adapter can run in.
 */
export function completedRetentionWindowMs(): number {
  const maxAge = SysJobQueue.lifecycle?.retention?.maxAge;
  if (!maxAge) {
    throw new Error(
      '[service-queue] sys_job_queue no longer declares lifecycle.retention — DbQueueAdapter dedups against '
      + 'terminal rows by `created_at` window and relies on that declared retention to keep them (ADR-0057, #5179). '
      + 'Restore the declaration in @objectstack/platform-objects rather than sweeping the table from here.',
    );
  }
  return lifecycleDurationMs(maxAge);
}

/**
 * [#5195] The shape `LifecycleService.registerRetentionFloor()` accepts.
 *
 * Restated here rather than imported: `@objectstack/objectql` is a
 * devDependency of this package on purpose (the queue must not drag the engine
 * into every install), so its types are not available to this package's
 * consumers at build time.
 */
export interface QueueRetentionFloor {
  policy: 'retention';
  minWindowMs: number;
  declaredBy: string;
  consequence: string;
  remedy: string;
}

/**
 * [#5195] The `lifecycle` slot's contract as THIS package consumes it — the one
 * method `QueueServicePlugin` calls, and nothing else.
 *
 * Declared rather than erased to `any` at the lookup (#4127/#4251): `any` would
 * switch off checking on the single call that carries the floor, so a rename or
 * a changed argument order in `LifecycleService.registerRetentionFloor` would
 * compile here and fail at runtime inside a `try` that logs and continues —
 * i.e. the floor would silently not exist, which is precisely the silent
 * bypass #5195 exists to close.
 *
 * `registerRetentionFloor` is **optional** on purpose, and that optionality is
 * the honest part of the contract: a kernel may carry a lifecycle service that
 * predates floors, so the runtime `typeof … === 'function'` probe below is a
 * real check and the type says so, instead of an `any` that hides both the
 * check and the call.
 */
export interface LifecycleFloorRegistrar {
  registerRetentionFloor?(object: string, floor: QueueRetentionFloor): void;
}

export interface DbQueueAdapterOptions {
  /** Polling interval for the worker loop (ms, default 1000) */
  pollIntervalMs?: number;
  /** Max messages claimed per poll tick (default 10) */
  batchSize?: number;
  /** Lease duration before another worker may reclaim (ms, default 30000) */
  leaseMs?: number;
  /**
   * Idempotency window — how long the same key blocks re-publish (ms, default 24h).
   *
   * Must not exceed `sys_job_queue`'s declared retention for `completed` rows
   * ({@link completedRetentionWindowMs}, 7d): the window is evaluated against
   * rows that are still in the table, so a longer window would silently start
   * accepting duplicates as soon as the Reaper swept the row it dedups
   * against. The constructor rejects that configuration (#5179).
   */
  idempotencyWindowMs?: number;
  /** Default maxAttempts when publish doesn't specify (default 3) */
  defaultMaxAttempts?: number;
  /** Unique identifier for this worker (default: random) */
  workerId?: string;
  /** Whether to auto-start the polling worker (default true) */
  autoStart?: boolean;
}

interface RegisteredHandler {
  queue: string;
  fn: QueueHandler;
}

/**
 * DbQueueAdapter — durable, polling, DB-backed IQueueService.
 *
 * Persists every message to `sys_job_queue`. A polling worker leases
 * pending messages (CAS update status pending→running with a lease),
 * invokes registered subscribers, and retries with backoff on failure.
 * Messages that exceed `max_attempts` land in `status='dlq'`.
 *
 * Idempotency: publish suppresses duplicates within a configurable
 * window when `(queue, idempotencyKey)` is non-null.
 *
 * Retention: this adapter does NOT sweep the table. `completed` rows are
 * bounded by `sys_job_queue`'s declared ADR-0057 retention (7d, filtered to
 * `status='completed'`), enforced by the one platform-owned
 * `LifecycleService` reaper — see the object definition in
 * `@objectstack/platform-objects` and {@link completedRetentionWindowMs}.
 * `dlq`/`failed` rows are never swept; they are the dead-letter surface
 * ({@link DbQueueAdapter.listFailed} / {@link DbQueueAdapter.replay} /
 * {@link DbQueueAdapter.purgeFailed}).
 *
 * Designed for SQLite and Postgres alike — uses CAS via WHERE-clauses,
 * not row-level locking.
 */
export class DbQueueAdapter implements IQueueService {
  private readonly engine: JobEngine;
  private readonly logger?: JobLogger;
  private readonly clock?: JobClock;
  private readonly opts: Required<Omit<DbQueueAdapterOptions, 'workerId'>> & { workerId: string };

  private readonly handlers = new Map<string, RegisteredHandler[]>();
  private timer?: ReturnType<typeof setInterval>;
  private running = false;

  constructor(args: {
    engine: JobEngine;
    logger?: JobLogger;
    clock?: JobClock;
    options?: DbQueueAdapterOptions;
  }) {
    this.engine = args.engine;
    this.logger = args.logger;
    this.clock = args.clock;
    const o = args.options ?? {};
    this.opts = {
      pollIntervalMs: o.pollIntervalMs ?? 1000,
      batchSize: o.batchSize ?? 10,
      leaseMs: o.leaseMs ?? 30_000,
      idempotencyWindowMs: o.idempotencyWindowMs ?? 24 * 60 * 60 * 1000,
      defaultMaxAttempts: o.defaultMaxAttempts ?? 3,
      autoStart: o.autoStart ?? true,
      workerId: o.workerId ?? uid('worker'),
    };

    // [#5179] The dedup window only means anything while the row it dedups
    // against still exists. `completed` rows now expire on the declared
    // retention window, so an idempotency window LONGER than it would quietly
    // degrade into "dedup for as long as the Reaper happens not to have run" —
    // duplicate deliveries appearing days later, with nothing in any log. The
    // two windows are ordered here, at construction, rather than tolerated at
    // publish time: the fix is a config or declaration change, and both are
    // named in the message.
    const retentionMs = completedRetentionWindowMs();
    if (this.opts.idempotencyWindowMs > retentionMs) {
      throw new Error(
        `[service-queue] idempotencyWindowMs (${this.opts.idempotencyWindowMs}ms) exceeds the retention window `
        + `sys_job_queue declares for completed rows (${retentionMs}ms, lifecycle.retention.maxAge — ADR-0057). `
        + 'Terminal-row dedup is evaluated by `created_at` against that same window, so the longer setting would '
        + 'silently accept duplicates once a row is reaped. Lower idempotencyWindowMs, or raise the declared '
        + 'retention (both windows are measured from `created_at`).',
      );
    }
  }

  /** The configured dedup window (ms) — the number the floor below is made of. */
  get idempotencyWindowMs(): number {
    return this.opts.idempotencyWindowMs;
  }

  /**
   * [#5195] The retention floor `sys_job_queue` must satisfy for this adapter's
   * dedup contract to mean anything, handed to `LifecycleService`
   * (`registerRetentionFloor`) by `QueueServicePlugin`.
   *
   * The constructor check above only reads the object's **declaration**. ADR-0057
   * P4 lets an operator override that window per environment/tenant through the
   * `lifecycle` settings namespace, which the constructor cannot see: set
   * `lifecycle.retention_overrides.sys_job_queue.maxAge = '1h'` and completed
   * rows vanish an hour after they are written while publish keeps dedupping
   * against a 24h window — duplicate deliveries resume, with nothing in any log.
   * Registering the floor is what closes that door, and it carries the number
   * this adapter was actually CONSTRUCTED with rather than a static copy of the
   * default (a per-kernel option cannot live in the object's declaration).
   */
  retentionFloor(): QueueRetentionFloor {
    const ms = this.opts.idempotencyWindowMs;
    // Settings are authored as ADR-0057 duration literals, not milliseconds, so
    // the remedy quotes one the operator can paste — rounded UP, since a
    // rounded-down literal would be rejected by the very floor it is meant to
    // satisfy.
    const literal = `${Math.ceil(ms / 3_600_000)}h`;
    return {
      policy: 'retention',
      minWindowMs: ms,
      declaredBy: 'com.objectstack.service.queue',
      consequence:
        `DbQueueAdapter dedups sys_job_queue publishes by comparing created_at against its ${ms}ms `
        + 'idempotency window, so a shorter retention deletes the very rows that check reads — '
        + 'duplicate deliveries resume silently, with nothing in any log.',
      remedy:
        `set lifecycle.retention_overrides.sys_job_queue.maxAge to '${literal}' or longer, or lower `
        + "QueueServicePlugin's db.idempotencyWindowMs to the window you actually want (both are measured "
        + 'from created_at).',
    };
  }

  // ── IQueueService ────────────────────────────────────────────────

  async publish<T = unknown>(
    queue: string,
    data: T,
    options?: QueuePublishOptions,
  ): Promise<string> {
    const opts = options ?? {};
    const now = this.now();

    // Idempotency check.
    //
    // [#5179] This is the reason `sys_job_queue`'s retention is filtered and
    // generous rather than aggressive: a terminal (`completed`/`dlq`) row
    // blocks a re-publish only while its `created_at` is inside the
    // idempotency window, so the row must SURVIVE that long. The declared
    // retention (7d on `completed`, nothing on `dlq`) is measured on the very
    // same `created_at` axis and is ≥ this window — enforced in the
    // constructor — which makes "the reaper deleted a row the dedup check
    // needed" unrepresentable rather than merely unlikely.
    if (opts.idempotencyKey) {
      const windowStartMs = now.getTime() - this.opts.idempotencyWindowMs;
      const existing = await this.engine.find(QUEUE_TABLE, {
        where: {
          queue,
          idempotency_key: opts.idempotencyKey,
          // Only block if not yet terminal — completed/dlq dedup is by window via created_at
        },
        limit: 5,
        context: SYSTEM_CTX,
      });
      const blocking = (existing ?? []).find((row: any) => {
        if (row.status === 'pending' || row.status === 'running') return true;
        // [#13993] Compare INSTANTS, not strings (#13382's shape). The old
        // `String(row.created_at) >= windowStart` was a lexicographic compare
        // whose left side, on Postgres/MySQL, is a `Date.toString()` starting
        // with a weekday LETTER — unconditionally above the ISO text's digit —
        // so every terminal row blocked forever and publish() silently
        // enqueued nothing. An instant compare gives every materialisation the
        // same verdict; a row whose created_at denotes no instant cannot be
        // inside the window (see createdAtInstantMs).
        const createdAtMs = createdAtInstantMs(row.created_at);
        return createdAtMs !== null && createdAtMs >= windowStartMs;
      });
      if (blocking) return String(blocking.id);
    }

    const id = uid('msg');
    const scheduledFor = opts.scheduledFor
      ? new Date(opts.scheduledFor).toISOString()
      : opts.delay
        ? new Date(now.getTime() + opts.delay).toISOString()
        : now.toISOString();

    const maxAttempts = opts.maxAttempts
      ?? (opts.retries != null ? opts.retries + 1 : this.opts.defaultMaxAttempts);
    const backoff = opts.backoff ?? { type: 'exponential' as const, delayMs: 1000 };

    await this.engine.insert(QUEUE_TABLE, {
      id,
      queue,
      idempotency_key: opts.idempotencyKey ?? null,
      payload_json: JSON.stringify(data ?? null),
      metadata_json: opts.metadata ? JSON.stringify(opts.metadata) : null,
      status: 'pending',
      priority: opts.priority ?? 100,
      attempts: 0,
      max_attempts: maxAttempts,
      backoff_type: backoff.type,
      backoff_delay_ms: backoff.delayMs,
      backoff_max_delay_ms: backoff.maxDelayMs ?? null,
      scheduled_for: scheduledFor,
      created_at: now.toISOString(),
      updated_at: now.toISOString(),
    }, { context: SYSTEM_CTX });

    return id;
  }

  async subscribe<T = unknown>(queue: string, handler: QueueHandler<T>): Promise<void> {
    const existing = this.handlers.get(queue) ?? [];
    existing.push({ queue, fn: handler as QueueHandler });
    this.handlers.set(queue, existing);
    if (this.opts.autoStart) this.start();
  }

  async unsubscribe(queue: string): Promise<void> {
    this.handlers.delete(queue);
  }

  async getQueueSize(queue: string): Promise<number> {
    const rows = await this.engine.find(QUEUE_TABLE, {
      where: { queue, status: 'pending' },
      limit: 10_000,
      context: SYSTEM_CTX,
    });
    return rows?.length ?? 0;
  }

  async purge(queue: string): Promise<void> {
    const rows = await this.engine.find(QUEUE_TABLE, {
      where: { queue, status: 'pending' },
      limit: 10_000,
      context: SYSTEM_CTX,
    });
    for (const row of rows ?? []) {
      // `where: { id }` — the engine's delete has no top-level `id` option.
      // The old `{ id: row.id }` bag carried no predicate at all, so every
      // purge delete threw "Delete requires an ID or options.multi=true"
      // straight into this catch: purge logged a warn per row and deleted
      // NOTHING (#4371 option-2 survey).
      try { await this.engine.delete(QUEUE_TABLE, { where: { id: row.id }, context: SYSTEM_CTX }); }
      catch (err) { this.logger?.warn?.('DbQueueAdapter: purge delete failed', err as any); }
    }
  }

  async listFailed(
    queue?: string,
    options?: { limit?: number; offset?: number },
  ): Promise<QueueMessageRecord[]> {
    const where: any = { status: 'dlq' };
    if (queue) where.queue = queue;
    const rows = await this.engine.find(QUEUE_TABLE, {
      where,
      limit: options?.limit ?? 100,
      offset: options?.offset,
      orderBy: [{ field: 'created_at', order: 'desc' }],
      context: SYSTEM_CTX,
    });
    return (rows ?? []).map((r: any) => this.rowToRecord(r));
  }

  async replay(messageId: string): Promise<void> {
    const row = await this.loadById(messageId);
    if (!row) throw new Error(`MESSAGE_NOT_FOUND: ${messageId}`);
    if (row.status !== 'dlq' && row.status !== 'failed') {
      throw new Error(`INVALID_STATE: cannot replay message in status=${row.status}`);
    }
    const now = this.now();
    await this.engine.update(QUEUE_TABLE, {
      id: messageId,
      status: 'pending',
      attempts: 0,
      last_error: null,
      locked_by: null,
      locked_until: null,
      scheduled_for: now.toISOString(),
      updated_at: now.toISOString(),
    }, { context: SYSTEM_CTX });
  }

  async purgeFailed(messageId: string): Promise<void> {
    const row = await this.loadById(messageId);
    if (!row) return;
    if (row.status !== 'dlq' && row.status !== 'failed') {
      throw new Error(`INVALID_STATE: cannot purge message in status=${row.status}`);
    }
    await this.engine.delete(QUEUE_TABLE, { where: { id: messageId }, context: SYSTEM_CTX });
  }

  // ── Worker lifecycle ─────────────────────────────────────────────

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      if (this.running) return;
      this.running = true;
      this.pollOnce()
        .catch((err) => { this.logger?.warn?.('DbQueueAdapter: poll tick failed', err); })
        .finally(() => { this.running = false; });
    }, this.opts.pollIntervalMs);
    (this.timer as any)?.unref?.();
  }

  async stop(): Promise<void> {
    if (this.timer) { clearInterval(this.timer); this.timer = undefined; }
  }

  /** Test-friendly synchronous poll. */
  async pollOnce(): Promise<number> {
    const queues = [...this.handlers.keys()];
    if (queues.length === 0) return 0;

    let processed = 0;
    for (const queue of queues) {
      const claimed = await this.claimBatch(queue, this.opts.batchSize);
      for (const row of claimed) {
        await this.dispatch(row);
        processed++;
      }
    }
    return processed;
  }

  // ── Internals ────────────────────────────────────────────────────

  private async claimBatch(queue: string, max: number): Promise<any[]> {
    const now = this.now();
    const candidates = await this.engine.find(QUEUE_TABLE, {
      where: { queue, status: 'pending' },
      limit: max * 3, // over-fetch in case of CAS contention
      orderBy: [
        { field: 'priority', order: 'asc' },
        { field: 'scheduled_for', order: 'asc' },
      ],
      context: SYSTEM_CTX,
    });

    const out: any[] = [];
    for (const row of candidates ?? []) {
      if (out.length >= max) break;
      const sched = row.scheduled_for ? new Date(row.scheduled_for).getTime() : 0;
      if (sched > now.getTime()) continue;
      // Honor existing lease
      const lockedUntil = row.locked_until ? new Date(row.locked_until).getTime() : 0;
      if (row.locked_by && lockedUntil > now.getTime()) continue;

      // CAS — only update if still pending (best-effort with engine.update which
      // typically does row-level update by id; concurrent workers will overwrite
      // each other but the dispatcher tolerates duplicate delivery via attempts).
      try {
        await this.engine.update(QUEUE_TABLE, {
          id: row.id,
          status: 'running',
          locked_by: this.opts.workerId,
          locked_until: new Date(now.getTime() + this.opts.leaseMs).toISOString(),
          updated_at: now.toISOString(),
        }, { context: SYSTEM_CTX });
        out.push({ ...row, status: 'running' });
      } catch (err) {
        this.logger?.warn?.('DbQueueAdapter: claim CAS failed', err as any);
      }
    }
    return out;
  }

  private async dispatch(row: any): Promise<void> {
    const handlers = this.handlers.get(row.queue) ?? [];
    if (handlers.length === 0) {
      // No handler — release lease so another process can pick it up
      await this.releasePending(row.id);
      return;
    }

    const msg: QueueMessage = {
      id: String(row.id),
      data: parseJson(row.payload_json),
      attempts: (row.attempts ?? 0) + 1,
      timestamp: row.created_at ? new Date(row.created_at).getTime() : Date.now(),
    };

    let success = true;
    let lastError: string | undefined;
    for (const h of handlers) {
      try { await h.fn(msg); }
      catch (err) {
        success = false;
        lastError = err instanceof Error ? err.message : String(err);
        this.logger?.warn?.(`DbQueueAdapter: handler failed on ${row.queue}`, err as any);
        break;
      }
    }

    const now = this.now();
    if (success) {
      await this.engine.update(QUEUE_TABLE, {
        id: row.id,
        status: 'completed',
        attempts: msg.attempts,
        completed_at: now.toISOString(),
        locked_by: null,
        locked_until: null,
        updated_at: now.toISOString(),
      }, { context: SYSTEM_CTX });
      return;
    }

    const attempts = msg.attempts;
    const max = row.max_attempts ?? this.opts.defaultMaxAttempts;
    if (attempts >= max) {
      await this.engine.update(QUEUE_TABLE, {
        id: row.id,
        status: 'dlq',
        attempts,
        last_error: lastError ?? 'unknown error',
        completed_at: now.toISOString(),
        locked_by: null,
        locked_until: null,
        updated_at: now.toISOString(),
      }, { context: SYSTEM_CTX });
      return;
    }

    const backoffMs = this.computeBackoff(row, attempts);
    await this.engine.update(QUEUE_TABLE, {
      id: row.id,
      status: 'pending',
      attempts,
      last_error: lastError ?? 'unknown error',
      scheduled_for: new Date(now.getTime() + backoffMs).toISOString(),
      locked_by: null,
      locked_until: null,
      updated_at: now.toISOString(),
    }, { context: SYSTEM_CTX });
  }

  private computeBackoff(row: any, attempt: number): number {
    const base = row.backoff_delay_ms ?? 1000;
    const cap = row.backoff_max_delay_ms ?? undefined;
    if ((row.backoff_type ?? 'exponential') === 'fixed') return base;
    const exp = base * Math.pow(2, Math.max(0, attempt - 1));
    return cap ? Math.min(exp, cap) : exp;
  }

  private async releasePending(id: string): Promise<void> {
    const now = this.now();
    try {
      await this.engine.update(QUEUE_TABLE, {
        id,
        status: 'pending',
        locked_by: null,
        locked_until: null,
        scheduled_for: new Date(now.getTime() + this.opts.pollIntervalMs * 5).toISOString(),
        updated_at: now.toISOString(),
      }, { context: SYSTEM_CTX });
    } catch (err) {
      this.logger?.warn?.('DbQueueAdapter: release failed', err as any);
    }
  }

  private async loadById(id: string): Promise<any | null> {
    const rows = await this.engine.find(QUEUE_TABLE, {
      where: { id },
      limit: 1,
      context: SYSTEM_CTX,
    });
    return rows?.[0] ?? null;
  }

  private rowToRecord(r: any): QueueMessageRecord {
    return {
      id: String(r.id),
      queue: String(r.queue),
      data: parseJson(r.payload_json),
      status: r.status,
      attempts: r.attempts ?? 0,
      maxAttempts: r.max_attempts ?? this.opts.defaultMaxAttempts,
      scheduledFor: r.scheduled_for ?? undefined,
      lockedBy: r.locked_by ?? undefined,
      lockedUntil: r.locked_until ?? undefined,
      lastError: r.last_error ?? undefined,
      idempotencyKey: r.idempotency_key ?? undefined,
      metadata: parseJson(r.metadata_json),
      createdAt: r.created_at ?? nowIso(this.clock),
      updatedAt: r.updated_at ?? undefined,
      completedAt: r.completed_at ?? undefined,
    };
  }

  private now(): Date {
    return this.clock?.now() ?? new Date();
  }
}
