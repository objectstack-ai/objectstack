// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Where "home" is — the ONE reader of the product's declared landing.
 *
 * Two different screens have both called themselves the console's home:
 *
 *   - `/home`, the multi-app workspace launcher ("Build an app", "Start from a
 *     template", "Your apps"). Under ADR-0075 that is the ENVIRONMENT layer's
 *     home: its cards act on the environment the SPA is attached to.
 *   - `/apps/<app>`, the landing an App DECLARES with `isDefault: true`. The
 *     landing page WITHIN that app is its first navigation item (spec 17.0.0
 *     retired `app.homePageId`; position in `navigation` is the declaration).
 *
 * `RootLandingRedirect` (apps/console) has honored the declaration on `/` since
 * the hardcoded `PREFERRED_APPS = ['cloud_control']` redirect was retired. The
 * chrome did not: the top-bar logo and every "Home" affordance named `/home`
 * literally, so a deployment that declares a landing showed the customer TWO
 * homes with two different voices — and on cloud's control plane the launcher
 * one is actively wrong (objectui#7256): its "Build an app" / "Start from a
 * template" cards are environment-side actions that cannot work from the
 * control plane, and its "Your apps" tiles are the control plane's own internal
 * management apps.
 *
 * The posture signal is the App metadata the server already sends — NOT a
 * hostname sniff, and NOT a hardcoded product name. `cloud_control` is nowhere
 * in this file on purpose: baking one product's identity into the shared bundle
 * is exactly what the declaration replaced.
 *
 * Two surfaces ask this question, and they must always get the same answer:
 *   - this module, read by `useHomePath()` for the chrome — no heuristic on
 *     top, because a persistent "go home" affordance must not change target
 *     with the number of visible apps;
 *   - `resolveLandingPath` (apps/console, the `/` entry), which layers a
 *     single-visible-app EMPTINESS heuristic on its own reading of the same
 *     declaration (objectui#4048).
 *
 * `/`'s resolver deliberately does NOT import this function: its routing tests
 * replace `@object-ui/app-shell` wholesale with a chrome-free hand-rolled mock,
 * so the import would put that fixture under test instead of the shipped
 * policy. What holds the two together is a behavioural matrix comparing both
 * shipped answers — `apps/console/src/components/landingHomeParity-7256.test.ts`.
 *
 * @module
 */

/**
 * The multi-app workspace launcher — the environment layer's own home
 * (ADR-0075). The fallback whenever no App declares a landing, which is every
 * ordinary environment and therefore the unchanged status quo.
 */
export const HOME_LAUNCHER_PATH = '/home';

/** Minimal shape this resolver needs off each App metadata record. */
export interface DeclaredHomeApp {
  name?: string;
  /** ADR-0049: `isDefault` ROUTES (it used to be a display-only badge). */
  isDefault?: boolean;
}

/**
 * The path the product DECLARED as its landing, or `null` when it declared
 * none.
 *
 * The app root is the target, never a page inside it: `AppContent
 * .resolveLandingRoute()` already resolves an app root to that app's first
 * reachable navigation item, so naming a page here would fork "where does an
 * app open" into a second place and drift the moment the app's nav is
 * re-ordered.
 *
 * The segment is the app's `name` — byte-identical to what `/` has been
 * redirecting to, so the logo and the post-login landing cannot disagree.
 * (`matchAppBySegment()` accepts the name as a per-tenant alias.)
 */
export function resolveDeclaredHomePath(
  apps: readonly DeclaredHomeApp[] | null | undefined,
): string | null {
  const declared = (apps ?? []).find((a) => a?.isDefault === true && Boolean(a?.name));
  return declared ? `/apps/${declared.name}` : null;
}
