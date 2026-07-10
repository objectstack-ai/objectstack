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
 */

import type { Plugin, PluginContext } from '@objectstack/core';
import { resolveCloudUrl } from './cloud-url.js';

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
            let httpServer: any;
            try {
                httpServer = ctx.getService('http-server');
            } catch {
                ctx.logger?.warn?.('[RuntimeConfigPlugin] http-server not available — runtime/config not mounted');
                return;
            }
            if (!httpServer || typeof httpServer.getRawApp !== 'function') {
                ctx.logger?.warn?.('[RuntimeConfigPlugin] http-server missing getRawApp() — runtime/config not mounted');
                return;
            }
            const rawApp = httpServer.getRawApp();

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
            let envRegistry: any = null;
            try { envRegistry = ctx.getService('env-registry'); } catch { /* not mounted (file/CLI mode) */ }

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
                        marketplace: true,
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
