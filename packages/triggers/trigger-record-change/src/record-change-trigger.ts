// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import type { AutomationContext } from '@objectstack/spec/contracts';
import type { HookContext } from '@objectstack/spec/data';

/**
 * Structural mirror of the automation engine's `FlowTriggerBinding`
 * (service-automation/src/engine.ts). Declared locally so this trigger plugin
 * stays decoupled from the automation package — same pattern the connector /
 * messaging integrations use to avoid a hard build edge. The engine parses the
 * flow's start node and hands us one of these per activated flow.
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
 * The slice of the ObjectQL data engine this trigger needs: subscribe to a
 * lifecycle hook, and (for teardown) drop all hooks owned by a packageId.
 * Typed structurally because `IDataEngine` (the public contract) doesn't model
 * the hook surface, but the concrete engine implements both.
 */
export interface RecordChangeDataEngine {
    registerHook(
        event: string,
        handler: (ctx: HookContext) => unknown | Promise<unknown>,
        options?: { object?: string | string[]; priority?: number; packageId?: string },
    ): void;
    unregisterHooksByPackage?(packageId: string): number;
    /**
     * Optional object-existence probe (the ObjectQL engine's `getObject`).
     * When present, {@link RecordChangeTrigger.start} uses it to call out a
     * flow whose `objectName` matches no registered object — a hook filtered
     * to a name nobody writes never fires, with zero output at any layer
     * (2026-07-17 third-party eval).
     */
    getObject?(name: string): unknown;
}

/** Minimal logger surface (matches core's `ctx.logger`). */
export interface TriggerLogger {
    info(msg: string, ...args: unknown[]): void;
    warn(msg: string, ...args: unknown[]): void;
    debug?(msg: string, ...args: unknown[]): void;
    /**
     * Execution failures log here when available (falling back to `warn`).
     * ERROR matters operationally: the CLI's boot-quiet window swallows
     * stdout (debug/info/warn) but stderr (error/fatal) always lands.
     */
    error?(msg: string, ...args: unknown[]): void;
}

const TRIGGER_PREFIX = 'com.objectstack.trigger.record-change';

/**
 * Map a flow start node's `triggerType` (e.g. `record-after-update`) to an
 * ObjectQL `HookEvent` (e.g. `afterUpdate`). Returns `null` for anything that
 * isn't a `record-(before|after)-(create|insert|update|delete)` token.
 */
export function triggerTypeToHookEvent(triggerType: string | undefined): string | null {
    if (!triggerType) return null;
    const m = /^record-(before|after)-(create|insert|update|delete)$/.exec(triggerType.trim());
    if (!m) return null;
    const phase = m[1]; // 'before' | 'after'
    const op = m[2]; // create|insert|update|delete
    const verb = op === 'create' || op === 'insert' ? 'Insert' : op.charAt(0).toUpperCase() + op.slice(1);
    return `${phase}${verb}`; // e.g. 'afterUpdate', 'beforeDelete'
}

/**
 * RecordChangeTrigger
 *
 * Bridges the automation engine's {@link FlowTrigger} extension point to
 * ObjectQL lifecycle hooks. For each flow the engine activates, it subscribes
 * to the matching hook event (filtered to the flow's target object) and, when
 * the hook fires, builds an {@link AutomationContext} from the new/old record
 * and invokes the engine-supplied callback (which runs the flow — the engine
 * owns the start-node condition gate, so we don't re-evaluate it here).
 *
 * Each flow's hooks are registered under a per-flow packageId so {@link stop}
 * can tear exactly that flow's subscription down via
 * `unregisterHooksByPackage`, without touching other flows or audit hooks.
 */
export class RecordChangeTrigger implements FlowTrigger {
    readonly type = 'record_change';

    private readonly engine: RecordChangeDataEngine;
    private readonly logger: TriggerLogger;
    /** flowName → packageId used for its hook(s), so stop() can unregister it. */
    private readonly bound = new Map<string, string>();

    constructor(engine: RecordChangeDataEngine, logger: TriggerLogger) {
        this.engine = engine;
        this.logger = logger;
    }

    start(binding: FlowTriggerBinding, callback: (ctx: AutomationContext) => Promise<void>): void {
        const hookEvent = triggerTypeToHookEvent(binding.event);
        if (!hookEvent) {
            this.logger.warn(
                `[record-change] flow '${binding.flowName}' has unsupported trigger event '${binding.event ?? '(none)'}' — not bound`,
            );
            return;
        }

        // Idempotent: drop any prior subscription for this flow before re-binding
        // (covers disable→enable cycles and hot reload).
        this.stop(binding.flowName);

        // Silent-miss guard (2026-07-17 third-party eval): a hook filtered to an
        // object name nobody writes never fires — and nothing anywhere says so.
        // When the engine can be probed, call the mismatch out at bind time.
        // Still bind (the object may be registered later by a metadata reload);
        // this is a diagnosis, not a refusal.
        if (binding.object && typeof this.engine.getObject === 'function') {
            let known: unknown;
            try {
                known = this.engine.getObject(binding.object);
            } catch {
                known = undefined;
            }
            if (!known) {
                this.logger.warn(
                    `[record-change] flow '${binding.flowName}' targets unknown object '${binding.object}' — the trigger is bound but will never fire. ` +
                        `Object names match exactly; check the flow start node's config.objectName against the object's registered name.`,
                );
            }
        }

        const packageId = `${TRIGGER_PREFIX}:${binding.flowName}`;

        const handler = async (ctx: HookContext): Promise<void> => {
            try {
                // Seed/bulk suppression: writes made with `context.skipTriggers`
                // (notably package metadata SEED replay) must NOT fire
                // record-change automation — seed rows are pre-existing end-state
                // data, not user events. Firing "on create/update" flows for them
                // is semantically wrong and was the vector for the 2026-07-06
                // self-trigger loop that wedged first-boot. Lifecycle hooks still
                // ran (they are separate); only the flow dispatch is skipped here.
                if ((ctx.session as { skipTriggers?: boolean } | undefined)?.skipTriggers) {
                    return;
                }
                const automationCtx = this.buildContext(binding, ctx);
                await callback(automationCtx);
            } catch (err) {
                // Error isolation: a flow failure must NEVER break the CRUD write
                // that triggered it. Log (loudly — ERROR reaches stderr, which
                // survives the CLI's boot-quiet stdout window) and swallow.
                const log = this.logger.error?.bind(this.logger) ?? this.logger.warn.bind(this.logger);
                log(
                    `[record-change] flow '${binding.flowName}' execution failed: ${(err as Error)?.message ?? String(err)}`,
                );
            }
        };

        this.engine.registerHook(hookEvent, handler, {
            object: binding.object,
            packageId,
        });
        this.bound.set(binding.flowName, packageId);
        this.logger.info(
            `[record-change] bound flow '${binding.flowName}' → ${hookEvent}${binding.object ? ` on '${binding.object}'` : ''}`,
        );
    }

    stop(flowName: string): void {
        const packageId = this.bound.get(flowName);
        if (!packageId) return;
        try {
            this.engine.unregisterHooksByPackage?.(packageId);
        } catch (err) {
            this.logger.warn(
                `[record-change] failed to unbind flow '${flowName}': ${(err as Error)?.message ?? String(err)}`,
            );
        }
        this.bound.delete(flowName);
        this.logger.debug?.(`[record-change] unbound flow '${flowName}'`);
    }

    /**
     * Build the flow execution context from an ObjectQL hook context. The new
     * record comes from `ctx.result` (after-hooks) or falls back to the
     * mutation input doc / previous row; the old record from `ctx.previous`
     * (with the `__previous` stash audit also uses as a fallback).
     */
    private buildContext(binding: FlowTriggerBinding, ctx: HookContext): AutomationContext {
        // objectql lifecycle hooks carry the written row under `input.data` (insert /
        // update payload); `id` is on update. (`doc` kept only as a defensive alias.)
        const input = (ctx.input ?? {}) as { data?: Record<string, unknown>; doc?: Record<string, unknown>; id?: unknown };
        const after = ctx.result as Record<string, unknown> | undefined;
        const previous =
            (ctx.previous as Record<string, unknown> | undefined) ??
            ((ctx as unknown as { __previous?: Record<string, unknown> }).__previous ?? undefined);

        const inputDoc =
            input.data && typeof input.data === 'object'
                ? input.data
                : input.doc && typeof input.doc === 'object'
                  ? input.doc
                  : undefined;
        const record: Record<string, unknown> =
            after && typeof after === 'object'
                ? // #1872 — overlay the after-row on the input doc so fields the
                  // driver did not echo back (notably `multiple: true` lookups,
                  // stored as an array column) stay visible to the flow's start
                  // condition and `{record.<field>}` interpolation. The after-row
                  // wins for every field it DOES return (id, DB-computed values).
                  { ...(inputDoc ?? {}), ...after }
                : inputDoc ?? (previous && typeof previous === 'object' ? previous : {});

        const session = (ctx.session ?? {}) as { userId?: string; tenantId?: string; positions?: string[] };

        return {
            record,
            previous,
            object: binding.object ?? ctx.object,
            event: binding.event,
            userId: session.userId,
            // Forward the writer's roles/tenant so a `runAs:'user'` flow enforces
            // RLS exactly as the user who made the change, not a member fallback
            // (#1888). The engine elevates only for `runAs:'system'`.
            ...(Array.isArray(session.positions) && session.positions.length ? { positions: session.positions } : {}),
            ...(session.tenantId ? { tenantId: session.tenantId } : {}),
            // Expose the record as params too, so flows with named `isInput`
            // variables matching record fields get them seeded.
            params: record,
        };
    }
}
