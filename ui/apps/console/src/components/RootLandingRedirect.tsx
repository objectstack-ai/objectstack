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
 * display-only badge. (A deploy-time ops override is intentionally kept
 * server-side, not read here — the metadata declaration is the source of
 * truth.)
 *
 * Those three rules are the PHONE's, after its last app
 * ({@link resolvePhoneLandingPath}). From 768 px up the platform home page is
 * retired (objectstack#36732): `/` and the old `/home` address both resolve
 * through {@link resolveDesktopLandingPath} — the last-used app, the declared
 * default, the first product app — and only a viewer with no product app at
 * all is left on `/home`, which then draws the no-apps empty state.
 */

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import {
  useMetadata,
  LoadingFallback,
  RedirectWithSplash,
  SETUP_APP_PACKAGE_ID,
  SETUP_APP_NAME,
  isPlatformBuiltinApp,
  useLastApp,
  useLauncherApps,
  usePhoneViewport,
  useServedApps,
} from '@object-ui/app-shell';
import type { MetadataTypeStatus } from '@object-ui/app-shell';

/** Minimal shape this resolver needs off each App metadata record. */
// A type alias, not an interface: `useServedApps` takes records indexable by
// string, which an interface never is.
type LandingApp = {
  name?: string;
  isDefault?: boolean;
  active?: boolean;
  hidden?: boolean;
  /** ADR-0048 owning package — the canonical identity of a shipped app. */
  _packageId?: string;
};

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
 * The ONE segment that addresses `app` among `apps` (ADR-0048 option A): its
 * package id whenever that resolves back to this very app, else its name — a
 * package shipping several apps leaves the name as the only address that
 * reaches the later ones. The same answer as app-shell's `appAddressSegment`,
 * spelled out here for the reason rule 1 below gives for not importing the
 * chrome's policy; `landingHomeParity-7256.test.ts` holds the two equal.
 *
 * Landing on the name used to leave the whole session on the name alias while
 * the sidebar built every link on the package id (objectstack-ai/objectstack#26183).
 */
function landingSegment(apps: readonly LandingApp[], app: LandingApp & { name: string }): string {
  const pkg = app._packageId;
  if (!pkg) return app.name;
  const resolved = apps.find((a) => a?._packageId === pkg) ?? apps.find((a) => a?.name === pkg);
  return resolved === app ? pkg : app.name;
}

/**
 * The path a phone's `/` redirects to when it knows no last app, resolved
 * purely from the App list. Extracted from the component so the policy is
 * unit-testable without a router/render. A desktop resolves through
 * {@link resolveDesktopLandingPath} instead (objectstack#36732).
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
  if (defaultApp) return `/apps/${landingSegment(apps ?? [], defaultApp)}`;

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
  //    apps yet — and under ObjectUI ADR-0075 the environment layer's home is the
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
  if (visible.length === 1 && !isPlatformSetupApp(visible[0])) return `/apps/${landingSegment(apps ?? [], visible[0])}`;

  // 3. Multi-app default: the workspace launcher.
  return '/home';
}

/**
 * The path `/` redirects to on a phone (objectstack#35881): the app this
 * person last had open, when it is still an active, visible app; otherwise
 * the three rules of {@link resolveLandingPath} (the declared default, the one
 * app, the app list at `/home`).
 *
 * The order is the maintainer's ruling (record 7045309332 on #35881, Sales
 * 2026-11-20 16:50Z, 「上次用的优先」): the last app beats a declared default,
 * which decides only a first sign-in with no last app yet. From 768 px up `/`
 * resolves through {@link resolveDesktopLandingPath}.
 */
export function resolvePhoneLandingPath(
  apps: readonly LandingApp[] | null | undefined,
  lastApp: string | null | undefined,
): string {
  return lastAppLandingPath(apps, lastApp) ?? resolveLandingPath(apps);
}

/**
 * The last app's own address, when `lastApp` still names an active, visible
 * app of the list; `null` otherwise (no record, or an app since removed,
 * hidden or switched off).
 */
function lastAppLandingPath(
  apps: readonly LandingApp[] | null | undefined,
  lastApp: string | null | undefined,
): string | null {
  if (!lastApp) return null;
  const list = apps ?? [];
  const last = list.find(
    (a): a is LandingApp & { name: string } =>
      a?.name === lastApp && a.active !== false && a.hidden !== true,
  );
  return last ? `/apps/${landingSegment(list, last)}` : null;
}

/**
 * Is this an app somebody put into the environment, rather than one the
 * platform ships into every deployment (Setup, Studio, Account)? Setup by its
 * own two-way test (a runtime/DB Setup carries no package id), the rest by the
 * platform's reserved package namespace (`isPlatformBuiltinApp`, the reading
 * the first-run checklist's "Put your first app in" row takes).
 */
function isProductApp(app: LandingApp): boolean {
  return !isPlatformSetupApp(app) && !isPlatformBuiltinApp(app);
}

/**
 * The path `/` — and the retired `/home` address — redirect to from 768 px up
 * (objectstack#36732, the maintainer's ruling to retire the platform home
 * page, 2026-11-23 14:30Z 「同意」).
 *
 *   1. the app this person last had open, while it is still an active,
 *      visible app (the order of the #35881 ruling, 「上次用的优先」);
 *   2. else the App the product declares `isDefault`;
 *   3. else the first visible PRODUCT app of the list — never a platform
 *      built-in: a viewer whose only apps are Setup or Studio has no product
 *      app yet (objectui#4048);
 *   4. else `/home`, which on a desktop draws only the no-apps empty state.
 *
 * Rule 3 is where a desktop parts from the phone: a phone with several apps
 * and no record still opens its app list (`resolveLandingPath` rule 3).
 *
 * The console chrome asks the same question for its Home affordances
 * (app-shell's `resolveDesktopHomePath`, read by `useHomePath`), and
 * `landingHomeParity-7256.test.ts` holds the two answers equal.
 */
export function resolveDesktopLandingPath(
  apps: readonly LandingApp[] | null | undefined,
  lastApp: string | null | undefined,
): string {
  const last = lastAppLandingPath(apps, lastApp);
  if (last) return last;
  const list = (apps ?? []).filter((a): a is LandingApp & { name: string } => Boolean(a?.name));
  const defaultApp = list.find((a) => a.isDefault === true);
  if (defaultApp) return `/apps/${landingSegment(apps ?? [], defaultApp)}`;
  const first = list.find((a) => a.active !== false && a.hidden !== true && isProductApp(a));
  if (first) return `/apps/${landingSegment(apps ?? [], first)}`;
  return '/home';
}

/**
 * How long `/` waits for the person's last app to be read before it resolves
 * without it (objectstack#35881, and from 768 px up objectstack#36732). The
 * row rides the console's one preference read, which is normally in by the
 * time the app list is.
 */
const LAST_APP_WAIT_MS = 2000;

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

export interface RootLandingRedirectProps {
  /**
   * What to draw when the landing resolves to `/home` itself. The `/home`
   * route passes its no-apps page here, so the retired address redirects into
   * an app whenever there is one and draws the empty state only when there is
   * none (objectstack#36732). Absent on `/`, which redirects to `/home`.
   */
  home?: ReactNode;
}

export function RootLandingRedirect({ home }: RootLandingRedirectProps = {}) {
  const { apps, loading, getTypeStatus, refresh } = useMetadata();
  const location = useLocation();
  // objectstack#35881 — a phone lands in the person's last app, and from
  // 768 px up so does a desktop (objectstack#36732).
  const phone = usePhoneViewport();
  // objectstack#36732 — a desktop chooses only among the apps the member's
  // permission sets show (`/me/apps`, the answer every launcher surface reads):
  // a set-hidden app is never the landing. That answer is held under `/home`
  // and `/apps/*`, not `/`, so a desktop `/` hands off to `/home` below.
  const servedApps = useServedApps((apps ?? []) as LandingApp[]);
  const { pending: servedPending } = useLauncherApps(apps as LandingApp[] | undefined);
  const { lastApp, settled: lastAppSettled } = useLastApp();
  const [lastAppWaitOver, setLastAppWaitOver] = useState(false);
  useEffect(() => {
    if (lastAppSettled) return;
    const id = setTimeout(() => setLastAppWaitOver(true), LAST_APP_WAIT_MS);
    return () => clearTimeout(id);
  }, [lastAppSettled]);

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

  // From 768 px up, `/` (a sign-in, the SSO callback) goes to `/home`, the one
  // desktop resolver, which sits inside the `/me/apps` provider.
  if (!phone && home === undefined) {
    return <RedirectWithSplash to={`/home${location.search}${location.hash}`} replace state={location.state} />;
  }
  if (loading || unresolved) return <LoadingFallback />;
  if (!lastAppSettled && !lastAppWaitOver) return <LoadingFallback />;
  if (!phone && servedPending) return <LoadingFallback />;
  // `RedirectWithSplash`, not a bare `<Navigate>` (objectui#6378). This is the
  // widest measured instance of the boot blank: the line above holds the splash
  // while the app list loads, and handing off to a null-rendering redirect left
  // `#root` empty for 147 ms while `/home` rendered at transition priority. The
  // splash is unchanged across the handoff, so the boot reads as one screen.
  //
  // Search and hash carry over (objectstack-ai/objectstack#27450): the URL
  // overlays (`?palette=1`, `?recordId=`) live in the query, and the landing is
  // a bare `/apps/<segment>` or `/home`, so there is nothing to merge with. The
  // app root it lands on carries them on to the app's own landing in turn.
  const landing = phone
    ? resolvePhoneLandingPath(apps as LandingApp[] | undefined, lastApp)
    : resolveDesktopLandingPath(servedApps, lastApp);
  if (home !== undefined && landing === '/home') return <>{home}</>;
  return <RedirectWithSplash to={`${landing}${location.search}${location.hash}`} replace state={location.state} />;
}
