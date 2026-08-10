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
import {
    resolveTenancyPosture,
    collectGlobalUniques,
    unconfirmedGlobalUniques,
    recordGlobalUniqueAttestation,
    buildGlobalUniqueStopMessage,
    describeGlobalUniqueFinding,
    postureGatesGlobalUniques,
    GLOBAL_UNIQUE_CONFIRMATION_REQUIRED,
    type GlobalUniqueFinding,
} from '@objectstack/types';
import { postureEnforcesWall, type TenancyPosture } from '@objectstack/spec/security';
import { resolveCloudUrl } from './cloud-url.js';
import { resolveMarketplacePublicBaseUrl } from './marketplace-public-url.js';
import { join } from 'node:path';

import {
    LocalManifestSource,
    type InstalledManifestEntry,
    type InstalledManifestListing,
    type SkippedManifestEntry,
} from './local-manifest-source.js';
import { ConnectionCredentialStore } from './connection-credential-store.js';
import { MARKETPLACE_INSTALLED_UI_BUNDLE } from './marketplace-ui.js';
import type { IHttpServer } from '@objectstack/spec/contracts';

const ROUTE_BASE = '/api/v1/marketplace/install-local';

/**
 * A ledger read failure in the thrower's own words (#5413 / #5426).
 *
 * The `cause` travels from `LocalManifestSource` unwrapped precisely so it can
 * be quoted here rather than replaced by a summary. `.message` first because
 * that is the operational sentence (`EACCES: permission denied, open '…'`);
 * `.name` only when a thrower left the message empty, which is still better
 * than the empty string.
 */
function describeLedgerCause(cause: unknown): string {
    return cause instanceof Error ? (cause.message || cause.name) : String(cause);
}

/** Best-effort manifest id from a registry package entry (shape varies). */
function manifestIdOf(p: any): string | undefined {
    return p?.manifest?.id ?? p?.id ?? p?.manifest?.name ?? undefined;
}

/**
 * [ADR-0093 D4/D5, ADR-0105 D1 / #5262] Is an organization wall actually IN
 * FORCE for this boot? Both seeding decisions in this plugin key off it.
 *
 * ⛔ Never `resolveMultiOrgEnabled()`. ADR-0105 D1 demoted that boolean to a
 * back-compat INPUT of `resolveTenancyPosture()`, so it reads `false` on a
 * deployment configured the documented way (`OS_TENANCY_POSTURE=isolated|group`,
 * legacy boolean unset) — and a marketplace install on such a deployment wrote
 * its sample rows with NO `organization_id` at all, landing them outside the
 * wall every subsequent read applies. Same shape as cloud#1020 and #5233.
 *
 * EFFECTIVE, not requested. Both call sites ask "is the per-org replay going to
 * own this seeding instead of me?", and that replay is the enterprise
 * `@objectstack/organizations` middleware on `sys_organization` insert. On a
 * DEGRADED boot that middleware is absent, so deferring to it would strand the
 * data permanently; the `tenancy` service reports the posture in force
 * (`single` there), which correctly hands the work back to the inline path.
 *
 * Falls back to the requested posture when no `tenancy` service is registered
 * (a lean embedding without plugin-auth). Read live — never cached.
 */
function organizationWallActive(ctx: PluginContext): boolean {
    try {
        const tenancy = ctx.getService?.('tenancy') as { posture?: TenancyPosture } | undefined;
        if (tenancy?.posture) return postureEnforcesWall(tenancy.posture);
    } catch {
        /* no `tenancy` service registered — fall through */
    }
    return postureEnforcesWall(resolveTenancyPosture());
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
            // [#4251] Read canonical-first with a REAL per-name fallback:
            // `getService` THROWS for an empty slot, so a single try around
            // `canonical ?? alias` never reaches the alias — the shape the old
            // alias-first read had too, meaning its fallback never once fired.
            const readServer = (name: string): IHttpServer | undefined => {
                try { return ctx.getService<IHttpServer>(name); } catch { return undefined; }
            };
            // Canonical first — see marketplace-proxy-plugin.
            const httpServer = readServer('http.server') ?? readServer('http-server');
            if (!httpServer) {
                ctx.logger?.warn?.('[MarketplaceInstallLocal] http-server not available — install endpoints not mounted');
                return;
            }
            if (typeof httpServer.getRawApp !== 'function') {
                ctx.logger?.warn?.('[MarketplaceInstallLocal] http-server missing getRawApp() — install endpoints not mounted');
                return;
            }
            const rawApp = httpServer.getRawApp();

            const postHandler = async (c: any) => this.handleInstall(c, ctx);
            const getHandler = async (c: any) => this.handleList(c, ctx);
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
        const { entries, skipped } = this.readAll();

        // #5413 — BEFORE the early return, not after. A ledger whose entries
        // are ALL corrupt is the worst case of this bug, not an exempt one:
        // every installed app silently missing from the runtime, and an
        // `entries.length === 0` return above this loop would be the one path
        // that still said nothing at all.
        this.warnSkippedLedgerEntries(ctx, skipped, 'that installed app is NOT registered in this runtime');

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
                // …EXCEPT when the database no longer has them: the ledger is
                // anchored to <cwd> while the database can be swapped out from
                // under it (`os dev --fresh`, a deleted dev.db, a --database
                // switch). Config-declared apps re-seed on every single-tenant
                // boot via AppPlugin, but a rehydrated marketplace package
                // would stay empty forever — app visible, tables created,
                // zero rows. Heal that case.
                await this.maybeHealSampleData(ctx, entry);
                ctx.logger?.info?.(`[MarketplaceInstallLocal] rehydrated ${entry.manifestId}@${entry.version}`);
            } catch (err: any) {
                ctx.logger?.error?.(`[MarketplaceInstallLocal] rehydrate failed for ${entry.manifestId}`, err instanceof Error ? err : new Error(String(err)));
            }
        }
    };

    /**
     * Rehydrate-time sample-data healing (the "installed app, empty database"
     * repair). Runs the bundled seed datasets iff:
     *
     *   • the cached manifest actually bundles seed datasets, AND
     *   • the user never explicitly purged them (`sampleDataPurged`), AND
     *   • single-tenant mode (multi-tenant seeding is owned by the per-org
     *     replay on sys_organization insert — the datasets were already merged
     *     into the kernel's `seed-datasets` service by applySideEffects), AND
     *   • EVERY seeded object is empty. One surviving row anywhere means the
     *     install-time rows (or the user's own data) are still present, and
     *     re-upserting would silently revert user edits on every boot.
     *
     * Never throws — a failed heal logs and leaves the boot untouched.
     */
    private maybeHealSampleData = async (ctx: PluginContext, entry: InstalledEntry): Promise<void> => {
        const datasets = Array.isArray(entry.manifest?.data)
            ? entry.manifest.data.filter((d: any) => d && d.object && Array.isArray(d.records))
            : [];
        if (datasets.length === 0) return;
        if (entry.sampleDataPurged === true) return;
        if (organizationWallActive(ctx)) {
            ctx.logger?.info?.(`[MarketplaceInstallLocal] organization wall active — sample-data heal for ${entry.manifestId} left to per-org replay`);
            return;
        }

        let ql: any;
        try { ql = ctx.getService('objectql'); } catch { return; }
        if (!ql || typeof ql.find !== 'function') return;

        // Emptiness probe: any row in any seeded object → nothing to heal.
        const objects = [...new Set(datasets.map((d: any) => String(d.object)))];
        for (const object of objects) {
            try {
                const rows = await ql.find(object, { limit: 1, context: { isSystem: true } } as any);
                const first = Array.isArray(rows) ? rows[0] : rows?.items?.[0];
                if (first !== undefined && first !== null) return;
            } catch { /* unknown/missing table reads as empty — keep probing */ }
        }

        try {
            const summary = await this.runInlineSeed(ctx, datasets);
            const landed = (summary.inserted ?? 0) + (summary.updated ?? 0);
            if (landed > 0) {
                entry.withSampleData = true;
                entry.sampleDataPurged = false;
                try { this.ledger.write(entry); } catch { /* non-fatal */ }
                ctx.logger?.info?.(`[MarketplaceInstallLocal] healed sample data for ${entry.manifestId}: inserted=${summary.inserted} updated=${summary.updated} errors=${summary.errors}`);
                // #3430: surface the fresh-DB self-heal in the boot banner — the
                // info line above is swallowed by the default warn level, so this
                // was previously only confirmable by querying the database.
                await this.recordSeedSummary(ctx, {
                    source: entry.manifestId,
                    marketplace: true,
                    inserted: summary.inserted ?? 0,
                    updated: summary.updated ?? 0,
                    skipped: summary.skipped ?? 0,
                    rejected: summary.errors ?? 0,
                    droppedRefs: summary.droppedRefs ?? 0,
                    healed: true,
                });
            } else {
                ctx.logger?.warn?.(`[MarketplaceInstallLocal] sample-data heal for ${entry.manifestId} landed no rows${summary.errorSample ? ` — first error: ${summary.errorSample}` : ''}`);
                // Installed package, seed datasets declared, yet 0 rows landed —
                // the "app in the switcher, every KPI 0" case. Escalate it in the
                // banner (emptyInstall ⇒ ⚠) rather than let it pass silently.
                await this.recordSeedSummary(ctx, {
                    source: entry.manifestId,
                    marketplace: true,
                    inserted: 0,
                    updated: 0,
                    skipped: 0,
                    rejected: summary.errors ?? 0,
                    emptyInstall: true,
                });
            }
        } catch (err: any) {
            ctx.logger?.warn?.(`[MarketplaceInstallLocal] sample-data heal failed for ${entry.manifestId}: ${err?.message ?? err}`);
            await this.recordSeedSummary(ctx, {
                source: entry.manifestId,
                marketplace: true,
                inserted: 0,
                updated: 0,
                skipped: 0,
                rejected: 0,
                emptyInstall: true,
            });
        }
    };

    /**
     * Append a per-source outcome onto the kernel's `seed-summary` service so
     * the CLI boot banner can print it (#3430). Resolved lazily through the
     * runtime's shared writer contract; guarded so a runtime that predates the
     * helper — or a test that mocks `@objectstack/runtime` without it — simply
     * skips the banner line instead of crashing the heal path.
     */
    private recordSeedSummary = async (
        ctx: PluginContext,
        outcome: {
            source: string;
            marketplace?: boolean;
            inserted: number;
            updated: number;
            skipped: number;
            rejected: number;
            droppedRefs?: number;
            healed?: boolean;
            emptyInstall?: boolean;
        },
    ): Promise<void> => {
        try {
            const mod: any = await import('@objectstack/runtime');
            if (typeof mod?.recordSeedOutcome === 'function') mod.recordSeedOutcome(ctx, outcome);
        } catch { /* banner summary is best-effort — never break the heal */ }
    };

    /**
     * Merge `datasets` onto the SHARED `seed-datasets` service via the runtime's
     * register-once-then-mutate helper (#3453), so THIS package's seeds accumulate
     * alongside every config app's and every other package's rather than clobbering
     * them — the per-org replayer (AppPlugin) replays the whole union on the next
     * `sys_organization` insert. Resolved lazily through `@objectstack/runtime` and
     * guarded exactly like {@link recordSeedSummary}: a runtime that predates the
     * helper — or a test that mocks the module without it — falls back to an
     * equivalent inline merge. Returns the post-merge total for the log line.
     */
    private mergeSeedDatasetsIntoKernel = async (ctx: PluginContext, datasets: any[]): Promise<number> => {
        try {
            const mod: any = await import('@objectstack/runtime');
            if (typeof mod?.mergeSeedDatasets === 'function') {
                const list = mod.mergeSeedDatasets(ctx, datasets);
                return Array.isArray(list) ? list.length : datasets.length;
            }
        } catch { /* fall through to the inline merge below */ }
        return this.mergeSeedDatasetsInline(ctx, datasets);
    };

    /**
     * Fallback for {@link mergeSeedDatasetsIntoKernel} when the runtime helper is
     * unavailable (older build / mocked module). Same register-once-then-mutate:
     * read the live list through the context's OWN resolver first — a standard
     * PluginContext has no `.kernel`, which is precisely why the old
     * `(ctx as any).kernel` read clobbered instead of accumulating — push in place,
     * and register only when the service does not yet exist so a second source
     * cannot trip the duplicate-register throw. Returns the post-merge total.
     */
    private mergeSeedDatasetsInline = (ctx: PluginContext, datasets: any[]): number => {
        const c = ctx as any;
        const read = (): any[] | undefined => {
            if (typeof c?.getService === 'function') {
                try { const v = c.getService('seed-datasets'); if (Array.isArray(v)) return v; } catch { /* absent */ }
            }
            if (typeof c?.kernel?.getService === 'function') {
                try { const v = c.kernel.getService('seed-datasets'); if (Array.isArray(v)) return v; } catch { /* absent */ }
            }
            return undefined;
        };
        const current = read();
        const list: any[] = Array.isArray(current) ? current : [];
        list.push(...datasets);
        if (!Array.isArray(current)) {
            if (typeof c?.kernel?.registerService === 'function') c.kernel.registerService('seed-datasets', list);
            else if (typeof c?.registerService === 'function') c.registerService('seed-datasets', list);
        }
        return list.length;
    };

    private handleInstall = async (c: any, ctx: PluginContext): Promise<Response> => {
        const userId = await this.requireAuthenticatedUser(c, ctx);
        if (!userId) {
            return c.json({ success: false, error: { code: 'UNAUTHENTICATED', message: 'Authentication required to install packages.' } }, 401);
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
                return c.json({ success: false, error: { code: 'PLUGIN_MANIFEST_INVALID', message: 'Inline manifest must have an "id" or "name".' } }, 400);
            }
        } else {
            if (!this.cloudUrl) {
                return c.json({ success: false, error: { code: 'MARKETPLACE_UNAVAILABLE', message: 'OS_CLOUD_URL not configured.' } }, 503);
            }
            packageId = String(body?.packageId ?? '').trim();
            const versionId = String(body?.versionId ?? 'latest').trim() || 'latest';
            if (!packageId) {
                return c.json({ success: false, error: { code: 'INVALID_REQUEST', message: 'packageId is required.' } }, 400);
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
                        error: { code: 'CLOUD_FETCH_FAILED', message: err?.message ?? String(err) },
                    }, 502);
                }
            }
            if (!payload) {
                return c.json({
                    success: false,
                    error: { code: 'CLOUD_FETCH_FAILED', message: `Cloud returned ${lastErrStatus}: ${lastErrText}` },
                }, lastErrStatus === 404 ? 404 : 502);
            }

            const data = payload?.data ?? payload;
            manifest = normalizeBundle(data?.manifest);
            resolvedVersionId = String(data?.version_id ?? versionId);
            version = String(data?.version ?? 'unknown');
        }

        const manifestId = String(manifest?.id ?? manifest?.name ?? '');
        if (!manifest || !manifestId) {
            return c.json({ success: false, error: { code: 'PLUGIN_MANIFEST_INVALID', message: 'Invalid manifest payload.' } }, inlineManifest ? 400 : 502);
        }

        // 2. Conflict check — refuse to overwrite user-authored apps
        const conflict = this.findConflict(ctx, manifestId);
        if (conflict === 'user-code') {
            return c.json({
                success: false,
                error: {
                    code: 'MANIFEST_CONFLICT',
                    message: `manifest_id "${manifestId}" is already defined by this runtime's local code. Refusing to overwrite. Uninstall the local definition first.`,
                },
            }, 409);
        }

        // 2b. [ADR-0120 D5e] `isolated`-posture gate on installation-wide
        //     uniques. Runs BEFORE hot-register and before anything is written
        //     to the ledger: a stopped install must leave the runtime exactly as
        //     it found it, so the installer can rewrite the metadata and retry
        //     without an uninstall in between.
        //
        //     #5426 — `.entry` alone, on purpose. A ledger file that will not
        //     parse is treated here exactly as "no previous attestation", so a
        //     corrupt entry makes the gate ASK AGAIN rather than skip: the
        //     fail-safe direction (worst case, a one-time ceremony is repeated;
        //     the case that must never happen — an installation-wide unique
        //     going unconfirmed because its record was unreadable — cannot).
        //     Conflating the two nulls is the right call at THIS call site; it
        //     is now made here, in the open, instead of by the ledger for
        //     everyone.
        const previousEntry = this.ledger.read(manifestId).entry;
        const gate = this.evaluateGlobalUniqueGate(manifest, previousEntry, body, userId);
        if (gate.blocked) {
            ctx.logger?.warn?.(
                `[MarketplaceInstallLocal] install of ${manifestId} stopped by the ADR-0120 D5e posture gate ` +
                `(${gate.pending.length} unconfirmed installation-wide unique(s))`,
            );
            return c.json({
                success: false,
                error: {
                    code: GLOBAL_UNIQUE_CONFIRMATION_REQUIRED,
                    message: buildGlobalUniqueStopMessage(manifestId, gate.pending),
                    // Machine-readable so an AI installer can decide per index
                    // instead of re-parsing the prose it was handed.
                    details: {
                        posture: gate.posture,
                        findings: gate.pending.map((f) => ({
                            id: f.id,
                            object: f.object,
                            kind: f.kind,
                            ...(f.name ? { name: f.name } : {}),
                            columns: f.columns,
                            spelling: f.spelling,
                            describe: describeGlobalUniqueFinding(f),
                        })),
                        confirmWith: {
                            body: { confirmGlobalUniques: gate.pending.map((f) => f.id) },
                            cli: 'os package install … --confirm-global-uniques',
                        },
                    },
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
                    error: { code: 'PLUGIN_REGISTER_FAILED', message: `Failed to register imported manifest: ${err?.message ?? err}` },
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
            // [ADR-0120 D5e] Carry the attestation across the reinstall so the
            // ceremony is not re-run for constraints already answered for, and
            // fold in whatever this install confirmed.
            ...(gate.attestation ? { globalUniqueAttestation: gate.attestation } : {}),
        };
        try {
            this.ledger.write(entry);
        } catch (err: any) {
            return c.json({
                success: false,
                error: { code: 'MARKETPLACE_STORAGE_FAILED', message: `Failed to persist manifest: ${err?.message ?? err}` },
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
        // `skipped` counts too: an all-skip run means the rows are ALREADY in
        // the database (e.g. a reinstall/upgrade over live sample data) — the
        // install carries sample data either way. Leaving the flag false here
        // is what made older ledgers claim "no sample data" over a seeded DB.
        const seededRows = (seededSummary.seeded.inserted ?? 0) + (seededSummary.seeded.updated ?? 0) + (seededSummary.seeded.skipped ?? 0);
        if (seededSummary.seeded.mode === 'inline' && seededRows > 0) {
            entry.withSampleData = true;
            entry.sampleDataPurged = false;
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
                // #6721: the RESOLVED ledger directory on THIS host — the same
                // value the GET listing serves (`handleList`), from the same
                // field. It is here because the installer is remote: `os package
                // install` never touches this machine's disk, so without it the
                // CLI can only describe the directory by literal, and that
                // literal is wrong the moment a host configures `storageDir`.
                // Keep the two endpoints reading `this.storageDir` — a second
                // derivation is how they diverged in the first place.
                storageDir: this.storageDir,
                note: 'App is now available in this runtime. Refresh the console to see it in the app switcher.',
            },
        }, 200);
    };

    /**
     * `GET /…/installed` — the console's "Installed Apps" list.
     *
     * #5413: the WIRE SHAPE is deliberately unchanged. A corrupt ledger entry
     * is reported to the operator's log, not to the HTTP client — putting it in
     * the response body is a separate decision about this endpoint's schema and
     * is explicitly NOT made here. What the fix removes is the case where a
     * short list was served with `success: true` and nobody, anywhere, could
     * have known.
     */
    private handleList = async (c: any, ctx: PluginContext): Promise<Response> => {
        const { entries, skipped } = this.readAll();
        this.warnSkippedLedgerEntries(ctx, skipped, 'it is MISSING from the installed-apps list served to the console');
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
            return c.json({ success: false, error: { code: 'UNAUTHENTICATED', message: 'Authentication required.' } }, 401);
        }
        const manifestId = String(c.req.param?.('manifestId') ?? c.req.params?.manifestId ?? '').trim();
        if (!manifestId) {
            return c.json({ success: false, error: { code: 'INVALID_REQUEST', message: 'manifestId path param required.' } }, 400);
        }
        if (!this.ledger.has(manifestId)) {
            return c.json({ success: false, error: { code: 'RESOURCE_NOT_FOUND', message: `No marketplace install for ${manifestId}.` } }, 404);
        }
        try {
            this.ledger.remove(manifestId);
        } catch (err: any) {
            return c.json({ success: false, error: { code: 'MARKETPLACE_STORAGE_FAILED', message: err?.message ?? String(err) } }, 500);
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
     * [ADR-0120 D5e] Decide whether this install must stop for the
     * `isolated`-posture confirmation, and what attestation the ledger entry
     * should carry afterwards.
     *
     * The three outcomes, in the order they are checked:
     *
     * 1. **Not `isolated`** — no findings are decision points at all. Under
     *    `single` there is one customer; under `group` the installation IS the
     *    customer company, which is exactly what `'global'` means there. The
     *    previous attestation (if any) is carried through untouched rather than
     *    dropped: a posture may flip back, and a confirmation already given is
     *    still a fact about the posture it was given under.
     * 2. **Every finding already answered for** — proceed silently. This is the
     *    "之后不复问" half of the decision, and it is why the record lives in the
     *    durable ledger rather than in memory.
     * 3. **Something unanswered** — stop, unless THIS request confirms it.
     *
     * Whatever this returns as `attestation` is written into the install
     * manifest in ADR-0104 attestation style — the fact affirmed, by whom, when,
     * and under which posture — so the ceremony is evidence, not a dismissed
     * prompt.
     *
     * `confirmGlobalUniques` accepts either `true` (confirm everything the gate
     * lists, the shape a CLI `--confirm-global-uniques` produces) or an explicit
     * array of finding ids. The array form is the per-index ceremony the ADR
     * asks for: confirming two of three constraints still stops on the third,
     * so an installer cannot blanket-approve a list it did not read by echoing
     * back one id.
     */
    private evaluateGlobalUniqueGate = (
        manifest: any,
        previous: InstalledEntry | null,
        body: any,
        installerId: string | null,
    ): {
        blocked: boolean;
        posture: string;
        pending: GlobalUniqueFinding[];
        attestation?: InstalledEntry['globalUniqueAttestation'];
    } => {
        const posture = resolveTenancyPosture();
        const carried = previous?.globalUniqueAttestation;
        if (!postureGatesGlobalUniques(posture)) {
            return { blocked: false, posture, pending: [], ...(carried ? { attestation: carried } : {}) };
        }

        const findings = collectGlobalUniques(manifest?.objects);
        const pending = unconfirmedGlobalUniques(findings, carried, posture);
        if (pending.length === 0) {
            return { blocked: false, posture, pending: [], ...(carried ? { attestation: carried } : {}) };
        }

        const raw = body?.confirmGlobalUniques;
        const confirmedIds =
            raw === true
                ? pending.map((f) => f.id)
                : Array.isArray(raw)
                  ? pending.filter((f) => raw.includes(f.id)).map((f) => f.id)
                  : [];
        const stillPending = pending.filter((f) => !confirmedIds.includes(f.id));
        if (stillPending.length > 0) {
            return { blocked: true, posture, pending: stillPending };
        }

        return {
            blocked: false,
            posture,
            pending: [],
            attestation: recordGlobalUniqueAttestation(carried, confirmedIds, posture, installerId),
        };
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
            return c.json({ success: false, error: { code: 'UNAUTHENTICATED', message: 'Authentication required.' } }, 401);
        }
        const manifestId = String(c.req.param?.('manifestId') ?? c.req.params?.manifestId ?? '').trim();
        if (!manifestId) {
            return c.json({ success: false, error: { code: 'INVALID_REQUEST', message: 'manifestId path param required.' } }, 400);
        }
        if (!this.ledger.has(manifestId)) {
            return c.json({ success: false, error: { code: 'RESOURCE_NOT_FOUND', message: `No marketplace install for ${manifestId}.` } }, 404);
        }
        // #5426 — `has()` above already answered "is it installed", so reaching
        // this with no entry means the file is THERE and unreadable. The reason
        // travels to the operator instead of dying in a `catch`.
        const { entry, failure } = this.ledger.read(manifestId);
        if (!entry) {
            return this.unreadableLedgerEntry(c, ctx, manifestId, failure, 'reseed sample data');
        }

        const summary = await this.applySideEffects(ctx, entry.manifest, { seedNow: true, c });
        if (summary.seeded.mode === 'skipped') {
            return c.json({
                success: false,
                error: {
                    code: 'RESEED_SKIPPED',
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
                    code: 'RESEED_NO_ROWS',
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
            entry.sampleDataPurged = false;
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
            return c.json({ success: false, error: { code: 'UNAUTHENTICATED', message: 'Authentication required.' } }, 401);
        }
        const manifestId = String(c.req.param?.('manifestId') ?? c.req.params?.manifestId ?? '').trim();
        if (!manifestId) {
            return c.json({ success: false, error: { code: 'INVALID_REQUEST', message: 'manifestId path param required.' } }, 400);
        }
        if (!this.ledger.has(manifestId)) {
            return c.json({ success: false, error: { code: 'RESOURCE_NOT_FOUND', message: `No marketplace install for ${manifestId}.` } }, 404);
        }
        // #5426 — same shape as reseed: `has()` said the file is there, so a
        // missing entry here is an unreadable one, and the operator gets the
        // reason rather than a sentence that points at itself.
        const { entry, failure } = this.ledger.read(manifestId);
        if (!entry) {
            return this.unreadableLedgerEntry(c, ctx, manifestId, failure, 'purge sample data');
        }

        const datasets = Array.isArray(entry.manifest?.data)
            ? entry.manifest.data.filter((d: any) => d && d.object && Array.isArray(d.records))
            : [];

        if (datasets.length === 0) {
            return c.json({
                success: false,
                error: { code: 'NOTHING_TO_PURGE', message: 'This package declares no seed datasets.' },
            }, 400);
        }

        let driver: any;
        try { driver = ctx.getService('driver'); } catch { /* none */ }
        if (!driver || typeof driver.delete !== 'function') {
            return c.json({
                success: false,
                error: { code: 'DRIVER_UNAVAILABLE', message: 'driver service unavailable — cannot purge.' },
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

        // Flip flag so UI reflects the empty baseline. `sampleDataPurged`
        // additionally tells the rehydrate-time healer this emptiness is
        // deliberate — demo rows must not come back on the next restart.
        try {
            entry.withSampleData = false;
            entry.sampleDataPurged = true;
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
    ): Promise<{ translationsLoaded: number; seeded: { mode: 'inline' | 'replayer' | 'skipped'; inserted?: number; updated?: number; skipped?: number; errors?: number; reason?: string; errorSample?: string } }> => {
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
                const total = await this.mergeSeedDatasetsIntoKernel(ctx, datasets);
                ctx.logger?.info?.(`[MarketplaceInstallLocal] merged ${datasets.length} seed dataset(s) into kernel (total: ${total})`);
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
            // See `organizationWallActive` — the wall in FORCE, not the demoted
            // boolean. This one is the write path: judged wrong, the install's
            // rows are inserted with no `organization_id` on a walled
            // deployment, i.e. behind the wall and unreadable by every caller
            // the wall applies to (#5262).
            const multiTenant = organizationWallActive(ctx);
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
                        const s = await this.runInlineSeed(ctx, datasets, organizationId);
                        seedSummary = { mode: 'inline', ...s };
                        ctx.logger?.info?.(`[MarketplaceInstallLocal] inline seed for ${appId}${organizationId ? ` (org=${organizationId})` : ''}: inserted=${s.inserted} updated=${s.updated} skipped=${s.skipped} errors=${s.errors}`);
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
     * One SeedLoaderService run over `datasets` (upsert, multi-pass) — the
     * shared engine behind install-time seeding, the reseed endpoint and the
     * rehydrate-time healer. Throws when objectql/metadata are unavailable;
     * per-row write failures are counted into `errors`, not thrown.
     */
    private runInlineSeed = async (
        ctx: PluginContext,
        datasets: any[],
        organizationId?: string,
    ): Promise<{ inserted: number; updated: number; skipped: number; errors: number; droppedRefs: number; errorSample?: string }> => {
        const ql: any = ctx.getService('objectql');
        let metadata: any;
        try { metadata = ctx.getService('metadata'); } catch { /* none */ }
        if (!ql || !metadata) throw new Error('objectql-or-metadata-missing');

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
        return {
            inserted: result.summary.totalInserted,
            updated: result.summary.totalUpdated,
            skipped: result.summary.totalSkipped ?? 0,
            errors: result.errors.length,
            // Reference fields dropped from rows that WERE written (#3932) —
            // invisible in every row count, so carried explicitly.
            droppedRefs: result.summary.totalReferencesDropped ?? 0,
            // Surface the first write/resolution failure so the caller can
            // report WHY nothing landed (e.g. a locked DB, a missing table,
            // a failed validation) instead of a bare "0 rows".
            errorSample: result.errors[0]?.message,
        };
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

    /**
     * Read the whole ledger — the entries it parsed AND the files it could not
     * (#5413).
     *
     * Returns the listing rather than unwrapping `.entries` here on purpose: an
     * unwrap at this seam would put the silence back one layer up, where it is
     * even harder to find. Both call sites below report `skipped` before they
     * do anything with `entries`.
     */
    private readAll = (): InstalledManifestListing => this.ledger.list();

    /**
     * One line per ledger file that could not be read (#5413).
     *
     * `warn`, deliberately, and the same tier as this plugin's existing
     * "no `manifest` service — rehydrate skipped": this is a FUNCTIONAL
     * degradation, not a durability one. Nothing that claimed to persist failed
     * to land — the ledger file is still on disk, exactly as written — the
     * runtime is simply, visibly smaller than the ledger says it should be, and
     * the next person to look for the missing app finds out. (See AGENTS.md,
     * "Degradation log levels".)
     *
     * The file name and the thrower's own words are both in the line, because
     * they are the two things that turn "an app is missing" into a fix:
     * `.objectstack/installed-packages/<file>` is the thing to repair or delete.
     */
    private warnSkippedLedgerEntries = (ctx: PluginContext, skipped: SkippedManifestEntry[], what: string): void => {
        for (const { file, cause } of skipped) {
            ctx.logger?.warn?.(
                `[MarketplaceInstallLocal] unreadable ledger entry ${file} — ${what} `
                + `(repair or remove ${join(this.storageDir, file)}): ${describeLedgerCause(cause)}`,
            );
        }
    };

    /**
     * The 500 for "`has()` said the entry is there, `read()` could not turn it
     * into one" — with the reason attached (#5426).
     *
     * Shared by reseed and purge because they hit the identical wall, and both
     * used to answer `Failed to read manifest cache.`: a sentence whose only
     * content is that the thing it just did failed. The operator was left with
     * nothing to act on — not the file, not whether it was truncated, locked or
     * a directory — while the object that said all three had been dropped in an
     * un-bound `catch` one layer down.
     *
     * Deliberate choices here:
     * - **`code` is unchanged** (`MARKETPLACE_STORAGE_FAILED`). This is the same
     *   failure it always was; only its explanation is new. A client branching
     *   on the code keeps working — the fix must not cost a wire break.
     * - **The cause is quoted, not paraphrased** (#5390 house style). `EACCES`,
     *   `EISDIR` and `Unexpected end of JSON input` are three different repairs,
     *   and the thrower words each better than any sentence here could.
     * - **In the response body, not only the log.** These are operator-facing
     *   admin endpoints — the person who can fix the file is the person holding
     *   the failed response — and the server line is the durable copy for
     *   whoever reads the log later instead.
     */
    private unreadableLedgerEntry = (
        c: any,
        ctx: PluginContext,
        manifestId: string,
        failure: SkippedManifestEntry | undefined,
        attempted: string,
    ): Response => {
        // `failure === undefined` here means the file vanished (or was emptied)
        // between `has()` and `read()` — a real race, rare, and worth wording
        // honestly rather than blaming a cause we were never handed. Note it
        // names the DIRECTORY: with no failure there is no file name to quote,
        // and inventing one would be the same self-referential mistake at a
        // different address.
        const detail = failure
            ? `repair or remove ${join(this.storageDir, failure.file)}: ${describeLedgerCause(failure.cause)}`
            : `its ledger file under ${this.storageDir} no longer yields an entry `
              + `(removed or emptied between the existence check and the read)`;

        ctx.logger?.warn?.(
            `[MarketplaceInstallLocal] cannot ${attempted} for ${manifestId} — its ledger entry is unreadable (${detail})`,
        );

        return c.json({
            success: false,
            error: {
                code: 'MARKETPLACE_STORAGE_FAILED',
                message: `Failed to read the manifest cache entry for ${manifestId} (${detail})`,
            },
        }, 500);
    };
}
