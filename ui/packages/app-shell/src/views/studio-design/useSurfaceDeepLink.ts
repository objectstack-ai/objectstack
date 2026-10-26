// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Shared `?surface=<type>:<name>` deep-link plumbing for the Studio pillars.
 *
 * Every pillar rail (Data / Interfaces / Automations / Access) opens ONE
 * surface at a time and used to hand-roll the same two halves — or skip them:
 *
 *  1. CAPTURE: read the `?surface=` target once, at mount, so the pillar's
 *     list-load effect can open it instead of auto-picking the first item.
 *     Captured in a ref so later in-pillar selections don't re-trigger the
 *     restore, and kept out of that effect's deps (which are keyed on the
 *     package, not the URL).
 *  2. MIRROR: write the open surface back to `?surface=` (replace) whenever it
 *     changes, so the selection is shareable and reload-stable — the inverse
 *     of the capture. Only written once a surface is open: the first render
 *     has no selection yet, and clearing the param there would strip an
 *     incoming deep-link before it is applied.
 *
 * The Interfaces pillar's surfaces are nav ENTRIES, and several can open one
 * target, so there both halves also carry the entry's id in a `?nav=` key
 * beside `?surface=` ({@link DESIGNER_SURFACE_NAV_PARAM}, objectui#11774). A
 * pillar whose surfaces carry no entry id reads and writes `?surface=` alone,
 * as before.
 *
 * InterfacesPillar pioneered the pattern (#code-block-menu-nav); the Data
 * pillar grew the capture half for the app→Studio object bridge (#2446);
 * Automations/Access had neither, so their deep-links snapped back to the
 * first item. This hook is the single canonical implementation.
 *
 * Both halves above are URL-shaped, which is exactly why a producer that is
 * ALREADY INSIDE a mounted pillar cannot use them: writing `?surface=` moves
 * nothing (capture is over) and the mirror overwrites it on the next
 * selection. The third half — a live target delivered beside the URL, applied
 * once — lives in {@link file://./surfaceDeepLinkChannel.ts}. It is additive:
 * nothing here observes it, so the mount-time ref keeps meaning exactly what
 * it meant.
 */

import * as React from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  DESIGNER_SURFACE_PARAM,
  parseSurfaceParam,
  formatSurfaceParam,
} from '../metadata-admin/nav-selection.js';

/**
 * The nav-entry qualifier of a `?surface=` deep-link (objectui#11774): the
 * spec `id` of the Interfaces nav entry that is open, `?surface=…&nav=<id>`.
 *
 * `?surface=<type>:<name>` names a TARGET, and one app may hold several nav
 * entries that open one object (data slices, named views), so the Interfaces
 * pillar adds the entry beside it. A KEY OF ITS OWN, not a `nav:<id>` value of
 * `?surface=`: every reader of that param parses it as `<type>:<name>` (each
 * pillar's restore, the app→Studio bridge in `utils/appRoute.ts`, the
 * copilot's surface context in `StudioAiCopilot`), and a second value grammar
 * would hand each of them a `nav` "type". With a separate key, `?surface=`
 * keeps meaning what it meant to all of them, and a link without `nav` — every
 * link produced before this key existed — resolves exactly as it did.
 */
export const DESIGNER_SURFACE_NAV_PARAM = 'nav';

/**
 * The surface identity carried in the URL: `?surface=` plus, on an Interfaces
 * nav entry, its id from `?nav=` (absent otherwise).
 */
export interface SurfaceTarget {
  type: string;
  name: string;
  navId?: string;
}

/**
 * Capture the mount-time `?surface=` target (returned) and mirror `current`
 * back to the URL as it changes. Pass the pillar's open surface — `null`
 * while nothing is selected yet.
 */
export function useSurfaceDeepLink(
  current: SurfaceTarget | null | undefined,
): SurfaceTarget | null {
  const [searchParams, setSearchParams] = useSearchParams();
  const initialRef = React.useRef(
    parseSurfaceTarget(searchParams.get(DESIGNER_SURFACE_PARAM), searchParams.get(DESIGNER_SURFACE_NAV_PARAM)),
  );
  // Keyed on the identity, not the object — pillars recreate their Surface
  // objects on list reload, and a same-surface rewrite is a wasted render.
  const type = current?.type;
  const name = current?.name;
  const navId = current?.navId;
  React.useEffect(() => {
    if (!type || !name) return;
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.set(DESIGNER_SURFACE_PARAM, formatSurfaceParam({ type, name }));
        // objectui#11774 — the entry travels with its target, and a surface
        // with no entry id clears it, so a `nav` left by an earlier selection
        // never qualifies a target it was not written for.
        if (navId) next.set(DESIGNER_SURFACE_NAV_PARAM, navId);
        else next.delete(DESIGNER_SURFACE_NAV_PARAM);
        return next;
      },
      { replace: true },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [type, name, navId]);
  return initialRef.current;
}

/**
 * The deep-link target in a `?surface=` value and a `?nav=` value — the
 * capture half's parse, pure for the tests. `nav` only ever qualifies a
 * surface: alone (no parsable `?surface=`) it names nothing, since the mirror
 * above never writes one without the other.
 */
export function parseSurfaceTarget(
  surface: string | null | undefined,
  nav: string | null | undefined,
): SurfaceTarget | null {
  const parsed = parseSurfaceParam(surface);
  if (!parsed) return null;
  return nav ? { ...parsed, navId: nav } : parsed;
}

/**
 * Resolve a captured deep-link against the pillar's loaded rail: the matching
 * item when the target is of this pillar's surface type AND actually exists in
 * the list, else `undefined` so the caller falls back to its first-item
 * default. Pure — unit-tested without rendering a pillar.
 */
export function resolveSurfaceDeepLink<T extends { name: string }>(
  items: readonly T[],
  initial: SurfaceTarget | null,
  expectedType: string,
): T | undefined {
  if (!initial || initial.type !== expectedType) return undefined;
  return items.find((item) => item.name === initial.name);
}
