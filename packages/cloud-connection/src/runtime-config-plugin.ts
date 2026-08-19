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
 *     branding: { productName, productShortName, stage?, logoUrl, faviconUrl, brandColor, pwaDescription, pwaThemeColor }
 *   }
 *
 * ## `branding.stage` — a documented knob that this runtime never sent (#9252)
 *
 * The Console's `PreviewBadge` reads `branding.stage` to decide whether to show
 * its "Preview" / "Beta" chip, and objectui's app-shell README states the
 * operator interface in as many words: *"Operators set it with
 * `OS_PRODUCT_STAGE` or `new RuntimeConfigPlugin({ stage })`"*. Neither half
 * existed. Measured on `main` with a control before this change (the control is
 * what makes the zeros a reading rather than a broken search):
 *
 *   OS_PRODUCT_STAGE, repo-wide                  0 hits
 *   branding.stage / PlatformStage, cloud repo   0 hits
 *   control: OS_PRODUCT_NAME, cloud repo         9 hits
 *
 * So `OS_PRODUCT_STAGE=ga objectstack dev` left the badge up, and the card's
 * guess that "the knob is honored only by the cloud distribution" was wrong in
 * the operator's favour: **no** distribution honoured it. Emitting the key is
 * restoration of an already-declared contract, not a new surface.
 *
 * It is resolved HERE and not threaded in from the CLI, which is the one design
 * choice in this fix worth stating. Both halves of the documented interface name
 * this plugin, every sibling branding key already resolves `config.X ?? OS_X`
 * in this constructor, and — decisively — the card's own repro
 * (`examples/app-showcase`) constructs its **own** `RuntimeConfigPlugin` in
 * `objectstack.config.ts`, which takes precedence over the CLI's by plugin name.
 * A value threaded through `Serve.RUNTIME_CONFIG_OPTIONS` would therefore have
 * left the reported repro still broken, and made every other host responsible
 * for remembering one more passthrough — the every-host-must-remember failure
 * `features.installLocal` above was already demoted for.
 *
 * The value space is CLOSED (`preview` | `beta` | `ga`), mirroring the
 * `PlatformStage` union the Console branches on. An unrecognised value is
 * refused and reported at mount time rather than forwarded: the SPA would
 * discard it anyway (its own `isPlatformStage` guard keeps the current stage on
 * a malformed payload), so a passthrough would recreate this bug's exact shape —
 * an operator setting the knob, nothing happening, nothing said. Unset stays
 * **absent**: no `stage` key at all, never an empty string or a guessed default,
 * so the Console keeps applying its own documented `'preview'` default and
 * nothing that works today changes.
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
 *
 * ## `features.installLocal` is DERIVED too, with the option kept as a CEILING (#8388)
 *
 * #8356 derived `marketplace` and stopped there, leaving two keys in one
 * object answered by different rules — one observed, one declared. The
 * declared one was the constructor's `installLocal`, and it is the key #8343
 * actually measured wrong on a real customer deployment: `installLocal: true`
 * in the served payload with
 * `GET/POST /api/v1/marketplace/install-local -> 404 {"error":"Not found"}`
 * behind it. The #8343 ruling's reasoning — a hand-maintained boolean makes
 * every host responsible for keeping the flag in step with its own mounting,
 * and hosts measurably do not — transfers to this key unchanged; it is simply
 * the one the ruling was not asked about.
 *
 * The `installLocal` constructor option is **kept** (hosts pass it today), but
 * it is now a **ceiling, not a source**:
 *
 *   omitted / `true`  -> the derived observation governs
 *   `false`           -> `false`, even where the plugin IS mounted (opt-out)
 *
 * A ceiling rather than a plain override because the plain override would have
 * left the measured defect standing: the CLI's own `RUNTIME_CONFIG_OPTIONS`
 * passes `installLocal: true` unconditionally, so honouring `true` upward
 * would keep "declared `true`, route 404s" reachable on the exact product path
 * #8343 reported — the derivation would be inert precisely where it is needed.
 * Nothing is lost: a host on an adapter whose routes cannot be observed still
 * states the capability through `resolveFeatures`, which merges over this base
 * exactly as it does for `marketplace`.
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
 * / `marketplace-install-local-plugin` — the derivations must also see a
 * surface this package never mounted (see {@link hasMarketplaceBrowseMount}),
 * so keying them on a provider module would narrow them back to one provider.
 * The coupling to each plugin's own spelling is instead pinned by test: both
 * positive directions mount the REAL plugin onto the same app rather than
 * hand-spelling its route, so a change to either prefix fails there rather
 * than silently flipping a flag to `false`.
 *
 * `MARKETPLACE_INSTALL_LOCAL_PREFIX` is the **one** definition of "what
 * install-local is", read in opposite directions by the two predicates below:
 * negatively by browse (#8356 excludes it) and positively by install-local
 * (#8388 requires it). That single constant is the part that genuinely has to
 * be shared — it is what makes it impossible for the two flags to both claim,
 * or both disown, the same route if the prefix ever moves.
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
    return someRoutePattern(rawApp, isMarketplaceBrowsePattern);
}

/**
 * Does this registered route pattern mount the offline INSTALL-LOCAL surface?
 * (#8388)
 *
 * Sibling of {@link isMarketplaceBrowsePattern}, not a reuse of it: browse
 * subtracts these paths by design, so no single predicate can answer both
 * questions. What the two share is the prefix constant, so "what counts as
 * install-local" has one definition rather than two that can drift apart.
 *
 * `MarketplaceInstallLocalPlugin` mounts the bare prefix plus `/:manifestId`
 * sub-paths, so a segment boundary — not a bare `startsWith` — decides
 * membership: `…/install-local` and `…/install-local/anything` count,
 * `…/install-locality` does not. That is deliberately one notch stricter than
 * browse's exclusion, which subtracts every `startsWith` match. The asymmetry
 * is in the safe direction for both keys: a near-miss spelling is claimed by
 * neither flag, which is under-reporting, and under-reporting is the failure
 * mode this whole family of fixes chose over the alternative. Tightening
 * browse's exclusion to match would be a behaviour change to #8356's key and
 * is not this card's to make.
 */
function isMarketplaceInstallLocalPattern(pattern: string): boolean {
    if (!pattern.startsWith(MARKETPLACE_INSTALL_LOCAL_PREFIX)) return false;
    const rest = pattern.slice(MARKETPLACE_INSTALL_LOCAL_PREFIX.length);
    return rest === '' || rest.startsWith('/');
}

/**
 * Is an install-local surface actually mounted on the app serving this
 * response? (#8388)
 *
 * Every word of {@link hasMarketplaceBrowseMount}'s reasoning about *why the
 * raw app's route table* applies here too, and one of them applies harder:
 * `MarketplaceInstallLocalPlugin` also registers no service to look up — it
 * announces itself only by mounting its routes on the raw app — so the route
 * ledger is again the only place the question has an answer. Read per request
 * for the same reason: `kernel:ready` hook order is not guaranteed, and by
 * request time every hook has run.
 *
 * Unobservable adapter ⇒ `false`, same as browse: do not claim a capability
 * you could not verify. That is not a regression against the old constructor
 * flag — claiming it unverified IS #8343's measured defect. A host that knows
 * better says so through `resolveFeatures`.
 */
function hasMarketplaceInstallLocalMount(rawApp: unknown): boolean {
    return someRoutePattern(rawApp, isMarketplaceInstallLocalPattern);
}

/**
 * The route-ledger read both derivations share.
 *
 * This — not the predicates — is the genuinely common mechanism: locate the
 * raw app's `routes` ledger, refuse to answer when there is none, and test
 * every registered pattern. The predicates stay separate because they answer
 * different questions about the same ledger.
 */
function someRoutePattern(rawApp: unknown, matches: (pattern: string) => boolean): boolean {
    const routes = (rawApp as { routes?: unknown } | null | undefined)?.routes;
    if (!Array.isArray(routes)) return false;
    return routes.some((route) => {
        const pattern = (route as { path?: unknown } | null | undefined)?.path;
        return typeof pattern === 'string' && matches(pattern);
    });
}


/**
 * Product lifecycle stage — drives the Console's top-bar preview/beta chip
 * (#9252).
 *
 * A CLOSED set, not free text, because the consumer BRANCHES on the value:
 * `PreviewBadge` renders "Preview" for `preview`, "Beta" for `beta`, and
 * nothing at all for `ga`. This union is the server-side mirror of the
 * `PlatformStage` union in objectui's `app-shell/src/runtime-config.ts`; the
 * two are pinned together by the operator-facing documentation in its README
 * rather than by an import, since neither repo depends on the other here.
 *
 * There is deliberately no `'preview'` default on this side — see
 * {@link RuntimeConfigPluginConfig.stage}.
 */
export type PlatformStage = 'preview' | 'beta' | 'ga';

/** The accepted spellings, in the order the diagnostic lists them. */
const PLATFORM_STAGES: readonly PlatformStage[] = ['preview', 'beta', 'ga'];

/**
 * Narrow an operator-supplied string to the closed stage set.
 *
 * Exact match against the trimmed value — no case folding, no synonyms. A
 * near-miss (`GA`, `general-availability`) is REFUSED and reported, not
 * guessed: silently coercing it would fossilize a second spelling of a
 * documented key, and this file's whole subject is a knob that appeared to work
 * while doing nothing.
 */
function asPlatformStage(value: string | undefined): PlatformStage | undefined {
    if (value === undefined) return undefined;
    const trimmed = value.trim();
    return (PLATFORM_STAGES as readonly string[]).includes(trimmed)
        ? (trimmed as PlatformStage)
        : undefined;
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
    /**
     * CEILING for the `features.installLocal` flag — no longer its source
     * (#8388).
     *
     * The flag is derived from whether an install-local surface is really
     * mounted on the app serving the response. This option can only lower that
     * answer:
     *
     *   - omitted or `true` — report what is mounted (the default, and what
     *     every host passing `installLocal: true` today already meant);
     *   - `false` — report `false` even where the plugin IS mounted, for a
     *     host that wants the affordance hidden.
     *
     * It deliberately cannot raise the answer: `true` on a runtime with no
     * install-local route is #8343's measured defect (a capability whose route
     * 404s), and re-admitting it here would make the derivation inert on the
     * CLI's own path, which passes `installLocal: true` unconditionally. A host
     * whose adapter exposes no route table, but which knows install-local is
     * live, declares it through {@link resolveFeatures} — that hook still
     * merges over this base, exactly as it does for `marketplace`.
     */
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
    /**
     * Product lifecycle stage driving the Console's preview/beta chip (#9252).
     * Falls back to the `OS_PRODUCT_STAGE` env var; set `'ga'` to hide the
     * badge. Both spellings are the ones objectui's app-shell README already
     * documents to operators.
     *
     * ⛔ Unset means **unset**: the response then carries no `stage` key at all,
     * rather than an empty string or a default invented here. The Console
     * already owns the documented default (`'preview'` until a server says
     * otherwise), so guessing one on this side would be this card's own defect
     * pointing the other way — a consumer misreading a missing thing, except
     * the server would be the one asserting it.
     *
     * An unrecognised value (env typo, or a JS host outside this type) is
     * refused and warned about at mount time — never forwarded.
     */
    stage?: PlatformStage;
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
    /**
     * `false` only when the host explicitly opted out — see the config option.
     * Named for what it now is (a bound on the derived answer) rather than for
     * the answer itself, so a future edit cannot mistake it for the source.
     */
    private readonly installLocalCeiling: boolean;
    private readonly aiStudio: boolean;
    private readonly singleEnvironment: boolean;
    private readonly productName: string;
    private readonly productShortName: string;
    /** Resolved stage, or `undefined` for "send no key" (unset or refused). */
    private readonly stage: PlatformStage | undefined;
    /**
     * The rejected spelling, kept only so `start()` can name it once. Holding
     * it — rather than warning from the constructor — is what the route-ledger
     * diagnostic below already does: the constructor has no logger, and a
     * silently dropped operator knob is exactly the thing that must not be
     * invisible from the SPA end.
     */
    private readonly refusedStage: string | undefined;
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
        // `!== false`, not `!!` — an omitted option must not read as an opt-out
        // now that the flag is derived; only an explicit `false` lowers it.
        this.installLocalCeiling = config.installLocal !== false;
        this.aiStudio = config.aiStudio !== false; // default true (override-to-hide)
        this.singleEnvironment = !!config.singleEnvironment;
        // Prefer the plan-agnostic seam; fall back to the deprecated alias.
        this.resolveFeatures = config.resolveFeatures ?? config.resolvePlanFeatures;
        const envName = (typeof process !== 'undefined' ? process.env?.OS_PRODUCT_NAME : undefined)?.trim();
        const envShort = (typeof process !== 'undefined' ? process.env?.OS_PRODUCT_SHORT_NAME : undefined)?.trim();
        this.productName = (config.productName ?? envName ?? 'ObjectOS').trim() || 'ObjectOS';
        this.productShortName = (config.productShortName ?? envShort ?? this.productName).trim() || this.productName;
        // Same precedence as every branding key above — the HOST's explicit
        // option wins, the env var is the operator's fallback — but resolved
        // through the closed set, so an unrecognised spelling from either door
        // becomes "no key" plus one diagnostic rather than an out-of-contract
        // value the Console would silently discard.
        const envStage = (typeof process !== 'undefined' ? process.env?.OS_PRODUCT_STAGE : undefined)?.trim();
        const requestedStage = config.stage ?? (envStage || undefined);
        this.stage = asPlatformStage(requestedStage);
        this.refusedStage = this.stage === undefined ? requestedStage : undefined;
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
            // adapter with no observable route ledger makes BOTH derived flags
            // report false for the whole process, and a silently downgraded
            // capability flag is hard to trace from the SPA end. See
            // hasMarketplaceBrowseMount() / hasMarketplaceInstallLocalMount().
            if (!Array.isArray((rawApp as { routes?: unknown } | null | undefined)?.routes)) {
                ctx.logger?.warn?.(
                    '[RuntimeConfigPlugin] raw app exposes no route table — features.marketplace and '
                    + 'features.installLocal will report false (a mounted browse or install-local surface cannot '
                    + 'be observed here). Declare them via resolveFeatures if this runtime does serve them.',
                );
            }

            // An operator who set OS_PRODUCT_STAGE (or a JS host that passed
            // `stage`) to something outside the closed set gets told here,
            // naming what was refused and what is accepted. `warn`, not
            // `error`: this is a FUNCTIONAL degradation — the badge visibly
            // stays up and the next person to look finds out — with nothing
            // claimed-persisted going missing behind it.
            if (this.refusedStage !== undefined) {
                ctx.logger?.warn?.(
                    `[RuntimeConfigPlugin] ignoring unrecognised product stage ${JSON.stringify(this.refusedStage)} `
                    + `(OS_PRODUCT_STAGE / the \`stage\` option) — branding.stage will be omitted and the Console `
                    + `keeps its default preview badge. Accepted values: ${PLATFORM_STAGES.join(', ')}.`,
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
                        // Observed, not declared (#8388) — the constructor
                        // option survives only as a ceiling, so a host cannot
                        // announce an install route it never mounted (#8343's
                        // measured symptom) but can still opt out of one it
                        // did.
                        installLocal: this.installLocalCeiling && hasMarketplaceInstallLocalMount(rawApp),
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
                        // Spread, not `stage: this.stage` — the sibling keys
                        // below may serialize as `undefined` (JSON.stringify
                        // drops them) but this one is asserted on by KEY
                        // PRESENCE, so it must never exist as a
                        // present-and-undefined property on the object handed
                        // to a non-JSON consumer or a test.
                        ...(this.stage !== undefined ? { stage: this.stage } : {}),
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
