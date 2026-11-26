// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The one Studio scope that is not a package: the organization's own,
 * package-less flows (objectui#11553).
 *
 * ADR-0126 §7.1 makes a clone of a packaged flow "an ordinary org/install-owned
 * flow", and the clone door strips the package envelope on purpose, so the
 * stored row names no package. Studio was routed per package
 * (`/studio/:packageId/:tab`) and every rail read a package-scoped list, so
 * such a flow matched no route and no rail: Setup's Packaged automation page
 * says "Editing happens in Studio", and Studio could not reach the copy.
 *
 * This scope is where such a flow is listed and edited. It is the SAME
 * `StudioDesignSurface` with no package under it, not a second builder: the
 * area's route serves `/studio/~org/metadata/flow?source=runtime` (the list)
 * and `/studio/~org/metadata/flow/<name>?source=runtime` (the designer), and
 * the surface reads the reserved segment as "no package". objectstack#36903 —
 * the old `/studio/~org/automations` redirects there.
 *
 * ## The segment cannot name a package
 *
 * `~` is outside every package-id alphabet in play: the spec's
 * `MANIFEST_ID_PATTERN` (lowercase letters, digits, hyphens, dots), which this
 * app judges ids by (`isSpecPackageId`), and the alphabet `sanitizePackageId`
 * keeps (`packages-io.ts`, which also keeps underscores). So no package id can
 * ever equal it.
 *
 * ## What the scope offers, and what it does not
 *
 * Flows only, which is what the ruling on objectui#11553 asks for: every flow
 * that belongs to no package, listed and opened editable, because it is the
 * organization's own. It offers no "New" flow: new authoring stays
 * package-first, and this scope exists to reach flows that already exist
 * without a package (a clone is the measured producer).
 *
 * ## Where it lives (objectstack#36903)
 *
 * In its own leg of the "All metadata" area, as a package's flows are in
 * theirs: the list at `/studio/~org/metadata/flow`, a flow full-screen at
 * `/studio/~org/metadata/flow/<name>`. Both carry the list's source filter
 * `?source=runtime`: an item with no owning package is the list's `runtime`
 * source (`classifyProvenance`, the reading {@link isPackageLessItem} gives
 * it), so the list shows the scope's flows and the designer's ‹ › walk them
 * and nothing else. The old `/studio/~org/automations` address redirects here
 * (`automationsPillarRedirect.ts`).
 */

import { canonicalMetaUrlType } from '@objectstack/spec/shared';
import { LIST_SOURCE_PARAM } from '../metadata-admin/metadataListState.js';
import {
  STUDIO_ORG_SCOPE_SEGMENT,
  STUDIO_ORG_SCOPE_TYPE,
  studioMetadataAreaAddress,
  studioMetadataItemAddress,
} from './studioAddress.js';

// objectstack#36895 — the scope's reserved segment and its one pillar are
// Studio address vocabulary, owned by `studioAddress.ts`; re-exported here.
export { STUDIO_ORG_SCOPE_SEGMENT, STUDIO_ORG_SCOPE_PILLAR, STUDIO_ORG_SCOPE_TYPE } from './studioAddress.js';

/**
 * objectstack#36903 — the list source the scope's addresses carry: the items
 * with no owning package (`metadataListState.ts`'s `runtime`).
 */
export const STUDIO_ORG_SCOPE_SOURCE = 'runtime';

/** Whether a `/studio/:packageId` route segment names the package-less scope. */
export function isStudioOrgScope(segment: string | null | undefined): boolean {
  return segment === STUDIO_ORG_SCOPE_SEGMENT;
}

/**
 * The package-less scope's flows (objectstack#36903): its list in the area,
 * or one flow's full-screen designer, each with the scope's source filter.
 */
export function studioOrgScopePath(surface?: { type: string; name: string }): string {
  // The reserved segment is written as it is, as it always was (`~` is outside
  // every package-id alphabet, and `encodeURIComponent` leaves it unchanged).
  const query = `${LIST_SOURCE_PARAM}=${STUDIO_ORG_SCOPE_SOURCE}`;
  if (!surface) {
    return studioMetadataAreaAddress(STUDIO_ORG_SCOPE_SEGMENT, encodeURIComponent(STUDIO_ORG_SCOPE_TYPE), {
      query,
      segmentEncoding: 'verbatim',
    });
  }
  return studioMetadataItemAddress(STUDIO_ORG_SCOPE_SEGMENT, surface.type, surface.name, { query, segmentEncoding: 'verbatim' });
}

/**
 * The DB-authored pseudo-package. It names no package Studio can open, so an
 * item carrying it is read as package-less, the same reading the app-to-Studio
 * bridge gives it (`studioPackageId` in `utils/appRoute.ts`).
 */
const SYS_METADATA_PSEUDO_PACKAGE = 'sys_metadata';

function namesAPackage(value: unknown): boolean {
  return typeof value === 'string' && value !== '' && value !== SYS_METADATA_PSEUDO_PACKAGE;
}

/**
 * Whether a served metadata item belongs to no package.
 *
 * Reads `_packageId`, the spec's own "owning package machine id"
 * (`MetadataProtectionFields`, which `FlowSchema` spreads). The registry's
 * package filter keeps exactly the items whose `_packageId` equals the asked
 * package, so an item without one is precisely what every package-scoped list
 * omits, and what this scope has to list.
 */
export function isPackageLessItem(item: { _packageId?: unknown } | null | undefined): boolean {
  return !namesAPackage(item?._packageId);
}

/**
 * Whether a pending-draft header belongs to no package. The `_drafts` feed
 * carries the row's binding as `packageId` (`null` for an unbound row).
 */
export function isPackageLessDraft(header: { packageId?: unknown } | null | undefined): boolean {
  return !namesAPackage(header?.packageId);
}

/**
 * The drafts the package-less scope reviews and publishes: package-less FLOW
 * drafts, nothing else. A package-less draft of another type is not on this
 * surface, so its header must not count it and its Publish must not ship it.
 * The stored type is folded first: the feed returns each row's stored
 * spelling.
 */
export function isOrgScopeDraft(entry: { type: string; packageId?: unknown }): boolean {
  return canonicalMetaUrlType(entry.type) === 'flow' && isPackageLessDraft(entry);
}
