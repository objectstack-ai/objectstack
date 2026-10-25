/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Window event the AI usage indicator (ADR-0057 #8) listens for to refetch its
 * quota headroom. A completed turn consumes tokens and a rejected send (429) means
 * the wall was hit — both change what the usage ring should show. Emitting a window
 * event keeps the indicator (in `@object-ui/app-shell`) decoupled from this chat
 * engine: no callback has to be threaded through `ChatPane`.
 */
export const AI_USAGE_REFRESH_EVENT = 'objectui:ai-usage-refresh';

/** Fire-and-forget nudge for the usage indicator. SSR-safe; never throws. */
export function emitAiUsageRefresh(): void {
  if (typeof window === 'undefined' || typeof window.dispatchEvent !== 'function') return;
  try {
    window.dispatchEvent(new CustomEvent(AI_USAGE_REFRESH_EVENT));
  } catch {
    /* CustomEvent unavailable (very old env) — the indicator just polls on its own cadence */
  }
}
