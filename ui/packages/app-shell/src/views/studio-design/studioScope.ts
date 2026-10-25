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
 * generic `/studio/:packageId/:tab` route serves `/studio/~org/automations`,
 * and the surface reads the reserved segment as "no package".
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
 * Flows only, which is what the ruling on objectui#11553 asks for: the
 * Automations pillar, listing every flow that belongs to no package and opening
 * it editable, because it is the organization's own. It offers no "New" flow:
 * new authoring stays package-first, and this scope exists to reach flows that
 * already exist without a package (a clone is the measured producer).
 */

import { canonicalMetaUrlType } from '@objectstack/spec/shared';
import {
  DESIGNER_SURFACE_PARAM,
  formatSurfaceParam,
} from '../metadata-admin/nav-selection.js';

/** The reserved `/studio/<segment>` value for the package-less scope. */
export const STUDIO_ORG_SCOPE_SEGMENT = '~org';

/** The one pillar the package-less scope offers. */
export const STUDIO_ORG_SCOPE_PILLAR = 'automations';

/** Whether a `/studio/:packageId` route segment names the package-less scope. */
export function isStudioOrgScope(segment: string | null | undefined): boolean {
  return segment === STUDIO_ORG_SCOPE_SEGMENT;
}

/**
 * The package-less scope's Automations pillar, optionally opened on one flow
 * through the pillar's `?surface=` deep link.
 */
export function studioOrgScopePath(surface?: { type: string; name: string }): string {
  const base = `/studio/${STUDIO_ORG_SCOPE_SEGMENT}/${STUDIO_ORG_SCOPE_PILLAR}`;
  if (!surface) return base;
  return `${base}?${DESIGNER_SURFACE_PARAM}=${encodeURIComponent(formatSurfaceParam(surface))}`;
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
