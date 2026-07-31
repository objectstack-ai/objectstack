// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import {
    Plugin, PluginContext, IDataEngine,
    shouldDenyAnonymous, ANONYMOUS_DENY_BODY, ANONYMOUS_DENY_STATUS,
} from '@objectstack/core';
import {
    RestServerConfig,
    type ApiRoutes,
} from '@objectstack/spec/api';
import {
    makeExecutionContextResolver,
    registerCurrentUserEndpoints,
} from './current-user-endpoints';
import { HonoHttpServer, HonoCorsOptions } from './adapter';
import { cors } from 'hono/cors';
import { serveStatic } from '@hono/node-server/serve-static';
import * as fs from 'fs';
import * as path from 'path';
import { createOriginMatcher, hasWildcardPattern, isLocalhostOrigin } from './pattern-matcher';
import { readEnvWithDeprecation } from '@objectstack/types';
import {
    PerfTiming,
    runWithPerfTiming,
    runWithPerfDisclosure,
    allowPerfDisclosure,
    isPerfDisclosurePrincipal,
    type PerfDisclosureGate,
} from '@objectstack/observability';

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
     * Whether to register the standalone CRUD + discovery convenience surface:
     * raw `POST/GET /api/v1/data/:object` (create + read only) and
     * `GET /api/v1/discovery` / `/.well-known/objectstack`.
     *
     * @deprecated On its way out (#4073) — opt in only during the deprecation
     * window; the surface (and this flag) will be deleted after a release of
     * observation, leaving this plugin a pure transport adapter (ADR-0076 D11).
     *
     * Every path it mounts is DUPLICATE supply, and lesser supply at that:
     * C+R only, a subset of the gates, and a discovery payload that predates
     * `DiscoverySchema`. `@objectstack/rest` serves full `/data` CRUD behind
     * the whole gate stack, REST/the dispatcher own discovery (this surface
     * cedes it to them when either is present, #4018), and a composed host
     * answers byte-identically with this flag on or off (#4260). It exists
     * only for a bare host that mounts neither — and the tax has been real:
     * every platform invariant needed re-implementing here after the fact
     * (#2567, #3298, #4018).
     *
     * The default is now `false`. A bare host that relied on it should mount
     * `createRestApiPlugin` (`@objectstack/rest`) — it needs the same
     * `objectql` this surface already required, and returns full CRUD plus
     * the gates — or pass `true` explicitly until the deletion lands. A boot
     * with no data/discovery provider at all logs a pointer instead of
     * silently 404ing.
     *
     * It does NOT gate the current-user endpoints (`/auth/me/permissions`,
     * `/auth/me/localization`, `/me/apps`) — this plugin is their only provider
     * anywhere, so they register unconditionally (#4073).
     *
     * @default false
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
     * Per-request performance timing via the `Server-Timing` response header
     * ("perf-tuning mode"). The header discloses internal phase durations
     * (total / auth / db / hooks / serialize), which is handy for profiling but
     * is also a mild backend-fingerprinting surface, so disclosure is gated:
     *
     *  - **GLOBAL** — `serverTiming: true`, or `OS_SERVER_TIMING=true` /
     *    `OS_PERF_TIMING=1`: every response carries the header (an environment
     *    under active investigation).
     *  - **PER-REQUEST** — always available unless hard-disabled: a caller sends
     *    `X-OS-Debug-Timing: 1` and the header is returned ONLY after the request
     *    resolves an admin/service identity (the dispatcher opens the disclosure
     *    gate). Ordinary users can never pull timings just by sending the header.
     *    `X-OS-Debug-Timing: json` additionally returns an admin-only
     *    `X-OS-Debug-Timing-Detail` header — compact JSON listing the slowest
     *    per-query SQL *shapes* (parametrized, no bindings) — never disclosed to
     *    a non-admin, even under global mode.
     *  - `serverTiming: false` hard-disables BOTH paths (no middleware).
     *
     * `undefined` (the default) leaves global mode off but keeps the
     * admin-gated per-request path available.
     * @default undefined
     */
    serverTiming?: boolean;
}

/**
 * How much per-request timing the caller opted into via `X-OS-Debug-Timing`:
 *  - `off`   — no header sent (or an unrecognized value).
 *  - `basic` — `1` / `true` / `yes` / `on`: the `Server-Timing` header only.
 *  - `json`  — `json` / `detail` / `verbose`: also the admin-only richer detail
 *              payload (per-query SQL shapes, slowest query).
 */
export type DebugTimingMode = 'off' | 'basic' | 'json';

/** Parse the `X-OS-Debug-Timing` request-header value into a {@link DebugTimingMode}. */
export function debugTimingMode(value: string | undefined | null): DebugTimingMode {
    if (!value) return 'off';
    const v = value.trim().toLowerCase();
    if (v === 'json' || v === 'detail' || v === 'verbose') return 'json';
    if (v === '1' || v === 'true' || v === 'yes' || v === 'on') return 'basic';
    return 'off';
}

/**
 * Whether a request opted into per-request perf timing via `X-OS-Debug-Timing`
 * (any recognized mode — basic or json).
 */
export function isDebugTimingRequested(value: string | undefined | null): boolean {
    return debugTimingMode(value) !== 'off';
}

/** Max individual queries listed in the detail payload (bounds header size). */
const DETAIL_MAX_QUERIES = 20;
/** Max characters kept per query label in the detail payload. */
const DETAIL_MAX_LABEL = 300;

/**
 * Coerce a detail label (a parametrized SQL statement) to a header-safe,
 * printable-ASCII string: non-token bytes and control chars become spaces so the
 * JSON stays valid and the `X-OS-Debug-Timing-Detail` header can never carry a
 * CR/LF (header-injection) or a non-latin1 byte the Fetch Headers API rejects.
 */
function sanitizeDetailLabel(s: string): string {
    let out = '';
    for (const ch of String(s)) {
        const c = ch.codePointAt(0)!;
        out += c >= 0x20 && c <= 0x7e ? ch : ' ';
    }
    return out.replace(/\s+/g, ' ').trim().slice(0, DETAIL_MAX_LABEL);
}

/**
 * Build the admin-only `X-OS-Debug-Timing-Detail` payload (compact JSON) from a
 * collector's captured `db` detail: the slowest queries by shape, the single
 * slowest, and the captured count + total. Returns `''` when nothing was
 * captured. SQL is parametrized (no bindings) and sanitized to printable ASCII.
 */
export function buildTimingDetail(timing: PerfTiming): string {
    const db = timing.details('db');
    if (db.length === 0) return '';
    const round = (n: number) => Math.round(n * 100) / 100;
    const sorted = [...db].sort((a, b) => b.dur - a.dur);
    const queries = sorted.slice(0, DETAIL_MAX_QUERIES).map((d) => ({
        sql: sanitizeDetailLabel(d.label),
        dur: round(d.dur),
    }));
    const totalMs = round(db.reduce((sum, d) => sum + d.dur, 0));
    const payload: Record<string, unknown> = {
        db: {
            count: db.length,
            totalMs,
            slowest: queries[0] ?? null,
            queries,
            ...(sorted.length > queries.length ? { truncated: sorted.length - queries.length } : {}),
        },
    };
    return JSON.stringify(payload);
}

/**
 * The two plugins that own a REAL, computed `/discovery` (ADR-0076 D11 / OQ#9).
 * `@objectstack/rest` serves `metadata-protocol`'s registry-driven `getDiscovery()`;
 * the runtime dispatcher serves `HttpDispatcher.getDiscoveryInfo()`. When either is
 * on the kernel, this convenience surface cedes the route to it rather than
 * publishing a third payload.
 */
const REST_API_PLUGIN = 'com.objectstack.rest.api';
const RUNTIME_DISPATCHER_PLUGIN = 'com.objectstack.runtime.dispatcher';

/**
 * Base-path segment for every route family this surface can advertise, keyed by
 * its `ApiRoutes` field (`spec/api/discovery.zod.ts`). Typed against the spec so a
 * renamed or dropped key breaks the build here instead of drifting silently.
 *
 * This is a path map, not a capability list — nothing here is advertised unless a
 * matching route is actually registered (see `advertisableRoutes`).
 *
 * `realtime` is deliberately absent (ADR-0076 D12, #2462): service-realtime is an
 * in-process pub/sub bus with no HTTP surface anywhere, so it could never be
 * mounted under `/api/v1/realtime` and listing it would only invite a stale entry.
 */
const DISCOVERY_ROUTE_SEGMENTS: Partial<Record<keyof ApiRoutes, string>> = {
    data:          'data',
    metadata:      'meta',
    auth:          'auth',
    packages:      'packages',
    analytics:     'analytics',
    workflow:      'workflow',
    approvals:     'approvals',
    automation:    'automation',
    ai:            'ai',
    notifications: 'notifications',
    i18n:          'i18n',
    storage:       'storage',
    ui:            'ui',
};

/**
 * Hono Server Plugin
 *
 * Provides HTTP server capabilities using Hono framework.
 * Registers the IHttpServer service so other plugins can register routes.
 *
 * Route registration is handled by plugins:
 * - `@objectstack/rest` → CRUD, metadata, discovery, UI, batch
 * - `createDispatcherPlugin()` → auth, graphql, analytics, packages, etc.
 *
 * The current-user endpoints (`/auth/me/permissions`, `/auth/me/localization`,
 * `/me/apps`) are this plugin's own, and are the platform's only supply — see
 * `./current-user-endpoints`, which exports the registrar so a host serving a
 * bare {@link HonoHttpServer} instead of this plugin can supply them too.
 */
export class HonoServerPlugin implements Plugin {
    name = 'com.objectstack.server.hono';
    /**
     * Services init() registers on every path (ADR-0116, #4131) — lets the
     * kernel name this plugin when a consumer requires one before it inits.
     */
    providesServices = ['http.server', 'http-server'];
    type = 'server';
    version = '0.9.0';

    // No endpoint-priority constants: three of them (DEFAULT/CORE/DISCOVERY)
    // sat here unreferenced by anything in the repo, and `DISCOVERY_ENDPOINT_
    // PRIORITY = 900` in particular implied a priority mechanism that does not
    // exist — route precedence here is Hono's first-registration-wins, which is
    // exactly what the #4018 cede and the `kernel:ready` ordering above turn on.
    // Removed (#4073) so the file stops advertising a dead concept.

    private options: HonoPluginOptions;
    private server: HonoHttpServer;

    constructor(options: HonoPluginOptions = {}) {
        this.options = {
            port: 3000,
            // OFF by default (#4073): the convenience surface is deprecated
            // duplicate supply. See the option's JSDoc for the migration path.
            registerStandardEndpoints: false,
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
        // Per-request performance timing exposed via the `Server-Timing`
        // response header. Registered FIRST (before CORS) so the `total` mark
        // brackets the whole request and the ambient timing collector is
        // established — via AsyncLocalStorage — for every downstream layer
        // (CORS, route handler, body parse, SQL driver, hooks) to record
        // sub-phases into.
        //
        // Two ways to turn it on (see the `serverTiming` option JSDoc):
        //   • GLOBAL   — `serverTiming: true` / `OS_SERVER_TIMING=true` /
        //                `OS_PERF_TIMING=1`: the header is returned to EVERY
        //                caller. The disclosure gate opens up front.
        //   • PER-REQUEST — the caller sends `X-OS-Debug-Timing: 1`; the header
        //                is returned ONLY after the dispatcher resolves an
        //                admin/service identity and opens the gate, so an
        //                ordinary user can never fingerprint the backend by
        //                sending the header alone.
        // `serverTiming: false` hard-disables both paths (no middleware).
        if (this.options.serverTiming !== false) {
            const globalTiming =
                this.options.serverTiming === true ||
                process.env.OS_SERVER_TIMING === 'true' ||
                process.env.OS_PERF_TIMING === '1' ||
                process.env.OS_PERF_TIMING === 'true';
            const rawApp = this.server.getRawApp();
            rawApp.use('*', async (c, next) => {
                const mode = debugTimingMode(c.req.header('X-OS-Debug-Timing'));
                // Nothing asked for timing on this request — a single header
                // read, then straight through. Zero collector overhead.
                if (!globalTiming && mode === 'off') return next();

                const timing = new PerfTiming();
                // `json` opts into per-query DETAIL capture (parametrized SQL
                // shapes) — recorded now, disclosed later only to an admin.
                if (mode === 'json') timing.enableDetail();
                // Global mode opens the gate for everyone; the per-request path
                // starts closed and is opened only if an admin/service identity
                // is proven during dispatch (`allowPerfDisclosure`).
                const gate: PerfDisclosureGate = { allowed: globalTiming };
                const endTotal = timing.start('total', 'Total server time');
                await runWithPerfTiming(timing, () => runWithPerfDisclosure(gate, () => next()));
                endTotal();
                if (!gate.allowed) return; // per-request, unverified caller — withhold
                const header = timing.toHeader();
                // `append` (not `set`) so we coexist with any upstream proxy
                // that already added a Server-Timing entry.
                if (header) c.res.headers.append('Server-Timing', header);
                // Richer per-query detail is ADMIN-ONLY — even under global mode
                // an ordinary caller must never see SQL shapes. Emit only when the
                // principal was proven privileged (admin/service) AND detail was
                // requested/captured.
                if (gate.privileged && timing.detailEnabled) {
                    const detail = buildTimingDetail(timing);
                    // Guard the append: an exotic label the Fetch Headers API
                    // still rejects must never break the response.
                    if (detail) {
                        try {
                            c.res.headers.append('X-OS-Debug-Timing-Detail', detail);
                        } catch {
                            /* header rejected — skip the detail, keep the response */
                        }
                    }
                }
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
                // `x-objectstack-dropped-fields` (#3455): expose the single-write
                // drop header (#3431) to cross-origin JS. Kept in lockstep with the
                // `@objectstack/hono` adapter's default. The body `droppedFields`
                // channel remains the primary, cross-origin-safe surface.
                const defaultExposeHeaders = ['set-auth-token', 'x-objectstack-dropped-fields'];
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

        // Register endpoints during kernel:ready so they're wired up alongside
        // other plugins' route registrations.
        //
        // The current-user endpoints go first and are NOT gated (#4073): this
        // plugin is their only provider on any host that mounts it, so they must
        // not depend on a flag whose stated job is the optional CRUD/discovery
        // convenience surface. Registering them ahead of that block also keeps
        // their position in the `kernel:ready` order exactly where it was, which
        // matters: plugin-auth mounts a TERMINAL `rawApp.all('/api/v1/auth/*')`
        // from its own `kernel:ready` hook, and `/auth/me/*` only wins the match
        // by being registered first.
        //
        // The registrar lives in `./current-user-endpoints` and is exported, so a
        // host serving a bare `HonoHttpServer` instead of this plugin (cloud's
        // Vercel/serverless entrypoints) supplies the same three endpoints from
        // the same code (cloud#924). It is idempotent: a host that pre-registers
        // them on the raw app AND mounts this plugin gets one registration, the
        // host's — this call then no-ops rather than shadowing it.
        ctx.hook('kernel:ready', async () => {
            registerCurrentUserEndpoints({ rawApp: this.server.getRawApp(), ctx });
        });

        if (this.options.registerStandardEndpoints) {
            ctx.hook('kernel:ready', async () => {
                this.registerDiscoveryAndCrudEndpoints(ctx);
            });
        } else {
            // The default is OFF (#4073). For a composed host that is a no-op —
            // REST/the dispatcher answer these routes byte-identically either
            // way (#4260). The one composition it changes is a BARE host that
            // mounts none of the three: it used to inherit the convenience
            // surface implicitly and now gets 404s. Say so once at boot, with
            // the remedy — the same honesty rule as #4018's discovery cede:
            // absence must be loud, not something to diagnose from a silent
            // 404. Checked on kernel:ready so every `kernel.use()` has landed,
            // and quiet whenever a real API owner is mounted so transport-only
            // compositions are not nagged.
            ctx.hook('kernel:ready', async () => {
                const kernel = ctx.getKernel() as { hasPlugin?(name: string): boolean } | undefined;
                const hasPlugin = (name: string) =>
                    typeof kernel?.hasPlugin === 'function' && kernel.hasPlugin(name);
                if (!hasPlugin(REST_API_PLUGIN) && !hasPlugin(RUNTIME_DISPATCHER_PLUGIN)) {
                    ctx.logger.warn(
                        'No data/discovery API is mounted on this server: `registerStandardEndpoints` '
                        + 'defaults to false (#4073; the convenience surface is deprecated). Mount '
                        + '`createRestApiPlugin` from @objectstack/rest (full CRUD + gates) or the '
                        + 'runtime dispatcher — or pass `registerStandardEndpoints: true` to keep the '
                        + 'legacy surface during the deprecation window.',
                    );
                }
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
     * Discovery for this standalone convenience surface. Two rules, both ADR-0076:
     *
     * **1. Single owner (D11 / OQ#9).** `@objectstack/rest` and the runtime
     * dispatcher each serve a real, computed discovery; whichever is on the kernel
     * owns `${prefix}/discovery` and we do not register it. Hono is
     * first-registration-wins and both of those register during plugin `start()` —
     * i.e. before this `kernel:ready` hook — so they already shadowed this handler
     * in every composed deployment; ceding cannot change which payload a client
     * sees, it just stops us shipping a third one that nobody serves. (The
     * dispatcher cedes to REST on the same `hasPlugin` predicate, without probing
     * REST's `enableDiscovery`; matching it keeps the three surfaces consistent.)
     *
     * `/.well-known/objectstack` is ceded to the dispatcher ONLY — REST never
     * registers it, so in a REST-without-dispatcher composition this redirect is
     * the only thing pointing a `.well-known`-first client at `/discovery`.
     *
     * **2. Computed, never hardcoded (D12, #4018).** When we do own `/discovery`,
     * `routes` is derived from the routes actually registered on this Hono app.
     * The table used to be a hardcoded list of every ObjectStack domain —
     * `/analytics`, `/workflow`, `/ai`, … — advertised whether or not anything
     * mounted them, which is exactly the "advertise a route that 404s" class D12
     * exists to kill: a standalone host with no service plugins advertised the
     * whole platform while serving `/data` CRUD and two `/auth/me/*` helpers.
     * Both real discovery surfaces compute per service
     * (`hasXxx ? route : undefined`); this one computes per registration, which on
     * a bare host is the stricter and more honest question — service-registered
     * does not imply route-mounted here, because nothing bridges services to HTTP
     * on this surface (that bridging IS the dispatcher).
     */
    private registerDiscoveryEndpoints(ctx: PluginContext, rawApp: any, prefix: string) {
        const kernel = ctx.getKernel() as { hasPlugin?(name: string): boolean } | undefined;
        const hasPlugin = (name: string) =>
            typeof kernel?.hasPlugin === 'function' && kernel.hasPlugin(name);

        if (hasPlugin(RUNTIME_DISPATCHER_PLUGIN)) {
            ctx.logger.info(
                `/.well-known/objectstack ceded to ${RUNTIME_DISPATCHER_PLUGIN} (single owner)`,
            );
        } else {
            rawApp.get('/.well-known/objectstack', (c: any) => c.redirect(`${prefix}/discovery`));
        }

        const discoveryOwner =
            hasPlugin(REST_API_PLUGIN) ? REST_API_PLUGIN
            : hasPlugin(RUNTIME_DISPATCHER_PLUGIN) ? RUNTIME_DISPATCHER_PLUGIN
            : undefined;
        if (discoveryOwner) {
            ctx.logger.info(`${prefix}/discovery ceded to ${discoveryOwner} (single owner)`);
            return;
        }

        // Built per request, not here: sibling plugins keep registering routes
        // through the rest of `kernel:ready`, and the socket only opens on
        // `kernel:listening` — so by the time a request can arrive the route table
        // is final, while a table snapshotted now would miss every later mount.
        rawApp.get(`${prefix}/discovery`, (c: any) => c.json({ data: this.buildDiscovery(prefix) }));

        ctx.logger.info('Registered discovery endpoints', { prefix });
    }

    /** The discovery payload served when this surface owns `/discovery`. */
    private buildDiscovery(prefix: string) {
        return {
            version: 'v1',
            apiName: 'ObjectStack API',
            routes: this.advertisableRoutes(prefix),
            capabilities: {
                // This standalone Hono surface registers CRUD + auth only (see
                // `registerDiscoveryAndCrudEndpoints`) — it does NOT mount the
                // cross-object `/batch` route,
                // which ships with `@objectstack/rest`. `declared === enforced`
                // (#3298): report `transactionalBatch: false` so a client never
                // drops its non-atomic fallback against a backend that lacks the
                // endpoint. When `@objectstack/rest` is mounted it serves its own
                // discovery, which reports the real value from the runtime engine.
                transactionalBatch: { enabled: false },
            },
        };
    }

    /**
     * `ApiRoutes` computed from the live Hono route table: a family is advertised
     * iff some route is registered AT its base path or UNDER it.
     *
     * `app.routes` is every registration on this app — adapter routes, `getRawApp()`
     * routes (how plugin-auth mounts `${basePath}/*`), mounted sub-apps and `use()`
     * middleware alike — so this sees what a request will actually hit, not what a
     * parallel bookkeeping list believes. Requiring the base or a `/`-separated
     * child means a wildcard ABOVE the base (global `/*` middleware, `/api/v1/*`)
     * never counts as a mount, while `/api/v1/auth/*` and `/api/v1/data/:object`
     * both do — and `/api/v1/me/apps` does not pass for `metadata` (`/api/v1/meta`).
     */
    private advertisableRoutes(prefix: string): Partial<Record<keyof ApiRoutes, string>> {
        const app = this.server.getRawApp() as { routes?: Array<{ path?: string }> };
        const registered = Array.isArray(app?.routes) ? app.routes : [];
        const routes: Partial<Record<keyof ApiRoutes, string>> = {};
        for (const [key, segment] of Object.entries(DISCOVERY_ROUTE_SEGMENTS)) {
            const base = `${prefix}/${segment}`;
            const mounted = registered.some(
                (r) => typeof r?.path === 'string' && (r.path === base || r.path.startsWith(`${base}/`)),
            );
            if (mounted) routes[key as keyof ApiRoutes] = base;
        }
        return routes;
    }

    /**
     * Register discovery and basic CRUD endpoints.
     * Called when `registerStandardEndpoints` is true, before the server starts listening.
     */
    private registerDiscoveryAndCrudEndpoints(ctx: PluginContext) {
        const rawApp = this.server.getRawApp();
        const prefix = '/api/v1';

        this.registerDiscoveryEndpoints(ctx, rawApp, prefix);

        // ── Anonymous-deny gate (ADR-0056 D2, #2567) ──────────────────────────
        // These raw `/data/:object` routes delegate straight to ObjectQL. They
        // are only *shadowed* by the REST plugin's gated `/data` routes when
        // that plugin registers the same paths FIRST — so before this gate the
        // platform's anonymous posture depended on plugin registration order: a
        // load-order change silently reopened anonymous data access with no test
        // failing. Gating here makes the deny decision a property of THIS entry
        // point too, so security no longer depends on who registered first.
        //
        // [#3963] Anonymous access to object data is denied unconditionally —
        // the `requireAuth` opt-out is retired, so there is no posture to read
        // or warn about here. An authenticated / system caller always passes.
        // Returns a 401 Response when the caller is anonymous, else null
        // (caller proceeds). Delegates the decision to the
        // shared `shouldDenyAnonymous` (#2567) so every HTTP seam stays in
        // lockstep. `isSystem` is never set on inbound HTTP (internal-only), so
        // it cannot be forged to bypass this.
        const denyAnonymous = (c: any, execCtx: any): Response | null =>
            shouldDenyAnonymous({ userId: execCtx?.userId, isSystem: execCtx?.isSystem })
                ? c.json(ANONYMOUS_DENY_BODY, ANONYMOUS_DENY_STATUS)
                : null;

        // Basic CRUD data endpoints — delegate to ObjectQL service directly
        const getObjectQL = () => ctx.getService<IDataEngine>('objectql');

        // Session → ExecutionContext. Shared with the always-registered
        // current-user endpoints, which resolve the same principal.
        const resolveCtx = makeExecutionContextResolver(ctx);

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
