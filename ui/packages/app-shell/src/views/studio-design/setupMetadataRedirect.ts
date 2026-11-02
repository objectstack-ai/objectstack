// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Where a Setup metadata URL lands now that Setup carries no metadata editor
 * and no metadata catalog (objectstack ADR-0146 D1, D11 "Retire"; N-28).
 *
 * Every `/apps/<app>/metadata/...` URL, and every legacy alias that chained
 * into one, opens Studio's "All metadata" area (`metadataArea.ts`) on the same
 * page: the area mounts the metadata-admin pages under the same route shapes,
 * so the path below `metadata` carries over as it is. The query carries over
 * too, because `?package=`, `?scope=environment` and `?review=1` keep their
 * Setup meaning there. The URL is put on the leg its query names here, with
 * {@link areaLocationRedirect}, so an old link lands in one hop.
 *
 * ⛔ Not the datasource. D1 places it in Setup (runtime configuration, not
 * metadata authoring), and the area sends every datasource URL back to Setup's
 * Datasources page, so redirecting it here would loop.
 */

import { STUDIO_ALL_PACKAGES_SEGMENT, areaLocationRedirect, studioMetadataAreaPath } from './metadataArea.js';

/** The one metadata type whose Setup pages stay in Setup (ADR-0146 D1). */
export const SETUP_KEPT_METADATA_TYPE = 'datasource';

/**
 * The Studio URL for a Setup metadata URL, or `null` when the URL stays in
 * Setup (a datasource page).
 *
 * `rest` is the path below `…/metadata` as the URL spells it (encoded), `''`
 * at the root: `object`, `object/account`, `permission/admin/history`,
 * `_diagnostics`. `search` is the URL's query, with or without its `?`, and
 * `hash` its fragment, with its `#`.
 */
export function setupMetadataStudioPath(rest: string, search: string, hash = ''): string | null {
  const segments = rest.split('/').filter(Boolean);
  if (segments[0] === SETUP_KEPT_METADATA_TYPE) return null;
  const tail = segments.join('/');
  const onLeg = areaLocationRedirect(STUDIO_ALL_PACKAGES_SEGMENT, tail, search);
  if (onLeg) return `${onLeg}${hash}`;
  const query = new URLSearchParams(search).toString();
  return `${studioMetadataAreaPath(STUDIO_ALL_PACKAGES_SEGMENT)}${tail ? `/${tail}` : ''}${query ? `?${query}` : ''}${hash}`;
}

/**
 * The part of an app path below its `metadata` segment, or `null` when the
 * path is not one of the metadata routes: `/apps/setup/metadata/object/account`
 * → `object/account`, `/apps/crm/metadata` → `''`. The app segment is the first
 * one after `/apps`, so an app named `metadata` still reads right.
 */
export function setupMetadataRest(pathname: string): string | null {
  const match = /^\/apps\/[^/]+\/metadata(?:\/(.*))?$/.exec(pathname);
  if (!match) return null;
  return (match[1] ?? '').replace(/\/+$/, '');
}

/**
 * Where a bookmark of the retired Setup › Packaged automation page lands
 * (`/apps/<app>/component/automation/packaged`, ADR-0146 D11): Studio's
 * Automations pillar, where a packaged flow's switch and its New similar are
 * (D4).
 *
 * The pillar is a package's, so `?package=<id>` names which one, and is kept
 * with the rest of the query (`?package=all`, the cross-package spelling the
 * area reads, names none). With no package named (the page listed every
 * package's flows), the URL opens the cross-package list of flows in the "All
 * metadata" area, which lists the same flows and opens each one.
 */
export function packagedAutomationStudioPath(search: string, hash = ''): string {
  const params = new URLSearchParams(search);
  const query = params.toString();
  const tail = `${query ? `?${query}` : ''}${hash}`;
  const pkg = params.get('package');
  if (pkg && pkg !== 'all') return `/studio/${encodeURIComponent(pkg)}/automations${tail}`;
  return `${studioMetadataAreaPath(STUDIO_ALL_PACKAGES_SEGMENT)}/flow${tail}`;
}
