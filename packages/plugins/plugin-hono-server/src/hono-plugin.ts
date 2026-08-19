// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { Plugin, PluginContext } from '@objectstack/core';
import { RestServerConfig } from '@objectstack/spec/api';
import { registerCurrentUserEndpoints } from './current-user-endpoints';
import {
    HonoHttpServer,
    HonoCorsOptions,
    DEFAULT_CORS_ALLOW_HEADERS,
    DEFAULT_CORS_EXPOSE_HEADERS,
} from './adapter';
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
    OBSERVABILITY_METRICS_SERVICE,
    type PerfDisclosureGate,
    type MetricsRegistry,
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
    // `useApiRegistry` REMOVED in #4939. It advertised "load endpoints from
    // API Registry" and was defaulted to `true` in the constructor, but no
    // code path ever read it — and the `api-registry` service it named was
    // itself composed only in `packages/core/examples/`, so there were never
    // endpoints to load. The ApiRegistry family is retired; the option went
    // with it rather than outliving the thing it configured.

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

    /**
     * Observability backends for the transport's own signals.
     *
     * `metrics` receives `http_requests_total{method,route,status}` for every
     * inbound request on this server — see
     * {@link HonoHttpServer.installHttpMetricsSeam} for why the counter is
     * emitted at the transport rather than one layer up (#9650).
     *
     * Resolution chain, the canonical one (`ObservabilityServicePlugin`):
     *
     *   1. this option — explicit wiring, and the escape hatch tests use;
     *   2. the `observability:metrics` service, when the host registered one
     *      BEFORE this plugin;
     *   3. neither — then **no middleware is installed at all**, so an
     *      unconfigured deployment pays no per-request cost. Not a disabled
     *      counter; no counter.
     */
    observability?: {
        metrics?: MetricsRegistry;
    };
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
 * The two plugins that own the data + discovery APIs (ADR-0076 D11 / OQ#9).
 * `@objectstack/rest` serves `metadata-protocol`'s registry-driven
 * `getDiscovery()` and full `/data` CRUD; the runtime dispatcher serves
 * `HttpDispatcher.getDiscoveryInfo()` and the service routes.
 *
 * This plugin serves neither (#4073) — it is a transport adapter. These names
 * exist only so a boot that mounts NO owner can say so out loud instead of
 * leaving callers to diagnose a bare 404.
 */
const REST_API_PLUGIN = 'com.objectstack.rest.api';
const RUNTIME_DISPATCHER_PLUGIN = 'com.objectstack.runtime.dispatcher';

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
        // Hand the adapter the host's logger BEFORE the server is reachable as
        // a service — that is the earliest point `ctx` exists (the adapter is
        // constructed in this plugin's constructor, which has no context), and
        // it is what routes an escaped handler throw into the host's log
        // pipeline instead of the adapter's own default (#5848).
        this.server.setLogger(ctx.logger);

        ctx.logger.debug('Initializing Hono server plugin', {
            port: this.options.port,
            staticRoot: this.options.staticRoot
        });

        // Register HTTP server service as IHttpServer — `http.server` is the
        // CANONICAL name (the ledger entry in `@objectstack/spec/contracts`
        // documents it; runtime's `config.server` path registers only this one).
        ctx.registerService('http.server', this.server);
        // DEPRECATED alias (#4251): same instance, second name. Kept while
        // alias readers migrate; dropped at a release boundary — new code must
        // read `http.server`.
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
                // Both defaults come from `adapter.ts` (#3786). They used to be
                // spelled out here AND in the `@objectstack/hono` adapter, each
                // under a "keep in sync" comment; the per-entry rationale now
                // lives on the constants themselves.
                const allowHeaders = corsOpts.allowHeaders ?? [...DEFAULT_CORS_ALLOW_HEADERS];
                const exposeHeaders = Array.from(new Set([
                    ...DEFAULT_CORS_EXPOSE_HEADERS,
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

        // ─── IHttpServer middleware seam ──────────────────────────────────────
        // Mounted LAST in init(), and that position is the whole point (#4910).
        //
        // After the built-ins above, so a middleware that short-circuits (the
        // inbound rate limiter's 429) still gets CORS headers applied — a
        // browser shown a header-less 429 reports an opaque network error and
        // the operator debugs the wrong thing.
        //
        // Before any route, because every route on this server is mounted in
        // some plugin's `start()` (Phase 2) and Phase 1 completes first. Hono
        // composes matched handlers in registration order, so this is the last
        // moment at which a gate can still precede all of them — and placing it
        // here means a consumer's `use()` no longer has to win a race with route
        // registration. It can register whenever it has the facts.

        // ─── `http_requests_total` seam (#9650) ───────────────────────────────
        // Mounted immediately BEFORE the middleware seam, and that order is
        // load-bearing in both directions:
        //
        //  - before it, so a request the `use()` chain short-circuits (the
        //    dispatcher's inbound rate limiter answering 429) is still counted.
        //    A refused request is precisely the one an operator alerts on;
        //    counting only what got through would rebuild, one layer in, the
        //    blind spot this seam exists to close.
        //  - still at the END of `init()`, i.e. before any route exists, since
        //    every route in the platform is mounted in some plugin's `start()`
        //    and Hono composes the handlers that MATCHED in registration
        //    order. A middleware Hono learns about after a route runs after
        //    that route's handler — which is why installing this from a later
        //    phase (or from `kernel:bootstrapped`) observes nothing at all.
        const metrics = this.resolveMetrics(ctx);
        if (metrics) {
            this.server.installHttpMetricsSeam(metrics);
            ctx.logger.debug('HTTP request counter armed', {
                metric: 'http_requests_total',
                labels: 'method, route (pattern), status',
            });
        }

        this.server.installMiddlewareSeam();
    }

    /**
     * The canonical metrics-resolution chain, as documented on
     * `ObservabilityServicePlugin`: explicit option, then the
     * `observability:metrics` service, then nothing.
     *
     * Returns `undefined` rather than a no-op registry so the caller can skip
     * installing the middleware entirely when no backend is configured.
     */
    private resolveMetrics(ctx: PluginContext): MetricsRegistry | undefined {
        const explicit = this.options.observability?.metrics;
        if (explicit) return explicit;
        try {
            const fromService = ctx.getService<MetricsRegistry | undefined>(
                OBSERVABILITY_METRICS_SERVICE,
            );
            if (fromService) return fromService;
        } catch {
            // No host registry registered — the counter is simply absent.
        }
        return undefined;
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

        // ─── Unmatched-request seam ───────────────────────────────────────────
        // Catch-all: ensure unmatched requests always get a proper Response
        // (prevents Hono "Context is not finalized" error), and answer a method
        // mismatch with 405 + `Allow` rather than an opaque 404 (#2684).
        //
        // The answer itself now lives in `HonoHttpServer.unmatchedResponse` and
        // this call only MOUNTS the hook (#5090). It moved because `notFound` is
        // last-call-wins and gained a second writer: `setFallbackHandler` — the
        // `IHttpServer` seam the declarative-endpoint dispatcher installs — maps
        // onto the same hook. Two writers of one hook would have meant the
        // survivor was decided by plugin start order, silently costing whichever
        // lost. One hook, one owner: the adapter composes fallback-then-standard
        // answer inside it, so this call and any `setFallbackHandler()` are
        // order-independent.
        this.server.installNotFoundSeam();

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

        // This plugin is a TRANSPORT ADAPTER: it owns the socket, the middleware
        // and the three current-user endpoints above, and nothing else. The data
        // and discovery APIs belong to `@objectstack/rest` and the runtime
        // dispatcher — one owner per route (ADR-0076 D11). The convenience
        // surface that used to duplicate them here is gone (#4073).
        //
        // A host that mounts neither owner therefore has NO data or discovery
        // API. That is a real composition (a bare transport host), and its
        // failure mode without this warning is a bare 404 with nothing pointing
        // at the cause. Absence must be loud — the same honesty rule #4018
        // applied to the discovery cede. Checked on `kernel:ready` so every
        // `kernel.use()` has landed, and silent whenever an owner IS mounted so
        // transport-only compositions are not nagged.
        ctx.hook('kernel:ready', async () => {
            const kernel = ctx.getKernel() as { hasPlugin?(name: string): boolean } | undefined;
            const hasPlugin = (name: string) =>
                typeof kernel?.hasPlugin === 'function' && kernel.hasPlugin(name);
            if (!hasPlugin(REST_API_PLUGIN) && !hasPlugin(RUNTIME_DISPATCHER_PLUGIN)) {
                ctx.logger.warn(
                    'No data or discovery API is mounted on this server. HonoServerPlugin is a '
                    + 'transport adapter and serves neither (#4073). Mount `createRestApiPlugin` '
                    + 'from @objectstack/rest for full CRUD behind the gate stack, or '
                    + '`createDispatcherPlugin` from @objectstack/runtime.',
                );
            }
        });

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
     * Destroy phase - Stop server
     */
    async destroy() {
        this.server.close();
        // Note: Can't use ctx.logger here since we're in destroy
        console.log('[HonoServerPlugin] Server stopped');
    }
}
