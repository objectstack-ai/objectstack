// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import type { Plugin, PluginContext } from '@objectstack/core';
import type { IJobService } from '@objectstack/spec/contracts';
import type {
    Connector,
    ConnectorInstanceAuth,
    ResolvedConnectorAuth,
    ConnectorProviderContext,
} from '@objectstack/spec/integration';
import { isConnectorUpstreamUnavailable } from '@objectstack/spec/integration';
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
     * secret at boot (ADR-0097 §3). Defaults to {@link defaultEnvCredentialResolver}
     * — the **open tier**: a `credentialRef` names an environment variable. An
     * enterprise host injects a vault/KMS-backed resolver here without touching
     * the materialization path. A ref that resolves to `undefined`/empty is a
     * hard boot error (an app must not silently run with a dead connector).
     */
    credentialResolver?: CredentialResolver;
    /**
     * Root directory of the stack/package whose metadata this kernel serves —
     * the base that relative file refs in declarative connector entries resolve
     * against (#3016, e.g. `providerConfig.spec: './billing-openapi.json'` for
     * `provider: 'openapi'`). The CLI passes the directory containing
     * `objectstack.config.ts`; embedders pass their stack root. Defaults to
     * `process.cwd()`. Reads are confined to this root (see
     * {@link createPackageFileLoader}).
     */
    packageRoot?: string;
}

/**
 * Build the `loadPackageFile` capability handed to provider factories via
 * {@link ConnectorProviderContext} (#3016): read a UTF-8 text file resolved
 * against `packageRoot`, **confined to that root**. Rejects absolute paths and
 * any path that escapes the root after resolution (`../…`, `a/../../…`), so a
 * declarative entry can never read outside the stack/package that declared it.
 * A missing/unreadable file throws — the materializer's reconcile policy makes
 * that fatal at boot and a skipped entry on reload, like every other ADR-0097
 * materialization failure.
 *
 * Node builtins are imported lazily inside the returned closure so merely
 * constructing the capability never touches `node:fs`/`node:path` — hosts
 * without a filesystem only fail if a factory actually dereferences a file ref.
 */
export function createPackageFileLoader(packageRoot?: string): (relativePath: string) => Promise<string> {
    return async (relativePath: string) => {
        if (typeof relativePath !== 'string' || relativePath.trim().length === 0) {
            throw new Error('package file ref must be a non-empty relative path.');
        }
        const path = await import('node:path');
        // Windows drive-letter absolutes ('C:\…') are not `isAbsolute` on posix —
        // reject them explicitly so the guard is platform-independent.
        if (path.isAbsolute(relativePath) || /^[a-zA-Z]:[\\/]/.test(relativePath)) {
            throw new Error(
                `package file ref '${relativePath}' is absolute — file refs must be relative to the declaring stack/package root.`,
            );
        }
        const root = path.resolve(packageRoot ?? process.cwd());
        const resolved = path.resolve(root, relativePath);
        const rel = path.relative(root, resolved);
        if (rel.startsWith('..') || path.isAbsolute(rel)) {
            throw new Error(
                `package file ref '${relativePath}' escapes the stack/package root — reads are confined to '${root}'.`,
            );
        }
        const { readFile } = await import('node:fs/promises');
        try {
            return await readFile(resolved, 'utf8');
        } catch (err) {
            throw new Error(
                `package file ref '${relativePath}' could not be read (resolved to '${resolved}'): ${(err as Error).message}`,
            );
        }
    };
}

/**
 * Resolves a declarative connector `credentialRef` to its plaintext secret, or
 * `undefined`/empty when unknown (which the materializer turns into a hard boot
 * error). May be async so an enterprise resolver can hit a vault. The open-tier
 * default reads from `process.env` (see {@link defaultEnvCredentialResolver}).
 */
export type CredentialResolver = (ref: string) => string | undefined | Promise<string | undefined>;

/**
 * Open-tier credential resolver (ADR-0097 §3, ADR-0015 open/enterprise line):
 * a `credentialRef` is the name of an environment variable. This is the
 * degraded-but-honest story for environments without a managed secrets service —
 * static credentials from env/config are open source; managed vaulting, OAuth2
 * refresh, and per-tenant connection lifecycle are the enterprise tier.
 */
export const defaultEnvCredentialResolver: CredentialResolver = (ref) =>
    typeof process !== 'undefined' ? process.env?.[ref] : undefined;

/**
 * Retry backoff for **degraded** declarative instances (#3017) — provider-bound
 * entries whose upstream (e.g. an MCP server) was unreachable at
 * materialization. First retry after {@link DECLARATIVE_RETRY_BASE_MS}, doubling
 * per consecutive failure up to {@link DECLARATIVE_RETRY_MAX_MS}, so a server
 * that comes up seconds after the app recovers fast while a long outage doesn't
 * generate connection spam. A `metadata:reloaded` reconcile also retries
 * immediately, and a config edit to the entry resets the backoff.
 */
export const DECLARATIVE_RETRY_BASE_MS = 5_000;
/** Ceiling for the degraded-instance retry backoff (#3017). */
export const DECLARATIVE_RETRY_MAX_MS = 300_000;

/**
 * Deterministic JSON stringify (keys sorted at every level) so a signature is
 * stable regardless of authored key order — two materialization inputs that
 * differ only in key order hash identically and don't trigger a needless
 * re-materialize.
 */
function stableStringify(input: unknown): string {
    if (input === null || typeof input !== 'object') return JSON.stringify(input) ?? 'null';
    if (Array.isArray(input)) return '[' + input.map(stableStringify).join(',') + ']';
    const obj = input as Record<string, unknown>;
    return '{' + Object.keys(obj).sort().map((k) => JSON.stringify(k) + ':' + stableStringify(obj[k])).join(',') + '}';
}

/**
 * Stable signature of a provider-bound instance's materialization inputs
 * (ADR-0097). Drives the `metadata:reloaded` reconcile: an unchanged signature
 * means the live connector is left untouched (no MCP reconnect); a changed one
 * triggers re-materialization. `auth` carries only the `credentialRef`, never a
 * resolved secret, so hashing the declarative entry is safe.
 */
function connectorInstanceSignature(entry: {
    provider?: unknown;
    providerConfig?: unknown;
    auth?: unknown;
    label?: unknown;
    description?: unknown;
    icon?: unknown;
    type?: unknown;
}): string {
    return stableStringify({
        provider: entry.provider ?? null,
        providerConfig: entry.providerConfig ?? null,
        auth: entry.auth ?? null,
        label: entry.label ?? null,
        description: entry.description ?? null,
        icon: entry.icon ?? null,
        type: entry.type ?? null,
    });
}

/**
 * The shape of a declarative `connectors:` stack entry as it sits in the
 * ObjectQL metadata registry (registered by `registerApp` under kind
 * 'connector'). Raw authored values — Zod defaults (e.g. `enabled: true`)
 * may not have been applied, so `enabled` is only trusted when explicitly
 * `false`. `provider` (+ `providerConfig`/`auth`) marks a provider-bound
 * **instance** the automation service materializes at boot (ADR-0097);
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
 * the ADR-0097 instance contract, not the descriptor-only warning (#2977).
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
     * Provider-bound declarative connectors this plugin has materialized
     * (ADR-0097), keyed by connector name. `signature` is a stable hash of the
     * entry's materialization inputs so a `metadata:reloaded` reconcile can tell
     * an unchanged instance (skip — don't re-open its MCP connection) from a
     * changed one (re-materialize). `close` is the optional teardown (e.g. an MCP
     * connection), invoked on removal, replacement, and `destroy()` so no socket /
     * child process leaks.
     */
    private materializedConnectors = new Map<string, { signature: string; close?: () => void | Promise<void> }>();
    /**
     * Degraded declarative instances (#3017): provider-bound entries whose
     * upstream was unreachable at materialization. Keyed by connector name;
     * `attempts` drives the retry backoff, `signature` detects a config edit
     * (which resets the backoff), `reason` is what the registered husk surfaces.
     * Disjoint from {@link materializedConnectors} EXCEPT when a *changed*
     * entry's re-materialization failed — then the old live connector keeps
     * serving (still tracked there) while the retry is pending here.
     */
    private degradedInstances = new Map<string, { attempts: number; signature: string; reason: string }>();
    private declarativeRetryTimer?: ReturnType<typeof setTimeout>;
    /** Serializes reconcile runs — see {@link materializeDeclaredConnectors}. */
    private reconcileQueue: Promise<void> = Promise.resolve();
    private destroyed = false;

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

        // ── ADR-0097: materialize provider-bound declarative connector instances ──
        // Every plugin's init() has completed by start(), so connector plugins have
        // registered their provider factories (they do so in init()) and the ObjectQL
        // registry is fully populated with declared `connectors:` entries. Turn each
        // provider-bound entry into a live, dispatchable connector now. Deliberately
        // NOT wrapped in a swallowing try/catch: a misconfiguration (unknown provider,
        // invalid providerConfig, unresolvable credentialRef, name conflict) MUST fail
        // boot loudly — a metadata platform shipping a plausible-but-dead connector is
        // the worst failure mode. A start()-phase throw is fatal under both LiteKernel
        // and ObjectKernel (rollbackOnFailure defaults on), so the operator sees it.
        // One carve-out (#3017): a factory signalling its UPSTREAM is temporarily
        // unreachable (CONNECTOR_UPSTREAM_UNAVAILABLE) degrades that one instance —
        // registered action-less + retried with backoff — instead of failing boot;
        // an operational blip in one integration must not take the whole app down.
        await this.materializeDeclaredConnectors(ctx, { fatal: true });

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
            // A Studio publish / dev reload can add, change, or remove declarative
            // provider-bound connector instances — reconcile the live registry so
            // a newly-published instance becomes dispatchable (and a removed one
            // is torn down) without a restart (ADR-0097). Soft mode: a bad publish
            // logs + skips rather than crashing the running server.
            await this.materializeDeclaredConnectors(ctx, { fatal: false });
            // Re-audit so the inert-descriptor warning stays current for plain
            // descriptors (see auditDeclaredConnectors).
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

        // ── Silent-miss audit: unbound triggered flows (2026-07-17 eval) ──────
        // kernel:bootstrapped fires strictly after EVERY kernel:ready handler —
        // i.e. after the protocol flow sync above AND after trigger plugins
        // (record-change, schedule, api) registered their triggers. Anything
        // still unbound here stays unbound: say so, per flow, with the fix.
        // One caveat: plain warn/info goes to stdout, which the CLI swallows
        // during boot — serve.ts therefore ALSO surfaces this audit in the
        // startup summary. The warn matters for embedded hosts and tests.
        ctx.hook('kernel:bootstrapped', async () => {
            if (!this.engine) return;
            const audit = this.engine.getTriggerBindingAudit();
            for (const entry of audit) {
                ctx.logger.warn(
                    `[Automation] flow '${entry.flowName}' declares a '${entry.triggerType}' trigger but is NOT bound — it will never auto-launch. ${entry.reason}`,
                );
            }
            const states = this.engine.getFlowRuntimeStates();
            const drafts = states.filter((s) => s.enabled && (s.status ?? 'draft') === 'draft');
            if (drafts.length > 0) {
                ctx.logger.info(
                    `[Automation] ${drafts.length} flow(s) have status 'draft' (${drafts.map((d) => d.name).join(', ')}) — ` +
                        `draft flows still fire their triggers; set status: 'active' to make intent explicit, or 'obsolete' to disable.`,
                );
            }
            const bound = states.filter((s) => s.bound).length;
            if (states.length > 0) {
                ctx.logger.info(
                    `[Automation] ${states.length} flow(s) registered, ${bound} bound to triggers, ${audit.length} unbound-but-triggered`,
                );
            }
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
                `Declarative provider-bound connector instances are tracked in #2977 (ADR-0097).`,
        );
    }

    /**
     * ADR-0097 — reconcile the live connector registry against the declared
     * provider-bound `connectors:` entries. For each enabled entry naming a
     * `provider`: look up the provider factory, resolve `auth.credentialRef`,
     * invoke the factory, and register the result under the **declared** name
     * (tagged `declarative`). Entries that vanished (or were disabled) since the
     * last reconcile are unregistered and torn down; unchanged entries are left
     * alone (an unchanged MCP instance is NOT reconnected); changed entries are
     * re-materialized.
     *
     * Two modes:
     *  - **Boot** (`fatal: true`, called from `start()`): any problem — unknown
     *    provider, invalid `providerConfig`, unresolvable `credentialRef`, name
     *    conflict, duplicate — **throws**, which is fatal to bootstrap under both
     *    LiteKernel and ObjectKernel (the ADR's "fail loudly" contract).
     *  - **Reload** (`fatal: false`, called from `metadata:reloaded`): the same
     *    problems are **logged and the offending entry is skipped**, so a bad
     *    Studio publish / dev reload never crashes a live server. A changed
     *    entry's old connector keeps serving until the new one materializes
     *    successfully.
     *
     * Reads the same ObjectQL registry the descriptor audit uses; without one
     * there is nothing declared, hence nothing to reconcile.
     *
     * **Upstream-availability exception (#3017):** a provider factory that
     * throws the `CONNECTOR_UPSTREAM_UNAVAILABLE` marker (e.g. `connector-mcp`
     * when the MCP server is unreachable) is an *operational* fault, not a
     * configuration fault — in BOTH modes the instance is **degraded** instead
     * of failing the run: registered as an action-less husk (visible via
     * `GET /connectors`, dispatch errors clearly) when nothing live holds the
     * name, or the previous live connector keeps serving on a changed-config
     * re-materialize. Degraded instances are retried with exponential backoff
     * ({@link DECLARATIVE_RETRY_BASE_MS}) and on every reconcile.
     */
    private materializeDeclaredConnectors(ctx: PluginContext, opts: { fatal: boolean }): Promise<void> {
        // Serialize runs: boot, `metadata:reloaded`, and the degraded-retry
        // timer can all request a reconcile; concurrent runs would race the
        // registry and the tracked maps. Each caller still observes its own
        // run's failure (a fatal boot error propagates), while the chain itself
        // is never left poisoned for the next caller.
        const run = this.reconcileQueue.then(() => this.reconcileDeclaredConnectors(ctx, opts));
        this.reconcileQueue = run.catch(() => undefined);
        return run;
    }

    private async reconcileDeclaredConnectors(ctx: PluginContext, opts: { fatal: boolean }): Promise<void> {
        const engine = this.engine;
        if (!engine || this.destroyed) return;
        // This run supersedes any pending degraded-instance retry; it is
        // rescheduled at the end if instances remain degraded.
        this.clearDeclarativeRetryTimer();

        let declared: unknown[] = [];
        try {
            const ql = ctx.getService<{
                registry?: { listItems?: (type: string) => unknown[] };
            }>('objectql');
            declared = ql?.registry?.listItems?.('connector') ?? [];
        } catch {
            return; // no registry — nothing declared
        }

        // Report a reconcile problem: fatal (boot) throws; soft (reload) logs.
        const fail = (msg: string): void => {
            if (opts.fatal) throw new Error(msg);
            ctx.logger.error(msg);
        };

        // Build the desired set: enabled provider-bound instances, keyed by name.
        // A descriptor (no `provider`) or an `enabled: false` instance is not
        // desired — if we materialized it before, it is torn down below.
        const desired = new Map<string, { entry: DeclaredConnectorItem & { name: string; provider: string }; signature: string }>();
        for (const raw of declared) {
            const entry = raw as DeclaredConnectorItem;
            if (typeof entry?.name !== 'string' || entry.name.length === 0) continue;
            if (typeof entry.provider !== 'string' || entry.provider.length === 0) continue;
            const bound = entry as DeclaredConnectorItem & { name: string; provider: string };
            if (bound.enabled === false) continue;
            if (desired.has(bound.name)) {
                fail(`[Automation] duplicate declarative connector instance name '${bound.name}' — connector names must be unique (ADR-0097).`);
                continue;
            }
            desired.set(bound.name, { entry: bound, signature: connectorInstanceSignature(bound) });
        }

        // 1. Remove connectors we previously materialized that are no longer
        //    desired (deleted from the stack, or newly `enabled: false`).
        for (const [name, tracked] of [...this.materializedConnectors]) {
            if (desired.has(name)) continue;
            await this.dematerializeConnector(engine, name, tracked, ctx);
        }
        // Degraded instances (#3017) whose entry vanished / was disabled are
        // dropped too: unregister the husk (idempotent — a kept-serving old
        // connector was already torn down above) and forget the retry.
        for (const name of [...this.degradedInstances.keys()]) {
            if (desired.has(name)) continue;
            this.degradedInstances.delete(name);
            try { engine.unregisterConnector(name); } catch { /* ignore */ }
            ctx.logger.info(`[Automation] dropped degraded connector instance '${name}' (no longer declared)`);
        }

        // 2. Add new instances and re-materialize changed ones (signature diff).
        const resolver = this.options.credentialResolver ?? defaultEnvCredentialResolver;
        let changed = 0;
        for (const [name, { entry, signature }] of desired) {
            const existing = this.materializedConnectors.get(name);
            if (existing && existing.signature === signature) {
                // Unchanged — leave the live connector as-is. If a retry was
                // pending for a *changed* config that has since been reverted,
                // the live connector is already the desired one: cancel it.
                if (this.degradedInstances.delete(name)) {
                    ctx.logger.info(
                        `[Automation] connector instance '${name}' reverted to its live configuration; pending retry cancelled (#3017)`,
                    );
                }
                continue;
            }

            const provider = entry.provider;

            // §4 conflict: the name is held by a plugin-registered connector (not
            // one of ours). Never silently replace across origins.
            if (!existing && engine.getConnectorOrigin(name) === 'plugin') {
                fail(
                    `[Automation] connector name conflict: declarative provider-bound instance '${name}' collides with a ` +
                        `plugin-registered connector of the same name — there is no silent precedence (ADR-0097 §4). Rename one.`,
                );
                continue;
            }

            const factory = engine.getConnectorProvider(provider);
            if (!factory) {
                const installed = engine.getRegisteredConnectorProviders();
                fail(
                    `[Automation] connector instance '${name}' declares provider '${provider}', but no provider factory is registered. ` +
                        `Install the connector plugin that supplies it (openapi → @objectstack/connector-openapi, mcp → @objectstack/connector-mcp, ` +
                        `rest → @objectstack/connector-rest) in the stack's plugins: array. Installed providers: ` +
                        `[${installed.join(', ') || 'none'}] (ADR-0097).`,
                );
                continue;
            }

            let auth;
            try {
                auth = await this.resolveInstanceAuth(entry.auth, resolver, name, provider);
            } catch (err) {
                fail((err as Error).message);
                continue;
            }

            const providerCtx: ConnectorProviderContext = {
                name,
                label: entry.label ?? name,
                description: entry.description,
                icon: entry.icon,
                type: typeof entry.type === 'string' ? entry.type : 'api',
                providerConfig: entry.providerConfig ?? {},
                auth,
                // #3016 — lets a factory dereference relative file refs (e.g.
                // openapi's `providerConfig.spec: './billing-openapi.json'`),
                // confined to the stack/package root.
                loadPackageFile: createPackageFileLoader(this.options.packageRoot),
            };

            let materialization;
            try {
                materialization = await factory(providerCtx);
            } catch (err) {
                // #3017 — an *operational* fault (upstream unreachable) degrades
                // the one instance instead of failing the run, in BOTH modes;
                // only configuration faults keep the fail-loud contract below.
                if (isConnectorUpstreamUnavailable(err)) {
                    this.degradeConnectorInstance(engine, ctx, {
                        name,
                        entry,
                        provider,
                        signature,
                        hasLive: existing !== undefined,
                        reason: (err as Error).message,
                    });
                    continue;
                }
                fail(
                    `[Automation] failed to materialize connector instance '${name}' via provider '${provider}': ` +
                        `${(err as Error).message} (ADR-0097).`,
                );
                continue;
            }

            // The new bundle is ready. Only NOW tear down the previous connection
            // (on a change), so a failed re-materialization above left the old
            // connector serving untouched.
            if (existing?.close) {
                try { await existing.close(); } catch { /* best-effort */ }
            }

            // The declared name is authoritative: register under it regardless of
            // what the factory named its def, so discovery, dispatch, and the
            // conflict rule all agree with the metadata the author wrote.
            const def = { ...materialization.def, name };
            engine.registerConnector(def, materialization.handlers, 'declarative');
            this.materializedConnectors.set(name, { signature, close: materialization.close });
            // Success clears any pending degraded retry — including replacing a
            // registered husk (registerConnector above overwrote it).
            const recovered = this.degradedInstances.delete(name);
            changed++;
            ctx.logger.info(
                `[Automation] ${recovered ? 'recovered' : existing ? 're-materialized' : 'materialized'} ` +
                    `connector instance '${name}' via provider '${provider}' (${def.actions?.length ?? 0} action(s))`,
            );
        }

        if (changed > 0) {
            ctx.logger.info(
                `[Automation] materialized ${changed} provider-bound connector instance(s) (ADR-0097)`,
            );
        }

        // #3017 — instances still degraded after this run retry on a backoff.
        this.scheduleDeclarativeRetry(ctx);
    }

    /**
     * Track one instance as degraded (#3017) and make the failure honest:
     * unless a previously-materialized connector still holds the name (a
     * changed-config re-materialize failure — the old connector keeps serving,
     * same guarantee as every other reload failure), register an action-less
     * husk so `GET /connectors` shows the instance with `state: 'degraded'`
     * and a `connector_action` dispatch fails with the reason, rather than the
     * instance silently missing. A config edit (signature change) resets the
     * backoff — it is a different upstream/config now.
     */
    private degradeConnectorInstance(
        engine: AutomationEngine,
        ctx: PluginContext,
        info: {
            name: string;
            entry: DeclaredConnectorItem;
            provider: string;
            signature: string;
            hasLive: boolean;
            reason: string;
        },
    ): void {
        const prior = this.degradedInstances.get(info.name);
        const attempts = prior && prior.signature === info.signature ? prior.attempts + 1 : 1;
        this.degradedInstances.set(info.name, { attempts, signature: info.signature, reason: info.reason });

        if (!info.hasLive) {
            try {
                engine.registerDegradedConnector(
                    this.buildDegradedHuskDef(info.name, info.entry),
                    info.reason,
                    'declarative',
                );
            } catch (err) {
                // Can't even register the husk (e.g. the entry's def no longer
                // parses) — the retry bookkeeping above still drives recovery.
                ctx.logger.warn(
                    `[Automation] could not register degraded husk for '${info.name}': ${(err as Error).message}`,
                );
            }
        }
        ctx.logger.error(
            `[Automation] connector instance '${info.name}' (provider '${info.provider}') upstream unavailable — ` +
                (info.hasLive
                    ? 'the previously-materialized connector keeps serving'
                    : 'instance registered degraded (no actions)') +
                `; retrying with backoff, attempt ${attempts} (#3017): ${info.reason}`,
        );
    }

    /** The action-less `status: 'error'` def a degraded instance registers (#3017). */
    private buildDegradedHuskDef(name: string, entry: DeclaredConnectorItem): Connector {
        return {
            name,
            label: entry.label ?? name,
            description: entry.description,
            icon: entry.icon,
            type: (typeof entry.type === 'string' ? entry.type : 'api') as Connector['type'],
            // 'error' is the ConnectorStatusSchema value for "has errors" — the
            // husk is honest metadata, not a dispatchable connector.
            status: 'error',
            enabled: true,
            authentication: { type: 'none' },
            connectionTimeoutMs: 30000,
            requestTimeoutMs: 30000,
            actions: [],
        };
    }

    /** Backoff for degraded-instance retries (#3017): base · 2^(attempts-1), capped. */
    private static declarativeRetryDelayMs(attempts: number): number {
        return Math.min(DECLARATIVE_RETRY_BASE_MS * 2 ** Math.max(0, attempts - 1), DECLARATIVE_RETRY_MAX_MS);
    }

    private clearDeclarativeRetryTimer(): void {
        if (this.declarativeRetryTimer !== undefined) {
            clearTimeout(this.declarativeRetryTimer);
            this.declarativeRetryTimer = undefined;
        }
    }

    /**
     * Arm one retry timer for the soonest-due degraded instance (#3017). The
     * retry is a full soft reconcile — it re-reads the registry, so it also
     * picks up whatever else changed — and reconcile re-arms the timer while
     * anything stays degraded. `unref()` (where available) keeps the timer from
     * holding the process open.
     */
    private scheduleDeclarativeRetry(ctx: PluginContext): void {
        this.clearDeclarativeRetryTimer();
        if (this.destroyed || this.degradedInstances.size === 0) return;
        const delay = Math.min(
            ...[...this.degradedInstances.values()].map((d) =>
                AutomationServicePlugin.declarativeRetryDelayMs(d.attempts),
            ),
        );
        const timer = setTimeout(() => {
            this.declarativeRetryTimer = undefined;
            // Always soft: a background retry must never crash a running server.
            void this.materializeDeclaredConnectors(ctx, { fatal: false });
        }, delay);
        (timer as unknown as { unref?: () => void }).unref?.();
        this.declarativeRetryTimer = timer;
        ctx.logger.info(
            `[Automation] ${this.degradedInstances.size} degraded connector instance(s); next retry in ${delay}ms (#3017)`,
        );
    }

    /** Unregister and tear down one materialized declarative connector (ADR-0097). */
    private async dematerializeConnector(
        engine: AutomationEngine,
        name: string,
        tracked: { close?: () => void | Promise<void> },
        ctx: PluginContext,
    ): Promise<void> {
        try { engine.unregisterConnector(name); } catch { /* ignore */ }
        if (tracked.close) {
            try { await tracked.close(); } catch { /* best-effort */ }
        }
        this.materializedConnectors.delete(name);
        ctx.logger.info(`[Automation] unregistered declarative connector instance '${name}' (no longer declared)`);
    }

    /**
     * Resolve a declarative instance's `auth` into the static
     * {@link ResolvedConnectorAuth} a provider factory applies — dereferencing
     * `credentialRef` through the resolver. An `undefined`/empty resolution is a
     * hard boot error (ADR-0097 §3): an app must not run with a connector whose
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
                    `AutomationServicePluginOptions.credentialResolver to a secrets service (ADR-0097 §3).`,
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
        // Stop the degraded-instance retry loop first (#3017): mark destroyed so
        // an already-queued reconcile no-ops, and cancel any armed timer.
        this.destroyed = true;
        this.clearDeclarativeRetryTimer();
        this.degradedInstances.clear();
        // Tear down materialized provider-bound connectors (ADR-0097) — e.g. an
        // MCP connection's close — in reverse registration order, best-effort, so
        // no socket / child process leaks. The engine (and its registry) is dropped
        // right after, so unregistering the connectors themselves is unnecessary.
        // Teardown failures never fail shutdown (swallowed).
        for (const [, tracked] of [...this.materializedConnectors].reverse()) {
            if (!tracked.close) continue;
            try {
                await tracked.close();
            } catch {
                /* best-effort */
            }
        }
        this.materializedConnectors.clear();
        this.engine = undefined;
    }
}
