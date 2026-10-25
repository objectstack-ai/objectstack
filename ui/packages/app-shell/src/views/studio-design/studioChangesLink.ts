// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The one declared way into Studio's 变更 (Changes) drawer from outside its
 * top bar (objectui#12894, objectui#12725): `?changes=review` on a Studio
 * pillar URL.
 *
 * `StudioDesignSurface` reads it, opens the drawer in its review posture and
 * drops the param (replace), the way the metadata designer consumes
 * `?review=1`: a refresh or a Back does not reopen the drawer. It is a request
 * to OPEN, not a mirror of the drawer's state; the drawer's own buttons still
 * open and close it.
 *
 * Page-scoped, like `?surface=`: the Studio route's own contract, so it is not
 * in `urlParams.ts`'s reserved registry, and no reserved param is named
 * `changes`.
 *
 * The writer is the copilot's applied card (查看变更并发布), through
 * `ChatPane`: inside the package's Studio the param goes onto the current
 * location, so the surface stays mounted and keeps its selection; from
 * anywhere else (the full-page chat, the console dock) the link opens the
 * package's Interfaces pillar with it.
 */

/** The query key the surface reads. */
export const STUDIO_CHANGES_PARAM = 'changes';

/** The one value it acts on: open the drawer to review the pending drafts. */
export const STUDIO_CHANGES_REVIEW = 'review';

/** Where to go, and whether the move replaces the current history entry. */
export interface StudioChangesTarget {
  to: string;
  replace: boolean;
}

/**
 * The navigation that opens `packageId`'s 变更 drawer from `current`.
 *
 *  - Already on one of that package's Studio pillars: the same path, search
 *    and hash with the param set, replacing the entry. No route changes, so
 *    nothing remounts.
 *  - Anywhere else: the package's Interfaces pillar with the param, as a new
 *    entry (Back returns to where the user was).
 */
export function studioChangesReviewTarget(
  packageId: string,
  current: { pathname: string; search: string; hash?: string },
): StudioChangesTarget {
  const base = `/studio/${encodeURIComponent(packageId)}`;
  const onPillar = current.pathname.startsWith(`${base}/`) && current.pathname.length > base.length + 1;
  if (onPillar) {
    const params = new URLSearchParams(current.search);
    params.set(STUDIO_CHANGES_PARAM, STUDIO_CHANGES_REVIEW);
    return { to: `${current.pathname}?${params.toString()}${current.hash ?? ''}`, replace: true };
  }
  return {
    to: `${base}/interfaces?${STUDIO_CHANGES_PARAM}=${STUDIO_CHANGES_REVIEW}`,
    replace: false,
  };
}
