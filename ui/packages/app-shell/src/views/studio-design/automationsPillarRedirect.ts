// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#36903 (Studio redesign epic #36890, step 3 of the address
 * table's switch) — where the retired Automations pillar's address lands.
 *
 * A flow opens its designer full-screen on its metadata address
 * (`/studio/<package>/metadata/flow/<name>`), and the package-less scope's
 * flows on that scope's own leg (`/studio/~org/metadata/flow/<name>`,
 * `studioScope.ts`). The pillar's addresses are bookmarks, test pins and links
 * an AI was handed, so each still opens what it named:
 *
 *  - `/automations?surface=flow:<name>` → that flow's designer;
 *  - `/automations` with no flow named, or naming another type → the flow
 *    list of the same scope (the pillar opened its first flow; the list is
 *    where a flow is chosen now, decision 7).
 *
 * The pillar's own qualifiers go (`?surface=`, and `?view=` and `?nav=`, which
 * opened nothing on a flow); everything else is kept verbatim, `?changes=review`
 * (the server's draft review link, `studioChangesReviewLink`) included. On a
 * package's leg the area adds `?package=` itself (`areaLocationRedirect`).
 *
 * Pure, so the mapping is pinned without a render.
 */

import { LIST_SOURCE_PARAM } from '../metadata-admin/metadataListState.js';
import { DESIGNER_SURFACE_PARAM, parseSurfaceParam } from '../metadata-admin/nav-selection.js';
import { studioMetadataItemAddress, studioMetadataTypePath } from './studioAddress.js';
import { isStudioOrgScope, studioOrgScopePath } from './studioScope.js';
import { DESIGNER_SURFACE_NAV_PARAM, DESIGNER_SURFACE_VIEW_PARAM } from './useSurfaceDeepLink.js';

/** The pillar's qualifiers that do not travel to the metadata address. */
const PILLAR_ONLY_PARAMS: readonly string[] = [DESIGNER_SURFACE_PARAM, DESIGNER_SURFACE_VIEW_PARAM, DESIGNER_SURFACE_NAV_PARAM];

function withQuery(path: string, params: URLSearchParams): string {
  const query = params.toString();
  if (!query) return path;
  return `${path}${path.includes('?') ? '&' : '?'}${query}`;
}

/**
 * Where `/studio/<segment>/automations<search>` lands. `segment` is the route
 * segment as read (a package id, or `~org`); `search` is the URL's query, with
 * or without its `?`.
 */
export function automationsPillarRedirect(segment: string, search: string): string {
  const params = new URLSearchParams(search);
  const target = parseSurfaceParam(params.get(DESIGNER_SURFACE_PARAM));
  const flow = target?.type === 'flow' && target.name ? target.name : null;
  for (const key of PILLAR_ONLY_PARAMS) params.delete(key);
  if (isStudioOrgScope(segment)) {
    // The scope names no package: a `?package=` it was handed is not carried,
    // and its own address already carries the scope's source filter.
    params.delete('package');
    params.delete(LIST_SOURCE_PARAM);
    return withQuery(studioOrgScopePath(flow ? { type: 'flow', name: flow } : undefined), params);
  }
  if (flow) return studioMetadataItemAddress(segment, 'flow', flow, { query: params });
  return withQuery(studioMetadataTypePath(segment, 'flow'), params);
}
