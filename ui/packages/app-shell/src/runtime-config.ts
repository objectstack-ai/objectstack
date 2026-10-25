// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Runtime configuration pushed by the server at boot.
 *
 * The SPA fetches `GET /api/v1/runtime/config` once before first paint
 * (`initRuntimeConfig()`) and exposes the response through a module-level
 * singleton (`config` + `getRuntimeConfig()`). Modules that need to know
 * about the upstream cloud URL or capability flags read from here —
 * NEVER from `window.location.hostname` or Vite-time env vars, since
 * those don't reflect the runtime the SPA is actually attached to (e.g.
 * a tenant ObjectOS runtime pointing at a separate cloud control plane).
 *
 * The runtime-config shape lives in app-shell because the Console SPA in
 * `apps/console` consumes app-shell code.
 *
 * Server-side producers of this payload — anchored by exported symbol +
 * package rather than by file path, because the previous path list went stale
 * (the framework implementation moved packages; the cloud repo deleted its
 * dead forked per-environment stack). Nothing imports across the repo
 * boundary, so this list is the only link between the two sides of the shape:
 *
 *   - `RuntimeConfigPlugin` from `@objectstack/cloud-connection` (framework)
 *     — the open implementation. Serves `GET /api/v1/runtime/config` and the
 *     legacy `GET /api/v1/studio/runtime-config` alias, and owns the
 *     `branding` / `features` shape mirrored below.
 *   - `RuntimeConfigPlugin` from `@objectstack/objectos-runtime` (cloud) —
 *     subclasses the open plugin to inject cloud plan policy, i.e. which plan
 *     unlocks `aiStudio` / `customDomain` / `sso`.
 *   - `createStudioRuntimeConfigPlugin` from `@objectstack/service-cloud`
 *     (cloud) — the multi-environment control-plane handshake.
 */

import { sharedGetJson } from '@object-ui/types';

export interface RuntimeFeatures {
  /** "Install to this runtime" button is meaningful on this runtime. */
  installLocal: boolean;
  /** `/api/v1/marketplace/*` is reachable from this runtime. */
  marketplace: boolean;
  /**
   * AI-driven metadata authoring ("online development") is offered by this
   * runtime. Default true; the capability is still gated server-side by the
   * presence of the metadata-authoring agent. When false, the SPA hides the
   * AI authoring affordances (generic data-chat assistant is unaffected).
   */
  aiStudio: boolean;
  /**
   * Auto-publish AI-built apps in the author's own environment. When true, the
   * Studio chat fires the publish-drafts call automatically the moment the
   * agent drafts an app, so the user refreshes and sees it live WITH its sample
   * data — no manual "go home and publish" step. Server-derived from the plan
   * (env-revertible via `OS_AI_AUTOPUBLISH_DISABLED`). Default true.
   */
  autoPublishAiBuilds: boolean;
  /**
   * Branded subdomains + custom (BYO-DNS) domains are available on this
   * environment's plan. Optional commercial flag — absent on self-hosted /
   * vanilla runtimes (treated as off). When false the SPA hides custom-domain
   * settings (or shows them as an upgrade affordance). Server-derived from the
   * plan entitlements (cloud ADR-0011/0012).
   */
  customDomain?: boolean;
  /**
   * SSO / SAML enterprise login is available on this environment's plan.
   * Optional commercial flag — absent on self-hosted / vanilla runtimes
   * (treated as off). Server-derived from the plan entitlements.
   */
  sso?: boolean;
  /**
   * SCIM-based user/group provisioning is available on this environment's
   * plan. Optional commercial flag — absent on self-hosted / vanilla
   * runtimes (treated as off). Server-derived from the plan entitlements,
   * the same producer object as `customDomain` / `sso`. Mapped through by
   * `initRuntimeConfig` alongside its two siblings so the typed value
   * matches the wire the producer already emits — no SPA read point or
   * gate consumes it yet (any actual SCIM UI gating is future work, not
   * implied by this declaration).
   */
  scim?: boolean;
  /**
   * `GET /api/v1/usage/storage` is served by this runtime — the one response
   * behind the environment admin's storage-capacity banner and read-rate
   * report. Optional cloud flag — absent on self-hosted / vanilla runtimes
   * (treated as off). Server-derived from the runtime's COMPOSITION, not from
   * the plan: the cloud distribution serves it `true` exactly when it mounts
   * the endpoint's plugin (cloud#2481), and no key at all otherwise. When off,
   * the console never asks that endpoint (objectui#11002); see
   * {@link isStorageUsageServed}.
   */
  storageUsage?: boolean;
}

/**
 * Product lifecycle stage. Surfaced as a small chip next to the product
 * wordmark: `'preview'` → "Preview", `'beta'` → "Beta"; `'ga'` hides it.
 * Defaults to `'preview'` while the whole platform is pre-GA — operators flip
 * it to `'ga'` at launch (via `OS_PRODUCT_STAGE` / `RuntimeConfigPlugin`) with
 * no code change.
 */
export type PlatformStage = 'preview' | 'beta' | 'ga';

export interface RuntimeBranding {
  /** Product name shown in browser title, splash, account chrome. */
  productName: string;
  /** Short variant for PWA shortName / compact spots. */
  productShortName: string;
  /** Product lifecycle stage — drives the top-bar preview/beta badge. */
  stage?: PlatformStage;
  /** Absolute or relative URL for the product logo. */
  logoUrl?: string;
  /** Absolute or relative URL for the favicon. */
  faviconUrl?: string;
  /** Primary brand hex color (e.g. '#4F46E5'). */
  brandColor?: string;
  /** PWA manifest description. */
  pwaDescription?: string;
  /** PWA theme color hex. */
  pwaThemeColor?: string;
}

/**
 * The Console's client error-reporting sink, served by the runtime
 * (objectui#5522 / objectstack#12681, upstream half of cloud#1508).
 *
 * A CLOSED enumeration, delivered as one object. Everything here used to be a
 * build-time `VITE_SENTRY_*` variable, which meant a platform user consuming
 * the PREBUILT Console could set none of it — including `sendDefaultPii`, the
 * knob that decides whether IP and User-Agent leave their network. The
 * maintainer named that on 2026-08-27, verbatim and untranslated:
 *
 * > 「我是一个开发平台呀，我的用户并不会去构建我的前端，我理解这种应该在服务端传进去。」
 *
 * One knob deliberately did NOT move and is still read from `import.meta.env`:
 * `VITE_SENTRY_RELEASE`. A release identifies WHICH BUNDLE produced a stack
 * trace and must match the source maps that bundle's pipeline uploaded, so it
 * is a property of the build; a server cannot know which Console build it is
 * serving.
 */
export interface RuntimeClientErrorReporting {
  /**
   * The sink. Non-empty by construction — this object exists only when a DSN
   * arrived, so holding one IS the grant. There is no companion permission
   * boolean, and the one that briefly existed (objectstack#10805's
   * `allowClientErrorReporting`) was removed by the same change that added
   * this, not paralleled.
   */
  dsn: string;
  /** May IP address + User-Agent be attached to events? Opt-in. */
  sendDefaultPii: boolean;
  /** The `environment` tag. Absent ⇒ the SPA falls back to its own build mode. */
  environment?: string;
  /** Transaction sampling, `0`..`1`. */
  tracesSampleRate: number;
  /** Error-session replay sampling, `0`..`1`. */
  replaysOnErrorSampleRate: number;
}

/**
 * The runtime's client-telemetry namespace.
 *
 * Its OWN namespace on the payload, deliberately NOT a member of
 * {@link RuntimeFeatures}. That map is open-ended — a host's `resolveFeatures`
 * hook merges arbitrary keys into it verbatim — so putting the sink there
 * would let a distribution hand out a telemetry endpoint from code whose
 * subject is billing tiers. A security-bearing configuration has exactly one
 * author. The producer (`RuntimeConfigPlugin` in
 * `@objectstack/cloud-connection`) pins the same separation from its side.
 */
export interface RuntimeTelemetry {
  /** The sink and its knobs. Absent means no client error reporting. */
  errorReporting?: RuntimeClientErrorReporting;
}

/**
 * The canonical fail-closed reading of a `/api/v1/runtime/config` payload's
 * error-reporting sink.
 *
 * ⚠️ **A MIRROR, and the mirror is the whole risk.** This repo has no
 * dependency on `@objectstack/cloud-connection` (the package that serves the
 * payload and owns the shape) — measured, not assumed: no `package.json` here
 * names it, and neither `@objectstack/spec` nor `@objectstack/client`, which we
 * do pin, re-export it. So no version bump can deliver this key to us and no
 * pin lag can withhold it; the shape reaches us only by being retyped here, the
 * way `branding` and `features` above already are. What CAN go wrong is drift,
 * so this function is a deliberate line-for-line mirror of
 * `readClientErrorReporting` exported from
 * `@objectstack/cloud-connection/telemetry-posture`, and
 * `runtime-config.test.ts` pins it in both directions.
 *
 * Every "cannot determine the answer" state — a non-object body, an absent
 * `telemetry` block, an absent `errorReporting` block, an empty DSN, a payload
 * from an older ObjectStack or a third-party host — carries no DSN and
 * therefore reads as OFF. That is stronger than the permission boolean this
 * replaced, which needed `=== true` plus a written argument about why a
 * negative `disabled` key would have been vacuous: absence of a SOURCE is not
 * a value that can be misread.
 *
 * The knobs are re-derived defensively — only a real `true` opts into PII, only
 * a finite `0`..`1` moves a sample rate — because `'true'`, `1` and `'yes'` are
 * payloads a consumer should not teach itself to accept.
 *
 * The DSN itself is accepted as any non-empty string, NOT re-run through the
 * producer's shape check: a server serving a working DSN that this quietly
 * discarded would rebuild the two-places-disagreeing failure objectstack#12681
 * deleted. `Sentry.init` is the authority on its own format. The one exception
 * is a DSN carrying a PASSWORD, refused here as well as at the producer —
 * that failure mode is a secret published to every browser that loads the page,
 * and against a third-party host this reader is the last thing standing.
 */
function readClientErrorReporting(payload: unknown): RuntimeClientErrorReporting | null {
  if (typeof payload !== 'object' || payload === null) return null;
  const telemetry = (payload as { telemetry?: unknown }).telemetry;
  if (typeof telemetry !== 'object' || telemetry === null) return null;
  const block = (telemetry as { errorReporting?: unknown }).errorReporting;
  if (typeof block !== 'object' || block === null) return null;

  const raw = block as Record<string, unknown>;
  if (typeof raw.dsn !== 'string') return null;
  const dsn = raw.dsn.trim();
  if (dsn === '') return null;
  if (carriesSecret(dsn)) return null;

  return {
    dsn,
    sendDefaultPii: raw.sendDefaultPii === true,
    ...(typeof raw.environment === 'string' && raw.environment.trim()
      ? { environment: raw.environment.trim() }
      : {}),
    tracesSampleRate: sampleRateOr(raw.tracesSampleRate, DEFAULT_TRACES_SAMPLE_RATE),
    replaysOnErrorSampleRate: sampleRateOr(
      raw.replaysOnErrorSampleRate,
      DEFAULT_REPLAYS_ON_ERROR_SAMPLE_RATE,
    ),
  };
}

/** Does this DSN carry a secret after the public key? See the reader's note. */
function carriesSecret(dsn: string): boolean {
  try {
    return new URL(dsn).password !== '';
  } catch {
    // Unparseable here means `Sentry.init` will reject it too. Not this
    // function's question, and answering `true` would discard it for the
    // wrong stated reason.
    return false;
  }
}

/** A finite `0`..`1` rate, or the default. Never a coerced string. */
function sampleRateOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1
    ? value
    : fallback;
}

/** Mirrors the producer's default transaction sampling. */
const DEFAULT_TRACES_SAMPLE_RATE = 0.1;

/**
 * Mirrors the producer's default replay sampling: OFF. Replay records what the
 * user did, so it is the deliberate choice of the deployment that wants it.
 */
const DEFAULT_REPLAYS_ON_ERROR_SAMPLE_RATE = 0;

/**
 * The SPA's server-pushed runtime configuration — which cloud to talk to, which
 * features are on, and how the product is branded.
 *
 * Named `AppShellRuntimeConfig`, not `RuntimeConfig`: `@objectstack/spec/kernel`
 * exports a `RuntimeConfig` that configures the ObjectStack ENGINE
 * (`engine`, `engineConfig`, `resourceLimits`). The two share not one key —
 * they are unrelated things that happened to pick the same noun
 * (objectstack#4115). `__tests__/spec-symbol-parity.test.ts` pins that the spec
 * does not own this name.
 */
export interface AppShellRuntimeConfig {
  /**
   * Upstream cloud base URL — the SPA dispatches install + env listing
   * directly against this origin. Empty string ⇒ requests stay on this
   * origin, and that is all it says: the runtime may serve the catalog
   * itself or proxy a control plane it does not name. The CLI's cloud-connected
   * `os serve` answers `''` while its marketplace proxy forwards to the
   * default control plane (objectui#11726), so read `''` neither as "this
   * runtime is the cloud" nor as "there is no upstream".
   */
  cloudUrl: string;
  /** Single-environment runtime (CLI `os serve`, etc.). */
  singleEnvironment: boolean;
  defaultOrgId?: string | null;
  defaultEnvironmentId?: string | null;
  features: RuntimeFeatures;
  branding: RuntimeBranding;
  /**
   * The runtime's client-telemetry namespace. Always present on the singleton
   * (defaulting to empty, i.e. no sink) so consumers never have to spell the
   * absent case themselves.
   */
  telemetry: RuntimeTelemetry;
  /**
   * The host asks the console to draw no app switcher for a viewer served ONE
   * app (objectui#12913). Meant for a deployment that is one product, such as
   * the cloud control plane (`createStudioRuntimeConfigPlugin` in
   * `@objectstack/service-cloud`), whose 「All apps」 row would only lead back
   * to the app the viewer is already in.
   *
   * It is a REQUEST, not the rule. `AppSwitcher` draws the app's own name and
   * glyph in place of its pill — so no dropdown, and no 「Back to home」 /
   * 「All apps」 / 「Settings」 rows — only when this is `true` AND the viewer's
   * app list holds exactly one active, un-hidden app, counted off the same
   * list the dropdown draws. A viewer served two or more keeps the switcher:
   * it is their way to the other app. The product mark still links home, and
   * the platform-stage chip still follows the app's name.
   *
   * Optional and OFF unless served: only a real `true` turns it on (see
   * {@link isSingleAppSwitcherHidden}), so a runtime that says nothing — every
   * runtime predating the key, a self-hosted one, a failed config fetch — keeps
   * today's switcher. Re-derived from each payload in full, like
   * `singleEnvironment`: a later payload without it withdraws it.
   */
  hideSingleAppSwitcher?: boolean;
}

const defaults: AppShellRuntimeConfig = {
  cloudUrl: '',
  singleEnvironment: false,
  defaultOrgId: null,
  defaultEnvironmentId: null,
  features: { installLocal: false, marketplace: true, aiStudio: true, autoPublishAiBuilds: true, customDomain: false, sso: false, scim: false, storageUsage: false },
  // `stage: 'preview'` while the whole platform is pre-GA, so the badge shows
  // out of the box on any runtime that hasn't sent an explicit stage yet.
  branding: { productName: 'ObjectOS', productShortName: 'ObjectOS', stage: 'preview', brandColor: '#4F46E5', pwaThemeColor: '#4f46e5' },
  // ⛔ No sink until a runtime serves one — including before
  // `initRuntimeConfig()` has ever run. This default IS the fail-closed
  // guarantee for the two states no payload can speak for: "the config has
  // not arrived yet" and "the fetch failed".
  telemetry: {},
  // The switcher is drawn until a host asks otherwise (objectui#12913).
  hideSingleAppSwitcher: false,
};

/** Valid {@link PlatformStage} values, for validating server-pushed config. */
const PLATFORM_STAGES: readonly PlatformStage[] = ['preview', 'beta', 'ga'];

function isPlatformStage(value: unknown): value is PlatformStage {
  return typeof value === 'string' && (PLATFORM_STAGES as readonly string[]).includes(value);
}

let current: AppShellRuntimeConfig = { ...defaults };
let initialised = false;

/** Apply a partial update over the singleton. */
function applyUpdate(patch: Partial<AppShellRuntimeConfig>): void {
  current = {
    ...current,
    ...patch,
    features: {
      ...current.features,
      ...(patch.features ?? {}),
    },
    branding: {
      ...current.branding,
      ...(patch.branding ?? {}),
    },
    // NOT merged like `features`/`branding`: the sink is re-derived from each
    // payload in full, so it can never outlive the response that carried it (a
    // later re-fetch against a runtime that withdrew the DSN must withdraw it
    // here too).
    telemetry: patch.telemetry ? { ...patch.telemetry } : current.telemetry,
  };
}

/**
 * The slot `apps/console/index.html`'s pre-boot branding script leaves its
 * `GET /api/v1/runtime/config` in: the URL it asked and the parsed-body promise,
 * kept for the page's lifetime. A classic inline script cannot import, so the
 * slot is spelled by hand on both sides and `runtimeConfigBootDedup.test.ts`
 * runs the shipped script against this reader.
 */
const EARLY_RUNTIME_CONFIG_KEY = Symbol.for('objectui.earlyRuntimeConfig');

interface EarlyRuntimeConfigSlot {
  url: string;
  body: Promise<Partial<AppShellRuntimeConfig> | null>;
  taken?: boolean;
}

/**
 * Take the pre-boot script's answer, once per page load, when it asked the same
 * URL. Resolves `undefined` when there is nothing to take — no script, another
 * URL, already taken, or an early fetch that failed — and the caller fetches.
 */
async function takeEarlyRuntimeConfig(
  url: string,
): Promise<Partial<AppShellRuntimeConfig> | null | undefined> {
  const holder = globalThis as unknown as Record<symbol, EarlyRuntimeConfigSlot | undefined>;
  const slot = holder[EARLY_RUNTIME_CONFIG_KEY];
  if (!slot || slot.taken || slot.url !== url) return undefined;
  slot.taken = true;
  try {
    return await slot.body;
  } catch {
    return undefined;
  }
}

/**
 * Fetch the server-pushed runtime config and merge it into the singleton.
 * Must be awaited before first render so consumers see definitive values
 * on first paint. Safe to call more than once (subsequent calls re-fetch
 * and re-merge).
 *
 * `baseUrl` lets callers in dev (Vite proxy) override the fetch origin.
 * In production both Console SPA and tenant runtime share an origin so
 * the default (relative `/api/v1/...`) works.
 *
 * This is NOT the page's first ask for this URL (objectui#5544): the inline
 * branding script in `apps/console/index.html` starts the identical request
 * during HTML parse, well before this module chunk is even fetched, and this one
 * is on the critical path — the console awaits it before `createRoot().render()`.
 * So the first call takes that script's answer instead of asking again
 * (objectui#12808, see {@link takeEarlyRuntimeConfig}); a failed early fetch, or
 * a page without the script, fetches here through {@link sharedGetJson}, and
 * every later call re-fetches, so the repeat-call contract above is unchanged.
 */
export async function initRuntimeConfig(baseUrl: string = ''): Promise<void> {
  const base = (baseUrl || '').replace(/\/+$/, '');
  const url = `${base}/api/v1/runtime/config`;
  try {
    const early = await takeEarlyRuntimeConfig(url);
    const body = early !== undefined
      ? early
      : await sharedGetJson<Partial<AppShellRuntimeConfig> | null>(
        url,
        { credentials: 'include', headers: { Accept: 'application/json' } },
      );
    if (!body || typeof body !== 'object') return;
    applyUpdate({
      cloudUrl: typeof body.cloudUrl === 'string' ? body.cloudUrl.replace(/\/+$/, '') : current.cloudUrl,
      singleEnvironment: !!body.singleEnvironment,
      // objectui#12913 — a host's request, so only a real `true` turns it on;
      // `'true'`, `1` and an absent key all keep the switcher.
      hideSingleAppSwitcher: body.hideSingleAppSwitcher === true,
      defaultOrgId: body.defaultOrgId ?? current.defaultOrgId ?? null,
      defaultEnvironmentId: body.defaultEnvironmentId ?? current.defaultEnvironmentId ?? null,
      features: body.features
        ? {
          installLocal: !!body.features.installLocal,
          marketplace: body.features.marketplace !== false,
          aiStudio: body.features.aiStudio !== false,
          autoPublishAiBuilds: body.features.autoPublishAiBuilds !== false,
          // Commercial flags default OFF unless the server explicitly grants
          // them — never show a paid surface on an unknown/older runtime.
          customDomain: body.features.customDomain === true,
          sso: body.features.sso === true,
          scim: body.features.scim === true,
          // A composition fact, not a commercial one, but OFF unless served for
          // the same reason: an unknown/older runtime is exactly the one that
          // does not serve the endpoint, and asking it is a 404 per page load.
          storageUsage: body.features.storageUsage === true,
        }
        : current.features,
      // Read off the RAW body, not off `body.telemetry`: the mirrored reader
      // owns every malformed/absent shape in one place, and handing it the
      // whole payload is what keeps this call site from growing its own
      // `?.` dialect.
      telemetry: (() => {
        const errorReporting = readClientErrorReporting(body);
        return errorReporting ? { errorReporting } : {};
      })(),
      branding: body.branding
        ? {
          productName:
            typeof body.branding.productName === 'string' && body.branding.productName.trim()
              ? body.branding.productName.trim()
              : current.branding.productName,
          productShortName:
            typeof body.branding.productShortName === 'string' && body.branding.productShortName.trim()
              ? body.branding.productShortName.trim()
              : current.branding.productShortName,
          // Only a recognised stage overrides the default; anything else
          // (missing, typo'd) preserves the current value so the badge never
          // vanishes on a malformed payload.
          stage: isPlatformStage(body.branding.stage) ? body.branding.stage : current.branding.stage,
          logoUrl: typeof body.branding.logoUrl === 'string' && body.branding.logoUrl.trim()
            ? body.branding.logoUrl.trim()
            : current.branding.logoUrl,
          faviconUrl: typeof body.branding.faviconUrl === 'string' && body.branding.faviconUrl.trim()
            ? body.branding.faviconUrl.trim()
            : current.branding.faviconUrl,
          brandColor: typeof body.branding.brandColor === 'string' && body.branding.brandColor.trim()
            ? body.branding.brandColor.trim()
            : current.branding.brandColor,
          pwaDescription: typeof body.branding.pwaDescription === 'string' && body.branding.pwaDescription.trim()
            ? body.branding.pwaDescription.trim()
            : current.branding.pwaDescription,
          pwaThemeColor: typeof body.branding.pwaThemeColor === 'string' && body.branding.pwaThemeColor.trim()
            ? body.branding.pwaThemeColor.trim()
            : current.branding.pwaThemeColor,
        }
        : current.branding,
    });
  } catch {
    // Endpoint missing or network failure ⇒ keep defaults. Older runtimes
    // pre-dating this endpoint simply behave as before.
  } finally {
    initialised = true;
  }
}

/** Read-only accessor. Returns the current snapshot. */
export function getRuntimeConfig(): AppShellRuntimeConfig {
  return current;
}

/**
 * Product name shown in browser title, splash, account chrome.
 * Falls back to `'ObjectOS'` when the server hasn't been contacted yet.
 * Operators override via `OS_PRODUCT_NAME` env var or
 * `new RuntimeConfigPlugin({ productName: 'Acme Studio' })`.
 */
export function getProductName(): string {
  return current.branding?.productName || 'ObjectOS';
}

export function getProductShortName(): string {
  return current.branding?.productShortName || getProductName();
}

/**
 * Product lifecycle stage — drives the top-bar preview/beta badge. Defaults to
 * `'preview'` until the server (or an operator override) says otherwise, so the
 * whole platform reads as preview out of the box; set `'ga'` to hide the badge.
 */
export function getPlatformStage(): PlatformStage {
  return current.branding?.stage ?? 'preview';
}

export function getBrandColor(): string {
  return current.branding?.brandColor || '#4F46E5';
}

export function getLogoUrl(): string | undefined {
  return current.branding?.logoUrl;
}

export function getFaviconUrl(): string | undefined {
  return current.branding?.faviconUrl;
}

export function getPwaDescription(): string {
  return current.branding?.pwaDescription || `${getProductName()} — runtime console`;
}

export function getPwaThemeColor(): string {
  return current.branding?.pwaThemeColor || getBrandColor();
}

/** Whether `initRuntimeConfig()` has run at least once. */
export function isRuntimeConfigInitialised(): boolean {
  return initialised;
}

/**
 * Resolve the upstream cloud base URL the SPA should target. When the
 * runtime answers `cloudUrl: ''` the SPA stays on the current origin; that
 * says where requests go, not who serves them (see
 * `AppShellRuntimeConfig.cloudUrl`). Otherwise this returns the
 * server-supplied URL with no trailing slash.
 */
export function getCloudBase(): string {
  return current.cloudUrl ?? '';
}

/**
 * Is a marketplace catalog reachable from this runtime? (objectui#5504)
 *
 * Reads the server's OWN answer — `features.marketplace`, which
 * `RuntimeConfigPlugin` derives per request from the serving app's route
 * table (objectstack#8356), i.e. "is a `/api/v1/marketplace/*` browse surface
 * actually mounted here". On a runtime deployed with `OS_CLOUD_URL=off`
 * (`none` / `local` / `disabled` alike) the host mounts no marketplace proxy,
 * so the flag arrives `false` while `/api/v1/runtime/config` itself is still
 * served — the EE image wires runtime-config unconditionally and the
 * cloud-dependent surfaces only when `resolveCloudUrl()` is truthy.
 *
 * ⛔ Never infer this from the SHAPE OF A FAILURE. A 404/503 from the
 * marketplace route is equally what a control plane that is merely DOWN
 * produces, and a page that concludes "disabled by configuration" from it
 * tells an operator their config is the problem while their control plane
 * burns. The flag is a property of the runtime's own routing table; a broken
 * upstream leaves it `true` and the load failure stays a load failure.
 *
 * Fails OPEN (`!== false`): a runtime predating `/api/v1/runtime/config`, or
 * one whose config fetch failed, keeps the default `true` and the marketplace
 * stays exactly as visible as it was before this gate existed. Withholding a
 * working capability on an unanswered question is the worse direction.
 */
export function isMarketplaceEnabled(): boolean {
  return current.features?.marketplace !== false;
}

/**
 * Is AI-driven metadata authoring ("online development") offered by this
 * runtime? (objectui#5521 / objectui#5577)
 *
 * Reads the server's OWN answer — `features.aiStudio`, which the runtime
 * derives per request from the same resolution that decides whether the
 * metadata-authoring agent is mounted at all. On the composed hosted-SaaS shape
 * it arrives `false` while the ToolRegistry holds zero authoring handlers and
 * `/api/v1/meta/*` answers 403, so the SPA withholds the authoring entry points
 * instead of offering a front door the backend refuses.
 *
 * Distinct from the PER-PRINCIPAL authoring capability (`useCanAuthorMetadata`):
 * this is the DEPLOYMENT's answer ("is authoring offered here at all"), that one
 * is the caller's ("may THIS principal author"). Both gates are real and neither
 * substitutes for the other.
 *
 * ⛔ Never infer this from the SHAPE OF A FAILURE. A 403/404 from `/api/v1/meta/*`
 * is equally what a permission denial — or a control plane that is merely DOWN —
 * produces, and a page that concludes "authoring is disabled on this runtime"
 * from it tells an operator their deployment is the problem while the real one is
 * their credentials or their upstream. The flag is a property of the runtime's
 * own capability set; a broken upstream leaves it `true` and the failure stays a
 * failure.
 *
 * Fails OPEN (`!== false`): a runtime predating `/api/v1/runtime/config`, or one
 * whose config fetch failed, keeps the default `true` and the AI authoring
 * affordances stay exactly as visible as they were before this gate existed.
 * Withholding a working capability on an unanswered question is the worse
 * direction — the server refuses the write regardless.
 *
 * `features?.` is load-bearing, not decoration. It is why this doctrine belongs
 * in ONE place instead of being retyped per call site: a caller reached through a
 * PARTIAL runtime-config snapshot (a host, or a sibling suite standing the module
 * in as `getRuntimeConfig: () => ({ branding })`) sees `features` genuinely
 * absent, and reading `.aiStudio` off `undefined` is a TypeError — a crash, not a
 * fail-open. PR #5575 measured that exact un-chained shape crashing 29 tests
 * across 4 suites before it was corrected.
 */
export function isAiStudioEnabled(): boolean {
  return current.features?.aiStudio !== false;
}

/**
 * Does this runtime serve `GET /api/v1/usage/storage`? (objectui#11002)
 *
 * Reads the server's OWN answer — `features.storageUsage`, which the cloud
 * distribution derives from its composition (cloud#2481): `true` exactly when
 * the endpoint is mounted, and no key at all on every other runtime. Both
 * console surfaces that read that one response, `StorageUsageBanner` and
 * `ReadRateBanner`, gate their request on this one boolean, so a runtime that
 * does not serve the endpoint is never asked.
 *
 * ⛔ Never infer this from the SHAPE OF A FAILURE. "Ask once and remember the
 * 404" spends the very request this flag exists to withhold, and reads a
 * control plane that is merely down as a runtime without the endpoint.
 *
 * Fails CLOSED (`=== true`), the opposite direction from
 * {@link isMarketplaceEnabled} and {@link isAiStudioEnabled}. Those withhold a
 * working capability on an unanswered question; this one decides whether to
 * make a request at all, and every unanswered question — a runtime predating
 * the key, a self-hosted runtime, a failed config fetch — is precisely the
 * population that would answer it with a 404. The cloud runtime that serves
 * the endpoint is also the one that serves the flag.
 *
 * `features?.` for the reason {@link isAiStudioEnabled} gives: a caller reached
 * through a partial snapshot sees `features` absent, and that must read as off,
 * not throw.
 */
export function isStorageUsageServed(): boolean {
  return current.features?.storageUsage === true;
}

/**
 * Has the host asked for no app switcher when the viewer is served one app?
 * (objectui#12913, {@link AppShellRuntimeConfig.hideSingleAppSwitcher})
 *
 * The request half of the rule only. The other half — exactly one active,
 * un-hidden app in the viewer's list — is `AppSwitcher`'s to count, off the
 * list it draws, so the count and the dropdown cannot read two lists.
 *
 * Fails CLOSED to today's chrome (`=== true`): every runtime that does not
 * serve the key keeps its switcher.
 */
export function isSingleAppSwitcherHidden(): boolean {
  return current.hideSingleAppSwitcher === true;
}

/**
 * The error-reporting sink this deployment's runtime served, or `null` for
 * "send nothing" (objectui#5522 / objectstack#12681).
 *
 * The whole telemetry configuration cloud#1508 asked for, from the one place a
 * platform user can reach. An air-gapped on-premises EE Console was measured
 * sending 14 Sentry envelopes per session to `sentry.io` carrying IP +
 * User-Agent PII, and could not be silenced because every knob in
 * `observability/sentry.ts` was a Vite build-time variable that Vite inlines as
 * a frozen literal. `@object-ui/console` publishes ONE pre-built SPA that the
 * hosted SaaS console and the on-prem/air-gapped EE images both embed, so the
 * artifact cannot tell those postures apart and editing env vars on the
 * deployed host does nothing. These values come from the server on every boot,
 * so they CAN — and ObjectStack's users, who never build this frontend, can
 * finally turn reporting ON as well as off.
 *
 * ⛔ Fails CLOSED, the opposite direction from {@link isMarketplaceEnabled} and
 * {@link isAiStudioEnabled} above — do not "make it consistent" with them.
 * Those withhold a working capability on an unanswered question, which is the
 * worse direction for a feature; here an unreported error is recoverable and
 * PII leaving an air-gapped deployment is not, so every unanswered question
 * must land on silence. Concretely: a runtime predating the key, a third-party
 * host, a 404 and a network failure all serve no DSN and read as OFF — which
 * is exactly the set of runtimes leaking today.
 *
 * The DSN's presence IS the grant, so this returns the configuration rather
 * than a boolean: there is no second question to ask, and a caller holding a
 * non-null result is holding everything it needs. See `observability/sentry.ts`
 * for the one place that consumes it.
 */
export function getClientErrorReporting(): RuntimeClientErrorReporting | null {
  return current.telemetry?.errorReporting ?? null;
}

/** Test/dev helper. */
export function resetRuntimeConfigForTesting(): void {
  current = {
    ...defaults,
    features: { ...defaults.features },
    branding: { ...defaults.branding },
    telemetry: { ...defaults.telemetry },
  };
  initialised = false;
}
