// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The LIVE half of the `?surface=<type>:<name>` deep-link plumbing — the half
 * {@link file://./useSurfaceDeepLink.ts} describes and never had.
 *
 * That module captures the URL target ONCE, at mount, and that is deliberate:
 * a pillar that re-read the param would re-trigger its restore on every
 * in-pillar selection, because the MIRROR half writes the param back on each
 * one. The consequence is that a producer already inside a mounted pillar —
 * the pending-changes sheet's pre-publish security block, which names the
 * draft the publish door would refuse as `object/crmext_visit` — can write the
 * param and move nothing at all.
 *
 * So the live target travels BESIDE the URL rather than through it, which is
 * what keeps the mount-time ref intact instead of replacing it:
 *
 *  - PRODUCERS call {@link useSurfaceNavigator}. It returns `null` wherever no
 *    host is listening, and that null IS the degradation contract: the sheet
 *    is shared with the Home / draft-preview bar, where the Studio object
 *    editor is not a reachable destination at all, and a dead link there is
 *    worse than the prose it would replace. `null` means "render the prose".
 *  - SUBSCRIBERS (the pillars) read {@link useRequestedSurface}. Every request
 *    carries a monotonic `id` and must be applied AT MOST ONCE: a pillar that
 *    kept re-resolving a standing request would yank the author off their own
 *    selection on the next rail reload — precisely the regression the
 *    mount-time ref exists to prevent.
 *
 * Deliberately its own module rather than more of `useSurfaceDeepLink.ts`: a
 * producer subscribes with React alone, while that module pulls in
 * `nav-selection.js` (and through it the App-nav inspector) for its
 * parse/format pair. The sheet reaches this file from the console's eager
 * graph, so the import it does not make is the point.
 */

import * as React from 'react';
import type { SurfaceTarget } from './useSurfaceDeepLink.js';

/** A surface asked for AFTER mount, stamped so subscribers apply it once. */
export interface SurfaceRequest {
  target: SurfaceTarget;
  /** Monotonic within one provider. Compare against the last id you applied. */
  id: number;
}

interface SurfaceDeepLinkChannel {
  requested: SurfaceRequest | null;
  request: (target: SurfaceTarget) => void;
}

const SurfaceDeepLinkContext = React.createContext<SurfaceDeepLinkChannel | null>(null);

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
   * Host-side effects of a request — switching pillars, closing the surface
   * the producer lives in. Return `false` to VETO it (the host asked about
   * unsaved edits and the author declined): the request is then never
   * published, so no pillar can act on it later either.
   */
  onRequest?: (target: SurfaceTarget) => boolean | void;
  children: React.ReactNode;
}): React.ReactElement {
  const [requested, setRequested] = React.useState<SurfaceRequest | null>(null);
  const idRef = React.useRef(0);
  // Held in a ref so a host that rebuilds its handler each render does not
  // churn `request`'s identity — producers pass it straight into effect deps.
  const onRequestRef = React.useRef(onRequest);
  React.useEffect(() => {
    onRequestRef.current = onRequest;
  });
  const request = React.useCallback((target: SurfaceTarget) => {
    if (onRequestRef.current?.(target) === false) return;
    idRef.current += 1;
    setRequested({ target, id: idRef.current });
  }, []);
  const value = React.useMemo(() => ({ requested, request }), [requested, request]);
  // `createElement` rather than JSX so this stays a `.ts` module alongside the
  // hook it completes, instead of forcing a rename of a file four pillars and
  // their tests import.
  return React.createElement(SurfaceDeepLinkContext.Provider, { value }, children);
}

/**
 * Producer side: ask the host to open a surface, or `null` when nothing is
 * listening. Callers MUST branch on the null and render prose instead of a
 * link — the null is the documented degradation, not a failure.
 */
export function useSurfaceNavigator(): ((target: SurfaceTarget) => void) | null {
  return React.useContext(SurfaceDeepLinkContext)?.request ?? null;
}

/** Subscriber side: the standing request, or `null` outside a provider. */
export function useRequestedSurface(): SurfaceRequest | null {
  return React.useContext(SurfaceDeepLinkContext)?.requested ?? null;
}
