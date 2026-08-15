// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { Plugin, PluginContext, wireAuthoredTranslationSync } from '@objectstack/core';
import { assertProtocolCompat } from '@objectstack/metadata-core';
import { resolveTenancyPosture } from '@objectstack/types';
import { postureEnforcesWall, type TenancyPosture } from '@objectstack/spec/security';
import { SeedLoaderService } from './seed-loader.js';
import { recordSeedOutcome } from './seed-summary.js';
import { mergeSeedDatasets, readSeedDatasets, registerSeedReplayerOnce } from './seed-datasets.js';
import { declareSeedSource } from './seed-settlement.js';
import { loadDisabledPackageIds } from './package-state-store.js';
import type { IJobService, IMetadataService, IObjectQLEngine, II18nService } from '@objectstack/spec/contracts';
import { normalizeFlowFunctionEntry, type NormalizedFlowFunction } from '@objectstack/spec/automation';
import { readServiceSelfInfo } from '@objectstack/spec/api';
import { QuickJSScriptRunner } from './sandbox/quickjs-runner.js';
import { hookBodyRunnerFactory, actionBodyRunnerFactory } from './sandbox/body-runner.js';
import { GLOBAL_ACTION_OBJECT_KEY } from './action-execution.js';
import { toBoundaryJobSchedule } from './job-schedule.js';
import { countServerTiming, SEMCONV } from '@objectstack/observability';
import { resolveMetrics } from './observability/observability-service-plugin.js';

/**
 * The write options every seed insert must use — mirrors
 * `SeedLoaderService.SEED_OPTIONS`. `skipTriggers` is the load-bearing part:
 * seed rows are pre-existing end-state data, not user events, so firing
 * "on create" automation for them is semantically wrong and was the vector for
 * a self-trigger loop that wedged first boot. `isSystem` alone does NOT suppress
 * dispatch — only `skipTriggers` does — so the two basic-insert fallbacks below
 * used to seed with automation live while the main path had it suppressed
 * (#3760).
 */
const SEED_WRITE_OPTIONS = { context: { isSystem: true, skipTriggers: true, seedReplay: true } } as const;

/**
 * Optional per-project context attached when AppPlugin is instantiated by the
 * project kernel factory. Required for the `app:registered` / `app:unregistered`
 * hooks that drive the org-scoped `sys_app` catalog. Standalone (single-tenant)
 * usages may omit this — no catalog hooks are emitted in that case.
 */

export interface AppPluginProjectContext {
    environmentId: string;
    organizationId: string;
    projectName?: string;
    /** When the app comes from a package installation, the source package id. */
    packageId?: string;
    /** Defaults to 'package' when packageId is set, otherwise 'user'. */
    source?: 'package' | 'user';
}

/**
 * AppPlugin
 * 
 * Adapts a generic App Bundle (Manifest + Runtime Code) into a Kernel Plugin.
 * 
 * Responsibilities:
 * 1. Register App Manifest as a service (for ObjectQL discovery)
 * 2. Execute Runtime `onEnable` hook (for code logic)
 * 3. Auto-load i18n translation bundles into the kernel's i18n service
 */
export class AppPlugin implements Plugin {
    name: string;
    type = 'app';
    version?: string;
    /**
     * Ordering — declared, not positional (ADR-0116, the #4131 close of
     * #4085). `init()` synchronously registers the manifest through the
     * `manifest` service and seeds package state / sandbox runners through
     * `objectql` — both registered by ObjectQLPlugin's init. For months that
     * ordering held only because callers happened to `use()` this plugin in
     * the right slot; #4085 is what the wrong slot looks like. Soft (order-
     * if-present) rather than hard because AppPlugin is deliberately
     * composed on engine-less kernels too (metadata-only one-shot commands,
     * mock-engine tests) where it degrades: every `objectql` touch in init
     * is behind a try/catch.
     */
    optionalDependencies = ['com.objectstack.engine.objectql'];
    /**
     * The one init-time service this plugin CANNOT degrade without: a
     * non-empty bundle is registered via `getService('manifest').register()`
     * with no fallback. Declared so a composition that breaks it fails as a
     * named ordering/composition error before init side effects (#4131).
     * Cleared in the constructor for the empty-env no-op path, which never
     * touches the service.
     */
    requiresServices: string[] = ['manifest'];

    private bundle: any;
    private projectContext?: AppPluginProjectContext;
    /** When true, init/start become no-ops — env has no app payload. */
    private readonly empty: boolean = false;
    /**
     * Suppress the inline boot seed (#3917). One-shot schema commands
     * (`os migrate plan` / `os migrate apply`) boot the full plugin set purely
     * to read metadata, and a boot that writes demo rows into the operator's
     * live database before they have confirmed anything is the same class of
     * bug as boot-time DDL. The `seed-replayer` service is still registered —
     * it only writes when something calls it.
     */
    private readonly skipSeedData: boolean;

    constructor(
        bundle: any,
        projectContext?: AppPluginProjectContext,
        opts: { skipSeedData?: boolean } = {},
    ) {
        this.bundle = bundle;
        this.projectContext = projectContext;
        this.skipSeedData = opts.skipSeedData ?? false;
        // Support both direct manifest (legacy) and Stack Definition (nested manifest)
        const sys = bundle?.manifest || bundle;
        const appId = sys?.id || sys?.name;

        if (!appId) {
            // No app id at all. Two scenarios:
            //   (a) Empty environment — the artifact only ships the bootstrap
            //       envelope ({ manifest: { plugins, drivers, engines }, functions: [] })
            //       with no app categories. We must NOT crash kernel boot
            //       here, otherwise every brand-new env returns 500.
            //   (b) Malformed envelope where an app payload exists but the
            //       caller forgot to pass `manifest`. We throw loudly with
            //       diagnostics so the bug surfaces immediately.
            // App-category keys that indicate "this bundle was supposed to
            // register an app". `manifest`/`functions` are envelope-level
            // wrappers and don't count.
            const APP_CATEGORY_KEYS = [
                'objects', 'views', 'apps', 'pages', 'dashboards', 'reports',
                'flows', 'workflows', 'triggers', 'agents', 'tools', 'skills',
                'actions', 'permissions', 'positions', 'translations',
                'sharingRules', 'ragPipelines', 'data', 'emailTemplates',
                'docs', 'books',
            ];
            const hasAppPayload = APP_CATEGORY_KEYS.some((k) => {
                const v = (bundle && bundle[k]) ?? (sys && sys[k]);
                return Array.isArray(v) && v.length > 0;
            });

            if (!hasAppPayload) {
                // Empty env — degrade to a no-op plugin so kernel boot
                // succeeds. Auth / data routes will still work; there's
                // simply nothing to register. No manifest is registered on
                // this path, so the init-service requirement is dropped —
                // empty envs boot on kernels with no engine at all.
                this.empty = true;
                this.requiresServices = [];
                const envSlug = projectContext?.environmentId
                    ? projectContext.environmentId.slice(0, 8)
                    : 'empty';
                this.name = `plugin.app.empty-${envSlug}`;
                return;
            }

            // Has app payload but no id — genuine malformed envelope.
            const bundleKeys = bundle && typeof bundle === 'object'
                ? Object.keys(bundle).slice(0, 20).join(',')
                : typeof bundle;
            const sysKeys = sys && typeof sys === 'object'
                ? Object.keys(sys).slice(0, 20).join(',')
                : typeof sys;
            const ctxHint = projectContext
                ? ` projectContext=${JSON.stringify({
                    environmentId: projectContext.environmentId,
                    packageId: projectContext.packageId,
                    source: projectContext.source,
                })}`
                : '';
            throw new Error(
                `[AppPlugin] bundle has app payload but no manifest.id / manifest.name — `
                + `cannot register as a plugin. bundleKeys=[${bundleKeys}] `
                + `sysKeys=[${sysKeys}]${ctxHint}`,
            );
        }

        this.name = `plugin.app.${appId}`;
        this.version = sys?.version;
    }

    init = async (ctx: PluginContext) => {
        // Install the engine-wide default hook body runner FIRST — even for
        // empty envs (an empty env is exactly where a user will author their
        // first Studio hook). Runs in init (Phase 1) so it is in place before
        // ObjectQLPlugin.start binds metadata-service hooks in Phase 2 (#2588).
        this.installDefaultHookBodyRunner(ctx);
        // Same for the action runner — authored actions register in Phase 2's
        // authored-action re-sync and need the sandbox bridge in place (#2605).
        this.installDefaultActionBodyRunner(ctx);
        // Feed per-hook execution time into the request-scoped perf collector
        // so the `Server-Timing` header can split "hook time" from "DB time".
        // Same boot point as the runners so it is in place before Phase 2 binds
        // metadata-service hooks; a no-op unless perf-tuning is on.
        this.installHookMetricsTiming(ctx);
        // Wire the authored-translation sync (#2591) — also BEFORE the empty-env
        // return: an empty env is exactly where a user authors their first
        // Studio translation. Covers whatever `i18n` service this kernel ends
        // up with (the core in-memory fallback included); idempotent across
        // multiple wirers via the ownership marker in core.
        wireAuthoredTranslationSync(ctx as any);
        // Seed persisted package disable-state — also BEFORE the empty-env
        // return (#5047). An empty env is EXACTLY the hydration-only scenario:
        // the artifact ships no app payload, so every package in that
        // environment arrives later from `sys_packages` (PackageServicePlugin's
        // Phase 2 rehydrate) or from an HTTP install. Seeding after the return
        // meant the registry's initial-disabled set stayed empty on those
        // envs, and a package an operator had disabled came back ENABLED on
        // every restart. The seed must land before ANY registration path runs,
        // which is Phase 1, unconditionally.
        this.seedPersistedDisabledPackages(ctx);
        if (this.empty) {
            ctx.logger.debug('[AppPlugin] empty env — no app payload, skipping init', {
                pluginName: this.name,
            });
            return;
        }
        const sys = this.bundle.manifest || this.bundle;
        const appId = sys.id || sys.name;

        // ADR-0087 D1 — protocol handshake on the code-defined-stack LOAD seam,
        // BEFORE the manifest is decomposed into the registry. A bundle whose
        // declared `engines.protocol` excludes this runtime's major fails boot
        // fast with the structured OS_PROTOCOL_INCOMPATIBLE diagnostic (naming
        // the `migrate meta` command) instead of crashing later in a schema
        // `.parse()` or renderer contract. Absent/unparsable ranges are admitted
        // with a warning (grandfathering; never a false rejection).
        assertProtocolCompat(sys, undefined, (m) => ctx.logger.warn(`[AppPlugin] ${m}`));

        ctx.logger.info('Registering App Service', {
            appId,
            pluginName: this.name,
            version: this.version
        });
        
        // Register the app manifest directly via the manifest service.
        // This immediately decomposes the manifest into SchemaRegistry entries.
        const servicePayload = this.bundle.manifest
            ? { ...this.bundle.manifest, ...this.bundle }
            : this.bundle;

        ctx.getService<{ register(m: any): void }>('manifest').register(servicePayload);
    }

    /**
     * Seed persisted package disable-state into the registry's initial-disabled
     * set, so every later registration path — boot artifact decomposition,
     * marketplace / `sys_packages` rehydrate, local import — installs those
     * packages DISABLED and they stay hidden after a restart.
     *
     * Runs in init (Phase 1) and BEFORE the empty-env return (#5047), for the
     * same reason the runners above do: the seed only works if it is in place
     * before the FIRST `installPackage` call, and on an empty env every
     * package arrives from Phase 2 hydration rather than from this bundle.
     * On a non-empty env it still lands before the manifest is decomposed,
     * because that decomposition happens at the `manifest.register()` call at
     * the end of init.
     *
     * Best-effort — never block boot on this. Degrades silently on kernels
     * with no engine (metadata-only one-shot commands, mock-engine tests).
     */
    private seedPersistedDisabledPackages(ctx: PluginContext): void {
        try {
            const ql = ctx.getService<{ registry?: { setInitialDisabledPackageIds?: (ids: Iterable<string>) => void } }>('objectql');
            const setter = ql?.registry?.setInitialDisabledPackageIds;
            if (typeof setter === 'function') {
                const disabled = loadDisabledPackageIds(this.projectContext?.environmentId);
                if (disabled.size > 0) {
                    setter.call(ql!.registry, disabled);
                    ctx.logger.info('[AppPlugin] seeded persisted disabled packages', {
                        environmentId: this.projectContext?.environmentId,
                        disabled: Array.from(disabled),
                    });
                }
            }
        } catch (err) {
            ctx.logger.warn('[AppPlugin] failed to seed persisted package state', {
                error: (err as Error)?.message ?? String(err),
            });
        }
    }

    /**
     * Install the engine's DEFAULT hook body runner (`engine.setDefaultBodyRunner`).
     *
     * Hooks authored at runtime (Studio → `protocol.saveMetaItem` → publish)
     * bind through paths that pass no explicit `bodyRunner` — notably
     * ObjectQLPlugin's metadata-service bind — so without this default their
     * L1/L2 `body` is silently dropped by `bindHooksToEngine` and the hook
     * never runs (#2588). The runtime owns the sandbox bridge (objectql stays
     * sandbox-free), so this is the boot point that wires it: same
     * QuickJS-sandboxed, capability-gated runner the `defineStack({ hooks })`
     * bind already uses.
     *
     * `OS_DISABLE_AUTHORED_HOOKS=1` opts out for deployments that want
     * runtime-authored (DB-stored, non-code-reviewed) hook bodies to stay
     * inert; code-shipped hooks are unaffected (AppPlugin passes its own
     * runner explicitly).
     *
     * Idempotent: the first AppPlugin to run installs it; the runner is
     * bundle-agnostic (it only closes over the engine + logger).
     */
    private installDefaultHookBodyRunner(ctx: PluginContext): void {
        if (process.env.OS_DISABLE_AUTHORED_HOOKS === '1') {
            ctx.logger.info('[AppPlugin] OS_DISABLE_AUTHORED_HOOKS=1 — runtime-authored hook bodies will not execute');
            return;
        }
        let ql: IObjectQLEngine | undefined;
        try {
            ql = ctx.getService<IObjectQLEngine>('objectql');
        } catch {
            return; // no engine on this kernel — nothing to wire
        }
        if (!ql || typeof ql.setDefaultBodyRunner !== 'function') return;
        // [#4251] The setter is first-wins — the engine keeps the first runner
        // when several AppPlugins share one kernel; this caller no longer
        // probes the engine's private `_defaultBodyRunner` field to find out.
        const installed = ql.setDefaultBodyRunner(hookBodyRunnerFactory(new QuickJSScriptRunner(), {
            ql,
            logger: ctx.logger,
            appId: 'runtime-authored',
        }));
        if (installed !== false) {
            ctx.logger.info('[AppPlugin] Installed default hook body runner (runtime-authored hooks can execute)');
        }
    }

    /**
     * Install the engine's DEFAULT action body runner (`engine.setDefaultActionRunner`).
     *
     * The exact action-path parallel of {@link installDefaultHookBodyRunner}
     * (#2605 item 1): actions authored at runtime (Studio → `action` metadata →
     * publish) are registered by ObjectQLPlugin's authored-action re-sync,
     * which lives in `objectql` and therefore has no sandbox of its own. This
     * boot point hands it the same QuickJS-sandboxed runner that
     * `defineStack({ actions })` bundles already execute through, so an
     * authored `body` becomes a real `executeAction` handler instead of a
     * silent "Action not found".
     *
     * `OS_DISABLE_AUTHORED_ACTIONS=1` opts out for deployments that want
     * runtime-authored (DB-stored, non-code-reviewed) action bodies to stay
     * inert; code-shipped actions are unaffected (AppPlugin registers those
     * itself with its own runner).
     */
    private installDefaultActionBodyRunner(ctx: PluginContext): void {
        if (process.env.OS_DISABLE_AUTHORED_ACTIONS === '1') {
            ctx.logger.info('[AppPlugin] OS_DISABLE_AUTHORED_ACTIONS=1 — runtime-authored action bodies will not execute');
            return;
        }
        let ql: IObjectQLEngine | undefined;
        try {
            ql = ctx.getService<IObjectQLEngine>('objectql');
        } catch {
            return; // no engine on this kernel — nothing to wire
        }
        if (!ql || typeof ql.setDefaultActionRunner !== 'function') return;
        // [#4251] First-wins setter — same as the hook body runner above.
        const installed = ql.setDefaultActionRunner(actionBodyRunnerFactory(new QuickJSScriptRunner(), {
            ql,
            logger: ctx.logger,
            appId: 'runtime-authored',
        }));
        if (installed !== false) {
            ctx.logger.info('[AppPlugin] Installed default action body runner (runtime-authored actions can execute)');
        }
    }

    /**
     * Install an engine-wide {@link HookMetricsRecorder} that folds every
     * hook's execution time into the request-scoped `Server-Timing` collector
     * (the `hooks;dur=…;desc="N hooks"` span). This is the framework's ONLY
     * caller of `setHookMetricsRecorder`, so it owns the engine's recorder;
     * objectql stays observability-free (the lean `core` tier, ADR-0076) — the
     * timing lives here in the runtime, which already depends on it.
     *
     * `countServerTiming` is a no-op unless a request opened a perf collector
     * (perf-tuning mode), so this costs nothing when the feature is off. It
     * composes with any recorder a host wired earlier (chains to it), and is
     * idempotent across the multiple AppPlugins a multi-app env installs.
     */
    private installHookMetricsTiming(ctx: PluginContext): void {
        let ql: IObjectQLEngine | undefined;
        try {
            ql = ctx.getService<IObjectQLEngine>('objectql');
        } catch {
            return; // no engine on this kernel — nothing to wire
        }
        if (!ql || typeof ql.setHookMetricsRecorder !== 'function') return;
        const existing = typeof ql.getHookMetricsRecorder === 'function'
            ? ql.getHookMetricsRecorder()
            : undefined;
        if (existing?.__perfTimingFeed) return; // already installed by a sibling AppPlugin
        ql.setHookMetricsRecorder({
            __perfTimingFeed: true,
            recordExecution(label: any, outcome: any, durationMs: number) {
                try { existing?.recordExecution?.(label, outcome, durationMs); } catch { /* keep timing isolated */ }
                countServerTiming('hooks', durationMs, 'hooks');
            },
            recordSkip(label: any, reason: any) {
                try { existing?.recordSkip?.(label, reason); } catch { /* noop */ }
            },
            recordRetry(label: any, attempt: number) {
                try { existing?.recordRetry?.(label, attempt); } catch { /* noop */ }
            },
        });
        ctx.logger.debug('[AppPlugin] Installed hook-metrics Server-Timing feed');
    }

    /**
     * Datasource name → the objects a `datasourceMapping` rule routes to it
     * (#4462), asked of the ENGINE rather than re-derived here.
     *
     * The gate this feeds (`isDatasourceAddressed` (d)) and the routing that
     * makes it correct (`ObjectQLEngine.getDriver` step 2) must agree exactly
     * about which rules match which objects. A second matcher living in this
     * plugin — or in the connection service — would drift by one clause and
     * produce either a datasource connected that routing never uses, or one
     * routed to and never connected, which is the defect itself.
     *
     * Objects with an EXPLICIT `object.datasource` binding are excluded: that
     * binding outranks mapping in `getDriver`, so counting them here would let
     * a mapping rule they never obey force a fail-fast on their behalf.
     * `default` is excluded for the same reason `getDriver` lets it through —
     * the host's default driver is registered under its natural name and needs
     * no per-app connect.
     */
    private resolveMappedObjects(
        ql: IObjectQLEngine,
        objects: Array<{ name?: string; datasource?: string }>,
    ): Record<string, string[]> {
        const resolve = (ql as unknown as {
            resolveMappedDatasource?: (objectName: string) => string | null;
        }).resolveMappedDatasource;
        if (typeof resolve !== 'function') return {};
        const out: Record<string, string[]> = {};
        for (const obj of objects) {
            const name = obj?.name;
            if (typeof name !== 'string' || !name) continue;
            if (obj.datasource && obj.datasource !== 'default') continue;
            let mapped: string | null = null;
            try {
                mapped = resolve.call(ql, name);
            } catch {
                continue; // a resolver that throws must not brick boot
            }
            if (!mapped || mapped === 'default') continue;
            (out[mapped] ??= []).push(name);
        }
        return out;
    }

    start = async (ctx: PluginContext) => {
        if (this.empty) {
            ctx.logger.debug('[AppPlugin] empty env — no app payload, skipping start', {
                pluginName: this.name,
            });
            return;
        }
        const sys = this.bundle.manifest || this.bundle;
        const appId = sys.id || sys.name;
        
        // Execute Runtime Step
        // Retrieve ObjectQL engine from services
        // ctx.getService throws when a service is not registered, so we
        // must use try/catch instead of a null-check.
        let ql: IObjectQLEngine | undefined;
        try {
            ql = ctx.getService<IObjectQLEngine>('objectql');
        } catch {
            // Service not registered — handled below
        }

        if (!ql) {
            ctx.logger.warn('ObjectQL engine service not found', { 
                appName: this.name,
                appId 
            });
            return;
        }

        ctx.logger.debug('Retrieved ObjectQL engine service', { appId });

        // Configure datasourceMapping if provided in the stack definition
        if (this.bundle.datasourceMapping && Array.isArray(this.bundle.datasourceMapping)) {
            ctx.logger.info('Configuring datasource mapping rules', {
                appId,
                ruleCount: this.bundle.datasourceMapping.length
            });
            ql.setDatasourceMapping(this.bundle.datasourceMapping);
        }

        // Surface code-defined datasources (ADR-0015 Addendum) in the metadata
        // registry so the datasource-admin list returns them alongside any
        // UI-created (`origin:'runtime'`) ones. These are GitOps-managed
        // (declared in `*.datasource.ts`), so they are registered IN MEMORY
        // ONLY — never persisted to the runtime DB store — and stamped
        // `origin:'code'` so the admin service enforces them as read-only.
        // The engine already indexed them for the write gate via registerApp().
        //
        // `default` is a HOST-owned reserved name (#3826): the runtime declares
        // and connects it (DefaultDatasourcePlugin). An app declaring it would
        // shadow the host's metadata row and — if it passed the D2 gate —
        // divert every unbound object to a fresh connection. Contract-first:
        // reject at load, loudly (outside the lenient catch below), instead of
        // letting the collision produce undefined routing.
        {
            const dsDefs = this.bundle.datasources;
            const declared = Array.isArray(dsDefs)
                ? dsDefs
                : dsDefs && typeof dsDefs === 'object'
                    ? Object.values(dsDefs as Record<string, unknown>)
                    : [];
            const names = Array.isArray(dsDefs)
                ? declared.map((d: any) => d?.name)
                : Object.keys((dsDefs as Record<string, unknown>) ?? {});
            if (declared.some((d: any) => d?.name === 'default') || names.includes('default')) {
                throw new Error(
                    `[AppPlugin] app '${appId}' declares a datasource named 'default' — that name is ` +
                    `reserved for the host's primary datasource. Rename it (e.g. '${appId.split('.').pop()}_primary') ` +
                    `and route objects to it explicitly, or omit it to use the host default.`,
                );
            }
        }
        try {
            const dsDefs = this.bundle.datasources;
            const dsList = Array.isArray(dsDefs)
                ? dsDefs
                : dsDefs && typeof dsDefs === 'object'
                    ? Object.entries(dsDefs).map(([name, def]) => ({ name, ...(def as any) }))
                    : [];
            if (dsList.length > 0) {
                const metadata = ctx.getService('metadata') as
                    | { registerInMemory?: (t: string, n: string, d: unknown) => void }
                    | undefined;
                if (typeof metadata?.registerInMemory === 'function') {
                    for (const ds of dsList) {
                        if (!ds?.name) continue;
                        metadata.registerInMemory('datasource', ds.name, { ...ds, origin: 'code' });
                    }
                    ctx.logger.info('Registered code-defined datasources in metadata registry', {
                        appId,
                        count: dsList.length,
                    });
                }
            }
        } catch (err) {
            ctx.logger.warn('[AppPlugin] failed to register code-defined datasources', {
                error: (err as Error)?.message ?? String(err),
            });
        }

        // Auto-connect declared datasources (ADR-0062 D1/D2/D5). The metadata
        // registration above only makes a datasource *visible*; to make its
        // federated objects *queryable* with zero app boilerplate, build + open
        // + register a live driver via the shared `'datasource-connection'`
        // service (when present — wired by the datasource-admin plugin). The
        // service applies the D2 gate (connect only when `external`, an object
        // explicitly binds via `object.datasource`, a `datasourceMapping` rule
        // routes objects to it, or `autoConnect:true`) and the host connect
        // policy, so a managed datasource nothing routes to stays metadata-only.
        // Idempotent vs. a legacy `onEnable` driver registration.
        //
        // Runs in `start()` (before the `kernel:ready` external-validation gate)
        // so the kernel's init-all-then-start-all ordering guarantees the
        // connection service was already registered during init.
        try {
            const dsDefs = this.bundle.datasources;
            const dsList: any[] = Array.isArray(dsDefs)
                ? dsDefs
                : dsDefs && typeof dsDefs === 'object'
                    ? Object.entries(dsDefs).map(([name, def]) => ({ name, ...(def as any) }))
                    : [];
            if (dsList.length > 0) {
                // `ctx.getService` throws when a service is absent, so resolve
                // defensively — a runtime without the datasource-admin plugin
                // simply has no connection service, and declared datasources
                // stay metadata-only (the legacy `onEnable` escape hatch still
                // works). This must NOT fall into the fail-fast catch below.
                let connection:
                    | {
                          connectDeclared?: (input: {
                              datasources: any[];
                              objects?: Array<{ name?: string; datasource?: string }>;
                              mappedObjects?: Record<string, string[]>;
                          }) => Promise<Array<{ name: string; status: string }>>;
                      }
                    | undefined;
                try {
                    connection = ctx.getService('datasource-connection');
                } catch {
                    connection = undefined;
                }
                if (typeof connection?.connectDeclared === 'function') {
                    const objects = Array.isArray(this.bundle.objects) ? this.bundle.objects : [];
                    const results = await connection.connectDeclared({
                        datasources: dsList,
                        objects,
                        mappedObjects: this.resolveMappedObjects(ql, objects),
                    });
                    const connected = results.filter((r) => r.status === 'connected');
                    if (connected.length > 0) {
                        ctx.logger.info('Auto-connected declared datasources', {
                            appId,
                            connected: connected.map((r) => r.name),
                        });
                    }
                } else {
                    ctx.logger.debug('No datasource-connection service — declared datasources stay metadata-only', { appId });
                }
            }
        } catch (err) {
            // A fail-fast connect error propagates to brick boot as intended
            // (ADR-0062 D5): the datasource has no fallback path — `external` +
            // onMismatch:'fail', or objects that bind to it explicitly and would
            // otherwise fail every query with "Datasource 'x' is not registered"
            // (#3758). Other errors are already degraded inside the connection
            // service. Re-throw so the kernel surfaces the real cause.
            // (Single-string message: the context logger types
            // `error(message, error?)`, not a meta object.)
            ctx.logger.error(
                `[AppPlugin] declared-datasource auto-connect failed for app '${appId}': ${(err as Error)?.message ?? String(err)}`,
            );
            throw err;
        }

        // [ADR-0057 / #2077] Surface stack-declared SECURITY metadata
        // (positions, permission sets, sharing rules, policies) in the
        // metadata registry so the boot seeders (plugin-security /
        // plugin-sharing) and runtime resolvers can read them via
        // `list('position'|'permission'|'sharing_rule')`.
        // Without this, bootStack's metadata service holds only objects (the
        // artifact loader that registers these runs only in compiled serve.ts),
        // leaving the declarations decorative.
        try {
            const metadata = ctx.getService('metadata') as
                | { registerInMemory?: (t: string, n: string, d: unknown) => void }
                | undefined;
            if (typeof metadata?.registerInMemory === 'function') {
                const securityBundle: any = this.bundle.manifest
                    ? { ...this.bundle.manifest, ...this.bundle }
                    : this.bundle;
                const SECURITY_FIELDS: Array<[string, string]> = [
                    ['positions', 'position'],
                    ['permissions', 'permission'],
                    // [ADR-0066 D1] Package-declared authorization capabilities —
                    // read back by bootstrapDeclaredCapabilities to seed
                    // sys_capability with package provenance.
                    ['capabilities', 'capability'],
                    ['sharingRules', 'sharing_rule'],
                    ['policies', 'policy'],
                ];
                let count = 0;
                for (const [field, type] of SECURITY_FIELDS) {
                    const arr = securityBundle?.[field];
                    if (!Array.isArray(arr)) continue;
                    for (const item of arr) {
                        if (!item?.name) continue;
                        metadata.registerInMemory(type, item.name, item);
                        count += 1;
                    }
                }
                if (count > 0) {
                    ctx.logger.info('Registered stack-declared security metadata', { appId, count });
                }
            }
        } catch (err) {
            ctx.logger.warn('[AppPlugin] failed to register security metadata', {
                error: (err as Error)?.message ?? String(err),
            });
        }

        // Resolve the runtime hook owner. Modules that declare both a
        // `default` (defineStack(...)) export and a named `onEnable` export
        // hide the named export from `bundle.default`, so we fall back to the
        // top-level bundle when the default doesn't carry the hook.
        const stackBundle = this.bundle.default || this.bundle;
        const runtime: any = (stackBundle && typeof stackBundle.onEnable === 'function')
            ? stackBundle
            : this.bundle;

        if (runtime && typeof runtime.onEnable === 'function') {
             ctx.logger.info('Executing runtime.onEnable', { 
                 appName: this.name,
                 appId 
             });
             
             // Construct the Host Context (mirroring old ObjectQL.use logic)
             const hostContext = {
                ...ctx,
                ql,
                logger: ctx.logger,
                drivers: {
                    register: (driver: any) => {
                        ctx.logger.debug('Registering driver via app runtime', { 
                            driverName: driver.name,
                            appId 
                        });
                        ql.registerDriver(driver);
                    }
                },
             };
             
             await runtime.onEnable(hostContext);
             ctx.logger.debug('Runtime.onEnable completed', { appId });
        } else {
             ctx.logger.debug('No runtime.onEnable function found', { appId });
        }

        // ── Auto-bind declarative Hook metadata ─────────────────────────
        // Hooks declared via `defineStack({ hooks })` (or attached to the
        // bundle by other tooling) are wired into the ObjectQL execution
        // pipeline here, with no boilerplate from user code. Inline
        // function handlers are resolved directly; string-named handlers
        // are looked up in `bundle.functions` (also auto-registered) or in
        // any function previously registered on the engine.
        //
        // Runs AFTER `runtime.onEnable` so user code may still
        // imperatively register additional hooks/functions for advanced
        // cases — both will coexist on the engine.
        try {
            const hooks = collectBundleHooks(this.bundle);
            // Entries, not bare handlers: each function's declared `effect`
            // (#4396) rides along to the registry, where a `script` node reads
            // it to report what its run actually did.
            const functions = collectBundleFunctionEntries(this.bundle);
            for (const [name, fn] of Object.entries(functions)) {
                if (fn.unrecognizedEffect === undefined) continue;
                ctx.logger.warn('[AppPlugin] unrecognized function effect — counted as an uncountable write', {
                    appId,
                    name,
                    effect: fn.unrecognizedEffect,
                    expected: "'pure' | 'writes'",
                });
            }
            if (hooks.length > 0 || Object.keys(functions).length > 0) {
                if (typeof ql.bindHooks === 'function') {
                    ql.bindHooks(hooks, {
                        packageId: `app:${appId}`,
                        functions,
                        bodyRunner: hookBodyRunnerFactory(new QuickJSScriptRunner(), {
                            ql,
                            logger: ctx.logger,
                            appId,
                        }),
                    });
                    ctx.logger.info('[AppPlugin] Bound declarative hooks', {
                        appId,
                        hookCount: hooks.length,
                        functionCount: Object.keys(functions).length,
                    });
                } else {
                    ctx.logger.warn('[AppPlugin] ql.bindHooks unavailable; declarative hooks ignored', {
                        appId,
                        hookCount: hooks.length,
                    });
                }
            }
        } catch (err: any) {
            ctx.logger.error('[AppPlugin] Failed to bind declarative hooks', err as Error, {
                appId,
            });
        }

        // ── Auto-register declarative Action handlers ───────────────────
        // Actions with an inline `handler` (or extracted `body`) are wired
        // to the engine here so HTTP `POST /api/v1/actions/<obj>/<name>`
        // can invoke them. Actions without a body are left for legacy
        // imperative `engine.registerAction(...)` registration in user code.
        try {
            const actions = collectBundleActions(this.bundle);
            const actionBodyRunner = actionBodyRunnerFactory(new QuickJSScriptRunner(), {
                ql,
                logger: ctx.logger,
                appId,
            });
            let registered = 0;
            if (actions.length > 0 && typeof ql.registerAction === 'function') {
                for (const action of actions) {
                    const handler = actionBodyRunner(action);
                    if (!handler) continue;
                    // Object-less actions register under the canonical
                    // `'global'` key (#3913) — the literal every reader probes
                    // (`actionHandlerObjectKeys`), since `executeAction` is an
                    // exact-string Map lookup with no wildcard semantics.
                    const objectKey =
                        typeof action.object === 'string' && action.object.length > 0
                            ? action.object
                            : GLOBAL_ACTION_OBJECT_KEY;
                    try {
                        ql.registerAction(objectKey, action.name, handler, `app:${appId}`);
                        registered++;
                    } catch (err: any) {
                        ctx.logger.warn('[AppPlugin] Failed to register action body', {
                            appId,
                            action: action.name,
                            object: objectKey,
                            error: err?.message ?? String(err),
                        });
                    }
                }
            }
            if (registered > 0) {
                ctx.logger.info('[AppPlugin] Bound declarative actions', {
                    appId,
                    actionCount: registered,
                });
            }
        } catch (err: any) {
            ctx.logger.error('[AppPlugin] Failed to bind declarative actions', err as Error, {
                appId,
            });
        }

        // [ADR-0110 D5] The action-governance inventory used to hang off a
        // `kernel:ready` hook HERE. Moved to ObjectQLPlugin: AppPlugin is
        // registered conditionally (serve.ts skips it when the host wraps
        // itself; the `os dev` fast path loads apps without it), so on the
        // platform's own dev loop the inventory never ran — and the engine
        // plugin owns the very registry being audited, is unconditionally
        // present, and re-runs the audit on `metadata:reloaded`.

        // ── Auto-register declarative Background Jobs ────────────────────
        // Jobs declared via `defineStack({ jobs })` are scheduled against the
        // running `IJobService` on `kernel:ready` (so the service plugin and
        // ObjectQL engine have had a chance to register). Handler strings are
        // resolved through `collectBundleFunctions(bundle)` — the same
        // registry used by hooks/actions, keeping the surface uniform.
        try {
            const jobs: any[] = Array.isArray(this.bundle.jobs)
                ? this.bundle.jobs
                : Array.isArray((this.bundle.manifest || {}).jobs)
                    ? (this.bundle.manifest as any).jobs
                    : [];
            if (jobs.length > 0) {
                ctx.hook('kernel:ready', async () => {
                    let svc: IJobService | undefined;
                    try { svc = ctx.getService<IJobService>('job'); } catch { /* not installed */ }
                    if (!svc || typeof svc.schedule !== 'function') {
                        ctx.logger.warn('[AppPlugin] job service not registered — skipping declarative jobs', {
                            appId, jobCount: jobs.length,
                        });
                        return;
                    }
                    const fnMap = collectBundleFunctions(this.bundle);
                    const metrics = resolveMetrics(ctx);
                    let ok = 0;
                    let failed = 0;
                    for (const job of jobs) {
                        const jobName: string = job?.name;
                        if (!jobName) {
                            ctx.logger.warn('[AppPlugin] skipping job without name', { appId, job });
                            continue;
                        }
                        if (job.enabled === false) {
                            ctx.logger.debug('[AppPlugin] job disabled — skipping', { appId, job: jobName });
                            continue;
                        }
                        const handler = fnMap[job.handler];
                        if (typeof handler !== 'function') {
                            ctx.logger.warn('[AppPlugin] job handler not found in bundle.functions — skipping', {
                                appId, job: jobName, handler: job.handler,
                            });
                            continue;
                        }
                        try {
                            await svc.schedule(
                                jobName,
                                // #4567: authoring tier → boundary tier. `job.schedule`
                                // is the PARSED `Schedule`, whose cron `expression` is
                                // the ADR expression envelope `{dialect,source}`;
                                // `IJobService.schedule` (and croner behind it) take a
                                // bare cron string. Same seam, same place, as the
                                // retryPolicy/timeout threading just below.
                                toBoundaryJobSchedule(job.schedule, jobName),
                                async (jobCtx: any) => {
                                    await handler({ ...jobCtx, jobId: jobName, bundle: this.bundle });
                                },
                                // #3494: thread the authored retryPolicy/timeout to the adapter
                                (job.retryPolicy || job.timeout)
                                    ? { retryPolicy: job.retryPolicy, timeout: job.timeout }
                                    : undefined,
                            );
                            ok++;
                        } catch (err: any) {
                            failed++;
                            // #4567: a job that fails to schedule is a SILENT OUTAGE —
                            // the app builds and boots green while the work never runs.
                            // It gets error level plus its own counter, and deliberately
                            // NOT the `warn` that "handler not found" / "job disabled"
                            // use: those describe a job that was never going to run,
                            // this one describes a job the author is owed.
                            ctx.logger.error(
                                '[AppPlugin] Background job FAILED TO SCHEDULE — it will never run',
                                err as Error,
                                { appId, job: jobName, schedule: job.schedule },
                            );
                            metrics.counter(SEMCONV.jobScheduleFailuresTotal, { app: appId, job: jobName });
                        }
                    }
                    ctx.logger.info('[AppPlugin] Scheduled background jobs', { appId, count: ok, failed });
                    if (failed > 0) {
                        ctx.logger.error(
                            '[AppPlugin] Some background jobs are declared but NOT scheduled',
                            undefined,
                            { appId, scheduled: ok, failed },
                        );
                    }
                });
            }
        } catch (err: any) {
            ctx.logger.error('[AppPlugin] Failed to schedule background-job registration', err as Error, { appId });
        }

        // ── Org-Scoped App Catalog Sync ──────────────────────────────────
        // Emit `app:registered` so AppCatalogService (running on the
        // control-plane kernel) can mirror this app into `sys_app`. Skipped
        // for standalone (single-tenant) usages where no project context is
        // attached.
        this.emitCatalogEvent(ctx, 'app:registered', sys);

        // ── i18n Translation Loading ─────────────────────────────────────
        // Auto-load translation bundles from the app config into the
        // kernel's i18n service, so discovery and handlers stay consistent.
        await this.loadTranslations(ctx, appId);

        // Data Seeding
        // Collect seed data from multiple locations (top-level `data` preferred, `manifest.data` for backward compat)
        const seedDatasets: any[] = [];
        
        // 1. Top-level `data` field (new standard location on ObjectStackDefinition)
        if (Array.isArray(this.bundle.data)) {
            seedDatasets.push(...this.bundle.data);
        }
        
        // 2. Legacy: `manifest.data` (backward compatibility)
        const manifest = this.bundle.manifest || this.bundle;
        if (manifest && Array.isArray(manifest.data)) {
            seedDatasets.push(...manifest.data);
        }

        // Object names in seed data are used as-is — no FQN expansion.
        // Under the current naming convention, the object's short name IS
        // the canonical name and the physical table name.

        if (seedDatasets.length > 0) {
             ctx.logger.info(`[AppPlugin] Found ${seedDatasets.length} seed datasets for ${appId}`);

             // Pass seed datasets through unchanged — object names are canonical
             const normalizedDatasets = seedDatasets
                 .filter((d: any) => d.object && Array.isArray(d.records))
                 .map((d: any) => ({
                     ...d,
                     object: d.object,
                 }));

             // No seed identity is provisioned. The platform never mints a
             // placeholder `usr_system`: seeds leave `owner_id` unset (or use
             // `cel`os.user.id``, which the loader resolves to NULL since the
             // owning admin does not exist yet), and the first-admin handoff
             // (`claimSeedOwnership`) re-owns those NULL rows to the promoted
             // admin. `os.org` is still derived from `organizationId` inside the
             // loader, independent of this.
             const seedIdentity = undefined;

             // Stash datasets on a kernel service so SecurityPlugin's
             // sys_organization insert hook can replay them per-tenant
             // (Salesforce-sandbox style: every new org gets its own
             // private copy of the artifact's demo data).
             //
             // We also register a `seed-replayer` callable so the
             // SecurityPlugin doesn't need to import @objectstack/runtime
             // (would create a circular workspace dep). The replayer
             // captures the SeedLoaderService closure and exposes a
             // narrow `(orgId) => Promise<summary>` surface.
             try {
                 // #3453: append this app's datasets onto the SHARED `seed-datasets`
                 // array (register-once-then-mutate). Reading through the context's
                 // own resolver — NOT the non-existent `(ctx as any).kernel`, which was
                 // always undefined — means a SECOND config app (or a marketplace
                 // install) extends the list instead of clobbering it or tripping the
                 // duplicate-register throw. The per-org replayer below re-reads this
                 // live list on every call, so a new org replays the full union.
                 const sharedDatasets = mergeSeedDatasets(ctx, normalizedDatasets);

                 const loggerRef = ctx.logger;
                 const replayer = async (organizationId: string) => {
                     if (!organizationId) return { inserted: 0, updated: 0, skipped: 0, errors: [] as any[] };
                     const md = ctx.getService('metadata') as IMetadataService | undefined;
                     if (!md) {
                         loggerRef.warn('[seed-replayer] metadata service unavailable');
                         return { inserted: 0, updated: 0, skipped: 0, errors: [] as any[] };
                     }
                     // Read the LIVE shared list on every replay — NOT the
                     // `sharedDatasets` snapshot captured when this closure was built.
                     // An org created after a later app/marketplace install must still
                     // replay their seeds (the #3453 fix). Fall back to the snapshot
                     // only if the service somehow vanished.
                     const datasetsNow = readSeedDatasets(ctx) ?? sharedDatasets;
                     if (!Array.isArray(datasetsNow) || datasetsNow.length === 0) {
                         return { inserted: 0, updated: 0, skipped: 0, errors: [] as any[] };
                     }
                     const seedLoader = new SeedLoaderService(ql, md, loggerRef);
                     const { SeedLoaderRequestSchema } = await import('@objectstack/spec/data');
                     const request = SeedLoaderRequestSchema.parse({
                         seeds: datasetsNow,
                         config: {
                             defaultMode: 'upsert',
                             multiPass: true,
                             organizationId,
                             // `os.org` is derived from organizationId inside
                             // the loader. `seedIdentity` (os.user) is undefined
                             // unless a seed embeds `cel`os.user.id`` — see the
                             // lazy guard where it is resolved.
                             identity: seedIdentity,
                         },
                     });
                     const result = await seedLoader.load(request);
                     return {
                         inserted: result.summary.totalInserted,
                         updated: result.summary.totalUpdated,
                         // `skipped` lets a cloud host distinguish an all-skip
                         // replay (data already present) from the zero-summary
                         // early-returns above (which never ran the loader), so
                         // it can stamp its seed-once record on progress rather
                         // than re-replaying every cold boot (cloud#853).
                         skipped: result.summary.totalSkipped,
                         errors: result.errors,
                     };
                 };
                 // Register the replayer once; a later config app reuses the first
                 // one, which reads the now-extended shared list on every call — so
                 // there is no duplicate-register throw and no lost datasets (#3453).
                 const replayerRegistered = registerSeedReplayerOnce(ctx, replayer);
                 ctx.logger.info(
                     replayerRegistered
                         ? `[Seeder] Registered ${normalizedDatasets.length} datasets + replayer (total seeds: ${sharedDatasets.length})`
                         : `[Seeder] Appended ${normalizedDatasets.length} datasets to shared registry; reused existing replayer (total seeds: ${sharedDatasets.length})`,
                 );
             } catch (e: any) {
                 ctx.logger.warn('[Seeder] Failed to register seed-datasets/seed-replayer service', { error: e?.message });
             }

             // #4795 — declare this source BEFORE choosing what to do with it.
             // Consumers that must not act until the boot's own rows have
             // landed (the ADR-0104 fresh-datastore attestation) read the
             // tally at `kernel:ready`; counting the source only on the
             // branch that seeds would leave exactly the gap they are asking
             // about. Every branch below closes the handle — settle when the
             // write is done, suppress when this boot will not write at all.
             const seedSource = declareSeedSource(ctx);

             // Decide whether to also run the seed inline at AppPlugin
             // start. In multi-tenant mode, the per-org replay (driven
             // by OrgScopingPlugin's sys_organization middleware) is the
             // source of truth — running it here too would create NULL-
             // org rows that pollute reads and need a separate claim
             // step. So we skip it. Single-tenant deployments keep the
             // legacy behaviour: seed immediately at boot so there's
             // always demo data without needing an org insert.
             const multiTenant = this.organizationWallActive(ctx);
             if (this.skipSeedData) {
                 // #3917: this boot exists to READ metadata (os migrate
                 // plan/apply). It must not write to the target database.
                 // The source stays pending for the life of the boot, which
                 // is what keeps ADR-0104 from self-certifying over rows this
                 // boot deliberately never wrote (#4795).
                 seedSource.suppress('skip-seed-data');
                 ctx.logger.info('[Seeder] skipSeedData — inline seed suppressed; no rows written by this boot');
             } else if (multiTenant) {
                 // Same posture, different cause: the rows these datasets
                 // describe are written per org on `sys_organization` insert,
                 // so at boot they do not exist yet and nothing observed now
                 // can prove a claim about them (#4795).
                 seedSource.suppress('multi-tenant-replay');
                 ctx.logger.info('[Seeder] multi-tenant mode — skipping inline seed; per-org replay will run on sys_organization insert');
             } else {
             // Inline seed budget: large bundles (e.g. CRM Starter's 10
             // datasets) can easily exceed the kernel's plugin-start
             // timeout. We MUST NOT let seed work tear the kernel down —
             // a 500 on /auth and /data is far worse than a delayed seed.
             // Race the actual seed work against a soft budget; if we run
             // out of time, log loudly and let the kernel proceed.
             const seedBudgetMs = Number(process.env.OS_INLINE_SEED_BUDGET_MS ?? 8000);
             const seedPromise = (async () => {
              try {
                  const metadata = ctx.getService('metadata') as IMetadataService | undefined;
                  if (metadata) {
                      const seedLoader = new SeedLoaderService(ql, metadata, ctx.logger);
                      const { SeedLoaderRequestSchema } = await import('@objectstack/spec/data');
                      const request = SeedLoaderRequestSchema.parse({
                          seeds: normalizedDatasets,
                          config: { defaultMode: 'upsert', multiPass: true, identity: seedIdentity },
                      });
                      const result = await seedLoader.load(request);
                      const { totalInserted, totalUpdated, totalSkipped, totalErrored } = result.summary;
                      // "Wrote the row, lost the link" (#3932): a reference field
                      // dropped from a row that WAS written moves none of the row
                      // counters, so it needs carrying separately or the banner
                      // reads clean over a severed association.
                      const totalRefsDropped = result.summary.totalReferencesDropped ?? 0;
                      // #3415/#3430: stash a per-source outcome on the kernel so
                      // the CLI boot banner can print a Seeds line. The logs below
                      // are `info`, which sits under the default `warn` level, so
                      // they never reach `os dev` output — without this a fixture
                      // can lose most of its rows with no signal at all. (The
                      // serve boot-quiet window used to swallow them on top of
                      // that, at every level; framework#4012 fixed that half, but
                      // the level gate below is what still hides these.) One
                      // labelled entry per config app.
                      recordSeedOutcome(ctx, {
                          source: String(appId),
                          inserted: totalInserted,
                          updated: totalUpdated,
                          skipped: totalSkipped,
                          rejected: totalErrored,
                          droppedRefs: totalRefsDropped,
                      });
                      if (result.success) {
                          ctx.logger.info('[Seeder] Seed loading complete', {
                              inserted: totalInserted,
                              updated: totalUpdated,
                              skipped: totalSkipped,
                              errored: totalErrored,
                          });
                      } else {
                          // LOUD FAILURE: dropped records were previously
                          // invisible (the summary only logged errors.length and
                          // omitted totalErrored). Report the count AND each
                          // actionable reason so broken seeds can't pass silently.
                          // Dropped reference FIELDS are named separately — the
                          // old line said "0 dropped record(s)" over a load that
                          // had severed associations, which is true and useless.
                          const lostLinks = totalRefsDropped > 0
                              ? `, ${totalRefsDropped} dropped reference field(s) on written rows,`
                              : '';
                          ctx.logger.warn(
                              `[Seeder] Seed loading completed with ${totalErrored} dropped record(s)${lostLinks} and ${result.errors.length} error(s) for ${appId}`,
                              {
                                  inserted: totalInserted,
                                  updated: totalUpdated,
                                  skipped: totalSkipped,
                                  errored: totalErrored,
                                  referencesDropped: totalRefsDropped,
                              },
                          );
                          for (const e of result.errors.slice(0, 20)) {
                              ctx.logger.warn(`[Seeder]   ✗ ${e.message}`);
                          }
                          if (result.errors.length > 20) {
                              ctx.logger.warn(`[Seeder]   …and ${result.errors.length - 20} more error(s)`);
                          }
                      }
                  } else {
                      // Fallback: basic insert when metadata service is not available
                      ctx.logger.debug('[Seeder] No metadata service; using basic insert fallback');
                      for (const dataset of normalizedDatasets) {
                          ctx.logger.info(`[Seeder] Seeding ${dataset.records.length} records for ${dataset.object}`);
                          for (const record of dataset.records) {
                              try {
                                  await ql.insert(dataset.object, record, SEED_WRITE_OPTIONS as any);
                              } catch (err: any) {
                                  ctx.logger.warn(`[Seeder] Failed to insert ${dataset.object} record:`, { error: err.message });
                              }
                          }
                      }
                      ctx.logger.info('[Seeder] Data seeding complete.');
                  }
              } catch (err: any) {
                  // If SeedLoaderService fails (e.g., metadata not available), fall back to basic insert
                  ctx.logger.warn('[Seeder] SeedLoaderService failed, falling back to basic insert', { error: err.message });
                  for (const dataset of normalizedDatasets) {
                      for (const record of dataset.records) {
                          try {
                              await ql.insert(dataset.object, record, SEED_WRITE_OPTIONS as any);
                          } catch (insertErr: any) {
                              ctx.logger.warn(`[Seeder] Failed to insert ${dataset.object} record:`, { error: insertErr.message });
                          }
                      }
                  }
                  ctx.logger.info('[Seeder] Data seeding complete (fallback).');
              }
             })();
             let timer: ReturnType<typeof setTimeout> | undefined;
             const budget = new Promise<'budget'>((resolve) => {
                 timer = setTimeout(() => resolve('budget'), seedBudgetMs);
             });
             // Signal seed settle so reconcilers that read seeded rows can
             // re-run past this point. plugin-auth's ADR-0093 D6 membership
             // backfill runs once on `kernel:ready`, but seeded users are raw
             // `engine.insert` into `sys_user` (bypassing better-auth's
             // `user.create.after` reconciler). If this seed overruns the
             // budget below and finishes in the background — AFTER
             // `kernel:ready` — those users would stay member-less until the
             // next restart. Emitting on settle lets the backfill re-run (#2996).
             const emitSeedSettled = (overBudget: boolean) => {
                 // #4795 — settle FIRST, and before the `trigger` guard below.
                 // Two orderings depend on it: a consumer running inside the
                 // `app:seeded` hook must see this source already settled (it
                 // asks "has everything landed?" and would otherwise defer
                 // forever on the very signal telling it to act), and a kernel
                 // context with no `trigger()` must not strand the tally at
                 // pending — the seed still finished, there is simply nobody
                 // to tell.
                 seedSource.settle();
                 const trigger = (ctx as any).trigger;
                 if (typeof trigger !== 'function') return;
                 try {
                     const p = trigger.call(ctx, 'app:seeded', { appId, overBudget });
                     if (p && typeof p.catch === 'function') {
                         p.catch((err: any) => ctx.logger.debug('[Seeder] app:seeded trigger failed', { appId, error: err?.message ?? String(err) }));
                     }
                 } catch (err: any) {
                     ctx.logger.debug('[Seeder] app:seeded trigger failed', { appId, error: err?.message ?? String(err) });
                 }
             };
             const winner = await Promise.race([seedPromise.then(() => 'done' as const), budget]);
             if (timer) clearTimeout(timer);
             if (winner === 'budget') {
                 ctx.logger.warn(
                     `[Seeder] Inline seed exceeded ${seedBudgetMs}ms budget for ${appId}; continuing in background to avoid blocking kernel start.`,
                 );
                 // Don't leave the promise unobserved; emit the settle signal
                 // once the background seed finishes (fires past kernel:ready).
                 seedPromise
                     .catch((err: any) => {
                         ctx.logger.warn('[Seeder] Background seed failed after budget', { appId, error: err?.message ?? String(err) });
                     })
                     .then(() => emitSeedSettled(true));
             } else {
                 emitSeedSettled(false);
             }
             }
        }

        this.registerHotReloadSeeder(ctx, ql);
        this.registerSeedTenancyHandoff(ctx, ql);
    }

    /**
     * [#8686] Adopt untenanted seed rows into the install's organization the
     * moment that organization first exists.
     *
     * ## Why this cannot be done at seed time, and why boot is too late
     *
     * The seed loader already stamps `organization_id` on business seeds — but
     * only when it can resolve an organization to stamp WITH
     * (`resolveSoleOrganizationId`). On a first boot there is none: seeds land
     * during `start()`, and the admin (and their organization) are created later,
     * by a sign-up POST against the running server. So the loader correctly
     * declines, the rows land `organization_id = NULL`, and the SQL driver files
     * their numbers under the `__global__` counter.
     *
     * Then the first API create arrives carrying a real organization, draws from a
     * DIFFERENT counter that is correctly empty, and mints `CASE-00001` — a value
     * the seed already used. The partitioned unique index
     * (`COALESCE(organization_id, '__global__'), <field>`) cannot see the
     * collision because the two rows sit in different partitions. Measured on
     * 17.0.0 GA: four duplicate identifiers, four 201s, no warning.
     *
     * `metadata-protocol`'s `kernel:ready` migration repairs an install that is
     * ALREADY in that state, which covers every existing deployment. It cannot
     * cover a fresh one: at `kernel:ready` the organization still does not exist,
     * so the earliest that migration can act is the NEXT restart — by which time
     * the duplicates of this session have already been minted and, per the ruling,
     * are not the platform's to renumber.
     *
     * Hence this seam. `sys_organization` gaining its first row is exactly the
     * event that makes the answer derivable, and it is the ownership handoff's
     * twin: `claimSeedOwnership` already re-owns seeded rows to the first admin at
     * the analogous moment, and `claim-seed-ownership.ts` names the missing
     * tenancy half in its own header ("the ownership twin of org-scoping's
     * `claimOrphanOrgRows`, which back-fills `organization_id`") — that back-fill
     * ships in the enterprise organizations runtime, which a single-tenant install
     * does not have. This is the open-core half of the same handoff.
     *
     * Cheap by construction: the backfill's first act is one indexed probe of
     * `_objectstack_sequences`, and on any install with no untenanted counter it
     * returns `no-split` having written nothing and logged nothing.
     */
    private registerSeedTenancyHandoff(ctx: PluginContext, ql: any): void {
        if (!ql || typeof ql.registerMiddleware !== 'function') return;
        ql.registerMiddleware(async (opCtx: any, next: () => Promise<void>) => {
            await next();
            const isOrgCreate =
                opCtx?.object === 'sys_organization' &&
                (opCtx?.operation === 'create' || opCtx?.operation === 'insert');
            if (!isOrgCreate) return;
            try {
                const { backfillSeedTenancy, resolveSeedTenancyExec } = await import(
                    '@objectstack/metadata-protocol'
                );
                await backfillSeedTenancy(resolveSeedTenancyExec(ql), ctx.logger);
            } catch (e: any) {
                // Best-effort, exactly like the ownership handoff beside it: an
                // organization was just created and that must stand whatever
                // happens here. `warn` and not `error` — nothing was lost, and the
                // `kernel:ready` migration retries the same repair on next boot.
                ctx.logger.warn('[AppPlugin] seed tenancy handoff failed (#8686)', {
                    error: e?.message ?? String(e),
                });
            }
        });
    }

    /**
     * [ADR-0093 D4/D5, ADR-0105 D1 / #5262] Is an organization wall actually IN
     * FORCE for this boot? The judge for both seeder decisions below.
     *
     * ⛔ Never `resolveMultiOrgEnabled()`. ADR-0105 D1 demoted that boolean to a
     * back-compat INPUT of `resolveTenancyPosture()`, so it reads `false` on a
     * deployment configured the documented way (`OS_TENANCY_POSTURE=isolated|group`,
     * legacy boolean unset). Both seeder sites then took the single-tenant branch
     * on a fully walled deployment and inline-seeded exactly the NULL-organization
     * rows their own comments exist to avoid — rows that sit behind the wall
     * unreadable and need a separate claim step. Third recurrence of the shape
     * (cloud#1020, #5233).
     *
     * EFFECTIVE, not requested — and this site is the reason the distinction is
     * worth the extra hop. What these decisions actually turn on is "will the
     * per-org replay run instead of me?", and that replay is the enterprise
     * `@objectstack/organizations` middleware on `sys_organization` insert. On a
     * DEGRADED boot (a wall requested, the enterprise runtime absent, operator
     * opted in via `OS_ALLOW_DEGRADED_TENANCY`) that middleware does not exist,
     * so keying on the REQUEST would skip the inline seed in favour of a replay
     * that can never happen — a stack with no seed data at all. The `tenancy`
     * service reports the posture in force (`single` + `degraded` there), which
     * makes the seeded rows land inline, exactly as they should on a deployment
     * with no wall to isolate them behind.
     *
     * AppPlugin starts in kernel Phase 2 and plugin-auth registers `tenancy` in
     * Phase 1, so the service is present on any real boot; the fallback covers
     * lean embeddings that mount AppPlugin without plugin-auth, where the
     * requested posture is the best fact available. Read live per call — never
     * cached — so nothing freezes a verdict a later boot phase can still change.
     */
    private organizationWallActive(ctx: PluginContext): boolean {
        try {
            const tenancy = ctx.getService?.('tenancy') as
                | { posture?: TenancyPosture }
                | undefined;
            if (tenancy?.posture) return postureEnforcesWall(tenancy.posture);
        } catch {
            /* service registry has no `tenancy` — fall through */
        }
        return postureEnforcesWall(resolveTenancyPosture());
    }

    /**
     * 15.1 third-party eval — dev hot-reload of a NEW object registered its
     * metadata (and, via ObjectQL's `metadata:reloaded` hook, created its
     * table) but its seeds never ran: the seed pipeline in `start()` only
     * reads the boot-time bundle, so `os dev` users had to restart the
     * server to get seed rows. Subscribe to `metadata:reloaded` (fired by
     * MetadataPlugin for both the artifact-file watcher and the HMR POST
     * endpoint; its payload carries the freshly parsed artifact, because
     * seeds have no `name` and never enter the MetadataManager) and load the
     * seeds of objects that did not exist before the reload.
     *
     * Scoped STRICTLY to first-seen objects: an already-loaded (and possibly
     * user-edited) dataset is never re-upserted mid-run — edits to existing
     * seeds still apply on restart, as before. Dev-only (production publish
     * flows own their seeding), single-tenant only (multi-tenant replays
     * per-org on sys_organization insert). Runs AFTER ObjectQL's reload
     * schema sync because kernel hooks fire in registration order and
     * ObjectQLPlugin starts first.
     */
    private registerHotReloadSeeder(ctx: PluginContext, ql: any): void {
        const hook = (ctx as any).hook;
        if (typeof hook !== 'function') return;
        if (process.env.NODE_ENV !== 'development') return;
        // Same judge as the inline seed above, for the same reason — see
        // `organizationWallActive`. Keying this on the demoted boolean installed
        // the hot-reload seeder on posture-only walled dev stacks, where every
        // row it wrote for a newly-registered object landed with a NULL
        // organization (#5262).
        if (this.organizationWallActive(ctx)) return;

        const knownObjects = new Set<string>(
            (Array.isArray(this.bundle.objects) ? this.bundle.objects : [])
                .map((o: any) => o?.name)
                .filter((n: any): n is string => typeof n === 'string'),
        );

        hook.call(ctx, 'metadata:reloaded', async (payload: any) => {
            try {
                const meta = payload?.metadata;
                const objectsNow: any[] = Array.isArray(meta?.objects) ? meta.objects : [];
                const fresh = objectsNow
                    .map((o: any) => o?.name)
                    .filter((n: any): n is string => typeof n === 'string' && !knownObjects.has(n));
                for (const n of fresh) knownObjects.add(n);
                if (fresh.length === 0) return;

                const seeds = (Array.isArray(meta?.data) ? meta.data : []).filter(
                    (d: any) => d?.object && fresh.includes(d.object) && Array.isArray(d.records),
                );
                if (seeds.length === 0) return;

                const metadata = ctx.getService('metadata') as IMetadataService | undefined;
                if (!metadata) {
                    ctx.logger.warn('[Seeder] hot-reload seed skipped — metadata service unavailable');
                    return;
                }
                const seedLoader = new SeedLoaderService(ql, metadata, ctx.logger);
                const { SeedLoaderRequestSchema } = await import('@objectstack/spec/data');
                const request = SeedLoaderRequestSchema.parse({
                    seeds,
                    config: { defaultMode: 'upsert', multiPass: true },
                });
                const result = await seedLoader.load(request);
                const { totalInserted, totalUpdated, totalErrored } = result.summary;
                ctx.logger.info(
                    `[Seeder] Hot-reload seeded new object(s) ${fresh.join(', ')}: ` +
                        `${totalInserted} inserted, ${totalUpdated} updated` +
                        (totalErrored ? `, ${totalErrored} errored` : ''),
                );
                for (const e of (result.errors ?? []).slice(0, 10)) {
                    ctx.logger.warn(`[Seeder]   ✗ ${e.message}`);
                }
            } catch (err: any) {
                ctx.logger.warn('[Seeder] hot-reload seed failed', { error: err?.message ?? String(err) });
            }
        });
    }

    stop = async (ctx: PluginContext) => {
        const sys = this.bundle.manifest || this.bundle;
        this.emitCatalogEvent(ctx, 'app:unregistered', sys);
    }

    /**
     * Emit a kernel hook so the control-plane `AppCatalogService` can
     * upsert / delete the corresponding `sys_app` row. Silently no-ops
     * when no project context is attached (standalone single-tenant mode)
     * or when the kernel has no `trigger` API available.
     */
    private emitCatalogEvent(ctx: PluginContext, event: 'app:registered' | 'app:unregistered', sys: any): void {
        if (!this.projectContext) return;

        const trigger = (ctx as any).trigger;
        if (typeof trigger !== 'function') {
            ctx.logger.debug('[AppPlugin] kernel has no trigger() — skipping catalog hook', { event });
            return;
        }

        const appName = sys.name || sys.id;
        if (!appName) return;

        const payload = {
            environmentId: this.projectContext.environmentId,
            organizationId: this.projectContext.organizationId,
            projectName: this.projectContext.projectName,
            app: {
                name: appName,
                label: sys.label,
                icon: sys.icon,
                branding: sys.branding,
                isDefault: sys.isDefault ?? sys.is_default,
                active: sys.active !== false,
            },
            source: this.projectContext.source ?? (this.projectContext.packageId ? 'package' : 'user'),
            packageId: this.projectContext.packageId,
        };

        try {
            trigger.call(ctx, event, payload);
        } catch (err: any) {
            ctx.logger.warn('[AppPlugin] catalog hook trigger failed', { event, error: err?.message });
        }
    }

    /**
     * Auto-load i18n translation bundles from the app config into the
     * kernel's i18n service. Handles both `translations` (array of
     * TranslationBundle) and `i18n` config (default locale, etc.).
     *
     * Gracefully skips when the i18n service is not registered —
     * this keeps AppPlugin resilient across server/dev/mock environments.
     */
    private async loadTranslations(ctx: PluginContext, appId: string): Promise<void> {
        // ctx.getService throws when a service is not registered, so we
        // must use try/catch to gracefully skip when no i18n plugin is loaded.
        let i18nService: II18nService | undefined;
        try {
            i18nService = ctx.getService('i18n') as II18nService;
        } catch {
            // Service not registered — handled below
        }

        // Collect translation bundles early to determine if we have data
        const bundles: Array<Record<string, unknown>> = [];
        if (Array.isArray(this.bundle.translations)) {
            bundles.push(...this.bundle.translations);
        }
        const manifest = this.bundle.manifest || this.bundle;
        if (manifest && Array.isArray(manifest.translations) && manifest.translations !== this.bundle.translations) {
            bundles.push(...manifest.translations);
        }

        if (!i18nService) {
            if (bundles.length > 0) {
                // Auto-register the in-memory i18n fallback so the bundles
                // we already loaded server-side become discoverable through
                // `getService('i18n')` (used by the REST API to localize
                // view / action / object metadata). Without this step,
                // bundles authored in `defineStack({ translations })` were
                // silently dropped on standalone/dev stacks that didn't
                // explicitly install I18nServicePlugin.
                try {
                    const mod = await import('@objectstack/core');
                    const createMemoryI18n = (mod as any).createMemoryI18n;
                    if (typeof createMemoryI18n === 'function') {
                        const fallback = createMemoryI18n();
                        (ctx as any).registerService('i18n', fallback);
                        i18nService = fallback;
                        ctx.logger.info(
                            `[i18n] Auto-registered in-memory i18n fallback for "${appId}" (${bundles.length} bundle(s) detected). ` +
                            'Install I18nServicePlugin from @objectstack/service-i18n for file-based / production use.'
                        );
                    }
                } catch (err: any) {
                    ctx.logger.warn(
                        `[i18n] App "${appId}" has ${bundles.length} translation bundle(s) but auto-fallback failed: ${err?.message ?? err}.`
                    );
                    return;
                }
                if (!i18nService) {
                    ctx.logger.warn(
                        `[i18n] App "${appId}" has ${bundles.length} translation bundle(s) but no i18n service is registered.`
                    );
                    return;
                }
            } else {
                ctx.logger.debug('[i18n] No i18n service registered; skipping translation loading', { appId });
                return;
            }
        }

        // Apply i18n config (default locale, etc.)
        const i18nConfig = this.bundle.i18n || (this.bundle.manifest || this.bundle)?.i18n;
        if (i18nConfig?.defaultLocale && typeof i18nService.setDefaultLocale === 'function') {
            i18nService.setDefaultLocale(i18nConfig.defaultLocale);
            ctx.logger.debug('[i18n] Set default locale', { appId, locale: i18nConfig.defaultLocale });
        }

        // [#7679] Narrow what `getLocales()` REPORTS to the locales the app
        // declared. This is the only layer that can: `getLocales()` sees the
        // loaded set, and what is loaded is not the app's decision — every
        // platform plugin (platform-objects, service-settings, service-storage,
        // service-messaging, service-realtime, plugin-security, plugin-sharing,
        // plugin-webhooks) pushes its own `en/zh-CN/ja-JP/es-ES` bundle at
        // `kernel:ready`. A showcase declaring `['en','zh-CN']` therefore
        // advertised four locales on `GET /i18n/locales`, two of which
        // translate `sys_*` metadata and nothing the app owns.
        //
        // Threaded exactly like `defaultLocale` immediately above, and applied
        // through the same optional-capability probe: `setSupportedLocales` is
        // optional on `II18nService`, so a provider that has not implemented it
        // keeps today's behaviour rather than breaking.
        //
        // Only the REPORTED set narrows. The bundles stay loaded and stay
        // servable — an unreported locale still returns its `sys_*`
        // translations if asked for by code. Unloading them is a bigger change
        // than this fix and buys nothing.
        //
        // A locale declared with no bundle behind it is still reported
        // (declared-but-unserved) rather than intersected away — see
        // `normalizeSupportedLocales` / `II18nService.setSupportedLocales` for
        // why, and note that an intersection computed HERE would in any case be
        // wrong: the platform bundles have not arrived yet at this point in the
        // lifecycle.
        // Guarded on "declared something" rather than called unconditionally,
        // for the same reason `setDefaultLocale` above is: several AppPlugins
        // can share one kernel (the config apps are AppPlugins too), and an app
        // that declares no `i18n` block must not clear the narrowing another
        // app declared. Absent stays absent — that is the no-narrowing default,
        // not something anyone has to write.
        const declaredLocales = i18nConfig?.supportedLocales;
        if (
            Array.isArray(declaredLocales) && declaredLocales.length > 0
            && typeof i18nService.setSupportedLocales === 'function'
        ) {
            i18nService.setSupportedLocales(declaredLocales);
            ctx.logger.debug('[i18n] Narrowed reported locales to the app\'s declared set', {
                appId, supportedLocales: declaredLocales,
            });
        }

        if (bundles.length === 0) {
            return;
        }

        let loadedLocales = 0;
        for (const bundle of bundles) {
            // Each bundle is a TranslationBundle: Record<locale, TranslationData>
            for (const [locale, data] of Object.entries(bundle)) {
                if (data && typeof data === 'object') {
                    try {
                        i18nService.loadTranslations(locale, data as Record<string, unknown>);
                        loadedLocales++;
                    } catch (err: any) {
                        ctx.logger.warn('[i18n] Failed to load translations', { appId, locale, error: err.message });
                    }
                }
            }
        }

        // Emit diagnostic when the active i18n service is a fallback/stub.
        // [#4058] Reads the standard D12 self-description instead of duck-typing
        // the two ad-hoc markers this branch knew about (`_fallback` / `_dev`).
        // `_fallback` was recognized by nothing else — which is exactly how the
        // kernel fallbacks carrying it ended up reported as fully `available`.
        // Both ad-hoc markers are gone now (#4082 moved their producers onto
        // the descriptor; #4319 retired the last `_dev` reader), so this is the
        // only spelling left to read.
        if (readServiceSelfInfo(i18nService)) {
            ctx.logger.info(
                `[i18n] Loaded ${loadedLocales} locale(s) into in-memory i18n fallback for "${appId}". ` +
                'For production, consider registering I18nServicePlugin from @objectstack/service-i18n.'
            );
        } else {
            ctx.logger.info('[i18n] Loaded translation bundles', { appId, bundles: bundles.length, locales: loadedLocales });
        }
    }
}

// ─── Bundle hook & function collectors ──────────────────────────────
// Hooks declared in `defineStack({ hooks })` end up at `bundle.hooks`;
// some legacy bundles still nest them under `manifest.hooks`. We dedupe
// (by reference) so the same array isn't bound twice when both shapes
// happen to point at the same list.

/** Collect declarative `Hook` definitions from a bundle (top-level + manifest). */
export function collectBundleHooks(bundle: any): any[] {
    const out: any[] = [];
    const seen = new Set<any>();
    const push = (arr: any) => {
        if (!Array.isArray(arr)) return;
        for (const h of arr) {
            if (h && !seen.has(h)) {
                seen.add(h);
                out.push(h);
            }
        }
    };
    push(bundle?.hooks);
    push(bundle?.manifest?.hooks);
    return out;
}

/**
 * Collect declarative actions from the bundle. Walks both root-level
 * `actions[]` and per-object `objects[*].actions[]`, attaching the parent
 * object name where applicable so `engine.registerAction(object, name, ...)`
 * sees the correct routing key.
 *
 * Each returned record is a shallow copy with `object` set when the action
 * originated under an object (and not already present on the action itself).
 *
 * Deliberately type-BLIND, and it must stay that way: this collects every
 * declared action, most of which (`url`, `modal`, `flow`, `api`, `form`)
 * legitimately have no body and bind nothing. The `type: 'script'` gate that
 * decides whether a `body` becomes an executable handler lives at the single
 * bind point — `actionBodyRunnerFactory` (#4352) — because the other binder
 * (`engine.setDefaultActionRunner`, for Studio-authored actions) never walks
 * this collector at all. Re-filtering here would duplicate half the rule and
 * leave the other binder ungated.
 */
export function collectBundleActions(
    bundle: any,
): Array<{ name: string; object?: string; body?: unknown; type?: string; [k: string]: unknown }> {
    const out: any[] = [];
    const seen = new Set<any>();
    const push = (arr: any, parentObject?: string) => {
        if (!Array.isArray(arr)) return;
        for (const a of arr) {
            if (!a || typeof a !== 'object' || typeof a.name !== 'string') continue;
            if (seen.has(a)) continue;
            seen.add(a);
            const inferredObject =
                typeof a.object === 'string' ? a.object
                : typeof a.objectName === 'string' ? a.objectName
                : parentObject;
            out.push(inferredObject ? { ...a, object: inferredObject } : { ...a });
        }
    };
    push(bundle?.actions);
    push(bundle?.manifest?.actions);
    if (Array.isArray(bundle?.objects)) {
        for (const o of bundle.objects) push(o?.actions, o?.name);
    }
    if (Array.isArray(bundle?.manifest?.objects)) {
        for (const o of bundle.manifest.objects) push(o?.actions, o?.name);
    }
    return out;
}

/**
 * Collect a name → {@link NormalizedFlowFunction} map from `bundle.functions`,
 * keeping each entry's DECLARATION (its data `effect`, #4396) attached to the
 * handler. Accepted shapes:
 *
 *   - `{ functions: { foo: fn, bar: fn } }`                        ← preferred map form
 *   - `{ functions: { foo: { handler: fn, effect: 'writes' } } }`  ← declared map entry
 *   - `{ functions: [{ name: 'foo', handler: fn, effect: … }] }`   ← array of records
 *
 * The declaration matters at exactly one consumer — a `script` node reporting
 * what its run did to the data — but it has to survive the collection step to
 * get there, and dropping it here is how the shape would silently become
 * unsupported.
 */
export function collectBundleFunctionEntries(bundle: any): Record<string, NormalizedFlowFunction> {
    const out: Record<string, NormalizedFlowFunction> = {};
    const merge = (src: any) => {
        if (!src) return;
        if (Array.isArray(src)) {
            for (const item of src) {
                if (!item || typeof item.name !== 'string') continue;
                const fn = normalizeFlowFunctionEntry(item);
                if (fn) out[item.name] = fn;
            }
        } else if (typeof src === 'object') {
            for (const [name, entry] of Object.entries(src)) {
                const fn = normalizeFlowFunctionEntry(entry);
                if (fn) out[name] = fn;
            }
        }
    };
    merge(bundle?.functions);
    merge(bundle?.manifest?.functions);
    return out;
}

/**
 * Collect a name → handler map from `bundle.functions` — {@link
 * collectBundleFunctionEntries} with the declarations dropped, for the callers
 * that only need something callable (string-named hook handlers via
 * `Hook.handler: 'foo'`, job handlers).
 */
export function collectBundleFunctions(bundle: any): Record<string, (ctx: any) => any> {
    const out: Record<string, (ctx: any) => any> = {};
    for (const [name, fn] of Object.entries(collectBundleFunctionEntries(bundle))) {
        out[name] = fn.handler as (ctx: any) => any;
    }
    return out;
}
