/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `RedirectWithSplash` — a boot-path redirect that keeps the splash painted.
 *
 * ## Why this exists (objectui#6378 — measured, not guessed)
 *
 * Every readiness gate on the console boot path renders the splash while it
 * WAITS and a bare `<Navigate>` the moment it DECIDES:
 *
 * ```tsx
 * if (loading) return <LoadingFallback />;   // splash on screen
 * return <Navigate to={…} replace />;        // renders NOTHING
 * ```
 *
 * `<Navigate>` renders `null` and performs its navigation from an effect, and
 * react-router wraps that navigation in a transition — so the destination tree
 * renders at transition priority while the commit that already dropped the
 * splash is what the compositor is showing. For the whole of that window
 * `#root` holds no view at all and the viewport is the bare page background.
 *
 * Measured on the production `apps/console` bundle with the boot endpoints
 * mocked, correlating a CDP `Page.startScreencast` frame ledger against a
 * DOM-state ledger on the same clock (`performance.timeOrigin`): the window is
 * 41–147 ms wide, and whenever the compositor happens to swap a frame inside it
 * the user sees a full-viewport white flash. Both suspects named on the card
 * were exonerated by that ledger — `RouteFader` never mounts on the boot path
 * at all, and `LoadingScreen` unmounts exactly when its own gate says to. What
 * is wrong is what REPLACES it.
 *
 * ## Why the splash, and why it cannot itself flicker
 *
 * The component renders the SAME `LoadingScreen` the gate one line above was
 * already rendering, so the handoff changes no pixels: the transition now runs
 * underneath an unchanged screen instead of underneath a blank one. That is
 * also why this is not "add a spinner" — a different holding image would
 * introduce a visual change where today there is a blank, and the goal is for
 * the boot to look like one continuous screen until the destination paints.
 *
 * ## Scope
 *
 * Deliberately minimal: `to` + `replace`, the only shape the console's boot
 * redirects use. It is a boot-chrome affordance, not a general `<Navigate>`
 * replacement — a redirect that fires while a view is already on screen should
 * keep that view, not cover it with a splash.
 */

import { Navigate } from 'react-router-dom';
import { LoadingScreen } from './LoadingScreen.js';

export interface RedirectWithSplashProps {
  /** Where to go — the same value a bare `<Navigate to={…}>` would take. */
  to: string;
  /** Replace the current history entry instead of pushing a new one. */
  replace?: boolean;
}

export function RedirectWithSplash({ to, replace }: RedirectWithSplashProps) {
  return (
    <>
      {/* Order is not load-bearing — `<Navigate>` renders null — but the
          splash is written first so the element that OCCUPIES the screen reads
          first at every call site. */}
      <LoadingScreen />
      <Navigate to={to} replace={replace} />
    </>
  );
}
