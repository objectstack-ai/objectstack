// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import {
    Plugin, PluginContext, IDataEngine,
    shouldDenyAnonymous, ANONYMOUS_DENY_BODY, ANONYMOUS_DENY_STATUS,
} from '@objectstack/core';
import {
    RestServerConfig,
} from '@objectstack/spec/api';
import { HonoHttpServer, HonoCorsOptions } from './adapter';
import { cors } from 'hono/cors';
import { serveStatic } from '@hono/node-server/serve-static';
import * as fs from 'fs';
import * as path from 'path';
import { createOriginMatcher, hasWildcardPattern, isLocalhostOrigin } from './pattern-matcher';
import { readEnvWithDeprecation } from '@objectstack/types';
import { PerfTiming, runWithPerfTiming } from '@objectstack/observability';

export interface StaticMount {
    root: string;
    path?: string;
    rewrite?: boolean;
    spa?: boolean;
}

export interface HonoPluginOptions {
    port?: number;
    staticRoot?: string;
    /**
     * Multiple static resource mounts
     */
    staticMounts?: StaticMount[];
    /**
     * REST server configuration
     * Controls automatic endpoint generation and API behavior
     */
    restConfig?: RestServerConfig;
    /**
     * Whether to register standard ObjectStack CRUD endpoints
     * @default true
     */
    registerStandardEndpoints?: boolean;
    /**
     * Whether to load endpoints from API Registry
     * @default true
     */
    useApiRegistry?: boolean;

    /**
     * Whether to enable SPA fallback
     * If true, returns index.html for non-API 404s
     * @default false
     */
    spaFallback?: boolean;

    /**
     * CORS configuration. Set to `false` to disable entirely.
     * Enabled by default with origin '*'.
     * Can also be controlled via environment variables:
     *   OS_CORS_ENABLED, OS_CORS_ORIGIN, OS_CORS_CREDENTIALS, OS_CORS_MAX_AGE
     *   (legacy CORS_* names still honoured with a deprecation warning).
     */
    cors?: HonoCorsOptions | false;

    /**
     * Enable per-request performance timing via the `Server-Timing` response
     * header ("perf-tuning mode"). OFF by default — the header discloses
     * internal phase durations (total / body-parse / handler), which is handy
     * for profiling but is also a backend-fingerprinting surface, so it is
     * opt-in. Can also be enabled with the `OS_SERVER_TIMING=true` environment
     * variable.
     * @default false
     */
    serverTiming?: boolean;
}

/**
 * Hono Server Plugin
 *
 * Provides HTTP server capabilities using Hono framework.
 * Registers the IHttpServer service so other plugins can register routes.
 *
 * Route registration is handled by plugins:
 * - `@objectstack/rest` → CRUD, metadata, discovery, UI, batch
 * - `createDispatcherPlugin()` → auth, graphql, analytics, packages, etc.
 */

/**
 * Fold the `'*'` wildcard super-user grant into every per-object entry of a
 * `/me/permissions` `objects` map, mutating it in place.
 *
 * The endpoint merges each resolved permission set's explicit `objects` entries
 * most-permissively per key, but treats `'*'` and named objects as independent
 * keys — so a wildcard "Modify/View All Data" grant is never propagated into a
 * per-object entry another set explicitly denied. That makes the client's
 * per-object FLS STRICTER than the server's actual enforcement
 * (`PermissionEvaluator.checkObjectPermission`, which returns allow as soon as
 * ANY set grants — including via the `'*'` modifyAll/viewAll super-user bypass,
 * with no deny-wins). The mismatch surfaces for a platform admin
 * (`admin_full_access` `'*': {modifyAllRecords}`) who ALSO holds
 * `organization_admin` (which denies writes on identity tables): the client
 * would see `sys_user.allowEdit:false` and disable a form the server accepts
 * (verified: `PATCH /data/sys_user {name}` → 200). ADR-0057 D10 makes the
 * server the authoritative gate; the client must mirror it, never diverge.
 *
 * The super-user grant covers private/managed objects on the server, so folding
 * it here is exactly as broad as real enforcement — never broader.
 */
export function foldWildcardSuperUser(objects: Record<string, any>): void {
    const wild = objects?.['*'];
    if (!wild) return;
    const superRead = wild.viewAllRecords === true || wild.modifyAllRecords === true;
    const superWrite = wild.modifyAllRecords === true;
    if (!superRead && !superWrite) return;
    for (const [obj, acc] of Object.entries(objects) as Array<[string, any]>) {
        if (obj === '*' || !acc) continue;
        if (superRead) acc.allowRead = true;
        if (superWrite) {
            acc.allowEdit = true;
            acc.allowCreate = true;
            acc.allowDelete = true;
        }
    }
}

/** Minimal schema shape the managed-write clamp needs. */
export interface ManagedSchemaLike {
    managedBy?: string;
    userActions?: {
        create?: boolean;
        // edit/delete accept the #2614 object form ({ enabled, visibleWhen,
        // disabledWhen }); only the object-level `enabled` matters here — the
        // per-record predicates are UI gating, not a permission grant.
        edit?: boolean | { enabled?: boolean };
        delete?: boolean | { enabled?: boolean };
    } | null;
}

/** True only when a userActions flag (bare boolean or object form) explicitly opts the write in. */
function isWriteOptedIn(v: boolean | { enabled?: boolean } | undefined | null): boolean {
    return v === true || (typeof v === 'object' && v !== null && v.enabled === true);
}

/**
 * Re-clamp a `/me/permissions` `objects` map by the SECOND server-side
 * enforcement layer that permission sets don't model: the identity write guard
 * (ADR-0092 D2). The guard fail-closed rejects USER-CONTEXT insert/update/delete
 * on every `managedBy: 'better-auth'` object except where the object opted a
 * write affordance in (`userActions.{create,edit,delete}` — e.g. sys_user opens
 * `edit` for its profile fields; the field-level `readonly` flags then narrow it
 * to `{name, image}`).
 *
 * Without this clamp, {@link foldWildcardSuperUser} would report `allowEdit:true`
 * for a platform admin on identity tables the guard actually blocks (sys_member,
 * sys_account, …) — a false-POSITIVE that mirrors, inverted, the false-negative
 * the fold fixes. The real effective answer for a user-context caller is
 * `permission-set grant ∩ guard policy`, and the guard policy for a managed
 * object is exactly its resolved CRUD affordance. Only `better-auth` objects are
 * clamped — the guard covers only them; `system`/`config`/`append-only` objects
 * have no such guard, so their permission-set result stands (an admin CAN write
 * them via the data API, and the hint must not under-report that).
 */
export function clampManagedObjectWrites(
    objects: Record<string, any>,
    schemaOf: (objectName: string) => ManagedSchemaLike | undefined,
): void {
    for (const [obj, acc] of Object.entries(objects) as Array<[string, any]>) {
        if (obj === '*' || !acc) continue;
        const schema = schemaOf(obj);
        if (schema?.managedBy !== 'better-auth') continue;
        const ua = schema.userActions ?? {};
        if (!isWriteOptedIn(ua.edit)) acc.allowEdit = false;
        if (ua.create !== true) acc.allowCreate = false;
        if (!isWriteOptedIn(ua.delete)) acc.allowDelete = false;
    }
}

export class HonoServerPlugin implements Plugin {
    name = 'com.objectstack.server.hono';
    type = 'server';
    version = '0.9.0';

    // Constants
    private static readonly DEFAULT_ENDPOINT_PRIORITY = 100;
    private static readonly CORE_ENDPOINT_PRIORITY = 950;
    private static readonly DISCOVERY_ENDPOINT_PRIORITY = 900;

    private options: HonoPluginOptions;
    private server: HonoHttpServer;

    constructor(options: HonoPluginOptions = {}) {
        this.options = {
            port: 3000,
            registerStandardEndpoints: true,
            useApiRegistry: true,
            spaFallback: false,
            ...options
        };
        // We handle static root manually in start() to support SPA fallback
        this.server = new HonoHttpServer(this.options.port);
    }

    /**
     * Init phase - Setup HTTP server and register as service
     */
    init = async (ctx: PluginContext) => {
        ctx.logger.debug('Initializing Hono server plugin', {
            port: this.options.port,
            staticRoot: this.options.staticRoot
        });

        // Register HTTP server service as IHttpServer
        // Register as 'http.server' to match core requirements
        ctx.registerService('http.server', this.server);
        // Alias 'http-server' for backward compatibility
        ctx.registerService('http-server', this.server);
        ctx.logger.debug('HTTP server service registered', { serviceName: 'http.server' });

        // ─── Server-Timing (perf-tuning mode) ─────────────────────────────────
        // Opt-in per-request performance timing exposed via the `Server-Timing`
        // response header. Registered FIRST (before CORS) so the `total` mark
        // brackets the whole request and the ambient timing collector is
        // established — via AsyncLocalStorage — for every downstream layer
        // (CORS, route handler, body parse) to record sub-phases into.
        const serverTimingEnabled =
            this.options.serverTiming ?? (process.env.OS_SERVER_TIMING === 'true');
        if (serverTimingEnabled) {
            const rawApp = this.server.getRawApp();
            rawApp.use('*', async (c, next) => {
                const timing = new PerfTiming();
                const endTotal = timing.start('total', 'Total server time');
                await runWithPerfTiming(timing, () => next());
                endTotal();
                const header = timing.toHeader();
                // `append` (not `set`) so we coexist with any upstream proxy
                // that already added a Server-Timing entry.
                if (header) c.res.headers.append('Server-Timing', header);
            });
            ctx.logger.debug('Server-Timing (perf-tuning) middleware enabled');
        }

        // ─── CORS Middleware ──────────────────────────────────────────────────
        // Enabled by default. Controlled via options.cors or environment variables.
        const corsDisabledByEnv = readEnvWithDeprecation('OS_CORS_ENABLED', 'CORS_ENABLED', { silent: true }) === 'false';
        if (this.options.cors !== false && !corsDisabledByEnv) {
            const corsOpts = typeof this.options.cors === 'object' ? this.options.cors : {};
            const enabled = corsOpts.enabled ?? true;

            if (enabled) {
                let configuredOrigin: string | string[];
                const corsOriginEnv = readEnvWithDeprecation('OS_CORS_ORIGIN', 'CORS_ORIGIN', { silent: true });
                if (corsOpts.origins) {
                    configuredOrigin = corsOpts.origins;
                } else if (corsOriginEnv) {
                    const envOrigin = corsOriginEnv.trim();
                    configuredOrigin = envOrigin.includes(',') ? envOrigin.split(',').map(s => s.trim()) : envOrigin;
                } else {
                    configuredOrigin = '*';
                }

                const credentials = corsOpts.credentials ?? (readEnvWithDeprecation('OS_CORS_CREDENTIALS', 'CORS_CREDENTIALS', { silent: true }) !== 'false');
                const maxAgeEnv = readEnvWithDeprecation('OS_CORS_MAX_AGE', 'CORS_MAX_AGE', { silent: true });
                const maxAge = corsOpts.maxAge ?? (maxAgeEnv ? parseInt(maxAgeEnv, 10) : 86400);

                // Determine origin handler based on configuration.
                // Always use a function so that localhost origins are
                // automatically allowed regardless of the configured
                // pattern list (handled inside matchOriginPattern /
                // createOriginMatcher).
                let origin: string | string[] | ((origin: string) => string | undefined | null);

                // When credentials is true, browsers reject wildcard '*' for Access-Control-Allow-Origin.
                // For wildcard patterns (like "https://*.example.com"), always use a matcher function.
                // For exact origins, we can pass them directly as string/array.
                if (configuredOrigin === '*' && credentials) {
                    // Credentials mode with '*' - reflect the request origin
                    origin = (requestOrigin: string) => requestOrigin || '*';
                } else if (hasWildcardPattern(configuredOrigin)) {
                    // Wildcard patterns (including better-auth style patterns like "https://*.objectui.org")
                    // Use pattern matcher to support subdomain and port wildcards
                    origin = createOriginMatcher(configuredOrigin);
                } else {
                    // Exact origin(s) — wrap in a function so localhost is
                    // still auto-allowed via the matcher.
                    const matcher = createOriginMatcher(configuredOrigin);
                    origin = (requestOrigin: string) => matcher(requestOrigin);
                }

                const rawApp = this.server.getRawApp();
                // Always include `set-auth-token` in exposed headers so that
                // the better-auth `bearer()` plugin can deliver rotated
                // session tokens to cross-origin clients (see plugin-auth).
                // User-supplied exposeHeaders are merged with this default.
                // `If-Match` carries the OCC token on record PATCHes (objectui's
                // record-level inline edit, REST `update` with `ifMatch`) — without
                // it in the preflight allow-list, every cross-origin save fails in
                // the browser with "Failed to fetch" (objectui#2572 dogfood find;
                // same split-origin class as the #2548 Bearer fixes).
                const defaultAllowHeaders = ['Content-Type', 'Authorization', 'X-Requested-With', 'X-Tenant-ID', 'X-Environment-Id', 'If-Match'];
                const defaultExposeHeaders = ['set-auth-token'];
                const allowHeaders = corsOpts.allowHeaders ?? defaultAllowHeaders;
                const exposeHeaders = Array.from(new Set([
                    ...defaultExposeHeaders,
                    ...(corsOpts.exposeHeaders ?? []),
                ]));

                rawApp.use('*', cors({
                    origin: origin as any,
                    allowMethods: corsOpts.methods || ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS'],
                    allowHeaders,
                    exposeHeaders,
                    credentials,
                    maxAge,
                }));

                ctx.logger.debug('CORS middleware enabled', { origin: configuredOrigin, credentials });
            }
        }
    }

    /**
     * Start phase - Configure static files and start listening
     */
    start = async (ctx: PluginContext) => {
        ctx.logger.debug('Starting Hono server plugin');

        // Configure Static Files & SPA Fallback
        const mounts: StaticMount[] = this.options.staticMounts || [];

        // Auto-discover UI Plugins
        try {
            const rawKernel = ctx.getKernel() as any;
            if (rawKernel.plugins) {
                const loadedPlugins = rawKernel.plugins instanceof Map
                    ? Array.from(rawKernel.plugins.values())
                    : Array.isArray(rawKernel.plugins) ? rawKernel.plugins : Object.values(rawKernel.plugins);

                for (const plugin of (loadedPlugins as any[])) {
                    // Check for UI Plugin signature
                    // Support legacy 'ui-plugin' and new 'ui' type
                    if ((plugin.type === 'ui' || plugin.type === 'ui-plugin') && plugin.staticPath) {
                        // Derive base route from name: @org/console -> console
                        const slug = plugin.slug || plugin.name.split('/').pop();
                        const baseRoute = `/${slug}`;

                        ctx.logger.debug(`Auto-mounting UI Plugin: ${plugin.name}`, {
                            path: baseRoute,
                            root: plugin.staticPath
                        });

                        mounts.push({
                            root: plugin.staticPath,
                            path: baseRoute,
                            rewrite: true, // Strip prefix: /console/assets/x -> /assets/x
                            spa: true
                        });

                        // Handle Default Plugin Redirect
                        if (plugin.default || plugin.isDefault) {
                             const rawApp = this.server.getRawApp();
                             rawApp.get('/', (c) => c.redirect(baseRoute));
                             ctx.logger.debug(`Set default UI redirect: / -> ${baseRoute}`);
                        }
                    }
                }
            }
        } catch (err: any) {
            ctx.logger.warn('Failed to auto-discover UI plugins', { error: err.message || err });
        }

        // Backward compatibility for staticRoot
        if (this.options.staticRoot) {
            mounts.push({
                root: this.options.staticRoot,
                path: '/',
                rewrite: false,
                spa: this.options.spaFallback
            });
        }

        if (mounts.length > 0) {
            const rawApp = this.server.getRawApp();

            for (const mount of mounts) {
                const mountRoot = path.resolve(process.cwd(), mount.root);

                if (!fs.existsSync(mountRoot)) {
                    ctx.logger.warn(`Static mount root not found: ${mountRoot}. Skipping.`);
                    continue;
                }

                const mountPath = mount.path || '/';
                const normalizedPath = mountPath.startsWith('/') ? mountPath : `/${mountPath}`;
                const routePattern = normalizedPath === '/' ? '/*' : `${normalizedPath.replace(/\/$/, '')}/*`;

                // Routes to register: both /mount and /mount/*
                const routes = normalizedPath === '/' ? [routePattern] : [normalizedPath, routePattern];

                ctx.logger.debug('Mounting static files', {
                    to: routes,
                    from: mountRoot,
                    rewrite: mount.rewrite,
                    spa: mount.spa
                });

                routes.forEach(route => {
                    // 1. Serve Static Files
                    rawApp.get(
                        route,
                        serveStatic({
                            root: mount.root,
                            rewriteRequestPath: (reqPath) => {
                                if (mount.rewrite && normalizedPath !== '/') {
                                    // /console/assets/style.css -> /assets/style.css
                                    if (reqPath.startsWith(normalizedPath)) {
                                        return reqPath.substring(normalizedPath.length) || '/';
                                    }
                                }
                                return reqPath;
                            }
                        })
                    );

                    // 2. SPA Fallback (Scoped)
                    if (mount.spa) {
                        rawApp.get(route, async (c, next) => {
                            // Skip if API path check
                            const config = this.options.restConfig || {};
                            const basePath = config.api?.basePath || '/api';

                            if (c.req.path.startsWith(basePath)) {
                                return next();
                            }

                            return serveStatic({
                                root: mount.root,
                                rewriteRequestPath: () => 'index.html'
                            })(c, next);
                        });
                    }
                });
            }
        }

        // Catch-all: ensure unmatched requests always get a proper Response
        // (prevents Hono "Context is not finalized" error).
        //
        // Hono routes a method mismatch to the SAME `notFound` sink as a
        // genuinely missing path, so a `POST` to a `PUT`-only route (e.g. the
        // metadata save endpoint, see #2684) used to return an opaque
        // `{ error: 'Not found' }` 404 with no hint that the path exists under
        // another verb. Here we re-match the request path against the set of
        // registered route patterns: if it lines up with routes under other
        // methods, answer `405 Method Not Allowed` with an accurate `Allow`
        // header so callers can self-correct. A path that matches nothing
        // stays a 404. This is framework-wide — every registered endpoint
        // benefits, not just metadata.
        const rawAppForNotFound = this.server.getRawApp();
        if (typeof rawAppForNotFound.notFound === 'function') {
            rawAppForNotFound.notFound((c: any) => {
                const allowed = this.server.allowedMethodsForPath(c.req.path);
                if (allowed.length > 0 && !allowed.includes(c.req.method)) {
                    c.header('Allow', allowed.join(', '));
                    return c.json({
                        error: 'Method Not Allowed',
                        code: 'METHOD_NOT_ALLOWED',
                        message: `${c.req.method} is not supported for ${c.req.path}. Allowed: ${allowed.join(', ')}.`,
                        method: c.req.method,
                        path: c.req.path,
                        allowed,
                    }, 405);
                }
                return c.json({ error: 'Not found' }, 404);
            });
        }

        // Register standard endpoints during kernel:ready so they're
        // wired up alongside other plugins' route registrations.
        if (this.options.registerStandardEndpoints) {
            ctx.hook('kernel:ready', async () => {
                this.registerDiscoveryAndCrudEndpoints(ctx);
            });
        }

        // Open the listening socket on kernel:listening — this fires
        // STRICTLY AFTER every kernel:ready handler completes, so all
        // plugins have finished registering routes by the time the
        // server starts accepting requests.
        //
        // Why this matters: Hono seals the route matcher the first
        // time a request is matched. If we listen during kernel:ready
        // and a request arrives before sibling plugins (auth, i18n,
        // storage, …) finish registering their routes, those late
        // `app.get(...)` calls throw "matcher is already built" and
        // crash the process. Cloudflare Containers fronts traffic the
        // millisecond port 4000 opens, so the race fires on every
        // cold boot in production. See
        // packages/spec/src/contracts/plugin-lifecycle-events.ts for
        // the full rationale.
        ctx.hook('kernel:listening', async () => {
            const port = this.options.port ?? 3000;
            ctx.logger.debug('Starting HTTP server', { port });

            await this.server.listen(port);

            const actualPort = this.server.getPort();
            if (actualPort !== port) {
                ctx.logger.warn(`Port ${port} is in use, using port ${actualPort} instead`);
            }
            ctx.logger.info('HTTP server started successfully', {
                port: actualPort,
                url: `http://localhost:${actualPort}`
            });
        });
    }

    /**
     * Register discovery and basic CRUD endpoints.
     * Called when `registerStandardEndpoints` is true, before the server starts listening.
     */
    private registerDiscoveryAndCrudEndpoints(ctx: PluginContext) {
        const rawApp = this.server.getRawApp();
        const prefix = '/api/v1';

        // Build the standard discovery response
        const discovery = {
            version: 'v1',
            apiName: 'ObjectStack API',
            routes: {
                data:          `${prefix}/data`,
                metadata:      `${prefix}/meta`,
                auth:          `${prefix}/auth`,
                packages:      `${prefix}/packages`,
                analytics:     `${prefix}/analytics`,
                // realtime deliberately absent (ADR-0076 D12, #2462): no
                // /realtime HTTP surface is mounted anywhere — advertising
                // it here made clients call a route that 404s.
                workflow:      `${prefix}/workflow`,
                automation:    `${prefix}/automation`,
                ai:            `${prefix}/ai`,
                notifications: `${prefix}/notifications`,
                i18n:          `${prefix}/i18n`,
                storage:       `${prefix}/storage`,
                ui:            `${prefix}/ui`,
            },
        };

        // Discovery endpoints
        rawApp.get('/.well-known/objectstack', (c: any) => c.redirect(`${prefix}/discovery`));
        rawApp.get(`${prefix}/discovery`, (c: any) => c.json({ data: discovery }));

        ctx.logger.info('Registered discovery endpoints', { prefix });

        // ── Anonymous-deny gate (ADR-0056 D2, #2567) ──────────────────────────
        // These raw `/data/:object` routes delegate straight to ObjectQL. They
        // are only *shadowed* by the REST plugin's gated `/data` routes when
        // that plugin registers the same paths FIRST — so before this gate the
        // platform's anonymous posture depended on plugin registration order: a
        // load-order change silently reopened anonymous data access with no test
        // failing. Gating here makes the deny decision a property of THIS entry
        // point too, so security no longer depends on who registered first.
        //
        // Secure-by-default: `requireAuth` mirrors `rest-server.ts`'s `?? true`
        // (ADR-0056 D2). A deployment that intentionally serves data publicly
        // sets `restConfig.api.requireAuth = false` (a boot warning is logged, as
        // in the REST plugin). No-op in that case — the previously-public surface
        // is unchanged. An authenticated / system caller always passes.
        //
        // `requireAuth` is not in the typed `api` shape (rest-server.ts reads it
        // via the same `as any` cast), so widen locally.
        const requireAuth =
            (this.options.restConfig?.api as { requireAuth?: boolean } | undefined)?.requireAuth ?? true;
        if (!requireAuth) {
            ctx.logger.warn(
                'Hono standard /data endpoints: requireAuth is OFF — anonymous callers can read/write object data. ' +
                'This is a deliberate opt-out; set restConfig.requireAuth=true to deny anonymous access (ADR-0056 D2, #2567).',
            );
        }
        // Returns a 401 Response when the caller is anonymous under the deny
        // posture, else null (caller proceeds). Delegates the decision to the
        // shared `shouldDenyAnonymous` (#2567) so every HTTP seam stays in
        // lockstep. `isSystem` is never set on inbound HTTP (internal-only), so
        // it cannot be forged to bypass this.
        const denyAnonymous = (c: any, execCtx: any): Response | null =>
            shouldDenyAnonymous({ requireAuth, userId: execCtx?.userId, isSystem: execCtx?.isSystem })
                ? c.json(ANONYMOUS_DENY_BODY, ANONYMOUS_DENY_STATUS)
                : null;

        // Basic CRUD data endpoints — delegate to ObjectQL service directly
        const getObjectQL = () => ctx.getService<IDataEngine>('objectql');

        // Helper: resolve ExecutionContext from request headers (cookie session
        // or API key). Mirrors the runtime's resolveExecutionContext but
        // self-contained to avoid a cross-package dep. We DO query the
        // `sys_user_permission_set` link tables because hardcoding a single
        // permission set name (e.g. `member_default`) would silently ignore
        // any explicit admin / role assignment — including the platform-admin
        // promotion seeded by `bootstrapPlatformAdmin`.
        const resolveCtx = async (c: any): Promise<any | undefined> => {
            try {
                const authService: any = ctx.getService('auth');
                if (!authService) return undefined;
                let api: any = authService.api;
                if (!api && typeof authService.getApi === 'function') {
                    api = await authService.getApi();
                }
                if (!api?.getSession) return undefined;
                const session = await api.getSession({ headers: c.req.raw.headers });
                if (!session?.user?.id) return undefined;
                const userId = session.user.id;
                const tenantId = session.session?.activeOrganizationId ?? undefined;
                const permissions: string[] = [];
                const roles: string[] = [];
                try {
                    const ql = getObjectQL();
                    const sysCtx = { context: { isSystem: true } };
                    // Roles via sys_member (org-scoped if active org).
                    const memberRows = await ql?.find?.(
                        'sys_member',
                        {
                            where: tenantId
                                ? { user_id: userId, organization_id: tenantId }
                                : { user_id: userId },
                            limit: 50,
                            ...sysCtx,
                        } as any,
                    ).catch(() => []);
                    for (const m of (memberRows ?? []) as any[]) {
                        if (typeof m.role === 'string') {
                            for (const r of m.role.split(',').map((s: string) => s.trim()).filter(Boolean)) {
                                if (!roles.includes(r)) roles.push(r);
                            }
                        }
                    }
                    // User-scoped permission sets — match BOTH (a) the active
                    // org's link rows and (b) the cross-tenant rows
                    // (organization_id IS NULL) so the platform-admin
                    // promotion seeded by `bootstrapPlatformAdmin` applies
                    // regardless of the user's active org.
                    const upsRows = await ql?.find?.(
                        'sys_user_permission_set',
                        { where: { user_id: userId }, limit: 100, ...sysCtx } as any,
                    ).catch(() => []);
                    const psIds = new Set<string>();
                    for (const r of (upsRows ?? []) as any[]) {
                        const orgScope = r.organization_id ?? null;
                        if (!orgScope || (tenantId && orgScope === tenantId)) {
                            const pid = r.permission_set_id ?? r.permissionSetId;
                            if (pid) psIds.add(pid);
                        }
                    }
                    if (psIds.size > 0) {
                        const psRows = await ql?.find?.(
                            'sys_permission_set',
                            { where: { id: { $in: Array.from(psIds) } }, limit: 500, ...sysCtx } as any,
                        ).catch(() => []);
                        for (const ps of (psRows ?? []) as any[]) {
                            if (ps.name && !permissions.includes(ps.name)) permissions.push(ps.name);
                        }
                    }
                } catch {
                    /* fall through with whatever we resolved so far */
                }
                // Resolve fellow-org user IDs so identity-table RLS (sys_user
                // org-members policy) can scope @-mention pickers, owner
                // lookups and reviewer selectors to the active organization.
                // Mirrors the resolvers in `@objectstack/rest` and
                // `@objectstack/runtime` so all three REST entry-points
                // produce a consistent ExecutionContext shape.
                let orgUserIds: string[] = [userId];
                if (tenantId) {
                    try {
                        const ql = getObjectQL();
                        const sysCtx = { context: { isSystem: true } };
                        const memberRows = await ql?.find?.(
                            'sys_member',
                            { where: { organization_id: tenantId }, limit: 1000, ...sysCtx } as any,
                        ).catch(() => []);
                        const ids = new Set<string>([userId]);
                        for (const m of (memberRows ?? []) as any[]) {
                            const uid = m.user_id ?? m.userId;
                            if (typeof uid === 'string' && uid.length > 0) ids.add(uid);
                        }
                        orgUserIds = Array.from(ids);
                    } catch {
                        /* fall back to self-only */
                    }
                }
                // Env-side AI-seat marker (simple model). The single-org env
                // DB has no permission-set/org dimension for this — the seat is
                // the boolean `sys_user.ai_access`. Read it with a GUARDED system
                // query (NOT a better-auth additionalField: sys_user is
                // better-auth-managed and better-auth SELECTs explicit columns,
                // so an additionalField would make getSession query a possibly-
                // missing column → broken auth; a guarded read can only no-op).
                // When true, synthesize the `ai_seat` capability so the per-agent
                // gate (evaluateAgentAccess → requires `ai_seat`) admits the user
                // with no permission-set grant. Absent/false/missing-column →
                // no synthesis (deny, as before).
                if (!permissions.includes('ai_seat')) {
                    try {
                        const ql = getObjectQL();
                        const sysCtx = { context: { isSystem: true } };
                        const uRows = await ql?.find?.(
                            'sys_user',
                            { where: { id: userId }, limit: 1, ...sysCtx } as any,
                        ).catch(() => []);
                        // Turso returns sqlite booleans as 1/0; memory driver as boolean.
                        const aiAccess = (uRows?.[0] as any)?.ai_access;
                        if (aiAccess === true || aiAccess === 1 || aiAccess === '1') permissions.push('ai_seat');
                    } catch {
                        /* no ai_access column / query failed → no seat (safe) */
                    }
                }
                return {
                    userId,
                    tenantId,
                    roles,
                    permissions,
                    isSystem: false,
                    org_user_ids: orgUserIds,
                } as any;
            } catch {
                return undefined;
            }
        };

        // Create
        rawApp.post(`${prefix}/data/:object`, async (c: any) => {
            const ql = getObjectQL();
            if (!ql) return c.json({ error: 'Data service not available' }, 503);
            const object = c.req.param('object');
            const data = await c.req.json().catch(() => ({}));
            const execCtx = await resolveCtx(c);
            const denied = denyAnonymous(c, execCtx);
            if (denied) return denied;
            try {
                const res = await ql.insert(object, data, { context: execCtx } as any);
                const record = { ...data, ...res };
                return c.json({ object, id: record.id, record });
            } catch (err: any) {
                if (err?.code === 'PERMISSION_DENIED' || err?.name === 'PermissionDeniedError') {
                    return c.json({ error: err.message ?? 'Forbidden' }, 403);
                }
                throw err;
            }
        });

        // Get by ID
        rawApp.get(`${prefix}/data/:object/:id`, async (c: any) => {
            const ql = getObjectQL();
            if (!ql) return c.json({ error: 'Data service not available' }, 503);
            const object = c.req.param('object');
            const id = c.req.param('id');
            const execCtx = await resolveCtx(c);
            const denied = denyAnonymous(c, execCtx);
            if (denied) return denied;
            try {
                let all = await ql.find(object, { context: execCtx } as any);
                if (!all) all = [];
                const match = all.find((i: any) => i.id === id);
                return match ? c.json({ object, id, record: match }) : c.json({ error: 'Not found' }, 404);
            } catch (err: any) {
                if (err?.code === 'PERMISSION_DENIED' || err?.name === 'PermissionDeniedError') {
                    return c.json({ error: err.message ?? 'Forbidden' }, 403);
                }
                throw err;
            }
        });

        // Find / List
        rawApp.get(`${prefix}/data/:object`, async (c: any) => {
            const ql = getObjectQL();
            if (!ql) return c.json({ error: 'Data service not available' }, 503);
            const object = c.req.param('object');
            const execCtx = await resolveCtx(c);
            const denied = denyAnonymous(c, execCtx);
            if (denied) return denied;
            try {
                let all = await ql.find(object, { context: execCtx } as any);
                if (!Array.isArray(all) && all && (all as any).value) all = (all as any).value;
                if (!all) all = [];
                return c.json({ object, records: all, total: all.length });
            } catch (err: any) {
                if (err?.code === 'PERMISSION_DENIED' || err?.name === 'PermissionDeniedError') {
                    return c.json({ error: err.message ?? 'Forbidden' }, 403);
                }
                throw err;
            }
        });

        // Effective permissions for the current user — single aggregation
        // endpoint that resolves session → roles → permission sets → merged
        // field/object permissions. Frontend Field-Level Security (FLS)
        // consumes this to gate form fields / list columns without having
        // to replicate the server's role+permission-set resolution and
        // most-permissive merge logic.
        //
        // Response shape (designed to mirror @object-ui/permissions
        // expectations — see `PermissionSet` in @objectstack/spec):
        //   {
        //     userId, tenantId, roles, permissionSets,
        //     objects: Record<objectName, { allowCreate, allowRead, ... }>,
        //     fields:  Record<"object.field", { readable, editable }>,
        //   }
        //
        // Returns `{authenticated:false}` (200) when no session is
        // present, so the frontend can distinguish anon from error.
        rawApp.get(`${prefix}/auth/me/permissions`, async (c: any) => {
            const execCtx = await resolveCtx(c);
            if (!execCtx?.userId) {
                return c.json({ authenticated: false });
            }
            try {
                const metadata: any = ctx.getService('metadata');
                const evaluator: any = ctx.getService('security.permissions');
                const bootstrap: any[] = (() => {
                    try { return ctx.getService<any[]>('security.bootstrapPermissionSets') ?? []; }
                    catch { return []; }
                })();
                const fallbackName: string | null = (() => {
                    try { return ctx.getService<string | null>('security.fallbackPermissionSet') ?? 'member_default'; }
                    catch { return 'member_default'; }
                })();
                // DB loader: surfaces user-defined permission sets
                // (created via the admin UI as `sys_permission_set`
                // rows) that aren't in metadata or bootstrap.
                const ql: any = (() => {
                    try { return ctx.getService('objectql'); } catch { return null; }
                })();
                const dbLoader = ql
                    ? async (names: string[]) => {
                        let rows: any;
                        try {
                            rows = await ql.find(
                                'sys_permission_set',
                                { where: { name: { $in: names } }, limit: names.length },
                                { context: { isSystem: true } },
                            );
                        } catch {
                            rows = [];
                        }
                        const list = Array.isArray(rows) ? rows : rows?.records ?? [];
                        return list.map((r: any) => ({
                            name: r.name,
                            label: r.label,
                            objects: typeof r.object_permissions === 'string'
                                ? JSON.parse(r.object_permissions || '{}')
                                : r.object_permissions ?? {},
                            fields: typeof r.field_permissions === 'string'
                                ? JSON.parse(r.field_permissions || '{}')
                                : r.field_permissions ?? {},
                            // #2752 follow-through: DB-loaded sets used to drop
                            // their capability + tab columns, so a direct grant
                            // of e.g. `setup.access` never surfaced here.
                            systemPermissions: typeof r.system_permissions === 'string'
                                ? JSON.parse(r.system_permissions || '[]')
                                : r.system_permissions ?? [],
                            tabPermissions: typeof r.tab_permissions === 'string'
                                ? JSON.parse(r.tab_permissions || '{}')
                                : r.tab_permissions ?? {},
                        }));
                    }
                    : undefined;
                if (!evaluator || !metadata) {
                    // Auth resolved but security plugin isn't wired — emit
                    // an empty-but-authenticated body so the frontend can
                    // fail-open with full access (matches server behaviour
                    // when SecurityPlugin isn't registered).
                    return c.json({
                        authenticated: true,
                        userId: execCtx.userId,
                        tenantId: execCtx.tenantId ?? null,
                        positions: execCtx.positions ?? [],
                        permissionSets: execCtx.permissions ?? [],
                        objects: {},
                        fields: {},
                    });
                }
                // Resolve the same way SecurityPlugin middleware does:
                // role names + explicit permission-set names, with a
                // fallback to `member_default` when authenticated users
                // resolve to zero permission sets (matches the
                // post-resolution fallback in security-plugin.ts).
                const requested = [
                    ...(execCtx.positions ?? []),
                    ...(execCtx.permissions ?? []),
                ];
                let resolved: any[] = await evaluator
                    .resolvePermissionSets(requested, metadata, bootstrap, dbLoader)
                    .catch(() => []);
                if (resolved.length === 0 && fallbackName) {
                    resolved = await evaluator
                        .resolvePermissionSets([fallbackName], metadata, bootstrap, dbLoader)
                        .catch(() => []);
                }
                // Most-permissive merge of `objects` and `fields` across
                // all resolved permission sets — same semantics as
                // PermissionEvaluator.getFieldPermissions but for ALL
                // objects in a single pass.
                const objects: Record<string, any> = {};
                const fields: Record<string, { readable: boolean; editable: boolean }> = {};
                const systemPermissions = new Set<string>();
                const tabRank: Record<string, number> = { hidden: 0, default_off: 1, default_on: 2, visible: 3 };
                const tabPermissions: Record<string, 'visible' | 'hidden' | 'default_on' | 'default_off'> = {};
                for (const ps of resolved) {
                    if (ps?.objects) {
                        for (const [obj, perm] of Object.entries(ps.objects)) {
                            const acc = objects[obj] ?? {};
                            for (const [k, v] of Object.entries(perm as any)) {
                                if (v === true) acc[k] = true;
                                else if (acc[k] === undefined) acc[k] = v;
                            }
                            objects[obj] = acc;
                        }
                    }
                    if (ps?.fields) {
                        for (const [key, perm] of Object.entries(ps.fields)) {
                            const acc = fields[key] ?? { readable: false, editable: false };
                            const p = perm as any;
                            if (p.readable) acc.readable = true;
                            if (p.editable) acc.editable = true;
                            fields[key] = acc;
                        }
                    }
                    if (Array.isArray(ps?.systemPermissions)) {
                        for (const sp of ps.systemPermissions) {
                            if (typeof sp === 'string') systemPermissions.add(sp);
                        }
                    }
                    if (ps?.tabPermissions && typeof ps.tabPermissions === 'object') {
                        for (const [app, val] of Object.entries(ps.tabPermissions as Record<string, unknown>)) {
                            if (typeof val !== 'string' || !(val in tabRank)) continue;
                            const cur = tabPermissions[app];
                            if (!cur || tabRank[val] > tabRank[cur]) {
                                tabPermissions[app] = val as 'visible' | 'hidden' | 'default_on' | 'default_off';
                            }
                        }
                    }
                }
                // Make the client's per-object FLS reflect the server's ACTUAL
                // effective enforcement = permission-set grant ∩ identity write
                // guard (ADR-0057 D10). (1) Fold the `'*'` super-user grant into
                // every object so an admin's wildcard is not shadowed by another
                // set's explicit deny; (2) re-clamp `better-auth` managed objects
                // by their write affordance, since the guard (ADR-0092 D2) blocks
                // user-context writes there except where the object opted in
                // (sys_user → edit). Together these remove both the false-negative
                // (admin sees sys_user editable) and the false-positive (admin does
                // NOT see sys_member editable, matching the guard).
                foldWildcardSuperUser(objects);
                clampManagedObjectWrites(objects, (name) => {
                    try { return ql?.getSchema?.(name) as ManagedSchemaLike | undefined; }
                    catch { return undefined; }
                });
                return c.json({
                    authenticated: true,
                    userId: execCtx.userId,
                    tenantId: execCtx.tenantId ?? null,
                    positions: execCtx.positions ?? [],
                    permissionSets: resolved.map((p: any) => p?.name).filter(Boolean),
                    objects,
                    fields,
                    systemPermissions: Array.from(systemPermissions),
                    tabPermissions,
                });
            } catch (err: any) {
                ctx.logger.warn('[hono] /auth/me/permissions failed', { err: err?.message });
                return c.json({ authenticated: true, userId: execCtx.userId, objects: {}, fields: {} });
            }
        });

        // GET /me/localization — the resolved regional defaults (currency /
        // locale / timezone) for the current request's tenant, exposed to EVERY
        // authenticated user. The `localization` SETTINGS are gated to
        // `setup.access`, but the resolved defaults are needed by every renderer
        // to format currency/dates/numbers — so they ride on the request
        // ExecutionContext (ADR-0053) and are surfaced here without that gate.
        rawApp.get(`${prefix}/auth/me/localization`, async (c: any) => {
            const execCtx = await resolveCtx(c);
            if (!execCtx?.userId) {
                return c.json({ authenticated: false });
            }
            return c.json({
                authenticated: true,
                currency: execCtx.currency ?? null,
                locale: execCtx.locale ?? null,
                timezone: execCtx.timezone ?? null,
            });
        });

        // GET /me/apps — list apps the current user is allowed to enter.
        // Apps live in the ENGINE REGISTRY (runtime AppPlugin registerApp()),
        // not the metadata service — reading `metadata.list('app')` returned
        // [] for every principal (#2752), leaving tabPermissions and
        // AppSchema.requiredPermissions with no enforced consumer. Source
        // from `registry.getAllApps()` (the same authority the meta routes
        // use, nav contributions merged), with the metadata service kept as
        // an additive fallback for runtime-draft-published apps. Filters:
        //   1. AppSchema.requiredPermissions ⊆ ctx.systemPermissions
        //   2. ctx.tabPermissions[app.name] !== 'hidden'
        // Anonymous users get an empty array. When SecurityPlugin is absent
        // we fail-open and return every app (matches server behaviour).
        rawApp.get(`${prefix}/me/apps`, async (c: any) => {
            const execCtx = await resolveCtx(c);
            if (!execCtx?.userId) return c.json({ apps: [] });
            try {
                const byName = new Map<string, any>();
                try {
                    const registry: any = (ctx.getService('objectql') as any)?._registry;
                    for (const app of registry?.getAllApps?.() ?? []) {
                        if (app?.name) byName.set(String(app.name), app);
                    }
                } catch { /* registry unavailable — fall through to metadata */ }
                try {
                    const metadata: any = ctx.getService('metadata');
                    for (const app of ((await metadata?.list?.('app')) ?? []) as any[]) {
                        if (app?.name && !byName.has(String(app.name))) byName.set(String(app.name), app);
                    }
                } catch { /* metadata service optional */ }
                // Resolve the caller's effective capability/tab surface the
                // same way /auth/me/permissions does — resolveCtx() carries
                // neither systemPermissions nor tabPermissions, so filtering
                // on execCtx fields silently gated EVERY requiredPermissions
                // app away from everyone, including the platform admin.
                const sysPerms = new Set<string>(execCtx.systemPermissions ?? []);
                const tabs: Record<string, string> = { ...((execCtx as any).tabPermissions ?? {}) };
                let failOpen = true;
                try {
                    const evaluator: any = ctx.getService('security.permissions');
                    failOpen = !evaluator;
                    if (evaluator) {
                        const metadata: any = ctx.getService('metadata');
                        const bootstrap: any[] = (() => {
                            try { return ctx.getService<any[]>('security.bootstrapPermissionSets') ?? []; }
                            catch { return []; }
                        })();
                        const fallbackName: string | null = (() => {
                            try { return ctx.getService<string | null>('security.fallbackPermissionSet') ?? 'member_default'; }
                            catch { return 'member_default'; }
                        })();
                        const requested = [
                            ...((execCtx as any).positions ?? []),
                            ...((execCtx as any).permissions ?? []),
                        ];
                        const qlSvc: any = (() => { try { return ctx.getService('objectql'); } catch { return null; } })();
                        const dbLoader = qlSvc
                            ? async (names: string[]) => {
                                let rows: any;
                                try {
                                    rows = await qlSvc.find(
                                        'sys_permission_set',
                                        { where: { name: { $in: names } }, limit: names.length },
                                        { context: { isSystem: true } },
                                    );
                                } catch { rows = []; }
                                const list = Array.isArray(rows) ? rows : rows?.records ?? [];
                                return list.map((r: any) => ({
                                    name: r.name,
                                    systemPermissions: typeof r.system_permissions === 'string'
                                        ? JSON.parse(r.system_permissions || '[]')
                                        : r.system_permissions ?? [],
                                    tabPermissions: typeof r.tab_permissions === 'string'
                                        ? JSON.parse(r.tab_permissions || '{}')
                                        : r.tab_permissions ?? {},
                                }));
                            }
                            : undefined;
                        let resolved: any[] = await evaluator
                            .resolvePermissionSets(requested, metadata, bootstrap, dbLoader)
                            .catch(() => []);
                        if (resolved.length === 0 && fallbackName) {
                            resolved = await evaluator
                                .resolvePermissionSets([fallbackName], metadata, bootstrap, dbLoader)
                                .catch(() => []);
                        }
                        const tabRank: Record<string, number> = { hidden: 0, default_off: 1, default_on: 2, visible: 3 };
                        for (const ps of resolved) {
                            for (const sp of (Array.isArray(ps?.systemPermissions) ? ps.systemPermissions : [])) {
                                if (typeof sp === 'string') sysPerms.add(sp);
                            }
                            if (ps?.tabPermissions && typeof ps.tabPermissions === 'object') {
                                for (const [app, val] of Object.entries(ps.tabPermissions as Record<string, unknown>)) {
                                    if (typeof val !== 'string' || !(val in tabRank)) continue;
                                    const cur = tabs[app];
                                    if (!cur || tabRank[val] > (tabRank[cur] ?? -1)) tabs[app] = val;
                                }
                            }
                        }
                    }
                } catch { failOpen = true; }
                const apps = [...byName.values()].filter((app: any) => {
                    if (tabs[app.name] === 'hidden') return false;
                    if (failOpen) return true;
                    const req: string[] = Array.isArray(app.requiredPermissions) ? app.requiredPermissions : [];
                    return req.every((p) => sysPerms.has(p));
                });
                return c.json({ apps });
            } catch (err: any) {
                ctx.logger.warn('[hono] /me/apps failed', { err: err?.message });
                return c.json({ apps: [] });
            }
        });

        ctx.logger.debug('Registered standard CRUD data endpoints', { prefix });
    }

    /**
     * Destroy phase - Stop server
     */
    async destroy() {
        this.server.close();
        // Note: Can't use ctx.logger here since we're in destroy
        console.log('[HonoServerPlugin] Server stopped');
    }
}
