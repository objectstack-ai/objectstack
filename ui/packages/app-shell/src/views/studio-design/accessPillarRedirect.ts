// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Where an Access pillar address goes now (objectstack#36905, Studio redesign
 * epic #36890): the pillar no longer draws a page of its own, so every one of
 * its addresses lands on the page that replaced it, and an old bookmark, a
 * test pin or a link an AI was handed keeps working.
 *
 *  - `?surface=permission:<name>` opens the set at its metadata address,
 *    `/studio/<package>/metadata/permission/<name>?package=<package>`, where
 *    the "All metadata" area draws the matrix full-screen;
 *  - `?surface=owd:overview` opens the organization-wide default sharing
 *    overview's own route, `/studio/<package>/owd` (decision 11: it sits in
 *    the menu's Access group);
 *  - anything else (no `?surface=`, or one naming another type) opens the
 *    package's list of permission sets.
 *
 * Every other parameter is carried as it is (`?changes=review`, the
 * surface's own, is read on every Studio page). `?package=` is written for
 * the area's addresses, so the area does not redirect a second time
 * (`areaLocationRedirect`).
 *
 * A set a read-only base's `.custom` pair adds (ADR-0146 D3) — every "New
 * similar" copy among them — was listed on the base's pillar and opened at the
 * pair, writable, while the address kept naming the base. Such a set opens at
 * the pair's address (`setHeldIn`, decided by {@link accessPillarSetHolder}
 * from the two packages' sets): the base's own stack does not hold it.
 *
 * Pure: no React, no router. The reads live in `accessPillarLanding.tsx`.
 */

import { DESIGNER_SURFACE_PARAM, parseSurfaceParam } from '../metadata-admin/nav-selection.js';
import { studioMetadataAreaAddress, studioMetadataItemAddress, studioOwdOverviewPath } from './studioAddress.js';

/** The `?surface=` value the retired pillar opened its sharing overview on. */
export const ACCESS_PILLAR_OWD_SURFACE = { type: 'owd', name: 'overview' } as const;

/** The permission set an Access pillar URL's query opens, or `null` when it opens none. */
export function accessPillarSetName(search: string): string | null {
  const surface = parseSurfaceParam(new URLSearchParams(search).get(DESIGNER_SURFACE_PARAM));
  return surface?.type === 'permission' && surface.name ? surface.name : null;
}

/**
 * The package that holds the set `name` the base's pillar opened, as the
 * retired pillar decided it: the base when its sets (published or draft) hold
 * the name; otherwise `pairId` when the pair's do, since the pillar listed the
 * pair's sets the base does not hold and opened them there; the base else.
 * `null` sets are a read that failed: a failed pair read lists none of the
 * pair's sets, and a failed base read leaves the set on the base, whose page
 * then reports the failure.
 */
export function accessPillarSetHolder(
  packageId: string,
  name: string,
  baseSets: ReadonlySet<string> | null,
  pair: { id: string; sets: ReadonlySet<string> | null } | null,
): string {
  if (baseSets === null || baseSets.has(name)) return packageId;
  return pair?.sets?.has(name) ? pair.id : packageId;
}

/**
 * The address an Access pillar URL of `packageId` redirects to; `search` is
 * its query, with or without its `?`. `setHeldIn` is the package holding the
 * set it opens ({@link accessPillarSetHolder}), `packageId` when omitted.
 */
export function accessPillarRedirect(packageId: string, search: string, options: { setHeldIn?: string } = {}): string {
  const params = new URLSearchParams(search);
  const surface = parseSurfaceParam(params.get(DESIGNER_SURFACE_PARAM));
  params.delete(DESIGNER_SURFACE_PARAM);
  if (surface?.type === ACCESS_PILLAR_OWD_SURFACE.type) return studioOwdOverviewPath(packageId, { query: params });
  if (surface?.type === 'permission' && surface.name) {
    const holder = options.setHeldIn ?? packageId;
    params.set('package', holder);
    return studioMetadataItemAddress(holder, 'permission', surface.name, { query: params });
  }
  params.set('package', packageId);
  return studioMetadataAreaAddress(packageId, 'permission', { query: params });
}
