// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { IHttpServer } from '@objectstack/core';
import { RouteManager } from './route-manager.js';
import { RestServerConfig, RestApiConfig, CrudEndpointsConfig, MetadataEndpointsConfig, BatchEndpointsConfig, RouteGenerationConfig } from '@objectstack/spec/api';
import { ObjectStackProtocol } from '@objectstack/spec/api';

// Node-safe logger — avoids importing 'console' which is absent from ES2020 lib typings.
const logError = (...args: unknown[]) => (globalThis as any).console?.error(...args);

/**
 * Map a data-layer error to a clean HTTP response. Unknown-object errors
 * (SQLite "no such table", PG "relation does not exist", protocol
 * "object not found", etc.) are surfaced as a 404 with `code: 'object_not_found'`
 * so clients can distinguish "object isn't registered" from real server
 * faults. Anything else becomes a 400 (bad request) preserving prior
 * behavior. Genuine 500s are still logged.
 *
 * `PermissionDeniedError` (thrown by `SecurityPlugin`) MUST be caught
 * before the unknown-object heuristic, otherwise its message —
 * "[Security] Access denied: operation 'insert' on object 'sys_user' is
 * not permitted …" — trips the `'<obj>' … not` substring check and
 * returns a misleading 404.
 */
function mapDataError(error: any, object?: string): { status: number; body: Record<string, unknown> } {
    // Validation failures → 400 with per-field envelope. Handled FIRST
    // because the validator throws a typed error before any SQL ever
    // runs, and we want callers to differentiate "your payload was
    // invalid" (fixable client-side) from generic 400s.
    if (error?.code === 'VALIDATION_FAILED' || error?.name === 'ValidationError') {
        return {
            status: 400,
            body: {
                error: error?.message ?? 'Validation failed',
                code: 'VALIDATION_FAILED',
                fields: Array.isArray(error?.fields) ? error.fields : [],
                ...(object ? { object } : {}),
            },
        };
    }
    // Short-circuit: explicit security denial → 403. Match by `code` /
    // `name` to avoid pulling a runtime dependency on plugin-security.
    if (
        error?.code === 'PERMISSION_DENIED' ||
        error?.name === 'PermissionDeniedError' ||
        (typeof error?.message === 'string' && error.message.startsWith('[Security] Access denied'))
    ) {
        return {
            status: 403,
            body: {
                error: error?.message ?? 'Permission denied',
                code: 'PERMISSION_DENIED',
                ...(object ? { object } : {}),
            },
        };
    }
    const raw = String(error?.message ?? error ?? '');
    const lower = raw.toLowerCase();

    // ProjectKernelFactory: project missing database_url/driver — typically
    // means provisioning is in flight or the project record was never
    // fully provisioned. 503 (with Retry-After implied) is more accurate
    // than the default 400/500: clients can poll until the project is
    // active.
    if (
        raw.includes('[ProjectKernelFactory]') &&
        (lower.includes('missing database_url') || lower.includes('not found'))
    ) {
        const isProvisioning = lower.includes("status='provisioning'") || lower.includes("status='pending'");
        const isFailed = lower.includes("status='failed'");
        return {
            status: isProvisioning ? 503 : isFailed ? 502 : 404,
            body: {
                error: raw,
                code: isProvisioning
                    ? 'PROJECT_PROVISIONING'
                    : isFailed
                        ? 'PROJECT_PROVISIONING_FAILED'
                        : 'PROJECT_NOT_FOUND',
            },
        };
    }

    const looksLikeUnknownObject =
        lower.includes('no such table') ||
        lower.includes('relation') && lower.includes('does not exist') ||
        lower.includes('table not found') ||
        lower.includes('unknown object') ||
        lower.includes('object not found') ||
        lower.includes('no driver available') ||
        (object !== undefined && lower.includes(`'${object.toLowerCase()}'`) && lower.includes('not'));
    if (looksLikeUnknownObject) {
        return {
            status: 404,
            body: {
                error: object ? `Object '${object}' is not registered` : 'Object not found',
                code: 'object_not_found',
                object,
            },
        };
    }
    // Default: do NOT leak raw SQL or driver internals. If the message
    // looks like a SQL/driver dump, replace it with a generic envelope
    // and rely on server logs for the full diagnostic.
    const looksLikeSqlLeak =
        lower.includes('sqlite_') ||
        lower.includes('sqlstate') ||
        lower.startsWith('insert into ') ||
        lower.startsWith('update ') ||
        lower.startsWith('select ') ||
        lower.startsWith('delete from ') ||
        lower.includes('constraint failed') ||
        lower.includes('unique constraint') ||
        lower.includes('foreign key');
    if (looksLikeSqlLeak) {
        // Surface unique-constraint violations as a structured 409 so
        // the UI can map them to "this value already exists".
        if (lower.includes('unique constraint') || lower.includes('unique violation')) {
            return {
                status: 409,
                body: {
                    error: 'A record with this value already exists',
                    code: 'UNIQUE_VIOLATION',
                    ...(object ? { object } : {}),
                },
            };
        }
        return {
            status: 500,
            body: { error: 'Internal data error', code: 'DATABASE_ERROR' },
        };
    }
    return { status: 400, body: { error: raw || 'Bad request' } };
}

/**
 * Centralized error responder for all REST handlers. Ensures raw driver
 * messages (SQLite/Postgres dumps, stack traces, unique-constraint
 * payloads with table names, etc.) never reach clients. Honors
 * structured errors that already carry an explicit `status` so callers
 * can surface domain-specific codes (e.g. 422 from a metadata save
 * validator), and routes everything else through `mapDataError` so the
 * security / validation / SQL-leak / unknown-object envelopes apply
 * uniformly across CRUD, batch, metadata, UI and discovery routes.
 */
function sendError(res: any, error: any, object?: string): void {
    if (typeof error?.status === 'number' && error.status >= 400 && error.status < 600) {
        const safeMsg = typeof error.message === 'string' && error.message.length < 500
            ? error.message
            : 'Request failed';
        res.status(error.status).json({
            error: safeMsg,
            ...(error.code ? { code: error.code } : {}),
        });
        return;
    }
    const mapped = mapDataError(error, object);
    res.status(mapped.status).json(mapped.body);
}

/**
 * Whether a mapped data-error status represents an *expected* client/lifecycle
 * outcome (and therefore shouldn't be logged as "[REST] Unhandled error").
 *  - 403 PERMISSION_DENIED is a normal RBAC denial
 *  - 404 unknown object / project not found is a normal client mistake
 *  - 502/503 mean the underlying project is provisioning or failed; the
 *    handler will emit the response and the operator can inspect
 *    sys_project.metadata.provisioningError if needed.
 */
function isExpectedDataStatus(status: number): boolean {
    return status === 403 || status === 404 || status === 409 || status === 502 || status === 503;
}

/**
 * Minimal RFC-4180-style CSV parser used by the bulk-import endpoint
 * (M10.9). Handles quoted fields (including embedded quotes via "" and
 * embedded commas/newlines) and both CRLF and LF line endings.
 *
 * The first non-empty line is treated as the header row. Header names
 * can be re-mapped to canonical field names via the optional `mapping`
 * argument (e.g. `{ "First Name": "first_name" }`); unmapped headers
 * pass through unchanged. Empty cells become empty strings.
 *
 * Kept dependency-free so REST stays runtime-portable (Hono / Express
 * adapters both consume this without pulling a CSV lib transitively).
 */
function parseCsvToRows(csv: string, mapping: Record<string, string> = {}): Array<Record<string, any>> {
    const text = csv.replace(/^\uFEFF/, ''); // strip BOM
    const cells: string[][] = [];
    let cur = '';
    let row: string[] = [];
    let inQuotes = false;
    for (let i = 0; i < text.length; i++) {
        const ch = text[i];
        if (inQuotes) {
            if (ch === '"') {
                if (text[i + 1] === '"') { cur += '"'; i++; }
                else { inQuotes = false; }
            } else {
                cur += ch;
            }
            continue;
        }
        if (ch === '"') { inQuotes = true; continue; }
        if (ch === ',') { row.push(cur); cur = ''; continue; }
        if (ch === '\r') { continue; }
        if (ch === '\n') {
            row.push(cur); cur = '';
            cells.push(row); row = [];
            continue;
        }
        cur += ch;
    }
    if (cur.length > 0 || row.length > 0) { row.push(cur); cells.push(row); }

    // Drop fully-empty trailing rows so a stray newline at EOF doesn't
    // produce a phantom empty record.
    while (cells.length > 0 && cells[cells.length - 1].every(c => c === '')) cells.pop();
    if (cells.length < 2) return [];

    const header = cells[0].map(h => h.trim());
    const fields = header.map(h => mapping[h] ?? h);
    const out: Array<Record<string, any>> = [];
    for (let r = 1; r < cells.length; r++) {
        const row = cells[r];
        const obj: Record<string, any> = {};
        for (let c = 0; c < fields.length; c++) {
            const key = fields[c];
            if (!key) continue;
            const raw = row[c] ?? '';
            obj[key] = raw;
        }
        out.push(obj);
    }
    return out;
}

/**
 * Escape a single value into an RFC-4180 CSV cell. Values containing
 * commas, quotes, CR, or LF are wrapped in double-quotes with embedded
 * quotes doubled. `null` / `undefined` become an empty cell. Objects and
 * arrays are serialised as compact JSON so nested data round-trips
 * without flattening surprises.
 */
function formatCsvCell(value: any): string {
    if (value === null || value === undefined) return '';
    let s: string;
    if (typeof value === 'string') s = value;
    else if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') s = String(value);
    else if (value instanceof Date) s = value.toISOString();
    else { try { s = JSON.stringify(value); } catch { s = String(value); } }
    if (/[",\r\n]/.test(s)) {
        return `"${s.replace(/"/g, '""')}"`;
    }
    return s;
}

/**
 * Serialise a list of rows to RFC-4180 CSV text. Caller supplies the
 * ordered list of field names; unknown fields produce empty cells.
 */
function rowsToCsv(fields: string[], rows: Array<Record<string, any>>, includeHeader: boolean): string {
    const lines: string[] = [];
    if (includeHeader) lines.push(fields.map(formatCsvCell).join(','));
    for (const row of rows) {
        lines.push(fields.map(f => formatCsvCell(row?.[f])).join(','));
    }
    return lines.join('\r\n') + (lines.length > 0 ? '\r\n' : '');
}

/**
 * Structural subset of `KernelManager` that RestServer needs in order to
 * resolve a per-project protocol at request time. Typed locally to avoid
 * an @objectstack/runtime → @objectstack/rest → @objectstack/runtime
 * package cycle.
 */
export interface RestKernelManager {
    getOrCreate(projectId: string): Promise<{
        getServiceAsync<T = unknown>(name: string): Promise<T>;
    }>;
}

/**
 * Normalized REST Server Configuration
 * All nested properties are required after normalization
 */
type NormalizedRestServerConfig = {
    api: {
        version: string;
        basePath: string;
        apiPath: string | undefined;
        enableCrud: boolean;
        enableMetadata: boolean;
        enableUi: boolean;
        enableBatch: boolean;
        enableDiscovery: boolean;
        enableSearch?: boolean;
        enableProjectScoping: boolean;
        projectResolution: 'required' | 'optional' | 'auto';
        requireAuth: boolean;
        documentation: RestApiConfig['documentation'];
        responseFormat: RestApiConfig['responseFormat'];
    };
    crud: {
        operations: {
            create: boolean;
            read: boolean;
            update: boolean;
            delete: boolean;
            list: boolean;
        };
        patterns: CrudEndpointsConfig['patterns'];
        dataPrefix: string;
        objectParamStyle: 'path' | 'query';
    };
    metadata: {
        prefix: string;
        enableCache: boolean;
        cacheTtl: number;
        endpoints: {
            types: boolean;
            items: boolean;
            item: boolean;
            schema: boolean;
        };
    };
    batch: {
        maxBatchSize: number;
        enableBatchEndpoint: boolean;
        operations: {
            createMany: boolean;
            updateMany: boolean;
            deleteMany: boolean;
            upsertMany: boolean;
        };
        defaultAtomic: boolean;
    };
    routes: {
        includeObjects: string[] | undefined;
        excludeObjects: string[] | undefined;
        nameTransform: 'none' | 'plural' | 'kebab-case' | 'camelCase';
        overrides: RouteGenerationConfig['overrides'];
    };
};

/**
 * RestServer
 * 
 * Provides automatic REST API endpoint generation for ObjectStack.
 * Generates standard RESTful CRUD endpoints, metadata endpoints, and batch operations
 * based on the configured protocol provider.
 * 
 * Features:
 * - Automatic CRUD endpoint generation (GET, POST, PUT, PATCH, DELETE)
 * - Metadata API endpoints (/meta)
 * - Batch operation endpoints (/batch, /createMany, /updateMany, /deleteMany)
 * - Discovery endpoint
 * - Configurable path prefixes and patterns
 * 
 * @example
 * const restServer = new RestServer(httpServer, protocolProvider, {
 *   api: {
 *     version: 'v1',
 *     basePath: '/api'
 *   },
 *   crud: {
 *     dataPrefix: '/data'
 *   }
 * });
 * 
 * restServer.registerRoutes();
 */
/**
 * Minimal env registry shape consumed by the REST server for hostname →
 * projectId resolution and `X-Project-Id` header validation on unscoped
 * routes. Mirrors the surface of `EnvironmentDriverRegistry` defined in
 * `@objectstack/service-cloud`.
 */
export interface RestEnvRegistry {
    resolveByHostname(hostname: string): Promise<{ projectId: string } | null | undefined>;
    /**
     * Look up a project by id. Returns a truthy value (typically an
     * `IDataDriver`) when the project exists and is bound, `null` when
     * unknown. The REST server only uses the truthiness; it does not
     * touch the driver itself (the actual driver is loaded later via
     * `KernelManager.getOrCreate(projectId)`).
     */
    resolveById?(projectId: string): Promise<unknown | null>;
}

export class RestServer {
    private protocol: ObjectStackProtocol;
    private config: NormalizedRestServerConfig;
    private routeManager: RouteManager;
    private kernelManager?: RestKernelManager;
    private envRegistry?: RestEnvRegistry;
    private defaultProjectIdProvider?: () => string | undefined;
    private authServiceProvider?: (projectId?: string) => Promise<any | undefined>;
    private objectQLProvider?: (projectId?: string) => Promise<any | undefined>;
    private emailServiceProvider?: (projectId?: string) => Promise<any | undefined>;
    private sharingServiceProvider?: (projectId?: string) => Promise<any | undefined>;
    private reportsServiceProvider?: (projectId?: string) => Promise<any | undefined>;
    private approvalsServiceProvider?: (projectId?: string) => Promise<any | undefined>;
    private sharingRulesServiceProvider?: (projectId?: string) => Promise<any | undefined>;

    constructor(
        server: IHttpServer,
        protocol: ObjectStackProtocol,
        config: RestServerConfig = {},
        kernelManager?: RestKernelManager,
        envRegistry?: RestEnvRegistry,
        defaultProjectIdProvider?: () => string | undefined,
        authServiceProvider?: (projectId?: string) => Promise<any | undefined>,
        objectQLProvider?: (projectId?: string) => Promise<any | undefined>,
        emailServiceProvider?: (projectId?: string) => Promise<any | undefined>,
        sharingServiceProvider?: (projectId?: string) => Promise<any | undefined>,
        reportsServiceProvider?: (projectId?: string) => Promise<any | undefined>,
        approvalsServiceProvider?: (projectId?: string) => Promise<any | undefined>,
        sharingRulesServiceProvider?: (projectId?: string) => Promise<any | undefined>,
    ) {
        this.protocol = protocol;
        this.config = this.normalizeConfig(config);
        this.routeManager = new RouteManager(server);
        this.kernelManager = kernelManager;
        this.envRegistry = envRegistry;
        this.defaultProjectIdProvider = defaultProjectIdProvider;
        this.authServiceProvider = authServiceProvider;
        this.objectQLProvider = objectQLProvider;
        this.emailServiceProvider = emailServiceProvider;
        this.sharingServiceProvider = sharingServiceProvider;
        this.reportsServiceProvider = reportsServiceProvider;
        this.approvalsServiceProvider = approvalsServiceProvider;
        this.sharingRulesServiceProvider = sharingRulesServiceProvider;
    }

    /**
     * Resolve the protocol for a given request. When `projectId` is present
     * and a KernelManager is wired, fetch the per-project kernel's
     * `protocol` service so metadata / data / UI reads hit the project's
     * own registry and datastore.
     *
     * When `projectId` is absent on an unscoped route and an `envRegistry`
     * is wired (runtime mode), the resolution chain is:
     *   1. Hostname → projectId (`envRegistry.resolveByHostname`)
     *   2. `X-Project-Id` header → projectId (`envRegistry.resolveById`)
     *   3. Default-project fallback (`defaultProjectIdProvider`, set by
     *      `createSingleProjectPlugin`)
     *   4. Control-plane protocol captured at boot.
     *
     * Special case: `projectId === 'platform'` is a reserved virtual id used
     * by Studio to address the control plane through the regular project
     * URL shape (`/projects/platform/...`). It is NOT a row in the projects
     * table, so we must never call `KernelManager.getOrCreate('platform')`.
     * Instead, return the control-plane protocol directly. This lets Studio
     * (and any other client) speak a single, uniform URL family without
     * duplicating route logic for the platform surface.
     */
    private async resolveProtocol(projectId?: string, req?: any): Promise<ObjectStackProtocol> {
        if (projectId === 'platform') return this.protocol;
        if (!projectId && req && this.envRegistry && this.kernelManager) {
            const host = this.extractHostname(req);
            if (host) {
                try {
                    const result = await this.envRegistry.resolveByHostname(host);
                    if (result?.projectId) projectId = result.projectId;
                } catch {
                    // fall through to next strategy
                }
            }
            // 2. `X-Project-Id` request header → projectId. Lets clients
            //    explicitly target a project when the URL is unscoped and
            //    no hostname binding exists (e.g. a single shared origin
            //    serving multiple compiled bundles via OS_PROJECT_ARTIFACTS).
            //    We validate the id through the env registry to avoid
            //    routing to a non-existent kernel.
            if (!projectId && typeof this.envRegistry.resolveById === 'function') {
                const headerVal = this.extractProjectIdHeader(req);
                if (headerVal) {
                    try {
                        const driver = await this.envRegistry.resolveById(headerVal);
                        if (driver) projectId = headerVal;
                    } catch {
                        // fall through to default fallback
                    }
                }
            }
        }
        // 3. Single-project default fallback. Registered by
        //    `createSingleProjectPlugin()` so bare `/api/v1/data/...` URLs
        //    (no `/projects/<id>` prefix, no hostname mapping, no header)
        //    resolve to the lone project's kernel rather than the control
        //    plane.
        if (!projectId && this.defaultProjectIdProvider) {
            try {
                const def = this.defaultProjectIdProvider();
                if (def) projectId = def;
            } catch { /* fall through */ }
        }
        if (!projectId || !this.kernelManager) return this.protocol;
        const kernel = await this.kernelManager.getOrCreate(projectId);
        return kernel.getServiceAsync<ObjectStackProtocol>('protocol');
    }

    /**
     * Resolve the i18n service for the request's project (or control plane
     * when no project id is in scope). Returns `undefined` when no service is
     * registered, so callers can short-circuit and skip translation rather
     * than failing.
     *
     * Mirrors `resolveProtocol`'s lookup chain: explicit `projectId` from the
     * route → kernel-managed `i18n` service. Control-plane / unscoped
     * requests intentionally return `undefined` because the platform kernel
     * does not own per-app translation bundles.
     */
    private async resolveI18nService(projectId?: string): Promise<any | undefined> {
        if (!projectId || projectId === 'platform' || !this.kernelManager) return undefined;
        try {
            const kernel = await this.kernelManager.getOrCreate(projectId);
            return await kernel.getServiceAsync<any>('i18n');
        } catch {
            return undefined;
        }
    }

    /**
     * Reject anonymous requests with HTTP 401 when `api.requireAuth` is set.
     * Returns `true` if the response was sent and the caller should stop
     * processing. Returns `false` to continue.
     *
     * The check is intentionally narrow: only `context?.userId` counts as
     * "authenticated". `isSystem` flags are never set on inbound HTTP
     * requests (they're internal-only), so they cannot bypass this gate.
     */
    private enforceAuth(req: any, res: any, context: any): boolean {
        if (!this.config.api.requireAuth) return false;
        if (context?.userId) return false;
        if (req?.method === 'OPTIONS') return false;
        res.status(401).json({
            error: 'unauthenticated',
            message: 'Authentication is required to access this endpoint.',
        });
        return true;
    }

    /**
     * Resolve the request's execution context (RBAC/RLS/FLS) by looking up
     * the better-auth session via the project's `auth` service. Returns
     * `undefined` for anonymous requests so callers can pass `context` as-is
     * to the protocol layer (the SecurityPlugin treats undefined as anon).
     */
    private async resolveExecCtx(projectId: string | undefined, req: any): Promise<any | undefined> {
        try {
            // For multi-tenant hosts (objectos), incoming requests on unscoped
            // URLs like `/api/v1/data/:object` arrive with `projectId === undefined`.
            // The route's protocol resolver already maps hostname → projectId
            // (see resolveProtocol). We mirror that here so getSession() can
            // find the right per-project auth service. Without this, the
            // hostname-routed requests fall through to defaultProjectIdProvider/
            // authServiceProvider (neither of which is wired in objectos) and
            // every authenticated user sees 401.
            if (!projectId && req && this.envRegistry && this.kernelManager) {
                const host = this.extractHostname(req);
                if (host) {
                    try {
                        const result = await this.envRegistry.resolveByHostname(host);
                        if (result?.projectId) projectId = result.projectId;
                    } catch { /* fall through */ }
                }
                if (!projectId && typeof this.envRegistry.resolveById === 'function') {
                    const headerVal = this.extractProjectIdHeader(req);
                    if (headerVal) {
                        try {
                            const driver = await this.envRegistry.resolveById(headerVal);
                            if (driver) projectId = headerVal;
                        } catch { /* fall through */ }
                    }
                }
            }
            // Look up the auth service in the right kernel. For unscoped
            // single-project apps the kernelManager will hand us the lone
            // tenant kernel; for multi-project hosts we use the resolved
            // projectId.
            let authService: any;
            let kernel: any;
            if (projectId && projectId !== 'platform' && this.kernelManager) {
                kernel = await this.kernelManager.getOrCreate(projectId);
                authService = await kernel.getServiceAsync('auth').catch(() => undefined);
            }
            if (!authService && this.defaultProjectIdProvider && this.kernelManager) {
                try {
                    const def = this.defaultProjectIdProvider();
                    if (def) {
                        kernel = await this.kernelManager.getOrCreate(def);
                        authService = await kernel.getServiceAsync('auth').catch(() => undefined);
                    }
                } catch { /* fall through */ }
            }
            // Single-kernel deployment fallback — no kernelManager, but
            // the plugin wired an `authServiceProvider` that hits the
            // local kernel directly.
            if (!authService && this.authServiceProvider) {
                authService = await this.authServiceProvider(projectId).catch(() => undefined);
            }
            if (!authService) return undefined;
            // The auth service may be the AuthManager wrapper (which exposes
            // `getApi()`) or the raw better-auth instance (which exposes
            // `.api` directly). Normalize to the raw API object.
            let api: any = authService.api;
            if (!api && typeof authService.getApi === 'function') {
                api = await authService.getApi();
            }
            if (!api?.getSession) return undefined;

            // better-auth's `getSession` requires a Web `Headers` instance
            // (it calls `headers.get('cookie')`). Adapter req.headers may
            // already be one, or a plain object — normalize.
            const rawHeaders: any = req?.headers;
            let headers: any;
            if (rawHeaders && typeof rawHeaders.get === 'function') {
                headers = rawHeaders;
            } else if (rawHeaders && typeof rawHeaders === 'object') {
                headers = new (globalThis as any).Headers();
                for (const [k, v] of Object.entries(rawHeaders)) {
                    if (Array.isArray(v)) v.forEach((x) => headers.append(k, String(x)));
                    else if (v != null) headers.set(k, String(v));
                }
            } else {
                return undefined;
            }

            const session = await api.getSession({ headers });
            if (!session?.user?.id) return undefined;
            const userId = session.user.id;
            const tenantId = session.session?.activeOrganizationId ?? undefined;
            const permissions: string[] = [];
            const roles: string[] = [];
            // Look up the link tables to surface roles + permission set names.
            // Skipping this lookup would silently ignore admin/role grants —
            // including the platform-admin promotion seeded by
            // `bootstrapPlatformAdmin` — and force every authenticated user
            // through the `member_default` fallback path.
            try {
                let ql: any;
                if (kernel) {
                    ql = await kernel.getServiceAsync('objectql').catch(() => undefined);
                }
                if (!ql && this.objectQLProvider) {
                    ql = await this.objectQLProvider(projectId).catch(() => undefined);
                }
                if (ql && typeof ql.find === 'function') {
                    const sysOpts = { context: { isSystem: true } };
                    const memberRows = await ql.find('sys_member', {
                        where: tenantId ? { user_id: userId, organization_id: tenantId } : { user_id: userId },
                        limit: 50,
                        ...sysOpts,
                    } as any).catch(() => []);
                    for (const m of (memberRows ?? []) as any[]) {
                        if (typeof m.role === 'string') {
                            for (const r of m.role.split(',').map((s: string) => s.trim()).filter(Boolean)) {
                                if (!roles.includes(r)) roles.push(r);
                            }
                        }
                    }
                    const upsRows = await ql.find('sys_user_permission_set', {
                        where: { user_id: userId },
                        limit: 100,
                        ...sysOpts,
                    } as any).catch(() => []);
                    const psIds = new Set<string>();
                    for (const r of (upsRows ?? []) as any[]) {
                        const orgScope = r.organization_id ?? null;
                        if (!orgScope || (tenantId && orgScope === tenantId)) {
                            const pid = r.permission_set_id ?? r.permissionSetId;
                            if (pid) psIds.add(pid);
                        }
                    }
                    if (psIds.size > 0) {
                        const psRows = await ql.find('sys_permission_set', {
                            where: { id: { $in: Array.from(psIds) } },
                            limit: 500,
                            ...sysOpts,
                        } as any).catch(() => []);
                        for (const ps of (psRows ?? []) as any[]) {
                            if (ps.name && !permissions.includes(ps.name)) permissions.push(ps.name);
                        }
                    }
                }
            } catch { /* fall through with empty perms */ }
            return {
                userId,
                tenantId,
                roles,
                permissions,
                isSystem: false,
            };
        } catch {
            return undefined;
        }
    }

    /**
     * Build a `TranslationBundle` (`Record<locale, TranslationData>`) from an
     * `II18nService` instance. Returns `undefined` when no locales are
     * registered so callers can avoid translation work.
     */
    private buildTranslationBundle(i18n: any): any | undefined {
        if (!i18n || typeof i18n.getLocales !== 'function' || typeof i18n.getTranslations !== 'function') {
            return undefined;
        }
        const locales: string[] = i18n.getLocales();
        if (!locales.length) return undefined;
        const bundle: Record<string, any> = {};
        for (const locale of locales) {
            const data = i18n.getTranslations(locale);
            if (data && typeof data === 'object') bundle[locale] = data;
        }
        return Object.keys(bundle).length ? bundle : undefined;
    }

    /**
     * Parse the highest-priority locale from an `Accept-Language` header.
     * Falls back to a `?locale=` query parameter, then to the i18n service's
     * default locale. Returns `undefined` when no preference is expressed
     * (callers will then return untranslated metadata).
     */
    private extractLocale(req: any, i18n?: any): string | undefined {
        const headers = req?.headers;
        let header: string | undefined;
        if (headers) {
            header = typeof headers.get === 'function'
                ? headers.get('accept-language') ?? undefined
                : headers['accept-language'] ?? headers['Accept-Language'];
        }
        if (typeof header === 'string' && header.length > 0) {
            const top = header.split(',')[0]?.split(';')[0]?.trim();
            if (top) return top;
        }
        const queryLocale = req?.query?.locale;
        if (typeof queryLocale === 'string' && queryLocale.length > 0) return queryLocale;
        if (i18n && typeof i18n.getDefaultLocale === 'function') {
            const def = i18n.getDefaultLocale();
            if (typeof def === 'string' && def.length > 0) return def;
        }
        return undefined;
    }

    /**
     * Translate a single metadata document (view or action) when an i18n
     * service is registered for the request's project and the requested
     * locale yields a match. Falls through unchanged for unsupported types
     * or missing translations.
     */
    private async translateMetaItem(req: any, type: string, projectId: string | undefined, item: any): Promise<any> {
        if (!item || typeof item !== 'object') return item;
        if (type !== 'view' && type !== 'action') return item;
        const i18n = await this.resolveI18nService(projectId);
        const bundle = this.buildTranslationBundle(i18n);
        if (!bundle) return item;
        const locale = this.extractLocale(req, i18n);
        if (!locale) return item;
        const { translateMetadataDocument } = await import('@objectstack/spec/system');
        return translateMetadataDocument(type, item, bundle, { locale });
    }

    /**
     * Translate a list of metadata documents using `translateMetaItem`.
     */
    private async translateMetaItems(req: any, type: string, projectId: string | undefined, items: any): Promise<any> {
        if (!Array.isArray(items)) return items;
        if (type !== 'view' && type !== 'action') return items;
        const i18n = await this.resolveI18nService(projectId);
        const bundle = this.buildTranslationBundle(i18n);
        if (!bundle) return items;
        const locale = this.extractLocale(req, i18n);
        if (!locale) return items;
        const { translateMetadataDocument } = await import('@objectstack/spec/system');
        return items.map((item) => translateMetadataDocument(type, item, bundle, { locale }));
    }

    /**
     * Pull the request hostname (without port) from a Node-style `req` or
     * a Fetch-style request wrapper. Returns undefined when no Host header
     * is available.
     */
    private extractHostname(req: any): string | undefined {
        const headers = req?.headers;
        let host: string | undefined;
        if (headers) {
            if (typeof headers.get === 'function') {
                host = headers.get('host') ?? undefined;
            } else {
                host = headers.host ?? headers.Host;
            }
        }
        if (!host && typeof req?.hostname === 'string') host = req.hostname;
        if (!host && typeof req?.url === 'string') {
            // Fetch-style requests expose the hostname via `req.url` even
            // when the (forbidden) `Host` header has been stripped by the
            // runtime. This branch keeps hostname-routing working when
            // tests build a `Request` object through `app.fetch(...)`.
            try {
                host = new (globalThis as any).URL(req.url).host;
            } catch { /* ignore */ }
        }
        if (!host) return undefined;
        return String(host).split(':')[0].toLowerCase();
    }

    /**
     * Pull the `X-Project-Id` header from a Node- or Fetch-style request.
     * Header names are case-insensitive; we probe both casings to cover
     * adapters that don't normalize headers (e.g. raw Node http).
     */
    private extractProjectIdHeader(req: any): string | undefined {
        const headers = req?.headers;
        if (!headers) return undefined;
        let val: unknown;
        if (typeof headers.get === 'function') {
            val = headers.get('x-project-id') ?? headers.get('X-Project-Id');
        } else {
            val = headers['x-project-id'] ?? headers['X-Project-Id'];
        }
        if (Array.isArray(val)) val = val[0];
        if (typeof val !== 'string') return undefined;
        const trimmed = val.trim();
        return trimmed.length > 0 ? trimmed : undefined;
    }
    
    /**
     * Normalize configuration with defaults
     */
    private normalizeConfig(config: RestServerConfig): NormalizedRestServerConfig {
        const api = (config.api ?? {}) as Partial<RestApiConfig>;
        const crud = (config.crud ?? {}) as Partial<CrudEndpointsConfig>;
        const metadata = (config.metadata ?? {}) as Partial<MetadataEndpointsConfig>;
        const batch = (config.batch ?? {}) as Partial<BatchEndpointsConfig>;
        const routes = (config.routes ?? {}) as Partial<RouteGenerationConfig>;
        
        return {
            api: {
                version: api.version ?? 'v1',
                basePath: api.basePath ?? '/api',
                apiPath: api.apiPath,
                enableCrud: api.enableCrud ?? true,
                enableMetadata: api.enableMetadata ?? true,
                enableUi: api.enableUi ?? true,
                enableBatch: api.enableBatch ?? true,
                enableDiscovery: api.enableDiscovery ?? true,
                enableSearch: (api as any).enableSearch ?? true,
                enableProjectScoping: api.enableProjectScoping ?? false,
                projectResolution: api.projectResolution ?? 'auto',
                requireAuth: (api as any).requireAuth ?? false,
                documentation: api.documentation,
                responseFormat: api.responseFormat,
            },
            crud: {
                operations: crud.operations ?? {
                    create: true,
                    read: true,
                    update: true,
                    delete: true,
                    list: true,
                },
                patterns: crud.patterns,
                dataPrefix: crud.dataPrefix ?? '/data',
                objectParamStyle: crud.objectParamStyle ?? 'path',
            },
            metadata: {
                prefix: metadata.prefix ?? '/meta',
                enableCache: metadata.enableCache ?? true,
                cacheTtl: metadata.cacheTtl ?? 3600,
                endpoints: metadata.endpoints ?? {
                    types: true,
                    items: true,
                    item: true,
                    schema: true,
                },
            },
            batch: {
                maxBatchSize: batch.maxBatchSize ?? 200,
                enableBatchEndpoint: batch.enableBatchEndpoint ?? true,
                operations: batch.operations ?? {
                    createMany: true,
                    updateMany: true,
                    deleteMany: true,
                    upsertMany: true,
                },
                defaultAtomic: batch.defaultAtomic ?? true,
            },
            routes: {
                includeObjects: routes.includeObjects,
                excludeObjects: routes.excludeObjects,
                nameTransform: routes.nameTransform ?? 'none',
                overrides: routes.overrides,
            },
        };
    }
    
    /**
     * Get the full API base path
     */
    private getApiBasePath(): string {
        const { api } = this.config;
        return api.apiPath ?? `${api.basePath}/${api.version}`;
    }

    /**
     * Get the project-scoped base path for a given unscoped base.
     * Example: `/api/v1` → `/api/v1/projects/:projectId`.
     */
    private getScopedBasePath(basePath: string): string {
        return `${basePath}/projects/:projectId`;
    }

    /**
     * Register all REST API routes
     *
     * When `enableProjectScoping` is true, routes are registered under
     * `/api/v1/projects/:projectId/...`. The `projectResolution` strategy
     * controls whether unscoped legacy routes remain available:
     *   - `required` → only scoped routes registered.
     *   - `optional` / `auto` → both scoped and unscoped routes registered.
     */
    registerRoutes(): void {
        const basePath = this.getApiBasePath();
        const { enableProjectScoping, projectResolution } = this.config.api;

        const registerForBase = (bp: string) => {
            if (this.config.api.enableDiscovery) {
                this.registerDiscoveryEndpoints(bp);
            }
            if (this.config.api.enableMetadata) {
                this.registerMetadataEndpoints(bp);
            }
            if (this.config.api.enableUi) {
                this.registerUiEndpoints(bp);
            }
            if (this.config.api.enableSearch ?? true) {
                this.registerSearchEndpoints(bp);
            }
            this.registerEmailEndpoints(bp);
            // Capability routes (sharing rules, reports, approvals) live at
            // the top of the API surface (`/api/v1/{capability}/...`) rather
            // than under `/data/`, so they don't collide with the greedy
            // CRUD `/:object` matcher and don't pretend to be records on a
            // single object.
            this.registerSharingEndpoints(bp);
            this.registerSharingRuleEndpoints(bp);
            this.registerReportsEndpoints(bp);
            this.registerApprovalsEndpoints(bp);
            if (this.config.api.enableCrud) {
                this.registerCrudEndpoints(bp);
            }
            this.registerDataActionEndpoints(bp);
            if (this.config.api.enableBatch) {
                this.registerBatchEndpoints(bp);
            }
        };

        if (enableProjectScoping) {
            const scopedBase = this.getScopedBasePath(basePath);
            if (projectResolution === 'required') {
                // Strict: only scoped routes
                registerForBase(scopedBase);
            } else {
                // 'optional' | 'auto' — keep both so legacy callers keep working
                registerForBase(basePath);
                registerForBase(scopedBase);
            }
        } else {
            registerForBase(basePath);
        }
    }
    
    /**
     * Register discovery endpoints
     */
    private registerDiscoveryEndpoints(basePath: string): void {
        const isScoped = basePath.includes('/projects/:projectId');
        const discoveryHandler = async (req: any, res: any) => {
                try {
                    const discovery = await this.protocol.getDiscovery();

                    // Override discovery information with actual server configuration
                    discovery.version = this.config.api.version;

                    // Substitute the resolved projectId into the advertised routes so
                    // clients can consume them verbatim (e.g. /api/v1/projects/abc/data).
                    const realBase = isScoped
                        ? basePath.replace(':projectId', req.params?.projectId ?? ':projectId')
                        : basePath;

                    if (discovery.routes) {
                        // Ensure routes match the actual mounted paths
                        if (this.config.api.enableCrud) {
                            discovery.routes.data = `${realBase}${this.config.crud.dataPrefix}`;
                        }

                        if (this.config.api.enableMetadata) {
                            discovery.routes.metadata = `${realBase}${this.config.metadata.prefix}`;
                        }

                        if (this.config.api.enableUi) {
                            discovery.routes.ui = `${realBase}/ui`;
                        }

                        // Align auth route with the versioned base path if present.
                        // Auth is a control-plane concern, so use the unscoped base.
                        if (discovery.routes.auth) {
                            const unscopedBase = isScoped
                                ? basePath.replace(/\/projects\/:projectId$/, '')
                                : basePath;
                            discovery.routes.auth = `${unscopedBase}/auth`;
                        }
                    }

                    // Attach scoping metadata so clients can detect dual-mode routing.
                    (discovery as any).scoping = {
                        enabled: this.config.api.enableProjectScoping,
                        resolution: this.config.api.projectResolution,
                        scoped: isScoped,
                        projectId: isScoped ? req.params?.projectId : undefined,
                    };

                    res.json(discovery);
                } catch (error: any) {
                    logError("[REST] Unhandled error:", error);
                    sendError(res, error);
                }
            };

        // Register at basePath (e.g. /api/v1)
        this.routeManager.register({
            method: 'GET',
            path: basePath,
            handler: discoveryHandler,
            metadata: {
                summary: 'Get API discovery information',
                tags: ['discovery'],
            },
        });

        // Register at basePath/discovery (e.g. /api/v1/discovery)
        this.routeManager.register({
            method: 'GET',
            path: `${basePath}/discovery`,
            handler: discoveryHandler,
            metadata: {
                summary: 'Get API discovery information',
                tags: ['discovery'],
            },
        });
    }
    
    /**
     * Register metadata endpoints
     */
    private registerMetadataEndpoints(basePath: string): void {
        const { metadata } = this.config;
        const metaPath = `${basePath}${metadata.prefix}`;
        const isScoped = basePath.includes('/projects/:projectId');

        // GET /meta - List all metadata types
        if (metadata.endpoints.types !== false) {
            this.routeManager.register({
                method: 'GET',
                path: metaPath,
                handler: async (req: any, res: any) => {
                    try {
                        const projectId = isScoped ? req.params?.projectId : undefined;
                        const p = await this.resolveProtocol(projectId, req);
                        const types = await p.getMetaTypes();
                        res.json(types);
                    } catch (error: any) {
                        logError("[REST] Unhandled error:", error);
                        sendError(res, error);
                    }
                },
                metadata: {
                    summary: 'List all metadata types',
                    tags: ['metadata'],
                },
            });
        }

        // GET /meta/:type - List items of a type
        if (metadata.endpoints.items !== false) {
            this.routeManager.register({
                method: 'GET',
                path: `${metaPath}/:type`,
                handler: async (req: any, res: any) => {
                    try {
                        const packageId = req.query?.package || undefined;
                        const projectId = isScoped ? req.params?.projectId : undefined;
                        const p = await this.resolveProtocol(projectId, req);
                        const items = await p.getMetaItems({
                            type: req.params.type,
                            packageId,
                            ...(projectId ? { projectId } : {}),
                        } as any);
                        const translated = await this.translateMetaItems(req, req.params.type, projectId, items);
                        res.header('Vary', 'Accept-Language');
                        res.json(translated);
                    } catch (error: any) {
                        logError("[REST] Unhandled error:", error);
                        sendError(res, error);
                    }
                },
                metadata: {
                    summary: 'List metadata items of a type',
                    tags: ['metadata'],
                },
            });
        }

        // GET /meta/:type/:name - Get specific item
        if (metadata.endpoints.item !== false) {
            this.routeManager.register({
                method: 'GET',
                path: `${metaPath}/:type/:name`,
                handler: async (req: any, res: any) => {
                    try {
                        const projectId = isScoped ? req.params?.projectId : undefined;
                        const p = await this.resolveProtocol(projectId, req);
                        // Check if cached version is available
                        if (metadata.enableCache && p.getMetaItemCached) {
                            const cacheRequest = {
                                ifNoneMatch: req.headers['if-none-match'] as string,
                                ifModifiedSince: req.headers['if-modified-since'] as string,
                            };

                            const result = await p.getMetaItemCached({
                                type: req.params.type,
                                name: req.params.name,
                                cacheRequest,
                                ...(projectId ? { projectId } : {}),
                            } as any);

                            if (result.notModified) {
                                res.status(304).send();
                                return;
                            }

                            // Set cache headers
                            if (result.etag) {
                                const etagValue = result.etag.weak
                                    ? `W/"${result.etag.value}"`
                                    : `"${result.etag.value}"`;
                                res.header('ETag', etagValue);
                            }
                            if (result.lastModified) {
                                res.header('Last-Modified', new Date(result.lastModified).toUTCString());
                            }
                            if (result.cacheControl) {
                                const directives = result.cacheControl.directives.join(', ');
                                const maxAge = result.cacheControl.maxAge
                                    ? `, max-age=${result.cacheControl.maxAge}`
                                    : '';
                                res.header('Cache-Control', directives + maxAge);
                            }

                            res.header('Vary', 'Accept-Language');
                            res.json(await this.translateMetaItem(req, req.params.type, projectId, result.data));
                        } else {
                            // Non-cached version
                            const packageId = req.query?.package || undefined;
                            const item = await p.getMetaItem({
                                type: req.params.type,
                                name: req.params.name,
                                packageId,
                            } as any);
                            res.header('Vary', 'Accept-Language');
                            res.json(await this.translateMetaItem(req, req.params.type, projectId, item));
                        }
                    } catch (error: any) {
                        logError("[REST] Unhandled error:", error);
                        sendError(res, error);
                    }
                },
                metadata: {
                    summary: 'Get specific metadata item',
                    tags: ['metadata'],
                },
            });
        }

        // PUT /meta/:type/:name - Save metadata item
        // We always register this route, but return 501 if protocol doesn't support it
        // This makes it discoverable even if not implemented
        this.routeManager.register({
            method: 'PUT',
            path: `${metaPath}/:type/:name`,
            handler: async (req: any, res: any) => {
                try {
                    const projectId = isScoped ? req.params?.projectId : undefined;
                    const p = await this.resolveProtocol(projectId, req);
                    if (!p.saveMetaItem) {
                        res.status(501).json({ error: 'Save operation not supported by protocol implementation' });
                        return;
                    }

                    // Accept both `{ ...itemFields }` (bare) and `{ metadata: {...} }`
                    // / `{ item: {...} }` envelope shapes. Studio and direct API
                    // callers historically use either; ADR-0005 settles on
                    // unwrapping to a single payload before persistence.
                    const body = req.body ?? {};
                    const item = (body && typeof body === 'object' && 'metadata' in body)
                        ? (body as any).metadata
                        : (body && typeof body === 'object' && 'item' in body)
                            ? (body as any).item
                            : body;

                    const result = await p.saveMetaItem({
                        type: req.params.type,
                        name: req.params.name,
                        item,
                        ...(projectId ? { projectId } : {}),
                    } as any);
                    res.json(result);
                } catch (error: any) {
                    logError("[REST] Unhandled error:", error);
                    sendError(res, error);
                }
            },
            metadata: {
                summary: 'Save specific metadata item',
                tags: ['metadata'],
            },
        });

        // DELETE /meta/:type/:name - Reset metadata item to artifact default
        // Removes a customization overlay row from sys_metadata (ADR-0005).
        // Returns 200 even when no overlay existed (idempotent reset).
        this.routeManager.register({
            method: 'DELETE',
            path: `${metaPath}/:type/:name`,
            handler: async (req: any, res: any) => {
                try {
                    const projectId = isScoped ? req.params?.projectId : undefined;
                    const p = await this.resolveProtocol(projectId, req);
                    if (!(p as any).deleteMetaItem) {
                        res.status(501).json({
                            error: 'Reset operation not supported by protocol implementation',
                        });
                        return;
                    }
                    const result = await (p as any).deleteMetaItem({
                        type: req.params.type,
                        name: req.params.name,
                        ...(projectId ? { projectId } : {}),
                    });
                    res.json(result);
                } catch (error: any) {
                    logError("[REST] Unhandled error:", error);
                    sendError(res, error);
                }
            },
            metadata: {
                summary: 'Reset metadata item to artifact default (deletes customization overlay)',
                tags: ['metadata'],
            },
        });

        // GET /meta/:type/:section/:name - Get specific item with compound name
        // Compound names express sub-resources of a type (e.g. a view of an
        // object, a flow under an automation). The protocol layer treats
        // `<section>/<name>` as a single opaque key.
        if (metadata.endpoints.item !== false) {
            this.routeManager.register({
                method: 'GET',
                path: `${metaPath}/:type/:section/:name`,
                handler: async (req: any, res: any) => {
                    try {
                        const projectId = isScoped ? req.params?.projectId : undefined;
                        const p = await this.resolveProtocol(projectId, req);
                        const compoundName = `${req.params.section}/${req.params.name}`;
                        const packageId = req.query?.package || undefined;
                        const item = await p.getMetaItem({
                            type: req.params.type,
                            name: compoundName,
                            packageId,
                        } as any);
                        res.header('Vary', 'Accept-Language');
                        res.json(await this.translateMetaItem(req, req.params.type, projectId, item));
                    } catch (error: any) {
                        logError("[REST] Unhandled error:", error);
                        sendError(res, error);
                    }
                },
                metadata: {
                    summary: 'Get specific metadata item by compound name',
                    tags: ['metadata'],
                },
            });
        }

        // PUT /meta/:type/:section/:name - Save metadata item with compound name
        this.routeManager.register({
            method: 'PUT',
            path: `${metaPath}/:type/:section/:name`,
            handler: async (req: any, res: any) => {
                try {
                    const projectId = isScoped ? req.params?.projectId : undefined;
                    const p = await this.resolveProtocol(projectId, req);
                    if (!p.saveMetaItem) {
                        res.status(501).json({ error: 'Save operation not supported by protocol implementation' });
                        return;
                    }

                    const compoundName = `${req.params.section}/${req.params.name}`;
                    const result = await p.saveMetaItem({
                        type: req.params.type,
                        name: compoundName,
                        item: req.body,
                        ...(projectId ? { projectId } : {}),
                    } as any);
                    res.json(result);
                } catch (error: any) {
                    logError("[REST] Unhandled error:", error);
                    sendError(res, error);
                }
            },
            metadata: {
                summary: 'Save specific metadata item by compound name',
                tags: ['metadata'],
            },
        });
    }

    /**
     * Register UI endpoints
     */
    private registerUiEndpoints(basePath: string): void {
        const uiPath = `${basePath}/ui`;
        const isScoped = basePath.includes('/projects/:projectId');

        // GET /ui/view/:object/:type - Resolve view for object
        this.routeManager.register({
            method: 'GET',
            path: `${uiPath}/view/:object/:type`,
            handler: async (req: any, res: any) => {
                try {
                    const projectId = isScoped ? req.params?.projectId : undefined;
                    const p = await this.resolveProtocol(projectId, req);
                    if (p.getUiView) {
                        const view = await p.getUiView({
                            object: req.params.object,
                            type: req.params.type as any,
                            ...(projectId ? { projectId } : {}),
                        } as any);
                        res.json(view);
                    } else {
                        res.status(501).json({ error: 'UI View resolution not supported by protocol implementation' });
                    }
                } catch (error: any) {
                    logError("[REST] Unhandled error:", error);
                    sendError(res, error, req.params?.object);
                }
            },
            metadata: {
                summary: 'Resolve UI View for object',
                tags: ['ui'],
            },
        });
    }
    
    /**
     * Register CRUD endpoints for data operations
     */
    private registerCrudEndpoints(basePath: string): void {
        const { crud } = this.config;
        const dataPath = `${basePath}${crud.dataPrefix}`;
        const isScoped = basePath.includes('/projects/:projectId');

        const operations = crud.operations;

        // GET /data/:object - List/query records
        if (operations.list) {
            this.routeManager.register({
                method: 'GET',
                path: `${dataPath}/:object`,
                handler: async (req: any, res: any) => {
                    try {
                        const projectId = isScoped ? req.params?.projectId : undefined;
                        const p = await this.resolveProtocol(projectId, req);
                        const context = await this.resolveExecCtx(projectId, req);
                        if (this.enforceAuth(req, res, context)) return;
                        const result = await p.findData({
                            object: req.params.object,
                            query: req.query,
                            ...(projectId ? { projectId } : {}),
                            ...(context ? { context } : {}),
                        } as any);
                        res.json(result);
                    } catch (error: any) {
                        const mapped = mapDataError(error, req.params?.object);
                        if (mapped.status === 404 || mapped.status === 503 || mapped.status === 502) {
                            res.status(mapped.status).json(mapped.body);
                        } else {
                            logError("[REST] Unhandled error:", error);
                            res.status(mapped.status).json(mapped.body);
                        }
                    }
                },
                metadata: {
                    summary: 'Query records',
                    tags: ['data', 'crud'],
                },
            });
        }

        // GET /data/:object/:id - Get single record
        if (operations.read) {
            this.routeManager.register({
                method: 'GET',
                path: `${dataPath}/:object/:id`,
                handler: async (req: any, res: any) => {
                    try {
                        const projectId = isScoped ? req.params?.projectId : undefined;
                        const p = await this.resolveProtocol(projectId, req);
                        const { select, expand } = req.query || {};
                        const context = await this.resolveExecCtx(projectId, req);
                        if (this.enforceAuth(req, res, context)) return;
                        const result = await p.getData({
                            object: req.params.object,
                            id: req.params.id,
                            ...(select != null ? { select } : {}),
                            ...(expand != null ? { expand } : {}),
                            ...(projectId ? { projectId } : {}),
                            ...(context ? { context } : {}),
                        } as any);
                        res.json(result);
                    } catch (error: any) {
                        const mapped = mapDataError(error, req.params?.object);
                        if (!isExpectedDataStatus(mapped.status) && mapped.body?.code !== "VALIDATION_FAILED") logError("[REST] Unhandled error:", error);
                        res.status(mapped.status === 400 ? 404 : mapped.status).json(mapped.body);
                    }
                },
                metadata: {
                    summary: 'Get record by ID',
                    tags: ['data', 'crud'],
                },
            });
        }

        // POST /data/:object - Create record
        if (operations.create) {
            this.routeManager.register({
                method: 'POST',
                path: `${dataPath}/:object`,
                handler: async (req: any, res: any) => {
                    try {
                        const projectId = isScoped ? req.params?.projectId : undefined;
                        const p = await this.resolveProtocol(projectId, req);
                        const context = await this.resolveExecCtx(projectId, req);
                        if (this.enforceAuth(req, res, context)) return;
                        const result = await p.createData({
                            object: req.params.object,
                            data: req.body,
                            ...(projectId ? { projectId } : {}),
                            ...(context ? { context } : {}),
                        } as any);
                        res.status(201).json(result);
                    } catch (error: any) {
                        const mapped = mapDataError(error, req.params?.object);
                        if (!isExpectedDataStatus(mapped.status) && mapped.body?.code !== "VALIDATION_FAILED") logError("[REST] Unhandled error:", error);
                        res.status(mapped.status).json(mapped.body);
                    }
                },
                metadata: {
                    summary: 'Create record',
                    tags: ['data', 'crud'],
                },
            });
        }

        // POST /data/:object/query — Spec-shape advanced query (QueryAST in body).
        // Supports server-side aggregation via { groupBy, aggregations, where, ... }
        // per spec/data/query.zod.ts. Mirrors what `client.data.query()` posts.
        // Returns FindDataResponse = { object, records, total? }.
        if (operations.list) {
            this.routeManager.register({
                method: 'POST',
                path: `${dataPath}/:object/query`,
                handler: async (req: any, res: any) => {
                    try {
                        const projectId = isScoped ? req.params?.projectId : undefined;
                        const p = await this.resolveProtocol(projectId, req);
                        const context = await this.resolveExecCtx(projectId, req);
                        if (this.enforceAuth(req, res, context)) return;
                        const result = await p.findData({
                            object: req.params.object,
                            query: req.body || {},
                            ...(projectId ? { projectId } : {}),
                            ...(context ? { context } : {}),
                        } as any);
                        res.json(result);
                    } catch (error: any) {
                        const mapped = mapDataError(error, req.params?.object);
                        if (!isExpectedDataStatus(mapped.status)) logError("[REST] Unhandled error:", error);
                        res.status(mapped.status).json(mapped.body);
                    }
                },
                metadata: {
                    summary: 'Advanced query (QueryAST in body)',
                    tags: ['data', 'crud'],
                },
            });
        }

        // PATCH /data/:object/:id - Update record
        if (operations.update) {
            this.routeManager.register({
                method: 'PATCH',
                path: `${dataPath}/:object/:id`,
                handler: async (req: any, res: any) => {
                    try {
                        const projectId = isScoped ? req.params?.projectId : undefined;
                        const p = await this.resolveProtocol(projectId, req);
                        const context = await this.resolveExecCtx(projectId, req);
                        if (this.enforceAuth(req, res, context)) return;
                        const result = await p.updateData({
                            object: req.params.object,
                            id: req.params.id,
                            data: req.body,
                            ...(projectId ? { projectId } : {}),
                            ...(context ? { context } : {}),
                        } as any);
                        res.json(result);
                    } catch (error: any) {
                        const mapped = mapDataError(error, req.params?.object);
                        if (!isExpectedDataStatus(mapped.status) && mapped.body?.code !== "VALIDATION_FAILED") logError("[REST] Unhandled error:", error);
                        res.status(mapped.status).json(mapped.body);
                    }
                },
                metadata: {
                    summary: 'Update record',
                    tags: ['data', 'crud'],
                },
            });
        }

        // DELETE /data/:object/:id - Delete record
        if (operations.delete) {
            this.routeManager.register({
                method: 'DELETE',
                path: `${dataPath}/:object/:id`,
                handler: async (req: any, res: any) => {
                    try {
                        const projectId = isScoped ? req.params?.projectId : undefined;
                        const p = await this.resolveProtocol(projectId, req);
                        const context = await this.resolveExecCtx(projectId, req);
                        if (this.enforceAuth(req, res, context)) return;
                        const result = await p.deleteData({
                            object: req.params.object,
                            id: req.params.id,
                            ...(projectId ? { projectId } : {}),
                            ...(context ? { context } : {}),
                        } as any);
                        res.json(result);
                    } catch (error: any) {
                        const mapped = mapDataError(error, req.params?.object);
                        if (!isExpectedDataStatus(mapped.status) && mapped.body?.code !== "VALIDATION_FAILED") logError("[REST] Unhandled error:", error);
                        res.status(mapped.status).json(mapped.body);
                    }
                },
                metadata: {
                    summary: 'Delete record',
                    tags: ['data', 'crud'],
                },
            });
        }
    }
    
    /**
     * Register object-specific action endpoints that don't fit the
     * generic CRUD shape. These are domain operations (Salesforce
     * convertLead, etc.) where the protocol implementation does its own
     * multi-record orchestration and we just need a thin HTTP route.
     *
     * POST {basePath}/data/lead/:id/convert — M10.6 lead conversion.
     */
    private registerDataActionEndpoints(basePath: string): void {
        const isScoped = basePath.includes('/projects/:projectId');
        const { crud } = this.config;
        const dataPath = `${basePath}${crud.dataPrefix}`;

        // POST /data/lead/:id/convert
        this.routeManager.register({
            method: 'POST',
            path: `${dataPath}/lead/:id/convert`,
            handler: async (req: any, res: any) => {
                try {
                    const projectId = isScoped ? req.params?.projectId : undefined;
                    const p = await this.resolveProtocol(projectId, req);
                    const context = await this.resolveExecCtx(projectId, req);
                    if (this.enforceAuth(req, res, context)) return;
                    const convertLead = (p as any).convertLead;
                    if (typeof convertLead !== 'function') {
                        res.status(501).json({ code: 'NOT_IMPLEMENTED', error: 'Lead convert not supported by this protocol' });
                        return;
                    }
                    const body = req.body ?? {};
                    const result = await convertLead.call(p, {
                        leadId: req.params.id,
                        accountId: body.accountId,
                        contactId: body.contactId,
                        createOpportunity: body.createOpportunity,
                        opportunity: body.opportunity,
                        convertedStatus: body.convertedStatus,
                        ...(context ? { context } : {}),
                    });
                    res.json(result);
                } catch (error: any) {
                    logError('[REST] Unhandled error:', error);
                    sendError(res, error, 'lead');
                }
            },
            metadata: {
                summary: 'Convert a Lead into Account + Contact (+ optional Opportunity)',
                tags: ['data', 'lead'],
            },
        });
        // POST /data/:object/import  — bulk CSV/JSON ingestion (M10.9)
        //
        // Body shapes:
        //   { format: 'csv', csv: '...header,row,...', dryRun?: boolean, mapping?: {<csvCol>:<field>} }
        //   { format: 'json', rows: [...], dryRun?: boolean }
        //
        // Returns per-row outcome so a UI can present an import report.
        this.routeManager.register({
            method: 'POST',
            path: `${dataPath}/:object/import`,
            handler: async (req: any, res: any) => {
                try {
                    const projectId = isScoped ? req.params?.projectId : undefined;
                    const p = await this.resolveProtocol(projectId, req);
                    const context = await this.resolveExecCtx(projectId, req);
                    if (this.enforceAuth(req, res, context)) return;
                    const objectName = String(req.params.object || '');
                    if (!objectName) {
                        res.status(400).json({ code: 'INVALID_REQUEST', error: 'object is required' });
                        return;
                    }
                    const body = req.body ?? {};
                    const dryRun = body.dryRun === true;
                    const mapping: Record<string, string> = body.mapping ?? {};

                    // Build rows[] from either explicit JSON array or CSV text.
                    let rows: Array<Record<string, any>> = [];
                    if (body.format === 'json' && Array.isArray(body.rows)) {
                        rows = body.rows as Array<Record<string, any>>;
                    } else if ((body.format === 'csv' || typeof body.csv === 'string') && typeof body.csv === 'string') {
                        rows = parseCsvToRows(body.csv, mapping);
                    } else if (Array.isArray(body)) {
                        // Permissive: a bare JSON array at the top level.
                        rows = body as Array<Record<string, any>>;
                    } else {
                        res.status(400).json({
                            code: 'INVALID_REQUEST',
                            error: 'Provide either format:"csv" with csv text or format:"json" with rows[]',
                        });
                        return;
                    }

                    const max = 5000;
                    if (rows.length > max) {
                        res.status(413).json({
                            code: 'PAYLOAD_TOO_LARGE',
                            error: `Import limit is ${max} rows per request (got ${rows.length})`,
                        });
                        return;
                    }

                    const results: Array<{ row: number; ok: boolean; id?: string; error?: string; code?: string }> = [];
                    let okCount = 0;
                    let errCount = 0;

                    for (let i = 0; i < rows.length; i++) {
                        const data = rows[i];
                        try {
                            if (dryRun) {
                                // Validate via protocol's metadata layer when available, else
                                // best-effort: treat any non-empty row as syntactically OK.
                                const validate = (p as any).validate;
                                if (typeof validate === 'function') {
                                    await validate.call(p, { object: objectName, data, context });
                                }
                                results.push({ row: i + 1, ok: true });
                                okCount++;
                            } else {
                                const created = await (p as any).createData({ object: objectName, data, context });
                                const id = (created as any)?.id ?? (created as any)?.record?.id;
                                results.push({ row: i + 1, ok: true, id });
                                okCount++;
                            }
                        } catch (err: any) {
                            errCount++;
                            const code = err?.code ?? 'IMPORT_ROW_FAILED';
                            const message = typeof err?.message === 'string' ? err.message.slice(0, 300) : 'Row failed';
                            results.push({ row: i + 1, ok: false, error: message, code });
                        }
                    }

                    res.json({
                        object: objectName,
                        dryRun,
                        total: rows.length,
                        ok: okCount,
                        errors: errCount,
                        results,
                    });
                } catch (error: any) {
                    logError('[REST] Unhandled error:', error);
                    sendError(res, error, String(req.params?.object || ''));
                }
            },
            metadata: {
                summary: 'Bulk-import rows into an object (CSV or JSON, with optional dry-run)',
                tags: ['data', 'import'],
            },
        });

        // GET /data/:object/export  — streaming export (M10.21 / C.21)
        //
        // Query params:
        //   format=csv|json     (default: csv. json emits a JSON array.)
        //   fields=a,b,c        (default: derive from object schema; falls back to keys of the first row)
        //   filter=<json>       ($filter as URL-encoded JSON, same shape as list endpoint)
        //   orderby=field:desc  (optional ordering, mirrors $orderby semantics)
        //   limit=<n>           (default 10000, hard cap 50000)
        //   page=<n>            (driver chunk size, default 500, max 5000)
        //
        // Streams the response so 50k-row exports do not buffer in memory.
        // Filename suggests `${object}-${YYYY-MM-DD}.${ext}` for browsers.
        this.routeManager.register({
            method: 'GET',
            path: `${dataPath}/:object/export`,
            handler: async (req: any, res: any) => {
                try {
                    const projectId = isScoped ? req.params?.projectId : undefined;
                    const p = await this.resolveProtocol(projectId, req);
                    const context = await this.resolveExecCtx(projectId, req);
                    if (this.enforceAuth(req, res, context)) return;
                    const objectName = String(req.params.object || '');
                    if (!objectName) {
                        res.status(400).json({ code: 'INVALID_REQUEST', error: 'object is required' });
                        return;
                    }
                    const q = req.query ?? {};
                    const format = (String(q.format ?? 'csv')).toLowerCase() === 'json' ? 'json' : 'csv';
                    const HARD_CAP = 50_000;
                    const MAX_CHUNK = 5_000;
                    const requestedLimit = q.limit != null ? Math.max(1, Number(q.limit) || 0) : 10_000;
                    const limit = Math.min(requestedLimit, HARD_CAP);
                    const chunkSize = Math.min(MAX_CHUNK, Math.max(50, q.page != null ? Number(q.page) || 500 : 500));

                    let filter: any = undefined;
                    if (typeof q.filter === 'string' && q.filter.length > 0) {
                        try { filter = JSON.parse(q.filter); }
                        catch {
                            res.status(400).json({ code: 'INVALID_REQUEST', error: 'filter must be JSON' });
                            return;
                        }
                    } else if (q.filter && typeof q.filter === 'object') {
                        filter = q.filter;
                    }

                    let orderby: any = undefined;
                    if (typeof q.orderby === 'string' && q.orderby.length > 0) {
                        // Accept "field:dir,field2:dir" shorthand or a JSON object.
                        if (q.orderby.startsWith('{') || q.orderby.startsWith('[')) {
                            try { orderby = JSON.parse(q.orderby); } catch { /* leave undefined */ }
                        } else {
                            const obj: Record<string, 'asc' | 'desc'> = {};
                            for (const part of q.orderby.split(',')) {
                                const [field, dir] = part.split(':').map((s: string) => s.trim());
                                if (field) obj[field] = dir?.toLowerCase() === 'desc' ? 'desc' : 'asc';
                            }
                            if (Object.keys(obj).length > 0) orderby = obj;
                        }
                    }

                    // Resolve fields: explicit param > schema fields > derived from first row.
                    let fields: string[] | undefined;
                    if (typeof q.fields === 'string' && q.fields.length > 0) {
                        fields = q.fields.split(',').map((s: string) => s.trim()).filter(Boolean);
                    } else if (Array.isArray(q.fields)) {
                        fields = q.fields.filter((s: any) => typeof s === 'string' && s.length > 0);
                    }
                    if (!fields || fields.length === 0) {
                        try {
                            const schema = await (p as any).getObjectSchema?.(objectName, projectId);
                            const schemaFields = schema?.fields;
                            if (Array.isArray(schemaFields)) {
                                fields = schemaFields.map((f: any) => f.name).filter((n: any) => typeof n === 'string');
                            }
                        } catch { /* fall back to first-row derivation */ }
                    }

                    // Prepare streaming response. Set headers BEFORE first write.
                    const stamp = new Date().toISOString().slice(0, 10);
                    const safeObj = objectName.replace(/[^A-Za-z0-9_.-]/g, '_');
                    if (format === 'csv') {
                        res.header('Content-Type', 'text/csv; charset=utf-8');
                        res.header('Content-Disposition', `attachment; filename="${safeObj}-${stamp}.csv"`);
                    } else {
                        res.header('Content-Type', 'application/json; charset=utf-8');
                        res.header('Content-Disposition', `attachment; filename="${safeObj}-${stamp}.json"`);
                    }
                    res.header('X-Export-Format', format);
                    res.header('X-Export-Limit', String(limit));
                    res.header('Cache-Control', 'no-store');

                    let exported = 0;
                    let firstChunk = true;
                    let skip = 0;
                    if (format === 'json') res.write('[');

                    while (exported < limit) {
                        const take = Math.min(chunkSize, limit - exported);
                        const findArgs: any = {
                            object: objectName,
                            query: {
                                ...(filter ? { $filter: filter } : {}),
                                ...(orderby ? { $orderby: orderby } : {}),
                                $top: take,
                                $skip: skip,
                            },
                            ...(projectId ? { projectId } : {}),
                            ...(context ? { context } : {}),
                        };
                        const result: any = await (p as any).findData(findArgs);
                        const rows: any[] = Array.isArray(result?.data) ? result.data
                            : Array.isArray(result?.rows) ? result.rows
                                : Array.isArray(result) ? result : [];

                        if (rows.length === 0) break;

                        if (format === 'csv') {
                            // Derive fields from the first row if schema lookup failed.
                            if ((!fields || fields.length === 0) && firstChunk) {
                                fields = Object.keys(rows[0] ?? {});
                            }
                            const text = rowsToCsv(fields ?? [], rows, firstChunk);
                            res.write(text);
                        } else {
                            for (let i = 0; i < rows.length; i++) {
                                const prefix = (firstChunk && i === 0) ? '' : ',';
                                res.write(prefix + JSON.stringify(rows[i]));
                            }
                        }
                        firstChunk = false;
                        exported += rows.length;
                        skip += rows.length;
                        if (rows.length < take) break;
                    }
                    if (format === 'json') res.write(']');
                    res.end();
                } catch (error: any) {
                    logError('[REST] Unhandled error:', error);
                    // Best-effort error envelope; if headers already sent the
                    // client receives a truncated stream which signals failure.
                    try { sendError(res, error, String(req.params?.object || '')); }
                    catch { try { res.end(); } catch { /* swallow */ } }
                }
            },
            metadata: {
                summary: 'Streaming export of object rows (CSV or JSON)',
                tags: ['data', 'export'],
            },
        });
    }

    /**
     * Register global cross-object search endpoint (M10.5).
     * GET {basePath}/search?q=acme&objects=lead,account&limit=20&perObject=5
     */
    private registerSearchEndpoints(basePath: string): void {
        const isScoped = basePath.includes('/projects/:projectId');
        this.routeManager.register({
            method: 'GET',
            path: `${basePath}/search`,
            handler: async (req: any, res: any) => {
                try {
                    const projectId = isScoped ? req.params?.projectId : undefined;
                    const p = await this.resolveProtocol(projectId, req);
                    const context = await this.resolveExecCtx(projectId, req);
                    if (this.enforceAuth(req, res, context)) return;
                    const searchAll = (p as any).searchAll;
                    if (typeof searchAll !== 'function') {
                        res.status(501).json({ code: 'NOT_IMPLEMENTED', message: 'Search not supported by this protocol' });
                        return;
                    }
                    const q = String(req.query?.q ?? req.query?.query ?? '');
                    const objectsParam = req.query?.objects;
                    const objects = typeof objectsParam === 'string'
                        ? objectsParam.split(',').map((s: string) => s.trim()).filter(Boolean)
                        : Array.isArray(objectsParam) ? objectsParam : undefined;
                    const result = await searchAll.call(p, {
                        q,
                        objects,
                        limit: req.query?.limit ? Number(req.query.limit) : undefined,
                        perObject: req.query?.perObject ? Number(req.query.perObject) : undefined,
                        ...(context ? { context } : {}),
                    });
                    res.json(result);
                } catch (error: any) {
                    const mapped = mapDataError(error);
                    if (!isExpectedDataStatus(mapped.status) && mapped.body?.code !== 'VALIDATION_FAILED') {
                        logError('[REST] Unhandled error:', error);
                    }
                    res.status(mapped.status).json(mapped.body);
                }
            },
            metadata: {
                summary: 'Global cross-object search',
                tags: ['search'],
            },
        });
    }

    /**
     * Register email endpoints (M11.B1 / M10.7).
     *
     * POST {basePath}/email/send — send a transactional email via the
     * `IEmailService` provider registered by EmailServicePlugin. Returns
     * 501 when no provider is wired so deployments without email
     * configured fail cleanly.
     *
     * Request body:
     *   {
     *     to: "a@b.com" | ["a@b.com", { name, address }],
     *     from?: ..., cc?: ..., bcc?: ..., replyTo?: ...,
     *     subject: string,
     *     text?: string, html?: string,  // at least one required
     *     attachments?: [{ filename, content, contentType?, cid? }],
     *     headers?: { [name]: value },
     *     relatedObject?: string, relatedId?: string,
     *   }
     */
    private registerEmailEndpoints(basePath: string): void {
        const isScoped = basePath.includes('/projects/:projectId');
        this.routeManager.register({
            method: 'POST',
            path: `${basePath}/email/send`,
            handler: async (req: any, res: any) => {
                try {
                    const projectId = isScoped ? req.params?.projectId : undefined;
                    const context = await this.resolveExecCtx(projectId, req);
                    if (this.enforceAuth(req, res, context)) return;

                    if (!this.emailServiceProvider) {
                        res.status(501).json({
                            code: 'NOT_IMPLEMENTED',
                            message: 'Email service is not configured on this deployment',
                        });
                        return;
                    }
                    const emailService = await this.emailServiceProvider(projectId).catch(() => undefined);
                    if (!emailService || typeof emailService.send !== 'function') {
                        res.status(501).json({
                            code: 'NOT_IMPLEMENTED',
                            message: 'Email service is not configured on this deployment',
                        });
                        return;
                    }

                    const body = req.body ?? {};
                    if (!body || typeof body !== 'object') {
                        res.status(400).json({ code: 'INVALID_REQUEST', error: 'JSON body required' });
                        return;
                    }
                    // Stamp sentBy from the authenticated context when caller didn't supply one.
                    const input = {
                        ...body,
                        ...(body.sentBy === undefined && (context as any)?.userId
                            ? { sentBy: (context as any).userId }
                            : {}),
                    };

                    try {
                        const result = await emailService.send(input);
                        if (result?.status === 'sent') {
                            res.status(200).json(result);
                        } else {
                            // failed / queued — still surface to client with 200 so clients can branch on status.
                            res.status(200).json(result);
                        }
                    } catch (err: any) {
                        // Validation errors from normalizeMessage are surfaced as 400.
                        const message = String(err?.message ?? err ?? 'send failed');
                        if (message.startsWith('VALIDATION_FAILED')) {
                            res.status(400).json({
                                code: 'VALIDATION_FAILED',
                                error: message.replace(/^VALIDATION_FAILED:\s*/, ''),
                            });
                            return;
                        }
                        throw err;
                    }
                } catch (error: any) {
                    logError('[REST] Email send unhandled error:', error);
                    res.status(500).json({
                        code: 'EMAIL_SEND_FAILED',
                        error: String(error?.message ?? error ?? 'send failed').slice(0, 500),
                    });
                }
            },
            metadata: {
                summary: 'Send a transactional email via the configured EmailService',
                tags: ['email'],
            },
        });
    }

    /**
     * Register record-level sharing endpoints (M11.C17).
     *
     * Surfaces `ISharingService` over HTTP so the UI can list, create
     * and revoke per-record grants without going through ObjectQL. The
     * three routes mirror the share-management drawer in Salesforce /
     * ServiceNow:
     *
     *   GET    {basePath}/data/:object/:id/shares
     *   POST   {basePath}/data/:object/:id/shares
     *   DELETE {basePath}/data/:object/:id/shares/:shareId
     *
     * All three resolve via `sharingServiceProvider`; routes return 501
     * when no sharing service is configured so a deployment without the
     * `@objectstack/plugin-sharing` plugin fails cleanly.
     */
    private registerSharingEndpoints(basePath: string): void {
        const { crud } = this.config;
        const dataPath = `${basePath}${crud.dataPrefix}`;
        const isScoped = basePath.includes('/projects/:projectId');

        const resolveService = async (projectId?: string) => {
            if (!this.sharingServiceProvider) return undefined;
            try { return await this.sharingServiceProvider(projectId); }
            catch { return undefined; }
        };
        const respond501 = (res: any) => res.status(501).json({
            code: 'NOT_IMPLEMENTED',
            message: 'Sharing service is not configured on this deployment',
        });

        // GET — list shares on a record.
        this.routeManager.register({
            method: 'GET',
            path: `${dataPath}/:object/:id/shares`,
            handler: async (req: any, res: any) => {
                try {
                    const projectId = isScoped ? req.params?.projectId : undefined;
                    const context = await this.resolveExecCtx(projectId, req);
                    if (this.enforceAuth(req, res, context)) return;
                    const svc = await resolveService(projectId);
                    if (!svc) return respond501(res);
                    const rows = await svc.listShares(req.params.object, req.params.id, context ?? {});
                    res.json({ data: rows });
                } catch (error: any) {
                    logError('[REST] List shares error:', error);
                    res.status(500).json({ code: 'SHARES_LIST_FAILED', error: String(error?.message ?? error).slice(0, 500) });
                }
            },
            metadata: { summary: 'List per-record sharing grants', tags: ['sharing'] },
        });

        // POST — grant access.
        this.routeManager.register({
            method: 'POST',
            path: `${dataPath}/:object/:id/shares`,
            handler: async (req: any, res: any) => {
                try {
                    const projectId = isScoped ? req.params?.projectId : undefined;
                    const context = await this.resolveExecCtx(projectId, req);
                    if (this.enforceAuth(req, res, context)) return;
                    const svc = await resolveService(projectId);
                    if (!svc) return respond501(res);
                    const body = req.body ?? {};
                    const input = {
                        object: req.params.object,
                        recordId: req.params.id,
                        recipientType: body.recipientType ?? body.recipient_type,
                        recipientId: body.recipientId ?? body.recipient_id,
                        accessLevel: body.accessLevel ?? body.access_level,
                        source: body.source,
                        sourceId: body.sourceId ?? body.source_id,
                        reason: body.reason,
                    };
                    try {
                        const row = await svc.grant(input, context ?? {});
                        res.status(201).json(row);
                    } catch (err: any) {
                        const msg = String(err?.message ?? err ?? '');
                        if (msg.startsWith('VALIDATION_FAILED')) {
                            res.status(400).json({
                                code: 'VALIDATION_FAILED',
                                error: msg.replace(/^VALIDATION_FAILED:\s*/, ''),
                            });
                            return;
                        }
                        throw err;
                    }
                } catch (error: any) {
                    logError('[REST] Grant share error:', error);
                    res.status(500).json({ code: 'SHARE_GRANT_FAILED', error: String(error?.message ?? error).slice(0, 500) });
                }
            },
            metadata: { summary: 'Grant a per-record share to a principal', tags: ['sharing'] },
        });

        // DELETE — revoke a share by id.
        this.routeManager.register({
            method: 'DELETE',
            path: `${dataPath}/:object/:id/shares/:shareId`,
            handler: async (req: any, res: any) => {
                try {
                    const projectId = isScoped ? req.params?.projectId : undefined;
                    const context = await this.resolveExecCtx(projectId, req);
                    if (this.enforceAuth(req, res, context)) return;
                    const svc = await resolveService(projectId);
                    if (!svc) return respond501(res);
                    await svc.revoke(req.params.shareId, context ?? {});
                    res.status(204).end();
                } catch (error: any) {
                    logError('[REST] Revoke share error:', error);
                    res.status(500).json({ code: 'SHARE_REVOKE_FAILED', error: String(error?.message ?? error).slice(0, 500) });
                }
            },
            metadata: { summary: 'Revoke a per-record share by id', tags: ['sharing'] },
        });
    }

    /**
     * Register sharing-rule endpoints (M10.17). Mirrors the existing
     * sharing endpoints but operates on `sys_sharing_rule` rows.
     *
     *   GET    {basePath}/sharing/rules?object=&activeOnly=
     *   POST   {basePath}/sharing/rules
     *   GET    {basePath}/sharing/rules/:idOrName
     *   DELETE {basePath}/sharing/rules/:idOrName
     *   POST   {basePath}/sharing/rules/:idOrName/evaluate
     *
     * Returns 501 when no sharing-rule service is configured.
     */
    private registerSharingRuleEndpoints(basePath: string): void {
        // Sharing-rule routes live at the top of the API surface (e.g.
        // `/api/v1/sharing/rules`) — they administer rules across the whole
        // tenant rather than acting on a single CRUD object, so anchoring
        // them on `basePath` keeps them out of the `/data/:object` namespace
        // where greedy CRUD matchers would otherwise swallow them.
        const dataPath = basePath;
        const isScoped = basePath.includes('/projects/:projectId');

        const resolveService = async (projectId?: string) => {
            if (!this.sharingRulesServiceProvider) return undefined;
            try { return await this.sharingRulesServiceProvider(projectId); }
            catch { return undefined; }
        };
        const respond501 = (res: any) => res.status(501).json({
            code: 'NOT_IMPLEMENTED',
            message: 'Sharing-rule service is not configured on this deployment',
        });
        const handleError = (err: any, res: any, defaultCode: string) => {
            const msg = String(err?.message ?? err ?? '');
            if (msg.startsWith('VALIDATION_FAILED')) {
                return res.status(400).json({ code: 'VALIDATION_FAILED', error: msg.replace(/^VALIDATION_FAILED:\s*/, '') });
            }
            if (msg.startsWith('RULE_NOT_FOUND')) {
                return res.status(404).json({ code: 'RULE_NOT_FOUND', error: msg.replace(/^RULE_NOT_FOUND:?\s*/, '') });
            }
            logError(`[REST] sharing-rule ${defaultCode}:`, err);
            return res.status(500).json({ code: defaultCode, error: msg.slice(0, 500) });
        };

        // LIST
        this.routeManager.register({
            method: 'GET',
            path: `${dataPath}/sharing/rules`,
            handler: async (req: any, res: any) => {
                try {
                    const projectId = isScoped ? req.params?.projectId : undefined;
                    const context = await this.resolveExecCtx(projectId, req);
                    if (this.enforceAuth(req, res, context)) return;
                    const svc = await resolveService(projectId);
                    if (!svc) return respond501(res);
                    const rows = await svc.listRules({
                        object: req.query?.object,
                        activeOnly: req.query?.activeOnly === 'true' || req.query?.activeOnly === true,
                    }, context ?? {});
                    res.json({ data: rows });
                } catch (err: any) { handleError(err, res, 'RULE_LIST_FAILED'); }
            },
            metadata: { summary: 'List sharing rules', tags: ['sharing'] },
        });

        // CREATE / UPSERT
        this.routeManager.register({
            method: 'POST',
            path: `${dataPath}/sharing/rules`,
            handler: async (req: any, res: any) => {
                try {
                    const projectId = isScoped ? req.params?.projectId : undefined;
                    const context = await this.resolveExecCtx(projectId, req);
                    if (this.enforceAuth(req, res, context)) return;
                    const svc = await resolveService(projectId);
                    if (!svc) return respond501(res);
                    const body = req.body ?? {};
                    const input = {
                        name: body.name,
                        label: body.label,
                        description: body.description,
                        object: body.object ?? body.object_name,
                        criteria: body.criteria,
                        recipientType: body.recipientType ?? body.recipient_type,
                        recipientId: body.recipientId ?? body.recipient_id,
                        accessLevel: body.accessLevel ?? body.access_level,
                        active: body.active,
                    };
                    const row = await svc.defineRule(input, context ?? {});
                    res.status(201).json(row);
                } catch (err: any) { handleError(err, res, 'RULE_DEFINE_FAILED'); }
            },
            metadata: { summary: 'Create or upsert a sharing rule', tags: ['sharing'] },
        });

        // GET
        this.routeManager.register({
            method: 'GET',
            path: `${dataPath}/sharing/rules/:idOrName`,
            handler: async (req: any, res: any) => {
                try {
                    const projectId = isScoped ? req.params?.projectId : undefined;
                    const context = await this.resolveExecCtx(projectId, req);
                    if (this.enforceAuth(req, res, context)) return;
                    const svc = await resolveService(projectId);
                    if (!svc) return respond501(res);
                    const row = await svc.getRule(req.params.idOrName, context ?? {});
                    if (!row) return res.status(404).json({ code: 'RULE_NOT_FOUND' });
                    res.json(row);
                } catch (err: any) { handleError(err, res, 'RULE_GET_FAILED'); }
            },
            metadata: { summary: 'Get a sharing rule by id or name', tags: ['sharing'] },
        });

        // DELETE
        this.routeManager.register({
            method: 'DELETE',
            path: `${dataPath}/sharing/rules/:idOrName`,
            handler: async (req: any, res: any) => {
                try {
                    const projectId = isScoped ? req.params?.projectId : undefined;
                    const context = await this.resolveExecCtx(projectId, req);
                    if (this.enforceAuth(req, res, context)) return;
                    const svc = await resolveService(projectId);
                    if (!svc) return respond501(res);
                    await svc.deleteRule(req.params.idOrName, context ?? {});
                    res.status(204).end();
                } catch (err: any) { handleError(err, res, 'RULE_DELETE_FAILED'); }
            },
            metadata: { summary: 'Delete a sharing rule and its materialised grants', tags: ['sharing'] },
        });

        // EVALUATE
        this.routeManager.register({
            method: 'POST',
            path: `${dataPath}/sharing/rules/:idOrName/evaluate`,
            handler: async (req: any, res: any) => {
                try {
                    const projectId = isScoped ? req.params?.projectId : undefined;
                    const context = await this.resolveExecCtx(projectId, req);
                    if (this.enforceAuth(req, res, context)) return;
                    const svc = await resolveService(projectId);
                    if (!svc) return respond501(res);
                    const result = await svc.evaluateRule(req.params.idOrName, context ?? {});
                    res.json(result);
                } catch (err: any) { handleError(err, res, 'RULE_EVALUATE_FAILED'); }
            },
            metadata: { summary: 'Re-evaluate a sharing rule and reconcile grants', tags: ['sharing'] },
        });
    }

    /**
     * Register saved-report + scheduled-digest endpoints (M11.C16).
     *
     * Surfaces `IReportService` over HTTP so the UI can build,
     * run, and schedule reports without dropping to ObjectQL. Routes
     * live at the top of the API surface (alongside `/approvals` and
     * `/sharing`) — reports are a tenant-wide capability, not a record
     * on a specific CRUD object:
     *
     *   GET    {basePath}/reports?object=&ownerId=
     *   POST   {basePath}/reports
     *   GET    {basePath}/reports/:id
     *   DELETE {basePath}/reports/:id
     *   POST   {basePath}/reports/:id/run
     *   POST   {basePath}/reports/:id/schedule
     *   GET    {basePath}/reports/:id/schedules
     *   DELETE {basePath}/reports/schedules/:scheduleId
     *
     * All routes return 501 when `reportsServiceProvider` is unset so
     * a deployment without `@objectstack/plugin-reports` fails cleanly.
     */
    private registerReportsEndpoints(basePath: string): void {
        // Reports live at the top of the API surface (e.g. `/api/v1/reports`)
        // rather than under `/data/`, because a report is a first-class
        // capability whose definition is tenant-wide (not a record on a
        // particular object).
        const dataPath = basePath;
        const isScoped = basePath.includes('/projects/:projectId');

        const resolveService = async (projectId?: string) => {
            if (!this.reportsServiceProvider) return undefined;
            try { return await this.reportsServiceProvider(projectId); }
            catch { return undefined; }
        };
        const respond501 = (res: any) => res.status(501).json({
            code: 'NOT_IMPLEMENTED',
            message: 'Reports service is not configured on this deployment',
        });
        const handleValidation = (res: any, err: any): boolean => {
            const msg = String(err?.message ?? err ?? '');
            if (msg.startsWith('VALIDATION_FAILED')) {
                res.status(400).json({
                    code: 'VALIDATION_FAILED',
                    error: msg.replace(/^VALIDATION_FAILED:\s*/, ''),
                });
                return true;
            }
            if (msg.startsWith('REPORT_NOT_FOUND')) {
                res.status(404).json({ code: 'REPORT_NOT_FOUND', error: msg });
                return true;
            }
            return false;
        };

        // GET — list reports.
        this.routeManager.register({
            method: 'GET',
            path: `${dataPath}/reports`,
            handler: async (req: any, res: any) => {
                try {
                    const projectId = isScoped ? req.params?.projectId : undefined;
                    const context = await this.resolveExecCtx(projectId, req);
                    if (this.enforceAuth(req, res, context)) return;
                    const svc = await resolveService(projectId);
                    if (!svc) return respond501(res);
                    const q = req.query ?? {};
                    const rows = await svc.listReports({ object: q.object, ownerId: q.ownerId }, context ?? {});
                    res.json({ data: rows });
                } catch (error: any) {
                    logError('[REST] List reports error:', error);
                    res.status(500).json({ code: 'REPORTS_LIST_FAILED', error: String(error?.message ?? error).slice(0, 500) });
                }
            },
            metadata: { summary: 'List saved reports', tags: ['reports'] },
        });

        // POST — save (upsert) a report.
        this.routeManager.register({
            method: 'POST',
            path: `${dataPath}/reports`,
            handler: async (req: any, res: any) => {
                try {
                    const projectId = isScoped ? req.params?.projectId : undefined;
                    const context = await this.resolveExecCtx(projectId, req);
                    if (this.enforceAuth(req, res, context)) return;
                    const svc = await resolveService(projectId);
                    if (!svc) return respond501(res);
                    try {
                        const row = await svc.saveReport(req.body ?? {}, context ?? {});
                        res.status(201).json(row);
                    } catch (err: any) {
                        if (handleValidation(res, err)) return;
                        throw err;
                    }
                } catch (error: any) {
                    logError('[REST] Save report error:', error);
                    res.status(500).json({ code: 'REPORT_SAVE_FAILED', error: String(error?.message ?? error).slice(0, 500) });
                }
            },
            metadata: { summary: 'Create or update a saved report', tags: ['reports'] },
        });

        // GET — single report.
        this.routeManager.register({
            method: 'GET',
            path: `${dataPath}/reports/:id`,
            handler: async (req: any, res: any) => {
                try {
                    const projectId = isScoped ? req.params?.projectId : undefined;
                    const context = await this.resolveExecCtx(projectId, req);
                    if (this.enforceAuth(req, res, context)) return;
                    const svc = await resolveService(projectId);
                    if (!svc) return respond501(res);
                    const row = await svc.getReport(req.params.id, context ?? {});
                    if (!row) {
                        res.status(404).json({ code: 'REPORT_NOT_FOUND', error: `Report ${req.params.id} not found` });
                        return;
                    }
                    res.json(row);
                } catch (error: any) {
                    logError('[REST] Get report error:', error);
                    res.status(500).json({ code: 'REPORT_GET_FAILED', error: String(error?.message ?? error).slice(0, 500) });
                }
            },
            metadata: { summary: 'Get a saved report by id', tags: ['reports'] },
        });

        // DELETE — drop report + cascade schedules.
        this.routeManager.register({
            method: 'DELETE',
            path: `${dataPath}/reports/:id`,
            handler: async (req: any, res: any) => {
                try {
                    const projectId = isScoped ? req.params?.projectId : undefined;
                    const context = await this.resolveExecCtx(projectId, req);
                    if (this.enforceAuth(req, res, context)) return;
                    const svc = await resolveService(projectId);
                    if (!svc) return respond501(res);
                    await svc.deleteReport(req.params.id, context ?? {});
                    res.status(204).end();
                } catch (error: any) {
                    logError('[REST] Delete report error:', error);
                    res.status(500).json({ code: 'REPORT_DELETE_FAILED', error: String(error?.message ?? error).slice(0, 500) });
                }
            },
            metadata: { summary: 'Delete a saved report (cascades schedules)', tags: ['reports'] },
        });

        // POST — execute a report by id.
        this.routeManager.register({
            method: 'POST',
            path: `${dataPath}/reports/:id/run`,
            handler: async (req: any, res: any) => {
                try {
                    const projectId = isScoped ? req.params?.projectId : undefined;
                    const context = await this.resolveExecCtx(projectId, req);
                    if (this.enforceAuth(req, res, context)) return;
                    const svc = await resolveService(projectId);
                    if (!svc) return respond501(res);
                    try {
                        const result = await svc.run(req.params.id, context ?? {});
                        res.json(result);
                    } catch (err: any) {
                        if (handleValidation(res, err)) return;
                        throw err;
                    }
                } catch (error: any) {
                    logError('[REST] Run report error:', error);
                    res.status(500).json({ code: 'REPORT_RUN_FAILED', error: String(error?.message ?? error).slice(0, 500) });
                }
            },
            metadata: { summary: 'Execute a saved report and return rendered output', tags: ['reports'] },
        });

        // POST — schedule a report.
        this.routeManager.register({
            method: 'POST',
            path: `${dataPath}/reports/:id/schedule`,
            handler: async (req: any, res: any) => {
                try {
                    const projectId = isScoped ? req.params?.projectId : undefined;
                    const context = await this.resolveExecCtx(projectId, req);
                    if (this.enforceAuth(req, res, context)) return;
                    const svc = await resolveService(projectId);
                    if (!svc) return respond501(res);
                    const body = req.body ?? {};
                    try {
                        const row = await svc.scheduleReport({
                            reportId: req.params.id,
                            recipients: body.recipients ?? [],
                            name: body.name,
                            intervalMinutes: body.intervalMinutes ?? body.interval_minutes,
                            cronExpression: body.cronExpression ?? body.cron_expression,
                            timezone: body.timezone,
                            format: body.format,
                            subjectTemplate: body.subjectTemplate ?? body.subject_template,
                            ownerId: body.ownerId ?? body.owner_id,
                            active: body.active,
                        }, context ?? {});
                        res.status(201).json(row);
                    } catch (err: any) {
                        if (handleValidation(res, err)) return;
                        throw err;
                    }
                } catch (error: any) {
                    logError('[REST] Schedule report error:', error);
                    res.status(500).json({ code: 'REPORT_SCHEDULE_FAILED', error: String(error?.message ?? error).slice(0, 500) });
                }
            },
            metadata: { summary: 'Create a recurring email schedule for a report', tags: ['reports'] },
        });

        // GET — list schedules for a report.
        this.routeManager.register({
            method: 'GET',
            path: `${dataPath}/reports/:id/schedules`,
            handler: async (req: any, res: any) => {
                try {
                    const projectId = isScoped ? req.params?.projectId : undefined;
                    const context = await this.resolveExecCtx(projectId, req);
                    if (this.enforceAuth(req, res, context)) return;
                    const svc = await resolveService(projectId);
                    if (!svc) return respond501(res);
                    const rows = await svc.listSchedules({ reportId: req.params.id }, context ?? {});
                    res.json({ data: rows });
                } catch (error: any) {
                    logError('[REST] List schedules error:', error);
                    res.status(500).json({ code: 'SCHEDULES_LIST_FAILED', error: String(error?.message ?? error).slice(0, 500) });
                }
            },
            metadata: { summary: 'List schedules for a report', tags: ['reports'] },
        });

        // DELETE — drop a schedule.
        this.routeManager.register({
            method: 'DELETE',
            path: `${dataPath}/reports/schedules/:scheduleId`,
            handler: async (req: any, res: any) => {
                try {
                    const projectId = isScoped ? req.params?.projectId : undefined;
                    const context = await this.resolveExecCtx(projectId, req);
                    if (this.enforceAuth(req, res, context)) return;
                    const svc = await resolveService(projectId);
                    if (!svc) return respond501(res);
                    await svc.unscheduleReport(req.params.scheduleId, context ?? {});
                    res.status(204).end();
                } catch (error: any) {
                    logError('[REST] Unschedule report error:', error);
                    res.status(500).json({ code: 'SCHEDULE_DELETE_FAILED', error: String(error?.message ?? error).slice(0, 500) });
                }
            },
            metadata: { summary: 'Delete a report schedule by id', tags: ['reports'] },
        });
    }

    /**
     * Register approval engine endpoints.
     *
     * Routes (all under {basePath}/approvals):
     *   GET    /processes                       — list approval processes
     *   POST   /processes                       — upsert (defineProcess)
     *   GET    /processes/:id                   — get by id or name
     *   DELETE /processes/:id                   — delete process
     *   POST   /requests                        — submit
     *   GET    /requests                        — list (filters: status, object, recordId, approverId, submitterId)
     *   GET    /requests/:id                    — get request
     *   POST   /requests/:id/approve            — approve current step
     *   POST   /requests/:id/reject             — reject current step
     *   POST   /requests/:id/recall             — recall (submitter only)
     *   GET    /requests/:id/actions            — audit trail
     *
     * Returns 501 when `approvalsServiceProvider` is unset so deployments
     * without `@objectstack/plugin-approvals` fail cleanly.
     */
    private registerApprovalsEndpoints(basePath: string): void {
        // Approval routes live at the top of the API surface (e.g.
        // `/api/v1/approvals/processes`, `/api/v1/approvals/requests/:id/approve`).
        // Approvals are a cross-cutting capability — a request is not a
        // record on a single CRUD object, so anchoring it on `basePath`
        // (instead of `${basePath}/data`) keeps the URL semantics honest.
        const dataPath = basePath;
        const isScoped = basePath.includes('/projects/:projectId');

        const resolveService = async (projectId?: string) => {
            if (!this.approvalsServiceProvider) return undefined;
            try { return await this.approvalsServiceProvider(projectId); }
            catch { return undefined; }
        };
        const respond501 = (res: any) => res.status(501).json({
            code: 'NOT_IMPLEMENTED',
            message: 'Approvals service is not configured on this deployment',
        });
        const handleApprovalError = (res: any, err: any): boolean => {
            const msg = String(err?.message ?? err ?? '');
            const mapping: Array<[RegExp, number, string]> = [
                [/^VALIDATION_FAILED/, 400, 'VALIDATION_FAILED'],
                [/^DUPLICATE_REQUEST/, 409, 'DUPLICATE_REQUEST'],
                [/^INVALID_STATE/, 409, 'INVALID_STATE'],
                [/^FORBIDDEN/, 403, 'FORBIDDEN'],
                [/^NO_ACTIVE_PROCESS/, 404, 'NO_ACTIVE_PROCESS'],
                [/^PROCESS_NOT_FOUND/, 404, 'PROCESS_NOT_FOUND'],
                [/^REQUEST_NOT_FOUND/, 404, 'REQUEST_NOT_FOUND'],
            ];
            for (const [re, status, code] of mapping) {
                if (re.test(msg)) {
                    res.status(status).json({ code, error: msg.replace(/^[A-Z_]+:\s*/, '') });
                    return true;
                }
            }
            return false;
        };

        // ── Processes ─────────────────────────────────────────────
        this.routeManager.register({
            method: 'GET',
            path: `${dataPath}/approvals/processes`,
            handler: async (req: any, res: any) => {
                try {
                    const projectId = isScoped ? req.params?.projectId : undefined;
                    const context = await this.resolveExecCtx(projectId, req);
                    if (this.enforceAuth(req, res, context)) return;
                    const svc = await resolveService(projectId);
                    if (!svc) return respond501(res);
                    const q = req.query ?? {};
                    const rows = await svc.listProcesses({
                        object: q.object,
                        activeOnly: q.activeOnly === 'true' || q.activeOnly === true,
                    }, context ?? {});
                    res.json({ data: rows });
                } catch (error: any) {
                    logError('[REST] List approval processes error:', error);
                    res.status(500).json({ code: 'APPROVAL_PROCESS_LIST_FAILED', error: String(error?.message ?? error).slice(0, 500) });
                }
            },
            metadata: { summary: 'List approval processes', tags: ['approvals'] },
        });

        this.routeManager.register({
            method: 'POST',
            path: `${dataPath}/approvals/processes`,
            handler: async (req: any, res: any) => {
                try {
                    const projectId = isScoped ? req.params?.projectId : undefined;
                    const context = await this.resolveExecCtx(projectId, req);
                    if (this.enforceAuth(req, res, context)) return;
                    const svc = await resolveService(projectId);
                    if (!svc) return respond501(res);
                    try {
                        const row = await svc.defineProcess(req.body ?? {}, context ?? {});
                        res.status(201).json(row);
                    } catch (err: any) {
                        if (handleApprovalError(res, err)) return;
                        throw err;
                    }
                } catch (error: any) {
                    logError('[REST] Define approval process error:', error);
                    res.status(500).json({ code: 'APPROVAL_PROCESS_DEFINE_FAILED', error: String(error?.message ?? error).slice(0, 500) });
                }
            },
            metadata: { summary: 'Define (upsert) an approval process', tags: ['approvals'] },
        });

        this.routeManager.register({
            method: 'GET',
            path: `${dataPath}/approvals/processes/:id`,
            handler: async (req: any, res: any) => {
                try {
                    const projectId = isScoped ? req.params?.projectId : undefined;
                    const context = await this.resolveExecCtx(projectId, req);
                    if (this.enforceAuth(req, res, context)) return;
                    const svc = await resolveService(projectId);
                    if (!svc) return respond501(res);
                    const row = await svc.getProcess(req.params.id, context ?? {});
                    if (!row) {
                        res.status(404).json({ code: 'PROCESS_NOT_FOUND', error: `Approval process '${req.params.id}' not found` });
                        return;
                    }
                    res.json(row);
                } catch (error: any) {
                    logError('[REST] Get approval process error:', error);
                    res.status(500).json({ code: 'APPROVAL_PROCESS_GET_FAILED', error: String(error?.message ?? error).slice(0, 500) });
                }
            },
            metadata: { summary: 'Get an approval process by id or name', tags: ['approvals'] },
        });

        this.routeManager.register({
            method: 'DELETE',
            path: `${dataPath}/approvals/processes/:id`,
            handler: async (req: any, res: any) => {
                try {
                    const projectId = isScoped ? req.params?.projectId : undefined;
                    const context = await this.resolveExecCtx(projectId, req);
                    if (this.enforceAuth(req, res, context)) return;
                    const svc = await resolveService(projectId);
                    if (!svc) return respond501(res);
                    await svc.deleteProcess(req.params.id, context ?? {});
                    res.status(204).end();
                } catch (error: any) {
                    logError('[REST] Delete approval process error:', error);
                    res.status(500).json({ code: 'APPROVAL_PROCESS_DELETE_FAILED', error: String(error?.message ?? error).slice(0, 500) });
                }
            },
            metadata: { summary: 'Delete an approval process', tags: ['approvals'] },
        });

        // ── Requests ──────────────────────────────────────────────
        this.routeManager.register({
            method: 'POST',
            path: `${dataPath}/approvals/requests`,
            handler: async (req: any, res: any) => {
                try {
                    const projectId = isScoped ? req.params?.projectId : undefined;
                    const context = await this.resolveExecCtx(projectId, req);
                    if (this.enforceAuth(req, res, context)) return;
                    const svc = await resolveService(projectId);
                    if (!svc) return respond501(res);
                    const body = req.body ?? {};
                    try {
                        const row = await svc.submit({
                            object: body.object,
                            recordId: body.recordId ?? body.record_id,
                            processName: body.processName ?? body.process_name,
                            submitterId: body.submitterId ?? body.submitter_id ?? context?.userId,
                            comment: body.comment,
                            payload: body.payload,
                        }, context ?? {});
                        res.status(201).json(row);
                    } catch (err: any) {
                        if (handleApprovalError(res, err)) return;
                        throw err;
                    }
                } catch (error: any) {
                    logError('[REST] Submit approval error:', error);
                    res.status(500).json({ code: 'APPROVAL_SUBMIT_FAILED', error: String(error?.message ?? error).slice(0, 500) });
                }
            },
            metadata: { summary: 'Submit a record for approval', tags: ['approvals'] },
        });

        this.routeManager.register({
            method: 'GET',
            path: `${dataPath}/approvals/requests`,
            handler: async (req: any, res: any) => {
                try {
                    const projectId = isScoped ? req.params?.projectId : undefined;
                    const context = await this.resolveExecCtx(projectId, req);
                    if (this.enforceAuth(req, res, context)) return;
                    const svc = await resolveService(projectId);
                    if (!svc) {
                        // No approvals plugin loaded — return empty list rather than 501
                        // so Console badge polls don't spam the error log on deployments
                        // that don't run an approvals workflow.
                        res.json({ data: [] });
                        return;
                    }
                    const q = req.query ?? {};
                    const rows = await svc.listRequests({
                        object: q.object,
                        recordId: q.recordId ?? q.record_id,
                        status: q.status,
                        approverId: q.approverId ?? q.approver_id,
                        submitterId: q.submitterId ?? q.submitter_id,
                    }, context ?? {});
                    res.json({ data: rows });
                } catch (error: any) {
                    logError('[REST] List approval requests error:', error);
                    res.status(500).json({ code: 'APPROVAL_REQUEST_LIST_FAILED', error: String(error?.message ?? error).slice(0, 500) });
                }
            },
            metadata: { summary: 'List approval requests', tags: ['approvals'] },
        });

        this.routeManager.register({
            method: 'GET',
            path: `${dataPath}/approvals/requests/:id`,
            handler: async (req: any, res: any) => {
                try {
                    const projectId = isScoped ? req.params?.projectId : undefined;
                    const context = await this.resolveExecCtx(projectId, req);
                    if (this.enforceAuth(req, res, context)) return;
                    const svc = await resolveService(projectId);
                    if (!svc) return respond501(res);
                    const row = await svc.getRequest(req.params.id, context ?? {});
                    if (!row) {
                        res.status(404).json({ code: 'REQUEST_NOT_FOUND', error: `Approval request '${req.params.id}' not found` });
                        return;
                    }
                    res.json(row);
                } catch (error: any) {
                    logError('[REST] Get approval request error:', error);
                    res.status(500).json({ code: 'APPROVAL_REQUEST_GET_FAILED', error: String(error?.message ?? error).slice(0, 500) });
                }
            },
            metadata: { summary: 'Get an approval request by id', tags: ['approvals'] },
        });

        const decisionRoute = (suffix: 'approve' | 'reject' | 'recall', method: 'approve' | 'reject' | 'recall') => {
            this.routeManager.register({
                method: 'POST',
                path: `${dataPath}/approvals/requests/:id/${suffix}`,
                handler: async (req: any, res: any) => {
                    try {
                        const projectId = isScoped ? req.params?.projectId : undefined;
                        const context = await this.resolveExecCtx(projectId, req);
                        if (this.enforceAuth(req, res, context)) return;
                        const svc = await resolveService(projectId);
                        if (!svc) return respond501(res);
                        const body = req.body ?? {};
                        try {
                            const out = await svc[method](req.params.id, {
                                actorId: body.actorId ?? body.actor_id ?? context?.userId,
                                comment: body.comment,
                            }, context ?? {});
                            res.json(out);
                        } catch (err: any) {
                            if (handleApprovalError(res, err)) return;
                            throw err;
                        }
                    } catch (error: any) {
                        logError(`[REST] ${suffix} approval error:`, error);
                        res.status(500).json({ code: `APPROVAL_${suffix.toUpperCase()}_FAILED`, error: String(error?.message ?? error).slice(0, 500) });
                    }
                },
                metadata: { summary: `${suffix[0].toUpperCase()}${suffix.slice(1)} an approval request`, tags: ['approvals'] },
            });
        };
        decisionRoute('approve', 'approve');
        decisionRoute('reject', 'reject');
        decisionRoute('recall', 'recall');

        this.routeManager.register({
            method: 'GET',
            path: `${dataPath}/approvals/requests/:id/actions`,
            handler: async (req: any, res: any) => {
                try {
                    const projectId = isScoped ? req.params?.projectId : undefined;
                    const context = await this.resolveExecCtx(projectId, req);
                    if (this.enforceAuth(req, res, context)) return;
                    const svc = await resolveService(projectId);
                    if (!svc) return respond501(res);
                    const rows = await svc.listActions(req.params.id, context ?? {});
                    res.json({ data: rows });
                } catch (error: any) {
                    logError('[REST] List approval actions error:', error);
                    res.status(500).json({ code: 'APPROVAL_ACTIONS_FAILED', error: String(error?.message ?? error).slice(0, 500) });
                }
            },
            metadata: { summary: 'List actions (audit trail) for an approval request', tags: ['approvals'] },
        });
    }

    /**
     * Register batch operation endpoints
     */
    private registerBatchEndpoints(basePath: string): void {
        const { crud, batch } = this.config;
        const dataPath = `${basePath}${crud.dataPrefix}`;
        const isScoped = basePath.includes('/projects/:projectId');

        const operations = batch.operations;

        // POST /data/:object/batch - Generic batch endpoint
        if (batch.enableBatchEndpoint && this.protocol.batchData) {
            this.routeManager.register({
                method: 'POST',
                path: `${dataPath}/:object/batch`,
                handler: async (req: any, res: any) => {
                    try {
                        const projectId = isScoped ? req.params?.projectId : undefined;
                        const p = await this.resolveProtocol(projectId, req);
                        const context = await this.resolveExecCtx(projectId, req);
                        if (this.enforceAuth(req, res, context)) return;
                        const result = await p.batchData!({
                            object: req.params.object,
                            request: req.body,
                            ...(projectId ? { projectId } : {}),
                            ...(context ? { context } : {}),
                        } as any);
                        res.json(result);
                    } catch (error: any) {
                        logError("[REST] Unhandled error:", error);
                        sendError(res, error, req.params?.object);
                    }
                },
                metadata: {
                    summary: 'Batch operations',
                    tags: ['data', 'batch'],
                },
            });
        }

        // POST /data/:object/createMany - Bulk create
        if (operations.createMany && this.protocol.createManyData) {
            this.routeManager.register({
                method: 'POST',
                path: `${dataPath}/:object/createMany`,
                handler: async (req: any, res: any) => {
                    try {
                        const projectId = isScoped ? req.params?.projectId : undefined;
                        const p = await this.resolveProtocol(projectId, req);
                        const context = await this.resolveExecCtx(projectId, req);
                        if (this.enforceAuth(req, res, context)) return;
                        const result = await p.createManyData!({
                            object: req.params.object,
                            records: req.body || [],
                            ...(projectId ? { projectId } : {}),
                            ...(context ? { context } : {}),
                        } as any);
                        res.status(201).json(result);
                    } catch (error: any) {
                        logError("[REST] Unhandled error:", error);
                        sendError(res, error, req.params?.object);
                    }
                },
                metadata: {
                    summary: 'Create multiple records',
                    tags: ['data', 'batch'],
                },
            });
        }

        // POST /data/:object/updateMany - Bulk update
        if (operations.updateMany && this.protocol.updateManyData) {
            this.routeManager.register({
                method: 'POST',
                path: `${dataPath}/:object/updateMany`,
                handler: async (req: any, res: any) => {
                    try {
                        const projectId = isScoped ? req.params?.projectId : undefined;
                        const p = await this.resolveProtocol(projectId, req);
                        const context = await this.resolveExecCtx(projectId, req);
                        if (this.enforceAuth(req, res, context)) return;
                        const result = await p.updateManyData!({
                            object: req.params.object,
                            ...req.body,
                            ...(projectId ? { projectId } : {}),
                            ...(context ? { context } : {}),
                        } as any);
                        res.json(result);
                    } catch (error: any) {
                        logError("[REST] Unhandled error:", error);
                        sendError(res, error, req.params?.object);
                    }
                },
                metadata: {
                    summary: 'Update multiple records',
                    tags: ['data', 'batch'],
                },
            });
        }

        // POST /data/:object/deleteMany - Bulk delete
        if (operations.deleteMany && this.protocol.deleteManyData) {
            this.routeManager.register({
                method: 'POST',
                path: `${dataPath}/:object/deleteMany`,
                handler: async (req: any, res: any) => {
                    try {
                        const projectId = isScoped ? req.params?.projectId : undefined;
                        const p = await this.resolveProtocol(projectId, req);
                        const context = await this.resolveExecCtx(projectId, req);
                        if (this.enforceAuth(req, res, context)) return;
                        const result = await p.deleteManyData!({
                            object: req.params.object,
                            ...req.body,
                            ...(projectId ? { projectId } : {}),
                            ...(context ? { context } : {}),
                        } as any);
                        res.json(result);
                    } catch (error: any) {
                        logError("[REST] Unhandled error:", error);
                        sendError(res, error, req.params?.object);
                    }
                },
                metadata: {
                    summary: 'Delete multiple records',
                    tags: ['data', 'batch'],
                },
            });
        }
    }

    
    /**
     * Get the route manager
     */
    getRouteManager(): RouteManager {
        return this.routeManager;
    }
    
    /**
     * Get all registered routes
     */
    getRoutes() {
        return this.routeManager.getAll();
    }
}
