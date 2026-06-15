// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { Plugin, PluginContext } from '@objectstack/core';
import { readEnvWithDeprecation } from '@objectstack/types';
import { SeedLoaderService } from './seed-loader.js';
import { loadDisabledPackageIds } from './package-state-store.js';
import type { IMetadataService, II18nService } from '@objectstack/spec/contracts';
import { SystemUserId } from '@objectstack/spec/system';
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
    /** When true, init/start become no-ops — env has no app payload. */
    private readonly empty: boolean = false;

    constructor(bundle: any, projectContext?: AppPluginProjectContext) {
        this.bundle = bundle;
        this.projectContext = projectContext;
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
                'actions', 'permissions', 'roles', 'profiles', 'translations',
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
                // simply nothing to register.
                this.empty = true;
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
        if (this.empty) {
            ctx.logger.debug('[AppPlugin] empty env — no app payload, skipping init', {
                pluginName: this.name,
            });
            return;
        }
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

        // Seed persisted package disable-state into the registry BEFORE the
        // manifest is decomposed, so disabled packages are installed disabled
        // and stay hidden after restart. Honors every later registration path
        // (boot artifact, marketplace rehydrate, import) via the registry's
        // initial-disabled set. Best-effort — never block boot on this.
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

        ctx.getService<{ register(m: any): void }>('manifest').register(servicePayload);
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

        // Surface code-defined datasources (ADR-0015 Addendum) in the metadata
        // registry so the datasource-admin list returns them alongside any
        // UI-created (`origin:'runtime'`) ones. These are GitOps-managed
        // (declared in `*.datasource.ts`), so they are registered IN MEMORY
        // ONLY — never persisted to the runtime DB store — and stamped
        // `origin:'code'` so the admin service enforces them as read-only.
        // The engine already indexed them for the write gate via registerApp().
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
                    let svc: any;
                    try { svc = ctx.getService('job'); } catch { /* not installed */ }
                    if (!svc || typeof svc.schedule !== 'function') {
                        ctx.logger.warn('[AppPlugin] job service not registered — skipping declarative jobs', {
                            appId, jobCount: jobs.length,
                        });
                        return;
                    }
                    const fnMap = collectBundleFunctions(this.bundle);
                    let ok = 0;
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
                                job.schedule,
                                async (jobCtx: any) => {
                                    await handler({ ...jobCtx, jobId: jobName, bundle: this.bundle });
                                },
                            );
                            ok++;
                        } catch (err: any) {
                            ctx.logger.warn('[AppPlugin] Failed to schedule job', {
                                appId, job: jobName, error: err?.message ?? String(err),
                            });
                        }
                    }
                    ctx.logger.info('[AppPlugin] Scheduled background jobs', { appId, count: ok });
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

             // Resolve the seed identity (os.user / os.org) BEFORE any seed
             // runs. Deterministically ensures a non-loginable system user
             // exists so identity-derived seed values (e.g.
             // `owner_id: cel`os.user.id``) resolve at boot — before the
             // first human sign-up. See ensureSeedIdentity().
             const seedIdentity = await this.ensureSeedIdentity(ql, ctx.logger);

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
                         seeds: datasetsNow,
                         config: {
                             defaultMode: 'upsert',
                             multiPass: true,
                             organizationId,
                             // Bind os.user (system identity) and os.org (this
                             // tenant) so identity-derived seed values resolve
                             // per-org. org.id falls back to organizationId
                             // inside the loader when identity.org is absent.
                             identity: seedIdentity,
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
                 ctx.logger.info(`[Seeder] Registered ${normalizedDatasets.length} datasets + replayer on kernel (total seeds: ${merged.length})`);
             } catch (e: any) {
                 ctx.logger.warn('[Seeder] Failed to register seed-datasets/seed-replayer service', { error: e?.message });
             }

             // Decide whether to also run the seed inline at AppPlugin
             // start. In multi-tenant mode, the per-org replay (driven
             // by OrgScopingPlugin's sys_organization middleware) is the
             // source of truth — running it here too would create NULL-
             // org rows that pollute reads and need a separate claim
             // step. So we skip it. Single-tenant deployments keep the
             // legacy behaviour: seed immediately at boot so there's
             // always demo data without needing an org insert.
             const multiTenant = String(readEnvWithDeprecation('OS_MULTI_ORG_ENABLED', 'OS_MULTI_TENANT') ?? 'false').toLowerCase() !== 'false';
             if (multiTenant) {
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
                          ctx.logger.warn(
                              `[Seeder] Seed loading completed with ${totalErrored} dropped record(s) and ${result.errors.length} error(s) for ${appId}`,
                              {
                                  inserted: totalInserted,
                                  updated: totalUpdated,
                                  skipped: totalSkipped,
                                  errored: totalErrored,
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
             })();
             let timer: ReturnType<typeof setTimeout> | undefined;
             const budget = new Promise<'budget'>((resolve) => {
                 timer = setTimeout(() => resolve('budget'), seedBudgetMs);
             });
             const winner = await Promise.race([seedPromise.then(() => 'done' as const), budget]);
             if (timer) clearTimeout(timer);
             if (winner === 'budget') {
                 ctx.logger.warn(
                     `[Seeder] Inline seed exceeded ${seedBudgetMs}ms budget for ${appId}; continuing in background to avoid blocking kernel start.`,
                 );
                 // Don't leave the promise unobserved.
                 seedPromise.catch((err: any) => {
                     ctx.logger.warn('[Seeder] Background seed failed after budget', { appId, error: err?.message ?? String(err) });
                 });
             }
             }
        }
    }

    stop = async (ctx: PluginContext) => {
        const sys = this.bundle.manifest || this.bundle;
        this.emitCatalogEvent(ctx, 'app:unregistered', sys);
    }

    /**
     * Resolve the identity bound to `os.user` / `os.org` for seed CEL values.
     *
     * On a fresh boot there are zero users until the first human sign-up
     * (which the SeedLoader runs *before*), so identity-derived seeds like
     * `owner_id: cel`os.user.id`` had nothing to resolve against and were
     * dropped silently. To make seeds deterministic and self-sufficient we
     * upsert a single non-loginable **system user** (`usr_system`) and bind
     * it as `os.user`.
     *
     * Why a dedicated system user rather than the login admin:
     *  - `sys_user` is better-auth-managed and schema-locked (ADR-0010); the
     *    password lives in `sys_account`, so a *loginable* admin can only be
     *    minted through better-auth (the CLI does this via HTTP sign-up after
     *    boot). A raw insert here would bypass those invariants.
     *  - `usr_system` is an owner identity only (no credential row), analogous
     *    to Salesforce's "Automated Process" user. The human admin is created
     *    independently and need not be the seed owner.
     *
     * Idempotent: matches by the stable id, inserts once, reuses thereafter.
     * Failures are non-fatal (logged) — records that actually need `os.user`
     * then fail loudly in the loader with an actionable message.
     */
    private async ensureSeedIdentity(
        ql: any,
        logger: PluginContext['logger'],
    ): Promise<{ user: { id: string; role: string; email: string } }> {
        // Deterministic, non-loginable service identity that owns seeded data.
        const SYSTEM_USER_ID = SystemUserId.SYSTEM;
        const SYSTEM_USER_EMAIL = 'system@objectstack.local';
        const identity = { user: { id: SYSTEM_USER_ID, role: 'system', email: SYSTEM_USER_EMAIL } };
        const opts = { context: { isSystem: true } } as any;

        try {
            const existing = await (ql as any).find(
                'sys_user',
                { where: { id: SYSTEM_USER_ID }, limit: 1 },
                opts,
            );
            if (Array.isArray(existing) && existing.length > 0) {
                return identity;
            }
            await (ql as any).insert(
                'sys_user',
                {
                    id: SYSTEM_USER_ID,
                    name: 'System',
                    email: SYSTEM_USER_EMAIL,
                    email_verified: true,
                    role: 'system',
                },
                opts,
            );
            logger.info(
                `[Seeder] Provisioned deterministic system user (${SYSTEM_USER_ID}) as seed owner — binds os.user for identity-derived seed values`,
            );
        } catch (err: any) {
            // Non-fatal: identity-dependent records will fail loudly in the
            // loader; identity-free records still seed normally.
            logger.warn('[Seeder] Failed to ensure system seed user; os.user-dependent seeds may be dropped', {
                error: err?.message ?? String(err),
            });
        }
        return identity;
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
