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

import type { Plugin, PluginContext } from '@objectstack/core';
import { resolveMultiOrgEnabled } from '@objectstack/types';
import { resolveCloudUrl } from './cloud-url.js';
import { resolveMarketplacePublicBaseUrl } from './marketplace-public-url.js';
import { LocalManifestSource, type InstalledManifestEntry } from './local-manifest-source.js';
import { ConnectionCredentialStore } from './connection-credential-store.js';
import { MARKETPLACE_INSTALLED_UI_BUNDLE } from './marketplace-ui.js';

const ROUTE_BASE = '/api/v1/marketplace/install-local';

/** Best-effort manifest id from a registry package entry (shape varies). */
function manifestIdOf(p: any): string | undefined {
    return p?.manifest?.id ?? p?.id ?? p?.manifest?.name ?? undefined;
}

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

// Desired-state entry shape — owned by the LocalManifestSource ledger
// (ADR-0007 step ⑤: the ledger is the named local desired-state owner;
// this plugin is its HTTP mutation surface).
type InstalledEntry = InstalledManifestEntry;

export class MarketplaceInstallLocalPlugin implements Plugin {
    readonly name = 'com.objectstack.runtime.marketplace-install-local';
    readonly version = '1.0.0';

    private readonly cloudUrl: string;
    private readonly ledger: LocalManifestSource;
    private readonly storageDir: string;
    private readonly credentials: ConnectionCredentialStore;
    /**
     * Manifest ids already present in the engine registry at `kernel:ready`,
     * BEFORE this plugin rehydrates its own ledger. These are genuine
     * user/config-defined apps (AppPlugin from objectstack.config.ts). Used by
     * findConflict to tell real local code apart from an orphaned marketplace
     * install whose ledger entry went missing.
     */
    private readonly bootUserCodeIds = new Set<string>();

    constructor(config: MarketplaceInstallLocalPluginConfig = {}) {
        this.cloudUrl = resolveCloudUrl(config.controlPlaneUrl);
        this.ledger = new LocalManifestSource(config.storageDir);
        this.storageDir = this.ledger.dir;
        this.credentials = new ConnectionCredentialStore();
    }

    init = async (_ctx: PluginContext): Promise<void> => {
        // No services registered — pure HTTP wiring during start().
    };

    start = async (ctx: PluginContext): Promise<void> => {
        ctx.hook('kernel:ready', async () => {
            // Snapshot the manifest ids the engine already knows about BEFORE
            // we register anything or rehydrate the ledger — by now AppPlugin
            // has loaded objectstack.config.ts, so whatever is registered here
            // is genuine local/user code. findConflict uses this to avoid
            // misreading an orphaned marketplace install as user code.
            this.captureBootUserCodeIds(ctx);

            // Plugin-owned Setup nav (cloud ADR-0009): "Installed Apps"
            // ships WITH the local-install capability.
            try {
                const manifest = ctx.getService<{ register(m: any): void }>('manifest');
                manifest?.register?.(MARKETPLACE_INSTALLED_UI_BUNDLE);
            } catch { /* no manifest service */ }

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

            const reseedHandler = async (c: any) => this.handleReseed(c, ctx);
            const purgeHandler = async (c: any) => this.handlePurge(c, ctx);

            if (typeof rawApp.post === 'function') rawApp.post(ROUTE_BASE, postHandler);
            if (typeof rawApp.get === 'function') rawApp.get(ROUTE_BASE, getHandler);
            if (typeof rawApp.delete === 'function') rawApp.delete(`${ROUTE_BASE}/:manifestId`, deleteHandler);
            if (typeof rawApp.post === 'function') {
                rawApp.post(`${ROUTE_BASE}/:manifestId/reseed-sample-data`, reseedHandler);
                rawApp.post(`${ROUTE_BASE}/:manifestId/purge-sample-data`, purgeHandler);
            }

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

        let manifestService: { register(m: any): void | Promise<void> } | null = null;
        try {
            manifestService = ctx.getService('manifest') as any;
        } catch {
            ctx.logger?.warn?.('[MarketplaceInstallLocal] no `manifest` service — rehydrate skipped');
            return;
        }

        for (const entry of entries) {
            try {
                // Awaited: register also bridges the manifest's objects into
                // the metadata service (late-registration bridge in
                // ObjectQLPlugin) — wait for that so metadata consumers see
                // the package as soon as rehydrate reports success.
                await manifestService!.register(entry.manifest);
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
        const userId = await this.requireAuthenticatedUser(c, ctx);
        if (!userId) {
            return c.json({ success: false, error: { code: 'unauthorized', message: 'Authentication required to install packages.' } }, 401);
        }

        let body: any = {};
        try { body = await c.req.json(); } catch { /* empty body */ }

        // ── Offline path: an inline manifest was supplied (file import). ──
        // Bypass the cloud-fetch entirely; no OS_CLOUD_URL required.
        const inlineManifest = body?.manifest && typeof body.manifest === 'object' ? body.manifest : null;

        // A COMPILED stack bundle (`dist/objectstack.json`, what publish
        // uploads as the version payload) nests its meta under `.manifest`:
        //   { manifest: { id, namespace, version, … }, objects, views, … }
        // while ObjectQL's registerApp expects the FLAT app shape (top-level
        // id + sections). Flatten when detected — otherwise every install of
        // a published compiled bundle dies with "Invalid manifest payload".
        const normalizeBundle = (m: any): any => {
            if (m && !m.id && !m.name && m.manifest && typeof m.manifest === 'object' && (m.manifest.id || m.manifest.name)) {
                const { manifest: meta, ...sections } = m;
                return { ...meta, ...sections };
            }
            return m;
        };

        let manifest: any;
        let resolvedVersionId: string;
        let version: string;
        let packageId: string;

        if (inlineManifest) {
            manifest = normalizeBundle(inlineManifest);
            packageId = String(manifest.id ?? manifest.name ?? '').trim();
            version = String(manifest.version ?? 'unknown');
            resolvedVersionId = String(body?.versionId ?? version);
            if (!packageId) {
                return c.json({ success: false, error: { code: 'invalid_manifest', message: 'Inline manifest must have an "id" or "name".' } }, 400);
            }
        } else {
            if (!this.cloudUrl) {
                return c.json({ success: false, error: { code: 'marketplace_unavailable', message: 'OS_CLOUD_URL not configured.' } }, 503);
            }
            packageId = String(body?.packageId ?? '').trim();
            const versionId = String(body?.versionId ?? 'latest').trim() || 'latest';
            if (!packageId) {
                return c.json({ success: false, error: { code: 'bad_request', message: 'packageId is required.' } }, 400);
            }

            // 1. Fetch manifest snapshot — prefer public R2 fast-path so
            //    install works even when cloud is asleep or down. Fall back
            //    to cloud on miss/error.
            let payload: any;
            const publicBase = resolveMarketplacePublicBaseUrl();
            const fetchAttempts: { label: string; url: string }[] = [];
            if (publicBase) {
                fetchAttempts.push({
                    label: 'public-r2',
                    url: `${publicBase}/packages/${encodeURIComponent(packageId)}/versions/${encodeURIComponent(versionId)}/manifest.json`,
                });
            }
            fetchAttempts.push({
                label: 'cloud',
                url: `${this.cloudUrl}/api/v1/marketplace/packages/${encodeURIComponent(packageId)}/versions/${encodeURIComponent(versionId)}/manifest`,
            });

            // Credential for the CLOUD attempt: the env→cloud service key
            // (cloud-hosted) or the bound oscc_ bearer (self-hosted). With it
            // the catalog also serves the caller's OWN org/private packages —
            // anonymous fetches keep getting public/listed only. The public
            // R2 fast-path stays anonymous (it only ever holds public).
            const cloudCredential = (process.env.OS_CLOUD_API_KEY ?? '').trim()
                || this.credentials.read()?.runtimeToken
                || '';

            let lastErrStatus = 0;
            let lastErrText = '';
            for (const attempt of fetchAttempts) {
                try {
                    const headers: Record<string, string> = { Accept: 'application/json' };
                    if (attempt.label === 'cloud' && cloudCredential) headers.Authorization = `Bearer ${cloudCredential}`;
                    const resp = await fetch(attempt.url, { headers });
                    if (!resp.ok) {
                        lastErrStatus = resp.status;
                        lastErrText = (await resp.text().catch(() => '')).slice(0, 200);
                        // 404 from public R2 is not fatal — fall through to cloud.
                        if (attempt.label === 'public-r2' && resp.status === 404) {
                            ctx.logger?.info?.(`[MarketplaceInstallLocal] public-r2 miss for ${packageId}@${versionId}, falling back to cloud`);
                            continue;
                        }
                        if (attempt.label === 'public-r2' && resp.status >= 500) {
                            ctx.logger?.warn?.(`[MarketplaceInstallLocal] public-r2 ${resp.status}, falling back to cloud`);
                            continue;
                        }
                        break; // cloud non-ok → surface error
                    }
                    payload = await resp.json();
                    lastErrStatus = 0;
                    break;
                } catch (err: any) {
                    if (attempt.label === 'public-r2') {
                        ctx.logger?.warn?.(`[MarketplaceInstallLocal] public-r2 fetch error: ${err?.message ?? err}, falling back to cloud`);
                        continue;
                    }
                    return c.json({
                        success: false,
                        error: { code: 'cloud_fetch_failed', message: err?.message ?? String(err) },
                    }, 502);
                }
            }
            if (!payload) {
                return c.json({
                    success: false,
                    error: { code: 'cloud_fetch_failed', message: `Cloud returned ${lastErrStatus}: ${lastErrText}` },
                }, lastErrStatus === 404 ? 404 : 502);
            }

            const data = payload?.data ?? payload;
            manifest = normalizeBundle(data?.manifest);
            resolvedVersionId = String(data?.version_id ?? versionId);
            version = String(data?.version ?? 'unknown');
        }

        const manifestId = String(manifest?.id ?? manifest?.name ?? '');
        if (!manifest || !manifestId) {
            return c.json({ success: false, error: { code: 'invalid_manifest', message: 'Invalid manifest payload.' } }, inlineManifest ? 400 : 502);
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

        // 3. Hot-register FIRST so a malformed inline manifest fails the
        //    install loudly rather than persisting a broken record that
        //    would also fail on every subsequent rehydrate.
        try {
            const manifestService = ctx.getService('manifest') as any;
            // Awaited: register also bridges the manifest's objects into the
            // metadata service — a caller that reads metadata right after a
            // 200 (AI describe_object, Studio object list) must see them.
            await manifestService.register(manifest);
        } catch (err: any) {
            // For offline file imports we treat a register failure as a hard
            // failure (don't persist). Cloud installs historically tolerated
            // this (the on-disk record survives a restart), so keep that path
            // lenient for backwards compatibility.
            if (inlineManifest) {
                return c.json({
                    success: false,
                    error: { code: 'register_failed', message: `Failed to register imported manifest: ${err?.message ?? err}` },
                }, 422);
            }
            ctx.logger?.warn?.(`[MarketplaceInstallLocal] hot-register failed for ${manifestId} (will load on next restart): ${err?.message ?? err}`);
        }

        // 4. Persist on disk
        const entry: InstalledEntry = {
            packageId,
            versionId: resolvedVersionId,
            manifestId,
            version,
            manifest,
            installedAt: new Date().toISOString(),
            installedBy: userId,
            withSampleData: false,
        };
        try {
            this.ledger.write(entry);
        } catch (err: any) {
            return c.json({
                success: false,
                error: { code: 'storage_failed', message: `Failed to persist manifest: ${err?.message ?? err}` },
            }, 500);
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
        if (seededSummary.seeded.mode === 'inline' && (seededSummary.seeded.inserted ?? 0) + (seededSummary.seeded.updated ?? 0) > 0) {
            entry.withSampleData = true;
            try {
                this.ledger.write(entry);
            } catch { /* non-fatal — entry already on disk */ }
        }

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
                    withSampleData: e.withSampleData ?? false,
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
        if (!this.ledger.has(manifestId)) {
            return c.json({ success: false, error: { code: 'not_found', message: `No marketplace install for ${manifestId}.` } }, 404);
        }
        try {
            this.ledger.remove(manifestId);
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
        // 1. A live ledger entry is the authoritative "we installed this" record.
        if (this.ledger.has(manifestId)) {
            return 'marketplace';
        }
        // 2. Present in the engine registry AND captured at boot before we
        //    rehydrated — genuine user/config code. Refuse to overwrite.
        if (this.bootUserCodeIds.has(manifestId)) {
            return 'user-code';
        }
        // 3. Registered, but neither in the ledger nor in the boot snapshot.
        //    This is an ORPHANED marketplace install — its ledger entry was
        //    lost/renamed/corrupted (e.g. a half-finished upgrade left a
        //    `.bak`). It is NOT user code, so treat it as a marketplace package
        //    and let the upgrade overwrite it, rather than refusing with a
        //    misleading "defined by this runtime's local code" error.
        try {
            const ql: any = ctx.getService('objectql');
            const packages: any[] = ql?.registry?.getAllPackages?.() ?? [];
            if (packages.some((p: any) => manifestIdOf(p) === manifestId)) {
                return 'marketplace';
            }
        } catch { /* objectql not registered yet — treat as fresh */ }
        return 'none';
    };

    /**
     * Record the manifest ids the engine registry already holds, called once at
     * `kernel:ready` before rehydrate. Best-effort: a missing/empty registry
     * just yields an empty snapshot (every later install is treated as fresh).
     */
    private captureBootUserCodeIds = (ctx: PluginContext): void => {
        try {
            const ql: any = ctx.getService('objectql');
            const packages: any[] = ql?.registry?.getAllPackages?.() ?? [];
            for (const p of packages) {
                const id = manifestIdOf(p);
                if (id) this.bootUserCodeIds.add(id);
            }
        } catch { /* objectql not ready — leave snapshot empty */ }
    };

    /**
     * Pull a userId out of the request's better-auth session, if any.
     * Returns null when there is no signed-in user. v1 does not check
     * admin role — UI gating + the auth requirement is sufficient for
     * dev / single-tenant runtimes. Stricter checks can be layered on
     * via a middleware in cloud-hosted multi-tenant deployments.
     */
    /**
     * POST /api/v1/marketplace/install-local/:manifestId/reseed-sample-data
     *
     * Re-runs SeedLoaderService against the cached manifest's `data` arrays.
     * Idempotent (upsert by id). Useful when:
     *   • The user installed an app and skipped sample data
     *   • A purge was undone
     *   • The user wants a clean baseline back after editing demo rows
     *
     * Multi-tenant: requires an active organization on the session (same
     * rule as install seed path).
     */
    private handleReseed = async (c: any, ctx: PluginContext): Promise<Response> => {
        const userId = await this.requireAuthenticatedUser(c, ctx);
        if (!userId) {
            return c.json({ success: false, error: { code: 'unauthorized', message: 'Authentication required.' } }, 401);
        }
        const manifestId = String(c.req.param?.('manifestId') ?? c.req.params?.manifestId ?? '').trim();
        if (!manifestId) {
            return c.json({ success: false, error: { code: 'bad_request', message: 'manifestId path param required.' } }, 400);
        }
        if (!this.ledger.has(manifestId)) {
            return c.json({ success: false, error: { code: 'not_found', message: `No marketplace install for ${manifestId}.` } }, 404);
        }
        const entry: InstalledEntry | null = this.ledger.read(manifestId);
        if (!entry) {
            return c.json({ success: false, error: { code: 'storage_failed', message: 'Failed to read manifest cache.' } }, 500);
        }

        const summary = await this.applySideEffects(ctx, entry.manifest, { seedNow: true, c });
        if (summary.seeded.mode === 'skipped') {
            return c.json({
                success: false,
                error: {
                    code: 'reseed_skipped',
                    message: `Reseed did not run: ${summary.seeded.reason ?? 'unknown reason'}`,
                },
            }, 400);
        }

        const inserted = summary.seeded.inserted ?? 0;
        const updated = summary.seeded.updated ?? 0;
        const errors = summary.seeded.errors ?? 0;
        const wrote = inserted + updated > 0;

        // HONEST RESULT: the loader runs row-by-row and counts write failures
        // (locked DB, missing table, validation reject) into `errors` rather
        // than throwing. Previously this handler returned success — and flipped
        // `withSampleData` to true — even when every row failed, so the UI said
        // "done" while the database stayed empty. Treat a run that landed no
        // rows as a failure and report why.
        if (!wrote) {
            return c.json({
                success: false,
                error: {
                    code: 'reseed_no_rows',
                    message: errors > 0
                        ? `Reseed wrote no rows (${errors} error${errors === 1 ? '' : 's'}).${summary.seeded.errorSample ? ` First error: ${summary.seeded.errorSample}` : ''}`
                        : 'Reseed wrote no rows. The package declares no seedable records for this runtime.',
                    details: { inserted, updated, errors },
                },
            }, 422);
        }

        // Only mark the install as carrying sample data once rows actually landed.
        try {
            entry.withSampleData = true;
            this.ledger.write(entry);
        } catch { /* non-fatal */ }

        return c.json({
            success: true,
            data: {
                manifestId,
                inserted,
                updated,
                errors,
                withSampleData: true,
            },
        }, 200);
    };

    /**
     * POST /api/v1/marketplace/install-local/:manifestId/purge-sample-data
     *
     * Deletes every record whose id is declared in the cached manifest's
     * seed datasets. Uses the `driver` service directly to bypass ACL /
     * lifecycle hooks (same pattern as cloud purge). User-created records
     * are never touched — only ids declared in the package's bundled
     * datasets are removed. Already-deleted rows count as `skipped`.
     */
    private handlePurge = async (c: any, ctx: PluginContext): Promise<Response> => {
        const userId = await this.requireAuthenticatedUser(c, ctx);
        if (!userId) {
            return c.json({ success: false, error: { code: 'unauthorized', message: 'Authentication required.' } }, 401);
        }
        const manifestId = String(c.req.param?.('manifestId') ?? c.req.params?.manifestId ?? '').trim();
        if (!manifestId) {
            return c.json({ success: false, error: { code: 'bad_request', message: 'manifestId path param required.' } }, 400);
        }
        if (!this.ledger.has(manifestId)) {
            return c.json({ success: false, error: { code: 'not_found', message: `No marketplace install for ${manifestId}.` } }, 404);
        }
        const entry: InstalledEntry | null = this.ledger.read(manifestId);
        if (!entry) {
            return c.json({ success: false, error: { code: 'storage_failed', message: 'Failed to read manifest cache.' } }, 500);
        }

        const datasets = Array.isArray(entry.manifest?.data)
            ? entry.manifest.data.filter((d: any) => d && d.object && Array.isArray(d.records))
            : [];

        if (datasets.length === 0) {
            return c.json({
                success: false,
                error: { code: 'nothing_to_purge', message: 'This package declares no seed datasets.' },
            }, 400);
        }

        let driver: any;
        try { driver = ctx.getService('driver'); } catch { /* none */ }
        if (!driver || typeof driver.delete !== 'function') {
            return c.json({
                success: false,
                error: { code: 'driver_missing', message: 'driver service unavailable — cannot purge.' },
            }, 500);
        }

        let deleted = 0;
        let skipped = 0;
        let errors = 0;
        for (const ds of datasets) {
            const object = String(ds.object);
            for (const rec of ds.records as any[]) {
                const id = rec?.id;
                if (id === undefined || id === null || id === '') { skipped++; continue; }
                try {
                    const r = await driver.delete(object, id);
                    if (r === false || r === 0 || r?.deleted === 0) skipped++;
                    else deleted++;
                } catch (err: any) {
                    // Treat "not found" as skipped; anything else as error.
                    const msg = String(err?.message ?? err);
                    if (/not.?found|no row/i.test(msg)) skipped++;
                    else { errors++; ctx.logger?.warn?.(`[MarketplaceInstallLocal] purge ${object}#${id}: ${msg}`); }
                }
            }
        }

        // Flip flag so UI reflects the empty baseline
        try {
            entry.withSampleData = false;
            this.ledger.write(entry);
        } catch { /* non-fatal */ }

        ctx.logger?.info?.(`[MarketplaceInstallLocal] purged ${manifestId}: deleted=${deleted} skipped=${skipped} errors=${errors}`);
        return c.json({
            success: true,
            data: { manifestId, deleted, skipped, errors, withSampleData: false },
        }, 200);
    };

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
    ): Promise<{ translationsLoaded: number; seeded: { mode: 'inline' | 'replayer' | 'skipped'; inserted?: number; updated?: number; errors?: number; reason?: string; errorSample?: string } }> => {
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
            const multiTenant = resolveMultiOrgEnabled();
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
                            import('@objectstack/runtime'),
                            import('@objectstack/spec/data'),
                        ]);
                        const seedLoader = new (SeedLoaderService as any)(ql, metadata, ctx.logger);
                        const request = (SeedLoaderRequestSchema as any).parse({
                            // ADR-0036 / seed rename: the field is `seeds` (was `datasets`).
                            seeds: datasets,
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
                            // Surface the first write/resolution failure so the
                            // caller can report WHY nothing landed (e.g. a locked
                            // DB, a missing table, a failed validation) instead of
                            // a bare "0 rows".
                            errorSample: result.errors[0]?.message,
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

    private readAll = (): InstalledEntry[] => this.ledger.list();
}
