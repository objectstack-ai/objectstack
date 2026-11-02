// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The addresses of Studio's "All metadata" area (objectstack ADR-0146 D1,
 * #28561): its routes, the one reserved segment it adds, and the pillar each
 * pillar type opens in. Pure, so the routing rules are pinned without a render.
 *
 * ## Two legs
 *
 *  - Per package: `/studio/<package>/metadata/...`, beside the four pillars of
 *    that package. The metadata-admin pages, mounted unchanged, scoped to it.
 *  - Across packages: `/studio/~all/metadata/...`. The environment catalog
 *    (positions, capabilities, permission sets, sharing rules), whose items
 *    have one name per deployment and may belong to no package (ADR-0131 D3),
 *    served in the environment scope (`?scope=environment`), as Setup's catalog
 *    serves it today.
 *
 * ## Why `~all` and not `~org`
 *
 * `~org` (`studioScope.ts`) is the scope of the flows that belong to NO
 * package; this leg is the registry of EVERY package plus the environment's
 * own items. Two different reads, so two names: folding this leg into `~org`
 * would make the package-less scope mean "all packages" too, and its header,
 * switcher entry and drafts filter (`isOrgScopeDraft`) are the flows' alone.
 * `~` is outside every package-id alphabet (`studioScope.ts` says why), so
 * `~all` cannot name a package either. `metadata` could: it is a legal package
 * id, which is why the cross-package leg is not a bare `/studio/metadata`.
 *
 * ## The query keeps its meaning
 *
 * `?package=`, `?scope=environment` and `?review=1` mean what they mean on
 * Setup's metadata routes, so a redirect from those routes (N-28) loses no deep
 * link. {@link areaLocationRedirect} puts each URL on the leg its query names.
 */

import { DESIGNER_SURFACE_PARAM, formatSurfaceParam } from '../metadata-admin/nav-selection.js';
import { CATALOG_SCOPE_PARAM, ENVIRONMENT_SCOPE } from '../metadata-admin/catalog-scope.js';

/** The area's route segment, beside the pillars' (`/studio/<package>/metadata`). */
export const STUDIO_METADATA_AREA = 'metadata';

/** The reserved `/studio/<segment>` value for the area's cross-package leg. */
export const STUDIO_ALL_PACKAGES_SEGMENT = '~all';

/** Whether a `/studio/:packageId` route segment names the cross-package leg. */
export function isStudioAllPackagesScope(segment: string | null | undefined): boolean {
  return segment === STUDIO_ALL_PACKAGES_SEGMENT;
}

/** The area's root for a package, or for the cross-package leg with {@link STUDIO_ALL_PACKAGES_SEGMENT}. */
export function studioMetadataAreaPath(segment: string): string {
  return `/studio/${encodeURIComponent(segment)}/${STUDIO_METADATA_AREA}`;
}

/** The pillar keys a pillar type opens in (`StudioDesignSurface`'s `PILLARS`). */
export type StudioPillarKey = 'data' | 'automations' | 'interfaces' | 'access';

/**
 * ADR-0146 D1 — "A pillar type opened from the directory opens its pillar".
 * The types each pillar designs; every other type opens the area's generic
 * item page.
 *
 * Its own table, not `StudioDesignSurface`'s `PILLAR_FOR_SURFACE_TYPE`: that
 * one routes the live in-surface request channel, which the Interfaces pillar
 * answers through its nav tree alone, so it names no Interfaces type. Here the
 * four Interfaces types open the pillar by URL, where the pillar resolves an
 * item no nav entry opens through its off-nav lists.
 */
export const AREA_PILLAR_FOR_TYPE: Readonly<Record<string, StudioPillarKey>> = {
  object: 'data',
  flow: 'automations',
  page: 'interfaces',
  dashboard: 'interfaces',
  report: 'interfaces',
  view: 'interfaces',
  permission: 'access',
};

/** A pillar of a package, opened on one item through its `?surface=` deep link. */
export function studioPillarItemPath(
  packageId: string,
  pillar: StudioPillarKey,
  item: { type: string; name: string },
): string {
  return `/studio/${encodeURIComponent(packageId)}/${pillar}?${DESIGNER_SURFACE_PARAM}=${encodeURIComponent(formatSurfaceParam(item))}`;
}

/**
 * The pillar an item of the area opens in, as a path, or `null` when the
 * area's generic item page is where it opens:
 *  - a type no pillar designs;
 *  - the cross-package leg, which names no package to open a pillar of;
 *  - the environment scope, whose catalog item is the environment's, by name;
 *  - `?review=1`, which opens the draft review on the generic page, as it does
 *    on Setup's (the console's draft-review links name that page).
 */
export function areaItemPillarPath(input: {
  packageId: string | null;
  type: string;
  name: string;
  search: URLSearchParams;
}): string | null {
  const pillar = AREA_PILLAR_FOR_TYPE[input.type];
  if (!pillar || !input.packageId) return null;
  if (input.search.get(CATALOG_SCOPE_PARAM) === ENVIRONMENT_SCOPE) return null;
  if (input.search.get('review') === '1') return null;
  return studioPillarItemPath(input.packageId, pillar, { type: input.type, name: input.name });
}

/**
 * objectstack#28569 (ADR-0146 Consequences) — the types whose item opens the
 * area's simplified form editor (`StudioBundleItemEditor`): the fields Setup's
 * form offers beside the type's preview, and Customize on a read-only base.
 * Both are `overridable` in the spec's classification.
 */
export const AREA_FORM_EDITOR_TYPES: readonly string[] = ['email_template', 'translation'];

/**
 * Whether an item of the area opens the form editor rather than the generic
 * item page: a form-editor type on a package's leg, under the same exceptions
 * as {@link areaItemPillarPath} (the cross-package leg and the environment
 * scope name no package to write, and `?review=1` opens the generic page's
 * draft review).
 */
export function areaItemOpensFormEditor(input: {
  packageId: string | null;
  type: string;
  search: URLSearchParams;
}): boolean {
  if (!AREA_FORM_EDITOR_TYPES.includes(input.type) || !input.packageId) return false;
  if (input.search.get(CATALOG_SCOPE_PARAM) === ENVIRONMENT_SCOPE) return false;
  return input.search.get('review') !== '1';
}

/** `?package=all` is the metadata list's "every package" scope, not a package (`ResourceEditPage`'s `'all'` fold). */
const ALL_PACKAGES_VALUE = 'all';

/**
 * Where an area URL belongs, or `null` when it is already there. The query
 * decides the leg, so each parameter keeps its Setup meaning:
 *
 *  - `?scope=environment` is the cross-package leg. The environment scope
 *    lists every package's items and binds no package, so `?package=` is
 *    dropped there;
 *  - `?package=<id>` is that package's leg, so the route and the scope never
 *    disagree, and a link that names another package re-roots onto it;
 *  - `?package=all` is the cross-package leg, keeping the parameter;
 *  - the per-package leg with no `?package=` gets its own, because the item
 *    page binds its saves to `?package=` (`readActivePackageBinding`): without
 *    it a save in the area would leave the package;
 *  - the cross-package leg with no `?package=` stays as it is, the pages
 *    keeping their Setup meaning for a URL that names no package.
 *
 * `rest` is the path below the area's root as the URL spells it (encoded),
 * `''` at the root; `search` is the URL's query, with or without its `?`.
 */
export function areaLocationRedirect(segment: string, rest: string, search: string): string | null {
  const params = new URLSearchParams(search);
  const allLeg = isStudioAllPackagesScope(segment);
  const tail = rest ? `/${rest}` : '';
  const at = (leg: string) => {
    const qs = params.toString();
    return `${studioMetadataAreaPath(leg)}${tail}${qs ? `?${qs}` : ''}`;
  };

  if (params.get(CATALOG_SCOPE_PARAM) === ENVIRONMENT_SCOPE) {
    if (allLeg && !params.has('package')) return null;
    params.delete('package');
    return at(STUDIO_ALL_PACKAGES_SEGMENT);
  }

  const pkg = params.get('package');
  if (!pkg) {
    if (allLeg) return null;
    params.set('package', segment);
    return at(segment);
  }
  if (pkg === ALL_PACKAGES_VALUE) return allLeg ? null : at(STUDIO_ALL_PACKAGES_SEGMENT);
  return pkg === segment ? null : at(pkg);
}
