// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import type { Plugin, PluginContext } from '@objectstack/core';
import type { IJobService } from '@objectstack/spec/contracts';
import { AutomationEngine } from './engine.js';
import { installBuiltinNodes, rearmSuspendedWaitTimers } from './builtin/index.js';
import { SysAutomationRun } from './sys-automation-run.object.js';
import { ObjectStoreSuspendedRunStore, type SuspendedRunStoreEngine } from './suspended-run-store.js';

/**
 * Configuration options for the AutomationServicePlugin.
 */
export interface AutomationServicePluginOptions {
    /** Enable debug logging for flow execution */
    debug?: boolean;
    /**
     * Durable suspended-run persistence (ADR-0019):
     *  - `'auto'` (default): persist to `sys_automation_run` via the ObjectQL
     *    engine when one is available, otherwise stay in-memory.
     *  - `'memory'`: never persist — keep suspended runs in memory only (the
     *    historical behaviour; suitable for tests / single-process dev).
     *
     * When persistence is on, a run paused at an approval / wait / screen node
     * survives a process restart and can be resumed after a cold boot.
     */
    suspendedRunStore?: 'auto' | 'memory';
    /**
     * Max in-memory execution-log entries retained per process (ring buffer;
     * oldest evicted). The buffer is diagnostic-only and already bounded
     * (launch-readiness.md P1-2); this just makes the window tunable. Defaults
     * to {@link DEFAULT_MAX_EXECUTION_LOG_SIZE} (1000).
     */
    maxLogSize?: number;
}

/**
 * AutomationServicePlugin — Core engine plugin
 *
 * Responsibilities:
 * 1. init phase: Create engine instance, register as 'automation' service, and
 *    seed the platform's built-in node executors (logic / CRUD / screen-script /
 *    http) via {@link installBuiltinNodes}. Per ADR-0018, foundational
 *    capabilities are built into the core, not packaged as optional plugins.
 * 2. start phase: Trigger 'automation:ready' hook so third-party plugins can
 *    register additional node types, then pull flow definitions from the
 *    ObjectQL schema registry and register them with the engine.
 * 3. destroy phase: Clean up resources
 *
 * The engine's `registerNodeExecutor()` stays open so plugins extend the
 * node/action vocabulary at runtime — the marketplace-extensibility contract.
 *
 * @example
 * ```ts
 * import { LiteKernel } from '@objectstack/core';
 * import { AutomationServicePlugin } from '@objectstack/service-automation';
 *
 * const kernel = new LiteKernel();
 * kernel.use(new AutomationServicePlugin());
 * await kernel.bootstrap();
 *
 * const automation = kernel.getService('automation');
 * ```
 */
export class AutomationServicePlugin implements Plugin {
    name = 'com.objectstack.service-automation';
    version = '1.0.0';
    type = 'standard' as const;
    // Soft dependency on metadata: we look it up at start() and tolerate absence.
    // Do NOT declare a hard kernel dependency, so this plugin works in environments
    // where MetadataPlugin is not registered.
    dependencies: string[] = [];

    private engine?: AutomationEngine;
    private readonly options: AutomationServicePluginOptions;
    /**
     * Flow names this plugin has registered into the engine from the
     * artifact / ObjectQL registry, tracked so a `metadata:reloaded` re-sync
     * can tear down flows that were removed from the artifact (stopping their
     * triggers/jobs). Seeded by the boot pull, then replaced on each re-sync.
     * Plugin-contributed node packs never enter this set, so re-sync never
     * unregisters them.
     */
    private syncedFlowNames = new Set<string>();

    constructor(options: AutomationServicePluginOptions = {}) {
        this.options = options;
    }

    async init(ctx: PluginContext): Promise<void> {
        this.engine = new AutomationEngine(ctx.logger, undefined, {
            maxLogSize: this.options.maxLogSize,
        });

        // Register as global service — other plugins access via ctx.getService('automation')
        ctx.registerService('automation', this.engine);

        // Register the sys_automation_run object so suspended-run state migrates
        // like other sys_* tables (ADR-0019). Best-effort: a host without the
        // manifest service still runs in-memory. Skipped when persistence is off.
        if ((this.options.suspendedRunStore ?? 'auto') !== 'memory') {
            try {
                ctx.getService<{ register(m: unknown): void }>('manifest').register({
                    id: 'com.objectstack.service-automation',
                    name: 'Automation Service',
                    version: '1.0.0',
                    type: 'plugin',
                    scope: 'system',
                    defaultDatasource: 'cloud',
                    namespace: 'sys',
                    objects: [SysAutomationRun],
                });
            } catch (err) {
                ctx.logger.warn(
                    `[Automation] manifest service unavailable; sys_automation_run not registered (suspended runs stay in-memory): ${(err as Error).message}`,
                );
            }
        }

        // Seed the platform's built-in node executors. A bare
        // `new AutomationServicePlugin()` is thus a self-contained automation
        // capability — no companion node-pack plugins required (ADR-0018).
        installBuiltinNodes(this.engine, ctx);

        if (this.options.debug) {
            ctx.hook('automation:beforeExecute', async (flowName: string) => {
                ctx.logger.debug(`[Automation] Before execute: ${flowName}`);
            });
        }

        ctx.logger.info('[Automation] Engine initialized');
    }

    async start(ctx: PluginContext): Promise<void> {
        if (!this.engine) {
            ctx.logger.warn('[Automation] start() called before init() — engine missing, skipping');
            return;
        }

        // Trigger hook to notify engine is ready — other plugins can start registering nodes
        await ctx.trigger('automation:ready', this.engine);

        const nodeTypes = this.engine.getRegisteredNodeTypes();
        ctx.logger.info(
            `[Automation] Engine started with ${nodeTypes.length} node types: ${nodeTypes.join(', ') || '(none)'}`,
        );

        // Upgrade to durable suspended-run persistence when an ObjectQL engine is
        // present (ADR-0019). The engine was constructed in init() before
        // services were wired, so we attach the DB-backed store here. Without an
        // engine (or with `suspendedRunStore: 'memory'`) the in-memory default
        // stands — suspended runs simply don't survive a restart.
        let durableStore: ObjectStoreSuspendedRunStore | null = null;
        if ((this.options.suspendedRunStore ?? 'auto') !== 'memory') {
            let dataEngine: SuspendedRunStoreEngine | null = null;
            try { dataEngine = ctx.getService<SuspendedRunStoreEngine>('objectql'); }
            catch { try { dataEngine = ctx.getService<SuspendedRunStoreEngine>('data'); } catch { /* none */ } }
            if (dataEngine && typeof dataEngine.find === 'function' && typeof dataEngine.insert === 'function') {
                durableStore = new ObjectStoreSuspendedRunStore(dataEngine, ctx.logger);
                this.engine.setSuspendedRunStore(durableStore);
                ctx.logger.info('[Automation] Suspended-run persistence enabled (sys_automation_run)');
            } else {
                ctx.logger.info('[Automation] No ObjectQL engine — suspended runs kept in-memory only');
            }
        }

        // #1870 — bridge `script`-node function calls to the host function
        // registry. ObjectQL holds the name→handler map populated from
        // `bundle.functions` / `defineStack({ functions })` (the same registry
        // hooks/actions resolve through). Wiring it here lets a `script` node
        // invoke an authored function by name; an unresolved name fails the step
        // loudly. Best-effort: without ObjectQL, function-calling script nodes
        // fail with a clear "no function registered" error when executed.
        try {
            const fnRegistry = ctx.getService<{
                resolveFunction?: (name: string) => ((c: unknown) => unknown) | undefined;
            }>('objectql');
            if (fnRegistry && typeof fnRegistry.resolveFunction === 'function') {
                this.engine.setFunctionResolver((name) => {
                    const fn = fnRegistry.resolveFunction!(name);
                    return typeof fn === 'function'
                        ? (fnCtx) => (fn as (c: unknown) => unknown)(fnCtx)
                        : undefined;
                });
                ctx.logger.debug('[Automation] script-node function registry bridged to objectql.resolveFunction');
            }
        } catch {
            ctx.logger.debug('[Automation] objectql not present — script-node function calls will fail loudly when used');
        }

        // Pull flow definitions from the ObjectQL schema registry. AppPlugin.init()
        // calls manifest.register(payload), which routes to ql.registerApp() and
        // stores each inline flow under type 'flow'. By the time start() runs,
        // every init() phase has completed, so the registry is fully populated.
        try {
            const ql = ctx.getService<{
                registry?: { listItems?: (type: string) => unknown[] };
            }>('objectql');
            if (!ql) {
                ctx.logger.debug('[Automation] objectql service not found at start()');
            } else if (!ql.registry) {
                ctx.logger.debug('[Automation] objectql.registry is undefined at start()');
            } else if (typeof ql.registry.listItems !== 'function') {
                ctx.logger.debug('[Automation] objectql.registry.listItems is not a function');
            }
            const flows = ql?.registry?.listItems?.('flow') ?? [];
            ctx.logger.debug(`[Automation] flow pull: registry returned ${flows.length} flow(s)`);
            let registered = 0;
            for (const f of flows) {
                const def = f as { name?: string };
                if (!def?.name) continue;
                try {
                    this.engine.registerFlow(def.name, def as never);
                    this.syncedFlowNames.add(def.name);
                    registered++;
                } catch (e) {
                    const msg = e instanceof Error ? e.message : String(e);
                    ctx.logger.warn(`[Automation] failed to register flow ${def.name}: ${msg}`);
                }
            }
            if (registered > 0) {
                ctx.logger.info(`[Automation] Pulled ${registered} flow(s) from ObjectQL registry`);
            }
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            ctx.logger.warn(`[Automation] flow pull from ObjectQL registry failed: ${msg}`);
        }

        // ── Dev hot-reload: re-bind flow triggers when the artifact recompiles ──
        // `os dev` recompiles dist/objectstack.json on a src edit; MetadataPlugin
        // reloads it into the metadata service and fires 'metadata:reloaded'. The
        // engine, however, still holds the flow definitions + trigger bindings it
        // pulled ONCE above — including scheduled jobs bound through the schedule
        // trigger. Without re-syncing, an edited schedule-triggered flow keeps
        // firing its OLD definition (old runAs / schedule / logic) until a full
        // restart. Re-register every current flow (registerFlow re-binds its
        // trigger idempotently — ScheduleTrigger.start cancels + reschedules) and
        // unregister flows that vanished from the artifact so their jobs stop.
        ctx.hook('metadata:reloaded', async () => {
            await this.resyncFlowsFromMetadata(ctx);
        });

        // ── Cold-boot bind via the PROTOCOL's flattened flow view ─────────────
        // The boot pull above reads `ql.registry.listItems('flow')`, which is
        // EMPTY for flows defined inline in an app manifest: registerApp stores
        // the app under type 'app' and never promotes its inline flows to
        // standalone registry 'flow' items. The 'metadata:reloaded' re-sync
        // below can't cover the cold boot either — that hook fires only on a dev
        // HMR reload (and `os dev` restarts the process on recompile rather than
        // firing it), never on a fresh boot or in production. Net effect:
        // record-triggered flows silently never bound on a cold start, so their
        // automations never fired.
        //
        // The canonical flattened flow view — the one `GET /meta/flow` serves —
        // is `protocol.getMetaItems({ type: 'flow' })`; it surfaces inline app
        // flows on-demand from the registry. Bind from THAT at kernel:ready,
        // once every plugin has finished init()/start() (so the app — hence its
        // flows — is registered). registerFlow is idempotent with the boot pull.
        ctx.hook('kernel:ready', async () => {
            await this.syncFlowsFromProtocol(ctx);
        });

        // ADR-0019 follow-up: re-arm auto-resume timers for runs that were
        // suspended at a timer-`wait` node when the process went down. Must run
        // *after* the flow pull above — resume() needs the flow definitions
        // registered. Overdue deadlines resume immediately; future ones get
        // their one-shot job re-scheduled. Best-effort: a failure here only
        // means those runs wait for an external resume(runId).
        if (durableStore) {
            let job: IJobService | undefined;
            try { job = ctx.getService<IJobService>('job'); } catch { /* none */ }
            try {
                const rearmed = await rearmSuspendedWaitTimers(this.engine, durableStore, job, ctx.logger);
                if (rearmed > 0) {
                    ctx.logger.info(`[Automation] Re-armed ${rearmed} suspended wait timer(s) after restart`);
                }
            } catch (err) {
                ctx.logger.warn(`[Automation] wait-timer re-arm failed: ${(err as Error).message}`);
            }
        }
    }

    /**
     * Re-pull flow definitions from the metadata service and re-register them
     * into the engine, so an `os dev` artifact recompile re-binds flow triggers
     * (notably scheduled jobs) instead of leaving the engine executing the
     * boot-time definitions. Driven by the `metadata:reloaded` hook that
     * MetadataPlugin fires after reloading the artifact from disk.
     *
     * Pulls from the metadata service — NOT the ObjectQL schema registry used by
     * the boot pull. The schema registry is a boot-time cache the artifact reload
     * does not refresh; `MetadataManager.register()` (the reload's write path) IS
     * refreshed, so the metadata service is the only source carrying the edited
     * definitions.
     *
     * Idempotent and best-effort: registerFlow() re-binds the trigger
     * (ScheduleTrigger.start cancels + reschedules), flows removed from the
     * artifact are unregistered so their jobs stop firing, and any failure is
     * logged without disturbing the rest of the runtime.
     */
    private async resyncFlowsFromMetadata(ctx: PluginContext): Promise<void> {
        if (!this.engine) return;
        let metadata: { list?(type: string): Promise<unknown[]> } | undefined;
        try {
            metadata = ctx.getService('metadata');
        } catch {
            // No metadata service (e.g. a bare engine / tests) — nothing to sync.
            return;
        }
        if (!metadata || typeof metadata.list !== 'function') return;

        let defs: unknown[];
        try {
            defs = await metadata.list('flow');
        } catch (err) {
            ctx.logger.warn(
                `[Automation] flow re-sync skipped: metadata.list('flow') failed: ${(err as Error).message}`,
            );
            return;
        }

        const freshNames = new Set<string>();
        let resynced = 0;
        for (const d of defs) {
            const def = d as { name?: string };
            if (!def?.name) continue;
            freshNames.add(def.name);
            try {
                this.engine.registerFlow(def.name, def as never);
                resynced++;
            } catch (err) {
                ctx.logger.warn(
                    `[Automation] flow re-sync: failed to register ${def.name}: ${(err as Error).message}`,
                );
            }
        }

        // Tear down flows that were synced from a prior artifact but are gone
        // now, so their triggers/jobs (e.g. a scheduled job) stop firing.
        for (const prev of this.syncedFlowNames) {
            if (!freshNames.has(prev)) {
                try {
                    this.engine.unregisterFlow(prev);
                } catch {
                    /* best-effort */
                }
            }
        }
        this.syncedFlowNames = freshNames;

        if (resynced > 0) {
            ctx.logger.info(`[Automation] Re-synced ${resynced} flow(s) after metadata reload`);
        }
    }

    /**
     * Bind flows from the protocol's flattened flow view — `getMetaItems({ type:
     * 'flow' })`, the same source `GET /meta/flow` serves. Unlike
     * `registry.listItems('flow')` (the boot pull) this surfaces flows defined
     * inline in an app manifest, and unlike `metadata.list('flow')` (the
     * `metadata:reloaded` re-sync) it is populated on a cold boot once the app
     * is registered. Called at kernel:ready so record-triggered automations
     * actually bind on a fresh start. registerFlow is idempotent, so re-binding
     * a flow the boot pull already registered is harmless.
     */
    private async syncFlowsFromProtocol(ctx: PluginContext): Promise<void> {
        if (!this.engine) return;
        let protocol: { getMetaItems?(q: { type: string }): Promise<unknown> } | undefined;
        try {
            protocol = ctx.getService('protocol');
        } catch {
            return; // no protocol service (bare engine / tests) — nothing to sync
        }
        if (!protocol || typeof protocol.getMetaItems !== 'function') return;

        let raw: unknown;
        try {
            raw = await protocol.getMetaItems({ type: 'flow' });
        } catch (err) {
            ctx.logger.warn(
                `[Automation] cold-boot flow bind skipped: getMetaItems('flow') failed: ${(err as Error).message}`,
            );
            return;
        }

        // getMetaItems hands back a bare array or an `{ items: [...] }` envelope,
        // and each entry is either the flow doc or an `{ item: <flow> }` wrapper.
        const list = Array.isArray(raw) ? raw : (((raw as { items?: unknown[] })?.items) ?? []);
        let bound = 0;
        for (const entry of list) {
            const def = (
                entry && typeof entry === 'object' && 'item' in entry ? (entry as { item: unknown }).item : entry
            ) as { name?: string } | undefined;
            if (!def?.name) continue; // registerFlow is idempotent, so re-binding is safe
            try {
                this.engine.registerFlow(def.name, def as never);
                this.syncedFlowNames.add(def.name);
                bound++;
            } catch (err) {
                ctx.logger.warn(
                    `[Automation] cold-boot flow bind: failed to register ${def.name}: ${(err as Error).message}`,
                );
            }
        }
        if (bound > 0) {
            ctx.logger.info(`[Automation] Bound ${bound} flow(s) from the protocol at kernel:ready`);
        }
    }

    async destroy(): Promise<void> {
        this.engine = undefined;
    }
}
