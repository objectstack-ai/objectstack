// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { Plugin, PluginContext } from '@objectstack/core';
import { NodeMetadataManager } from './node-metadata-manager.js';
import { MemoryLoader } from './loaders/memory-loader.js';
import { DEFAULT_METADATA_TYPE_REGISTRY } from '@objectstack/spec/kernel';
import type { MetadataPluginConfig } from '@objectstack/spec/kernel';
import { applyProtection } from '@objectstack/spec/shared';
import {
    SysMetadataObject,
    SysMetadataHistoryObject,
    SysMetadataAuditObject,
    SysViewDefinitionObject,
} from '@objectstack/metadata-core';

// `SysMetadataObject` + `SysMetadataHistoryObject` are the customer overlay
// storage substrate (ADR-0005). They must always be auto-provisioned so
// `PUT /api/v1/meta/{view,dashboard}/...` has a place to write. All other
// metadata types (object/view/flow/agent/tool/dashboard/app/...) live as
// JSON inside `sys_metadata` — there are no separate per-type tables. The
// previously shipped `SysObject` / `SysView` / `SysFlow` / `SysAgent` /
// `SysTool` projection objects were removed in 2026-05 (see ADR 0005
// addendum); the projection pipeline was removed at the same time.
//
// `SysMetadataAuditObject` (ADR-0010) is the append-only audit trail for
// metadata write decisions — provisioned alongside the storage tables so
// `_lock` enforcement always has a place to record decisions, even when
// the deployment skipped @objectstack/plugin-audit.
const queryableMetadataObjects = [
    SysMetadataObject,
    SysMetadataHistoryObject,
    SysMetadataAuditObject,
    // Runtime view storage (shared / personal). Must always be provisioned so
    // end-user view creation via the generic data API has a place to write —
    // mirroring why sys_metadata is always provisioned for PUT /meta.
    SysViewDefinitionObject,
];

// Subdirectory under `rootDir` reserved for the ADR-0008 repository's
// canonical JSON storage + JSONL change log. Kept separate from user
// source code (which the legacy FilesystemLoader still scans).
const REPO_SUBDIR = '.objectstack/metadata';

// Map from ObjectStackDefinition field name to MetadataType name
const ARTIFACT_FIELD_TO_TYPE: Record<string, string> = {
    objects: 'object',
    objectExtensions: 'object_extension',
    apps: 'app',
    views: 'view',
    pages: 'page',
    dashboards: 'dashboard',
    reports: 'report',
    actions: 'action',
    themes: 'theme',
    workflows: 'workflow',
    flows: 'flow',
    roles: 'role',
    permissions: 'permission',
    sharingRules: 'sharing_rule',
    policies: 'policy',
    apis: 'api',
    webhooks: 'webhook',
    agents: 'agent',
    tools: 'tool',
    skills: 'skill',
    ragPipelines: 'rag_pipeline',
    hooks: 'hook',
    mappings: 'mapping',
    analyticsCubes: 'analytics_cube',
    connectors: 'connector',
    emailTemplates: 'email_template',
    docs: 'doc',
    books: 'book',
    data: 'dataset',
};

// ───────────────────────────────────────────────────────────────────────────
// View container expansion — "Object has-many View" (ADR-0017)
// ───────────────────────────────────────────────────────────────────────────
//
// `defineView({ list, form, listViews, formViews })` aggregates every view of
// an object into one document. The loader expands such a container into N
// independent ViewItems (one per named view) registered under
// `<object>.<viewKey>`, so each view is individually addressable and the
// runtime switcher can be rebuilt by querying `object`. The original container
// is ALSO kept under the bare `<object>` key for backward-compatible reads.
//
// The implementation lives in `@objectstack/spec` (`isAggregatedViewContainer`
// / `expandViewContainer`) so this HMR loader and the ObjectQL engine boot loop
// share ONE canonical expansion and can never drift. Re-exported here for the
// callers below and for `view-expand.test.ts`.
export { isAggregatedViewContainer, expandViewContainer } from '@objectstack/spec';
import { isAggregatedViewContainer, expandViewContainer } from '@objectstack/spec';

export interface MetadataPluginOptions {
    rootDir?: string;
    /**
     * When `true`, NodeMetadataManager scans `rootDir` for source-file metadata
     * (yaml/json/ts/js loaders) AND attaches a chokidar watcher to react to
     * filesystem changes. In **artifact-mode** (this is the normal path when
     * a `defineStack()` config is compiled into `dist/objectstack.json`) this
     * filesystem scan is redundant and expensive — leave `watch: false`.
     *
     * The artifact-file HMR watcher is controlled separately by
     * {@link artifactWatch} so that the cheap, single-file polling watcher
     * can be enabled in dev without paying the cost of scanning the entire
     * project root.
     *
     * Default: `false` (post PR-10e — was previously `true`).
     */
    watch?: boolean;
    /**
     * When `true` AND `artifactSource.mode === 'local-file'`, attach a
     * polling chokidar watcher to the artifact file so the server reloads
     * metadata when the CLI recompiles `dist/objectstack.json` in dev mode.
     * Independent of {@link watch} (which controls the source-file scanner).
     *
     * Default: `true` when `artifactSource` is set, otherwise `false`.
     */
    artifactWatch?: boolean;
    config?: Partial<MetadataPluginConfig>;
    /** Organization ID for metadata-scoped consumers; MetadataPlugin itself does not persist runtime metadata. */
    organizationId?: string;
    /** Project ID used by local artifact envelopes and metadata-scoped consumers. */
    environmentId?: string;
    /**
     * When set, MetadataPlugin loads metadata from an artifact instead of scanning
     * the filesystem. Only `local-file` is implemented now; `artifact-api` is
     * reserved for M3/M4.
     */
    artifactSource?:
        | { mode: 'local-file'; path: string; fetchTimeoutMs?: number }
        | { mode: 'artifact-api'; url: string; token?: string; commitId?: string; fetchTimeoutMs?: number };
    /**
     * Register the `sys_metadata` + `sys_metadata_history` storage objects
     * on this kernel. Default `true` for backward compatibility.
     *
     * Set to `false` for **per-project** kernels: in cloud / project mode the
     * control plane is the sole owner of metadata storage tables — exposing
     * them inside each project kernel would leak control-plane schema into
     * business-data namespaces.
     */
    registerSystemObjects?: boolean;
    /**
     * Owning package id for source-file metadata loaded by the filesystem
     * scanner (`watch`/eager mode) — the project's `defineStack({ manifest:
     * { id } })` id. When set, scanned items are stamped with
     * `_packageId`/`_provenance: 'package'` via `applyProtection`, exactly
     * like the artifact path, so GET /meta consumers can tell code-defined
     * metadata from user-authored rows.
     *
     * Leave unset when the host has no package identity — items then stay
     * unstamped (runtime-authored semantics). Do NOT pass a guessed value:
     * `_packageId` feeds `isArtifactBacked()` write authorization, so a
     * wrong id silently changes who may edit these items.
     */
    packageId?: string;
}

export class MetadataPlugin implements Plugin {
    name = 'com.objectstack.metadata';
    type = 'standard';
    version = '1.0.0';

    private manager: NodeMetadataManager;
    private options: MetadataPluginOptions;
    private repository?: import('@objectstack/metadata-core').MetadataRepository;
    /** Chokidar watcher on the artifact file (local-file mode) — ADR-0008 PR-8. */
    private artifactWatcher?: { close: () => Promise<void> };

    constructor(options: MetadataPluginOptions = {}) {
        this.options = {
            watch: true,
            ...options
        };

        const rootDir = this.options.rootDir || process.cwd();

        // Sealed-runtime carve-out: `bootstrap: 'artifact-only'` MUST NOT touch
        // the filesystem at all — that includes chokidar subscriptions. Force
        // watch off in that mode regardless of `options.watch`. The other two
        // modes ('eager', 'lazy') honor the user's flag; `lazy` + watch is a
        // valid combination because chokidar attaches to `rootDir` directly,
        // not as a side effect of any priming pass.
        const bootstrapMode = this.options.config?.bootstrap ?? 'eager';
        const effectiveWatch =
            bootstrapMode === 'artifact-only' ? false : (this.options.watch ?? true);

        this.manager = new NodeMetadataManager({
            rootDir,
            watch: effectiveWatch,
            formats: ['yaml', 'json', 'typescript', 'javascript']
        });

        // Initialize with default type registry
        this.manager.setTypeRegistry(DEFAULT_METADATA_TYPE_REGISTRY);
    }

    init = async (ctx: PluginContext) => {
        ctx.logger.info('Initializing Metadata Manager', {
            root: this.options.rootDir || process.cwd(),
            watch: this.options.watch,
            artifactSource: this.options.artifactSource?.mode,
        });

        // Register Metadata Manager as the primary metadata service provider.
        ctx.registerService('metadata', this.manager);
        console.log('[MetadataPlugin] Registered metadata service, has getRegisteredTypes:', typeof this.manager.getRegisteredTypes);

        // Register metadata system objects via the manifest service (if available).
        // MetadataPlugin may init before ObjectQLPlugin, so wrap in try/catch.
        // Skipped when `registerSystemObjects: false` (per-project kernels in
        // cloud / project mode — sys_* live exclusively in the control plane).
        const registerSysObjects = this.options.registerSystemObjects !== false;
        if (registerSysObjects) {
            try {
                const manifestService = ctx.getService<{ register(m: any): void }>('manifest');

                // Register the queryable metadata-layer platform objects.
                manifestService.register({
                    id: 'com.objectstack.metadata-objects',
                    name: 'Metadata Platform Objects',
                    version: '1.0.0',
                    type: 'plugin',
                    scope: 'system',
                    defaultDatasource: 'cloud',
                    objects: queryableMetadataObjects,
                });

                ctx.logger.info('Registered system metadata objects', {
                    queryable: queryableMetadataObjects.map((object) => object.name),
                });
            } catch {
                // ObjectQL not loaded yet — objects will be discovered via legacy fallback
            }
        }

        ctx.logger.info('MetadataPlugin providing metadata service (primary mode)', {
            mode: this.options.artifactSource?.mode ?? 'file-system',
            features: ['watch', 'multi-format', 'query', 'overlay', 'type-registry']
        });
    }

    start = async (ctx: PluginContext) => {
        const src = this.options.artifactSource;
        const mode = this.options.config?.bootstrap ?? 'eager';

        ctx.logger.info('[MetadataPlugin] Bootstrapping metadata', {
            bootstrap: mode,
            artifactSource: src?.mode ?? 'none',
        });

        if (mode === 'artifact-only') {
            // Sealed-runtime mode: ONLY load from a pre-compiled artifact. Never
            // touch the filesystem. Required for Edge / serverless / read-only
            // production deployments where the running process must not depend
            // on local source files.
            if (src?.mode === 'local-file') {
                await this._loadFromLocalFile(ctx, src.path, src.fetchTimeoutMs);
            } else if (src?.mode === 'artifact-api') {
                await this._loadFromArtifactApi(ctx, src);
            } else {
                throw new Error('[MetadataPlugin] bootstrap=artifact-only requires options.artifactSource to be set');
            }
        } else if (mode === 'lazy') {
            // On-demand mode: skip the eager filesystem priming pass entirely.
            // Reads go through MetadataManager.load*/list* which are backed by
            // the DatabaseLoader read-through cache and any registered loaders.
            // An artifact source, if present, is still honored so projects can
            // pin a known set of metadata at boot without paying the FS scan.
            if (src?.mode === 'local-file') {
                await this._loadFromLocalFile(ctx, src.path, src.fetchTimeoutMs);
            } else if (src?.mode === 'artifact-api') {
                await this._loadFromArtifactApi(ctx, src);
            } else {
                ctx.logger.info('[MetadataPlugin] lazy bootstrap — skipping filesystem priming; metadata loads on demand');
            }
        } else {
            // 'eager' (default): preserve historical behavior.
            if (src?.mode === 'local-file') {
                await this._loadFromLocalFile(ctx, src.path, src.fetchTimeoutMs);
            } else if (src?.mode === 'artifact-api') {
                await this._loadFromArtifactApi(ctx, src);
            } else {
                await this._loadFromFileSystem(ctx);
            }
        }

        // ── ADR-0008 PR-6: attach FileSystemRepository as a supplementary
        //    event source so PR-7 (ObjectQL SchemaRegistry), PR-9 (Studio
        //    SSE hook) and future cloud consumers can subscribe to the
        //    same canonical event stream. No write mirroring yet.
        const bootstrapMode = this.options.config?.bootstrap ?? 'eager';
        if (bootstrapMode !== 'artifact-only') {
            try {
                const path = await import('node:path');
                const { FileSystemRepository } = await import('@objectstack/metadata-fs');
                const rootDir = this.options.rootDir || process.cwd();
                const repoRoot = path.join(rootDir, REPO_SUBDIR);
                const repo = new FileSystemRepository({
                    root: repoRoot,
                    org: this.options.organizationId ?? 'system',
                    disableWatch: this.options.watch === false,
                });
                await repo.start();
                this.repository = repo;
                this.manager.setRepository(repo);
                ctx.logger.info('[MetadataPlugin] FileSystemRepository attached', {
                    repoRoot,
                    watch: this.options.watch !== false,
                });
            } catch (e: any) {
                ctx.logger.warn('[MetadataPlugin] Failed to attach FileSystemRepository', {
                    error: e?.message,
                });
            }
        }

        // Bridge realtime service from kernel service registry to MetadataManager.
        try {
            const realtimeService = ctx.getService('realtime');
            if (realtimeService && typeof realtimeService === 'object' && 'publish' in realtimeService) {
                ctx.logger.info('[MetadataPlugin] Bridging realtime service to MetadataManager for event publishing');
                this.manager.setRealtimeService(realtimeService as any);
            }
        } catch (e: any) {
            ctx.logger.debug('[MetadataPlugin] No realtime service found — metadata events will not be published', {
                error: e.message,
            });
        }

        // Register the HMR SSE endpoint when an HTTP server is available
        // that exposes a raw Hono app. The endpoint is registered regardless
        // of the `watch` option:
        //  - In `watch: true` mode the FS watcher feeds events into the hub.
        //  - In `watch: false` mode (e.g. artifact-mode `os dev`), an
        //    external watch-recompile pipeline POSTs to the same endpoint
        //    after rebuilding the artifact, and we reload it here before
        //    broadcasting.
        // Production deployments simply won't have a CLI POSTing to this
        // endpoint and won't surface the route to clients.
        try {
            const httpServer = ctx.getService<any>('http-server')
                ?? ctx.getService<any>('http.server');
            if (httpServer && typeof httpServer.getRawApp === 'function') {
                const { registerMetadataHmrRoutes } = await import('./routes/hmr-routes.js');
                const hub = registerMetadataHmrRoutes(httpServer.getRawApp(), this.manager);
                // Wire POST → re-load the artifact from disk (when in
                // local-file artifact mode) so subsequent reads see fresh
                // metadata. The broadcast happens after the handler returns.
                hub.setOnPostReload(async (body: { reason?: string; changed?: string[] } = {}) => {
                    const src = this.options.artifactSource;
                    if (src?.mode === 'local-file') {
                        try {
                            await this._loadFromLocalFile(ctx, src.path, src.fetchTimeoutMs);
                            ctx.logger.info('[MetadataPlugin] artifact reloaded via HMR POST', {
                                path: src.path,
                                reason: body?.reason,
                            });
                        } catch (e: any) {
                            ctx.logger.warn('[MetadataPlugin] artifact reload failed', { error: e?.message });
                            throw e;
                        }
                    }
                });

                // ── ADR-0008 PR-8 / PR-10e: server-side artifact-file watcher ──
                //
                // When running in local-file artifact mode (e.g. `os dev`
                // serving from `dist/objectstack.json`), watch the
                // artifact path directly so the server reloads on
                // recompile WITHOUT requiring the CLI to ping the HMR
                // POST endpoint. The POST route stays available for
                // external trigger sources (cloud webhook, git hook,
                // ad-hoc curl) but is no longer the only signal.
                //
                // Gated on `artifactWatch` (NOT `watch` — the latter
                // controls the source-file scanner which is redundant in
                // artifact mode). Default: on when artifactSource is
                // present, off otherwise.
                const src = this.options.artifactSource;
                const wantArtifactWatch = this.options.artifactWatch
                    ?? (src?.mode === 'local-file');
                if (src?.mode === 'local-file' && wantArtifactWatch && !/^https?:\/\//i.test(src.path)) {
                    try {
                        const { watch: chokidarWatch } = await import('chokidar');
                        const w = chokidarWatch(src.path, {
                            ignoreInitial: true,
                            awaitWriteFinish: { stabilityThreshold: 50, pollInterval: 20 },
                            persistent: true,
                            // Use polling to avoid `fs.watch` exhausting the
                            // process file-descriptor limit on macOS (chokidar
                            // recursively wires watches on the parent
                            // directory tree which can trip EMFILE on busy
                            // dev hosts). 500ms polling is fast enough for
                            // HMR (a recompile takes ~400ms anyway).
                            usePolling: true,
                            interval: 500,
                            binaryInterval: 1000,
                        });
                        let pending = false;
                        const reload = async () => {
                            if (pending) return;
                            pending = true;
                            try {
                                await this._loadFromLocalFile(ctx, src.path, src.fetchTimeoutMs);
                                hub.broadcastReload('artifact-file-changed', [src.path]);
                                ctx.logger.info('[MetadataPlugin] artifact auto-reloaded (file watcher)', {
                                    path: src.path,
                                });
                            } catch (e: any) {
                                ctx.logger.warn('[MetadataPlugin] artifact auto-reload failed', { error: e?.message });
                            } finally {
                                pending = false;
                            }
                        };
                        w.on('change', () => { void reload(); });
                        w.on('add', () => { void reload(); });
                        this.artifactWatcher = { close: () => w.close() };
                        // eslint-disable-next-line no-console
                        console.log('[MetadataPlugin] artifact file watcher attached', src.path);
                    } catch (e: any) {
                        ctx.logger.warn('[MetadataPlugin] artifact watcher failed to start', { error: e?.message });
                    }
                }
                // eslint-disable-next-line no-console
                console.log('[MetadataPlugin] HMR endpoint registered at /api/v1/dev/metadata-events');
            } else {
                // eslint-disable-next-line no-console
                console.log('[MetadataPlugin] HTTP server with getRawApp() not available — skipping HMR endpoint');
            }
        } catch (e: any) {
            // eslint-disable-next-line no-console
            console.warn('[MetadataPlugin] Failed to register HMR endpoint', e?.message);
        }
    }

    stop = async (ctx: PluginContext) => {
        if (this.artifactWatcher) {
            try { await this.artifactWatcher.close(); } catch { /* noop */ }
            this.artifactWatcher = undefined;
        }
        try {
            await this.manager.dispose();
        } catch (e: any) {
            ctx.logger.warn('[MetadataPlugin] manager.dispose() failed', { error: e?.message });
        }
        const repo = this.repository as any;
        if (repo && typeof repo.close === 'function') {
            try { await repo.close(); } catch { /* noop */ }
        }
        this.repository = undefined;
    }

    /**
     * Fetch JSON content from a URL with configurable timeout.
     */
    private async _fetchJson(url: string, fetchTimeoutMs?: number, token?: string): Promise<unknown> {
        const envTimeout = Number(process.env.OS_ARTIFACT_FETCH_TIMEOUT_MS);
        const timeoutMs = fetchTimeoutMs
            ?? (Number.isFinite(envTimeout) && envTimeout > 0 ? envTimeout : undefined)
            ?? 60_000;
        const controller = new AbortController();
        const timer = timeoutMs > 0 ? setTimeout(() => controller.abort(), timeoutMs) : undefined;
        try {
            const headers: Record<string, string> = { Accept: 'application/json, */*;q=0.5' };
            if (token) headers.Authorization = `Bearer ${token}`;
            const res = await fetch(url, { redirect: 'follow', signal: controller.signal, headers });
            if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
            const content = await res.text();
            return JSON.parse(content);
        } catch (e: any) {
            if (e?.name === 'AbortError') {
                throw new Error(
                    `fetch timed out after ${timeoutMs}ms — set artifactSource.fetchTimeoutMs or OS_ARTIFACT_FETCH_TIMEOUT_MS to extend it (0 disables)`,
                );
            }
            throw e;
        } finally {
            if (timer) clearTimeout(timer);
        }
    }

    /**
     * Parse raw artifact JSON (envelope or bare definition) and register all
     * metadata items into the MetadataManager.
     */
    private async _parseAndRegisterArtifact(ctx: PluginContext, raw: unknown, label: string): Promise<number> {
        const { EnvironmentArtifactSchema } = await import('@objectstack/spec/cloud');
        const { ObjectStackDefinitionSchema } = await import('@objectstack/spec');

        let metadata: Record<string, unknown[]>;

        const obj = raw as any;
        if (obj?.schemaVersion && obj?.commitId && obj?.metadata !== undefined) {
            const artifact = EnvironmentArtifactSchema.parse(obj);
            metadata = artifact.metadata as Record<string, unknown[]>;
        } else if (obj?.success && obj?.data?.metadata) {
            // Unwrap cloud API envelope: { success: true, data: { metadata: {...} } }
            const artifact = EnvironmentArtifactSchema.parse(obj.data);
            metadata = artifact.metadata as Record<string, unknown[]>;
        } else {
            const def = ObjectStackDefinitionSchema.parse(obj);
            const canonical = JSON.stringify(def, Object.keys(def).sort());
            const checksum = createHash('sha256').update(canonical).digest('hex');
            const environmentId = this.options.environmentId ?? 'proj_local';
            EnvironmentArtifactSchema.parse({
                schemaVersion: '0.1',
                environmentId,
                commitId: 'local-dev',
                checksum,
                metadata: def,
            });
            metadata = def as Record<string, unknown[]>;
        }

        const memLoader = new MemoryLoader();
        const manifestPackageId =
            (metadata as any)?.manifest?.id ?? (metadata as any)?.id ?? undefined;
        const manifestVersion =
            (metadata as any)?.manifest?.version ?? (metadata as any)?.version ?? undefined;

        let totalRegistered = 0;
        for (const [field, metaType] of Object.entries(ARTIFACT_FIELD_TO_TYPE)) {
            const items = (metadata as any)[field];
            if (!Array.isArray(items) || items.length === 0) continue;
            for (const item of items) {
                // Expand aggregated view containers into independent ViewItems
                // ("Object has-many View"), while still registering the
                // container under the bare <object> key for backward-compatible
                // reads. Already-independent ViewItems carry a top-level `name`
                // and fall through to the normal path below.
                if (metaType === 'view' && isAggregatedViewContainer(item)) {
                    const viewObject =
                        (item as any)?.list?.data?.object
                        ?? (item as any)?.form?.data?.object;
                    if (!viewObject) continue;
                    applyProtection(item as any, {
                        packageId: manifestPackageId,
                        packageVersion: manifestVersion,
                    });
                    await memLoader.save('view', viewObject, item);
                    await this.manager.register('view', viewObject, item);
                    totalRegistered++;
                    for (const vi of expandViewContainer(viewObject, item)) {
                        applyProtection(vi as any, {
                            packageId: manifestPackageId,
                            packageVersion: manifestVersion,
                        });
                        await memLoader.save('view', vi.name, vi);
                        await this.manager.register('view', vi.name, vi);
                        totalRegistered++;
                    }
                    continue;
                }
                // Most metadata items carry a top-level `name`. The `View`
                // container (UI namespace) is an exception: it has no own
                // `name` — its identity is the target object, encoded under
                // `list.data.object` (or `form.data.object`). Mirror the
                // resolution used by `ObjectQL.SchemaRegistry` so that
                // artifact-loaded views land in `MetadataManager` under the
                // SAME key reads expect (`metadataService.get('view', <object>)`).
                // Without this, HMR pushes views into the registry only via
                // AppPlugin's `manifest.register`, which targets the
                // boot-only SchemaRegistry cache and is never refreshed on
                // file edits — leaving MetadataService empty for view/* and
                // forcing all reads to return the stale boot copy.
                let name = (item as any)?.name;
                if (!name) {
                    if (metaType === 'view') {
                        name =
                            (item as any)?.list?.data?.object
                            ?? (item as any)?.form?.data?.object;
                    }
                }
                if (!name) continue;
                // ADR-0010 §3.7 — translate the author-facing
                // `protection` block into the private `_lock` envelope
                // and stamp package provenance in one call. Strips the
                // public block so it never lands in sys_metadata.
                applyProtection(item as any, {
                    packageId: manifestPackageId,
                    packageVersion: manifestVersion,
                });
                await memLoader.save(metaType, name, item);
                await this.manager.register(metaType, name, item);
                totalRegistered++;
            }
        }

        this.manager.registerLoader(memLoader);
        ctx.logger.info('[MetadataPlugin] Artifact metadata loaded', { source: label, totalRegistered });
        return totalRegistered;
    }

    private async _loadFromLocalFile(ctx: PluginContext, filePath: string, fetchTimeoutMs?: number): Promise<void> {
        const isUrl = /^https?:\/\//i.test(filePath);
        ctx.logger.info(
            `[MetadataPlugin] Loading metadata from ${isUrl ? 'remote URL' : 'local artifact file'}`,
            { path: filePath },
        );

        let raw: unknown;
        try {
            if (isUrl) {
                raw = await this._fetchJson(filePath, fetchTimeoutMs);
            } else {
                const content = await readFile(filePath, 'utf8');
                raw = JSON.parse(content);
            }
        } catch (e: any) {
            throw new Error(`[MetadataPlugin] Cannot read artifact ${isUrl ? 'URL' : 'file'} at "${filePath}": ${e.message}`);
        }

        await this._parseAndRegisterArtifact(ctx, raw, filePath);
    }

    /**
     * P2: Load metadata from the cloud artifact API endpoint.
     */
    private async _loadFromArtifactApi(
        ctx: PluginContext,
        src: { url: string; token?: string; commitId?: string; fetchTimeoutMs?: number },
    ): Promise<void> {
        const environmentId = this.options.environmentId;
        if (!environmentId) {
            throw new Error('[MetadataPlugin] artifact-api source requires options.environmentId to be set');
        }

        // Build the artifact URL:
        //   ${url}/api/v1/cloud/environments/${environmentId}/artifact[?commit=${commitId}]
        let artifactUrl = src.url.replace(/\/+$/, '');
        // If the URL already contains /api/v1, use it as-is; otherwise append default path.
        if (!/\/api\/v\d+\/cloud\/projects\//i.test(artifactUrl)) {
            artifactUrl = `${artifactUrl}/api/v1/cloud/environments/${environmentId}/artifact`;
        }
        if (src.commitId) {
            artifactUrl += `${artifactUrl.includes('?') ? '&' : '?'}commit=${encodeURIComponent(src.commitId)}`;
        }

        ctx.logger.info('[MetadataPlugin] Loading metadata from artifact API', { url: artifactUrl });

        let raw: unknown;
        try {
            raw = await this._fetchJson(artifactUrl, src.fetchTimeoutMs, src.token);
        } catch (e: any) {
            throw new Error(`[MetadataPlugin] Cannot load artifact from API "${artifactUrl}": ${e.message}`);
        }

        await this._parseAndRegisterArtifact(ctx, raw, artifactUrl);
    }

    private async _loadFromFileSystem(ctx: PluginContext): Promise<void> {
        ctx.logger.info('Loading metadata from file system...');

        const sortedTypes = [...DEFAULT_METADATA_TYPE_REGISTRY]
            .sort((a, b) => a.loadOrder - b.loadOrder);

        let totalLoaded = 0;
        for (const entry of sortedTypes) {
            try {
                const items = await this.manager.loadMany(entry.type, {
                    recursive: true,
                    patterns: entry.filePatterns,
                });

                if (items.length > 0) {
                    for (const item of items) {
                        const meta = item as any;
                        if (meta?.name) {
                            // Stamp package provenance when the host declared
                            // its package id (see MetadataPluginOptions.packageId)
                            // — same applyProtection call the artifact path
                            // uses, so both load paths produce identical
                            // _packageId/_provenance state. No-op when the
                            // option is unset or the item is already stamped.
                            applyProtection(meta, {
                                packageId: this.options.packageId,
                            });
                            await this.manager.register(entry.type, meta.name, item);
                        }
                    }
                    ctx.logger.info(`Loaded ${items.length} ${entry.type} from file system`);
                    totalLoaded += items.length;
                }
            } catch (e: any) {
                ctx.logger.debug(`No ${entry.type} metadata found`, { error: e.message });
            }
        }

        ctx.logger.info('Metadata loading complete', {
            totalItems: totalLoaded,
            registeredTypes: sortedTypes.length,
        });
    }
}
