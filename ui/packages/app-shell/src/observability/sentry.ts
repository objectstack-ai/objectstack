/**
 * Sentry integration — configured by the RUNTIME, on `/api/v1/runtime/config`.
 *
 * Design goals:
 *  - **Zero cost when disabled.** `@sentry/react` is dynamically imported only
 *    when the runtime served a DSN, so deployments without Sentry pay zero
 *    bundle bytes and issue no third-party request at all.
 *  - **Graceful degradation.** If init fails (network, a hosting-layer CSP,
 *    etc.) we log a warning and continue — the host app must still render.
 *  - **One source of truth.** Every knob that decides WHAT is sent arrives in
 *    one object from one place.
 *
 * ## Fail direction: when in doubt, DO NOT SEND (objectui#5522)
 *
 * An air-gapped EE deployment was measured sending 14 Sentry envelopes per
 * session to sentry.io with IP + User-Agent PII, unstoppable by the customer
 * (objectstack-ai/cloud#1508). `@object-ui/console` publishes ONE pre-built SPA
 * that both the hosted SaaS console and the on-premises / air-gapped EE images
 * embed, so anything baked into the bundle lands inside customer networks and
 * cannot be reconfigured afterwards.
 *
 * Hence this module fails CLOSED, the opposite of the usual gate: an unreported
 * error is recoverable, PII leaving an air-gapped deployment is not.
 *
 * ## Why the DSN moved to the server (objectstack#12681)
 *
 * The first fix made the DSN a build-time `VITE_SENTRY_DSN` and added a runtime
 * PERMISSION beside it, so reporting needed both. That closed the leak and
 * opened a different hole, which the maintainer named on 2026-08-27, verbatim
 * and untranslated:
 *
 * > 「我是一个开发平台呀，我的用户并不会去构建我的前端，我理解这种应该在服务端传进去。」
 *
 * ObjectStack's users consume a PREBUILT console. They cannot set a build-time
 * key, so under the two-key gate a self-hosting operator could not enable error
 * reporting at all: the permission was reachable and the source was not. The
 * DSN — and every knob that must travel with it — now arrives from the runtime,
 * and `VITE_SENTRY_DSN` is retired rather than kept as a second path.
 *
 * ```
 * send  ⇔  the RUNTIME served a DSN
 * ```
 *
 * **The DSN's presence IS the grant**, and there is no companion boolean. That
 * is not shorthand: two knobs in two places produced two silent dead states
 * ("permission on, no DSN" / "DSN in, permission off") that look identical from
 * the browser. One knob cannot disagree with itself. Turning reporting off is
 * unsetting the server DSN — there is deliberately no build-time force-off left
 * to forget, because on a prebuilt console nobody can reach one anyway.
 *
 * Runtime config consumed — the whole telemetry decision, from
 * `telemetry.errorReporting` on `/api/v1/runtime/config`:
 *
 *  - `dsn`                       — the sink. Absent/unreachable ⇒ do not send.
 *  - `sendDefaultPii`            — IP + User-Agent. Opt-in.
 *  - `environment`               — event tag; falls back to Vite's `MODE`.
 *  - `tracesSampleRate`          — transaction sampling.
 *  - `replaysOnErrorSampleRate`  — error-session replay sampling.
 *
 * Env vars consumed — exactly one, and it is a property of the BUILD:
 *
 *  - `VITE_SENTRY_RELEASE` — which bundle produced a stack trace. It must match
 *    the source maps that bundle's pipeline uploaded, and a server cannot know
 *    which Console build it is serving, so this one stays build-time. Falls
 *    back to the console's build identity (`buildIdentity.ts`: `VITE_APP_VERSION`,
 *    or the git sha the console's Vite config baked), then `'unknown'`.
 *
 * @module
 */

import { getClientErrorReporting, type RuntimeClientErrorReporting } from '../runtime-config.js';
import { resolveConsoleBuild, type BuildIdentityEnv } from '../buildIdentity.js';

type SentryModule = typeof import('@sentry/react');

let sentryModule: SentryModule | null = null;
let initPromise: Promise<boolean> | null = null;

/** The outcome of {@link resolveSentryGate}. */
export interface SentryGateDecision {
  /** Whether reporting may start at all. */
  enabled: boolean;
  /**
   * Why — useful in tests and when explaining a silent deployment.
   *
   * Two values, not four. `forced-off` retired with `VITE_SENTRY_ENABLED`, and
   * `runtime-denied` COLLAPSED INTO `no-dsn`: once the DSN is the grant, "the
   * runtime declined" and "no DSN arrived" are the same state, described from
   * the same one place an operator has to look.
   */
  reason: 'no-dsn' | 'opted-in';
  /** The DSN, or `''` when there is none. */
  dsn: string;
  /** Whether IP address + User-Agent may be attached to events. */
  sendDefaultPii: boolean;
  /** Event `environment` tag, or `''` to let the caller fall back to `MODE`. */
  environment: string;
  /** Transaction sampling, `0`..`1`. */
  tracesSampleRate: number;
  /** Error-session replay sampling, `0`..`1`. */
  replaysOnErrorSampleRate: number;
}

/** What a withheld verdict looks like. Never carries PII or a sample rate. */
const WITHHELD: SentryGateDecision = {
  enabled: false,
  reason: 'no-dsn',
  dsn: '',
  sendDefaultPii: false,
  environment: '',
  tracesSampleRate: 0,
  replaysOnErrorSampleRate: 0,
};

/**
 * The whole telemetry decision, as a pure function of its ONE input: what the
 * runtime served.
 *
 * Split out from {@link initSentry} deliberately. The decision is the part with
 * the security consequence, and leaving it inline made it unreachable from
 * tests: this repo's Vitest setup exposes only `BASE_URL`/`DEV`/`MODE`/`PROD`/
 * `SSR` on `import.meta.env`, and `vi.stubEnv` writes to `process.env` WITHOUT
 * reaching `import.meta.env` (measured — a suite that stubbed a DSN and
 * asserted "enabled" failed, because the module never saw it). An untestable
 * gate is how the previous one stayed broken; this one is pinned case by case
 * in `sentry.test.ts`.
 *
 * The parameter is REQUIRED and nullable rather than optional. Both spellings
 * fail closed, but only a required parameter makes the compiler refuse a caller
 * that never considered the question — and "a caller that never considered the
 * question" is this defect class entirely. Callers read it from
 * {@link getClientErrorReporting}, which owns the fail-closed reading of the
 * payload.
 *
 * It takes no `env` argument any more, and that absence is the point: nothing
 * a build was compiled with can influence whether reporting happens. The one
 * surviving build-time value (`VITE_SENTRY_RELEASE`) is a label on the events,
 * never a gate, so it is read at the call site instead of here.
 */
export function resolveSentryGate(
  runtimeErrorReporting: RuntimeClientErrorReporting | null,
): SentryGateDecision {
  // No runtime-served sink ⇒ nothing to send to. This is the state every
  // deployment inherits when nobody asked for telemetry — and also the state a
  // failed fetch, a 404, an older runtime and a not-yet-arrived config all
  // produce, which is why it must mean silence.
  if (!runtimeErrorReporting) return WITHHELD;

  // `typeof`, not truthiness: a JS caller outside this type can hand over
  // anything, and only a real non-empty string is a sink.
  const dsn = typeof runtimeErrorReporting.dsn === 'string' ? runtimeErrorReporting.dsn.trim() : '';
  if (!dsn) return WITHHELD;

  return {
    enabled: true,
    reason: 'opted-in',
    dsn,
    // OPT-IN, not opt-out: `=== true`, so no truthy lookalike on the wire can
    // turn on IP + User-Agent collection.
    sendDefaultPii: runtimeErrorReporting.sendDefaultPii === true,
    environment:
      typeof runtimeErrorReporting.environment === 'string'
        ? runtimeErrorReporting.environment.trim()
        : '',
    tracesSampleRate: rate(runtimeErrorReporting.tracesSampleRate, 0.1),
    replaysOnErrorSampleRate: rate(runtimeErrorReporting.replaysOnErrorSampleRate, 0),
  };
}

/** A finite `0`..`1` rate, or the default. The reader already checked; this is the belt. */
function rate(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1
    ? value
    : fallback;
}

/** The slice of `import.meta.env` {@link resolveSentryRelease} reads. */
export interface SentryReleaseEnv extends BuildIdentityEnv {
  readonly VITE_SENTRY_RELEASE?: unknown;
}

/**
 * The release Sentry tags events with: `VITE_SENTRY_RELEASE` when the build set
 * one, else the console's build identity — read through `resolveConsoleBuild`,
 * the same one read the help menu's About dialog shows (objectui#12970) — else
 * `'unknown'`.
 */
export function resolveSentryRelease(env: SentryReleaseEnv): string {
  const explicit = typeof env.VITE_SENTRY_RELEASE === 'string' ? env.VITE_SENTRY_RELEASE.trim() : '';
  return explicit || resolveConsoleBuild(env) || 'unknown';
}

/**
 * Returns the loaded Sentry module, or `null` if Sentry was never initialized
 * (e.g. the runtime served no DSN). Callers must handle the null case.
 */
export function getSentry(): SentryModule | null {
  return sentryModule;
}

/**
 * Initializes Sentry if the runtime served a DSN. Safe to call multiple times —
 * only the first invocation runs.
 *
 * @returns `true` if Sentry was initialized, `false` if disabled or failed.
 */
export function initSentry(): Promise<boolean> {
  if (initPromise) return initPromise;

  initPromise = (async () => {
    const env = (import.meta as any).env ?? {};
    // Read at init time, not at module-eval time: this is a server-pushed
    // value, so it is only meaningful once `initRuntimeConfig()` has settled.
    // Until then — and if the fetch failed, or the runtime predates the key —
    // it reads as no sink, so an `initSentry()` that runs too early withholds
    // telemetry rather than starting it. Ordering is the caller's to get right;
    // the failure mode of getting it wrong is silence, not a leak.
    const gate = resolveSentryGate(getClientErrorReporting());
    // Returning BEFORE the dynamic import is load-bearing, not an early-exit
    // micro-optimisation: it keeps the vendor-sentry chunk unfetched, so a
    // deployment that configured nothing issues no third-party request at all —
    // not even one to load the SDK.
    if (!gate.enabled) return false;

    try {
      const Sentry = (await import('@sentry/react')) as SentryModule;

      Sentry.init({
        dsn: gate.dsn,
        // The operator's tag when they set one, the build's mode otherwise —
        // a client-side fallback for a client-side fact, never a second gate.
        environment: gate.environment || env.MODE || 'production',
        // The ONE build-time value left, and it is a label rather than a gate:
        // a release identifies which bundle produced a stack trace and has to
        // match the source maps that bundle's pipeline uploaded, which no
        // server can know.
        release: resolveSentryRelease(env),
        tracesSampleRate: gate.tracesSampleRate,
        // IP address + User-Agent — decided by `resolveSentryGate` above, and
        // OPT-IN there. Defaulting it on is how PII left an air-gapped network
        // in the first place (objectui#5522).
        sendDefaultPii: gate.sendDefaultPii,
        // Replay of ERROR sessions only, and only at the rate the operator
        // asked for. Whole-session replay stays off and is not authorable —
        // nothing pulls it, and it is a strictly larger surface.
        replaysSessionSampleRate: 0,
        replaysOnErrorSampleRate: gate.replaysOnErrorSampleRate,
        // Browser tracing — captures pageloads + navigation transactions.
        integrations: [Sentry.browserTracingIntegration()],
        // Strip query strings + Authorization from breadcrumbs before send.
        beforeBreadcrumb(breadcrumb) {
          if (breadcrumb.category === 'fetch' || breadcrumb.category === 'xhr') {
            if (breadcrumb.data?.url && typeof breadcrumb.data.url === 'string') {
              breadcrumb.data.url = stripSensitive(breadcrumb.data.url);
            }
          }
          return breadcrumb;
        },
      });

      sentryModule = Sentry;
      return true;
    } catch (err) {
      console.warn('[sentry] init failed; continuing without observability:', err);
      return false;
    }
  })();

  return initPromise;
}

/**
 * Reports an error to Sentry if initialized; otherwise no-op. Use this from
 * ErrorBoundary or any catch block where you want best-effort reporting.
 */
export function captureError(error: unknown, context?: Record<string, unknown>): void {
  if (!sentryModule) return;
  try {
    sentryModule.captureException(error, context ? { extra: context } : undefined);
  } catch {
    // never let observability break the host app
  }
}

/**
 * Sets the active user context for subsequent events. Pass `null` on logout.
 */
export function setSentryUser(user: { id?: string; email?: string; username?: string } | null): void {
  if (!sentryModule) return;
  try {
    sentryModule.setUser(user);
  } catch {
    /* swallow */
  }
}

function stripSensitive(url: string): string {
  try {
    const u = new URL(url, 'http://localhost');
    // Drop common token-shaped query params before sending to Sentry.
    for (const key of ['token', 'access_token', 'id_token', 'apiKey', 'api_key', 'password']) {
      if (u.searchParams.has(key)) u.searchParams.set(key, '[redacted]');
    }
    return u.pathname + (u.searchParams.toString() ? '?' + u.searchParams.toString() : '');
  } catch {
    return url;
  }
}
