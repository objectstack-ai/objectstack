// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { Plugin, PluginContext } from '@objectstack/core';
import { SeedLoaderService } from './seed-loader.js';
import type { IMetadataService, II18nService } from '@objectstack/spec/contracts';
import { QuickJSScriptRunner } from './sandbox/quickjs-runner.js';
import { hookBodyRunnerFactory, actionBodyRunnerFactory } from './sandbox/body-runner.js';

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
    
    private bundle: any;
    private projectContext?: AppPluginProjectContext;

    constructor(bundle: any, projectContext?: AppPluginProjectContext) {
        this.bundle = bundle;
        this.projectContext = projectContext;
        // Support both direct manifest (legacy) and Stack Definition (nested manifest)
        const sys = bundle.manifest || bundle;
        const appId = sys.id || sys.name || 'unnamed-app';

        this.name = `plugin.app.${appId}`;
        this.version = sys.version;
    }

    init = async (ctx: PluginContext) => {
        const sys = this.bundle.manifest || this.bundle;
        const appId = sys.id || sys.name;

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

        console.warn(
            `[AppPlugin:init] appId=${appId} keys=${Object.keys(servicePayload).join(',')} flows=${Array.isArray((servicePayload as any).flows) ? (servicePayload as any).flows.length : 'n/a'}`,
        );

        ctx.getService<{ register(m: any): void }>('manifest').register(servicePayload);
    }

    start = async (ctx: PluginContext) => {
        const sys = this.bundle.manifest || this.bundle;
        const appId = sys.id || sys.name;
        
        // Execute Runtime Step
        // Retrieve ObjectQL engine from services
        // ctx.getService throws when a service is not registered, so we
        // must use try/catch instead of a null-check.
        let ql: any;
        try {
            ql = ctx.getService('objectql');
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
            const functions = collectBundleFunctions(this.bundle);
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
                    const objectKey =
                        typeof action.object === 'string' && action.object.length > 0
                            ? action.object
                            : 'global';
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

        // ── Auto-register declarative Approval Processes ────────────────
        // Approval processes declared via `defineStack({ approvals })` are
        // upserted into the running `approvals` service. The `approvals`
        // service itself registers on `kernel:ready`, so we defer to the
        // same hook to avoid a chicken-and-egg.
        try {
            const approvals: any[] = Array.isArray(this.bundle.approvals)
                ? this.bundle.approvals
                : Array.isArray((this.bundle.manifest || {}).approvals)
                    ? (this.bundle.manifest as any).approvals
                    : [];
            if (approvals.length > 0) {
                ctx.hook('kernel:ready', async () => {
                    let svc: any;
                    try { svc = ctx.getService('approvals'); } catch { /* not installed */ }
                    if (!svc || typeof svc.defineProcess !== 'function') {
                        ctx.logger.warn('[AppPlugin] approvals service not registered — skipping declarative processes', {
                            appId, processCount: approvals.length,
                        });
                        return;
                    }
                    const sysCtx = { isSystem: true, roles: [], permissions: [] };
                    let ok = 0;
                    for (const proc of approvals) {
                        try {
                            await svc.defineProcess({
                                name: proc.name,
                                label: proc.label,
                                object: proc.object,
                                description: proc.description,
                                active: proc.active !== false,
                                definition: proc,
                            }, sysCtx);
                            ok++;
                        } catch (err: any) {
                            ctx.logger.warn('[AppPlugin] Failed to register approval process', {
                                appId, process: proc?.name, error: err?.message ?? String(err),
                            });
                        }
                    }
                    ctx.logger.info('[AppPlugin] Registered approval processes', { appId, count: ok });
                });
            }
        } catch (err: any) {
            ctx.logger.error('[AppPlugin] Failed to schedule approval-process registration', err as Error, { appId });
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
                 const kernel: any = (ctx as any).kernel;
                 const existing = (() => {
                     try { return kernel?.getService?.('seed-datasets'); } catch { return undefined; }
                 })();
                 const merged = Array.isArray(existing)
                     ? [...existing, ...normalizedDatasets]
                     : normalizedDatasets;
                 const registerSvc = (name: string, value: any) => {
                     if (kernel?.registerService) kernel.registerService(name, value);
                     else if (typeof (ctx as any).registerService === 'function') (ctx as any).registerService(name, value);
                 };
                 registerSvc('seed-datasets', merged);

                 const metadataNow = ctx.getService('metadata') as IMetadataService | undefined;
                 const loggerRef = ctx.logger;
                 const replayer = async (organizationId: string) => {
                     if (!organizationId) return { inserted: 0, updated: 0, errors: [] as any[] };
                     const md = metadataNow ?? (ctx.getService('metadata') as IMetadataService | undefined);
                     if (!md) {
                         loggerRef.warn('[seed-replayer] metadata service unavailable');
                         return { inserted: 0, updated: 0, errors: [] as any[] };
                     }
                     const datasetsNow = (() => {
                         try { return kernel?.getService?.('seed-datasets'); } catch { return merged; }
                     })() ?? merged;
                     if (!Array.isArray(datasetsNow) || datasetsNow.length === 0) {
                         return { inserted: 0, updated: 0, errors: [] as any[] };
                     }
                     const seedLoader = new SeedLoaderService(ql, md, loggerRef);
                     const { SeedLoaderRequestSchema } = await import('@objectstack/spec/data');
                     const request = SeedLoaderRequestSchema.parse({
                         datasets: datasetsNow,
                         config: {
                             defaultMode: 'upsert',
                             multiPass: true,
                             organizationId,
                         },
                     });
                     const result = await seedLoader.load(request);
                     return {
                         inserted: result.summary.totalInserted,
                         updated: result.summary.totalUpdated,
                         errors: result.errors,
                     };
                 };
                 registerSvc('seed-replayer', replayer);
                 ctx.logger.info(`[Seeder] Registered ${normalizedDatasets.length} datasets + replayer on kernel (total datasets: ${merged.length})`);
             } catch (e: any) {
                 ctx.logger.warn('[Seeder] Failed to register seed-datasets/seed-replayer service', { error: e?.message });
             }

             // Decide whether to also run the seed inline at AppPlugin
             // start. In multi-tenant mode, the per-org replay (driven
             // by SecurityPlugin's sys_organization middleware) is the
             // source of truth — running it here too would create NULL-
             // org rows that pollute reads and need a separate claim
             // step. So we skip it. Single-tenant deployments keep the
             // legacy behaviour: seed immediately at boot so there's
             // always demo data without needing an org insert.
             const multiTenant = String(process.env.OS_MULTI_TENANT ?? 'false').toLowerCase() !== 'false';
             if (multiTenant) {
                 ctx.logger.info('[Seeder] multi-tenant mode — skipping inline seed; per-org replay will run on sys_organization insert');
             } else {
             // Use SeedLoaderService for metadata-driven loading with reference resolution
             try {
                 const metadata = ctx.getService('metadata') as IMetadataService | undefined;
                 if (metadata) {
                     const seedLoader = new SeedLoaderService(ql, metadata, ctx.logger);
                     const { SeedLoaderRequestSchema } = await import('@objectstack/spec/data');
                     const request = SeedLoaderRequestSchema.parse({
                         datasets: normalizedDatasets,
                         config: { defaultMode: 'upsert', multiPass: true },
                     });
                     const result = await seedLoader.load(request);
                     ctx.logger.info('[Seeder] Seed loading complete', {
                         inserted: result.summary.totalInserted,
                         updated: result.summary.totalUpdated,
                         errors: result.errors.length,
                     });
                 } else {
                     // Fallback: basic insert when metadata service is not available
                     ctx.logger.debug('[Seeder] No metadata service; using basic insert fallback');
                     for (const dataset of normalizedDatasets) {
                         ctx.logger.info(`[Seeder] Seeding ${dataset.records.length} records for ${dataset.object}`);
                         for (const record of dataset.records) {
                             try {
                                 await ql.insert(dataset.object, record, { context: { isSystem: true } } as any);
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
                             await ql.insert(dataset.object, record, { context: { isSystem: true } } as any);
                         } catch (insertErr: any) {
                             ctx.logger.warn(`[Seeder] Failed to insert ${dataset.object} record:`, { error: insertErr.message });
                         }
                     }
                 }
                 ctx.logger.info('[Seeder] Data seeding complete (fallback).');
             }
             }
        }
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

        // Emit diagnostic when the active i18n service is a fallback/stub
        const svcAny = i18nService as unknown as Record<string, unknown>;
        if (svcAny._fallback || svcAny._dev) {
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
 * Collect a name → handler map from `bundle.functions`. Accepted shapes:
 *
 *   - `{ functions: { foo: fn, bar: fn } }`           ← preferred map form
 *   - `{ functions: [{ name: 'foo', handler: fn }] }` ← array of records
 *
 * String-named hook handlers (`Hook.handler: 'foo'`) are resolved against
 * this map (and the engine's persistent function registry).
 */
export function collectBundleFunctions(bundle: any): Record<string, (ctx: any) => any> {
    const out: Record<string, (ctx: any) => any> = {};
    const merge = (src: any) => {
        if (!src) return;
        if (Array.isArray(src)) {
            for (const item of src) {
                if (item && typeof item.name === 'string' && typeof item.handler === 'function') {
                    out[item.name] = item.handler;
                }
            }
        } else if (typeof src === 'object') {
            for (const [name, fn] of Object.entries(src)) {
                if (typeof fn === 'function') out[name] = fn as any;
            }
        }
    };
    merge(bundle?.functions);
    merge(bundle?.manifest?.functions);
    return out;
}
