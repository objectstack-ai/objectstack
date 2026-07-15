// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import type { Lifecycle } from '@objectstack/spec/data';
import { parseLifecycleDuration } from './duration.js';

/**
 * LifecycleService — the single platform-owned enforcer of ADR-0057
 * `lifecycle` declarations. Scans every registered object carrying a
 * `lifecycle` block and applies its policy:
 *
 *   - **Reaper** (P1): batch-deletes rows past `retention.maxAge` (by
 *     `created_at`) or past `ttl.field + ttl.expireAfter`, then asks each
 *     touched driver to reclaim free space (SQLite `incremental_vacuum`).
 *   - **Rotator** (P2): time-shards high-frequency telemetry and DROPs the
 *     oldest shard. Until a driver advertises rotation support, declared
 *     rotation falls back to an age-based reap bounded by `shards × unit`.
 *   - **Archiver** (P3): copies audit-class cold rows to the declared archive
 *     datasource, then deletes them from the hot store. **Safety rule:** an
 *     object that declares `archive` is never hot-deleted unless the archive
 *     copy succeeded — a compliance ledger must not be dropped unarchived.
 *
 * Design constraints (ADR-0057 §3.3):
 *   - One implementation, owned here — not N per-plugin sweepers.
 *   - Sweeps run under a system context (cross-tenant operator policy) and
 *     use bulk `multi: true` deletes, so at most ONE afterDelete hook fires
 *     per object per sweep — audit sees an aggregate, never per-row noise
 *     (telemetry-class sys_* objects are additionally in the audit writer's
 *     SKIP_OBJECTS, so they produce no audit rows at all).
 *   - A sweep failure is logged and isolated; it never throws into the
 *     scheduler and never blocks other objects' policies.
 */

/** Cross-tenant operator context — lifecycle is a system policy, not a user
 * action (mirrors the existing retention sweepers). */
const SYSTEM_CTX: LifecycleSweepContext = { isSystem: true, positions: [], permissions: [] };

export interface LifecycleSweepContext {
  isSystem: boolean;
  positions: string[];
  permissions: string[];
}

/** Width of one rotation shard. Months are the operational 30d, matching the
 * coarse-bound posture of {@link parseLifecycleDuration}. */
const SHARD_UNIT_MS: Record<'day' | 'week' | 'month', number> = {
  day: 86_400_000,
  week: 7 * 86_400_000,
  month: 30 * 86_400_000,
};

/** Default cadence between sweeps. Lifecycle windows are hours-to-years, so
 * hourly enforcement is ample and keeps the sweep invisible in profiles. */
export const DEFAULT_LIFECYCLE_SWEEP_MS = 3_600_000;

/** Delay before the first sweep after boot — lets seeding/migrations finish
 * and keeps short-lived test kernels from ever sweeping. */
export const DEFAULT_LIFECYCLE_INITIAL_DELAY_MS = 60_000;

/** Minimal engine surface the service needs — duck-typed for tests. */
export interface LifecycleEngineLike {
  registry: { getAllObjects(): LifecycleObjectLike[] };
  delete(
    object: string,
    options: { where: Record<string, unknown>; multi: true; context: LifecycleSweepContext },
  ): Promise<unknown>;
  getDriverForObject(objectName: string): unknown;
  /** Datasource lookup by name; throws/absent when not registered. */
  datasource?(name: string): unknown;
  /** Row reads for governance (tenant enumeration); optional. */
  find?(object: string, options: Record<string, unknown>): Promise<Array<Record<string, unknown>>>;
}

export interface LifecycleObjectLike {
  name: string;
  lifecycle?: Lifecycle;
  fields?: Record<string, unknown>;
}

export interface LifecycleLoggerLike {
  info(msg: string, meta?: unknown): void;
  warn(msg: string, meta?: unknown): void;
  debug?(msg: string, meta?: unknown): void;
}

/** Duck-typed SettingsService surface (avoids a package dependency). */
export interface LifecycleSettingsLike {
  get(
    namespace: string,
    key: string,
    ctx?: Record<string, unknown>,
  ): Promise<{ value: unknown; source?: string }>;
}

/** Governance alert (ADR-0057 P4) — quotas/growth never delete data beyond
 * the declared policy; they alert so an operator decides. */
export interface LifecycleGovernanceAlert {
  type: 'quota-exceeded' | 'growth';
  object: string;
  rowCount: number;
  quota?: number;
  delta?: number;
}

export interface LifecycleServiceOptions {
  /** Resolve the data engine; `undefined` ⇒ sweep is a no-op. */
  getEngine(): LifecycleEngineLike | undefined;
  logger: LifecycleLoggerLike;
  /** Master switch. Defaults to true; `OS_LIFECYCLE_DISABLED=1` also wins. */
  enabled?: boolean;
  /** Cadence between sweeps. Default {@link DEFAULT_LIFECYCLE_SWEEP_MS}. */
  sweepIntervalMs?: number;
  /** Delay before the first sweep. Default {@link DEFAULT_LIFECYCLE_INITIAL_DELAY_MS}. */
  initialDelayMs?: number;
  /** Clock injection for deterministic tests. Defaults to `Date.now()`. */
  now?(): number;
  /** Resolve the settings service for governance (P4); absent ⇒ declared
   * policies apply unmodified and quotas/alerts are off. */
  getSettings?(): LifecycleSettingsLike | undefined;
  /** Governance alert sink. Defaults to a logger warning. */
  onAlert?(alert: LifecycleGovernanceAlert): void;
}

/** Per-sweep governance snapshot resolved from the `lifecycle` namespace. */
interface GovernanceSnapshot {
  enabled: boolean;
  /** Global-resolved per-object window overrides. */
  overrides: Record<string, { maxAge?: string; expireAfter?: string }>;
  /** object → tenant-specific windows (only tenants whose override is
   * genuinely tenant-scoped, not inherited). */
  tenantOverrides: Map<string, Array<{ tenantId: string; maxAge?: string; expireAfter?: string }>>;
  quotas: Record<string, number>;
  quotaDefaults: Record<string, number>;
  growthAlertRows: number;
}

const DEFAULT_GOVERNANCE: GovernanceSnapshot = {
  enabled: true,
  overrides: {},
  tenantOverrides: new Map(),
  quotas: {},
  quotaDefaults: {},
  growthAlertRows: 0,
};

/** Cap on tenants scanned for per-tenant overrides each sweep. */
const TENANT_SCAN_LIMIT = 200;

export interface LifecycleSweepEntry {
  object: string;
  class: string;
  policy: 'ttl' | 'retention' | 'rotation' | 'rotation-fallback' | 'archive';
  cutoff: string;
  /** `undefined` when the driver doesn't report a count. */
  deleted?: number;
  /** Rotation only: expired shard tables DROPped this sweep (O(1) reclaim). */
  droppedShards?: number;
  /** Archive only: rows copied to the cold store (then hot-deleted). */
  archived?: number;
}

export interface LifecycleSweepReport {
  at: string;
  /** Policies applied, one entry per (object, policy). */
  swept: LifecycleSweepEntry[];
  /** Objects intentionally not swept, with the reason. */
  skipped: Array<{ object: string; reason: string }>;
  /** Isolated per-object failures — the sweep itself never throws. */
  errors: Array<{ object: string; error: string }>;
  /** Datasources whose driver reclaimed space after this sweep. */
  reclaimed: string[];
  /** Governance alerts raised this sweep (quota breaches, growth spikes). */
  alerts: LifecycleGovernanceAlert[];
}

interface ReclaimCapableDriver {
  name?: string;
  reclaimSpace?(): Promise<void>;
}

interface RotationCapableDriver extends ReclaimCapableDriver {
  supportsRotation?: boolean;
  rotateShards?(
    objectDef: LifecycleObjectLike,
    nowMs?: number,
  ): Promise<{ object: string; current: string; shards: string[]; dropped: string[] }>;
}

/** Driver surface the Archiver uses on both the hot and the cold store. */
interface ArchiveCapableDriver {
  name?: string;
  find(object: string, query: Record<string, unknown>, options?: unknown): Promise<Array<Record<string, unknown>>>;
  upsert(object: string, data: Record<string, unknown>, conflictKeys?: string[], options?: unknown): Promise<unknown>;
  bulkDelete(object: string, ids: Array<string | number>, options?: unknown): Promise<void>;
  deleteMany?(object: string, query: Record<string, unknown>, options?: unknown): Promise<number>;
  syncSchema?(object: string, schema: unknown, options?: unknown): Promise<void>;
}

/** Max rows the Archiver moves per object per sweep — bounds sweep latency;
 * the backlog drains across consecutive sweeps. */
const ARCHIVE_BATCH_SIZE = 500;
const ARCHIVE_MAX_BATCHES_PER_SWEEP = 20;

/** Guarded reap batching — same posture as the Archiver: bound one sweep's
 * work, drain the backlog across sweeps. */
const REAP_GUARD_BATCH_SIZE = 500;
const REAP_GUARD_MAX_BATCHES_PER_SWEEP = 20;

/**
 * Reap guard (ADR-0057 amendment): a domain callback consulted by the Reaper
 * before rows of the guarded object are deleted. The guard receives the
 * candidate rows and returns the ids it CONFIRMS for deletion — performing
 * any external cleanup (e.g. storage-byte reclaim) for those ids before
 * returning. Ids not returned are kept this sweep (vetoed — e.g. the row
 * regained references since it was marked).
 *
 * Guards are registered at runtime (`registerReapGuard`), not declared in the
 * spec: detection and scheduling stay inside the single platform sweep
 * (ADR-0057 §3.3 — a guard is a domain callback, not a second sweeper).
 */
export type LifecycleReapGuard = (
  object: string,
  rows: Array<Record<string, unknown>>,
) => Promise<Array<string | number>>;

export class LifecycleService {
  private readonly now: () => number;
  private timer: ReturnType<typeof setInterval> | undefined;
  private initialTimer: ReturnType<typeof setTimeout> | undefined;
  private sweeping = false;
  /** Row counts from the previous sweep — baseline for growth alerts. */
  private lastCounts = new Map<string, number>();
  /** Governance snapshot for the sweep in flight. */
  private governance: GovernanceSnapshot = DEFAULT_GOVERNANCE;
  /** Per-object reap guards ({@link LifecycleReapGuard}). */
  private readonly reapGuards = new Map<string, LifecycleReapGuard>();

  constructor(private readonly opts: LifecycleServiceOptions) {
    this.now = opts.now ?? (() => Date.now());
  }

  get enabled(): boolean {
    if (process.env.OS_LIFECYCLE_DISABLED === '1') return false;
    return this.opts.enabled !== false;
  }

  /** Arm the periodic sweep. Idempotent; timers are unref'ed so a kernel
   * shutdown is never held open by the lifecycle schedule. */
  start(): void {
    if (!this.enabled || this.timer || this.initialTimer) return;
    const interval = this.opts.sweepIntervalMs ?? DEFAULT_LIFECYCLE_SWEEP_MS;
    const initial = this.opts.initialDelayMs ?? DEFAULT_LIFECYCLE_INITIAL_DELAY_MS;
    this.initialTimer = setTimeout(() => {
      this.initialTimer = undefined;
      void this.sweep();
      this.timer = setInterval(() => void this.sweep(), interval);
      this.timer.unref?.();
    }, initial);
    this.initialTimer.unref?.();
  }

  stop(): void {
    if (this.initialTimer) clearTimeout(this.initialTimer);
    if (this.timer) clearInterval(this.timer);
    this.initialTimer = undefined;
    this.timer = undefined;
  }

  /**
   * Register a {@link LifecycleReapGuard} for one object. From then on the
   * Reaper never blind-deletes that object's rows: candidates are fetched,
   * the guard confirms (after external cleanup) or vetoes each row, and only
   * confirmed ids are deleted. One guard per object (last registration wins —
   * guards are platform wiring, not user surface).
   */
  registerReapGuard(object: string, guard: LifecycleReapGuard): void {
    this.reapGuards.set(object, guard);
  }

  /**
   * Apply every declared lifecycle policy once. Safe to call directly (the
   * dogfood growth gate and `db:clean`-style tooling do); re-entrant calls
   * while a sweep is running resolve to an empty report.
   */
  async sweep(): Promise<LifecycleSweepReport> {
    const report: LifecycleSweepReport = {
      at: new Date(this.now()).toISOString(),
      swept: [],
      skipped: [],
      errors: [],
      reclaimed: [],
      alerts: [],
    };
    if (this.sweeping || !this.enabled) return report;
    const engine = this.opts.getEngine();
    if (!engine || typeof engine.delete !== 'function' || !engine.registry) {
      this.opts.logger.debug?.('[lifecycle] no data engine available; sweep skipped');
      return report;
    }

    this.sweeping = true;
    try {
      const declared = engine.registry
        .getAllObjects()
        .filter((o) => o?.lifecycle && o.lifecycle.class !== 'record');

      // Governance snapshot (P4): settings-driven overrides / quotas.
      this.governance = await this.loadGovernance(engine, declared);
      if (!this.governance.enabled) {
        this.opts.logger.debug?.('[lifecycle] disabled via settings; sweep skipped');
        return report;
      }

      // Drivers that should reclaim space after this sweep (deduped by
      // instance — several objects usually share one datasource).
      const reclaimable = new Set<ReclaimCapableDriver>();

      for (const obj of declared) {
        const lc = obj.lifecycle as Lifecycle;
        try {
          const outcomes = await this.reapObject(engine, obj, lc, report);
          const deletedSomething = outcomes.some((n) => n === undefined || n > 0);
          if (deletedSomething && lc.reclaim !== false) {
            const driver = engine.getDriverForObject(obj.name) as ReclaimCapableDriver | undefined;
            if (driver && typeof driver.reclaimSpace === 'function') reclaimable.add(driver);
          }
        } catch (err) {
          const msg = (err as Error)?.message ?? String(err);
          report.errors.push({ object: obj.name, error: msg });
          this.opts.logger.warn(`[lifecycle] sweep of ${obj.name} failed (${msg})`);
        }
      }

      for (const driver of reclaimable) {
        try {
          await driver.reclaimSpace!();
          report.reclaimed.push(driver.name ?? 'default');
        } catch (err) {
          this.opts.logger.warn(
            `[lifecycle] space reclaim on datasource '${driver.name ?? 'default'}' failed (${(err as Error)?.message ?? err})`,
          );
        }
      }

      // Governance (P4): quotas + growth alerts — observe-and-alert only,
      // never a delete beyond the declared policy.
      await this.checkGovernance(engine, declared, report);

      if (report.swept.length > 0 || report.errors.length > 0 || report.alerts.length > 0) {
        // ADR-0057 §3.3: cleanup must not re-feed the tables it drains — one
        // aggregate log line per sweep is the entire trace it leaves.
        const total = report.swept.reduce((sum, e) => sum + (e.deleted ?? 0), 0);
        this.opts.logger.info(
          `[lifecycle] sweep: ${report.swept.length} policy(ies) applied, ~${total} rows reaped, ` +
            `${report.reclaimed.length} datasource(s) reclaimed, ${report.errors.length} error(s), ` +
            `${report.alerts.length} alert(s)`,
        );
      }
      return report;
    } finally {
      this.sweeping = false;
    }
  }

  /** Resolve the `lifecycle` settings namespace into a per-sweep snapshot.
   * Every read is best-effort: no settings service / unregistered namespace
   * ⇒ declared policies apply unmodified. */
  private async loadGovernance(
    engine: LifecycleEngineLike,
    declared: LifecycleObjectLike[],
  ): Promise<GovernanceSnapshot> {
    const settings = this.opts.getSettings?.();
    if (!settings || typeof settings.get !== 'function') return DEFAULT_GOVERNANCE;

    const read = async <T>(key: string, fallback: T, ctx?: Record<string, unknown>): Promise<{ value: T; source?: string }> => {
      try {
        const r = await settings.get('lifecycle', key, ctx);
        return { value: (r?.value ?? fallback) as T, source: r?.source };
      } catch {
        return { value: fallback };
      }
    };

    const snapshot: GovernanceSnapshot = {
      enabled: (await read<boolean>('enabled', true)).value !== false,
      overrides: (await read<Record<string, { maxAge?: string; expireAfter?: string }>>('retention_overrides', {})).value ?? {},
      tenantOverrides: new Map(),
      quotas: (await read<Record<string, number>>('quotas', {})).value ?? {},
      quotaDefaults: (await read<Record<string, number>>('quota_defaults', {})).value ?? {},
      growthAlertRows: Number((await read<number>('growth_alert_rows', 0)).value) || 0,
    };

    // Tenant-level windows (ADR-0057 §3.2): only overrides genuinely stored
    // at TENANT scope count — inherited global values would otherwise turn
    // every tenant into a "tenant override" and break the global pass.
    if (typeof engine.find === 'function' && declared.length > 0) {
      try {
        const orgs = await engine.find('sys_organization', {
          limit: TENANT_SCAN_LIMIT,
          context: { ...SYSTEM_CTX },
        });
        for (const org of orgs ?? []) {
          const tenantId = org?.id as string | undefined;
          if (!tenantId) continue;
          const r = await read<Record<string, { maxAge?: string; expireAfter?: string }>>(
            'retention_overrides',
            {},
            { tenantId },
          );
          if (r.source !== 'tenant') continue;
          for (const [objectName, windows] of Object.entries(r.value ?? {})) {
            if (!windows || typeof windows !== 'object') continue;
            const list = snapshot.tenantOverrides.get(objectName) ?? [];
            list.push({ tenantId, maxAge: windows.maxAge, expireAfter: windows.expireAfter });
            snapshot.tenantOverrides.set(objectName, list);
          }
        }
      } catch {
        // No sys_organization (single-tenant kernel) — tenant overrides n/a.
      }
    }

    return snapshot;
  }

  /** Quota + growth checks (P4). Alerts only — an operator decides. */
  private async checkGovernance(
    engine: LifecycleEngineLike,
    declared: LifecycleObjectLike[],
    report: LifecycleSweepReport,
  ): Promise<void> {
    const gov = this.governance;
    const nextCounts = new Map<string, number>();
    for (const obj of declared) {
      const driver = engine.getDriverForObject(obj.name) as
        | { count?(object: string, query?: Record<string, unknown>): Promise<number> }
        | undefined;
      if (!driver || typeof driver.count !== 'function') continue;
      let rowCount: number;
      try {
        rowCount = await driver.count(obj.name, { object: obj.name });
      } catch {
        continue;
      }
      nextCounts.set(obj.name, rowCount);

      const quota = gov.quotas[obj.name] ?? gov.quotaDefaults[obj.lifecycle!.class];
      if (typeof quota === 'number' && quota > 0 && rowCount > quota) {
        this.alert(report, { type: 'quota-exceeded', object: obj.name, rowCount, quota });
      }

      const last = this.lastCounts.get(obj.name);
      if (gov.growthAlertRows > 0 && last !== undefined && rowCount - last > gov.growthAlertRows) {
        this.alert(report, { type: 'growth', object: obj.name, rowCount, delta: rowCount - last });
      }
    }
    this.lastCounts = nextCounts;
  }

  private alert(report: LifecycleSweepReport, alert: LifecycleGovernanceAlert): void {
    report.alerts.push(alert);
    if (this.opts.onAlert) {
      try {
        this.opts.onAlert(alert);
      } catch {
        /* alert sinks must never break the sweep */
      }
    } else {
      this.opts.logger.warn(
        `[lifecycle] governance alert: ${alert.type} on ${alert.object} ` +
          `(rows=${alert.rowCount}${alert.quota != null ? `, quota=${alert.quota}` : ''}${alert.delta != null ? `, delta=+${alert.delta}` : ''})`,
      );
    }
  }

  /** Apply the policies declared on one object (Rotator first, then the
   * Reaper). Returns per-policy outcomes so the caller can decide on
   * reclaim: numbers are deleted-row counts; `undefined` means "work was
   * done but the driver reports no count" (also used for dropped shards). */
  private async reapObject(
    engine: LifecycleEngineLike,
    obj: LifecycleObjectLike,
    lc: Lifecycle,
    report: LifecycleSweepReport,
  ): Promise<Array<number | undefined>> {
    const object = obj.name;

    // Safety rule: declared `archive` means retain → archive → delete. Hot
    // deletion happens ONLY for rows the Archiver has copied to the cold
    // store; when the archive datasource isn't registered, rows are retained
    // (never dropped unarchived) and the object is reported as skipped.
    if (lc.archive) {
      return this.archiveObject(engine, obj, lc, report);
    }

    const outcomes: Array<number | undefined> = [];
    // Governance overrides (P4): a configured window beats the declared one.
    const ov = this.governance.overrides[object] ?? {};

    if (lc.ttl) {
      const windowMs = this.effectiveWindowMs(ov.expireAfter, parseLifecycleDuration(lc.ttl.expireAfter), object);
      outcomes.push(await this.reap(engine, object, lc, 'ttl', lc.ttl.field, windowMs, report));
    }

    // Rotation (P2): physical time-sharding when the driver supports it —
    // the window bound comes from DROPping expired shards (O(1) reclaim).
    // Drivers without rotation fall through to an equivalent age-based reap,
    // so the declared bound holds on every dialect.
    let rotated = false;
    if (lc.storage?.strategy === 'rotation') {
      const driver = engine.getDriverForObject(object) as RotationCapableDriver | undefined;
      if (driver && typeof driver.rotateShards === 'function' && driver.supportsRotation !== false) {
        const windowMs = lc.storage.shards * SHARD_UNIT_MS[lc.storage.unit];
        const res = await driver.rotateShards(obj, this.now());
        report.swept.push({
          object,
          class: lc.class,
          policy: 'rotation',
          cutoff: new Date(this.now() - windowMs).toISOString(),
          droppedShards: res.dropped.length,
        });
        // Dropped shards freed pages — signal the reclaim pass.
        outcomes.push(res.dropped.length > 0 ? undefined : 0);
        rotated = true;
      }
    }

    if (lc.retention) {
      // Runs even when rotation is active: rotation reclaims at SHARD
      // granularity, an explicit retention.maxAge trims to the day inside the
      // live shards — and immediately bounds a legacy table the Rotator just
      // adopted whole into its first shard.
      const windowMs = this.effectiveWindowMs(ov.maxAge, parseLifecycleDuration(lc.retention.maxAge), object);
      outcomes.push(
        await this.reap(engine, object, lc, 'retention', 'created_at', windowMs, report, lc.retention.onlyWhen),
      );
    } else if (lc.storage?.strategy === 'rotation' && !rotated && !lc.ttl) {
      // Rotation declared but the driver can't shard physically: the shard
      // window IS the bound — enforce the same window with an age-based reap
      // so the declaration is never inert.
      const windowMs = this.effectiveWindowMs(ov.maxAge, lc.storage.shards * SHARD_UNIT_MS[lc.storage.unit], object);
      outcomes.push(await this.reap(engine, object, lc, 'rotation-fallback', 'created_at', windowMs, report));
    }

    return outcomes;
  }

  /** A governance override window beats the declared one — unless it fails to
   * parse, in which case the declared window stands (never fail open into
   * "no bound at all"). */
  private effectiveWindowMs(override: string | undefined, declaredMs: number, object: string): number {
    if (!override) return declaredMs;
    try {
      return parseLifecycleDuration(override);
    } catch {
      this.opts.logger.warn(`[lifecycle] invalid override window '${override}' for ${object}; keeping the declared window`);
      return declaredMs;
    }
  }

  /**
   * Archiver (ADR-0057 §3.3 / P3): copy rows past `archive.after` from the
   * hot store to the archive datasource, then delete the copied rows hot.
   * Batched (500 × 20 per sweep) so a large backlog drains across sweeps
   * without one long-locking pass. Copies are per-row idempotent upserts, so
   * a sweep interrupted between copy and hot-delete re-converges. When
   * `archive.keep` is set, cold rows past it are pruned from the archive.
   */
  private async archiveObject(
    engine: LifecycleEngineLike,
    obj: LifecycleObjectLike,
    lc: Lifecycle,
    report: LifecycleSweepReport,
  ): Promise<Array<number | undefined>> {
    const object = obj.name;
    const archive = lc.archive!;

    let cold: ArchiveCapableDriver | undefined;
    try {
      cold = engine.datasource?.(archive.to) as ArchiveCapableDriver | undefined;
    } catch {
      cold = undefined;
    }
    const hot = engine.getDriverForObject(object) as ArchiveCapableDriver | undefined;
    if (!cold || !hot || typeof hot.find !== 'function' || typeof cold.upsert !== 'function') {
      // No archive target ⇒ retain everything. A compliance ledger cannot be
      // destroyed by declaring a lifecycle — this is the safe default state
      // for deployments that never provision cold storage.
      report.skipped.push({ object, reason: 'archive-pending' });
      return [];
    }

    // The cold store mirrors the hot schema (idempotent DDL).
    if (typeof cold.syncSchema === 'function') {
      await cold.syncSchema(object, obj);
    }

    const cutoff = new Date(this.now() - parseLifecycleDuration(archive.after)).toISOString();
    let archived = 0;
    for (let batch = 0; batch < ARCHIVE_MAX_BATCHES_PER_SWEEP; batch++) {
      const rows = await hot.find(object, {
        where: { created_at: { $lt: cutoff } },
        limit: ARCHIVE_BATCH_SIZE,
      });
      if (!rows.length) break;
      for (const row of rows) {
        await cold.upsert(object, row, ['id']);
      }
      await hot.bulkDelete(object, rows.map((r) => r.id as string));
      archived += rows.length;
      if (rows.length < ARCHIVE_BATCH_SIZE) break;
    }

    // Cold-side retention: `keep` bounds the archive itself.
    if (archive.keep && typeof cold.deleteMany === 'function') {
      const keepCutoff = new Date(this.now() - parseLifecycleDuration(archive.keep)).toISOString();
      await cold.deleteMany(object, { where: { created_at: { $lt: keepCutoff } } });
    }

    report.swept.push({ object, class: lc.class, policy: 'archive', cutoff, archived });
    return [archived];
  }

  private async reap(
    engine: LifecycleEngineLike,
    object: string,
    lc: Lifecycle,
    policy: LifecycleSweepEntry['policy'],
    field: string,
    windowMs: number,
    report: LifecycleSweepReport,
    onlyWhen?: Record<string, unknown>,
  ): Promise<number | undefined> {
    const cutoff = new Date(this.now() - windowMs).toISOString();
    const overrideKey = policy === 'ttl' ? 'expireAfter' : 'maxAge';
    const tenantWindows = (this.governance.tenantOverrides.get(object) ?? []).filter(
      (t) => typeof t[overrideKey] === 'string',
    );
    // `retention.onlyWhen` narrows every delete to the declared row filter —
    // rows outside it (live workflow state) are retained regardless of age.
    const scope = onlyWhen ?? {};

    // A guarded object is NEVER blind-deleted: without row reads the guard
    // cannot confirm, so the reap is skipped (fail-safe), not degraded.
    const guard = this.reapGuards.get(object);
    if (guard && typeof engine.find !== 'function') {
      if (!report.skipped.some((s) => s.object === object && s.reason === 'reap-guard-unsupported')) {
        report.skipped.push({ object, reason: 'reap-guard-unsupported' });
      }
      return 0;
    }

    let total: number | undefined = 0;
    const accumulate = (n: number | undefined) => {
      if (n === undefined) total = undefined;
      else if (total !== undefined) total += n;
    };
    const reapWhere = async (where: Record<string, unknown>): Promise<number | undefined> =>
      guard
        ? this.guardedReap(engine, object, guard, where)
        : countDeleted(await engine.delete(object, { where, multi: true, context: { ...SYSTEM_CTX } }));

    if (tenantWindows.length === 0) {
      accumulate(await reapWhere({ [field]: { $lt: cutoff }, ...scope }));
    } else {
      // Tenant-level windows (P4): each overriding tenant gets its own
      // cutoff on its own rows…
      for (const t of tenantWindows) {
        const tMs = this.effectiveWindowMs(t[overrideKey], windowMs, `${object} (tenant ${t.tenantId})`);
        const tCutoff = new Date(this.now() - tMs).toISOString();
        accumulate(await reapWhere({ [field]: { $lt: tCutoff }, organization_id: t.tenantId, ...scope }));
      }
      // …and the global pass covers everyone else, INCLUDING rows with no
      // organization (a bare `$nin` would silently skip NULL-org rows).
      accumulate(
        await reapWhere({
          [field]: { $lt: cutoff },
          $or: [
            { organization_id: { $nin: tenantWindows.map((t) => t.tenantId) } },
            { organization_id: null },
          ],
          ...scope,
        }),
      );
    }

    report.swept.push({ object, class: lc.class, policy, cutoff, deleted: total });
    return total;
  }

  /**
   * Guarded reap: fetch candidate rows in batches, let the guard confirm
   * (after performing external cleanup) or veto each, delete only confirmed
   * ids. A guard error propagates to the per-object handler in `sweep()` —
   * an erroring guard must never fail open into deletion. A batch that isn't
   * fully confirmed ends the pass: vetoed rows still match the cutoff filter
   * and would be re-fetched forever; the next sweep retries them.
   */
  private async guardedReap(
    engine: LifecycleEngineLike,
    object: string,
    guard: LifecycleReapGuard,
    where: Record<string, unknown>,
  ): Promise<number> {
    let total = 0;
    for (let batch = 0; batch < REAP_GUARD_MAX_BATCHES_PER_SWEEP; batch++) {
      const rows = await engine.find!(object, {
        where,
        limit: REAP_GUARD_BATCH_SIZE,
        context: { ...SYSTEM_CTX },
      });
      if (!rows?.length) break;
      const confirmed = (await guard(object, rows)).filter((id) => id !== null && id !== undefined);
      if (confirmed.length > 0) {
        await engine.delete(object, {
          where: { id: { $in: confirmed } },
          multi: true,
          context: { ...SYSTEM_CTX },
        });
        total += confirmed.length;
      }
      if (confirmed.length < rows.length || rows.length < REAP_GUARD_BATCH_SIZE) break;
    }
    return total;
  }
}

/** Best-effort row-count extraction from a driver's delete result. */
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
