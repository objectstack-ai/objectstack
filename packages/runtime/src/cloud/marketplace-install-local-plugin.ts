// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * MarketplaceInstallLocalPlugin
 *
 * Installs marketplace packages into THIS runtime's kernel as opposed to a
 * remote cloud environment. Conceptually different from cloud install in
 * three important ways:
 *
 *   1. Single target — the local kernel is the only install target; there
 *      is no `sys_environment` picker.
 *   2. Manifests are cached on disk — once installed, the package is
 *      runnable offline. Cloud is only needed during the install action
 *      itself (to fetch the manifest snapshot).
 *   3. Coexists with user-authored apps — the local runtime usually has
 *      its own `objectstack.config.ts` declared apps. Install refuses to
 *      overwrite a manifest_id that's already registered to avoid silently
 *      replacing user code.
 *
 * Endpoints (mounted by `start()` on the `kernel:ready` hook):
 *
 *   POST   /api/v1/marketplace/install-local
 *          body: { packageId: string, versionId?: string }   (default: "latest")
 *          → fetches manifest from cloud, caches to disk, registers via
 *            the kernel's `manifest` service. Returns the installed entry.
 *
 *   GET    /api/v1/marketplace/install-local
 *          → lists currently installed marketplace packages
 *
 *   DELETE /api/v1/marketplace/install-local/:manifestId
 *          → removes the cached manifest. Kernel must be restarted to fully
 *            unload — `engine.registerApp` is additive only. We document
 *            this in the response message.
 *
 * Persistence layout:
 *   <cwd>/.objectstack/installed-packages/<safe-manifest-id>.json
 *   Each file: { packageId, versionId, manifestId, version, manifest, installedAt, installedBy }
 *
 * On `kernel:ready`, the plugin scans the directory and re-registers each
 * cached manifest so installs survive process restarts without further
 * cloud round-trips.
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { Plugin, PluginContext } from '@objectstack/core';
import { resolveCloudUrl } from './cloud-url.js';

const ROUTE_BASE = '/api/v1/marketplace/install-local';
const DEFAULT_DIR = '.objectstack/installed-packages';

export interface MarketplaceInstallLocalPluginConfig {
    /** Cloud control-plane base URL. When unset, falls back to OS_CLOUD_URL
     *  and then to the public ObjectStack cloud so a fresh `objectstack dev`
     *  can install from the marketplace without configuration. Set
     *  OS_CLOUD_URL=off to disable (the install endpoint then returns 503). */
    controlPlaneUrl?: string;
    /** Override the on-disk cache directory. Defaults to
     *  `<cwd>/.objectstack/installed-packages`. */
    storageDir?: string;
}

interface InstalledEntry {
    packageId: string;
    versionId: string;
    manifestId: string;
    version: string;
    manifest: any;
    installedAt: string;
    installedBy: string | null;
}

function safeFilename(manifestId: string): string {
    return manifestId.replace(/[^a-zA-Z0-9._-]/g, '_') + '.json';
}

export class MarketplaceInstallLocalPlugin implements Plugin {
    readonly name = 'com.objectstack.runtime.marketplace-install-local';
    readonly version = '1.0.0';

    private readonly cloudUrl: string;
    private readonly storageDir: string;

    constructor(config: MarketplaceInstallLocalPluginConfig = {}) {
        this.cloudUrl = resolveCloudUrl(config.controlPlaneUrl);
        this.storageDir = config.storageDir
            ? resolve(config.storageDir)
            : resolve(process.cwd(), DEFAULT_DIR);
    }

    init = async (_ctx: PluginContext): Promise<void> => {
        // No services registered — pure HTTP wiring during start().
    };

    start = async (ctx: PluginContext): Promise<void> => {
        ctx.hook('kernel:ready', async () => {
            // 1. Rehydrate previously installed packages so they survive restart.
            await this.rehydrate(ctx);

            // 2. Mount HTTP endpoints.
            let httpServer: any;
            try {
                httpServer = ctx.getService('http-server');
            } catch {
                ctx.logger?.warn?.('[MarketplaceInstallLocal] http-server not available — install endpoints not mounted');
                return;
            }
            if (!httpServer || typeof httpServer.getRawApp !== 'function') {
                ctx.logger?.warn?.('[MarketplaceInstallLocal] http-server missing getRawApp() — install endpoints not mounted');
                return;
            }
            const rawApp = httpServer.getRawApp();

            const postHandler = async (c: any) => this.handleInstall(c, ctx);
            const getHandler = async (c: any) => this.handleList(c);
            const deleteHandler = async (c: any) => this.handleUninstall(c, ctx);

            if (typeof rawApp.post === 'function') rawApp.post(ROUTE_BASE, postHandler);
            if (typeof rawApp.get === 'function') rawApp.get(ROUTE_BASE, getHandler);
            if (typeof rawApp.delete === 'function') rawApp.delete(`${ROUTE_BASE}/:manifestId`, deleteHandler);

            ctx.logger?.info?.(`[MarketplaceInstallLocal] mounted at ${ROUTE_BASE} (storage: ${this.storageDir})`);
        });
    };

    /**
     * Re-register every cached manifest with the kernel's manifest service.
     * Safe to call on a kernel that already has the same manifest_id (the
     * underlying ObjectQL registry overwrites by id, but we still warn so
     * a developer can spot the dev-time clash between their config.ts and
     * a marketplace package).
     */
    private rehydrate = async (ctx: PluginContext): Promise<void> => {
        const entries = this.readAll();
        if (entries.length === 0) return;

        let manifestService: { register(m: any): void } | null = null;
        try {
            manifestService = ctx.getService('manifest') as any;
        } catch {
            ctx.logger?.warn?.('[MarketplaceInstallLocal] no `manifest` service — rehydrate skipped');
            return;
        }

        for (const entry of entries) {
            try {
                manifestService!.register(entry.manifest);
                // Sync schemas so the driver creates tables for the newly-
                // registered objects (idempotent — already-synced tables
                // are no-ops).
                try {
                    const ql: any = ctx.getService('objectql');
                    if (ql && typeof ql.syncSchemas === 'function') await ql.syncSchemas();
                } catch { /* non-fatal */ }
                // Replay translations + register seed datasets, but don't
                // re-run seeding — existing rows are already in the DB from
                // the original install, and multi-tenant orgs will replay
                // via the security middleware on next sys_organization insert.
                await this.applySideEffects(ctx, entry.manifest, { seedNow: false });
                ctx.logger?.info?.(`[MarketplaceInstallLocal] rehydrated ${entry.manifestId}@${entry.version}`);
            } catch (err: any) {
                ctx.logger?.error?.(`[MarketplaceInstallLocal] rehydrate failed for ${entry.manifestId}`, err instanceof Error ? err : new Error(String(err)));
            }
        }
    };

    private handleInstall = async (c: any, ctx: PluginContext): Promise<Response> => {
        if (!this.cloudUrl) {
            return c.json({ success: false, error: { code: 'marketplace_unavailable', message: 'OS_CLOUD_URL not configured.' } }, 503);
        }
        const userId = await this.requireAuthenticatedUser(c, ctx);
        if (!userId) {
            return c.json({ success: false, error: { code: 'unauthorized', message: 'Authentication required to install packages.' } }, 401);
        }

        let body: any = {};
        try { body = await c.req.json(); } catch { /* empty body */ }
        const packageId = String(body?.packageId ?? '').trim();
        const versionId = String(body?.versionId ?? 'latest').trim() || 'latest';
        if (!packageId) {
            return c.json({ success: false, error: { code: 'bad_request', message: 'packageId is required.' } }, 400);
        }

        // 1. Fetch manifest snapshot from cloud
        let payload: any;
        try {
            const url = `${this.cloudUrl}/api/v1/marketplace/packages/${encodeURIComponent(packageId)}/versions/${encodeURIComponent(versionId)}/manifest`;
            const resp = await fetch(url, { headers: { 'Accept': 'application/json' } });
            if (!resp.ok) {
                const text = await resp.text().catch(() => '');
                return c.json({
                    success: false,
                    error: { code: 'cloud_fetch_failed', message: `Cloud returned ${resp.status}: ${text.slice(0, 200)}` },
                }, resp.status === 404 ? 404 : 502);
            }
            payload = await resp.json();
        } catch (err: any) {
            return c.json({
                success: false,
                error: { code: 'cloud_fetch_failed', message: err?.message ?? String(err) },
            }, 502);
        }

        const data = payload?.data ?? payload;
        const manifest = data?.manifest;
        const resolvedVersionId = String(data?.version_id ?? versionId);
        const version = String(data?.version ?? 'unknown');
        const manifestId = String(manifest?.id ?? manifest?.name ?? '');
        if (!manifest || !manifestId) {
            return c.json({ success: false, error: { code: 'invalid_manifest', message: 'Cloud returned an invalid manifest payload.' } }, 502);
        }

        // 2. Conflict check — refuse to overwrite user-authored apps
        const conflict = this.findConflict(ctx, manifestId);
        if (conflict === 'user-code') {
            return c.json({
                success: false,
                error: {
                    code: 'manifest_conflict',
                    message: `manifest_id "${manifestId}" is already defined by this runtime's local code. Refusing to overwrite. Uninstall the local definition first.`,
                },
            }, 409);
        }

        // 3. Persist on disk
        const entry: InstalledEntry = {
            packageId,
            versionId: resolvedVersionId,
            manifestId,
            version,
            manifest,
            installedAt: new Date().toISOString(),
            installedBy: userId,
        };
        try {
            mkdirSync(this.storageDir, { recursive: true });
            writeFileSync(join(this.storageDir, safeFilename(manifestId)), JSON.stringify(entry, null, 2), 'utf8');
        } catch (err: any) {
            return c.json({
                success: false,
                error: { code: 'storage_failed', message: `Failed to persist manifest: ${err?.message ?? err}` },
            }, 500);
        }

        // 4. Hot-register via manifest service (works post-bootstrap)
        try {
            const manifestService = ctx.getService('manifest') as any;
            manifestService.register(manifest);
        } catch (err: any) {
            // Persisted on disk so a restart would still pick it up;
            // surface the error but keep the install record.
            ctx.logger?.warn?.(`[MarketplaceInstallLocal] hot-register failed for ${manifestId} (will load on next restart): ${err?.message ?? err}`);
        }

        // 4b. Sync schemas to physical tables — registerApp only adds the
        //     object definitions to the in-memory registry; the driver
        //     must be asked to materialize tables/columns before any seed
        //     insert (or user write) succeeds.
        try {
            const ql: any = ctx.getService('objectql');
            if (ql && typeof ql.syncSchemas === 'function') {
                await ql.syncSchemas();
                ctx.logger?.info?.(`[MarketplaceInstallLocal] syncSchemas() ran after registering ${manifestId}`);
            }
        } catch (err: any) {
            ctx.logger?.warn?.(`[MarketplaceInstallLocal] syncSchemas failed for ${manifestId}: ${err?.message ?? err}`);
        }

        // 5. Replicate the AppPlugin start-time side-effects that the
        //    `manifest` service does NOT do on its own:
        //      • load translation bundles into the i18n service
        //      • stash seed datasets on the kernel + run them now so the
        //        installed app has demo data on first paint.
        const seededSummary = await this.applySideEffects(ctx, manifest, { seedNow: true, c });

        return c.json({
            success: true,
            data: {
                manifestId,
                version,
                versionId: resolvedVersionId,
                installedAt: entry.installedAt,
                hotLoaded: true,
                upgradedFrom: conflict === 'marketplace' ? 'previous-marketplace-version' : null,
                translationsLoaded: seededSummary.translationsLoaded,
                seeded: seededSummary.seeded,
                note: 'App is now available in this runtime. Refresh the console to see it in the app switcher.',
            },
        }, 200);
    };

    private handleList = async (c: any): Promise<Response> => {
        const entries = this.readAll();
        return c.json({
            success: true,
            data: {
                items: entries.map(e => ({
                    packageId: e.packageId,
                    versionId: e.versionId,
                    manifestId: e.manifestId,
                    version: e.version,
                    installedAt: e.installedAt,
                    installedBy: e.installedBy,
                })),
                total: entries.length,
                storageDir: this.storageDir,
            },
        }, 200);
    };

    private handleUninstall = async (c: any, ctx: PluginContext): Promise<Response> => {
        const userId = await this.requireAuthenticatedUser(c, ctx);
        if (!userId) {
            return c.json({ success: false, error: { code: 'unauthorized', message: 'Authentication required.' } }, 401);
        }
        const manifestId = String(c.req.param?.('manifestId') ?? c.req.params?.manifestId ?? '').trim();
        if (!manifestId) {
            return c.json({ success: false, error: { code: 'bad_request', message: 'manifestId path param required.' } }, 400);
        }
        const file = join(this.storageDir, safeFilename(manifestId));
        if (!existsSync(file)) {
            return c.json({ success: false, error: { code: 'not_found', message: `No marketplace install for ${manifestId}.` } }, 404);
        }
        try {
            unlinkSync(file);
        } catch (err: any) {
            return c.json({ success: false, error: { code: 'storage_failed', message: err?.message ?? String(err) } }, 500);
        }
        ctx.logger?.info?.(`[MarketplaceInstallLocal] uninstalled ${manifestId} (cached manifest removed; restart runtime to unload from running kernel)`);
        return c.json({
            success: true,
            data: {
                manifestId,
                note: 'Cached manifest removed. The app remains loaded in the running kernel until the next restart (the kernel API does not support unregistering apps in-place).',
            },
        }, 200);
    };

    /**
     * Detect whether `manifestId` is already known to the kernel and classify
     * the source so we can refuse vs upgrade gracefully.
     *
     *   'none'         — fresh install
     *   'marketplace'  — previously installed by this plugin (allow upgrade)
     *   'user-code'    — defined by AppPlugin from objectstack.config.ts
     *                    (refuse to avoid silently overwriting authored code)
     */
    private findConflict = (ctx: PluginContext, manifestId: string): 'none' | 'marketplace' | 'user-code' => {
        // First check: do we already have a marketplace install file?
        if (existsSync(join(this.storageDir, safeFilename(manifestId)))) {
            return 'marketplace';
        }
        // Then check: is the manifest_id already in the engine's registry?
        try {
            const ql: any = ctx.getService('objectql');
            const packages: any[] = ql?.registry?.getAllPackages?.() ?? [];
            const hit = packages.find((p: any) =>
                (p?.manifest?.id ?? p?.id ?? p?.manifest?.name) === manifestId,
            );
            if (hit) return 'user-code';
        } catch { /* objectql not registered yet — treat as fresh */ }
        return 'none';
    };

    /**
     * Pull a userId out of the request's better-auth session, if any.
     * Returns null when there is no signed-in user. v1 does not check
     * admin role — UI gating + the auth requirement is sufficient for
     * dev / single-tenant runtimes. Stricter checks can be layered on
     * via a middleware in cloud-hosted multi-tenant deployments.
     */
    /**
     * Replicate the start-time side-effects that AppPlugin runs for
     * statically-declared apps but the `manifest` service does NOT:
     *
     *   1. Load `manifest.translations` (array of `Record<locale, data>`)
     *      into the i18n service — auto-creating an in-memory fallback if
     *      none is registered, matching AppPlugin's behaviour.
     *
     *   2. Merge `manifest.data` (an array of seed datasets) into the
     *      kernel's `seed-datasets` service so SecurityPlugin's per-org
     *      replay middleware picks them up on every future
     *      sys_organization insert.
     *
     *   3. When `seedNow=true`, also run the seed immediately so the user
     *      sees demo data without having to create a new org:
     *        • single-tenant: run SeedLoaderService inline (mirrors
     *          AppPlugin single-tenant branch)
     *        • multi-tenant: invoke `seed-replayer` for the caller's
     *          active org (resolved from the request session)
     *
     * Errors are logged but never thrown — install succeeds even if
     * post-register side-effects partially fail (the manifest itself is
     * already registered + cached). Returns a small summary for the
     * response envelope.
     */
    private applySideEffects = async (
        ctx: PluginContext,
        manifest: any,
        opts: { seedNow: boolean; c?: any },
    ): Promise<{ translationsLoaded: number; seeded: { mode: 'inline' | 'replayer' | 'skipped'; inserted?: number; updated?: number; errors?: number; reason?: string } }> => {
        const appId = String(manifest?.id ?? 'unknown');
        let translationsLoaded = 0;
        let seedSummary: any = { mode: 'skipped', reason: 'no-datasets' };

        // ── 1. i18n bundles ─────────────────────────────────────────────
        try {
            const bundles: Array<Record<string, unknown>> = [];
            if (Array.isArray(manifest?.translations)) bundles.push(...manifest.translations);
            if (Array.isArray(manifest?.i18n)) bundles.push(...manifest.i18n);

            if (bundles.length > 0) {
                let i18nService: any;
                try { i18nService = ctx.getService('i18n'); } catch { /* not registered */ }
                if (!i18nService) {
                    try {
                        const mod = await import('@objectstack/core');
                        const createMemoryI18n = (mod as any).createMemoryI18n;
                        if (typeof createMemoryI18n === 'function') {
                            i18nService = createMemoryI18n();
                            (ctx as any).registerService?.('i18n', i18nService);
                            ctx.logger?.info?.(`[MarketplaceInstallLocal] auto-registered in-memory i18n fallback for "${appId}"`);
                        }
                    } catch { /* fallback unavailable */ }
                }
                if (i18nService?.loadTranslations) {
                    for (const bundle of bundles) {
                        for (const [locale, data] of Object.entries(bundle)) {
                            if (data && typeof data === 'object') {
                                try {
                                    i18nService.loadTranslations(locale, data as Record<string, unknown>);
                                    translationsLoaded++;
                                } catch (err: any) {
                                    ctx.logger?.warn?.(`[MarketplaceInstallLocal] failed to load ${appId} translations for ${locale}: ${err?.message ?? err}`);
                                }
                            }
                        }
                    }
                    ctx.logger?.info?.(`[MarketplaceInstallLocal] loaded ${translationsLoaded} locale bundle(s) for ${appId}`);
                }
            }
        } catch (err: any) {
            ctx.logger?.warn?.(`[MarketplaceInstallLocal] i18n side-effect failed for ${appId}: ${err?.message ?? err}`);
        }

        // ── 2. Seed datasets — merge into kernel service ─────────────────
        const datasets = Array.isArray(manifest?.data)
            ? manifest.data.filter((d: any) => d && d.object && Array.isArray(d.records))
            : [];

        if (datasets.length > 0) {
            try {
                const kernel: any = (ctx as any).kernel;
                let existing: any[] = [];
                try {
                    const v = kernel?.getService?.('seed-datasets');
                    if (Array.isArray(v)) existing = v;
                } catch { /* unset */ }
                const merged = [...existing, ...datasets];
                if (kernel?.registerService) kernel.registerService('seed-datasets', merged);
                else (ctx as any).registerService?.('seed-datasets', merged);
                ctx.logger?.info?.(`[MarketplaceInstallLocal] merged ${datasets.length} seed dataset(s) into kernel (total: ${merged.length})`);
            } catch (err: any) {
                ctx.logger?.warn?.(`[MarketplaceInstallLocal] failed to merge seed-datasets: ${err?.message ?? err}`);
            }
        }

        // ── 3. Optional immediate seed ───────────────────────────────────
        // Always seed inline via SeedLoaderService — don't rely on the
        // `seed-replayer` registered by AppPlugin since (a) it isn't
        // registered when the host runtime has no AppPlugin app with
        // seed data, and (b) its closure may use stale datasets. In
        // multi-tenant mode we pass `organizationId` so the loader
        // writes tenant-scoped rows the same way AppPlugin's
        // single-tenant branch + SecurityPlugin's per-org replay do.
        if (opts.seedNow && datasets.length > 0) {
            const multiTenant = String(process.env.OS_MULTI_TENANT ?? 'false').toLowerCase() !== 'false';
            try {
                const ql: any = ctx.getService('objectql');
                let metadata: any;
                try { metadata = ctx.getService('metadata'); } catch { /* none */ }
                if (!ql || !metadata) {
                    seedSummary = { mode: 'skipped', reason: 'objectql-or-metadata-missing' };
                } else {
                    let organizationId: string | undefined;
                    if (multiTenant) {
                        const resolved = await this.resolveActiveOrgId(opts.c, ctx);
                        if (resolved) organizationId = resolved;
                        else {
                            seedSummary = { mode: 'skipped', reason: 'multi-tenant-no-active-org' };
                            ctx.logger?.warn?.('[MarketplaceInstallLocal] multi-tenant: no active org on request — data not seeded');
                        }
                    }
                    if (!multiTenant || organizationId) {
                        const [{ SeedLoaderService }, { SeedLoaderRequestSchema }] = await Promise.all([
                            import('../seed-loader.js'),
                            import('@objectstack/spec/data'),
                        ]);
                        const seedLoader = new (SeedLoaderService as any)(ql, metadata, ctx.logger);
                        const request = (SeedLoaderRequestSchema as any).parse({
                            datasets,
                            config: {
                                defaultMode: 'upsert',
                                multiPass: true,
                                ...(organizationId ? { organizationId } : {}),
                            },
                        });
                        const result = await seedLoader.load(request);
                        seedSummary = {
                            mode: 'inline',
                            inserted: result.summary.totalInserted,
                            updated: result.summary.totalUpdated,
                            errors: result.errors.length,
                        };
                        ctx.logger?.info?.(`[MarketplaceInstallLocal] inline seed for ${appId}${organizationId ? ` (org=${organizationId})` : ''}: inserted=${seedSummary.inserted} updated=${seedSummary.updated} errors=${seedSummary.errors}`);
                    }
                }
            } catch (err: any) {
                seedSummary = { mode: 'skipped', reason: `seed-error: ${err?.message ?? err}` };
                ctx.logger?.warn?.(`[MarketplaceInstallLocal] seed run failed for ${appId}: ${err?.message ?? err}`);
            }
        }

        return { translationsLoaded, seeded: seedSummary };
    };

    /**
     * Best-effort active-org resolution. Reads the better-auth session
     * (same path as requireAuthenticatedUser) and returns
     * `session.activeOrganizationId`, falling back to the user's first
     * org membership.
     */
    private resolveActiveOrgId = async (c: any, ctx: PluginContext): Promise<string | null> => {
        if (!c?.req?.raw?.headers) return null;
        try {
            const authService: any = ctx.getService('auth');
            let api: any = authService?.api;
            if (!api && typeof authService?.getApi === 'function') api = await authService.getApi();
            if (!api?.getSession) return null;
            const session = await api.getSession({ headers: c.req.raw.headers });
            const direct = session?.session?.activeOrganizationId ?? session?.activeOrganizationId ?? null;
            if (direct) return String(direct);
            // Fall back to the user's first membership row.
            const userId = session?.user?.id;
            if (!userId) return null;
            try {
                const ql: any = ctx.getService('objectql');
                if (ql?.find) {
                    const rows = await ql.find('sys_organization_member', { where: { user_id: userId }, limit: 1, context: { isSystem: true } } as any);
                    const row = Array.isArray(rows) ? rows[0] : (rows?.items?.[0] ?? null);
                    return row?.organization_id ? String(row.organization_id) : null;
                }
            } catch { /* ignore */ }
        } catch { /* ignore */ }
        return null;
    };

    private requireAuthenticatedUser = async (c: any, ctx: PluginContext): Promise<string | null> => {
        try {
            // Mirror `hono-plugin.ts` resolveCtx: pull the better-auth `api`
            // off the auth service and call `getSession({ headers })`. The
            // earlier guess `c.get('auth').session` is wrong — AuthPlugin
            // does not pre-populate the Hono context.
            const authService: any = ctx.getService('auth');
            let api: any = authService?.api;
            if (!api && typeof authService?.getApi === 'function') {
                api = await authService.getApi();
            }
            if (api?.getSession && c?.req?.raw?.headers) {
                const session = await api.getSession({ headers: c.req.raw.headers });
                const userId = session?.user?.id ?? null;
                if (userId) return String(userId);
            }
        } catch { /* ignore — fall through */ }
        // Header fallback for cases where auth is disabled (e.g. test stubs)
        const xUserId = c?.req?.header?.('x-user-id');
        if (xUserId) return String(xUserId);
        return null;
    };

    private readAll = (): InstalledEntry[] => {
        if (!existsSync(this.storageDir)) return [];
        const out: InstalledEntry[] = [];
        for (const name of readdirSync(this.storageDir)) {
            if (!name.endsWith('.json')) continue;
            try {
                const raw = readFileSync(join(this.storageDir, name), 'utf8');
                out.push(JSON.parse(raw));
            } catch { /* skip corrupt files */ }
        }
        return out;
    };
}
