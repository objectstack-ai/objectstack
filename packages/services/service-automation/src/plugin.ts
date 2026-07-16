// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import type { Plugin, PluginContext } from '@objectstack/core';
import type { IJobService } from '@objectstack/spec/contracts';
import type {
    ConnectorInstanceAuth,
    ResolvedConnectorAuth,
    ConnectorProviderContext,
} from '@objectstack/spec/integration';
import { AutomationEngine } from './engine.js';
import { installBuiltinNodes, rearmSuspendedWaitTimers } from './builtin/index.js';
import { SysAutomationRun } from './sys-automation-run.object.js';
import {
    ObjectStoreSuspendedRunStore,
    DEFAULT_MAX_TERMINAL_RUNS_PER_FLOW,
    type SuspendedRunStoreEngine,
} from './suspended-run-store.js';

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
    /**
     * Per-flow cap on terminal run-history rows, enforced at write time (the
     * "or 100 runs/flow, whichever first" half of the #2585 retention
     * contract). Defaults to {@link DEFAULT_MAX_TERMINAL_RUNS_PER_FLOW} (100);
     * `0` disables the cap.
     *
     * The AGE half of the contract is declarative since ADR-0057 (#2834):
     * `sys_automation_run` declares `retention: { maxAge: '30d', onlyWhen:
     * { status: { $in: ['completed', 'failed'] } } }` and the platform
     * LifecycleService enforces it — suspended (`paused`) rows stay outside
     * the filter and are retained regardless of age. Tune the window via the
     * `lifecycle` settings namespace (`retention_overrides`).
     */
    runHistoryMaxPerFlow?: number;
    /**
     * Resolves a declarative connector instance's `auth.credentialRef` to its
     * secret at boot (ADR-0096 §3). Defaults to {@link defaultEnvCredentialResolver}
     * — the **open tier**: a `credentialRef` names an environment variable. An
     * enterprise host injects a vault/KMS-backed resolver here without touching
     * the materialization path. A ref that resolves to `undefined`/empty is a
     * hard boot error (an app must not silently run with a dead connector).
     */
    credentialResolver?: CredentialResolver;
}

/**
 * Resolves a declarative connector `credentialRef` to its plaintext secret, or
 * `undefined`/empty when unknown (which the materializer turns into a hard boot
 * error). May be async so an enterprise resolver can hit a vault. The open-tier
 * default reads from `process.env` (see {@link defaultEnvCredentialResolver}).
 */
export type CredentialResolver = (ref: string) => string | undefined | Promise<string | undefined>;

/**
 * Open-tier credential resolver (ADR-0096 §3, ADR-0015 open/enterprise line):
 * a `credentialRef` is the name of an environment variable. This is the
 * degraded-but-honest story for environments without a managed secrets service —
 * static credentials from env/config are open source; managed vaulting, OAuth2
 * refresh, and per-tenant connection lifecycle are the enterprise tier.
 */
export const defaultEnvCredentialResolver: CredentialResolver = (ref) =>
    typeof process !== 'undefined' ? process.env?.[ref] : undefined;

/**
 * The shape of a declarative `connectors:` stack entry as it sits in the
 * ObjectQL metadata registry (registered by `registerApp` under kind
 * 'connector'). Raw authored values — Zod defaults (e.g. `enabled: true`)
 * may not have been applied, so `enabled` is only trusted when explicitly
 * `false`. `provider` (+ `providerConfig`/`auth`) marks a provider-bound
 * **instance** the automation service materializes at boot (ADR-0096);
 * its absence marks a catalog **descriptor** (#2612).
 */
interface DeclaredConnectorItem {
    name?: string;
    label?: string;
    description?: string;
    icon?: string;
    type?: string;
    enabled?: boolean;
    actions?: unknown[];
    provider?: string;
    providerConfig?: Record<string, unknown>;
    auth?: ConnectorInstanceAuth;
}

/**
 * Descriptor-only contract audit (#2612): declarative `connectors:` stack
 * entries are catalog descriptors — they are registered as metadata but never
 * reach the engine's connector registry, which is populated exclusively by
 * plugins calling `engine.registerConnector(def, handlers)` (ADR-0018
 * §Addendum). A declared connector that also declares `actions` looks
 * dispatchable but is not — `connector_action` will fail on it at runtime.
 *
 * Returns the names of declared connectors that (a) declare at least one
 * action, (b) have no runtime registration under the same name, (c) are not
 * explicitly opted out with `enabled: false` (the marker for a deliberate
 * catalog-only entry), and (d) are NOT provider-bound instances — a
 * provider-bound entry (`provider` set) is materialized (or fails boot) by
 * {@link AutomationServicePlugin.materializeDeclaredConnectors}, so it follows
 * the ADR-0096 instance contract, not the descriptor-only warning (#2977).
 */
export function findInertDeclaredConnectors(
    declared: unknown[],
    liveConnectorNames: ReadonlySet<string>,
): string[] {
    return declared
        .map((c) => c as DeclaredConnectorItem)
        .filter(
            (c) =>
                typeof c?.name === 'string' &&
                c.name.length > 0 &&
                typeof c.provider !== 'string' &&
                (c.actions?.length ?? 0) > 0 &&
                c.enabled !== false &&
                !liveConnectorNames.has(c.name),
        )
        .map((c) => c.name as string);
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
    /**
     * Teardown callbacks for connectors this plugin materialized from
     * provider-bound declarative entries (ADR-0096) — e.g. an MCP connection's
     * `close`. Invoked in reverse on `destroy()` so no socket / child process
     * leaks after the connectors are unregistered.
     */
    private materializedConnectorClosers: Array<{ name: string; close: () => void | Promise<void> }> = [];

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
                durableStore = new ObjectStoreSuspendedRunStore(dataEngine, ctx.logger, {
                    maxTerminalRunsPerFlow:
                        this.options.runHistoryMaxPerFlow ?? DEFAULT_MAX_TERMINAL_RUNS_PER_FLOW,
                });
                this.engine.setSuspendedRunStore(durableStore);
                ctx.logger.info('[Automation] Suspended-run persistence enabled (sys_automation_run)');
            } else {
                ctx.logger.info('[Automation] No ObjectQL engine — suspended runs kept in-memory only');
            }
        }

        // Run-history AGE retention is declarative since ADR-0057 (#2834):
        // sys_automation_run carries `retention: { maxAge: '30d', onlyWhen:
        // { status: { $in: ['completed', 'failed'] } } }` and the platform
        // Reaper sweeps it — the status predicate keeps suspended approval
        // runs alive indefinitely, exactly like the old pruneHistory loop did.
        // Only the write-time per-flow overflow cap stays here (it is a
        // count-based bound the declarative contract can't express).

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

        // ── ADR-0096: materialize provider-bound declarative connector instances ──
        // Every plugin's init() has completed by start(), so connector plugins have
        // registered their provider factories (they do so in init()) and the ObjectQL
        // registry is fully populated with declared `connectors:` entries. Turn each
        // provider-bound entry into a live, dispatchable connector now. Deliberately
        // NOT wrapped in a swallowing try/catch: a misconfiguration (unknown provider,
        // invalid providerConfig, unresolvable credentialRef, name conflict) MUST fail
        // boot loudly — a metadata platform shipping a plausible-but-dead connector is
        // the worst failure mode. A start()-phase throw is fatal under both LiteKernel
        // and ObjectKernel (rollbackOnFailure defaults on), so the operator sees it.
        await this.materializeDeclaredConnectors(ctx);

        // ── Runtime re-bind: re-sync flow triggers on 'metadata:reloaded' ──────
        // Fires on two RUNTIME events (never on a cold boot — the kernel:ready
        // bind below covers that): a dev `os dev` artifact recompile (MetadataPlugin
        // reloads dist/objectstack.json and announces), and a Studio package publish
        // (the runtime dispatcher announces after publishPackageDrafts promotes the
        // drafts to active). The engine still holds the flow definitions + trigger
        // bindings it pulled ONCE above — including scheduled jobs. Without
        // re-syncing, an edited schedule-triggered flow keeps firing its OLD
        // definition (old runAs / schedule / logic), and a newly-published
        // record-triggered flow never binds its trigger at all, until a full
        // restart. Re-register every current flow (registerFlow re-binds its trigger
        // idempotently — ScheduleTrigger.start cancels + reschedules) and unregister
        // flows that vanished so their jobs stop.
        ctx.hook('metadata:reloaded', async () => {
            await this.resyncFlowsFromProtocol(ctx);
            // A Studio publish / dev reload can introduce new declarative
            // connector entries — re-audit so the inert-descriptor warning
            // stays current (see auditDeclaredConnectors).
            this.auditDeclaredConnectors(ctx);
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
            // Every plugin's init()/start() has completed here, so connector
            // plugins have registered their runtime connectors — the earliest
            // point the declared-vs-registered comparison is meaningful.
            this.auditDeclaredConnectors(ctx);
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
     * Descriptor-only contract audit (#2612) — warn, once per boot/reload,
     * about declarative `connectors:` entries that declare actions but have no
     * runtime registration (see {@link findInertDeclaredConnectors}). Reads
     * the same ObjectQL registry `registerApp` writes declarative connector
     * metadata into. Best-effort: without an ObjectQL registry there is
     * nothing declared, hence nothing to audit.
     */
    private auditDeclaredConnectors(ctx: PluginContext): void {
        if (!this.engine) return;
        let declared: unknown[] = [];
        try {
            const ql = ctx.getService<{
                registry?: { listItems?: (type: string) => unknown[] };
            }>('objectql');
            declared = ql?.registry?.listItems?.('connector') ?? [];
        } catch {
            return;
        }
        if (declared.length === 0) return;
        const live = new Set(this.engine.getConnectorDescriptors().map((d) => d.name));
        const inert = findInertDeclaredConnectors(declared, live);
        if (inert.length === 0) return;
        ctx.logger.warn(
            `[Automation] ${inert.length} declarative connector(s) declare actions but are not registered ` +
                `in the connector registry — the connector_action node cannot dispatch them: ${inert.join(', ')}. ` +
                `Declarative \`connectors:\` entries are catalog descriptors (descriptor-only contract, #2612); ` +
                `runtime connectors are contributed by plugins via engine.registerConnector() — e.g. ` +
                `@objectstack/connector-rest, @objectstack/connector-slack, @objectstack/connector-openapi, ` +
                `@objectstack/connector-mcp. Install/instantiate the matching connector plugin, or mark a ` +
                `deliberate catalog-only entry with \`enabled: false\` to silence this warning. ` +
                `Declarative provider-bound connector instances are tracked in #2977 (ADR-0096).`,
        );
    }

    /**
     * ADR-0096 — materialize every provider-bound declarative `connectors:` entry
     * into a live, dispatchable connector at boot. For each entry that names a
     * `provider`:
     *   1. look up the provider factory the connector plugin registered
     *      (unknown provider ⇒ **hard boot error**, naming the plugin to install);
     *   2. resolve `auth.credentialRef` through the credential resolver
     *      (unresolvable ⇒ **hard boot error**);
     *   3. invoke the factory — the same `{ def, handlers }` bundle a plugin would
     *      register (invalid providerConfig / unreachable upstream ⇒ **hard error**);
     *   4. register it under the **declared** name, tagged `declarative`, so a
     *      collision with a plugin-registered connector fails loudly (§4).
     *
     * Called from `start()` (not a `kernel:ready` hook) so a throw here is fatal
     * to bootstrap under both LiteKernel and ObjectKernel — the ADR's "fail
     * loudly" contract. Reads the same ObjectQL registry the descriptor audit
     * uses; without one there is nothing declared, hence nothing to materialize.
     */
    private async materializeDeclaredConnectors(ctx: PluginContext): Promise<void> {
        const engine = this.engine;
        if (!engine) return;

        let declared: unknown[] = [];
        try {
            const ql = ctx.getService<{
                registry?: { listItems?: (type: string) => unknown[] };
            }>('objectql');
            declared = ql?.registry?.listItems?.('connector') ?? [];
        } catch {
            return; // no registry — nothing declared
        }

        const instances = declared
            .map((c) => c as DeclaredConnectorItem)
            .filter(
                (c): c is DeclaredConnectorItem & { name: string; provider: string } =>
                    typeof c?.name === 'string' &&
                    c.name.length > 0 &&
                    typeof c.provider === 'string' &&
                    c.provider.length > 0,
            );
        if (instances.length === 0) return;

        const resolver = this.options.credentialResolver ?? defaultEnvCredentialResolver;
        const seen = new Set<string>();
        let materialized = 0;

        for (const entry of instances) {
            const { name, provider } = entry;

            // A deliberately-disabled instance is declared but not activated —
            // the enabled:false marker, consistent with the descriptor contract.
            if (entry.enabled === false) {
                ctx.logger.info(
                    `[Automation] connector instance '${name}' (provider '${provider}') is enabled:false — declared but not materialized`,
                );
                continue;
            }

            // Two instances declaring the same name is an authoring bug — the
            // registry would otherwise silently keep one.
            if (seen.has(name)) {
                throw new Error(
                    `[Automation] duplicate declarative connector instance name '${name}' — connector names must be unique (ADR-0096).`,
                );
            }
            seen.add(name);

            // §4 conflict, init-time case: a plugin already registered this name
            // during init(). (Plugins that register in start() — after this runs —
            // are caught by the origin-tagged registerConnector when they start.)
            if (engine.getConnectorOrigin(name) === 'plugin') {
                throw new Error(
                    `[Automation] connector name conflict: declarative provider-bound instance '${name}' collides with a ` +
                        `plugin-registered connector of the same name — there is no silent precedence (ADR-0096 §4). Rename one.`,
                );
            }

            const factory = engine.getConnectorProvider(provider);
            if (!factory) {
                const installed = engine.getRegisteredConnectorProviders();
                throw new Error(
                    `[Automation] connector instance '${name}' declares provider '${provider}', but no provider factory is registered. ` +
                        `Install the connector plugin that supplies it (openapi → @objectstack/connector-openapi, mcp → @objectstack/connector-mcp, ` +
                        `rest → @objectstack/connector-rest) in the stack's plugins: array. Installed providers: ` +
                        `[${installed.join(', ') || 'none'}] (ADR-0096).`,
                );
            }

            const auth = await this.resolveInstanceAuth(entry.auth, resolver, name, provider);

            const providerCtx: ConnectorProviderContext = {
                name,
                label: entry.label ?? name,
                description: entry.description,
                icon: entry.icon,
                type: typeof entry.type === 'string' ? entry.type : 'api',
                providerConfig: entry.providerConfig ?? {},
                auth,
            };

            let materialization;
            try {
                materialization = await factory(providerCtx);
            } catch (err) {
                throw new Error(
                    `[Automation] failed to materialize connector instance '${name}' via provider '${provider}': ` +
                        `${(err as Error).message} (ADR-0096).`,
                );
            }

            // The declared name is authoritative: register under it regardless of
            // what the factory named its def, so discovery, dispatch, and the
            // conflict rule all agree with the metadata the author wrote.
            const def = { ...materialization.def, name };
            engine.registerConnector(def, materialization.handlers, 'declarative');
            if (materialization.close) {
                this.materializedConnectorClosers.push({ name, close: materialization.close });
            }
            materialized++;
            ctx.logger.info(
                `[Automation] materialized connector instance '${name}' via provider '${provider}' ` +
                    `(${def.actions?.length ?? 0} action(s))`,
            );
        }

        if (materialized > 0) {
            ctx.logger.info(
                `[Automation] materialized ${materialized} provider-bound connector instance(s) (ADR-0096)`,
            );
        }
    }

    /**
     * Resolve a declarative instance's `auth` into the static
     * {@link ResolvedConnectorAuth} a provider factory applies — dereferencing
     * `credentialRef` through the resolver. An `undefined`/empty resolution is a
     * hard boot error (ADR-0096 §3): an app must not run with a connector whose
     * credentials never loaded.
     */
    private async resolveInstanceAuth(
        auth: ConnectorInstanceAuth | undefined,
        resolver: CredentialResolver,
        connectorName: string,
        provider: string,
    ): Promise<ResolvedConnectorAuth | undefined> {
        if (!auth) return undefined;
        if (auth.type === 'none') return { type: 'none' };

        const secret = await resolver(auth.credentialRef);
        if (secret === undefined || secret === null || secret === '') {
            throw new Error(
                `[Automation] connector instance '${connectorName}' (provider '${provider}'): credentialRef ` +
                    `'${auth.credentialRef}' did not resolve to a value. The open tier resolves credentialRef from ` +
                    `environment variables — set the '${auth.credentialRef}' env var, or wire ` +
                    `AutomationServicePluginOptions.credentialResolver to a secrets service (ADR-0096 §3).`,
            );
        }

        switch (auth.type) {
            case 'bearer':
                return { type: 'bearer', token: secret };
            case 'api-key':
                return {
                    type: 'api-key',
                    key: secret,
                    headerName: auth.headerName ?? 'X-API-Key',
                    paramName: auth.paramName,
                };
            case 'basic':
                return { type: 'basic', username: auth.username, password: secret };
        }
    }

    /**
     * Read the protocol's flattened flow view — `getMetaItems({ type: 'flow' })`,
     * the same source `GET /meta/flow` serves and #2560's cold-boot bind uses.
     * Returns the list of flow docs, or `null` when the protocol is unavailable
     * or the read failed. Callers MUST treat `null` as "couldn't read", NOT as
     * "zero flows" — tearing flows down on a failed read would unbind live
     * automations.
     *
     * Unlike `registry.listItems('flow')` (the boot pull) this surfaces flows
     * defined inline in an app manifest, and unlike `metadata.list('flow')` — the
     * source this re-sync read before this fix — it is actually populated in a
     * real running server (`metadata.list('flow')` returns 0 there, so the old
     * re-sync bound nothing).
     */
    private async readFlowDefsFromProtocol(
        ctx: PluginContext,
    ): Promise<Array<{ name?: string }> | null> {
        let protocol: { getMetaItems?(q: { type: string }): Promise<unknown> } | undefined;
        try {
            protocol = ctx.getService('protocol');
        } catch {
            return null; // no protocol service (bare engine / tests) — nothing to sync
        }
        if (!protocol || typeof protocol.getMetaItems !== 'function') return null;

        let raw: unknown;
        try {
            raw = await protocol.getMetaItems({ type: 'flow' });
        } catch (err) {
            ctx.logger.warn(
                `[Automation] flow read from protocol failed: getMetaItems('flow'): ${(err as Error).message}`,
            );
            return null;
        }

        // getMetaItems hands back a bare array or an `{ items: [...] }` envelope,
        // and each entry is either the flow doc or an `{ item: <flow> }` wrapper.
        const list = Array.isArray(raw) ? raw : (((raw as { items?: unknown[] })?.items) ?? []);
        return list.map((entry) =>
            (entry && typeof entry === 'object' && 'item' in entry
                ? (entry as { item: unknown }).item
                : entry) as { name?: string },
        );
    }

    /**
     * Re-pull flow definitions from the protocol and re-register them into the
     * engine, so a RUNTIME metadata change re-binds flow triggers instead of
     * leaving the engine executing the boot-time definitions. Driven by the
     * `metadata:reloaded` hook, which fires on two runtime events:
     *   1. a dev `os dev` artifact recompile — MetadataPlugin reloads the
     *      artifact from disk and announces; and
     *   2. a Studio package publish — the runtime dispatcher announces after
     *      `publishPackageDrafts` promotes the drafts to active. Without (2), a
     *      flow authored + published while the server runs never bound its
     *      trigger (record-change automations never fired) until the next
     *      restart, even though #2560 fixed the cold-boot bind.
     *
     * Reads `protocol.getMetaItems({ type: 'flow' })` — the SAME source #2560's
     * cold-boot bind and `GET /meta/flow` use. It does NOT read the ObjectQL
     * schema registry (a boot-time cache the reload never refreshes) and — the
     * bug this fixes — no longer reads `metadata.list('flow')`, which returns 0
     * in a real running server (it does not surface inline app flows), so the old
     * re-sync was a silent no-op that bound nothing on publish.
     *
     * Idempotent and best-effort: registerFlow() re-binds the trigger
     * (ScheduleTrigger.start cancels + reschedules), flows removed from the
     * artifact are unregistered so their jobs/triggers stop firing, and any
     * failure is logged without disturbing the rest of the runtime. A failed or
     * unavailable protocol read is a no-op — it never tears down live flows.
     */
    private async resyncFlowsFromProtocol(ctx: PluginContext): Promise<void> {
        if (!this.engine) return;
        const defs = await this.readFlowDefsFromProtocol(ctx);
        if (!defs) return; // unavailable / failed read — do not tear down live flows

        const freshNames = new Set<string>();
        let resynced = 0;
        for (const def of defs) {
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
     * Bind flows from the protocol's flattened flow view at `kernel:ready`, so
     * record-triggered automations actually bind on a fresh start (#2560).
     * Additive by design — unlike {@link resyncFlowsFromProtocol} it never tears
     * flows down, so a transient empty/failed read at boot can't unbind the flows
     * the boot pull already registered. registerFlow is idempotent, so re-binding
     * a flow the boot pull already registered is harmless.
     */
    private async syncFlowsFromProtocol(ctx: PluginContext): Promise<void> {
        if (!this.engine) return;
        const defs = await this.readFlowDefsFromProtocol(ctx);
        if (!defs) return;
        let bound = 0;
        for (const def of defs) {
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
        // Tear down materialized provider-bound connectors (ADR-0096) — e.g. an
        // MCP connection's close — in reverse registration order, best-effort, so
        // no socket / child process leaks. The engine (and its registry) is dropped
        // right after, so unregistering the connectors themselves is unnecessary.
        // Teardown failures never fail shutdown (swallowed).
        for (const { close } of this.materializedConnectorClosers.reverse()) {
            try {
                await close();
            } catch {
                /* best-effort */
            }
        }
        this.materializedConnectorClosers = [];
        this.engine = undefined;
    }
}
