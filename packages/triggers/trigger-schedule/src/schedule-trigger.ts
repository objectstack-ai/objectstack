// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { Cron } from 'croner';
import type { AutomationContext } from '@objectstack/spec/contracts';
import type { JobSchedule, JobHandler } from '@objectstack/spec/contracts';

/**
 * Structural mirror of the automation engine's `FlowTriggerBinding`
 * (service-automation/src/engine.ts). Declared locally so this trigger plugin
 * stays decoupled from the automation package — same pattern the record-change
 * trigger and the connector / messaging integrations use. The engine parses the
 * flow's start node and hands us a binding whose `schedule` carries the
 * cron/interval/once descriptor.
 */
export interface FlowTriggerBinding {
    readonly flowName: string;
    readonly object?: string;
    readonly event?: string;
    readonly condition?: string | { dialect?: string; source?: string; ast?: unknown };
    readonly schedule?: unknown;
    readonly config?: Record<string, unknown>;
}

/**
 * Structural mirror of the engine's `FlowTrigger` extension point. The engine
 * calls {@link start} with a parsed binding + a callback that runs the flow,
 * and {@link stop} when the flow is unregistered/disabled.
 */
export interface FlowTrigger {
    readonly type: string;
    start(binding: FlowTriggerBinding, callback: (ctx: AutomationContext) => Promise<void>): void;
    stop(flowName: string): void;
}

/**
 * What a {@link ReplayGuard} answers when a job service is about to replay a
 * job it does not itself understand. Structural mirror of the job adapter's
 * own type — see the note on {@link JobServiceSurface}.
 */
export type ReplayGuardDecision =
    | { readonly allow: true }
    | {
          readonly allow: false;
          /** Human-readable identity of the window that was already delivered. */
          readonly window: string;
          /** When that window's claim was taken (ISO-8601), if the ledger knows. */
          readonly claimedAt: string | null;
      };

/**
 * A per-job pre-flight the job service runs before `replay()` (#14501).
 *
 * It is asked, and it also PREPARES: a guard that answers `{ allow: true }`
 * has already armed whatever its owner needs to let the replayed run through
 * its own idempotency gate. So a job service must call it exactly once per
 * replay, and must not call it for a replay it then abandons.
 */
export type ReplayGuard = (options: { readonly force: boolean }) => Promise<ReplayGuardDecision>;

/**
 * The slice of `IJobService` this trigger needs: schedule a named job and
 * cancel it. Typed structurally so the plugin depends on the spec contract
 * shape, not a concrete adapter.
 *
 * `setReplayGuard` is OPTIONAL and is NOT part of the `IJobService` spec
 * contract — it is the adapter-local registration `DbJobAdapter` grew for
 * #14501, and a job service without it (the bootstrap `IntervalJobAdapter`,
 * any third-party adapter) simply never installs the guard. That degradation
 * is declared, not silent: see {@link ScheduleTrigger} for what is lost.
 */
export interface JobServiceSurface {
    schedule(name: string, schedule: JobSchedule, handler: JobHandler): Promise<void>;
    cancel(name: string): Promise<void>;
    setReplayGuard?(name: string, guard: ReplayGuard | null): void;
}

/** What a claimed dispatch turned into — mirror of the ledger's own type. */
export type ScheduleDispatchOutcome = 'succeeded' | 'failed';

/** One dispatch-claim row, as this trigger reads it back. */
export interface ScheduleDispatchClaim {
    readonly outcome: ScheduleDispatchOutcome | null;
    readonly claimedAt: string | null;
}

/**
 * The slice of the automation service this trigger needs for once-per-window
 * delivery (#14501): the same `sys_flow_dispatch` claim ledger the
 * time-relative trigger uses for its per-record keys (#10220), plus the
 * outcome half the #14501 ruling added.
 *
 * Typed structurally — like {@link JobServiceSurface} — so this plugin never
 * learns the ledger's table name and takes no build dependency on
 * `@objectstack/service-automation`. `settleDispatch` / `readDispatch` are
 * optional for the same reason `claim` is resolved defensively: an automation
 * service predating either one resolves to a partial surface, and the trigger
 * degrades honestly rather than throwing at bind time.
 */
export interface ScheduleDispatchLedger {
    claim(key: string): Promise<boolean>;
    settleDispatch?(key: string, outcome: ScheduleDispatchOutcome): Promise<void>;
    readDispatch?(key: string): Promise<ScheduleDispatchClaim | null>;
}

/**
 * One tick window — the unit a scheduled flow is delivered once per, and the
 * `(flow, tick-window)` half of the #14501 claim key.
 */
export interface TickWindow {
    /**
     * The window's start instant as an ISO-8601 string, seconds precision.
     * This IS the window's identity: two fires share a window exactly when
     * they share this value.
     */
    readonly startedAt: string;
    /** How the window reads in a log line or a replay refusal. */
    readonly label: string;
}

/**
 * The most recent tick window of `schedule` at or before `now`, or `null` when
 * the descriptor admits no window.
 *
 * ⚠️ There is exactly ONE notion of "window" here and it is derived from the
 * schedule descriptor itself, so the tick that takes a claim and the replay
 * that reads it back cannot disagree — which is the whole reason the key is
 * computed here rather than read off the fire:
 *
 *  - **cron** — the previous occurrence of the very same expression in the
 *    very same timezone, computed by the very same library the job adapter
 *    schedules with (`croner`). A DST or leap-second boundary therefore moves
 *    the fire and the window key together, by construction; there is no second
 *    calendar to disagree with. `croner` resolves patterns to whole seconds,
 *    so the reference is advanced to the start of the next second to turn its
 *    strictly-before answer into the at-or-before one this needs.
 *    ⚠️ That "one calendar" property rests on an assumption worth naming: an
 *    absent `schedule.timezone` falls back to `'UTC'` here, which is the same
 *    default `CronJobAdapter` applies to the fire (`options.timezone ?? 'UTC'`).
 *    A host that constructed its adapter with a different default timezone
 *    would fire on its calendar while this keys on UTC, and the two would part
 *    company at a DST boundary.
 *  - **interval** — the epoch-anchored bucket `floor(now / intervalMs)`.
 *    Anchored to the epoch and not to registration time on purpose: a restart
 *    re-registers the timer at a new offset, and a window that moved with it
 *    would forget every claim across exactly the restart this ledger exists to
 *    survive. Consecutive fires are `intervalMs` apart and buckets are
 *    `intervalMs` wide, so two fires never share one.
 *  - **once** — the single instant the job is due. One window, forever.
 */
export function computeTickWindow(schedule: JobSchedule, now: Date): TickWindow | null {
    const nowMs = now.getTime();
    if (!Number.isFinite(nowMs)) return null;

    if (schedule.type === 'cron') {
        const expression = schedule.expression;
        if (!expression) return null;
        // croner strips milliseconds and answers strictly BEFORE the reference
        // second; advancing to the start of the next second makes that the
        // at-or-before answer, including when `now` IS the fire instant.
        const reference = new Date(Math.floor(nowMs / 1000) * 1000 + 1000);
        let previous: Date | undefined;
        try {
            const pattern = new Cron(expression, { timezone: schedule.timezone ?? 'UTC' });
            previous = pattern.previousRuns(1, reference)[0];
            pattern.stop();
        } catch {
            return null; // unparseable expression — the job will not bind either
        }
        if (!previous) return null;
        const startedAt = previous.toISOString();
        return {
            startedAt,
            label: `cron '${expression}' window starting ${startedAt}`,
        };
    }

    if (schedule.type === 'interval') {
        const intervalMs = schedule.intervalMs;
        if (!intervalMs || intervalMs <= 0) return null;
        const startedAt = new Date(Math.floor(nowMs / intervalMs) * intervalMs).toISOString();
        return {
            startedAt,
            label: `interval ${intervalMs}ms window starting ${startedAt}`,
        };
    }

    if (schedule.type === 'once') {
        if (!schedule.at) return null;
        const at = new Date(schedule.at);
        if (!Number.isFinite(at.getTime())) return null;
        const startedAt = at.toISOString();
        return { startedAt, label: `one-shot window at ${startedAt}` };
    }

    return null;
}

/**
 * The `(flow, tick-window)` dispatch key (#14501).
 *
 * Namespaced `schedule:` so it can never collide with the time-relative
 * trigger's `time-relative:` keys in the one shared ledger.
 */
export function scheduleDispatchKey(flowName: string, window: TickWindow): string {
    return `schedule:${flowName}:${window.startedAt}`;
}

/** Minimal logger surface (matches core's `ctx.logger`). */
export interface TriggerLogger {
    info(msg: string, ...args: unknown[]): void;
    warn(msg: string, ...args: unknown[]): void;
    debug?(msg: string, ...args: unknown[]): void;
    /**
     * Execution failures log here when available (falling back to `warn`).
     * ERROR matters operationally: the CLI's boot-quiet window swallows
     * stdout (debug/info/warn) but stderr (error/fatal) always lands — so a
     * per-record sweep failure stays visible. Mirrors the record-change
     * trigger's logger surface.
     */
    error?(msg: string, ...args: unknown[]): void;
}

const JOB_PREFIX = 'flow-schedule';

/**
 * Report a scheduled flow that failed to bind to the job service.
 *
 * **Why this is `error` and not `warn`** — the repo's degradation-log-level
 * rule (AGENTS.md) decides the level with one question: after the degradation,
 * does the system still look normal from the outside while something it claims
 * is in place has not landed? Here it does, completely: the flow stays
 * published and active in `sys_metadata`, Studio lists it, the metadata API
 * serves it and `verify_build` passes — while nothing will ever fire it. That
 * is persisted state and runtime state disagreeing, which the rule puts in the
 * `error` class, not the functional-degradation class.
 *
 * The neighbouring composition branch — "no job service is registered at all" —
 * deliberately stays at `warn`: the system is *visibly* smaller and the rule
 * names that exact message as correctly a `warn`. The distinction is not the
 * severity of the outcome, it is whether the outside can see it.
 *
 * An `error` here owes two things, both in the first line it prints: the
 * concrete consequence (including that everything else keeps looking healthy)
 * and the remedy. Kept in one helper so both triggers say it the same way.
 */
export function reportBindFailure(
    logger: TriggerLogger,
    tag: 'schedule' | 'time-relative',
    flowName: string,
    err: unknown,
): void {
    const report = logger.error?.bind(logger) ?? logger.warn.bind(logger);
    report(
        `[${tag}] flow '${flowName}' FAILED to bind to the job service: ${(err as Error)?.message ?? String(err)}. ` +
            'The flow stays published and active — Studio, the metadata API and verify_build all keep reporting it ' +
            'healthy — but nothing will fire it until it binds. Re-publish the flow (or restart the environment) to retry.',
    );
}

/**
 * Normalize a flow's raw `schedule` descriptor into a {@link JobSchedule}, or
 * `null` if it can't be understood. Accepts the canonical
 * `{ type: 'cron'|'interval'|'once', ... }` shape plus a few ergonomic
 * shorthands (a bare cron string, `{ cron }`, `{ expression }`, `{ every }` /
 * `{ intervalMs }`, `{ at }`).
 */
export function normalizeSchedule(raw: unknown): JobSchedule | null {
    if (raw == null) return null;

    // Bare cron string, e.g. '0 1 * * *'.
    if (typeof raw === 'string') {
        const expr = raw.trim();
        return expr ? { type: 'cron', expression: expr } : null;
    }

    if (typeof raw !== 'object') return null;
    const s = raw as Record<string, unknown>;

    const type = typeof s.type === 'string' ? s.type : undefined;

    if (type === 'cron' || (!type && (typeof s.cron === 'string' || typeof s.expression === 'string'))) {
        const expression =
            (typeof s.expression === 'string' && s.expression) ||
            (typeof s.cron === 'string' && s.cron) ||
            undefined;
        if (!expression) return null;
        const out: JobSchedule = { type: 'cron', expression };
        if (typeof s.timezone === 'string') out.timezone = s.timezone;
        return out;
    }

    if (type === 'interval' || (!type && (typeof s.intervalMs === 'number' || typeof s.every === 'number'))) {
        const intervalMs =
            (typeof s.intervalMs === 'number' && s.intervalMs) ||
            (typeof s.every === 'number' && s.every) ||
            undefined;
        if (!intervalMs || intervalMs <= 0) return null;
        return { type: 'interval', intervalMs };
    }

    if (type === 'once' || (!type && typeof s.at === 'string')) {
        const at = typeof s.at === 'string' ? s.at : undefined;
        if (!at) return null;
        return { type: 'once', at };
    }

    return null;
}

/**
 * ScheduleTrigger
 *
 * Bridges the automation engine's {@link FlowTrigger} extension point to the
 * platform {@link JobServiceSurface}. For each schedule-triggered flow the
 * engine activates, it registers a job whose handler runs the flow; the job
 * service owns the actual cron/interval/once timing (so this trigger stays
 * adapter-agnostic — cron schedules need a cron-capable adapter, which the
 * job service selects).
 *
 * The job service is resolved lazily (per `start()`) via the supplied accessor,
 * so we always pick up the job service's *upgraded* adapter (e.g. the durable
 * DbJobAdapter that replaces the bootstrap interval adapter on `kernel:ready`).
 *
 * ## Once-per-window delivery (#14501)
 *
 * A scheduled flow claims a `(flow, tick-window)` key in the shared
 * `sys_flow_dispatch` ledger before it launches, and settles that claim with
 * the run's outcome afterwards — the same ledger the time-relative trigger
 * claims per `(flow, record, window)` (#10220), with the key shape the
 * maintainer's A + a2 ruling named. Three doors close at once:
 *
 *  - a second tick inside one window finds the claim and does nothing;
 *  - a restart inside a window is that same case, because the key is a pure
 *    function of the schedule descriptor and the clock, not of process state;
 *  - an operator `replay()` of a window that was DELIVERED is refused with an
 *    ADR-0112 `RESOURCE_CONFLICT` / 409 envelope, via the
 *    {@link ReplayGuard} this trigger registers on the job service.
 *
 * What did NOT change is the error isolation: a throwing flow is still caught
 * and swallowed so the ticker survives. It stopped being SILENT — the throw
 * settles the window's claim `failed`, and a plain `replay()` re-runs a failed
 * window — but the ticker's protection is unchanged and must stay that way.
 */
export class ScheduleTrigger implements FlowTrigger {
    readonly type = 'schedule';

    private readonly getJobService: () => JobServiceSurface | null;
    private readonly logger: TriggerLogger;
    /** flowName → job name registered for it, so stop() can cancel it. */
    private readonly bound = new Map<string, string>();
    /** Dispatch-claim ledger (#14501), resolved lazily per fire. */
    private readonly getLedger: () => ScheduleDispatchLedger | null;
    /** Injectable clock so window math is deterministic under test. */
    private readonly now: () => Date;
    /**
     * flowName → the ONE dispatch key a {@link ReplayGuard} has authorised for
     * re-dispatch (#14501). A replay of a window whose claim is absent or
     * failed must actually re-run it — but the handler's own claim gate would
     * see the existing row and no-op, so the guard leaves a one-shot pass here
     * and the handler consumes it. In-process by construction and correctly
     * so: the pass is written and read inside a single `replay()` call chain.
     *
     * Keyed by FLOW rather than accumulated in a set, so a pass a job service
     * asked for and then abandoned is overwritten by the next one instead of
     * outliving its window — at most one outstanding pass per bound flow, and
     * `stop()` takes it with the binding.
     *
     * ⚠️ Residue is therefore bounded but not zero: an abandoned pass survives
     * until this flow's next guard call replaces it, or `stop()` drops it. A
     * later fire does NOT clear it — the handler deletes the entry only when
     * the pass MATCHES the window it just computed — so an abandoned pass
     * outlives every fire in every other window. It stays inert through all of
     * them for the same reason: a pass naming a window that has passed can
     * never match again. Its blast radius is one fire of one flow inside the
     * window the pass names, and only if that window is still current — a fire
     * that would have been a no-op runs instead.
     */
    private readonly replayPasses = new Map<string, string>();
    /** Whether the in-process-only dedup degradation has been said (once). */
    private claimDegradationWarned = false;
    /** Whether the "no replay guard could be installed" degradation has been said (once). */
    private replayGuardDegradationWarned = false;

    constructor(
        getJobService: () => JobServiceSurface | null,
        logger: TriggerLogger,
        getLedger: () => ScheduleDispatchLedger | null = () => null,
        now: () => Date = () => new Date(),
    ) {
        this.getJobService = getJobService;
        this.logger = logger;
        this.getLedger = getLedger;
        this.now = now;
    }

    start(binding: FlowTriggerBinding, callback: (ctx: AutomationContext) => Promise<void>): void {
        const raw = binding.schedule ?? (binding.config as Record<string, unknown> | undefined)?.schedule;
        const schedule = normalizeSchedule(raw);
        if (!schedule) {
            this.logger.warn(
                `[schedule] flow '${binding.flowName}' has no recognizable schedule descriptor — not bound`,
            );
            return;
        }

        const jobService = this.getJobService();
        if (!jobService || typeof jobService.schedule !== 'function') {
            this.logger.warn(
                `[schedule] job service unavailable — flow '${binding.flowName}' not scheduled`,
            );
            return;
        }

        // Idempotent: drop any prior schedule for this flow before re-binding
        // (covers disable→enable cycles and hot reload).
        this.stop(binding.flowName);

        const jobName = `${JOB_PREFIX}:${binding.flowName}`;

        const handler: JobHandler = async ({ jobId }) => {
            // #14501 — once-per-(flow, tick-window) delivery. The key is
            // computed from the schedule descriptor, so it is the same value
            // on a re-tick inside the window, after a restart inside the
            // window, and at an operator replay.
            const window = computeTickWindow(schedule, this.now());
            const key = window ? scheduleDispatchKey(binding.flowName, window) : null;
            if (key) {
                // A guard-issued pass means this run IS the re-dispatch of a
                // window whose claim was absent or failed (or a forced replay
                // of a delivered one): claim anyway so the ledger records the
                // dispatch, but do not let a claim miss stop it.
                const replayPass = this.replayPasses.get(binding.flowName) === key;
                if (replayPass) this.replayPasses.delete(binding.flowName);
                const claimed = await this.claimDispatch(binding.flowName, key);
                if (!claimed && !replayPass) {
                    this.logger.debug?.(
                        `[schedule] flow '${binding.flowName}' already dispatched for ${window!.label} — skipping`,
                    );
                    return;
                }
            }
            try {
                const ctx: AutomationContext = {
                    event: 'schedule',
                    params: {
                        jobId,
                        flowName: binding.flowName,
                        schedule,
                    },
                };
                await callback(ctx);
                if (key) await this.settleDispatch(binding.flowName, key, 'succeeded');
            } catch (err) {
                // Error isolation: a scheduled flow failure must not crash the
                // job runner / ticker. Log and swallow.
                //
                // #14501 kept the swallow — it is what protects the ticker,
                // and the ruling says so explicitly — and took away only its
                // silence: the window's claim is settled `failed`, so the run
                // is no longer indistinguishable from a delivered one and a
                // plain `replay()` re-runs it.
                this.logger.warn(
                    `[schedule] flow '${binding.flowName}' execution failed: ${(err as Error)?.message ?? String(err)}`,
                );
                if (key) await this.settleDispatch(binding.flowName, key, 'failed');
            }
        };

        this.installReplayGuard(jobService, jobName, binding.flowName, schedule);

        this.bound.set(binding.flowName, jobName);
        // FlowTrigger.start is sync; the job service's schedule() is async.
        // Fire-and-forget with error logging.
        void Promise.resolve(jobService.schedule(jobName, schedule, handler))
            .then(() => {
                this.logger.info(
                    `[schedule] bound flow '${binding.flowName}' → ${schedule.type}` +
                        (schedule.expression ? ` '${schedule.expression}'` : '') +
                        (schedule.intervalMs ? ` every ${schedule.intervalMs}ms` : '') +
                        (schedule.at ? ` at ${schedule.at}` : ''),
                );
            })
            .catch((err) => {
                this.bound.delete(binding.flowName);
                reportBindFailure(this.logger, 'schedule', binding.flowName, err);
            });
    }

    /**
     * Install the `replay()` pre-flight for this job (#14501), when the job
     * service has somewhere to put one.
     *
     * Degradation contract, declared once: a job service without
     * `setReplayGuard` (the bootstrap `IntervalJobAdapter`, any adapter
     * predating #14501) keeps every other guarantee here — a second tick in a
     * window is still a no-op, a throw is still recorded failed — but an
     * operator replay of a DELIVERED window can no longer be refused loudly.
     * It hits the handler's claim gate and returns having done nothing, which
     * is the silent no-op the ruling exists to prevent, so it is said out loud
     * here instead.
     *
     * ⚠ Said only when a ledger is actually attached. With no ledger nothing is
     * ever RECORDED as delivered, so there is no refusal to lose and the line
     * would be a false alarm — that deployment's real degradation is the
     * "delivery is NOT deduplicated" warning {@link claimDispatch} already
     * emits, and stacking a second, vacuous warning on top of it buries the
     * one that matters.
     */
    private installReplayGuard(
        jobService: JobServiceSurface,
        jobName: string,
        flowName: string,
        schedule: JobSchedule,
    ): void {
        if (typeof jobService.setReplayGuard !== 'function') {
            if (!this.replayGuardDegradationWarned && this.getLedger() !== null) {
                this.replayGuardDegradationWarned = true;
                this.logger.warn(
                    `[schedule] job service has no replay guard registration — a replay of a scheduled flow's ` +
                        `ALREADY-DELIVERED tick window cannot be refused and will quietly do nothing instead of ` +
                        `raising RESOURCE_CONFLICT. Ticks are unaffected.`,
                );
            }
            return;
        }
        jobService.setReplayGuard(jobName, async ({ force }) => {
            const window = computeTickWindow(schedule, this.now());
            if (!window) return { allow: true };
            const key = scheduleDispatchKey(flowName, window);
            const claim = force ? null : await this.readDispatch(flowName, key);
            if (claim?.outcome === 'succeeded') {
                return { allow: false, window: window.label, claimedAt: claim.claimedAt };
            }
            // Absent, failed, unsettled, or forced — this replay re-runs the
            // window, so let the handler past its own claim gate exactly once.
            this.replayPasses.set(flowName, key);
            return { allow: true };
        });
    }

    /**
     * Claim one `(flow, tick-window)` dispatch key (#14501): `true` = launch,
     * `false` = this window was already dispatched (an earlier tick this
     * process, or a previous process lifetime).
     *
     * Degradation contract, deliberately identical to the time-relative
     * trigger's: a ledger call that THROWS dispatches anyway (availability
     * over strict-once — a broken ledger must never silently swallow a
     * digest), and a missing ledger is warned once because the once-per-window
     * guarantee then no longer survives a kernel rebuild.
     */
    private async claimDispatch(flowName: string, key: string): Promise<boolean> {
        const ledger = this.getLedger();
        if (ledger && typeof ledger.claim === 'function') {
            try {
                return await ledger.claim(key);
            } catch (err) {
                this.logger.warn(
                    `[schedule] flow '${flowName}' dispatch-claim failed for key '${key}' — dispatching anyway ` +
                        `(availability over strict-once; the same window may re-fire until the claim store recovers): ` +
                        `${(err as Error)?.message ?? String(err)}`,
                );
                return true;
            }
        }
        if (!this.claimDegradationWarned) {
            this.claimDegradationWarned = true;
            this.logger.warn(
                `[schedule] no dispatch-claim surface (automation service missing or without claim()) — ` +
                    `scheduled-flow delivery is NOT deduplicated: a restart inside a tick window, or an operator ` +
                    `replay, can deliver the same window twice.`,
            );
        }
        return true;
    }

    /** Record what a dispatch turned into. Best-effort: never fails the run. */
    private async settleDispatch(
        flowName: string,
        key: string,
        outcome: ScheduleDispatchOutcome,
    ): Promise<void> {
        const ledger = this.getLedger();
        if (!ledger || typeof ledger.settleDispatch !== 'function') return;
        try {
            await ledger.settleDispatch(key, outcome);
        } catch (err) {
            this.logger.warn(
                `[schedule] flow '${flowName}' could not record dispatch outcome '${outcome}' for key '${key}' — ` +
                    `the claim stays unsettled and reads as NOT delivered, so a later replay is allowed through: ` +
                    `${(err as Error)?.message ?? String(err)}`,
            );
        }
    }

    /** Read one dispatch claim. A ledger that cannot answer reports `null`. */
    private async readDispatch(flowName: string, key: string): Promise<ScheduleDispatchClaim | null> {
        const ledger = this.getLedger();
        if (!ledger || typeof ledger.readDispatch !== 'function') return null;
        try {
            return await ledger.readDispatch(key);
        } catch (err) {
            this.logger.warn(
                `[schedule] flow '${flowName}' dispatch-claim read failed for key '${key}' — treating the window as ` +
                    `unclaimed so the replay proceeds: ${(err as Error)?.message ?? String(err)}`,
            );
            return null;
        }
    }

    stop(flowName: string): void {
        const jobName = this.bound.get(flowName);
        if (!jobName) return;
        this.bound.delete(flowName);
        this.replayPasses.delete(flowName);
        const jobService = this.getJobService();
        if (!jobService || typeof jobService.cancel !== 'function') return;
        if (typeof jobService.setReplayGuard === 'function') {
            try { jobService.setReplayGuard(jobName, null); } catch { /* the cancel below is what matters */ }
        }
        void Promise.resolve(jobService.cancel(jobName))
            .then(() => this.logger.debug?.(`[schedule] unbound flow '${flowName}'`))
            .catch((err) => {
                this.logger.warn(
                    `[schedule] failed to unbind flow '${flowName}': ${(err as Error)?.message ?? String(err)}`,
                );
            });
    }
}
