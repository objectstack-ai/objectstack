// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import type { Logger } from '@objectstack/spec/contracts';
import type { RunRecord, SuspendedRun, SuspendedRunStore } from './engine.js';

/**
 * Durable persistence for suspended flow runs (ADR-0019).
 *
 * The engine keeps an in-memory map of paused runs; that map is lost on a
 * process restart (e.g. a hibernating Cloudflare Worker), so a run that paused
 * at an `approval` / `wait` / `screen` node can never be resumed afterwards.
 * A {@link SuspendedRunStore} backs the in-memory map with durable storage so a
 * cold-booted kernel can rehydrate and continue.
 *
 * Two implementations ship here:
 *   - {@link InMemorySuspendedRunStore} — a Map (the default behaviour, for
 *     tests / dev). It JSON round-trips on save/load so it faithfully exercises
 *     the serialization boundary a DB store imposes.
 *   - {@link ObjectStoreSuspendedRunStore} — persists to the `sys_automation_run`
 *     object via the ObjectQL engine, for production / serverless hosts.
 */

const TABLE = 'sys_automation_run';
/** Prefix for terminal run-history row ids, keeping them disjoint from live
 *  suspended runs (which use the raw `runId`). */
const HISTORY_PREFIX = 'run_';
const SYSTEM_CTX = { isSystem: true, roles: [], permissions: [] } as const;

/**
 * Default per-flow cap on terminal run-history rows (#2585 retention stop-gap
 * until the ADR-0057 lifecycle sweep covers `sys_automation_run`). A busy
 * per-record-change flow otherwise persists one row per execution forever —
 * exactly the unbounded self-telemetry growth ADR-0057 exists to prevent.
 * 100 newest terminal runs per flow keeps the Runs surface useful while
 * bounding the table. `0` disables the cap.
 */
export const DEFAULT_MAX_TERMINAL_RUNS_PER_FLOW = 100;

/**
 * Default age-based retention window for terminal run-history rows, in days.
 * Enforced by {@link ObjectStoreSuspendedRunStore.pruneHistory}, swept
 * periodically by the service plugin. `0` disables age pruning. Suspended
 * (`paused`) rows are live resumable state and are NEVER age-pruned.
 */
export const DEFAULT_RUN_HISTORY_RETENTION_DAYS = 30;

/** Max deletes one write-time overflow prune may issue — bounds the write
 *  amplification a single `recordTerminal` can incur on a legacy oversized
 *  table (the periodic age sweep handles bulk convergence). */
const OVERFLOW_PRUNE_BATCH = 50;

/** Byte cap for a terminal row's persisted `steps_json`. When over, the step
 *  tail is halved until it fits — the newest steps carry the failure. */
const MAX_STEPS_JSON_BYTES = 64 * 1024;

const TERMINAL_STATUSES = ['completed', 'failed'] as const;

function isTerminalStatus(status: unknown): boolean {
    return status === 'completed' || status === 'failed';
}

/** Deep clone via JSON so a stored snapshot can't alias live engine state. */
function jsonClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/** Parse a JSON column that may already be an object (some drivers auto-parse). */
function parseJson<T>(raw: unknown, fallback: T): T {
  if (raw == null || raw === '') return fallback;
  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw) as T;
    } catch {
      return fallback;
    }
  }
  return raw as T;
}

/**
 * In-memory {@link SuspendedRunStore}. Snapshots are JSON-cloned on the way in
 * and out, matching the serialize/deserialize boundary of a DB-backed store —
 * so a unit test can share one instance across two engine instances to simulate
 * a process restart (suspend on engine A, resume on engine B).
 */
export class InMemorySuspendedRunStore implements SuspendedRunStore {
  private readonly runs = new Map<string, SuspendedRun>();
  private readonly history = new Map<string, RunRecord>();
  private readonly maxTerminalRunsPerFlow: number;

  constructor(options?: { maxTerminalRunsPerFlow?: number }) {
    this.maxTerminalRunsPerFlow =
      options?.maxTerminalRunsPerFlow ?? DEFAULT_MAX_TERMINAL_RUNS_PER_FLOW;
  }

  async save(run: SuspendedRun): Promise<void> {
    this.runs.set(run.runId, jsonClone(run));
  }

  async load(runId: string): Promise<SuspendedRun | null> {
    const run = this.runs.get(runId);
    return run ? jsonClone(run) : null;
  }

  async delete(runId: string): Promise<void> {
    this.runs.delete(runId);
  }

  async list(): Promise<SuspendedRun[]> {
    return [...this.runs.values()].map(jsonClone);
  }

  async recordTerminal(record: RunRecord): Promise<void> {
    this.history.set(record.runId, jsonClone(record));
    // Per-flow cap (#2585 retention): evict the oldest terminal runs beyond
    // the cap, mirroring the DB-backed store's write-time prune.
    if (this.maxTerminalRunsPerFlow > 0) {
      const flowRuns = [...this.history.values()]
        .filter((r) => r.flowName === record.flowName)
        .sort((a, b) => (b.startedAt ?? '').localeCompare(a.startedAt ?? ''));
      for (const evicted of flowRuns.slice(this.maxTerminalRunsPerFlow)) {
        this.history.delete(evicted.runId);
      }
    }
  }

  async listHistory(flowName: string, limit: number): Promise<RunRecord[]> {
    return [...this.history.values()]
      .filter((r) => r.flowName === flowName)
      .sort((a, b) => (b.startedAt ?? '').localeCompare(a.startedAt ?? ''))
      .slice(0, limit)
      .map(jsonClone);
  }

  async loadTerminal(runId: string): Promise<RunRecord | null> {
    const record = this.history.get(runId);
    return record ? jsonClone(record) : null;
  }
}

/**
 * Minimal ObjectQL engine surface the {@link ObjectStoreSuspendedRunStore} uses.
 * Matches the find/insert/update/delete shape exposed by the `objectql` service
 * (and mirrors `ApprovalEngine` in plugin-approvals).
 */
export interface SuspendedRunStoreEngine {
  find(object: string, options?: any): Promise<any[]>;
  insert(object: string, data: any, options?: any): Promise<any>;
  update(object: string, data: any, options?: any): Promise<any>;
  delete?(object: string, options?: any): Promise<any>;
}

interface MinimalLogger {
  warn?: Logger['warn'];
  debug?: Logger['debug'];
}

/** Tuning knobs for the DB-backed store's run-history retention (#2585). */
export interface ObjectStoreSuspendedRunStoreOptions {
  /**
   * Per-flow cap on terminal history rows, enforced at write time in
   * {@link ObjectStoreSuspendedRunStore.recordTerminal}. Defaults to
   * {@link DEFAULT_MAX_TERMINAL_RUNS_PER_FLOW}; `0` disables the cap.
   */
  maxTerminalRunsPerFlow?: number;
}

/**
 * Durable {@link SuspendedRunStore} backed by the `sys_automation_run` object.
 *
 * Persists the resumable run state (`variables` / `steps` / `context` / `screen`)
 * JSON-serialized, so the engine's `Map`-based variable context round-trips. A
 * live pause is keyed by `runId` and removed on terminal completion; terminal
 * runs are kept as `run_`-prefixed history rows (bounded by the per-flow cap
 * and the age sweep, #2585). All access uses a system context — these are
 * infrastructure rows, not tenant data subject to RLS (the tenant is captured
 * in `organization_id` for scoping/observability).
 */
export class ObjectStoreSuspendedRunStore implements SuspendedRunStore {
  private readonly maxTerminalRunsPerFlow: number;

  constructor(
    private readonly engine: SuspendedRunStoreEngine,
    private readonly logger?: MinimalLogger,
    options?: ObjectStoreSuspendedRunStoreOptions,
  ) {
    this.maxTerminalRunsPerFlow =
      options?.maxTerminalRunsPerFlow ?? DEFAULT_MAX_TERMINAL_RUNS_PER_FLOW;
  }

  async save(run: SuspendedRun): Promise<void> {
    const now = new Date().toISOString();
    const row = this.serialize(run);
    // Upsert: a re-suspend (the run paused again at a downstream node) updates
    // the existing row rather than inserting a duplicate.
    const existing = await this.engine.find(TABLE, {
      where: { id: run.runId }, limit: 1, context: SYSTEM_CTX,
    });
    if (Array.isArray(existing) && existing[0]) {
      await this.engine.update(
        TABLE,
        { ...row, updated_at: now },
        { where: { id: run.runId }, context: SYSTEM_CTX },
      );
    } else {
      await this.engine.insert(
        TABLE,
        { ...row, created_at: now, updated_at: now },
        { context: SYSTEM_CTX },
      );
    }
  }

  async load(runId: string): Promise<SuspendedRun | null> {
    const rows = await this.engine.find(TABLE, {
      where: { id: runId }, limit: 1, context: SYSTEM_CTX,
    });
    const row = Array.isArray(rows) ? rows[0] : null;
    return row ? this.deserialize(row) : null;
  }

  async delete(runId: string): Promise<void> {
    if (typeof this.engine.delete !== 'function') {
      this.logger?.warn?.(
        `[automation] ObjectStoreSuspendedRunStore: engine has no delete(); suspended run '${runId}' row not removed`,
      );
      return;
    }
    await this.engine.delete(TABLE, { where: { id: runId }, context: SYSTEM_CTX });
  }

  async list(): Promise<SuspendedRun[]> {
    const rows = await this.engine.find(TABLE, {
      where: { status: 'paused' }, limit: 1000, context: SYSTEM_CTX,
    });
    return (Array.isArray(rows) ? rows : []).map(r => this.deserialize(r));
  }

  /**
   * Persist a TERMINAL run (completed / failed) as durable history. Keyed by a
   * `run_`-prefixed id so it NEVER collides with a live suspended run's row
   * (id = raw `runId`, status `paused`) — the suspend save/load/delete/list
   * path (which only touches raw ids and `status:'paused'` rows) is untouched.
   * Upsert so a re-emitted terminal (e.g. a resumed run) updates in place.
   */
  async recordTerminal(record: RunRecord): Promise<void> {
    const now = new Date().toISOString();
    const id = HISTORY_PREFIX + record.runId;
    const row = {
      id,
      organization_id: record.organizationId ?? null,
      flow_name: record.flowName,
      flow_version: record.flowVersion ?? null,
      node_id: record.nodeId ?? null,
      status: record.status,
      user_id: record.userId ?? null,
      started_at: record.startedAt,
      start_time: record.startTime ?? null,
      finished_at: record.finishedAt ?? now,
      duration_ms: record.durationMs ?? null,
      error: record.error ?? null,
      steps_json: serializeStepsBounded(record.steps),
    };
    const existing = await this.engine.find(TABLE, {
      where: { id }, limit: 1, context: SYSTEM_CTX,
    });
    if (Array.isArray(existing) && existing[0]) {
      await this.engine.update(TABLE, { ...row, updated_at: now }, { where: { id }, context: SYSTEM_CTX });
    } else {
      await this.engine.insert(TABLE, { ...row, created_at: now, updated_at: now }, { context: SYSTEM_CTX });
      // Write-time retention (#2585): keep only the newest N terminal rows per
      // flow. Best-effort — a prune failure never fails the history write.
      try {
        await this.pruneFlowOverflow(record.flowName);
      } catch (err) {
        this.logger?.warn?.(
          `[automation] run-history overflow prune failed for '${record.flowName}': ${(err as Error)?.message}`,
        );
      }
    }
  }

  /**
   * Enforce the per-flow terminal-history cap: fetch the flow's rows, keep the
   * newest {@link ObjectStoreSuspendedRunStoreOptions.maxTerminalRunsPerFlow}
   * terminal ones, delete the overflow (bounded per call by
   * {@link OVERFLOW_PRUNE_BATCH}). Paused rows are live resumable state and are
   * never touched. Steady state deletes at most one row per terminal write.
   */
  private async pruneFlowOverflow(flowName: string): Promise<void> {
    const max = this.maxTerminalRunsPerFlow;
    if (!(max > 0) || typeof this.engine.delete !== 'function') return;
    const rows = await this.engine.find(TABLE, {
      where: { flow_name: flowName },
      limit: max * 2 + OVERFLOW_PRUNE_BATCH,
      context: SYSTEM_CTX,
    });
    const overflow = (Array.isArray(rows) ? rows : [])
      .filter((r) => isTerminalStatus(r?.status))
      .sort((a, b) => String(b.started_at ?? '').localeCompare(String(a.started_at ?? '')))
      .slice(max, max + OVERFLOW_PRUNE_BATCH);
    for (const row of overflow) {
      await this.engine.delete(TABLE, { where: { id: row.id }, context: SYSTEM_CTX });
    }
    if (overflow.length > 0) {
      this.logger?.debug?.(
        `[automation] run-history cap: pruned ${overflow.length} terminal run(s) of '${flowName}' beyond newest ${max}`,
      );
    }
  }

  /**
   * Age-based retention sweep (#2585, ADR-0057 posture): delete terminal
   * history rows older than `retentionDays`. Two equality-filtered bulk
   * deletes (one per terminal status) so `paused` rows — live resumable state —
   * can never match. Returns the number of rows deleted when the driver
   * reports it. No-op for a non-positive window or a delete-less engine.
   */
  async pruneHistory(retentionDays: number, now: number = Date.now()): Promise<number | undefined> {
    if (!(retentionDays > 0) || typeof this.engine.delete !== 'function') return 0;
    const cutoffIso = new Date(now - retentionDays * 86_400_000).toISOString();
    let total: number | undefined = 0;
    for (const status of TERMINAL_STATUSES) {
      // ISO-8601 comparand: `created_at` is a native timestamp column, which
      // rejects a bare epoch-ms number on Postgres (see service-messaging's
      // NotificationRetention for the prior art this mirrors).
      const res = await this.engine.delete(TABLE, {
        where: { status, created_at: { $lt: cutoffIso } },
        multi: true,
        context: SYSTEM_CTX,
      });
      const n = countDeleted(res);
      total = n === undefined || total === undefined ? undefined : total + n;
    }
    return total;
  }

  /** Load one terminal history row by raw `runId` (durable `getRun` fallback). */
  async loadTerminal(runId: string): Promise<RunRecord | null> {
    const rows = await this.engine.find(TABLE, {
      where: { id: HISTORY_PREFIX + runId }, limit: 1, context: SYSTEM_CTX,
    });
    const row = Array.isArray(rows) ? rows[0] : null;
    if (!row || !isTerminalStatus(row.status)) return null;
    return this.deserializeTerminal(row);
  }

  /** Newest terminal (`completed` / `failed`) run-history rows for one flow. */
  async listHistory(flowName: string, limit: number): Promise<RunRecord[]> {
    // Fetch the flow's rows and filter terminal in memory — avoids depending on
    // IN-clause support in the driver's `where`. Paused rows are excluded.
    const rows = await this.engine.find(TABLE, {
      where: { flow_name: flowName }, limit: Math.max(limit * 4, 200), context: SYSTEM_CTX,
    });
    return (Array.isArray(rows) ? rows : [])
      .filter(r => r?.status === 'completed' || r?.status === 'failed')
      .map(r => this.deserializeTerminal(r))
      .sort((a, b) => (b.startedAt ?? '').localeCompare(a.startedAt ?? ''))
      .slice(0, limit);
  }

  /** Rebuild a {@link RunRecord} from a terminal `sys_automation_run` row. */
  private deserializeTerminal(row: any): RunRecord {
    const rawId = String(row.id ?? '');
    return {
      runId: rawId.startsWith(HISTORY_PREFIX) ? rawId.slice(HISTORY_PREFIX.length) : rawId,
      flowName: String(row.flow_name ?? ''),
      flowVersion: typeof row.flow_version === 'number' ? row.flow_version : undefined,
      status: row.status === 'failed' ? 'failed' : 'completed',
      startedAt: row.started_at ?? row.created_at ?? '',
      startTime: typeof row.start_time === 'number' ? row.start_time : undefined,
      finishedAt: row.finished_at ?? undefined,
      durationMs: typeof row.duration_ms === 'number' ? row.duration_ms : undefined,
      error: row.error ?? undefined,
      nodeId: row.node_id ?? undefined,
      organizationId: row.organization_id ?? null,
      userId: row.user_id ?? undefined,
      steps: parseJson<RunRecord['steps']>(row.steps_json, undefined),
    };
  }

  /** Flatten a run into a `sys_automation_run` row (state columns JSON-encoded). */
  private serialize(run: SuspendedRun): Record<string, unknown> {
    const ctx = (run.context ?? {}) as Record<string, unknown>;
    const org = ctx.organizationId ?? ctx.tenantId ?? null;
    return {
      id: run.runId,
      organization_id: org,
      flow_name: run.flowName,
      flow_version: run.flowVersion ?? null,
      node_id: run.nodeId,
      status: 'paused',
      correlation: run.correlation ?? null,
      user_id: ctx.userId ?? null,
      variables_json: JSON.stringify(run.variables ?? {}),
      steps_json: JSON.stringify(run.steps ?? []),
      context_json: JSON.stringify(run.context ?? {}),
      screen_json: run.screen ? JSON.stringify(run.screen) : null,
      started_at: run.startedAt,
      start_time: run.startTime ?? null,
    };
  }

  /** Rebuild a run from a `sys_automation_run` row. */
  private deserialize(row: any): SuspendedRun {
    const startedAt = row.started_at ?? new Date().toISOString();
    return {
      runId: String(row.id),
      flowName: String(row.flow_name ?? ''),
      flowVersion: row.flow_version ?? undefined,
      nodeId: String(row.node_id ?? ''),
      variables: parseJson<Record<string, unknown>>(row.variables_json, {}),
      steps: parseJson<SuspendedRun['steps']>(row.steps_json, []),
      context: parseJson<SuspendedRun['context']>(row.context_json, {}),
      startedAt,
      startTime: typeof row.start_time === 'number' ? row.start_time : (Date.parse(startedAt) || Date.now()),
      correlation: row.correlation ?? undefined,
      screen: parseJson<SuspendedRun['screen']>(row.screen_json, undefined as any),
    };
  }
}

/**
 * JSON-encode a terminal run's step log under the {@link MAX_STEPS_JSON_BYTES}
 * cap. The engine already bounds step COUNT (and strips stacks); this bounds
 * BYTES — a few huge step errors can still blow up a row. When over, the step
 * tail is halved until it fits (the newest steps carry the failure); an empty
 * result stores `null`.
 */
function serializeStepsBounded(steps: RunRecord['steps']): string | null {
  let tail = steps ?? [];
  while (tail.length > 0) {
    const json = JSON.stringify(tail);
    if (json.length <= MAX_STEPS_JSON_BYTES) return json;
    tail = tail.slice(Math.ceil(tail.length / 2));
  }
  return null;
}

/** Best-effort row-count extraction from a driver's delete result (mirrors
 *  service-messaging's retention sweeper). */
function countDeleted(res: unknown): number | undefined {
  if (typeof res === 'number') return res;
  if (Array.isArray(res)) return res.length;
  if (res && typeof res === 'object') {
    const r = res as Record<string, unknown>;
    for (const k of ['deletedCount', 'deleted', 'count', 'affected', 'affectedRows']) {
      if (typeof r[k] === 'number') return r[k] as number;
    }
  }
  return undefined;
}
