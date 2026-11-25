// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The Studio address mapping table (objectstack#36895, Studio redesign epic
 * #36890): every address family Studio answers to today, every `?surface=`
 * spelling, and every query parameter, with what each one becomes when a
 * designer card moves its type to the metadata address.
 *
 * The builders are in `studioAddress.ts`; this is their map. It is data a
 * card reads before it switches a type, and data the code reads where the
 * table decides something: the retired `/interfaces` redirect keeps exactly
 * the parameters this table marks as surviving it
 * ({@link STUDIO_RETIRED_INTERFACES_KEPT_PARAMS}).
 *
 * ## How a designer card switches its type
 *
 *  1. Delete the type's row from `STUDIO_ITEM_PILLAR` (`studioAddress.ts`).
 *     Every producer calling `studioItemPath`, and the "All metadata" area's
 *     pillar redirect (`areaItemPillarPath`), then open the metadata address
 *     together, so the two never bounce.
 *  2. Carry each qualifier its row below lists onto the metadata address, or
 *     drop it, as the row's `onMetadataAddress` says.
 *  3. Add the redirect from the pillar address in that same PR.
 *  4. Update the type's row here: `today` becomes the metadata address.
 *
 * `studioAddressTable.test.ts` holds each row's example equal to its
 * builder's output, so the table cannot drift from the code.
 */

import { DESIGNER_SURFACE_PARAM } from '../metadata-admin/nav-selection.js';
import { CATALOG_SCOPE_PARAM, ENVIRONMENT_SCOPE } from '../metadata-admin/catalog-scope.js';
import {
  DESIGNER_SURFACE_ACTION_PARAM,
  DESIGNER_SURFACE_NAV_PARAM,
  DESIGNER_SURFACE_VIEW_PARAM,
} from './useSurfaceDeepLink.js';
import { STUDIO_NEW_PACKAGE_VALUE, STUDIO_NEW_PARAM } from './studioNewPackage.js';
import {
  RETIRED_INTERFACES_SEGMENT,
  STUDIO_CHANGES_PARAM,
  STUDIO_CHANGES_REVIEW,
  STUDIO_HOME_PILLAR,
  STUDIO_ITEM_REVIEW_PARAM,
  STUDIO_ITEM_REVIEW_VALUE,
  STUDIO_OWD_OBJECT_PARAM,
  STUDIO_OWD_SECTION,
  type StudioPillarKey,
  type StudioSurfaceSpelling,
} from './studioAddress.js';

// ---------------------------------------------------------------------------
// Address families
// ---------------------------------------------------------------------------

/** One shape of Studio address, as it is today. */
export interface StudioAddressFamily {
  /** Stable id. */
  readonly id: string;
  /** Today's shape; `<…>` marks a variable part. */
  readonly today: string;
  /** The `studioAddress.ts` builder that produces it. */
  readonly builder: string;
  /** What the shape is for. */
  readonly meaning: string;
}

export const STUDIO_ADDRESS_FAMILIES: readonly StudioAddressFamily[] = Object.freeze([
  {
    id: 'landing',
    today: '/studio',
    builder: 'studioLandingPath',
    meaning: "Studio's entry, no page of its own: the package last opened, else the package list (StudioEntryRedirect).",
  },
  {
    id: 'landing-new-package',
    today: `/studio?${STUDIO_NEW_PARAM}=${STUDIO_NEW_PACKAGE_VALUE}`,
    builder: 'studioLandingPath',
    meaning: "A retired bookmark: Studio's entry forwards it to Setup → Packages with New Package open.",
  },
  { id: 'package', today: '/studio/<package>', builder: 'studioPackagePath', meaning: `A package's Studio; the route lands it on its home, \`${STUDIO_HOME_PILLAR}\`, which redirects to the package's object list (objectstack#36904).` },
  { id: 'pillar', today: '/studio/<package>/<pillar>', builder: 'studioPillarPath', meaning: 'One pillar of a package: data, automations or access.' },
  {
    id: 'pillar-item',
    today: `/studio/<package>/<pillar>?${DESIGNER_SURFACE_PARAM}=<type>:<name>`,
    builder: 'studioItemPath',
    meaning: 'A pillar opened on one item. The family the designer cards move, one type at a time (STUDIO_ITEM_TYPES).',
  },
  {
    id: 'owd',
    today: `/studio/<package>/${STUDIO_OWD_SECTION}[?${STUDIO_OWD_OBJECT_PARAM}=<object>]`,
    builder: 'studioOwdOverviewPath',
    meaning: "A package's organization-wide default sharing overview (objectstack#36905), optionally on one object. Not a metadata item and not a pillar.",
  },
  { id: 'org-scope', today: '/studio/~org/automations', builder: 'studioOrgScopePath', meaning: 'The package-less scope: the organization\'s own flows.' },
  {
    id: 'org-scope-item',
    today: `/studio/~org/automations?${DESIGNER_SURFACE_PARAM}=flow:<name>`,
    builder: 'studioOrgScopePath',
    meaning: 'A package-less flow. It has no package, so no metadata address of a package; it moves with the flow designer card.',
  },
  { id: 'area-root', today: '/studio/<package or ~all>/metadata', builder: 'studioMetadataAreaRoot', meaning: 'The "All metadata" area of a package, or across packages.' },
  { id: 'area-type', today: '/studio/<package or ~all>/metadata/<type>', builder: 'studioMetadataTypePath', meaning: "A type's list in the area." },
  {
    id: 'area-item',
    today: '/studio/<package>/metadata/<type>/<name>',
    builder: 'studioMetadataItemAddress',
    meaning: "An item's page in the area: the metadata address every type moves to.",
  },
  {
    id: 'changes-review',
    today: `/studio/<package>/${STUDIO_HOME_PILLAR}?${STUDIO_CHANGES_PARAM}=${STUDIO_CHANGES_REVIEW}`,
    builder: 'studioChangesReviewPath',
    meaning: "A package's Changes drawer, opened from outside its Studio. The server's draft review link (studioChangesReviewLink in @objectstack/types) spells the same address.",
  },
  {
    id: 'item-review',
    today: `/studio/<package>/metadata/<type>/<name>?${STUDIO_ITEM_REVIEW_PARAM}=${STUDIO_ITEM_REVIEW_VALUE}`,
    builder: 'studioItemReviewPath',
    meaning: "An item's draft review. The server's draft review link (studioItemReviewLink in @objectstack/types) spells the same address.",
  },
  {
    id: 'retired-interfaces',
    today: `/studio/<package>/${RETIRED_INTERFACES_SEGMENT}[?…]`,
    builder: 'retiredInterfacesTarget',
    meaning: `The retired Interfaces pillar (objectstack#36502). Redirects to the package's home, \`${STUDIO_HOME_PILLAR}\` (and from there to its object list, objectstack#36904), keeping only STUDIO_RETIRED_INTERFACES_KEPT_PARAMS.`,
  },
]);

// ---------------------------------------------------------------------------
// Item types: where each opens today, and what it switches to
// ---------------------------------------------------------------------------

/** One `?surface=` type: the pillar it opens today and the metadata address it moves to. */
export interface StudioItemTypeRow {
  /** The `?surface=` type. */
  readonly type: string;
  /** The pillar that opens it today. */
  readonly pillar: StudioPillarKey;
  /** Today's `?surface=` value. */
  readonly surface: string;
  /** The qualifiers that ride beside `?surface=` for this type today. */
  readonly qualifiers: readonly string[];
  /** The `?surface=` spellings producers write today (`StudioSurfaceSpelling`). */
  readonly spellings: readonly StudioSurfaceSpelling[];
  /** The metadata address it moves to, or `null` when it is a pillar page with no item of its own. */
  readonly onMetadataAddress: string | null;
  /**
   * Set once the type has moved: the address its pillar address now redirects
   * to (step 3 above). Absent while the pillar still opens it.
   */
  readonly redirectsTo?: string;
}

export const STUDIO_ITEM_TYPES: readonly StudioItemTypeRow[] = Object.freeze([
  {
    // objectstack#36904 — switched: an object opens on its metadata address,
    // and this pillar address redirects there (`dataPillarRedirect`), keeping
    // `?action=` as the designer's query and dropping `?view=` and `?nav=`.
    type: 'object',
    pillar: 'data',
    surface: 'object:<name>',
    qualifiers: [DESIGNER_SURFACE_VIEW_PARAM, DESIGNER_SURFACE_ACTION_PARAM, DESIGNER_SURFACE_NAV_PARAM],
    spellings: ['component', 'name', 'form'],
    onMetadataAddress: '/studio/<package>/metadata/object/<name>',
  },
  {
    type: 'flow',
    pillar: 'automations',
    surface: 'flow:<name>',
    qualifiers: [],
    spellings: ['component'],
    onMetadataAddress: '/studio/<package>/metadata/flow/<name>',
  },
  {
    type: 'permission',
    pillar: 'access',
    surface: 'permission:<name>',
    qualifiers: [],
    spellings: ['component'],
    onMetadataAddress: '/studio/<package>/metadata/permission/<name>',
    // objectstack#36905 — moved (`accessPillarRedirect.ts`).
    redirectsTo: '/studio/<package>/metadata/permission/<name>?package=<package>',
  },
  {
    // The Access pillar's organization-wide defaults overview. Not a metadata
    // item: objectstack#36905 gave it a route of its own (the `owd` family).
    type: 'owd',
    pillar: 'access',
    surface: 'owd:overview',
    qualifiers: [],
    spellings: ['component'],
    onMetadataAddress: null,
    redirectsTo: `/studio/<package>/${STUDIO_OWD_SECTION}`,
  },
]);

// ---------------------------------------------------------------------------
// Query parameters
// ---------------------------------------------------------------------------

/** One query parameter a Studio address carries. */
export interface StudioQueryParamRow {
  readonly key: string;
  /** The values it takes. */
  readonly values: string;
  /** Where it is read, and what it means there. */
  readonly meaning: string;
  /**
   * What happens to it when an item moves to its metadata address:
   * `verbatim` — carried as it is; `qualifier` — rides beside `?surface=`, and
   * the designer card maps it onto its designer or drops it; `replaced` — the
   * metadata address itself carries what it said.
   */
  readonly onMetadataAddress: 'verbatim' | 'qualifier' | 'replaced';
  /** Whether the retired `/interfaces` redirect keeps it. */
  readonly keptOnRetiredInterfaces: boolean;
}

export const STUDIO_QUERY_PARAMS: readonly StudioQueryParamRow[] = Object.freeze([
  {
    key: DESIGNER_SURFACE_PARAM,
    values: '<type>:<name>, owd:overview',
    meaning: 'A pillar opened on one item (STUDIO_ITEM_TYPES).',
    onMetadataAddress: 'replaced',
    keptOnRetiredInterfaces: false,
  },
  {
    key: DESIGNER_SURFACE_VIEW_PARAM,
    values: '<object>.<key>',
    meaning: 'The list view an object surface shows (Data pillar).',
    onMetadataAddress: 'qualifier',
    keptOnRetiredInterfaces: false,
  },
  {
    key: DESIGNER_SURFACE_ACTION_PARAM,
    values: '<action name>',
    meaning: "An object surface opened on its Actions view at one action (Data pillar).",
    onMetadataAddress: 'qualifier',
    keptOnRetiredInterfaces: false,
  },
  {
    key: DESIGNER_SURFACE_NAV_PARAM,
    values: '<nav entry id>',
    meaning: 'The nav entry a surface was opened from (the retired Interfaces pillar wrote it; the mirror still clears it).',
    onMetadataAddress: 'qualifier',
    keptOnRetiredInterfaces: false,
  },
  {
    key: STUDIO_CHANGES_PARAM,
    values: STUDIO_CHANGES_REVIEW,
    meaning: "Opens the package's Changes drawer. The surface's, not a pillar's, so it is read on every pillar.",
    onMetadataAddress: 'verbatim',
    keptOnRetiredInterfaces: true,
  },
  {
    key: STUDIO_ITEM_REVIEW_PARAM,
    values: STUDIO_ITEM_REVIEW_VALUE,
    meaning: "Opens an item page's draft review in the area; the area does not send it to a pillar.",
    onMetadataAddress: 'verbatim',
    keptOnRetiredInterfaces: false,
  },
  {
    key: 'package',
    values: '<package id>, all',
    meaning: "The area's package binding; decides the leg (areaLocationRedirect).",
    onMetadataAddress: 'verbatim',
    keptOnRetiredInterfaces: false,
  },
  {
    key: CATALOG_SCOPE_PARAM,
    values: ENVIRONMENT_SCOPE,
    meaning: "The area's environment scope: the cross-package leg; the area does not send it to a pillar.",
    onMetadataAddress: 'verbatim',
    keptOnRetiredInterfaces: false,
  },
  {
    key: STUDIO_NEW_PARAM,
    values: STUDIO_NEW_PACKAGE_VALUE,
    meaning: "The retired new-package bookmark; Studio's entry forwards it to Setup's New Package. Entry only.",
    onMetadataAddress: 'verbatim',
    keptOnRetiredInterfaces: false,
  },
]);

/** The query keys the retired `/interfaces` redirect keeps: the rows above marked so. */
export const STUDIO_RETIRED_INTERFACES_KEPT_PARAMS: readonly string[] = Object.freeze(
  STUDIO_QUERY_PARAMS.filter((row) => row.keptOnRetiredInterfaces).map((row) => row.key),
);
