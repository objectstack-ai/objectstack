// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { Cron } from 'croner';
import type { AutomationContext } from '@objectstack/spec/contracts';
import type { JobSchedule, JobHandler } from '@objectstack/spec/contracts';
import {
    SCHEDULE_ORGANIZATION_KEY,
    ScheduleOrganizationSchema,
    describeMissingScheduleOrganization,
} from '@objectstack/spec/automation';
import {
    resolveScheduledWorkPolicy,
    SCHEDULED_WORK_DISABLED_REASON,
    type ScheduledWorkPolicy,
} from '@objectstack/types';

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
    /**
     * [#16659] The ACTING ORGANIZATION a time-triggered flow declares on its
     * start node (`config.organization`), lifted onto the binding by the
     * engine's `resolveTriggerBinding` the same way `schedule` is.
     *
     * Optional on this interface and REQUIRED by the two time triggers — the
     * split is deliberate. The interface is the structural mirror of the
     * engine's binding, which is shared with `record_change` and `api` flows
     * that legitimately carry none (their trigger threads the firing session's
     * own tenant). "Absent" is therefore a real state the type must be able to
     * express; what must not exist is a time-triggered run that PROCEEDS
     * without it, and that verdict is {@link resolveBindingOrganization}'s,
     * one layer down.
     */
    readonly organization?: string;
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
 * Resolve the acting organization of a time-triggered binding (#16659), or
 * `null` when the flow declared none.
 *
 * Reads the binding's lifted `organization` first and the raw start-node
 * `config` second. The second read is not redundancy for its own sake: the
 * binding is a STRUCTURAL mirror of the engine's type, so a host running an
 * engine that predates the lift hands this trigger a binding with no
 * `organization` field and a `config` that still carries the author's
 * declaration. Reading only the lifted field there would report a correctly
 * declared flow as organization-less and refuse it — turning an engine-version
 * skew into an authoring error, which is the wrong diagnosis pointed at the
 * wrong person.
 *
 * A present-but-unusable value (empty string, a number) resolves to `null` and
 * takes the refusal path, exactly as {@link resolveScheduleOrganization} does
 * at validation: this trigger and the validator must agree about what counts
 * as declared, or a flow refused by one and admitted by the other is the
 * silent hole again.
 */
export function resolveBindingOrganization(binding: FlowTriggerBinding): string | null {
    const lifted = ScheduleOrganizationSchema.safeParse(binding.organization);
    if (lifted.success) return lifted.data;
    const raw = binding.config?.[SCHEDULE_ORGANIZATION_KEY];
    const declared = ScheduleOrganizationSchema.safeParse(raw);
    return declared.success ? declared.data : null;
}

/**
 * [#17396] The deployment's scheduled-work policy, read once per bind.
 *
 * ⛔ Not memoised at module scope on purpose. {@link resolveScheduledWorkPolicy}
 * reads `process.env` live, and a host that rebinds its flows after changing
 * the environment (the CLI's `--fresh` harness, a test that flips the switch
 * between kernels in one process) must get the value that is current at the
 * bind, not the one the first import happened to see.
 */
function readScheduledWorkPolicy(): ScheduledWorkPolicy {
    return resolveScheduledWorkPolicy();
}

/**
 * Refuse to bind ANY time-triggered flow because package-authored scheduled
 * work is switched off on this deployment (#17396): say so once, then THROW so
 * the flow is never recorded as bound.
 *
 * ## Why this is a distinct refusal and not a variant of the one below
 *
 * The two refusals answer to different people. An undeclared acting
 * organization is an AUTHORING defect with an authoring remedy — write the key.
 * A deployment that has not switched scheduled work on has no defect at all:
 * it is running the configuration it asked for, and the flow it ships is
 * perfectly well-formed. Reporting the second as "binding failed" sends an
 * operator to look for a broken flow, and sends an author to look for a key
 * they may already have written. So the sentence is
 * {@link SCHEDULED_WORK_DISABLED_REASON}, it names the switch and its remedy,
 * and the automation engine's binding audit reports it under its own branch —
 * ⛔ never as "binding failed — see earlier warnings", which is ruled item 6.
 *
 * ## Why `info` and not `warn` or `error`
 *
 * The repo's degradation-log-level rule asks whether the system still looks
 * normal from the outside while something it claims is in place has not
 * landed. Nothing here is claimed: the deployment declared this state, the
 * global default IS this state, and every structured surface reports it. It is
 * the rule's own functional class — "a trigger is not armed" — and it is
 * DELIBERATE, so it sits one step below even that: escalating the default
 * configuration of every deployment to `warn` is how a `warn` stops being read.
 *
 * ## Why it still throws
 *
 * `FlowTrigger.start` returns `void`, so a trigger that logs and returns is
 * indistinguishable to its host from one that armed. Throwing is the engine's
 * designed path for "not bound" — see {@link refuseMissingOrganization}'s
 * header for the full mechanism. In the engine's own composition this is
 * belt-and-braces rather than the primary gate: `activateFlowTrigger` reads the
 * same policy and does not call `start()` at all when it is off, which is what
 * keeps the audit's reason precise. This gate is what makes the guarantee hold
 * for a host that drives the trigger directly.
 */
export function refuseScheduledWorkDisabled(
    logger: TriggerLogger,
    tag: 'schedule' | 'time-relative',
    flowName: string,
): never {
    const sentence = `${tag} flow '${flowName}' is not armed: ${SCHEDULED_WORK_DISABLED_REASON}`;
    logger.info(`[${tag}] NOT ARMED — ${sentence}`);
    throw new Error(sentence);
}

/**
 * Refuse to bind a time-triggered flow that declares no acting organization
 * (#16659): say why at `error`, then THROW so the engine records the refusal.
 *
 * ## When this fires, after #17396
 *
 * ⚠️ Under a WALLED posture (`group` / `isolated`) with scheduled work switched
 * on, and nowhere else. The 2026-09-08 ruling this implements is unchanged
 * where it applies — a flow declares its organization or it is not armed, no
 * fan-out, no organization is ever chosen for it — but it applies to the
 * postures that have a wall to be crossed. On a `single` deployment with the
 * switch on there is exactly one organization — plugin-auth's ORG-CREATE
 * POSTURE GATE refuses a second: `auth-manager.ts`'s `beforeCreateOrganization`
 * answers 403 "Creating additional organizations is disabled on this
 * deployment." whenever `multiOrgPostureEffective()` is false, pinned in
 * `org-create-posture-gate.test.ts`. So the run carries none, every
 * tenant-scoped insert beneath it resolves that one organization through the
 * #8844 guard, there is no cross-organization task to forbid and nothing for
 * an author to declare. With the switch OFF this refusal is not
 * reached at all: {@link refuseScheduledWorkDisabled} answers first, because a
 * deployment that runs no scheduled work owes no authoring remedy.
 *
 * ## Why it throws, and does not merely log and return
 *
 * `FlowTrigger.start` returns `void`, so a trigger that logs and returns is
 * indistinguishable — to the engine — from one that armed successfully. The
 * engine's `activateFlowTrigger` then runs `boundFlowTriggers.set(flowName, …)`
 * and logs `Flow '<name>' bound to trigger 'schedule'` one line after this
 * function said NOT BOUND, and every structured surface built for exactly this
 * state reports the opposite of it: `getFlowRuntimeStates()` (Studio's status
 * badge) answers `bound: true`, and `getTriggerBindingAudit()` — the silent-miss
 * audit the automation plugin warns from at `kernel:bootstrapped` and the CLI
 * prints in its startup summary — skips the flow because it is in
 * `boundFlowTriggers`. A refusal only an operator reading stderr can see, in a
 * repo that built three machine-readable channels to say "declared but not
 * armed", is the same silent-miss shape this card exists to close.
 *
 * Throwing is the engine's DESIGNED path for this: `activateFlowTrigger` wraps
 * `trigger.start(...)` in a `try/catch` whose `catch` logs the plugin-supplied
 * thrown text and — because the `set` is inside the `try`, after the call — never
 * marks the flow bound. The audit then lists it with `binding failed — see
 * earlier warnings`, which points at the `error` line this function already
 * emitted. The message is the same sentence both times, so the loud channel and
 * the structured channel cannot drift.
 *
 * ## Why this REFUSES rather than binding and degrading
 *
 * The whole defect this closes is a run that looked healthy while delivering
 * nothing: the tick selected its rows, landed its `update_record` steps,
 * reported `unmeasured=0`, and every tenant-scoped write beneath it — the
 * inbox rows and the `sys_automation_run` history row — was refused one layer
 * down where nothing summarised it. Binding such a flow and warning once at
 * boot would reproduce exactly that shape: a flow that is armed, listed, and
 * inert. So the flow is NOT bound, and the reason names it.
 *
 * ## Why `error` and not `warn`
 *
 * The repo's degradation-log-level rule asks one question: after the
 * degradation, does the system still look normal from the outside while
 * something it claims is in place has not landed? It does, completely — the
 * flow stays published and active in `sys_metadata`, Studio lists it, the
 * metadata API serves it and `verify_build` passes — which is the same
 * reasoning {@link reportBindFailure} records for its own branch, and the same
 * `error` class.
 *
 * ⛔ There is deliberately no limb here that picks an organization. Not the
 * install's only one, not the platform organization, not the first row of
 * `sys_organization`. A wrong `organization_id` is worse than a refusal: a
 * refusal is visible at boot and names its flow, while a wrong value is
 * silently authoritative to every report, export and cleanup script that
 * filters by organization.
 */
export function refuseMissingOrganization(
    logger: TriggerLogger,
    tag: 'schedule' | 'time-relative',
    flowName: string,
    binding: FlowTriggerBinding,
): never {
    const sentence = describeMissingScheduleOrganization(flowName, {
        kind: tag === 'time-relative' ? 'time_relative' : 'schedule',
        // The start node's `config` as the engine handed it over; the near-miss
        // scan is `@objectstack/spec`'s and runs inside the sentence, so a
        // trigger cannot report a spelling the scan would not have found.
        config: binding.config,
    });
    const report = logger.error?.bind(logger) ?? logger.warn.bind(logger);
    report(`[${tag}] NOT BOUND — ${sentence}`);
    throw new Error(sentence);
}

/**
 * [#18378] The clause a BIND line carries about which organization this flow's
 * runs will act as — one vocabulary, so the two triggers cannot describe the
 * same deployment differently.
 *
 * "Which rows can this flow ever see, and who will own what it writes" is
 * answerable from the boot log rather than from the metadata, and after ruling
 * A′ that is three distinct answers rather than two. The third — an undeclared
 * flow under `group` with nothing to derive from — is the one that earns a
 * WARNING rather than a fact: it is legal and armed, and it will nonetheless be
 * refused at its first tenant-scoped write. That refusal is loud and correct,
 * but it arrives at the first tick; boot is where an operator is reading, so it
 * is said here too, with the remedy.
 *
 * ⛔ `hasRecord` is a fact about the TRIGGER KIND, not about a tick: a
 * `time_relative` sweep always has a swept record to derive from by
 * construction, and a plain `schedule` flow never does. It is not "did this
 * tick match anything".
 */
export function describeScheduleRunOwnership(
    policy: ScheduledWorkPolicy,
    organization: string | null,
    opts: { readonly hasRecord: boolean },
): string {
    if (organization !== null) return ` as organization '${organization}'`;
    if (policy.runOwnership === 'per-record') {
        return opts.hasRecord
            ? ` with per-record acting organization (tenancy posture '${policy.posture}') — the sweep reads group-wide and each run acts as its own swept record's organization`
            : ` with NO acting organization (tenancy posture '${policy.posture}') — this flow sweeps no records, so there is nothing to derive one from, and any tenant-scoped row it writes (a notification, an inbox message, its own run history) will be REFUSED at the write. Declare \`organization\` on the start node's config if this flow writes per-organization data`;
    }
    return ` with NO acting organization (tenancy posture '${policy.posture}') — the run carries none and the deployment's single organization is resolved beneath each write`;
}

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
        // [#17396] The DEPLOYMENT gate comes first — before the descriptor, the
        // declaration and the job service. All three of those describe the
        // flow; this one describes the deployment, and on a deployment that
        // runs no package-authored scheduled work the other three verdicts are
        // not reached and must not be reported: an operator told that a flow
        // has "no recognizable schedule descriptor" would go and fix a
        // descriptor that was never going to be read.
        const policy = readScheduledWorkPolicy();
        if (!policy.enabled) {
            // Same ordering reason as the declaration refusal below: drop any
            // prior binding before throwing, so a rebind under a switch that
            // has since been turned off cannot leave the previous job armed.
            this.stop(binding.flowName);
            refuseScheduledWorkDisabled(this.logger, 'schedule', binding.flowName);
        }

        const raw = binding.schedule ?? (binding.config as Record<string, unknown> | undefined)?.schedule;
        const schedule = normalizeSchedule(raw);
        if (!schedule) {
            this.logger.warn(
                `[schedule] flow '${binding.flowName}' has no recognizable schedule descriptor — not bound`,
            );
            return;
        }

        // [#16659] The acting organization is part of the BINDING, so it is
        // checked before the job service is even resolved: a flow that cannot
        // legally run must not be reported as "not scheduled because the job
        // service is missing", which is a different defect with a different
        // remedy.
        //
        // [#17396] …and only where the posture makes it answerable. Under
        // `single` the run carries NO organization and the #8844 guard resolves
        // the deployment's one organization beneath it, so a missing key is not
        // a defect there — `policy.requiresActingOrganization` is the whole of
        // that distinction and it is resolved once, centrally, so this trigger,
        // the sweep trigger and the engine's audit cannot disagree about it.
        //
        // [#18378] …nor under `group`, and for a different reason worth keeping
        // apart from `single`'s. There the key is OPTIONAL, not moot: a
        // declared flow acts as its declaration exactly as under `isolated`,
        // while an undeclared one is a legal armed shape whose ownership
        // follows the record. A PLAIN `schedule` flow has no record, so an
        // undeclared one here carries nothing and is refused at its first
        // tenant-scoped write — loudly, by the tenancy guard, with the remedy.
        // ⛔ That is deliberately NOT converted into a bind refusal: a cron flow
        // that only reads, or writes only objects declaring
        // `tenancy: { enabled: false }`, has no write to be refused and must
        // still run. Refusing it at bind would be ruling G again under a new
        // name, which is the thing A′ reopened. The bind line says so instead.
        const organization = resolveBindingOrganization(binding);
        if (policy.requiresActingOrganization && organization === null) {
            // Drop any prior binding for this flow FIRST. A hot re-publish that
            // REMOVES the organization must not leave the previous, still-armed
            // job firing org-less ticks behind an error that says it was
            // refused — and the throw below leaves this method immediately.
            this.stop(binding.flowName);
            refuseMissingOrganization(this.logger, 'schedule', binding.flowName, binding);
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
                    // [#16659] When the flow declares one, the run executes AS
                    // that organization: `tenantId` is the acting run's
                    // organization, and every consumer already reads it —
                    // `notify-node.ts` threads it onto the notification it
                    // emits (#11303), and the engine copies it onto the
                    // `sys_automation_run` history row (#10101). The producer
                    // was simply never supplying a value, so both consumers
                    // resolved NULL and the tenancy guard refused the rows
                    // beneath them.
                    //
                    // [#17396] ⚠️ RETIRED PIN, with its reason. This spread
                    // replaces an unconditional `tenantId: organization` whose
                    // comment read "⛔ Never conditional", on the argument
                    // that an org-less run is a silent state. That argument was
                    // sound while EVERY time-triggered run owed a declaration:
                    // conditional there meant "sometimes we forgot". Under
                    // ruling G an absent `tenantId` is a DECLARED state rather
                    // than a forgotten one — the `single` posture with the
                    // switch on, where the deployment holds exactly one
                    // organization (plugin-auth's org-create posture gate
                    // refuses a second) and the #8844 guard resolves it for
                    // every tenant-scoped insert beneath the run. It is reached only through that gate: under a
                    // wall the bind above still refuses an undeclared flow, and
                    // with the switch off nothing binds at all. ⛔ The key is
                    // OMITTED rather than set to `undefined` — the ruling says
                    // the run carries no organization, and a present-but-
                    // undefined `tenantId` is a different thing to every
                    // consumer that asks `in`.
                    ...(organization !== null ? { tenantId: organization } : {}),
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
                        (schedule.at ? ` at ${schedule.at}` : '') +
                        // [#18378] Which organization this flow's runs act as,
                        // on the BIND line. A plain `schedule` flow has no
                        // swept record, so `per-record` ownership has nothing
                        // to derive from and the run carries none — which under
                        // `group` is a legal, armed shape whose first
                        // tenant-scoped write is nonetheless refused
                        // (`walled-posture`). That refusal is correct and
                        // loud, but it arrives at the first TICK, which may be
                        // hours away and unattended; boot is where the operator
                        // is actually reading, so the warning is owed here as
                        // well. ⛔ Not a reason to refuse the bind: a cron flow
                        // that only reads, or only writes objects that declare
                        // `tenancy: { enabled: false }`, is legitimate and must
                        // still run — which is the whole of what ruling A′
                        // reopened.
                        describeScheduleRunOwnership(policy, organization, { hasRecord: false }),
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
