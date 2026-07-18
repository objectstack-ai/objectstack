// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import type { AutomationContext, JobSchedule, JobHandler } from '@objectstack/spec/contracts';
import {
    TimeRelativeTriggerSchema,
    TIME_RELATIVE_DEFAULT_CRON,
    TIME_RELATIVE_DEFAULT_MAX_RECORDS,
} from '@objectstack/spec/automation';
import type { TimeRelativeTrigger as TimeRelativeDescriptor } from '@objectstack/spec/automation';
import { normalizeSchedule } from './schedule-trigger.js';
import type { FlowTrigger, FlowTriggerBinding, JobServiceSurface, TriggerLogger } from './schedule-trigger.js';

/**
 * The slice of the ObjectQL data engine this trigger needs: run a filtered
 * `find` (to discover the records whose date field falls in the window) and,
 * optionally, probe whether an object is registered. Typed structurally — same
 * decoupling pattern the record-change trigger uses for its hook surface — so
 * this plugin does not take a build dependency on the engine package.
 */
export interface TimeRelativeDataEngine {
    find(
        objectName: string,
        query?: {
            where?: Record<string, unknown>;
            fields?: string[];
            limit?: number;
            /** Elevated context — a background sweep must see all rows, not RLS-scoped ones. */
            context?: { isSystem?: boolean };
        },
    ): Promise<Array<Record<string, unknown>> | undefined>;
    /**
     * Optional object-existence probe (the ObjectQL engine's `getObject`).
     * When present, {@link TimeRelativeTrigger.start} uses it to call out a
     * descriptor whose `object` matches no registered object at bind time —
     * otherwise the sweep just quietly finds nothing forever.
     */
    getObject?(name: string): unknown;
}

/** Job-name namespace so time-relative sweeps never collide with plain schedule jobs. */
const JOB_PREFIX = 'flow-time-relative';

const MS_PER_DAY = 86_400_000;

/** A closed, inclusive instant window `[gte, lte]` as ISO-8601 strings. */
export interface DateWindow {
    /** Lower bound (inclusive), ISO-8601. */
    gte: string;
    /** Upper bound (inclusive), ISO-8601. */
    lte: string;
}

// ─── Pure window math (day-granular, UTC) ───────────────────────────

/** Start of `d`'s UTC calendar day (00:00:00.000Z). */
function startOfUtcDay(d: Date): Date {
    return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 0, 0, 0, 0));
}

/** End of `d`'s UTC calendar day (23:59:59.999Z) — inclusive upper bound. */
function endOfUtcDay(d: Date): Date {
    return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 23, 59, 59, 999));
}

/** `d`'s UTC day shifted by `n` whole days (exact in UTC — no DST drift). */
function addUtcDays(d: Date, n: number): Date {
    return new Date(startOfUtcDay(d).getTime() + n * MS_PER_DAY);
}

/**
 * Compute the inclusive date window(s) a descriptor selects, relative to `now`.
 *
 * - `offsetDays` → one single-day window per offset (`today + offset`), so the
 *   sweep fires exactly on each threshold day (the robust T-minus reminder).
 * - `withinDays` → one range window: `[today, today + N]` when N ≥ 0 (upcoming),
 *   or `[today − |N|, today]` when N < 0 (overdue lookback). Always includes today.
 *
 * Day-granular and computed in UTC. The upper bound is the *end* of its day
 * (`23:59:59.999Z`), so a `datetime` field matches for the whole day and a
 * `date` field (compared as `YYYY-MM-DD` after the driver truncates) is inclusive.
 */
export function computeDateWindows(desc: TimeRelativeDescriptor, now: Date): DateWindow[] {
    const today = startOfUtcDay(now);

    if (desc.offsetDays && desc.offsetDays.length > 0) {
        return desc.offsetDays.map((offset) => {
            const day = addUtcDays(today, offset);
            return { gte: startOfUtcDay(day).toISOString(), lte: endOfUtcDay(day).toISOString() };
        });
    }

    const n = desc.withinDays ?? 0;
    if (n >= 0) {
        return [{ gte: startOfUtcDay(today).toISOString(), lte: endOfUtcDay(addUtcDays(today, n)).toISOString() }];
    }
    // Negative: window extends into the past, still anchored to (and including) today.
    return [{ gte: startOfUtcDay(addUtcDays(today, n)).toISOString(), lte: endOfUtcDay(today).toISOString() }];
}

/**
 * Build the ObjectQL `where` map for one date window: the descriptor's static
 * `filter` (if any) ANDed with a `$gte`/`$lte` range on the date field. The map
 * form is the canonical filter shape both drivers evaluate verbatim (the same
 * shape the platform's own retention sweep uses).
 */
export function buildWindowWhere(desc: TimeRelativeDescriptor, window: DateWindow): Record<string, unknown> {
    return {
        ...(desc.filter ?? {}),
        [desc.dateField]: { $gte: window.gte, $lte: window.lte },
    };
}

function errMessage(err: unknown): string {
    return (err as Error)?.message ?? String(err);
}

/**
 * TimeRelativeTrigger
 *
 * The declarative answer to "act on records whose date field is coming up (or
 * overdue)" (#1874). Instead of the fragile date-equality-on-record-change
 * pattern (which only fires if the record happens to be edited on the threshold
 * day) or a hand-rolled cron + range query per flow, a flow whose start node
 * declares `config.timeRelative` is swept on a schedule (daily by default) and
 * launched **once per matching record**.
 *
 * It composes the schedule trigger's two collaborators:
 *  - the platform {@link JobServiceSurface} owns the sweep cadence (like the
 *    plain schedule trigger), and
 *  - the {@link TimeRelativeDataEngine} runs the date-window query (like the
 *    record-change trigger reaching ObjectQL).
 *
 * Both are resolved lazily (per call) so adapter upgrades — the durable job
 * adapter that replaces the bootstrap ticker on `kernel:ready`, a late-registered
 * data engine — are always picked up. The engine owns the start-node `condition`
 * gate and `runAs` identity, so this trigger only has to put the matched record
 * on the {@link AutomationContext}; `{record.<field>}` interpolation and the
 * condition work exactly as they do for a record-change flow.
 */
export class TimeRelativeTrigger implements FlowTrigger {
    readonly type = 'time_relative';

    private readonly getJobService: () => JobServiceSurface | null;
    private readonly getDataEngine: () => TimeRelativeDataEngine | null;
    private readonly logger: TriggerLogger;
    /** Injectable clock so window math is deterministic under test. */
    private readonly now: () => Date;
    /** flowName → job name registered for it, so stop() can cancel it. */
    private readonly bound = new Map<string, string>();

    constructor(
        getJobService: () => JobServiceSurface | null,
        getDataEngine: () => TimeRelativeDataEngine | null,
        logger: TriggerLogger,
        now: () => Date = () => new Date(),
    ) {
        this.getJobService = getJobService;
        this.getDataEngine = getDataEngine;
        this.logger = logger;
        this.now = now;
    }

    start(binding: FlowTriggerBinding, callback: (ctx: AutomationContext) => Promise<void>): void {
        const raw = (binding.config as Record<string, unknown> | undefined)?.timeRelative;
        const parsed = TimeRelativeTriggerSchema.safeParse(raw);
        if (!parsed.success) {
            this.logger.warn(
                `[time-relative] flow '${binding.flowName}' has no valid \`timeRelative\` descriptor — not bound. ` +
                    `Provide { object, dateField, and exactly one of withinDays | offsetDays }. ` +
                    `(${parsed.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ')})`,
            );
            return;
        }
        const desc = parsed.data;

        // Cadence: the flow's start-node schedule descriptor, or a daily default.
        // A daily sweep is the whole point (evaluate the window every day so a
        // threshold day is never missed), so an omitted schedule means "daily",
        // not "never".
        const schedule: JobSchedule =
            normalizeSchedule(binding.schedule) ?? { type: 'cron', expression: TIME_RELATIVE_DEFAULT_CRON };

        const jobService = this.getJobService();
        if (!jobService || typeof jobService.schedule !== 'function') {
            this.logger.warn(
                `[time-relative] job service unavailable — flow '${binding.flowName}' not scheduled`,
            );
            return;
        }

        // Best-effort object-existence probe at bind time (the engine may be
        // available now even though the sweep resolves it lazily). A descriptor
        // targeting an unknown object would sweep forever finding nothing.
        const engineNow = this.getDataEngine();
        if (desc.object && engineNow && typeof engineNow.getObject === 'function') {
            let known: unknown;
            try {
                known = engineNow.getObject(desc.object);
            } catch {
                known = undefined;
            }
            if (!known) {
                this.logger.warn(
                    `[time-relative] flow '${binding.flowName}' targets unknown object '${desc.object}' — the sweep is bound but will match nothing until that object is registered. ` +
                        `Object names match exactly; check config.timeRelative.object.`,
                );
            }
        }

        // Idempotent: drop any prior schedule for this flow before re-binding
        // (covers disable→enable cycles and hot reload).
        this.stop(binding.flowName);

        const jobName = `${JOB_PREFIX}:${binding.flowName}`;
        const maxRecords = desc.maxRecords ?? TIME_RELATIVE_DEFAULT_MAX_RECORDS;

        const handler: JobHandler = async () => {
            try {
                await this.sweep(binding.flowName, desc, maxRecords, callback);
            } catch (err) {
                // Error isolation: a sweep failure must not crash the job
                // runner / ticker. Log and swallow.
                this.logger.warn(
                    `[time-relative] flow '${binding.flowName}' sweep failed: ${errMessage(err)}`,
                );
            }
        };

        this.bound.set(binding.flowName, jobName);
        // FlowTrigger.start is sync; the job service's schedule() is async.
        // Fire-and-forget with error logging (mirrors ScheduleTrigger).
        void Promise.resolve(jobService.schedule(jobName, schedule, handler))
            .then(() => {
                const mode = desc.offsetDays
                    ? `offsets [${desc.offsetDays.join(', ')}]d`
                    : `within ${desc.withinDays}d`;
                this.logger.info(
                    `[time-relative] bound flow '${binding.flowName}' → sweep '${desc.object}.${desc.dateField}' ${mode} on ${schedule.type}` +
                        (schedule.expression ? ` '${schedule.expression}'` : '') +
                        (schedule.intervalMs ? ` every ${schedule.intervalMs}ms` : ''),
                );
            })
            .catch((err) => {
                this.bound.delete(binding.flowName);
                this.logger.warn(
                    `[time-relative] failed to schedule flow '${binding.flowName}': ${errMessage(err)}`,
                );
            });
    }

    /**
     * Run one sweep: query each date window, union the matched records (deduped
     * by id, capped at `maxRecords`), and launch the flow once per record. A
     * per-record failure is isolated so one bad row never aborts the batch.
     */
    private async sweep(
        flowName: string,
        desc: TimeRelativeDescriptor,
        maxRecords: number,
        callback: (ctx: AutomationContext) => Promise<void>,
    ): Promise<void> {
        const engine = this.getDataEngine();
        if (!engine || typeof engine.find !== 'function') {
            this.logger.warn(
                `[time-relative] data engine unavailable — flow '${flowName}' sweep skipped this tick`,
            );
            return;
        }

        const windows = computeDateWindows(desc, this.now());
        const seenIds = new Set<unknown>();
        const matched: Array<Record<string, unknown>> = [];

        for (const window of windows) {
            if (matched.length >= maxRecords) break;
            const where = buildWindowWhere(desc, window);
            const rows =
                (await engine.find(desc.object, {
                    where,
                    limit: maxRecords,
                    context: { isSystem: true },
                })) ?? [];
            for (const row of rows) {
                const id = (row as { id?: unknown }).id;
                // Dedup across windows (offset mode) by id; rows without an id
                // are always kept (can't dedup, better than dropping).
                if (id != null) {
                    if (seenIds.has(id)) continue;
                    seenIds.add(id);
                }
                matched.push(row);
                if (matched.length >= maxRecords) break;
            }
        }

        if (matched.length >= maxRecords) {
            this.logger.warn(
                `[time-relative] flow '${flowName}' sweep hit the ${maxRecords}-record cap — some matching records were NOT processed this tick. ` +
                    `Narrow the window/filter, or raise config.timeRelative.maxRecords.`,
            );
        }

        let launched = 0;
        let failed = 0;
        for (const record of matched) {
            try {
                const ctx: AutomationContext = {
                    record,
                    object: desc.object,
                    event: 'time_relative',
                    // Expose the record as params too, so flows with named `isInput`
                    // variables matching record fields get them seeded (parity with
                    // the record-change trigger).
                    params: record,
                };
                await callback(ctx);
                launched++;
            } catch (err) {
                failed++;
                // Error isolation per record: one failing flow run must not stop
                // the sweep. ERROR when available (stderr survives the CLI's
                // boot-quiet stdout window), else warn.
                const log = this.logger.error?.bind(this.logger) ?? this.logger.warn.bind(this.logger);
                log(
                    `[time-relative] flow '${flowName}' failed for record '${String((record as { id?: unknown }).id ?? '?')}': ${errMessage(err)}`,
                );
            }
        }

        this.logger.debug?.(
            `[time-relative] flow '${flowName}' swept '${desc.object}': ${matched.length} matched, ${launched} launched, ${failed} failed`,
        );
    }

    stop(flowName: string): void {
        const jobName = this.bound.get(flowName);
        if (!jobName) return;
        this.bound.delete(flowName);
        const jobService = this.getJobService();
        if (!jobService || typeof jobService.cancel !== 'function') return;
        void Promise.resolve(jobService.cancel(jobName))
            .then(() => this.logger.debug?.(`[time-relative] unbound flow '${flowName}'`))
            .catch((err) => {
                this.logger.warn(
                    `[time-relative] failed to unbind flow '${flowName}': ${errMessage(err)}`,
                );
            });
    }
}
