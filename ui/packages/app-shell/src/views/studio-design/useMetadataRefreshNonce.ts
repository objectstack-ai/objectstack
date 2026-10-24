// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#7255 — turn the assistant bus's live-metadata pulse into a render
 * dependency the Studio pillars can list next to `publishNonce` / `draftNonce`.
 *
 * Why this exists: the Studio workbench and the AI copilot are the SAME
 * document (the copilot is the right dock, ADR-0057 P3c). When a copilot turn
 * stages or publishes metadata, `ChatPane` already announces it on the
 * assistant bus (`emitMetadataRefresh()` — the same pulse `usePendingDrafts`
 * and `MetadataProvider` converge on). The pillars' rails never listened, so a
 * just-applied object / nav item stayed invisible until a full page reload.
 * This hook is the missing half: the pulse becomes a number, the rails' load
 * effects list it, and each refetch is exactly the package-scoped read that
 * went stale — no polling, no remount, no `location.reload()`.
 *
 * `hold` is the edit-buffer guard. A pillar whose rail load also rehydrates an
 * EDIT BUFFER (the Interfaces pillar re-reads `app` into `appDraft`, which the
 * nav editor patches in place) must not let a background pulse overwrite
 * unsaved work. Passing `hold` while the buffer is dirty defers the pulse
 * rather than dropping it: the nonce advances the moment the hold lifts, so
 * the rail still converges once the author's edits are saved. Coalescing is
 * deliberate — several pulses during one hold release as a single refetch.
 */

import { useEffect, useState } from 'react';
import { subscribeMetadataRefresh } from '../../assistant/assistantBus.js';

/**
 * A monotonic counter that advances on every live-metadata pulse.
 *
 * @param hold - while true, pulses are recorded but not released to consumers.
 * @returns the released nonce — stable across renders until a pulse lands.
 */
export function useMetadataRefreshNonce(hold = false): number {
  // Two counters, not one: `received` advances the instant the bus fires (a
  // pulse is never lost to a hold), `released` is what consumers depend on.
  const [received, setReceived] = useState(0);
  const [released, setReleased] = useState(0);

  useEffect(() => subscribeMetadataRefresh(() => setReceived((n) => n + 1)), []);

  useEffect(() => {
    if (hold) return;
    // React bails out when the reducer returns the current value, so this is a
    // no-op render-wise while no pulse is outstanding.
    setReleased((cur) => (cur === received ? cur : received));
  }, [hold, received]);

  return released;
}
