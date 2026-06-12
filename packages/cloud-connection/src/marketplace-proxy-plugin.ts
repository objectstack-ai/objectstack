// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * MarketplaceProxyPlugin
 *
 * Forwards `GET /api/v1/marketplace/*` from a tenant ObjectOS runtime to
 * the configured ObjectStack Cloud control-plane URL. The cloud endpoint
 * is unauthenticated and only exposes packages whose owner has opted in
 * to the public catalog (`sys_package.marketplace_listed = true`) — so the
 * proxy passes through without any credentials.
 *
 * Why proxy instead of direct browser → cloud:
 *   - The Console SPA stays on the tenant origin, so no CORS configuration
 *     is required on the cloud side.
 *   - Local-dev `os serve` works regardless of whether the developer's
 *     browser has cookies for cloud.objectos.ai.
 *   - Adds a single, easily auditable network seam between tenant and
 *     control plane.
 *
 * Install is NOT proxied here. Installing a package mutates control-plane
 * state and requires a cloud session + active organization context — the
 * Console SPA performs install by opening the cloud's install dialog in a
 * new tab so the user authenticates against cloud directly. A future
 * iteration may introduce a delegated install token; until then, browse
 * here and install on cloud.
 */

import type { Plugin, PluginContext } from '@objectstack/core';
import { resolveCloudUrl } from './cloud-url.js';
import { MARKETPLACE_BROWSE_UI_BUNDLE } from './marketplace-ui.js';
import {
    resolveMarketplacePublicBaseUrl,
    publicMarketplaceKeyForApiPath,
} from './marketplace-public-url.js';

const MARKETPLACE_PREFIX = '/api/v1/marketplace';

/**
 * In-memory cache for GET/HEAD marketplace responses.
 *
 * Marketplace data changes infrequently (new package versions are
 * audited & published in ~hours, not seconds), so we cache aggressively
 * with conditional revalidation:
 *
 *   - listing/search     →  30 min hard TTL
 *   - package detail     →   2 h
 *   - version detail /
 *     readme / assets    →  24 h  (versions are immutable once published)
 *
 * After TTL expiry the next request issues an `If-None-Match` /
 * `If-Modified-Since` and, on `304 Not Modified`, simply refreshes the
 * TTL without re-downloading the body.
 *
 * Bypass conditions (always re-fetch, no cache write):
 *   - `OS_MARKETPLACE_CACHE=off`
 *   - Request header `Cache-Control: no-cache` (the Console SPA's
 *     "Refresh" button sets this)
 *   - Non-2xx upstream responses (avoid pinning transient errors)
 *
 * Every response carries `X-Cache: HIT|REVALIDATED|MISS|BYPASS` to make
 * the layer observable in browser devtools.
 */
const DEFAULT_LRU_MAX = 200;
const LIST_TTL_MS = 30 * 60 * 1000;          // 30 min
const PACKAGE_TTL_MS = 2 * 60 * 60 * 1000;   // 2 h
const VERSION_TTL_MS = 24 * 60 * 60 * 1000;  // 24 h

interface CacheEntry {
    status: number;
    body: ArrayBuffer;
    headers: Record<string, string>;
    etag?: string;
    lastModified?: string;
    expiresAt: number;
    ttlMs: number;
}

function ttlForPath(pathname: string): number {
    // `/api/v1/marketplace/packages/:id/versions/:v(.../...)?` → 24h
    if (/\/packages\/[^/]+\/versions\//.test(pathname)) return VERSION_TTL_MS;
    // `/api/v1/marketplace/packages/:id(/readme)?` → 2h
    if (/\/packages\/[^/]+/.test(pathname)) return PACKAGE_TTL_MS;
    // Listings, search, categories, anything else → 30 min
    return LIST_TTL_MS;
}

class LruTtlCache {
    private readonly map = new Map<string, CacheEntry>();
    constructor(private readonly max: number) {}

    get(key: string): CacheEntry | undefined {
        const entry = this.map.get(key);
        if (!entry) return undefined;
        // LRU touch: re-insert to move to end.
        this.map.delete(key);
        this.map.set(key, entry);
        return entry;
    }

    set(key: string, entry: CacheEntry): void {
        if (this.map.has(key)) this.map.delete(key);
        this.map.set(key, entry);
        while (this.map.size > this.max) {
            const oldest = this.map.keys().next().value;
            if (oldest === undefined) break;
            this.map.delete(oldest);
        }
    }

    clear(): void {
        this.map.clear();
    }
}

export interface MarketplaceProxyPluginConfig {
    /**
     * Control-plane base URL (e.g. https://cloud.objectos.ai). When the
     * caller passes nothing AND the runtime has no OS_CLOUD_URL set, the
     * plugin falls back to the public ObjectStack-operated cloud so that
     * `objectstack dev` can browse the marketplace out of the box. Set
     * OS_CLOUD_URL=off (or `local`) to opt out — the plugin then mounts
     * a stub that responds 503 and the SPA renders an empty-state
     * explaining marketplace is unavailable in this runtime.
     */
    controlPlaneUrl?: string;

    /**
     * Disable the in-memory response cache (testing / debugging).
     * Defaults to the value of `OS_MARKETPLACE_CACHE` (anything in
     * {"off","false","0","no"} disables).
     */
    cacheDisabled?: boolean;

    /**
     * Override the LRU upper bound. Defaults to 200 entries.
     */
    cacheMaxEntries?: number;
    /**
     * Public R2 base URL for marketplace snapshots. When set, GETs for
     * snapshot-backed paths (`/packages`, `/packages/:id`,
     * `/packages/:id/versions/:vid/manifest`) are fetched directly from
     * R2 (CF edge) — bypassing the cloud control plane entirely.
     * Defaults to the value of OS_MARKETPLACE_PUBLIC_BASE_URL. Empty
     * string disables the public fast-path (legacy cloud-proxy only).
     */
    publicMarketplaceBaseUrl?: string;
}

export class MarketplaceProxyPlugin implements Plugin {
    readonly name = 'com.objectstack.runtime.marketplace-proxy';
    readonly version = '1.1.0';

    private readonly cloudUrl: string;
    private readonly publicBaseUrl: string;
    private readonly cache: LruTtlCache | null;

    constructor(config: MarketplaceProxyPluginConfig = {}) {
        this.cloudUrl = resolveCloudUrl(config.controlPlaneUrl);
        this.publicBaseUrl = resolveMarketplacePublicBaseUrl(config.publicMarketplaceBaseUrl);

        const envFlag = (process.env.OS_MARKETPLACE_CACHE ?? '').trim().toLowerCase();
        const envDisabled = ['off', 'false', '0', 'no', 'disable', 'disabled'].includes(envFlag);
        const disabled = config.cacheDisabled ?? envDisabled;
        this.cache = disabled
            ? null
            : new LruTtlCache(Math.max(8, config.cacheMaxEntries ?? DEFAULT_LRU_MAX));
    }

    init = async (_ctx: PluginContext): Promise<void> => {
        // No services registered — pure HTTP wiring during start().
    };

    start = async (ctx: PluginContext): Promise<void> => {
        ctx.hook('kernel:ready', async () => {
            // Plugin-owned Setup nav (cloud ADR-0009): the "Browse
            // Marketplace" entry ships WITH the browse capability — no
            // proxy mounted, no entry. Best-effort: headless kernels
            // simply have no Setup surface.
            try {
                const manifest = ctx.getService<{ register(m: any): void }>('manifest');
                manifest?.register?.(MARKETPLACE_BROWSE_UI_BUNDLE);
            } catch { /* no manifest service */ }

            let httpServer: any;
            try {
                httpServer = ctx.getService('http-server');
            } catch {
                ctx.logger?.warn?.('[MarketplaceProxyPlugin] http-server not available — marketplace routes not mounted');
                return;
            }
            if (!httpServer || typeof httpServer.getRawApp !== 'function') {
                ctx.logger?.warn?.('[MarketplaceProxyPlugin] http-server missing getRawApp() — marketplace routes not mounted');
                return;
            }

            const rawApp = httpServer.getRawApp();
            const cloudUrl = this.cloudUrl;
            const publicBaseUrl = this.publicBaseUrl;
            const cache = this.cache;

            if (publicBaseUrl) {
                ctx.logger?.info?.(`[MarketplaceProxyPlugin] public R2 fast-path enabled → ${publicBaseUrl}`);
            }

            const handler = async (c: any, next: any) => {
                if (!cloudUrl) {
                    return c.json({
                        success: false,
                        error: {
                            code: 'marketplace_unavailable',
                            message: 'No control-plane URL configured for this runtime (OS_CLOUD_URL).',
                        },
                    }, 503);
                }
                try {
                    const incomingUrl = new URL(c.req.url);
                    // Do NOT proxy install-local — those are owned by
                    // MarketplaceInstallLocalPlugin and must hit this
                    // runtime, never cloud. Pass through so Hono can match
                    // the install-local route registered on the same app.
                    if (incomingUrl.pathname.startsWith(`${MARKETPLACE_PREFIX}/install-local`)) {
                        return next();
                    }

                    const method = String(c.req.method ?? 'GET').toUpperCase();

                    // ── Public R2 fast-path ─────────────────────────
                    // When OS_MARKETPLACE_PUBLIC_BASE_URL is configured,
                    // GETs for snapshot-backed paths fetch directly from
                    // R2 → CF edge cache. This skips the cloud control
                    // plane entirely so marketplace browse + install
                    // work even when cloud is asleep or completely down.
                    if (publicBaseUrl && (method === 'GET' || method === 'HEAD')) {
                        const r2Resp = await tryPublicMarketplaceFetch(
                            publicBaseUrl, incomingUrl, method, c.req.header('accept'),
                            ctx.logger,
                        );
                        if (r2Resp) return r2Resp;
                        // Fall through on miss / error to the cloud path.
                    }

                    // Preserve the full /api/v1/marketplace/... path on cloud.
                    const target = `${cloudUrl}${incomingUrl.pathname}${incomingUrl.search}`;

                    // Browse-only mechanism: this plugin forwards only safe,
                    // idempotent GET/HEAD (it carries no credentialled cloud
                    // auth). It does NOT own install *policy* — that is a host
                    // concern (ObjectStack Cloud supplies a credentialled
                    // install route via the `extraPlugins` seam; see ADR
                    // docs/design/cloud-account-binding-marketplace-install.md
                    // §5.2). So instead of dead-ending non-GET with a 405
                    // "install via cloud", we PASS THROUGH: a host-supplied
                    // handler mounted after this plugin can claim the request;
                    // if none does, the app returns its normal 404. This
                    // removes the browse-only install dead-end (framework#1548)
                    // without this plugin pretending to know install policy.
                    if (method !== 'GET' && method !== 'HEAD') {
                        return next();
                    }

                    // Cache lookup. Key includes accept-language because
                    // cloud may serve locale-specific copy in the future;
                    // HEAD shares the cache slot with GET (we just elide the
                    // body in the response).
                    const accept = c.req.header('accept') ?? 'application/json';
                    const acceptLang = c.req.header('accept-language') ?? '';
                    const cacheKey = `${incomingUrl.pathname}${incomingUrl.search}|al=${acceptLang}|a=${accept}`;
                    const reqCacheCtl = (c.req.header('cache-control') ?? '').toLowerCase();
                    const bypass = !cache || reqCacheCtl.includes('no-cache') || reqCacheCtl.includes('no-store');
                    const now = Date.now();

                    if (cache && !bypass) {
                        const hit = cache.get(cacheKey);
                        if (hit && hit.expiresAt > now) {
                            return buildCachedResponse(hit, method, 'HIT');
                        }
                        if (hit) {
                            // TTL expired — try conditional revalidate so we
                            // don't pay for the body when nothing changed.
                            const revalHeaders: Record<string, string> = {
                                'Accept': accept,
                                'User-Agent': `objectos-marketplace-proxy/${MarketplaceProxyPlugin.prototype.version ?? '1.0.0'}`,
                            };
                            if (acceptLang) revalHeaders['Accept-Language'] = acceptLang;
                            if (hit.etag) revalHeaders['If-None-Match'] = hit.etag;
                            if (hit.lastModified) revalHeaders['If-Modified-Since'] = hit.lastModified;
                            const revalResp = await fetch(target, { method: 'GET', headers: revalHeaders });
                            if (revalResp.status === 304) {
                                hit.expiresAt = now + hit.ttlMs;
                                // Refresh ETag/Last-Modified if the upstream
                                // re-issued them on the 304 (per RFC 7232 §4.1).
                                const newEtag = revalResp.headers.get('etag');
                                const newLm = revalResp.headers.get('last-modified');
                                if (newEtag) hit.etag = newEtag;
                                if (newLm) hit.lastModified = newLm;
                                cache.set(cacheKey, hit);
                                return buildCachedResponse(hit, method, 'REVALIDATED');
                            }
                            // 200 (or anything else): fall through to the
                            // normal fetch+store path below, using the
                            // revalidation response we already have in hand.
                            return await consumeAndMaybeCache(revalResp, cacheKey, incomingUrl.pathname, method, cache);
                        }
                    }

                    // MISS (or BYPASS): origin fetch.
                    const reqHeaders: Record<string, string> = {
                        // Strip the inbound Host header — fetch will set
                        // it to the cloud host. Forward only the
                        // identifying headers cloud might log.
                        'Accept': accept,
                        'User-Agent': `objectos-marketplace-proxy/${MarketplaceProxyPlugin.prototype.version ?? '1.0.0'}`,
                    };
                    if (acceptLang) reqHeaders['Accept-Language'] = acceptLang;
                    const resp = await fetch(target, { method: 'GET', headers: reqHeaders });

                    if (bypass || !cache) {
                        // Don't write to cache; just stream back.
                        return await passthroughResponse(resp, method, bypass ? 'BYPASS' : 'MISS');
                    }
                    return await consumeAndMaybeCache(resp, cacheKey, incomingUrl.pathname, method, cache);
                } catch (err: any) {
                    const errObj = err instanceof Error ? err : new Error(err?.message ?? String(err));
                    ctx.logger?.error?.('[MarketplaceProxyPlugin] proxy failed', errObj);
                    return c.json({
                        success: false,
                        error: {
                            code: 'marketplace_proxy_failed',
                            message: err?.message ?? String(err),
                        },
                    }, 502);
                }
            };

            if (typeof rawApp.all === 'function') {
                rawApp.all(`${MARKETPLACE_PREFIX}/*`, handler);
            } else {
                for (const m of ['get', 'head'] as const) {
                    try { rawApp[m]?.(`${MARKETPLACE_PREFIX}/*`, handler); } catch { /* best effort */ }
                }
            }

            ctx.logger?.info?.(`[MarketplaceProxyPlugin] mounted at ${MARKETPLACE_PREFIX}/* → ${cloudUrl || '(unconfigured)'} (cache=${this.cache ? 'on' : 'off'})`);
        });
    };
}

// ---------------------------------------------------------------------------
// Public R2 fast-path (module-private)
// ---------------------------------------------------------------------------

/**
 * Fetch a marketplace API path from the public R2 base URL and return
 * the response shaped exactly like the cloud API endpoint would. The
 * snapshots are already in `{ success: true, data: ... }` shape so for
 * direct lookups we stream bytes verbatim. The list endpoint applies
 * query-string filters (q / category / limit / offset) client-side
 * from the full snapshot.
 *
 * Returns `null` for any of:
 *   - path is not snapshot-backed (e.g. featured / categories / etc.)
 *   - R2 returned 404 (snapshot not yet generated for this id)
 *   - network error fetching from R2
 *
 * On `null`, the caller falls back to the cloud proxy path.
 */
async function tryPublicMarketplaceFetch(
    publicBaseUrl: string,
    incomingUrl: URL,
    method: string,
    acceptHeader: string | undefined,
    logger: any,
): Promise<Response | null> {
    const key = publicMarketplaceKeyForApiPath(incomingUrl.pathname);
    if (!key) return null;

    const target = `${publicBaseUrl}/${key}`;
    let resp: Response;
    try {
        resp = await fetch(target, {
            method: 'GET',
            headers: {
                'Accept': acceptHeader || 'application/json',
                'User-Agent': `objectos-marketplace-proxy/public-r2`,
            },
        });
    } catch (err: any) {
        logger?.warn?.(`[MarketplaceProxyPlugin] public R2 fetch failed (${target}): ${err?.message ?? err}`);
        return null;
    }
    if (resp.status === 404) return null;
    if (!resp.ok) {
        logger?.warn?.(`[MarketplaceProxyPlugin] public R2 ${target} returned ${resp.status} — falling back to cloud`);
        return null;
    }

    // List endpoint: apply optional q/category/limit/offset filters on
    // the full snapshot. Detail + manifest snapshots stream verbatim.
    const isList = key === 'packages.json';
    const hasFilters = isList && (
        incomingUrl.searchParams.has('q') ||
        incomingUrl.searchParams.has('category') ||
        incomingUrl.searchParams.has('limit') ||
        incomingUrl.searchParams.has('offset')
    );

    if (!hasFilters) {
        // Verbatim passthrough — preserve cache headers from R2 / CF.
        const headers = new Headers();
        const ct = resp.headers.get('content-type') ?? 'application/json; charset=utf-8';
        headers.set('content-type', ct);
        const cc = resp.headers.get('cache-control');
        if (cc) headers.set('cache-control', cc);
        const etag = resp.headers.get('etag');
        if (etag) headers.set('etag', etag);
        headers.set('x-cache', 'PUBLIC-R2');
        const body = method === 'HEAD' ? null : resp.body;
        return new Response(body, { status: 200, headers });
    }

    // Filtered list — parse, filter, re-serialize.
    let snapshot: any;
    try { snapshot = await resp.json(); }
    catch (err: any) {
        logger?.warn?.(`[MarketplaceProxyPlugin] public R2 list snapshot parse failed: ${err?.message ?? err}`);
        return null;
    }
    const items: any[] = Array.isArray(snapshot?.data?.items) ? snapshot.data.items : [];

    const q = (incomingUrl.searchParams.get('q') ?? '').trim().toLowerCase();
    const category = (incomingUrl.searchParams.get('category') ?? '').trim();
    const limit = Math.min(Math.max(Number(incomingUrl.searchParams.get('limit') ?? 50), 1), 100);
    const offset = Math.max(Number(incomingUrl.searchParams.get('offset') ?? 0), 0);

    let filtered = items;
    if (q) {
        filtered = filtered.filter((r) => {
            const dn = String(r?.display_name ?? '').toLowerCase();
            const mid = String(r?.manifest_id ?? '').toLowerCase();
            return dn.includes(q) || mid.includes(q);
        });
    }
    if (category) {
        filtered = filtered.filter((r) => String(r?.category ?? '') === category);
    }
    const total = filtered.length;
    const page = filtered.slice(offset, offset + limit);
    const body = JSON.stringify({ success: true, data: { items: page, total, limit, offset } });

    const headers = new Headers({
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'public, max-age=30',
        'x-cache': 'PUBLIC-R2-FILTERED',
    });
    return new Response(method === 'HEAD' ? null : body, { status: 200, headers });
}

// ---------------------------------------------------------------------------
// Cache helpers (module-private)
// ---------------------------------------------------------------------------

const PASSTHROUGH_HEADERS = ['content-type', 'cache-control', 'etag', 'last-modified', 'vary'] as const;

function collectHeaders(src: Response): Record<string, string> {
    const out: Record<string, string> = {};
    for (const h of PASSTHROUGH_HEADERS) {
        const v = src.headers.get(h);
        if (v) out[h] = v;
    }
    return out;
}

function buildCachedResponse(entry: CacheEntry, method: string, xCache: 'HIT' | 'REVALIDATED'): Response {
    const headers = new Headers(entry.headers);
    headers.set('X-Cache', xCache);
    // Surface remaining freshness so downstream HTTP caches / devtools
    // can reason about it (clamped at 0).
    const ageSec = Math.max(0, Math.floor((entry.expiresAt - entry.ttlMs - Date.now()) / -1000));
    headers.set('Age', String(Math.max(0, ageSec)));
    const body = method === 'HEAD' ? null : entry.body;
    return new Response(body, { status: entry.status, headers });
}

async function passthroughResponse(resp: Response, method: string, xCache: 'MISS' | 'BYPASS'): Promise<Response> {
    const headers = new Headers(collectHeaders(resp));
    headers.set('X-Cache', xCache);
    if (method === 'HEAD') {
        // Drain to release the connection.
        try { await resp.arrayBuffer(); } catch { /* ignore */ }
        return new Response(null, { status: resp.status, headers });
    }
    const body = await resp.arrayBuffer();
    return new Response(body, { status: resp.status, headers });
}

async function consumeAndMaybeCache(
    resp: Response,
    key: string,
    pathname: string,
    method: string,
    cache: LruTtlCache,
): Promise<Response> {
    const body = await resp.arrayBuffer();
    const headers = collectHeaders(resp);
    // Only cache success responses — pinning a 404 / 5xx would just
    // amplify a transient failure.
    if (resp.status >= 200 && resp.status < 300) {
        const ttlMs = ttlForPath(pathname);
        const entry: CacheEntry = {
            status: resp.status,
            body,
            headers,
            etag: resp.headers.get('etag') ?? undefined,
            lastModified: resp.headers.get('last-modified') ?? undefined,
            expiresAt: Date.now() + ttlMs,
            ttlMs,
        };
        cache.set(key, entry);
    }
    const respHeaders = new Headers(headers);
    respHeaders.set('X-Cache', 'MISS');
    const outBody = method === 'HEAD' ? null : body;
    return new Response(outBody, { status: resp.status, headers: respHeaders });
}
