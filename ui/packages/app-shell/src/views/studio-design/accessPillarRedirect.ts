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
 * Pure: no React, no router.
 */

import { DESIGNER_SURFACE_PARAM, parseSurfaceParam } from '../metadata-admin/nav-selection.js';
import { studioMetadataAreaAddress, studioMetadataItemAddress, studioOwdOverviewPath } from './studioAddress.js';

/** The `?surface=` value the retired pillar opened its sharing overview on. */
export const ACCESS_PILLAR_OWD_SURFACE = { type: 'owd', name: 'overview' } as const;

/** The address an Access pillar URL of `packageId` redirects to; `search` is its query, with or without its `?`. */
export function accessPillarRedirect(packageId: string, search: string): string {
  const params = new URLSearchParams(search);
  const surface = parseSurfaceParam(params.get(DESIGNER_SURFACE_PARAM));
  params.delete(DESIGNER_SURFACE_PARAM);
  if (surface?.type === ACCESS_PILLAR_OWD_SURFACE.type) return studioOwdOverviewPath(packageId, { query: params });
  params.set('package', packageId);
  if (surface?.type === 'permission' && surface.name) {
    return studioMetadataItemAddress(packageId, 'permission', surface.name, { query: params });
  }
  return studioMetadataAreaAddress(packageId, 'permission', { query: params });
}
