// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import type { Lifecycle } from '@objectstack/spec/data';
import type { DriverQuery } from '@objectstack/spec/contracts';
import { isMissingTableError } from '@objectstack/metadata/errors';
import { parseLifecycleDuration } from './duration.js';
import type {
  DanglingReferenceAuditOptions,
  DanglingReferenceReport,
} from '../integrity/dangling-reference-audit.js';

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
 *   - Sweeps run under a system context (cross-tenant operator policy).
 *   - [#5194] Every reap is BOUNDED. Candidates are read a page at a time and
 *     deleted by id — at most {@link REAP_BATCH_SIZE} ×
 *     {@link REAP_MAX_BATCHES_PER_SWEEP} rows per object per sweep, with the
 *     remainder draining across later sweeps. Unguarded objects used to issue
 *     one `multi: true` DELETE with no limit instead: invisible in the steady
 *     state (hourly sweeps delete a small increment), and a table-scanning long
 *     write transaction exactly once per table — the first sweep after a
 *     retention is declared on an already-large table. SQLite holds the whole
 *     database's write lock for the duration of that one statement; Postgres
 *     takes it as autovacuum debt.
 *
 *     Stated plainly because it is the cost of that bound: a reap now fires one
 *     afterDelete hook PER REAPED ROW, not one per object per sweep. That is
 *     free for today's population — every lifecycle-declaring platform object
 *     is in the audit writer's SKIP_OBJECTS (telemetry/transient plumbing), so
 *     it produces no audit rows either way, and `sys_file`, the one that is
 *     audited, already reaped per id because it carries reap guards.
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
  /**
   * [#4551] Read-only referential-integrity audit. Optional — an engine
   * without it simply contributes no finding (and the report says so by
   * omitting the key, rather than by reporting zero).
   */
  inspectDanglingReferences?(
    options?: DanglingReferenceAuditOptions,
  ): Promise<DanglingReferenceReport>;
}

export interface LifecycleObjectLike {
  name: string;
  lifecycle?: Lifecycle;
  fields?: Record<string, unknown>;
}

export interface LifecycleLoggerLike {
  info(msg: string, meta?: unknown): void;
  warn(msg: string, meta?: unknown): void;
  /** Optional so a test double stays a two-method object; a real kernel logger
   * always has it. Absent ⇒ {@link LifecycleService} falls back to `warn`. */
  error?(msg: string, meta?: unknown): void;
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
  /**
   * [#4551] Referential-integrity audit tuning. The audit rides this sweep's
   * clock deliberately (see {@link LifecycleService.sweep}); `enabled: false`
   * drops that leg while leaving lifecycle enforcement alone.
   *
   * `signal` is deliberately NOT configurable (#4747): the audit's lifetime is
   * this service's lifetime, so the abort bit comes from {@link
   * LifecycleService.stop} and nowhere else. A second, caller-owned signal
   * would be a second answer to "may this still read?".
   */
  referenceAudit?: Omit<DanglingReferenceAuditOptions, 'signal'> & { enabled?: boolean };
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

/**
 * [#5195] A **retention floor**: the shortest window a consumer's own contract
 * can survive on an object it does not own.
 *
 * ADR-0057 P4 lets an operator override any object's window through the
 * `lifecycle` settings namespace, and until #5195 the only validation on that
 * override was "does it parse". That is a side door around exactly the kind of
 * invariant #5179 had just made construction-time: `DbQueueAdapter` dedups
 * `sys_job_queue` publishes by comparing `created_at` against its idempotency
 * window and checks — at construction — that the window is ≤ the **declared**
 * retention. A settings override the constructor cannot see (`maxAge: '1h'`)
 * reaps the very rows the dedup check reads, and duplicate deliveries resume
 * with nothing in any log.
 *
 * The floor is registered at **runtime** (`registerRetentionFloor`), the same
 * shape as {@link LifecycleReapGuard} and for the same reason (ADR-0057 §3.3
 * amendment): the number is not a property of the declaration at all. The
 * queue's floor IS `DbQueueAdapterOptions.idempotencyWindowMs` — a per-kernel
 * construction option — so a static key on the object's `lifecycle` block could
 * only ever be a second, drifting copy of it. Declaration says how long rows
 * are kept; a floor says how short a *consumer* can survive them being kept.
 */
export interface LifecycleRetentionFloor {
  /** Which window is floored: `retention` (`maxAge`, incl. the rotation
   * fallback) or `ttl` (`expireAfter`). */
  policy: 'retention' | 'ttl';
  /** Shortest window, in ms, that keeps the registrar's contract true. */
  minWindowMs: number;
  /** Who depends on it — named in the rejection so an operator knows who to
   * talk to (e.g. `'com.objectstack.service.queue'`). */
  declaredBy: string;
  /** What breaks below the floor, in operator terms. Required: an error line
   * without a consequence is an error line nobody can act on. */
  consequence: string;
  /** The config change that makes the override legal. Also required. */
  remedy: string;
}

/**
 * [#5195] A window that would have been enforced below a registered floor.
 * Always reported per sweep (machine-readable), and logged at `error` once per
 * distinct violation — the failure it prevents is silent duplicate work, which
 * is a durability-class degradation, not a functional one.
 */
export interface LifecycleFloorViolation {
  object: string;
  policy: 'retention' | 'ttl';
  /** `'global'`, or `tenant:<id>` for a tenant-scoped override. */
  scope: string;
  /** The offending settings literal — absent when the **declaration itself**
   * is what sits below the floor (there is no override to blame). */
  override?: string;
  /** The offending window in ms. */
  offendingMs: number;
  /** The floor that rejected it, and who registered it. */
  floorMs: number;
  declaredBy: string;
  /** The window actually enforced this sweep after the violation was handled. */
  appliedMs: number;
}

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
  /**
   * [#5195] Windows rejected this sweep for sitting below a registered
   * {@link LifecycleRetentionFloor}. Empty on every healthy sweep; non-empty
   * means an override (or a declaration) is being overruled, and the entry
   * says by whom.
   */
  floorViolations: LifecycleFloorViolation[];
  /**
   * [#4551] Read-only referential-integrity finding for this sweep, when the
   * engine offers the audit. Absent on an engine that does not (older engine,
   * a test double) — which is itself honest: no report is not "clean".
   */
  danglingReferences?: DanglingReferenceReport;
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

/**
 * Driver surface the governance counter (P4) uses.
 *
 * `query` is the driver contract's {@link DriverQuery}: the object name
 * travels as argument ONE and is deliberately absent from the AST, so a
 * caller cannot state it twice (objectstack#5181, #6231). Typing it as the
 * contract rather than as a loose bag is the point — the previous
 * `Record<string, unknown>` accepted the redundant `object` key, and would
 * equally have accepted a `where` the filter dialect does not have.
 */
interface CountCapableDriver {
  count?(object: string, query?: DriverQuery, options?: unknown): Promise<number>;
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

/**
 * Reap batching — same posture as the Archiver: bound one sweep's work, drain
 * the backlog across sweeps.
 *
 * [#5194] These govern EVERY reap, not just guarded ones. The reasoning the
 * Archiver's constants carry ("bound one sweep's work") never depended on a
 * guard being registered; the unguarded path simply had not had it applied.
 */
const REAP_BATCH_SIZE = 500;
const REAP_MAX_BATCHES_PER_SWEEP = 20;

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
 *
 * [#5535] An object may carry SEVERAL guards, and they compose by
 * intersection: an id is deleted only if every guard confirmed it. See
 * {@link LifecycleService.registerReapGuard}.
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
  /**
   * [#5535] Per-object reap guards ({@link LifecycleReapGuard}), in
   * registration order. A LIST, not a single slot: every registrar of an
   * object keeps its say (all must confirm), the same reason
   * {@link registerRetentionFloor} keys by registrar rather than overwriting.
   */
  private readonly reapGuards = new Map<string, LifecycleReapGuard[]>();
  /**
   * [#5195] Registered retention floors, keyed `object::policy::declaredBy` so
   * a re-registration replaces rather than accumulates, while two independent
   * consumers of one object both keep their say (the strictest wins).
   */
  private readonly retentionFloors = new Map<string, LifecycleRetentionFloor & { object: string }>();
  /** Violations already logged, so a standing misconfiguration says it once
   * (AGENTS.md degradation rule) while a CHANGED one speaks up again. */
  private readonly reportedFloorViolations = new Set<string>();
  /**
   * [#4747] The "the engine is going away" bit, handed to the work in flight.
   *
   * Replaced (never mutated back) by {@link start}, so a sweep that is still
   * running when {@link stop} is called keeps the object it was given and sees
   * the abort even if the service is re-armed afterwards.
   */
  private abort: { aborted: boolean } = { aborted: false };

  constructor(private readonly opts: LifecycleServiceOptions) {
    this.now = opts.now ?? (() => Date.now());
  }

  get enabled(): boolean {
    if (process.env.OS_LIFECYCLE_DISABLED === '1') return false;
    return this.opts.enabled !== false;
  }

  /**
   * [#4747] `true` between {@link stop} and the next {@link start}: the service
   * has been torn down and will neither begin a sweep nor let one in flight
   * carry on.
   */
  get stopped(): boolean {
    return this.abort.aborted;
  }

  /** Arm the periodic sweep. Idempotent; timers are unref'ed so a kernel
   * shutdown is never held open by the lifecycle schedule. */
  start(): void {
    if (!this.enabled || this.timer || this.initialTimer) return;
    // A fresh bit per armed run — the one a previous sweep captured stays
    // aborted forever, which is what makes stop() irreversible for that sweep.
    this.abort = { aborted: false };
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

  /**
   * Disarm the schedule AND call off the work.
   *
   * [#4747] Clearing the timers is only half of it: the sweep is async, so one
   * already in flight would otherwise keep reading and deleting through an
   * engine whose datasource the host is closing underneath it — the reads fail
   * as `Unable to acquire a connection` and the audit files the objects it
   * could not read as findings, on every single healthy run.
   *
   * So `stop()` raises the abort bit the running sweep captured, and the sweep
   * checks it at each leg boundary. That makes teardown a fact the work can
   * see, rather than a race it loses. Synchronous by contract (the kernel's
   * `destroy()` awaits the caller, not this) — it does not wait for the sweep
   * to unwind, it only guarantees no FURTHER work is issued.
   */
  stop(): void {
    if (this.initialTimer) clearTimeout(this.initialTimer);
    if (this.timer) clearInterval(this.timer);
    this.initialTimer = undefined;
    this.timer = undefined;
    this.abort.aborted = true;
  }

  /**
   * Register a {@link LifecycleReapGuard} for one object. From then on the
   * Reaper never blind-deletes that object's rows: candidates are fetched,
   * each guard confirms (after external cleanup) or vetoes each row, and only
   * confirmed ids are deleted.
   *
   * [#5535] **Several guards may govern one object, and they COMPOSE by
   * intersection** — an id is deleted only if every registered guard confirmed
   * it; a single veto keeps the row for the next sweep to retry. Registering
   * does not replace: the previous registrar keeps its say.
   *
   * The alternative — one slot, last registration wins — was how this started,
   * and it is unsafe for exactly the reason the guard seam exists. A guard's
   * contract is "external cleanup first, then confirm", so `sys_file`'s guard
   * reclaims storage bytes before it confirms, and the row is the only pointer
   * to those bytes. A second registrar (ADR-0057 §3.3 explicitly invites one —
   * a domain callback such as de-indexing a derived index by id) would have
   * displaced that byte reclaim wholesale: rows deleted, bytes leaked, not one
   * line of log to say so, and nothing the newcomer could have read to notice
   * (#5535). Intersection is the composition the "confirm before delete"
   * contract already implies, and it is what {@link registerRetentionFloor}
   * does one policy over (there: the strictest window wins).
   *
   * Two consequences worth knowing when writing a guard:
   *
   * - Guards run in registration order, but a guard is only ever asked about
   *   rows the guards before it have already confirmed. That is deliberate:
   *   being asked implies "everyone so far agrees this row can go", so a guard
   *   never performs irreversible cleanup for a row another guard is about to
   *   keep. The delete set itself does not depend on the order.
   * - A guard that throws aborts the object's reap with nothing deleted
   *   (unchanged: an erroring guard must never fail open into deletion), so
   *   cleanup already done by an earlier guard in that batch is retried next
   *   sweep rather than paid out in a delete.
   *
   * Registering the identical function twice is a no-op — re-run wiring, not a
   * second opinion: intersecting a guard's verdict with itself changes no
   * outcome, while calling it twice would run its external cleanup twice.
   */
  registerReapGuard(object: string, guard: LifecycleReapGuard): void {
    const guards = this.reapGuards.get(object);
    if (!guards) {
      this.reapGuards.set(object, [guard]);
      return;
    }
    if (!guards.includes(guard)) guards.push(guard);
  }

  /** Snapshot of the guards governing `object`, in registration order — a copy,
   * so a registration mid-sweep cannot change the set a reap in flight is
   * consulting. */
  private reapGuardsFor(object: string): LifecycleReapGuard[] {
    return [...(this.reapGuards.get(object) ?? [])];
  }

  /**
   * [#5195] Register a {@link LifecycleRetentionFloor} for one object.
   *
   * From then on a settings override (global **or** tenant-scoped) that would
   * shorten that object's window below the floor is REJECTED — the declared
   * window stands — and the rejection is reported at `error` naming the
   * registrar, the consequence and the fix.
   *
   * Rejected rather than clamped to the floor, deliberately. Clamping would
   * enforce a third number that appears in neither the object's declaration nor
   * the operator's settings, so nobody reading either surface could predict when
   * rows actually disappear — and it would move whenever an unrelated package
   * changed its floor. Rejection has exactly one fallback, the declaration,
   * which is already the contract everywhere else in this file (an unparseable
   * override resolves the same way: "never fail open into no bound at all").
   * The operator's intent is not silently half-honoured; it is refused, loudly,
   * with the two settings that would make it legal.
   *
   * Registering a floor is a wiring act, so a malformed one throws here rather
   * than degrading into an unactionable log line at 3am.
   */
  registerRetentionFloor(object: string, floor: LifecycleRetentionFloor): void {
    if (!object) throw new Error('[lifecycle] registerRetentionFloor requires an object name');
    if (floor?.policy !== 'retention' && floor?.policy !== 'ttl') {
      throw new Error(
        `[lifecycle] retention floor for ${object} must declare policy 'retention' or 'ttl' (got ${JSON.stringify(floor?.policy)})`,
      );
    }
    if (!Number.isFinite(floor.minWindowMs) || floor.minWindowMs <= 0) {
      throw new Error(
        `[lifecycle] retention floor for ${object} needs a positive finite minWindowMs (got ${String(floor.minWindowMs)})`,
      );
    }
    if (!floor.declaredBy || !floor.consequence || !floor.remedy) {
      throw new Error(
        `[lifecycle] retention floor for ${object} must name declaredBy, consequence and remedy — `
        + 'the rejection it produces is read by an operator who knows none of the three.',
      );
    }
    this.retentionFloors.set(`${object}::${floor.policy}::${floor.declaredBy}`, { ...floor, object });
  }

  /** The strictest floor registered for (object, policy) — every registrar's
   * floor has to hold, so the largest one governs. */
  private floorFor(
    object: string,
    policy: 'retention' | 'ttl',
  ): (LifecycleRetentionFloor & { object: string }) | undefined {
    let strictest: (LifecycleRetentionFloor & { object: string }) | undefined;
    for (const floor of this.retentionFloors.values()) {
      if (floor.object !== object || floor.policy !== policy) continue;
      if (!strictest || floor.minWindowMs > strictest.minWindowMs) strictest = floor;
    }
    return strictest;
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
      floorViolations: [],
    };
    if (this.sweeping || !this.enabled) return report;
    // [#4747] Torn down ⇒ there is no engine to sweep through, whatever the
    // timer that woke us thinks. A one-shot host (`os migrate`) disconnects its
    // datasource on the way out; work started after that reads a closed pool.
    if (this.stopped) return report;
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
        // [#4747] Leg boundary: stop() during the sweep ends it here rather
        // than pushing more deletes at a datasource that is being closed.
        if (this.stopped) return report;
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
        // [#4747] Leg boundary, after the object loop — space reclaim is the
        // last thing `sweep()` issues at the data plane, and the one the
        // per-object check above cannot reach. That check sits at the TOP of the
        // object loop, so a teardown landing inside the LAST declared object's
        // reap never meets it again: `batchedReap` breaks BECAUSE it read
        // `aborted === true`, the object loop then ends normally rather than
        // through the check, and control arrives here. Sending a VACUUM-class
        // operation to a datasource the host is closing is therefore not a race
        // teardown lost — it is work issued by code that had already been told
        // the engine is going away.
        //
        // Deferring costs nothing. Reclaim is pure housekeeping, not half of a
        // pair: it deletes no row, and skipping it leaves nothing inconsistent —
        // only pages unreturned, which the next sweep reclaims after re-deriving
        // the same `reclaimable` set from the same deletes. Checking per driver
        // rather than once before the loop also covers teardown landing inside
        // one driver's reclaim: the datasources still queued are spared instead
        // of being asked in turn.
        if (this.abort.aborted) break;
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

      // [#4551] Referential-integrity audit — READ-ONLY, and the only leg of
      // this sweep that writes nothing at all.
      //
      // It rides this clock for one reason: an operator must not have to know
      // the finding exists in order to go looking for it (the same argument
      // that put #4469's stranded-request inspection on the approvals SLA
      // clock). Its subject is unrelated to retention, and that is fine — a
      // clock is scheduling, not scope.
      //
      // Failure is isolated like every other leg: an audit that cannot run must
      // never cost a sweep its reaping.
      await this.auditReferences(engine, report);

      if (report.swept.length > 0 || report.errors.length > 0 || report.alerts.length > 0) {
        // ADR-0057 §3.3: cleanup must not re-feed the tables it drains — one
        // aggregate log line per sweep is the entire trace it leaves.
        const total = report.swept.reduce((sum, e) => sum + (e.deleted ?? 0), 0);
        this.opts.logger.info(
          `[lifecycle] sweep: ${report.swept.length} policy(ies) applied, ~${total} rows reaped, ` +
            `${report.reclaimed.length} datasource(s) reclaimed, ${report.errors.length} error(s), ` +
            `${report.alerts.length} alert(s)` +
            (report.floorViolations.length > 0
              ? `, ${report.floorViolations.length} window(s) overruled by a registered retention floor`
              : ''),
        );
      }
      return report;
    } finally {
      this.sweeping = false;
    }
  }

  /**
   * [#4551] Run the read-only dangling-reference audit as one leg of the sweep.
   *
   * Deliberately contributes NOTHING to `report.errors` on failure: those
   * entries mean "a lifecycle policy did not get applied", and an audit that
   * could not run has applied no policy either way. It logs instead, and its
   * own report already carries `unreadableObjects` / `undetermined` so a
   * partial run is never mistaken for a clean one.
   */
  private async auditReferences(
    engine: LifecycleEngineLike,
    report: LifecycleSweepReport,
  ): Promise<void> {
    const cfg = this.opts.referenceAudit;
    if (cfg?.enabled === false) return;
    if (typeof engine.inspectDanglingReferences !== 'function') return;
    // [#4747] Not a config switch keyed on "is this a one-shot process" — the
    // audit stays wired on every host, exactly as #4551 intends. What it gets
    // is the teardown bit: it reads while the engine is live and stops when the
    // engine is going away, so `unreadableObjects` keeps meaning "the
    // datasource refused" and nothing else.
    if (this.stopped) return;
    try {
      const { enabled: _enabled, ...auditOptions } = cfg ?? {};
      report.danglingReferences = await engine.inspectDanglingReferences({
        ...auditOptions,
        signal: this.abort,
      });
    } catch (err) {
      this.opts.logger.warn(
        `[lifecycle] reference audit failed (${(err as Error)?.message ?? err})`,
      );
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
      const driver = engine.getDriverForObject(obj.name) as CountCapableDriver | undefined;
      if (!driver || typeof driver.count !== 'function') continue;
      let rowCount: number;
      try {
        rowCount = await driver.count(obj.name);
      } catch (error) {
        // [#8906] A row-count probe that FAILED is not an object with nothing
        // to say. The bare `catch { continue }` this replaces made the two
        // indistinguishable, and the damage outlived the sweep it happened in:
        // the object is skipped for `quota-exceeded` AND for `growth` alerting
        // this sweep, and — because `nextCounts` is what becomes
        // `this.lastCounts` below — it is also dropped from the BASELINE, so
        // the next sweep has no `last` to diff against and cannot alert on
        // growth either. A driver outage read exactly like a quiet, healthy
        // object, twice over, with nothing logged and nothing in the report.
        //
        // Benign: the object is registered but its TABLE was never provisioned
        // (schema sync not run yet). It holds no rows, so there is no quota to
        // breach and no growth to measure — skipping it IS the truth. Asked
        // through the shared `isMissingTableError` predicate
        // (`@objectstack/metadata/errors`), never a hand-rolled code test, so
        // one vocabulary of "benign driver error" serves every seam that needs
        // one. It stays out of `nextCounts` deliberately: seeding a 0 baseline
        // for a table that does not exist would fire a phantom `growth` alert
        // on the first sweep after the table is provisioned and seeded.
        //
        // Everything else (connection drop, timeout, permission denial, a
        // dialect error) means the rows may well exist and simply were not
        // counted — the maintainer's 2026-08-15 disposition for this family:
        // unprovisioned is truthful emptiness, everything else must surface.
        //
        // It surfaces through the channels that already exist — no new report
        // field and no new error code. `report.errors` is this sweep's declared
        // per-object failure channel (the object loop in `sweep()` fills it the
        // same way) and the sweep's summary line already counts it; the `warn`
        // matches that loop's level, because the consequence is reduced
        // ALERTING, not a write that claimed to persist and did not
        // (AGENTS.md "Degradation log levels"). Both messages name the baseline
        // loss, since that is the half an operator cannot infer from a report
        // that is otherwise identical to a healthy one.
        //
        // Rethrowing — the shape #8895 took at the `cascadeDeleteRelations`
        // probe — is deliberately NOT the shape here, and not for uniformity's
        // sake: there, the caller is a `delete()` that must fail. Here the only
        // caller is `sweep()`, whose scheduler entry point is `void this.sweep()`
        // — a throw would land as an unhandled rejection, abandon governance for
        // every object still queued behind this one, skip `this.lastCounts =
        // nextCounts` entirely (losing EVERY object's baseline, not just this
        // one's), and break the documented invariant that a sweep failure is
        // isolated and never thrown into the scheduler. That is strictly more
        // damage than the defect being repaired.
        if (isMissingTableError(error)) continue;
        const msg = (error as Error)?.message ?? String(error);
        report.errors.push({
          object: obj.name,
          error:
            `governance row-count probe failed (${msg}) — quota and growth alerting skipped ` +
            `for this object this sweep, and its growth baseline for the next sweep is lost`,
        });
        this.opts.logger.warn(
          `[lifecycle] governance row-count probe on ${obj.name} failed (${msg}); ` +
            'quota/growth alerting skipped this sweep and the next sweep has no growth baseline for it',
        );
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
      const windowMs = this.effectiveWindowMs(
        ov.expireAfter,
        parseLifecycleDuration(lc.ttl.expireAfter),
        object,
        'ttl',
        'global',
        report,
      );
      outcomes.push(await this.reap(engine, object, lc, 'ttl', lc.ttl.field, windowMs, report));
    }

    // Rotation (P2): physical time-sharding when the driver supports it —
    // the window bound comes from DROPping expired shards (O(1) reclaim).
    // Drivers without rotation fall through to an equivalent age-based reap,
    // so the declared bound holds on every dialect.
    let rotated = false;
    if (lc.storage?.strategy === 'rotation') {
      const driver = engine.getDriverForObject(object) as RotationCapableDriver | undefined;
      // [#4747] Leg boundary. `rotateShards` DROPs expired physical shards — the
      // most destructive single operation this service issues, and the one the
      // guards below it (strategy, driver capability) say nothing about. When
      // the object declares `ttl` as well, the reap above has already run, and
      // `batchedReap` may have broken BECAUSE it read `aborted === true`; it
      // returns straight to here. Dropping shards at a datasource the host is
      // closing is then a decision made with the answer in hand, not an await
      // that merely straddled teardown.
      //
      // Deferring costs nothing. Rotation is an O(1) reclaim of a bound the next
      // sweep re-derives from the same `storage.shards` × `unit` window and
      // applies to the same shards: skipping it drops nothing early and retains
      // nothing past its window by more than one sweep interval.
      //
      // The conjunct cannot divert the rotation-WITHOUT-`ttl` form into the
      // age-based fallback further down. That branch is `!lc.ttl`-gated, and
      // without `ttl` (and without `archive`, which returns earlier) nothing in
      // `reapObject` has awaited before this point — so the bit here is
      // structurally false in that form, not merely unobserved.
      if (
        !this.abort.aborted &&
        driver &&
        typeof driver.rotateShards === 'function' &&
        driver.supportsRotation !== false
      ) {
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
      const windowMs = this.effectiveWindowMs(
        ov.maxAge,
        parseLifecycleDuration(lc.retention.maxAge),
        object,
        'retention',
        'global',
        report,
      );
      outcomes.push(
        await this.reap(engine, object, lc, 'retention', 'created_at', windowMs, report, lc.retention.onlyWhen),
      );
    } else if (lc.storage?.strategy === 'rotation' && !rotated && !lc.ttl) {
      // Rotation declared but the driver can't shard physically: the shard
      // window IS the bound — enforce the same window with an age-based reap
      // so the declaration is never inert.
      const windowMs = this.effectiveWindowMs(
        ov.maxAge,
        lc.storage.shards * SHARD_UNIT_MS[lc.storage.unit],
        object,
        'retention',
        'global',
        report,
      );
      outcomes.push(await this.reap(engine, object, lc, 'rotation-fallback', 'created_at', windowMs, report));
    }

    return outcomes;
  }

  /**
   * A governance override window beats the declared one — unless it fails to
   * parse, in which case the declared window stands (never fail open into
   * "no bound at all") — or [#5195] unless it sits below a registered
   * {@link LifecycleRetentionFloor}, in which case it is rejected the same way
   * and for the same reason: an override that breaks a consumer's contract is
   * not a shorter policy, it is an invalid one.
   *
   * `fallbackMs` is what an invalid override falls back to: the declared window
   * at global scope, and the already-resolved global window for a tenant-scoped
   * override (which has itself passed this check).
   */
  private effectiveWindowMs(
    override: string | undefined,
    fallbackMs: number,
    object: string,
    policy: 'retention' | 'ttl',
    scope: string,
    report: LifecycleSweepReport,
  ): number {
    const floor = this.floorFor(object, policy);

    if (!override) {
      // No override: the DECLARATION is what runs. A declaration below the
      // floor is a different defect (the object and its consumer disagree at
      // authoring time, which is where #5179's constructor guard catches the
      // queue case) — reported here too, because a floor registered against an
      // object nobody re-checked would otherwise be silently unmet. The sweep
      // still runs it: refusing to reap would trade a broken consumer contract
      // for an unbounded table, which is the defect #5179 just closed.
      if (floor && fallbackMs < floor.minWindowMs) {
        this.reportFloorViolation(report, {
          object,
          policy,
          scope,
          offendingMs: fallbackMs,
          floorMs: floor.minWindowMs,
          declaredBy: floor.declaredBy,
          appliedMs: fallbackMs,
        }, floor, 'declared');
      }
      return fallbackMs;
    }

    let overrideMs: number;
    try {
      overrideMs = parseLifecycleDuration(override);
    } catch {
      this.opts.logger.warn(`[lifecycle] invalid override window '${override}' for ${object}; keeping the declared window`);
      return fallbackMs;
    }

    if (floor && overrideMs < floor.minWindowMs) {
      this.reportFloorViolation(report, {
        object,
        policy,
        scope,
        override,
        offendingMs: overrideMs,
        floorMs: floor.minWindowMs,
        declaredBy: floor.declaredBy,
        appliedMs: fallbackMs,
      }, floor, 'override');
      return fallbackMs;
    }

    return overrideMs;
  }

  /**
   * Record a floor violation on the sweep report (always) and log it at
   * `error` (once per distinct violation).
   *
   * `error`, not `warn`, by the AGENTS.md test: after this degradation the
   * system looks entirely normal — the sweep reports success, the table shrinks
   * on schedule — while the contract that override silently broke shows up
   * later as duplicate work nobody can trace back to a settings edit. The line
   * owes a consequence and a fix, and both come from the registrar rather than
   * from guesswork here.
   */
  private reportFloorViolation(
    report: LifecycleSweepReport,
    violation: LifecycleFloorViolation,
    floor: LifecycleRetentionFloor,
    kind: 'override' | 'declared',
  ): void {
    report.floorViolations.push(violation);
    const dedupKey = `${violation.object}|${violation.policy}|${violation.scope}|${kind}|${violation.offendingMs}|${violation.floorMs}`;
    if (this.reportedFloorViolations.has(dedupKey)) return;
    this.reportedFloorViolations.add(dedupKey);

    const where = violation.scope === 'global' ? 'global scope' : violation.scope;
    const head =
      kind === 'override'
        ? `[lifecycle] REJECTED the ${violation.policy} override '${violation.override}' (${violation.offendingMs}ms) on `
          + `${violation.object} at ${where}: it is below the ${violation.floorMs}ms floor registered by `
          + `'${floor.declaredBy}'. Enforcing the declared ${violation.appliedMs}ms window instead.`
        : `[lifecycle] ${violation.object}'s declared ${violation.policy} window (${violation.offendingMs}ms) is below `
          + `the ${violation.floorMs}ms floor registered by '${floor.declaredBy}'; it is still being enforced as declared.`;
    this.logError(`${head} Consequence: ${floor.consequence} Fix: ${floor.remedy}`);
  }

  /** `error` where the logger has one; a duck-typed test double may not. */
  private logError(msg: string): void {
    if (typeof this.opts.logger.error === 'function') this.opts.logger.error(msg);
    else this.opts.logger.warn(msg);
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
      // [#4747] Leg boundary, per batch — the same check the reap loop makes
      // (see {@link batchedReap}). `sweep()` checks the abort bit between
      // OBJECTS, which leaves one archive round as up to 20 pages of reads and
      // writes across TWO datasources (a hot page read, a cold upsert per row,
      // a hot bulk delete), i.e. ~10k operations issued at stores the host may
      // already be closing — precisely what #4747 stopped.
      //
      // Breaking BETWEEN batches keeps the Archiver's safety rule intact
      // ("hot-delete only what the cold store has taken"): a batch already in
      // flight finishes its upsert → bulkDelete pair, and batches not yet begun
      // are simply left for the next sweep, which re-reads them from the hot
      // store unchanged.
      if (this.abort.aborted) break;
      const rows = await hot.find(object, {
        where: { created_at: { $lt: cutoff } },
        limit: ARCHIVE_BATCH_SIZE,
      });
      if (!rows.length) break;
      // [#8807] The conflict target stays `['id']`, and that is a measured
      // conclusion rather than an untouched line.
      //
      // #8807 ruled that an upsert must never modify a row whose identity the
      // caller did not supply and whose conflict key it did not name — the
      // MySQL `ON DUPLICATE KEY UPDATE` merge can land on any UNIQUE key,
      // including one nobody named. The enforcement options included refusing
      // this exact call shape on any table carrying a non-primary UNIQUE key,
      // which would have refused archival wholesale, so the ruling required the
      // blast radius on THIS caller be measured before anything shipped.
      //
      // Measured: of the objects in this repo that declare `lifecycle.archive`
      // — `sys_audit_log` and `sys_metadata_audit`, the only two — ZERO declare
      // a non-primary unique field or a `unique` index. The archiver therefore
      // never even reaches the check today.
      //
      // It is also correct by construction for a customer object that DOES
      // carry one, which is why no opt-out is threaded through here: this loop
      // copies a row that already has an `id` and re-copies it idempotently, so
      // the merge lands on the identity it supplied and the check passes. The
      // one case it would refuse is a cold row that collides on a business key
      // while carrying a DIFFERENT id — which is not archival working, it is
      // archival about to overwrite an unrelated archived record. Refusing
      // there is the Archiver's own safety rule ("hot-delete only what the cold
      // store has taken"): the upsert throws, `bulkDelete` below never runs,
      // and the hot rows survive for the next sweep.
      for (const row of rows) {
        await cold.upsert(object, row, ['id']);
      }
      await hot.bulkDelete(object, rows.map((r) => r.id as string));
      archived += rows.length;
      if (rows.length < ARCHIVE_BATCH_SIZE) break;
    }

    // Cold-side retention: `keep` bounds the archive itself.
    //
    // [#4747] Leg boundary, after the batch loop — the last leg `archiveObject`
    // can issue, and the one the per-batch check above does not reach. The loop
    // may have just broken BECAUSE it read `aborted === true`, so firing a
    // predicate DELETE at the cold datasource here is not a race teardown lost:
    // it is a write issued by code that had already been told the engine is
    // going away. That is what separates this leg from a lone `await` sitting
    // between two checkpoints (the pre-#5194 reap shape) — there, nothing had
    // observed the bit, and carrying on was not a decision.
    //
    // Deferring costs nothing. The cold prune is pure retention reclaim, not
    // half of a pair: unlike the loop's `upsert` → `bulkDelete`, which must
    // finish so the Archiver never hot-deletes a row the cold store has not
    // taken, nothing is left inconsistent by skipping it. The next sweep
    // re-derives the same cutoff from the same `keep` and prunes the same rows.
    if (!this.abort.aborted && archive.keep && typeof cold.deleteMany === 'function') {
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
    const guards = this.reapGuardsFor(object);
    const canReadRows = typeof engine.find === 'function';
    if (guards.length > 0 && !canReadRows) {
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
    // [#5194] One reap path for every object. Zero guards is not a different
    // algorithm — it is the empty intersection, i.e. "every candidate row is
    // confirmed" — so the batching, the per-sweep ceiling and the by-id deletes
    // are identical either way, and there is exactly one place where a reap
    // decides what to delete.
    //
    // The fallback below is NOT the unguarded path; it is the no-`find` path.
    // `LifecycleEngineLike.find` is optional (a two-method test double is a
    // legal engine here), and an engine that cannot read rows cannot page
    // through them — so it keeps the pre-#5194 single unbounded DELETE rather
    // than losing retention enforcement entirely. Every real engine has `find`
    // (`ObjectQL.find`, wired in `plugin.ts`), so production always batches.
    const reapWhere = async (where: Record<string, unknown>): Promise<number | undefined> =>
      canReadRows
        ? this.batchedReap(engine, object, guards, where)
        : countDeleted(await engine.delete(object, { where, multi: true, context: { ...SYSTEM_CTX } }));

    if (tenantWindows.length === 0) {
      accumulate(await reapWhere({ [field]: { $lt: cutoff }, ...scope }));
    } else {
      // Tenant-level windows (P4): each overriding tenant gets its own
      // cutoff on its own rows…
      for (const t of tenantWindows) {
        // [#5195] Tenant-scoped overrides go through the same floor: a
        // per-tenant `maxAge: '1h'` is the identical side door, one scope down.
        const tMs = this.effectiveWindowMs(
          t[overrideKey],
          windowMs,
          object,
          policy === 'ttl' ? 'ttl' : 'retention',
          `tenant:${t.tenantId}`,
          report,
        );
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
   * Batched reap: fetch candidate rows a page at a time, let every registered
   * guard confirm (after performing external cleanup) or veto each, delete
   * only the ids ALL of them confirmed — by id, page after page, up to
   * {@link REAP_MAX_BATCHES_PER_SWEEP} pages. A guard error propagates to the
   * per-object handler in `sweep()` — an erroring guard must never fail open
   * into deletion. A batch that isn't fully confirmed ends the pass: vetoed
   * rows still match the cutoff filter and would be re-fetched forever; the
   * next sweep retries them.
   *
   * [#5194] `guards` MAY BE EMPTY, and that is the ordinary case — an object
   * with no guard registered is the empty intersection, which confirms every
   * candidate. The guard loop then simply does not execute, and what remains is
   * exactly the bound this method exists to impose: read ≤ {@link
   * REAP_BATCH_SIZE} rows, delete them by id, stop after
   * {@link REAP_MAX_BATCHES_PER_SWEEP} pages and let the next sweep continue.
   * The alternative — a second, guard-free batching routine beside this one —
   * would be two implementations of one policy, drifting apart at the first
   * change to either.
   *
   * [#5535] The intersection is computed as a narrowing pipeline rather than
   * N independent verdicts unioned at the end, because a guard's confirmation
   * is not an opinion — it is the *receipt* for cleanup it has already
   * performed. Handing guard 2 a row guard 1 already vetoed would have it
   * de-index (or otherwise reclaim) a row that then survives the sweep. So a
   * guard is asked only about rows still standing, and one that vetoes
   * everything ends the batch before the rest are called at all. The delete
   * set is the same whatever the registration order.
   */
  private async batchedReap(
    engine: LifecycleEngineLike,
    object: string,
    guards: readonly LifecycleReapGuard[],
    where: Record<string, unknown>,
  ): Promise<number> {
    let total = 0;
    for (let batch = 0; batch < REAP_MAX_BATCHES_PER_SWEEP; batch++) {
      // [#4747] Leg boundary, per page. `sweep()` checks the abort bit between
      // OBJECTS; before #5194 an unguarded reap was a single `await` between
      // two such checks, so that was the whole story. A reap is now up to
      // REAP_MAX_BATCHES_PER_SWEEP pages of reads and deletes, and pushing them
      // at a datasource the host is closing is precisely what #4747 stopped.
      if (this.abort.aborted) break;
      const rows = await engine.find!(object, {
        where,
        limit: REAP_BATCH_SIZE,
        context: { ...SYSTEM_CTX },
      });
      if (!rows?.length) break;
      // [#5194] A row with no usable id is dropped before anything is asked
      // about it or done to it. It cannot be deleted by id, and it must never
      // reach the delete below: `where: { id: undefined }` with `multi: true`
      // is not a by-id delete at all — the engine's dispatch reads no scalar
      // id, routes to `deleteMany`, and the predicate it would run is the
      // batch's whole cutoff filter. The guard intersection used to drop such
      // rows as a side effect of matching ids (see {@link idKey}); with zero
      // guards nothing narrows, so the invariant is stated here instead of
      // being an emergent property of a loop that may not run. Dropping them
      // pre-guard also keeps a guard from reclaiming bytes for a row that was
      // never deletable — the same reason #5535 narrows before it asks.
      let confirmed = rows.filter((row) => idKey(row?.id) !== undefined);
      for (const guard of guards) {
        const ids = new Set(
          (await guard(object, confirmed)).map(idKey).filter((k): k is string => k !== undefined),
        );
        confirmed = confirmed.filter((row) => {
          const k = idKey(row?.id);
          return k !== undefined && ids.has(k);
        });
        if (confirmed.length === 0) break;
      }
      // Per-id deletes (NOT a `{$in}` filter): the engine's delete path reads
      // `where.id` as a scalar target, and by-id deletes get referential
      // cascade handling a filter-delete would bypass.
      for (const row of confirmed) {
        await engine.delete(object, {
          where: { id: row.id },
          multi: true,
          context: { ...SYSTEM_CTX },
        });
      }
      total += confirmed.length;
      if (confirmed.length < rows.length || rows.length < REAP_BATCH_SIZE) break;
    }
    return total;
  }
}

/**
 * [#5535] Identity key used to intersect one guard's confirmed ids with the
 * rows it was handed. `undefined` for an unusable id (null/undefined), which
 * never matches anything — a row with no id cannot be confirmed, and a guard
 * that returns one is confirming nothing.
 *
 * Stringified because the two sides are typed independently: a guard returns
 * `string | number` while a row's id is whatever the driver stored, so a guard
 * that hands back `String(row.id)` must not silently stop reclaiming. Within
 * one batch the rows' ids are distinct, so the collapse cannot merge two rows.
 */
function idKey(id: unknown): string | undefined {
  return id === null || id === undefined ? undefined : String(id);
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
