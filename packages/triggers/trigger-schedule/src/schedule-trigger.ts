// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

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
 * The slice of `IJobService` this trigger needs: schedule a named job and
 * cancel it. Typed structurally so the plugin depends on the spec contract
 * shape, not a concrete adapter.
 */
export interface JobServiceSurface {
    schedule(name: string, schedule: JobSchedule, handler: JobHandler): Promise<void>;
    cancel(name: string): Promise<void>;
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
 */
export class ScheduleTrigger implements FlowTrigger {
    readonly type = 'schedule';

    private readonly getJobService: () => JobServiceSurface | null;
    private readonly logger: TriggerLogger;
    /** flowName → job name registered for it, so stop() can cancel it. */
    private readonly bound = new Map<string, string>();

    constructor(getJobService: () => JobServiceSurface | null, logger: TriggerLogger) {
        this.getJobService = getJobService;
        this.logger = logger;
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
            } catch (err) {
                // Error isolation: a scheduled flow failure must not crash the
                // job runner / ticker. Log and swallow.
                this.logger.warn(
                    `[schedule] flow '${binding.flowName}' execution failed: ${(err as Error)?.message ?? String(err)}`,
                );
            }
        };

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
                this.logger.warn(
                    `[schedule] failed to schedule flow '${binding.flowName}': ${(err as Error)?.message ?? String(err)}`,
                );
            });
    }

    stop(flowName: string): void {
        const jobName = this.bound.get(flowName);
        if (!jobName) return;
        this.bound.delete(flowName);
        const jobService = this.getJobService();
        if (!jobService || typeof jobService.cancel !== 'function') return;
        void Promise.resolve(jobService.cancel(jobName))
            .then(() => this.logger.debug?.(`[schedule] unbound flow '${flowName}'`))
            .catch((err) => {
                this.logger.warn(
                    `[schedule] failed to unbind flow '${flowName}': ${(err as Error)?.message ?? String(err)}`,
                );
            });
    }
}
