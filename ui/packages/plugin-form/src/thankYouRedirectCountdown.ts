/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * objectui#5083 — the thank-you panel's "Redirecting in {{seconds}} seconds…"
 * copy is a promise made in ALL TEN locale packs
 * (`packages/i18n/src/locales/*.ts`, key `publicForm.redirecting`, documented
 * as "the remaining seconds"). The number used to be computed exactly once —
 * at the render that first shows the panel, as
 * `Math.ceil(pendingRedirect.delayMs / 1000)` — and never touched again:
 * accurate the instant it was drawn, then a static prop pretending to be a
 * countdown for the rest of the wait (3 full seconds, unmoving, on the
 * default delay).
 *
 * This hook owns the ticking half of that promise, on the SAME ownership
 * model PR #5070 established for the redirect wait itself
 * (`thankYouRedirectNavigation.ts`) — restated rather than reinvented,
 * because objectui#5049 already paid for getting that model wrong once on
 * this exact component:
 *
 * - keyed on the ACCEPTED destination (`PendingThankYouRedirect`), not the
 *   authored one — a destination the guard refused never reaches here with a
 *   non-null value, same as the navigation wait (objectui#5073);
 * - an effect owns the interval for exactly as long as `pending` stands, and
 *   its cleanup — which runs on unmount AND on every change of identity of
 *   `pending` (a fresh accept, or `handleReset`'s `setPendingRedirect(null)`)
 *   — is the only thing that ever cancels it. Nothing here reaches for a
 *   module-level or ref-only handle the way the pre-#5049 code did.
 *
 * ## Why the count is *state*, ticked by the interval — not re-derived from
 * `Date.now()` on every render
 *
 * A render-time `Date.now() - startedAt` reading would make the visible
 * number ride on WHEN React happens to re-render this component for
 * unrelated reasons, rather than ticking on its own — the same "looks live,
 * isn't" failure this file exists to fix, just harder to notice in a
 * short-lived panel. Explicit per-second state, advanced only by the
 * interval that owns the wait, is the one source both the display and the
 * wait agree on.
 *
 * ## Why the initial value is ALSO assigned during render, not only inside
 * the effect
 *
 * `pending` is a plain object recreated on every accepted submit — a new
 * identity, not a mutation of the old one — so "the destination changed" is
 * detected by comparing it against the previously rendered value DURING
 * render (the React-documented "adjusting state when a prop changes"
 * pattern: https://react.dev/learn/you-might-not-need-an-effect), rather
 * than waiting for the commit-then-effect round trip. Without it, the first
 * paint of the thank-you panel would show the previous render's leftover
 * count (or nothing) for one frame before the effect below catches up —
 * which would fail the existing `redirectVerdictCopy` fixture asserting the
 * exact seconds text is present the instant the panel appears.
 */

import { useEffect, useState } from 'react';
import type { PendingThankYouRedirect } from './thankYouRedirectNavigation';

/** One tick per displayed second — matches the `{{seconds}}` unit the copy promises. */
export const REDIRECT_COUNTDOWN_TICK_MS = 1000;

function secondsFor(pending: PendingThankYouRedirect | null): number | null {
  return pending ? Math.max(0, Math.ceil(pending.delayMs / 1000)) : null;
}

/**
 * The remaining whole seconds of an accepted thank-you redirect wait, ticking
 * down once per second until it reaches 0. `null` while nothing is pending —
 * the panel keeps deciding on its own whether a countdown renders at all (a
 * refused destination, objectui#5073, never reaches this hook with a
 * non-null `pending`).
 *
 * Pass the same `PendingThankYouRedirect | null` value given to
 * `useThankYouRedirectNavigation`. This hook does not navigate anything and
 * does not judge the destination — it only counts down the delay that was
 * captured alongside it.
 */
export function useRedirectCountdownSeconds(pending: PendingThankYouRedirect | null): number | null {
  // Previous-value comparison for the render-time reset described above —
  // NOT a cache of the count itself.
  const [committedPending, setCommittedPending] = useState(pending);
  const [remainingSeconds, setRemainingSeconds] = useState<number | null>(() => secondsFor(pending));

  if (pending !== committedPending) {
    setCommittedPending(pending);
    setRemainingSeconds(secondsFor(pending));
  }

  useEffect(() => {
    if (!pending) return;
    const interval = setInterval(() => {
      setRemainingSeconds((prev) => {
        if (prev === null || prev <= 1) {
          // The wait this counts down is owned elsewhere
          // (`useThankYouRedirectNavigation`); once the display reaches 0
          // there is nothing left to report, so the interval stops itself
          // rather than ticking into negative numbers for a panel that is
          // about to be replaced.
          clearInterval(interval);
          return 0;
        }
        return prev - 1;
      });
    }, REDIRECT_COUNTDOWN_TICK_MS);
    // Unmount, or `pending` changing identity — cancels the interval. Same
    // cleanup shape as `useThankYouRedirectNavigation`, for the same
    // objectui#5049 reason: an interval nobody owns outlives the component
    // that armed it.
    return () => clearInterval(interval);
  }, [pending]);

  return remainingSeconds;
}
