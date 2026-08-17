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
const SYSTEM_CTX = { isSystem: true, positions: [], permissions: [] } as const;

/**
 * Default per-flow cap on terminal run-history rows (#2585). A busy
 * per-record-change flow otherwise persists one row per execution forever —
 * exactly the unbounded self-telemetry growth ADR-0057 exists to prevent.
 * 100 newest terminal runs per flow keeps the Runs surface useful while
 * bounding the table. `0` disables the cap.
 *
 * This write-time COUNT bound is the only retention this store enforces.
 * AGE retention is declarative (#2834): `sys_automation_run` declares
 * `retention: { maxAge, onlyWhen: { status: { $in: [...] } } }` and the
 * platform Reaper sweeps it — suspended (`paused`) rows are live resumable
 * state and never match the predicate.
 */
export const DEFAULT_MAX_TERMINAL_RUNS_PER_FLOW = 100;

/** Max deletes one write-time overflow prune may issue — bounds the write
 *  amplification a single `recordTerminal` can incur on a legacy oversized
 *  table (the periodic age sweep handles bulk convergence). */
const OVERFLOW_PRUNE_BATCH = 50;

/** Byte cap for a terminal row's persisted `steps_json`. When over, the step
 *  tail is halved until it fits — the newest steps carry the failure. */
const MAX_STEPS_JSON_BYTES = 64 * 1024;

/** Byte cap for a terminal row's persisted `summary_json` (#4354). Generous
 *  relative to the shape it holds — one entry per node that ran, one per gate
 *  that closed — so only a pathological flow ever trips it. */
const MAX_SUMMARY_JSON_BYTES = 16 * 1024;

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

  /**
   * Read the backing table once so a misconfiguration surfaces at BOOT rather
   * than as a per-suspend write failure nobody reads. Throws the driver error
   * verbatim — `no such table: sys_automation_run` means the object was never
   * registered (or its schema never synced), which is #4420: a durable store
   * that silently persists nothing and zombifies every pause on restart.
   */
  async probe(): Promise<void> {
    await this.engine.find(TABLE, { where: {}, limit: 1, context: SYSTEM_CTX });
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
      // #7533 — trigger attribution. Terminal rows never carried any: the
      // in-memory run knew its kind and this mapping dropped it, so a restart
      // turned every history row into "a run happened" with no "why".
      trigger_type: record.triggerType ?? null,
      trigger_object: record.triggerObject ?? null,
      trigger_record_id: record.triggerRecordId ?? null,
      started_at: record.startedAt,
      start_time: record.startTime ?? null,
      finished_at: record.finishedAt ?? now,
      duration_ms: record.durationMs ?? null,
      error: record.error ?? null,
      steps_json: serializeStepsBounded(record.steps),
      // #4354 — the totals land in COLUMNS so an operator can alert on
      // `selected_count > 0 AND acted_count = 0`; the per-node / per-gate detail
      // rides in the JSON blob. Null (not 0) when the engine computed no
      // summary: "not measured" and "measured zero" are different answers, and
      // only one of them should trip an alarm.
      selected_count: record.summary?.selected ?? null,
      acted_count: record.summary?.acted ?? null,
      skipped_count: record.summary?.skipped ?? null,
      unmeasured_count: record.summary?.unmeasured ?? null,
      summary_json: record.summary ? serializeSummaryBounded(record.summary) : null,
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
      // #7533 — read the trigger columns back. `?? undefined` (not `?? ''`):
      // a pre-#7533 row genuinely has no recorded trigger, and the engine's
      // `runRecordToLogEntry` is the single place that decides how an absent
      // one renders.
      triggerType: row.trigger_type ?? undefined,
      triggerObject: row.trigger_object ?? undefined,
      triggerRecordId: row.trigger_record_id ?? undefined,
      steps: parseJson<RunRecord['steps']>(row.steps_json, undefined),
      // #4354 — rehydrate from `summary_json`, never re-fold `steps_json`: those
      // steps are compacted (200 max), so recomputing would report a
      // 5000-iteration sweep as having acted a couple of hundred times.
      summary: parseJson<RunRecord['summary']>(row.summary_json, undefined),
    };
  }

  /** Flatten a run into a `sys_automation_run` row (state columns JSON-encoded). */
  private serialize(run: SuspendedRun): Record<string, unknown> {
    const ctx = (run.context ?? {}) as Record<string, unknown>;
    // [cloud#1395] `tenantId` is the ONLY spelling — it is the field
    // `AutomationContext` declares for the triggering identity's organization,
    // and the only one any producer writes: `RecordChangeTrigger.buildContext`
    // maps the hook session's `organizationId` onto it, and the runtime's
    // automation domain sets it directly. A `ctx.organizationId` limb used to
    // sit ahead of this read with ZERO producers behind it (PD #12 — the
    // consumer-side alias that fossilizes a second de-facto contract), and it
    // was not harmless: the ONE test asserting this column fed the phantom key,
    // so the only coverage `organization_id` had proved the dead limb worked
    // and said nothing about the live one. Removed rather than kept "for
    // safety"; a producer that wants this row attributed sets the declared
    // `tenantId`.
    //
    // ⚠️ MEASURED, and NOT fixed by the line above (cloud#1395): this resolves
    // to null on every trigger path that carries no acting tenant — the
    // schedule, time-relative and api triggers set none at all, by
    // construction, because a scheduled run has no one organization. Those runs
    // persist `organization_id = NULL` while describing a record that DOES
    // belong to a customer. `sys_audit_log` does not have this defect on the
    // same boot because its writer resolves the organization from the RECORD it
    // describes (plugin-audit `resolveRecordOrganizationField`, #8707 honouring
    // #8287's ruling) and falls back to the session only when the record has
    // none. ⛔ Do not read that asymmetry as "platform tables carry no org" —
    // it is two writers reading the acting context where a third reads the
    // subject. Which column a side-table row should take its organization from
    // is the open contract question on cloud#1395.
    const org = ctx.tenantId ?? null;
    // #7533 — the same three trigger columns the terminal path writes. A paused
    // row is a `sys_automation_run` row too, and leaving them null here would
    // make "which runs did this record provoke?" answer for finished runs while
    // silently omitting the ones still in flight — the worst shape for that
    // query, because a partial answer reads as a complete one. `context_json`
    // does carry this for paused rows, but a JSON blob is not a filter.
    const rawRecordId = (ctx.record as Record<string, unknown> | undefined)?.id;
    return {
      id: run.runId,
      organization_id: org,
      flow_name: run.flowName,
      flow_version: run.flowVersion ?? null,
      node_id: run.nodeId,
      // Node TYPE, not just id — the resume gate (#3801) keys on what produced
      // the pause, and it has to survive the restart the pause itself survives.
      node_type: run.nodeType ?? null,
      status: 'paused',
      correlation: run.correlation ?? null,
      user_id: ctx.userId ?? null,
      trigger_type: ctx.event ?? null,
      trigger_object: ctx.object ?? null,
      trigger_record_id:
        typeof rawRecordId === 'string'
          ? rawRecordId || null
          : typeof rawRecordId === 'number'
            ? String(rawRecordId)
            : null,
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
      nodeType: row.node_type ?? undefined,
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

/**
 * JSON-encode a run summary under {@link MAX_SUMMARY_JSON_BYTES} (#4354).
 *
 * The detail arrays are bounded by the flow's STATIC shape — one entry per node
 * that ran, one per gate that closed — not by iteration count, so a 5000-row
 * sweep over a 6-node flow serializes six entries. A pathological flow with
 * thousands of nodes is the only way over the cap; there the detail is dropped
 * and the TOTALS are kept, because the totals are what the broken-sweep alert
 * queries and losing them to a size limit would be the one unacceptable outcome.
 * The dropped detail stays visible as `detailOmitted`, never silently absent.
 */
function serializeSummaryBounded(summary: NonNullable<RunRecord['summary']>): string {
  const json = JSON.stringify(summary);
  if (json.length <= MAX_SUMMARY_JSON_BYTES) return json;
  return JSON.stringify({
    selected: summary.selected,
    acted: summary.acted,
    skipped: summary.skipped,
    unmeasured: summary.unmeasured,
    nodes: [],
    gates: [],
    detailOmitted: true,
  });
}
