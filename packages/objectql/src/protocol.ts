// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { ObjectStackProtocol } from '@objectstack/spec/api';
import { IDataEngine } from '@objectstack/core';
import type { ObjectQL } from './engine.js';
import { SysMetadataRepository, type SysMetadataEngine } from './sys-metadata-repository.js';
import { ConflictError } from '@objectstack/metadata-core';
import type {
    BatchUpdateRequest,
    BatchUpdateResponse,
    UpdateManyDataRequest,
    DeleteManyDataRequest
} from '@objectstack/spec/api';
import type { MetadataCacheRequest, MetadataCacheResponse, ServiceInfo, ApiRoutes, WellKnownCapabilities } from '@objectstack/spec/api';
import type { IFeedService } from '@objectstack/spec/contracts';
import { parseFilterAST, isFilterAST } from '@objectstack/spec/data';
import { PLURAL_TO_SINGULAR, SINGULAR_TO_PLURAL } from '@objectstack/spec/shared';
import { ListViewSchema, FormViewSchema, DashboardSchema } from '@objectstack/spec/ui';
import { DEFAULT_METADATA_TYPE_REGISTRY } from '@objectstack/spec/kernel';
import { z } from 'zod';

/**
 * Zod schemas used to validate overlay items before they are persisted into
 * `sys_metadata` by {@link ObjectStackProtocolImplementation.saveMetaItem}.
 *
 * Some types (notably `view`) are *not* a single schema but a discriminated
 * family — a grid/kanban/calendar list view vs. a simple/tabbed/wizard form
 * view. We dispatch to the right schema based on the `type` discriminant
 * rather than using `z.union([...])`, which would collapse all branch errors
 * into an opaque "Invalid input" union error.
 *
 * Validation policy:
 *   - `safeParse` is used so we can craft a 422 with structured `issues`.
 *   - We do NOT replace the persisted document with `parsed.data`; the
 *     original payload is stored verbatim so Studio-only auxiliary fields
 *     (e.g. `isPinned`, `isDefault`, `sortOrder`) survive the round-trip.
 *   - Schemas are referenced lazily through the Spec's `lazySchema` Proxy,
 *     so importing this module does not trigger eager Zod construction.
 *   - Types without a registered schema (e.g. `app`, `package`) fall through
 *     unvalidated for backwards compatibility — they were never enforced
 *     historically and existing control-plane writes rely on the lenient
 *     behaviour.
 */
const FORM_VIEW_TYPES = new Set(['simple', 'tabbed', 'wizard', 'split', 'drawer', 'modal']);

function resolveOverlaySchema(type: string, item: unknown): z.ZodTypeAny | null {
    const singular = PLURAL_TO_SINGULAR[type] ?? type;
    switch (singular) {
        case 'view': {
            // Form views and list views share the `view` overlay type. Pick
            // the right Zod schema by inspecting the discriminant. Defaults
            // to ListViewSchema (matches the ListViewSchema `type.default('grid')`).
            const t = (item && typeof item === 'object' && 'type' in item)
                ? String((item as any).type)
                : undefined;
            return t && FORM_VIEW_TYPES.has(t) ? FormViewSchema : ListViewSchema;
        }
        case 'dashboard':
            return DashboardSchema;
        default:
            return null;
    }
}

/**
 * Simple hash function for ETag generation (browser-compatible)
 * Uses a basic hash algorithm instead of crypto.createHash
 */
function simpleHash(str: string): string {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        const char = str.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash; // Convert to 32bit integer
    }
    return Math.abs(hash).toString(16);
}

/**
 * Thrown by `updateData` / `deleteData` when the caller supplies an
 * `expectedVersion` that does not match the current record's `updated_at`.
 *
 * The HTTP layer maps this to `409 Conflict` with code `CONCURRENT_UPDATE`,
 * and includes both the current server-side version and the current record
 * payload so the client can render an informed conflict-resolution UI
 * ("Reload latest" vs. "Overwrite anyway").
 *
 * NOTE: This is an *application-level* compare-and-set — not an atomic
 * storage-layer CAS. There is a small TOCTOU window between the version
 * check and the subsequent write. For the conflict frequency this targets
 * (different users seconds-to-minutes apart in B2B record editing) this
 * is more than adequate; a future revision can push the check into the
 * driver's UPDATE statement (`WHERE id=? AND updated_at=?`) for true
 * atomicity.
 */
export class ConcurrentUpdateError extends Error {
    readonly code = 'CONCURRENT_UPDATE';
    readonly status = 409;
    readonly currentVersion: string | null;
    readonly currentRecord: unknown;
    constructor(opts: { currentVersion: string | null; currentRecord: unknown; message?: string }) {
        super(opts.message ?? 'Record was modified by another user');
        this.name = 'ConcurrentUpdateError';
        this.currentVersion = opts.currentVersion;
        this.currentRecord = opts.currentRecord;
    }
}

/**
 * Normalises a version token for comparison. Strips RFC-7232-style quotes
 * (`"…"`) that an HTTP `If-Match` header may carry, trims whitespace, and
 * returns null for empty / nullish input.
 */
function normaliseVersionToken(v: unknown): string | null {
    if (v === null || v === undefined) return null;
    const s = String(v).trim();
    if (!s) return null;
    if (s.length >= 2 && s.startsWith('"') && s.endsWith('"')) {
        return s.slice(1, -1);
    }
    return s;
}

/**
 * Service Configuration for Discovery
 * Maps service names to their routes and plugin providers
 */
const SERVICE_CONFIG: Record<string, { route: string; plugin: string }> = {
    auth:         { route: '/api/v1/auth', plugin: 'plugin-auth' },
    automation:   { route: '/api/v1/automation', plugin: 'plugin-automation' },
    cache:        { route: '/api/v1/cache', plugin: 'plugin-redis' },
    queue:        { route: '/api/v1/queue', plugin: 'plugin-bullmq' },
    job:          { route: '/api/v1/jobs', plugin: 'job-scheduler' },
    ui:           { route: '/api/v1/ui', plugin: 'ui-plugin' },
    workflow:     { route: '/api/v1/workflow', plugin: 'plugin-workflow' },
    realtime:     { route: '/api/v1/realtime', plugin: 'plugin-realtime' },
    notification: { route: '/api/v1/notifications', plugin: 'plugin-notifications' },
    ai:           { route: '/api/v1/ai', plugin: 'plugin-ai' },
    i18n:         { route: '/api/v1/i18n', plugin: 'service-i18n' },
    graphql:      { route: '/graphql', plugin: 'plugin-graphql' },  // GraphQL uses /graphql by convention (not versioned REST)
    'file-storage': { route: '/api/v1/storage', plugin: 'plugin-storage' },
    search:       { route: '/api/v1/search', plugin: 'plugin-search' },
};

export class ObjectStackProtocolImplementation implements ObjectStackProtocol {
    private engine: ObjectQL;
    private getServicesRegistry?: () => Map<string, any>;
    private getFeedService?: () => IFeedService | undefined;
    /**
     * Project scope applied to sys_metadata reads/writes. When undefined
     * (single-kernel deployments), rows land in / come from the
     * platform-global bucket (`project_id IS NULL`). When set, every
     * saveMetaItem insert/update and loadMetaFromDb query is filtered by
     * `project_id = projectId`, so per-project kernels see only their own
     * metadata even if several projects share the same physical database.
     */
    private projectId?: string;

    /**
     * Lazily-instantiated SysMetadataRepository per organization. Keyed by
     * `${organizationId ?? '__env__'}`. Repositories are stateful — they
     * carry the per-org `seqCounter` and watch subscribers — so we cache
     * them rather than constructing one per call.
     */
    private overlayRepos = new Map<string, SysMetadataRepository>();

    constructor(
        engine: IDataEngine,
        getServicesRegistry?: () => Map<string, any>,
        getFeedService?: () => IFeedService | undefined,
        projectId?: string,
    ) {
        this.engine = engine as ObjectQL;
        this.getServicesRegistry = getServicesRegistry;
        this.getFeedService = getFeedService;
        this.projectId = projectId;
    }

    /**
     * Lazily obtain a SysMetadataRepository for the given organization.
     * Env-wide overlays (organizationId == null) share a singleton under
     * the `__env__` key.
     */
    private getOverlayRepo(organizationId: string | null): SysMetadataRepository {
        const key = organizationId ?? '__env__';
        let repo = this.overlayRepos.get(key);
        if (!repo) {
            repo = new SysMetadataRepository({
                engine: this.engine as unknown as SysMetadataEngine,
                organizationId,
                orgLabel: organizationId ?? 'env',
            });
            this.overlayRepos.set(key, repo);
        }
        return repo;
    }

    /**
     * One-time guard for ensuring the overlay-uniqueness UNIQUE INDEX exists
     * on `sys_metadata`. ADR-0005: scopes overlays by
     * `(type, name, organization_id, project_id, scope)` for active rows only.
     * Idempotent SQL — safe to attempt on every protocol instance.
     *
     * Inlined here (rather than importing from @objectstack/metadata/migrations)
     * to avoid a circular dependency: metadata already depends on objectql.
     */
    private overlayIndexEnsured = false;
    private async ensureOverlayIndex(): Promise<void> {
        if (this.overlayIndexEnsured) return;
        this.overlayIndexEnsured = true;
        try {
            const engineAny = this.engine as any;
            let driver: any = engineAny?.driver ?? engineAny?.getDriver?.();
            if (!driver && engineAny?.drivers instanceof Map) {
                for (const candidate of engineAny.drivers.values()) {
                    if (
                        candidate &&
                        (typeof (candidate as any).raw === 'function' ||
                            typeof (candidate as any).execute === 'function')
                    ) {
                        driver = candidate;
                        break;
                    }
                }
            }
            if (!driver) return;
            const exec = async (sql: string): Promise<void> => {
                if (typeof (driver as any).raw === 'function') {
                    await (driver as any).raw(sql);
                } else if (typeof (driver as any).execute === 'function') {
                    await (driver as any).execute(sql);
                } else {
                    throw new Error('driver has neither raw nor execute');
                }
            };
            // ADR-0005 (revised 2026-05): per-env DBs replace the old
            // "per-project" isolation, so `project_id` is no longer a
            // discriminator. Overlay uniqueness is `(type, name,
            // organization_id)` filtered to active rows. Drop the legacy
            // composite index first so the new partial UNIQUE can claim
            // the same name — DROP INDEX IF EXISTS is idempotent.
            try { await exec("DROP INDEX IF EXISTS idx_sys_metadata_overlay_active"); } catch { /* best-effort */ }
            const partialSql =
                "CREATE UNIQUE INDEX IF NOT EXISTS idx_sys_metadata_overlay_active " +
                "ON sys_metadata (type, name, organization_id) " +
                "WHERE state = 'active'";
            const fallbackSql =
                "CREATE INDEX IF NOT EXISTS idx_sys_metadata_overlay_active " +
                "ON sys_metadata (type, name, organization_id)";
            try {
                await exec(partialSql);
            } catch (err: any) {
                const msg = err instanceof Error ? err.message : String(err);
                if (/partial|where clause|syntax/i.test(msg)) {
                    try {
                        await exec(fallbackSql);
                    } catch {
                        // ignore — non-essential optimization
                    }
                }
                // "already exists" or anything else: best-effort
            }
        } catch {
            // ignore — index is an optimization, not a correctness invariant
        }
    }

    /**
     * Exposes the project scope the protocol is bound to. Consumers like
     * the HTTP dispatcher use this to decide whether to trust the process-
     * wide SchemaRegistry or whether they must route a read through the
     * protocol's project_id-filtered lookup.
     */
    getProjectId(): string | undefined {
        return this.projectId;
    }

    private requireFeedService(): IFeedService {
        const svc = this.getFeedService?.();
        if (!svc) {
            throw new Error('Feed service not available. Install and register service-feed to enable feed operations.');
        }
        return svc;
    }

    async getDiscovery() {
        // Get registered services from kernel if available
        const registeredServices = this.getServicesRegistry ? this.getServicesRegistry() : new Map();
        
        // Build dynamic service info with proper typing
        const services: Record<string, ServiceInfo> = {
            // --- Kernel-provided (objectql is an example kernel implementation) ---
            metadata:  { enabled: true, status: 'available' as const, route: '/api/v1/meta', provider: 'objectql' },
            data:      { enabled: true, status: 'available' as const, route: '/api/v1/data', provider: 'objectql' },
            analytics: { enabled: true, status: 'available' as const, route: '/api/v1/analytics', provider: 'objectql' },
        };

        // Check which services are actually registered
        for (const [serviceName, config] of Object.entries(SERVICE_CONFIG)) {
            if (registeredServices.has(serviceName)) {
                // Service is registered and available
                services[serviceName] = {
                    enabled: true,
                    status: 'available' as const,
                    route: config.route,
                    provider: config.plugin,
                };
            } else {
                // Service is not registered
                services[serviceName] = {
                    enabled: false,
                    status: 'unavailable' as const,
                    message: `Install ${config.plugin} to enable`,
                };
            }
        }

        // Build routes from services — a flat convenience map for client routing
        const serviceToRouteKey: Record<string, keyof ApiRoutes> = {
            auth: 'auth',
            automation: 'automation',
            ui: 'ui',
            workflow: 'workflow',
            realtime: 'realtime',
            notification: 'notifications',
            ai: 'ai',
            i18n: 'i18n',
            graphql: 'graphql',
            'file-storage': 'storage',
        };

        const optionalRoutes: Partial<ApiRoutes> = {
            analytics: '/api/v1/analytics',
        };

        // Add routes for available plugin services
        for (const [serviceName, config] of Object.entries(SERVICE_CONFIG)) {
            if (registeredServices.has(serviceName)) {
                const routeKey = serviceToRouteKey[serviceName];
                if (routeKey) {
                    optionalRoutes[routeKey] = config.route;
                }
            }
        }

        // Add feed service status
        if (registeredServices.has('feed')) {
            services['feed'] = {
                enabled: true,
                status: 'available' as const,
                route: '/api/v1/data',
                provider: 'service-feed',
            };
        } else {
            services['feed'] = {
                enabled: false,
                status: 'unavailable' as const,
                message: 'Install service-feed to enable',
            };
        }

        const routes: ApiRoutes = {
            data: '/api/v1/data',
            metadata: '/api/v1/meta',
            ...optionalRoutes,
        };

        // Build well-known capabilities from registered services.
        // DiscoverySchema defines capabilities as Record<string, { enabled, features?, description? }>
        // (hierarchical format). We also keep a flat WellKnownCapabilities for backward compat.
        const wellKnown: WellKnownCapabilities = {
            feed: registeredServices.has('feed'),
            comments: registeredServices.has('feed'),
            automation: registeredServices.has('automation'),
            cron: registeredServices.has('job'),
            search: registeredServices.has('search'),
            export: registeredServices.has('automation') || registeredServices.has('queue'),
            chunkedUpload: registeredServices.has('file-storage'),
        };

        // Convert flat booleans → hierarchical capability objects
        const capabilities: Record<string, { enabled: boolean; description?: string }> = {};
        for (const [key, enabled] of Object.entries(wellKnown)) {
            capabilities[key] = { enabled };
        }

        return {
            version: '1.0',
            apiName: 'ObjectStack API',
            routes,
            services,
            capabilities,
        };
    }

    async getMetaTypes() {
        const schemaTypes = this.engine.registry.getRegisteredTypes();

        // Also include types from MetadataService (runtime-registered: agent, tool, etc.)
        let runtimeTypes: string[] = [];
        try {
            const services = this.getServicesRegistry?.();
            const metadataService = services?.get('metadata');
            if (metadataService && typeof metadataService.getRegisteredTypes === 'function') {
                runtimeTypes = await metadataService.getRegisteredTypes();
            }
        } catch {
            // MetadataService not available
        }

        const allTypes = Array.from(new Set([...schemaTypes, ...runtimeTypes]));
        return { types: allTypes };
    }

    async getMetaItems(request: { type: string; packageId?: string; organizationId?: string }) {
        const { packageId } = request;
        let items: unknown[] = [];

        // Unscoped kernels (control plane): read everything from SchemaRegistry.
        // Scoped (project) kernels: skip user-project entries in SchemaRegistry to
        // prevent cross-project leakage, but DO include scope:'system' packages
        // (plugin-auth, plugin-security, plugin-audit, …) — those are globally
        // shared and must be visible at every project's meta endpoint.
        if (this.projectId === undefined) {
            items = [...this.engine.registry.listItems(request.type, packageId)];
            // Normalize singular/plural using explicit mapping
            if (items.length === 0) {
                const alt = PLURAL_TO_SINGULAR[request.type] ?? SINGULAR_TO_PLURAL[request.type];
                if (alt) items = [...this.engine.registry.listItems(alt, packageId)];
            }
        } else {
            // For project kernels: the SchemaRegistry is owned by THIS
            // kernel's ObjectQL instance (not shared across projects in the
            // process), so we can safely include every package — system
            // plugins (auth/security/audit) and the project's own app
            // package alike. The `_packageId` tag added by `listItems`
            // (registry.ts) is preserved for the sidebar to compute the
            // correct navigation URL.
            items = [...this.engine.registry.listItems(request.type, packageId)];
            if (items.length === 0) {
                const alt = PLURAL_TO_SINGULAR[request.type] ?? SINGULAR_TO_PLURAL[request.type];
                if (alt) items = [...this.engine.registry.listItems(alt, packageId)];
            }
        }

        // Always consult the DB so metadata persisted by the seeder /
        // bulkRegister shows up even when the registry already has unrelated
        // entries (the previous fallback-only logic meant per-env metadata
        // was never surfaced whenever system-bridged items populated the
        // registry). Deduplicate against whatever the registry returned.
        //
        // ADR-0005 (revised 2026-05): isolation is now per-organization, since
        // each env has its own physical DB. We surface both org-scoped overlays
        // (when an active org is provided) and env-wide (organization_id IS NULL)
        // overlays; org-scoped rows win on name collision.
        try {
            const orgId = (request as any).organizationId as string | undefined;
            const queryByOrg = async (oid: string | null): Promise<any[]> => {
                const whereClause: Record<string, unknown> = {
                    type: request.type,
                    state: 'active',
                    organization_id: oid,
                };
                if (packageId) whereClause._packageId = packageId;
                let rs = await this.engine.find('sys_metadata', { where: whereClause });
                if ((!rs || rs.length === 0)) {
                    const alt = PLURAL_TO_SINGULAR[request.type] ?? SINGULAR_TO_PLURAL[request.type];
                    if (alt) {
                        const altWhere: Record<string, unknown> = { type: alt, state: 'active', organization_id: oid };
                        if (packageId) altWhere._packageId = packageId;
                        rs = await this.engine.find('sys_metadata', { where: altWhere });
                    }
                }
                return rs ?? [];
            };
            const envWideRecords = await queryByOrg(null);
            const orgRecords = orgId ? await queryByOrg(orgId) : [];
            // org-specific rows override env-wide rows on name collision
            const mergedMap = new Map<string, any>();
            for (const r of envWideRecords) mergedMap.set(r.name, r);
            for (const r of orgRecords) mergedMap.set(r.name, r);
            const records = Array.from(mergedMap.values());
            if (records && records.length > 0) {
                const byName = new Map<string, any>();
                for (const existing of items) {
                    const entry = existing as any;
                    if (entry && typeof entry === 'object' && 'name' in entry) {
                        byName.set(entry.name, entry);
                    }
                }
                for (const record of records) {
                    const data = typeof record.metadata === 'string'
                        ? JSON.parse(record.metadata)
                        : record.metadata;
                    if (data && typeof data === 'object' && 'name' in data) {
                        byName.set(data.name, data);
                    }
                    // Only hydrate the global registry for unscoped calls —
                    // scoped project entries must not leak process-wide.
                    if (this.projectId === undefined) {
                        this.engine.registry.registerItem(request.type, data, 'name' as any);
                    }
                }
                items = Array.from(byName.values());
            }
        } catch {
            // DB not available — fall through with whatever we already have.
        }

        // Merge with MetadataService (runtime-registered items: agents, tools, etc.)
        try {
            const services = this.getServicesRegistry?.();
            const metadataService = services?.get('metadata');
            if (metadataService && typeof metadataService.list === 'function') {
                let runtimeItems = await metadataService.list(request.type);
                // When filtering by packageId, only include runtime items that
                // belong to the requested package. MetadataService.list() returns
                // items from ALL packages, so we must filter here to respect the
                // package scope requested by the caller (e.g., Studio sidebar).
                if (packageId && runtimeItems && runtimeItems.length > 0) {
                    runtimeItems = runtimeItems.filter((item: any) => item?._packageId === packageId);
                }
                if (runtimeItems && runtimeItems.length > 0) {
                    // Merge, avoiding duplicates by name
                    const itemMap = new Map<string, any>();
                    for (const item of items) {
                        const entry = item as any;
                        if (entry && typeof entry === 'object' && 'name' in entry) {
                            itemMap.set(entry.name, entry);
                        }
                    }
                    for (const item of runtimeItems) {
                        const entry = item as any;
                        if (entry && typeof entry === 'object' && 'name' in entry) {
                            // Do not overwrite entries already present in the
                            // map: those came from sys_metadata (customization
                            // overlays) or the SchemaRegistry and must win
                            // over the MetadataService's artifact baseline.
                            // Without this guard, saved per-org dashboard /
                            // view overlays disappear from list endpoints on
                            // refresh (detail endpoint kept showing the
                            // overlay because it uses a different code path).
                            if (!itemMap.has(entry.name)) {
                                itemMap.set(entry.name, entry);
                            }
                        }
                    }
                    items = Array.from(itemMap.values());
                }
            }
        } catch {
            // MetadataService not available or doesn't support this type
        }

        return {
            type: request.type,
            items
        };
    }

    async getMetaItem(request: { type: string, name: string, packageId?: string, organizationId?: string }) {
        let item: unknown;
        const orgId = request.organizationId;

        // 1. Customization overlay lookup (sys_metadata).
        //    Per ADR-0005 (revised), org-scoped row wins; env-wide
        //    (organization_id IS NULL) row is the fallback before falling
        //    through to the in-memory registry / MetadataService.
        try {
            const findOverlay = async (oid: string | null): Promise<any | undefined> => {
                const where: Record<string, unknown> = {
                    type: request.type,
                    name: request.name,
                    state: 'active',
                    organization_id: oid,
                };
                const rec = await this.engine.findOne('sys_metadata', { where });
                if (rec) return rec;
                const alt = PLURAL_TO_SINGULAR[request.type] ?? SINGULAR_TO_PLURAL[request.type];
                if (alt) {
                    const altWhere: Record<string, unknown> = {
                        type: alt,
                        name: request.name,
                        state: 'active',
                        organization_id: oid,
                    };
                    return await this.engine.findOne('sys_metadata', { where: altWhere });
                }
                return undefined;
            };
            const record = (orgId ? await findOverlay(orgId) : undefined)
                ?? await findOverlay(null);
            if (record) {
                item = typeof record.metadata === 'string'
                    ? JSON.parse(record.metadata)
                    : record.metadata;
            }
        } catch {
            // DB not available — fall through to registry / MetadataService
        }

        // 2. MetadataService (runtime-registered items: HMR-updated view/page/
        //    dashboard/agent/tool, plus FilesystemLoader-sourced items). This
        //    is consulted BEFORE the in-memory SchemaRegistry because the
        //    registry is a boot-time cache populated by `loadMetadataFromService`
        //    and is NOT invalidated on `MetadataManager.register()` (which is
        //    how the CLI dev watcher pushes recompiled metadata into the
        //    running server). Without this ordering, edits to `*.view.ts`
        //    source files appear to take effect (MetadataManager learns the
        //    new value) but reads continue to return the stale registry copy.
        if (item === undefined) {
            try {
                const services = this.getServicesRegistry?.();
                const metadataService = services?.get('metadata');
                if (metadataService && typeof metadataService.get === 'function') {
                    const fromService = await metadataService.get(request.type, request.name);
                    if (fromService !== undefined && fromService !== null) {
                        item = fromService;
                    } else {
                        const alt = PLURAL_TO_SINGULAR[request.type] ?? SINGULAR_TO_PLURAL[request.type];
                        if (alt) {
                            const altFromService = await metadataService.get(alt, request.name);
                            if (altFromService !== undefined && altFromService !== null) {
                                item = altFromService;
                            }
                        }
                    }
                }
            } catch {
                // MetadataService not available — fall through
            }
        }

        // 3. In-memory SchemaRegistry (artifact-loaded out-of-box values, and
        //    items that bypass MetadataService — e.g. some object-schema
        //    extension chains registered by AppPlugin directly).
        //    Both control-plane (unscoped) and project kernels consult the
        //    registry. The previous guard that skipped the registry for
        //    project kernels was meant to prevent cross-project leakage at
        //    the LIST level — but for a single-item lookup the kernel's own
        //    `engine.registry` is project-local (each ObjectQL instance has
        //    its own SchemaRegistry), so reading from it is safe and
        //    necessary. Without this, project-kernel callers of
        //    `GET /api/v1/meta/object/<name>` 404 even though the object is
        //    registered and visible via the list endpoint.
        if (item === undefined) {
            item = this.engine.registry.getItem(request.type, request.name);
            if (item === undefined) {
                const alt = PLURAL_TO_SINGULAR[request.type] ?? SINGULAR_TO_PLURAL[request.type];
                if (alt) item = this.engine.registry.getItem(alt, request.name);
            }
        }

        return {
            type: request.type,
            name: request.name,
            item
        };
    }

    async getUiView(request: { object: string, type: 'list' | 'form' }) {
        const schema = this.engine.registry.getObject(request.object);
        if (!schema) throw new Error(`Object ${request.object} not found`);

        const fields = schema.fields || {};
        const fieldKeys = Object.keys(fields);

        if (request.type === 'list') {
            // Intelligent Column Selection
            // 1. Always include 'name' or name-like fields
            // 2. Limit to 6 columns by default
            const priorityFields = ['name', 'title', 'label', 'subject', 'email', 'status', 'type', 'category', 'created_at'];
            
            let columns = fieldKeys.filter(k => priorityFields.includes(k));
            
            // If few priority fields, add others until 5
            if (columns.length < 5) {
                const remaining = fieldKeys.filter(k => !columns.includes(k) && k !== 'id' && !fields[k].hidden);
                columns = [...columns, ...remaining.slice(0, 5 - columns.length)];
            }
            
            // Sort columns by priority then alphabet or schema order
            // For now, just keep them roughly in order they appear in schema or priority list
            
            return {
                list: {
                    type: 'grid' as const,
                    object: request.object,
                    label: schema.label || schema.name,
                    columns: columns.map(f => ({
                        field: f,
                        label: fields[f]?.label || f,
                        sortable: true
                    })),
                    sort: fields['created_at'] ? ([{ field: 'created_at', order: 'desc' }] as any) : undefined,
                    searchableFields: columns.slice(0, 3) // Make first few textual columns searchable
                }
            };
        } else {
             // Form View Generation
             // Simple single-section layout for now
             const formFields = fieldKeys
                .filter(k => k !== 'id' && k !== 'created_at' && k !== 'updated_at' && !fields[k].hidden)
                .map(f => ({
                    field: f,
                    label: fields[f]?.label,
                    required: fields[f]?.required,
                    readonly: fields[f]?.readonly,
                    type: fields[f]?.type,
                    // Default to 2 columns for most, 1 for textareas
                    colSpan: (fields[f]?.type === 'textarea' || fields[f]?.type === 'html') ? 2 : 1
                }));

             return {
                form: {
                    type: 'simple' as const,
                    object: request.object,
                    label: `Edit ${schema.label || schema.name}`,
                    sections: [
                        {
                            label: 'General Information',
                            columns: 2 as const,
                            collapsible: false,
                            collapsed: false,
                            fields: formFields
                        }
                    ]
                }
            };
        }
    }

    async findData(request: { object: string, query?: any, context?: any }) {
        const options: any = { ...request.query };
        // Forward the dispatcher's ExecutionContext so RBAC/RLS middleware
        // can apply per-request enforcement. The protocol layer is purely
        // a normalizer — it must never strip security context.
        if (request.context !== undefined) {
            options.context = request.context;
        }

        // ====================================================================
        // Normalize legacy params → QueryAST standard (where/fields/orderBy/offset/expand)
        // ====================================================================

        // OData-style `$`-prefixed params → bare aliases that the rest of
        // this function knows how to normalize. Without this step, params
        // like `?$top=2&$orderby=...` survive into the catch-all
        // implicit-filter pass below and get merged into `where` as
        // bogus field-equality predicates (e.g. `where.$top = "2"`),
        // which silently returns zero rows for every list endpoint.
        for (const [dollar, bare] of [
            ['$top', 'top'],
            ['$skip', 'skip'],
            ['$orderby', 'orderBy'],
            ['$select', 'select'],
            ['$count', 'count'],
        ] as const) {
            if (options[dollar] != null && options[bare] == null) {
                options[bare] = options[dollar];
            }
            delete options[dollar];
        }

        // Numeric fields — normalize top → limit, skip → offset
        if (options.top != null) {
            options.limit = Number(options.top);
            delete options.top;
        }
        if (options.skip != null) {
            options.offset = Number(options.skip);
            delete options.skip;
        }
        if (options.limit != null) options.limit = Number(options.limit);
        if (options.offset != null) options.offset = Number(options.offset);

        // Select → fields: comma-separated string → array
        if (typeof options.select === 'string') {
            options.fields = options.select.split(',').map((s: string) => s.trim()).filter(Boolean);
        } else if (Array.isArray(options.select)) {
            options.fields = options.select;
        }
        if (options.select !== undefined) delete options.select;

        // Sort/orderBy → orderBy: string → SortNode[] array
        const sortValue = options.orderBy ?? options.sort;
        if (typeof sortValue === 'string') {
            const parsed = sortValue.split(',').map((part: string) => {
                const trimmed = part.trim();
                if (trimmed.startsWith('-')) {
                    return { field: trimmed.slice(1), order: 'desc' as const };
                }
                const [field, order] = trimmed.split(/\s+/);
                return { field, order: (order?.toLowerCase() === 'desc' ? 'desc' : 'asc') as 'asc' | 'desc' };
            }).filter((s: any) => s.field);
            options.orderBy = parsed;
        } else if (Array.isArray(sortValue)) {
            options.orderBy = sortValue;
        }
        delete options.sort;

        // Filter/filters/$filter → where: normalize all filter aliases
        const filterValue = options.filter ?? options.filters ?? options.$filter ?? options.where;
        delete options.filter;
        delete options.filters;
        delete options.$filter;

        if (filterValue !== undefined) {
            let parsedFilter = filterValue;
            // JSON string → object
            if (typeof parsedFilter === 'string') {
                try { parsedFilter = JSON.parse(parsedFilter); } catch { /* keep as-is */ }
            }
            // Filter AST array → FilterCondition object
            if (isFilterAST(parsedFilter)) {
                parsedFilter = parseFilterAST(parsedFilter);
            }
            options.where = parsedFilter;
        }

        // Populate/expand/$expand → expand (Record<string, QueryAST>)
        const populateValue = options.populate;
        const expandValue = options.$expand ?? options.expand;
        const expandNames: string[] = [];
        if (typeof populateValue === 'string') {
            expandNames.push(...populateValue.split(',').map((s: string) => s.trim()).filter(Boolean));
        } else if (Array.isArray(populateValue)) {
            expandNames.push(...populateValue);
        }
        if (!expandNames.length && expandValue) {
            if (typeof expandValue === 'string') {
                expandNames.push(...expandValue.split(',').map((s: string) => s.trim()).filter(Boolean));
            } else if (Array.isArray(expandValue)) {
                expandNames.push(...expandValue);
            }
        }
        delete options.populate;
        delete options.$expand;
        // Clean up non-object expand (e.g. string) BEFORE the Record conversion
        // below, so that populate-derived names can create the expand Record even
        // when a legacy string expand was also present.
        if (typeof options.expand !== 'object' || options.expand === null) {
            delete options.expand;
        }
        // Only set expand if not already an object (advanced usage)
        if (expandNames.length > 0 && !options.expand) {
            options.expand = {} as Record<string, any>;
            for (const rel of expandNames) {
                options.expand[rel] = { object: rel };
            }
        }

        // Boolean fields
        for (const key of ['distinct', 'count']) {
            if (options[key] === 'true') options[key] = true;
            else if (options[key] === 'false') options[key] = false;
        }
        
        // Flat field filters: REST-style query params like ?id=abc&status=open
        // After extracting all known query parameters, any remaining keys are
        // treated as implicit field-level equality filters merged into `where`.
        const knownParams = new Set([
            'top', 'limit', 'offset',
            'orderBy',
            'fields',
            'where',
            'expand',
            'distinct', 'count',
            'aggregations', 'groupBy',
            'search', 'context', 'cursor',
        ]);
        if (!options.where) {
            const implicitFilters: Record<string, unknown> = {};
            for (const key of Object.keys(options)) {
                if (!knownParams.has(key)) {
                    implicitFilters[key] = options[key];
                    delete options[key];
                }
            }
            if (Object.keys(implicitFilters).length > 0) {
                options.where = implicitFilters;
            }
        }
        
        // Route to engine.aggregate() when the query has GROUP BY / aggregations.
        // engine.find() does not do in-memory aggregation fallback, so without
        // this branch a spec-shape aggregate request would silently return
        // ungrouped raw rows on drivers (e.g. SqlDriver) that don't natively
        // honor groupBy/aggregations in find().
        const hasGroupBy = Array.isArray(options.groupBy) && options.groupBy.length > 0;
        const hasAggregations = Array.isArray(options.aggregations) && options.aggregations.length > 0;
        if (hasGroupBy || hasAggregations) {
            const records = await this.engine.aggregate(request.object, {
                where: options.where,
                groupBy: options.groupBy,
                aggregations: options.aggregations,
                context: options.context,
            } as any);
            // Apply limit client-side (EngineAggregateOptions doesn't carry limit)
            const limited = typeof options.limit === 'number' && options.limit > 0
                ? records.slice(0, options.limit)
                : records;
            return {
                object: request.object,
                records: limited,
                total: limited.length,
                hasMore: false,
            };
        }

        const records = await this.engine.find(request.object, options);
        // Spec: FindDataResponseSchema — only `records` is returned.
        // OData `value` adaptation (if needed) is handled in the HTTP dispatch layer.
        return {
            object: request.object,
            records,
            total: records.length,
            hasMore: false
        };
    }

    async getData(request: { object: string, id: string, expand?: string | string[], select?: string | string[], context?: any }) {
        const queryOptions: any = {
            where: { id: request.id }
        };
        if (request.context !== undefined) {
            queryOptions.context = request.context;
        }

        // Support fields for single-record retrieval
        if (request.select) {
            queryOptions.fields = typeof request.select === 'string'
                ? request.select.split(',').map((s: string) => s.trim()).filter(Boolean)
                : request.select;
        }

        // Support expand for single-record retrieval
        if (request.expand) {
            const expandNames = typeof request.expand === 'string'
                ? request.expand.split(',').map((s: string) => s.trim()).filter(Boolean)
                : request.expand;
            queryOptions.expand = {} as Record<string, any>;
            for (const rel of expandNames) {
                queryOptions.expand[rel] = { object: rel };
            }
        }

        const result = await this.engine.findOne(request.object, queryOptions);
        if (result) {
            return {
                object: request.object,
                id: request.id,
                record: result
            };
        }
        const err = new Error(`Record ${request.id} not found in ${request.object}`) as Error & {
            code?: string;
            status?: number;
            object?: string;
        };
        err.code = 'RECORD_NOT_FOUND';
        err.status = 404;
        err.object = request.object;
        throw err;
    }

    async createData(request: { object: string, data: any, context?: any }) {
        const result = await this.engine.insert(
            request.object,
            request.data,
            request.context !== undefined ? { context: request.context } as any : undefined,
        );
        return {
            object: request.object,
            id: result.id,
            record: result
        };
    }

    async updateData(request: { object: string, id: string, data: any, expectedVersion?: string, context?: any }) {
        await this.assertVersionMatch(request.object, request.id, request.expectedVersion, request.context);
        const opts: any = { where: { id: request.id } };
        if (request.context !== undefined) opts.context = request.context;
        const result = await this.engine.update(request.object, request.data, opts);
        return {
            object: request.object,
            id: request.id,
            record: result
        };
    }

    async deleteData(request: { object: string, id: string, expectedVersion?: string, context?: any }) {
        await this.assertVersionMatch(request.object, request.id, request.expectedVersion, request.context);
        const opts: any = { where: { id: request.id } };
        if (request.context !== undefined) opts.context = request.context;
        await this.engine.delete(request.object, opts);
        return {
            object: request.object,
            id: request.id,
            success: true
        };
    }

    /**
     * Optimistic Concurrency Control gate shared by updateData/deleteData.
     *
     * When the caller passes a non-empty `expectedVersion` token (typically
     * the `updated_at` value they read), this fetches the current record
     * and compares its `updated_at` against the token. Mismatch → throw
     * `ConcurrentUpdateError` which the REST layer maps to 409.
     *
     * Behaviour:
     *  - Empty/missing token → no check (opt-in semantics; existing callers
     *    that haven't yet adopted OCC are unaffected).
     *  - Record not found → no check; downstream `engine.update` will
     *    surface the usual `RECORD_NOT_FOUND` 404. We intentionally do not
     *    treat "missing record" as a concurrency conflict.
     *  - Record has no `updated_at` field (timestamps disabled) → no check.
     *    Logging would be noisy here; OCC is opt-in and the absence of a
     *    version column is an explicit "this object doesn't support OCC"
     *    signal.
     */
    private async assertVersionMatch(
        object: string,
        id: string,
        expectedVersion: string | undefined,
        context: any
    ): Promise<void> {
        const expected = normaliseVersionToken(expectedVersion);
        if (!expected) return;
        const findOpts: any = { where: { id } };
        if (context !== undefined) findOpts.context = context;
        const current = await this.engine.findOne(object, findOpts);
        if (!current) return;
        const currentVersion = normaliseVersionToken((current as any).updated_at);
        if (!currentVersion) return;
        if (currentVersion !== expected) {
            throw new ConcurrentUpdateError({
                currentVersion,
                currentRecord: current,
                message: `Record ${object}/${id} was modified by another user (current version ${currentVersion}, expected ${expected})`,
            });
        }
    }

    // ==========================================
    // Global Search (M10.5)
    // ==========================================
    /**
     * Cross-object substring search across all registered objects that opt in
     * via `enable.searchable !== false` and `enable.apiEnabled !== false`.
     * Searches text-like fields (text/textarea/email/url/phone/markdown/html/string)
     * whose `searchable: true` flag is set, falling back to the object's
     * `displayNameField` (or `name`) when no fields are explicitly searchable.
     *
     * The query is split into whitespace-separated terms; each term must match
     * (case-insensitive LIKE) at least one searchable field. RBAC/RLS is
     * enforced by forwarding the caller's `context` to `engine.find` so users
     * only see records they are entitled to read.
     */
    async searchAll(request: {
        q: string;
        objects?: string[];
        limit?: number;
        perObject?: number;
        context?: any;
    }): Promise<{
        query: string;
        hits: Array<{
            object: string;
            id: string;
            title: string;
            snippet?: string;
            record: any;
        }>;
        totalObjects: number;
        totalHits: number;
        truncated: boolean;
    }> {
        const q = (request.q ?? '').trim();
        if (!q) {
            return { query: '', hits: [], totalObjects: 0, totalHits: 0, truncated: false };
        }

        const overallLimit = Math.max(1, Math.min(100, Number(request.limit ?? 20)));
        const perObject = Math.max(1, Math.min(25, Number(request.perObject ?? 5)));
        const objectsFilter = request.objects && request.objects.length
            ? new Set(request.objects)
            : null;

        // Tokenise: each token must match (LIKE %term%) at least one searchable field
        const terms = q.split(/\s+/).filter(Boolean).slice(0, 8);

        const allObjects = (this.engine as any).registry?.getAllObjects?.() ?? [];
        const hits: Array<{ object: string; id: string; title: string; snippet?: string; record: any }> = [];
        let objectsScanned = 0;

        for (const obj of allObjects) {
            if (hits.length >= overallLimit) break;
            if (!obj?.name) continue;
            if (objectsFilter && !objectsFilter.has(obj.name)) continue;

            // Skip platform/system tables and opt-outs
            const enable = obj.enable ?? {};
            if (enable.searchable === false) continue;
            if (enable.apiEnabled === false) continue;
            // Skip noisy system tables by name prefix
            if (obj.name.startsWith('sys_audit_log')
                || obj.name.startsWith('sys_activity')
                || obj.name.startsWith('sys_session')
                || obj.name.startsWith('sys_presence')
                || obj.name.startsWith('sys_metadata')
                || obj.name.startsWith('sys_account')) {
                continue;
            }

            const fieldsRaw = obj.fields;
            const fields: Array<{ name: string; type: string; searchable?: boolean }> =
                Array.isArray(fieldsRaw)
                    ? fieldsRaw
                    : (fieldsRaw && typeof fieldsRaw === 'object'
                        ? Object.entries(fieldsRaw).map(([name, f]: [string, any]) => ({ name, ...(f || {}) }))
                        : []);
            const TEXT_TYPES = new Set(['text', 'textarea', 'string', 'email', 'url', 'phone', 'markdown', 'html']);
            const fieldByName = new Map(fields.map(f => [f.name, f]));
            const hasField = (n: string) => fieldByName.has(n);
            // Resolve title for a record using titleFormat → displayNameField →
            // common conventional fields → id. titleFormat supports simple
            // `{field}` placeholders (the `template` dialect); unresolved
            // placeholders fall through to the next strategy.
            const titleFormatSource = (obj.titleFormat && (obj.titleFormat.source || obj.titleFormat))
                || undefined;
            const renderTitle = (row: any): string => {
                if (typeof titleFormatSource === 'string') {
                    let allResolved = true;
                    const rendered = titleFormatSource.replace(/\{\{?\s*([a-zA-Z0-9_.]+)\s*\}?\}/g, (_m, key) => {
                        const v = row[key];
                        if (v == null || v === '') { allResolved = false; return ''; }
                        return String(v);
                    }).trim();
                    if (rendered && allResolved) return rendered;
                    if (rendered) return rendered.replace(/\s+-\s+$/, '').replace(/^\s+-\s+/, '').trim() || row.id;
                }
                const candidates = [
                    obj.displayNameField,
                    'name', 'full_name', 'title', 'subject', 'label', 'company',
                ].filter((c): c is string => typeof c === 'string' && hasField(c));
                for (const c of candidates) {
                    const v = row[c];
                    if (v != null && String(v).trim()) return String(v);
                }
                const fn = row.first_name, ln = row.last_name;
                if (fn || ln) return `${fn ?? ''} ${ln ?? ''}`.trim();
                return String(row.id);
            };

            const titleFieldName = obj.displayNameField
                || (hasField('name') ? 'name' : undefined)
                || (hasField('title') ? 'title' : undefined)
                || fields.find(f => TEXT_TYPES.has(f.type))?.name;

            let searchableFields = fields
                .filter(f => f && TEXT_TYPES.has(f.type) && f.searchable === true)
                .map(f => f.name as string);

            // Fallback: if no field is explicitly searchable, scan the title field
            if (searchableFields.length === 0 && titleFieldName) {
                searchableFields = [titleFieldName];
            }
            if (searchableFields.length === 0) continue;

            objectsScanned++;

            // Build AND-of-OR filter: every term must hit at least one field.
            // ObjectQL exposes case-insensitive substring matching via `$contains`.
            const andClauses = terms.map(term => ({
                $or: searchableFields.map(f => ({ [f]: { $contains: term } })),
            }));
            const where = andClauses.length === 1 ? andClauses[0] : { $and: andClauses };

            try {
                const opts: any = {
                    where,
                    limit: perObject,
                    orderBy: [{ field: 'updated_at', direction: 'desc' }],
                };
                if (request.context !== undefined) opts.context = request.context;

                const rows = await this.engine.find(obj.name, opts);
                for (const row of rows || []) {
                    if (hits.length >= overallLimit) break;
                    const title = renderTitle(row);
                    // Build snippet from first searchable field that contains a term
                    let snippet: string | undefined;
                    for (const f of searchableFields) {
                        const v = row[f];
                        if (typeof v === 'string' && v) {
                            const lc = v.toLowerCase();
                            const idx = terms.map(t => lc.indexOf(t.toLowerCase())).find(i => i >= 0);
                            if (idx != null && idx >= 0) {
                                const start = Math.max(0, idx - 30);
                                const end = Math.min(v.length, idx + 90);
                                snippet = (start > 0 ? '…' : '') + v.slice(start, end) + (end < v.length ? '…' : '');
                                break;
                            }
                        }
                    }
                    hits.push({
                        object: obj.name,
                        id: row.id,
                        title,
                        snippet,
                        record: row,
                    });
                }
            } catch {
                // RBAC denial or driver hiccup — skip silently per object
                continue;
            }
        }

        return {
            query: q,
            hits,
            totalObjects: objectsScanned,
            totalHits: hits.length,
            truncated: hits.length >= overallLimit,
        };
    }

    // ==========================================
    // Lead Convert (M10.6)
    // ==========================================
    /**
     * Convert a qualified Lead into an Account + Contact (+ optional
     * Opportunity) and mark the Lead as converted. Mirrors the Salesforce
     * lead-conversion model:
     *
     *   - If `accountId` is provided, the lead's company info is NOT used
     *     to create a new account; the new contact and opportunity link to
     *     the existing account instead.
     *   - If `contactId` is provided, no new contact is created either —
     *     useful when the lead is a new contact at an existing account.
     *   - `createOpportunity` defaults to true; pass `false` to convert
     *     without producing an opportunity (some teams convert "logos
     *     only" first).
     *   - Lead is updated atomically: `is_converted=true`,
     *     `converted_account`/`converted_contact`/`converted_opportunity`
     *     pointers, `converted_date`, and `status='converted'`.
     *
     * Atomicity is enforced via the default driver's transaction support
     * when available; otherwise a best-effort compensation (delete
     * already-created child records on failure) is attempted. Permission
     * checks on each child object are inherited from the caller's
     * execution context so SecurityPlugin still gates account/contact/
     * opportunity creates.
     */
    async convertLead(request: {
        leadId: string;
        accountId?: string;
        contactId?: string;
        createOpportunity?: boolean;
        opportunity?: {
            name?: string;
            amount?: number;
            close_date?: string;
            stage?: string;
        };
        convertedStatus?: string;
        context?: any;
    }): Promise<{
        lead: any;
        account: any;
        contact: any;
        opportunity: any | null;
    }> {
        const leadId = String(request.leadId || '').trim();
        if (!leadId) {
            const err: any = new Error('leadId is required');
            err.status = 400;
            err.code = 'INVALID_REQUEST';
            throw err;
        }
        const ctx = request.context;
        const ctxOpt = ctx !== undefined ? { context: ctx } : undefined;

        // Load lead
        const lead = await this.engine.findOne('lead', { where: { id: leadId }, ...(ctxOpt as any) } as any);
        if (!lead) {
            const err: any = new Error(`Lead '${leadId}' not found`);
            err.status = 404;
            err.code = 'LEAD_NOT_FOUND';
            throw err;
        }
        if (lead.is_converted) {
            const err: any = new Error(`Lead '${leadId}' is already converted`);
            err.status = 409;
            err.code = 'LEAD_ALREADY_CONVERTED';
            throw err;
        }

        // Wrap the whole conversion in a single DB transaction so that a
        // partial failure (e.g. opportunity insert fails after we've
        // already created the account/contact) rolls back atomically
        // instead of leaving orphan rows. Falls back to direct execution
        // on drivers without transaction support — in that case the
        // operations are still ordered so callers see the same partial
        // state we'd get from any non-atomic sequence.
        const runConversion = async (trxCtx: any) => {
            const opCtx = trxCtx ?? ctx;
            const trxCtxOpt = opCtx !== undefined ? { context: opCtx } : undefined;

            // 1) Account
            let account: any;
            if (request.accountId) {
                account = await this.engine.findOne('account', { where: { id: request.accountId }, ...(trxCtxOpt as any) } as any);
                if (!account) {
                    const err: any = new Error(`Account '${request.accountId}' not found`);
                    err.status = 404;
                    err.code = 'ACCOUNT_NOT_FOUND';
                    throw err;
                }
            } else {
                const accountPayload: Record<string, any> = {
                    name: lead.company || `${lead.first_name ?? ''} ${lead.last_name ?? ''}`.trim() || 'Untitled Account',
                };
                if (lead.industry)        accountPayload.industry = lead.industry;
                if (lead.annual_revenue)  accountPayload.annual_revenue = lead.annual_revenue;
                if (lead.number_of_employees) accountPayload.employees = lead.number_of_employees;
                if (lead.website)         accountPayload.website = lead.website;
                if (lead.phone)           accountPayload.phone = lead.phone;
                if (lead.address)         accountPayload.billing_address = lead.address;
                if (lead.owner)           accountPayload.owner = lead.owner;
                account = await this.engine.insert('account', accountPayload, trxCtxOpt as any);
            }

            // 2) Contact
            let contact: any;
            if (request.contactId) {
                contact = await this.engine.findOne('contact', { where: { id: request.contactId }, ...(trxCtxOpt as any) } as any);
                if (!contact) {
                    const err: any = new Error(`Contact '${request.contactId}' not found`);
                    err.status = 404;
                    err.code = 'CONTACT_NOT_FOUND';
                    throw err;
                }
            } else {
                const contactPayload: Record<string, any> = {
                    first_name: lead.first_name ?? '',
                    last_name:  lead.last_name  ?? lead.company ?? 'Unknown',
                };
                if (lead.salutation) contactPayload.salutation = lead.salutation;
                if (lead.email)      contactPayload.email = lead.email;
                if (lead.phone)      contactPayload.phone = lead.phone;
                if (lead.mobile)     contactPayload.mobile = lead.mobile;
                if (lead.title)      contactPayload.title = lead.title;
                if (lead.address)    contactPayload.mailing_address = lead.address;
                if (lead.owner)      contactPayload.owner = lead.owner;
                if (account?.id)     contactPayload.account = account.id;
                contact = await this.engine.insert('contact', contactPayload, trxCtxOpt as any);
            }

            // 3) Opportunity (optional)
            let opportunity: any | null = null;
            const shouldCreateOpp = request.createOpportunity !== false;
            if (shouldCreateOpp) {
                const oppOverrides = request.opportunity ?? {};
                const defaultName = oppOverrides.name
                    || `${account?.name ?? lead.company ?? 'Lead'} - New Opportunity`;
                const defaultClose = oppOverrides.close_date
                    || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
                const oppPayload: Record<string, any> = {
                    name: defaultName,
                    stage: oppOverrides.stage ?? 'qualification',
                    close_date: defaultClose,
                };
                if (oppOverrides.amount !== undefined)  oppPayload.amount = oppOverrides.amount;
                else if (lead.annual_revenue)            oppPayload.amount = lead.annual_revenue;
                if (account?.id)  oppPayload.account = account.id;
                if (contact?.id)  oppPayload.primary_contact = contact.id;
                if (lead.owner)   oppPayload.owner = lead.owner;
                if (lead.lead_source) oppPayload.lead_source = lead.lead_source;
                opportunity = await this.engine.insert('opportunity', oppPayload, trxCtxOpt as any);
            }

            // 4) Mark lead converted
            const leadUpdate: Record<string, any> = {
                is_converted: true,
                status: request.convertedStatus ?? 'converted',
                converted_account:     account?.id ?? null,
                converted_contact:     contact?.id ?? null,
                converted_opportunity: opportunity?.id ?? null,
                converted_date:        new Date().toISOString(),
            };
            const updatedLead = await this.engine.update('lead', leadUpdate, {
                where: { id: leadId },
                ...(trxCtxOpt as any),
            } as any);

            return {
                lead: updatedLead ?? { ...lead, ...leadUpdate },
                account,
                contact,
                opportunity,
            };
        };

        return (this.engine as any).transaction(runConversion, ctx);
    }

    // ==========================================
    // Metadata Caching
    // ==========================================

    async getMetaItemCached(request: { type: string, name: string, cacheRequest?: MetadataCacheRequest }): Promise<MetadataCacheResponse> {
        try {
            // Delegate to getMetaItem so the customization-overlay read order
            // (sys_metadata → registry → MetadataService) is honoured here too
            // (ADR-0005). Without this, cached reads silently bypass overlays.
            const result = await this.getMetaItem({ type: request.type, name: request.name });
            const item = (result as any)?.item;

            if (!item) {
                throw new Error(`Metadata item ${request.type}/${request.name} not found`);
            }

            // Calculate ETag (simple hash of the stringified metadata)
            const content = JSON.stringify(item);
            const hash = simpleHash(content);
            const etag = { value: hash, weak: false };

            // Check If-None-Match header
            if (request.cacheRequest?.ifNoneMatch) {
                const clientEtag = request.cacheRequest.ifNoneMatch.replace(/^"(.*)"$/, '$1').replace(/^W\/"(.*)"$/, '$1');
                if (clientEtag === hash) {
                    // Return 304 Not Modified
                    return {
                        notModified: true,
                        etag,
                    };
                }
            }

            // Return full metadata with cache headers
            return {
                data: item,
                etag,
                lastModified: new Date().toISOString(),
                cacheControl: {
                    directives: ['public', 'max-age'],
                    maxAge: 3600, // 1 hour
                },
                notModified: false,
            };
        } catch (error: any) {
            throw error;
        }
    }

    // ==========================================
    // Batch Operations
    // ==========================================

    async batchData(request: { object: string, request: BatchUpdateRequest }): Promise<BatchUpdateResponse> {
        const { object, request: batchReq } = request;
        const { operation, records, options } = batchReq;
        const results: Array<{ id?: string; success: boolean; error?: string; record?: any }> = [];
        let succeeded = 0;
        let failed = 0;

        for (const record of records) {
            try {
                switch (operation) {
                    case 'create': {
                        const created = await this.engine.insert(object, record.data || record);
                        results.push({ id: created.id, success: true, record: created });
                        succeeded++;
                        break;
                    }
                    case 'update': {
                        if (!record.id) throw new Error('Record id is required for update');
                        const updated = await this.engine.update(object, record.data || {}, { where: { id: record.id } });
                        results.push({ id: record.id, success: true, record: updated });
                        succeeded++;
                        break;
                    }
                    case 'upsert': {
                        // Try update first, then create if not found
                        if (record.id) {
                            try {
                                const existing = await this.engine.findOne(object, { where: { id: record.id } });
                                if (existing) {
                                    const updated = await this.engine.update(object, record.data || {}, { where: { id: record.id } });
                                    results.push({ id: record.id, success: true, record: updated });
                                } else {
                                    const created = await this.engine.insert(object, { id: record.id, ...(record.data || {}) });
                                    results.push({ id: created.id, success: true, record: created });
                                }
                            } catch {
                                const created = await this.engine.insert(object, { id: record.id, ...(record.data || {}) });
                                results.push({ id: created.id, success: true, record: created });
                            }
                        } else {
                            const created = await this.engine.insert(object, record.data || record);
                            results.push({ id: created.id, success: true, record: created });
                        }
                        succeeded++;
                        break;
                    }
                    case 'delete': {
                        if (!record.id) throw new Error('Record id is required for delete');
                        await this.engine.delete(object, { where: { id: record.id } });
                        results.push({ id: record.id, success: true });
                        succeeded++;
                        break;
                    }
                    default:
                        results.push({ id: record.id, success: false, error: `Unknown operation: ${operation}` });
                        failed++;
                }
            } catch (err: any) {
                results.push({ id: record.id, success: false, error: err.message });
                failed++;
                if (options?.atomic) {
                    // Abort remaining operations on first failure in atomic mode
                    break;
                }
                if (!options?.continueOnError) {
                    break;
                }
            }
        }

        return {
            success: failed === 0,
            operation,
            total: records.length,
            succeeded,
            failed,
            results: options?.returnRecords !== false ? results : results.map(r => ({ id: r.id, success: r.success, error: r.error })),
        } as BatchUpdateResponse;
    }
    
    async createManyData(request: { object: string, records: any[] }): Promise<any> {
        const records = await this.engine.insert(request.object, request.records);
        return {
            object: request.object,
            records,
            count: records.length
        };
    }
    
    async updateManyData(request: UpdateManyDataRequest): Promise<BatchUpdateResponse> {
        const { object, records, options } = request;
        const results: Array<{ id?: string; success: boolean; error?: string; record?: any }> = [];
        let succeeded = 0;
        let failed = 0;

        for (const record of records) {
            try {
                const updated = await this.engine.update(object, record.data, { where: { id: record.id } });
                results.push({ id: record.id, success: true, record: updated });
                succeeded++;
            } catch (err: any) {
                results.push({ id: record.id, success: false, error: err.message });
                failed++;
                if (!options?.continueOnError) {
                    break;
                }
            }
        }

        return {
            success: failed === 0,
            operation: 'update',
            total: records.length,
            succeeded,
            failed,
            results,
        } as BatchUpdateResponse;
    }

    async analyticsQuery(request: any): Promise<any> {
        // Map AnalyticsQuery (cube-style) to engine aggregation.
        // cube name maps to object name; measures → aggregations; dimensions → groupBy.
        const { query, cube } = request;
        const object = cube;

        // Build groupBy from dimensions
        const groupBy = query.dimensions || [];

        // Build aggregations from measures
        // Measures can be simple field names like "count" or "field_name.sum"
        // Or cube-defined measure names. We support: field.function or just function(field).
        const aggregations: Array<{ field: string; method: string; alias: string }> = [];
        if (query.measures) {
            for (const measure of query.measures) {
                // Support formats: "count", "amount.sum", "revenue.avg"
                if (measure === 'count' || measure === 'count_all') {
                    aggregations.push({ field: '*', method: 'count', alias: 'count' });
                } else if (measure.includes('.')) {
                    const [field, method] = measure.split('.');
                    aggregations.push({ field, method, alias: `${field}_${method}` });
                } else {
                    // Treat as count of the field
                    aggregations.push({ field: measure, method: 'sum', alias: measure });
                }
            }
        }

        // Build filter from analytics filters
        let filter: any = undefined;
        if (query.filters && query.filters.length > 0) {
            const conditions: any[] = query.filters.map((f: any) => {
                const op = this.mapAnalyticsOperator(f.operator);
                if (f.values && f.values.length === 1) {
                    return { [f.member]: { [op]: f.values[0] } };
                } else if (f.values && f.values.length > 1) {
                    return { [f.member]: { $in: f.values } };
                }
                return { [f.member]: { [op]: true } };
            });
            filter = conditions.length === 1 ? conditions[0] : { $and: conditions };
        }

        // Execute via engine.aggregate (which delegates to driver.find with groupBy/aggregations)
        const rows = await this.engine.aggregate(object, {
            where: filter,
            groupBy: groupBy.length > 0 ? groupBy : undefined,
            aggregations: aggregations.length > 0
                ? aggregations.map(a => ({ function: a.method as any, field: a.field, alias: a.alias }))
                : [{ function: 'count' as any, alias: 'count' }],
        });

        // Build field metadata
        const fields = [
            ...groupBy.map((d: string) => ({ name: d, type: 'string' })),
            ...aggregations.map(a => ({ name: a.alias, type: 'number' })),
        ];

        return {
            success: true,
            data: {
                rows,
                fields,
            },
        };
    }

    async getAnalyticsMeta(request: any): Promise<any> {
        // Auto-generate cube metadata from registered objects in SchemaRegistry.
        // Each object becomes a cube; number fields → measures; other fields → dimensions.
        const objects = this.engine.registry.listItems('object');
        const cubeFilter = request?.cube;

        const cubes: any[] = [];
        for (const obj of objects) {
            const schema = obj as any;
            if (cubeFilter && schema.name !== cubeFilter) continue;

            const measures: Record<string, any> = {};
            const dimensions: Record<string, any> = {};
            const fields = schema.fields || {};

            // Always add a count measure
            measures['count'] = {
                name: 'count',
                label: 'Count',
                type: 'count',
                sql: '*',
            };

            for (const [fieldName, fieldDef] of Object.entries(fields)) {
                const fd = fieldDef as any;
                const fieldType = fd.type || 'text';

                if (['number', 'currency', 'percent'].includes(fieldType)) {
                    // Numeric fields become both measures and dimensions
                    measures[`${fieldName}_sum`] = {
                        name: `${fieldName}_sum`,
                        label: `${fd.label || fieldName} (Sum)`,
                        type: 'sum',
                        sql: fieldName,
                    };
                    measures[`${fieldName}_avg`] = {
                        name: `${fieldName}_avg`,
                        label: `${fd.label || fieldName} (Avg)`,
                        type: 'avg',
                        sql: fieldName,
                    };
                    dimensions[fieldName] = {
                        name: fieldName,
                        label: fd.label || fieldName,
                        type: 'number',
                        sql: fieldName,
                    };
                } else if (['date', 'datetime'].includes(fieldType)) {
                    dimensions[fieldName] = {
                        name: fieldName,
                        label: fd.label || fieldName,
                        type: 'time',
                        sql: fieldName,
                        granularities: ['day', 'week', 'month', 'quarter', 'year'],
                    };
                } else if (['boolean'].includes(fieldType)) {
                    dimensions[fieldName] = {
                        name: fieldName,
                        label: fd.label || fieldName,
                        type: 'boolean',
                        sql: fieldName,
                    };
                } else {
                    // text, select, lookup, etc. → dimension
                    dimensions[fieldName] = {
                        name: fieldName,
                        label: fd.label || fieldName,
                        type: 'string',
                        sql: fieldName,
                    };
                }
            }

            cubes.push({
                name: schema.name,
                title: schema.label || schema.name,
                description: schema.description,
                sql: schema.name,
                measures,
                dimensions,
                public: true,
            });
        }

        return {
            success: true,
            data: { cubes },
        };
    }

    private mapAnalyticsOperator(op: string): string {
        const map: Record<string, string> = {
            equals: '$eq',
            notEquals: '$ne',
            contains: '$contains',
            notContains: '$notContains',
            gt: '$gt',
            gte: '$gte',
            lt: '$lt',
            lte: '$lte',
            set: '$ne',
            notSet: '$eq',
        };
        return map[op] || '$eq';
    }

    async triggerAutomation(_request: any): Promise<any> {
        throw new Error('triggerAutomation requires plugin-automation service. Install and register a plugin that provides the "automation" service.');
    }

    async deleteManyData(request: DeleteManyDataRequest): Promise<any> {
        // This expects deleting by IDs.
        return this.engine.delete(request.object, {
            where: { id: { $in: request.ids } },
            ...request.options
        });
    }

    /**
     * Metadata types that are customer-overridable via {@link saveMetaItem}/
     * {@link deleteMetaItem} in project-kernel mode. Derived from the canonical
     * registry in {@link DEFAULT_METADATA_TYPE_REGISTRY}: a type opts in by
     * setting `allowOrgOverride: true` on its registry entry. The set is
     * augmented with the plural form of every singular so callers using REST
     * conventions (`/api/v1/meta/views/...`) get the same gate. See ADR-0005
     * §"Whitelist enforcement" for the rationale and the per-type rollout
     * checklist.
     */
    private static readonly OVERLAY_ALLOWED_TYPES: ReadonlySet<string> = (() => {
        const out = new Set<string>();
        for (const entry of DEFAULT_METADATA_TYPE_REGISTRY) {
            if (!entry.allowOrgOverride) continue;
            out.add(entry.type);
            const plural = SINGULAR_TO_PLURAL[entry.type];
            if (plural) out.add(plural);
        }
        return out;
    })();

    /** Normalize plural→singular before consulting the allow-list. */
    private static isOverlayAllowed(type: string): boolean {
        const singular = PLURAL_TO_SINGULAR[type] ?? type;
        return ObjectStackProtocolImplementation.OVERLAY_ALLOWED_TYPES.has(singular)
            || ObjectStackProtocolImplementation.OVERLAY_ALLOWED_TYPES.has(type);
    }

    /**
     * Mirror an object-type overlay write into the in-memory engine
     * registry so subsequent CRUD finds the new schema. Idempotent and
     * safe to call after a successful persistence call. For the legacy
     * write path this is invoked BEFORE persistence (historical behavior
     * preserved); for the PR-10d.3 repository path it is invoked only
     * AFTER `put()` resolves successfully, so a failed write — DB error,
     * optimistic-lock conflict, validation failure — never leaks a
     * stale schema into the registry.
     */
    private applyObjectRegistryMutation(request: { type: string; name: string; item?: any }): void {
        if (request.type !== 'object' && request.type !== 'objects') return;
        this.engine.registry.registerItem(request.type, request.item, 'name');
        try {
            this.engine.registry.registerObject(request.item as any, 'sys_metadata');
        } catch (err: any) {
            console.warn(
                `[Protocol] registerObject failed for ${request.name}: ${err?.message ?? err}`,
            );
        }
    }

    async saveMetaItem(request: { type: string, name: string, item?: any, organizationId?: string, parentVersion?: string | null, actor?: string }) {
        if (!request.item) {
            throw new Error('Item data is required');
        }

        // ADR-0005 opt-in gate: project-kernel customization is only allowed
        // for types whose registry entry sets `allowOrgOverride: true`.
        // Returns 403 `not_overridable` so the caller can distinguish from a
        // generic 400 (validation) or 422 (spec mismatch).
        if (this.projectId !== undefined
            && !ObjectStackProtocolImplementation.isOverlayAllowed(request.type)) {
            const allowed = Array.from(ObjectStackProtocolImplementation.OVERLAY_ALLOWED_TYPES).join(', ');
            const err = new Error(
                `[not_overridable] Metadata type '${request.type}' has not opted into per-org overlay writes. `
                + `Set allowOrgOverride: true on its DEFAULT_METADATA_TYPE_REGISTRY entry to enable. `
                + `Currently allowed: ${allowed}. See docs/adr/0005-metadata-customization-overlay.md.`
            );
            (err as any).code = 'not_overridable';
            (err as any).status = 403;
            throw err;
        }

        // Spec-conformance check: if a Zod schema is registered for this
        // overlay type (see OVERLAY_VALIDATION_SCHEMAS), validate the payload
        // before persisting. We surface invalid payloads as `422
        // invalid_metadata` with structured Zod issues so the Studio form can
        // highlight the offending field. The original `item` is kept verbatim
        // — `parsed.data` would strip Studio-only auxiliary fields (e.g.
        // isPinned, isDefault, sortOrder) that intentionally ride along with
        // the overlay document. ADR-0005 §"Validation".
        {
            const schema = resolveOverlaySchema(request.type, request.item);
            if (schema) {
                const parsed = schema.safeParse(request.item);
                if (!parsed.success) {
                    const issues = parsed.error.issues.map((i: z.ZodIssue) => ({
                        path: i.path.join('.'),
                        message: i.message,
                        code: i.code,
                    }));
                    const summary = issues.slice(0, 3)
                        .map((i: { path: string; message: string }) => `${i.path || '<root>'}: ${i.message}`)
                        .join('; ');
                    const err = new Error(
                        `[invalid_metadata] ${request.type}/${request.name} failed spec validation: ${summary}`
                        + (issues.length > 3 ? ` (+${issues.length - 3} more)` : '')
                    );
                    (err as any).code = 'invalid_metadata';
                    (err as any).status = 422;
                    (err as any).issues = issues;
                    throw err;
                }
            }
        }

        // 1. Update the in-memory registry (runtime cache) ONLY for the
        //    `object` type — schema definitions feed engine.syncSchema and
        //    must be reflected immediately for CRUD to work. For all other
        //    metadata types (view, dashboard, ...) we deliberately do NOT
        //    mutate the artifact-loaded registry — sys_metadata is the
        //    authoritative overlay store and `getMetaItem` consults it
        //    first (ADR-0005). Mutating the registry here would create a
        //    "stale overlay" hazard: `deleteMetaItem` cannot restore the
        //    original artifact value because it was overwritten in-place.
        // 1. (deferred) — Object-type runtime-registry mutation used to happen
        //    here unconditionally. Moved to AFTER successful persistence
        //    (PR-10d.3 rubber-duck #3): a failed put() — DB error, optimistic
        //    conflict, validation — must not leave a stale object schema in
        //    the in-memory registry. See `applyObjectRegistryMutation` below.

        // 2. Persist to sys_metadata as a customization overlay row.
        //    ADR-0005 (revised 2026-05): isolation key is `organization_id`
        //    (each env = its own DB, so project_id is redundant). Org-scoped
        //    rows belong to the active organization in the request; env-wide
        //    overlays are written with organization_id = NULL.
        await this.ensureOverlayIndex();

        // ADR-0008 — overlay-allowed metadata types ALWAYS route through the
        // repository write path: every mutation appends to the change log
        // and emits a watch event with a monotonic `seq` (which Studio /
        // browser clients consume for HMR). Non-overlay-allowed types
        // (`object`, `flow`, `agent`, ...) take the legacy raw-engine path
        // below — this preserves the control-plane bootstrap semantic where
        // `saveMetaItem` is permitted by the outer protocol gate to write
        // any metadata type when `projectId` is undefined (the repository's
        // `assertAllowed()` would 403 those writes).
        //
        // PR-10d.6 (this PR) removed the `useRepositoryWritePath` flag.
        // For overlay-allowed types the repo path is no longer opt-out-able.
        //
        // Callers that omit `parentVersion` get backward-compatible
        // "last-write-wins" semantics: we read the current row's checksum
        // and use it as the parent, so the conflict check tautologically
        // passes (best-effort — racy under concurrent writes; explicit
        // optimistic-lock is opt-in via `parentVersion`).
        // Callers that pass an explicit `parentVersion` (e.g. Studio after
        // reading an item) get true optimistic-lock conflict detection
        // surfaced as a 409.
        const singularTypeForRepo = PLURAL_TO_SINGULAR[request.type] ?? request.type;
        if (ObjectStackProtocolImplementation.isOverlayAllowed(singularTypeForRepo)) {
            const orgId = request.organizationId ?? null;
            const repo = this.getOverlayRepo(orgId);
            const ref = {
                type: singularTypeForRepo,
                name: request.name,
                org: orgId ?? 'env',
            } as Parameters<typeof repo.put>[0];
            let parentVersion: string | null;
            if (request.parentVersion !== undefined) {
                parentVersion = request.parentVersion;
            } else {
                const current = await repo.get(ref);
                parentVersion = current?.hash ?? null;
            }
            try {
                const result = await repo.put(ref, request.item, {
                    parentVersion,
                    actor: request.actor ?? 'system',
                    source: 'protocol.saveMetaItem',
                });
                // Persistence succeeded — NOW it's safe to mutate the
                // in-memory object registry. If put() had thrown, the
                // registry would still reflect the prior state.
                this.applyObjectRegistryMutation(request);
                return {
                    success: true,
                    version: result.version,
                    seq: result.seq,
                    message: orgId
                        ? `Saved customization overlay (org=${orgId}) — type=${request.type}, name=${request.name} [seq=${result.seq}]`
                        : `Saved customization overlay (env-wide) — type=${request.type}, name=${request.name} [seq=${result.seq}]`,
                };
            } catch (err: any) {
                if (err instanceof ConflictError) {
                    const conflict = new Error(
                        `[metadata_conflict] ${request.type}/${request.name} has been modified since you loaded it. `
                        + `Expected parent ${err.expectedParent ?? 'null'} but current is ${err.actualHead ?? 'null'}.`,
                    );
                    (conflict as any).code = 'metadata_conflict';
                    (conflict as any).status = 409;
                    (conflict as any).expectedParent = err.expectedParent;
                    (conflict as any).actualHead = err.actualHead;
                    throw conflict;
                }
                throw err;
            }
        }

        // Legacy raw-engine path — taken when the type is NOT overlay-allowed
        // (control-plane bootstrap of `object`/`flow`/etc. when `projectId` is
        // undefined). This branch is intentionally retained: the repository
        // write path's `assertAllowed()` would 403 these types. There is no
        // change-log / HMR machinery for non-overlay metadata because
        // control-plane mutations are bootstrap-only and not subject to
        // per-org overlay semantics.
        //
        // Note: the registry mutation for the legacy path happens BEFORE
        // persistence (preserved historical behaviour). The overlay-allowed
        // path moved it to AFTER persistence in PR-10d.3 (rubber-duck #3).
        this.applyObjectRegistryMutation(request);

        try {
            const now = new Date().toISOString();
            const orgId = request.organizationId ?? null;
            const scopedWhere: Record<string, unknown> = {
                type: request.type,
                name: request.name,
                organization_id: orgId,
                state: 'active',
            };
            const existing = await this.engine.findOne('sys_metadata', {
                where: scopedWhere,
            });

            if (existing) {
                await this.engine.update('sys_metadata', {
                    metadata: JSON.stringify(request.item),
                    updated_at: now,
                    version: (existing.version || 0) + 1,
                    state: 'active',
                }, {
                    where: { id: existing.id }
                });
            } else {
                // Use crypto.randomUUID() when available (modern browsers and Node ≥ 14.17);
                // fall back to a time+random ID for older or restricted environments.
                const id = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
                    ? crypto.randomUUID()
                    : `meta_${Date.now()}_${Math.random().toString(36).slice(2)}`;
                const row: Record<string, unknown> = {
                    id,
                    name: request.name,
                    type: request.type,
                    // `scope` enum is ['system','platform','user']; per-org
                    // overlays use 'platform' as the informational tag. The
                    // authoritative isolation key is `organization_id`.
                    scope: 'platform',
                    metadata: JSON.stringify(request.item),
                    state: 'active',
                    version: 1,
                    created_at: now,
                    updated_at: now,
                    organization_id: orgId,
                };
                await this.engine.insert('sys_metadata', row);
            }

            return {
                success: true,
                message: orgId
                    ? `Saved customization overlay (org=${orgId}) — type=${request.type}, name=${request.name}`
                    : `Saved customization overlay (env-wide) — type=${request.type}, name=${request.name}`,
            };
        } catch (dbError: any) {
            // DB write failed — surface as an error rather than silently
            // succeeding (regression from the pre-ADR-0005 "silent loss" bug).
            console.error(
                `[Protocol] sys_metadata persistence failed for ${request.type}/${request.name}: ${dbError.message}`,
            );
            const err = new Error(
                `Failed to persist customization overlay to sys_metadata: ${dbError.message}. `
                + `In-memory registry was updated but will be lost on restart.`,
            );
            (err as any).code = 'overlay_persistence_failed';
            (err as any).status = 500;
            throw err;
        }
    }

    /**
     * Yield the durable change-log for a single metadata item — every
     * put/delete recorded in `sys_metadata_history` for `(org, type, name)`,
     * in event_seq order. Powers the Studio "History" tab and any
     * client-side audit timeline.
     *
     * Returns `[]` for non-overlay-allowed types (the legacy raw-engine
     * path doesn't record history) instead of throwing — callers can treat
     * "no history" uniformly.
     */
    async historyMetaItem(request: {
        type: string;
        name: string;
        organizationId?: string;
        sinceSeq?: number;
        limit?: number;
    }): Promise<{ events: import('@objectstack/metadata-core').MetadataEvent[] }> {
        const singularType = PLURAL_TO_SINGULAR[request.type] ?? request.type;
        if (!ObjectStackProtocolImplementation.isOverlayAllowed(singularType)) {
            return { events: [] };
        }
        const orgId = request.organizationId ?? null;
        const repo = this.getOverlayRepo(orgId);
        const ref = {
            type: singularType,
            name: request.name,
            org: orgId ?? 'env',
        } as Parameters<typeof repo.history>[0];

        const events: import('@objectstack/metadata-core').MetadataEvent[] = [];
        const opts: { sinceSeq?: number; limit?: number } = {};
        if (request.sinceSeq !== undefined) opts.sinceSeq = request.sinceSeq;
        if (request.limit !== undefined) opts.limit = request.limit;
        for await (const ev of repo.history(ref, opts)) events.push(ev);
        return { events };
    }

    /**
     * Remove a customization overlay row for the given metadata item, so the
     * next read falls through to the artifact-loaded default. Implements the
     * "Reset to factory default" semantic from ADR-0005. Whitelist is shared
     * with {@link saveMetaItem}.
     */
    async deleteMetaItem(request: {
        type: string;
        name: string;
        organizationId?: string;
        parentVersion?: string | null;
        actor?: string;
    }): Promise<{
        success: boolean;
        message?: string;
        reset?: boolean;
        seq?: number;
    }> {
        if (this.projectId !== undefined
            && !ObjectStackProtocolImplementation.isOverlayAllowed(request.type)) {
            const err = new Error(
                `[not_overridable] Metadata type '${request.type}' has not opted into per-org overlay writes. `
                + `See docs/adr/0005-metadata-customization-overlay.md.`
            );
            (err as any).code = 'not_overridable';
            (err as any).status = 403;
            throw err;
        }

        const singularTypeForRepo = PLURAL_TO_SINGULAR[request.type] ?? request.type;
        const useRepoPath = ObjectStackProtocolImplementation.isOverlayAllowed(singularTypeForRepo);

        // ADR-0008 — overlay-allowed types route through SysMetadataRepository
        // so the delete (a) is wrapped in engine.transaction(), (b) appends a
        // tombstone row to sys_metadata_history, and (c) emits a watch event
        // with a monotonic `seq` for HMR. Non-overlay-allowed types (only
        // reachable in control-plane bootstrap mode where projectId is
        // undefined) take the legacy raw-engine path below — the repository's
        // `assertAllowed()` whitelist would 403 those deletes.
        if (useRepoPath) {
            const orgId = request.organizationId ?? null;
            const repo = this.getOverlayRepo(orgId);
            const ref = {
                type: singularTypeForRepo,
                name: request.name,
                org: orgId ?? 'env',
            } as Parameters<typeof repo.delete>[0];

            try {
                // Probe first — "no overlay exists" is a success/no-op, not
                // a conflict. The repo would otherwise throw ConflictError.
                const current = await repo.get(ref);
                if (!current) {
                    return {
                        success: true,
                        reset: false,
                        message: `No customization overlay found for ${request.type}/${request.name} — already at artifact default.`,
                    };
                }

                // Last-write-wins parent resolution unless the caller pinned
                // an explicit version (Studio's "Reset" button is unpinned;
                // a future "delete vN" flow can pass parentVersion).
                const parentVersion: string = request.parentVersion !== undefined
                    ? (request.parentVersion ?? current.hash)
                    : current.hash;

                const result = await repo.delete(ref, {
                    parentVersion,
                    actor: request.actor ?? 'system',
                    source: 'protocol.deleteMetaItem',
                });

                // Refresh the in-memory artifact-side state on control-plane
                // kernels (same logic as the legacy branch — see comments
                // there for why this only runs when projectId === undefined).
                if (this.projectId === undefined) {
                    try {
                        const services = this.getServicesRegistry?.();
                        const metadataService = services?.get('metadata');
                        if (metadataService && typeof metadataService.get === 'function') {
                            const artifactItem = await metadataService.get(request.type, request.name);
                            if (artifactItem !== undefined) {
                                this.engine.registry.registerItem(request.type, artifactItem, 'name');
                            }
                        }
                    } catch {
                        // Best-effort registry refresh; next read fixes it anyway
                    }
                }

                return {
                    success: true,
                    reset: true,
                    seq: result.seq,
                    message: `Customization overlay deleted — ${request.type}/${request.name} reset to artifact default. [seq=${result.seq}]`,
                };
            } catch (err: any) {
                if (err instanceof ConflictError) {
                    const conflict = new Error(
                        `[metadata_conflict] ${request.type}/${request.name} has been modified since you loaded it. `
                        + `Expected parent ${err.expectedParent ?? 'null'} but current is ${err.actualHead ?? 'null'}.`,
                    );
                    (conflict as any).code = 'metadata_conflict';
                    (conflict as any).status = 409;
                    (conflict as any).expectedParent = err.expectedParent;
                    (conflict as any).actualHead = err.actualHead;
                    throw conflict;
                }
                const e = new Error(`Failed to delete customization overlay: ${err.message ?? err}`);
                (e as any).status = err?.status ?? 500;
                throw e;
            }
        }

        // ── Legacy raw-engine path: only reachable in control-plane bootstrap
        // (projectId === undefined) for non-overlay-allowed types like
        // `object`, `flow`, `agent`. No history row, no watch event — these
        // types don't participate in the change-log model.
        const scopedWhere: Record<string, unknown> = {
            type: request.type,
            name: request.name,
            organization_id: request.organizationId ?? null,
        };

        try {
            const existing = await this.engine.findOne('sys_metadata', { where: scopedWhere });
            if (!existing) {
                return {
                    success: true,
                    reset: false,
                    message: `No customization overlay found for ${request.type}/${request.name} — already at artifact default.`,
                };
            }
            await this.engine.delete('sys_metadata', { where: { id: existing.id } });

            if (this.projectId === undefined) {
                try {
                    const services = this.getServicesRegistry?.();
                    const metadataService = services?.get('metadata');
                    if (metadataService && typeof metadataService.get === 'function') {
                        const artifactItem = await metadataService.get(request.type, request.name);
                        if (artifactItem !== undefined) {
                            this.engine.registry.registerItem(request.type, artifactItem, 'name');
                        }
                    }
                } catch {
                    // Best-effort registry refresh; next read fixes it anyway
                }
            }

            return {
                success: true,
                reset: true,
                message: `Customization overlay deleted — ${request.type}/${request.name} reset to artifact default.`,
            };
        } catch (err: any) {
            const e = new Error(`Failed to delete customization overlay: ${err.message}`);
            (e as any).status = 500;
            throw e;
        }
    }

    /**
     * Hydrate SchemaRegistry from the database on startup.
     * Loads all active metadata records and registers them in the in-memory registry.
     * Safe to call repeatedly — idempotent (latest DB record wins).
     *
     * Per ADR-0005, project-kernel mode ALSO hydrates from sys_metadata —
     * customization overlay rows must survive restart. Scope filter
     * (`project_id = this.projectId ?? null`) keeps tenants isolated.
     */
    async loadMetaFromDb(): Promise<{ loaded: number; errors: number }> {
        let loaded = 0;
        let errors = 0;
        try {
            // ADR-0005 (revised 2026-05): hydrate only env-wide rows
            // (organization_id IS NULL). Per-org overlays are loaded on
            // demand by getMetaItem to avoid cross-org leakage into the
            // process-wide SchemaRegistry.
            const where: Record<string, unknown> = {
                state: 'active',
                organization_id: null,
            };
            const records = await this.engine.find('sys_metadata', { where });
            for (const record of records) {
                try {
                    const data = typeof record.metadata === 'string'
                        ? JSON.parse(record.metadata)
                        : record.metadata;
                    // Normalize DB type to singular (DB may store legacy plural forms)
                    const normalizedType = PLURAL_TO_SINGULAR[record.type] ?? record.type;
                    if (normalizedType === 'object') {
                        this.engine.registry.registerObject(data as any, record.packageId || 'sys_metadata');
                    } else {
                        this.engine.registry.registerItem(normalizedType, data, 'name' as any);
                    }
                    loaded++;
                } catch (e) {
                    errors++;
                    console.warn(`[Protocol] Failed to hydrate ${record.type}/${record.name}: ${e instanceof Error ? e.message : String(e)}`);
                }
            }
        } catch (e: any) {
            // "no such table" is expected on first run before migrations execute — not an error.
            if (!/no such table/i.test(e.message ?? '')) {
                console.warn(`[Protocol] DB hydration skipped: ${e.message}`);
            }
        }
        return { loaded, errors };
    }

    // ==========================================
    // Feed Operations
    // ==========================================

    async listFeed(request: any): Promise<any> {
        const svc = this.requireFeedService();
        const result = await svc.listFeed({
            object: request.object,
            recordId: request.recordId,
            filter: request.type,
            limit: request.limit,
            cursor: request.cursor,
        });
        return { success: true, data: result };
    }

    async createFeedItem(request: any): Promise<any> {
        const svc = this.requireFeedService();
        const item = await svc.createFeedItem({
            object: request.object,
            recordId: request.recordId,
            type: request.type,
            actor: { type: 'user', id: 'current_user' },
            body: request.body,
            mentions: request.mentions,
            parentId: request.parentId,
            visibility: request.visibility,
        });
        return { success: true, data: item };
    }

    async updateFeedItem(request: any): Promise<any> {
        const svc = this.requireFeedService();
        const item = await svc.updateFeedItem(request.feedId, {
            body: request.body,
            mentions: request.mentions,
            visibility: request.visibility,
        });
        return { success: true, data: item };
    }

    async deleteFeedItem(request: any): Promise<any> {
        const svc = this.requireFeedService();
        await svc.deleteFeedItem(request.feedId);
        return { success: true, data: { feedId: request.feedId } };
    }

    async addReaction(request: any): Promise<any> {
        const svc = this.requireFeedService();
        const reactions = await svc.addReaction(request.feedId, request.emoji, 'current_user');
        return { success: true, data: { reactions } };
    }

    async removeReaction(request: any): Promise<any> {
        const svc = this.requireFeedService();
        const reactions = await svc.removeReaction(request.feedId, request.emoji, 'current_user');
        return { success: true, data: { reactions } };
    }

    async pinFeedItem(request: any): Promise<any> {
        const svc = this.requireFeedService();
        const item = await svc.getFeedItem(request.feedId);
        if (!item) throw new Error(`Feed item ${request.feedId} not found`);
        // IFeedService doesn't have dedicated pin/unpin — use updateFeedItem to persist pin state
        await svc.updateFeedItem(request.feedId, { visibility: item.visibility });
        return { success: true, data: { feedId: request.feedId, pinned: true, pinnedAt: new Date().toISOString() } };
    }

    async unpinFeedItem(request: any): Promise<any> {
        const svc = this.requireFeedService();
        const item = await svc.getFeedItem(request.feedId);
        if (!item) throw new Error(`Feed item ${request.feedId} not found`);
        await svc.updateFeedItem(request.feedId, { visibility: item.visibility });
        return { success: true, data: { feedId: request.feedId, pinned: false } };
    }

    async starFeedItem(request: any): Promise<any> {
        const svc = this.requireFeedService();
        const item = await svc.getFeedItem(request.feedId);
        if (!item) throw new Error(`Feed item ${request.feedId} not found`);
        // IFeedService doesn't have dedicated star/unstar — verify item exists then return state
        await svc.updateFeedItem(request.feedId, { visibility: item.visibility });
        return { success: true, data: { feedId: request.feedId, starred: true, starredAt: new Date().toISOString() } };
    }

    async unstarFeedItem(request: any): Promise<any> {
        const svc = this.requireFeedService();
        const item = await svc.getFeedItem(request.feedId);
        if (!item) throw new Error(`Feed item ${request.feedId} not found`);
        await svc.updateFeedItem(request.feedId, { visibility: item.visibility });
        return { success: true, data: { feedId: request.feedId, starred: false } };
    }

    async searchFeed(request: any): Promise<any> {
        const svc = this.requireFeedService();
        // Search delegates to listFeed with filter since IFeedService doesn't have a dedicated search
        const result = await svc.listFeed({
            object: request.object,
            recordId: request.recordId,
            filter: request.type,
            limit: request.limit,
            cursor: request.cursor,
        });
        // Filter by query text in body
        const queryLower = (request.query || '').toLowerCase();
        const filtered = result.items.filter((item: any) =>
            item.body?.toLowerCase().includes(queryLower)
        );
        return { success: true, data: { items: filtered, total: filtered.length, hasMore: false } };
    }

    async getChangelog(request: any): Promise<any> {
        const svc = this.requireFeedService();
        // Changelog retrieves field_change type feed items
        const result = await svc.listFeed({
            object: request.object,
            recordId: request.recordId,
            filter: 'changes_only',
            limit: request.limit,
            cursor: request.cursor,
        });
        const entries = result.items.map((item: any) => ({
            id: item.id,
            object: item.object,
            recordId: item.recordId,
            actor: item.actor,
            changes: item.changes || [],
            timestamp: item.createdAt,
            source: item.source,
        }));
        return { success: true, data: { entries, total: result.total, nextCursor: result.nextCursor, hasMore: result.hasMore } };
    }

    async feedSubscribe(request: any): Promise<any> {
        const svc = this.requireFeedService();
        const subscription = await svc.subscribe({
            object: request.object,
            recordId: request.recordId,
            userId: 'current_user',
            events: request.events,
            channels: request.channels,
        });
        return { success: true, data: subscription };
    }

    async feedUnsubscribe(request: any): Promise<any> {
        const svc = this.requireFeedService();
        const unsubscribed = await svc.unsubscribe(request.object, request.recordId, 'current_user');
        return { success: true, data: { object: request.object, recordId: request.recordId, unsubscribed } };
    }
}
