// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The LIVE `?surface=<type>:<name>` request: a producer already inside a
 * mounted Studio page — the pending-changes sheet's pre-publish security
 * block, which names the draft the publish door would refuse as
 * `object/crmext_visit` — asks the host to put the author in front of that
 * item, and the host navigates to it (`StudioDesignSurface`'s
 * `requestSurface`).
 *
 *  - PRODUCERS call {@link useSurfaceNavigator}. It returns `null` wherever no
 *    host is listening, and that null IS the degradation contract: the sheet
 *    is shared with the Home / draft-preview bar, where the Studio object
 *    editor is not a reachable destination at all, and a dead link there is
 *    worse than the prose it would replace. `null` means "render the prose".
 *  - The HOST mounts {@link SurfaceDeepLinkProvider} with its `onRequest`.
 *
 * objectstack#36909 — the request used to be published to the mounted
 * pillars too (a `requested` value each applied at most once, read through
 * `useRequestedSurface`), because a pillar captured its deep link at mount
 * and mirrored its selection back to the URL. Every pillar retired, so that
 * half had no reader left and went: an item opens on its own address now.
 *
 * Deliberately its own module rather than more of `useSurfaceDeepLink.ts`: the
 * sheet reaches this file from the console's eager graph, and a producer
 * subscribes with React alone.
 */

import * as React from 'react';
import type { SurfaceTarget } from './useSurfaceDeepLink.js';

type SurfaceRequestHandler = (target: SurfaceTarget) => void;

const SurfaceDeepLinkContext = React.createContext<SurfaceRequestHandler | null>(null);

/**
 * Publishes the channel to a host's subtree — mounting this is what makes
 * {@link useSurfaceNavigator} non-null for every producer below it, so the
 * decision "is this destination reachable here?" is answered structurally,
 * by the tree, and never by sniffing a route string.
 */
export function SurfaceDeepLinkProvider({
  onRequest,
  children,
}: {
  /**
   * Host-side effects of a request — navigating to the item, closing the
   * surface the producer lives in. It may return `false` when the author
   * declines to abandon unsaved edits; the host then stays where it is.
   */
  onRequest?: (target: SurfaceTarget) => boolean | void;
  children: React.ReactNode;
}): React.ReactElement {
  // Held in a ref so a host that rebuilds its handler each render does not
  // churn `request`'s identity — producers pass it straight into effect deps.
  const onRequestRef = React.useRef(onRequest);
  React.useEffect(() => {
    onRequestRef.current = onRequest;
  });
  const request = React.useCallback<SurfaceRequestHandler>((target) => {
    onRequestRef.current?.(target);
  }, []);
  // `createElement` rather than JSX so this stays a `.ts` module.
  return React.createElement(SurfaceDeepLinkContext.Provider, { value: request }, children);
}

/**
 * Producer side: ask the host to open a surface, or `null` when nothing is
 * listening. Callers MUST branch on the null and render prose instead of a
 * link — the null is the documented degradation, not a failure.
 */
export function useSurfaceNavigator(): SurfaceRequestHandler | null {
  return React.useContext(SurfaceDeepLinkContext);
}
