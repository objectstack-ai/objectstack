// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Setup → People & organization: the two assignment pages (ADR-0146 D7).
 *
 * Assigning people is operational work, not authoring: a position's holders and
 * a permission set's direct grants are rows of the caller's organization, and
 * an administrator reaches them here without opening a catalog item. Each page
 * picks one catalog item and renders the section the item page already renders
 * for it (`PositionHoldersSection`, `AssignedUsersSection`), so the reads, the
 * writes and every server refusal are the sections' own.
 *
 * The entries that open them are Setup navigation contributions, which the
 * server's security plugin declares; these refs are what those entries name.
 */

import { componentRefToUrlSegments } from '../../services/componentRegistry.js';
import {
  holderKey,
  holdingOf,
  holdingPackage,
  type PermissionSetHolder,
  type PermissionSetHolding,
} from '../metadata-admin/permission-set-holder.js';

/** The component ref of the Position holders page. */
export const POSITION_HOLDERS_REF = 'security:position-holders';

/** The component ref of the Permission set assignment page. */
export const PERMISSION_SET_ASSIGNMENT_REF = 'security:permission-set-assignment';

/**
 * The page-scoped query parameter that names the picked item. Addressable
 * state (AGENTS.md #8): a shared or refreshed link opens the same item.
 */
export const POSITION_PARAM = 'position';
export const PERMISSION_SET_PARAM = 'set';
/**
 * objectstack#32537 — the package of the picked permission set, where more
 * than one package holds its name (ADR-0150 D4); absent otherwise.
 */
export const PERMISSION_SET_PACKAGE_PARAM = 'package';

/** Where a page opens inside the Setup app, optionally on one item. */
function pagePath(ref: string, param: string, name?: string): string {
  const base = `/apps/setup/component/${componentRefToUrlSegments(ref).join('/')}`;
  return name ? `${base}?${param}=${encodeURIComponent(name)}` : base;
}

export function positionHoldersPagePath(position?: string): string {
  return pagePath(POSITION_HOLDERS_REF, POSITION_PARAM, position);
}

export function permissionSetAssignmentPagePath(set?: string): string {
  return pagePath(PERMISSION_SET_ASSIGNMENT_REF, PERMISSION_SET_PARAM, set);
}

/** One pickable catalog item: its machine name and what the list shows. */
export interface CatalogEntry {
  name: string;
  /** The served label, or the name when the item has none. */
  label: string;
  description: string;
  /**
   * objectstack#32537 — which holder of the name this entry is, where more than
   * one package holds it (`catalogEntries` with `byHolder`); absent for a name
   * with one holder, which is addressed by the name alone.
   */
  holding?: PermissionSetHolding;
}

/** Environment first, then packages by id: a stable order among one name's holders. */
function holderOrder(a: PermissionSetHolder, b: PermissionSetHolder): number {
  if (a === b) return 0;
  if (a === null) return -1;
  if (b === null) return 1;
  return a.localeCompare(b);
}

/**
 * The pickable items of a registry list (`/meta/<type>`), by label then name.
 * An item without a string name cannot be addressed, so it is left out.
 *
 * `byHolder` (permission sets, objectstack#32537): a name more than one
 * package holds is one entry per holder, each carrying its holding; a name
 * with one holder is one entry, as before.
 */
export function catalogEntries(items: readonly unknown[], options?: { byHolder?: boolean }): CatalogEntry[] {
  const out: CatalogEntry[] = [];
  const seen = new Set<string>();
  for (const raw of items) {
    const it = raw as { name?: unknown; label?: unknown; description?: unknown } | null;
    if (typeof it?.name !== 'string' || !it.name) continue;
    const holding = options?.byHolder ? holdingOf(items, raw) : undefined;
    const key = holding ? `${it.name}@${holderKey(holding.packageId)}` : it.name;
    if (seen.has(key)) continue;
    seen.add(key);
    const label = typeof it.label === 'string' && it.label.trim() ? it.label : it.name;
    const description = typeof it.description === 'string' ? it.description : '';
    out.push(holding ? { name: it.name, label, description, holding } : { name: it.name, label, description });
  }
  return out.sort(
    (a, b) =>
      a.label.localeCompare(b.label) ||
      a.name.localeCompare(b.name) ||
      holderOrder(a.holding?.packageId ?? null, b.holding?.packageId ?? null),
  );
}

/** The key a list draws an entry by: its name, and its holder where it carries one. */
export function catalogEntryKey(entry: CatalogEntry): string {
  return entry.holding ? `${entry.name}@${holderKey(entry.holding.packageId)}` : entry.name;
}

/**
 * Is `entry` the pick a page's link names — `name`, and `packageId` (the
 * link's package, or `null`) where the entry is one of several holders? The
 * environment's own set and a name's one holder are named by the name alone.
 */
export function entryAnswersPick(entry: CatalogEntry, name: string, packageId: string | null): boolean {
  if (entry.name !== name) return false;
  if (!entry.holding) return true;
  return (holdingPackage(entry.holding) ?? null) === (packageId || null);
}

/** The entries whose label or name contains `query`, ignoring case. */
export function filterCatalogEntries(entries: readonly CatalogEntry[], query: string): CatalogEntry[] {
  const q = query.trim().toLocaleLowerCase();
  if (!q) return [...entries];
  return entries.filter((e) => e.label.toLocaleLowerCase().includes(q) || e.name.toLocaleLowerCase().includes(q));
}
