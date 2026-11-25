// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The addresses of Studio's "All metadata" area (objectstack ADR-0146 D1,
 * #28561): its routes, the one reserved segment it adds, and the pillar each
 * pillar type opens in. Pure, so the routing rules are pinned without a render.
 *
 * ## Two legs
 *
 *  - Per package: `/studio/<package>/metadata/...`, beside the pillars of
 *    that package. The metadata-admin pages, mounted unchanged, scoped to it.
 *  - Across packages: `/studio/~all/metadata/...`. The environment catalog
 *    (positions, capabilities, permission sets, sharing rules), whose items
 *    have one name per deployment and may belong to no package (ADR-0131 D3),
 *    served in the environment scope (`?scope=environment`), as Setup's catalog
 *    serves it today. Outside that scope, a type's list here is the list
 *    across every package, each row opening its owning package (#29566).
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

import { CATALOG_SCOPE_PARAM, ENVIRONMENT_SCOPE } from '../metadata-admin/catalog-scope.js';
import { LIST_SOURCE_PARAM } from '../metadata-admin/metadataListState.js';
import {
  STUDIO_ALL_PACKAGES_SEGMENT,
  STUDIO_ITEM_PILLAR,
  STUDIO_ITEM_REVIEW_PARAM,
  STUDIO_ITEM_REVIEW_VALUE,
  STUDIO_ORG_SCOPE_SEGMENT,
  STUDIO_ORG_SCOPE_TYPE,
  studioItemPillar,
  studioMetadataAreaAddress,
  studioMetadataAreaRoot,
  studioMetadataItemAddress,
  studioPillarItemAddress,
  type StudioPillarKey,
} from './studioAddress.js';
import { STUDIO_ORG_SCOPE_SOURCE, isStudioOrgScope, studioOrgScopePath } from './studioScope.js';

// objectstack#36895 — the area's segments are Studio address vocabulary, owned
// by `studioAddress.ts`; re-exported under their names here.
export { STUDIO_METADATA_AREA, STUDIO_ALL_PACKAGES_SEGMENT } from './studioAddress.js';
export type { StudioPillarKey } from './studioAddress.js';

/** Whether a `/studio/:packageId` route segment names the cross-package leg. */
export function isStudioAllPackagesScope(segment: string | null | undefined): boolean {
  return segment === STUDIO_ALL_PACKAGES_SEGMENT;
}

/** The area's root for a package, or for the cross-package leg with {@link STUDIO_ALL_PACKAGES_SEGMENT}. */
export function studioMetadataAreaPath(segment: string): string {
  return studioMetadataAreaRoot(segment);
}

/**
 * ADR-0146 D1 — "A pillar type opened from the directory opens its pillar".
 * The types each pillar designs; every other type opens the area's generic
 * item page.
 *
 * objectstack#36502 — pages, dashboards, reports and views have no pillar
 * since the Interfaces pillar retired: they are designed in the running app,
 * and this area's generic item page is where they are read and, as a
 * fallback, edited as metadata.
 */
export const AREA_PILLAR_FOR_TYPE: Readonly<Record<string, StudioPillarKey>> = STUDIO_ITEM_PILLAR;

/** The area's generic item page of one item of a package. */
export function studioMetadataItemPath(packageId: string, item: { type: string; name: string }): string {
  return studioMetadataItemAddress(packageId, item.type, item.name);
}

/** A pillar of a package, opened on one item through its `?surface=` deep link. */
export function studioPillarItemPath(
  packageId: string,
  pillar: StudioPillarKey,
  item: { type: string; name: string },
): string {
  return studioPillarItemAddress(packageId, pillar, item);
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
  const pillar = studioItemPillar(input.type);
  if (!pillar || !input.packageId) return null;
  if (areaItemAsksGenericPage(input.search)) return null;
  return studioPillarItemPath(input.packageId, pillar, { type: input.type, name: input.name });
}

/**
 * The query a pillar type's item honours on the generic item page rather than
 * its designer: the environment scope (which names no package to design in)
 * and `?review=1` (the generic page's draft review). {@link areaItemPillarPath}
 * keeps a pillar type there under it; objectstack#36903 — a designer page does
 * too, so a review link (`studioItemReviewPath`) still opens the review.
 */
export function areaItemAsksGenericPage(search: URLSearchParams): boolean {
  if (search.get(CATALOG_SCOPE_PARAM) === ENVIRONMENT_SCOPE) return true;
  return search.get(STUDIO_ITEM_REVIEW_PARAM) === STUDIO_ITEM_REVIEW_VALUE;
}

/**
 * Studio redesign epic #36890 (ADR-0146 D1 as amended) — the types whose item,
 * on a package's leg, opens its designer full-screen in the area rather than
 * the generic item page. objectstack#36903: the flow designer
 * (`AutomationsPillar`, fixed on one flow). A designer card adds its type here
 * in the PR that deletes the type's row from `STUDIO_ITEM_PILLAR`.
 */
export const AREA_DESIGNER_PAGE_TYPES: readonly string[] = Object.freeze(['flow']);

/**
 * Whether an item of the area opens its full-screen designer page: a
 * {@link AREA_DESIGNER_PAGE_TYPES} type on a package's leg. The cross-package
 * leg names no package to design in, so it keeps the generic item page.
 */
export function areaItemOpensDesignerPage(input: { packageId: string | null; type: string }): boolean {
  return input.packageId !== null && AREA_DESIGNER_PAGE_TYPES.includes(input.type);
}

/**
 * The item an area URL opens in its full-screen designer page, read off the
 * address (`/studio/<package>/metadata/<type>/<name>[/…]`), or `null` for any
 * other URL. Studio's copilot reads it as it reads a pillar's `?surface=`
 * (cloud#1610: the URL is the one source of what is being discussed), so a
 * designer that left its pillar keeps the context the pillar gave it.
 */
export function areaDesignerItemOf(pathname: string, segment: string | null | undefined): { type: string; name: string } | null {
  if (!segment || isStudioAllPackagesScope(segment) || isStudioOrgScope(segment)) return null;
  const root = `${studioMetadataAreaRoot(segment)}/`;
  if (!pathname.startsWith(root)) return null;
  const [rawType, rawName] = pathname.slice(root.length).split('/');
  // `<root>/<type>/new` is the area's create page (it routes before the item),
  // never an item called `new`.
  if (!rawType || !rawName || rawName === 'new') return null;
  try {
    const type = decodeURIComponent(rawType);
    const name = decodeURIComponent(rawName);
    return areaItemOpensDesignerPage({ packageId: segment, type }) ? { type, name } : null;
  } catch {
    return null;
  }
}

/**
 * objectstack#36903 — the flow the package-less scope's area opens in the flow
 * designer, read off its address (`/studio/~org/metadata/flow/<name>[/…]`), or
 * `null` for any other URL. The scope's area holds its flows alone
 * ({@link orgScopeAreaRedirect}) and names no package, so the shared
 * {@link areaDesignerItemOf} (a package's leg) never answers for it.
 */
export function orgScopeFlowOf(pathname: string, segment: string | null | undefined): { type: string; name: string } | null {
  if (!isStudioOrgScope(segment)) return null;
  const root = `${studioMetadataAreaRoot(STUDIO_ORG_SCOPE_SEGMENT)}/`;
  if (!pathname.startsWith(root)) return null;
  const [rawType, rawName] = pathname.slice(root.length).split('/');
  if (!rawType || !rawName || rawName === 'new') return null;
  try {
    const type = decodeURIComponent(rawType);
    return type === STUDIO_ORG_SCOPE_TYPE ? { type, name: decodeURIComponent(rawName) } : null;
  } catch {
    return null;
  }
}

/**
 * objectstack#28569 (ADR-0146 Consequences) — the types whose item opens the
 * area's simplified form editor (`StudioBundleItemEditor`): the fields Setup's
 * form offers beside the type's preview, and Customize on a read-only base.
 * Both are `overridable` in the spec's classification.
 */
export const AREA_FORM_EDITOR_TYPES: readonly string[] = ['email_template', 'translation'];

/**
 * objectstack#30064 (ADR-0146 D2) — the types whose item opens the same editor
 * on a READ-ONLY package only, where it is the item's Customize door: an
 * analytics dataset, which no pillar designs. The editor mounts the type's
 * registered designer (`DatasetDefaultInspector`) and preview. On a writable
 * package the generic item page stays the dataset's editor, as on Setup's.
 * `overridable` in the spec's classification.
 *
 * objectstack#36502 — a view, a dashboard, a report and a page too. Their
 * Customize door was the Interfaces pillar's; with that pillar retired, a
 * read-only base's item of these types is customized here, in its registered
 * designer (`ViewDefaultInspector`, `DashboardDefaultInspector`,
 * `ReportDefaultInspector`, `PageDefaultInspector`), into the base's pair.
 */
export const AREA_CUSTOMIZE_EDITOR_TYPES: readonly string[] = ['dataset', 'view', 'dashboard', 'report', 'page'];

/**
 * Whether an item of the area opens the form editor rather than the generic
 * item page: a form-editor type, or on a read-only package a customize-editor
 * type, on a package's leg, under the same exceptions as
 * {@link areaItemPillarPath} (the cross-package leg and the environment scope
 * name no package to write, and `?review=1` opens the generic page's draft
 * review).
 */
export function areaItemOpensFormEditor(input: {
  packageId: string | null;
  type: string;
  search: URLSearchParams;
  /** The package is read-only (the area's gate). */
  readOnly?: boolean;
}): boolean {
  const opens =
    AREA_FORM_EDITOR_TYPES.includes(input.type) ||
    (input.readOnly === true && AREA_CUSTOMIZE_EDITOR_TYPES.includes(input.type));
  if (!opens || !input.packageId) return false;
  if (input.search.get(CATALOG_SCOPE_PARAM) === ENVIRONMENT_SCOPE) return false;
  return input.search.get(STUDIO_ITEM_REVIEW_PARAM) !== STUDIO_ITEM_REVIEW_VALUE;
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
 *  - the cross-package leg with no `?package=` stays as it is: a URL that
 *    names no package lists across packages, and no page repairs one in
 *    (#29566);
 *  - the package-less scope (`~org`, as the segment or as `?package=`) names
 *    no package, so it is never written into `?package=` (#36899).
 *    objectstack#36903 — it has an area of one type, its flows
 *    ({@link orgScopeAreaRedirect}).
 *
 * `rest` is the path below the area's root as the URL spells it (encoded),
 * `''` at the root; `search` is the URL's query, with or without its `?`.
 */
export function areaLocationRedirect(segment: string, rest: string, search: string): string | null {
  const params = new URLSearchParams(search);
  if (isStudioOrgScope(segment) || isStudioOrgScope(params.get('package'))) return orgScopeAreaRedirect(segment, rest, params);
  const allLeg = isStudioAllPackagesScope(segment);
  const at = (leg: string) => studioMetadataAreaAddress(leg, rest, { query: params });

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

/**
 * objectstack#36903 — where a URL of the package-less scope's area belongs,
 * or `null` when it is already there. The scope's area serves its flows alone
 * (`studioScope.ts`): the list, a flow, and a flow's `/history`, each with the
 * scope's source filter (`?source=runtime`) and no `?package=`.
 *
 *  - a link on the scope's leg that names a real package (a packaged row the
 *    author reached by clearing the list's source filter) re-roots onto that
 *    package's leg, as a package's own leg does (`?package=all`, the
 *    cross-package leg);
 *  - a `?package=~org` link from another leg lands on the scope's leg, on the
 *    same flow;
 *  - any other path (the directory, another type, a create — the scope
 *    creates nothing) lands on the scope's list.
 */
function orgScopeAreaRedirect(segment: string, rest: string, params: URLSearchParams): string | null {
  const pkg = params.get('package');
  const onScope = isStudioOrgScope(segment);
  if (onScope && pkg && !isStudioOrgScope(pkg)) {
    return studioMetadataAreaAddress(pkg === ALL_PACKAGES_VALUE ? STUDIO_ALL_PACKAGES_SEGMENT : pkg, rest, { query: params });
  }
  const [rawType = '', rawName = '', ...below] = rest.split('/');
  let type: string;
  try {
    type = decodeURIComponent(rawType);
  } catch {
    type = '';
  }
  const flowPath =
    type === STUDIO_ORG_SCOPE_TYPE && rawName !== 'new' && (below.length === 0 || (below.length === 1 && below[0] === 'history'));
  if (!flowPath) return studioOrgScopePath();
  const next = new URLSearchParams(params);
  next.delete('package');
  next.delete(CATALOG_SCOPE_PARAM);
  next.set(LIST_SOURCE_PARAM, STUDIO_ORG_SCOPE_SOURCE);
  const settled =
    onScope &&
    !params.has('package') &&
    !params.has(CATALOG_SCOPE_PARAM) &&
    params.get(LIST_SOURCE_PARAM) === STUDIO_ORG_SCOPE_SOURCE;
  if (settled) return null;
  return studioMetadataAreaAddress(STUDIO_ORG_SCOPE_SEGMENT, rest.replace(/\/+$/, ''), { query: next, segmentEncoding: 'verbatim' });
}
