/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * hiddenTabPollStop — the ONE rule for when a forgotten tab stops polling
 * (objectui#12439).
 *
 * A backgrounded tab used to poll its feeds at the hidden cadence forever. On a
 * backend that scales to zero, any poll inside the idle window keeps the server
 * awake, and a 60 s poll is always inside it: one tab left open on a console
 * page kept two staging containers running around the clock. So a tab that has
 * been hidden CONTINUOUSLY for {@link HIDDEN_POLL_STOP_MS} stops polling until
 * the user comes back to it.
 *
 * Every timer poller that reads the tab's visibility consults this module
 * rather than carrying its own copy of the clock — one clock, so two pollers
 * cannot disagree about how long the tab has been hidden, and a poller added
 * later cannot keep the server awake by itself by forgetting the rule.
 *
 * What a poller does with the answer:
 *
 *  - before ARMING its timer, and again when the timer FIRES, it asks
 *    {@link isPollingSuspended}. `true` means: send nothing and arm nothing.
 *  - coming back to the tab is the poller's own `visibilitychange` handler,
 *    which refetches immediately and re-arms at the foreground cadence. That
 *    handler is what ends the suspension; this module only reports it.
 *
 * "Continuously" is the whole definition: the clock starts at each hide and a
 * visible spell, however short, resets it.
 *
 * Not exported from the package entry — it is an internal rule of this
 * package's pollers, not a public surface.
 *
 * @module
 */

/**
 * How long a tab may stay hidden before its pollers stop arming their timers.
 * A constant, not a knob: the cost (a desktop notification for an inbox
 * message that arrives after this point waits until the user returns to the
 * tab) was accepted for this value when it was chosen.
 */
export const HIDDEN_POLL_STOP_MS = 10 * 60_000;

/** When the tab was last seen going hidden; `null` while it is visible. */
let hiddenSince: number | null = null;
let listening = false;

function documentHidden(): boolean {
  return typeof document !== 'undefined' && document.hidden;
}

/**
 * Record each hide as it happens, so a hide → show → hide between two polls
 * restarts the clock even though no poller looked in between.
 */
function onVisibilityChange(): void {
  if (documentHidden()) {
    if (hiddenSince === null) hiddenSince = Date.now();
  } else {
    hiddenSince = null;
  }
}

function ensureListening(): void {
  if (listening || typeof document === 'undefined') return;
  document.addEventListener('visibilitychange', onVisibilityChange);
  listening = true;
}

/**
 * How long the tab has been continuously hidden, in ms; `0` while it is
 * visible (or outside a browser).
 *
 * The visibility is read from `document.hidden` at the time of the call, so
 * the answer does not depend on whether this module's listener ran before or
 * after the caller's own. A tab already hidden when first asked (opened in the
 * background) starts its clock at that first question.
 */
export function hiddenForMs(): number {
  ensureListening();
  if (!documentHidden()) {
    hiddenSince = null;
    return 0;
  }
  if (hiddenSince === null) hiddenSince = Date.now();
  return Date.now() - hiddenSince;
}

/**
 * Whether background polling is suspended: the tab has been hidden for at
 * least {@link HIDDEN_POLL_STOP_MS} without a visible spell in between.
 */
export function isPollingSuspended(): boolean {
  return hiddenForMs() >= HIDDEN_POLL_STOP_MS;
}

/** Test seam: forget the clock, as if the page had just loaded. */
export function __resetHiddenTabClock(): void {
  hiddenSince = null;
}
