// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * RootLandingRedirect — element for `<Route path="/" />`.
 *
 * Resolves the post-login landing from APP METADATA, so any product built on
 * the framework (cloud's control plane, an ISV's product, a per-project
 * runtime) declares its landing in source rather than forking the Console. This
 * replaces the previous hardcoded `PREFERRED_APPS = ['cloud_control']` redirect,
 * which baked one product's policy into the shared bundle.
 *
 * The landing is a build/dev-time PRODUCT decision, declared in metadata — not a
 * runtime, per-tenant, Settings-UI preference. Resolution order (see
 * {@link resolveLandingPath}):
 *   1. the App marked `isDefault: true` → `/apps/<it>` — and the landing page
 *      WITHIN that app is its first navigation item (by `order`); it used to
 *      be selectable with `homePageId`, retired in spec 17.0.0
 *      (objectstack#4667 / #4709);
 *   2. else the single visible App (`active !== false && hidden !== true`)
 *      → `/apps/<it>` (a one-app deployment shouldn't show a one-tile launcher)
 *      — UNLESS that one App is the platform's built-in Setup console, which
 *      means the environment has no product apps yet (objectui#4048, below);
 *   3. else `/home` — the multi-app workspace launcher (the legacy default).
 *
 * Those three rules describe a landing resolved from a KNOWN app list. Whether
 * the list is known at all is a separate question, answered before the policy
 * runs — see {@link isAppListConclusive} (objectui#4233).
 *
 * NOTE: this gives `isDefault` ROUTING semantics; it was previously a
 * display-only badge. Back-compat: a deployment with no `isDefault` App and ≥2
 * visible Apps still lands on `/home`, exactly as before. (A deploy-time ops
 * override is intentionally kept server-side, not read here — the metadata
 * declaration is the source of truth.)
 */

import { useEffect, useRef } from 'react';
import {
  useMetadata,
  LoadingFallback,
  RedirectWithSplash,
  SETUP_APP_PACKAGE_ID,
  SETUP_APP_NAME,
} from '@object-ui/app-shell';
import type { MetadataTypeStatus } from '@object-ui/app-shell';

/** Minimal shape this resolver needs off each App metadata record. */
interface LandingApp {
  name?: string;
  isDefault?: boolean;
  active?: boolean;
  hidden?: boolean;
  /** ADR-0048 owning package — the canonical identity of a shipped app. */
  _packageId?: string;
}

/**
 * Is this the platform's built-in Setup console (objectui#4048)?
 *
 * Package id first, app name as the fallback — the SAME order
 * `resolveSetupAppPath` resolves Setup in, so the `/` landing policy and the
 * `/setup` deep link cannot disagree about which app Setup is. A runtime/DB
 * app carries no `_packageId`, which is why the name alias is kept.
 */
function isPlatformSetupApp(app: LandingApp): boolean {
  return app._packageId === SETUP_APP_PACKAGE_ID || app.name === SETUP_APP_NAME;
}

/**
 * The path `/` should redirect to, resolved purely from the App list. Extracted
 * from the component so the policy is unit-testable without a router/render.
 */
export function resolveLandingPath(apps: readonly LandingApp[] | null | undefined): string {
  const list = (apps ?? []).filter((a): a is LandingApp & { name: string } => Boolean(a?.name));

  // 1. The App the product declared as default (isDefault now ROUTES, not just badges).
  //
  //    The console CHROME asks the same question — the top-bar logo and every
  //    "Home" affordance follow the declared landing rather than the launcher
  //    (objectui#7256, `app-shell`'s `resolveDeclaredHomePath` / `useHomePath`).
  //    Two readers of one declaration is exactly the drift this repo rules
  //    against, so `landingHomeParity-7256.test.ts` pins the two answers equal
  //    across a matrix. It is a real behavioural check rather than an import:
  //    this module's own routing tests replace `@object-ui/app-shell` with a
  //    chrome-free hand-rolled mock, so importing the policy from there would
  //    make the fixture, not the shipped function, the thing under test.
  const defaultApp = list.find((a) => a.isDefault === true);
  if (defaultApp) return `/apps/${defaultApp.name}`;

  // 2. A single-app deployment lands straight in that App (no one-tile
  //    launcher) — but Setup alone is NOT a one-app deployment.
  //
  //    objectui#4048: a new builder arriving on a just-created environment
  //    landed on Setup's System Overview, an audit/health dashboard reading all
  //    zeros because a fresh environment has no audit history yet. The path was
  //    this rule: the only app such a viewer can see is the platform
  //    administration console that @objectstack/platform-objects ships into
  //    EVERY deployment, so `visible.length === 1` was true and the resolver
  //    read it as "this deployment's product is Setup". `/apps/setup` then
  //    resolves to the app's first navigation item (`AppContent
  //    .resolveLandingRoute`), which for Setup is `dashboard/system_overview`.
  //
  //    "The only app I can see is Setup" means the environment has no product
  //    apps yet — and under ADR-0075 the environment layer's home is the
  //    environment's own responsibility, which is `/home` (build with AI, start
  //    from a template, Your apps). Rule 1 is deliberately left alone: a
  //    deployment that genuinely wants Setup as its first screen DECLARES it
  //    with `isDefault`, and a declared landing still wins.
  //
  //    Scoped to the SINGLE-app case on purpose. Dropping Setup from the
  //    `visible` count instead would re-route every ordinary `[product, setup]`
  //    deployment from `/home` into the product app — a far larger change than
  //    this card asks for, and one nobody measured.
  const visible = list.filter((a) => a.active !== false && a.hidden !== true);
  if (visible.length === 1 && !isPlatformSetupApp(visible[0])) return `/apps/${visible[0].name}`;

  // 3. Multi-app default: the workspace launcher.
  return '/home';
}

/**
 * Is the app list this resolver was handed an ANSWER, or an unknown standing
 * in for one? (objectui#4233)
 *
 * `resolveLandingPath` reads a LIST, and an empty list is a perfectly good
 * input to it — rule 3 answers `/home`, which is right when the emptiness is
 * REAL. What it cannot see is *why* the list is empty. A failed
 * `GET /meta/app` also produces `[]` (`MetadataProvider.ensureType` catches and
 * resolves `[]`, so `loading` goes false and nothing rejects), and the resolver
 * then reports "this deployment has no default app" about a deployment it never
 * managed to ask. That conclusion is not merely wrong, it STICKS: `Navigate
 * … replace` rewrites `/` to `/home` in history, so a reload re-enters at
 * `/home` and the `isDefault` branch never gets a second chance — and if the
 * session turns out to be dead, the auth guard captures `/home` into
 * `?redirect=%2Fhome` and honors it after sign-in. An error-state fallthrough
 * must never be fossilized as user intent.
 *
 * The distinguishing fact already exists on the metadata context and is the
 * ONE source of truth for it — `getTypeStatus('app')`, the provider's own
 * per-type load status ('idle' | 'loading' | 'ready' | 'error'). No second
 * dialect of loading/auth state is introduced here, and nothing about the
 * *policy* in `resolveLandingPath` changes: this gates whether the policy gets
 * to run at all.
 *
 * `getTypeStatus` is optional on `MetadataContextValue` and documented as
 * "absent means always ready" (hand-rolled context values in tests omit it), so
 * `undefined` is conclusive. Everything that is not a settled `ready` is not.
 */
export function isAppListConclusive(status: MetadataTypeStatus | undefined): boolean {
  if (status === undefined) return true;
  return status === 'ready';
}

/**
 * How long to wait before the single re-ask below (objectui#4233).
 *
 * Short enough that a transient failure heals before the visitor reads the
 * spinner as a hang, and comfortably past `MetadataProvider`'s
 * `ERROR_RETRY_COOLDOWN_MS` (~1s) — inside that window `ensureType` answers
 * from the failed entry instead of re-requesting, which would spend the one
 * retry on nothing.
 */
const APP_LIST_RETRY_DELAY_MS = 1500;

export function RootLandingRedirect() {
  const { apps, loading, getTypeStatus, refresh } = useMetadata();

  // "Not yet" (`loading`) and "asked and failed" (`status === 'error'`) are
  // both "no answer" — they differ only in whether waiting will help.
  const unresolved = !loading && !isAppListConclusive(getTypeStatus?.('app'));

  // Re-ask ONCE, so "produce no conclusion" is a recoverable state rather than
  // a terminal spinner: a transient failure (server restart, a request that
  // raced a session refresh) heals without the visitor doing anything, and a
  // real outage settles into a screen that is at least not a lie about which
  // apps exist. Deliberately bounded by a ref rather than by effect-dep
  // identity — `unresolved` stays true across a failed retry, so relying on the
  // deps to stop the loop would make "exactly once" a property of `refresh`'s
  // memoization instead of a property of this component.
  const retriedRef = useRef(false);
  useEffect(() => {
    if (!unresolved || retriedRef.current) return;
    retriedRef.current = true;
    const id = setTimeout(() => {
      void refresh?.('app');
    }, APP_LIST_RETRY_DELAY_MS);
    return () => clearTimeout(id);
  }, [unresolved, refresh]);

  if (loading || unresolved) return <LoadingFallback />;
  // `RedirectWithSplash`, not a bare `<Navigate>` (objectui#6378). This is the
  // widest measured instance of the boot blank: the line above holds the splash
  // while the app list loads, and handing off to a null-rendering redirect left
  // `#root` empty for 147 ms while `/home` rendered at transition priority. The
  // splash is unchanged across the handoff, so the boot reads as one screen.
  return <RedirectWithSplash to={resolveLandingPath(apps as LandingApp[] | undefined)} replace />;
}
