// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { ObjectStackProtocol } from '@objectstack/spec/api';
import { IDataEngine } from '@objectstack/core';
import type { ObjectQL } from './engine.js';
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
            const partialSql =
                "CREATE UNIQUE INDEX IF NOT EXISTS idx_sys_metadata_overlay_active " +
                "ON sys_metadata (type, name, organization_id, project_id, scope) " +
                "WHERE state = 'active'";
            const fallbackSql =
                "CREATE INDEX IF NOT EXISTS idx_sys_metadata_overlay_active " +
                "ON sys_metadata (type, name, organization_id, project_id, scope)";
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

    async getMetaItems(request: { type: string; packageId?: string }) {
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
        // entries (the previous fallback-only logic meant project metadata
        // was never surfaced whenever system-bridged items populated the
        // registry). Deduplicate against whatever the registry returned.
        //
        // ADR-0005 Phase 4: project kernels also consult sys_metadata so that
        // customer-saved view/dashboard overlays show up in list endpoints
        // alongside the artifact-loaded items.
        try {
            const whereClause: Record<string, unknown> = {
                type: request.type,
                state: 'active',
                // Always filter by project_id: project kernels use their projectId,
                // control-plane kernels use NULL (global scope only).
                project_id: this.projectId ?? null,
            };
            if (packageId) whereClause._packageId = packageId;
            let records = await this.engine.find('sys_metadata', { where: whereClause });
            if ((!records || records.length === 0)) {
                // Try alternate type name in DB using explicit mapping
                const alt = PLURAL_TO_SINGULAR[request.type] ?? SINGULAR_TO_PLURAL[request.type];
                if (alt) {
                    const altWhere: Record<string, unknown> = { type: alt, state: 'active', project_id: this.projectId ?? null };
                    if (packageId) altWhere._packageId = packageId;
                    records = await this.engine.find('sys_metadata', { where: altWhere });
                }
            }
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
                            itemMap.set(entry.name, entry);
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

    async getMetaItem(request: { type: string, name: string, packageId?: string }) {
        let item: unknown;

        // 1. Customization overlay lookup (sys_metadata).
        //    Per ADR-0005, overlay rows are the customer-managed delta and win
        //    over the artifact-loaded registry. Both project-kernel and
        //    control-plane modes participate (control-plane scope = NULL).
        try {
            const scopedWhere: Record<string, unknown> = {
                type: request.type,
                name: request.name,
                state: 'active',
                project_id: this.projectId ?? null,
            };
            const record = await this.engine.findOne('sys_metadata', { where: scopedWhere });
            if (record) {
                item = typeof record.metadata === 'string'
                    ? JSON.parse(record.metadata)
                    : record.metadata;
            } else {
                // Try alternate type name using explicit singular/plural mapping
                const alt = PLURAL_TO_SINGULAR[request.type] ?? SINGULAR_TO_PLURAL[request.type];
                if (alt) {
                    const altWhere: Record<string, unknown> = {
                        type: alt,
                        name: request.name,
                        state: 'active',
                        project_id: this.projectId ?? null,
                    };
                    const altRecord = await this.engine.findOne('sys_metadata', { where: altWhere });
                    if (altRecord) {
                        item = typeof altRecord.metadata === 'string'
                            ? JSON.parse(altRecord.metadata)
                            : altRecord.metadata;
                    }
                }
            }
        } catch {
            // DB not available — fall through to registry / MetadataService
        }

        // 2. In-memory SchemaRegistry (artifact-loaded out-of-box values).
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

        // 3. Fallback to MetadataService for runtime-registered items (agents, tools, etc.)
        if (item === undefined) {
            try {
                const services = this.getServicesRegistry?.();
                const metadataService = services?.get('metadata');
                if (metadataService && typeof metadataService.get === 'function') {
                    item = await metadataService.get(request.type, request.name);
                }
            } catch {
                // MetadataService not available
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
        throw new Error(`Record ${request.id} not found in ${request.object}`);
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

    async updateData(request: { object: string, id: string, data: any, context?: any }) {
        const opts: any = { where: { id: request.id } };
        if (request.context !== undefined) opts.context = request.context;
        const result = await this.engine.update(request.object, request.data, opts);
        return {
            object: request.object,
            id: request.id,
            record: result
        };
    }

    async deleteData(request: { object: string, id: string, context?: any }) {
        const opts: any = { where: { id: request.id } };
        if (request.context !== undefined) opts.context = request.context;
        await this.engine.delete(request.object, opts);
        return {
            object: request.object,
            id: request.id,
            success: true
        };
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

    async saveMetaItem(request: { type: string, name: string, item?: any }) {
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
        if (request.type === 'object' || request.type === 'objects') {
            this.engine.registry.registerItem(request.type, request.item, 'name');
            try {
                this.engine.registry.registerObject(request.item as any, 'sys_metadata');
            } catch (err: any) {
                console.warn(
                    `[Protocol] registerObject failed for ${request.name}: ${err?.message ?? err}`,
                );
            }
        }

        // 2. Persist to sys_metadata as a customization overlay row.
        //    Both project-kernel (project_id = this.projectId) and
        //    control-plane (project_id = NULL) modes participate. Per ADR-0005
        //    we store the entire item document — no field-level patch.
        await this.ensureOverlayIndex();
        try {
            const now = new Date().toISOString();
            const scopedWhere: Record<string, unknown> = {
                type: request.type,
                name: request.name,
                project_id: this.projectId ?? null,
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
                    // `scope` is informational; `project_id` is the authoritative
                    // isolation key (see sys-metadata schema unique index).
                    scope: this.projectId !== undefined ? 'project' : 'platform',
                    metadata: JSON.stringify(request.item),
                    state: 'active',
                    version: 1,
                    created_at: now,
                    updated_at: now,
                };
                if (this.projectId !== undefined) {
                    row.project_id = this.projectId;
                }
                await this.engine.insert('sys_metadata', row);
            }

            return {
                success: true,
                message: this.projectId !== undefined
                    ? `Saved customization overlay to sys_metadata (project scope) — type=${request.type}, name=${request.name}`
                    : 'Saved to database and registry',
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
     * Remove a customization overlay row for the given metadata item, so the
     * next read falls through to the artifact-loaded default. Implements the
     * "Reset to factory default" semantic from ADR-0005. Whitelist is shared
     * with {@link saveMetaItem}.
     */
    async deleteMetaItem(request: { type: string; name: string }): Promise<{
        success: boolean;
        message?: string;
        reset?: boolean;
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

        const scopedWhere: Record<string, unknown> = {
            type: request.type,
            name: request.name,
            project_id: this.projectId ?? null,
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

            // Refresh in-memory state from the artifact source so subsequent
            // reads don't return the stale overlay value via MetadataService.
            // The registry is intentionally NOT cleared on project kernels (it
            // is process-global there and shared); the next getMetaItem call
            // queries sys_metadata first (now empty) and falls through to
            // MetadataService, which retains the artifact value.
            if (this.projectId === undefined) {
                // For control-plane kernels we can safely re-register the
                // artifact-side value into the global registry from the
                // MetadataService, mirroring what saveMetaItem did inversely.
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
            // Always scope by project_id: project kernels hydrate only their own
            // rows; control-plane kernels (no projectId) hydrate only
            // rows with project_id = NULL (global scope). Without this filter the
            // control-plane registry would absorb every project's objects and
            // expose them at the control-plane metadata endpoints.
            const where: Record<string, unknown> = {
                state: 'active',
                project_id: this.projectId ?? null,
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
