// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The Studio address mapping table (objectstack#36895, Studio redesign epic
 * #36890): every address family Studio answers to, every `?surface=`
 * spelling, and every query parameter, with what each pillar address became
 * when its type moved to the metadata address.
 *
 * The builders are in `studioAddress.ts`; this is their map. It is data the
 * code reads where the table decides something: the retired `/interfaces`
 * redirect keeps exactly the parameters this table marks as surviving it
 * ({@link STUDIO_RETIRED_INTERFACES_KEPT_PARAMS}).
 *
 * objectstack#36909 — every type has moved and every pillar retired: each
 * `?surface=` row names where its pillar address now redirects, in one hop
 * (`studioPillarRedirectModel.ts`).
 *
 * `studioAddress.test.ts` holds each row's example equal to its builder's
 * output, and each row's redirect equal to the redirect's, so the table
 * cannot drift from the code.
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
  STUDIO_OVERVIEW_SECTION,
  STUDIO_OVERVIEW_TAB_PARAM,
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
  {
    id: 'package',
    today: '/studio/<package>',
    builder: 'studioPackagePath',
    meaning: "A package's Studio; the route lands it on the package's object list in one redirect (objectstack#36904, objectstack#36909).",
  },
  {
    id: 'pillar',
    today: '/studio/<package>/<pillar>',
    builder: 'studioPillarPath',
    meaning: `A retired pillar of a package (\`${STUDIO_HOME_PILLAR}\`, automations, access, interfaces): no page of its own; the route redirects it in one hop (objectstack#36909, studioPillarRedirectModel.ts).`,
  },
  {
    id: 'pillar-item',
    today: `/studio/<package>/<pillar>?${DESIGNER_SURFACE_PARAM}=<type>:<name>`,
    builder: 'studioPillarPath',
    meaning: "A retired pillar opened on one item: redirects to the item's own address (STUDIO_ITEM_TYPES, redirectsTo).",
  },
  {
    id: 'owd',
    today: `/studio/<package>/${STUDIO_OWD_SECTION}[?${STUDIO_OWD_OBJECT_PARAM}=<object>]`,
    builder: 'studioOwdOverviewPath',
    meaning: "A package's organization-wide default sharing overview (objectstack#36905), optionally on one object. Not a metadata item and not a pillar.",
  },
  {
    id: 'overview',
    today: `/studio/<package>/${STUDIO_OVERVIEW_SECTION}[?${STUDIO_OVERVIEW_TAB_PARAM}=pending]`,
    builder: 'studioPackageOverviewPath',
    meaning:
      "A package's own page, 概览 Overview (objectstack#37454, ADR-0084 as amended 2026-11-26): the menu's first entry, on its Info tab or its Pending tab. Not a metadata item: there is no package type.",
  },
  {
    id: 'org-scope',
    today: '/studio/~org/metadata/flow?source=runtime',
    builder: 'studioOrgScopePath',
    meaning:
      "The package-less scope: the organization's own flows, listed in its own leg of the area (objectstack#36903). The old /studio/~org/automations redirects here.",
  },
  {
    id: 'org-scope-item',
    today: '/studio/~org/metadata/flow/<name>?source=runtime',
    builder: 'studioOrgScopePath',
    meaning:
      'A package-less flow, full-screen in the scope\'s leg of the area (objectstack#36903). The old /studio/~org/automations?surface=flow:<name> redirects here.',
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
    meaning:
      "A package's Changes drawer, opened from outside its Studio. The server's draft review link (studioChangesReviewLink in @objectstack/types) spells the same address; it redirects, with `changes=review` kept, to the package's object list, where the drawer opens (objectstack#36909).",
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
    meaning:
      "The retired Interfaces pillar (objectstack#36502). Redirects to the package's object list in one hop (objectstack#36909), keeping only STUDIO_RETIRED_INTERFACES_KEPT_PARAMS.",
  },
]);

// ---------------------------------------------------------------------------
// Item types: where each opens today, and what it switches to
// ---------------------------------------------------------------------------

/** One `?surface=` type: the pillar that opened it, and where that pillar address redirects now. */
export interface StudioItemTypeRow {
  /** The `?surface=` type. */
  readonly type: string;
  /** The retired pillar that opened it. */
  readonly pillar: StudioPillarKey;
  /** The pillar address's `?surface=` value. */
  readonly surface: string;
  /** The qualifiers that rode beside `?surface=` for this type. */
  readonly qualifiers: readonly string[];
  /** The `?surface=` spellings producers wrote (`StudioSurfaceSpelling`); the redirect reads each. */
  readonly spellings: readonly StudioSurfaceSpelling[];
  /** The metadata address it moved to, or `null` when it is a page with no item of its own. */
  readonly onMetadataAddress: string | null;
  /** The settled address its pillar address redirects to, in one hop (objectstack#36909). */
  readonly redirectsTo: string;
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
    redirectsTo: '/studio/<package>/metadata/object/<name>?package=<package>',
  },
  {
    // objectstack#36903 — switched: a flow opens its designer on its metadata
    // address, and this pillar address redirects there
    // (`automationsPillarRedirect.ts`), dropping `?view=` and `?nav=`.
    type: 'flow',
    pillar: 'automations',
    surface: 'flow:<name>',
    qualifiers: [],
    spellings: ['component'],
    onMetadataAddress: '/studio/<package>/metadata/flow/<name>',
    redirectsTo: '/studio/<package>/metadata/flow/<name>?package=<package>',
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
    key: STUDIO_OVERVIEW_TAB_PARAM,
    values: 'pending',
    meaning: "The overview's open tab (objectstack#37454): `pending` opens 待发布 Pending, where the menu's badge leads; absent opens 信息 Info. Read on the overview only.",
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
