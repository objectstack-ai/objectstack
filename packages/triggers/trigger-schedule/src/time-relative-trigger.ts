// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import type { AutomationContext, JobSchedule, JobHandler } from '@objectstack/spec/contracts';
import {
    TimeRelativeTriggerSchema,
    TIME_RELATIVE_DEFAULT_CRON,
    TIME_RELATIVE_DEFAULT_MAX_RECORDS,
} from '@objectstack/spec/automation';
import type { TimeRelativeTrigger as TimeRelativeDescriptor } from '@objectstack/spec/automation';
import {
    normalizeSchedule,
    reportBindFailure,
    refuseMissingOrganization,
    resolveBindingOrganization,
} from './schedule-trigger.js';
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
            /**
             * The sweep's execution context. Two INDEPENDENT axes, and this
             * sweep sets both (#16659):
             *
             *  - `isSystem` is AUTHORIZATION — a background sweep must see
             *    every row the organization holds, not the RLS-scoped subset
             *    some absent user would see.
             *  - `tenantId` is TENANCY — which organization those rows belong
             *    to. The engine turns it into `DriverOptions.tenantId` and the
             *    driver scopes the read.
             *
             * The engine's own contract keeps them apart in as many words
             * (`Engine.buildDriverOptions`: *"System / isSystem callers may
             * still cross tenants by clearing `tenantId` themselves"*), so
             * elevating a sweep has never implied unscoping it — the previous
             * shape simply never passed the second one. Both members are
             * `ExecutionContext` keys the engine's `find` already accepts
             * (`EngineQueryOptions.context` is `ExecutionContextSchema.partial()`),
             * so naming `tenantId` here widens no contract; it declares the
             * slice of one this trigger uses.
             */
            context?: { isSystem?: boolean; tenantId?: string };
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

/**
 * The slice of the automation service this trigger needs for dispatch
 * idempotency (#10220): claim a dispatch key against the persisted
 * `sys_flow_dispatch` ledger. `true` = this caller owns the dispatch; `false` =
 * an earlier sweep (possibly in a previous process lifetime) already made it.
 * Typed structurally — like {@link TimeRelativeDataEngine} — so this plugin
 * never learns the ledger's table name and takes no build dependency on
 * `@objectstack/service-automation`.
 */
export interface FlowDispatchClaimSurface {
    claim(key: string): Promise<boolean>;
}

/** Job-name namespace so time-relative sweeps never collide with plain schedule jobs. */
const JOB_PREFIX = 'flow-time-relative';

const MS_PER_DAY = 86_400_000;

/**
 * TTL for the trigger's IN-PROCESS claim fallback (#10220): every dispatch key
 * embeds a calendar day, so no key is producible more than ~48h after it was
 * first claimable — pruning at that age keeps the fallback map bounded without
 * ever forgetting a key a sweep could still produce.
 */
const LOCAL_CLAIM_TTL_MS = 48 * 60 * 60 * 1000;

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
    return computeWindowClaimScopes(desc, now).map((s) => s.window);
}

/**
 * A date window paired with the **claim scope** naming its identity for the
 * dispatch dedup key (#10220, maintainer ruling 2026-08-20).
 */
export interface WindowClaimScope {
    window: DateWindow;
    /**
     * Window-identity fragment of the dispatch key — what makes a re-scan of
     * the SAME window dedup while a genuinely new window fires again:
     *
     * - offset mode → `<windowDay>:offset<n>`: the window day is the date the
     *   record's field must fall on, so editing the field to a new day (or a
     *   different offset matching) yields a new key and legitimately re-fires.
     *   Re-scans of one window all derive the same day → deduped.
     * - range mode → `<sweepDay>:within<n>`: keyed on the SWEEP day, not the
     *   (constant) field value, so the documented `withinDays` semantic —
     *   "fires every day the record stays in range" — remains true: each new
     *   day is a new key, but never twice in one day.
     */
    scope: string;
}

/**
 * {@link computeDateWindows}, with each window's claim scope (#10220). One
 * derivation for both so the matching rule and the dedup key can never drift.
 */
export function computeWindowClaimScopes(desc: TimeRelativeDescriptor, now: Date): WindowClaimScope[] {
    const today = startOfUtcDay(now);

    if (desc.offsetDays && desc.offsetDays.length > 0) {
        return desc.offsetDays.map((offset) => {
            const day = addUtcDays(today, offset);
            const window = { gte: startOfUtcDay(day).toISOString(), lte: endOfUtcDay(day).toISOString() };
            return { window, scope: `${window.gte.slice(0, 10)}:offset${offset}` };
        });
    }

    const n = desc.withinDays ?? 0;
    const sweepDay = today.toISOString().slice(0, 10);
    const window: DateWindow =
        n >= 0
            ? { gte: startOfUtcDay(today).toISOString(), lte: endOfUtcDay(addUtcDays(today, n)).toISOString() }
            // Negative: window extends into the past, still anchored to (and including) today.
            : { gte: startOfUtcDay(addUtcDays(today, n)).toISOString(), lte: endOfUtcDay(today).toISOString() };
    return [{ window, scope: `${sweepDay}:within${n}` }];
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

/**
 * [#16659] Why the engine will DROP this sweep's tenant scope for `schema`, or
 * `null` when it will apply it.
 *
 * `Engine.buildDriverOptions` scopes a read by `context.tenantId` unless the
 * object opts out, and it documents exactly two opt-outs: `tenancy.enabled:
 * false` (ADR-0066 — a platform-global catalog, whose NULL-organization rows
 * would vanish under a scope) and `external != null` (ADR-0015 — a federated
 * object whose table belongs to a remote database, where the platform has no
 * ground to guess a tenant column onto someone else's schema).
 *
 * ⛔ This is NOT a copy of that predicate for the sweep to act on — the sweep
 * passes `tenantId` either way and lets the engine decide. It exists so the
 * bind line can SAY that a declared organization is inert for this object,
 * which is the one case where the ruling's containment is not achievable and
 * the flow's declaration would otherwise imply it is. Read from the schema the
 * engine's own `getObject` hands back; an unrecognised shape answers `null`
 * (say nothing) rather than guessing.
 *
 * Module-private on purpose: its only consumer is the bind line below, and this
 * package's barrel already states the rule that an export with no consumer
 * outside its own package does not belong in it.
 */
function organizationScopeIsInertFor(schema: unknown): string | null {
    if (!schema || typeof schema !== 'object') return null;
    const s = schema as { tenancy?: { enabled?: unknown } | null; external?: unknown };
    if (s.tenancy?.enabled === false) return 'declares `tenancy: { enabled: false }` (ADR-0066, platform-global)';
    if (s.external != null) return 'is a federated object (ADR-0015 `external`), whose table the remote database owns';
    return null;
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
    /** Dispatch-idempotency claim surface (#10220), resolved lazily per sweep. */
    private readonly getClaimSurface: () => FlowDispatchClaimSurface | null;
    /**
     * In-process claim fallback when no claim surface resolves (#10220):
     * key → claim time (epoch ms), TTL-pruned. Dedups re-scans within THIS
     * process only — which is why falling to it is warned once, below.
     */
    private readonly localClaims = new Map<string, number>();
    /** Whether the in-process-only dedup degradation has been said (once). */
    private claimDegradationWarned = false;

    constructor(
        getJobService: () => JobServiceSurface | null,
        getDataEngine: () => TimeRelativeDataEngine | null,
        logger: TriggerLogger,
        now: () => Date = () => new Date(),
        getClaimSurface: () => FlowDispatchClaimSurface | null = () => null,
    ) {
        this.getJobService = getJobService;
        this.getDataEngine = getDataEngine;
        this.logger = logger;
        this.now = now;
        this.getClaimSurface = getClaimSurface;
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

        // [#16659] A time-relative sweep launches from a clock, exactly as a
        // plain schedule flow does, so it owes the same declaration and takes
        // the same refusal. It is NOT the weaker case for carrying an
        // organization, it is the stronger one: the sweep runs ELEVATED
        // (`isSystem`, deliberately — a background sweep must see all rows
        // rather than RLS-scoped ones), so the declaration is the only thing
        // that keeps its SELECTION inside one organization. Without it the
        // sweep would match rows in every tenant and then launch runs able to
        // write into none of them; with it the same value bounds the query and
        // the run (see `sweep`'s `organization` parameter).
        const organization = resolveBindingOrganization(binding);
        if (organization === null) {
            // Drop any prior sweep FIRST: a hot re-publish that removes the key
            // must not leave the previous, still-armed job sweeping org-less
            // behind an error saying it was refused. The call below throws, so
            // the engine's catch records the refusal instead of marking this
            // flow bound — see `refuseMissingOrganization`'s header for why a
            // logged-and-returned refusal is invisible to every audit surface.
            this.stop(binding.flowName);
            refuseMissingOrganization(this.logger, 'time-relative', binding.flowName, binding);
        }

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
            } else {
                const inertBecause = organizationScopeIsInertFor(known);
                if (inertBecause) {
                    // [#16659] ⛔ A DISCLOSURE, never a narrowing. The sweep
                    // passes `context.tenantId` unconditionally and the ENGINE
                    // decides whether it applies; this branch re-reads the two
                    // declarations the engine documents as its exemptions
                    // (`tenancy.enabled: false`, ADR-0066; `external`,
                    // ADR-0015) purely so the operator is told when their
                    // declaration cannot narrow anything. Nothing here changes
                    // which rows come back, so if this predicate ever drifts
                    // from the engine's, the cost is a wrong WARNING — never a
                    // wrong row. That is the only reason a second reading of
                    // tenancy is tolerable in a trigger at all.
                    //
                    // Saying it matters because the quiet direction here is the
                    // dangerous one: the sweep keeps selecting across every
                    // organization, exactly as it did before this card, while
                    // the flow's `organization` line makes it LOOK contained.
                    this.logger.warn(
                        `[time-relative] flow '${binding.flowName}' sweeps '${desc.object}', which ${inertBecause} — the engine applies no tenant scope to such an object, so the declared organization does NOT narrow this sweep: it still selects rows in every organization, while each run it launches acts as the declared one. ` +
                            `If '${desc.object}' really is per-organization data, that declaration on the OBJECT is what to fix.`,
                    );
                }
            }
        }

        // Idempotent: drop any prior schedule for this flow before re-binding
        // (covers disable→enable cycles and hot reload).
        this.stop(binding.flowName);

        const jobName = `${JOB_PREFIX}:${binding.flowName}`;
        const maxRecords = desc.maxRecords ?? TIME_RELATIVE_DEFAULT_MAX_RECORDS;

        const handler: JobHandler = async () => {
            try {
                await this.sweep(binding.flowName, desc, maxRecords, organization, callback);
            } catch (err) {
                // Error isolation: a sweep failure must not crash the job
                // runner / ticker. Log and swallow.
                //
                // [#16659] At `error` when the logger has one, for the reason
                // {@link TriggerLogger.error} already states: the CLI's
                // boot-quiet window swallows stdout, so a `warn` here can be
                // the whole of what a broken sweep says and still be invisible.
                // Since the query became organization-scoped, "this sweep can
                // no longer see anything" is a REACHABLE state — a store that
                // cannot honour the scope refuses the call rather than
                // answering it unscoped — and a sweep that selects nothing for
                // a structural reason must be as loud as one that crashed.
                const log = this.logger.error?.bind(this.logger) ?? this.logger.warn.bind(this.logger);
                log(
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
                // [#16659] The organization is on the BIND line, not only in
                // the refusal: it is now the sweep's selection scope as well as
                // the run's identity, so "which rows can this flow ever see" is
                // answerable from the boot log instead of from the metadata.
                this.logger.info(
                    `[time-relative] bound flow '${binding.flowName}' → sweep '${desc.object}.${desc.dateField}' ${mode} on ${schedule.type}` +
                        (schedule.expression ? ` '${schedule.expression}'` : '') +
                        (schedule.intervalMs ? ` every ${schedule.intervalMs}ms` : '') +
                        ` as organization '${organization}'`,
                );
            })
            .catch((err) => {
                this.bound.delete(binding.flowName);
                reportBindFailure(this.logger, 'time-relative', binding.flowName, err);
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
        /**
         * [#16659] The declared organization. It bounds this sweep TWICE, and
         * both halves are load-bearing:
         *
         *  1. SELECTION — it goes onto the `find` context as `tenantId`, so the
         *     rows this sweep can match are the declared organization's. Without
         *     it the sweep is a cross-organization scheduled task whatever the
         *     run is stamped with.
         *  2. IDENTITY — every run launched from a matched row executes as it.
         *
         * Required, not optional: `start()` refuses the binding without one, so
         * a sweep can never be reached with nothing to pass.
         */
        organization: string,
        callback: (ctx: AutomationContext) => Promise<void>,
    ): Promise<void> {
        const engine = this.getDataEngine();
        if (!engine || typeof engine.find !== 'function') {
            this.logger.warn(
                `[time-relative] data engine unavailable — flow '${flowName}' sweep skipped this tick`,
            );
            return;
        }

        const scopes = computeWindowClaimScopes(desc, this.now());
        const seenIds = new Set<unknown>();
        const matched: Array<{ record: Record<string, unknown>; claimKey: string | null }> = [];

        for (const { window, scope } of scopes) {
            if (matched.length >= maxRecords) break;
            const where = buildWindowWhere(desc, window);
            const rows =
                (await engine.find(desc.object, {
                    where,
                    limit: maxRecords,
                    // [#16659] SELECTION is scoped to the declared organization,
                    // not just the run that follows it.
                    //
                    // `isSystem` alone was the whole context here, and it made
                    // this sweep a cross-organization scheduled task — the thing
                    // the ruling forbids — with the declaration papering over
                    // it: a sweep declared for A still MATCHED rows in B, then
                    // launched a run stamped A about B's record. Downstream that
                    // is worse than the original defect, not better: the run's
                    // `update_record` matches nothing (silently, because the run
                    // is scoped to A), `notify` posts into A's inbox about B's
                    // record, and the history row is stamped from the SUBJECT,
                    // so it lands under B. One run, three organizations'
                    // opinions about who it belonged to.
                    //
                    // ⛔ Not a hand-built `organization_id` predicate on
                    // `where`. That would be a SECOND implementation of tenancy
                    // living in a trigger: it would hardcode a column name the
                    // object is free to rename (`tenancy.tenantField`), select
                    // NOTHING on a platform-global object that carries no such
                    // column, break a federated object outright, and — worst —
                    // read as a scoped query to a driver that never learned the
                    // caller wanted scoping, so a driver with no isolation would
                    // answer it silently instead of refusing it. The platform
                    // already owns this: `Engine.buildDriverOptions` turns
                    // `context.tenantId` into `DriverOptions.tenantId`, drops it
                    // for the two postures where it must not apply
                    // (`tenancy.enabled: false`, ADR-0066; federated, ADR-0015),
                    // and every driver that CAN isolate then scopes, while
                    // `driver-memory` — which cannot — refuses the call by name
                    // (#16589). Refusal is the correct answer for a sweep that
                    // is required to stay inside one organization and is talking
                    // to a store that cannot keep it there, and it arrives as a
                    // logged sweep failure rather than as silence.
                    context: { isSystem: true, tenantId: organization },
                })) ?? [];
            for (const row of rows) {
                const id = (row as { id?: unknown }).id;
                // Dedup across windows (offset mode) by id; rows without an id
                // are always kept (can't dedup, better than dropping).
                if (id != null) {
                    if (seenIds.has(id)) continue;
                    seenIds.add(id);
                }
                // #10220 — dispatch key: the MATCHED WINDOW's identity + the
                // record. A row without an id can't be keyed; it is dispatched
                // unconditionally, exactly as it was never dedupable before.
                const claimKey = id != null ? `time-relative:${flowName}:${scope}:${String(id)}` : null;
                matched.push({ record: row, claimKey });
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
        let deduped = 0;
        for (const { record, claimKey } of matched) {
            // #10220 — idempotency gate: launch only if this (flow, record,
            // window) key has not been dispatched before. A re-scan of the same
            // window (denser schedule, kernel rebuild + persisted ledger,
            // future catch-up sweep) skips instead of re-minting.
            if (claimKey != null && !(await this.claimDispatch(flowName, claimKey))) {
                deduped++;
                continue;
            }
            try {
                const ctx: AutomationContext = {
                    record,
                    object: desc.object,
                    event: 'time_relative',
                    // [#16659] The declared acting organization — the same key
                    // a record-change run inherits from its triggering session,
                    // and the one `notify-node.ts` and the run-history writer
                    // already read. ⛔ Never derived from the swept RECORD's
                    // own `organization_id`: the sweep runs elevated and can
                    // match rows in any tenant, so keying on the row would let
                    // one flow write into organizations it never declared —
                    // the cross-organization scheduled task the ruling forbids.
                    tenantId: organization,
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
            `[time-relative] flow '${flowName}' swept '${desc.object}' as organization '${organization}': ${matched.length} matched, ${launched} launched, ${deduped} already dispatched, ${failed} failed`,
        );
    }

    /**
     * Claim one dispatch key (#10220): `true` = launch, `false` = an earlier
     * sweep already dispatched this (flow, record, window).
     *
     * Degradation contract:
     *  - Claim surface resolves (the automation service's `claim()`, backed by
     *    the persisted `sys_flow_dispatch` ledger) → its answer is used; if the
     *    CALL throws, the failure is logged and the dispatch proceeds —
     *    availability over strict-once: a broken ledger must never silently
     *    swallow reminders.
     *  - No claim surface (automation service missing, or one predating
     *    `claim()`) → in-process dedup only, warned ONCE: a silent fallback
     *    would hide that the once-per-window guarantee no longer survives a
     *    kernel rebuild.
     */
    private async claimDispatch(flowName: string, key: string): Promise<boolean> {
        const surface = this.getClaimSurface();
        if (surface && typeof surface.claim === 'function') {
            try {
                return await surface.claim(key);
            } catch (err) {
                this.logger.warn(
                    `[time-relative] flow '${flowName}' dispatch-claim failed for key '${key}' — dispatching anyway ` +
                        `(availability over strict-once; the same window may re-fire until the claim store recovers): ${errMessage(err)}`,
                );
                return true;
            }
        }
        if (!this.claimDegradationWarned) {
            this.claimDegradationWarned = true;
            this.logger.warn(
                `[time-relative] no dispatch-claim surface (automation service missing or without claim()) — ` +
                    `sweep dedup is IN-PROCESS ONLY and will NOT survive a kernel rebuild: ` +
                    `the same record/window can re-fire after a restart.`,
            );
        }
        const now = this.now().getTime();
        const cutoff = now - LOCAL_CLAIM_TTL_MS;
        for (const [k, t] of this.localClaims) {
            if (t < cutoff) this.localClaims.delete(k);
        }
        if (this.localClaims.has(key)) return false;
        this.localClaims.set(key, now);
        return true;
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
