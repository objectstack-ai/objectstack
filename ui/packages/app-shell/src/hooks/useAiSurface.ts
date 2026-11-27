/**
 * useAiSurfaceEnabled
 *
 * Single source of truth for "should the in-UI AI surface be shown — for THIS
 * user, on this deployment?". The console ships under MIT and is edition- and
 * seat-agnostic at build time; it decides purely at runtime from what the
 * server reports — no `VITE_EDITION` flag, no tree-shake.
 *
 * The signal is **the agent catalog** (`GET /api/v1/ai/agents`): the surface
 * shows iff that returns >= 1 agent. The catalog is the right signal because it
 * is the ONLY one that is BOTH edition- AND user-aware:
 *
 *   • The route is access-filtered server-side (ADR-0049 / ADR-0068): it returns
 *     only the agents the CALLER may chat. A user WITHOUT the per-user AI seat
 *     (the `ai_seat` permission) gets an EMPTY catalog -> the whole AI surface
 *     hides for them, instead of showing a button that 403s on click. The
 *     deployment-wide discovery `services.ai` flag CANNOT express this — it is
 *     identical for every user — which is exactly why we do NOT gate on it.
 *   • It is ALSO the honest edition signal: a Community-Edition runtime that
 *     ships no `@objectstack/service-ai` registers no AI service and persists no
 *     agents -> empty catalog -> hidden. (The old "headless service reports
 *     available in CE" worry is moot: empty catalog hides the surface either way.)
 *
 * ⚠️  Do NOT "simplify" this back to `discovery.services.ai` (isAiEnabled): that
 * reintroduces the per-user gap — seat-less users would see the FAB / links and
 * hit 403 on click. The per-user AI-seat gate (ADR-0068) DEPENDS on this catalog
 * signal. (This reverts objectui#1992, which dropped the per-user dimension.)
 *
 * The `VITE_AI_BASE_URL` opt-in flows through naturally: {@link resolveAiApiBase}
 * points the catalog fetch at the configured server, so an external AI server
 * with reachable agents lights the surface up and an agent-less one keeps it hidden.
 *
 * `isLoading` is surfaced so the `/ai` route guard can wait for the catalog to
 * resolve before redirecting — otherwise a stale bookmark would flash a redirect
 * to home before the fetch even starts. Entry-point buttons (FAB, top-bar link,
 * designer "Ask AI") ignore it: staying hidden during the brief load is the
 * correct, flash-free behaviour for a control that must not appear unless AI can
 * actually answer.
 *
 * @module
 */

import { useAgents } from '@object-ui/plugin-chatbot/core';
import { catalogServesBuild } from './surfaceAgent.js';
import { resolveAiApiBase } from './aiApiBase.js';

// Re-exported where its callers have always imported it from.
export { resolveAiApiBase };

export interface AiSurfaceState {
  /** True when the AI UI should render — the CALLER can reach >= 1 agent (access-filtered). */
  enabled: boolean;
  /** True until the agent catalog has resolved; route guards wait on this. */
  isLoading: boolean;
  /**
   * objectstack#36969 — true when the same catalog serves the build agent
   * (alias-aware, `catalogServesBuild`): the gate for an entry that promises
   * building with AI. False while loading, and where building is closed
   * (`build` persisted inactive, `ask` still served).
   */
  buildServed: boolean;
}

/**
 * Whether the console's AI surface (FAB, `/ai` routes, "Ask AI" affordances)
 * should be shown FOR THE CURRENT USER, driven off the access-filtered agent
 * catalog (empty for seat-less users -> AI hidden; ADR-0068).
 */
export function useAiSurfaceEnabled(options: { enabled?: boolean } = {}): AiSurfaceState {
  // `enabled: false` asks nothing (objectstack#37833: the navigation gate asks
  // only while an app carries an `ai:chat` entry); the answer then reads as
  // loading, and the caller that turned the read off does not consult it.
  const { agents, settled } = useAgents({ apiBase: resolveAiApiBase(), enabled: options.enabled ?? true });

  const enabled = agents.length > 0;
  return {
    enabled,
    buildServed: catalogServesBuild(agents),
    // Agents present → resolved/available. Otherwise loading until a read has
    // answered (`settled`): the first render's empty list means "not fetched
    // yet", and a read the cache answers is never seen loading
    // (objectstack#37833).
    isLoading: enabled ? false : !settled,
  };
}
