// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * RuntimeConfigPlugin
 *
 * Serves `GET /api/v1/runtime/config` (and the legacy alias
 * `GET /api/v1/studio/runtime-config`) so the Console / Studio SPA can learn
 * the upstream cloud URL and capability flags **at boot time**, instead of
 * sniffing `window.location.hostname` or reading Vite-time env vars.
 *
 * Response shape:
 *
 *   {
 *     cloudUrl: string,            // base URL of the upstream cloud ('' = same origin)
 *     singleEnvironment: boolean,
 *     defaultOrgId?, defaultEnvironmentId?,   // multi-tenant, per-hostname
 *     features: { installLocal, marketplace, aiStudio, autoPublishAiBuilds, ... },
 *     branding: { productName, productShortName, logoUrl, faviconUrl, brandColor, pwaDescription, pwaThemeColor }
 *   }
 *
 * ## Feature seam (open-core boundary — cloud ADR-0012)
 *
 * This open package owns the **mechanism**: serve a per-request `features`
 * map to the SPA. It does NOT own the **catalog or policy** — which feature
 * keys exist and which billing plan unlocks them is a distribution concern
 * and must never be enumerated here (that would bleed commercial/pricing
 * policy into the open framework).
 *
 * Hosts inject policy via {@link RuntimeConfigPluginConfig.resolveFeatures}: it
 * receives an opaque environment token (the cloud distribution passes the plan
 * string) and returns an **open-ended** map of feature flags that is merged
 * verbatim into `features`. The framework neither names nor knows those keys —
 * e.g. the cloud distribution returns `customDomain` / `sso` from its plan
 * entitlements without any framework change. A self-hosted / vanilla
 * deployment omits the hook and gets static, config-driven flags.
 *
 * `aiStudio` / `autoPublishAiBuilds` are the framework's own non-commercial
 * mechanism defaults (ADR-0005: AI authoring is an all-plan capability gated
 * by cost, not a paid tier), so they keep first-class config knobs here.
 *
 * ## `features.marketplace` is DERIVED, not declared (#8356)
 *
 * It used to be the literal `true`, so every runtime mounting this plugin told
 * the Console the catalog was browsable — including one where
 * `MarketplaceProxyPlugin` was never mounted because no control plane
 * resolved. The affordance rendered; the runtime could not serve it. That is
 * the same declared-is-not-enforced shape as #8343, one key over, and it is
 * why #8343 mounts install-local ALONE on a cloud-less runtime rather than
 * also mounting this plugin: reporting install-local truthfully would have
 * cost a false browse claim.
 *
 * The flag is now read off what is really mounted — see
 * {@link hasMarketplaceBrowseMount} for the seam and why it is that one. A
 * config knob was rejected on the record (#8343 ACCEPT, 2026-08-13): it
 * repeats one layer up the every-host-must-remember failure that propagated
 * the original defect into the EE image, where both the host config and this
 * package's README kept a hand-maintained flag out of step with their own
 * mounting.
 */

import type { Plugin, PluginContext } from '@objectstack/core';
import { resolveCloudUrl } from './cloud-url.js';
import type { IHttpServer } from '@objectstack/spec/contracts';

/**
 * The `env-registry` slot's hostname resolvers — see the call site for both
 * spellings. Async by contract: the consumer awaits the result, and declaring
 * it `unknown` would only have moved the erasure one line down.
 */
interface EnvRegistrySurface {
    resolveByHostname?(hostname: string): Promise<any>;
    resolveHostname?(hostname: string): Promise<any>;
}

/**
 * The marketplace HTTP namespace, and the one sub-path inside it that is NOT
 * a browse surface.
 *
 * These literals are deliberately NOT imported from `marketplace-proxy-plugin`
 * — the derivation must also see a browse surface this package never mounted
 * (see {@link hasMarketplaceBrowseMount}), so keying it on the proxy module
 * would narrow it back to one provider. The coupling to the proxy's own
 * spelling is instead pinned by test: the positive direction mounts the REAL
 * `MarketplaceProxyPlugin` onto the same app rather than hand-spelling its
 * route, so a change to its prefix fails here rather than silently flipping
 * this flag to `false`.
 */
const MARKETPLACE_API_PREFIX = '/api/v1/marketplace';
const MARKETPLACE_INSTALL_LOCAL_PREFIX = `${MARKETPLACE_API_PREFIX}/install-local`;

/**
 * Does this registered route pattern mount a marketplace BROWSE surface?
 *
 * `/api/v1/marketplace/install-local` is excluded on purpose. It is the
 * offline install half, mounted precisely on the runtimes that have no
 * catalog, and counting it as browse would recreate this bug's mirror image:
 * #8343's cloud-less deployment reporting a capability whose route 404s.
 * Patterns outside the namespace (`/api/v1/*` middleware, an SPA `/*`
 * catch-all) are not evidence of anything and never match.
 */
function isMarketplaceBrowsePattern(pattern: string): boolean {
    if (pattern.startsWith(MARKETPLACE_INSTALL_LOCAL_PREFIX)) return false;
    if (!pattern.startsWith(MARKETPLACE_API_PREFIX)) return false;
    // `/api/v1/marketplaceish/...` is somebody else's namespace.
    const rest = pattern.slice(MARKETPLACE_API_PREFIX.length);
    return rest === '' || rest.startsWith('/');
}

/**
 * Is a marketplace browse surface actually mounted on the app serving this
 * response? (#8356)
 *
 * ## Why the raw app's route table, and not any of the alternatives
 *
 * Measured on `main`, not assumed — the card proposed reading a kernel
 * registration and there is none:
 *
 *  - **`MarketplaceProxyPlugin` registers no service.** Its `init` says so in
 *    as many words ("No services registered — pure HTTP wiring during
 *    `start()`"); it announces itself only by mounting
 *    `${MARKETPLACE_API_PREFIX}/*` on the raw app. So there is nothing on the
 *    kernel to look up, and adding a registration purely to read it back
 *    would be a mechanism invented for its own observation rather than a fix.
 *  - **`IHttpServer.getMountedRoutes()` / `resolveMountedRoute()` cannot see
 *    it.** Both are scoped to routes registered through the adapter's own
 *    verb methods — "routes an adapter mounts on its framework-native handle
 *    behind `getRawApp` are outside this table by construction" (the contract's
 *    own words, `packages/spec/src/contracts/http-server.ts`), and
 *    `resolveMountedRoute` filters the live router's verdict back through that
 *    same ledger. The proxy mounts through `getRawApp()`, so the adapter
 *    ledger reports nothing for it.
 *  - **A proxy-specific signal would under-report.** The ObjectStack Cloud
 *    control plane serves `/api/v1/marketplace/packages*` NATIVELY (its own
 *    route module), with no proxy anywhere; the flag's documented meaning in
 *    that distribution is already "`/api/v1/marketplace/*` is reachable
 *    (proxy or native)". Reading the route table is what makes one derivation
 *    true for both.
 *
 * The raw app's route ledger is the union of everything registered on it —
 * adapter verb methods and framework-native `getRawApp()` mounts alike — so it
 * answers exactly the question the flag claims to answer. Read per request:
 * plugin `start()` order across `kernel:ready` hooks is not guaranteed, and by
 * request time every hook has run.
 *
 * ## When it cannot be observed
 *
 * An adapter whose raw app exposes no route ledger returns `false` — do not
 * claim a capability you could not verify; claiming it unverified is the
 * defect. A host on such an adapter that KNOWS browse is live states it
 * through the `resolveFeatures` seam, which still merges over this base.
 */
function hasMarketplaceBrowseMount(rawApp: unknown): boolean {
    const routes = (rawApp as { routes?: unknown } | null | undefined)?.routes;
    if (!Array.isArray(routes)) return false;
    return routes.some((route) => {
        const pattern = (route as { path?: unknown } | null | undefined)?.path;
        return typeof pattern === 'string' && isMarketplaceBrowsePattern(pattern);
    });
}


/**
 * Feature-flag overrides a host's distribution policy can derive per request.
 *
 * Open-ended on purpose: the framework's own flags (`aiStudio`,
 * `autoPublishAiBuilds`) are named, but a distribution may return **any**
 * additional boolean keys (commercial tiering, white-label toggles, …) and
 * they pass through to the SPA untouched. The framework does not enumerate
 * the distribution's feature catalog.
 */
export interface RuntimeFeatureOverrides {
    /** Whether the SPA should surface AI-driven metadata authoring. */
    aiStudio?: boolean;
    /** Whether AI-built apps auto-publish in the author's own environment. */
    autoPublishAiBuilds?: boolean;
    /** Distribution-specific flags pass through opaquely (e.g. customDomain, sso). */
    [feature: string]: boolean | undefined;
}

/** @deprecated billing-vocab name; use {@link RuntimeFeatureOverrides}. */
export type RuntimeConfigPlanFeatures = RuntimeFeatureOverrides;

export interface RuntimeConfigPluginConfig {
    /**
     * Upstream cloud base URL. Falls back to `resolveCloudUrl()` (reads
     * `OS_CLOUD_URL` / built-in default) when omitted. Pass an explicit
     * empty string to declare "this runtime IS the cloud" (same-origin
     * for marketplace + install).
     */
    controlPlaneUrl?: string;
    /** Override the `features.installLocal` flag. Default: false. */
    installLocal?: boolean;
    /**
     * Override the `features.aiStudio` flag — whether the SPA should surface
     * AI-driven metadata authoring ("online development") affordances.
     * Default: true (the actual authoring capability is still gated
     * server-side; set false to force-hide the authoring UI).
     */
    aiStudio?: boolean;
    /**
     * Report this runtime as a single-environment deployment (CLI
     * `objectstack dev` / `os serve`). Defaults to `false` for
     * multi-tenant deployments.
     */
    singleEnvironment?: boolean;
    /**
     * Product name shown in browser title, splash screen, and other
     * client chrome. Operators can override per-deployment (white-label,
     * regional rebrands). Falls back to `OS_PRODUCT_NAME` env var, then
     * to the default `'ObjectOS'`.
     */
    productName?: string;
    /** Short product name (PWA shortName, compact spots). Defaults to productName. */
    productShortName?: string;
    /** Absolute or relative URL for the product logo. Falls back to OS_LOGO_URL env var. */
    logoUrl?: string;
    /** Absolute or relative URL for the favicon. Falls back to OS_FAVICON_URL env var. */
    faviconUrl?: string;
    /** Primary brand hex color (e.g. '#4F46E5'). Falls back to OS_BRAND_COLOR env var. */
    brandColor?: string;
    /** PWA manifest description. Falls back to OS_PWA_DESCRIPTION env var. Default: "<productName> — runtime console". */
    pwaDescription?: string;
    /** PWA theme color hex. Falls back to OS_PWA_THEME_COLOR env var. Default: brandColor or '#4f46e5'. */
    pwaThemeColor?: string;
    /**
     * Distribution feature-policy hook (open-core seam — cloud ADR-0012).
     * Called with `undefined` for the static default (no environment resolved
     * / no token known) and with an opaque environment token (the cloud
     * distribution passes the plan string) once hostname resolution provides
     * one. Returned flags are merged verbatim into `features` — arbitrary keys
     * pass through. Omitted keys keep the static config defaults; when the hook
     * itself is omitted, flags are purely config-driven. The framework does NOT
     * know the distribution's feature catalog or pricing.
     */
    resolveFeatures?: (token: string | undefined) => RuntimeFeatureOverrides;
    /**
     * @deprecated billing-vocab name; use {@link resolveFeatures}. Still
     * honoured when `resolveFeatures` is absent so existing hosts keep working.
     */
    resolvePlanFeatures?: (plan: string | undefined) => RuntimeFeatureOverrides;
}

export class RuntimeConfigPlugin implements Plugin {
    readonly name = 'com.objectstack.runtime.runtime-config';
    readonly version = '1.0.0';

    private readonly cloudUrl: string;
    private readonly installLocal: boolean;
    private readonly aiStudio: boolean;
    private readonly singleEnvironment: boolean;
    private readonly productName: string;
    private readonly productShortName: string;
    private readonly logoUrl: string | undefined;
    private readonly faviconUrl: string | undefined;
    private readonly brandColor: string | undefined;
    private readonly pwaDescription: string;
    private readonly pwaThemeColor: string;
    private readonly resolveFeatures?: (token: string | undefined) => RuntimeFeatureOverrides;

    constructor(config: RuntimeConfigPluginConfig = {}) {
        // An explicit empty string means "stay on this origin" — bypass the
        // resolver which would otherwise fall back to the default cloud URL.
        this.cloudUrl = config.controlPlaneUrl === ''
            ? ''
            : (resolveCloudUrl(config.controlPlaneUrl) ?? '');
        this.installLocal = !!config.installLocal;
        this.aiStudio = config.aiStudio !== false; // default true (override-to-hide)
        this.singleEnvironment = !!config.singleEnvironment;
        // Prefer the plan-agnostic seam; fall back to the deprecated alias.
        this.resolveFeatures = config.resolveFeatures ?? config.resolvePlanFeatures;
        const envName = (typeof process !== 'undefined' ? process.env?.OS_PRODUCT_NAME : undefined)?.trim();
        const envShort = (typeof process !== 'undefined' ? process.env?.OS_PRODUCT_SHORT_NAME : undefined)?.trim();
        this.productName = (config.productName ?? envName ?? 'ObjectOS').trim() || 'ObjectOS';
        this.productShortName = (config.productShortName ?? envShort ?? this.productName).trim() || this.productName;
        const envLogoUrl = (typeof process !== 'undefined' ? process.env?.OS_LOGO_URL : undefined)?.trim();
        const envFaviconUrl = (typeof process !== 'undefined' ? process.env?.OS_FAVICON_URL : undefined)?.trim();
        const envBrandColor = (typeof process !== 'undefined' ? process.env?.OS_BRAND_COLOR : undefined)?.trim();
        const envPwaDescription = (typeof process !== 'undefined' ? process.env?.OS_PWA_DESCRIPTION : undefined)?.trim();
        const envPwaThemeColor = (typeof process !== 'undefined' ? process.env?.OS_PWA_THEME_COLOR : undefined)?.trim();
        this.logoUrl = config.logoUrl ?? envLogoUrl;
        this.faviconUrl = config.faviconUrl ?? envFaviconUrl;
        this.brandColor = config.brandColor ?? envBrandColor;
        this.pwaDescription = config.pwaDescription ?? envPwaDescription ?? `${this.productName} — runtime console`;
        this.pwaThemeColor = config.pwaThemeColor ?? envPwaThemeColor ?? this.brandColor ?? '#4f46e5';
    }

    init = async (_ctx: PluginContext): Promise<void> => {};

    start = async (ctx: PluginContext): Promise<void> => {
        ctx.hook('kernel:ready', async () => {
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
                ctx.logger?.warn?.('[RuntimeConfigPlugin] http-server not available — runtime/config not mounted');
                return;
            }
            if (typeof httpServer.getRawApp !== 'function') {
                ctx.logger?.warn?.('[RuntimeConfigPlugin] http-server missing getRawApp() — runtime/config not mounted');
                return;
            }
            const rawApp = httpServer.getRawApp();

            // Diagnosable once at mount time rather than per request: an
            // adapter with no observable route ledger makes
            // `features.marketplace` report false for the whole process, and
            // a silently downgraded capability flag is hard to trace from the
            // SPA end. See hasMarketplaceBrowseMount().
            if (!Array.isArray((rawApp as { routes?: unknown } | null | undefined)?.routes)) {
                ctx.logger?.warn?.(
                    '[RuntimeConfigPlugin] raw app exposes no route table — features.marketplace will report false '
                    + '(a mounted browse surface cannot be observed here). Declare it via resolveFeatures if this '
                    + 'runtime does serve marketplace browse.',
                );
            }

            // A multi-tenant runtime serves many subdomains, each mapped to
            // one environment. Telling the SPA *which* environment it is
            // attached to (per-request) lets the App Marketplace skip the
            // env-picker dialog and install directly into "this" env — the
            // operator's domain already identifies it.
            //
            // Hostname → env is resolved by the same registry the per-env
            // kernel router uses (env-registry). Falls back to the static
            // payload when the host doesn't map to any env (e.g. a marketing
            // root or a CLI-served single-env runtime).
            // [#4251] `env-registry` has no written contract, so the two
            // hostname resolvers this reads are declared here rather than
            // erased. Both spellings are probed below because the slot has two
            // providers that disagree — declaring them is what makes that
            // disagreement visible instead of a pair of `?.` guesses.
            let envRegistry: EnvRegistrySurface | null = null;
            try { envRegistry = ctx.getService<EnvRegistrySurface>('env-registry') ?? null; }
            catch { /* not mounted (file/CLI mode) */ }

            // Merge the distribution's feature overrides over the static base.
            // Arbitrary keys returned by the host pass through verbatim — the
            // framework does not enumerate the distribution's feature catalog.
            const featuresFor = (
                token: string | undefined,
                base: Record<string, boolean>,
            ): Record<string, boolean> => {
                const derived = this.resolveFeatures?.(token);
                if (!derived) return { ...base };
                const out: Record<string, boolean> = { ...base };
                for (const [k, v] of Object.entries(derived)) {
                    if (typeof v === 'boolean') out[k] = v;
                }
                return out;
            };

            const handler = async (c: any) => {
                const rawHost = c.req.header('host') ?? '';
                const host = rawHost.split(':')[0].toLowerCase().trim();
                let defaultEnvironmentId: string | undefined;
                let defaultOrgId: string | undefined;
                let resolvedSingleEnv = this.singleEnvironment;
                // Static defaults: config-driven, optionally shaped by the
                // host's policy hook for the "no token known" case.
                let features = featuresFor(undefined, { aiStudio: this.aiStudio, autoPublishAiBuilds: false });
                // EnvironmentDriverRegistry exposes `resolveByHostname()`;
                // older code paths used `resolveHostname()` on the client.
                // Accept either so production runtimes don't silently no-op
                // and leave the SPA showing the env picker.
                const resolveFn: ((h: string) => Promise<any>) | null =
                    typeof envRegistry?.resolveByHostname === 'function'
                        ? envRegistry.resolveByHostname.bind(envRegistry)
                        : typeof envRegistry?.resolveHostname === 'function'
                            ? envRegistry.resolveHostname.bind(envRegistry)
                            : null;
                if (resolveFn && host) {
                    try {
                        const resolved = await resolveFn(host);
                        if (resolved?.environmentId) {
                            defaultEnvironmentId = String(resolved.environmentId);
                            const orgId = resolved.organizationId ?? resolved.organization_id;
                            if (orgId) defaultOrgId = String(orgId);
                            // Each subdomain is one environment from the
                            // operator's POV: surface as single-environment
                            // so the SPA hides multi-env affordances.
                            resolvedSingleEnv = true;
                            // Distribution-derived features — only an explicit
                            // non-empty token re-runs the policy hook.
                            if (typeof resolved.plan === 'string' && resolved.plan.trim() !== '') {
                                features = featuresFor(resolved.plan, features);
                            }
                        }
                    } catch {
                        // Resolver failures are non-fatal — fall through
                        // to the static payload so /runtime/config never
                        // 500s. Worst case the SPA shows its env picker.
                    }
                }
                return c.json({
                    cloudUrl: this.cloudUrl,
                    singleEnvironment: resolvedSingleEnv,
                    defaultOrgId,
                    defaultEnvironmentId,
                    features: {
                        installLocal: this.installLocal,
                        // Observed, not declared (#8356) — re-read per request
                        // because it is a property of the app, not of this
                        // plugin's config. A host's resolveFeatures still
                        // merges over it, same as every other base flag.
                        marketplace: hasMarketplaceBrowseMount(rawApp),
                        // aiStudio + autoPublishAiBuilds + any distribution keys.
                        ...features,
                    },
                    branding: {
                        productName: this.productName,
                        productShortName: this.productShortName,
                        logoUrl: this.logoUrl,
                        faviconUrl: this.faviconUrl,
                        brandColor: this.brandColor,
                        pwaDescription: this.pwaDescription,
                        pwaThemeColor: this.pwaThemeColor,
                    },
                });
            };
            rawApp.get('/api/v1/runtime/config', handler);
            // Legacy alias for older Studio bundles.
            rawApp.get('/api/v1/studio/runtime-config', handler);
        });
    };
}
